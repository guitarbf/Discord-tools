import { addLocalDays, DAY_MS, parseDateInput } from "../utils/dates";
import { type DateBounds, EMPTY_FILTERS, type MessageFilters, type SpeedSetting } from "./types";

export type DateSpec =
    | { kind: "none"; }
    | { kind: "olderThanDays"; days: number; }
    | { kind: "newerThanDays"; days: number; }
    | { kind: "before"; date: string; }
    | { kind: "after"; date: string; }
    | { kind: "between"; from: string; to: string; };

export interface Preset {
    id: string;
    name: string;
    description: string;
    filters: MessageFilters;
    date: DateSpec;
    speed: SpeedSetting | null;
    createdAt: number;
    updatedAt: number;
}

export type PresetDraft = Omit<Preset, "id" | "createdAt" | "updatedAt">;

export class DateSpecError extends Error {
    override name = "DateSpecError";
}

export function resolveDateSpec(spec: DateSpec, now = Date.now()): DateBounds {
    switch (spec.kind) {
        case "none":
            return { afterMs: null, beforeMs: null };
        case "olderThanDays":
            return { afterMs: null, beforeMs: now - spec.days * DAY_MS };
        case "newerThanDays":
            return { afterMs: now - spec.days * DAY_MS, beforeMs: null };
        case "before": {
            const d = parseDateInput(spec.date);
            if (d === null) throw new DateSpecError("Choose a valid 'before' date.");
            return { afterMs: null, beforeMs: d };
        }
        case "after": {
            const d = parseDateInput(spec.date);
            if (d === null) throw new DateSpecError("Choose a valid 'after' date.");
            return { afterMs: addLocalDays(d, 1), beforeMs: null };
        }
        case "between": {
            const from = parseDateInput(spec.from);
            const to = parseDateInput(spec.to);
            if (from === null || to === null) throw new DateSpecError("Choose both dates for the range.");
            if (from > to) throw new DateSpecError("The start date must be on or before the end date.");
            return { afterMs: from, beforeMs: addLocalDays(to, 1) };
        }
    }
}

export const PRESET_TEMPLATES: readonly PresetDraft[] = [
    {
        name: "Delete messages older than 30 days",
        description: "Your messages sent more than 30 days ago.",
        filters: { ...EMPTY_FILTERS },
        date: { kind: "olderThanDays", days: 30 },
        speed: null
    },
    {
        name: "Delete messages containing selected keywords",
        description: "Edit this preset to add your keywords.",
        filters: { ...EMPTY_FILTERS, contains: [] },
        date: { kind: "none" },
        speed: null
    },
    {
        name: "Delete messages with attachments",
        description: "Your messages that include files or images.",
        filters: { ...EMPTY_FILTERS, attachments: "only" },
        date: { kind: "none" },
        speed: null
    },
    {
        name: "Delete everything I can safely remove from this channel",
        description: "Every message you authored in the selected channel. System messages and other people's messages are never included.",
        filters: { ...EMPTY_FILTERS },
        date: { kind: "none" },
        speed: { preset: "slow", customDelayMs: 3000 }
    }
];
