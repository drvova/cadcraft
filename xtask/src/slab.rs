//! `cargo xtask slab` and `cargo xtask surfaces`: Slab, fetched and patched, and the crates built
//! on it.
//!
//! Slab (<https://github.com/stencil-hq/slab>, MIT) lays out CADCraft's designed surfaces
//! (`surfaces/surface`). Upstream at the pinned commit does not build from a clean checkout and
//! compiles fonts into everything that links it, so CADCraft builds it through a small patch
//! series: `third_party/slab/patches`, pinned with its base commit in `third_party/slab/SLAB.lock`.
//! No Slab source is committed, and the main workspace names nothing of Slab: the surfaces are a
//! workspace of their own (`surfaces/Cargo.toml`) that names the patched tree by path.
//!
//! - `slab` clones upstream at the pinned commit into the git-ignored `third_party/slab/src` and
//!   applies the series (each patch checked against the lock).
//! - `surfaces <test|check|clippy|build|run>` runs Cargo on the surfaces workspace, into the main
//!   workspace's `target` directory.
//!
//! Everything in the main workspace builds, tests and releases without any of this.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The Slab crates the surfaces workspace links, each a directory under `crates/` of the fetched tree.
const CRATES: &[&str] = &["slab-compile", "slab-fonts", "slab-kernel", "slab-slir", "slab-syntax", "slab-tui"];
/// The surfaces workspace's manifest, from the repository's root.
const MANIFEST: &str = "surfaces/Cargo.toml";

/// What `SLAB.lock` pins.
#[derive(Debug, PartialEq, Eq)]
pub struct Lock {
    pub repo: String,
    pub commit: String,
    /// `(sha256, file name)`, in the order they apply.
    pub patches: Vec<(String, String)>,
}

/// Parse `SLAB.lock`: `repo URL`, `commit HASH` and one `patch SHA256 FILE` line per patch, in
/// order; blank lines and `#` comments are skipped. Anything else is an error, so a damaged lock
/// never fetches or applies something unexpected.
pub fn parse_lock(text: &str) -> Result<Lock, String> {
    let (mut repo, mut commit, mut patches) = (None, None, Vec::new());
    for (n, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        let hex = |s: &str, len: usize| s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        match fields.as_slice() {
            ["repo", url] if url.starts_with("https://") && repo.is_none() => repo = Some((*url).to_string()),
            ["commit", hash] if hex(hash, 40) && commit.is_none() => commit = Some((*hash).to_string()),
            ["patch", sum, file]
                if hex(sum, 64)
                    && file.ends_with(".patch")
                    && file.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_') =>
            {
                patches.push(((*sum).to_string(), (*file).to_string()));
            }
            _ => return Err(format!("SLAB.lock line {}: not `repo URL`, `commit HASH` or `patch SHA256 FILE`: {line}", n + 1)),
        }
    }
    Ok(Lock { repo: repo.ok_or("SLAB.lock names no repo")?, commit: commit.ok_or("SLAB.lock names no commit")?, patches })
}

/// SHA-256 (FIPS 180-4) as lower-case hex. The workspace tooling is std only; this is the whole
/// algorithm, checked against the standard's vectors below.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
        0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
        0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
        0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
        0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut message = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bits.to_be_bytes());
    for block in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (word, bytes) in w.iter_mut().zip(block.chunks_exact(4)) {
            *word = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for (sum, add) in h.iter_mut().zip(v) {
            *sum = sum.wrapping_add(add);
        }
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}

fn dir(root: &Path) -> PathBuf {
    root.join("third_party").join("slab")
}

fn read_lock(root: &Path) -> Result<Lock, String> {
    let path = dir(root).join("SLAB.lock");
    parse_lock(&std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?)
}

/// The patches of the lock, read and checked: every file the lock names has the checksum it
/// names, and the directory holds no patch the lock does not name.
fn checked_patches(root: &Path, lock: &Lock) -> Result<Vec<PathBuf>, String> {
    let patches = dir(root).join("patches");
    let mut out = Vec::new();
    for (sum, file) in &lock.patches {
        let path = patches.join(file);
        let found = sha256_hex(&std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?);
        if found != *sum {
            return Err(format!(
                "third_party/slab/patches/{file} is not the patch SLAB.lock pins (sha256 {found}, pinned {sum}); review it, then update the lock"
            ));
        }
        out.push(path);
    }
    let listed = std::fs::read_dir(&patches).map_err(|e| format!("{}: {e}", patches.display()))?;
    for entry in listed.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".patch") && !lock.patches.iter().any(|(_, file)| *file == name) {
            return Err(format!("third_party/slab/patches/{name} is not in SLAB.lock: add its `patch SHA256 FILE` line, in order"));
        }
    }
    Ok(out)
}

