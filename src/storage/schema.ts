import type { JobStatus } from "../cleanup/engine";
import type { DateSpec, Preset } from "../cleanup/presets";
import { clampCustomDelay, DEFAULT_SPEED, SPEED_ORDER } from "../cleanup/speed";
import { EMPTY_FILTERS, type MessageFilters, type SpeedSetting, type TriState } from "../cleanup/types";
import { isSnowflake } from "../discord/snowflake";
import { clampNumber, isBoolean, isFiniteNumber, isRecord, isString, oneOf } from "../utils/guards";

export const SCHEMA_VERSION = 1;
export const STORAGE_KEYS = ["prefs", "presets", "history"] as const;
export type StorageKey = typeof STORAGE_KEYS[number];

export type TabId = "cleanup" | "presets" | "history" | "privacy";
export const TAB_IDS: readonly TabId[] = ["cleanup", "presets", "history", "privacy"];

export interface Preferences {
    tosAcknowledgedAt: number | null;
    defaultSpeed: SpeedSetting;
    largeOperationThreshold: number;
    historyRetention: number;
    storeKeywordsInHistory: boolean;
    showPreviewSnippets: boolean;
    lastTab: TabId;
}

export const DEFAULT_PREFERENCES: Preferences = {
    tosAcknowledgedAt: null,
    defaultSpeed: DEFAULT_SPEED,
    largeOperationThreshold: 500,
    historyRetention: 100,
    storeKeywordsInHistory: false,
    showPreviewSnippets: true,
    lastTab: "cleanup"
};

export type HistoryStatus = Exclude<JobStatus, "idle" | "running" | "paused"> | "running" | "interrupted";

export interface HistoryEntry {
    id: string;
    startedAt: number;
    finishedAt: number | null;
    targetKind: "channel" | "guild";
    channelId: string | null;
    guildId: string | null;
    filterSummary: string[];
    speedLabel: string;
    total: number;
    processed: number;
    deleted: number;
    skipped: number;
    errors: number;
    rateLimitPauses: number;
    status: HistoryStatus;
    note: string | null;
}

export interface Envelope<T> {
    v: number;
    data: T;
}

const TRI: readonly TriState[] = ["any", "only", "exclude"];
const HISTORY_STATUSES: readonly HistoryStatus[] = ["running", "completed", "cancelled", "stopped", "failed", "interrupted"];

function stringList(value: unknown, max: number): string[] {
    return Array.isArray(value) ? value.filter(isString).map(s => s.slice(0, 200)).slice(0, max) : [];
}

export function validateSpeed(value: unknown): SpeedSetting {
    if (!isRecord(value)) return { ...DEFAULT_SPEED };
    return {
        preset: oneOf(value.preset, SPEED_ORDER, DEFAULT_SPEED.preset),
        customDelayMs: clampCustomDelay(isFiniteNumber(value.customDelayMs) ? value.customDelayMs : DEFAULT_SPEED.customDelayMs)
    };
}

export function validateFilters(value: unknown): MessageFilters {
    if (!isRecord(value)) return { ...EMPTY_FILTERS };
    return {
        contains: stringList(value.contains, 25),
        notContains: stringList(value.notContains, 25),
        keywordMatch: oneOf(value.keywordMatch, ["substring", "word"] as const, "substring"),
        attachments: oneOf(value.attachments, TRI, "any"),
        links: oneOf(value.links, TRI, "any"),
        images: oneOf(value.images, TRI, "any"),
        replies: oneOf(value.replies, TRI, "any")
    };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = (v: unknown) => isString(v) && DATE_RE.test(v) ? v : null;

export function validateDateSpec(value: unknown): DateSpec {
    if (!isRecord(value)) return { kind: "none" };
    switch (value.kind) {
        case "olderThanDays":
        case "newerThanDays":
            return { kind: value.kind, days: Math.round(clampNumber(value.days, 1, 36500, 30)) };
        case "before":
        case "after": {
            const date = dateStr(value.date);
            return date ? { kind: value.kind, date } : { kind: "none" };
        }
        case "between": {
            const from = dateStr(value.from);
            const to = dateStr(value.to);
            return from && to ? { kind: "between", from, to } : { kind: "none" };
        }
        default:
            return { kind: "none" };
    }
}

export function validatePreferences(value: unknown): Preferences {
    if (!isRecord(value)) return { ...DEFAULT_PREFERENCES };
    return {
        tosAcknowledgedAt: isFiniteNumber(value.tosAcknowledgedAt) ? value.tosAcknowledgedAt : null,
        defaultSpeed: validateSpeed(value.defaultSpeed),
        largeOperationThreshold: Math.round(clampNumber(value.largeOperationThreshold, 10, 100_000, DEFAULT_PREFERENCES.largeOperationThreshold)),
        historyRetention: Math.round(clampNumber(value.historyRetention, 0, 1000, DEFAULT_PREFERENCES.historyRetention)),
        storeKeywordsInHistory: isBoolean(value.storeKeywordsInHistory) ? value.storeKeywordsInHistory : false,
        showPreviewSnippets: isBoolean(value.showPreviewSnippets) ? value.showPreviewSnippets : true,
        lastTab: oneOf(value.lastTab, TAB_IDS, "cleanup")
    };
}

export function validatePreset(value: unknown): Preset | null {
    if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null;
    return {
        id: value.id.slice(0, 64),
        name: value.name.slice(0, 100) || "Untitled preset",
        description: isString(value.description) ? value.description.slice(0, 500) : "",
        filters: validateFilters(value.filters),
        date: validateDateSpec(value.date),
        speed: value.speed === null || value.speed === undefined ? null : validateSpeed(value.speed),
        createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : 0,
        updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : 0
    };
}

const count = (v: unknown) => Math.max(0, Math.round(isFiniteNumber(v) ? v : 0));

export function validateHistoryEntry(value: unknown): HistoryEntry | null {
    if (!isRecord(value) || !isString(value.id) || !isFiniteNumber(value.startedAt)) return null;
    return {
        id: value.id.slice(0, 64),
        startedAt: value.startedAt,
        finishedAt: isFiniteNumber(value.finishedAt) ? value.finishedAt : null,
        targetKind: value.targetKind === "guild" ? "guild" : "channel",
        channelId: isSnowflake(value.channelId) ? value.channelId : null,
        guildId: isSnowflake(value.guildId) ? value.guildId : null,
        filterSummary: stringList(value.filterSummary, 20),
        speedLabel: isString(value.speedLabel) ? value.speedLabel.slice(0, 60) : "",
        total: count(value.total),
        processed: count(value.processed),
        deleted: count(value.deleted),
        skipped: count(value.skipped),
        errors: count(value.errors),
        rateLimitPauses: count(value.rateLimitPauses),
        status: oneOf(value.status, HISTORY_STATUSES, "interrupted"),
        note: isString(value.note) ? value.note.slice(0, 300) : null
    };
}
