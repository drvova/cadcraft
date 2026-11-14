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
| Profile swept along a rail (oval, shaped shank); two-rail sweep | `piece {rail:{curve}}` (any profile, drawn or named, swept square to a drawn closed rail scaled to the finger), "Update rail from curve", template Oval Band | done for one rail; two-rail sweep planned (J9) |
| Dome ring, tapered shank | `kind:"dome"` | done |
| Signet (flat face for engraving) | `kind:"signet"` | done; flush stone in the face partial |
| Solitaire, three-stone, halo | `kind:"solitaire"`, `"threestone"`, `halo` | done |
| Bezel head | `head:"bezel"` | done |
| Eternity, half eternity | `kind:"eternity"`, `"halfeternity"` | done |
| Split shank, double shank, bypass, cathedral shoulders | `piece {shank:{split:2\|3, gap, from, cathedral, height}}`, the Piece panel's Shank group, templates | split and cathedral done (solitaire); double shank and bypass planned (J10) |
| Twisted cable, braided bands | `piece {kind:"band", pattern:{twist:{strands, turns, wire}}}`, template Cable Band | twisted cable done (2–3 strands); braids planned (J11) |
| Text and names on a band; hallmark | engraving/text on `piece` | planned |
| Earrings, pendants, chains, links | other piece kinds | planned |

## Stones and settings

| Rhino workflow | CADCraft, without code | Status |
|---|---|---|
| Gem library (round and fancy cuts) | `gem`, `gemlist`; cuts in `gem.rs` | done; a bench's own library planned (J3) |
| Stones along a curve | `pave` on a region; pavé on the band | partial |
| Pavé on a surface: rows, honeycomb, scalloped, auto-spacing | `piece {pave}` | done (scallops not cut in the solid) |
| Prongs: count, shape (round, claw, tab, V), height | `prongs` count | partial |
| Channel setting | `setting` (2D) | partial (no solid) |
| Cutters (seats) for every stone | cut automatically in the cast solid | done |
| Graduated stones along a row | | planned (J1) |

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
| One closed mesh for printing (ShrinkWrap) | STL export writes one merged metal solid | done; surface stepped at the default cap |
| Sprue, supports, shrinkage allowance | | planned |
| 2D blueprint with dimensions and sections | the drawing, layouts, Tech Sheet | done |
| Photoreal render, turntable | Realistic 3D view; stills | partial (no turntable or image export) |

## Working

| Rhino workflow | CADCraft | Status |
|---|---|---|
| Four viewports | Top, Front, Right, Perspective | done |
| Gumball, live editing | drag handles that change parameters | done |
| History (edit and it rebuilds) | the parametric piece | done |
| Grasshopper sliders, the Player's input panel | the Piece panel; proposals; the assistant | done |
| Generative patterns (Voronoi, lattice, Truchet, image-driven) | pattern options on the band | planned |

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-14 | minor | Shank shapes: a drawn rail, a split shank, cathedral shoulders and a twisted cable band are done; two-rail sweep, double shank/bypass and braids are rows J9–J11 |
| 2026-11-14 | new | The feature list against Rhino's jewelry workflow, and the no-code rule |
