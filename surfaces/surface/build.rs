//! Compiles the surface documents in `slab/` into typed Rust modules.
//!
//! Each `slab/NAME.slab` becomes `$OUT_DIR/NAME.rs` (hyphens as underscores): the module
//! `slab gen rust` emits, produced here through the compiler as a library — typed setters for
//! every param, an item struct and a setter per list, the scene keys, and the compiled document
//! (SLIR) as a byte string. A document that does not compile fails the build with Slab's own
//! diagnostics. Nothing is fetched and no tool is run: the inputs are the files in `slab/`.
//!
//! Without the crate's `slab` feature there is no compiler to run and nothing to generate: the
//! crate is empty then, and this script does nothing.

#[cfg(feature = "slab")]
use std::collections::HashMap;
#[cfg(feature = "slab")]
use std::fmt::Write as _;
#[cfg(feature = "slab")]
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// The documents with a typed module. `tokens.slab` is imported by all of them and has none.
#[cfg(feature = "slab")]
const DOCUMENTS: &[&str] = &["piece-card", "tech-sheet", "dashboard"];

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("cadcraft-surface build: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(not(feature = "slab"))]
fn run() -> Result<(), String> {
    println!("cargo:rerun-if-changed=build.rs");
    Ok(())
}

#[cfg(feature = "slab")]
fn run() -> Result<(), String> {
    let dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?).join("slab");
    let out = PathBuf::from(std::env::var("OUT_DIR").map_err(|e| e.to_string())?);
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=slab");

    // Every source in the directory, keyed by file name: the compiler resolves `import "x.slab"`
    // from this map and never reads the file system itself.
    let mut sources: HashMap<String, String> = HashMap::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("slab") {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        println!("cargo:rerun-if-changed=slab/{name}");
        sources.insert(name.to_string(), std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?);
    }

    for name in DOCUMENTS {
        let file = format!("{name}.slab");
        let source = sources.get(&file).ok_or_else(|| format!("slab/{file} is missing"))?;
        let options = slab_compile::Options {
            embed_assets: true,
            base_dir: dir.clone(),
            assets: Some(HashMap::new()),
            sources: Some(sources.clone()),
            fonts: HashMap::new(),
        };
        let (module, diagnostics, _) = slab_compile::rustgen::generate_embedded_with_import_paths(source, &options, &format!("slab/{file}"));
        let mut report = String::new();
        for d in &diagnostics.0 {
            let _ = writeln!(report, "{}", d.format(&format!("slab/{file}")));
            // A warning is a mistake waiting to render: the build says so, every time.
            println!("cargo:warning={}", d.format(&format!("slab/{file}")).replace('\n', " "));
        }
        let module = module.ok_or_else(|| format!("slab/{file} does not compile:\n{report}"))?;
        write_module(&out.join(format!("{}.rs", name.replace('-', "_"))), &module)?;
    }
    Ok(())
}

/// Write a generated module where `include!` can take it: without the file-level `#![allow(…)]`
/// it opens with, which is legal at the top of a file but not inside an including module. The
/// including `mod` carries the allowances instead (`src/generated.rs`).
#[cfg(feature = "slab")]
fn write_module(path: &Path, module: &str) -> Result<(), String> {
    let start = module.find("#![allow(").ok_or("the generated module no longer opens with `#![allow(`; update build.rs")?;
    let end =
        module.get(start..).and_then(|rest| rest.find(")]")).map(|i| start + i + 2).ok_or("unterminated `#![allow(` in the generated module")?;
    let mut text = String::with_capacity(module.len());
    text.push_str(module.get(..start).unwrap_or_default());
    text.push_str(module.get(end..).unwrap_or_default());
    std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}
