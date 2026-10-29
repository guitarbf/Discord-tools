import type { App, AppSnapshot } from "../app";
import { useEffect, useState } from "../discord/compat";
import { ALLOWED_ROUTE_DESCRIPTIONS } from "../privacy/networkGuard";
import { buildPrivacyStatus } from "../privacy/status";
import type { AuditFinding } from "../security/audit";
import { DATABASE_NAME } from "../storage/indexedDb";
import { formatDateTime, formatNumber } from "../utils/format";
import { Button, Dialog, ErrorText, Field, Notice, Section, Toggle } from "./components";
import { SpeedPicker } from "./editors";
import { useAction } from "./hooks";

export function PrivacyTab(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    return (
        <div className="pc-stack-lg">
            <PrivacyStatusSection snap={snap} />
            <SecurityAuditSection app={app} snap={snap} />
            <EmergencySection app={app} snap={snap} />
            <PreferencesSection app={app} snap={snap} />
            <DebugSection app={app} snap={snap} />
        </div>
    );
}

function PrivacyStatusSection(props: { snap: AppSnapshot; }) {
    const rows = buildPrivacyStatus(props.snap.ledger, props.snap.debug);
    const api = props.snap.ledger.discordApi;
    return (
        <Section title="Privacy Status" description="These values come from what the addon actually does, not from settings.">
            <table className="pc-table">
                <tbody>
                    {rows.map(r => (
                        <tr key={r.label}>
                            <th>{r.label}</th>
                            <td className={r.good ? "pc-good" : "pc-warn"}>{r.value}</td>
                            <td className="pc-muted pc-small">{r.detail}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <details className="pc-small">
                <summary>Network allowlist and request counts (this session)</summary>
                <p className="pc-muted">The only requests the addon can make, all through Discord's own client:</p>
                <ul>{ALLOWED_ROUTE_DESCRIPTIONS.map(d => <li key={d}><code>{d}</code></li>)}</ul>
                <p className="pc-muted">
                    Searches: {formatNumber(api.searchChannel + api.searchGuild)} · History pages: {formatNumber(api.channelHistory)} · Deletions: {formatNumber(api.deleteMessage)} ·
                    Blocked: {formatNumber(props.snap.ledger.blockedRequests)} · Refused by STOP ALL: {formatNumber(props.snap.ledger.killSwitchRefusals)}
                </p>
            </details>
        </Section>
    );
}

const SEVERITY_LABEL: Record<AuditFinding["severity"], string> = { ok: "OK", info: "Info", warning: "Warning", risk: "Risk" };

function SecurityAuditSection(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    const [findings, setFindings] = useState<AuditFinding[] | null>(null);
    const [ranAt, setRanAt] = useState<number | null>(null);
    const action = useAction();
    const run = () => action.run(async () => {
        setFindings(await app.runAudit());
        setRanAt(Date.now());
    });
    useEffect(() => {
        void run();
    }, []);

    return (
        <Section title="Security Audit" description="Checks the addon's configuration, stored data and environment for privacy risks."
            actions={<Button small onClick={run} disabled={action.pending}>Run again</Button>}>
            {snap.securityAlerts.length > 0 && (
                <Notice kind="danger" title="Security alerts this session">
                    <ul>{snap.securityAlerts.map((a, i) => <li key={i}>{a}</li>)}</ul>
                    <Button small onClick={() => app.dismissSecurityAlerts()}>Dismiss alerts</Button>
                </Notice>
            )}
            {findings && (
                <ul className="pc-audit">
                    {findings.map(f => (
                        <li key={f.id} className={`pc-audit-item pc-audit-${f.severity}`}>
                            <span className="pc-audit-sev">{SEVERITY_LABEL[f.severity]}</span>
                            <div>
                                <div className="pc-list-title">{f.title}</div>
                                <div className="pc-muted pc-small">{f.detail}</div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {ranAt && <span className="pc-muted pc-small">Last run {formatDateTime(ranAt)}</span>}
            <ErrorText error={action.error} />
        </Section>
    );
}

function EmergencySection(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const action = useAction();
    const finish = (label: string, containerRemoved: boolean) => {
        setConfirm(null);
        setDone(containerRemoved ? `${label}: all local addon data was removed.`
            : `${label}: all records were erased. The empty database will be removed once other Discord windows are closed.`);
    };

    return (
        <Section title="Emergency controls & data">
            <div className="pc-row pc-wrap">
                {snap.killSwitchEngaged
                    ? <Button variant="success" onClick={() => app.resumeOperations()}>Re-enable operations</Button>
                    : <Button variant="danger" onClick={() => app.stopAllOperations()}>STOP ALL OPERATIONS</Button>}
                <Button onClick={() => { app.clearTemporaryData(); setDone("Temporary data cleared: preview results, the cleanup form and debug data."); }}>Clear Temporary Data</Button>
                <Button variant="danger" onClick={() => setConfirm("delete")}>Delete All Local Data</Button>
                <Button variant="danger" onClick={() => setConfirm("reset")}>Reset Addon</Button>
            </div>
            <span className="pc-muted pc-small">
                STOP ALL OPERATIONS blocks every new request at the network guard right away and halts any preview or cleanup. Local data lives in the IndexedDB database “{DATABASE_NAME}”.
            </span>
            {done && <Notice kind="success">{done}</Notice>}
            <ErrorText error={action.error} />
            {confirm === "delete" && (
                <Dialog title="Delete all local data?" danger actions={<>
                    <Button onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button variant="danger" disabled={action.pending} onClick={() => action.run(async () => finish("Deleted", (await app.deleteAllLocalData()).containerRemoved))}>Delete everything</Button>
                </>}>
                    <p>This permanently removes all presets, cleanup history and preferences, and deletes the addon's database. Your Discord messages aren't affected.</p>
                    <ErrorText error={action.error} />
                </Dialog>
            )}
            {confirm === "reset" && (
                <Dialog title="Reset addon?" danger actions={<>
                    <Button onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button variant="danger" disabled={action.pending} onClick={() => action.run(async () => finish("Reset", (await app.resetAddon()).containerRemoved))}>Reset</Button>
                </>}>
                    <p>Stops any running operation, clears temporary data, deletes all local data and returns every setting to its default (including the risk notice).
                        Vencord itself still remembers whether the plugin is enabled. Disable it under Plugins if you want that gone too.</p>
                    <ErrorText error={action.error} />
                </Dialog>
            )}
        </Section>
    );
}

function PreferencesSection(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    const { prefs } = snap;
    const action = useAction();
    const save = (patch: Parameters<App["updatePrefs"]>[0]) => action.run(() => app.updatePrefs(patch));
    return (
        <Section title="Preferences">
            <div className="pc-stack">
                <Field label="Default speed">
                    <SpeedPicker value={prefs.defaultSpeed} onChange={defaultSpeed => save({ defaultSpeed })} />
                </Field>
                <Field label="Ask for a second confirmation above (messages)">
                    <NumberSetting value={prefs.largeOperationThreshold} min={10} max={100000} onCommit={largeOperationThreshold => save({ largeOperationThreshold })} />
                </Field>
                <Field label="History entries to keep" hint="0 = none">
                    <NumberSetting value={prefs.historyRetention} min={0} max={1000} onCommit={historyRetention => save({ historyRetention })} />
                </Field>
                <Toggle checked={prefs.storeKeywordsInHistory} onChange={v => save({ storeKeywordsInHistory: v })}
                    label="Save keyword text in history" />
                <Toggle checked={prefs.showPreviewSnippets} onChange={v => save({ showPreviewSnippets: v })}
                    label="Show message snippets in the preview" />
                <ErrorText error={action.error} />
            </div>
        </Section>
    );
}

function NumberSetting(props: { value: number; min: number; max: number; onCommit: (value: number) => void; }) {
    return (
        <input type="number" className="pc-input pc-input-narrow" min={props.min} max={props.max} defaultValue={props.value} key={props.value}
            onBlur={e => {
                const n = Math.round(Number(e.currentTarget.value));
                const next = Number.isFinite(n) ? Math.max(props.min, Math.min(props.max, n)) : props.value;
                if (next !== props.value) props.onCommit(next);
                else e.currentTarget.value = String(props.value);
            }} />
    );
}

function DebugSection(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    const { debug } = snap;
    const [minutes, setMinutes] = useState(15);
    const [withContent, setWithContent] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    const copyReport = async () => {
        try {
            await navigator.clipboard.writeText(app.buildDiagnosticReport());
            setCopied("Sanitized report copied to your clipboard. It wasn't sent anywhere.");
        } catch {
            setCopied("Couldn't access the clipboard.");
        }
    };

    return (
        <Section title="Temporary debugging" description="Memory only, auto-wiped.">
            {debug.enabled ? (
                <div className="pc-stack">
                    <Notice kind={debug.includeMessageContent ? "danger" : "warning"}>
                        Debug logging is on{debug.includeMessageContent ? " and includes message content" : ""}. It switches off at {debug.expiresAt ? new Date(debug.expiresAt).toLocaleTimeString() : "—"}.
                        {" "}{formatNumber(debug.entryCount)} entries.
                    </Notice>
                    <div className="pc-row pc-wrap">
                        <Button variant="primary" onClick={() => app.disableDebug()}>Turn off & wipe</Button>
                        <Button onClick={() => app.logger.clearDebugEntries()}>Clear entries</Button>
                    </div>
                    <pre className="pc-log">{app.logger.entries.slice(-100).map(e =>
                        `${new Date(e.at).toLocaleTimeString()} ${e.level.toUpperCase()} ${e.message}${e.data === undefined ? "" : " " + JSON.stringify(e.data)}`).join("\n") || "No entries yet."}</pre>
                </div>
            ) : (
                <div className="pc-stack">
                    <div className="pc-row pc-wrap">
                        <select className="pc-input pc-select" value={minutes} onChange={e => setMinutes(Number(e.currentTarget.value))}>
                            {[5, 15, 30, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
                        </select>
                        <Button onClick={() => app.enableDebug(minutes, withContent)}>Enable temporary debugging</Button>
                    </div>
                    <Toggle checked={withContent} onChange={setWithContent} label="Include message content" />
                </div>
            )}
            <div className="pc-row pc-wrap">
                <Button small onClick={copyReport}>Copy sanitized diagnostic report</Button>
                {copied && <span className="pc-muted pc-small">{copied}</span>}
            </div>
        </Section>
    );
}
