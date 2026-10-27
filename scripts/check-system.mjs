#!/usr/bin/env node
// The design-system drift check lives in Rust: `cargo xtask system-check` (xtask/src/system_check.rs),
// beside the `layers` and `assets` gates. This file only forwards to it, so tools that look for
// `scripts/check-system.mjs` — `scripts/gen-docs.mjs --list-rules` and `--list-blind-spots` — read
// the same rules the gate enforces.
import { spawnSync } from "node:child_process";

const r = spawnSync("cargo", ["xtask", "system-check", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 2);
