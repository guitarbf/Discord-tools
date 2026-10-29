import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { SecurityError } from "../src/security/errors";
import { MemoryStore } from "../src/storage/kv";
import { LocalStore } from "../src/storage/localStore";
import { CHANNEL, fakePort, instantSleep, makeMessage } from "./helpers";
import type { RawRequester } from "../src/discord/types";

function makeApp(messages = 3) {
    const kv = new MemoryStore();
    const msgs = Array.from({ length: messages }, () => makeMessage());
    const deleted: string[] = [];
    const requests: string[] = [];
    let searched = false;
    const raw: RawRequester = async req => {
        requests.push(`${req.method} ${req.path}`);
        if (req.method === "DELETE") {
            deleted.push(req.path.split("/").pop()!);
            return { status: 204, body: null };
        }
        const hits = searched ? [] : msgs.map(m => [m]);
        searched = true;
        return { status: 200, body: { total_results: msgs.length, messages: hits } };
    };
    const app = new App({ port: fakePort(), raw, kv, networkPrimitivesWrapped: () => false, sleep: instantSleep, console: { warn() { }, error() { } } });
    return { app, kv, deleted, requests };
}

async function waitFor(cond: () => boolean) {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5));
    expect(cond()).toBe(true);
}

describe("app controller", () => {
    it("requires the risk notice, a preview and confirmation before deleting", async () => {
        const { app, deleted } = makeApp();
        await app.init();
        app.setDraft({ channelId: CHANNEL });
        await expect(app.startPreview()).rejects.toThrow(/acknowledge/);
        await app.acknowledgeTos();
        expect(app.startBlocker()).toMatch(/Preview/);
        await app.startPreview();
        expect(app.getSnapshot().scan.result?.items).toHaveLength(3);
        expect(app.startBlocker()).toBeNull();
        await expect(app.startCleanup({ confirmed: false, largeOperationConfirmed: false })).rejects.toThrow(/Confirmation/);
        await app.startCleanup({ confirmed: true, largeOperationConfirmed: false });
        await waitFor(() => app.getSnapshot().job.status === "completed");
        expect(deleted).toHaveLength(3);
        const history = app.getSnapshot().history;
        expect(history[0]).toMatchObject({ status: "completed", deleted: 3, total: 3 });
        expect(app.getSnapshot().scan.result).toBeNull();
        app.dispose();
    });

    it("invalidates the preview when the selection changes", async () => {
        const { app } = makeApp();
        await app.init();
        await app.acknowledgeTos();
        app.setDraft({ channelId: CHANNEL });
        await app.startPreview();
        app.setDraft({ containsText: "something" });
        expect(app.startBlocker()).toMatch(/changed/);
        app.setDraft({ containsText: "" });
        expect(app.startBlocker()).toBeNull();
        app.setDraft({ speed: { preset: "slow", customDelayMs: 3000 } });
        expect(app.startBlocker()).toBeNull();
        app.dispose();
    });

    it("needs a second confirmation for large operations", async () => {
        const { app } = makeApp(20);
        await app.init();
        await app.acknowledgeTos();
        await app.updatePrefs({ largeOperationThreshold: 10 });
        app.setDraft({ channelId: CHANNEL });
        await app.startPreview();
        await expect(app.startCleanup({ confirmed: true, largeOperationConfirmed: false })).rejects.toThrow(/second confirmation/);
        app.dispose();
    });

    it("STOP ALL blocks previews", async () => {
        const { app, requests } = makeApp();
        await app.init();
        await app.acknowledgeTos();
        app.setDraft({ channelId: CHANNEL });
        app.stopAllOperations();
        await expect(app.startPreview()).rejects.toThrow(/STOP ALL/);
        expect(requests).toHaveLength(0);
        app.resumeOperations();
        await app.startPreview();
        expect(requests.length).toBeGreaterThan(0);
        app.dispose();
    });

    it("stores no message content and nothing outside the documented keys", async () => {
        const { app, kv } = makeApp();
        await app.init();
        await app.acknowledgeTos();
        app.setDraft({ channelId: CHANNEL, containsText: "hello" });
        await app.startPreview();
        await app.startCleanup({ confirmed: true, largeOperationConfirmed: false });
        await waitFor(() => app.getSnapshot().job.status === "completed");
        await new Promise(r => setTimeout(r, 10));
        const dump = JSON.stringify([...kv.data.entries()]);
        expect([...kv.data.keys()].sort()).toEqual(["history", "prefs"]);
        expect(dump).not.toContain("hello world");
        expect(dump).not.toContain('"hello"');
        app.dispose();
    });

    it("refuses to persist credential-like data and raises an alert", async () => {
        const { app } = makeApp();
        await app.init();
        await expect(app.createPreset({
            name: "oops", description: "", date: { kind: "none" }, speed: null,
            filters: { contains: ["MTExMTExMTExMTExMTExMTEx.GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789AB"], notContains: [], keywordMatch: "substring", attachments: "any", links: "any", images: "any", replies: "any" }
        })).rejects.toBeInstanceOf(SecurityError);
        expect(app.getSnapshot().securityAlerts).toHaveLength(1);
        expect(app.getSnapshot().presets).toHaveLength(0);
        app.dispose();
    });

    it("Delete All Local Data removes everything", async () => {
        const { app, kv } = makeApp();
        await app.init();
        await app.acknowledgeTos();
        await app.createPreset({ name: "p", description: "", date: { kind: "olderThanDays", days: 30 }, speed: null, filters: { contains: [], notContains: [], keywordMatch: "substring", attachments: "any", links: "any", images: "any", replies: "any" } });
        expect(kv.data.size).toBeGreaterThan(0);
        await app.deleteAllLocalData();
        expect(kv.data.size).toBe(0);
        expect(app.getSnapshot().prefs.tosAcknowledgedAt).toBeNull();
        expect(app.getSnapshot().presets).toHaveLength(0);
        app.dispose();
    });

    it("marks interrupted runs on load and validates stored data", async () => {
        const kv = new MemoryStore();
        await kv.set("history", { v: 1, data: [{ id: "a", startedAt: 1, status: "running", total: 5 }, { bogus: true }] });
        await kv.set("prefs", { v: 1, data: { largeOperationThreshold: -5, defaultSpeed: { preset: "custom", customDelayMs: 1 } } });
        const loaded = await new LocalStore(kv).load();
        expect(loaded.prefs.largeOperationThreshold).toBe(10);
        expect(loaded.prefs.defaultSpeed.customDelayMs).toBe(1000);
        expect(loaded.history).toHaveLength(1);
        expect(loaded.warnings.length).toBeGreaterThan(0);

        const app = new App({ port: fakePort(), raw: null, kv, networkPrimitivesWrapped: () => null, console: { warn() { }, error() { } } });
        await app.init();
        expect(app.getSnapshot().history[0]?.status).toBe("interrupted");
        expect(app.getSnapshot().cleanupUnavailableReason).not.toBeNull();
        app.dispose();
    });

    it("security audit reports a clean state", async () => {
        const { app } = makeApp();
        await app.init();
        const findings = await app.runAudit();
        expect(findings.some(f => f.severity === "risk")).toBe(false);
        expect(findings.find(f => f.id === "net-external")?.severity).toBe("ok");
        app.enableDebug(5, true);
        expect((await app.runAudit()).some(f => f.id === "debug-on" && f.severity === "risk")).toBe(true);
        app.dispose();
    });
});
