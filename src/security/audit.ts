import { MIN_DELETE_DELAY_MS, resolveSpeed } from "../cleanup/speed";
import type { ModuleAvailability } from "../discord/types";
import type { LedgerSnapshot } from "../privacy/ledger";
import { type Preferences,STORAGE_KEYS } from "../storage/schema";
import type { DebugState } from "./logger";
import { findSensitiveData } from "./sensitive";

export type AuditSeverity = "ok" | "info" | "warning" | "risk";

export interface AuditFinding {
    id: string;
    severity: AuditSeverity;
    title: string;
    detail: string;
}

export interface AuditInput {
    ledger: LedgerSnapshot;
    debug: DebugState;
    prefs: Preferences;
    stored: Record<string, unknown> | { error: string; };
    storageWarnings: readonly string[];
    killSwitchEngaged: boolean;
    modules: readonly ModuleAvailability[];
    networkPrimitivesWrapped: boolean | null;
    previewInMemory: boolean;
    securityAlerts: readonly string[];
}

export function runSecurityAudit(input: AuditInput): AuditFinding[] {
    const f: AuditFinding[] = [];
    const add = (id: string, severity: AuditSeverity, title: string, detail: string) => f.push({ id, severity, title, detail });

    const { ledger } = input;
    if (ledger.externalConnections === 0) {
        add("net-external", "ok", "No external connections", "The addon has not contacted any server other than Discord's own API in this session.");
    } else {
        add("net-external", "risk", "External connections detected", `${ledger.externalConnections} request(s) went to a non-Discord destination. This should be impossible; please report it.`);
    }
    if (ledger.blockedRequests > 0) {
        add("net-blocked", "warning", "Blocked requests", `The network guard refused ${ledger.blockedRequests} request(s) that weren't on the allowlist. Nothing was sent.`);
    }

    for (const [i, alert] of input.securityAlerts.entries()) add(`alert-${i}`, "risk", "Security alert", alert);

    if (input.debug.enabled) {
        add("debug-on", input.debug.includeMessageContent ? "risk" : "warning",
            input.debug.includeMessageContent ? "Debug logging includes message content" : "Debug logging is on",
            `Debug entries are kept in memory only and cleared automatically${input.debug.expiresAt ? ` at ${new Date(input.debug.expiresAt).toLocaleTimeString()}` : ""}. Turn it off when you're done.`);
    } else {
        add("debug-off", "ok", "Debug logging is off", "No diagnostic data is being collected.");
    }

    if ("error" in input.stored && typeof input.stored.error === "string") {
        add("store-read", "warning", "Local storage couldn't be checked", input.stored.error);
    } else {
        const stored = input.stored as Record<string, unknown>;
        const findings = findSensitiveData(stored);
        if (findings.length) {
            add("store-sensitive", "risk", "Possible credential in local storage",
                `Found ${findings.length} value(s) that look like credentials (${[...new Set(findings.map(x => x.kind))].join(", ")}). Use "Delete All Local Data".`);
        } else {
            add("store-sensitive", "ok", "No credentials stored", "Local storage holds no token-like or credential-like values.");
        }
        const unknownKeys = Object.keys(stored).filter(k => !(STORAGE_KEYS as readonly string[]).includes(k));
        if (unknownKeys.length) add("store-unknown", "warning", "Unrecognized stored records", `${unknownKeys.length} record(s) in the addon's database weren't created by this version.`);
        const keys = Object.keys(stored).filter(k => (STORAGE_KEYS as readonly string[]).includes(k));
        add("store-scope", "info", "What is stored locally", keys.length ? `Records: ${keys.join(", ")}. No message content, tokens or account details.` : "Nothing is stored yet.");
    }
    for (const [i, w] of input.storageWarnings.entries()) add(`store-warning-${i}`, "warning", "Storage warning", w);

    if (input.prefs.storeKeywordsInHistory) {
        add("pref-keywords", "warning", "Keywords are saved in history", "Keyword filters can reveal what you were deleting. Consider turning this off and clearing history.");
    }
    if (input.prefs.historyRetention > 250) {
        add("pref-retention", "info", "Long history retention", `Up to ${input.prefs.historyRetention} history entries are kept. They hold channel IDs and counts only.`);
    }
    const speed = resolveSpeed(input.prefs.defaultSpeed);
    if (speed.deleteDelayMs <= MIN_DELETE_DELAY_MS + 200) {
        add("pref-speed", "info", "Fast default speed", "Faster speeds hit Discord's rate limits more often. The addon always waits as long as Discord asks.");
    }

    if (input.previewInMemory) {
        add("mem-preview", "info", "Preview data in memory", "A message preview (IDs and short snippets) is held in memory. Use \"Clear Temporary Data\" to discard it.");
    }
    if (input.killSwitchEngaged) {
        add("killswitch", "info", "STOP ALL OPERATIONS is engaged", "No requests will be sent until you re-enable operations.");
    }
    const missing = input.modules.filter(m => !m.available);
    if (missing.length) {
        add("compat", "warning", "Some Discord modules weren't found",
            missing.map(m => `${m.name} (affects: ${m.affects})`).join("; ") + ". Those features are turned off. Nothing is worked around.");
    }
    if (input.networkPrimitivesWrapped) {
        add("env-wrapped", "info", "Network functions are wrapped by another script",
            "window.fetch or XMLHttpRequest isn't the browser original. Discord's own error reporting (Sentry) does this, as can other plugins. This addon never wraps them, but whatever did may be able to observe Discord's traffic. Vencord's NoTrack plugin disables Discord's error reporting and analytics.");
    }
    if (input.prefs.tosAcknowledgedAt === null) {
        add("tos", "info", "Risk notice not acknowledged", "You'll be asked to acknowledge the Discord Terms of Service notice before your first cleanup.");
    }

    const order: Record<AuditSeverity, number> = { risk: 0, warning: 1, info: 2, ok: 3 };
    return f.sort((a, b) => order[a.severity] - order[b.severity]);
}
