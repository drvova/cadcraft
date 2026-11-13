# Slab foundation, web side

Status: measured 2026-11-12 on headless Chromium (Linux), production build served by `vite preview`
unless said otherwise. The Slab shell is the default since 2026-11-13 wherever its artifacts are
built; `?shell=standard` shows the SolidJS shell, which is unchanged and is also what a checkout
without the artifacts shows (silently, unless `?shell=slab` asks by name). An earlier spike
(npm 0.1.0) found three blockers; this is the same technology built from source.

## The toolchain

- **Pin**: `stencil-hq/slab` at `65747371a18da9a54a94955473d0ec7f7fd07d5f` (2026-08-22, the head of
  `main` when it was chosen; the same commit the spike saw as "ahead of npm"), under a series of
  four patches. The pin and the series are shared with the Rust side and live in
  `third_party/slab/` (`SLAB.lock`, `patches/`, and a `README.md` that says what each patch
  does). `slab.lock.json` here is the record of the last reviewed build: the commit and patches
  it was built from, which a test holds equal to the pin, the tool versions and the sha256 of the
  four pinned artifacts.
- **Built by `scripts/build-slab.mjs`** (`bun run build:slab`): clone, reset to the commit, apply
  the series, then, all with `--no-default-features` (no bundled fonts; no runtime or kernel
  embedded in the compiler), `slab-kernel-wasm` (profile `wasm-release`) + wasm-bindgen 0.2.126,
  the web runtime (`bun scripts/build-web-runtime.ts`), `slab-wasm` (the compiler the playground
  runs in the browser; `--target web`), and `slab-cli`. Cold: about 3.5 minutes and a 1.5 GB cargo
  target directory (upstream pins `nightly-2026-07-28`, which rustup installs). Warm: about a minute.
  The wgpu driver is not built. Every artifact is searched for a font's name records before it
  is vendored, and the build fails if one is found.
- **Artifacts** (`src/slab-vendor/`, git-ignored, 14 MB): `slab-runtime.js` 86.5 kB,
  `wasm/slab_kernel_bg.wasm` 1.57 MB (it was 4.34 MB with Slab's fonts in it),
  `compiler/slab_wasm{.js,_bg.wasm}` 4.35 MB (11.5 MB), `bin/slab` 7.5 MB (14.8 MB),
  `licenses/` (Slab's MIT text; there is no font licence to carry), and the compiled documents
  (`shell.js`, `shell.slir`, `bench.js`, `bench.*.slir`: 96 kB in all, where they were 139 kB
  of mostly font tables).
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
- The compiler built here has no web runtime payload, so its `gen wc` returns the module and the
  SLIR without `slab-runtime.js` and the kernel: the interface loads the runtime and kernel the
  same build produced.

### Where it is built

- `cargo xtask ui` (so `cargo xtask ci`, which is what CI runs): builds the toolchain when what is
  in `src/slab-vendor/` does not match `slab.lock.json`, verifies it, and fails when the built
  `dist` holds no Slab runtime. `CADCRAFT_SKIP_SLAB=1` leaves Slab out on a box with no network.
- `packaging/env.sh` `build_interface` (Linux, macOS, web) and `packaging/windows/package.ps1`: the
  same, with no skip: a package without the Slab runtime stops.
- It needs git, rustup and the network, and takes several minutes the first time. Not yet run on
  macOS or Windows: `slab:verify` holds the wasm to checksums made on Linux, and a build that
  differs there will stop the package.

## Fonts

**No font is in the build.** Upstream's kernel compiles in eight faces (Inter and JetBrains Mono,
four weights each: 2.7 of its 4.3 MB, SIL OFL), and its web driver takes them back out of the
kernel and paints with them. The series in `third_party/slab` makes those faces a Cargo feature
(`bundled-fonts`), and this build turns it off: the kernel, the compiler and the runtime contain
no font bytes.

How it works on the font-less build:

- SLIR carries a `FONT` table per authored family and weight: a cmap and per-glyph advances, never
  font bytes. With no face to read, the compiler fills each table from a built-in default advance
  model (one advance for a monospaced class, six width classes for a proportional one; derived
  from no font file). `family` is kept as authored.
- `inst_font_register(family, weight, upem, ascent, descent, …, data, codepoints, glyphs, advances)`
  appends a runtime table; the latest matching family (case-insensitive) and nearest weight wins.
  `data` may be empty: then the kernel only measures and "the host owns that face".
- A family nobody registered is laid out with the default table, and the kernel says so once, by
  name, in the element's diagnostics (`font-default`). None is reported for the two documents here.

Chosen: **measure the face the page really paints, register the metrics, paint with the page's own
stack.** `src/slab/fonts.ts` measures `--font-family` and `--font-family-mono` with a canvas
(`measureText` per codepoint, kerning off as the driver paints), at each of the interface's type
sizes and four weights, and registers them through one added driver method,
`SlabElement.registerFontMetrics(name, metrics, cssFamily)` (patch 0003 of the series, about 40
added lines). Each type size is its own family to the kernel (`cadcraft-ui-13`, `-12`, `-11`,
`cadcraft-mono-12`), because a system face's advances do not scale linearly.

Proof, re-run on the font-less build (2026-11-12): the Slab Bench panel with `--font-family`
forced to DejaVu Sans, Liberation Sans and Carlito, against the screenshots of the build that
still had the fonts in it. All three are pixel-identical to those screenshots (`bench-slab-DejaVuSans`, `-LiberationSans`, `-Carlito`: 0 differing pixels), as are the default panel and the selected and pressed states. The right-aligned values end on the same edge as the SolidJS
panel's in all three, and nothing overruns. (The spike, which could not register metrics,
measured DejaVu 8.5% too wide and Carlito 14% too narrow.)

