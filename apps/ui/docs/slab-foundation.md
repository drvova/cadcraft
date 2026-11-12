# Slab foundation, web side

Status: measured 2026-11-12 on headless Chromium (Linux), production build served by `vite preview`
unless said otherwise. Behind `?shell=slab`; the standard interface is unchanged. An earlier spike
(npm 0.1.0) found three blockers; this is the same technology built from source.

## The toolchain

- **Pin**: `stencil-hq/slab` at `65747371a18da9a54a94955473d0ec7f7fd07d5f` (2026-08-22, the head of
  `main` today; the same commit the spike saw as "ahead of npm"). `slab.lock.json` holds the commit,
  the patch's checksum, the tool versions and the sha256 of the four pinned artifacts.
- **Built by `scripts/build-slab.mjs`** (`bun run build:slab`): clone, reset to the commit, apply
  `slab/patches/*.patch`, then `slab-kernel-wasm` (profile `wasm-release`) + wasm-bindgen 0.2.126,
  the web runtime (`bun scripts/build-web-runtime.ts`), `slab-wasm` (the compiler the playground
  runs in the browser; `--target web`), and `slab-cli`. Cold: about 3.5 minutes and a 1.5 GB cargo
  target directory (upstream pins `nightly-2026-07-28`, which rustup installs). Warm: about a minute.
  The wgpu driver is not built.
- **Artifacts** (`src/slab-vendor/`, git-ignored, 30 MB): `slab-runtime.js` 86.5 kB,
  `wasm/slab_kernel_bg.wasm` 4.34 MB, `compiler/slab_wasm{.js,_bg.wasm}` 11.5 MB, `bin/slab` 14.8 MB,
  `licenses/`, and the compiled documents (`shell.js`, `shell.slir`, `bench.js`, `bench.*.slir`).
- **Documents** are compiled by the vendored wasm compiler running under Bun (`bun run slab:docs`,
  0.3 s, no Rust), as web components (`gen wc`: what upstream recommends for a page). The tokens
  module the documents import (`slab/gen/tokens.slab`) is generated from `src/tokens.css` first.
  Nothing recompiles a document automatically: after editing a `.slab` or `tokens.css`, run it.
- **Consumed** by `src/slab/loader.ts` through `import.meta.glob`, as the engine's wasm is. Absent,
  the globs are empty: the build is the same minus the lazy chunks, and `?shell=slab` shows the
  standard shell with "The Slab shell is not built here (bun run build:slab in apps/ui); showing the
  standard interface." beside the command field.
