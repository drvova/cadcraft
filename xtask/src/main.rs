//! Workspace tooling: `cargo xtask <command>`.
//!
//! Pure Rust (std + serde_json). External tools (`cargo`, `curl`, `tar`) are
//! invoked through `std::process::Command`.

mod assets;
mod ico;
mod layers;
mod parity;
mod stats;
mod system_check;
mod version;

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const USAGE: &str = "\
usage: cargo xtask <command>

commands:
  assets          check that every icon/image/font/asset is attributed in ATTRIBUTION.md
  layers          enforce the crate dependency layering (plan/architecture.md §3)
  wasm            cargo check --target wasm32-unknown-unknown for the wasm-safe crates
  ui [--strict]   the interface's gate: bun type check, tests and build in apps/ui (skipped,
                  with a note, where bun is missing; --strict makes that a failure)
  test            cargo nextest run (cargo test without nextest) plus the doctests
  i18n            print the strings each interface language shows in English (never fails)
  ci              fmt --check, clippy -D warnings, test, i18n, assets, layers, wasm, ui (stops at first failure)
  corpus [--download]
                  show where test corpora live; --download fetches PngSuite into corpus/pngsuite
  stats [--exact] count tests and lines per crate (--exact: ask the test harness via `-- --list`)
  parity          recompute the AutoCAD menu-breadth checklist in docs/parity-checklist.md
  system-check [--root <dir>] [--ratchet <file>] [--ratchet-update] [--warn]
               [--no-ratchet] [--list-rules] [--list-blind-spots]
                  the design-system drift check: a literal colour, radius, font or control
                  height where a token or recipe constant already holds that value. Fails on
                  new drift; the counts in scripts/check-system-ratchet.json hold today's.
  ico <out.ico> <in.png>...
                  pack square PNGs (<= 256 px) into a Windows .ico (see packaging/icons.sh)
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    let result = match args.first().map(String::as_str) {
        Some("assets") => assets::run(&root()),
        Some("layers") => cmd_layers(),
        Some("wasm") => cmd_wasm(),
        Some("ui") => cmd_ui(rest.contains(&"--strict")),
        Some("test") => cmd_test(),
        Some("i18n") => cmd_i18n(),
        Some("ci") => cmd_ci(),
        Some("corpus") => cmd_corpus(rest.contains(&"--download")),
        Some("stats") => stats::run(&root(), rest.contains(&"--exact")),
        Some("parity") => parity::run(&root()),
        Some("system-check") => system_check::run(&root(), &rest.iter().map(|s| (*s).to_string()).collect::<Vec<_>>()),
        Some("ico") => ico::run(&rest),
        Some("version") => version::run(&root(), &rest),
        Some("-h" | "--help" | "help") | None => {
            print!("{USAGE}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command `{other}`\n\n{USAGE}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Workspace root (parent of the xtask crate).
pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("xtask has a parent dir").to_path_buf()
}

pub fn cargo() -> Command {
    let mut c = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    c.current_dir(root());
    c
}

fn run(mut cmd: Command, what: &str) -> Result<(), String> {
    eprintln!("$ {what}");
    let status = cmd.status().map_err(|e| format!("{what}: failed to spawn: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("{what}: exited with {status}")) }
}

pub fn metadata() -> Result<serde_json::Value, String> {
    let out = cargo().args(["metadata", "--format-version", "1", "--no-deps"]).output().map_err(|e| format!("cargo metadata: {e}"))?;
    if !out.status.success() {
        return Err(format!("cargo metadata failed:\n{}", String::from_utf8_lossy(&out.stderr)));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("cargo metadata: bad JSON: {e}"))
}

fn cmd_layers() -> Result<(), String> {
    let crates = layers::from_metadata(&metadata()?)?;
    println!("Dependency layering (plan/architecture.md §3)\n");
    println!("{:<28} {:<14} workspace deps", "crate", "layer");
    for c in &crates {
        let ws: Vec<String> = c
            .deps
            .iter()
            .filter(|d| d.workspace)
            .map(|d| {
                let k = match d.kind {
                    layers::DepKind::Normal => "",
                    layers::DepKind::Dev => " (dev)",
                    layers::DepKind::Build => " (build)",
                };
                format!("{}{k}", layers::short_name(&d.name))
            })
            .collect();
        println!("{:<28} {:<14} {}", c.name, layers::describe(layers::classify(&c.name)), ws.join(", "));
    }
    let violations = layers::check(&crates);
    println!();
    if violations.is_empty() {
        println!("OK: {} crates, no layering violations.", crates.len());
        Ok(())
    } else {
        println!("{} violation(s):", violations.len());
        for v in &violations {
            println!("  - {v}");
        }
        Err(format!("{} layering violation(s)", violations.len()))
    }
}

/// Workspace packages that must build for wasm32: all L0–L4 crates plus the egui shell and the
/// JS facade (`crates/wasm`).
fn wasm_set() -> Result<Vec<String>, String> {
    let crates = layers::from_metadata(&metadata()?)?;
    Ok(crates
        .into_iter()
        .filter(|c| match layers::classify(&c.name) {
            Some(layers::Class::Layer(l)) => l <= 4 || matches!(layers::short_name(&c.name), "ui-egui" | "wasm"),
            Some(layers::Class::Standalone) => true,
            _ => false,
        })
        .map(|c| c.name)
        .collect())
}

fn cmd_wasm() -> Result<(), String> {
    let set = wasm_set()?;
    let mut c = cargo();
    c.args(["check", "--target", "wasm32-unknown-unknown", "--keep-going"]);
    for pkg in &set {
        c.args(["-p", pkg]);
    }
    run(c, &format!("cargo check --target wasm32-unknown-unknown --keep-going ({} crates)", set.len())).map_err(|e| format!("wasm check failed: {e}"))
}

/// Whether `cargo nextest` is installed.
fn has_nextest() -> bool {
    let mut c = cargo();
    c.args(["nextest", "--version"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    c.status().is_ok_and(|s| s.success())
}

/// Unit and integration tests (examples are not built) with nextest, or `cargo test` when
/// nextest is missing, then the doctests, which nextest does not run.
fn cmd_test() -> Result<(), String> {
    let mut c = cargo();
    if has_nextest() {
        c.args(["nextest", "run", "--workspace", "--lib", "--bins", "--tests"]);
        run(c, "cargo nextest run --workspace --lib --bins --tests")?;
    } else {
        eprintln!("note: cargo-nextest is not installed (cargo install cargo-nextest --locked); running cargo test");
        c.args(["test", "--workspace", "--lib", "--bins", "--tests"]);
        run(c, "cargo test --workspace --lib --bins --tests")?;
    }
    let mut c = cargo();
    c.args(["test", "--workspace", "--doc"]);
    run(c, "cargo test --workspace --doc")
}

/// The translation gap report (`cadcraft-ui-egui`'s ignored `i18n::tests::translation_gaps`).
/// A missing translation shows in English and never fails a build, so neither does this step.
fn cmd_i18n() -> Result<(), String> {
    let mut c = cargo();
    // `--workspace` builds the same test binaries as the test step; `-p` alone would rebuild them.
    c.args(["test", "--workspace", "--lib", "-q", "--", "--ignored", "--exact", "i18n::tests::translation_gaps", "--nocapture"]);
    if let Err(e) = run(c, "cargo test --workspace --lib -q -- --ignored --exact i18n::tests::translation_gaps --nocapture") {
        eprintln!("note: the translation gap report did not run: {e}");
    }
    Ok(())
}

/// The interface's own gate: the TypeScript app in `apps/ui` (the engine's is Rust's). Runs its
/// type check, its tests and its build, so a broken surface cannot land behind a green Rust gate.
///
/// Skipped, with a note, where `bun` is not installed: the app is verified on a box that has it
/// (and on CI once the workflow installs it), and a hard failure here would say nothing about the
/// change under test. `--ui-strict` turns the skip into a failure for a box that must have it.
fn cmd_ui(strict: bool) -> Result<(), String> {
    let root = root();
    let ui = root.join("apps/ui");
    if !ui.is_dir() {
        return if strict { Err("apps/ui is missing".into()) } else { Ok(()) };
    }
    let bun = std::env::var("BUN").unwrap_or_else(|_| "bun".into());
    let mut probe = Command::new(&bun);
    probe.arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    if probe.status().map(|s| !s.success()).unwrap_or(true) {
        let msg = format!(
            "`{bun}` is not installed; the interface's type check, tests and build did not run (install bun, or run `cargo xtask ui` on a box that has it)"
        );
        return if strict {
            Err(msg)
        } else {
            eprintln!("note: {msg}");
            Ok(())
        };
    }
    // The wasm the app imports is generated, not committed: build it first, so a fresh clone's
    // `bun run build` has something to import.
    let mut wasm = Command::new(&bun);
    wasm.current_dir(&ui).args(["run", "build:wasm"]);
    run(wasm, "bun run build:wasm (apps/ui)")?;
    for (args, what) in [
        (vec!["run", "typecheck"], "bun run typecheck (apps/ui)"),
        (vec!["test"], "bun test (apps/ui)"),
        (vec!["run", "build"], "bun run build (apps/ui)"),
    ] {
        let mut c = Command::new(&bun);
        c.current_dir(&ui).args(&args);
        run(c, what)?;
    }
    Ok(())
}

fn cmd_ci() -> Result<(), String> {
    type Step = (&'static str, Box<dyn Fn() -> Result<(), String>>);
    let steps: Vec<Step> = vec![
        (
            "fmt",
            Box::new(|| {
                let mut c = cargo();
                c.args(["fmt", "--all", "--", "--check"]);
                run(c, "cargo fmt --all -- --check")
            }),
        ),
        (
            "clippy",
            Box::new(|| {
                let mut c = cargo();
                c.args(["clippy", "--workspace", "--all-targets", "--keep-going", "--", "-D", "warnings"]);
                run(c, "cargo clippy --workspace --all-targets --keep-going -- -D warnings")
            }),
        ),
        ("test", Box::new(cmd_test)),
        ("i18n", Box::new(cmd_i18n)),
        ("assets", Box::new(|| assets::run(&root()))),
        ("layers", Box::new(cmd_layers)),
        ("system-check", Box::new(|| system_check::run(&root(), &[]))),
        ("wasm", Box::new(cmd_wasm)),
        ("ui", Box::new(|| cmd_ui(false))),
    ];
    let mut done = Vec::new();
    for (name, f) in &steps {
        eprintln!("\n=== ci: {name} ===");
        if let Err(e) = f() {
            println!("\nCI summary:");
            for d in &done {
                println!("  ok    {d}");
            }
            println!("  FAIL  {name}: {e}");
            for (n, _) in steps.iter().skip(done.len() + 1) {
                println!("  skip  {n}");
            }
            return Err(format!("ci failed at `{name}`"));
        }
        done.push(*name);
    }
    println!("\nCI summary: all {} steps passed ({})", done.len(), done.join(", "));
    Ok(())
}

fn cmd_corpus(_download: bool) -> Result<(), String> {
    println!("Test corpora live in storytold/cadcraft-corpus (planned); never commit large binaries here.");
    Ok(())
}
