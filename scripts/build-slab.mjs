#!/usr/bin/env bun
/**
 * Build the Slab toolchain the interface's Slab shell runs on, from source at the commit
 * `third_party/slab/SLAB.lock` pins, and compile the interface's Slab documents with it.
 *
 * Slab (https://github.com/stencil-hq/slab, MIT) is pre-alpha and its npm packages lag its
 * repository, so nothing of it is a package dependency and nothing of it is committed here: this
 * script fetches the pinned commit into a scratch directory, lays the patch series of
 * `third_party/slab/patches` over it (the same series the Rust side builds on:
 * third_party/slab/README.md), builds, without Slab's bundled fonts (`--no-default-features`),
 *
 *   slab-runtime.js              the web driver (clients/web), bundled
 *   wasm/slab_kernel_bg.wasm     the kernel (crates/slab-kernel-wasm)
 *   compiler/slab_wasm{.js,_bg.wasm}   the compiler for a browser or Bun (crates/slab-wasm)
 *   bin/slab                     the command line (crates/slab-cli), for `slab check` and `slab fmt`
 *
 * and copies them into `apps/ui/src/slab-vendor/` (git-ignored). Then it compiles
 * `apps/ui/slab/*.slab` into web components beside them. The interface builds and runs without
 * any of this: the Slab shell is behind `?shell=slab` and says so in one line when the artifacts
 * are absent (apps/ui/src/slab/loader.ts).
 *
 * No font is in any artifact: the page measures its own font and registers the metrics
 * (apps/ui/src/slab/fonts.ts), and the build fails if a face's name table is found in one.
 *
 * `apps/ui/slab.lock.json` records what was built: the commit and patches it was built from
 * (copied from SLAB.lock, which is the pin) and the artifacts' checksums.
 *
 *   bun scripts/build-slab.mjs                 build the toolchain, compile the documents
 *   bun scripts/build-slab.mjs --docs          compile the documents only (no Rust: uses the vendored compiler)
 *   bun scripts/build-slab.mjs --verify        compare the vendored artifacts with the lock; exit 1 when they differ
 *   bun scripts/build-slab.mjs --update-lock   after a build: write what was built into slab.lock.json
 *   bun scripts/build-slab.mjs --commit HASH   try another commit (the pin itself is SLAB.lock: third_party/slab/README.md)
 *   --work DIR   the scratch directory (default: $SLAB_BUILD_DIR or <tmp>/cadcraft-slab-build; ~1.6 GB)
 *   --quiet      print only what went wrong
 *
 * Needs: git, cargo with rustup (upstream pins its own nightly in rust-toolchain.toml), bun.
 * wasm-bindgen-cli at the version upstream's Cargo.lock names is installed into the scratch
 * directory when the one on PATH is another version; the one on PATH is never replaced.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareArtifacts, describeReport, formatLock, matchesLock, parseLock, parsePin } from "../apps/ui/src/slab/lock.ts";
import { slabTokenSource } from "../apps/ui/src/slab/tokens.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "apps", "ui");
const vendor = join(ui, "src", "slab-vendor");
const docsDir = join(ui, "slab");
const lockPath = join(ui, "slab.lock.json");
/** The shared pin and patch series (third_party/slab/README.md). */
const pinDir = join(root, "third_party", "slab");
const pinPath = join(pinDir, "SLAB.lock");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const quiet = flag("--quiet");
const say = (text) => {
  if (!quiet) process.stdout.write(`[build-slab] ${text}\n`);
};
const fail = (text) => {
  process.stderr.write(`[build-slab] ${text}\n`);
  process.exit(1);
};

/** The artifacts the lock pins, by their path under the vendor directory. The command line is a
 *  platform binary and the compiled documents follow the sources, so neither is pinned. */
