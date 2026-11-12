# CADCraft UI (`apps/ui`)

The interface: **SolidJS + TypeScript + Vite**. It draws through a `<canvas>` and reaches the
Rust engine only through the `crates/wasm` facade. The same build runs in a browser tab and in
the desktop app (`apps/cadcraft`), which is this interface in a native window on the system
webview.

The engine stays pure Rust. This app holds no geometry logic: the canvas maps world to screen
and draws the primitives the engine's display list hands it, and every pick, snap and preview
is the engine's answer.

Rules for changing the interface are in [AGENTS.md](AGENTS.md); the design system's pages are in
`docs/system` (hand-written) and `docs/generated` (built from them).

## Run it

```sh
bun install
bun run build:wasm   # crates/wasm → src/wasm/ (generated, git-ignored)
bun run dev          # http://127.0.0.1:5187  (add ?mock=1 to force the mock facade)
bun run build        # tsc --noEmit && vite build → dist/
```

In the desktop window, from the repository root:

```sh
cargo run -p cadcraft -- --dev        # shows the running dev server, so a change is seen live
cargo run --release -p cadcraft       # shows the build embedded from apps/ui/dist
```

Without `dist/` the desktop binary still builds, and its window says how to make the build.

## The gates

| Command | What it checks |
|---|---|
| `bun test` | The unit tests: view math, the display-list parser, the prompt machine, selection, properties, menus, the palette's ranking, the assistant, the facade and each component of `src/ui` |
| `bun run check` | `typecheck`, then `check:system` (no raw values, no second copy of a component, with a ratchet), `check:spec` (each spec in `docs/system` leaves no question open) and `check:docs` (the generated docs match their sources) |
| `bun run build` | Type check and the production build |
| `bun run verify:facade` | The real wasm facade against the JSON contract the mock implements |
| `node scripts/contrast-report.mjs` | The contrast of every measured colour pair, in both themes |

`cargo xtask ui` runs `build:wasm`, `typecheck`, `bun test`, `build` and `check` in that order,
and `cargo xtask ci` ends with it. Where `bun` is not installed the step is skipped with a note
(`--strict` makes that a failure).

## The facade, and the mock

`src/facade.ts` is the one module that loads and calls the wasm facade; `src/wasm-loader.ts` is
the only place that touches the generated glue. The app runs in one of two modes, shown at the
start of the status bar:

- **wasm**: `crates/wasm` was built into `src/wasm/`.
- **mock**: the canned engine in `src/mock.ts`. It is used when `?mock=1` is in the URL, when the
  wasm module is not built, or when it fails to load. The mock implements the same JSON contract
  and carries a sample drawing that exercises every primitive kind (polyline, tris, point,
  image) and the two-step `circle` prompt. It is for working on the interface without a wasm
  build; it is not the engine, so nothing drawn in it is measured.

`bun run build:wasm` runs `scripts/build-ui-wasm.mjs` at the repository root, which is:

```sh
cargo build -p cadcraft-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir apps/ui/src/wasm target/wasm32-unknown-unknown/release/cadcraft_wasm.wasm
```

The script fails loudly with cargo's own output when the facade does not build.

What the facade answers (`crates/wasm/src/lib.rs`): `execute`, `cmdline`, `start`, `cancel`,
`prompt`, `state`, `selection`, `settings`, `format_point`, `commands`, `source`, `run_script`,
`display`, `set_view`, `view`, `open_bytes`, `load_sample`, `save_bytes`, `digest`, and the
pointer's calls: `set_viewport` (the canvas's size), `set_cursor`, `preview` (the running
command's rubber band), `pick` (what is under the pointer and what a hover lights, leaving the
selection alone), `snap` (the object snap at a point), `pointer` (the point a click will take
under object snap, grid snap, polar and object snap tracking and ortho, what constrained it, a
label, the rays to draw and the rubber band there, in one call a frame) and `click` (a point
given to the running command, resolved as `pointer` reported). Each refuses a number that is
not finite or is out of range.

## The shell

The window is laid out as an editor:

| Part | What it is |
|---|---|
| Title bar | The menus (in groups, each row with the name typed at the command line and its shortcut), the command centre (the drawing's name; it opens the command palette) and three keys that fold the sidebar, the command line and the assistant |
| Tool strip | File, undo and redo, draw (line, polyline, circle, arc, rectangle, hatch, text), modify (move, copy, rotate, mirror, offset, trim, fillet, erase), linear dimension, zoom and pan, properties, layers, measure and print |
| Sidebar | Layers (current layer, on, frozen and locked keys) and Properties (the selection's values, edited through `properties.set`) |
| Editor tabs | Model and the drawing's layouts |
| Drawing | The canvas |
| Panel | The command line: history, the prompt, keyword chips |
| Assistant | The model's panel, on the right |
| Status bar | The engine mode, the current layer, counts, the selection, the drafting toggles and the coordinates |
| Command palette | Every command, searched by name, menu path or alias, the recently used first |

At narrow widths: at 900px and under the menus fold into one Main menu key, and the sidebar
steps aside while the assistant is open; at 700px and under a submenu opens in place under its
row (also in a short window); at 560px and under the sidebar is hidden and an open assistant
takes the whole workspace, with the drawing one key away. A tool strip wider than the window keeps the
leading groups that fit and folds the rest behind one overflow key, whose menu keeps the strip's
groups. The status bar gives up the
layer name's width, the counts, the mode badge and the coordinates, in that order, and never
clips a toggle.

## The pointer on the drawing

| Gesture | At rest | While a command runs |
|---|---|---|
| Left click | Picks the object under the pointer (adds; Shift removes, as `PICKADD` says) | Gives the command the point the engine resolved: the object snap the marker shows, else the grid point, the polar or tracking path, or the ortho axis; at "Select objects" it picks |
| Left drag | A selection rectangle: to the right a window, to the left a crossing | The same rectangle, given to a command that asks for objects |
| Pointer move | Lights what a click would select (not an object the selection-preview filter leaves out, such as one on a locked layer) | Draws the command's rubber band, the object-snap marker with its name, the ortho or polar ray with a label ("Polar: 4.2500 < 45°"), the grid dot, and the acquired tracking points with their paths |
| Shift, Ctrl | Shift removes from the selection | Shift flips ortho while held; Ctrl is passed to the engine (ARC's direction) |
| Right click | Enter (repeats the last command) | Enter |
| Middle drag | Pan | Pan |
| Two middle clicks | Zoom to the extents | Zoom to the extents |
| Wheel | Zoom about the pointer | Zoom about the pointer |
| One finger | Pan | Pan |
| Two fingers | Pan and pinch about their centre | Pan and pinch |

The drafting toggles act on the pointer at once, in the middle of a command too: F3 object snap,
F8 ortho, F9 grid snap, F10 polar tracking, F11 object snap tracking.

Not there yet: grips, a right-click menu, dynamic input, Tab to cycle snap candidates. The
author of the constraint work tried ortho, polar, grid snap and tracking in Chromium on the wasm
engine; the deferred tangent and ARC's Ctrl switch are covered by Rust tests only, and nothing
was checked at narrow widths. Touch is implemented and covered by unit tests of the view math,
and has not been tried on a device. Only Chromium has been exercised.

## Keyboard

On macOS the chords use Cmd in place of Ctrl.

| Key | What it does | Where |
|---|---|---|
| Ctrl+Shift+P, F1 | Open or close the command palette | Anywhere |
| Ctrl+B | Fold or show the sidebar | Anywhere |
| Ctrl+J | Bring the command line up and focus it; pressed in it, fold it away | Anywhere |
| Ctrl+1 | Fold or show Properties | Anywhere (a browser keeps Ctrl+1 for its tabs; the desktop window does not) |
| Ctrl+7 | Fold or show the assistant | Anywhere |
| Ctrl+9 | Fold or show the command line | Anywhere (as Ctrl+1) |
| F6, Shift+F6 | Move to the next or previous part: sidebar, drawing, command line, assistant | Anywhere |
| F3 | Object snap on or off | Anywhere, and it acts in the middle of a command |
| F7 | Grid (the setting only: the canvas draws its own grid) | Anywhere |
| Shift (held) | Flip ortho | The drawing, while a command wants a point |
| F8 | Ortho mode | Anywhere, mid-command too |
| F9 | Snap mode (grid snap) | Anywhere, mid-command too |
| F10 | Polar tracking | Anywhere, mid-command too |
| F11 | Object snap tracking | Anywhere, mid-command too |
| F12 | Dynamic input (the setting only: the interface draws no dynamic input) | Anywhere |
| Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Z, Ctrl+Shift+Z and every other chord a command carries | Run that command, as its menu item does | Anywhere but under an open menu, palette or sheet; a text field keeps its own undo, redo, select all and clipboard |
| Escape | Cancel the running command; with none running, clear the selection | The drawing, or the command line when its field is empty |
| Enter, Space | The command line's empty Enter: repeat the last command, or accept the running command's default | The drawing |
| Any character | Starts typing at the command line | The drawing, or with the focus on nothing editable |
| Enter | Send the line | Command line |
| Escape | Clear what is typed | Command line |
| Up, Down | Walk the lines sent, newest first | Command line |
| Left, Right | Move between menu titles | Menu bar (one Tab stop) |
| Down, Enter, Space | Open the menu on its first row (Up: on its last) | Menu bar, Main menu key, tool strip overflow key |
| Up, Down, Home, End, a letter | Move among the rows | An open menu |
| Right, Left | Open a submenu, close it (or move to the next or previous title's menu) | An open menu |
| Enter, Space | Run the row | An open menu |
| Escape | Close one level | An open menu |
| Left, Right, Home, End | Move among the keys (one Tab stop each) | Tool strip, editor tabs, status toggles |
| Enter, Space | Switch to the tab in focus (the arrows only move) | Editor tabs |
| Up, Down, Page Up, Page Down | Move the lit row | Command palette |
| Ctrl+Home, Ctrl+End | First and last row (Home and End alone when the field is empty) | Command palette |
| Tab | Write the lit command's name into the field | Command palette |
| Enter | Run the lit command | Command palette |
| Enter | Commit a value | Properties field |
| Escape | Put back a changed or refused value | Properties field |
| Enter | Send the message (queue it while a turn runs); Shift+Enter is a new line | Assistant composer |
| Up, Down, then Enter or Tab | Pick and run a command from the `/` list | Assistant composer, when the draft starts with `/` |
| Escape | Close the setup sheet or the list; otherwise stop the turn | Assistant |
| Left, Right, Home | Resize the panel (Shift for a larger step; Home returns it) | The assistant's left edge |

The chords are matched in `src/app.tsx` and `src/commands.ts` (`pressShortcut`, `chordCommand`),
the drafting toggles' keys are the `STATUS_TOGGLES` table in `src/components/StatusBar.tsx`, and
the arrow-key walks are `src/roving.ts`.

## The assistant

Window ▸ Assistant, Ctrl+7 or the title bar's key opens the panel. The model gets one tool,
`run`, which executes AutoLISP in the open drawing through the facade
([docs/assistant.md](../../docs/assistant.md)).

Setting a model up is a sheet with two decisions:

1. **Provider.** Pick one of the presets (OpenAI, OpenRouter, Anthropic's OpenAI-compatible
   endpoint, DeepSeek, Groq, Mistral, xAI, Together, Ollama, LM Studio) or "Other". Picking one
   fills in its address and model.
2. **Connection.** The base URL, the API key where the provider needs one, and the model.
   **Check connection** asks the server for its models, lists them as chips to pick from, or says
   why it could not. Save says why it waits when something is missing.

The setup is kept in this browser's `localStorage` (`cadcraft.assistant.provider`), key
included, not encrypted. The key is sent only to the base URL, is never shown in an error
message, and a stored setup that does not parse strictly is read as "not set up". A local
server must accept requests from the page's origin (`OLLAMA_ORIGINS` for Ollama).

In the panel: chats are tabs; a message typed while a turn runs joins a queue; each tool call
is a row that reads as a sentence and opens to its code and result; a reply's links open (http
and https addresses only) and a Markdown table is drawn as readable rows; the changes row counts what
the assistant changed and offers **Undo all** and **Keep**; a draft that starts with `/`
searches the commands; pictures attach by the paperclip, paste or drop (four per message, 4 MB
each). A provider's reply, tool calls, model list and stream are bounded, and a stream that
goes silent is ended.

Only a local stand-in for a provider has been exercised. No hosted provider has been run
against this panel.

## Layout of the source

```
src/main.tsx           boot: build the facade, mount the app
src/app.tsx            the shell: state, the invocation contract, the keys, visibility, theme
src/facade.ts          the one module that loads and calls the facade; mock/real switch
src/wasm-loader.ts     the only importer of the generated wasm glue
src/mock.ts            the canned facade
src/commands.ts        what an invoked id means, the menu tree, the ui.* items, chords
src/menu.ts            a menu's pure rules; src/roving.ts the arrow-key walks
src/palette.ts         the command palette's items and ranking
src/view.ts            world↔screen mapping, pan, zoom about the pointer, pinch (pure)
src/display.ts         the display-list parser (the trust boundary for engine bytes)
src/display-cache.ts   when a held display list still answers for the view
src/canvas.ts          the canvas renderer and the overlay (rubber band, snap marker, hover)
src/prompt.ts          the command line's prompt state and what the pointer is for
src/selection.ts       the pick aperture and the selection rules (pure)
src/props.ts           the properties palette's parsing and patch building (pure)
src/files.ts           file I/O: pick a file to open, download what the engine saves
src/assistant.ts       the provider, the wire protocol, the bounds, the transcript's text
src/assistant-session.ts  one chat: its conversation, queue, changes and stored setup
src/icons.ts           every icon, drawn in code (24×24 paths, one 1.25px stroke; no image assets)
src/components/        TopBar, MenuBar, Menu, ToolStrip, StatusBar (with the editor tabs),
                       CanvasView, LayersPanel, PropertiesPanel, CommandLine, CommandPalette,
                       AssistantPane
src/ui/                the design system's components, their tests and their one sheet, ui.css
src/tokens.css         the design tokens
src/styles.css, chrome.css, interaction.css, canvas.css, palette.css, assistant.css
docs/system/           the design system's pages and component specs (hand-written)
docs/generated/        the same, built by gen-docs for agents to read
docs/registry.json     the registered components
scripts/               check-system, check-spec, contrast-report, run-tests, verify-facade
```

## The components

`src/ui` holds the design system's thirteen components. New interface uses one of them and the
tokens; each has a spec in `docs/system/components` and a test beside it.

| Component | Its job |
|---|---|
| Button | Runs one action the moment its label says so |
| IconButton | Runs one action drawn as a single glyph; its title is its name and its hint |
| Toggle | Switches one setting on or off in place, under a name that never changes |
| Checkbox | Holds one yes-or-no value, and can say that what it stands for disagrees |
| Field | Takes one line of text |
| TextArea | Takes several lines and grows to hold them, up to a limit |
| Select | Picks one value from a short, known list |
| Row | The full-width clickable band of a list: a menu item, a property row, a layer |
| Tab | Brings one view of a strip to the front: a layout, a chat |
| Chip | Shows one compact fact, a keyword or a suggestion |
| Kbd | Shows the key that runs the action beside it |
| SectionLabel | Names a panel's section as a real heading |
| Tooltip | The one hint: a small box beside a control, on hover and on keyboard focus |

## Tokens and themes

Every colour, size, radius, duration and font is a custom property in `src/tokens.css`; no value
is written anywhere else, and `bun run check:system` enforces it. The canvas reads its colours
(`--canvas`, `--grid-*`, `--axis-*`, `--selection`) from the same properties at runtime, so the
drawing and the chrome cannot drift.

There are two themes, dark and light, and View ▸ Interface Theme chooses Dark, Light or the
system's. View ▸ Accessibility ▸ Animation Effects chooses On, Off or the system's setting. The
contrast of every text, icon, border and focus-ring pair is measured in both themes by
`scripts/contrast-report.mjs`; the results are in `docs/system/colors.md`.

The token list by role, with each token's value and source, is in `docs/system/colors.md`,
`typography.md`, `spacing.md`, `radius.md` and `motion.md`. Tokens that were carried over from
the removed egui theme and never drawn here are listed in `docs/system/decisions.md`, "Removed
tokens".

## What this interface does not do yet

- Dialogs: none. A command that had a dialog in the removed egui interface (Options, Plot, Layer
  Properties Manager, Hatch and Gradient, the block and text editors) runs here as its
  command-line prompt sequence only.
- Grips, right-click menus (a right click is Enter), dynamic input, Tab to cycle snap
  candidates.
- DWG. The wasm build has no DWG reader: opening one says to save as DXF. Save writes DXF.
- Files are picked and downloaded through the page; there is no autosave and no list of recent
  files.
- Languages other than English.
- `image` primitives draw their frame only: the display list carries no pixels.
- A control channel. The removed egui app served one (`docs/control-protocol.md`); nothing does
  today.
