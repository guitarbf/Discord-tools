import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";

export function Button(props: {
    children: ReactNode;
    onClick?: () => void;
    variant?: ButtonVariant;
    disabled?: boolean;
    title?: string;
    small?: boolean;
}) {
    const { variant = "secondary", small } = props;
    return (
        <button
            type="button"
            className={`pc-btn pc-btn-${variant}${small ? " pc-btn-small" : ""}`}
            onClick={props.onClick}
            disabled={props.disabled}
            title={props.title}
        >
            {props.children}
        </button>
    );
}

export function Section(props: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; }) {
    return (
        <section className="pc-section">
            <div className="pc-section-head">
                <h3 className="pc-section-title">{props.title}</h3>
                {props.actions && <div className="pc-row">{props.actions}</div>}
            </div>
            {props.description && <p className="pc-muted pc-section-desc">{props.description}</p>}
            {props.children}
        </section>
    );
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode; }) {
    return (
        <label className="pc-field">
            <span className="pc-field-label">{props.label}</span>
            {props.children}
            {props.hint && <span className="pc-muted pc-field-hint">{props.hint}</span>}
        </label>
    );
}

export function Segmented<T extends string>(props: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string; }>;
    onChange: (value: T) => void;
    disabled?: boolean;
    ariaLabel?: string;
}) {
    return (
        <div className="pc-segmented" role="radiogroup" aria-label={props.ariaLabel}>
            {props.options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={o.value === props.value}
                    className={`pc-seg${o.value === props.value ? " pc-seg-active" : ""}`}
                    disabled={props.disabled}
                    onClick={() => props.onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function Toggle(props: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; }) {
    return (
        <label className="pc-toggle">
            <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={e => props.onChange(e.currentTarget.checked)} />
            <span>
                <span className="pc-toggle-label">{props.label}</span>
                {props.hint && <span className="pc-muted pc-field-hint">{props.hint}</span>}
            </span>
        </label>
    );
}

export type NoticeKind = "info" | "warning" | "danger" | "success";

export function Notice(props: { kind: NoticeKind; children: ReactNode; title?: string; }) {
    return (
        <div className={`pc-notice pc-notice-${props.kind}`} role={props.kind === "danger" ? "alert" : undefined}>
            {props.title && <strong className="pc-notice-title">{props.title}</strong>}
            <div>{props.children}</div>
        </div>
    );
}

export function ProgressBar(props: { value: number; }) {
    const pct = Math.max(0, Math.min(100, Math.round(props.value * 100)));
    return (
        <div className="pc-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="pc-progress-fill" style={{ width: `${pct}%` }} />
            <span className="pc-progress-label">{pct}%</span>
        </div>
    );
}

export function Stat(props: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn"; }) {
    return (
        <div className={`pc-stat${props.tone ? ` pc-stat-${props.tone}` : ""}`}>
            <span className="pc-stat-value">{props.value}</span>
            <span className="pc-stat-label">{props.label}</span>
        </div>
    );
}

export function Dialog(props: { title: string; children: ReactNode; actions: ReactNode; danger?: boolean; }) {
    return (
        <div className="pc-dialog-backdrop">
            <div className={`pc-dialog${props.danger ? " pc-dialog-danger" : ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
                <h2 className="pc-dialog-title">{props.title}</h2>
                <div className="pc-dialog-body">{props.children}</div>
                <div className="pc-dialog-actions">{props.actions}</div>
            </div>
        </div>
    );
}

export function ErrorText(props: { error: string | null; }) {
    return props.error ? <div className="pc-error" role="alert">{props.error}</div> : null;
}
