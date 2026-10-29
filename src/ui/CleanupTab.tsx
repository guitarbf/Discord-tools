import type { App, AppSnapshot } from "../app";
import type { JobProgress } from "../cleanup/engine";
import { describeFilters } from "../cleanup/filters";
import { resolveSpeed } from "../cleanup/speed";
import { useState } from "../discord/compat";
import { formatDateTime, formatDuration, formatNumber, pluralize, truncate } from "../utils/format";
import { Button, Dialog, ErrorText, Notice, ProgressBar, Section, Stat, Toggle } from "./components";
import { DateSpecEditor, describeTarget, FiltersEditor, SpeedPicker, TargetPicker } from "./editors";
import { useAction, useNow } from "./hooks";
import { draftFromPreset } from "./presetForm";

const PREVIEW_LIST_LIMIT = 100;

export function CleanupTab(props: { app: App; snap: AppSnapshot; }) {
    const { app, snap } = props;
    const { draft, scan, job } = snap;
    const action = useAction();
    const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);
    const scanning = scan.status === "scanning";
    const jobActive = job.status === "running" || job.status === "paused";
    const locked = scanning || jobActive;
    const blocker = app.startBlocker();

    if (snap.prefs.tosAcknowledgedAt === null) return <TosNotice app={app} />;

    return (
        <div className="pc-stack-lg">
            {snap.cleanupUnavailableReason && <Notice kind="danger" title="Cleanup unavailable">{snap.cleanupUnavailableReason}</Notice>}

            {snap.presets.length > 0 && (
                <div className="pc-row pc-wrap">
                    <span className="pc-muted">Load preset:</span>
                    <select className="pc-input pc-select" disabled={locked} value="" onChange={e => {
                        const preset = snap.presets.find(p => p.id === e.currentTarget.value);
                        if (preset) app.setDraft(draftFromPreset(preset, snap.prefs.defaultSpeed));
                    }}>
                        <option value="">Choose…</option>
                        {snap.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <span className="pc-muted">Loading a preset only fills in the form. Nothing runs until you confirm.</span>
                </div>
            )}

            <Section title="Select Channel">
                <TargetPicker port={app.port} draft={draft} disabled={locked} onChange={patch => app.setDraft(patch)} />
            </Section>

            <Section title="Date Range">
                <DateSpecEditor value={draft.date} disabled={locked} onChange={date => app.setDraft({ date })} />
            </Section>

            <Section title="Message Filters" description="Only messages you authored are ever included. That is always enforced and can't be turned off.">
                <FiltersEditor value={draft} disabled={locked} onChange={patch => app.setDraft(patch)} />
            </Section>

            <Section title="Speed">
                <SpeedPicker value={draft.speed} disabled={jobActive} onChange={speed => app.setDraft({ speed })} />
            </Section>

            <Section title="Preview Messages" description="Previewing is read-only. It finds exactly which messages would be deleted.">
                <div className="pc-row pc-wrap">
                    {scanning
                        ? <Button onClick={() => app.cancelPreview()}>Cancel preview</Button>
                        : <Button variant="primary" disabled={jobActive || snap.killSwitchEngaged || !!snap.cleanupUnavailableReason} onClick={() => action.run(() => app.startPreview())}>Preview Messages</Button>}
                    {scan.status !== "idle" && !scanning && <Button variant="ghost" onClick={() => app.clearPreview()}>Clear preview</Button>}
                </div>
                <ErrorText error={action.error} />
                <PreviewView snap={snap} />
            </Section>

            <Section title="Start Cleanup">
                <div className="pc-row pc-wrap">
                    <Button variant="danger" disabled={blocker !== null} onClick={() => setConfirmStep(1)}>Start Cleanup</Button>
                    {blocker && !jobActive && <span className="pc-muted">{blocker}</span>}
                </div>
            </Section>

            {job.status !== "idle" && <ProgressView app={app} job={job} />}

            {confirmStep !== 0 && scan.result && scan.plan && (
                <ConfirmDialogs
                    app={app}
                    snap={snap}
                    step={confirmStep}
                    onStep={setConfirmStep}
                />
            )}
        </div>
    );
}

function TosNotice(props: { app: App; }) {
    const [checked, setChecked] = useState(false);
    const action = useAction();
    return (
        <Section title="Before you start">
            <Notice kind="warning" title="Discord Terms of Service">
                <p>Discord's Terms of Service don't allow client modifications or automating a user account. That includes bulk-deleting your own messages with a tool like this.
                    Discord offers no official bulk-delete feature for users.</p>
                <p>This addon only sends the same single-message requests the Discord client sends when you delete a message by hand, at a deliberately slow pace, and it always respects Discord's rate limits.
                    Even so, Discord <strong>could flag or restrict your account</strong>. Deleted messages <strong>can't be recovered</strong>.</p>
            </Notice>
            <Toggle checked={checked} onChange={setChecked} label="I understand the risks and want to use Message Cleanup." />
            <div className="pc-row">
                <Button variant="primary" disabled={!checked || action.pending} onClick={() => action.run(() => props.app.acknowledgeTos())}>Continue</Button>
            </div>
            <ErrorText error={action.error} />
        </Section>
    );
}

