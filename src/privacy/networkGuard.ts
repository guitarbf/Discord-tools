import type { RawRequest } from "../discord/types";
import { KillSwitchEngagedError, SecurityError } from "../security/errors";
import type { KillSwitch } from "../security/killSwitch";
import type { NetworkLedger, RouteName } from "./ledger";

const SNOWFLAKE = String.raw`\d{17,20}`;

const SEARCH_QUERY_KEYS = new Set([
    "author_id", "channel_id", "min_id", "max_id", "content", "has", "include_nsfw", "sort_by", "sort_order", "offset"
]);

interface RouteRule {
    name: RouteName;
    method: RawRequest["method"];
    pattern: RegExp;
    queryKeys: ReadonlySet<string>;
}

const ROUTES: readonly RouteRule[] = [
    { name: "searchChannel", method: "GET", pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages/search$`), queryKeys: SEARCH_QUERY_KEYS },
    { name: "searchGuild", method: "GET", pattern: new RegExp(`^/guilds/${SNOWFLAKE}/messages/search$`), queryKeys: SEARCH_QUERY_KEYS },
    { name: "channelHistory", method: "GET", pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages$`), queryKeys: new Set(["before", "limit"]) },
    { name: "deleteMessage", method: "DELETE", pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages/${SNOWFLAKE}$`), queryKeys: new Set() }
];

export const ALLOWED_ROUTE_DESCRIPTIONS: readonly string[] = [
    "GET /channels/{id}/messages/search: find your messages in a DM or channel",
    "GET /guilds/{id}/messages/search: find your messages in a server",
    "GET /channels/{id}/messages: fallback history scan when search is unavailable",
    "DELETE /channels/{id}/messages/{id}: delete one of your messages"
];

const MAX_QUERY_VALUE_LENGTH = 512;

// Every request must pass this allowlist.
export class NetworkGuard {
    constructor(private readonly ledger: NetworkLedger, private readonly killSwitch: KillSwitch) { }

    authorize(request: RawRequest): RouteName {
        if (this.killSwitch.engaged) {
            this.ledger.recordKillSwitchRefusal();
            throw new KillSwitchEngagedError();
        }

        const rule = ROUTES.find(r => r.method === request.method && r.pattern.test(request.path));
        if (!rule) {
            this.ledger.recordBlocked();
            throw new SecurityError(`Blocked a request to a route that is not on the allowlist (${request.method}).`);
        }

        for (const [key, raw] of Object.entries(request.query ?? {})) {
            const values = Array.isArray(raw) ? raw : [raw];
            const valid = rule.queryKeys.has(key) && values.every(v =>
                typeof v === "string" && v.length <= MAX_QUERY_VALUE_LENGTH && !/[\r\n\0]/.test(v));
            if (!valid) {
                this.ledger.recordBlocked();
                throw new SecurityError(`Blocked a request with a disallowed query parameter "${key}".`);
            }
        }

        this.ledger.recordAllowed(rule.name, "discord-api");
        return rule.name;
    }
}
