export function formatNumber(n: number): string {
    return Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";
}

export function formatDuration(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatDateTime(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return "—";
    return new Date(ms).toLocaleString();
}

export function formatDate(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return "—";
    return new Date(ms).toLocaleDateString();
}

export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)) + "…";
}

export function pluralize(n: number, singular: string, plural = singular + "s"): string {
    return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}
