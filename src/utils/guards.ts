export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
    return typeof value === "string";
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (!isFiniteNumber(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return (allowed as readonly unknown[]).includes(value) ? value as T : fallback;
}
