export type TriState = "any" | "only" | "exclude";

export type KeywordMatch = "substring" | "word";

export interface MessageFilters {
    contains: string[];
    notContains: string[];
    keywordMatch: KeywordMatch;
    attachments: TriState;
    links: TriState;
    images: TriState;
    replies: TriState;
}

export interface DateBounds {
    afterMs: number | null;
    beforeMs: number | null;
}

export type CleanupTarget =
    | { kind: "channel"; channelId: string; guildId: string | null; }
    | { kind: "guild"; guildId: string; };

export type SpeedPreset = "verySlow" | "slow" | "normal" | "fast" | "custom";

export interface SpeedSetting {
    preset: SpeedPreset;
    customDelayMs: number;
}

export interface CleanupPlan {
    target: CleanupTarget;
    filters: MessageFilters;
    range: DateBounds;
}

export interface MatchedMessage {
    id: string;
    channelId: string;
    authorId: string;
    timestamp: number;
    preview: {
        snippet: string;
        hasAttachments: boolean;
        hasImages: boolean;
        hasLinks: boolean;
        isReply: boolean;
    } | null;
}

export const EMPTY_FILTERS: MessageFilters = {
    contains: [],
    notContains: [],
    keywordMatch: "substring",
    attachments: "any",
    links: "any",
    images: "any",
    replies: "any"
};
