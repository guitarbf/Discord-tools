import type { LedgerSnapshot } from "../privacy/ledger";
import { ShieldIcon } from "./icons";

export function PrivacyBadge(props: { ledger: LedgerSnapshot; debugOn: boolean; }) {
    const ok = props.ledger.externalConnections === 0 && !props.debugOn;
    return (
        <div className={`pc-badge${ok ? "" : " pc-badge-warn"}`} title="Details on the Privacy & Security tab">
            <ShieldIcon width={18} height={18} />
            <div>
                <div className="pc-badge-title">{ok ? "Privacy Protected" : props.debugOn ? "Privacy Protected · debug logging on" : "Check Privacy & Security"}</div>
                <div className="pc-badge-sub">No telemetry • Local processing • No token collection</div>
            </div>
        </div>
    );
}