const PINNED = ["slab-runtime.js", "wasm/slab_kernel_bg.wasm", "compiler/slab_wasm.js", "compiler/slab_wasm_bg.wasm"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readLock() {
  if (!existsSync(lockPath)) fail(`${lockPath} is missing`);
  const parsed = parseLock(readFileSync(lockPath, "utf8"));
  if (!parsed.ok) fail(parsed.error);
  return parsed.lock;
}

function run(label, command, commandArgs, cwd, env) {
  say(`${label}\n  $ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { cwd, env: { ...process.env, ...env }, stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit" });
  if (result.error !== undefined) fail(`could not run \`${command}\`: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? "signal"}). The interface still builds and runs without Slab.`);
}

function capture(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function found() {
  const out = {};
  for (const path of PINNED) {
    const file = join(vendor, path);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    out[path] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return out;
}

/** The pin: the upstream repository, the commit, and the patch series in order, each patch
 *  checked against the checksum SLAB.lock gives it. */
function readPin() {
  if (!existsSync(pinPath)) fail(`${pinPath} is missing`);
  const parsed = parsePin(readFileSync(pinPath, "utf8"));
  if (!parsed.ok) fail(parsed.error);
  for (const patch of parsed.pin.patches) {
    const file = join(pinDir, "patches", patch.file);
    if (!existsSync(file)) fail(`third_party/slab/patches/${patch.file} is missing`);
    if (sha256(readFileSync(file)) !== patch.sha256) fail(`third_party/slab/patches/${patch.file} is not the patch SLAB.lock pins. Review it, then update SLAB.lock.`);
  }
  const strays = readdirSync(join(pinDir, "patches")).filter((name) => name.endsWith(".patch") && !parsed.pin.patches.some((p) => p.file === name));
  if (strays.length > 0) fail(`third_party/slab/patches/${strays[0]} is not in SLAB.lock`);
  return parsed.pin;
}

/** The names a font file carries in its name table, as they sit in a binary: Latin-1 and
 *  UTF-16BE. None may be in an artifact (the faces Slab would bundle by default). */
const FACE_NAMES = ["Inter", "JetBrains Mono", "JetBrainsMono"];
function fontNamesIn(bytes) {
  const found = [];
  for (const name of FACE_NAMES) {
    const wide = Buffer.from(name, "utf16le").swap16();
    // A font's name table holds the family beside a style and a version: plain prose that
    // merely mentions a face (a comment, a diagnostic) is not a font. The copyright string of
    // each bundled face is the mark that cannot be there without the file.
    if (bytes.includes(wide)) found.push(`${name} (UTF-16 name record)`);
  }
  for (const mark of ["The Inter Project Authors", "The JetBrains Mono Project Authors"]) {
    if (bytes.includes(Buffer.from(mark, "latin1")) || bytes.includes(Buffer.from(mark, "utf16le").swap16())) found.push(mark);
  }
  return found;
}

/** The version of a crate upstream's Cargo.lock resolves. */
function lockedVersion(cargoLock, crate) {
  const at = cargoLock.indexOf(`name = "${crate}"\n`);
  if (at < 0) return null;
  const m = /version = "([^"]+)"/.exec(cargoLock.slice(at, at + 200));
  return m === null ? null : m[1];
}

function buildToolchain(lock, pin) {
  const commit = option("--commit") ?? pin.commit;
  if (!/^[0-9a-f]{40}$/.test(commit)) fail("--commit takes a full 40-digit commit hash");
  const work = resolve(option("--work") ?? process.env["SLAB_BUILD_DIR"] ?? join(tmpdir(), "cadcraft-slab-build"));
  const src = join(work, "slab");
  const target = join(work, "target");
  const env = { CARGO_TARGET_DIR: target, CARGO_PROFILE_DEV_DEBUG: "0" };
  mkdirSync(work, { recursive: true });

  if (!existsSync(join(src, ".git"))) run("fetch the repository", "git", ["clone", "--quiet", pin.repo, src], work);
  if (capture("git", ["cat-file", "-t", commit], src) !== "commit") run("fetch the pinned commit", "git", ["fetch", "--quiet", "origin", commit], src);
  // The tree is put back to the commit exactly, so a patch is never laid over itself.
  run(`check out ${commit}`, "git", ["reset", "--quiet", "--hard", commit], src);
  // Build products of an earlier run (the kernel's bindings, the bundled runtime) go too: the
  // compiler would embed them if they were there.
  run("clean the tree", "git", ["clean", "--quiet", "-fdx", "-e", "node_modules"], src);
  const laid = pin.patches;
  // The record of the last reviewed build must be of this pin, unless this run is the one that
  // writes a new record.
  if (!flag("--update-lock") && option("--commit") === undefined) {
    const same = lock.commit === pin.commit && lock.patches.length === laid.length && laid.every((p, i) => lock.patches[i]?.file === p.file && lock.patches[i]?.sha256 === p.sha256);
    if (!same) fail("apps/ui/slab.lock.json records a build of another commit or patch series than third_party/slab/SLAB.lock pins. Build with --update-lock, look at the shell, and commit the new record.");
  }
  for (const patch of laid) run(`apply ${patch.file}`, "git", ["apply", "--whitespace=nowarn", join(pinDir, "patches", patch.file)], src);

  const bindgenVersion = lockedVersion(readFileSync(join(src, "Cargo.lock"), "utf8"), "wasm-bindgen");
  if (bindgenVersion === null) fail("upstream's Cargo.lock names no wasm-bindgen");
  let bindgen = "wasm-bindgen";
  if (!(capture("wasm-bindgen", ["--version"], work) ?? "").split(/\s+/).includes(bindgenVersion)) {
    const tools = join(work, "tools");
    bindgen = join(tools, "bin", process.platform === "win32" ? "wasm-bindgen.exe" : "wasm-bindgen");
    if (!(capture(bindgen, ["--version"], work) ?? "").split(/\s+/).includes(bindgenVersion)) {
      run(`install wasm-bindgen-cli ${bindgenVersion} into the scratch directory`, "cargo", ["install", "wasm-bindgen-cli", "--version", bindgenVersion, "--locked", "--root", tools], src, env);
    }
  }

  const wasmDir = join(target, "wasm32-unknown-unknown");
  // `--no-default-features` leaves out Slab's bundled faces (the series' `bundled-fonts`
  // feature) and, for the compiler, the embedded copy of the runtime and the kernel (`wc-embed`):
  // the interface loads the ones built here.
  run("1/6 the kernel (wasm32)", "cargo", ["build", "-p", "slab-kernel-wasm", "--no-default-features", "--profile", "wasm-release", "--target", "wasm32-unknown-unknown"], src, env);
  rmSync(join(src, "clients", "web", "wasm"), { recursive: true, force: true });
  run("2/6 the kernel's bindings", bindgen, ["--target", "web", "--out-name", "slab_kernel", "--out-dir", join(src, "clients", "web", "wasm"), join(wasmDir, "wasm-release", "slab_kernel_wasm.wasm")], src);
  run("3/6 the web runtime", "bun", ["install", "--frozen-lockfile"], src);
  run("3/6 the web runtime", "bun", ["scripts/build-web-runtime.ts"], src);
  run("4/6 the compiler (wasm32)", "cargo", ["build", "--release", "--no-default-features", "--target", "wasm32-unknown-unknown", "-p", "slab-wasm"], src, env);
  const compilerOut = join(work, "compiler");
  rmSync(compilerOut, { recursive: true, force: true });
  run("5/6 the compiler's bindings", bindgen, ["--target", "web", "--out-dir", compilerOut, join(wasmDir, "release", "slab_wasm.wasm")], src);
  run("6/6 the command line", "cargo", ["build", "--release", "--no-default-features", "-p", "slab-cli"], src, env);

  rmSync(vendor, { recursive: true, force: true });
  for (const dir of ["wasm", "compiler", "bin", "licenses"]) mkdirSync(join(vendor, dir), { recursive: true });
  const exe = process.platform === "win32" ? "slab.exe" : "slab";
  const copies = [
    [join(src, "gen", "web-runtime", "slab-runtime.js"), "slab-runtime.js"],
    [join(src, "clients", "web", "wasm", "slab_kernel_bg.wasm"), "wasm/slab_kernel_bg.wasm"],
    [join(compilerOut, "slab_wasm.js"), "compiler/slab_wasm.js"],
    [join(compilerOut, "slab_wasm_bg.wasm"), "compiler/slab_wasm_bg.wasm"],
    [join(target, "release", exe), `bin/${exe}`],
    // Slab's licence travels with the artifacts. No font is in them, so no font licence does.
    [join(src, "LICENSE"), "licenses/LICENSE-slab-MIT.txt"],
  ];
  for (const [from, to] of copies) {
    if (!existsSync(from)) fail(`the build did not produce ${from}`);
    // Proof, on every build: nothing of a bundled face is in what will be vendored.
    const marks = fontNamesIn(readFileSync(from));
    if (marks.length > 0) fail(`${to} contains font data (${marks.join(", ")}): the build was not font-less`);
    copyFileSync(from, join(vendor, to));
  }
  chmodSync(join(vendor, "bin", exe), 0o755);

  const versions = {
    slab: capture(join(vendor, "bin", exe), ["--version"], work) ?? "unknown",
    "wasm-bindgen": bindgenVersion,
    rust: (/channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(src, "rust-toolchain.toml"), "utf8")) ?? [])[1] ?? "unknown",
  };
  return { commit, patches: laid, versions };
}

