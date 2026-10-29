import SettingsPlugin from "@plugins/_core/settings";
import {
    ChannelStore, GuildChannelStore, GuildStore, React, RestAPI, SelectedChannelStore, useEffect, useMemo, useReducer, useRef, UserStore,
useState } from "@webpack/common";

import { isFiniteNumber, isRecord, isString } from "../utils/guards";
import { isSnowflake } from "./snowflake";
import type { ChannelInfo, ChannelKind, DiscordPort, GuildInfo, ModuleAvailability, RawRequester, RawResponse } from "./types";

export { React, useEffect, useMemo, useReducer, useRef, useState };

function safe<T>(fn: () => T, fallback: T): T {
    try {
        return fn() ?? fallback;
    } catch {
        return fallback;
    }
}

const CHANNEL_KINDS: Record<number, ChannelKind> = {
    0: "text", 1: "dm", 2: "voice", 3: "groupDm", 5: "announcement",
    10: "thread", 11: "thread", 12: "thread", 13: "stage", 15: "forum", 16: "forum"
};

function userLabel(userId: unknown): string {
    if (!isString(userId)) return "Unknown user";
    return safe(() => {
        const user = UserStore.getUser(userId) as unknown;
        if (!isRecord(user)) return "Unknown user";
        return (isString(user.globalName) && user.globalName) || (isString(user.username) && user.username) || "Unknown user";
    }, "Unknown user");
}

function toChannelInfo(raw: unknown): ChannelInfo | null {
    if (!isRecord(raw) || !isSnowflake(raw.id)) return null;
    const type = isFiniteNumber(raw.type) ? raw.type : -1;
    const kind = CHANNEL_KINDS[type] ?? "unknown";
    const guildId = isSnowflake(raw.guild_id) ? raw.guild_id : null;
    let name = isString(raw.name) && raw.name ? raw.name : "";
    if (!name && kind === "dm") {
        const recipients = Array.isArray(raw.recipients) ? raw.recipients : [];
        name = userLabel(recipients[0]);
    } else if (!name && kind === "groupDm") {
        const recipients = Array.isArray(raw.recipients) ? raw.recipients : [];
        name = recipients.slice(0, 4).map(userLabel).join(", ") || "Group DM";
    }
    return {
        id: raw.id,
        kind,
        name: name || "Unnamed channel",
        guildId,
        hasMessages: kind !== "forum" && kind !== "unknown"
    };
}

export const discordPort: DiscordPort = {
    getCurrentUserId() {
        return safe(() => {
            const user = UserStore.getCurrentUser() as unknown;
            return isRecord(user) && isSnowflake(user.id) ? user.id : null;
        }, null);
    },

    getSelectedChannelId() {
        return safe(() => {
            const id = SelectedChannelStore.getChannelId() as unknown;
            return isSnowflake(id) ? id : null;
        }, null);
    },

    getChannel(channelId) {
        return safe(() => toChannelInfo(ChannelStore.getChannel(channelId)), null);
    },

    getGuild(guildId) {
        return safe(() => {
            const guild = GuildStore.getGuild(guildId) as unknown;
            return isRecord(guild) && isSnowflake(guild.id) ? { id: guild.id, name: isString(guild.name) ? guild.name : "Server" } : null;
        }, null);
    },

    listPrivateChannels() {
        return safe(() => (ChannelStore.getSortedPrivateChannels() as unknown[])
            .map(toChannelInfo)
            .filter((c): c is ChannelInfo => c !== null), []);
    },

    listGuilds() {
        return safe(() => Object.values(GuildStore.getGuilds() as Record<string, unknown>)
            .filter(isRecord)
            .filter(g => isSnowflake(g.id))
            .map((g): GuildInfo => ({ id: g.id as string, name: isString(g.name) ? g.name : "Server" }))
            .sort((a, b) => a.name.localeCompare(b.name)), []);
    },

    listGuildChannels(guildId) {
        return safe(() => {
            const groups = GuildChannelStore.getChannels(guildId) as unknown;
            if (!isRecord(groups)) return [];
            const out: ChannelInfo[] = [];
            for (const key of ["SELECTABLE", "VOCAL"]) {
                const list = groups[key];
                if (!Array.isArray(list)) continue;
                for (const entry of list) {
                    const info = toChannelInfo(isRecord(entry) ? entry.channel : null);
                    if (info?.hasMessages) out.push(info);
                }
            }
            return out;
        }, []);
    },

    moduleAvailability(): ModuleAvailability[] {
        const has = (fn: () => unknown) => safe(() => Boolean(fn()), false);
        return [
            { name: "RestAPI", available: has(() => typeof RestAPI.get === "function" && typeof RestAPI.del === "function"), affects: "previewing and deleting messages" },
            { name: "UserStore", available: has(() => typeof UserStore.getCurrentUser === "function"), affects: "identifying your account" },
            { name: "ChannelStore", available: has(() => typeof ChannelStore.getChannel === "function"), affects: "channel selection" },
            { name: "GuildStore", available: has(() => typeof GuildStore.getGuilds === "function"), affects: "server selection" },
            { name: "GuildChannelStore", available: has(() => typeof GuildChannelStore.getChannels === "function"), affects: "server channel list" },
            { name: "SelectedChannelStore", available: has(() => typeof SelectedChannelStore.getChannelId === "function"), affects: "\"use current channel\"" },
            { name: "Settings entry", available: settingsEntryRegistered, affects: "the Message Cleanup entry in Discord settings (still reachable via Plugins → PrivacyCleanup)" }
        ];
    }
};

