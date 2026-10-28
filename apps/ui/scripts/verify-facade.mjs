#!/usr/bin/env bun
/**
 * Prove the REAL wasm module answers the extended facade contract, under Bun.
 *
 * `bun test` runs against the mock, and the mock can drift from `crates/wasm`; this script
 * builds the wasm (`bun run build:wasm` → the generated web glue in `src/wasm/`), loads it with
 * wasm-bindgen's `init` (a BufferSource is accepted — the web glue skips `fetch` for bytes), and
 * drives `CadFacade` through every call the UI's chrome and status bar depend on:
 * `sample`, `display`, `execute`, `state`, `start`, `cmdline`, `selection`, `settings`,
 * `format_point`, plus a hostile call that must answer an error, not trap.
 *
 * Usage (from apps/ui):  bun run verify:facade
 * Prints on success:     facade contract verified
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const gluePath = join(uiDir, "src", "wasm", "cadcraft_wasm.js");
const wasmPath = join(uiDir, "src", "wasm", "cadcraft_wasm_bg.wasm");

const failures = [];
/** Record a failed assertion with the value that proved it wrong. */
function check(label, ok, detail) {
  if (!ok) failures.push(`${label} — ${detail}`);
}

/** Parse a facade reply, recording a failure instead of throwing on bad JSON. */
function parse(raw, label) {
  if (typeof raw !== "string") {
    check(label, false, `the reply is not a string: ${String(raw).slice(0, 120)}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    check(label, false, `the reply is not JSON: ${raw.slice(0, 160)}`);
    return null;
  }
}

/** The drawing's entity count, or null when `state()` is unreadable. */
function entityCount(facade) {
  const st = parse(facade.state(), "state()");
  return st === null || typeof st.entityCount !== "number" ? null : st.entityCount;
}

// 1. Build the wasm the module under test is generated from.
const build = spawnSync("bun", ["run", "build:wasm"], {
  cwd: uiDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  console.error(`verify-facade: the wasm build failed (exit ${build.status ?? "signal"})`);
  process.exit(1);
}

// 2. Load the generated web glue and initialise it from bytes (no fetch in Bun).
const glue = await import(pathToFileURL(gluePath).href);
const init = glue.default;
if (typeof init !== "function") {
  console.error(`verify-facade: ${gluePath} has no default init export`);
  process.exit(1);
}
await init({ module_or_path: await Bun.file(wasmPath).arrayBuffer() });
const { CadFacade } = glue;

// 3. The contract.
const facade = CadFacade.sample();
check("CadFacade.sample()", typeof facade.display === "function", "the sample did not build a facade");

const display = parse(facade.display(), "display()");
check("display() parses", display !== null, "unreadable");
check("display() has verts", Array.isArray(display?.verts) && display.verts.length > 0, `verts: ${JSON.stringify(display?.verts ?? null).slice(0, 80)}`);

const before = entityCount(facade);
const circle = parse(facade.execute("circle", JSON.stringify({ center: [0, 0], radius: 5 })), "execute(circle)");
check("execute(circle) ok", circle?.ok === true, `reply: ${JSON.stringify(circle)}`);
const after = entityCount(facade);
check("execute(circle) grows the drawing", before !== null && after !== null && after > before, `entityCount ${before} → ${after}`);

const s1 = parse(facade.start("circle"), "start(circle)");
check("start(circle) runs the command", s1?.running === "circle", `running: ${JSON.stringify(s1?.running)}`);
check("start(circle) prompts for the centre", typeof s1?.prompt === "string" && s1.prompt.toLowerCase().includes("center"), `prompt: ${JSON.stringify(s1?.prompt)}`);
const s2 = parse(facade.cmdline("0,0"), "cmdline(0,0)");
check("cmdline(0,0) keeps the command running", s2?.running === "circle" && s2?.error === undefined, `reply: ${JSON.stringify(s2).slice(0, 160)}`);
check("cmdline(0,0) prompts for the radius", typeof s2?.prompt === "string" && s2.prompt.toLowerCase().includes("radius"), `prompt: ${JSON.stringify(s2?.prompt)}`);
const beforeCircle = entityCount(facade);
const s3 = parse(facade.cmdline("5"), "cmdline(5)");
check("cmdline(5) completes the circle", s3?.running === null && s3?.error === undefined, `reply: ${JSON.stringify(s3).slice(0, 160)}`);
const afterCircle = entityCount(facade);
check("the started circle landed", beforeCircle !== null && afterCircle !== null && afterCircle > beforeCircle, `entityCount ${beforeCircle} → ${afterCircle}`);

// A window selection is robust against the sample's exact geometry; try the point pick first.
const at = parse(facade.execute("select", JSON.stringify({ at: [2.3125, 2] })), "execute(select at)");
const byPoint = at?.ok === true && typeof at.result?.selected === "number" && at.result.selected >= 1;
if (!byPoint) {
  parse(facade.execute("select", JSON.stringify({ window: [[0.1, 0.1], [9.9, 6.4]] })), "execute(select window)");
}
const sel = parse(facade.selection(), "selection()");
check("selection() reflects the select command", typeof sel?.count === "number" && sel.count >= 1, `reply: ${JSON.stringify(sel).slice(0, 160)}`);
check("selection() handles agree with its count", Array.isArray(sel?.handles) && sel.handles.length === sel.count, `reply: ${JSON.stringify(sel).slice(0, 160)}`);

const grid0 = parse(facade.settings(), "settings()");
check("settings() answers booleans", typeof grid0?.grid === "boolean" && typeof grid0?.snap === "boolean", `reply: ${JSON.stringify(grid0).slice(0, 160)}`);
parse(facade.execute("grid", JSON.stringify({ on: !grid0.grid })), "execute(grid flip)");
const grid1 = parse(facade.settings(), "settings() after grid flip");
check("settings() flips with execute(grid)", grid1?.grid === !grid0?.grid, `grid ${grid0?.grid} → ${grid1?.grid}`);
parse(facade.execute("grid", JSON.stringify({ on: true })), "execute(grid on)");
const grid2 = parse(facade.settings(), "settings() after grid on");
check("settings() reaches grid on", grid2?.grid === true, `reply: ${JSON.stringify(grid2).slice(0, 160)}`);

const fp = parse(facade.formatPoint(6, 4), "formatPoint(6,4)");
check("format_point(6,4) formats in drawing units", typeof fp?.text === "string" && fp.text.includes("6.0000"), `reply: ${JSON.stringify(fp).slice(0, 160)}`);

let hostile;
try {
  hostile = parse(facade.execute("", "{}"), "execute(hostile)");
} catch (e) {
  check("execute('') answers without trapping", false, `it threw: ${e instanceof Error ? e.message : String(e)}`);
}
check("execute('') replies an error", hostile?.ok === false && typeof hostile.error === "string", `reply: ${JSON.stringify(hostile).slice(0, 160)}`);

// The facade still works after the hostile call.
const revived = parse(facade.display(), "display() after the hostile call");
check("the facade still answers after the hostile call", Array.isArray(revived?.verts), `reply: ${JSON.stringify(revived).slice(0, 120)}`);

// 4. Verdict.
if (failures.length > 0) {
  console.error("verify-facade: FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("facade contract verified");
