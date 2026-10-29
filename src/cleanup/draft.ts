import { isSnowflake } from "../discord/snowflake";
import type { DiscordPort } from "../discord/types";
import { parseKeywords } from "./filters";
import { type DateSpec, resolveDateSpec } from "./presets";
import { DEFAULT_SPEED } from "./speed";
import type { CleanupPlan, KeywordMatch, SpeedSetting, TriState } from "./types";

export interface CleanupDraft {
    scope: "channel" | "guild";
    channelId: string;
    guildId: string;
    date: DateSpec;
    containsText: string;
    notContainsText: string;
    keywordMatch: KeywordMatch;
    attachments: TriState;
    links: TriState;
    images: TriState;
    replies: TriState;
    speed: SpeedSetting;
}

export const EMPTY_DRAFT: CleanupDraft = {
    scope: "channel",
    channelId: "",
    guildId: "",
    date: { kind: "none" },
    containsText: "",
    notContainsText: "",
    keywordMatch: "substring",
    attachments: "any",
    links: "any",
    images: "any",
    replies: "any",
    speed: DEFAULT_SPEED
};

export class DraftError extends Error {
    override name = "DraftError";
}

export function draftKey(draft: CleanupDraft): string {
    const { speed: _speed, ...rest } = draft;
    return JSON.stringify({
        ...rest,
        containsText: parseKeywords(draft.containsText).map(k => k.toLowerCase()),
        notContainsText: parseKeywords(draft.notContainsText).map(k => k.toLowerCase())
    });
}

export function draftToPlan(draft: CleanupDraft, port: DiscordPort, now = Date.now()): CleanupPlan {
    let target: CleanupPlan["target"];
    if (draft.scope === "guild") {
        if (!isSnowflake(draft.guildId)) throw new DraftError("Select a server.");
        target = { kind: "guild", guildId: draft.guildId };
    } else {
        if (!isSnowflake(draft.channelId)) throw new DraftError("Select a channel or DM.");
        const channel = port.getChannel(draft.channelId);
        target = { kind: "channel", channelId: draft.channelId, guildId: channel?.guildId ?? null };
    }
    let range;
    try {
        range = resolveDateSpec(draft.date, now);
    } catch (err) {
        throw new DraftError(err instanceof Error ? err.message : "Invalid date range.");
    }
    return {
        target,
        range,
        filters: {
            contains: parseKeywords(draft.containsText),
            notContains: parseKeywords(draft.notContainsText),
            keywordMatch: draft.keywordMatch,
            attachments: draft.attachments,
            links: draft.links,
            images: draft.images,
            replies: draft.replies
        }
    };
}
