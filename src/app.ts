import { type CleanupDraft, DraftError, draftKey, draftToPlan, EMPTY_DRAFT } from "./cleanup/draft";
import { CleanupEngine, type JobProgress } from "./cleanup/engine";
import { describeFilters } from "./cleanup/filters";
import { PREVIEW_MAX_AGE_MS } from "./cleanup/plan";
import type { Preset, PresetDraft } from "./cleanup/presets";
import { scanForMatches, type ScanProgress, type ScanResult } from "./cleanup/scanner";
import { resolveSpeed } from "./cleanup/speed";
import type { CleanupPlan } from "./cleanup/types";
import { DiscordApi } from "./discord/api";
import type { DiscordPort, RawRequester } from "./discord/types";
import { type LedgerSnapshot,NetworkLedger } from "./privacy/ledger";
import { NetworkGuard } from "./privacy/networkGuard";
import { type AuditFinding,runSecurityAudit } from "./security/audit";
import { KillSwitchEngagedError, SecurityError } from "./security/errors";
import { KillSwitch } from "./security/killSwitch";
import { type ConsoleLike, type DebugState, Logger } from "./security/logger";
import { buildErrorReport } from "./security/report";
import { sanitizeError } from "./security/sanitize";
import type { DestroyResult, KeyValueStore } from "./storage/kv";
import { LocalStore } from "./storage/localStore";
import { DEFAULT_PREFERENCES, type HistoryEntry, type HistoryStatus, type Preferences } from "./storage/schema";
import { Emitter } from "./utils/emitter";
import { localId } from "./utils/id";
import { AbortedError, type SleepFn } from "./utils/sleep";

export interface AppEnvironment {
    port: DiscordPort;
    raw: RawRequester | null;
    kv: KeyValueStore;
    networkPrimitivesWrapped: () => boolean | null;
    console?: ConsoleLike;
    sleep?: SleepFn;
    now?: () => number;
}

export type ScanStatus = "idle" | "scanning" | "done" | "error" | "cancelled";

export interface ScanState {
    status: ScanStatus;
    draftKey: string | null;
    plan: CleanupPlan | null;
    userId: string | null;
    progress: ScanProgress | null;
    result: ScanResult | null;
    error: string | null;
    completedAt: number | null;
}

export interface AppSnapshot {
    loaded: boolean;
    loadError: string | null;
    prefs: Preferences;
    presets: readonly Preset[];
    history: readonly HistoryEntry[];
    scan: ScanState;
    draft: CleanupDraft;
    job: JobProgress;
    killSwitchEngaged: boolean;
    ledger: LedgerSnapshot;
    debug: DebugState;
    securityAlerts: readonly string[];
    storageWarnings: readonly string[];
    cleanupUnavailableReason: string | null;
}

export interface StartConfirmation {
    confirmed: boolean;
    largeOperationConfirmed: boolean;
}

const IDLE_SCAN: ScanState = {
    status: "idle", draftKey: null, plan: null, userId: null, progress: null, result: null, error: null, completedAt: null
};

const HISTORY_SAVE_EVERY = 50;

export class UserFacingError extends Error {
    override name = "UserFacingError";
}

export class App {
    readonly ledger: NetworkLedger;
    readonly killSwitch = new KillSwitch();
    readonly logger: Logger;
    private readonly api: DiscordApi | null;
    private readonly engine: CleanupEngine;
    private readonly store: LocalStore;
    private readonly emitter: Emitter<void>;
    private readonly now: () => number;
    private readonly disposers: Array<() => void> = [];

    private prefs: Preferences = { ...DEFAULT_PREFERENCES };
    private presets: Preset[] = [];
    private history: HistoryEntry[] = [];
    private scan: ScanState = IDLE_SCAN;
    private draft: CleanupDraft = { ...EMPTY_DRAFT };
    private scanAbort: AbortController | null = null;
    private loaded = false;
    private loadError: string | null = null;
    private securityAlerts: string[] = [];
    private storageWarnings: string[] = [];
    private activeHistoryId: string | null = null;
    private lastHistorySaveAt = 0;
    private snapshot: AppSnapshot;
    private disposed = false;

