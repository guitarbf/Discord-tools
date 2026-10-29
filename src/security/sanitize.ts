import { isRecord } from "../utils/guards";

export const TOKEN_PATTERNS: readonly RegExp[] = [
    /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{25,110}\b/g,
    /\bmfa\.[A-Za-z0-9_-]{20,}\b/g
];

const HEADER_PATTERN = /\b(authorization|cookie|set-cookie|x-super-properties|x-fingerprint|x-context-properties|x-captcha-key)\b(\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const BEARER_PATTERN = /\b(Bearer|Bot)\s+[A-Za-z0-9._~+/-]{10,}=*/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9+/_-]{48,}={0,2}(?![A-Za-z0-9])/g;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#"']+)\?[^\s#"']+/gi;
const SNOWFLAKE_PATTERN = /\b\d{17,20}\b/g;

export const SENSITIVE_KEY_PATTERN = /(token|authorization|^auth$|password|passwd|secret|cookie|session|fingerprint|super.?properties|^mfa|ticket|captcha|headers)/i;

const CONTENT_KEYS = new Set(["content", "snippet", "text", "keywords", "contains", "notContains", "body"]);

export interface SanitizeOptions {
    redactIds?: boolean;
    allowContent?: boolean;
}

export function redactString(input: string, options: SanitizeOptions = {}): string {
    let out = input;
    for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, "[redacted-token]");
    out = out.replace(HEADER_PATTERN, (_m, name: string, sep: string) => `${name}${sep}[redacted]`);
    out = out.replace(BEARER_PATTERN, (_m, scheme: string) => `${scheme} [redacted]`);
    out = out.replace(URL_QUERY_PATTERN, "$1?[redacted]");
    out = out.replace(EMAIL_PATTERN, "[redacted-email]");
    out = out.replace(LONG_SECRET_PATTERN, "[redacted-secret]");
    if (options.redactIds) out = out.replace(SNOWFLAKE_PATTERN, "[id]");
    return out;
}

const MAX_DEPTH = 5;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;

export function sanitizeValue(value: unknown, options: SanitizeOptions = {}, depth = 0, seen = new WeakSet<object>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value, options);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return options.redactIds ? "[id]" : value.toString();
    if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
    if (value instanceof Error) return sanitizeError(value, options);
    if (typeof value !== "object") return "[unknown]";
    if (seen.has(value)) return "[circular]";
    if (depth >= MAX_DEPTH) return "[truncated]";
    seen.add(value);

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY).map(v => sanitizeValue(v, options, depth + 1, seen));
        if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
        return items;
    }

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            out[key] = "[redacted]";
        } else if (CONTENT_KEYS.has(key) && !options.allowContent) {
            out[key] = "[content hidden]";
        } else {
            out[key] = sanitizeValue(v, options, depth + 1, seen);
        }
    }
    return out;
}

export interface SanitizedError {
    name: string;
    message: string;
    status?: number;
    code?: number;
}

export function sanitizeError(err: unknown, options: SanitizeOptions = {}): SanitizedError {
    if (err instanceof Error) {
        return { name: err.name, message: redactString(err.message, options) };
    }
    if (isRecord(err)) {
        const out: SanitizedError = { name: "Error", message: "" };
        if (typeof err.status === "number") out.status = err.status;
        const body = isRecord(err.body) ? err.body : null;
        if (body && typeof body.code === "number") out.code = body.code;
        const message = body && typeof body.message === "string" ? body.message : typeof err.message === "string" ? err.message : "";
        out.message = redactString(message, options);
        return out;
    }
    return { name: "Error", message: redactString(String(err), options) };
}
