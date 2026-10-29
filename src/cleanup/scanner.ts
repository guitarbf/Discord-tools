import type { SearchApi } from "../discord/api";
import { DELETABLE_MESSAGE_TYPES } from "../discord/messages";
import { compareSnowflakes, snowflakeFromTimestamp } from "../discord/snowflake";
import type { RawMessage } from "../discord/types";
import type { LoggerLike } from "../security/logger";
import { AbortedError, sleep as defaultSleep, type SleepFn } from "../utils/sleep";
import { hasAttachment, hasImage, hasLink, isReply, matchesFilters } from "./filters";
import { buildSearchRequest } from "./query";
import type { CleanupPlan, MatchedMessage } from "./types";

export type ScanStrategy = "search" | "history";

export interface ScanProgress {
    strategy: ScanStrategy;
    pages: number;
    scanned: number;
    matched: number;
    excludedByFilters: number;
    excludedSystem: number;
    indexingWaits: number;
    rateLimitPauses: number;
    discordEstimate: number | null;
    waitingUntil: number | null;
}

export interface ScanResult extends ScanProgress {
    items: MatchedMessage[];
    truncated: boolean;
    notice: string | null;
}

export class ScanError extends Error {
    override name = "ScanError";
}

export interface ScanOptions {
    api: SearchApi;
    userId: string;
    plan: CleanupPlan;
    searchDelayMs: number;
    signal: AbortSignal;
    logger: LoggerLike;
    onProgress?: (progress: ScanProgress) => void;
    keepSnippets: boolean;
    sleep?: SleepFn;
    now?: () => number;
    maxMatches?: number;
    maxHistoryScan?: number;
}

const SEARCH_PAGE_SIZE = 25;
const MAX_INDEXING_WAITS = 30;
const MAX_RATE_LIMIT_STREAK = 8;
const MAX_ERROR_RETRIES = 3;
export const DEFAULT_MAX_MATCHES = 50_000;
const DEFAULT_MAX_HISTORY_SCAN = 250_000;
const SNIPPET_LENGTH = 160;