    constructor(private readonly env: AppEnvironment) {
        this.now = env.now ?? Date.now;
        this.logger = new Logger(env.console, this.now);
        this.ledger = new NetworkLedger(this.now());
        this.emitter = new Emitter<void>(err => this.logger.error("UI listener failed", err));
        const guard = new NetworkGuard(this.ledger, this.killSwitch);
        this.api = env.raw ? new DiscordApi(env.raw, guard) : null;
        this.store = new LocalStore(env.kv);
        this.engine = new CleanupEngine({
            api: this.api ?? { deleteMessage: async () => ({ kind: "error", status: null, code: null, message: "Discord's REST module is unavailable" }) },
            getCurrentUserId: () => env.port.getCurrentUserId(),
            killSwitch: this.killSwitch,
            logger: this.logger,
            sleep: env.sleep,
            now: this.now
        });

        this.disposers.push(
            this.engine.subscribe(p => this.onJobProgress(p)),
            this.killSwitch.subscribe(() => this.changed()),
            this.ledger.subscribe(() => this.changed()),
            this.logger.subscribe(() => this.changed())
        );
        this.snapshot = this.buildSnapshot();
    }

    async init(): Promise<void> {
        try {
            const data = await this.store.load();
            if (this.disposed) return;
            this.prefs = data.prefs;
            this.draft = { ...this.draft, speed: data.prefs.defaultSpeed };
            this.presets = data.presets;
            this.storageWarnings = data.warnings;
            let staleFound = false;
            this.history = data.history.map(h => {
                if (h.status !== "running") return h;
                staleFound = true;
                return { ...h, status: "interrupted" as const, note: "Discord was closed or the addon was disabled during this cleanup." };
            });
            if (staleFound) await this.persist(() => this.store.saveHistory(this.history));
        } catch (err) {
            this.loadError = "Local settings couldn't be loaded. Defaults are in use.";
            this.logger.error("Failed to load local data", err);
        }
        this.loaded = true;
        this.changed();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.scanAbort?.abort();
        this.engine.dispose();
        for (const d of this.disposers.splice(0)) d();
        this.logger.dispose();
        this.ledger.dispose();
        this.killSwitch.dispose();
        this.emitter.clear();
        this.scan = IDLE_SCAN;
        this.draft = { ...EMPTY_DRAFT };
    }

    subscribe(listener: () => void): () => void {
        return this.emitter.subscribe(listener);
    }

    getSnapshot(): AppSnapshot {
        return this.snapshot;
    }

    get port(): DiscordPort {
        return this.env.port;
    }

    private changed(): void {
        if (this.disposed) return;
        this.snapshot = this.buildSnapshot();
        this.emitter.emit();
    }

    private buildSnapshot(): AppSnapshot {
        return {
            loaded: this.loaded,
            loadError: this.loadError,
            prefs: this.prefs,
            presets: this.presets,
            history: this.history,
            scan: this.scan,
            draft: this.draft,
            job: this.engine.getProgress(),
            killSwitchEngaged: this.killSwitch.engaged,
            ledger: this.ledger.snapshot(),
            debug: this.logger.debugState,
            securityAlerts: this.securityAlerts,
            storageWarnings: this.storageWarnings,
            cleanupUnavailableReason: this.api ? null : "Discord's REST module couldn't be found, possibly after a Discord update. Cleanup is turned off; no workaround is attempted."
        };
    }

    private async persist(write: () => Promise<void>): Promise<void> {
        try {
            await write();
        } catch (err) {
            if (err instanceof SecurityError) {
                this.securityAlerts = [...this.securityAlerts, err.message];
                this.logger.error("Storage write refused by security check", err);
                this.changed();
                throw err;
            }
            this.logger.error("Failed to save local data", err);
            throw new UserFacingError("Couldn't save to local storage.");
        }
    }

    async updatePrefs(patch: Partial<Preferences>): Promise<void> {
        const next = { ...this.prefs, ...patch };
        await this.persist(() => this.store.savePrefs(next));
        this.prefs = next;
        if (patch.historyRetention !== undefined) await this.trimHistory();
        this.changed();
    }

    acknowledgeTos(): Promise<void> {
        return this.updatePrefs({ tosAcknowledgedAt: this.now() });
    }

    private requireReady(): { api: DiscordApi; userId: string; } {
        if (!this.api) throw new UserFacingError(this.snapshot.cleanupUnavailableReason ?? "Cleanup is unavailable.");
        if (this.killSwitch.engaged) throw new KillSwitchEngagedError();
        if (this.prefs.tosAcknowledgedAt === null) throw new UserFacingError("Please read and acknowledge the risk notice first.");
        const userId = this.env.port.getCurrentUserId();
        if (!userId) throw new UserFacingError("Couldn't determine the logged-in account.");
        return { api: this.api, userId };
    }

