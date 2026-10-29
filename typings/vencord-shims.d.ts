declare module "@webpack/common" {
    import type * as ReactNS from "react";

    export const React: typeof ReactNS;
    export const useState: typeof ReactNS.useState;
    export const useEffect: typeof ReactNS.useEffect;
    export const useMemo: typeof ReactNS.useMemo;
    export const useRef: typeof ReactNS.useRef;
    export const useReducer: typeof ReactNS.useReducer;

    interface RestRequestData {
        url: string;
        query?: Record<string, unknown>;
        body?: Record<string, unknown>;
        retries?: number;
    }
    export const RestAPI: Record<"get" | "del", (data: RestRequestData) => Promise<unknown>>;
    export const UserStore: { getCurrentUser(): unknown; getUser(id: string): unknown; };
    export const ChannelStore: { getChannel(id: string): unknown; getSortedPrivateChannels(): unknown[]; };
    export const GuildStore: { getGuild(id: string): unknown; getGuilds(): Record<string, unknown>; };
    export const GuildChannelStore: { getChannels(guildId: string): unknown; };
    export const SelectedChannelStore: { getChannelId(): unknown; };
}

declare module "@plugins/_core/settings" {
    const SettingsPlugin: unknown;
    export default SettingsPlugin;
}

declare module "@utils/types" {
    interface PluginAuthor {
        name: string;
        id: bigint;
    }
    interface PluginDef {
        name: string;
        description: string;
        authors: PluginAuthor[];
        managedStyle?: string;
        settingsAboutComponent?: import("react").ComponentType<{}>;
        start?(): void;
        stop?(): void;
    }
    export default function definePlugin<P extends PluginDef>(p: P): P;
}

declare module "*.css?managed" {
    const css: string;
    export default css;
}

declare const VencordCreateElement: typeof import("react").createElement;
declare const VencordFragment: typeof import("react").Fragment;
