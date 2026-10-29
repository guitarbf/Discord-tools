import { isBoolean, isFiniteNumber, isRecord, isString } from "../utils/guards";
import { isSnowflake } from "./snowflake";
import type { RawAttachment, RawEmbed, RawMessage } from "./types";

export const DELETABLE_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19]);

export function parseRawMessage(value: unknown): RawMessage | null {
    if (!isRecord(value)) return null;
    const { id, channel_id, type, content, timestamp, author } = value;
    if (!isSnowflake(id) || !isSnowflake(channel_id)) return null;
    if (!isRecord(author) || !isSnowflake(author.id)) return null;
    if (!isFiniteNumber(type) || !isString(timestamp)) return null;

    const attachments: RawAttachment[] = Array.isArray(value.attachments)
        ? value.attachments.filter(isRecord).map(a => ({
            filename: isString(a.filename) ? a.filename : undefined,
            content_type: isString(a.content_type) ? a.content_type : undefined
        }))
        : [];
    const embeds: RawEmbed[] = Array.isArray(value.embeds)
        ? value.embeds.filter(isRecord).map(e => ({
            type: isString(e.type) ? e.type : undefined,
            url: isString(e.url) ? e.url : undefined,
            image: e.image,
            thumbnail: e.thumbnail
        }))
        : [];
    const ref = isRecord(value.message_reference) ? value.message_reference : null;

    return {
        id,
        channel_id,
        type,
        content: isString(content) ? content : "",
        timestamp,
        author: { id: author.id },
        attachments,
        embeds,
        message_reference: ref ? { message_id: isString(ref.message_id) ? ref.message_id : undefined } : null,
        hit: isBoolean(value.hit) ? value.hit : false
    };
}

export function extractSearchHits(groups: unknown): RawMessage[] {
    if (!Array.isArray(groups)) return [];
    const hits: RawMessage[] = [];
    for (const group of groups) {
        const candidates = (Array.isArray(group) ? group : [group])
            .map(parseRawMessage)
            .filter((m): m is RawMessage => m !== null);
        const hit = candidates.find(m => m.hit) ?? candidates[0];
        if (hit) hits.push(hit);
    }
    return hits;
}