function pickResponse(value: unknown): RawResponse {
    if (!isRecord(value)) return { status: 0, body: null };
    const headers = isRecord(value.headers) && isString(value.headers["retry-after"]) ? { "retry-after": value.headers["retry-after"] } : undefined;
    return { status: isFiniteNumber(value.status) ? value.status : 0, body: value.body, headers };
}

// Discord adds auth itself; only status, body and retry-after are kept.
export function createRawRequester(): RawRequester | null {
    const available = safe(() => typeof RestAPI.get === "function" && typeof RestAPI.del === "function", false);
    if (!available) return null;
    return async request => {
        const data = { url: request.path, query: request.query, retries: 0 };
        try {
            const res = request.method === "GET" ? await RestAPI.get(data) : await RestAPI.del(data);
            return pickResponse(res);
        } catch (err) {
            if (isRecord(err) && isFiniteNumber(err.status)) throw pickResponse(err);
            throw new Error("Network request failed");
        }
    };
}

export function networkPrimitivesWrapped(): boolean | null {
    try {
        const native = (fn: unknown) => typeof fn === "function" && /\[native code\]/.test(Function.prototype.toString.call(fn));
        return !(native(window.fetch) && native(XMLHttpRequest.prototype.open) && native(XMLHttpRequest.prototype.send));
    } catch {
        return null;
    }
}

const SETTINGS_KEY = "privacy_cleanup";
let settingsEntryRegistered = false;

interface SettingsEntry {
    key: string;
    title: string;
    Component: React.ComponentType<{}>;
    Icon: React.ComponentType<{ width?: number; height?: number; }>;
}

export function registerSettingsEntry(entry: Omit<SettingsEntry, "key">): void {
    try {
        const entries = (SettingsPlugin as unknown as { customEntries?: SettingsEntry[]; }).customEntries;
        if (!Array.isArray(entries)) return;
        if (!entries.some(e => e.key === SETTINGS_KEY)) entries.push({ key: SETTINGS_KEY, ...entry });
        settingsEntryRegistered = true;
    } catch {
        settingsEntryRegistered = false;
    }
}

export function unregisterSettingsEntry(): void {
    try {
        const entries = (SettingsPlugin as unknown as { customEntries?: SettingsEntry[]; }).customEntries;
        if (Array.isArray(entries)) {
            const index = entries.findIndex(e => e.key === SETTINGS_KEY);
            if (index !== -1) entries.splice(index, 1);
        }
    } finally {
        settingsEntryRegistered = false;
    }
}
