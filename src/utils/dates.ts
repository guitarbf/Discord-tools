export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateInput(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
    return date.getTime();
}

export function addLocalDays(ms: number, days: number): number {
    const date = new Date(ms);
    date.setDate(date.getDate() + days);
    return date.getTime();
}

export function toDateInput(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