function PreviewView(props: { snap: AppSnapshot; }) {
    const { scan } = props.snap;
    const now = useNow(scan.progress?.waitingUntil != null);
    if (scan.status === "idle") return null;
    const p = scan.progress;

    if (scan.status === "scanning") {
        return (
            <div className="pc-stack">
                <div className="pc-row pc-wrap">
                    <Stat label="Pages searched" value={formatNumber(p?.pages ?? 0)} />
                    <Stat label="Your messages checked" value={formatNumber(p?.scanned ?? 0)} />
                    <Stat label="Matching" value={formatNumber(p?.matched ?? 0)} />
                    {p?.discordEstimate != null && <Stat label="Discord's estimate" value={formatNumber(p.discordEstimate)} />}
                </div>
                {p?.waitingUntil != null && (
                    <span className="pc-muted">
                        {p.indexingWaits > 0 ? "Discord is indexing; " : ""}waiting {formatDuration(Math.max(0, p.waitingUntil - now))} before the next request…
                    </span>
                )}
            </div>
        );
    }
    if (scan.status === "error") return <Notice kind="danger" title="Preview failed">{scan.error}</Notice>;
    if (scan.status === "cancelled") return <Notice kind="info">Preview cancelled.</Notice>;

    const { result } = scan;
    if (!result) return null;
    return (
        <div className="pc-stack">
            <Notice kind={result.items.length ? "warning" : "info"} title={`${pluralize(result.items.length, "message")} will be affected`}>
                Checked {pluralize(result.scanned, "message")}
                {result.excludedByFilters ? `, ${formatNumber(result.excludedByFilters)} didn't match the filters` : ""}
                {result.excludedSystem ? `, ${formatNumber(result.excludedSystem)} system messages excluded` : ""}.
                {result.truncated && " The result was capped to keep memory use bounded; run the cleanup again afterwards for the rest."}
                {result.notice && <div>{result.notice}</div>}
            </Notice>
            {result.items.length > 0 && (
                <ul className="pc-preview-list">
                    {result.items.slice(0, PREVIEW_LIST_LIMIT).map(m => (
                        <li key={m.id} className="pc-preview-item">
                            <span className="pc-muted pc-preview-date">{formatDateTime(m.timestamp)}</span>
                            <span className="pc-preview-text">{m.preview ? (m.preview.snippet ? truncate(m.preview.snippet, 160) : <em className="pc-muted">(no text)</em>) : <em className="pc-muted">Snippets are turned off</em>}</span>
                            {m.preview && (
                                <span className="pc-tags">
                                    {m.preview.isReply && <span className="pc-tag">reply</span>}
                                    {m.preview.hasImages ? <span className="pc-tag">image</span> : m.preview.hasAttachments && <span className="pc-tag">file</span>}
                                    {m.preview.hasLinks && <span className="pc-tag">link</span>}
                                </span>
                            )}
                        </li>
                    ))}
                    {result.items.length > PREVIEW_LIST_LIMIT && <li className="pc-muted">…and {formatNumber(result.items.length - PREVIEW_LIST_LIMIT)} more</li>}
                </ul>
            )}
            <span className="pc-muted">Preview data is held in memory only and discarded after the cleanup or when cleared.</span>
        </div>
    );
}

