# CADCraft roadmap

**Stage: pre-alpha** · next: alpha, ~2 points (38% → 40% ready for real work) and the four failing core workflows of the [alpha gate](docs/roadmap.md#alpha-gate): ~125–190 Opus 5.5 hours as estimated before the interface was replaced, plus the new interface's own gaps, not estimated yet

> **Last reviewed:** 2026-10-10 (features, files, hours) · 2026-11-12 (interface) · **Last updated:** 2026-11-12 · **Change:** minor (the web interface gained dynamic input, the Layer Properties Manager, paper under a layout and recovery of unsaved work, after grips, right-click menus and its first dialog the same day: UI/UX fidelity ≈ 31% → ≈ 42%, ready for real work ≈ 36% → ≈ 38%; on 2026-11-11, major: the web interface replaced the egui interface) · **Target:** Autodesk AutoCAD 2027

CADCraft targets full parity with AutoCAD (2D drafting first, then annotation, layouts and
plotting, DWG, parametrics and 3D), plus what AutoCAD doesn't have: agent control over MCP, a
scriptable CLI, a web build, Linux and FreeBSD builds, and a free licence.

**Why pre-alpha:** four of AutoCAD's five core workflows fail the [alpha gate](docs/roadmap.md#alpha-gate).
Precise drafting: the new interface draws with the pointer, snaps to objects, follows ortho,
polar, grid snap and object snap tracking, takes dynamic input at the pointer and edits by grips;
what fails there is engine-side (no TK, approximate ellipse and spline intersections) and the
missing snap menu. There are two dialogs (Drafting Settings, Layer Properties Manager). Blocks, plotting and every other
command with a dialog run as command-line prompts only. The app opens and saves DXF, not DWG, and
a DWG saved by the CLI drops what CADCraft doesn't model and has never been checked in AutoCAD.
Dimensioning passes, by typing. Ready for real work (≈ 38%) is under the ~40% alpha bar. Beta was
≈ 600–930 h away before the interface change.

**The interface, 2026-11-11.** The egui interface is gone. The interface is a SolidJS app over
the engine compiled to WebAssembly, laid out as an editor: menus and a command centre in the
title bar, a drawing toolbar, Layers and Properties in a sidebar, layout tabs, the command line
as the panel, an assistant, a status bar of drafting toggles, a command palette and right-click
menus. It has been
exercised in Chromium and, as the desktop app, on Windows. What it lacks is in
[docs/gaps.md](docs/gaps.md#uiux) (W1–W14).

## Headline numbers

| Number | Value | Kind |
|---|---|---|
| Feature breadth (AutoCAD for Mac menu items with a live command) | **62%** (304 / 491: 300 engine commands in the checklist generated 2026-10-26, plus 4 interface-only items hand-counted 2026-11-11; 2D menus only ≈ 65% as of 2026-10-10, not recounted) | measured ([parity-checklist.md](docs/parity-checklist.md) + interface-only items); `cargo xtask parity` not re-run |
| Ready for real work | **≈ 38%** (as with the egui interface; 35% when the interface was first replaced) | estimated ([target-app-parity.md](docs/target-app-parity.md)); weighted sum hand-computed 2026-11-12 |
| Mainstream practitioner (2D drafter) | **≈ 28%** on the egui interface; not re-measured, lower now (lower than the full number: file exchange, stability and interaction discounts multiply) | estimated ([target-app-parity.md](docs/target-app-parity.md#mainstream-practitioner)) |
| Essentials user | **≈ 46%** on the egui interface; not re-measured, lower now | estimated ([target-app-parity.md](docs/target-app-parity.md#essentials-user)) |
| Remaining to alpha | **≈ 125–190 h** (the gate rows), plus the interface's gaps, not estimated | estimated before the interface change |
| Remaining to beta | **≈ 600–930 h** (≈ 150–250 h elapsed with 4–6 agents) | estimated before the interface change |
| Remaining to full parity | **≈ 1,300–2,100 h** (≈ 330–550 h elapsed) | estimated before the interface change |

### Readiness by audience

| Audience | Ready % | Opus 5.5 agent wall-clock hours to ~95% | Work that dominates |
|---|---:|---|---|
| Full target (ready for real work) | ≈ 38% | ≈ 1,150–1,850 h (≈ 70% parallelises across 4–6 agents: ≈ 300–480 h elapsed) | 3D kernel (300–450 h), DWG/DXF and other formats, AutoLISP and ecosystem, blocks/xrefs/dynamic blocks, localization |
| Mainstream practitioner (2D drafter) | ≈ 28% (egui; not re-measured) | ≈ 570–880 h (≈ 70% parallelises: ≈ 150–240 h elapsed) | lossless DWG exchange and a real-file corpus, precision input (tracking, dynamic input), 2D geometry precision, blocks/xrefs, annotation depth, stability backlog |
| Essentials user | ≈ 46% (egui; not re-measured) | ≈ 140–225 h (≈ 50% parallelises across 3 agents: ≈ 60–110 h elapsed) | stubbed options in basic draw/modify commands, opening DWGs people send, launch/stability fixes, plot dialog, context menus and dynamic input |

Hours are subsets (essentials ⊂ mainstream ⊂ full) and use the calibration in [target-app-parity.md](docs/target-app-parity.md#remaining-effort-and-how-it-was-calibrated): ≈ 25 commands
per agent-hour at presence quality in the first build (≈ 11.5 agent-hours), 0.3–0.7 h per option
or bug fix (≈ 60 such fixes on 2026-10-10), 2–5 h per moderate feature, 15–100 h per subsystem.

Hours are Opus 5.5 agent wall-clock hours, calibrated on this repo's own build: the first version
(51k lines, 290 commands) took ≈ 11.5 agent-hours at presence quality, while depth work runs at
0.3–0.7 h per option or bug fix (≈ 60 such fixes landed on 2026-10-10). Details:
[target-app-parity.md](docs/target-app-parity.md#remaining-effort-and-how-it-was-calibrated).

## By dimension

| Dimension | Parity | Remaining (h) | Doc |
|---|---:|---|---|
| Features (depth, weighted by use) | 41% | 735–1,115 | [target-app-parity.md](docs/target-app-parity.md#by-feature-area-the-features-dimension) |
| UI/UX fidelity | 42% (web interface, re-scored 2026-11-12; 43% here for egui) | 100–160 (not re-estimated; too low) | [ui-parity.md](docs/ui-parity.md) |
| File formats | 30% | 170–280 | [file-format-parity.md](docs/file-format-parity.md) |
| Hardware | 45% | 15–25 | [hardware-parity.md](docs/hardware-parity.md) |
| Localization | 5% (egui catalogs, since removed; not re-measured) | 60–100 | [localization-parity.md](docs/localization-parity.md) |
| Performance | 60% | 20–40 | [hardware-parity.md](docs/hardware-parity.md#performance-on-hardware-internal-numbers-only) |
| Stability | 35% | 30–50 | [gaps.md](docs/gaps.md#stability) |
| Platforms | 75% | 15–25 | [gaps.md](docs/gaps.md#platforms) |
| Ecosystem and automation | 10% | 120–200 | [gaps.md](docs/gaps.md#ecosystem-and-automation) |
| AI features | 20% | 40–80 | [gaps.md](docs/gaps.md#ai-features) |

## Features

| Area | Parity | Remaining (h) | Doc |
|---|---:|---|---|
| Draw (2D) | 60% | 15–25 | [gaps.md](docs/gaps.md#features) |
| Modify | 50% | 40–60 | [gaps.md](docs/gaps.md#features) |
| Geometry precision | 40% | 70–110 | [geometry-parity.md](docs/geometry-parity.md) |
| Layers and properties | 70% | 10–15 | [gaps.md](docs/gaps.md#features) |
| Dimensions | 45% | 25–35 | [gaps.md](docs/gaps.md#features) |
| Text and MTEXT | 35% | 30–45 | [gaps.md](docs/gaps.md#features) |
| Leaders, tables, fields | 25% | 25–35 | [gaps.md](docs/gaps.md#features) |
| Hatch and gradients | 35% | 15–25 | [gaps.md](docs/gaps.md#features) |
| Blocks, attributes, xrefs, groups | 25% | 80–120 | [gaps.md](docs/gaps.md#features) |
| Layouts, viewports, plotting | 35% | 35–50 | [gaps.md](docs/gaps.md#features) |
| Inquiry and utilities | 30% | 30–45 | [gaps.md](docs/gaps.md#features) |
| Parametric constraints | 50% | 20–30 | [geometry-parity.md](docs/geometry-parity.md) |
| 3D modelling and rendering | 2% | 300–450 | [gaps.md](docs/gaps.md#features) |
| Collaboration and cloud | 5% | 40–70 | [gaps.md](docs/gaps.md#features) |

## Languages

AutoCAD 2027 for Mac ships 8 interface languages. CADCraft's interface is English only since
2026-11-11: the string catalogs (Ukrainian, German, Brazilian Portuguese, Spanish, Czech, Russian,
French, Simplified Chinese, Italian, Greek, Korean, Swedish, Arabic, Hungarian and Turkish) were
part of the egui interface and were removed with it. The web interface has no catalog yet.
Detail: [localization-parity.md](docs/localization-parity.md), which still describes the removed
catalogs.

| Language | Status | UI translated |
|---|---|---:|
| English | full | 100% |
| Every other language | none in the interface (catalogs removed with egui) | 0% |

## Upcoming

Ranked; detail and the full beta checklist in [docs/roadmap.md](docs/roadmap.md). The list was
ranked before the interface was replaced; the interface's gaps (W1–W14 in
[docs/gaps.md](docs/gaps.md#uiux)) are not ranked into it yet, and item 4's tracking and dynamic
input: tracking and dynamic input are done and reach the pointer. Item 6: the interface keeps
recovery copies in the browser; the engine's autosave is not reached from it.

1. Gate and land: fix fmt on main, run `cargo xtask ci` on every PR, land the 47 open PRs (15–25 h).
2. Stop losing data on save; native MULTILEADER; save DWG/DXF at a chosen version (30–45 h).
3. Real-file DWG/DXF corpus and a black-box check in AutoCAD (10–15 h + owner).
4. Precision input: object snap tracking, extension/parallel snaps, FROM/M2P/TK, snap overrides,
   editable dynamic input (25–35 h).
5. Unstub prompt options in TRIM/EXTEND, OFFSET, ROTATE, PLINE, SPLINE, MTEXT, MLEADER (15–25 h).
6. Autosave, recovery, AUDIT, RECOVER (10–15 h).
7. Exact ellipse/spline geometry and correct polyline offsets (30–50 h).
8. Xrefs, block editor, groups, then dynamic blocks (80–120 h).

## Progress log

| Date | Entry |
|---|---|
| 2026-11-12 | A design pass on the jewelry interface. A line of the Bench section selects what it counts on the drawing; a selection offers "Ask about N selected objects" over the drawing; the assistant starts open on a wide window; the sample is dimensioned and drawn in gold, pale blue and greys ([docs/jewelry.md](docs/jewelry.md#in-the-interface)) |
| 2026-11-12 | Jewelry in the interface. It opens on a solitaire drawn by the jewelry commands; the sidebar's Bench section is the bench sheet, live (stones by cut and size with carats, bands with grams); the tool strip has Ring, Gem, Setting and Pavé; the assistant is briefed on the jewelry commands and Ctrl+K asks it from the drawing. Three engine faults fixed with tests: a stone named `diamond` did not read back, a halo was laid at the origin, and settings and pavé were misplaced in an inch drawing ([docs/jewelry.md](docs/jewelry.md#in-the-interface)) |
| 2026-11-12 | Paper under a layout, dynamic input, recovery of unsaved work, the Layer Properties Manager and a wider drafting font. A layout draws its sheet and printable area, with white objects inked dark on the paper; each space keeps its own view and Zoom Extents on a layout frames the sheet. With DYN on, the prompt and its fields (X and Y, distance and angle, or one value) follow the pointer; a typed value locks and holds the rubber band, Tab moves between fields, Down lists the prompt's options. Unsaved work is copied to the browser's storage three seconds after it changes and offered back on the next start (Restore, Save a copy…, Discard), never silently. Layers opens a manager: a grid of layers edited in place, bulk changes in one undo step, a filter, sorting, the keyboard throughout. The drafting font covers 362 characters instead of 101 (superscripts, fractions, Latin-1, accented Latin, signs), so "m²" no longer draws a box. Limits: dynamic input needs the drawing focused and previews typed angles as plain degrees; the unsaved mark stays after Save; the manager has no layer states, filters or viewport overrides; Greek and Cyrillic still box in the interface. UI/UX ≈ 37% → ≈ 42%, ready for real work ≈ 37% → ≈ 38% (hand-assessed). |
| 2026-11-12 | Grips, right-click menus and the first dialog in the web interface. A selection shows its grips: hover warms one, a press or a click makes it hot and edits through the engine's grip command, Space cycles Stretch, Move, Rotate, Scale and Mirror, Shift collects several, and a multifunctional grip offers its options. A right click opens a menu on the drawing (at rest, over a selection, and during a command with Enter, Cancel and the prompt's keywords; a quick right click during a command is still Enter), on a layer row and on a layout tab; the menu key, Shift+F10 and a long press open the same. Drafting Settings (snap and grid, polar tracking, object snap modes) is the first dialog, on a new Dialog component; the design system has fourteen components. Selection and hover are a halo under the object, so each keeps its own colour. Limits: every grip is a square, no grips for touch, dynamic-block grips unit-tested only; every other dialog, dynamic input and the snap menu are still missing. UI/UX ≈ 31% → ≈ 37%, ready for real work ≈ 36% → ≈ 37% (hand-assessed). |
| 2026-11-11 | The interface is rebuilt on the web stack and the egui interface is removed. The desktop app is the web interface in a native window (the system webview), embedding the build of `apps/ui`. The shell is laid out as an editor: title bar with the menus and a command centre, a drawing toolbar (draw, modify, annotate), a sidebar with Layers and Properties, layout tabs over the drawing, the command line as the bottom panel, the assistant, a status bar of drafting toggles, and a command palette (Ctrl+Shift+P). Drawing with the pointer: a click gives a running command its point, with the engine's rubber band, the object-snap marker and a snapped click, and the engine's snapped cursor behind it, so ortho, polar tracking, grid snap and object snap tracking constrain the click with a label and the rays drawn; hover highlight, window and crossing selection, right click as Enter, middle-button pan, wheel zoom, touch pan and pinch (touch not tried on a device). The wasm facade gained `cancel`, `preview`, `pick`, `snap`, `pointer`, `click`, `set_viewport` and `set_cursor`, and `properties.set` refuses bad values. Keyboard patterns through the whole shell (menubar, toolbar, tabs, F6 between parts, function keys for the toggles, command chords). The assistant: setup in two steps with a connection check, chats as tabs, a queue, a changes row with undo, tool rows as sentences, bounds on a provider's output. A design system of thirteen components with specs, a checker and generated docs; dark and light themes with measured contrast. Not carried over from egui: dialogs, grips, dynamic input, context menus, DWG in the app, autosave, the translations, the control channel. UI/UX 43% → ≈ 31%, ready for real work ≈ 38% → ≈ 36%. Exercised in Chromium, on Windows for the desktop shell, and with a local stand-in for a model provider. Docs: [ui-parity.md](docs/ui-parity.md), [apps/ui/README.md](apps/ui/README.md). |
| 2026-10-26 | One tool, and the model builds its own: the assistant and MCP advertise exactly `run`, which executes AutoLISP **inside the open drawing** — `(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))` draws, `(cmdline "line" "0,0" "10,0")` types at the command line, `(commands)`/`(describe "id")` discover, `(cmd "describe")` measures, `(render)` shows a picture — and a `defun` the model writes is kept in `%APPDATA%\CADCraft\definitions` and reloaded next session (`(kept)`, `(forget)`). The per-capability tool catalog is gone, MCP resources with it, and there is no enable/disable flag: running code is what the server does, and sandboxing is the boundary. The same tool in the pane (`assistant {ask}`) and over `cadcraft-cli mcp`. Docs: [assistant.md](docs/assistant.md), [mcp.md](docs/mcp.md). |
| 2026-10-26 | The assistant: Window ▸ Assistant (⌘7), `assistant {ask, attach, stop, clear}`, an OpenAI-compatible provider saved with the profile. Streamed answers, collapsed activity rows, render cards, attachments the model sees and can trace, queued/steering messages, per-request drawing checkpoints, context meter, 12-round cap, Stop. |
| 2026-10-25 | Jewelry: the trade's numbers as commands — RINGSIZES and RING (US/UK/ISO/JP/CN ring sizes from the published formula, the blank a size and wall make, metal weight), GEM and GEMLIST (each cut's real girdle as geometry, carat weight from the trade's per-cut formula, stones as one block per cut, size and material), PAVE and GEMFIT (calibrated melee along a path or through a region, with the fit checked and the largest fitting size reported), SETTING (prongs on the stone's own tips and shoulders, bezel, halo, channel), TECHSHEET (a bench sheet: stones by cut and size with carats, metal by Pappus's theorem); DESCRIBE reads jewelry out of any drawing and MCP gains `bench_sheet`. Docs: [jewelry.md](docs/jewelry.md). |
| 2026-10-21 | DXF save keeps each proxy object's and proxy entity's class: its class number (group 91) is renumbered to the rewritten CLASSES instead of naming another class, so AutoCAD's visual styles in an R14 file no longer come back as SCALE or MLEADERSTYLE (#1812) |
| 2026-10-14 | HATCHEDIT adds boundaries from internal points or closed objects and removes selected loops in the dialog, command line and JSON command; associative links and undo are covered by tests. |
| 2026-10-12 | TRIM: a pick after a closed polyline's last cut keeps only the complementary run instead of an extra circuit of the outline (#726) |
| 2026-10-12 | HATCHEDIT refuses an explicit bad `scale` or `angle` before it edits anything, so a rejected request leaves the drawing, undo and redo as they were (#724) |
| 2026-10-10 | Merged main: Ukrainian interface (#36, first string catalog), Dynamic Input pointer boxes with Tab and relative entry (#60), press-drag selection windows (#63), WIPEOUT and hatch gradients kept through DXF/DWG save (#147, #162), SETVAR DIM* as style overrides (#129), UNITS dialog (#38), close-window save prompt (#47), DIMANGULAR on circles (#20), cargo fmt fixed on main. UI/UX 40% → 43% (dynamic input 15% → 45%), localization 3% → 5%; ready for real work ≈ 37% → 38% (weighted 37.2% → 37.7%), mainstream 27% → 28%, essentials 45% → 46%. Beta is now ~37 points away; hours unchanged within rounding. |
| 2026-10-10 | Added mainstream practitioner (≈ 27%) and essentials user (≈ 45%) numbers; ready for real work unchanged at ≈ 37%. User evidence: 2 praise comments, 0 "switched from AutoCAD" reports, 27 of 37 open issues on the core path. |
| 2026-10-10 | Stage re-normalized from alpha to **pre-alpha** under the craftrules core-workflow gate: drafting with tracking, blocks, plotting and lossless DWG save fail; dimensioning passes. Alpha is ≈ 125–190 h away. |
| 2026-10-10 | Full re-measure against AutoCAD 2027 for Mac in the craftrules progress-docs format: menu breadth 245/491 (50%), ready for real work ≈ 37%, stage alpha. Remaining estimates rose (≈ 570 h → 1,300–2,100 h) on new evidence: behaviour audits found tracking/extension/parallel snaps and dynamic input are not real, saves drop unmodelled content, DWG saves as R2000, and the old estimate had no localization, ecosystem, stability, platform or AI rows. New docs: target-app-parity, gaps, roadmap, architecture, localization, file-format, hardware, UI and geometry parity; `docs/parity.md` became `docs/parity-checklist.md`. |
| 2026-10-10 | About 60 community PRs merged in a day: DXF fidelity (transparency, LWPOLYLINE elevation, frozen VP layers, dimension text rotation, arc-length dims, non-ASCII escapes), CJK font fallback, Save/Don't Save on close, Light/System themes, F2 history, trackpad pan, Linux XWayland drag-and-drop, correctness fixes across draw/modify/constraints. Release v0.4.0. |
| 2026-10-08 | Releases v0.1.0–v0.3.0: Flatpak, AppImage updates, signed macOS universal, Windows x64/x86/arm64, Linux, FreeBSD and web builds. |
| 2026-10-07 | Old assessment: menu breadth 233/491 (47%), ≈ 29% weighted parity, 2D drafting ≈ 55%, ≈ 570 h remaining; milestones as reported then: M1 ~85%, M2 ~65%, M3 ~75%, M4 ~50%, M5 ~35%, M6 ~55%, M7 ~55%, M8 ~20%, M9 ~60%, M10 ~70%, M11 0%, M12 ~25%, M13 ~10%. |
| 2026-10-07 | First version built in one session (≈ 6.9 h elapsed, ≈ 11.5 agent-hours): M0 vertical slice, dimensions, hatch, blocks, DWG bridge, layouts and PDF plotting, GPU canvas, R-tree, constraints, Layer Properties Manager, QSELECT, release pipeline. |

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-12 | patch | Progress log: jewelry in the interface (sample, Bench section, tool group, assistant briefing, Ctrl+K) and three jewelry fixes; no number moves |
| 2026-11-12 | minor | Dynamic input, the Layer Properties Manager, paper under a layout, recovery copies and the 362-character drafting font: banner, why, headline numbers (UI/UX 37% → 42%, ready 37% → 38%, hand-assessed), the note above Upcoming, progress log |
| 2026-11-12 | minor | Grips, right-click menus and the first dialog (Drafting Settings) in the web interface: banner, why, headline numbers (UI/UX 31% → 37%, ready 36% → 37%, hand-assessed), progress log |
| 2026-11-11 | major | The web interface replaced the egui interface: banner, why, headline numbers (UI/UX 43% → 31%, ready 38% → 36%; 25% and 35% before the pointer followed the engine's snapped cursor; breadth restated as 304/491 from the generated checklist plus hand-counted interface items), languages (English only), progress log. Hours are unchanged and predate the change; mainstream and essentials numbers not re-measured |
| 2026-10-25 | minor | Progress log: the jewelry layer (ring sizes, gem cuts, pavé and fit, settings, bench sheet) and [docs/jewelry.md](docs/jewelry.md) |
| 2026-10-21 | trivial | Progress log: proxy objects keep their class through a save (#1812) |
| 2026-10-14 | minor | Progress log: HATCHEDIT boundary add/remove |
| 2026-10-12 | trivial | Progress log: closed-polyline TRIM (#726) |
| 2026-10-12 | trivial | Progress log: HATCHEDIT numeric validation (#724) |
| 2026-10-10 | minor | Merged main's changes (Ukrainian catalog, dynamic input pointer boxes, DXF fixes); UI/UX and localization numbers updated |
| 2026-10-10 | minor | Readiness-by-audience table with hours to ~95% for each number |
| 2026-10-10 | minor | Mainstream practitioner and essentials user headline numbers |
| 2026-10-10 | minor | Stage alpha → pre-alpha under the core-workflow gate; banner, why, headline row |
| 2026-10-10 | major | Restructured to the progress-docs standard (stage, two numbers, dimensions, features, languages, upcoming, log); full re-measure; milestone detail moved to docs/roadmap.md, parity assessment to docs/target-app-parity.md |
| 2026-10-07 | major | Alpha checklist, milestone table, ≈ 29% weighted parity estimate |

## Interface

One interface everywhere: the SolidJS app in `apps/ui` over the engine's WebAssembly facade, in
a browser tab and in the desktop app's native webview. How to run it, its keys and its
components: [apps/ui/README.md](apps/ui/README.md). (This section used to describe the egui
interface's shared docking, which was removed with it.)
