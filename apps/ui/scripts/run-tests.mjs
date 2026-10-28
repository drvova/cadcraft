#!/usr/bin/env bun
/**
 * Run a named set of UI test files and prove every one of them actually ran.
 *
 * Why this exists: `bun test a.test.ts b.test.ts c.test.ts` exits 0 and prints "0 fail" even
 * when b and c do not exist — the unmatched filters are only a warning. A gate written as
 * `bun test <files>` therefore has no teeth until every file exists, and none at all if one is
 * later deleted. This runner asserts each file exists, runs them together, and requires bun's
 * own summary to report that many files with at least one test and no failures.
 *
 * Usage (from apps/ui):  bun scripts/run-tests.mjs src/a.test.ts src/b.test.ts
 * Prints on success:     ui tests passed: 2 files, 37 tests
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun scripts/run-tests.mjs <test-file> [more-test-files...]");
  process.exit(2);
}

const missing = files.filter((f) => !existsSync(f));
if (missing.length > 0) {
  for (const f of missing) console.error(`missing test file: ${f}`);
  process.exit(1);
}

const run = spawnSync("bun", ["test", ...files], { encoding: "utf8" });
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
process.stdout.write(output);
if (run.status !== 0) {
  console.error(`bun test exited with ${run.status === null ? "no status" : run.status}`);
  process.exit(1);
}

const ran = /Ran (\d+) tests? across (\d+) files?/.exec(output);
if (ran === null) {
  console.error("could not read bun's summary line (Ran N tests across M files)");
  process.exit(1);
}
const tests = Number.parseInt(ran[1] ?? "0", 10);
const ranFiles = Number.parseInt(ran[2] ?? "0", 10);
if (tests < 1) {
  console.error(`no tests ran (expected files: ${files.length})`);
  process.exit(1);
}
if (ranFiles !== files.length) {
  console.error(`expected ${files.length} test file(s), bun ran ${ranFiles} — one of the named files did not run`);
  process.exit(1);
}
if (!/\b0 fail\b/.test(output)) {
  console.error("bun did not report 0 fail");
  process.exit(1);
}

console.log(`ui tests passed: ${ranFiles} files, ${tests} tests`);
