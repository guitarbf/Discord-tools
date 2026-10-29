import definePlugin from "@utils/types";

import { startApp, stopApp } from "./src/app";
import { createRawRequester, discordPort, networkPrimitivesWrapped, registerSettingsEntry, unregisterSettingsEntry } from "./src/discord/compat";
import { IndexedDbStore } from "./src/storage/indexedDb";
import { ShieldIcon } from "./src/ui/icons";
import { MessageCleanupPanel } from "./src/ui/Panel";
import managedStyle from "./style.css?managed";

export default definePlugin({
    name: "PrivacyCleanup",
    description: "Delete your own messages, privately.",
    authors: [{ name: "guitarbf", id: 0n }],
    managedStyle,

    settingsAboutComponent: () => <MessageCleanupPanel />,

    start() {
        startApp({
            port: discordPort,
            raw: createRawRequester(),
            kv: new IndexedDbStore(),
            networkPrimitivesWrapped
        });
        registerSettingsEntry({ title: "Message Cleanup", Component: MessageCleanupPanel, Icon: ShieldIcon });
    },

    stop() {
        unregisterSettingsEntry();
        stopApp();
    }
});
