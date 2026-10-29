import { describe, expect, it } from "vitest";
import { containsKeyword, describeFilters, matchesFilters, parseKeywords } from "../src/cleanup/filters";
import { resolveDateSpec } from "../src/cleanup/presets";
import { EMPTY_FILTERS } from "../src/cleanup/types";
import { snowflakeFromTimestamp, timestampFromSnowflake } from "../src/discord/snowflake";
import { makeMessage } from "./helpers";

const ANY = { afterMs: null, beforeMs: null };

describe("filters", () => {
    it("parses keywords", () => {
        expect(parseKeywords(" a, b,\nA , ,c")).toEqual(["a", "b", "c"]);
    });

    it("matches substring and whole words", () => {
        expect(containsKeyword("concatenate", "cat", "substring")).toBe(true);
        expect(containsKeyword("concatenate", "cat", "word")).toBe(false);
        expect(containsKeyword("my cat!", "cat", "word")).toBe(true);
        expect(containsKeyword("a (b) c", "(b)", "word")).toBe(true);
    });

    it("applies contains / not contains", () => {
        const m = makeMessage({ content: "Secret plan for Friday" });
        expect(matchesFilters(m, { ...EMPTY_FILTERS, contains: ["plan"] }, ANY)).toBe(true);
        expect(matchesFilters(m, { ...EMPTY_FILTERS, contains: ["nope"] }, ANY)).toBe(false);
        expect(matchesFilters(m, { ...EMPTY_FILTERS, notContains: ["friday"] }, ANY)).toBe(false);
    });

    it("applies tri-state filters", () => {
        const withImage = makeMessage({ attachments: [{ filename: "a.png" }] });
        const withLink = makeMessage({ content: "see https://example.com" });
        const reply = makeMessage({ type: 19 });
        expect(matchesFilters(withImage, { ...EMPTY_FILTERS, images: "only" }, ANY)).toBe(true);
        expect(matchesFilters(withImage, { ...EMPTY_FILTERS, attachments: "exclude" }, ANY)).toBe(false);
        expect(matchesFilters(withLink, { ...EMPTY_FILTERS, links: "only" }, ANY)).toBe(true);
        expect(matchesFilters(withLink, { ...EMPTY_FILTERS, links: "exclude" }, ANY)).toBe(false);
        expect(matchesFilters(reply, { ...EMPTY_FILTERS, replies: "exclude" }, ANY)).toBe(false);
        expect(matchesFilters(makeMessage(), { ...EMPTY_FILTERS, replies: "only" }, ANY)).toBe(false);
    });

    it("applies date bounds (after inclusive, before exclusive)", () => {
        const at = Date.UTC(2024, 5, 1);
        const m = makeMessage({ at });
        expect(matchesFilters(m, EMPTY_FILTERS, { afterMs: at, beforeMs: null })).toBe(true);
        expect(matchesFilters(m, EMPTY_FILTERS, { afterMs: null, beforeMs: at })).toBe(false);
        expect(matchesFilters(m, EMPTY_FILTERS, { afterMs: at - 1, beforeMs: at + 1 })).toBe(true);
    });

    it("resolves date specs", () => {
        const between = resolveDateSpec({ kind: "between", from: "2024-01-01", to: "2024-01-31" });
        expect(new Date(between.afterMs!).getDate()).toBe(1);
        expect(new Date(between.beforeMs!).getMonth()).toBe(1);
        expect(() => resolveDateSpec({ kind: "between", from: "2024-02-01", to: "2024-01-01" })).toThrow();
        const now = Date.UTC(2024, 6, 1);
        expect(resolveDateSpec({ kind: "olderThanDays", days: 30 }, now).beforeMs).toBe(now - 30 * 86400000);
    });

    it("hides keywords in descriptions unless asked", () => {
        const lines = describeFilters({ ...EMPTY_FILTERS, contains: ["private name"] }, ANY, { includeKeywords: false });
        expect(lines.join(" ")).not.toContain("private name");
        expect(lines.join(" ")).toContain("1 keyword");
    });

    it("round-trips snowflake timestamps", () => {
        const at = Date.UTC(2023, 3, 3, 3, 3, 3);
        expect(timestampFromSnowflake(snowflakeFromTimestamp(at))).toBe(at);
    });
});