Trade-offs:

- A patch series to carry until upstream takes it or a fork holds it (four patches;
  `third_party/slab/README.md`).
- 368 codepoints are measured (Latin, Latin-1, Extended-A, the signs the interface writes): 16
  faces, a few milliseconds at start. Other text is charged a default advance and painted by the
  browser's fallback in a box of that width, so CJK or Cyrillic text in a Slab surface would be
  spaced wrongly until its range is added.
- Kerning and ligatures are off in a Slab surface (they are on in the rest of the interface).
- Not measured on Windows or macOS. The per-size families are there for them; they are untested.
- **The OFL question is closed.** It was open while the kernel and compiler wasm still contained
  Inter and JetBrains Mono: a `dist` built with the artifacts present would have shipped them
  inside `slab_kernel_bg-*.wasm`, with the duty to carry both OFL texts and an attribution row.
  They are no longer there to ship. The kernel is built with `--no-default-features`; the build
  searches every artifact for the faces' UTF-16 name records and copyright strings and fails on a
  hit (`scripts/build-slab.mjs`, `fontNamesIn`); a test holds the recorded kernel under 2.5 MB.
  Measured on this build: the kernel wasm is 1,566,589 bytes (4,338,926 before: 2,772,337 less, the size of the eight font files) and 616 kB gzipped (1.96 MB); the compiler wasm 4,318,765 (11,514,461); the name records `Inter` and `JetBrains Mono` in UTF-16 and both copyright strings occur 0 times in the kernel, the compiler, the runtime and the `slab` binary (32, 18 and 4 + 4 times in the old kernel). So there is no font licence to carry, no `ATTRIBUTION.md` row
  to add, and nothing for the owner to rule on.

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
Ready (canvas up, shell laid out), median of five: standard 565 to 594 ms, Slab 758 to 779 ms, against 862 to 885 ms for the same build with the old kernel, all on one machine that was also running a Rust test suite; on the quieter machine, Slab 625 ms (with the fonts in the kernel it was
standard 429 ms, Slab 659 ms). Loaded at start by the standard interface: no Slab file. Loaded by
`?shell=slab` on top: 106 kB of JS (the runtime is 85.4), the kernel wasm 1.57 MB (616 kB gzip) and 96 kB of SLIR, 1.70 MB in all where it was 4.50 MB; 22 requests against 11.

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

## Ported regions

Each is a document in `slab/`, a host in `src/slab/`, an optional member of `SlabParts` added by a
`with…` step in `main.tsx`; the SolidJS one shows in its place when its document does not load,
and the notice names the part. Logic is shared with the SolidJS component, not forked.

