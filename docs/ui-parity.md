# UI parity

> **Last reviewed:** 2026-11-11 · **Last updated:** 2026-11-11 · **Change:** minor (the pointer is resolved by the engine's snapped cursor: ortho, polar, grid snap and object snap tracking constrain a click; UI/UX fidelity ≈ 25% → ≈ 31%; earlier the same day, major: re-measured against the web interface, ≈ 48% → ≈ 25%) · **Target:** Autodesk AutoCAD 2027 for Mac (26.0)

How CADCraft's interaction compares with AutoCAD's: point entry, object snaps, tracking, dynamic
input, grips, selection, the command line, chrome and navigation. A drafter's speed in AutoCAD
comes from these, so "the command exists" isn't enough: it has to accept the same input, snap to
the same points and respond to the same keys. Work items: [gaps.md](gaps.md#uiux).

**Headline (estimated): UI/UX fidelity ≈ 31%.** The interface is the SolidJS app in `apps/ui`,
in a browser tab or in the desktop app's native webview. The egui interface was removed on
2026-11-11, and the dialogs, grips, dynamic input, context menus and translations it had went
with it. What the engine does for typed input still works: the command line, point syntax,
point modifiers and typed snap overrides. The pointer draws: a click gives a running command
its point, resolved by the engine's own snapped cursor, so object snaps, ortho, polar tracking,
grid snap and object snap tracking constrain it, with a label that names the constraint and
the tracking rays drawn. At rest the pointer selects by click, window or crossing. Remaining:
**≈ 110–170 Opus 5.5 hours** was the estimate for the egui interface; it has not been
re-estimated for this one and is too low.

## How this was measured

- CADCraft, interface: read from the source on 2026-11-11 (main at ec61741, then the working
  tree after the snapped-cursor work): `apps/ui/src` (`app.tsx`, `components/*`, `commands.ts`,
  `facade.ts`, `canvas.ts`), `crates/wasm/src/lib.rs` (the facade) and `apps/cadcraft` (the
  desktop shell). Not run in this pass. The author of the snapped-cursor work reports ortho,
  polar, grid snap and tracking tried in Chromium on the wasm engine, the deferred tangent and
  ARC's Ctrl switch covered by Rust tests only, and nothing checked at narrow widths. The commits that
  landed the interface say what was exercised: Chromium only, and the desktop webview on Windows
  only. Touch is implemented and unit-tested, not tried on a device.
- CADCraft, engine: the rows that cite `crates/engine` files were read on 2026-10-10 (main at
  bd2412f) and are carried over. A row says "engine" where the behaviour is reached by typing at
  the command line, and "interface" where the pointer or the chrome has to do it.
- AutoCAD: behaviour observed black-box in the running AutoCAD 2027 for Mac
  (`plan/autocad/01-observed-ui.md`, local only, with reference screenshots that are never
  committed), its menu tree (`xtask/data/menu-catalog.txt`) and Autodesk's documentation.
- Weights (how often a drafter hits each area): point entry 15%, object snaps 15%, tracking and
  polar 10%, dynamic input 10%, grips 10%, selection 10%, command line 10%, chrome and palettes
  10%, navigation 5%, keyboard and context menus 5%.
- The area percentages are judgements from the rows below, hand-assessed on 2026-11-11. The
  "egui" column is the last figure this page gave for the removed interface.

| Area | Weight | egui (removed) | CADCraft | Weighted |
|---|---:|---:|---:|---:|
| Point entry | 15% | 45% | 45% | 6.8 |
| Object snaps | 15% | 45% | 40% | 6.0 |
| Tracking, polar, ortho, grid/snap | 10% | 70% | 55% | 5.5 |
| Dynamic input | 10% | 45% | 0% | 0.0 |
| Grips | 10% | 40% | 0% | 0.0 |
| Selection | 10% | 40% | 30% | 3.0 |
| Command line | 10% | 60% | 45% | 4.5 |
| Chrome and palettes | 10% | 45% | 20% | 2.0 |
| Navigation | 5% | 55% | 50% | 2.5 |
| Keyboard shortcuts, context menus | 5% | 25% | 20% | 1.0 |
| **Total** | 100% | ≈ 48% | | **31.3 ≈ 31%** |

## Point entry (≈ 45%)

Typed point entry is the engine's and is unchanged. The engine's cursor is the resolved pointer,
so a distance typed alone runs along the ortho, polar or tracking path the pointer is on.

| Input | AutoCAD | CADCraft | Evidence |
|---|---|---|---|
| `x,y[,z]`, `@dx,dy`, `@d<a`, `d<a`, `#x,y`, bare `@` | yes | yes (engine); `#` equals absolute because there is no UCS; Z parsed then discarded | `prompt.rs` |
| `*x,y` (WCS override) | yes | yes (engine); the same as the plain forms because there is no UCS | `prompt.rs` |
| Direct distance entry | yes, honours ortho, polar and tracking paths | yes: along the ortho axis, and along the polar or tracking path the pointer is on (the engine's cursor is the point the facade's `pointer` resolved). Read from the source; the typed distance on a path was not tried in a browser | `engine/src/lib.rs` (`cmdline`), `wasm/src/lib.rs` (`resolve`) |
| Angle forms: `45d30'`, radians, grads, surveyor `N45dE` | yes | yes (engine) | `units.rs` |
| Architectural/engineering distances `5'6-1/2"` | yes | yes (engine) | `units.rs` |
| `FROM` (base point + offset) | yes | yes, typed (engine) | `pointmod.rs` |
| `M2P` / `MTP` (midpoint between two points) | yes | yes, typed (engine) | `pointmod.rs` |
| `TK` (tracking) | yes | **no** | |
| Point filters `.x`, `.y`, `.xy`, `.z` | yes | yes, typed (engine); Z is asked for and dropped (no 3D) | `pointmod.rs` |
| Angle override `<45` | yes | yes, typed (engine) | `pointmod.rs` |
| Object snap overrides (`END`, `MID`, `INT` … `NON`) | yes | typed override then a typed point: yes (engine). A pointer click after a typed override goes through the engine's snapped cursor; whether it takes the override is **not verified** | `pointmod.rs`, `wasm/src/lib.rs` (`resolve`) |
| A point by clicking | yes | yes: a left press gives the running command the point the engine resolved for the pointer (object snap, grid snap, tracking, ortho), written to the history as typed input would be | `CanvasView.tsx`, `app.tsx` (`onPoint`), facade `pointer` and `click` |
| Typed calculator `'CAL` | yes | no | |

## Object snaps (≈ 40%)

The modes are the engine's (`snap.rs`, `snap/tracking.rs`). While a command wants a point the
interface asks the engine once a frame for the resolved pointer (facade `pointer`, which runs
`Session::snap_cursor`), draws the snap's marker and name, and the click takes that same point.

| Mode | AutoCAD | CADCraft |
|---|---|---|
| Endpoint | every curve, solid/3D vertices, dimension ends | lines, arcs, polyline segments, open ellipses and splines, ray base, solid/trace corners |
| Midpoint | every curve incl. ellipse/spline arcs, polyline segments | segments only; **none on circles, ellipses, splines** |
| Center | arcs, circles, ellipses, polyarcs | arcs, circles, ellipses |
| Geometric center | any closed polyline, spline | closed LWPOLYLINE only |
| Node | points, dimension definition points, text alignment points | POINT only |
| Quadrant | circles, arcs, ellipses | yes |
| Intersection | every pair, extended intersection | among up to 200 nearby primitives; ellipse/spline pairs approximate ([geometry-parity.md](geometry-parity.md)) |
| Extension | yes, with dashed extension path | reached through the snapped cursor when the mode is running: rest on a line or arc end, then the path runs on and is drawn (`snap/tracking.rs`, facade `pointer`). Read from the source; not tried in a browser; not from ellipse, spline or polyline-arc ends |
| Insertion | text, mtext, blocks, attributes, attdefs | TEXT, MTEXT, INSERT; no ATTDEF or MLEADER |
| Perpendicular | every curve, deferred | lines, arcs, circles, xlines; deferred for the first point, and a click carries the deferred snap |
| Tangent | circles, arcs, ellipses, splines, deferred | arcs and circles; deferred for the first point; **no ellipse or spline** |
| Nearest | every curve | yes |
| Apparent intersection | projected intersection | reached through the snapped cursor in 2D, as Extension. Read from the source; not tried in a browser |
| Parallel | yes, with parallel path | reached through the snapped cursor: rest on a line, then a path parallel to it runs through the base point. Read from the source; not tried in a browser |
| Shift/Ctrl+right-click snap menu | yes | **no** (a right click is Enter) |
| Tab to cycle candidate snaps | yes | **no** |
| AutoSnap marker, tooltip, magnet, aperture box | yes | marker and name label, aperture from APERTURE; acquired tracking points are marked; no magnet, no aperture box |
| OSNAPZ, 3D object snaps | yes | no |

## Tracking, polar, ortho, grid and snap (≈ 55%)

The engine has these (`Session::snap_cursor`, `snap/tracking.rs`, `snap/iso.rs`). The interface
reaches them through one facade call, `pointer`, made once a frame while a command wants a
point: it returns the point a click will take, what constrained it (`osnap`, `ortho`, `polar`,
`grid` or `track`), a label, the rays to draw and the acquired points. `click` resolves the
same way, so the point shown is the point taken. The function keys take effect in the middle
of a command.

| Feature | AutoCAD | CADCraft |
|---|---|---|
| Ortho (F8) | yes, Shift overrides it while held | yes: a click is held to the ortho axis from the base point, with the ray drawn and a label ("Ortho: d < a°"); Shift flips it while held; a window's second corner ignores it. Tried in Chromium by its author |
| Polar tracking increment | yes | yes (F10): near an increment the pointer takes the polar path, with the ray and "Polar: d < a°"; free elsewhere. Tried in Chromium by its author |
| Additional polar angles, relative to last segment | yes | additional angles yes (engine, POLARADDANG with POLARMODE 4); **relative to the last segment no** |
| Polar distance snap (PolarSnap) | yes | **no** |
| **Object snap tracking** (acquire points, alignment paths, intersections of paths) | yes, F11 | yes: resting on a snap point acquires it after a dwell, acquired points and their alignment paths are drawn, crossings of paths snap, and the label names each path (engine #379, facade `pointer`). Tried in Chromium by its author |
| Grid (rectangular, major lines, adaptive, limits) | yes | the canvas draws its own adaptive decade grid with the axes; it does not follow the Grid toggle (F7), GRIDUNIT or the isometric grid |
| Snap (rectangular, isometric, polar snap) | yes | yes (F9): a click takes the grid point, shown as a dot. Tried in Chromium by its author. The isometric snap style is the engine's and was not tried here |
| Isometric drafting (ISODRAFT, isoplanes F5) | yes | ISODRAFT and the status toggle set the engine's state, and ortho follows the plane's axes in the engine; no F5, and the canvas draws no isometric grid or crosshair. Not tried in this interface |
| ARC direction with Ctrl | yes | Ctrl is passed to the engine with the pointer; covered by Rust tests only |
| Drafting Settings dialog | yes | **no** (no dialogs) |
| Hatch and Gradient / Hatch Edit dialogs | yes | **no**: HATCH and HATCHEDIT run at the command line |

## Dynamic input (0%)

AutoCAD's heads-up input (F12) has editable pointer-input fields, dimensional input fields with
Tab between them, relative-by-default second points, a prompt with clickable options and a
down-arrow menu. The web interface draws none of it. F12 and the status toggle set DYNMODE and
nothing reads it. The egui interface had pointer input boxes (#60); they were removed with it.

## Grips (0%)

The engine has grips (`grips.rs`: stretch grips per object type, hot-grip modes and options,
polyline grip menus, dynamic block grips) and JSON grip commands. The web interface draws no
grips and has no way to drag one. A selected object is highlighted only.

## Selection (≈ 30%)

| Feature | AutoCAD | CADCraft |
|---|---|---|
| Pick, implied window (left→right) and crossing (right→left) | yes | yes: a click picks with the engine's pick box; a left drag is a window to the right and a crossing to the left (`CanvasView.tsx`, `selection.ts`). The rectangles are drawn; SELECTIONAREA colours are not read |
| Keywords W, C, WP, CP, F, BOX, AU, SI, M, G (group), CL (class) | yes | typed at "Select objects" (engine), yes except CLass; a dragged rectangle is given to the command as its box selection |
| Press-drag selection windows (PICKDRAG) | yes | drag only; the two-click window and the PICKDRAG setting are not read |
| Lasso | yes | **no** |
| Selection cycling (SELECTIONCYCLING) | yes | **no** list or badge; the nearest object is picked |
| Selection preview, hover highlight | yes | yes: the object a click would select is outlined, at rest and while a command asks for objects (facade `pick`, which leaves the selection alone), and it follows the engine's selection-preview filter, so an object on a locked layer does not light; selected objects are drawn in the selection colour. The selection-area colours are not read |
| PICKADD, PICKFIRST, PICKAUTO | yes | PICKADD (a pick adds and Shift removes, or the reverse, as the variable says); a selection made at rest is there when a command starts |
| QSELECT, SELECTSIMILAR, FILTER | yes | QSELECT has no dialog; SELECTSIMILAR runs at the command line; no FILTER |
| Object isolate/hide (ISOLATEOBJECTS, HIDEOBJECTS) | yes | the commands run from the menu and the command line (engine); no status-bar button |
| Groups selectable as one (PICKSTYLE) | yes | engine (PICKSTYLE 1); not checked through the pointer |
| Escape clears the selection | yes | yes, when no command is running |

## Command line (≈ 45%)

| Feature | AutoCAD | CADCraft |
|---|---|---|
| AutoComplete (commands, sysvars, mid-string, synonyms) | yes | **not in the command line.** The command palette (Ctrl+Shift+P) searches every command by name, menu path and alias, and the assistant's composer lists commands for a draft that starts with `/` |
| Aliases | about 250 in `acad.pgp` | 144 aliases across the commands (engine, counted from source 2026-10-10) |
| History, Up/Down recall | yes | a scrollback above the field; Up and Down walk the lines sent. No F2 text window |
| Transparent commands (`'zoom`, `'pan`, `'osnap`) | yes | yes (engine) |
| Enter/Space repeats last command | yes | yes, in the field and on the drawing; a right click on the drawing is Enter |
| Clickable keywords in the prompt | yes | yes, as chips |
| Escape cancels | yes | yes: the engine's own cancel (`*Cancel*` in the history); typed text is cleared first |
| Typing on the drawing goes to the command line | yes | yes |
| UNDO with Mark, Back, BEgin, End, Auto, Control | yes | engine |
| SETVAR for every system variable | ~1,000 sysvars | about 150 by name (engine) |
| Scripts (SCRIPT, `.scr`) | yes | script text through the CLI and MCP; the SCRIPT command needs a file path, which the web interface cannot give |
| Floating/docked command window, transparency, lines of history | yes | docked as the panel under the drawing; folds with Ctrl+J or Ctrl+9 |

## Chrome and palettes (≈ 20%)

| Feature | AutoCAD for Mac | CADCraft |
|---|---|---|
| Menu bar | 11 menus, 491 leaf items | the same 11 menus, built from the command registry, in groups with separators, each row showing the name typed at the command line and its shortcut; breadth is in [parity-checklist.md](parity-checklist.md). Pointing at another title while one is open opens it; full keyboard walk; one Main menu key at 900px and under |
| Tool Bar | yes | yes: file, undo/redo, 7 draw tools, 8 modify tools, linear dimension, zoom and pan, properties, layers, measure, print; an overflow menu, in the strip's groups, when the window is narrow |
| File tabs, Start tab | yes | **no**: one drawing at a time, named in the title bar |
| Layout tabs | yes | yes, as the tabs over the drawing (Model and each layout); no tab menu, rename or reorder |
| Tool Sets palette (Drafting, Modeling, … with flyouts) | yes | **no** (the tool strip stands in) |
| Properties Inspector, Quick Properties | yes | Properties in the sidebar: the drawing's defaults, a single selection and a multiple selection; layer, colour, linetype, linetype scale, lineweight, transparency, thickness and visibility are edited through `properties.set`, which refuses a bad value and says why. No per-object geometry fields, no Quick Properties |
| Layer Properties Manager (filters, states, VP overrides) | yes | **no.** The Layers palette lists the layers with colour, on, frozen and locked keys and sets the current layer; creating, renaming and the other properties go through the LAYER command line |
| Blocks palette, Content | yes | **no** |
| Status bar toggles | ~25 | 11 toggles (Grid, Snap, Ortho, Polar, Iso, OTrack, OSnap, LW, Transp, Dyn, QP) with their function keys; they set the engine's settings. Snap, Ortho, Polar, OTrack and OSnap change what the pointer does, also in the middle of a command; Grid, Iso, LW, Transp, Dyn and QP change nothing on the canvas |
| Command palette | no | yes: every command with its menu path, command-line name and shortcut, ranked, the recently used first |
| ViewCube | interactive 3D | **no** |
| Navigation bar, SteeringWheels | yes | no |
| Workspaces | Drafting & Annotation, 3D Modeling | no |
| Options / Preferences dialog | many tabs | **no** (OPTIONS has a JSON form in the engine; no dialog) |
| Other dialogs (Plot, Page Setup, Hatch, Dimension Style, Block Editor, in-place MTEXT editor, Units, Drafting Settings, External References) | yes | **none.** The commands run as their command-line prompts |
| Customisation (CUI, aliases editor, tool palettes) | yes | no |
| Themes | Dark, Light | Dark, Light, System; every text, icon, border and focus-ring pair has a measured contrast in both (`apps/ui/docs/system/colors.md`) |
| Interface languages | 8 | English only (the egui interface's catalogs were removed with it) |
| Accessibility | VoiceOver basics | every control has a name; menus, toolbar, tabs and toggles follow the standard keyboard patterns, each as one Tab stop; F6 walks the regions; the command line is a live log; animation follows the system's reduced-motion setting (View ▸ Accessibility ▸ Animation Effects). Read from the code and its tests; not tried with a screen reader in this pass |
| Narrow windows | n/a | the menus fold at 900px, the tool strip folds its overflow, the status bar gives way in order, the assistant takes the workspace at 560px |

## Navigation (≈ 50%)

| Feature | AutoCAD | CADCraft |
|---|---|---|
| ZOOM Extents, All, Window, Previous, In/Out, Center, Scale, Object | yes | yes (engine); the canvas follows a view a command moved |
| ZOOM Realtime (drag), Dynamic | yes | engine (#463); not checked through this interface |
| Wheel zoom about cursor, ZOOMFACTOR, ZOOMWHEEL | yes | wheel zoom about the pointer; the factor is the interface's own |
| Middle-drag pan, double-middle-click extents | yes | yes |
| Trackpad two-finger pan, pinch zoom | yes | pinch zoom through the wheel event; a touch screen pans with one finger and pans and pinches with two (not tried on a device) |
| The view holds when the window or a panel changes size | yes | yes; a view nobody has moved is fitted again |
| Named views (VIEW) | yes | engine (#463); no dialog |
| Tiled model-space viewports (VPORTS) | yes | **no**: the interface shows one view |
| 3D orbit, ViewCube drag, SteeringWheels | yes | no (M11) |

## Keyboard and context menus (≈ 20%)

- Chords: every shortcut a command carries runs it (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Z,
  Ctrl+Shift+Z …), plus the interface's own: Ctrl+Shift+P or F1 (palette), Ctrl+B (sidebar),
  Ctrl+J and Ctrl+9 (command line), Ctrl+1 (Properties), Ctrl+7 (assistant), F6 and Shift+F6
  (next and previous part). The full table is in [apps/ui/README.md](../apps/ui/README.md#keyboard).
- Function keys: F3, F7, F8, F9, F10, F11 and F12 flip their drafting settings, and F3, F8, F9,
  F10 and F11 change the pointer at once, in the middle of a command too. F2 (text window), F4
  and F5 (isoplane) do nothing.
- Escape cancels the running command, or clears the selection. Delete does not erase the
  selection.
- Right-click on the drawing is Enter. **There are no context menus anywhere**: not on the
  drawing, the command line, the tabs, the Layers rows or the Properties palette.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-11 | minor | The pointer is resolved by the engine's snapped cursor (facade `pointer`, `Session::snap_cursor`): ortho with Shift to flip it, polar tracking, grid snap and object snap tracking constrain a click, with a label, the rays and the acquired points drawn; Extension, Parallel and Apparent Intersection are reached by the same call; direct distance entry follows the path; hover follows the selection-preview filter; menus are grouped and show typed names. Point entry 40% → 45%, object snaps 30% → 40%, tracking 10% → 55%; total 24.5 → 31.3 (≈ 25% → ≈ 31%), hand-assessed from the source. Its author tried ortho, polar, grid snap and tracking in Chromium; Extension, Parallel, Apparent Intersection and the typed distance on a path are read from the source only |
| 2026-11-11 | major | Re-measured against the web interface (`apps/ui`, main at ec61741) after the egui interface was removed. Every area re-scored from the source; total ≈ 48% → ≈ 25% (hand-assessed, not run). Gained: pointer drawing with rubber band, snap marker and snapped clicks, hover highlight, window and crossing selection, PICKADD, the command palette, full keyboard patterns, measured contrast in two themes, narrow-window behaviour. Lost with egui: every dialog, grips, dynamic input, context menus, the snapped cursor (ortho, polar, grid snap, tracking, Extension, Parallel, Apparent Intersection; restored later the same day, the row above), Tab snap cycling, selection cycling, file tabs, Tool Sets, Layer Properties Manager, Blocks palette, ViewCube, interface languages. The hours estimate is not re-estimated |
| 2026-10-22 | minor | Polyline segment midpoint grips use rectangles, distinct from square vertex grips, with matching hover and pick bounds (#1950) |
| 2026-10-13 | minor | Filled-region highlight boundaries are traversed in deterministic coordinate order, fixing dash-phase jumps on CPU hover/selection redraws and GPU highlight rebuilds; CPU dash-position, pixel and GPU mesh regressions |
| 2026-10-14 | minor | Selection cycling (#1143): the list and badge of SELECTIONCYCLING, Shift+Space through overlapping objects (#1145) |
| 2026-10-14 | minor | Hatch Edit dialog adds boundaries from picked points or closed objects and removes selected loops |
| 2026-10-14 | minor | Holding Shift overrides ortho while it is held (on when ORTHOMODE is off, off when it is on), as in AutoCAD |
| 2026-10-16 | minor | ALIASEDIT opens the Command Aliases dialog (#1381) |
| 2026-10-18 | minor | In-window menu bar: once a menu is open, pointing at another title closes it and opens that one (#1567) |
| 2026-10-13 | minor | Options ▸ Selection adds Select using two clicks only; PICKDRAG 0 disables drag-window creation/completion, 2 preserves clicks or drag, and the preference survives restart; UI pointer and profile regressions |
| 2026-10-12 | minor | Selected and hovered objects redrawn in the selection colour (text and arrowheads included); Options ▸ Selection laid out as AutoCAD's: Object grouping, Show grips, grip object limit, selection preview, Visual Effect Settings (selection area, preview filter) |
| 2026-10-12 | minor | Animation effects (dialog and menu fades, smoothed wheel scrolling and ⌘/Ctrl+wheel zoom) follow the operating system's setting; View ▸ Accessibility ▸ Animation Effects chooses System, On or Off |
| 2026-10-12 | minor | Hatch and Gradient / Hatch Edit dialogs (HATCH, GRADIENT, HATCHEDIT, double-click a hatch; HPDLGMODE) |
| 2026-10-12 | minor | Block references now show their stored insertion X/Y/Z in the Properties Inspector, including nonzero Z; fields are read-only |
| 2026-10-11 | minor | Isometric drafting (#556): isometric snap and grid, ISODRAFT, ISOPLANE (F5), ortho along isoplane axes, ELLIPSE Isocircle |
| 2026-10-11 | minor | Object snap tracking, Extension, Parallel, Apparent Intersection, additional polar angles (#379): tracking 30% → 70%, object snaps 40% → 45%; total 43% → 48% |
| 2026-10-10 | minor | Dynamic input 15% → 45% (pointer boxes, #60); press-drag windows (#63); total 40% → 43% |
| 2026-10-10 | major | First UI-parity audit: point entry, snaps, tracking, dynamic input, grips, selection, command line, chrome, navigation, keys |

Rows dated before 2026-11-11 describe the removed egui interface, except where they name an
engine file.
