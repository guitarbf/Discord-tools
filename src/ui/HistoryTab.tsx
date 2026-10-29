import type { App, AppSnapshot } from "../app";
import { useState } from "../discord/compat";
import type { HistoryEntry } from "../storage/schema";
import { formatDateTime, formatDuration, formatNumber } from "../utils/format";
import { Button, Dialog, ErrorText, Notice, Section } from "./components";
import { describeTarget } from "./editors";
import { useAction } from "./hooks";

const STATUS: Record<HistoryEntry["status"], string> = {
    running: "Running", completed: "Completed", cancelled: "Cancelled", stopped: "Stopped", failed: "Failed", interrupted: "Interrupted"
};

export function HistoryTab(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    const [confirmClear, setConfirmClear] = useState(false);
    const action = useAction();

    return (
        <div className="pc-stack-lg">
            <Notice kind="info">
                History stores only metadata: when a cleanup ran, the target channel/server ID, a filter summary{snap.prefs.storeKeywordsInHistory ? " (including keywords)" : " (keyword counts, not the keywords)"}, and counts.
                No message content or message IDs. Channel names are looked up live and not saved. Keeping the last {snap.prefs.historyRetention} entries.
            </Notice>
            <Section title="Cleanup history" actions={snap.history.length > 0 && <Button small variant="danger" onClick={() => setConfirmClear(true)}>Clear history</Button>}>
                {snap.history.length === 0 && <span className="pc-muted">No cleanups yet.</span>}
                <ul className="pc-list">
                    {snap.history.map(h => (
                        <li key={h.id} className="pc-list-item pc-history-item">
                            <div className="pc-grow">
                                <div className="pc-row pc-wrap">
                                    <span className={`pc-status pc-status-${h.status}`}>{STATUS[h.status]}</span>
                                    <strong>{describeTarget(app.port, { kind: h.targetKind, channelId: h.channelId, guildId: h.guildId })}</strong>
                                </div>
                                <div className="pc-muted pc-small">
                                    {formatDateTime(h.startedAt)}{h.finishedAt ? ` · took ${formatDuration(h.finishedAt - h.startedAt)}` : ""} · {h.speedLabel}
                                </div>
                                <div className="pc-small">
                                    {formatNumber(h.processed)}/{formatNumber(h.total)} processed · {formatNumber(h.deleted)} deleted · {formatNumber(h.skipped)} skipped · {formatNumber(h.errors)} errors · {formatNumber(h.rateLimitPauses)} rate-limit pauses
                                </div>
                                <details className="pc-small">
                                    <summary>Filters</summary>
                                    <ul>{h.filterSummary.map(l => <li key={l}>{l}</li>)}</ul>
                                </details>
                                {h.note && <div className="pc-muted pc-small">{h.note}</div>}
                            </div>
                            {h.status !== "running" && <Button small variant="ghost" onClick={() => action.run(() => app.deleteHistoryEntry(h.id))}>Remove</Button>}
                        </li>
                    ))}
                </ul>
                <ErrorText error={action.error} />
            </Section>
            {confirmClear && (
                <Dialog title="Clear history?" actions={<>
                    <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
                    <Button variant="danger" onClick={() => action.run(async () => { await app.clearHistory(); setConfirmClear(false); })}>Clear</Button>
                </>}>
                    <p>All history entries are removed from local storage. This doesn't affect any messages.</p>
                </Dialog>
            )}
        </div>
    );
}
