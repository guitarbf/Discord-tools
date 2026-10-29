import type { Preset } from "../cleanup/presets";
import { SecurityError } from "../security/errors";
import { findSensitiveData } from "../security/sensitive";
import { isRecord } from "../utils/guards";
import type { DestroyResult, KeyValueStore } from "./kv";
import {
    DEFAULT_PREFERENCES, type Envelope, type HistoryEntry, type Preferences, SCHEMA_VERSION, STORAGE_KEYS, type StorageKey,
    validateHistoryEntry, validatePreferences, validatePreset
} from "./schema";

export interface LoadedData {
    prefs: Preferences;
    presets: Preset[];
    history: HistoryEntry[];
    warnings: string[];
}

export class LocalStore {
    constructor(private readonly kv: KeyValueStore) { }

    async load(): Promise<LoadedData> {
        const warnings: string[] = [];
        const [prefsRaw, presetsRaw, historyRaw, keys] = await Promise.all([
            this.read("prefs", warnings), this.read("presets", warnings), this.read("history", warnings), this.kv.keys()
        ]);

        const unknown = keys.filter(k => !(STORAGE_KEYS as readonly string[]).includes(k));
        if (unknown.length) warnings.push(`Local storage holds ${unknown.length} unrecognized record(s).`);

        const presets = Array.isArray(presetsRaw) ? presetsRaw.map(validatePreset) : [];
        const history = Array.isArray(historyRaw) ? historyRaw.map(validateHistoryEntry) : [];
        if (presets.includes(null)) warnings.push("Some stored presets were invalid and were ignored.");
        if (history.includes(null)) warnings.push("Some stored history entries were invalid and were ignored.");

        return {
            prefs: prefsRaw === undefined ? { ...DEFAULT_PREFERENCES } : validatePreferences(prefsRaw),
            presets: presets.filter((p): p is Preset => p !== null),
            history: history.filter((h): h is HistoryEntry => h !== null),
            warnings
        };
    }

    private async read(key: StorageKey, warnings: string[]): Promise<unknown> {
        const raw = await this.kv.get(key);
        if (raw === undefined) return undefined;
        if (!isRecord(raw) || typeof raw.v !== "number" || !("data" in raw)) {
            warnings.push(`Stored "${key}" was not in the expected format and was reset.`);
            return undefined;
        }
        if (raw.v > SCHEMA_VERSION) warnings.push(`Stored "${key}" was written by a newer version of the addon.`);
        return raw.data;
    }

    private async write(key: StorageKey, data: unknown): Promise<void> {
        // Refuse writes containing credential-like data.
        const findings = findSensitiveData(data);
        if (findings.length) {
            throw new SecurityError(`Refused to save ${key}: it contains something that looks like a credential (${findings[0]!.kind}). Remove it and try again.`);
        }
        const envelope: Envelope<unknown> = { v: SCHEMA_VERSION, data };
        await this.kv.set(key, envelope);
    }

    savePrefs(prefs: Preferences): Promise<void> {
        return this.write("prefs", prefs);
    }

    savePresets(presets: Preset[]): Promise<void> {
        return this.write("presets", presets);
    }

    saveHistory(history: HistoryEntry[]): Promise<void> {
        return this.write("history", history);
    }

    async readAllRaw(): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        for (const key of await this.kv.keys()) out[key] = await this.kv.get(key);
        return out;
    }

    async deleteAll(): Promise<DestroyResult> {
        return this.kv.destroy();
    }
}
