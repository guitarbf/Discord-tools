import type { DeleteApi } from "../discord/api";
import { KillSwitchEngagedError, SecurityError } from "../security/errors";
import type { KillSwitch } from "../security/killSwitch";
import type { LoggerLike } from "../security/logger";
import { sanitizeError } from "../security/sanitize";
import { Emitter } from "../utils/emitter";
import { AbortedError, sleep as defaultSleep, type SleepFn } from "../utils/sleep";
import { MAX_DELETE_DELAY_MS } from "./speed";
import type { CleanupTarget, MatchedMessage } from "./types";

export type JobStatus = "idle" | "running" | "paused" | "completed" | "cancelled" | "stopped" | "failed";

export type SkipReason = "alreadyDeleted" | "notPermitted" | "notOwnMessage";

export interface JobProgress {
    jobId: string | null;
    status: JobStatus;
    total: number;
    processed: number;
    deleted: number;
    skipped: number;
    errors: number;
    rateLimitPauses: number;
    skipReasons: Record<SkipReason, number>;
    currentDelayMs: number;
    startedAt: number | null;
    finishedAt: number | null;
    etaMs: number | null;
    waitingUntil: number | null;
    waitReason: "rateLimit" | "retry" | "pace" | null;
    lastError: string | null;
}

export interface CleanupJob {
    id: string;
    userId: string;
    target: CleanupTarget;
    items: readonly MatchedMessage[];
    deleteDelayMs: number;
}

export interface EngineDeps {
    api: DeleteApi;
    getCurrentUserId: () => string | null;
    killSwitch: KillSwitch;
    logger: LoggerLike;
    sleep?: SleepFn;
    now?: () => number;
}

const MAX_ERROR_RETRIES = 2;
const MAX_CONSECUTIVE_ITEM_ERRORS = 5;
const MAX_RATE_LIMIT_STREAK = 10;
const RATE_LIMIT_SLOWDOWN = 1.5;
const RECOVERY_AFTER_SUCCESSES = 25;
const RECOVERY_FACTOR = 0.9;

class JobFailure extends Error {
    override name = "JobFailure";
}

type ItemResult = "deleted" | SkipReason | "error";

function idleProgress(): JobProgress {
    return {
        jobId: null, status: "idle", total: 0, processed: 0, deleted: 0, skipped: 0, errors: 0, rateLimitPauses: 0,
        skipReasons: { alreadyDeleted: 0, notPermitted: 0, notOwnMessage: 0 },
        currentDelayMs: 0, startedAt: null, finishedAt: null, etaMs: null, waitingUntil: null, waitReason: null, lastError: null
    };
}

export class CleanupEngine {
    private progress: JobProgress = idleProgress();
    private readonly emitter: Emitter<JobProgress>;
    private abort: AbortController | null = null;
    private unregisterAbort: (() => void) | null = null;
    private resumeWaiter: (() => void) | null = null;
    private pauseRequested = false;
    private stopReason: "cancelled" | "stopped" | null = null;
    private readonly sleep: SleepFn;
    private readonly now: () => number;
    private finishedCallback: ((progress: JobProgress) => void) | null = null;
    private latencyTotal = 0;
    private latencySamples = 0;

    constructor(private readonly deps: EngineDeps) {
        this.sleep = deps.sleep ?? defaultSleep;
        this.now = deps.now ?? Date.now;
        this.emitter = new Emitter<JobProgress>(err => deps.logger.error("Progress listener failed", err));
    }

    get isActive(): boolean {
        return this.progress.status === "running" || this.progress.status === "paused";
    }

    getProgress(): JobProgress {
        return { ...this.progress, skipReasons: { ...this.progress.skipReasons } };
    }

    subscribe(listener: (progress: JobProgress) => void): () => void {
        return this.emitter.subscribe(listener);
    }

    start(job: CleanupJob, onFinished?: (progress: JobProgress) => void): Promise<JobProgress> {
        if (this.isActive) throw new Error("A cleanup is already running.");
        if (this.deps.killSwitch.engaged) throw new KillSwitchEngagedError();

        this.abort = new AbortController();
        this.unregisterAbort = this.deps.killSwitch.register(this.abort);
        this.pauseRequested = false;
        this.stopReason = null;
        this.finishedCallback = onFinished ?? null;
        this.latencyTotal = 0;
        this.latencySamples = 0;
        this.progress = {
            ...idleProgress(),
            jobId: job.id,
            status: "running",
            total: job.items.length,
            currentDelayMs: job.deleteDelayMs,
            startedAt: this.now()
        };
        this.updateEta();
        this.emit();
        return this.run(job);
    }

    pause(): void {
        if (this.progress.status !== "running") return;
        this.pauseRequested = true;
        this.progress.status = "paused";
        this.emit();
    }

    resume(): void {
        if (this.progress.status !== "paused") return;
        if (this.deps.killSwitch.engaged) {
            this.progress.lastError = "STOP ALL OPERATIONS is engaged. Re-enable operations before resuming.";
            this.emit();
            return;
        }
        this.pauseRequested = false;
        this.progress.status = "running";
        this.emit();
        this.resumeWaiter?.();
        this.resumeWaiter = null;
    }

    cancel(): void {
        this.halt("cancelled");
    }

    stopNow(): void {
        this.halt("stopped");
    }

    private halt(reason: "cancelled" | "stopped"): void {
        if (!this.isActive) return;
        this.stopReason = reason;
        this.abort?.abort();
        this.resumeWaiter?.();
        this.resumeWaiter = null;
    }

