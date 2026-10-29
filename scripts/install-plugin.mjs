#!/usr/bin/env node
// Copies the plugin into a local Vencord checkout as a userplugin.
// Usage: node scripts/install-plugin.mjs /path/to/Vencord
// Local file copy only: no network access, no downloads.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vencordDir = process.argv[2];
if (!vencordDir) {
    console.error("Usage: node scripts/install-plugin.mjs /path/to/Vencord");
    process.exit(1);
}
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vencord = resolve(vencordDir);
if (!existsSync(join(vencord, "src", "plugins")) || !existsSync(join(vencord, "package.json"))) {
    console.error(`${vencord} doesn't look like a Vencord checkout (missing src/plugins).`);
    process.exit(1);
}

const target = join(vencord, "src", "userplugins", "privacyCleanup");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// Only the plugin itself. typings/ (standalone shims) and tests/ stay out of Vencord's tree.
for (const entry of ["index.tsx", "style.css", "src"]) {
    cpSync(join(root, entry), join(target, entry), { recursive: true });
}
console.log(`Installed to ${target}`);
console.log("Next: run `pnpm build` (or `pnpm buildWeb`) in your Vencord folder, then `pnpm inject` if needed, and restart Discord.");