    private validateTarget(plan: CleanupPlan): void {
        if (plan.target.kind === "channel") {
            const channel = this.env.port.getChannel(plan.target.channelId);
            if (!channel) throw new UserFacingError("That channel isn't available in your client.");
            if (!channel.hasMessages) throw new UserFacingError("This channel type has no messages of its own (e.g. forums or categories). Choose a thread or text channel.");
        } else if (!this.env.port.getGuild(plan.target.guildId)) {
            throw new UserFacingError("That server isn't available in your client.");
        }
    }

    setDraft(patch: Partial<CleanupDraft>): void {
        this.draft = { ...this.draft, ...patch };
        this.changed();
    }

    private planFromDraft(draft: CleanupDraft): CleanupPlan {
        try {
            return draftToPlan(draft, this.env.port, this.now());
        } catch (err) {
            if (err instanceof DraftError) throw new UserFacingError(err.message);
            throw err;
        }
    }

    async startPreview(): Promise<void> {
        const { api, userId } = this.requireReady();
        const { draft } = this;
        const plan = this.planFromDraft(draft);
        this.validateTarget(plan);
        if (this.engine.isActive) throw new UserFacingError("Wait for the running cleanup to finish before previewing.");
        this.scanAbort?.abort();

        const abort = new AbortController();
        this.scanAbort = abort;
        const unregister = this.killSwitch.register(abort);
        this.scan = { ...IDLE_SCAN, status: "scanning", draftKey: draftKey(draft), plan, userId };
        this.changed();

        try {
            const result = await scanForMatches({
                api,
                userId,
                plan,
                searchDelayMs: resolveSpeed(draft.speed).searchDelayMs,
                signal: abort.signal,
                logger: this.logger,
                keepSnippets: this.prefs.showPreviewSnippets,
                sleep: this.env.sleep,
                now: this.now,
                onProgress: progress => {
                    if (this.scanAbort !== abort) return;
                    this.scan = { ...this.scan, progress };
                    this.changed();
                }
            });
            if (this.scanAbort !== abort) return;
            this.scan = { ...this.scan, status: "done", result, progress: result, completedAt: this.now() };
        } catch (err) {
            if (this.scanAbort !== abort) return;
            if (err instanceof AbortedError || err instanceof KillSwitchEngagedError) {
                this.scan = { ...this.scan, status: "cancelled", error: null };
            } else {
                if (err instanceof SecurityError) this.securityAlerts = [...this.securityAlerts, err.message];
                this.logger.error("Preview failed", err);
                this.scan = { ...this.scan, status: "error", error: sanitizeError(err, { redactIds: true }).message || "Preview failed." };
            }
        } finally {
            unregister();
            if (this.scanAbort === abort) this.scanAbort = null;
            this.changed();
        }
    }

    cancelPreview(): void {
        this.scanAbort?.abort();
    }

    clearPreview(): void {
        this.scanAbort?.abort();
        this.scanAbort = null;
        this.scan = IDLE_SCAN;
        this.changed();
    }

    startBlocker(draft: CleanupDraft = this.draft): string | null {
        if (!this.api) return "Cleanup is unavailable.";
        if (this.killSwitch.engaged) return "STOP ALL OPERATIONS is engaged.";
        if (this.engine.isActive) return "A cleanup is already running.";
        const { scan } = this;
        if (scan.status !== "done" || !scan.result) return "Preview the matching messages first.";
        if (scan.draftKey !== draftKey(draft)) return "The selection changed since the preview. Preview again.";
        if (scan.completedAt !== null && this.now() - scan.completedAt > PREVIEW_MAX_AGE_MS) return "The preview is out of date. Preview again.";
        if (scan.userId !== this.env.port.getCurrentUserId()) return "The logged-in account changed. Preview again.";
        if (scan.result.items.length === 0) return "No matching messages.";
        return null;
    }

