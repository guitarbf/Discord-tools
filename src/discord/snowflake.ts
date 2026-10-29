export const DISCORD_EPOCH_MS = 1420070400000;
const DISCORD_EPOCH = BigInt(DISCORD_EPOCH_MS);

export function isSnowflake(value: unknown): value is string {
    return typeof value === "string" && /^\d{17,20}$/.test(value);
}

export function snowflakeFromTimestamp(ms: number): string {
    const clamped = Math.max(DISCORD_EPOCH_MS, Math.floor(ms));
    return ((BigInt(clamped) - DISCORD_EPOCH) << 22n).toString();
}

export function timestampFromSnowflake(id: string): number {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function compareSnowflakes(a: string, b: string): number {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

export function decrementSnowflake(id: string): string {
    const v = BigInt(id);
    return (v > 0n ? v - 1n : 0n).toString();
}
