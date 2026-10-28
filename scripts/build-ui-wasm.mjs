#!/usr/bin/env node
/**
 * Build the UI's wasm module: `crates/wasm` compiled to wasm32-unknown-unknown and wrapped by
 * wasm-bindgen into `apps/ui/src/wasm/` (the module `src/wasm-loader.ts` imports).
 *
 * Run from anywhere; paths are resolved from this file's location:
 *   bun scripts/build-ui-wasm.mjs        (or: bun run build:wasm, from apps/ui)
 *
 * When `crates/wasm` does not build yet, this script fails loudly with cargo's own output — the
 * UI itself still runs on its mock facade (see apps/ui/src/facade.ts), so a red build here is
 * expected while the facade crate is in flight.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps", "ui", "src", "wasm");
const wasmFile = join(root, "target", "wasm32-unknown-unknown", "release", "cadcraft_wasm.wasm");

function run(label, command, args) {
  process.stdout.write(`\n[build-ui-wasm] ${label}\n  $ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error !== undefined) {
    process.stderr.write(`\n[build-ui-wasm] could not run \`${command}\`: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(
      `\n[build-ui-wasm] ${label} failed (exit ${result.status ?? "signal"}).\n` +
        `The UI still runs on its mock facade (apps/ui, ?mock=1); the real facade needs this step green.\n`,
    );
    process.exit(result.status ?? 1);
  }
}

run("1/2 cargo build (cadcraft-wasm → wasm32)", "cargo", [
  "build",
  "-p",
  "cadcraft-wasm",
  "--target",
  "wasm32-unknown-unknown",
  "--release",
]);

if (!existsSync(wasmFile)) {
  process.stderr.write(`\n[build-ui-wasm] cargo succeeded but ${wasmFile} is missing; check the crate's name and lib target.\n`);
  process.exit(1);
}

run("2/2 wasm-bindgen (--target web → apps/ui/src/wasm)", "wasm-bindgen", ["--target", "web", "--out-dir", outDir, wasmFile]);

const produced = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith(".js") || f.endsWith(".wasm")).sort() : [];
if (produced.length === 0) {
  process.stderr.write(`\n[build-ui-wasm] wasm-bindgen produced nothing in ${outDir}.\n`);
  process.exit(1);
}
process.stdout.write(`\n[build-ui-wasm] done: ${produced.join(", ")}\n`);

// A stale glue file from a previous crate rename would keep the loader picking the wrong module.
const strays = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith(".js") && !f.startsWith("cadcraft_wasm")) : [];
for (const stray of strays) {
  rmSync(join(outDir, stray), { force: true });
  process.stdout.write(`[build-ui-wasm] removed stale glue file ${stray}\n`);
}