export async function scanForMatches(options: ScanOptions): Promise<ScanResult> {
    const { userId, plan, signal, logger } = options;
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;

    const progress: ScanProgress = {
        strategy: "search", pages: 0, scanned: 0, matched: 0, excludedByFilters: 0, excludedSystem: 0,
        indexingWaits: 0, rateLimitPauses: 0, discordEstimate: null, waitingUntil: null
    };
    const items: MatchedMessage[] = [];
    const seen = new Set<string>();
    let truncated = false;
    let notice: string | null = null;
    const report = () => options.onProgress?.({ ...progress });

    const wait = async (ms: number) => {
        progress.waitingUntil = now() + ms;
        report();
        try {
            await sleep(ms, signal);
        } finally {
            progress.waitingUntil = null;
        }
    };

    const consider = (m: RawMessage) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        progress.scanned++;
        if (m.author.id !== userId) return true;
        if (!DELETABLE_MESSAGE_TYPES.has(m.type)) {
            progress.excludedSystem++;
            return true;
        }
        if (!matchesFilters(m, plan.filters, plan.range)) {
            progress.excludedByFilters++;
            return true;
        }
        items.push({
            id: m.id,
            channelId: m.channel_id,
            authorId: m.author.id,
            timestamp: Date.parse(m.timestamp),
            preview: options.keepSnippets
                ? {
                    snippet: m.content.slice(0, SNIPPET_LENGTH),
                    hasAttachments: hasAttachment(m),
                    hasImages: hasImage(m),
                    hasLinks: hasLink(m),
                    isReply: isReply(m)
                }
                : null
        });
        progress.matched++;
        if (logger.contentLoggingActive) logger.debug("Matched message", { id: m.id, content: m.content });
        else logger.debug("Matched message", { id: m.id });
        return true;
    };

    const checkAbort = () => {
        if (signal.aborted) throw new AbortedError();
    };

    let cursor: string | null = null;
    let rateLimitStreak = 0;
    let errorRetries = 0;
    let useHistory = false;

    for (; ;) {
        checkAbort();
        const req = buildSearchRequest(plan, userId, cursor);
        const outcome = await options.api.search(req.path, req.query);
        if (outcome.kind === "indexing") {
            progress.indexingWaits++;
            if (progress.indexingWaits > MAX_INDEXING_WAITS) throw new ScanError("Discord's search index is still not ready. Try again later.");
            await wait(outcome.retryAfterMs);
            continue;
        }
        if (outcome.kind === "rateLimited") {
            progress.rateLimitPauses++;
            if (++rateLimitStreak > MAX_RATE_LIMIT_STREAK) throw new ScanError("Discord kept rate limiting search requests. Stopped to be safe; try a slower speed later.");
            await wait(outcome.retryAfterMs + 500);
            continue;
        }
        if (outcome.kind === "forbidden" || outcome.kind === "notFound") {
            if (progress.pages === 0 && plan.target.kind === "channel") {
                useHistory = true;
                notice = "Discord search isn't available for this channel, so its history was scanned page by page. Only your own messages were kept.";
                break;
            }
            throw new ScanError("Discord refused the search request. You may not have access to this location.");
        }
        if (outcome.kind === "error") {
            if (++errorRetries > MAX_ERROR_RETRIES) throw new ScanError(`Search failed: ${outcome.message}`);
            await wait(2000 * 2 ** errorRetries);
            continue;
        }

        rateLimitStreak = 0;
        errorRetries = 0;
        progress.pages++;
        if (progress.pages === 1) progress.discordEstimate = outcome.body.totalResults;

        const { hits } = outcome.body;
        let fresh = 0;
        let oldest: string | null = null;
        for (const hit of hits) {
            if (consider(hit)) fresh++;
            if (oldest === null || compareSnowflakes(hit.id, oldest) < 0) oldest = hit.id;
        }
        report();

        if (items.length >= maxMatches) {
            truncated = true;
            break;
        }
        if (hits.length === 0 || fresh === 0 || oldest === null) break;
        cursor = oldest;
        if (hits.length < SEARCH_PAGE_SIZE && progress.discordEstimate !== null && progress.scanned >= progress.discordEstimate) break;
        await wait(options.searchDelayMs);
    }

    if (useHistory && plan.target.kind === "channel") {
        progress.strategy = "history";
        truncated = await scanHistory(plan.target.channelId);
    }

    report();
    return { ...progress, items, truncated, notice };

    async function scanHistory(channelId: string): Promise<boolean> {
        const maxScan = options.maxHistoryScan ?? DEFAULT_MAX_HISTORY_SCAN;
        let before: string | null = plan.range.beforeMs !== null ? snowflakeFromTimestamp(plan.range.beforeMs) : null;
        let streak = 0;
        let retries = 0;
        for (; ;) {
            checkAbort();
            const outcome = await options.api.history(channelId, before, 100);
            if (outcome.kind === "rateLimited" || outcome.kind === "indexing") {
                progress.rateLimitPauses++;
                if (++streak > MAX_RATE_LIMIT_STREAK) throw new ScanError("Discord kept rate limiting history requests. Stopped to be safe.");
                await wait(outcome.retryAfterMs + 500);
                continue;
            }
            if (outcome.kind === "forbidden" || outcome.kind === "notFound") {
                throw new ScanError("Discord refused to load this channel's history. You may not have access.");
            }
            if (outcome.kind === "error") {
                if (++retries > MAX_ERROR_RETRIES) throw new ScanError(`Loading history failed: ${outcome.message}`);
                await wait(2000 * 2 ** retries);
                continue;
            }
            streak = 0;
            retries = 0;
            progress.pages++;
            const page = outcome.body;
            if (page.length === 0) return false;
            let reachedStart = false;
            for (const m of page) {
                const ts = Date.parse(m.timestamp);
                if (plan.range.afterMs !== null && ts < plan.range.afterMs) {
                    reachedStart = true;
                    continue;
                }
                consider(m);
            }
            report();
            if (items.length >= maxMatches || progress.scanned >= maxScan) return true;
            const last = page[page.length - 1];
            if (reachedStart || !last || page.length < 100) return false;
            before = last.id;
            await wait(options.searchDelayMs);
        }
    }
}
