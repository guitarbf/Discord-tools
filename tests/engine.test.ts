import { describe, expect, it } from "vitest";
import type { ApiOutcome } from "../src/discord/api";
import { CleanupEngine, type CleanupJob } from "../src/cleanup/engine";
import type { MatchedMessage } from "../src/cleanup/types";
import { KillSwitch } from "../src/security/killSwitch";
import { CHANNEL, instantSleep, ME, OTHER, silentLogger } from "./helpers";

const item = (id: string, authorId = ME): MatchedMessage => ({ id, channelId: CHANNEL, authorId, timestamp: 0, preview: null });

function makeEngine(responses: Array<ApiOutcome<null>>, opts: { userId?: () => string | null; } = {}) {
    const calls: string[] = [];
    const killSwitch = new KillSwitch();
    const sleeps: number[] = [];
    const engine = new CleanupEngine({
        api: {
            deleteMessage: async (_c, id) => {
                calls.push(id);
                return responses.shift() ?? { kind: "ok", status: 204, body: null };
            }
        },
        getCurrentUserId: opts.userId ?? (() => ME),
        killSwitch,
        logger: silentLogger,
        sleep: async (ms, signal) => { sleeps.push(ms); await instantSleep(ms, signal); }
    });
    return { engine, calls, killSwitch, sleeps };
}

const job = (items: MatchedMessage[]): CleanupJob => ({ id: "job", userId: ME, target: { kind: "channel", channelId: CHANNEL, guildId: null }, items, deleteDelayMs: 1000 });

describe("cleanup engine", () => {
    it("deletes every item and reports counts", async () => {
        const { engine, calls } = makeEngine([]);
        const result = await engine.start(job([item("1"), item("2"), item("3")]));
        expect(calls).toEqual(["1", "2", "3"]);
        expect(result).toMatchObject({ status: "completed", processed: 3, deleted: 3, skipped: 0, errors: 0 });
    });

    it("never sends a delete for another user's message", async () => {
        const { engine, calls } = makeEngine([]);
        const result = await engine.start(job([item("1"), item("2", OTHER)]));
        expect(calls).toEqual(["1"]);
        expect(result.skipReasons.notOwnMessage).toBe(1);
    });

    it("stops if the logged-in account changes", async () => {
        let current = ME;
        const { engine, calls } = makeEngine([], { userId: () => current });
        const p = engine.start(job([item("1"), item("2"), item("3")]));
        current = OTHER;
        const result = await p;
        expect(result.status).toBe("failed");
        expect(calls.length).toBeLessThan(3);
    });

    it("waits for Discord's retry_after on 429, slows down, then retries", async () => {
        const { engine, calls, sleeps } = makeEngine([{ kind: "rateLimited", retryAfterMs: 7000, global: false }]);
        const result = await engine.start(job([item("1"), item("2")]));
        expect(calls).toEqual(["1", "1", "2"]);
        expect(result.rateLimitPauses).toBe(1);
        expect(sleeps[0]).toBeGreaterThanOrEqual(7000);
        expect(result.currentDelayMs).toBeGreaterThan(1000);
        expect(result.deleted).toBe(2);
    });

    it("skips not-found and forbidden messages", async () => {
        const { engine } = makeEngine([{ kind: "notFound", code: 10008 }, { kind: "forbidden", code: 50083, message: "" }]);
        const result = await engine.start(job([item("1"), item("2"), item("3")]));
        expect(result).toMatchObject({ deleted: 1, skipped: 2, processed: 3 });
    });

    it("STOP ALL halts the job and no further requests are made", async () => {
        const { engine, calls, killSwitch } = makeEngine([]);
        const p = engine.start(job(Array.from({ length: 50 }, (_, i) => item(String(i)))));
        await Promise.resolve();
        killSwitch.engage();
        const result = await p;
        expect(result.status).toBe("stopped");
        const sent = calls.length;
        await new Promise(r => setTimeout(r, 10));
        expect(calls.length).toBe(sent);
        expect(sent).toBeLessThan(50);
    });

    it("pauses and resumes", async () => {
        const { engine, calls } = makeEngine([]);
        const p = engine.start(job([item("1"), item("2"), item("3")]));
        engine.pause();
        await new Promise(r => setTimeout(r, 10));
        const whilePaused = calls.length;
        expect(engine.getProgress().status).toBe("paused");
        await new Promise(r => setTimeout(r, 10));
        expect(calls.length).toBe(whilePaused);
        engine.resume();
        const result = await p;
        expect(result.status).toBe("completed");
        expect(calls).toHaveLength(3);
    });

    it("cancels while paused", async () => {
        const { engine } = makeEngine([]);
        const p = engine.start(job([item("1"), item("2")]));
        engine.pause();
        engine.cancel();
        expect((await p).status).toBe("cancelled");
    });

    it("gives up after repeated consecutive errors", async () => {
        const err: ApiOutcome<null> = { kind: "error", status: 500, code: null, message: "boom" };
        const { engine } = makeEngine(Array.from({ length: 100 }, () => err));
        const result = await engine.start(job(Array.from({ length: 20 }, (_, i) => item(String(i)))));
        expect(result.status).toBe("failed");
        expect(result.errors).toBe(5);
    });
});
