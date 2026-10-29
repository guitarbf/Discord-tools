import { decrementSnowflake, snowflakeFromTimestamp } from "../discord/snowflake";
import type { CleanupPlan } from "./types";

export interface SearchRequest {
    path: string;
    query: Record<string, string | string[]>;
}

export function buildSearchRequest(plan: CleanupPlan, userId: string, cursorMaxId: string | null): SearchRequest {
    const { target, filters, range } = plan;
    const query: Record<string, string | string[]> = {
        author_id: userId,
        include_nsfw: "true",
        sort_by: "timestamp",
        sort_order: "desc"
    };

    let path: string;
    if (target.kind === "guild") {
        path = `/guilds/${target.guildId}/messages/search`;
    } else if (target.guildId) {
        path = `/guilds/${target.guildId}/messages/search`;
        query.channel_id = target.channelId;
    } else {
        path = `/channels/${target.channelId}/messages/search`;
    }

    const rangeMax = range.beforeMs !== null ? snowflakeFromTimestamp(range.beforeMs) : null;
    const maxId = pickSmaller(rangeMax, cursorMaxId);
    if (maxId) query.max_id = maxId;
    if (range.afterMs !== null) query.min_id = decrementSnowflake(snowflakeFromTimestamp(range.afterMs));

    const has: string[] = [];
    if (filters.attachments === "only") has.push("file");
    if (filters.images === "only") has.push("image");
    if (filters.links === "only") has.push("link");
    if (has.length) query.has = has;
    if (filters.keywordMatch === "word" && filters.contains.length === 1 && filters.contains[0]) {
        query.content = filters.contains[0];
    }
    return { path, query };
}

function pickSmaller(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return BigInt(a) < BigInt(b) ? a : b;
}
