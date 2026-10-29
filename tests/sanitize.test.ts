import { describe, expect, it } from "vitest";
import { Logger } from "../src/security/logger";
import { redactString, sanitizeError, sanitizeValue } from "../src/security/sanitize";
import { findSensitiveData } from "../src/security/sensitive";

const FAKE_TOKEN = "MTExMTExMTExMTExMTExMTEx.GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789AB";

describe("sanitization", () => {
    it("redacts token-shaped strings, auth headers, emails and query strings", () => {
        const out = redactString(`token ${FAKE_TOKEN} Authorization: abc123 Bearer abcdefghijklmnop mail me@example.com https://x.test/a?b=c`);
        expect(out).not.toContain(FAKE_TOKEN);
        expect(out).not.toContain("abc123");
        expect(out).not.toContain("abcdefghijklmnop");
        expect(out).not.toContain("me@example.com");
        expect(out).not.toContain("b=c");
    });

    it("redacts ids only when asked", () => {
        expect(redactString("id 123456789012345678")).toContain("123456789012345678");
        expect(redactString("id 123456789012345678", { redactIds: true })).toBe("id [id]");
    });

    it("drops sensitive keys and content keys", () => {
        const out = sanitizeValue({ authorization: "x", headers: { a: 1 }, password: "p", content: "hi", author: "kept" }) as Record<string, unknown>;
        expect(out.authorization).toBe("[redacted]");
        expect(out.headers).toBe("[redacted]");
        expect(out.password).toBe("[redacted]");
        expect(out.content).toBe("[content hidden]");
        expect(out.author).toBe("kept");
        expect((sanitizeValue({ content: "hi" }, { allowContent: true }) as Record<string, unknown>).content).toBe("hi");
    });

    it("handles cycles", () => {
        const a: Record<string, unknown> = { name: "a" };
        a.self = a;
        expect((sanitizeValue(a) as Record<string, unknown>).self).toBe("[circular]");
    });

    it("reduces errors to safe fields", () => {
        const err = sanitizeError({ status: 403, body: { code: 50013, message: "Missing permissions" }, headers: { authorization: FAKE_TOKEN } });
        expect(err).toEqual({ name: "Error", message: "Missing permissions", status: 403, code: 50013 });
    });

    it("detects credential-like data", () => {
        expect(findSensitiveData({ a: [FAKE_TOKEN] })).toHaveLength(1);
        expect(findSensitiveData({ token: "x" })[0]?.kind).toBe("sensitiveKey");
        expect(findSensitiveData({ name: "fine", author: "fine" })).toHaveLength(0);
    });
});

describe("logger", () => {
    const sink = { warn: () => { }, error: () => { } };

    it("records nothing unless debug is enabled", () => {
        const logger = new Logger(sink);
        logger.debug("x");
        expect(logger.entries).toHaveLength(0);
    });

    it("hides content unless content logging is on, and wipes on disable", () => {
        const logger = new Logger(sink);
        logger.enableDebug(60_000, false);
        logger.debug("m", { content: "secret" });
        expect(JSON.stringify(logger.entries)).not.toContain("secret");
        logger.disableDebug();
        logger.enableDebug(60_000, true);
        logger.debug("m", { content: "visible" });
        expect(JSON.stringify(logger.entries)).toContain("visible");
        logger.disableDebug();
        expect(logger.entries).toHaveLength(0);
        logger.dispose();
    });

    it("expires debug mode", () => {
        let now = 0;
        const logger = new Logger(sink, () => now);
        logger.enableDebug(60_000, true);
        logger.debug("a");
        now = 61_000;
        logger.debug("b");
        expect(logger.debugState.enabled).toBe(false);
        expect(logger.entries).toHaveLength(0);
        logger.dispose();
    });

    it("never writes tokens to the console", () => {
        const lines: unknown[] = [];
        const logger = new Logger({ warn: (...a) => lines.push(a), error: (...a) => lines.push(a) });
        logger.error("failed", new Error(`bad ${FAKE_TOKEN}`));
        expect(JSON.stringify(lines)).not.toContain(FAKE_TOKEN);
    });
});
