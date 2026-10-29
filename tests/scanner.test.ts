import { describe, expect, it } from "vitest";
import type { ApiOutcome, SearchApi, SearchPage } from "../src/discord/api";
import { scanForMatches } from "../src/cleanup/scanner";
import { EMPTY_FILTERS, type CleanupPlan } from "../src/cleanup/types";
import { compareSnowflakes } from "../src/discord/snowflake";
import type { RawMessage } from "../src/discord/types";
import { CHANNEL, instantSleep, makeMessage, ME, OTHER, silentLogger } from "./helpers";

const plan = (patch: Partial<CleanupPlan> = {}): CleanupPlan => ({
    target: { kind: "channel", channelId: CHANNEL, guildId: null },
    filters: EMPTY_FILTERS,
    range: { afterMs: null, beforeMs: null },
    ...patch
});

function fakeSearch(all: RawMessage[], first: Array<ApiOutcome<SearchPage>> = []): SearchApi & { queries: Array<Record<string, string | string[]>>; } {
    const sorted = [...all].sort((a, b) => compareSnowflakes(b.id, a.id));
    const queries: Array<Record<string, string | string[]>> = [];
    return {
        queries,
        async search(_path, query) {
            queries.push(query);
            const pre = first.shift();
            if (pre) return pre;
            const max = typeof query.max_id === "string" ? query.max_id : null;
            const mine = sorted.filter(m => m.author.id === query.author_id && (max === null || compareSnowflakes(m.id, max) < 0));
            return { kind: "ok", status: 200, body: { totalResults: sorted.filter(m => m.author.id === query.author_id).length, hits: mine.slice(0, 25) } };
        },
        async history() {
            return { kind: "ok", status: 200, body: [] };
        }
    };
}

const run = (api: SearchApi, p = plan()) => scanForMatches({
    api, userId: ME, plan: p, searchDelayMs: 2000, signal: new AbortController().signal, logger: silentLogger, keepSnippets: true, sleep: instantSleep
});

describe("scanner", () => {
    it("pages through all results and counts exactly", async () => {
        const msgs = Array.from({ length: 80 }, (_, i) => makeMessage({ at: Date.UTC(2024, 0, 1) + i * 60000 }));
        const api = fakeSearch(msgs);
        const result = await run(api);
        expect(result.items).toHaveLength(80);
        expect(new Set(result.items.map(i => i.id)).size).toBe(80);
        expect(api.queries.every(q => q.author_id === ME)).toBe(true);
    });

    it("never includes other users' messages even if the API returns them", async () => {
        const api: SearchApi = {
            async search() {
                return { kind: "ok", status: 200, body: { totalResults: 2, hits: [makeMessage({ author: { id: OTHER } }), makeMessage()] } };
            },
            async history() { return { kind: "ok", status: 200, body: [] }; }
        };
        let calls = 0;
        const wrapped: SearchApi = { ...api, search: async (p, q) => (calls++ === 0 ? api.search(p, q) : { kind: "ok", status: 200, body: { totalResults: 2, hits: [] } }) };
        const result = await run(wrapped);
        expect(result.items.map(i => i.authorId)).toEqual([ME]);
    });

    it("excludes system messages and applies local filters", async () => {
        const msgs = [makeMessage({ type: 7 }), makeMessage({ content: "keep me" }), makeMessage({ content: "delete me" })];
        const result = await run(fakeSearch(msgs), plan({ filters: { ...EMPTY_FILTERS, notContains: ["keep"] } }));
        expect(result.items).toHaveLength(1);
        expect(result.excludedSystem).toBe(1);
        expect(result.excludedByFilters).toBe(1);
    });

    it("waits through indexing and rate limits", async () => {
        const api = fakeSearch([makeMessage()], [
            { kind: "indexing", retryAfterMs: 1000 },
            { kind: "rateLimited", retryAfterMs: 3000, global: false }
        ]);
        const result = await run(api);
        expect(result.items).toHaveLength(1);
        expect(result.indexingWaits).toBe(1);
        expect(result.rateLimitPauses).toBe(1);
    });

    it("falls back to history when search is forbidden, keeping only own messages", async () => {
        const page = [makeMessage({ author: { id: OTHER } }), makeMessage(), makeMessage()];
        const api: SearchApi = {
            async search() { return { kind: "forbidden", code: 50001, message: "Missing access" }; },
            async history(_c, before) { return { kind: "ok", status: 200, body: before ? [] : page }; }
        };
        const result = await run(api);
        expect(result.strategy).toBe("history");
        expect(result.items).toHaveLength(2);
        expect(result.items.every(i => i.authorId === ME)).toBe(true);
    });

    it("stops when aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(scanForMatches({
            api: fakeSearch([makeMessage()]), userId: ME, plan: plan(), searchDelayMs: 0, signal: controller.signal, logger: silentLogger, keepSnippets: false, sleep: instantSleep
        })).rejects.toThrow();
    });
});