- The script never touches the wasm-bindgen on PATH (upstream's own `xtask kernel-wasm` would
  replace it with 0.2.126 by `cargo install`; this repository's engine build uses another version).

## Fonts

How it works at the pinned commit:

- SLIR carries a `FONT` table per authored family and weight: a complete cmap and per-glyph
  advances, never font bytes. `family` is kept as authored; a name containing "mono" is measured
  with JetBrains Mono's table and any other with Inter's.
- The kernel wasm embeds eight faces (Inter and JetBrains Mono, four weights each: 2.7 of its 4.3
  MB). The web driver takes each table's bytes back out of the kernel (`font_data`), makes a
  `FontFace` of them and paints with it. So an unassisted document is laid out and painted in
  Inter on every machine: correct, and not the interface's font.
- `inst_font_register(family, weight, upem, ascent, descent, …, data, codepoints, glyphs, advances)`
  appends a runtime table; the latest matching family (case-insensitive) and nearest weight wins.
  `data` may be empty: then the kernel only measures and "the host owns that face". The web driver
  exposes this only as `registerFont(name, bytes)`, which needs a font file.

Chosen: **measure the face the page really paints, register the metrics, paint with the page's own
stack.** `src/slab/fonts.ts` measures `--font-family` and `--font-family-mono` with a canvas
(`measureText` per codepoint, kerning off as the driver paints), at each of the interface's type
sizes and four weights, and registers them through one added driver method,
`SlabElement.registerFontMetrics(name, metrics, cssFamily)`
(`slab/patches/0001-web-host-owned-font-metrics.patch`, about 40 added lines; the same patch stops the
driver loading the bundled face for a family the host owns). Each type size is its own family to
the kernel (`cadcraft-ui-13`, `-12`, `-11`, `cadcraft-mono-12`), because a system face's advances
do not scale linearly.

Proof: `font-proof.png` (the Slab Bench panel left, the SolidJS one right, with `--font-family`
forced to DejaVu Sans, Liberation Sans and Carlito). The right-aligned values end on the same edge
as the SolidJS panel's in all three, and nothing overruns. The spike measured DejaVu 8.5% too wide
and Carlito 14% too narrow.

Trade-offs:

- One patch to carry until upstream takes it.
- 368 codepoints are measured (Latin, Latin-1, Extended-A, the signs the interface writes): 16
  faces, a few milliseconds at start. Other text is charged a default advance and painted by the
  browser's fallback in a box of that width, so CJK or Cyrillic text in a Slab surface would be
  spaced wrongly until its range is added.
- Kerning and ligatures are off in a Slab surface (they are on in the rest of the interface).
- Not measured on Windows or macOS. The per-size families are there for them; they are untested.
- **OFL duty.** The kernel wasm and the compiler wasm still contain Inter and JetBrains Mono. They
  are never committed, never painted with and (with the patch) never loaded into the page, but a
  `dist` built with the artifacts present ships them inside `slab_kernel_bg-*.wasm`. Redistributing
  that requires the two OFL texts to go with it: they are in `src/slab-vendor/licenses/` and are not
  yet copied into `dist` or shown in the interface, and `ATTRIBUTION.md` has no row. The owner must
  rule before a build with the Slab shell is shipped. The clean end is a kernel built without the
  faces (a cargo feature on `slab-fonts`; not attempted): the wasm would drop to about 1.6 MB.

## The spike's blockers, on this commit

| | Result | Evidence |
|---|---|---|
| Text selectable | **Yes**, with `select` on a box. A drag across the Bench summary selected it, and Ctrl+C put ".35 ct · 3.86 g" on the clipboard. Text inside a focusable (a pressable line) is not selectable, as a button's is not. | `bench-slab-selected.png`, `t2.out` |
| Copy | The kernel's selection is not the page's, so the shell's Ctrl+C handler (COPYCLIP) would take the key: `surface.ts` asks the surface first. | same |
| Accessibility tree | **Real.** Roles and names for the heading, the list, list items, buttons with descriptions, `expanded` on the fold key. `act=` gives no role: every control must write `role=`. | `t2.out` (both trees) |
| Hidden content | A node collapsed with `max-h=0`, or `inert`, **stays in the tree**. Conditional content has to be a child of a `when` (absent when false), or left out by the host. | found on the cost group |
| Tab | **Still a trap** without help: the kernel walks its own ring and wraps. With Tab kept from the kernel (`surface.ts`) a surface is one tab stop, arrows move inside, Tab leaves; focus is no longer stolen back from the page. | `t2.out`, `t7` tab order |
| Reduced motion | The driver reads neither `prefers-reduced-motion` nor anything of the page. The host selects a `still` theme (all durations 0) from `data-animations`; the theme is selected correctly. **Not proven visually**: no tween was observed on the Bench rows with animations on either, so the two modes could not be told apart. | `t7`, `t8` |
| Theme | `when dark` follows the OS. Named themes follow the host: with the OS dark and `data-theme="light"` the surfaces are light, and the reverse. | `t7`, `theme-light-os-dark.png` |
| Browser compiler | Solved by building `slab-wasm` from source: the documents here are compiled by it. Not yet used in the page. | `build:slab` |

## The shell

`slab/shell.slab` (70 lines) is the whole outer layout: ten holes, a `splits` row of three panes,
seven bool params and seven heights. `app.tsx` composes each region once and hands the same
closures to either shell.

Decided by the kernel: every region's rectangle; which panes show (`when` over `sidebar`,
`assistant`, `narrow`, `compact`; conjunctions are written as ordered patches, last wins); the
bars' show and hide; the dividers' hit testing, drag, clamps, arrow keys and double click; the
painting of pane backgrounds, seams and the divider's accent.

Not decided by the kernel, and why:

