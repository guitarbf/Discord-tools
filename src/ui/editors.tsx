import type { CleanupDraft } from "../cleanup/draft";
import type { DateSpec } from "../cleanup/presets";
import { MIN_DELETE_DELAY_MS, resolveSpeed, SPEED_PRESETS } from "../cleanup/speed";
import type { CleanupTarget, KeywordMatch, SpeedPreset, SpeedSetting, TriState } from "../cleanup/types";
import { useMemo, useState } from "../discord/compat";
import { isSnowflake } from "../discord/snowflake";
import type { ChannelInfo, DiscordPort } from "../discord/types";
import { toDateInput } from "../utils/dates";
import { Button, Field, Segmented } from "./components";

const KIND_LABEL: Record<ChannelInfo["kind"], string> = {
    dm: "DM", groupDm: "Group DM", text: "Channel", announcement: "Announcements", thread: "Thread",
    voice: "Voice text", stage: "Stage", forum: "Forum", unknown: "Channel"
};

export function describeTarget(port: DiscordPort, target: CleanupTarget | { kind: "channel" | "guild"; channelId?: string | null; guildId?: string | null; }): string {
    if (target.kind === "guild") {
        const guild = target.guildId ? port.getGuild(target.guildId) : null;
        return `Entire server: ${guild?.name ?? "unknown server"} (all channels you can search)`;
    }
    const channel = "channelId" in target && target.channelId ? port.getChannel(target.channelId) : null;
    if (!channel) return "Unknown or unavailable channel";
    if (channel.kind === "dm") return `DM with ${channel.name}`;
    if (channel.kind === "groupDm") return `Group DM: ${channel.name}`;
    const guild = channel.guildId ? port.getGuild(channel.guildId) : null;
    return `${KIND_LABEL[channel.kind]} #${channel.name}${guild ? ` in ${guild.name}` : ""}`;
}

