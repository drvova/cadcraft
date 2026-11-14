# Jewelry parity with Rhino and its jewelry plugins, without code

Status: 2026-11-14. The jeweller's standard is Rhino 3D with a jewelry plugin (MatrixGold,
CrossGems, RhinoArtisan, Pro-J) and Grasshopper for parametric work. CADCraft aims at the same
reach **with no code**: what a Rhino jeweller builds by writing a Grasshopper definition is, here,
a command with named parameters, a panel, a template, a drag handle, a proposal or a request to
the assistant. Everything stays parametric (change a number, the piece rebuilds) and measured
(grams, carats, cost, checks).

This is a feature list drawn from public pages only (Rhino's jewelry page, the public course
syllabi on rhino3d.education, the plugins' one-line descriptions). Nothing of Rhino's or a
plugin's code, icons, artwork, names of UI elements or look is used.

Legend: **done**, **partial**, **planned** (with the gap row in [gaps.md](gaps.md) where there is one).

## Ring anatomy and kinds

| Rhino workflow | CADCraft, without code | Status |
|---|---|---|
| Band from a circle and a profile; dome, comfort, court, knife, bevel, concave sections | `piece {kind:"band", profile}`, the Piece panel | done |
| Band from a profile curve you draw | `piece {profile:{curve}}`, "Update from curve" | done |
| Free-form NURBS surfaces (loft, revolve, sweep, extrude, ruled), area and volume | `NurbsSurface` in `crates/geom` ([nurbs-surfaces.md](nurbs-surfaces.md)) | partial: kernel only, no surface entity, commands, trims or 3dm surfaces yet |
| Profile swept along a rail (oval, shaped shank); two-rail sweep | `piece {rail:{curve}}` (any profile, drawn or named, swept square to a drawn closed rail scaled to the finger), "Update rail from curve", template Oval Band | done for one rail; two-rail sweep planned (J9) |
| Dome ring, tapered shank | `kind:"dome"` | done |
| Signet (flat face for engraving) | `kind:"signet"` | done; flush stone in the face partial |
| Solitaire, three-stone, halo | `kind:"solitaire"`, `"threestone"`, `halo` | done |
| Bezel head | `head:"bezel"` | done |
| Eternity, half eternity | `kind:"eternity"`, `"halfeternity"` | done |
| Split shank, double shank, bypass, cathedral shoulders | `piece {shank:{split:2\|3, gap, from, cathedral, height}}`, the Piece panel's Shank group, templates | split and cathedral done (solitaire); double shank and bypass planned (J10) |
| Twisted cable, braided bands | `piece {kind:"band", pattern:{twist:{strands, turns, wire}}}`, template Cable Band | twisted cable done (2–3 strands); braids planned (J11) |
| Text and names on a band; hallmark | `piece {engrave: {text, at: inside|outside, style: cut|raised, font: block|script}, hallmark: true|{maker}}` | done (2026-11-14): CADCraft's own stroke font cut as round-bottomed grooves wrapped round the band; raised names add metal; fineness from the metal; weight, checks, developed view, 3D view and cast solid. Not yet: outline (filled) fonts, text on a dome or signet's outside, several lines |
| Earrings, pendants, chains, links | `PIECE` kinds `pendant` (the solitaire head, prongs or bezel, halo optional, with a loop or tube bail sized for a chain; a drop on a jump ring), `stud` (a pair: head and post, bought-in butterfly or scroll back) and `drop` (a pair: a hanging head on a jump ring under a French wire or a stud top); checks bail-opening, bail-wire, jump-ring, jump-ring-wire, post, ear-wire; weight, carats, sheet, 3D and cast solid count both of a pair; hoops, chains and links not yet | partial |

## Stones and settings

| Rhino workflow | CADCraft, without code | Status |
|---|---|---|
| Gem library (round and fancy cuts) | `gem`, `gemlist`; cuts in `gem.rs` | done; a bench's own library planned (J3) |
| Stones along a curve | `pave` on a region; pavé on the band | partial |
| Pavé on a surface: rows, honeycomb, scalloped, auto-spacing | `piece {pave}` | done (scallops cut into the band's sides in the STL) |
| Prongs: count, shape (round, claw, tab, V), height | `prongs`, `prongStyle` (round, claw, tab, v, double), `prongHeight`, `prongTip`, `prongWire`; the Setting group | done (baskets planned, J9) |
| Channel setting | `pave {layout: "channel"}`, `channelWall`, `channelLip` (sheet, mesh, cast solid, checks) | done |
| Cutters (seats) for every stone | cut automatically in the cast solid | done |
| Graduated stones along a row | `pave.graduated` on a pavé or channel row | partial (eternity rows planned, J1) |

## Checks and measures

| Rhino workflow | CADCraft | Status |
|---|---|---|
| Volume and weight per metal | grams per alloy on Bench, live | done (ahead) |
| Stone count and carats | Bench, tech sheet | done (ahead) |
| Wall thickness, prong and seat checks | piece checks, pavé rim, bezel wall | done (ahead) |
| Cost estimate | price book, Bench | done (ahead) |
| Ring sizes in every system, resizing | `ringsizes`, size on `piece` | done |

## Making it

| Rhino workflow | CADCraft | Status |
|---|---|---|
| One closed mesh for printing (ShrinkWrap) | STL export writes one merged metal solid, vertices projected onto the true surface | done; sharp edges (seat rims, a flat band's corners) are still chamfered and slightly ragged at the default cap |
| Sprue, supports, shrinkage allowance | `stlout {sprue, shrink}`; the 3D view's Sprue and shrink pickers by Download STL | partial (a straight round sprue, refused near a stone or seat; no supports or tree) |
| 2D blueprint with dimensions and sections | the drawing, layouts, Tech Sheet | done |
| Photoreal render, turntable | Realistic 3D view; Save Render: stills to 4096 px (studio, light, transparent), turntables as WebM or APNG, a contact sheet | partial (rasterised studio, not ray traced: no caustics, no depth of field, no HDRI) |
| SubD for organic forms (baskets, wavy and twisted shanks, sculpture) | Catmull–Clark cage, creases, limit mesh, volume and edits in `crates/geom` ([subd.md](subd.md)); not yet a drawing object or in the cast solid | partial |
| Photoreal render, turntable | Realistic 3D view; stills | partial (no turntable or image export) |

## Working

| Rhino workflow | CADCraft | Status |
|---|---|---|
| Four viewports | Top, Front, Right, Perspective | done |
| Gumball, live editing | drag handles that change parameters | done |
| History (edit and it rebuilds) | the parametric piece | done |
| Grasshopper sliders, the Player's input panel | the Piece panel; proposals; the assistant | done |
| Generative patterns (Voronoi, lattice, Truchet, image-driven) | pattern options on the band | planned |
| Interoperability: open and save Rhino `.3dm` | today via Rhino's DXF (curves) and STL/OBJ (meshes) exports, and `STLOUT` back; a 3dm reader waits on an owner decision (ADR 0003: no public 3dm specification) | planned |

## Behaviours to match (from McNeel's public command reference, in our words)

These are the behaviours of general Rhino tools that jewellers lean on, noted so CADCraft's own
versions behave as a jeweller expects. Our implementations are our own.

| Rhino tool | Behaviour a jeweller relies on | CADCraft |
|---|---|---|
| Sweep along one rail | The section keeps its angle to the rail ("free-form" frame), or stays upright against a fixed axis; a closed sweep returns to the first section; a taper can blend linearly end to end | The rail sweep (shank shapes) must keep the profile perpendicular and upright, with no twist where the rail's tangent meets the fixed axis |
| Sweep along two rails | Height can scale with width or stay fixed | Two-rail band: planned |
| Pipe | Round wire with a start and end radius, a taper blended either evenly or held at the ends; flat or round caps; a hollow wall option | Prongs, beads, cable strands are pipes; tapered prongs (claw) done |
| Array along a curve / on a surface | Count or spacing; copies oriented by the curve's frame, kept upright, or by the surface normal; even spacing by length rather than by parameter | Pavé on the band places by arc length and orients to the surface normal; auto-fit by gap |
| Flow along a curve or surface | Wraps flat decoration onto a band, rigid (move only) or deforming, with optional stretch | Engraving and generative patterns are laid out on the developed band and wrapped; a general "flow a drawing onto the band" is planned |
| Offset surface / shell | Wall thickness with sharp or round corners; a closed solid from inside and outside | The band's wall and the hollow options are parametric |
| Twist, bend, cage edit | Deform with a falloff: twist over an axis, bend along a spine, a lattice with local influence | Cable twist done; general deformers planned |
| Booleans | Need closed solids with outward normals; coincident faces and poles are where they fail | The cast solid avoids general Booleans (implicit CSG, ADR 0002) |
| ShrinkWrap | One closed mesh around many parts: a target edge length, an offset, smoothing | The merged cast solid: sampling step (≈ edge length), a shrink allowance, smoothing in progress |
| Volume, centroid | Volume and centroid of closed objects; no density built in | Grams by alloy, carats, cost, built in |

## Roadmap to a Rhino replacement for jewellers

Built clean-room: from published mathematics, public documentation, black-box observation and our
own tests — never from Rhino's binaries, code, interface or artwork.

1. **Now**: the jewelry wave (shanks, settings, engraving, earrings and pendants, patterns, render
   export, `.3dm` meshes and curves) and the NURBS surface foundation (`crates/geom`).
2. **Next**: surfaces as drawing objects (seen, snapped to, measured); `.3dm` surfaces; flow along a
   surface; pavé on free-form surfaces.
3. **Then**: trimmed surfaces and joined solids (B-rep) with Booleans that print; SubD for organic work.
4. **Later**: offsets, fillets and shells on solids; a node editor for power users; general modelling
   beyond jewelry.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-14 | minor | SubD row: the subdivision-surface foundation landed in `crates/geom` |
| 2026-11-14 | minor | Roadmap to a Rhino replacement for jewellers |
| 2026-11-14 | minor | NURBS surface kernel row (crates/geom) |
| 2026-11-14 | minor | Behaviours to match, from the public command reference |
| 2026-11-14 | minor | Interoperability row for `.3dm` (ADR 0003) |
| 2026-11-14 | minor | The render row: image, turntable and contact sheet export |
| 2026-11-14 | minor | Making it: STL surface on the true surface, scallops cut, sprue and shrinkage allowance |
| 2026-11-14 | minor | Shank shapes: a drawn rail, a split shank, cathedral shoulders and a twisted cable band are done; two-rail sweep, double shank/bypass and braids are rows J9–J11 |
| 2026-11-14 | minor | Prong styles and heights done, channel setting done, graduated rows partial (pavé and channel) |
| 2026-11-14 | minor | Earrings and pendants: pendant, stud and drop kinds with bails, posts, jump rings and ear wires (partial; hoops, chains and links planned) |
| 2026-11-14 | new | The feature list against Rhino's jewelry workflow, and the no-code rule |
| 2026-11-14 | minor | Text and names on a band, and the hallmark: done |
