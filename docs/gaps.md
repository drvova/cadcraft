# Where CADCraft falls short of AutoCAD

> **Last reviewed:** 2026-10-10 (engine rows) · 2026-11-12 (interface rows) · **Last updated:** 2026-11-12 · **Change:** minor (recovery copies, dynamic input, the Layer Properties Manager, paper under a layout and a wider drafting font landed: rows 5, 7, F4, W1, W4, W7, W11 narrowed, W15 and W16 added; earlier the same day W1, W2, W5 narrowed; on 2026-11-11, major: the egui interface was removed, rows W1–W14 added) · **Target:** Autodesk AutoCAD 2027

**The interface changed on 2026-11-11.** The egui interface was removed. The interface is the
SolidJS app in `apps/ui`, in a browser tab or in the desktop app's native webview, over the
engine compiled to WebAssembly. Engine rows below stand. A row that says a dialog, palette or
editor "landed" describes the removed interface: the engine command is still there and runs as
its command-line prompts, and the dialog is a gap again (W1; Drafting Settings and the Layer
Properties Manager are the dialogs the new interface has). The measured state of the
interface is in [ui-parity.md](ui-parity.md).

Every known shortfall, one row each, ranked within each section by user impact. This is the work
list: agents pick from here (top of a section first), and remove or update a row in the same PR
that closes it. Numbers and weights live in [target-app-parity.md](target-app-parity.md); hours
are Opus 5.5 agent-hours, calibrated as explained there. "Est." means a judgement from the cited
evidence. Rows marked **[alpha blocker]** are what fails the [alpha gate](roadmap.md#alpha-gate);
do them first.

## Top 10 across everything

| # | Gap | Why it ranks here | Est. | Doc |
|---|---|---|---|---|
| 1 | **[alpha blocker]** **Saving DWG drops what we don't model** (DXF now writes back unknown entities and objects, foreign xdata, extension dictionaries, reactors, layer states and colour books, #528, and native MULTILEADERs, #459 (not yet tested through DWG); through DWG, acadrust drops custom-class entities and objects, xdata on table records and blocks, entity colour books and reactors) | Opening a colleague's DWG and saving it still deletes some content: the one thing a CAD user can't forgive | 6–10 | [file formats](file-format-parity.md) |
| 2 | **[alpha blocker]** **No real-file test corpus and no check in AutoCAD** | All 36 file tests are synthetic; nobody has verified a CADCraft DWG/DXF opens cleanly in AutoCAD | 10–15 + human | [file formats](file-format-parity.md#tests) |
| 3 | **Ellipse and spline geometry is tessellated** (intersections, offsets, closest points; polyline offset ignores bulges) | Coordinates are subtly wrong; offsets of ellipses come out as polylines | 30–50 | [geometry](geometry-parity.md) |
| 4 | **[alpha blocker]** **No dynamic blocks or REFEDIT; xrefs can't be edited in place or clipped** (xrefs, #525, groups, #417, and the Block Editor for static blocks landed) | Most production drawings use them | 55–90 | [features](#features) |
| 5 | **Recovery leftovers in the interface.** A recovery copy of unsaved work is kept in the browser (IndexedDB) three seconds after the last change and when the page is hidden or closed, and offered back on the next start (Restore, Save a copy…, Discard). Left: the engine has no "mark saved" for the interface, so the unsaved mark stays after Save and a zoom after Save can leave a copy; copies are per browser profile and capped (3 per document per tab, 32 MiB each, 96 MiB in all), so a larger drawing has none; the desktop webview's persistence was read from code, not run. The engine's own SAVETIME autosave, AUDIT and RECOVER (#406) need a file system and are not reached | A crash or a closed tab no longer loses the drawing; a very large drawing still can | 3–5 (predates this work; not re-estimated) | [features](#features) |
| 6 | **No CI runs the Rust tests on pull requests** (`cargo fmt` on main is fixed) | open PRs land without a gate; regressions go unseen | 2–3 | [stability](#stability) |
| 7 | **The interface has two dialogs (Drafting Settings, Layer Properties Manager) and opens no DWG** (W1, W6, W8, FF12). Added 2026-11-11 and not yet ranked against the rows above; the next review re-ranks. Grips, right-click menus, dynamic input and recovery copies landed on 2026-11-12 (W2, W4, W5 and W7 are now leftovers) | A drafter can draw, select and grip-edit with the pointer, with ortho, polar, tracking and dynamic input, but cannot plot or set options from a dialog, or open a colleague's DWG in the app | not estimated | [UI/UX](#uiux) |

## Features

| # | Gap | Evidence | User impact | Est. |
|---|---|---|---|---|
| F1 | **[alpha blocker]** Prompt options that still print "not available yet": -ATTEDIT one-at-a-time Position, Height, Angle and Style, colour books in -ATTEDIT Color, -RENAME of materials, plot styles and viewport configurations. SPLINEDIT Join, Edit vertex Add and Elevate order (#559), PEDIT Edit vertex and the other SPLINEDIT options (#558) done: Edit vertex Tangent directions last for the PEDIT session only (LWPOLYLINE stores none). MTEXT Dynamic/Static columns done (#547). SPLINE, MTEXT and MLEADER options done (#408): SPLINE Object fits the polyline's vertices (no spline frame is kept) (STRETCH polygon, CP and WP, and fence selection done; TRIM/EXTEND, PLINE arc mode and Length, XLINE done (#397); OFFSET, ROTATE and FILLET options done earlier) | `cmd/blocks/attedit.rs`, `cmd/props/rename.rs` | Low: the most-used commands are done | 1–3 |
| F2 | XREF editing in place and clipping: XCLIP is missing. REFEDIT, REFSET and REFCLOSE edit a block reference in place (working set, faded rest of the block, everything else locked, save or discard; #813); left: editing an xref in place (its source drawing is not written back; XOPEN opens it), picking nested references, a dimmed look for the locked drawing and a banner with Save and Discard, attribute sync of other references (ATTSYNC). XATTACH, the External References palette, -XREF (Bind/Detach/Path/Unload/Reload/Overlay), XBIND, XOPEN, overlays, relative paths and loading at open are done (#525). Unloaded state and xref-layer overrides last only for the session | `cmd/blocks/xref.rs` | Medium: xrefs can't be edited in place or clipped | 15–25 |
| F3 | **[alpha blocker]** (dynamic-block authoring is beta) No dynamic-block authoring: parameters and actions can't be added in the Block Editor. Dynamic blocks from other files are read and their references edited (visibility, distances, stretch and move, lookups, grips). BEDIT (with the Edit Block Definition dialog, which also starts new blocks), BSAVE, BSAVEAS and BCLOSE edit a static block definition, and every reference updates; REFEDIT edits a reference in place; no authoring palettes yet | issue #185 offers help | High: standard libraries are dynamic | 40–65 |
| F4 | Autosave leftovers: the interface keeps recovery copies in the browser's storage (row 5, W7) but does not run the engine's SAVETIME autosave, Drawing Recovery, AUDIT or RECOVER, which need a file system; autosave files and recovery copies are DXF, not DWG; no separate RECOVER mode in the file readers (SAVETIME, Drawing Recovery, AUDIT and RECOVER landed with #406; AUDITCTL `.adt` log landed) | `engine/src/autosave.rs`, `engine/src/audit.rs` | Low-medium (web users) | 2–4 |
| F5 | Associative arrays (ASsociative, Levels, polar ROWs, ARRAYEDIT, ARRAYCLOSE) landed (#448); left: grip editing of arrays (count/spacing grips), ARRAYPATH is not associative, ARRAYEDIT has no item deletion (CTRL+click) and no Key point base points, levels only shift Z (no 3D view) | `cmd/array.rs`, `cmd/array/edit.rs` | Medium | 4–6 |
| F7 | Dimensions: no DIMSTYLE manager dialog; no smart DIM; DIMALTTD/DIMALTTZ, DIMUPT and DIMTXTDIRECTION not modelled; jog height and break size not style settings; DIMBREAK breaks don't follow moved objects; with DIMTFILL 1 the written `*D` block and EXPLODE keep no background mask (a WIPEOUT over the text box would), and a true-color DIMTFILLCLR is written to DXF as the nearest ACI (style variables, DIMJOGGED, DIMJOGLINE, DIMBREAK, DIMEDIT, DIMINSPECT and QDIM modes done, #507; the DIMTFILL/DIMTFILLCLR text background done) | `doc/src/tables.rs`, `cmd/annotate_dimedit.rs`, `cmd/annotate_qdim.rs` | Medium | 10–15 |
| F8 | TOLERANCE leftovers (feature control frames landed, #420: model, our own symbol drawing, DXF, command-line prompts, explode, grips): no Geometric Tolerance dialog, no LEADER/QLEADER tolerance annotation, no in-place editing of a frame's contents | `cmd/tolerance.rs` | Low-medium (mechanical) | 2–4 |
| F10 | MLEADEREDIT (add/remove leader), MLEADERALIGN and MLEADERCOLLECT landed, but a multileader has one landing and one block (a collection keeps the other blocks as block references beside it; MLEADERALIGN has no Options-menu preview); MLEADERSTYLE has 5 fields (block content and spline/no-leader types are per command, not in the style; block content has no attributes) | `annotate.rs`, `cmd/mleader_content.rs`, `tables.rs:417` | Medium | 8–12 |
| F9 | MTEXT is typed in an on-canvas editor with a formatting toolbar (font, height, bold, italic, underline, overline, colour, alignment, lists, tab and special characters) and a ruler for indents and tab stops (#532); left: the box does not lay the text out by the indents, tabs, columns or font weights while typing (bold shows wider, overline is not drawn), no justification (attachment) or columns controls in the editor, existing MTEXT cannot be edited (no DDEDIT/MTEDIT), stacked fractions and other codes show as placeholders; no fields (FIELD, UPDATEFIELD) and no spell check (SPELL): open PR #551. Paragraph indents, tabs, bullets, numbering and columns landed (#547). **The on-canvas editor was the egui interface's and is gone (W1): MTEXT is typed at the command line** | `engine/mtext_edit.rs` (the editor's `ui-egui/mtext_editor.rs` was removed) | Medium | 10–18 |
| F11 | Tables (cell styles, formulas, TABLEDIT, TABLEEXPORT, table breaking and CSV data links landed, #534): formulas aren't read from or written as AutoCAD FIELD objects (other programs see values); number formats apply to formula results only; cell text doesn't wrap; custom cell styles, breaks and data links travel as CADCraft xdata (not through DWG); data links read CSV only (no Excel ranges, no write-back, not on the web); no cell-style tab in the Table Style dialog | `cmd/table/*`, `io/dxf_table.rs` | Low-medium | 6–10 |
| F12 | Annotative scaling done (#468): scale list (SCALELISTEDIT), CANNOSCALE, OBJECTSCALE, ANNOALLVISIBLE/ANNOAUTOSCALE, viewport scale, DXF, status bar list. Left: per-scale positions (ANNORESET is a no-op), a viewport annotation scale apart from its viewport scale, annotative objects inside blocks and old LEADERs, AutoCAD files' per-object scale contexts (read as not annotative) | `cmd/annoscale.rs`, `doc/src/anno.rs` | Low-medium | 4–8 |
| F14 | **[alpha blocker]** Plotting leftovers: binary `.ctb`/`.stb`/`.pc3` files can't be read; model-space PDF plots keep the default margins (a device paper's margins apply to layouts and PNG plots); no system printers (H3); the page setup's "Plot transparency" is not saved in DXF/DWG (the public DXF Reference has no plot layout flag for it), so it lasts for the session and in JSON only. The Plot dialog (#160), Plot Preview and PUBLISH (#186), plot styles (CTB and STB, [plot-styles.md](plot-styles.md), #410) with their end, join and fill styles, plotter devices with paper sizes and printable areas ([plotters.md](plotters.md), #564), and plotted transparency (page setup and Plot dialog option, PLOTTRANSPARENCYOVERRIDE) landed | `io/src/plotter.rs`, `cmd/plotters.rs` | Medium | 4–8 |
| F13 | Hatch: 23 patterns (AutoCAD ~85; ours must stay original); the Hatch and Gradient and Hatch Edit dialogs have no Preview or Inherit Properties (HPDLGMODE 0 keeps HATCH on the command line); no MPolygon; HATCHEDIT and -HATCHEDIT add boundaries from picked points or closed objects and remove chosen loops, but a hatch copied with its boundary isn't linked to the copy; HPGAPTOL closes gaps between curve ends only | `doc/src/library.rs`, `cmd/hatch.rs`, `cmd/hatch/edit.rs` | Medium | 6–10 |
| F15 | Viewports: MVIEW Restore prints "not available yet" (named viewport configurations into a layout, see U11); a clipped viewport and its clip boundary move and scale separately. Polygonal, object and clipped viewports, VPCLIP, MVIEW ON/OFF/Lock/2/3/4 and the status-bar scale list landed (#453) | `cmd/layout/viewports.rs` | Low | 2–4 |
| F16 | Groups: no group bounding box or single grip when a group is selected (GROUPDISPLAYMODE), copying a whole group does not make a new group, no Object Grouping dialog (GROUP, GROUPEDIT, UNGROUP, -GROUP, PICKSTYLE group selection and the DXF/DWG round trip landed, #417); PICKSTYLE's associative-hatch bit is stored but unused | `cmd/groups.rs` | Low | 2–4 |
| F17 | Attributes (ATTSYNC, global -ATTEDIT, BATTMAN editing and DATAEXTRACTION/EATTEXT landed, #433): no verify, preset or lock-position modes, and multiline attributes (read, drawn and saved since 2026-10-12) can't be created or switched in BATTMAN; data extraction covers block references and attribute values (CSV or a table) only — no wizard, nested blocks, other objects' properties, `.dxe` templates or spreadsheet output | `cmd/blocks/battman.rs`, `cmd/blocks/extract.rs` | Low | 4–6 |
| F19 | MATCHPROP Settings is a keyword prompt (no dialog) and has no material, shadow or centre-object settings; TEXTTOFRONT and HATCHTOBACK act on the current space only; OVERKILL doesn't compare polyline segments with other objects (picker and Settings, DRAWORDER Above/Under, TEXTTOFRONT, HATCHTOBACK, OVERKILL tolerance/ignore/overlap/end-to-end options landed, #439) | `props/matchprop.rs`, `draworder.rs`, `overkill.rs` | Low | 2–4 |
| F20 | **The OPTIONS dialog was the egui interface's and is gone (W1); the `options` JSON form remains in the engine.** What it had (#23): Display, Open and Save, Drafting, Selection, User Preferences and Profiles tabs, and the user profile (object snap modes, drafting toggles, Dynamic Input, PICKBOX, APERTURE, GRIPSIZE, CURSORSIZE, PICKFIRST, PICKADD, QPMODE, model and paper background, snap marker size, system cursor) survives restarts. Left: right-click customization, the autosave interval and default save version on Open and Save (the features themselves landed, #406, #421), AutoSnap magnet and tooltip toggles, colours of the other drawing-area elements, named profiles with import and export | `engine/src/cmd/options.rs` (the dialog's `ui-egui/src/options/` was removed) | Low | 2–4 |
| F21 | MLINE, REGION and HELIX are objects since #510, with gaps: MLEDIT tees trim square; UNION/SUBTRACT/INTERSECT only combine regions whose boundaries don't meet; regions are saved as closed polylines (no ACIS data); PURGE skips multiline styles | `draw2/mline.rs`, `inquiry/regions.rs`, `dxf_region.rs` | Low | 6–10 |
| F22 | Inquiry leftovers (COUNT across spaces and nested blocks, the QuickCalc palette and COMPARE landed, #563; MASSPROP on regions, #510): COMPARE compares the tab shown, not every layout at once (COMPAREEXPORT, the comparison as a new drawing, landed); COMPAREEXPORT puts the two sets of objects in model-space groups, where AutoCAD puts them in blocks; QuickCalc keeps its history and variables for the session only | `file/compare.rs`, `palettes/quickcalc.rs` | Low | 3–5 |
| F23 | No Sheet Set Manager, eTransmit, Share, Traces, Markup Import, Activity Insights | menu items uncovered | Low-medium (team workflows) | 40–70 |
| F24 | No 3D: UCS, 3D views, orbit, solids, surfaces, meshes, sections, visual styles, materials, lights, rendering (150 menu items) | [parity-checklist](parity-checklist.md) | Medium (3D users) | 300–450 |

## UI/UX

Detail and evidence: [ui-parity.md](ui-parity.md).

### The web interface (`apps/ui`)

What the interface does not do yet, read from its source on 2026-11-11. What it does do is in
[ui-parity.md](ui-parity.md) and [apps/ui/README.md](../apps/ui/README.md). These rows have no
hour estimates yet: the calibration in [target-app-parity.md](target-app-parity.md) was made on
the Rust interface and has not been redone for this one.

| # | Gap | User impact | Est. |
|---|---|---|---|
| W1 | **Two dialogs so far.** Drafting Settings (Snap and Grid, Polar Tracking, Object Snap) and the Layer Properties Manager (W11) landed, on the design system's Dialog component. Still missing: Options, Plot and Page Setup, Hatch and Gradient, Dimension Style, Units, External References, the Block Editor's dialogs, the in-place MTEXT editor, QSELECT, QuickCalc and the Command Aliases dialog, all of which were the egui interface's. Their commands run as command-line prompts | High: most settings a drafter reaches by dialog are reachable only by typing | not estimated |
| W2 | Grip leftovers. A selection shows its grips and they edit through the engine's grip command: press-drag-release or click-move-click, Space to cycle Stretch, Move, Rotate, Scale and Mirror, the options as keywords, Shift for several hot grips, a multifunctional grip's menu on rest or right click. Left: every grip is a square (kinds are not distinguished) and there are no grip colours; no grips for touch; dynamic-block grips are unit-tested only and were never seen in a browser; no Ctrl to cycle a grip's options; dynamic input during a grip edit not checked (W4); the mock engine has no grips | Medium | not estimated |
| W3 | Cursor-constraint leftovers. Ortho (Shift flips it), polar tracking, grid snap and object snap tracking now constrain a pointer click, with a label and the rays drawn (facade `pointer`, over `Session::snap_cursor`); Extension, Parallel and Apparent Intersection are reached by the same call. Left: no Tab to cycle snap candidates, no Shift+right-click snap menu (W5), no F5 isoplane key and no isometric crosshair, polar relative to the last segment and PolarSnap (engine), and checks not yet made: Extension, Parallel and Apparent Intersection in a browser, the deferred tangent and ARC's Ctrl switch outside Rust tests, any of it at narrow widths or with touch | Low-medium | not estimated |
| W4 | Dynamic input leftovers. With DYN on, the prompt and its fields (X and Y, distance and angle, or one value) follow the pointer; typed values lock; Tab, comma, `<`, `@` and `#` work, and Down lists the prompt's keywords. Left: it takes typing only while the drawing has the focus and the command line is on screen; a typed angle is previewed as degrees counter-clockwise from +X whatever the drawing's angle settings; no DYNPIFORMAT, DYNPICOORDS or DYNDIM; not checked during a grip edit; no component test (browser-verified by its author) | Low-medium | not estimated |
| W5 | Right-click menu leftovers. Menus landed on the drawing (at rest: repeat, recent commands, undo, pan and zoom, select, paste, options; with a selection: the modify and clipboard commands, draw order, deselect, properties; during a command: Enter, Cancel, the prompt's keywords, transparent Pan and Zoom, where a quick right click is still Enter and a held one opens the menu), on grips, layer rows and layout tabs, also by the menu key, Shift+F10 and a long press. Left: the Shift+right-click snap menu and snap overrides in the command menu, Recent Input, menus on the command line and the Properties palette, in-place rename of a layer or a layout tab (Rename... finishes at the command line) | Low-medium | not estimated |
| W6 | **One drawing at a time**: no file tabs, no Start tab, no recent files. Open is the page's file picker and Save is a download of DXF; in the desktop window the same, through the webview (not verified beyond Windows). The desktop binary takes no file argument, so a file association cannot open a drawing | High | not estimated |
| W7 | Recovery leftovers (row 5): recovery copies and the recovery bar landed; the unsaved mark stays after Save, a zoom after Save can leave a copy, the caps leave a very large drawing without one, and the desktop webview's persistence is not verified | Medium | 3–5 (F4's, predates this work) |
| W8 | **No DWG in the interface** (FF12): the WebAssembly build has no DWG reader or writer; opening one says to save as DXF | High | 6–10 (FF12's) |
| W9 | The grid on the canvas is the interface's own decade grid: it does not follow the Grid toggle, GRIDUNIT, limits or the isometric grid; no crosshair that follows the isoplane | Low-medium | not estimated |
| W10 | Selection leftovers: no cycling list for overlapping objects, no lasso, no two-click window (PICKDRAG), the selection-area and preview system variables are not read, Delete does not erase | Medium | not estimated |
| W11 | Layer and Properties leftovers. The Layer Properties Manager landed as a dialog (a grid edited in place: name, on, freeze, lock, plot, colour, linetype, lineweight, transparency, description; bulk changes in one undo step; New, Rename, Delete, Set current, a filter, sorting). Left: layer states, property filters, viewport overrides, and a full colour picker (the manager offers the seven named colours). Properties edits the common properties only, no per-object geometry | Low-medium | not estimated |
| W12 | No Tool Sets palette, Blocks palette, ViewCube, tiled model viewports, command-line AutoComplete (the command palette searches instead) or F2 text window | Medium | not estimated |
| W13 | **English only.** The interface catalogs (15 languages besides English) were the egui interface's and were removed with it; `apps/ui` has no string catalog | High outside English | not estimated (L1, L2) |
| W14 | Not verified: touch on a real device (implemented, unit-tested); any browser but Chromium; the desktop webview on macOS, Linux and FreeBSD (Windows only); a screen reader; plotting from the interface (P1) | Unknown | not estimated |
| W15 | Paper-space leftovers. A layout draws its sheet and printable area, colour-7 objects are inked dark on the paper, each space keeps its own view and Zoom Extents frames the sheet. Left: light layer colours (yellow, cyan, green) are low-contrast on the paper; the wheel, snap markers and hover on paper and widths under 1280 were not checked in a browser by its author | Low-medium | not estimated |
| W16 | Drafting-font leftovers. With no system font behind it in the interface, text in the stroke font drew a box for anything past 101 characters; the font now covers 362 (superscripts and subscripts, fractions, all of Latin-1, accented Latin Extended-A by composition, typographic punctuation and common signs), and a character it lacks falls back to the nearest one before the box. Left: Greek beyond a few letters, Cyrillic and every other script still box in the interface | Medium outside Latin scripts | not estimated |

### Interaction leftovers from before the interface change

These rows were written against the egui interface. The engine half of each still stands; the
interface half is now covered by W1–W5 (the snapped cursor is back, W3; grips, W2; right-click
menus, W5; dynamic input, W4).

| # | Gap | User impact | Est. |
|---|---|---|---|
| U4 | Tab snap cycling offers the closest snap of each mode, not every candidate. Typed snap overrides (`END`, `MID` … `NON`), the Shift/Ctrl+right-click snap menu and Tab cycling landed (#393), the menu's Temporary track point in #441 | Low | 1 |
| U5 | Grip menus open on right-click only (no hover menu, no Ctrl to cycle the options); no multifunctional grips on dimensions, MLEADER, hatches or text; Add Vertex on an arc segment straightens it. Hot-grip options (Base point, Copy, Undo, Reference, eXit), multiple hot grips and the polyline/line/arc grip menus landed (#425) | Low-medium | 2–4 |
| U6 | Selection: lasso; the CLass keyword; isolation saved with the drawing (OBJECTISOLATIONMODE 1) and the status-bar isolate button. Press-drag windows (#63), the W, C, F, WP and CP keywords (#226), BOX, AUto, SIngle, Multiple, Group, Add, Remove and Undo, SELECTSIMILAR, ISOLATEOBJECTS/HIDEOBJECTS/UNISOLATEOBJECTS (#428) and selection cycling (#1143) landed | Medium | 3–5 |
| U7 | Right-click menus: no in-place layout tab rename or Move or Copy dialog, no Select All Layouts, no Paste to command line; palette menus are on the Layers rows and the Properties background only. The command menu (held right-click: Enter, Cancel, Recent Input, options, Snap Overrides, Pan/Zoom), the selection menu with object edits, command line, drawing tab, layout tab and palette menus landed (#512) | Low | 1–2 |
| U10 | SETVAR covers about 150 of ~1,000 variables (UNDO options, MREDO and UNDOCTL, and header variables such as CIRCLERAD, OFFSETDIST, POLYSIDES, HPNAME and the dimension variables in SETVAR ? landed, #461; typing a bare variable name as a command runs SETVAR on it) | Low-medium | 3–5 |
| U11 | MVIEW Restore (a saved viewport configuration into a layout); VIEW Orthographic, UCS and background settings; view twist is kept but not shown (Zoom Realtime and Dynamic, ZOOMFACTOR, named views (VIEW) and tiled model viewports with saved configurations (VPORTS) landed in #463) | Low | 1–2 |
| U12 | Workspaces, navigation bar, CUI customisation, ViewCube drag (#7) (the Command Aliases dialog landed, #1381) | Low-medium | 13–23 |
| U13 | `.dxf` from Finder fails to open on macOS (#158) (window controls fixed, #161) | Medium | 1–2 |

## File formats

Detail: [file-format-parity.md](file-format-parity.md).

| # | Gap | User impact | Est. |
|---|---|---|---|
| FF1 | **[alpha blocker]** Round-trip what we don't model. DXF done (#528): unknown entities and objects (with their CLASS records), foreign xdata (hyperlinks included), extension dictionaries, persistent reactors, DICTIONARYVAR and XRECORDs, layer states, colour book colours, references remapped on save; IMAGE, VIEW/UCS, groups, block descriptions, true colours, transparency (#201, #204, #208, #209, #213, #223); WIPEOUT and gradients (#147, #162). Left: through DWG, acadrust drops custom-class entities and objects, xdata on table records and blocks, entity colour book names and reactors; UCS elevation; MTEXT background colours; unknown entities follow only layer edits, and renamed layers and blocks lose their foreign data | High | 6–10 |
| FF2 | Multileader leftovers (native MULTILEADER read/write landed, #459): several landings per multileader (extra leader roots are folded into the lines), per-object overrides (leader colour and linetype, arrowhead symbol, text frame), annotative scale contexts; check the text placement of our MULTILEADER output in AutoCAD | Medium | 3–5 |
| FF3 | Save-version leftovers (DXF/DWG 2000–2018, binary DXF, SAVEAS `version`/`binary` and the default save version landed, #421): no R14 DWG or R12 DXF output; the Save dialog can't pick the version per file (the file picker doesn't report the chosen type; File > Default Save Format sets it); no command-line SAVEAS format prompt | Low | 2–4 |
| FF4 | Code-page leftovers (pre-2007 DXF read in their `$DWGCODEPAGE` landed, #505): Johab (ANSI_1361) and DOS 855/857/860–865/869 read as ANSI_1252; saving declares `ANSI_1252` instead of the file's code page (the text is pure ASCII, so still correct); acadrust approximates DOS code pages in pre-2007 DWG (DOS437 as 866, DOS850 as 1252) | Low | 1–2 |
| FF5 | **[alpha blocker]** Real-file corpus (`storytold/cadcraft-corpus`), open → save → reopen tests, black-box check in AutoCAD | High | 10–15 + human |
| FF6 | **[alpha blocker]** DWG throughput: a 10 MB DWG took ~2 min to fail (#57) | High for real projects | 6–10 |
| FF7 | Table record and object handles from other programs' files are renumbered on the first save (entity handles are kept; `*D` blocks no longer duplicate and once reopened, CADCraft's own files keep every handle across saves, #495) | Low | 4–6 |
| FF8 | SHX fonts (shape and big fonts) not read | Medium-high (text metrics differ) | 8–12 |
| FF9 | `.pc3` plotter configuration files; linetype shape (SHX) elements are skipped (templates and `.dwt`, user `.lin`/`.pat` and `.pgp` alias files landed, #552; `.ctb`/`.stb`, #410) | Low-medium | 5–10 |
| FF10 | PDF import and underlays (PDFATTACH). Raster images attach and draw (IMAGEATTACH places PNG/JPEG references with sizing, rotation, clips, fade and IMAGEFRAME; the picture shows in the app and in PNG exports) and IMAGETRACE vectorizes a picture into polylines sized to a measurement; TIFF/BMP left. PDF export has real text in embedded TrueType subsets, PDF layers, several sheets per file and hyperlinks (#567, #571) | Medium | 18–30 |
| FF11 | DWF/DWFx, DGN, WMF, EPS, ACIS/STL and other exchange formats | Low-medium | 50–100 |
| FF12 | DWG in the web build | Medium | 6–10 |
| FF13 | R12 binary DXF, pre-R13 DWG | Low | 10–20 |
| FF14 | SVG import leftovers (shapes, paths, groups and Inkscape layers landed, #636): no CSS classes (`<style>`), `use` references, fills and gradients, text or embedded images; rounded rectangle corners (`rx`/`ry`) are ignored. Opening such a file names what was left out (#627) | Low-medium | 2–4 |

## Hardware

Detail: [hardware-parity.md](hardware-parity.md).

| # | Gap | Est. |
|---|---|---|
| H1 | 3Dconnexion SpaceMouse (needs the device and 3D views) | 6–10 + human |
| H2 | Multi-monitor: floating palettes on other screens, per-monitor DPI (PR #110 for Windows 11 DPI) | 4–6 |
| H3 | Plotters and system printers (PC3 devices) beyond PDF files | 6–10 |
| H4 | Pen tablets / digitizer (TABLET) | 3–5 + human |
| H5 | Screen magnifier tracking (#39, PR #187) | 1–2 |

## Localization

Detail: [localization-parity.md](localization-parity.md).

| # | Gap | Est. |
|---|---|---|
| L0 | **The interface is English only since 2026-11-11.** The string catalogs and the language switch were part of the egui interface and were removed with it; `apps/ui` has no catalog. Rows L1–L4 were written against those catalogs | not estimated |
| L1 | Catalog covers the UI (989 rows, #36) but not engine diagnostics, CLI/MCP replies or command history | 4–6 |
| L2 | AutoCAD for Mac's other languages (zh-Hans, es, fr, ja, ko, it; de landed 2026-10-11) plus pt, hi, ar, id, vi from the standard's list | 35–55 + native review |
| L3 | Complex-script shaping for Devanagari and other Indic scripts in drawing text; RTL (mirrored) UI. Arabic-script shaping and bidi in drawing text landed (#287) | 20–30 |
| L4 | IME fixes on every platform (PRs #110–#119); vertical text styles | 6–10 |

## Stability

| # | Gap | Evidence | Est. |
|---|---|---|---|
| S1 | No CI runs `cargo xtask ci` on pull requests (only packaging lint and release builds) | `.github/workflows/` | 2–3 |
| S2 | ~~`cargo fmt --check` fails on main~~ fixed on main (8fceaaf) | — | 0 |
| S3 | 40 open PRs, many community bug fixes awaiting review | `gh pr list` | 10–20 |
| S4 | Open correctness issues: extents union far-apart geometry (#166), lines not visible mid-command (#44), browser plot shows raw PDF bytes (#134) (closing a tab and browser saves fixed, #76, #133) | issues | 4–6 |
| S5 | No smoke test of every command through the UI (PR #42 proposes one) | — | 6–10 |

## Platforms

| # | Gap | Est. |
|---|---|---|
| P1 | Web build: plot shows raw PDF bytes (#134), no DWG (File > Open and save downloads fixed, #55, #133) | 3–5 |
| P2 | Windows and Linux get little runtime testing; Linux Mint mouse delay (#25); Windows magnifier (#39) | 6–10 |
| P3 | File associations: the desktop binary takes no file argument (`apps/cadcraft/src/main.rs` accepts only `--dev` and `--help`), so opening a `.dxf` from a file manager cannot work on any platform (#158 was the macOS report) | 1–2 |
| P4 | The desktop app is the web interface in the system webview (WebView2, WKWebView, WebKitGTK). It has been run on Windows only; macOS, Linux and FreeBSD builds of the shell are not verified, and neither are the packages built from it | not estimated |
| P5 | The web interface has been exercised in Chromium only; touch input is implemented and not tried on a device | not estimated |
| P6 | No control channel: the egui app served one ([control-protocol.md](control-protocol.md)); the web interface does not, so `cadcraft-cli mcp --connect` has nothing to connect to and an agent cannot drive the running app | not estimated |

## Ecosystem and automation

| # | Gap | Est. |
|---|---|---|
| E1 | AutoLISP beyond the core (#758 landed the language, `command`, entity lists, selection sets, `get…` input, APPLOAD, `(load)`, `c:` commands and `acad.lsp`/`acaddoc.lsp` at startup; #1820 gave APPLOAD its `.lsp` file picker): Visual LISP ActiveX (`vlax-`, `vla-`), DCL dialogs, reactors, an APPLOAD Startup Suite, UCS-aware `trans` | 26–46 |
| E3 | Express Tools equivalents (SUPERHATCH; NCOPY, BREAKLINE, TXT2MTXT, BURST and MOCORO exist: BREAKLINE's Block option takes a block of the drawing, not a `.dwg` file, and TXT2MTXT's Settings are command-line prompts rather than a dialog, without the uniform line spacing option) | 24–40 |
| E4 | Plug-in API (owner decision: Rust/WASM plug-ins rather than ObjectARX/.NET) | 30–50 |
| E5 | CUI customisation (the alias editor, ALIASEDIT's Command Aliases dialog, landed, #1381; edits stay for the session; the dialog was the egui interface's and is gone, W1) | 13–23 |

## AI features

| # | Gap | Est. |
|---|---|---|
| A1 | Smart Blocks equivalents (placement suggestions, replace, detect and convert, search), using local open models | 25–50 + model licensing |
| A2 | ~~An in-app assistant~~ — **built** ([assistant.md](assistant.md)): the Assistant pane and the MCP server publish the same ONE tool, `run`, which executes AutoLISP in the open drawing, so a model builds its own tooling and keeps it across sessions; the pane reads like an agent panel (collapsed activity rows, inline render cards, attachments the model can see *and* trace, queued/steering messages, per-request drawing checkpoints, a context meter). Since 2026-11-11 the pane is the web interface's (`apps/ui/src/components/AssistantPane.tsx`): setup in two steps with a connection check, chats as tabs, a queue, tool rows as sentences, a changes row with Undo all and Keep, replies with headings and lists, bounds on what a provider may send. What remains: a local default model; no hosted provider has been exercised (a local stand-in only); in the interface a definition is kept for the session only, `(render)` has nowhere to write, an attached picture has no path so it cannot be traced, a queued message cannot steer the running turn, and there is no `assistant` command to open or ask from a script | 2–4 (for the first item; the rest not estimated) |
| A3 | Markup Assist (import markups from PDFs/images) | 10–20 |

## Jewelry (beyond AutoCAD)

CADCraft drafts fine jewelry with the trade's own numbers: ring sizes in every system, each cut's
real girdle, calibrated melee with the fit checked, settings built on the stone, and a bench sheet
([jewelry.md](jewelry.md)). The commands are ordinary ones, so the command line, scripts, the CLI
and MCP all reach them, and DESCRIBE reads jewelry out of any drawing.

| # | Gap | Est. |
|---|---|---|
| J1 | Elongated melee in a pavé region: oriented fit is done (PAVE `rotate`, GEMFIT `ratio`/`rotate`, fit by the cut's own outline). Left: `taper` rows (graduated sizes along a row), brick rows of elongated cuts do not nest, the default orientation follows the bounding box and not the region's true axis, `largestFitting` is still a round diameter, and the interactive PAVÉ prompt asks for round stones only | 4–8 |
| J2 | Settings as solids: a parametric band, solitaire and eternity band are solids now (PIECEMESH, STLOUT, a 3D view). Left: STLOUT now writes one merged shell with seats, but at the default 150,000-triangle cap it is sampled at about 0.2 mm (stepped beads and seat edges) and has no sprue; fancy cuts are their girdle tapered, not faceted; pavé scallops are not cut; channels, baskets and under-galleries are 2D only; a drawing that is not a parametric piece has no solid; STL is the only 3D format | 16–28 |
| J3 | A bench's own stone library: calibrated sizes, dealer girdle data and a house cut list (GEM takes any outline, but nothing imports a library file) | 6–10 |
| J4 | RINGSIZES measures a drawn ring from JSON (`handle`: a circle, an arc, a closed outline, a RING insert); there is no pick prompt for it at the command line, and the interface has no control for it | 1–2 |
| J5 | Settings on a heart: at the cleft a bezel's wall is thinner than asked (0.42 mm for 0.48), a halo stone lands over the centre stone and a channel's rail comes inside its distance. The outward offset of a concave corner is not held at its distance (a first repair of the fold is in `setting.rs`, not enough). Found by property tests, which are set aside until fixed | 3–5 |
| J6 | A halo around a sharp tip (a long pear) can put two stones slightly nearer than the gap: the halo is spaced by length along its path, not by straight distance | 2–3 |
| J7 | Outside a size system's own chart (under 12.84 mm, over 22.5 mm) a finger is named by that chart's last size (a 25 mm finger reads UK Z); it should have no size in that system, which changes the shape of every size row | 2–4 |
| J8 | A rail for `PIECE` is done (`rail: {curve}`, band only). Left: a rail on a solitaire or another kind with a head (the head stands on a round shank only), pavé on a railed band, and a rail whose inside length is not the finger's circumference (it is always scaled to it; no "fit inside" option) | 2–3 |
| J9 | Two-rail sweep: a band whose width follows a second drawn curve (the profile scaled across between two rails), as a jeweller's shaped shank does | 3–5 |
| J10 | Shank styles past split and cathedral: a double shank (two bands joined at the head), a bypass (the ends pass each other beside the head), split or cathedral shoulders on a three-stone ring, pavé on a split or cathedral shank, arms that split at their own width (each arm is a strip of the band's own section today) | 4–6 |
| J11 | Braided bands and cables of more than three strands, a cable on a solitaire's shank, a cable whose strands are not round wire | 3–5 |

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-14 | minor | Jewelry: shank shapes for PIECE — a drawn rail (J8 narrowed), a split shank, cathedral shoulders and a twisted cable band; new rows J9–J11 |
| 2026-11-14 | patch | Jewelry: the merged solid for casting takes bezels, tapered shanks, the signet's face, drawn profiles and pavé and half eternity seats; J2 narrowed |
| 2026-11-13 | minor | Jewelry: PIECE takes a band profile drawn as a closed curve; a rail for it is the new row J8 |
| 2026-11-13 | minor | Jewelry: pavé on a parametric piece's band (PIECE `pave`: row, rows, honeycomb, scallop, auto-fit to a span, graduated sizes, a `pave` check), drawn, counted on the bench sheet and built by PIECEMESH. No row closes: the solid still cuts no seat (J2) |
| 2026-11-12 | minor | Jewelry: band profiles and a three-stone ring in PIECE; property tests (Hegel) fixed six faults and left three as new rows J5–J7 |
| 2026-11-12 | minor | Jewelry: PRICEBOOK and an estimated cost on the bench sheet; in the interface a rendered tech sheet, templates and the Cost group. No row closes |
| 2026-11-12 | major | A parametric piece (PIECE) with a solid (PIECEMESH, STLOUT) and a 3D view in the interface; OBJECTS; in the interface a tabbed ribbon, Source, the Piece and Objects sections. J2 narrowed. New drawings in the interface are millimetres |
| 2026-11-12 | minor | Jewelry: RINGSIZES measures a drawn ring (`handle`); PAVE and GEMFIT fit elongated cuts by their own outline at their rotation (`rotate`, `ratio`); a pavé fill no longer ignores the edge that closes its outline. J4 narrows to its prompt, J1 to `taper`. In the interface: Ring and Gem dialogs, `@` context in the assistant, the sidebar reachable at a phone's width |
| 2026-11-12 | patch | Jewelry in the interface: a solitaire sample the interface opens on, a live Bench section in the sidebar, Ring, Gem, Setting and Pavé in the tool strip, the assistant briefed on the jewelry commands, Ctrl+K to ask it from the drawing. Three jewelry faults fixed in the engine (a stone named `diamond` did not read back; a halo was laid at the origin; settings and pavé were misplaced in an inch drawing). No row closes: J1–J3 stand ([jewelry.md](jewelry.md#revision-history)) |
| 2026-11-12 | minor | Read at 0ca8810: recovery copies with a recovery bar (rows 5, F4, W7 narrowed to leftovers), dynamic input at the pointer (W4), the Layer Properties Manager (W1, W11), paper under a layout (new W15), the drafting font at 362 characters (new W16, with what still boxes); top-10 row 7 reworded. Estimates unchanged and marked where they predate the work |
| 2026-11-12 | minor | Read at 43dd130: the first dialog (Drafting Settings), grips on the drawing and right-click menus landed in the web interface. W1 narrowed to the dialogs still missing, W2 to grip leftovers (one grip shape, no touch, dynamic-block grips untried in a browser), W5 to menu leftovers (snap menu, command line and Properties menus), W11 for the layer row's menu; top-10 row 7 reworded |
| 2026-11-11 | minor | The interface resolves the pointer through the engine's snapped cursor: W3 narrowed from "the pointer is not constrained" to its leftovers and to what has not been checked; top-10 row 7 no longer lists cursor constraints. Menus are grouped and show typed names; the assistant draws links and tables (A2 unchanged) |
| 2026-11-11 | major | The egui interface was removed (d5cad47); the interface is the web interface in `apps/ui`, and the desktop app is that interface in a native webview. Read from the source at ec61741: new rows W1–W14 (no dialogs, grips, dynamic input, context menus, cursor constraints, file tabs, autosave, DWG or languages in the interface; what is not verified), top-10 row 7, P3 rewritten, P4–P6, L0; rows 5, F4, F9, F20, E5 and A2 updated; the two egui notes above the UI/UX table removed (their features went with egui). What the interface gained is in [ui-parity.md](ui-parity.md): drawing and selecting with the pointer, the command palette, keyboard patterns, two themes, narrow-window behaviour, the assistant's setup. No hour estimates were added |
| 2026-10-26 | minor | The assistant pane as an agent panel: attachments (paperclip, paste, drop) travel to the model as vision parts **and** as paths the code can measure — `imagetrace` turns an attached photograph into editable polylines at a requested size (proven live: a 320×200 silhouette became one 120-wide closed outline with its hole); messages typed while a turn runs queue (Enter) or steer it at the next tool call (⌘/Ctrl+Enter); every request records the drawing's undo depth and a hover control restores it (`undoto`, conversation kept); a context meter; the system prompt rewritten for the one-tool surface (it still named the dead catalog) and a test forbids naming a tool that no longer exists. `crates/ai/src/agent.rs` (`Steer`), `crates/ai/src/chat.rs` (vision parts, `images`), `crates/engine/src/cmd/edit.rs` (`undoto`), `crates/ui-egui/src/assistant.rs` |
| 2026-10-26 | minor | One tool instead of a catalog: the assistant and MCP both advertise exactly `run`, which executes AutoLISP **inside the open drawing** (`(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))`, `(cmdline "line" "0,0" "10,0")`, `(cmd "describe")`, `(render)`) — the previous tool list is gone, capabilities are reached from code, and definitions a model writes are kept in `%APPDATA%\CADCraft\definitions` and reloaded next session (`(kept)`, `(forget)`). No enable/disable flag: running code is what the server does, and sandboxing is the boundary. MCP resources dropped (a second interface to the same capabilities). New `crates/engine/src/lisp/agent.rs` (the namespace and the manual), `crates/engine/src/cmd/code.rs` (`run`), `crates/engine/src/paths.rs` (config + definitions dirs, shared with the app), `crates/ai/src/code.rs` (the tool) |
| 2026-10-26 | minor | The assistant: an in-app pane (Window ▸ Assistant, ⌘7, `assistant {ask}`) where a model works in the open drawing through the same tool catalog MCP publishes — one list in `crates/ai/src/surface.rs`, two faces, so the pane can do exactly what an external agent can; any OpenAI-compatible provider (OpenAI, OpenRouter, Anthropic-compat, DeepSeek, Groq, Mistral, xAI, Together, Ollama, LM Studio, any base URL) with streamed answers and tool chips; the provider is saved with the profile and settable through `options`; new L5 `ai` crate and [assistant.md](assistant.md): A2 narrowed |
| 2026-10-25 | minor | Jewelry: RINGSIZES, RING, GEM, GEMLIST, PAVE, GEMFIT, SETTING and TECHSHEET (the trade's ring sizes, gem cuts with carat weights, calibrated melee with the fit checked, settings on the stone's girdle, and a bench sheet); DESCRIBE reports a drawing's stones and bands, MCP gains `bench_sheet`; new [jewelry.md](jewelry.md) and the J1–J4 rows |
| 2026-10-25 | minor | Raster images attach, draw and trace (IMAGEATTACH, IMAGETRACE, IMAGEFRAME, IMAGEADJUST; Insert menu with a picture picker, MCP `attach_image`/`trace_image`); DESCRIBE (measured report of a drawing or selection with a narrative) and SCALE by `width`/`height`; FF10 narrowed, IMAGE row in the file-format list narrowed |
| 2026-10-25 | minor | DIMTFILL limits: with DIMTFILL 1 (the drawing's background color) the written `*D` block and EXPLODE keep no background mask (a WIPEOUT over the text box would), and a true-color DIMTFILLCLR is written to DXF as the nearest ACI: F7 updated |
| 2026-10-24 | minor | COMPAREEXPORT (typed, or Export on the comparison bar) opens the comparison as a new untitled drawing, `compare_<this> vs <other>.dwg`: this drawing's objects in one group and the other drawing's differing objects in a second group, in the comparison colors (green, red, gray for objects in both), block contents and style colors included: F22 narrowed |
| 2026-10-24 | minor | DIMTFILL and DIMTFILLCLR: a dimension's text background (none, the drawing's background color, or a color) hides what is drawn under the text; SETVAR, DIMOVERRIDE and style fields, DIMSTYLE groups 69 and 70 in DXF from R2007 (CADCraft xdata before), and a SOLID in the `*D` block and from EXPLODE for DIMTFILL 2: F7 narrowed |
| 2026-10-22 | minor | APPLOAD typed or from Tools ▸ Load Application opens a `.lsp` file browser starting in the last-used folder (kept in the preferences); a picked file loads interactively like a typed name (routines that ask for input wait), the web says to drop the file (no file system), and the JSON form `{path}` reads the path as given and returns the commands the file defined, never opening a dialog (#1820): E1 narrowed |
| 2026-10-16 | minor | ALIASEDIT typed or from Tools ▸ Customize opens the Command Aliases dialog (user aliases next to the built-in ones; Add, Edit, Remove; OK, Cancel, Apply), #1381: U12 and E5 narrowed |
| 2026-10-16 | minor | MOCORO (Tools ▸ Express Tools ▸ Move/Copy/Rotate): select objects and a base point once, then Move, Copy, Rotate, Scale, Base and Undo until eXit, one undo step; JSON form `{base, ops}`: E3 narrowed |
| 2026-10-16 | minor | MLEDIT Merged Tee (MT): the first multiline's outer elements stop at the second one's near side, which opens, and its inner elements run on to the second one's inner element: F21 narrowed, hours unchanged |
| 2026-10-15 | minor | BURST (Tools ▸ Express Tools ▸ Explode Attributes to Text): block references explode as EXPLODE does, visible attribute values become text with the attribute's style, height, position, layer and colour, invisible attributes and the definitions go: E3 narrowed |
| 2026-10-13 | minor | Stabilized filled-object highlight dash anchors by canonicalizing boundary traversal order; renderer, CPU pointer-frame and GPU rebuild tests cover the fix (U6) |
| 2026-10-14 | minor | HATCHEDIT adds boundary loops from internal points or closed objects and removes selected loops, in the dialog, command line and JSON command: F13 narrowed |
| 2026-10-15 | minor | `entities` / MCP `query_entities` accept `selected:true`, combined with existing filters and paging; selection, drawing and undo/redo stay unchanged. No parity estimate change. |
| 2026-10-15 | minor | BREAKLINE (Tools ▸ Express Tools ▸ Break-line Symbol): one polyline between two points with a break symbol, Block/Size/Extension options, size times DIMSCALE: E3 narrowed |
| 2026-10-15 | minor | TXT2MTXT (Tools ▸ Express Tools ▸ Convert Text to Mtext): selected TEXT, and MTEXT, combined into one MTEXT top-down or in selection order with optional word wrap, or one MTEXT per TEXT; SEttings remembered for the session: E3 narrowed |
| 2026-10-13 | minor | Selection window gesture preference (PICKDRAG 0/2) added to Options ▸ Selection and saved in the profile (U6), with Portuguese and Ukrainian labels |
| 2026-10-12 | minor | Object transparency (entity, ByLayer, ByBlock) is drawn: on screen (TRANSPARENCYDISPLAY, on by default), in PNG/SVG exports, and in plots when the page setup's "Plot transparency" is on (PDF alpha, PNG blending, SVG opacity; PLOTTRANSPARENCYOVERRIDE): F14 narrowed |
| 2026-10-12 | minor | Hatch and Gradient dialog (HATCH, GRADIENT; HPDLGMODE) and Hatch Edit dialog (HATCHEDIT, right-click, double-click a hatch): F13 narrowed to Preview, Inherit Properties and boundary add/remove in edit mode |
| 2026-10-12 | minor | A bare system variable name typed at the command line (ORTHOMODE, GRIDMODE…) runs SETVAR on that variable, as in AutoCAD; U10 narrowed |
| 2026-10-13 | minor | STRETCH takes crossing and window polygons (CP, WP), BOX and a fence (F), typed and as JSON (`polygon`, `fence`): F1 narrowed |
| 2026-10-12 | minor | Property-based and hostile-input tests for geometry numerics landed (deterministic xorshift generator, no new dependency; known answers at 1e6–1e7 coordinates): S6 removed |
| 2026-10-12 | trivial | F13: HATCHEDIT refuses a bad scale or angle before editing (#724) |
| 2026-10-12 | minor | F3: dynamic block references show their grips (distance arrows, position squares, visibility/lookup lists, per visibility state) and drag them (`blocks.reference.grips`, `blocks.reference.grip`) |
| 2026-10-17 | minor | AUDITCTL system variable and .adt log generation in AUDIT/RECOVER landed: F4 narrowed (no .adt log removed) |
| 2026-10-12 | minor | Multiline attributes read, drawn and saved (they lost their text before): F17 narrowed to creating them |
| 2026-10-13 | minor | F3: opening a dynamic block's own drawing (authoring elements in model space) offers the Block Editor on `<Current Drawing>`, as AutoCAD does |
| 2026-10-12 | minor | Edit Block Definition dialog (block list, preview, description; a new name starts a new block): F3 text updated, hours unchanged |
| 2026-10-12 | minor | Block Editor (BEDIT, BSAVE, BSAVEAS, BCLOSE) for static blocks landed: rows 4 (65–100 → 55–90 h) and F3 (50–75 → 40–65 h) narrowed to REFEDIT and dynamic blocks |
| 2026-10-12 | minor | In-place MTEXT editor with formatting toolbar and indent/tab ruler landed (#532): F9 narrowed to the editor leftovers, fields and spell check |
| 2026-10-12 | minor | SCRIPT command reading `.scr` files landed (runs a file through the same script engine as CLI/MCP; nested scripts refused): E2 removed |
| 2026-10-11 | minor | Refreshed for merged features: code pages (#505), tracking leftovers (#441), dynamic input/grip input (#519, #425) and SPLINEDIT Join/Add/Elevate (#559) closed their top-10 rows (top 10 now has 6 rows until the next review re-ranks); MULTILEADER (#459) and xrefs (#525) narrowed rows 1 and 4; F1 narrowed to the remaining stubs (#558, #559, #547); F5, F7, F9, F12, F14, F15, F17, F20, F22, U5, U7, U10, FF2, FF4, FF10 narrowed; F18, U2, U8, U9 removed (done); U13, S3, S4, P1 updated for merged fixes |
| 2026-10-11 | minor | German interface catalog landed: L1 row count 936 → 989, L2 narrowed (de done; 40–60 → 35–55 h) |
| 2026-10-11 | minor | SPLINE Knots/Tangency/toLerance/Object, MTEXT Height/Justify/Line spacing/Rotation/Style/Width/Columns, MLEADER spline and no-leader types and block content landed (#408): top-10 row 5, F1 and F10 narrowed |
| 2026-10-11 | minor | Object snap tracking, Extension, Parallel and true Apparent Intersection landed (#379): top-10 row 3 and U1 narrowed to the leftovers |
| 2026-10-10 | minor | Merged main: closed or narrowed rows for the Ukrainian catalog, UNITS dialog, shortcut display, dynamic input pointer boxes, press-drag windows, SETVAR DIM*, WIPEOUT and gradients, fmt |
| 2026-10-10 | minor | Alpha blockers marked (rows failing the core-workflow gate) |
| 2026-10-10 | major | First gaps list: ranked top 10 and every known shortfall by dimension, with evidence and estimates |
