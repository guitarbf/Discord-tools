import { sanitizeError, sanitizeValue } from "./sanitize";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
    at: number;
    level: LogLevel;
    message: string;
    data?: unknown;
}

export interface DebugState {
    enabled: boolean;
    includeMessageContent: boolean;
    expiresAt: number | null;
    entryCount: number;
}

export interface ConsoleLike {
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

const PREFIX = "[PrivacyCleanup]";
const MAX_DEBUG_ENTRIES = 500;
export const MAX_DEBUG_DURATION_MS = 60 * 60 * 1000;
export const DEFAULT_DEBUG_DURATION_MS = 15 * 60 * 1000;

export class Logger {
    private debugEnabled = false;
    private includeContent = false;
    private expiresAt: number | null = null;
    private expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private buffer: LogEntry[] = [];
    private readonly listeners = new Set<() => void>();

    constructor(private readonly sink: ConsoleLike = console, private readonly now: () => number = Date.now) { }

    debug(message: string, data?: unknown): void {
        this.record("debug", message, data);
    }

    info(message: string, data?: unknown): void {
        this.record("info", message, data);
    }

    warn(message: string, data?: unknown): void {
        this.sink.warn(PREFIX, message, ...(data === undefined ? [] : [sanitizeValue(data, { redactIds: true })]));
        this.record("warn", message, data);
    }

    error(message: string, err?: unknown): void {
        this.sink.error(PREFIX, message, ...(err === undefined ? [] : [sanitizeError(err, { redactIds: true })]));
        this.record("error", message, err === undefined ? undefined : sanitizeError(err));
    }

    private record(level: LogLevel, message: string, data: unknown): void {
        if (!this.debugEnabled) return;
        if (this.expiresAt !== null && this.now() >= this.expiresAt) {
            this.disableDebug();
            return;
        }
        const entry: LogEntry = { at: this.now(), level, message: sanitizeValue(message) as string };
        if (data !== undefined) entry.data = sanitizeValue(data, { allowContent: this.includeContent });
        this.buffer.push(entry);
        if (this.buffer.length > MAX_DEBUG_ENTRIES) this.buffer.splice(0, this.buffer.length - MAX_DEBUG_ENTRIES);
        this.notify();
    }

    enableDebug(durationMs: number, includeMessageContent: boolean): void {
        const duration = Math.min(MAX_DEBUG_DURATION_MS, Math.max(60_000, durationMs));
        this.debugEnabled = true;
        this.includeContent = includeMessageContent;
        this.expiresAt = this.now() + duration;
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(() => this.disableDebug(), duration);
        this.notify();
    }

    disableDebug(): void {
        this.debugEnabled = false;
        this.includeContent = false;
        this.expiresAt = null;
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
        this.buffer = [];
        this.notify();
    }

    clearDebugEntries(): void {
        this.buffer = [];
        this.notify();
    }

    get entries(): readonly LogEntry[] {
        return this.buffer;
    }

    get debugState(): DebugState {
        return {
            enabled: this.debugEnabled,
            includeMessageContent: this.includeContent,
            expiresAt: this.expiresAt,
            entryCount: this.buffer.length
        };
    }

    get contentLoggingActive(): boolean {
        return this.debugEnabled && this.includeContent;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const l of [...this.listeners]) l();
    }

    dispose(): void {
        this.disableDebug();
        this.listeners.clear();
    }
}

export type LoggerLike = Pick<Logger, "debug" | "info" | "warn" | "error" | "contentLoggingActive">;