/// What a fetched tree was made from: the commit and every patch's checksum. Written beside the
/// tree, and compared before a build so a changed lock or patch is never built stale.
fn stamp(lock: &Lock) -> String {
    let mut text = format!("commit {}\n", lock.commit);
    for (sum, file) in &lock.patches {
        text.push_str(&format!("patch {sum} {file}\n"));
    }
    text
}

fn git(args: &[&str], cwd: &Path, what: &str) -> Result<(), String> {
    eprintln!("$ git {}", args.join(" "));
    let status = Command::new("git").args(args).current_dir(cwd).status().map_err(|e| format!("{what}: could not run git: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("{what}: git exited with {status}")) }
}

/// A git command on the fetched tree and on nothing else. The tree sits inside this repository,
/// so a command that found no repository of its own there would walk up and act on CADCraft's
/// (`reset --hard`, `clean`): every command names the tree's own git directory and work tree.
fn src_git(src: &Path) -> Command {
    let mut c = Command::new("git");
    c.arg(format!("--git-dir={}", src.join(".git").display())).arg(format!("--work-tree={}", src.display())).current_dir(src);
    c
}

fn in_src(src: &Path, args: &[&str], what: &str) -> Result<(), String> {
    if !src.join(".git").is_dir() {
        return Err(format!("{what}: {} is not a git checkout", src.display()));
    }
    eprintln!("$ git (third_party/slab/src) {}", args.join(" "));
    let status = src_git(src).args(args).status().map_err(|e| format!("{what}: could not run git: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("{what}: git exited with {status}")) }
}

/// Whether the fetched tree is the one the lock and the patches describe.
fn ready(root: &Path, lock: &Lock) -> bool {
    let src = dir(root).join("src");
    std::fs::read_to_string(dir(root).join("src.stamp")).is_ok_and(|s| s == stamp(lock))
        && CRATES.iter().all(|c| src.join("crates").join(c).join("Cargo.toml").is_file())
}

/// `cargo xtask slab [--verify]`: fetch the pinned commit and apply the series.
pub fn fetch(root: &Path, verify_only: bool) -> Result<(), String> {
    let lock = read_lock(root)?;
    let patches = checked_patches(root, &lock)?;
    if verify_only {
        println!("slab: {} at {} with {} patches, all as SLAB.lock pins them", lock.repo, lock.commit, patches.len());
        println!(
            "slab: the fetched tree in third_party/slab/src is {}",
            if ready(root, &lock) { "current" } else { "absent or stale (cargo xtask slab)" }
        );
        return Ok(());
    }
    let base = dir(root);
    let src = base.join("src");
    let stamp_path = base.join("src.stamp");
    // The stamp goes first: a fetch that stops half way leaves a tree no build will take.
    let _ = std::fs::remove_file(&stamp_path);
    if !src.join(".git").is_dir() {
        if src.exists() {
            std::fs::remove_dir_all(&src).map_err(|e| format!("{}: {e}", src.display()))?;
        }
        git(&["clone", "--quiet", "--no-checkout", &lock.repo, &src.display().to_string()], &base, "fetching Slab")?;
    }
    let have = src.join(".git").is_dir()
        && src_git(&src).args(["cat-file", "-e", &format!("{}^{{commit}}", lock.commit)]).status().is_ok_and(|s| s.success());
    if !have {
        in_src(&src, &["fetch", "--quiet", "origin", &lock.commit], "fetching the pinned commit")?;
    }
    // The tree is put back to the commit exactly, so a patch is never laid over itself; the
    // patches are applied to the working tree only, so HEAD stays the pinned commit.
    in_src(&src, &["checkout", "--quiet", "--force", "--detach", &lock.commit], "checking out the pinned commit")?;
    in_src(&src, &["reset", "--quiet", "--hard", &lock.commit], "resetting to the pinned commit")?;
    in_src(&src, &["clean", "--quiet", "-fdx"], "cleaning the fetched tree")?;
    for patch in &patches {
        in_src(&src, &["apply", "--whitespace=nowarn", &patch.display().to_string()], "applying the patch series")?;
    }
    std::fs::write(&stamp_path, stamp(&lock)).map_err(|e| format!("{}: {e}", stamp_path.display()))?;
    println!("slab: {} at {} with {} patches is in third_party/slab/src", lock.repo, lock.commit, patches.len());
    println!("slab: build on it with `cargo xtask surfaces test|clippy|build|run`");
    Ok(())
}

/// Whether the patched tree is there and current (for `ci`, which skips the surfaces otherwise).
pub fn fetched(root: &Path) -> bool {
    read_lock(root).is_ok_and(|lock| checked_patches(root, &lock).is_ok() && ready(root, &lock))
}

/// The Cargo command line for one `surfaces` verb, after `cargo`. `manifest` is the surfaces
/// workspace's manifest and `target` the directory it builds into.
pub fn cargo_args(verb: &str, manifest: &str, target: &str, rest: &[&str]) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| args.extend(items.iter().map(|s| (*s).to_string()));
    let place = ["--manifest-path", manifest, "--target-dir", target];
    match verb {
        "test" | "check" => {
            push(&[verb]);
            push(&place);
            push(&["--workspace"]);
            push(rest);
        }
        "clippy" => {
            push(&["clippy"]);
            push(&place);
            push(&["--workspace", "--all-targets"]);
            push(rest);
            push(&["--", "-D", "warnings"]);
        }
        // Only the surface crate: the tool's source file is the main workspace's, formatted there,
        // and `--all` would walk into the fetched Slab.
        "fmt" => {
            push(&["fmt", "--manifest-path", manifest, "-p", "cadcraft-surface", "--", "--check"]);
            push(rest);
        }
        "build" => {
            push(&["build"]);
            push(&place);
            push(&["-p", "cadcraft-cli"]);
            push(rest);
        }
        "run" => {
            push(&["run"]);
            push(&place);
            push(&["-p", "cadcraft-cli", "--"]);
            // `cargo xtask surfaces run -- run …` is how the documents write it: one `--` only.
            push(rest.strip_prefix(&["--"]).unwrap_or(rest));
        }
        other => return Err(format!("surfaces: unknown verb `{other}` (test, check, clippy, fmt, build, run)")),
    }
    Ok(args)
}

/// `cargo xtask surfaces <test|check|clippy|build|run> [args…]`: the surfaces workspace, built on
/// the patched Slab. Fetches it first when it is absent or stale.
pub fn surfaces(root: &Path, rest: &[&str]) -> Result<(), String> {
    let Some((verb, rest)) = rest.split_first() else {
        return Err("surfaces: give a verb (test, check, clippy, build, run)".into());
    };
    let lock = read_lock(root)?;
    checked_patches(root, &lock)?;
    if !ready(root, &lock) {
        eprintln!("surfaces: the patched Slab is absent or stale; fetching it (cargo xtask slab)");
        fetch(root, false)?;
    }
    // The main workspace's target directory: one place for the binaries, and what the two
    // workspaces share is compiled once.
    let target = std::env::var_os("CARGO_TARGET_DIR").map_or_else(|| root.join("target"), PathBuf::from);
    let args = cargo_args(verb, &root.join(MANIFEST).display().to_string(), &target.display().to_string(), rest)?;
    eprintln!("$ cargo {}", args.join(" "));
    let status = crate::cargo().args(&args).status().map_err(|e| format!("cargo: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("cargo {verb} (surfaces): exited with {status}")) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_the_standards_vectors() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        // Padding at every block boundary.
        assert_eq!(sha256_hex(&[b'a'; 55]), "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
        assert_eq!(sha256_hex(&[b'a'; 64]), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
    }

    #[test]
    fn the_lock_parses_and_a_damaged_one_is_refused() {
        let sum = "a".repeat(64);
        let text = format!(
            "# pin\nrepo https://github.com/stencil-hq/slab\ncommit {}\n\npatch {sum} 0001-a.patch\npatch {sum} 0002-b.patch\n",
            "0".repeat(40)
        );
        let lock = parse_lock(&text).unwrap();
        assert_eq!(lock.repo, "https://github.com/stencil-hq/slab");
        assert_eq!(lock.patches.len(), 2);
        assert_eq!(lock.patches[1].1, "0002-b.patch");
        for bad in [
            "commit abc\n",
            "repo http://insecure\ncommit 0\n",
            &format!("repo https://x\ncommit {}\npatch {sum} ../../etc/passwd.patch\n", "0".repeat(40)),
            &format!("repo https://x\ncommit {}\npatch short 0001-a.patch\n", "0".repeat(40)),
            &format!("repo https://x\nrepo https://y\ncommit {}\n", "0".repeat(40)),
            "repo https://x\n",
            "rm -rf /\n",
        ] {
            assert!(parse_lock(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_committed_lock_pins_the_committed_patches() {
        let root = crate::root();
        let lock = read_lock(&root).unwrap();
        assert!(!lock.patches.is_empty());
        checked_patches(&root, &lock).unwrap();
        // The crate that is written against it names the same commit.
        let document = std::fs::read_to_string(root.join("surfaces/surface/src/document.rs")).unwrap();
        assert!(document.contains(&format!("SLAB_COMMIT: &str = \"{}\"", lock.commit)), "surfaces/surface's SLAB_COMMIT is not the pinned commit");
    }

    /// The main workspace names nothing of Slab: its manifest and its lock file are what a release
    /// checks (git dependencies come from the suite's own organisation), and a fresh clone must
    /// resolve without the fetched tree. The surfaces workspace names it by path only.
    #[test]
    fn the_main_workspace_names_nothing_of_slab() {
        let root = crate::root();
        for file in ["Cargo.toml", "Cargo.lock"] {
            let text = std::fs::read_to_string(root.join(file)).unwrap();
            for line in text.lines().filter(|l| !l.trim_start().starts_with('#')) {
                assert!(!line.contains("stencil-hq") && !line.contains("slab-"), "{file} names Slab: {line}");
            }
        }
        let surfaces = std::fs::read_to_string(root.join(MANIFEST)).unwrap();
        for krate in CRATES {
            let line = surfaces
                .lines()
                .find(|l| l.starts_with(&format!("{krate} = ")))
                .unwrap_or_else(|| panic!("{krate} is not a dependency of the surfaces workspace"));
            assert!(line.contains(&format!("path = \"../third_party/slab/src/crates/{krate}\"")) && !line.contains("git"), "{line}");
        }
        // The two workspaces lint alike: the surfaces' table is a copy.
        let main = std::fs::read_to_string(root.join("Cargo.toml")).unwrap();
        let lints = |text: &str| -> Vec<String> {
            let from = text.find("[workspace.lints.rust]").unwrap();
            let rest = &text[from..];
            let to = rest.find("[profile").unwrap();
            rest[..to].lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(String::from).collect()
        };
        assert_eq!(lints(&main), lints(&surfaces));
    }

    #[test]
    fn surfaces_builds_the_surfaces_workspace() {
        let args = cargo_args("test", "s/Cargo.toml", "t", &["--no-run"]).unwrap();
        assert_eq!(args[..5], ["test", "--manifest-path", "s/Cargo.toml", "--target-dir", "t"]);
        assert!(args.ends_with(&["--no-run".to_string()]));
        let clippy = cargo_args("clippy", "s/Cargo.toml", "t", &[]).unwrap();
        assert!(clippy.ends_with(&["--".to_string(), "-D".to_string(), "warnings".to_string()]));
        let run = cargo_args("run", "s/Cargo.toml", "t", &["tui", "--sample"]).unwrap();
        assert!(run.ends_with(&["--".to_string(), "tui".to_string(), "--sample".to_string()]));
        let dashed = cargo_args("run", "s/Cargo.toml", "t", &["--", "run", "--sample"]).unwrap();
        assert_eq!(dashed.iter().filter(|a| *a == "--").count(), 1);
        assert_eq!(
            cargo_args("fmt", "s/Cargo.toml", "t", &[]).unwrap(),
            ["fmt", "--manifest-path", "s/Cargo.toml", "-p", "cadcraft-surface", "--", "--check"]
        );
        assert!(cargo_args("publish", "s/Cargo.toml", "t", &[]).is_err());
    }
}
