# CADCraft UI (`apps/ui`)

The interface: **SolidJS + TypeScript + Vite**, drawing through a `<canvas>` and talking to the
Rust engine through the `crates/wasm` facade (`plan/solid-ui-migration.md`, phases 1–2).

Phase 1 was the vertical slice (canvas with pan/zoom, command line, layers panel, chrome
skeleton). Phase 2 is the chrome: the **menu bar** (the full command registry tree, nested
submenus, shortcuts, disabled states), the **tool strip**, the **status bar** (layout tabs,
drafting toggles, coordinates, selection count), the **properties palette** (defaults, single and
multiple selection, edits through `properties.set`), and the command line's **clickable keywords**
and history. Selection works on the canvas (click to pick with the engine's pickbox aperture,
Shift to add, Escape to clear) and the drawing's light theme is in `tokens.css` (View ▸ Interface
Theme).

The engine stays pure Rust; this app contains no geometry logic (the canvas only maps world →
screen and draws the primitives the engine's display list hands it).

## Run it

```sh
bun install
bun run dev          # http://127.0.0.1:5187  (add ?mock=1 to force the mock facade)
bun run build        # tsc --noEmit && vite build → dist/
bun test             # the pure parts: view math, display-list parser, prompt machine, the shim
```

### The facade, and the mock

`src/facade.ts` is the single module that loads and calls the wasm facade; `src/wasm-loader.ts`
is the only place that touches the generated glue. The app runs in one of two modes, shown in the
top bar:

- **wasm** — `crates/wasm` was built into `src/wasm/` (see below).
- **mock** — the canned engine in `src/mock.ts`, used when the wasm module is missing, fails to
  load, or `?mock=1` is in the URL. The mock implements the same JSON contract and carries a
  sample drawing that exercises every primitive kind (polyline, tris, point, image), including the
  two-step `circle` prompt cycle.

### Building the wasm facade

```sh
bun run build:wasm     # → scripts/build-ui-wasm.mjs
```

which runs

```sh
cargo build -p cadcraft-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir apps/ui/src/wasm target/wasm32-unknown-unknown/release/cadcraft_wasm.wasm
```

The script fails loudly with cargo's own output when the facade does not build yet; the UI still
runs on the mock. `apps/ui/src/wasm/` is generated and git-ignored.

## Layout

```
src/facade.ts        the one module that loads and calls the facade; mock/real switch
src/wasm-loader.ts   the only importer of the generated wasm glue (lazy, Vite-only)
src/mock.ts          the canned facade for development before crates/wasm lands
src/view.ts          world↔screen mapping, pan, zoom-around-pointer (pure)
src/display.ts       the display-list parser (the trust boundary for engine bytes)
src/prompt.ts        the command line's prompt/output state machine (pure)
src/canvas.ts        the canvas 2D renderer: polyline / tris / point / image
src/app.tsx          the shell: state wiring, invocation contract, visibility toggles, theme
src/commands.ts      the menu tree from the command registry + the ui.* items the web shell honours
src/icons.ts         the tool-strip icons, drawn in code (24×24 SVG paths — no image assets)
src/files.ts         browser file I/O: pick a file to open, download what the engine saves
src/selection.ts     the pick aperture and click selection semantics (pure)
src/props.ts         the properties palette's parsing and patch building (pure)
src/components/      TopBar, MenuBar, ToolStrip, StatusBar, CanvasView, LayersPanel,
                     PropertiesPanel, CommandLine
src/chrome.css       menu bar, tool strip, status bar
src/interaction.css  properties rows and keyword chips
src/tokens.css       the design tokens, measured from Cursor 3.27.22 (2026-10-28)
src/styles.css       the layout (flex/grid) and component chrome
```

## Tokens

`src/tokens.css` carries the values measured from the running Cursor 3.27.22 desktop app
(2026-10-28; `.design-system/research/cursor-recipes-2026-10-28.md`) — not a hand-copy of
`crates/ui-egui/src/theme.rs`, which stays the frozen egui reference until the migration's phase 5
retires it. The tables below keep their `theme.rs` column as the record of where each token's role
came from; the colour values in them are superseded by the measured ladder in `tokens.css`. The
mapping, token for token:

| `tokens.css` | `theme.rs` (`Tokens::DARK`) | value |
|---|---|---|
| `--chrome` | `chrome` | `#141414` |
| `--chrome-dark` | `chrome_dark` | `#0f0f0f` |
| `--panel` | `panel` | `#141414` |
| `--tab-active` | `tab_active` | `#2d2d2d` |
| `--control` | `control` | `#1c1c1c` |
| `--control-hover` | `control_hover` | `#232323` |
| `--border` | `border` | `#232323` |
| `--canvas` | `canvas` | `#181818` |
| `--grid-minor` | `grid_minor` | `#202020` |
| `--grid-major` | `grid_major` | `#2a2a2a` |
| `--axis-x` | `axis_x` | `#552633` |
| `--axis-y` | `axis_y` | `#23412f` |
| `--text` | `text` | `#d4d4d4` |
| `--text-dim` | `text_dim` | `#888888` |
| `--text-faint` | `text_faint` | `#6b6b6b` |
| `--icon` | `icon` | `#b0b0b0` |
| `--icon-accent` | `icon_accent` | `#81a1c1` |
| `--icon-point` | `icon_point` | `#f1b467` |
| `--accent` | `accent` | `#81a1c1` |
| `--selection` | `selection` | `#81a1c1` |
| `--hover` | `hover` | `#b8cee6` |
| `--grip-hot` | `grip_hot` | `#e34671` |
| `--warn` | `warn` | `#f1b467` |
| `--error` | `error` | `#e34671` |
| `--snap` | `snap` | `#3fa266` |
| `--toggle-on` | `toggle_on` | `#3fa266` |
| `--cmd-bg` | `cmd_bg` (`0xf0` alpha) | `rgba(28,28,28,0.94)` |
| `--cmd-border` | `cmd_border` | `#333333` |
| `--cmd-keyword` | `cmd_keyword` | `#81a1c1` |
| `--cmd-keyword-hover` | `cmd_keyword_hover` | `#2a3037` |
| `--cmd-history` | `cmd_history` (`170/255`) | `rgba(26,26,26,0.667)` |
| `--list-bg` | `list_bg` | `#1c1c1c` |
| `--list-row` | `list_row` | `#2d2d2d` |
| `--icon-layer-off` | `icon_layer_off` | `#8a8a5a` |
| `--icon-layer-frozen` | `icon_layer_frozen` | `#9fd4ff` |
| `--icon-locked` | `icon_locked` | `#e6b43c` |
| `--icon-current` | `icon_current` | `#6fe06f` |
| `--layer-current` | `layer_current` | `#4cc25a` |
| `--swatch-border` | `swatch_border` (`gray(25)`) | `#191919` |
| `--on-accent` | `on_accent` | `#141414` |
| `--crosshair` | `crosshair` | `#e4e4e4` |
| `--paper` | `paper` | `#fcfcfc` |

Geometry and type come from the recipe constants in the same file:

| `tokens.css` | `theme.rs` | value |
|---|---|---|
| `--radius-control` / `--radius-small` / `--radius-card` / `--radius-composer` / `--radius-pill` | `RADIUS_CONTROL` … `RADIUS_PILL` | 2 / 3 / 4 / 5 / 11 px |
| `--gap-2` … `--gap-16`, `--gap-default` | `GAP_2` … `GAP_16`, `GAP_DEFAULT` | 2, 3, 4, 5, 6, 8, 10, 12, 16 px (default 4) |
| `--control-h-button` / `--control-h-input` / `--control-h-row` / `--control-h-tab` | `CONTROL_H_BUTTON` … `CONTROL_H_TAB` | 28 / 24 / 22 / 35 px |
| `--button-pad-x` / `--button-pad-y` / `--field-pad-x` / `--field-pad-y` | `BUTTON_PAD_*`, `FIELD_PAD_*` | 8/4, 6/4 px |
| `--card-padding` | `CARD_PADDING` | 16 px |
| `--font-button` / `--font-chip` / `--font-label` | `FONT_BUTTON`, `FONT_CHIP`, `FONT_LABEL` | 14 / 11 / 12 px |
| `--font-small` / `--font-body` / `--font-mono` | `small()`, `body()`, `mono()` | 11.5 / 13 / 12 px |
| `--hairline`, `--focus-outline-w`, `--focus-outline-offset`, `--hover-opacity` | `HAIRLINE`, `FOCUS_OUTLINE_W`, `FOCUS_OUTLINE_OFFSET`, `HOVER_OPACITY` | 1 px, 1 px, −1 px, 0.8 |

No colour or size is written outside this file (and `styles.css` reads only these variables).
`src/canvas.ts` reads the model-space colours (`--canvas`, `--grid-*`, `--axis-*`) from the CSS
custom properties at runtime, so the canvas and the chrome cannot drift.

## What this slice does not do yet

Selection, grips, snap, dialogs and the ribbon are later phases (`plan/solid-ui-migration.md`).
`image` primitives draw their quad's frame only — the facade's v1 display list carries no pixels.