| Region | Document | Notes |
|---|---|---|
| Bench | `bench.slab` | above |
| Layers | `layers.slab` | host tooltips through `hints.ts`; the layer menu by pointer and keyboard; capped at 500 rows with a line for the rest; the off, frozen and locked inks are read from the page (`color-mix` is not in the token bridge) |
| Piece | `piece.slab` | the kernel's text field for numbers (a `hole` is forbidden in an `each`); a choice opens inline, not as a popup; focusing a field selects its value; the edit machine is `src/piece-edit.ts`, shared |
| Objects | `objects.slab` | a `virtual` list (about twenty rows laid out whatever the drawing holds); the search field is the SolidJS `ObjectsSearch` in a hole: the kernel's field has no word selection, no search role, and draws IME text over its placeholder |
| Status bar | `statusbar.slab` | toggles are switches (no `aria-pressed`); a pointer move over the drawing costs about 2 ms more script than the SolidJS bar (the driver re-syncs the whole accessibility layer each frame) |
| View tabs | `tabs.slab` | finger pan and edge fades are the host's |
| Properties | `properties.slab` | choices open a host-drawn listbox anchored to the row (`src/slab/popup.tsx`: a Slab overlay cannot leave its surface's box), which Piece uses too; the row logic is `src/props-edit.ts`, shared |
| Dialog bodies | `pricebook.slab`, `jewelry-dialog.slab` | the host's `Dialog` stays the frame; `src/slab/modal.tsx` owns Tab between the kernel's controls, the controls in holes and the frame; selects and free text are SolidJS controls in holes |
| Ribbon | `ribbon.slab` | the fold is the SolidJS strip's `toolsFit` fed with the document's measures; the glyph block is generated from `ICON_PATHS` (`ribbon-icons.ts`, `RIBBON_ICONS=write bun test src/slab/ribbon.test.ts`); round stroke caps come from a sheet the host adds to the shadow root; no `pointer-move` binder and no `transition`, each of which solves per step |
| Title bar | `topbar.slab` | the menu titles, the command centre, the layout keys; the menus and the palette are the SolidJS ones, opened from the bar; the title keys are `MenuBar`'s `titleKeyAction`, shared |
| Command line | `cmdline.slab` | the band, the history (a `virtual` list, selectable), the keywords, the error; the typed line is the page's field in a hole (`CommandField`): the kernel's field measured 12.5 ms from key to paint against 3 to 4, and selects no word |
| Assistant | `assistant.slab` | the frame only: title band, empty state, chips, the composer's card and toolbar. The conversation and the editor are SolidJS in holes: a Slab conversation copied a line break at every drawn line, took no link press, had no headings or lists for a screen reader, and cost 30 times the script while streaming |
| Drafting Settings, Template Gallery | `drafting.slab`, `template-gallery.slab` | on `modal.tsx`, a tab strip being one stop with arrows; a hidden surface measures the tallest page so the dialog does not move; the gallery's stills are the renderer's PNGs registered as images |

Known to be worse than SolidJS in all of them: one tab stop with arrows per surface; a pointer
press can show the focus ring; no kerning; a screen reader sees switches where SolidJS has pressed
buttons. The standard shell carries no Slab code, but sharing logic split its bundle: it loads a
few more chunks than before.

## Next (agent-hours)

Every region of the shell has a Slab part now. What is still SolidJS, and why:

1. **The Layer Manager** (16 to 24): an 892-line virtualised grid; decide first whether it keeps
   the SolidJS model (one Tab stop, arrows between cells) or takes `modal.tsx`'s.
2. **Menus, the command palette, the tech sheet**: not attempted; a menu must open over other
   regions, which a surface's overlay cannot.
3. **Text**: every free-text field, the assistant's conversation and editor. These wait on the
   kernel: word selection, a placeholder, copy that follows paragraphs, links, variable-height
   virtual rows (`setItemExtent` on the web element).
4. The status bar and the view tabs still bind `pointer-move`, a solve per move.

The driver clips every hole and paints it under the later ones, so `SlabShell` lets the bars'
holes out and raises them (`OPEN_PAST_EDGE`): before that the menu bar's menus opened unseen.

Before these, settle tooltips and a keyboard convention for surfaces (one stop with arrows, or
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
- New list items' accessibility nodes are appended, not placed in order (`element.ts`
  `#syncSemantics`); every frame re-syncs the whole layer.
- An `each` directly under `wrap` is one block; a `hole` is forbidden in an `each`; a `virtual`
  list must be a root list.
- A focused end-aligned field is scrolled 8 and keeps the scroll after blur.
- `when coarse { tokens … }` does not apply under a named theme; a scroll row does not pan by touch.
- The focus ring stays after blur and shows on a pointer press.
- `registerFont` needs bytes (patch 0003 of the series adds `registerFontMetrics`).
- The fonts are compiled in with no switch, and `slab-compile` does not build from a clean
  checkout (patches 0002 and 0001).

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
- The fork is decided, as a patch series (`third_party/slab`): the clean build, the fonts as a
  feature, the metrics registration and the SVG family fix. Still to add to it: fixes for the
  hole-shrink and hole-over-sash bugs (in the driver; not one-screen fixes).

## Not run or not verified

- Windows, macOS, Firefox, Safari, a touch device, a screen reader itself (the tree was read
  through the browser's accessibility API, not listened to).
- IME and text fields in a Slab surface; virtual lists; anchored overlays.
- The 3D tab with a real piece in it (the sample has none; the tab mounted and showed its empty state).
- The desktop webview (`apps/cadcraft`), `cargo xtask ci`, `verify:facade`.
- Reduced motion visually (above). Whether the artifact checksums reproduce on another machine.

## Removing it

Delete `slab/`, `slab.lock.json`, `src/slab/`, `scripts/build-slab.mjs` and this file (and
`third_party/slab/` if the Rust side's surfaces go too: the pin is shared); revert the
marked parts of `src/main.tsx` and `src/app.tsx` (the `slab` and `shellNotice` props and the
`if (slab !== undefined)` branch; the region closures can stay), the three `package.json` scripts,
the `.gitignore` lines, the `check-system.config.json` exclude and the README section.