    private async run(job: CleanupJob): Promise<JobProgress> {
        const { signal } = (this.abort!);
        let consecutiveErrors = 0;
        let successesSinceSlowdown = 0;
        try {
            for (let i = 0; i < job.items.length; i++) {
                await this.checkpoint(signal);
                const item = job.items[i]!;

                if (item.authorId !== job.userId) {
                    this.recordSkip("notOwnMessage");
                    continue;
                }
                if (this.deps.getCurrentUserId() !== job.userId) {
                    throw new JobFailure("The logged-in Discord account changed. Cleanup stopped for safety.");
                }

                const result = await this.processItem(item, signal);
                this.progress.processed++;
                if (result === "deleted") {
                    this.progress.deleted++;
                    consecutiveErrors = 0;
                    if (++successesSinceSlowdown >= RECOVERY_AFTER_SUCCESSES) {
                        successesSinceSlowdown = 0;
                        this.progress.currentDelayMs = Math.max(job.deleteDelayMs, Math.round(this.progress.currentDelayMs * RECOVERY_FACTOR));
                    }
                } else if (result === "error") {
                    this.progress.errors++;
                    if (++consecutiveErrors >= MAX_CONSECUTIVE_ITEM_ERRORS) {
                        throw new JobFailure(`${MAX_CONSECUTIVE_ITEM_ERRORS} messages in a row failed. Stopped to avoid sending more failing requests.`);
                    }
                } else {
                    this.recordSkip(result, false);
                    consecutiveErrors = 0;
                }
                this.updateEta();
                this.emit();

                if (i < job.items.length - 1) await this.wait(this.progress.currentDelayMs, "pace", signal);
            }
            this.finish("completed");
        } catch (err) {
            if (err instanceof AbortedError || err instanceof KillSwitchEngagedError) {
                this.finish(this.stopReason ?? "stopped");
            } else if (err instanceof JobFailure) {
                this.progress.lastError = err.message;
                this.finish("failed");
            } else if (err instanceof SecurityError) {
                this.deps.logger.error("Cleanup stopped by a security check", err);
                this.progress.lastError = `Security check failed: ${err.message}`;
                this.finish("failed");
            } else {
                this.deps.logger.error("Cleanup failed unexpectedly", err);
                this.progress.lastError = sanitizeError(err, { redactIds: true }).message || "Unexpected error";
                this.finish("failed");
            }
        }
        return this.getProgress();
    }

    private async processItem(item: MatchedMessage, signal: AbortSignal): Promise<ItemResult> {
        let retries = 0;
        let rateLimitStreak = 0;
        for (; ;) {
            await this.checkpoint(signal);
            const startedAt = this.now();
            const outcome = await this.deps.api.deleteMessage(item.channelId, item.id);
            this.latencyTotal += this.now() - startedAt;
            this.latencySamples++;

            switch (outcome.kind) {
                case "ok":
                    return "deleted";
                case "notFound":
                    return "alreadyDeleted";
                case "forbidden":
                    return "notPermitted";
                case "rateLimited":
                case "indexing": {
                    this.progress.rateLimitPauses++;
                    if (++rateLimitStreak > MAX_RATE_LIMIT_STREAK) {
                        throw new JobFailure("Discord kept rate limiting delete requests. Stopped to be safe; try a slower speed later.");
                    }
                    this.progress.currentDelayMs = Math.min(MAX_DELETE_DELAY_MS, Math.round(this.progress.currentDelayMs * RATE_LIMIT_SLOWDOWN));
                    this.emit();
                    await this.wait(outcome.retryAfterMs + 1000, "rateLimit", signal);
                    continue;
                }
                case "error":
                    this.progress.lastError = outcome.message;
                    if (++retries > MAX_ERROR_RETRIES) return "error";
                    await this.wait(2000 * 2 ** retries, "retry", signal);
                    continue;
            }
        }
    }

    private recordSkip(reason: SkipReason, countProcessed = true): void {
        if (countProcessed) this.progress.processed++;
        this.progress.skipped++;
        this.progress.skipReasons[reason]++;
        this.updateEta();
        this.emit();
    }

    private async checkpoint(signal: AbortSignal): Promise<void> {
        if (signal.aborted || this.deps.killSwitch.engaged) throw new AbortedError();
        while (this.pauseRequested) {
            await new Promise<void>(resolve => {
                this.resumeWaiter = resolve;
            });
            if (signal.aborted) throw new AbortedError();
        }
    }

    private async wait(ms: number, reason: NonNullable<JobProgress["waitReason"]>, signal: AbortSignal): Promise<void> {
        this.progress.waitingUntil = this.now() + ms;
        this.progress.waitReason = reason;
        this.emit();
        try {
            await this.sleep(ms, signal);
        } finally {
            this.progress.waitingUntil = null;
            this.progress.waitReason = null;
        }
    }

    private updateEta(): void {
        const remaining = this.progress.total - this.progress.processed;
        const latency = this.latencySamples ? this.latencyTotal / this.latencySamples : 300;
        this.progress.etaMs = remaining > 0 ? Math.round(remaining * (this.progress.currentDelayMs + latency)) : 0;
    }

    private finish(status: JobStatus): void {
        this.progress.status = status;
        this.progress.finishedAt = this.now();
        this.progress.waitingUntil = null;
        this.progress.waitReason = null;
        if (status === "completed") this.progress.etaMs = 0;
        this.unregisterAbort?.();
        this.unregisterAbort = null;
        this.abort = null;
        this.pauseRequested = false;
        this.emit();
        const cb = this.finishedCallback;
        this.finishedCallback = null;
        cb?.(this.getProgress());
    }

    private emit(): void {
        this.emitter.emit(this.getProgress());
    }

    clearFinished(): void {
        if (this.isActive) return;
        this.progress = idleProgress();
        this.emit();
    }

    dispose(): void {
        this.stopNow();
        this.emitter.clear();
    }
}
