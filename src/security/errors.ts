export class SecurityError extends Error {
    override name = "SecurityError";
}

export class KillSwitchEngagedError extends Error {
    override name = "KillSwitchEngagedError";
    constructor() {
        super("STOP ALL OPERATIONS is engaged. No new requests are sent until you re-enable operations.");
    }
}
