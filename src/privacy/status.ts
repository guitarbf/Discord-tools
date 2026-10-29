import type { DebugState } from "../security/logger";
import type { LedgerSnapshot } from "./ledger";

export interface PrivacyStatusRow {
    label: string;
    value: string;
    good: boolean;
    detail: string;
}

export function buildPrivacyStatus(ledger: LedgerSnapshot, debug: DebugState): PrivacyStatusRow[] {
    const discordRequests = Object.values(ledger.discordApi).reduce((a, b) => a + b, 0);
    return [
        {
            label: "External connections made by the addon",
            value: String(ledger.externalConnections),
            good: ledger.externalConnections === 0,
            detail: `Enforced by the network guard. ${discordRequests} request(s) to Discord's own API this session; ${ledger.blockedRequests} blocked.`
        },
        { label: "Telemetry", value: "Disabled", good: true, detail: "No telemetry code is included." },
        { label: "Analytics", value: "Disabled", good: true, detail: "No analytics or advertising SDKs are included." },
        { label: "Token collection", value: "Disabled", good: true, detail: "The addon never reads your token. Discord's own client authenticates requests." },
        {
            label: "Message storage",
            value: "Disabled",
            good: true,
            detail: "Message content is never saved. Preview snippets stay in memory and are discarded after use."
        },
        {
            label: "Debug logging",
            value: debug.enabled ? (debug.includeMessageContent ? "On (with content)" : "On") : "Off",
            good: !debug.enabled,
            detail: debug.enabled ? "In memory only; cleared automatically when it expires." : "Opt-in only."
        }
    ];
}
