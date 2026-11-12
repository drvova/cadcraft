# Target-app parity: CADCraft vs AutoCAD 2027

> **Last reviewed:** 2026-10-10 (features, files, the audience numbers) · 2026-11-12 (UI/UX) · **Last updated:** 2026-11-12 · **Change:** minor (dynamic input, the Layer Properties Manager, paper under a layout and recovery copies in the web interface: UI/UX fidelity ≈ 37% → ≈ 42%, ready for real work ≈ 37% → ≈ 38%; earlier the same day ≈ 31% → ≈ 37%; on 2026-11-11, major: the web interface replaced the egui interface, UI/UX 43% → ≈ 25%) · **Target:** Autodesk AutoCAD 2027

The authoritative assessment of how close CADCraft is to AutoCAD, and how much Opus 5.5 work
remains. [ROADMAP.md](../ROADMAP.md) summarises it, [gaps.md](gaps.md) lists every shortfall,
and the deep checklists are [geometry-parity.md](geometry-parity.md),
[ui-parity.md](ui-parity.md), [file-format-parity.md](file-format-parity.md),
[hardware-parity.md](hardware-parity.md) and [localization-parity.md](localization-parity.md).

## Headline

| Number | Value | Kind |
|---|---|---|
| **Feature breadth** (AutoCAD for Mac menu items with a live command) | **304 / 491 = 62%**: 300 (61%) counted by `cargo xtask parity` on 2026-10-26, which sees engine commands only, plus 4 items the web interface has of its own (Window ▸ Tool Bar, Status Bar, Command Line, Properties Inspector; hand-counted 2026-11-11 against the checklist's uncovered list). It was 245 (233 + 12 egui items) on 2026-10-10. Breadth counts a registered command; in the interface a command that had a dialog runs as command-line prompts | measured ([parity-checklist.md](parity-checklist.md)); `cargo xtask parity` not re-run on 2026-11-11 |
| Feature breadth, 2D menus only (excluding 150 3D items) | **≈ 65%** (222 / 341 by `cargo xtask parity`'s rule) | measured (source scan, 2026-10-10; not recounted since) |
| Feature depth, weighted by use (features dimension) | **≈ 41%** | estimated (table below) |
| **Ready for real work** | **≈ 38%** | estimated (dimension table below; weighted 37.6%; it was 37.7% with the egui interface, and 35.0%, 36.1% and 36.9% on the web interface as its parts landed) |
| Mainstream practitioner (2D drafter, weekly tools) | **≈ 28%**, measured on the egui interface; not re-measured, and lower now | estimated ([below](#mainstream-practitioner)) |
| Essentials user (core tools, default settings) | **≈ 46%**, measured on the egui interface; not re-measured, and lower now | estimated ([below](#essentials-user)) |
| Remaining to alpha (gate rows) | **≈ 125–190 Opus 5.5 hours** | estimated |
| Remaining to beta | **≈ 600–930 Opus 5.5 hours** | estimated |
| Remaining to full parity | **≈ 1,300–2,100 Opus 5.5 hours** | estimated |

Stage: **pre-alpha**. Four of the five core workflows fail the [alpha gate](roadmap.md#alpha-gate) (precise drafting with tracking, blocks, plotting, lossless DWG save), and ready for real work (≈ 38%) is under the ~40% alpha bar. Alpha was ≈ 125–190 h away before the interface was replaced; the work to bring the web interface to the egui interface's level ([gaps.md](gaps.md#uiux) W1–W14) is not in that figure and is not estimated yet.

## Readiness by audience

| Audience | Ready % | Opus 5.5 agent wall-clock hours to ~95% | Work that dominates |
|---|---:|---|---|
| Full target (ready for real work) | ≈ 38% | ≈ 1,150–1,850 h (≈ 70% parallelises across 4–6 agents: ≈ 300–480 h elapsed) | 3D kernel (300–450 h), DWG/DXF and other formats, AutoLISP and ecosystem, blocks/xrefs/dynamic blocks, localization |
| Mainstream practitioner (2D drafter) | ≈ 28% | ≈ 570–880 h (≈ 70% parallelises: ≈ 150–240 h elapsed) | lossless DWG exchange and a real-file corpus, precision input (tracking, dynamic input), 2D geometry precision, blocks/xrefs, annotation depth, stability backlog |
| Essentials user | ≈ 46% | ≈ 140–225 h (≈ 50% parallelises across 3 agents: ≈ 60–110 h elapsed) | stubbed options in basic draw/modify commands, opening DWGs people send, launch/stability fixes, plot dialog, context menus and dynamic input |

Hours are subsets (essentials ⊂ mainstream ⊂ full) and use the calibration in [Remaining effort](#remaining-effort-and-how-it-was-calibrated): ≈ 25 commands
per agent-hour at presence quality in the first build (≈ 11.5 agent-hours), 0.3–0.7 h per option
or bug fix (≈ 60 such fixes on 2026-10-10), 2–5 h per moderate feature, 15–100 h per subsystem.

The full number is an additive weighted sum over the dimensions (table below); only the
mainstream and essentials numbers use multiplicative discounts.

The hours in this table, and the mainstream and essentials percentages, were worked out on the
egui interface and have not been redone since it was removed on 2026-11-11. They leave out the
interface work in [gaps.md](gaps.md#uiux) W1–W14.

## Target and how it was measured

- **Target:** Autodesk AutoCAD 2027 for Mac, version 26.0 (installed under
  `/Applications/Autodesk/AutoCAD 2027`), and AutoCAD 2027 for Windows from Autodesk's
  documentation where the two differ (Ribbon, Sheet Set Manager, Express Tools, .NET).
- **Clean room:** the installed bundle was inspected by **listing names only**: localizations
  (`Base`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `zh_CN` `.lproj` folders), `Contents/PlugIns`
  module names (AcSolids, AcDim, AcTable, AcSection, AcSubD, AcPublish, AcETransmit, AcXDiff /
  DWG Compare, AcCounting, AcMarkupAssist, AcTrace, AcSmartCenter, AcSpeller, Vlide …, about 130
  modules), and `Resources/Support` file names. Nothing inside a file was read, nothing was
  copied, AutoCAD was not launched in this pass.
- **Menu oracle:** `xtask/data/menu-catalog.txt` (feature names only, 491 leaf items, recorded from
  the running AutoCAD 2027 for Mac) against the command registry.
- **Behaviour reference:** `plan/autocad/01-observed-ui.md` and local reference screenshots (black
  box, never committed); Autodesk's public command reference.
- **CADCraft:** the source on `main` at bd2412f (2026-10-10/11), read by four agents in
  parallel: command-by-command option audits (prompts that print "not available yet"), the
  geometry kernel, DXF/DWG paths, interaction code. Plus the 88 GitHub issues and 47 open PRs.
  Disk was nearly full, so nothing was built or run: `cargo xtask parity` was reproduced by a
  Python scan of `CommandSpec` menus with the xtask's matching rule, which gives exactly the same
  uncovered list as the last generated report (233 / 491). Re-run `cargo xtask parity` to
  confirm.
- **2026-11-11, the interface only:** the egui interface was removed and the web interface
  (`apps/ui`, and `apps/cadcraft` as its native webview) replaced it. Its source was read at
  ec61741 (`apps/ui/src`, `crates/wasm/src/lib.rs`, `apps/cadcraft`) and the UI/UX dimension
  re-scored row by row in [ui-parity.md](ui-parity.md). Nothing was built or run. The commits
  say what was exercised: Chromium only, the desktop webview on Windows only, a local stand-in
  for a model provider only. The other dimensions were not re-measured.

## Mainstream practitioner

The typical AutoCAD professional is a 2D drafter or detailer: draw, modify, dimension, use
blocks, manage layers, plot sheets, and exchange DWGs with colleagues, every week. Excluded per
the standard: 3D, AutoLISP and plug-ins, cloud/AI (Autodesk Assistant, Smart Blocks, Traces,
Share), Sheet Set Manager administration, specialist hardware, languages other than English.

| Area (weekly use) | Weight | Depth | Weighted |
|---|---:|---:|---:|
| Draw (2D) | 15% | 60% | 9.0 |
| Modify | 18% | 50% | 9.0 |
| Precision input (snaps, tracking, coordinate entry, dynamic input) | 13% | 40% | 5.2 |
| Layers and properties | 8% | 70% | 5.6 |
| Dimensions | 10% | 45% | 4.5 |
| Text and MTEXT | 6% | 35% | 2.1 |
| Leaders and tables | 3% | 25% | 0.8 |
| Hatch | 5% | 35% | 1.8 |
| Blocks, attributes, xrefs | 8% | 25% | 2.0 |
| Layouts and plotting | 8% | 35% | 2.8 |
| Inquiry and utilities (incl. autosave) | 3% | 30% | 0.9 |
| Command line and navigation | 3% | 58% | 1.7 |
| **Average depth** | 100% | | **≈ 45.3%** |

Depths are the area percentages above and in [ui-parity.md](ui-parity.md) as they stood for the
egui interface. The precision-input and command-line rows, and the interaction discount below,
differ for the web interface (two dialogs where egui had many) and have
not been redone. File I/O is not an area here; it is counted once, as the file-exchange discount.

| Discount | Factor | Evidence |
|---|---:|---|
| Interaction fidelity (beyond the precision-input area) | ×0.90 | hot-grip options ignored, no context menus, selection keywords W/C/F/WP/CP rejected (#224), transparent 'ZOOM cancels the running command (#220), ELLIPSE/BREAK keywords ignored (#219) |
| Stability on real machines | ×0.85 | 27 of 37 open issues are core-path bugs; about 60 correctness fixes merged on 2026-10-10 alone; lines not visible mid-command (#44); locked layers edited (#87); no CI runs the Rust tests on PRs |
| Exchanging files with AutoCAD users | ×0.80 | saves drop unmodelled entities, images, layer states, multileader styles, true colours and more (#79, #201, #204, #208, #209, #213, #223); never checked in AutoCAD; a 10 MB DWG failed (#57) |

**Mainstream practitioner ≈ 45.3% × 0.90 × 0.85 × 0.80 ≈ 28%** (estimated). It is lower than
ready for real work (≈ 38%) for CADCraft, unlike most apps: the full number credits additively
what CADCraft does well beyond 2D drafting (platforms 75%, performance 60%, hardware 45%), while
here the three blockers a working drafter hits every day multiply.

**User evidence** (GitHub issues, PRs and comments, excluding maintainers, counted 2026-10-10):
97 issues filed (60 closed, 37 open) and 127 PRs from 19 outside authors. Praise: 2 (#65:
"I was looking for Autocad replacement for years"; #18), plus thanks on a translation PR (#218).
"Switched from AutoCAD" reports: 0. Open issues: 27 core-path bugs (file data loss, plotting,
selection, layers, web open/save, large DWG), 6 niche requests (ViewCube drag, preferences, SVG
icon, magnifier, constraint edge case, macOS window controls), 4 other (icon offer, trademark,
"Revitcraft", dynamic-block help offer). Interest is real; the open issues are about the core
path, which matches the discounts.

## Essentials user

A casual user who sticks to the essential features: start a drawing, the common draw and modify tools with default
settings, undo, save, print a PDF. Excluded: advanced options, sheet sets, xrefs, plot styles,
annotation styles, exchange edge cases and everything excluded above.

| Core feature | Weight | Depth | Weighted |
|---|---:|---|---:|
| Launch, Start tab, new/open drawing | 10% | 70% | 7.0 |
| LINE, PLINE, CIRCLE, ARC, RECTANG | 20% | 70% | 14.0 |
| MOVE, COPY, ROTATE, SCALE, MIRROR, ERASE | 15% | 70% | 10.5 |
| OFFSET, TRIM (quick), EXTEND, FILLET | 10% | 50% | 5.0 |
| Running object snaps, ortho, polar | 10% | 55% | 5.5 |
| Basic dimensions (linear, aligned, radius) | 8% | 60% | 4.8 |
| TEXT and MTEXT | 5% | 55% | 2.8 |
| Layers (create, colour, on/off) | 7% | 75% | 5.3 |
| Pan, zoom, picking and window selection | 5% | 65% | 3.3 |
| Undo, redo | 3% | 85% | 2.6 |
| Save and reopen own drawings | 4% | 75% | 3.0 |
| Print or export to PDF | 3% | 45% | 1.4 |
| **Average depth** | 100% | | **≈ 65%** |

| Discount | Factor | Evidence |
|---|---:|---|
| Launch and stability | ×0.90 | startup crash on Intel UHD graphics (#33, fixed in 0.4.0), lines not visible (#44), Linux mouse delay (#25), web open/save broken (#55, #133) |
| Discoverability and UI clarity | ×0.92 | no right-click menus (dynamic input got real pointer boxes in #60, which raised this from ×0.90), Print has no plot dialog (#160), some menu items only recently got dialogs (#126) |
| Opening files people send them | ×0.85 | DWGs from others untested on real files; a 10 MB DWG failed (#57); `.dxf` from Finder fails (#158); pre-2007 CJK/Cyrillic DXF garbled (no code pages) |

**Essentials user ≈ 65% × 0.90 × 0.92 × 0.85 ≈ 46%** (estimated).

## By feature area (the features dimension)

Weights are the share of a typical AutoCAD user's working time (2D drafters and detailers are
the large majority; 3D modelling and cloud features are a minority). Percentages are depth, not
presence: an option that prints "not available yet" doesn't count.

| Area | Weight | Parity | Remaining (Opus 5.5 h) | Evidence and main gaps | Doc |
|---|---:|---:|---|---|---|
| Draw (2D) | 13% | 60% | 15–25 | ARC 11/11 methods, CIRCLE 6/6, RECTANG all options plus a centre construction mode (#1127), REVCLOUD, WIPEOUT, XLINE; PLINE arc options and SPLINE options done (#397, #408); MLINE, REGION and HELIX are objects (#510); isometric drafting (#556) | [gaps](gaps.md#features) |
| Modify | 15% | 50% | 40–60 | TRIM/EXTEND, OFFSET, ROTATE, PEDIT and SPLINEDIT options done (#397, #558, #559); associative arrays with ARRAYEDIT (#448), no array grips; MATCHPROP picker and Settings (#439) | [gaps](gaps.md#features) |
| Geometry precision | 10% | 40% | 70–110 | exact for lines/arcs/circles; ellipse and spline intersections, offsets, closest points tessellated; absolute tolerances; polyline offset doesn't recompute bulges | [geometry-parity](geometry-parity.md) |
| Layers and properties | 7% | 70% | 10–15 | Layer Properties Manager with filters, states, VP overrides; QSELECT; Quick Properties; transparency; linetype manager thin; 19 linetypes of ~45 | [gaps](gaps.md#features) |
| Dimensions | 9% | 45% | 25–35 | all core DIM types and associativity; style variables, DIMJOGGED, DIMJOGLINE, DIMBREAK, DIMEDIT, DIMINSPECT, QDIM modes (#507) and TOLERANCE (#420); no DIMSTYLE manager dialog or smart DIM | [gaps](gaps.md#features) |
| Text and MTEXT | 6% | 35% | 30–45 | TrueType, formatting codes, stacking; MTEXT prompt options (#408), indents, tabs, bullets, numbering and columns (#547), annotative scaling (#468); editor is a dialog, not in place; no fields or SPELL (open PR #551), no SHX | [gaps](gaps.md#features) |
| Leaders, tables, fields | 4% | 25% | 25–35 | MLEADER options and block content (#408), native MULTILEADER in DXF (#459); tables with cell styles, formulas, breaking and CSV data links (#534); no MLEADEREDIT/ALIGN/COLLECT, no FIELD | [gaps](gaps.md#features) |
| Hatch and gradients | 5% | 35% | 15–25 | pick points with islands; 23 patterns of ~85; gradients render flat; origin, gap tolerance, separate hatches, island styles and HATCHEDIT options (#451); Hatch and Gradient / Hatch Edit dialogs (no Preview or Inherit Properties) | [gaps](gaps.md#features) |
| Blocks, attributes, xrefs, groups | 9% | 25% | 80–120 | static blocks and attributes; ATTSYNC, BATTMAN editing, DATAEXTRACTION/EATTEXT (#433); xrefs (#525); groups (#417); Block Editor for static blocks (BEDIT, BSAVE, BSAVEAS, BCLOSE); REFEDIT; dynamic block references read and edited; no dynamic-block authoring, XCLIP, DesignCenter | [gaps](gaps.md#features) |
| Layouts, viewports, plotting | 9% | 35% | 35–50 | layouts, per-VP layers, page setups, plot styles (CTB/STB), Plot dialog (#160), Plot Preview and PUBLISH (#186), plotter devices (#564), PDF with text, layers and sheets (#567, #571), polygonal/object/clipped viewports (#453), annotative scales (#468); no MVIEW Restore, no system printers | [gaps](gaps.md#features) |
| Inquiry and utilities | 4% | 30% | 30–45 | DIST, AREA, ID, LIST, MEASUREGEOM, CAL, FIND, COUNT across layouts, QuickCalc, COMPARE (#563) and COMPAREEXPORT, MASSPROP on regions (#510), autosave/recovery, AUDIT, RECOVER (#406), OPTIONS (#23); no SPELL (open PR #551), ETRANSMIT | [gaps](gaps.md#features) |
| Parametric constraints | 2% | 50% | 20–30 | all 12 geometric and the dimensional constraints, own solver; DOF report, G2 Smooth, ellipse/spline/block geometry and CONSTRAINTINFER landed (#546) | [geometry-parity](geometry-parity.md#constraint-solver--50) |
| 3D modelling, visualisation, rendering | 5% | 2% | 300–450 | no UCS, 3D views, orbit, solids, surfaces, meshes, sections, visual styles, materials, lights or rendering; 150 of the 491 menu items | [gaps](gaps.md#features) |
| Collaboration and cloud (Sheet Set Manager, Share, Traces, Markup Import, Activity Insights, DWG Compare) | 2% | 5% | 40–70 | none of these exist | [gaps](gaps.md#features) |
| **Features dimension** | 100% | **≈ 41%** | **735–1,115** | | |

## By dimension (ready for real work)

| Dimension | Weight | Parity | Remaining (h) | Kind | Doc |
|---|---:|---:|---|---|---|
| Features (table above) | 35% | 41% | 735–1,115 | estimated | this file |
| UI/UX fidelity (point entry, snaps, tracking, dynamic input, grips, selection, command line, chrome) | 15% | 42% | 100–160 (estimated for the egui interface; not re-estimated) | estimated, weighted in the doc; re-scored for the web interface as its parts landed: ≈ 25% as first read and ≈ 31% with the snapped cursor (2026-11-11), ≈ 37% with grips, right-click menus and the first dialog, ≈ 42% with dynamic input, the Layer Properties Manager and paper under a layout (2026-11-12) (43% before; ui-parity's own table had reached 48% on 2026-10-11 and this row had not followed) | [ui-parity](ui-parity.md) |
| File formats (DWG/DXF fidelity first) | 20% | 30% | 170–280 | estimated | [file-format-parity](file-format-parity.md) |
| Stability and correctness | 10% | 35% | 30–50 | estimated: about 60 bug fixes merged on 2026-10-10 alone, 30 open issues, `cargo fmt` failing on main (PR #194), no CI runs the Rust tests on pull requests | [gaps](gaps.md#stability) |
| Performance | 5% | 60% | 20–40 | internal numbers only (200k entities fluent); 1M entities and large DWG loads untested; a 10 MB DWG took ~2 min to fail (#57) | [hardware-parity](hardware-parity.md#performance-on-hardware-internal-numbers-only) |
| Ecosystem and automation (AutoLISP/Visual LISP, .NET/ObjectARX, CUI, APPLOAD, Express Tools, App Store) | 5% | 10% | 120–200 | estimated; MCP and the CLI are ahead of AutoCAD (the control channel is not served since the egui app was removed), but no LISP, CUI or plug-ins | [gaps](gaps.md#ecosystem-and-automation) |
| Hardware | 3% | 45% | 15–25 | estimated | [hardware-parity](hardware-parity.md) |
| Platforms | 3% | 75% | 15–25 | macOS, Windows (x64/x86/arm64), Linux, FreeBSD, web: more than AutoCAD; but the web build can't open or save files reliably (#55, #133, #134) and has no DWG, and Windows/Linux get little runtime testing. Not re-measured on 2026-11-11: the desktop app is now the web interface in the system webview, run on Windows only so far, and it shares the web build's limits (no DWG, no autosave) | [gaps](gaps.md#platforms) |
| Localization | 3% | 5% | 60–100 | measured on the egui interface: string catalog with Ukrainian (936 rows, #36). Not re-measured on 2026-11-11: the catalogs were removed with that interface and the web interface is English only, so this figure is too high (it moves the total by at most 0.15) | [localization-parity](localization-parity.md) |
| AI features (Autodesk Assistant, Smart Blocks, Markup Assist) | 1% | 20% | 40–80 | the in-app assistant ([assistant.md](assistant.md)), now in the web interface; agent control over MCP is a different strength; no Smart Blocks or Markup Assist | [gaps](gaps.md#ai-features) |
| **Ready for real work** | 100% | **≈ 38%** (37.6: the weighted sum above, hand-computed 2026-11-12) | **≈ 1,300–2,100** (predates the interface change) | | |

The dimension weights describe what decides whether a professional can switch: features and
file compatibility dominate.

## Remaining effort and how it was calibrated

**Calibration.** The Claude Code transcripts of the session that built CADCraft show its whole
first version (about 51,000 lines, 290 commands, 47% menu breadth) took **about 11.5 Opus 5.5
agent-hours**: 6.9 hours of the lead agent (2026-10-07 02:16–09:08 UTC) plus about 4.6 hours of
eight sub-agents, some in parallel. (Git commit dates were rewritten earlier than that session
and can't be used.) That is about 25 commands per agent-hour **at presence quality**. Depth costs
far more: the next day external contributors found and fixed about 60 correctness bugs, each a
small PR with a regression test, and the audits in this pass found dozens of prompt options that
only print "not available yet". The rates used here are: an option or bug fix 0.3–0.7 h; a
moderate feature (object snap tracking, editable dynamic input, a dialog) 2–5 h; a subsystem
(xrefs, dynamic blocks, AutoLISP, plot styles) 15–100 h; the 3D kernel 300–450 h; then a 1.3×
tail factor for verification against AutoCAD.

**Why the total went up.** The 2026-10-07 roadmap put full parity at ≈ 29% with ≈ 570 h left,
from agent-reported milestone percentages. This pass audited behaviour instead of presence and
found new evidence: object snap tracking, extension, parallel and apparent snaps are toggles;
dynamic input is read-only; saves drop every entity the reader doesn't model; DWG always saves as
R2000; tolerances are absolute; and the old estimate had no rows for localization, ecosystem,
platforms, stability or AI. The weighted figure rose (29% → 41% features) because breadth and
depth both grew since 2026-10-07 and the weights are now written down; the hours rose because
the remaining work is depth and 3D.

**Parallelism.** About 70% of the work splits across 4–6 agents by area (each feature area,
file formats, UI precision, localization per language), so elapsed time is roughly a quarter of
the agent-hours. Needs a human: native-speaker review of every translation; a licensed real-file
DWG/DXF corpus (files from people who own them); black-box checks in AutoCAD of what we save;
3D mouse and tablet hardware; an owner decision on plug-in hosting and on DGN.

## History of this assessment

| Date | Feature breadth | Weighted parity | Remaining | Note |
|---|---|---|---|---|
| 2026-11-12 (later) | unchanged (not recounted) | ready ≈ 38% (37.6%); mainstream and essentials not re-measured | not re-estimated | dynamic input, the Layer Properties Manager, paper under a layout and recovery copies in the web interface: UI/UX ≈ 37% → ≈ 42%. Recovery copies and the wider drafting font touch the features and stability dimensions, which were not re-scored |
| 2026-11-12 | unchanged (not recounted) | ready ≈ 37% (36.9%); mainstream and essentials not re-measured | not re-estimated | grips, right-click menus and the first dialog in the web interface: UI/UX ≈ 31% → ≈ 37% |
| 2026-11-11 | 304/491 (62%): engine 300/491 from the checklist generated 2026-10-26, +4 interface items hand-counted | ready ≈ 36% (36.1%); mainstream and essentials not re-measured | not re-estimated | the egui interface was removed and the web interface replaced it: UI/UX 43% → ≈ 25% as first read (ready 35.0%), then ≈ 31% once the pointer followed the engine's snapped cursor |
| 2026-10-10 (merge) | unchanged (233/491 re-scanned) | ready ≈ 38% (37.7%), mainstream ≈ 28%, essentials ≈ 46% | unchanged within rounding | main landed dynamic input pointer boxes (#60), the Ukrainian catalog (#36), WIPEOUT/gradient DXF fixes (#147, #162): UI/UX 40% → 43%, localization 3% → 5% |
| 2026-10-10 (later) | unchanged | ready for real work ≈ 37% (unchanged: already built from the written dimension weights, no hidden judgement); mainstream practitioner ≈ 27%; essentials user ≈ 45% | unchanged | mainstream and essentials numbers added (craftrules standard) |
| 2026-10-10 | 245/491 (50%), engine-only 233/491 | features ≈ 41%, ready for real work ≈ 37% | 1,300–2,100 h | full re-measure in this format (this file) |
| 2026-10-07 | 233/491 (47%) | ≈ 29% overall, 2D ≈ 55% | ≈ 570 h | old ROADMAP: milestone percentages reported by the building agents |

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-12 | minor | The web interface gained dynamic input, the Layer Properties Manager, paper under a layout and recovery copies: UI/UX ≈ 37% → ≈ 42% ([ui-parity.md](ui-parity.md), hand-assessed from the source), ready for real work 36.9% → 37.6% by the dimension weights (hand-computed). No other dimension re-scored |
| 2026-11-12 | minor | The web interface gained grips, right-click menus and its first dialog (Drafting Settings): UI/UX ≈ 31% → ≈ 37% ([ui-parity.md](ui-parity.md), hand-assessed from the source), ready for real work 36.1% → 36.9% by the dimension weights (hand-computed) |
| 2026-11-11 | minor | The interface's pointer is resolved by the engine's snapped cursor (ortho, polar, grid snap, object snap tracking): UI/UX ≈ 25% → ≈ 31% ([ui-parity.md](ui-parity.md), hand-assessed), ready for real work 35.0% → 36.1% by the dimension weights (hand-computed) |
| 2026-11-11 | major | The egui interface was removed; the web interface (`apps/ui`) replaced it and the desktop app is that interface in a native webview. UI/UX fidelity re-scored from the interface's source, 43% → ≈ 25% ([ui-parity.md](ui-parity.md)); ready for real work 37.7% → 35.0% by the dimension weights (hand-computed). Feature breadth restated from the generated checklist (300/491 on 2026-10-26) plus 4 interface-only items, hand-counted. Ecosystem, platforms, localization and AI evidence text updated; their percentages, the mainstream and essentials numbers and every hour figure are not re-measured |
| 2026-10-24 | minor | Inquiry and utilities row: COMPAREEXPORT exports a comparison to a new drawing; parity percentages and hours not re-measured |
| 2026-10-22 | minor | Draw row: RECTANG gained a centre construction mode (`Center` keyword, `center: true`) beside its corner mode (#1127); parity percentages and hours not re-measured |
| 2026-10-12 | minor | Hatch row evidence: Hatch and Gradient / Hatch Edit dialogs; percentages and hours not re-measured |
| 2026-10-12 | minor | Blocks row evidence: Block Editor for static blocks (BEDIT, BSAVE, BSAVEAS, BCLOSE); percentages and hours not re-measured |
| 2026-10-11 | minor | Evidence text of the feature-area rows refreshed for merged work (#397, #406, #408, #417, #420, #433, #448, #451, #453, #459, #468, #507, #510, #525, #534, #546, #547, #558, #563, #564, #567, #571); parity percentages and hours not re-measured |
| 2026-10-10 | minor | Merged main: dynamic input pointer boxes (#60) lift UI/UX to 43%, Ukrainian catalog (#36) lifts localization to 5%; ready 37% → 38%, mainstream 27% → 28%, essentials 45% → 46% |
| 2026-10-10 | minor | Readiness-by-audience table: hours to ~95% for full (1,150–1,850 h), mainstream (570–880 h) and essentials (140–225 h); full number confirmed as an additive weighted sum, unchanged |
| 2026-10-10 | minor | Mainstream-practitioner (≈ 27%) and essentials-user (≈ 45%) numbers with written weights, discounts and user evidence |
| 2026-10-10 | minor | Stage alpha → pre-alpha under the core-workflow gate; remaining-to-alpha row |
| 2026-10-10 | major | Created from the old ROADMAP's parity section; full re-measure with weights, two numbers, per-area hours and calibration from the build session's transcripts |
