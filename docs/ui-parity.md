# UI parity

> **Last reviewed:** 2026-11-12 · **Last updated:** 2026-11-12 · **Change:** minor (dynamic input at the pointer, the Layer Properties Manager, paper under a layout, recovery of unsaved work: UI/UX fidelity ≈ 37% → ≈ 42%; earlier the same day, grips, right-click menus and the first dialog, ≈ 31% → ≈ 37%; on 2026-11-11, major: re-measured against the web interface, ≈ 48% → ≈ 25%) · **Target:** Autodesk AutoCAD 2027 for Mac (26.0)

How CADCraft's interaction compares with AutoCAD's: point entry, object snaps, tracking, dynamic
input, grips, selection, the command line, chrome and navigation. A drafter's speed in AutoCAD
comes from these, so "the command exists" isn't enough: it has to accept the same input, snap to
the same points and respond to the same keys. Work items: [gaps.md](gaps.md#uiux).

**Headline (estimated): UI/UX fidelity ≈ 42%.** The interface is the SolidJS app in `apps/ui`,
in a browser tab or in the desktop app's native webview. The egui interface was removed on
2026-11-11, and most of its dialogs and its translations went with it. What the engine does
for typed input still works: the command line, point syntax, point modifiers and typed snap
overrides. The pointer draws: a click gives a running command its point, resolved by the
engine's own snapped cursor, so object snaps, ortho, polar tracking, grid snap and object snap
tracking constrain it, and with dynamic input on, the prompt and its fields follow the pointer.
A selection shows its grips. A right click opens a menu. A layout draws its sheet of paper.
Two dialogs exist, Drafting Settings and the Layer Properties Manager; the others and the snap
menu are still missing. Remaining: **≈ 110–170 Opus 5.5 hours** was the estimate for the egui
interface; it has not been re-estimated for this one.

## How this was measured

- CADCraft, interface: read from the source on 2026-11-11 (main at ec61741, then the working
  tree after the snapped-cursor work): `apps/ui/src` (`app.tsx`, `components/*`, `commands.ts`,
  `facade.ts`, `canvas.ts`), `crates/wasm/src/lib.rs` (the facade) and `apps/cadcraft` (the
  desktop shell). Not run in this pass. The author of the snapped-cursor work reports ortho,
  polar, grid snap and tracking tried in Chromium on the wasm engine, the deferred tangent and
  ARC's Ctrl switch covered by Rust tests only, and nothing checked at narrow widths.
- 2026-11-12: re-read at 43dd130 for grips, right-click menus and the Drafting Settings dialog
  (`components/CanvasView.tsx`, `canvas.ts`, `context.ts`, `components/ContextMenu.tsx`,
  `components/DraftingSettings.tsx`, `drafting.ts`, `ui/Dialog.tsx`, the facade's grip calls).
  Not run in this pass. The author of the grip work reports these limits: every grip is drawn
  as a square, dynamic-block grips are unit-tested only and were never seen in a browser, grips
  do not work for touch, and the mock engine has none.
- 2026-11-12, again at 0ca8810: dynamic input (`dynamic.ts`, `components/DynamicInput.tsx`), the
  Layer Properties Manager (`layer-manager.ts`, `components/LayerManager.tsx`), paper under a
  layout (`display.ts`, `canvas.ts`, the facade's `space` and `sheet`) and recovery copies
  (`autosave.ts`, `components/RecoveryBar.tsx`). Not run in this pass. Their authors report
  what was not checked; each section below repeats it. The commits that
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
| Tracking, polar, ortho, grid/snap | 10% | 70% | 60% | 6.0 |
| Dynamic input | 10% | 45% | 40% | 4.0 |
| Grips | 10% | 40% | 35% | 3.5 |
| Selection | 10% | 40% | 30% | 3.0 |
| Command line | 10% | 60% | 45% | 4.5 |
| Chrome and palettes | 10% | 45% | 35% | 3.5 |
| Navigation | 5% | 55% | 55% | 2.8 |
| Keyboard shortcuts, context menus | 5% | 25% | 35% | 1.8 |
| **Total** | 100% | ≈ 48% | | **41.8 ≈ 42%** |

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
| Shift/Ctrl+right-click snap menu | yes | **no**: the right-click menus have no snap overrides |
| Tab to cycle candidate snaps | yes | **no** |
| AutoSnap marker, tooltip, magnet, aperture box | yes | marker and name label, aperture from APERTURE; acquired tracking points are marked; no magnet, no aperture box |
| OSNAPZ, 3D object snaps | yes | no |

## Tracking, polar, ortho, grid and snap (≈ 60%)

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
| Drafting Settings dialog | yes | yes: Snap and Grid (each switch and its X and Y spacing), Polar Tracking (the switch, the increment angle, additional angles) and Object Snap (the switch, tracking, a box per running snap beside its marker). Opened from Tools ▸ Drafting Settings..., by typing DSETTINGS, DS or SE at an idle command line, and by a right click on a status-bar drafting toggle, which opens that toggle's page. OK sends only what changed; a refused value is shown beside its field (`DraftingSettings.tsx`, `drafting.ts`) |
| Hatch and Gradient / Hatch Edit dialogs | yes | **no**: HATCH and HATCHEDIT run at the command line |

## Dynamic input (≈ 40%)

With DYN on (F12 or the status toggle), a box beside the pointer says what the running command
asks and takes the answer there (`dynamic.ts`, `components/DynamicInput.tsx`). What is typed in
it is the command line's own input: every edit is echoed into the command line's field and
every line is sent through it.

| Feature | AutoCAD | CADCraft |
|---|---|---|
| Pointer input fields (X, Y) | yes | yes, for a first point; a field with nothing typed shows the pointer's value |
| Dimensional input (distance and angle) for a next point | yes | yes: Distance and Angle from the last point |
| A single value (a radius, a count) | yes | yes, one field |
| Typed values lock, with a lock icon | yes | yes: a typed field is locked, shows a padlock and holds the rubber band to its value; emptying it unlocks |
| Tab between fields; `,` to Y; `<` to the angle | yes | yes |
| Relative by default for a second point, `#` for absolute, `@` for relative | yes | yes |
| The prompt at the pointer, Down arrow for its options (DYNPROMPT) | yes | yes: the prompt in a quiet line; Down lists the prompt's keywords |
| Typed angles follow the drawing's angle settings | yes | **no**: a typed angle is previewed as degrees counter-clockwise from +X whatever ANGBASE, ANGDIR and the angle units say (its author's report) |
| Works wherever the keyboard is | yes | **partly**: it takes typing only while the drawing has the focus and the command line is on screen (its author's report) |
| Dimensional input on grips (length and angle while stretching) | yes | not checked: a grip edit is a running command with a point prompt, so the box may show; nothing in the source is specific to grips |
| DYNMODE, DYNPIFORMAT, DYNPICOORDS, DYNDIM settings | yes | DYNMODE only (on or off) |

Its author verified it in a browser; it has no component test (`dynamic.ts` has unit tests).

## Grips (≈ 35%)

The engine has grips (`grips.rs`) and the facade lists, hit-tests and edits them (`grips`,
`gripAt`, `gripStart`, `gripOptions`, `gripOption`). The interface draws a selection's grips
and edits through the engine's own grip command, so a grip edit is a running command: its
prompt, keywords, snapped cursor and Escape are the command line's.

| Feature | AutoCAD | CADCraft |
|---|---|---|
| Stretch grips per object type | yes | the engine's set: lines, arcs, ellipses, polylines (vertices and segment midpoints), dimensions, MLEADER, viewport, wipeout, spline (`grips.rs`). Drawn for the selection; the grip under the pointer warms |
| Editing a grip | press, drag, release; or click, move, click | both: a press that is dragged commits where it is released, a press that was a click commits at the next click (`CanvasView.tsx`, `app.tsx` `gripStart`) |
| Text/MText grips | position, width, column grips | move the whole object (engine) |
| Hot-grip modes with Space/Enter cycling | Stretch, Move, Rotate, Scale, Mirror | yes: Space or Enter on the drawing is the command's empty Enter, which cycles the modes |
| Hot-grip options: Base point, Copy, Undo, Reference, eXit | yes | the prompt's keywords, as chips on the command line and rows of the right-click menu. Copy, Base point and Undo are reported working; Reference and eXit were not checked |
| Several hot grips at once (Shift-click) | yes | yes: Shift on a grip collects it for the next edit |
| Multifunctional grip menus (Add Vertex, Remove Vertex, Convert to Arc, Lengthen …) | yes | yes for the grips the engine gives options: the menu opens when the pointer rests on the grip, and on a right click of it. No Ctrl to cycle the options |
| Escape | cancels the edit, then clears | yes: the first Escape cancels the edit, a second clears the selection |
| Grip dimensional input (length/angle fields) | yes | not checked (see Dynamic input) |
| Dynamic block grips | yes | the engine's dynamic-block grips go through the same calls; unit-tested only, never seen in a browser |
| Grip appearance (GRIPSIZE, colours, kinds) | yes | **every grip is a square**: kinds (a polyline's midpoint rectangle, a dynamic block's arrow) are not distinguished; the size comes from the engine's reply; no grip colours |
| Grips with touch | n/a | **no**: a finger pans; grips need a mouse or a pen |

## Selection (≈ 30%)

| Feature | AutoCAD | CADCraft |
|---|---|---|
| Pick, implied window (left→right) and crossing (right→left) | yes | yes: a click picks with the engine's pick box; a left drag is a window to the right and a crossing to the left (`CanvasView.tsx`, `selection.ts`). The rectangles are drawn; SELECTIONAREA colours are not read |
| Keywords W, C, WP, CP, F, BOX, AU, SI, M, G (group), CL (class) | yes | typed at "Select objects" (engine), yes except CLass; a dragged rectangle is given to the command as its box selection |
| Press-drag selection windows (PICKDRAG) | yes | drag only; the two-click window and the PICKDRAG setting are not read |
| Lasso | yes | **no** |
| Selection cycling (SELECTIONCYCLING) | yes | **no** list or badge; the nearest object is picked |
| Selection preview, hover highlight | yes | yes: the object a click would select is outlined, at rest and while a command asks for objects (facade `pick`, which leaves the selection alone), and it follows the engine's selection-preview filter, so an object on a locked layer does not light; a selected or hovered object is drawn with a halo under it, so each object keeps its own colour. The selection-area colours are not read |
| PICKADD, PICKFIRST, PICKAUTO | yes | PICKADD (a pick adds and Shift removes, or the reverse, as the variable says); a selection made at rest is there when a command starts |
| QSELECT, SELECTSIMILAR, FILTER | yes | QSELECT has no dialog; SELECTSIMILAR runs at the command line; no FILTER |
| Object isolate/hide (ISOLATEOBJECTS, HIDEOBJECTS) | yes | the commands run from the menu and the command line (engine); no status-bar button |
| Groups selectable as one (PICKSTYLE) | yes | engine (PICKSTYLE 1); not checked through the pointer |
| Escape clears the selection | yes | yes, when no command is running |
| A menu for the selection | yes | yes: a right click with objects selected offers Erase, Move, Copy, Rotate, Scale, Mirror, the clipboard, Draw Order, Deselect All and Properties |

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
| Dynamic input types into it | yes | yes: what is typed at the pointer is echoed in the command line's field and sent through it |
| Floating/docked command window, transparency, lines of history | yes | docked as the panel under the drawing; folds with Ctrl+J or Ctrl+9 |

## Chrome and palettes (≈ 35%)

| Feature | AutoCAD for Mac | CADCraft |
|---|---|---|
| Menu bar | 11 menus, 491 leaf items | the same 11 menus, built from the command registry, in groups with separators, each row showing the name typed at the command line (lower case, quiet) and its shortcut; a submenu opens beside its whole menu; breadth is in [parity-checklist.md](parity-checklist.md). Pointing at another title while one is open opens it; full keyboard walk; one Main menu key at 900px and under |
| Tool Bar | yes | yes: file, undo/redo, 7 draw tools, 8 modify tools, linear dimension, zoom and pan, properties, layers, measure, print; an overflow menu, in the strip's groups, when the window is narrow |
| File tabs, Start tab | yes | **no**: one drawing at a time, named in the title bar |
| Drawing recovery | Drawing Recovery Manager | yes, in the interface's own form: a recovery copy is kept in the browser's IndexedDB three seconds after the last change and when the page is hidden or closed, and the next start shows a bar offering Restore, Save a copy… and Discard. Nothing is restored or thrown away silently; copies stay on the device (`autosave.ts`, `components/RecoveryBar.tsx`). Limits its author reported: the title's unsaved mark stays after Save, a zoom after Save can leave a copy, and the desktop webview's persistence was read from code, not run |
| Layout tabs | yes | yes, as the tabs over the drawing (Model and each layout), with a right-click menu: New Layout, Rename... (finished at the command line), Delete, Page Setup. No reorder, no in-place rename |
| Paper space on screen | a sheet with its printable area | yes: a layout draws its sheet and printable area, colour-7 objects are inked dark on the paper, and the selection, grip and snap inks are chosen for it. Light layer colours (yellow, cyan, green) are low-contrast on paper and left as they are. Not checked in a browser by its author: the wheel, snap markers and hover on paper, and widths under 1280 |
| Tool Sets palette (Drafting, Modeling, … with flyouts) | yes | **no** (the tool strip stands in) |
| Properties Inspector, Quick Properties | yes | Properties in the sidebar (its header says "N selected"): the drawing's defaults, a single selection and a multiple selection; layer, colour, linetype, linetype scale, lineweight, transparency, thickness and visibility are edited through `properties.set`, which refuses a bad value and says why. No per-object geometry fields, no Quick Properties |
| Layer Properties Manager (filters, states, VP overrides) | yes | yes, as a dialog: a grid of layers edited in place (name, on, freeze, lock, plot, colour from the seven named colours, linetype, lineweight, transparency, description), several rows selected and changed together in one undo step, New, Rename, Delete, Set current, a name filter, sorting, and the keyboard throughout. Opened from Format ▸ Layers, the tool strip's Layers key, and LAYER or LA typed at an idle command line (`LayerManager.tsx`, `layer-manager.ts`). **Not there:** layer states, property filters, viewport overrides, a full colour picker (index or true colour) |
| Layers palette | yes | the sidebar's list: colour, on, frozen and locked keys (shown on hover or when not at their default), the current layer, and a row's right-click menu (Make Current, Turn Off, Freeze, Lock, Select Objects, Isolate, Rename..., Delete) |
| Blocks palette, Content | yes | **no** |
| Status bar toggles | ~25 | 11 toggles (Grid, Snap, Ortho, Polar, Iso, OTrack, OSnap, LW, Transp, Dyn, QP) with their function keys; they set the engine's settings, and a right click on one opens Drafting Settings on its page. Snap, Ortho, Polar, OTrack and OSnap change what the pointer does, also in the middle of a command; Dyn shows dynamic input at the pointer; Grid, Iso, LW, Transp and QP change nothing on the canvas |
| Command palette | no | yes: every command with its menu path, command-line name and shortcut, ranked, the recently used first |
| ViewCube | interactive 3D | **no** |
| Navigation bar, SteeringWheels | yes | no |
| Workspaces | Drafting & Annotation, 3D Modeling | no |
| Options / Preferences dialog | many tabs | **no** (OPTIONS has a JSON form in the engine; no dialog) |
| Drafting Settings dialog | yes | yes, the interface's first dialog (see Tracking above), on the design system's Dialog: a native modal with a title bar, a scrolling body and actions |
| Other dialogs (Plot, Page Setup, Hatch, Dimension Style, Block Editor, in-place MTEXT editor, Units, External References) | yes | **none.** The commands run as their command-line prompts |
| Customisation (CUI, aliases editor, tool palettes) | yes | no |
| Themes | Dark, Light | Dark, Light, System; every text, icon, border and focus-ring pair has a measured contrast in both (`apps/ui/docs/system/colors.md`) |
| Interface languages | 8 | English only (the egui interface's catalogs were removed with it) |
| Accessibility | VoiceOver basics | every control has a name; menus, toolbar, tabs and toggles follow the standard keyboard patterns, each as one Tab stop; F6 walks the regions; the command line is a live log; animation follows the system's reduced-motion setting (View ▸ Accessibility ▸ Animation Effects). Read from the code and its tests; not tried with a screen reader in this pass |
| Narrow windows | n/a | the menus fold at 900px, the tool strip folds its overflow, the status bar gives way in order, the assistant takes the workspace at 560px |

## Navigation (≈ 55%)

| Feature | AutoCAD | CADCraft |
|---|---|---|
| ZOOM Extents, All, Window, Previous, In/Out, Center, Scale, Object | yes | yes (engine); the canvas follows a view a command moved, and holds it through the resize that follows; on a layout, Zoom Extents frames the sheet |
| Each space keeps its own view | yes | yes: Model and each layout come back at the view they were left at |
| ZOOM Realtime (drag), Dynamic | yes | engine (#463); not checked through this interface |
| Wheel zoom about cursor, ZOOMFACTOR, ZOOMWHEEL | yes | wheel zoom about the pointer; the factor is the interface's own |
| Middle-drag pan, double-middle-click extents | yes | yes |
| Trackpad two-finger pan, pinch zoom | yes | pinch zoom through the wheel event; a touch screen pans with one finger and pans and pinches with two (not tried on a device) |
| The view holds when the window or a panel changes size | yes | yes; a view nobody has moved is fitted again |
| Named views (VIEW) | yes | engine (#463); no dialog |
| Tiled model-space viewports (VPORTS) | yes | **no**: the interface shows one view |
| 3D orbit, ViewCube drag, SteeringWheels | yes | no (M11) |

## Keyboard and context menus (≈ 35%)

- Chords: every shortcut a command carries runs it (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Z,
  Ctrl+Shift+Z …), plus the interface's own: Ctrl+Shift+P or F1 (palette), Ctrl+B (sidebar),
  Ctrl+J and Ctrl+9 (command line), Ctrl+1 (Properties), Ctrl+7 (assistant), Ctrl+K (ask the assistant from the drawing), F6 and Shift+F6
  (next and previous part). The full table is in [apps/ui/README.md](../apps/ui/README.md#keyboard).
- Function keys: F3, F7, F8, F9, F10, F11 and F12 flip their drafting settings, and F3, F8, F9,
  F10, F11 and F12 (dynamic input) change the pointer at once, in the middle of a command too. F2 (text window), F4
  and F5 (isoplane) do nothing.
- Escape cancels the running command (a grip edit included), or clears the selection. The
  Delete key does not erase the selection; Erase is in the selection's menu.
- Right-click menus, built on the menu bar's own menu (the same rows, keys and typeahead):
  - on the drawing at rest: Repeat, Recent Commands, Undo and Redo, Pan and Zoom, Select All and
    Quick Select, Paste, Options;
  - on the drawing with a selection: Repeat, Erase, Move, Copy, Rotate, Scale, Mirror, the
    clipboard, Draw Order, Deselect All, Properties;
  - while a command runs: Enter, Cancel, the prompt's keywords, transparent Pan and Zoom. A
    quick right click (under 250 ms, not moved) is still Enter; a held one opens the menu, as
    AutoCAD's time-sensitive right click does;
  - on a grip: the engine's options for that grip;
  - on a layer row and on a layout tab (see Chrome above).
- The menu key and Shift+F10 open the same menu for what has the focus, and a finger held
  still for 500 ms opens the drawing's.
- **Still missing:** the Shift+right-click snap menu (and snap overrides in the command menu),
  Recent Input, menus on the command line and on the Properties palette, and a menu on a status
  toggle (its right click opens Drafting Settings).

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-12 | patch | Beyond the reference, so no score moves: the interface opens on a jewelry sample, the sidebar has a Bench section (the engine's bench sheet, live), the tool strip a jewelry group, and Ctrl+K asks the assistant from the drawing ([jewelry.md](jewelry.md#in-the-interface)) |
| 2026-11-12 | minor | Read at 0ca8810: dynamic input at the pointer (prompt, X/Y or distance/angle or one value, typed values lock, Tab, comma, `<`, `@`, `#`, Down for the options), the Layer Properties Manager as a dialog, paper under a layout with per-space views and extents on the sheet, recovery copies with a bar on the next start. Dynamic input 0% → 40%, chrome and palettes 25% → 35%, navigation 50% → 55%; total 36.5 → 41.8 (≈ 37% → ≈ 42%), hand-assessed from the source, not run. Limits kept from their authors: dynamic input needs the drawing focused and the command line shown, and previews typed angles as degrees counter-clockwise from +X; paper was not checked for the wheel, snap markers, hover or widths under 1280; the manager has no layer states, filters, viewport overrides or full colour picker |
| 2026-11-12 | minor | Read at 43dd130: grips on the drawing (drawn for the selection, press-drag-release or click-move-click through the engine's grip command, Space to cycle the modes, keyword options, Shift for several hot grips, multifunctional grip menus), right-click menus (drawing at rest, with a selection, during a command, grips, layer rows, layout tabs; the menu key, Shift+F10, a long press), the first dialog (Drafting Settings), selection and hover as a halo that keeps each object's colour. Grips 0% → 35%, keyboard and context menus 20% → 35%, chrome 20% → 25%, tracking 55% → 60% (the dialog); total 31.3 → 36.5 (≈ 31% → ≈ 37%), hand-assessed from the source, not run. Limits kept from the grip work's author: every grip is a square, dynamic-block grips unit-tested only, no grips for touch |
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
