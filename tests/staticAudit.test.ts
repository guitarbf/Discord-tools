import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name: string) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
    });
}

const files = [...sources(join(ROOT, "src")), join(ROOT, "index.tsx"), join(ROOT, "style.css")]
    .map(path => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));

const FORBIDDEN: Array<[string, RegExp]> = [
    ["fetch()", /\bfetch\s*\(/],
    ["XMLHttpRequest usage", /new\s+XMLHttpRequest|XMLHttpRequest\.prototype\.\w+\s*=/],
    ["WebSocket", /\bWebSocket\b/],
    ["EventSource", /\bEventSource\b/],
    ["sendBeacon", /sendBeacon/],
    ["eval", /\beval\s*\(/],
    ["new Function", /new\s+Function\s*\(/],
    ["dynamic import", /\bimport\s*\(/],
    ["remote URL", /https?:\/\/(?!example\.)[a-z0-9.-]+\.[a-z]{2,}/i],
    ["CSS @import", /@import/],
    ["localStorage token access", /localStorage\s*\.\s*getItem\s*\(\s*["']token/],
    ["getToken", /getToken\s*\(/],
    ["Authorization header set", /["']Authorization["']\s*:/],
    ["document.cookie", /document\.cookie/],
    ["script injection", /createElement\s*\(\s*["']script/]
];

describe("static privacy audit", () => {
    for (const [label, pattern] of FORBIDDEN) {
        it(`contains no ${label}`, () => {
            expect(files.filter(f => pattern.test(f.text)).map(f => f.path)).toEqual([]);
        });
    }

    it("only the compatibility layer and entry point import Discord/Vencord internals", () => {
        const importers = files.filter(f => /from\s+["']@(webpack|plugins|utils|api|components)\//.test(f.text)).map(f => f.path).sort();
        expect(importers).toEqual(["index.tsx", join("src", "discord", "compat.ts")].sort());
    });

    it("no console.log calls (only sanitized logger output)", () => {
        expect(files.filter(f => /console\.(log|info|debug)\s*\(/.test(f.text)).map(f => f.path)).toEqual([]);
    });
});