/** A compiler diagnostic as one line: `file:line: level[code]: message`, in the compiler's own wording. */
function diagnosticLine(d) {
  if (d !== null && typeof d === "object" && typeof d.formatted === "string" && d.formatted !== "") return d.formatted;
  return d !== null && typeof d === "object" && typeof d.msg === "string" ? d.msg : String(d);
}

/** Compile `slab/*.slab` into web components in the vendor directory, with the vendored compiler. */
async function compileDocs() {
  const glue = join(vendor, "compiler", "slab_wasm.js");
  const wasm = join(vendor, "compiler", "slab_wasm_bg.wasm");
  if (!existsSync(glue) || !existsSync(wasm)) fail("the Slab compiler is not built: run `bun run build:slab` (apps/ui) first. The interface still builds and runs without it.");
  const compiler = await import(pathToFileURL(glue).href);
  compiler.initSync({ module: readFileSync(wasm) });

  // The interface's tokens as a Slab module, written where the documents import it from.
  mkdirSync(join(docsDir, "gen"), { recursive: true });
  const tokens = slabTokenSource(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
  writeFileSync(join(docsDir, "gen", "tokens.slab"), tokens);

  const names = readdirSync(docsDir).filter((name) => name.endsWith(".slab")).sort();
  const sources = { "gen/tokens.slab": tokens };
  for (const name of names) sources[name] = readFileSync(join(docsDir, name), "utf8");

  const manifest = { compiler: compiler.compiler_version(), documents: {} };
  let errors = 0;
  for (const name of names) {
    const stem = name.slice(0, -".slab".length);
    let reply;
    try {
      reply = JSON.parse(compiler.gen_wc_with_sources(sources[name], JSON.stringify({ tag: `cadcraft-${stem}`, stem, sourceName: `slab/${name}` }), "{}", JSON.stringify(sources)));
    } catch (thrown) {
      // A document that does not compile throws its diagnostics as JSON text.
      errors += 1;
      let list = [];
      try {
        list = JSON.parse(String(thrown));
      } catch {
        list = [{ message: String(thrown) }];
      }
      for (const d of Array.isArray(list) ? list : []) process.stderr.write(`${diagnosticLine(d)}\n`);
      continue;
    }
    for (const d of reply.diagnostics ?? []) process.stderr.write(`${diagnosticLine(d)}\n`);
    const written = [];
    for (const file of reply.files ?? []) {
      // The runtime and the kernel are the vendored ones; the typings are not used (src/slab/types.ts).
      if (typeof file.name !== "string" || !/^[a-z0-9.-]+\.(js|slir)$/.test(file.name) || file.name === "slab-runtime.js") continue;
      writeFileSync(join(vendor, file.name), typeof file.text === "string" ? file.text : Buffer.from(file.b64 ?? "", "base64"));
      written.push(file.name);
    }
    manifest.documents[name] = { sha256: sha256(sources[name]), files: written.sort() };
    say(`slab/${name} → ${written.sort().join(", ")}`);
  }
  manifest.tokens = sha256(tokens);
  writeFileSync(join(vendor, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (errors > 0) fail(`${errors} document${errors === 1 ? "" : "s"} did not compile`);
}

const lock = readLock();
const pin = readPin();

if (flag("--verify")) {
  const pinned = lock.commit === pin.commit && lock.patches.length === pin.patches.length && pin.patches.every((p, i) => lock.patches[i]?.file === p.file && lock.patches[i]?.sha256 === p.sha256);
  if (!pinned) {
    process.stdout.write("[build-slab] slab.lock.json records another commit or patch series than third_party/slab/SLAB.lock pins\n");
    process.exit(1);
  }
  const report = compareArtifacts(lock, found());
  process.stdout.write(`[build-slab] ${describeReport(report)}\n`);
  process.exit(matchesLock(report) ? 0 : 1);
}

if (flag("--docs")) {
  await compileDocs();
  process.exit(0);
}

const built = buildToolchain(lock, pin);
await compileDocs();
const next = { repo: pin.repo, commit: built.commit, patches: built.patches, versions: built.versions, artifacts: found() };
if (flag("--update-lock")) {
  writeFileSync(lockPath, formatLock(next));
  say(`wrote ${lockPath}`);
} else {
  const report = compareArtifacts(lock, next.artifacts);
  // A build on another machine can differ in bytes (paths, the host's linker): the lock says what
  // was reviewed, and a difference is reported, never papered over.
  process.stdout.write(`[build-slab] ${describeReport(report)}${matchesLock(report) ? "" : " (--update-lock pins this build)"}\n`);
}
say(`artifacts in ${vendor}. The scratch directory can be deleted.`);
