import type { RawMessage } from "../discord/types";
import type { DateBounds, KeywordMatch, MessageFilters, TriState } from "./types";

const LINK_PATTERN = /\bhttps?:\/\/[^\s<]+/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|heic|svg)$/i;

export const MAX_KEYWORDS = 25;
export const MAX_KEYWORD_LENGTH = 100;

export function parseKeywords(input: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of input.split(/[,\n]/)) {
        const keyword = part.trim().slice(0, MAX_KEYWORD_LENGTH);
        const key = keyword.toLowerCase();
        if (!keyword || seen.has(key)) continue;
        seen.add(key);
        out.push(keyword);
        if (out.length >= MAX_KEYWORDS) break;
    }
    return out;
}

export function hasAttachment(m: RawMessage): boolean {
    return m.attachments.length > 0;
}

export function hasImage(m: RawMessage): boolean {
    return m.attachments.some(a => a.content_type?.startsWith("image/") || IMAGE_EXTENSION.test(a.filename ?? ""))
        || m.embeds.some(e => e.type === "image" || e.type === "gifv" || e.image !== undefined);
}

export function hasLink(m: RawMessage): boolean {
    return LINK_PATTERN.test(m.content);
}

export function isReply(m: RawMessage): boolean {
    return m.type === 19 || Boolean(m.message_reference?.message_id);
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsKeyword(content: string, keyword: string, mode: KeywordMatch): boolean {
    if (mode === "substring") return content.toLowerCase().includes(keyword.toLowerCase());
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(keyword)}($|[^\\p{L}\\p{N}_])`, "iu").test(content);
}

function triMatches(state: TriState, value: boolean): boolean {
    return state === "any" || (state === "only" ? value : !value);
}

export function withinBounds(timestampMs: number, range: DateBounds): boolean {
    if (range.afterMs !== null && timestampMs < range.afterMs) return false;
    if (range.beforeMs !== null && timestampMs >= range.beforeMs) return false;
    return true;
}

export function matchesFilters(m: RawMessage, filters: MessageFilters, range: DateBounds): boolean {
    const ts = Date.parse(m.timestamp);
    if (!Number.isFinite(ts) || !withinBounds(ts, range)) return false;
    if (filters.contains.length && !filters.contains.some(k => containsKeyword(m.content, k, filters.keywordMatch))) return false;
    if (filters.notContains.some(k => containsKeyword(m.content, k, filters.keywordMatch))) return false;
    if (!triMatches(filters.attachments, hasAttachment(m))) return false;
    if (!triMatches(filters.images, hasImage(m))) return false;
    if (!triMatches(filters.links, hasLink(m))) return false;
    if (!triMatches(filters.replies, isReply(m))) return false;
    return true;
}

export interface DescribeOptions {
    includeKeywords: boolean;
}

const TRI_LABELS: Record<Exclude<TriState, "any">, string> = { only: "only with", exclude: "without" };

export function describeFilters(filters: MessageFilters, range: DateBounds, options: DescribeOptions): string[] {
    const lines: string[] = [];
    if (range.afterMs !== null && range.beforeMs !== null) {
        lines.push(`Sent from ${new Date(range.afterMs).toLocaleString()} up to (not including) ${new Date(range.beforeMs).toLocaleString()}`);
    } else if (range.afterMs !== null) {
        lines.push(`Sent on or after ${new Date(range.afterMs).toLocaleString()}`);
    } else if (range.beforeMs !== null) {
        lines.push(`Sent before ${new Date(range.beforeMs).toLocaleString()}`);
    } else {
        lines.push("Any date");
    }
    const kw = (list: string[]) => options.includeKeywords ? list.map(k => `"${k}"`).join(", ") : `${list.length} keyword${list.length === 1 ? "" : "s"}`;
    const how = filters.keywordMatch === "word" ? "whole word" : "text";
    if (filters.contains.length) lines.push(`Contains ${how}: ${kw(filters.contains)}`);
    if (filters.notContains.length) lines.push(`Does not contain ${how}: ${kw(filters.notContains)}`);
    const tri: Array<[TriState, string]> = [
        [filters.attachments, "attachments"], [filters.images, "images"], [filters.links, "links"]
    ];
    for (const [state, noun] of tri) if (state !== "any") lines.push(`${TRI_LABELS[state]} ${noun}`.replace(/^./, c => c.toUpperCase()));
    if (filters.replies === "only") lines.push("Only replies");
    if (filters.replies === "exclude") lines.push("Excluding replies");
    lines.push("Only messages you authored (always enforced)");
    return lines;
}
