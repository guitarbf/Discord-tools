import type { App, AppSnapshot } from "../app";
import { describeFilters } from "../cleanup/filters";
import { type Preset, PRESET_TEMPLATES, type PresetDraft, resolveDateSpec } from "../cleanup/presets";
import { resolveSpeed } from "../cleanup/speed";
import { useState } from "../discord/compat";
import { Button, Dialog, ErrorText, Field, Notice, Section, Toggle } from "./components";
import { DateSpecEditor, FiltersEditor, SpeedPicker } from "./editors";
import { useAction } from "./hooks";
import { draftFromPreset, filterFieldsFromFilters, filtersFromFields, presetDraftFromCleanupDraft } from "./presetForm";

function safeDescribe(p: PresetDraft): string[] {
    try {
        return describeFilters(p.filters, resolveDateSpec(p.date), { includeKeywords: true });
    } catch {
        return ["Invalid date range"];
    }
}

export function PresetsTab(props: { app: App; snap: AppSnapshot; onLoaded: () => void; }) {
    const { app, snap, onLoaded } = props;
    const [editing, setEditing] = useState<{ id: string | null; draft: PresetDraft; } | null>(null);
    const [deleting, setDeleting] = useState<Preset | null>(null);
    const action = useAction();

    return (
        <div className="pc-stack-lg">
            <Notice kind="info">Presets are saved only on this computer. They never include a channel and never run on their own: loading one fills in the cleanup form, and you still preview and confirm.</Notice>

            <Section title="Your presets" actions={<>
                <Button onClick={() => setEditing({ id: null, draft: presetDraftFromCleanupDraft(snap.draft, "My preset") })}>Save current form as preset</Button>
            </>}>
                {snap.presets.length === 0 && <span className="pc-muted">No presets yet. Start from a template below.</span>}
                <ul className="pc-list">
                    {snap.presets.map(p => (
                        <li key={p.id} className="pc-list-item">
                            <div className="pc-grow">
                                <div className="pc-list-title">{p.name}</div>
                                {p.description && <div className="pc-muted">{p.description}</div>}
                                <div className="pc-muted pc-small">{safeDescribe(p).join(" · ")} · Speed: {p.speed ? resolveSpeed(p.speed).label : "default"}</div>
                            </div>
                            <div className="pc-row">
                                <Button small variant="primary" onClick={() => { app.setDraft(draftFromPreset(p, snap.prefs.defaultSpeed)); onLoaded(); }}>Load</Button>
                                <Button small onClick={() => setEditing({ id: p.id, draft: { name: p.name, description: p.description, filters: p.filters, date: p.date, speed: p.speed } })}>Edit</Button>
                                <Button small variant="danger" onClick={() => setDeleting(p)}>Delete</Button>
                            </div>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section title="Templates" description="Creating a preset from a template only saves it. You can edit it afterwards.">
                <ul className="pc-list">
                    {PRESET_TEMPLATES.map(t => (
                        <li key={t.name} className="pc-list-item">
                            <div className="pc-grow">
                                <div className="pc-list-title">{t.name}</div>
                                <div className="pc-muted">{t.description}</div>
                            </div>
                            <Button small onClick={() => setEditing({ id: null, draft: structuredClone(t) })}>Use template</Button>
                        </li>
                    ))}
                </ul>
            </Section>
            <ErrorText error={action.error} />

            {editing && (
                <PresetEditor
                    initial={editing.draft}
                    isNew={editing.id === null}
                    onCancel={() => setEditing(null)}
                    onSave={draft => action.run(async () => {
                        if (editing.id) await app.updatePreset(editing.id, draft);
                        else await app.createPreset(draft);
                        setEditing(null);
                    })}
                    error={action.error}
                />
            )}
            {deleting && (
                <Dialog title="Delete preset?" danger actions={<>
                    <Button onClick={() => setDeleting(null)}>Cancel</Button>
                    <Button variant="danger" onClick={() => action.run(async () => { await app.deletePreset(deleting.id); setDeleting(null); })}>Delete</Button>
                </>}>
                    <p>“{deleting.name}” will be removed from local storage. No messages are affected.</p>
                </Dialog>
            )}
        </div>
    );
}

function PresetEditor(props: { initial: PresetDraft; isNew: boolean; onSave: (draft: PresetDraft) => void; onCancel: () => void; error: string | null; }) {
    const [name, setName] = useState(props.initial.name);
    const [description, setDescription] = useState(props.initial.description);
    const [fields, setFields] = useState(filterFieldsFromFilters(props.initial.filters));
    const [date, setDate] = useState(props.initial.date);
    const [overrideSpeed, setOverrideSpeed] = useState(props.initial.speed !== null);
    const [speed, setSpeed] = useState(props.initial.speed ?? { preset: "normal" as const, customDelayMs: 2500 });

    return (
        <Dialog title={props.isNew ? "New preset" : "Edit preset"} actions={<>
            <Button onClick={props.onCancel}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim()} onClick={() => props.onSave({
                name: name.trim().slice(0, 100),
                description: description.trim().slice(0, 500),
                filters: filtersFromFields(fields),
                date,
                speed: overrideSpeed ? speed : null
            })}>Save preset</Button>
        </>}>
            <div className="pc-stack">
                <Field label="Name"><input className="pc-input" value={name} maxLength={100} onChange={e => setName(e.currentTarget.value)} /></Field>
                <Field label="Description"><input className="pc-input" value={description} maxLength={500} onChange={e => setDescription(e.currentTarget.value)} /></Field>
                <h4 className="pc-subhead">Date range</h4>
                <DateSpecEditor value={date} onChange={setDate} />
                <h4 className="pc-subhead">Filters</h4>
                <FiltersEditor value={fields} onChange={patch => setFields({ ...fields, ...patch })} />
                <Toggle checked={overrideSpeed} onChange={setOverrideSpeed} label="Use a specific speed for this preset" />
                {overrideSpeed && <SpeedPicker value={speed} onChange={setSpeed} />}
                <ErrorText error={props.error} />
            </div>
        </Dialog>
    );
}
