# Jewelry

CADCraft drafts fine jewelry with the trade's own numbers: ring sizes in every system, gemstone
outlines built on each cut's real girdle, calibrated melee placed with the fit checked, settings
built on the stone they hold, and a bench sheet that counts the stones and weighs the metal. The
commands are ordinary CADCraft commands — they reach the command line, the menus, scripts, the CLI,
the control channel and the MCP server (`execute`, or the `bench_sheet` tool), and every one of
them reports what it did as JSON and as a plain-language line.

Everything is in **millimetres** and converts through `INSUNITS`: a size 6 finger is the same
finger in a metric drawing and in an inch one. A **new drawing is inches** (AutoCAD's own template);
set `INSUNITS` to 4 for millimetres, or to 0 for a unitless drawing, which jewelry reads as
millimetres.

## Commands

| Command | What it does |
|---|---|
| `RINGSIZES` | One finger size in every system (US/Canada, UK/Australia, ISO/Europe, Japan, China), or a range of them. |
| `RING` | The ring a size and a wall make: the finger circle, the outside circle, and the side view of the band, with the metal's weight. |
| `GEM` | A stone's girdle as CAD geometry, with its carat weight, inserted as one block per cut and size. |
| `GEMLIST` | The cuts with their weight factors and depth proportions, and the stones with their specific gravities. |
| `PAVE` | Melee laid along a path or through a region in the trade's patterns, with the fit checked. |
| `GEMFIT` | For each calibrated melee size, how many stones a region takes — and the largest that fits at all. |
| `SETTING` | Prongs at the stone's tips and shoulders, a bezel wall around its girdle, a halo of melee, or channel rails. |
| `TECHSHEET` | The bench sheet: stones by cut and size with carats, and the metal in grams. |

`DESCRIBE` reads any drawing that holds jewelry the same way, and the MCP `bench_sheet` tool does
it for an agent in one call.

## Ring sizes

A finger size is a circumference; every system names it differently. All of them come from one
place — the US formula — so a size converts exactly and round-trips:

| System | Definition |
|---|---|
| US / Canada | inside diameter = 0.8128 × size + 11.63 mm; halves and quarters between (`6`, `6½`, `6¼`) |
| UK / Australia | letters, A = US 0½ and each letter half a US size (A 12.04, L 16.51, M 16.92, Z 22.20 mm) |
| ISO 8653 / Europe | the inside circumference in whole millimetres (US 6 = 52) |
| Japan | 13 mm at size 1, a third of a millimetre per size (US 6 = 12) |
| China | the inside circumference less forty (US 6 = 12) |

The trade's range is 000 (11.6 mm) to 16 (24.6 mm); outside it a size is refused, never clamped.
`RING` draws the blank a size and a wall make, with a sizing allowance (`gap`, 0.02 mm) cut from
the inside, and reports the weight of the annulus in the alloy named (`metal`, default 18k yellow
gold). The block's description carries the size in every system and the metal, so a drawing
describes itself.

## Gemstones

Each cut is drawn from its own construction, not as a circle: a round brilliant is a circle, a
marquise is two arcs meeting at the tips, a pear is a circle with tangents to a point, a heart is
two tangent circles with a point, an emerald is a rectangle with cut corners, a cushion is a
rectangle with arc corners, a trillion is a triangle. Bulges carry the arcs, so the geometry is
exact and editable. The length runs along +y and the width across x on every cut.

The weight is the trade's own formula, `L × W × depth × SG × factor`, with the published constant
per cut divided by diamond's specific gravity (a round brilliant's 0.0061, an emerald's 0.0092,
a marquise's 0.00565), so the same formula works for any material:

| Stone | 6.5 mm round, 4.0 mm deep |
|---|---|
| Diamond (SG 3.52) | 1.03 ct |
| Sapphire (SG 4.00) | 1.17 ct |
| Cubic zirconia (SG 5.70) | 1.67 ct |

Depth defaults to the cut's usual proportion of its width (a round's 0.615, an emerald's 0.65),
and `depth` overrides it. `stone` names the material (`diamond`, `sapphire`, `ruby`, `emerald`,
`cz`, `moissanite`, `opal`, … 27 of them) or `sg` gives the specific gravity directly.

**A stone is a block**, `GEM-<CUT>-<SIZE>` plus the material and any unusual depth when they are
not the default: `GEM-ROUND-1.3`, `GEM-OVAL-8x6-SAPPHIRE`, `GEM-OVAL-8x6-SG4.2-D4.1`. Two stones
share a block exactly when they are interchangeable, which is what makes a drawing countable and
replaceable — change the block and every stone of that cut, size and material follows. The block's
description carries the same numbers as text (`gem: cut=round, mm=1.3, depth=0.8, sg=3.52,
ct=0.0086`) for a bench sheet to read back.

## Pavé and fit

`PAVE` places calibrated melee — 0.8 to 3.0 mm in 0.1 steps — along a path or through a region:

- **Along a path** (`along`): a row, two rows (`double`), up to four (`rows`), or an exact `count`
  evenly spaced. Each stone is rotated to the path's tangent, so fancy cuts follow the run.
- **Through a region** (`handles`, a closed polyline, circle or ellipse; several loops read as one
  region with holes, so a ring's hole is not filled): `grid`, `brick` (half-offset rows, the usual
  pavé) or `trench`.

A stone is placed only when its whole body fits: `clearance` (0.15 mm default) from its neighbours
and from the edge, plus any `edge` inset. What could not be placed is reported (`skipped.edge`,
`skipped.outside`), and so is the largest calibrated size the region would have taken
(`largestFitting`). A size off the calibrated list is allowed and flagged (`calibrated: false`),
because a bench buys calibrated melee and a designer should know when they have left it.

`GEMFIT` answers the question before anything is placed: for every calibrated size, how many
stones fit and what they weigh, plus the largest that fits at all. A 6 mm wide band takes 3.0 mm
melee; a 2.5 mm band takes 2.2 mm.

## Settings

`SETTING` builds the metal on the stone's own girdle:

- **`prong`** — the prongs go where the stone needs holding: its sharp corners first (a marquise's
  two tips, an emerald's four corners), then the points furthest from those along the girdle (a
  marquise's two shoulders). A girdle with no corners (a round, an oval) is divided evenly by arc
  length, so a round's six claws come out 60° apart. `prongs` sets the count, `diameter` the prong
  (0.8 mm) and `offset` pushes them outward.
- **`bezel`** — the girdle offset outward by `wall` (0.8 mm), plus a seat line on the girdle
  itself. The offset is exact on arcs and bulges, not a resampled approximation.
- **`halo`** — melee (`stoneWidth`, 1.0 mm) laid around the girdle at `gap` (0.15 mm), rotated to
  the outline, with the total carat weight reported.
- **`channel`** — two rails either side of the stones at the stone's radius plus the gap.

The target is an insert of a `GEM-…` block (a stone, wherever it sits and however it is rotated) or
any closed outline in the drawing (a ring, a hand-drawn shape).

## The bench sheet

`TECHSHEET` counts the stones by cut, size and material — from the blocks themselves, so it counts
what is really in the drawing, not what was intended — totals the carats, and weighs the metal:

```
round 1.3 mm — 22 pc, 0.181 ct total (0.008 ct each)
emerald 7×5 mm — 1 pc, 0.809 ct total (0.809 ct each)
23 stones, 0.990 ct total
18k gold 3.22 g (cross-section 3.60 mm², swept at 9.16 mm)
```

The metal comes from the band's cross-section: a closed polyline where x is the distance from the
finger's surface (outward) and y runs along the finger. Pappus's theorem gives the volume,
`V = 2π · (R + x̄) · A`, with the inside radius `R` from a ring size (`size` with `system`) or
directly in millimetres (`radius`), and the alloy's density (`metal`) gives the grams — 18k gold
15.5 g/cm³, platinum 20.7, sterling 10.4, and so on. A hand-edited description that disagrees with
a stone's name is reported as a warning instead of being silently believed.

Set `table: true` to draw the sheet as a table in the drawing at `at`, which is what goes on a job
bag with the piece.

## Where the numbers come from

The formulas are the trade's published ones, and the tests check them against known stones: a
6.5 mm round brilliant is 1.03 ct, a 7×5 emerald 1.13 ct, an 8×4 marquise 0.45 ct, an 8×5 pear
0.74 ct, a 5×5 princess 0.70 ct; US 6 is 16.51 mm inside and UK L, EU 52, JP 12, CN 12; a 6 mm
band takes 3 mm melee; a size 6 band of 1.8 × 2.0 mm cross-section in 18k gold weighs 3.2 g. See
`crates/engine/src/cmd/jewelry/tests.rs`.