function ConfirmDialogs(props: { app: App; snap: AppSnapshot; step: 1 | 2; onStep: (step: 0 | 1 | 2) => void; }) {
    const { app, snap, step, onStep } = props;
    const result = snap.scan.result!;
    const plan = snap.scan.plan!;
    const count = result.items.length;
    const large = count > snap.prefs.largeOperationThreshold;
    const speed = resolveSpeed(snap.draft.speed);
    const [understood, setUnderstood] = useState(false);
    const [typed, setTyped] = useState("");
    const action = useAction();
    const start = (largeOperationConfirmed: boolean) => action.run(async () => {
        await app.startCleanup({ confirmed: true, largeOperationConfirmed });
        onStep(0);
    });

    if (step === 1) {
        return (
            <Dialog title="Confirm cleanup" danger actions={<>
                <Button onClick={() => onStep(0)}>Cancel</Button>
                <Button variant="danger" disabled={!understood || action.pending} onClick={() => large ? onStep(2) : start(false)}>
                    {large ? "Continue" : `Delete ${pluralize(count, "message")}`}
                </Button>
            </>}>
                <dl className="pc-summary">
                    <dt>Target</dt><dd>{describeTarget(app.port, plan.target)}</dd>
                    <dt>Matching messages</dt><dd><strong>{formatNumber(count)}</strong></dd>
                    <dt>Filters</dt><dd><ul>{describeFilters(plan.filters, plan.range, { includeKeywords: true }).map(l => <li key={l}>{l}</li>)}</ul></dd>
                    <dt>Speed</dt><dd>{speed.label}, estimated at least {formatDuration(count * speed.deleteDelayMs)}</dd>
                </dl>
                <Notice kind="info">Discord may impose rate limits. When that happens the cleanup pauses for as long as Discord requires and then continues more slowly.</Notice>
                <Toggle checked={understood} onChange={setUnderstood} label={`I understand this permanently deletes ${pluralize(count, "message")} and can't be undone.`} />
                <ErrorText error={action.error} />
            </Dialog>
        );
    }
    return (
        <Dialog title="Large operation: second confirmation" danger actions={<>
            <Button onClick={() => onStep(0)}>Cancel</Button>
            <Button variant="danger" disabled={typed.trim() !== String(count) || action.pending} onClick={() => start(true)}>Start deleting</Button>
        </>}>
            <p>This will delete <strong>{formatNumber(count)}</strong> messages, more than your large-operation threshold of {formatNumber(snap.prefs.largeOperationThreshold)}.
                It will take at least {formatDuration(count * speed.deleteDelayMs)}.</p>
            <label className="pc-field">
                <span className="pc-field-label">Type {count} to confirm</span>
                <input className="pc-input" value={typed} onChange={e => setTyped(e.currentTarget.value)} autoFocus />
            </label>
            <ErrorText error={action.error} />
        </Dialog>
    );
}

const STATUS_LABEL: Record<JobProgress["status"], string> = {
    idle: "Idle", running: "Running", paused: "Paused", completed: "Completed", cancelled: "Cancelled", stopped: "Stopped", failed: "Stopped with an error"
};

export function ProgressView(props: { app: App; job: JobProgress; }) {
    const { app, job } = props;
    const active = job.status === "running" || job.status === "paused";
    const now = useNow(active);
    const fraction = job.total ? job.processed / job.total : 0;
    return (
        <Section title="Progress" actions={<span className={`pc-status pc-status-${job.status}`}>{STATUS_LABEL[job.status]}</span>}>
            <ProgressBar value={fraction} />
            <div className="pc-stats">
                <Stat label="Processed" value={`${formatNumber(job.processed)} / ${formatNumber(job.total)}`} />
                <Stat label="Deleted" value={formatNumber(job.deleted)} tone="good" />
                <Stat label="Skipped" value={formatNumber(job.skipped)} />
                <Stat label="Rate-limit pauses" value={formatNumber(job.rateLimitPauses)} tone={job.rateLimitPauses ? "warn" : undefined} />
                <Stat label="Errors" value={formatNumber(job.errors)} tone={job.errors ? "bad" : undefined} />
                <Stat label="Estimated remaining" value={active ? formatDuration(job.etaMs) : "—"} />
            </div>
            {job.skipped > 0 && (
                <span className="pc-muted">
                    Skipped: {job.skipReasons.alreadyDeleted} already deleted, {job.skipReasons.notPermitted} not permitted (e.g. archived threads)
                    {job.skipReasons.notOwnMessage ? `, ${job.skipReasons.notOwnMessage} not yours` : ""}.
                </span>
            )}
            {job.waitingUntil !== null && job.waitReason !== "pace" && (
                <Notice kind="warning">
                    {job.waitReason === "rateLimit" ? "Discord rate limit: pausing" : "Retrying after an error in"} {formatDuration(Math.max(0, job.waitingUntil - now))}…
                </Notice>
            )}
            {job.lastError && <Notice kind={job.status === "failed" ? "danger" : "warning"}>{job.lastError}</Notice>}
            <div className="pc-row pc-wrap">
                {job.status === "running" && <Button onClick={() => app.pauseCleanup()}>Pause</Button>}
                {job.status === "paused" && <Button variant="primary" onClick={() => app.resumeCleanup()}>Resume</Button>}
                {active && <Button variant="danger" onClick={() => app.cancelCleanup()}>Cancel</Button>}
                {!active && <Button variant="ghost" onClick={() => app.dismissFinishedJob()}>Dismiss</Button>}
            </div>
        </Section>
    );
}
