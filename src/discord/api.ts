import type { NetworkGuard } from "../privacy/networkGuard";
import { isFiniteNumber, isRecord, isString } from "../utils/guards";
import { extractSearchHits, parseRawMessage } from "./messages";
import type { RawMessage, RawRequest, RawRequester, RawResponse } from "./types";

export type ApiOutcome<T> =
    | { kind: "ok"; status: number; body: T; }
    | { kind: "indexing"; retryAfterMs: number; }
    | { kind: "rateLimited"; retryAfterMs: number; global: boolean; }
    | { kind: "notFound"; code: number | null; }
    | { kind: "forbidden"; code: number | null; message: string; }
    | { kind: "error"; status: number | null; code: number | null; message: string; };

export interface SearchPage {
    totalResults: number | null;
    hits: RawMessage[];
}

const NOT_PERMITTED_CODES = new Set([
    50001,
    50013,
    50021,
    50083,
    160005
]);

const DEFAULT_RATE_LIMIT_MS = 5000;
const DEFAULT_INDEXING_MS = 2000;

function retryAfterMs(body: unknown, headers: Record<string, string> | undefined, fallback: number): number {
    if (isRecord(body) && isFiniteNumber(body.retry_after) && body.retry_after >= 0) {
        return Math.ceil(body.retry_after * 1000);
    }
    const header = headers?.["retry-after"];
    if (header && Number.isFinite(Number(header))) return Math.ceil(Number(header) * 1000);
    return fallback;
}

function errorCode(body: unknown): number | null {
    return isRecord(body) && isFiniteNumber(body.code) ? body.code : null;
}

function errorMessage(body: unknown, status: number | null): string {
    if (isRecord(body) && isString(body.message)) return body.message.slice(0, 200);
    return status === null ? "Request failed" : `HTTP ${status}`;
}

export function classifyResponse(res: RawResponse): ApiOutcome<unknown> {
    const { status, body } = res;
    if (status === 202) return { kind: "indexing", retryAfterMs: retryAfterMs(body, res.headers, DEFAULT_INDEXING_MS) };
    if (status >= 200 && status < 300) return { kind: "ok", status, body };
    if (status === 429) {
        return {
            kind: "rateLimited",
            retryAfterMs: retryAfterMs(body, res.headers, DEFAULT_RATE_LIMIT_MS),
            global: isRecord(body) && body.global === true
        };
    }
    const code = errorCode(body);
    if (status === 404) return { kind: "notFound", code };
    if (status === 403 || (code !== null && NOT_PERMITTED_CODES.has(code))) {
        return { kind: "forbidden", code, message: errorMessage(body, status) };
    }
    return { kind: "error", status, code, message: errorMessage(body, status) };
}

export function classifyFailure(err: unknown): ApiOutcome<unknown> {
    if (isRecord(err) && isFiniteNumber(err.status)) {
        const headers = isRecord(err.headers) ? pickRetryAfter(err.headers) : undefined;
        return classifyResponse({ status: err.status, body: err.body, headers });
    }
    return { kind: "error", status: null, code: null, message: "Network request failed" };
}

function pickRetryAfter(headers: Record<string, unknown>): Record<string, string> | undefined {
    const value = headers["retry-after"];
    return isString(value) ? { "retry-after": value } : undefined;
}

export class DiscordApi {
    constructor(private readonly raw: RawRequester, private readonly guard: NetworkGuard) { }

    private async send(request: RawRequest): Promise<ApiOutcome<unknown>> {
        this.guard.authorize(request);
        try {
            return classifyResponse(await this.raw(request));
        } catch (err) {
            return classifyFailure(err);
        }
    }

    async search(path: string, query: Record<string, string | string[]>): Promise<ApiOutcome<SearchPage>> {
        const outcome = await this.send({ method: "GET", path, query });
        if (outcome.kind !== "ok") return outcome;
        const { body } = outcome;
        if (!isRecord(body)) return { kind: "error", status: outcome.status, code: null, message: "Unexpected search response" };
        return {
            kind: "ok",
            status: outcome.status,
            body: {
                totalResults: isFiniteNumber(body.total_results) ? body.total_results : null,
                hits: extractSearchHits(body.messages)
            }
        };
    }

    async history(channelId: string, before: string | null, limit = 100): Promise<ApiOutcome<RawMessage[]>> {
        const query: Record<string, string> = { limit: String(limit) };
        if (before) query.before = before;
        const outcome = await this.send({ method: "GET", path: `/channels/${channelId}/messages`, query });
        if (outcome.kind !== "ok") return outcome;
        if (!Array.isArray(outcome.body)) return { kind: "error", status: outcome.status, code: null, message: "Unexpected history response" };
        return {
            kind: "ok",
            status: outcome.status,
            body: outcome.body.map(parseRawMessage).filter((m): m is RawMessage => m !== null)
        };
    }

    async deleteMessage(channelId: string, messageId: string): Promise<ApiOutcome<null>> {
        const outcome = await this.send({ method: "DELETE", path: `/channels/${channelId}/messages/${messageId}` });
        return outcome.kind === "ok" ? { kind: "ok", status: outcome.status, body: null } : outcome;
    }
}

export type SearchApi = Pick<DiscordApi, "search" | "history">;
export type DeleteApi = Pick<DiscordApi, "deleteMessage">;
