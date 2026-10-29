import { describe, expect, it } from "vitest";
import { DiscordApi } from "../src/discord/api";
import { NetworkLedger } from "../src/privacy/ledger";
import { NetworkGuard } from "../src/privacy/networkGuard";
import { KillSwitchEngagedError, SecurityError } from "../src/security/errors";
import { KillSwitch } from "../src/security/killSwitch";
import { CHANNEL } from "./helpers";

function setup() {
    const ledger = new NetworkLedger();
    const killSwitch = new KillSwitch();
    const guard = new NetworkGuard(ledger, killSwitch);
    return { ledger, killSwitch, guard };
}

describe("network guard", () => {
    it("allows exactly the four Discord API routes", () => {
        const { guard, ledger } = setup();
        expect(guard.authorize({ method: "GET", path: `/channels/${CHANNEL}/messages/search`, query: { author_id: CHANNEL, has: ["file", "link"] } })).toBe("searchChannel");
        expect(guard.authorize({ method: "GET", path: `/guilds/${CHANNEL}/messages/search` })).toBe("searchGuild");
        expect(guard.authorize({ method: "GET", path: `/channels/${CHANNEL}/messages`, query: { limit: "100" } })).toBe("channelHistory");
        expect(guard.authorize({ method: "DELETE", path: `/channels/${CHANNEL}/messages/${CHANNEL}` })).toBe("deleteMessage");
        expect(ledger.snapshot().externalConnections).toBe(0);
    });

    it.each([
        ["absolute URL", "GET", "https://evil.example/channels/1/messages"],
        ["protocol-relative", "GET", `//evil.example/channels/${CHANNEL}/messages`],
        ["other route", "GET", "/users/@me"],
        ["wrong method", "DELETE", `/channels/${CHANNEL}/messages`],
        ["path traversal", "GET", `/channels/${CHANNEL}/messages/../../users/@me`],
        ["non-snowflake", "GET", "/channels/abc/messages"]
    ] as const)("blocks %s", (_label, method, path) => {
        const { guard, ledger } = setup();
        expect(() => guard.authorize({ method, path })).toThrow(SecurityError);
        expect(ledger.snapshot().blockedRequests).toBe(1);
    });

    it("blocks unexpected query parameters", () => {
        const { guard } = setup();
        expect(() => guard.authorize({ method: "GET", path: `/channels/${CHANNEL}/messages`, query: { token: "x" } })).toThrow(SecurityError);
        expect(() => guard.authorize({ method: "GET", path: `/channels/${CHANNEL}/messages`, query: { limit: "1\r\nX: y" } })).toThrow(SecurityError);
    });

    it("refuses everything while STOP ALL is engaged", async () => {
        const { guard, killSwitch, ledger } = setup();
        killSwitch.engage();
        let sent = 0;
        const api = new DiscordApi(async () => { sent++; return { status: 204, body: null }; }, guard);
        await expect(api.deleteMessage(CHANNEL, CHANNEL)).rejects.toBeInstanceOf(KillSwitchEngagedError);
        expect(sent).toBe(0);
        expect(ledger.snapshot().killSwitchRefusals).toBe(1);
        killSwitch.rearm();
        await expect(api.deleteMessage(CHANNEL, CHANNEL)).resolves.toMatchObject({ kind: "ok" });
        expect(sent).toBe(1);
    });
});

describe("response classification", () => {
    const { guard } = setup();
    const respond = (status: number, body: unknown, reject = false) => new DiscordApi(async () => {
        if (reject) throw { status, body, headers: { authorization: "should-not-leak" } };
        return { status, body };
    }, guard);

    it("maps rate limits with Discord's retry_after", async () => {
        await expect(respond(429, { retry_after: 2.5, global: false }, true).deleteMessage(CHANNEL, CHANNEL))
            .resolves.toEqual({ kind: "rateLimited", retryAfterMs: 2500, global: false });
    });

    it("maps 404 / 403 / archived threads", async () => {
        await expect(respond(404, { code: 10008 }, true).deleteMessage(CHANNEL, CHANNEL)).resolves.toMatchObject({ kind: "notFound" });
        await expect(respond(403, { code: 50013 }, true).deleteMessage(CHANNEL, CHANNEL)).resolves.toMatchObject({ kind: "forbidden" });
        await expect(respond(400, { code: 50083, message: "Thread archived" }, true).deleteMessage(CHANNEL, CHANNEL)).resolves.toMatchObject({ kind: "forbidden" });
    });

    it("maps search indexing (202)", async () => {
        await expect(respond(202, { retry_after: 1 }).search(`/channels/${CHANNEL}/messages/search`, {})).resolves.toEqual({ kind: "indexing", retryAfterMs: 1000 });
    });

    it("does not leak network error objects", async () => {
        const api = new DiscordApi(async () => { throw new Error("socket details authorization=abc"); }, guard);
        const out = await api.deleteMessage(CHANNEL, CHANNEL);
        expect(JSON.stringify(out)).not.toContain("authorization");
    });
});