    async startCleanup(confirmation: StartConfirmation): Promise<void> {
        const { userId } = this.requireReady();
        const blocker = this.startBlocker();
        if (blocker) throw new UserFacingError(blocker);
        const plan = this.scan.plan!;
        const { speed } = this.draft;
        if (!confirmation.confirmed) throw new UserFacingError("Confirmation is required.");
        const { items } = (this.scan.result!);
        if (items.length > this.prefs.largeOperationThreshold && !confirmation.largeOperationConfirmed) {
            throw new UserFacingError("This is a large operation and needs a second confirmation.");
        }

        const resolved = resolveSpeed(speed);
        const jobId = localId();
        const entry: HistoryEntry = {
            id: jobId,
            startedAt: this.now(),
            finishedAt: null,
            targetKind: plan.target.kind,
            channelId: plan.target.kind === "channel" ? plan.target.channelId : null,
            guildId: plan.target.guildId,
            filterSummary: describeFilters(plan.filters, plan.range, { includeKeywords: this.prefs.storeKeywordsInHistory }),
            speedLabel: resolved.label,
            total: items.length,
            processed: 0, deleted: 0, skipped: 0, errors: 0, rateLimitPauses: 0,
            status: "running",
            note: null
        };
        this.history = [entry, ...this.history];
        await this.trimHistory();
        await this.persist(() => this.store.saveHistory(this.history));
        this.activeHistoryId = jobId;
        this.lastHistorySaveAt = 0;

        void this.engine.start({ id: jobId, userId, target: plan.target, items, deleteDelayMs: resolved.deleteDelayMs }, final => {
            void this.finalizeHistory(jobId, final);
            this.scan = IDLE_SCAN;
            this.changed();
        });
    }

    pauseCleanup(): void {
        this.engine.pause();
    }

    resumeCleanup(): void {
        this.engine.resume();
    }

    cancelCleanup(): void {
        this.engine.cancel();
    }

    dismissFinishedJob(): void {
        this.engine.clearFinished();
    }

    private onJobProgress(progress: JobProgress): void {
        if (this.activeHistoryId && progress.processed - this.lastHistorySaveAt >= HISTORY_SAVE_EVERY) {
            this.lastHistorySaveAt = progress.processed;
            this.updateHistoryEntry(this.activeHistoryId, progress, "running");
            void this.persist(() => this.store.saveHistory(this.history)).catch(() => undefined);
        }
        this.changed();
    }

    private updateHistoryEntry(id: string, p: JobProgress, status: HistoryStatus, note: string | null = null): void {
        this.history = this.history.map(h => h.id !== id ? h : {
            ...h,
            processed: p.processed, deleted: p.deleted, skipped: p.skipped, errors: p.errors, rateLimitPauses: p.rateLimitPauses,
            status,
            finishedAt: status === "running" ? null : p.finishedAt,
            note: note ?? h.note
        });
    }

    private async finalizeHistory(id: string, final: JobProgress): Promise<void> {
        const status: HistoryStatus = final.status === "idle" || final.status === "running" || final.status === "paused" ? "interrupted" : final.status;
        this.updateHistoryEntry(id, final, status, final.lastError);
        if (this.activeHistoryId === id) this.activeHistoryId = null;
        try {
            await this.persist(() => this.store.saveHistory(this.history));
        } catch {
            // Logged in persist().
        }
        this.changed();
    }

    stopAllOperations(): void {
        this.killSwitch.engage(this.now());
        this.engine.stopNow();
        this.scanAbort?.abort();
        this.logger.warn("STOP ALL OPERATIONS engaged by user");
        this.changed();
    }

    resumeOperations(): void {
        this.killSwitch.rearm();
    }

    clearTemporaryData(): void {
        this.clearPreview();
        this.draft = { ...EMPTY_DRAFT, speed: this.prefs.defaultSpeed };
        this.logger.disableDebug();
        this.engine.clearFinished();
        this.changed();
    }

    async deleteAllLocalData(): Promise<DestroyResult> {
        if (this.engine.isActive) throw new UserFacingError("Stop the running cleanup before deleting local data.");
        this.scanAbort?.abort();
        let result: DestroyResult;
        try {
            result = await this.store.deleteAll();
        } catch (err) {
            this.logger.error("Deleting local data failed", err);
            throw new UserFacingError("Deleting local data failed. Some data may remain; try again or restart Discord.");
        }
        this.prefs = { ...DEFAULT_PREFERENCES };
        this.draft = { ...EMPTY_DRAFT };
        this.presets = [];
        this.history = [];
        this.storageWarnings = [];
        this.activeHistoryId = null;
        this.changed();
        return result;
    }

