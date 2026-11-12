# Slab, as CADCraft builds it

[Slab](https://github.com/stencil-hq/slab) is the layout technology CADCraft's designed surfaces
are written in: the Slab shell of the web interface (`apps/ui/slab`, behind `?shell=slab`) and the
piece card, bench sheet and terminal dashboard of the command-line tool (`crates/surface`). It is
pre-alpha, not on crates.io, and its npm packages lag its repository, so both sides build it from
source.

This directory is the one place that says **which** Slab: upstream at one commit, under a small
patch series. Nothing of Slab is committed here — no source, no binary, no font. Only:

| File | What it is |
|---|---|
| `SLAB.lock` | The pin: the upstream URL, the base commit, and the sha256 of every patch, in order |
| `patches/NNNN-*.patch` | The series, as `git format-patch` wrote it |
| `README.md` | This file |

Git-ignored, made by `cargo xtask slab`: `src/` (upstream at the pin with the series applied),
`src.stamp`, `cargo-config.toml`.

- Upstream: <https://github.com/stencil-hq/slab>
- Base commit: `65747371a18da9a54a94955473d0ec7f7fd07d5f` (2026-08-22)
- Licence: MIT (© Stencil; `LICENSE` in the upstream repository). The patches are CADCraft's and
  are offered under the same MIT licence, so upstream can take them as they are.

## Why a series

Upstream at the base commit has two properties CADCraft cannot ship on:

1. **It does not build from a clean checkout.** `slab-compile` `include_str!`s and
   `include_bytes!`s two untracked build products (the bundled web runtime and the kernel's
   wasm). A Cargo git dependency is a clean checkout, so the crate cannot be depended on.
2. **It compiles fonts into everything.** `slab-fonts` embeds Inter and JetBrains Mono (eight
   files, 2.77 MB, SIL OFL 1.1) into every binary and wasm module that links the kernel, with no
   switch. CADCraft's rule is that no third-party font is in the repository or in what it
   builds.

## The patches

Each is one commit, written to be acceptable upstream; each commit message says what and why in
full.

| Patch | What it does |
|---|---|
| `0001` fix(compile): build from a clean checkout | A `wc-embed` feature (default on). The build script embeds the runtime and the kernel's wasm when both files exist and warns when they do not; `gen wc` / `gen react` then return no runtime sidecars and the command line refuses with a sentence naming `just web-runtime`. With the artifacts present upstream's own flow is unchanged. The version hash comes from `SLAB_GIT_HASH` or from the crate's own checkout only: a copy nested in another repository no longer reports that repository's `HEAD` |
| `0002` feat(fonts): bundled faces as a feature | `bundled-fonts` on `slab-fonts`, default on, forwarded by every crate that links it; the workspace inherits its own crates without default features, so `--no-default-features` gives a build with **no font bytes**. Without it: a family with no face is compiled to a built-in default advance table (a designed model — one advance for a monospaced class, six width classes for a proportional one — documented in `slab-fonts`, derived from no font file); the kernel lays its text out from that table and names the family once in a `font-default` frame diagnostic until the host registers the family's metrics or bytes; SVG and terminal cells work unchanged; a raster export (PNG, APNG) of text with no outlines returns an error naming the family instead of a picture without the text |
| `0003` feat(web): register a face by its metrics | `SlabElement.registerFontMetrics(name, metrics, cssFamily)`: the kernel measures with the metrics the page hands it and the driver paints with a CSS family the page owns. No font bytes cross the boundary |
| `0004` fix(svg): no empty name in a font-family list | Text with no authored family was written `font-family=", Helvetica, …"`, which a viewer drops whole. It now gets the fallback list alone |

Not in the series, because they are not one-screen fixes (known issues at the base commit):

- A `hug` hole cannot shrink: the web driver reports the hole's own `scrollWidth`/`scrollHeight`,
  never less than the hole (`clients/web/element.ts`, `#measureHoleContent`). The interface
  measures its bars and sets params instead.
- The generated Rust `Doc::set_env` hard-codes the GPU client (code 1). Fixing it changes the
  template and upstream's checked-in generated modules; `crates/surface` calls the kernel's
  `inst_set_env` itself.
- A weight or family that reaches a node through a token bundle gets no font table
  (`slab-compile/src/emit.rs`, `collect_font_attrs` matches literals only); a child added by a
  `when` is placed after its parent's other children. `crates/surface/slab` works around both.
- The rest of what the web side found is in `apps/ui/docs/slab-foundation.md`.

## Who reads this

- **The web side**: `scripts/build-slab.mjs` (`bun run build:slab` in `apps/ui`) clones upstream
  at the pin into a scratch directory, applies the series, and builds the kernel wasm, the
  compiler wasm, the runtime and the `slab` command line with `--no-default-features`. It refuses
  to vendor an artifact that contains a font's name records. `apps/ui/slab.lock.json` records the
  build (the commit and patches, which must equal `SLAB.lock`, and the artifacts' checksums).
- **The Rust side**: the root `Cargo.toml` names Slab's crates as git dependencies on upstream at
  the pin, `default-features = false`, and every use is optional (`cadcraft-surface`'s `slab`
  feature, `surfaces` on `cadcraft-cli` and `cadcraft-mcp`). So a fresh clone builds and passes
  its gates with no extra step and compiles none of Slab. To build the surfaces:

  ```sh
  cargo xtask slab                       # fetch the pin into third_party/slab/src, apply the series
  cargo xtask surfaces test              # lint/test/build what is built on Slab, against that tree
  cargo xtask surfaces build --release   # cadcraft-cli with --card, --sheet, tui and (card)
  cargo xtask surfaces run -- tui --sample
  ```

  `cargo xtask surfaces` passes Cargo a `paths` override (`cargo-config.toml`, written by
  `cargo xtask slab`) that substitutes the patched tree for the git dependency. `Cargo.lock` is
  not touched. `cargo xtask ci` lints and tests the surfaces when the tree has been fetched, and
  says it skipped them when it has not.

  Three things to know. Cargo resolves an optional git dependency like any other: the first
  Cargo command on a fresh clone fetches `github.com/stencil-hq/slab` into Cargo's own cache (as
  it does `storytold/craft-libs`), though a default build compiles none of it; if that
  repository were ever gone, the workspace would not resolve until the six lines pointed
  elsewhere. A bare `cargo build -p cadcraft-cli --features surfaces` compiles
  **unpatched** upstream and fails in `slab-compile` (`couldn't read …/slab-runtime.js`): use
  `cargo xtask surfaces`. And Cargo warns that the override "has altered the original list of
  dependencies" of Slab's crates (the series changes how they depend on each other); `cargo xtask
  surfaces` counts that warning and says it once. All three go away with the fork.

## When the fork exists

The series is what a fork would carry. Once it is pushed to a repository (the base commit plus
these four commits, at some hash `H`):

1. In the root `Cargo.toml`, change the six `slab-*` lines from
   `git = "https://github.com/stencil-hq/slab", rev = "6574737…"` to `git = "<fork URL>", rev = "H"`.
   That is the whole change for the Rust side: the features become ordinary optional features,
   `cargo build -p cadcraft-cli --features surfaces` works, and the override warning is gone.
2. Delete the fetch step: `xtask/src/slab.rs`'s `fetch` and `paths` override (keep
   `surfaces` as a shorthand, or drop it), the `third_party/slab/src` entries in `.gitignore`
   and the workspace `exclude`.
3. Point `SLAB.lock` at the fork (`repo <fork URL>`, `commit H`, no `patch` lines): the web
   build then clones the fork and applies nothing. Keep `patches/` only if the fork is not the
   place the series is reviewed.

## Moving the pin

1. Clone upstream, check out the base commit, and apply the series as commits:
   `git am /path/to/third_party/slab/patches/*.patch`.
2. Rebase onto the new upstream commit: `git rebase --onto <new> 65747371a18d…`. Resolve; a patch
   upstream has taken drops out.
3. Verify, in both configurations (below).
4. Export: `git format-patch --no-signature --zero-commit -o <this directory>/patches <new>..HEAD`
   (delete the old files first), then rewrite `SLAB.lock`: the new `commit`, and a
   `patch <sha256> <file>` line per patch, in order.
5. Change the commit in the root `Cargo.toml`'s six `slab-*` lines and `SLAB_COMMIT` in
   `crates/surface/src/document.rs` (an xtask test fails while they differ from the lock).
6. `cargo xtask slab && cargo xtask surfaces test`; `bun run build:slab -- --update-lock` in
   `apps/ui`, look at `?shell=slab`, and commit the new record.

## Verifying the series

In a clone of upstream with the series applied (upstream pins its own nightly in
`rust-toolchain.toml`):

```sh
CRATES="-p slab-fonts -p slab-kernel -p slab-slir -p slab-syntax -p slab-compile -p slab-drive \
        -p slab-tui -p slab-cli -p slab-kernel-wasm -p slab-wasm -p slab-lsp"
cargo test $CRATES                          # with the bundled faces: upstream's behaviour
cargo test $CRATES --no-default-features    # font-less
cargo clippy $CRATES -p slab-native --all-targets -- -D warnings
cargo clippy $CRATES -p slab-native --all-targets --no-default-features -- -D warnings
cargo run -q -p slab-cli -- conformance     # the goldens: default configuration only
```

Measured on the series at the base commit (2026-11-12, from a clean checkout, without the web
runtime payload built):

| | default | `--no-default-features` |
|---|---|---|
| `cargo test` (the eleven crates above) | 586 passed, 0 failed | 583 passed, 0 failed |
| `cargo clippy --all-targets -D warnings` | clean | clean |
| `slab conformance` | 125 / 125 | 45 / 125 |

The conformance goldens are frames measured with the bundled faces, so the 80 cases that set
text differ in a font-less build (46 frame files, 1 cell grid, 34 traces); the 45 that pass draw
no text or do not depend on its width. That is expected, and it is the only configuration in
which a golden changes. Tests that need a bundled face are gated on the feature;
`crates/slab-compile/tests/fontless.rs` covers the build without it.

Proof that a font-less build holds no font: search the artifact for a face's UTF-16BE name
records and its copyright string (a font file cannot be present without them). The web build does
this on every build; for a binary, `python3` with `data.count("Inter".encode("utf-16-be"))` and
`"The Inter Project Authors"`, `"JetBrains Mono"` likewise.
