# Designed surfaces (Rust side)

A *surface* is a picture of the drawing's **data** — as opposed to a picture of the drawing. Three
exist outside the web interface, all in `surfaces/surface` (`cadcraft-surface`, layer L5):

| Surface | Document | Reached by | Output |
|---|---|---|---|
| Piece card | `surfaces/surface/slab/piece-card.slab` | the assistant's `(card [path] [width] [theme])` inside `run` (MCP returns it as an image block); `cadcraft-cli run … --card OUT.svg\|png` | SVG, PNG (1280 px wide by default) |
| Bench sheet | `surfaces/surface/slab/tech-sheet.slab` | `cadcraft-cli run … --sheet OUT.svg\|png` | SVG page (794 units wide), PNG |
| Terminal dashboard | `surfaces/surface/slab/dashboard.slab` | `cadcraft-cli tui [FILE\|--sample\|--metric]` | interactive terminal; text when stdout is not a terminal or with `--print` |

`--theme dark|light` picks the palette (`slab/tokens.slab`, the interface's own tokens). The card
is dark by default and the sheet light.

**They are optional.** The surfaces are the `surfaces` feature of `cadcraft-cli` and
`cadcraft-mcp` (the `slab` feature of `cadcraft-surface`), off by default, because Slab is not in
the repository: it is fetched and patched first. A default build knows the options and answers
them, and `(card)`, with one sentence. To have them:

```sh
cargo xtask slab                        # once: fetch Slab at the pin, apply the patch series
cargo xtask surfaces build --release    # cadcraft-cli with the surfaces
cargo xtask surfaces run -- run --sample --card card.svg --sheet sheet.svg
cargo xtask surfaces run -- tui --sample
cargo xtask surfaces test               # the tests of surfaces/surface and of the tool built with it
```

**An SVG needs no font; a PNG needs one of the machine's.** No font is shipped (see Fonts below).

## Where the figures come from

Two commands are asked and nothing is changed: `piece {query: true}` and `techsheet {}`. The
surfaces print their replies — size, weight, stone count and carats, each check's `ok` as PASS or
FAIL with the engine's sentence, the cost lines when the drawing has a price book. Nothing is
measured, summed or priced in `surfaces/surface` (`src/data.rs`). A drawing with no parametric
piece shows its bands and stones and says there are no checks; no drawing at all shows that.

The sheet's views are the engine's own PNG of the drawing (`cadcraft_io::png_framed`), handed to
Slab as a runtime image.

## The piece card for agents

The MCP server has one tool, `run`, and that does not change. Inside a run, `(card)` draws the
card to a PNG, returns `((PATH . …) (WIDTH . …) (HEIGHT . …) (BYTES . …) (DATA . …))` — `DATA` is
the two replies, without handle lists — and the server attaches the PNG as an MCP image content
block (`type: image`, base64 `data`, `mimeType: image/png`), as it does for `(render)`. A picture
over 4 MiB, or a ninth picture in one run, is named in text instead of inlined
(`crates/mcp/src/tools.rs`).

The engine cannot depend on `cadcraft-surface` (L4 below L5), so it has a door:
`cadcraft_engine::surfaces::install` takes a renderer once, and `(card)` calls through it. The
command-line tool and the headless MCP server install it. A build without one (the browser, the
desktop window) answers `(card)` with a sentence.

## Slab

The documents are written in [Slab](https://github.com/stencil-hq/slab) (MIT): a small
declarative layout language with one kernel that solves the layout for every medium, and
exporters for PNG, SVG and terminal cells. It is pre-alpha and not on crates.io.

- **Pin and patches.** `third_party/slab/SLAB.lock` pins upstream at commit
  `65747371a18da9a54a94955473d0ec7f7fd07d5f` and a series of four patches
  (`third_party/slab/patches`; its `README.md` says what each does). The series makes
  `slab-compile` build from a clean checkout and makes Slab's bundled fonts a feature, which
  CADCraft turns off. The web interface's Slab shell builds on the same pin and series
  (`scripts/build-slab.mjs`). No Slab source is in the repository; `vendor/slab-compile`, the
  copy an earlier revision carried, is gone.
- **How it is linked.** The surfaces are a workspace of their own, `surfaces/`: the surface crate
  (`surfaces/surface`) and the command-line tool built with it (`surfaces/cli`, the same source
  file as `apps/cadcraft-cli` with its `surfaces` feature on). Its manifest names `slab-compile`,
  `slab-fonts`, `slab-kernel`, `slab-slir`, `slab-syntax` and `slab-tui` by path into the
  git-ignored `third_party/slab/src`, with `default-features = false`. `cargo xtask slab` clones
  the pin there and applies the series (each patch checked against the lock's sha256);
  `cargo xtask surfaces test|check|clippy|fmt|build|run` runs Cargo on that workspace.
- **What that buys.** The main workspace's `Cargo.toml` and `Cargo.lock` name nothing of Slab,
  so a fresh clone builds, tests, passes `cargo xtask ci` and releases without it, and nothing is
  fetched from upstream unless the surfaces are asked for. `surfaces/Cargo.lock` is committed.
  The MCP server does not link the surface crate: its host installs the renderer, which the
  command-line tool of the surfaces workspace does before it serves.

### Updating the pin

`third_party/slab/README.md` has the steps (rebase the series, verify it in both feature
configurations, export it, rewrite `SLAB.lock`). On this side: change `SLAB_COMMIT` in `surfaces/surface/src/document.rs`
(an xtask test fails while it differs from the lock), then `cargo xtask slab` and
`cargo xtask surfaces test`. The tests write every surface to a directory when
`CADCRAFT_SURFACE_SAMPLES` names one: look at them.

### Workarounds for Slab at this commit

- A weight or family that reaches a node through a token bundle (`style=text.title`) gets no
  font table and falls back to the nearest one (`slab-compile/src/emit.rs`, `collect_font_attrs`
  matches literals only). Each document's root carries never-active `when` patches naming the
  weights as literals.
- A child added by a `when` is placed after its parent's other children, not where the `when`
  is written. Each optional section has a wrapper of its own.
- The generated `Doc::set_env` is written for the GPU client; `render.rs` calls the kernel's
  `inst_set_env` with the client it is drawing for.
- The SVG exporter's empty first family name (`font-family=", Helvetica, …"`) is fixed by the
  series (patch 0004), and with no bundled faces it has no face to embed. `render::tidy_svg`
  now only gives a monospaced run a monospaced fallback.

## Fonts

**None is shipped.** No font file is in this repository, and none is in what it builds: Slab is
linked without its bundled faces (Inter and JetBrains Mono, which upstream compiles into every
binary), a test asserts it (`slab_is_linked_without_its_bundled_faces`), and the built
`cadcraft-cli` has been searched for both faces' name records. The documents name no family.

- **SVG and the terminal dashboard need no font.** Without a face, Slab's kernel lays text out
  with a built-in default advance table (a designed width model, the same on every machine,
  derived from no font: `slab-fonts`, `default_metrics`). The SVG writes every run with the width
  it was given (`textLength`) and names a generic family (`Helvetica, Arial, sans-serif`), so a
  viewer's own sans-serif fits the layout. The same drawing gives the same bytes everywhere.
- **A PNG needs glyph outlines, so it needs a face of the machine's.** `surfaces/surface/src/fonts.rs`
  looks, when the picture is drawn, for: the file `CADCRAFT_SURFACE_FONT` names (with
  `CADCRAFT_SURFACE_FONT_BOLD` for the heavy weights); then the first installed family of Inter,
  Segoe UI, Helvetica Neue, Arial, Liberation Sans, DejaVu Sans, Noto Sans, Carlito, FreeSans
  (through `cadcraft_fonts::ttf::find`: system fonts found at run time, never bundled); then a
  Latin face of the optional craft-fonts build input (`CRAFT_FONTS_DIR`). The face is registered
  with the kernel for that one render (Slab's `inst_font_register`, with its bytes), so the text
  is shaped and measured with the face that paints it. `cadcraft_surface::png_font()` says which.
- **With no face, a PNG is refused**, in a sentence: `a PNG surface needs a font: no font was
  found to draw the text with (looked for Inter, …; CADCRAFT_SURFACE_FONT can name a .ttf or .otf
  file). The SVG form needs no font: ask for a .svg`. `--card out.png`, `--sheet out.png` and
  `(card)` all answer with it; nothing is written, and the picture is never drawn without its
  text. It does not fall back to SVG silently: the caller asked for a PNG, and an MCP client may
  not show an SVG.
- **So a PNG depends on the machine and an SVG does not.** Two machines with different fonts give
  different PNGs of the same drawing (the same machine gives the same bytes). Use the SVG where
  that matters.

## Not done

- No `CommandSpec` for the card or the sheet: an engine command cannot draw them (layering), and
  the precedent is `(render)` and `--export`, which are not commands either.
- The dashboard has no scrolling, no history and no mouse; its command line runs one line at a
  time through `Session::cmdline`.
- The desktop window and the browser do not have `(card)`.
- Amounts are printed with the decimal places the engine's reply shows; the engine does not say
  a currency's format, so there are no thousands separators or symbols.