    async resetAddon(): Promise<DestroyResult> {
        this.engine.stopNow();
        this.scanAbort?.abort();
        await this.waitForEngineIdle();
        this.clearTemporaryData();
        const result = await this.deleteAllLocalData();
        this.securityAlerts = [];
        this.killSwitch.rearm();
        this.changed();
        return result;
    }

    private async waitForEngineIdle(): Promise<void> {
        for (let i = 0; i < 100 && this.engine.isActive; i++) await new Promise(r => setTimeout(r, 20));
    }

    async createPreset(draft: PresetDraft): Promise<Preset> {
        const at = this.now();
        const preset: Preset = { ...draft, id: localId(), createdAt: at, updatedAt: at };
        const next = [...this.presets, preset];
        await this.persist(() => this.store.savePresets(next));
        this.presets = next;
        this.changed();
        return preset;
    }

    async updatePreset(id: string, draft: PresetDraft): Promise<void> {
        const next = this.presets.map(p => p.id === id ? { ...p, ...draft, updatedAt: this.now() } : p);
        await this.persist(() => this.store.savePresets(next));
        this.presets = next;
        this.changed();
    }

    async deletePreset(id: string): Promise<void> {
        const next = this.presets.filter(p => p.id !== id);
        await this.persist(() => this.store.savePresets(next));
        this.presets = next;
        this.changed();
    }

    private async trimHistory(): Promise<void> {
        const max = this.prefs.historyRetention;
        if (this.history.length <= max) return;
        this.history = this.history.filter((h, i) => i < max || h.id === this.activeHistoryId);
        await this.persist(() => this.store.saveHistory(this.history));
    }

    async deleteHistoryEntry(id: string): Promise<void> {
        if (id === this.activeHistoryId) throw new UserFacingError("This entry belongs to the running cleanup.");
        const next = this.history.filter(h => h.id !== id);
        await this.persist(() => this.store.saveHistory(next));
        this.history = next;
        this.changed();
    }

    async clearHistory(): Promise<void> {
        const next = this.history.filter(h => h.id === this.activeHistoryId);
        await this.persist(() => this.store.saveHistory(next));
        this.history = next;
        this.changed();
    }

    enableDebug(minutes: number, includeMessageContent: boolean): void {
        this.logger.enableDebug(minutes * 60_000, includeMessageContent);
        this.logger.info("Temporary debug logging enabled", { minutes, includeMessageContent });
    }

    disableDebug(): void {
        this.logger.disableDebug();
    }

    dismissSecurityAlerts(): void {
        this.securityAlerts = [];
        this.changed();
    }

    async runAudit(): Promise<AuditFinding[]> {
        let stored: Record<string, unknown> | { error: string; };
        try {
            stored = await this.store.readAllRaw();
        } catch (err) {
            this.logger.error("Audit could not read local storage", err);
            stored = { error: "Reading local storage failed." };
        }
        return runSecurityAudit({
            ledger: this.ledger.snapshot(),
            debug: this.logger.debugState,
            prefs: this.prefs,
            stored,
            storageWarnings: this.storageWarnings,
            killSwitchEngaged: this.killSwitch.engaged,
            modules: this.env.port.moduleAvailability(),
            networkPrimitivesWrapped: this.env.networkPrimitivesWrapped(),
            previewInMemory: this.scan.result !== null,
            securityAlerts: this.securityAlerts
        });
    }

    buildDiagnosticReport(): string {
        const job = this.engine.getProgress();
        return buildErrorReport({
            job: { status: job.status, total: job.total, processed: job.processed, deleted: job.deleted, skipped: job.skipped, errors: job.errors, rateLimitPauses: job.rateLimitPauses, lastError: job.lastError },
            scan: { status: this.scan.status, error: this.scan.error, scanned: this.scan.progress?.scanned ?? 0, strategy: this.scan.progress?.strategy ?? null },
            network: this.ledger.snapshot(),
            modules: this.env.port.moduleAvailability(),
            securityAlerts: this.securityAlerts,
            storageWarnings: this.storageWarnings,
            debugEntries: this.logger.entries.slice(-50)
        });
    }
}

let current: App | null = null;

export function startApp(env: AppEnvironment): App {
    current?.dispose();
    current = new App(env);
    void current.init();
    return current;
}

export function stopApp(): void {
    current?.dispose();
    current = null;
}

export function getApp(): App | null {
    return current;
}