- **The width class.** `when w<N` reads the constraint of the node it is on; inside a pane that is
  the pane's width, not the window's (SPEC §10). The breakpoints are tokens of the document and the
  host compares the element's width with them.
- **The bars' heights.** A `hug` hole cannot shrink: the driver reports the hole's `scrollHeight`,
  which is never less than the hole (`clients/web/element.ts`, `#measureHoleContent`). The host
  measures each bar and sets a num param.
- **Pane widths over time.** `splits` rescales all panes in proportion when the row resizes or a
  pane hides, and a pane that was hidden returns at its minimum (`layout.rs`,
  `normalize_split_sizes`). The host remembers the two side widths and writes them back after any
  solve that drifted (`panes.ts`). This costs one extra frame after a toggle or a resize.
- **The dividers' reach.** Holes sit above the painted layer and swallow the pointer, so a divider
  between two holes cannot be hit. Each side pane keeps a 4 u strip at its inner edge.
- **The bench sheet's cap** (two fifths of the rail): `max-h` takes no percentage.
- A pane with no room still holds its content; the host sets `hidden` on those slots.

Checked inside the holes (`t3.out`): a line drawn with the pointer (55 → 56 objects), wheel zoom,
window selection with grips, middle-button pan, the canvas backing store following the hole, the
command line growing, the 3D tab, the palette, F6 through all four regions, Ctrl+B / Ctrl+7 /
Ctrl+9, pane widths surviving a reload.

Against the standard shell (`pair-*.png`; magenta divides standard | Slab):

- 390 wide, all three states: pixel-identical, except the sidebar's bench area.
- 1440, 1024, 768, both themes: 2 to 3.6% of pixels differ, all in the sidebar: it is 4 px narrower
  inside (the seam), and the Bench section takes its natural height before the other sections
  share the rest, so Piece and Properties are cut a row earlier than in the standard shell.
- The dividers are the page's first tab stop and have **no role and no name** (the kernel's
  synthetic sash takes none). The standard shell's assistant handle is named.
- The sidebar is now resizable (it was fixed at 252); the assistant keeps its drag.
- A pointer press on a Slab row shows the keyboard focus ring (`bench-slab-pressed.png`).
- No tooltips in a Slab surface (the interface's tooltip reads `data-hint` from the page's DOM).
- After a toggle the panes are right one frame late.

Performance: kernel solve of the shell 0.2 ms median, 0.6 ms p95 (alternating widths); a split
write 0.1 ms; the Bench panel 0.4 ms. A divider drag painted at 16.7 ms median frame gap, 21.9 p95.
Ready (canvas up, shell laid out), median of five: standard 429 ms, Slab 659 ms. Loaded at start
by the standard interface: no Slab file. Loaded by `?shell=slab` on top: 106 kB of JS (the runtime
is 85.4), the kernel wasm 4.34 MB (1.96 MB gzip) and 54 kB of SLIR; 22 requests against 11.

## The Bench panel

| | SolidJS | Slab |
|---|---|---|
| View | `BenchPanel.tsx` 111 lines + 96 lines of CSS | `bench.slab` 109 lines |
| Host | (the component) | `SlabBench.tsx` 32 + `bench-params.ts` 79 |
| Depends on | `Row`, `IconButton`, `Button`, `SectionLabel`, the tooltip | tokens only |

- Look: `bench-compare.png`, `pair-*`. Same rows, inks, insets and edges in both themes; 4 px
  narrower with the rail.
- Keyboard: SolidJS has a tab stop per control; Slab has one stop and arrows. Enter and Space
  press. Both work; they are different conventions.
- Screen reader: the same tree. Slab's lines say "Selected on the drawing" in their description
  where SolidJS sets `aria-current` (Slab has `selected`, `checked`, `expanded`; no `current` or
  `pressed`). The folded or absent parts are absent from the tree in both.
- Awkward: no expressions, so every string and every boolean is shaped by the host; a `def` prop
  named `label` or `desc` shadows the attribute; `w=fill` on a leaf list item silently hugs;
  uppercase is typed; three exported defs make four elements and four SLIR files (20 to 32 kB
  each, mostly font tables); it is a second component system that none of `src/ui`'s rules check.
