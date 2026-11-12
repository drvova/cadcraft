# CADCraft architecture

> **Last reviewed:** 2026-11-11 (the interface, the facade, the desktop shell, crate sizes) · 2026-10-10 (the rest) · **Last updated:** 2026-11-11 · **Change:** major (the interface is the web interface over the wasm facade; the desktop app is that interface in a native webview; rendering, agent control and the workspace table rewritten from the code on main at ec61741) · **Target:** Autodesk AutoCAD 2027

How CADCraft is built today. This describes the code on `main`, not plans; plans live in
[roadmap.md](roadmap.md). Agents: the rules that keep this shape (layering, never-crash,
everything-is-a-command, clean-room) are in [AGENTS.md](../AGENTS.md).

## Workspace

About 149,000 lines of Rust in 13 library crates, 2 Rust apps and `xtask`, and about 14,000 lines
of TypeScript in the interface (`apps/ui/src`, tests left out). Counted 2026-11-11 with `wc -l`
over the tracked `src` files; the Rust figures include each crate's tests.

| Layer | Crate | Lines | What it does |
|---|---|---:|---|
| L0 | `geom` | 5,745 | f64 2D/3D vectors, `Mat3`/`Mat4`, bounds, lines, arcs and bulges, circles, ellipses, (rational) B-splines with fit-point interpolation, line/arc intersections, tessellation, planar region tracing for HATCH/BOUNDARY (`region.rs`) |
| L0 | `dxf` | 1,108 | Standalone DXF tag reader/writer: ASCII and binary, tag-count limits for hostile input |
| L1 | `color` | 311 | AutoCAD Color Index table, true colour, ByLayer/ByBlock |
| L1 | `doc` | 11,141 | The drawing database: header, symbol tables (layers, linetypes, text/dimension/table/multileader styles), blocks, model space, layouts, constraints; copy-on-write `EntityStore`; our own hatch pattern and linetype library (`library.rs`) |
| L2 | `fonts` | 4,493 (before the font grew; not recounted) | Our single-stroke drafting font (362 characters: ASCII, all of Latin-1, superscripts and subscripts, fractions, accented Latin Extended-A composed from a base letter and a mark, typographic punctuation and common signs; a character it lacks falls back to the nearest one before the missing-glyph box), TrueType/OpenType/`.ttc` outlines through `skrifa`, TEXT and MTEXT layout and formatting codes, per-character fallback and FONTALT |
| L2 | `render` | 9,055 | Display lists (polylines, triangles, points tagged with entity handles): linetypes, hatches, gradients, text, block expansion, dimension geometry, paper-space clipping; CPU rasteriser (`tiny-skia`) for PNG, plot preview and tests |
| L2 | `constraints` | 4,344 | Own parametric solver: damped Gauss–Newton / Levenberg–Marquardt (`lm.rs`), 12 geometric and the dimensional constraints, expressions and parameters, AutoConstrain inference |
| L3 | `io` | 15,062 | DXF ⇄ document mapping (`dxf_read.rs`, `dxf_write.rs`, CADCraft xdata in `dxf_ext.rs`), PDF plotting, SVG and PNG export |
| L3 | `dwg` | 914 | DWG through a DXF bridge: the `acadrust` crate (MPL-2.0, unmodified) converts DWG ⇄ DXF bytes; nothing else sees its types. Native only: on `wasm32` the crate answers that DWG cannot be opened, so the interface has no DWG |
| L4 | `engine` | 88,604 | `Session`, the command registry (`cmd/*`), command-line parser and prompt machines, object snaps and polar/ortho (`snap.rs`), selection (`select.rs`), grips (`grips.rs`), associativity (`assoc.rs`), system variables, units, undo, R-tree spatial index (`spatial.rs`) |
| L5 | `wasm` | 2,295 | The facade the interface runs on: the engine compiled to WebAssembly behind a small JSON API, the only door the interface has into the engine. Session calls (`execute`, `cmdline`, `start`, `cancel`, `prompt`, `state`, `selection`, `settings`, `commands`, `run_script`), the drawing (`display`, `set_view`, `view`, `open_bytes`, `save_bytes`, `load_sample`, `digest`) and the pointer (`set_viewport`, `set_cursor`, `preview`, `pick`, `snap`, `click`). The core `Facade` has no wasm dependency, so its tests run natively |
| L5 | `ai` | 2,001 | The one tool (`code.rs`: `run`, which executes AutoLISP in the drawing) and its catalog (`surface.rs`), which MCP serves; the conversation, transport and turn loop (`chat.rs`, `client.rs`, `agent.rs`), which the egui pane ran and no app runs today (the interface's port is `apps/ui/src/assistant.ts`) |
| L5 | `mcp` | 1,551 | MCP server (JSON-RPC 2.0 over stdio, one `run` tool) on a headless session or bridged to a running app |
| L5 | `surface` | ≈ 2,700 | Designed surfaces outside the web interface: a piece card, the bench sheet as a page and a terminal dashboard, laid out by [Slab](https://github.com/stencil-hq/slab) documents (`crates/surface/slab`) and filled from the engine's own replies to `piece` and `techsheet`. Everything is behind the crate's `slab` feature, off by default (the crate is empty without it): Slab is not in the repository, `cargo xtask slab` fetches it at the commit `third_party/slab/SLAB.lock` pins and applies the patch series there, and `cargo xtask surfaces` builds on it. Linked without Slab's bundled fonts: an SVG and the dashboard need none, a PNG uses a face found on the machine ([surfaces.md](surfaces.md)) |
| app | `cadcraft` | 388 | Desktop app: one native window (tao) whose content is the interface in the system webview (wry). `build.rs` embeds `apps/ui/dist` and `assets.rs` serves it from a table on a custom scheme, treating request paths as hostile; `--dev [URL]` shows a running dev server instead. The page's title becomes the window's title; the webview's storage lives under the user's data folder. No engine code: the engine it shows is the wasm build |
| app | `cadcraft-cli` | 1,170 (before the surfaces; not recounted) | `info`, `convert`, `run` (scripts), `commands`, `sample`, `mcp`; with the optional `surfaces` feature, `run --card/--sheet` and `tui` |
| app | `ui` | ≈ 14,000 (TypeScript) | The interface: SolidJS + TypeScript over the wasm facade (`apps/ui`, a bun app, not a Rust crate); the same build runs in a browser tab and in the desktop window. Layout, keys and components: [apps/ui/README.md](../apps/ui/README.md) |
| tool | `xtask` | 1,252 (before `slab`; not recounted) | `ci`, `layers`, `assets`, `wasm`, `ui`, `test`, `slab`, `surfaces`, `parity`, `version`, `stats`, `corpus`, icon packing |

`cargo xtask layers` enforces the layering: nothing below the apps depends on a UI toolkit
(tao, wry, winit, wgpu or rfd). The egui interface (`ui-egui`, and the `cadcraft-web` build of it)
was removed on 2026-11-11; the interface is `apps/ui`.

## Data model

- A `Drawing` is header variables, symbol tables, block definitions, model space and paper-space
  layouts. Entities carry a handle, layer, colour, linetype, lineweight, transparency and an
  `EntityKind`: Line, Point, Circle, Arc, Ellipse, LwPolyline, Polyline3d, Spline, Ray, XLine,
  Text, MText, AttDef, Insert (with attributes), Dimension (linear, aligned, angular, diameter,
  radius, ordinate, arc length), Leader, MLeader, Hatch (pattern, solid, gradient), Solid,
  Trace, Face3d, Viewport, Image, Wipeout, Table and Unknown (raw DXF tags).
- Since this section was first written the model gained Helix, MLine, Region and Tolerance.
  There are no 3D solids, surfaces, meshes or underlays yet, and a region carries no ACIS data
  ([gaps.md](gaps.md)).
- Entity collections are copy-on-write, so undo is a whole-drawing snapshot that costs little.
- Coordinates are f64 world units. 2D work happens in the WCS; there is no UCS yet.

## Commands

Every user-visible action is a `CommandSpec` (`crates/engine/src/cmd/mod.rs`): id = AutoCAD's
command name in lower case, label, menu path, shortcut, aliases, a JSON `run`, an `enabled`
check and an optional interactive prompt machine. 454 commands were registered when
`cargo xtask parity` last ran (2026-10-26; not re-run for this revision), plus the interface's
own `ui.*` items in `apps/ui/src/commands.ts`. The command line, menus, toolbar, command palette,
scripts, CLI and MCP all reach the same commands. JSON calls never open dialogs.

## Rendering

`render::build` turns a space into a display list (polylines, triangles, points and image
frames, each tagged with its entity's handle). The facade's `display(margin)` serialises the
part of it inside the view, padded by the margin, with a revision number, the `space` the list
is of and, for a layout, its `sheet` (the paper and its printable area); the interface parses
it (`apps/ui/src/display.ts`, the trust boundary for engine bytes) and draws it on a 2D canvas
(`canvas.ts`), on the sheet of paper when the list carries one, with colour-7 objects inked dark
there. There is no GPU path: the wgpu renderer was the egui interface's and went with it.

The interface keeps the list it holds until the view leaves the padded window, the drawing's
revision changes, or a zoom passes the detail the list was built for (`display-cache.ts`), so a
pan inside the window is a redraw with no engine call. The canvas draws at most once a frame.
What follows the pointer is drawn on a second canvas over the drawing: the running command's
rubber band (`preview`, where dragged objects are the list's own primitives under a matrix the
engine gives), the object-snap marker (`snap`) and the outline of what a click would pick
(`pick`).

The R-tree (`spatial.rs`) is patched per changed store chunk after an edit. PNG, PDF, SVG and
plot output reuse the same display list through the CPU rasteriser or the vector writers, on a
native session (`cadcraft-cli`).

## Files

DXF is the native path: `dxf` parses tags, `io::dxf_read` maps them to the document, and
`io::dxf_write` writes an R2000 (AC1015) DXF. DWG is converted to DXF in memory by `acadrust` and
read through the same path; saving DWG writes our DXF and converts it back. CADCraft-only data
(constraints, associativity details, table flags) travels in xdata under our own application
name. Detail and gaps: [file-format-parity.md](file-format-parity.md).

## Agent control

- **MCP:** `cadcraft-cli mcp` serves one tool, `run`, on a headless session; see [mcp.md](mcp.md).
- **Control channel (not served today):** the egui app's `cadcraft --control PORT` accepted JSON
  lines (`cmdline.input`, `engine.execute`, `ui.screenshot`, `ui.render` …). The web interface
  does not serve one, so `cadcraft-cli mcp --connect HOST:PORT` has nothing to connect to and an
  agent cannot drive the running app. [control-protocol.md](control-protocol.md) is kept as the
  specification for one.
- **The assistant:** Window ▸ Assistant (Ctrl+7) opens the panel in the interface. It speaks the
  OpenAI chat protocol from the page (`fetch`), and a tool call is the facade's
  `execute("run", …)`: the same one tool, AutoLISP in the drawing, and nothing an MCP client
  cannot do ([assistant.md](assistant.md)).
- **CLI:** `cadcraft-cli run --script … --export out.png` for headless batch work. A reader that
  closes stdout early (`… | head`) drops the rest of the output but keeps the work — later
  commands, `--save`, `--export` — and the exit status still reports failures; another stdout
  write error is reported and makes it 1.

## Safety

Production crates deny `unwrap`/`expect`/`panic!` and forbid `unsafe`. `Session::execute` and
interactive input run under `catch_unwind`, restoring the drawing if a panic escapes. Input-sized
allocations are capped (DXF tag counts, DWG size limits, hatch segment and island limits,
`MAX_BLOCK_DEPTH`).

The facade treats what the interface sends as hostile too: a coordinate, aperture, view or
canvas size that is not finite or is out of range is refused with an error, a display list and
a pick list are bounded, and an opened file has a size limit. On the other side the interface
parses every reply with checked narrowing, and the assistant bounds what a provider may send.
The desktop shell never lets a request path reach the file system.

The designed surfaces call into Slab, which is pre-alpha and unwraps freely: every call runs
under `catch_unwind` and becomes an error, strings from a drawing are cleaned and cut, lists are
capped and sizes clamped before anything is allocated ([surfaces.md](surfaces.md)). The engine
reaches them through a door (`cadcraft_engine::surfaces`), not a dependency: L4 does not link L5,
and a build without the surfaces answers `(card)` with a sentence.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-12 | minor | `surface` (L5, optional): the piece card, bench sheet page and terminal dashboard on Slab, which is pinned and patched in `third_party/slab` and fetched by `cargo xtask slab`; the `cadcraft-cli` row gains `run --card/--sheet` and `tui` behind its `surfaces` feature |
| 2026-11-12 | minor | The display list carries `space` and a layout's `sheet`, and the canvas draws a layout on its paper; the drafting font covers 362 characters with composed glyphs and a nearest-character fallback |
| 2026-11-11 | major | The interface is `apps/ui` over the wasm facade and the desktop app is that interface in a native webview (egui removed, d5cad47). Workspace table: `wasm`, `ai`, `cadcraft` and `ui` rows rewritten, line counts recounted (57,000 → about 149,000 lines of Rust, tests included). Rendering rewritten: a 2D canvas over the facade's display list, no GPU path. Agent control: the control channel is not served; the assistant runs in the interface. Data model: Helix, MLine, Region, Tolerance noted. Safety: the facade's bounds |
| 2026-10-10 | major | First committed architecture doc, measured from the code (crate sizes, entity kinds, command counts) |
