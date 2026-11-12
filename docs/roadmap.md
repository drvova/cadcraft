# CADCraft roadmap detail

> **Last reviewed:** 2026-10-10 (hours, milestones) · 2026-11-11 (interface evidence) · **Last updated:** 2026-11-11 · **Change:** major (the egui interface was removed and the web interface replaced it: alpha-gate evidence, milestone notes and ready-for-real-work updated; then the pointer gained ortho, polar, grid snap and tracking; hours not re-estimated) · **Target:** Autodesk AutoCAD 2027

Forward-looking plan: milestones with status, the current focus, and what comes next with
estimates. The summary is [ROADMAP.md](../ROADMAP.md); the work items behind every line are in
[gaps.md](gaps.md); numbers come from [target-app-parity.md](target-app-parity.md). Hours are
Opus 5.5 agent-hours.

## Current focus

**The interface changed on 2026-11-11.** The egui interface was removed; the interface is the
SolidJS app in `apps/ui`, in a browser tab or in the desktop app's native webview. It draws and
selects with the pointer and has the menus, tool strip, sidebar, command line, command palette
and assistant, and the pointer follows ortho, polar, grid snap and object snap tracking. It does
not yet have dialogs, grips, dynamic input, context menus, DWG, autosave or translations ([gaps.md](gaps.md#uiux) W1–W14). That work is not
ranked or estimated yet, and several items below assumed the old interface: where an item says
a dialog or tracking is done, read the alpha gate table for what holds today.

1. **Gate and land.** (`cargo fmt` on main is fixed.) Add a PR workflow that runs
   `cargo xtask ci`, then review and land the 47 open PRs, most of them community bug fixes
   (S1–S3). ≈ 15–25 h.
2. **Stop losing data on save** (FF1, FF2, FF7) and save DWG/DXF at a chosen version (FF3).
   ≈ 30–45 h.
3. **A real-file corpus** and a check of our output in AutoCAD (FF5, needs the owner).
4. **Precision input:** object snap tracking, extension/parallel snaps, FROM/M2P/TK, typed snap
   overrides, editable dynamic input (U1–U4). ≈ 25–35 h.
5. **Unstub the prompt options** of the most-used commands (F1). ≈ 15–25 h.
6. **Autosave, recovery, AUDIT, RECOVER** (F4). ≈ 10–15 h.
7. **The rest of the alpha gate:** block editor and REFEDIT, xref attach (F2, F3), and plot styles
   with a plot dialog and preview (F14). ≈ 50–80 h.

Items 2–5 and 7 are the [alpha gate](#alpha-gate) rows.

## Alpha gate

The core workflows a typical AutoCAD professional does every day (craftrules progress-docs
standard). CADCraft is **pre-alpha** because four of the five fail the gate; the failing rows are
the alpha checklist. Main platform: macOS. (The desktop app, now the web interface in the system
webview, has been run on Windows only so far.)

| Core workflow | Works end to end? | Evidence | Hours to pass |
|---|---|---|---|
| Draw and modify precisely with object snaps and tracking | **partial, blocking** | Typed coordinate entry, FROM, M2P, point filters and typed snap overrides work (engine); in the interface a click gives a command its point with a rubber band, running object snaps show a marker, and ortho, polar tracking, grid snap and object snap tracking constrain the click, with a label and the rays drawn (the engine's snapped cursor; tried in Chromium by its author; Extension and Parallel reached by the same call, read from the source only). There are no grips and no dynamic input (W2, W4), and no Tab snap cycling or snap menu (W3, W5); no TK; ellipse/spline intersections approximate ([ui-parity.md](ui-parity.md), [gaps.md](gaps.md) W2–W4, F1) | 35–50 (predates the interface change) |
| Dimension and annotate | partial, not blocking | All core DIM types, associativity, DIMSTYLE variables (43 of ~80), TEXT/MTEXT, MLEADER, tables work at the command line; no dialogs at all in the interface (W1), so no DIMSTYLE dialog and no MTEXT editor; MLEADER thin (F7, F9, F10). A drafter can dimension a sheet end to end by typing; without grips a placed dimension cannot be dragged | 0 for the gate (beta work) |
| Use blocks (insert library blocks, edit them, attributes, xrefs) | **partial, blocking** | Static BLOCK/INSERT/attributes, ATTSYNC, BATTMAN editing, xrefs (#525), the Block Editor commands (BEDIT/BSAVE/BCLOSE: every reference updates) and REFEDIT (#813) work in the engine; their dialogs and palettes (Edit Block Definition, External References, the Blocks window) were the egui interface's and are gone (W1); no XCLIP; dynamic blocks from other drawings lose their behaviour (F2, F3) | 35–55 |
| Layers, layouts and plotting a sheet | **partial, blocking** | Layers, layouts, viewports, page setups, PDF output, plot styles (CTB/STB, #410), PUBLISH (#186) and plotter devices (#564) work in the engine and from `cadcraft-cli`; the Plot dialog (#160) and Plot Preview were the egui interface's and are gone, and plotting from the interface is not verified (W1, W14, P1); layouts are tabs over the drawing; printers only via PDF/PNG/SVG files (F14, H3) | 15–25 (predates the interface change) |
| Save DWG that AutoCAD opens without loss, and reopen others' DWGs | **no** | DXF keeps what we don't model (#528) and writes native MULTILEADERs (#459, not yet tested through DWG); through DWG, acadrust drops custom-class entities and objects and some foreign data; never checked in AutoCAD; no real-file tests; a 10 MB DWG failed after ~2 min (#57) (FF1–FF6). **The interface opens and saves DXF only**: its WebAssembly engine has no DWG (W8, FF12); DWG goes through `cadcraft-cli convert` | 40–60 + owner (real-file corpus, AutoCAD check), plus FF12 |
| **To alpha** | | | **≈ 125–190** |

Ready for real work is ≈ 36% (it was ≈ 38% with the egui interface: UI/UX fidelity fell from 43%
to ≈ 25% when the interface was replaced and is ≈ 31% with the snapped cursor back,
[ui-parity.md](ui-parity.md)), under the ~40% alpha bar. The hours in this table were estimated for the old interface. They do not include bringing
the new one to the same level, which is not estimated yet.

## Beta checklist

Beta means: close to feature complete for mainstream 2D work, opens and saves DWG reliably,
remaining gaps are known bugs and edge features (≈ 75% ready for real work).

| Item | State | Est. |
|---|---|---|
| DWG/DXF: nothing lost on save; MULTILEADER native; version choice; code pages; real-file corpus green; verified in AutoCAD | not started | 50–75 |
| 2D geometry exact for ellipses and splines; polyline offset correct; relative tolerances | not started | 50–80 |
| Precision input at AutoCAD level (tracking, dynamic input, overrides, point modifiers, grips, selection keywords, context menus) | partial | 90–140 |
| Every Draw/Modify prompt option works; associative arrays | partial | 40–60 |
| Annotation depth: DIMSTYLE manager and variables, missing DIM commands, in-place MTEXT, fields, MLEADER editing, annotative scaling, tables | partial | 90–130 |
| Xrefs, block editor, dynamic blocks, groups, attribute tools | not started | 90–135 |
| Plot styles, plot preview, PUBLISH, non-rectangular viewports | partial | 30–45 |
| Autosave, recovery, AUDIT/RECOVER, Options dialog, templates, SHX, user `.lin`/`.pat` | partial | 40–60 |
| AutoLISP core subset and SCRIPT | done (AutoLISP #758, SCRIPT #693); Visual LISP, DCL and reactors to come | 30–50 |
| Catalog plus AutoCAD for Mac's languages | not started | 30–45 |
| Stability: CI gate, issue backlog, command smoke sweep, geometry fuzzing | partial | 30–50 |
| Platforms: web open/save, Windows/Linux runtime checks; performance at 1M entities and large DWG | partial | 20–35 |
| **Total to beta** | | **≈ 600–930** |

About 70% of this parallelises across 4–6 agents (one per row), so elapsed time is roughly
150–250 hours.

## Milestones

Status re-scored on 2026-10-10 by depth, not presence (the 2026-10-07 percentages, reported by the
agents that built each milestone, are in the progress log of [ROADMAP.md](../ROADMAP.md)).

| # | Milestone | Status | Remaining (h) |
|---|---|---|---|
| M0 | Skeleton and vertical slice: workspace, AutoCAD-style UI, command line, draw/modify basics, DXF, CLI, MCP, web | done; the UI was rebuilt as the web interface on 2026-11-11 ([ui-parity.md](ui-parity.md)) | — |
| M1 | Drafting core: every 2D Draw command and option, dynamic input, object snap tracking, snap overrides | ≈ 55% (Draw breadth strong; tracking, dynamic input, overrides missing) | 35–55 |
| M2 | Modify: grips, PEDIT, SPLINEDIT, LENGTHEN, BLEND, ALIGN, associative arrays, trim/extend for all curves, MATCHPROP UI | ≈ 50% | 45–70 |
| M3 | Layers and properties | ≈ 70% (open layer bugs #71–#75, #87) | 10–15 |
| M4 | Annotation: DIM*, DIMSTYLE manager, MLEADER, in-place MTEXT, fields, tables, annotative scaling, SHX | ≈ 40% | 90–130 |
| M5 | Hatch and blocks: hatch depth, block editor, dynamic blocks, xrefs, groups, attributes | ≈ 30% | 105–160 |
| M6 | Layouts and plotting: viewports, page setups, plot styles, preview, PUBLISH | ≈ 35% | 35–50 |
| M7 | Files: DWG/DXF fidelity and versions, RECOVER/AUDIT, templates, autosave, ETRANSMIT, underlays | ≈ 30% | 170–280 (incl. other formats) |
| M8 | Inquiry and utilities, OPTIONS, customisation | ≈ 25% | 45–70 |
| M9 | Parametric | ≈ 50% | 20–30 |
| M10 | Performance: 1M entities at 60 fps, large DWG loads | ≈ 60% (internal numbers only) | 20–40 |
| M11 | 3D: UCS, orbit, visual styles, solids, surfaces, meshes, sections, rendering | ≈ 2% | 300–450 |
| M12 | Automation: AutoLISP, SCRIPT, action recorder, sheet sets, Express Tools | ≈ 15% (MCP and CLI done; the control channel is specified but not served since the egui app was removed) | 130–220 |
| M13 | 1.0 polish: preferences, workspaces, localisation, accessibility, signed packages, docs | ≈ 15%, not re-scored (dark, light and system themes with measured contrast, and keyboard patterns through the whole shell, are in the web interface; the string catalogs and language switching were the egui interface's and are gone; packages built from the new desktop shell are not verified) | 110–170 |
| — | Geometry precision (cross-cutting, see [geometry-parity.md](geometry-parity.md)) | ≈ 40% | 70–110 |
| — | AI features | ≈ 20% (the in-app assistant, [assistant.md](assistant.md); the figure is target-app-parity's) | 40–80 |
| | **Remaining to full parity** | | **≈ 1,300–2,100** |

Milestone rows overlap a little with the cross-cutting rows; the total is the dimension sum in
[target-app-parity.md](target-app-parity.md), not the column sum.

## After beta

3D foundations (UCS, 3D views, orbit, then solids per `plan/adr/0001`), sheet sets, the full
AutoLISP surface, AI features with openly licensed local models, and every remaining language.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-11 | minor | The interface's pointer follows ortho, polar, grid snap and object snap tracking (the engine's snapped cursor): the first alpha-gate row's evidence updated; UI/UX ≈ 25% → ≈ 31%, ready for real work ≈ 35% → ≈ 36% (hand-assessed). The row still fails the gate: no grips, no dynamic input |
| 2026-11-11 | major | The egui interface was removed and the web interface (`apps/ui`, and the desktop app as its native webview) replaced it: a note under Current focus, alpha-gate evidence rewritten for what the interface does and does not do, ready for real work 38% → 35% (UI/UX 43% → 25%, hand-assessed), M0, M12, M13 and AI rows annotated. Statuses and hours are unchanged and predate the change |
| 2026-10-12 | minor | Block Editor for static blocks landed: "Use blocks" evidence updated; status and hours unchanged (REFEDIT and dynamic blocks remain) |
| 2026-10-11 | minor | Alpha-gate evidence refreshed for merged work (#459, #525, #528, #160, #186, #564); statuses and hours unchanged |
| 2026-10-10 | minor | Merged main: fmt fixed, Ukrainian catalog noted in M13, ready for real work 38% |
| 2026-10-10 | minor | Alpha gate added (5 core workflows, 4 failing); stage pre-alpha |
| 2026-10-10 | major | Created from the old ROADMAP's milestone table and current focus; milestones re-scored by depth; beta checklist added |