- Better: the layout cannot overlap or overflow, the document is checked by a compiler, and the
  same file would paint in the native and terminal drivers.

## Next panels (agent-hours, in the order recommended)

1. **Layers** (4 to 6): a list with three toggles and a swatch; needs a context-menu signal and
   the host's tooltip. Proves lists with several controls per row.
2. **Piece** (6 to 8): buttons, rows of results and checks; little input.
3. **Objects** (8 to 12): a tree (`list` of `list`), a search field (the kernel's text editing and
   IME, untested here), `virtual` for long lists.
4. **Properties** (12 to 16): fields, selects and checkboxes per row. A select is an anchored
   overlay the host must dismiss and focus-manage (§6.10); this is the first real test of fields.
5. **Status bar and tabs** (4 to 6 each).
6. **Ribbon** (12 to 16): overflow folding, a menu, tooltips on every key.
7. **Dialogs** (16 to 24 for the layer, then 4 to 8 each): no modal primitive; focus trapping and
   restoration are the host's.

Before 3 and 4, settle tooltips and a keyboard convention for surfaces (one stop with arrows, or
let Tab through per control with a kernel change).

Missing or broken for this application at the pinned commit:

- `hug` holes cannot shrink (`clients/web/element.ts` `#measureHoleContent`).
- A divider or sash between two holes cannot be reached (`.slab-hole { pointer-events: auto }`).
- Synthetic sashes have no role, label or value (§6.12).
- `splits` has no "fixed pane, flexible pane" mode (§6.12, `layout.rs` `normalize_split_sizes`),
  and a fixed seed beside `w=fill` weighs the fill as 1.
- No window-width condition for a nested node, and no conjunction of conditions (§10).
- Collapsed and `inert` nodes stay in the accessibility layer (`element.ts` `#syncSemantics`).
- Tab is not released at the ends of the focus ring (§15.3).
- No `prefers-reduced-motion`, no host motion switch (§14).
- `max-w`/`max-h` take no percentage (§5).
- No `aria-current`, `aria-pressed` (§15.2).
- `registerFont` needs bytes (patched here).

## Upstream risk

- README: "pre-alpha … no maintenance expectation". One commit since npm 0.1.0's tag range was
  examined; no release cadence.
- Spec against implementation: `hug` holes "report natural size" (§13.2) but cannot shrink; "nested
  `when` is an error" (§10) yet a node inside a `when`'s children may carry its own `when`s (used
  by `bench.slab`); `a11y: full on web` omits hidden and synthetic nodes' problems above; the
  support chart is otherwise accurate for what was exercised.
- Surface depended on (all of it is in `src/slab/types.ts`): `setParam`, `setList`, `setTheme`,
  `setSplit`, `getSplit`, `getToken`, `sceneSnapshot` (key, w, h), `clearFocus`, the `slab-frame`
  event, signal events' `detail.item`, the `copy` event behaviour, `registerFontMetrics`; the
  compiler's `gen_wc_with_sources`, `compiler_version`, `initSync`; the generated tags
  (`cadcraft-shell`, `slab-bench-panel`) and the scene keys `#shell/#work/#side|#editor|#chat`.
- A fork would carry: the one patch; fixes for the hole-shrink and hole-over-sash bugs (small, in
  the driver); and, for shipping, a kernel build without the bundled faces.

## Not run or not verified

- Windows, macOS, Firefox, Safari, a touch device, a screen reader itself (the tree was read
  through the browser's accessibility API, not listened to).
- IME and text fields in a Slab surface; virtual lists; anchored overlays.
- The 3D tab with a real piece in it (the sample has none; the tab mounted and showed its empty state).
- The desktop webview (`apps/cadcraft`), `cargo xtask ci`, `verify:facade`.
- Reduced motion visually (above). Whether the artifact checksums reproduce on another machine.

## Removing it

Delete `slab/`, `slab.lock.json`, `src/slab/`, `scripts/build-slab.mjs` and this file; revert the
marked parts of `src/main.tsx` and `src/app.tsx` (the `slab` and `shellNotice` props and the
`if (slab !== undefined)` branch; the region closures can stay), the three `package.json` scripts,
the `.gitignore` lines, the `check-system.config.json` exclude and the README section.
