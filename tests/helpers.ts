import type { DiscordPort, RawMessage } from "../src/discord/types";
import { snowflakeFromTimestamp } from "../src/discord/snowflake";

export const ME = "111111111111111111";
export const OTHER = "222222222222222222";
export const CHANNEL = "333333333333333333";
export const GUILD = "444444444444444444";

let seq = 0n;
export function makeMessage(partial: Partial<RawMessage> & { at?: number; } = {}): RawMessage {
    const at = partial.at ?? Date.UTC(2024, 0, 15);
    seq++;
    const id = partial.id ?? (BigInt(snowflakeFromTimestamp(at)) + seq).toString();
    return {
        id,
        channel_id: CHANNEL,
        type: 0,
        content: "hello world",
        timestamp: new Date(at).toISOString(),
        author: { id: ME },
        attachments: [],
        embeds: [],
        message_reference: null,
        hit: true,
        ...partial
    };
}

export const fakePort = (overrides: Partial<DiscordPort> = {}): DiscordPort => ({
    getCurrentUserId: () => ME,
    getSelectedChannelId: () => CHANNEL,
    getChannel: id => id === CHANNEL ? { id, kind: "dm", name: "Friend", guildId: null, hasMessages: true } : null,
    getGuild: id => id === GUILD ? { id, name: "Server" } : null,
    listPrivateChannels: () => [],
    listGuilds: () => [],
    listGuildChannels: () => [],
    moduleAvailability: () => [],
    ...overrides
});

export const instantSleep = async (_ms: number, signal?: AbortSignal) => {
    await Promise.resolve();
    if (signal?.aborted) {
        const { AbortedError } = await import("../src/utils/sleep");
        throw new AbortedError();
    }
};

export const silentLogger = {
    debug() { }, info() { }, warn() { }, error() { }, contentLoggingActive: false
};
