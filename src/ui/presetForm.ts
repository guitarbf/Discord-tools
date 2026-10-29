import type { CleanupDraft } from "../cleanup/draft";
import { parseKeywords } from "../cleanup/filters";
import type { Preset, PresetDraft } from "../cleanup/presets";
import type { MessageFilters, SpeedSetting } from "../cleanup/types";
import type { FilterFields } from "./editors";

export function filterFieldsFromFilters(f: MessageFilters): FilterFields {
    return {
        containsText: f.contains.join(", "),
        notContainsText: f.notContains.join(", "),
        keywordMatch: f.keywordMatch,
        attachments: f.attachments,
        links: f.links,
        images: f.images,
        replies: f.replies
    };
}

export function filtersFromFields(f: FilterFields): MessageFilters {
    return {
        contains: parseKeywords(f.containsText),
        notContains: parseKeywords(f.notContainsText),
        keywordMatch: f.keywordMatch,
        attachments: f.attachments,
        links: f.links,
        images: f.images,
        replies: f.replies
    };
}

export function draftFromPreset(preset: Preset, defaultSpeed: SpeedSetting): Partial<CleanupDraft> {
    return {
        ...filterFieldsFromFilters(preset.filters),
        date: preset.date,
        speed: preset.speed ?? defaultSpeed
    };
}

export function presetDraftFromCleanupDraft(draft: CleanupDraft, name: string): PresetDraft {
    return {
        name,
        description: "",
        filters: filtersFromFields(draft),
        date: draft.date,
        speed: draft.speed
    };
}
