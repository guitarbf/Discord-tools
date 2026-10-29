import { type App, getApp } from "../app";
import { useState } from "../discord/compat";
import { TAB_IDS,type TabId } from "../storage/schema";
import { CleanupTab } from "./CleanupTab";
import { Button, Notice } from "./components";
import { HistoryTab } from "./HistoryTab";
import { useAppSnapshot } from "./hooks";
import { PresetsTab } from "./PresetsTab";
import { PrivacyBadge } from "./PrivacyBadge";
import { PrivacyTab } from "./PrivacyTab";

const TAB_LABELS: Record<TabId, string> = {
    cleanup: "Message Cleanup",
    presets: "Presets",
    history: "History",
    privacy: "Privacy & Security"
};

export function MessageCleanupPanel() {
    const app = getApp();
    if (!app) {
        return (
            <div className="pc-root">
                <Notice kind="warning">PrivacyCleanup isn't running. Enable it in Vencord → Plugins.</Notice>
            </div>
        );
    }
    return <PanelInner app={app} />;
}

function PanelInner(props: { app: App; }) {
    const { app } = props;
    const snap = useAppSnapshot(app);
    const [tab, setTabState] = useState<TabId | null>(null);
    const active = tab ?? snap.prefs.lastTab;
    const setTab = (next: TabId) => {
        setTabState(next);
        if (snap.prefs.lastTab !== next) void app.updatePrefs({ lastTab: next }).catch(() => undefined);
    };

    if (!snap.loaded) return <div className="pc-root"><span className="pc-muted">Loading…</span></div>;

    return (
        <div className="pc-root">
            <header className="pc-header">
                <h2 className="pc-title">MESSAGE CLEANUP</h2>
                <PrivacyBadge ledger={snap.ledger} debugOn={snap.debug.enabled} />
            </header>

            <div className="pc-row pc-wrap pc-emergency">
                {snap.killSwitchEngaged ? (
                    <>
                        <Notice kind="danger" title="All operations stopped">No requests are sent until you re-enable operations.</Notice>
                        <Button variant="success" onClick={() => app.resumeOperations()}>Re-enable operations</Button>
                    </>
                ) : (
                    <Button variant="danger" onClick={() => app.stopAllOperations()} title="Immediately blocks every new request and halts any preview or cleanup">
                        STOP ALL OPERATIONS
                    </Button>
                )}
            </div>

            {snap.loadError && <Notice kind="warning">{snap.loadError}</Notice>}
            {snap.securityAlerts.length > 0 && active !== "privacy" && (
                <Notice kind="danger" title="Security alert">
                    {snap.securityAlerts[snap.securityAlerts.length - 1]} <a className="pc-link" onClick={() => setTab("privacy")}>Details</a>
                </Notice>
            )}

            <nav className="pc-tabs" role="tablist">
                {TAB_IDS.map(id => (
                    <button key={id} type="button" role="tab" aria-selected={id === active} className={`pc-tab${id === active ? " pc-tab-active" : ""}`} onClick={() => setTab(id)}>
                        {TAB_LABELS[id]}
                    </button>
                ))}
            </nav>

            {active === "cleanup" && <CleanupTab app={app} snap={snap} />}
            {active === "presets" && <PresetsTab app={app} snap={snap} onLoaded={() => setTab("cleanup")} />}
            {active === "history" && <HistoryTab app={app} snap={snap} />}
            {active === "privacy" && <PrivacyTab app={app} snap={snap} />}
        </div>
    );
}
