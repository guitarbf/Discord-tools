export interface RawAttachment {
    filename?: string;
    content_type?: string;
}

export interface RawEmbed {
    type?: string;
    url?: string;
    image?: unknown;
    thumbnail?: unknown;
}

export interface RawMessage {
    id: string;
    channel_id: string;
    type: number;
    content: string;
    timestamp: string;
    author: { id: string; };
    attachments: RawAttachment[];
    embeds: RawEmbed[];
    message_reference: { message_id?: string; } | null;
    hit: boolean;
}

export type ChannelKind =
    | "dm" | "groupDm" | "text" | "announcement" | "thread" | "voice" | "stage" | "forum" | "unknown";

export interface ChannelInfo {
    id: string;
    kind: ChannelKind;
    name: string;
    guildId: string | null;
    hasMessages: boolean;
}

export interface GuildInfo {
    id: string;
    name: string;
}

export interface ModuleAvailability {
    name: string;
    available: boolean;
    affects: string;
}

export interface DiscordPort {
    getCurrentUserId(): string | null;
    getSelectedChannelId(): string | null;
    getChannel(channelId: string): ChannelInfo | null;
    getGuild(guildId: string): GuildInfo | null;
    listPrivateChannels(): ChannelInfo[];
    listGuilds(): GuildInfo[];
    listGuildChannels(guildId: string): ChannelInfo[];
    moduleAvailability(): ModuleAvailability[];
}

export type HttpMethod = "GET" | "DELETE";

export interface RawRequest {
    method: HttpMethod;
    path: string;
    query?: Record<string, string | string[]>;
}

export interface RawResponse {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}

export type RawRequester = (request: RawRequest) => Promise<RawResponse>;
