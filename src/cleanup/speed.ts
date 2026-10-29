import type { SpeedPreset, SpeedSetting } from "./types";

export const MIN_DELETE_DELAY_MS = 1000;
export const MAX_DELETE_DELAY_MS = 120_000;
export const MIN_SEARCH_DELAY_MS = 2000;

export const SPEED_PRESETS: Record<Exclude<SpeedPreset, "custom">, { label: string; deleteDelayMs: number; }> = {
    verySlow: { label: "Very Slow", deleteDelayMs: 5000 },
    slow: { label: "Slow", deleteDelayMs: 3000 },
    normal: { label: "Normal", deleteDelayMs: 1800 },
    fast: { label: "Fast", deleteDelayMs: 1200 }
};

export const SPEED_ORDER: readonly SpeedPreset[] = ["verySlow", "slow", "normal", "fast", "custom"];

export const DEFAULT_SPEED: SpeedSetting = { preset: "normal", customDelayMs: 2500 };

export function clampCustomDelay(ms: number): number {
    if (!Number.isFinite(ms)) return DEFAULT_SPEED.customDelayMs;
    return Math.round(Math.min(MAX_DELETE_DELAY_MS, Math.max(MIN_DELETE_DELAY_MS, ms)));
}

export interface ResolvedSpeed {
    label: string;
    deleteDelayMs: number;
    searchDelayMs: number;
}

export function resolveSpeed(speed: SpeedSetting): ResolvedSpeed {
    const deleteDelayMs = speed.preset === "custom" ? clampCustomDelay(speed.customDelayMs) : SPEED_PRESETS[speed.preset].deleteDelayMs;
    const label = speed.preset === "custom" ? `Custom (${(deleteDelayMs / 1000).toFixed(1)}s per message)` : SPEED_PRESETS[speed.preset].label;
    return { label, deleteDelayMs, searchDelayMs: Math.max(MIN_SEARCH_DELAY_MS, deleteDelayMs) };
}