export function TargetPicker(props: { port: DiscordPort; draft: CleanupDraft; onChange: (patch: Partial<CleanupDraft>) => void; disabled?: boolean; }) {
    const { port, draft, onChange, disabled } = props;
    const [browseGuild, setBrowseGuild] = useState<string>(() => {
        const ch = draft.channelId ? port.getChannel(draft.channelId) : null;
        return ch?.guildId ?? "";
    });
    const privateChannels = useMemo(() => port.listPrivateChannels(), [port]);
    const guilds = useMemo(() => port.listGuilds(), [port]);
    const guildChannels = useMemo(() => browseGuild ? port.listGuildChannels(browseGuild) : [], [port, browseGuild]);
    const current = port.getSelectedChannelId();

    const pickChannel = (id: string) => onChange({ channelId: id });

    return (
        <div className="pc-stack">
            <Segmented
                ariaLabel="Scope"
                value={draft.scope}
                disabled={disabled}
                options={[{ value: "channel", label: "Channel / DM" }, { value: "guild", label: "Entire server" }]}
                onChange={scope => onChange({ scope })}
            />
            {draft.scope === "channel" ? (
                <div className="pc-stack">
                    <div className="pc-row pc-wrap">
                        <Button disabled={disabled || !current} onClick={() => current && pickChannel(current)} title="Use the channel you have open">
                            Use current channel
                        </Button>
                        <select className="pc-input pc-select" disabled={disabled} value={privateChannels.some(c => c.id === draft.channelId) ? draft.channelId : ""} onChange={e => e.currentTarget.value && pickChannel(e.currentTarget.value)}>
                            <option value="">Direct messages…</option>
                            {privateChannels.map(c => <option key={c.id} value={c.id}>{c.kind === "groupDm" ? "Group: " : ""}{c.name}</option>)}
                        </select>
                    </div>
                    <div className="pc-row pc-wrap">
                        <select className="pc-input pc-select" disabled={disabled} value={browseGuild} onChange={e => setBrowseGuild(e.currentTarget.value)}>
                            <option value="">Server…</option>
                            {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        <select className="pc-input pc-select" disabled={disabled || !browseGuild} value={guildChannels.some(c => c.id === draft.channelId) ? draft.channelId : ""} onChange={e => e.currentTarget.value && pickChannel(e.currentTarget.value)}>
                            <option value="">Channel…</option>
                            {guildChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                        </select>
                    </div>
                    <Field label="Or channel ID" hint="Works for threads.">
                        <input className="pc-input" disabled={disabled} value={draft.channelId} placeholder="e.g. 123456789012345678" onChange={e => onChange({ channelId: e.currentTarget.value.trim() })} />
                    </Field>
                </div>
            ) : (
                <select className="pc-input pc-select" disabled={disabled} value={draft.guildId} onChange={e => onChange({ guildId: e.currentTarget.value })}>
                    <option value="">Server…</option>
                    {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
            )}
            <div className="pc-target">
                <span className="pc-muted">Target: </span>
                <strong>{
                    draft.scope === "guild"
                        ? (isSnowflake(draft.guildId) ? describeTarget(port, { kind: "guild", guildId: draft.guildId }) : "None selected")
                        : (isSnowflake(draft.channelId) ? describeTarget(port, { kind: "channel", channelId: draft.channelId }) : "None selected")
                }</strong>
            </div>
        </div>
    );
}

type DateMode = DateSpec["kind"];

const DATE_MODES: ReadonlyArray<{ value: DateMode; label: string; }> = [
    { value: "none", label: "Any time" },
    { value: "before", label: "Before" },
    { value: "after", label: "After" },
    { value: "between", label: "Between" },
    { value: "olderThanDays", label: "Older than N days" },
    { value: "newerThanDays", label: "Last N days" }
];

function switchDateMode(spec: DateSpec, mode: DateMode): DateSpec {
    const today = toDateInput(Date.now());
    switch (mode) {
        case "none": return { kind: "none" };
        case "before": return { kind: "before", date: "date" in spec ? spec.date : today };
        case "after": return { kind: "after", date: "date" in spec ? spec.date : today };
        case "between": return { kind: "between", from: "from" in spec ? spec.from : today, to: "to" in spec ? spec.to : today };
        case "olderThanDays": return { kind: "olderThanDays", days: "days" in spec ? spec.days : 30 };
        case "newerThanDays": return { kind: "newerThanDays", days: "days" in spec ? spec.days : 7 };
    }
}

export function DateSpecEditor(props: { value: DateSpec; onChange: (spec: DateSpec) => void; disabled?: boolean; }) {
    const { value, onChange, disabled } = props;
    return (
        <div className="pc-stack">
            <Segmented ariaLabel="Date range" value={value.kind} options={DATE_MODES} disabled={disabled} onChange={mode => onChange(switchDateMode(value, mode))} />
            {(value.kind === "before" || value.kind === "after") && (
                <Field label={value.kind === "before" ? "Sent before (not including this day)" : "Sent after (not including this day)"}>
                    <input type="date" className="pc-input" disabled={disabled} value={value.date} onChange={e => onChange({ ...value, date: e.currentTarget.value })} />
                </Field>
            )}
            {value.kind === "between" && (
                <div className="pc-row pc-wrap">
                    <Field label="From (inclusive)">
                        <input type="date" className="pc-input" disabled={disabled} value={value.from} onChange={e => onChange({ ...value, from: e.currentTarget.value })} />
                    </Field>
                    <Field label="To (inclusive)">
                        <input type="date" className="pc-input" disabled={disabled} value={value.to} onChange={e => onChange({ ...value, to: e.currentTarget.value })} />
                    </Field>
                </div>
            )}
            {(value.kind === "olderThanDays" || value.kind === "newerThanDays") && (
                <Field label="Days" hint="From preview time.">
                    <input type="number" min={1} max={36500} className="pc-input pc-input-narrow" disabled={disabled} value={value.days}
                        onChange={e => onChange({ ...value, days: Math.max(1, Math.min(36500, Math.round(Number(e.currentTarget.value) || 1))) })} />
                </Field>
            )}
        </div>
    );
}

export interface FilterFields {
    containsText: string;
    notContainsText: string;
    keywordMatch: KeywordMatch;
    attachments: TriState;
    links: TriState;
    images: TriState;
    replies: TriState;
}

const TRI_OPTIONS: ReadonlyArray<{ value: TriState; label: string; }> = [
    { value: "any", label: "Any" },
    { value: "only", label: "Only with" },
    { value: "exclude", label: "Without" }
];

export function FiltersEditor(props: { value: FilterFields; onChange: (patch: Partial<FilterFields>) => void; disabled?: boolean; }) {
    const { value, onChange, disabled } = props;
    const tri = (key: "attachments" | "links" | "images" | "replies", label: string) => (
        <div className="pc-filter-row" key={key}>
            <span className="pc-filter-label">{label}</span>
            <Segmented ariaLabel={label} value={value[key]} options={TRI_OPTIONS} disabled={disabled} onChange={v => onChange({ [key]: v })} />
        </div>
    );
    return (
        <div className="pc-stack">
            <Field label="Contains text" hint="Comma-separated, any match.">
                <input className="pc-input" disabled={disabled} value={value.containsText} placeholder="keyword, another keyword" onChange={e => onChange({ containsText: e.currentTarget.value })} />
            </Field>
            <Field label="Does not contain text" hint="Comma-separated.">
                <input className="pc-input" disabled={disabled} value={value.notContainsText} placeholder="keep, these" onChange={e => onChange({ notContainsText: e.currentTarget.value })} />
            </Field>
            <div className="pc-filter-row">
                <span className="pc-filter-label">Keyword matching</span>
                <Segmented ariaLabel="Keyword matching" value={value.keywordMatch} disabled={disabled}
                    options={[{ value: "substring", label: "Anywhere in text" }, { value: "word", label: "Whole words (faster)" }]}
                    onChange={keywordMatch => onChange({ keywordMatch })} />
            </div>
            {tri("attachments", "Attachments")}
            {tri("links", "Links")}
            {tri("images", "Images")}
            {tri("replies", "Replies")}
        </div>
    );
}

const SPEED_OPTIONS: ReadonlyArray<{ value: SpeedPreset; label: string; }> = [
    { value: "verySlow", label: SPEED_PRESETS.verySlow.label },
    { value: "slow", label: SPEED_PRESETS.slow.label },
    { value: "normal", label: SPEED_PRESETS.normal.label },
    { value: "fast", label: SPEED_PRESETS.fast.label },
    { value: "custom", label: "Custom" }
];

export function SpeedPicker(props: { value: SpeedSetting; onChange: (speed: SpeedSetting) => void; disabled?: boolean; }) {
    const { value, onChange, disabled } = props;
    const resolved = resolveSpeed(value);
    return (
        <div className="pc-stack">
            <Segmented ariaLabel="Speed" value={value.preset} options={SPEED_OPTIONS} disabled={disabled} onChange={preset => onChange({ ...value, preset })} />
            {value.preset === "custom" && (
                <Field label="Seconds between deletions" hint={`Minimum ${MIN_DELETE_DELAY_MS / 1000}s.`}>
                    <input type="number" step={0.1} min={MIN_DELETE_DELAY_MS / 1000} max={120} className="pc-input pc-input-narrow" disabled={disabled}
                        value={value.customDelayMs / 1000}
                        onChange={e => onChange({ ...value, customDelayMs: Math.round((Number(e.currentTarget.value) || 0) * 1000) })} />
                </Field>
            )}
            <span className="pc-muted">
                About {(resolved.deleteDelayMs / 1000).toFixed(1)}s per message (~{Math.round(3600_000 / resolved.deleteDelayMs).toLocaleString()} per hour at most).
                Discord may impose additional rate limits; the addon always waits as long as Discord asks.
            </span>
        </div>
    );
}
