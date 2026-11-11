//! Embeds the web interface's build (`apps/ui/dist`) into the desktop binary.
//!
//! The build is an optional input, like the fonts: when `apps/ui/dist` is absent (nobody ran
//! `bun run build` there yet) the table is empty and the app shows a page that says how to make
//! it, so `cargo build` and the tests work on a box without bun.
//!
//! Output: `$OUT_DIR/embedded.rs`, one `(path, bytes)` row per file, paths relative to `dist`
//! with forward slashes.

use std::error::Error;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// A build deeper or larger than this is not a Vite `dist`; stop rather than walk a mistake.
const MAX_DEPTH: usize = 8;
const MAX_FILES: usize = 4096;

fn main() -> Result<(), Box<dyn Error>> {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let dist = manifest.join("..").join("ui").join("dist");
    println!("cargo:rerun-if-changed={}", dist.display());

    let mut files = Vec::new();
    if dist.is_dir() {
        collect(&dist, &dist, 0, &mut files)?;
    }
    files.sort();

    let mut out = String::from("/// The interface's files: `(path relative to dist, contents)`.\npub static FILES: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &files {
        writeln!(out, "    ({rel:?}, include_bytes!({:?})),", abs.display().to_string())?;
    }
    out.push_str("];\n");
    std::fs::write(PathBuf::from(std::env::var("OUT_DIR")?).join("embedded.rs"), out)?;
    Ok(())
}

fn collect(root: &Path, dir: &Path, depth: usize, files: &mut Vec<(String, PathBuf)>) -> Result<(), Box<dyn Error>> {
    if depth > MAX_DEPTH {
        return Err(format!("{} is nested deeper than {MAX_DEPTH} levels", dir.display()).into());
    }
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect(root, &path, depth + 1, files)?;
        } else if path.is_file() {
            if files.len() >= MAX_FILES {
                return Err(format!("{} holds more than {MAX_FILES} files", root.display()).into());
            }
            let rel = path.strip_prefix(root)?.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            files.push((rel, path.canonicalize()?));
        }
    }
    Ok(())
}
