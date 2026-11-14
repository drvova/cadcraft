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
| `PIECE` | A parametric ring (a band, a solitaire or an eternity band) drawn as a sheet from a handful of numbers, and rebuilt when one of them changes. |
| `PIECEMESH` | The same piece as closed shells of triangles, for a 3D view. |
| `STLOUT` | The metal as one closed shell with every stone's seat cut, as a binary or ASCII STL in millimetres; the stones as separate shells when `stones` is set. |

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

**Measuring a drawn ring.** Give `handle` (or `handles`) and `RINGSIZES` measures a drawn finger
hole instead of converting a size: a circle or an arc by its diameter, a closed polyline or a full
ellipse by its perimeter ÷ π (a finger size is a circumference), a `RING` insert by its finger
circle as drawn. The reply carries the usual size row at the measured diameter and `measured`:
where it came from, the diameter in millimetres whatever the drawing's units, the nearest standard
size in the `system` asked for (a quarter size in US, a half letter in UK, a whole number in EU,
JP and CN) with `offBy` in millimetres (+ over, − under), and the nearest in every system under
`nearestIn`. A circle of radius 8.35 mm measures 16.7 mm; the nearest US size is 6¼ (16.71 mm),
`offBy` −0.01. Of several concentric outlines the smallest is the finger and the largest gives
`wall`; outlines that do not share a centre are refused. A hole that is not round reports
`outOfRound`. A diameter outside 11.6–25 mm is refused, as `RING` refuses it. A blank drawn by
`RING` reads back 0.04 mm over its size: that is its sizing allowance. Measuring has no prompt at
the command line yet; it is reached from JSON, scripts, MCP and the assistant.

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

**Stones that are not round.** In a region such a stone is laid at `rotate` (degrees
counter-clockwise; 0 = its length along Y, as `GEM` draws it). With no `rotate`, a stone longer
than wide lies with its length along the long axis of the region's bounding box. The pitch along a
row is the stone's extent in that direction plus the clearance, and the rows are its extent across
plus the clearance apart; a stone is kept only when its own girdle at that rotation is `clearance
+ edge` clear of every edge. A 3 × 1.5 mm marquise (`cut: marquise, length: 3, stoneWidth: 1.5`)
in a 10 × 2 mm band with 0.15 clearance lies at 90°, pitch 3.15 along and 1.65 across, 3 stones;
with `rotate: 0` none fits. The reply's `rotate`, `pitch` and `notes` say how it was laid. Brick
rows of stones that are not round are half-offset but do not nest; round melee is laid as before
and ignores `rotate`. Along a path `rotate` is ignored: each stone follows the path.

For a cut that is not round, `GEMFIT` counts each calibrated width as a stone `ratio` times as
long (default the cut's usual: marquise and baguette 2, pear 1.5, emerald and radiant 1.4, oval
1.333), oriented by `rotate` as in `PAVE`, with the same fit. A 20 × 2.5 mm band, `cut: marquise`,
0.15 clearance: the largest is 2.2 mm wide (4.4 long), 4 stones, lying along the band. `limit`
keeps the largest N sizes.

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

### Pricing

`PRICEBOOK` stores a per-drawing price book: metal priced per gram per alloy, stones per carat per
material (with an optional `default` for materials the book does not name), and one labor figure
(`flat`, `perStone` or `perGram`). `PRICEBOOK {set:{…}}` merges prices in, `{}` or `{query:true}`
reads the book back, `{clear:true}` empties it. The book is kept as the block `JEWELRY_PRICEBOOK`
(no geometry, its description one line of JSON), so a DXF save and open carries it. There are
**no market prices in the code**: every price is one the user supplied.

When a price book is set (or prices are passed as `techsheet {price:{…}}`), the bench sheet's
reply gains a `cost`: `{currency, metal, stones, labor?, total, lines, unpriced, note}`, with
`metal = Σ grams × price per gram`, `stones = Σ carats × price per carat`, and labor per the chosen
model, rounded to the currency's minor unit. A size 6 band of 3.22 g in 18k at 50 a gram is 161.00
of metal. A material the book cannot price is listed in `lines` with its quantity and carats but
no amount, and left out of the total, never guessed. These are estimates from the user's own
prices, not market quotes. With no prices known there is no `cost` and the reply is unchanged.

## A parametric piece

`PIECE {kind: band|solitaire|eternity, …}` draws one ring per drawing as a sheet: the front view
(the finger and outside circles, as the block `RING-PIECE`, which the bench sheet reads as a
band), the section beside it, the plan under it, and for an eternity band the stones laid out on
the unrolled band. Give it again with only what changed (`PIECE {size: 7}`) and the keys are
merged over the stored piece, the old sheet is erased and the new one drawn in one undo step.
`PIECE {query: true}` reads the piece back and changes nothing; `PIECE {remove: true}` takes it
away. A request that cannot be built is refused and nothing changes. The piece is kept as the
group `JEWELRY_PIECE` (its objects, and its parameters in the description), so undo, redo and a
DXF save and open keep the geometry and the numbers together; a rebuild lands where the band is
now unless `at` is given.

The kinds are `band`, `solitaire`, `eternity` and `threestone` (a solitaire with one side stone
each side of the centre around the band: `sideWidth`, default 60 % of the centre's width,
`sideLength`, `sideCut`, `sideProngs`, default 4; side stones that cannot clear the centre are
refused with the numbers). The profiles are `flat`, `dome`, `comfort` (the dome with the finger
side eased), `court` (curved outside and inside), `knife` (two faces meeting at a ridge), `bevel`
(chamfered edges) and `concave` (the outside hollowed between two raised edges), each with one
optional number of its own (`comfort`, `ridge`, `bevel`, `hollow`). The finger's size is the
inside at its narrowest, and the `wall` check reads the band where it is thinnest and says where.

**A profile drawn in the drawing.** `PIECE {profile: {curve: "<handle>"}}` makes the band's
cross-section a closed curve of the drawing: a closed polyline (straight or with bulges), a
spline whose ends meet, a circle, a full ellipse or a one-loop region. The frame: the curve is
drawn in the XY plane with **X across the band's width** (along the finger) and **Y outward from
the finger**; where it is drawn does not matter, because its bounding box places it — the box's
lowest edge is the finger line and the box is centred across, so a stone stands on the curve's
top above the box's middle. Drawing units become millimetres through `INSUNITS`, as for every
jewelry command. The piece stores the profile **by value**: `params.profile` is `"custom"` and
`params.profileCurve` is `{curve: handle, points: [[x, y], …]}` in millimetres in that frame (the
curve flattened within a twenty-thousandth of its size, at most 400 points, rounded to the
micrometre), so the piece survives the curve being moved, edited or erased and travels through
DXF in the `JEWELRY_PIECE` group like its other parameters. Giving the same handle again (the
Piece panel's **Update from curve**) reads the curve afresh; a handle that is gone is refused and
the stored profile kept. `width` and `wall` are the box's and are **read-only** while the
profile is custom (a different number given is refused with the curve's figure: scaling a drawn
shape by two numbers would distort the jeweller's curve, so it is scaled where it was drawn); the
size still drives the inside diameter, so a size change rebuilds the band from the same profile.
Weight is Pappus on the stored polygon (area × the path of its centroid, exact for the polygon;
against the true half-disc the flattening costs under 2 × 10⁻⁴). The `wall` check reads the least
radial metal at least 0.4 mm (and at most a quarter of the width) in from either edge, since every
drawn edge tapers to nothing. The solid revolves the same polygon (thinned to 6 points per dome
segment of the quality). Refused with a sentence: an open, self-crossing or degenerate curve, one
under 0.5 × 0.3 mm or over 30 × 10 mm, a region with holes or several pieces, another kind of
object, and a profile that stands off the finger in its middle by more than half its wall.
**Not yet:** a rail (`rail: {curve}`, the band's path seen from the front, swept with the profile
kept perpendicular) is not built — the band is always the profile revolved round a circular
finger (gap row J8).

The parameters: `size` (with `system`), `wall`, `width`, `profile`, `metal`;
for a solitaire `cut`, `stone`, `stoneWidth`, `stoneLength`, `prongs` (3 to 8) and `halo` (off, or
the melee's width); for an eternity band `cut`, `stone`, `melee`, `count` (none: as many as fit)
and `gap`. `params.size` is the US number with `system: "us"`; `sizeSystem` names the system the
piece was given in and survives a round trip.

The reply carries the parameters, every object's handle, the size in every system, the band's
weight, the stone count and carats, and five checks in a jeweler's words: `wall` (at least 0.8 mm
to cast), `stone-seat`, `spacing`, `calibrated` and `size`. A failed check is information, not a
refusal. The seat thresholds (a quarter of the stone's length for a solitaire's band, 0.3 mm of
metal each side of an eternity stone) are this project's rules of thumb, not a cited standard.

One definition serves the sheet and the solid (`piece_params.rs`), and a test builds over a
thousand pieces both ways to hold them to it:

- **Dome.** A half-round (D-section): a circular arc over the full width rising to the wall; when
  the wall is more than half the width, straight sides of `wall − width/2` under a semicircle.
- **Weight.** The band alone: its section's area swept around the finger at the section's
  centroid, at the alloy's density. Prongs and the head are not weighed, and the seats cut for
  stones are not taken off. `PIECE` and `PIECEMESH` report the same `metal.grams`; `PIECEMESH`'s
  `metal.shells` is the sum of its tessellated shells, overlaps counted twice, an approximation.
- **Eternity.** The stones are the piece's `cut`, `melee` wide, tables level with the band's
  outside, girdles on a circle of radius `outer/2 − 0.28 × depth`. With no `count` the band takes
  the most that keep `gap` between neighbouring girdles: a size 6 band with a 1.8 mm wall takes 30
  stones of 1.8 mm at 0.2 mm, and at size 7, 31. `PIECE` refuses a `count` over that number;
  `PIECEMESH` still builds it, reports `fits` and says so in `notes`.
- **Solitaire.** The centre stone's culet stands 0.5 mm over the band. The prong wire is 15 % of
  the stone's lesser dimension, between 0.8 and 1.2 mm; prongs stand centred on the girdle where
  `SETTING` puts them and reach 1.15 wire diameters over it.
- **Halo.** Round diamonds of the `halo` width on the girdle offset by half the prong wire + `gap`
  + half a melee, as many as keep `gap` between every pair (19 of 1.3 mm around a 6.5 mm round).
- **Stone proportions.** Depth is the cut's usual proportion of its width, split crown 26 %,
  girdle 4 %, pavilion 70 %; the table is the fraction `GEM` draws.

**The solid.** `PIECEMESH` and `STLOUT` take the piece's parameters directly and change nothing in
the drawing. The finger's axis is Z, the ring lies in the XY plane about the origin and the head
is at +Y. The band is its section revolved; a round stone is a brilliant; every other cut is its
girdle outline tapered to a table and to a culet or keel, not its real facet pattern. For the 3D
view (`PIECEMESH`) each part is a closed shell wound counter-clockwise from outside; those shells
pass through each other where they join. A reply holds at most 150,000 triangles; a larger piece
is tessellated more coarsely and `notes` says so.

**For the caster (`STLOUT`).** The metal is written as **one** closed, manifold, outward-facing,
non-self-intersecting shell with a seat cut for every stone (decision: `docs/adr/0002-mesh-booleans.md`).
Each part is an analytic signed-distance bound; the metal is `max(min(adds), −min(cuts))`, sampled
on a sparse grid and extracted by marching tetrahedra, so the shell is closed and manifold by
construction and is checked edge by edge before it is written (a broken one is refused, never
written). Shells smaller than 0.1 % of the volume (a grid node of metal left between two seats) are
dropped. `stones: true` appends the stones as shells of their own.

- *Seats.* A prong head gets its stone's own room cut into the prongs and gallery rail — the
  bearing notch at girdle height — and a clearance hole under the culet (30 % of the girdle's
  inradius, reaching 0.25 mm past the culet's clearance). Halo and eternity melee get a cone seat
  from their own pavilion, a girdle-sized bore to set them through, and a through-hole of half the
  stone's diameter; a half eternity's stones and pavé stones get the same (the pavé's hole runs
  along the surface's normal). A bezel's stone gets its own room cut from the collar's ledge and
  anything under it. A seat is the concave hull of the stone's own vertices (at the shown and the
  finest tessellation) grown by a 0.05 mm clearance, so the stone never touches the metal. These
  figures are this project's approximation of usual bench practice, not a cited standard.
- *Resolution.* Fine quality samples at 0.1 mm, draft at 0.2 mm. A file holds at most
  `maxTriangles` (default 150,000, what the interface downloads; up to 1,000,000); a piece that
  needs more is sampled more coarsely and `step` and `notes` say so. At the default cap a usual
  piece comes out at about 0.18–0.25 mm, which leaves small beads and seat edges visibly stepped;
  ask for `maxTriangles: 1000000` (about 25–30 MB) for the 0.1 mm solid. Times on this machine
  (release, native): 0.3–0.5 s at the default cap, 1.0–1.7 s at 0.1 mm for a solitaire, halo,
  three-stone or eternity.
- *Weight.* The reply's `metal.grams` is the merged solid's (band, head, beads, less the seats):
  the metal that is cast. `metal.band` is the band alone, exactly, which is what `PIECE` and the
  bench sheet keep reporting, since it does not depend on sampling. On a plain band the two agree
  within 0.1 × the step in mm (1 % at 0.1 mm, 2 % at 0.2 mm; measured 0.1–0.3 % and up to 1.3 %),
  the solid slightly light because a sampled surface cuts convex corners; a band outside that says so.
- *Not one body.* When stones crowd each other (a seat cuts a neighbour's prong through), the solid
  is in more than one piece; `bodies` counts them and `notes` says so.
- An ASCII STL is limited to 30,000 triangles.

### Pavé on the band

`PIECE {pave: …}` lays melee on the band's outside, as a bench's pavé plug-ins do, on a plain band,
a solitaire or a three-stone ring (an eternity band's stones are its own row; it ignores `pave`
and says so). `pave: true` is one row of 1.3 mm on the shoulders at 0.2 mm; an object takes:

| Key | Values | Default |
|---|---|---|
| `layout` | `row` (one row in the middle of the width), `rows` (rows side by side, every row's stones at the same angles), `honeycomb` (every other row offset half a stone, the rows closed up), `scallop` (one row, each stone in a scallop cut into the band's side) | `row` |
| `rows` | 1–3 (`rows` and `honeycomb`; `row` and `scallop` are one row) | 2 |
| `melee` | mm 0.8–3, round diamonds | 1.3 |
| `gap` | mm 0–2, the least metal between two stones | 0.2 |
| `span` | `shoulders` (60° each side of 12 o'clock), `top-half` (90°), `full` (all round) | `shoulders` |
| `from`, `to` | degrees clockwise from 12 o'clock, −360–360, `to` more than `from` and at most 360° beyond it; giving them drops `span` | 0, 60 |
| `symmetric` | mirror `from`–`to` the other side of 12 o'clock | true |
| `graduated` | `{from: mm, to: mm}`: sizes from the end nearest 12 o'clock (an asymmetric span: from `from`) to the far end, linear, rounded to the calibrated 0.1 mm | none |

A `pave` object merges over the stored one key by key (`PIECE {pave: {gap: 0.3}}` changes the gap
alone); `false` takes the pavé away. The reply's `stones.pave` gives the count, carats, layout,
rows, the actual least gap, the least rim, the angle the pavé starts at beside a head, the arcs
fitted and the stones by size; `stones.count` and `stones.carat` include them.

**Where a stone sits.** On the outside's surface for every profile: at angle θ and arc length `u`
across the section from the middle (the width point `x(u)` that arc length reaches), the surface
point is `(rᵢ + h(x))·(sin θ, cos θ) + x·Z` and its normal leans by the section's slope `h′(x)`.
The table lies on the surface square to that normal, the girdle 0.28 of the depth under it — the
seat the eternity row uses, tilted with the surface. On a dome the outer rows lean out; on a
concave band the row sits in the hollow.

**Auto-fit.** A span is filled from the end nearest 12 o'clock: the first girdle at the span's end
(or, through 12 o'clock with no head, one stone centred at 12), each next stone at the least angle
that keeps `gap` in every row (the metal between girdles measured edge to edge, bisected), until
the next would leave the span; the angle left over is shared equally between the gaps, so the
stones fill the span and the actual gap is at least the asked one. All round a plain band it takes
the most `n` that keep the gap and stands them 360°/n apart. Numbers: a size 6 band 3 × 1.8 mm
takes 36 stones of 1.5 mm at 0.2 mm all round (0.21 mm actual); a 2.6 × 2 mm solitaire's shoulders
take 10 of 1.3 mm, 5 a side, with 0.5 mm between them (the residual of the 60° span shared out);
a 6.5 mm comfort band takes 68 of 1.2 mm in a three-row honeycomb over the top half at 0.15 mm.

**The `pave` check** (only when pavé is asked for): every girdle at least 0.3 mm (`PAVE_RIM`) from
the band's edge, measured across the outside's surface; the least gap kept; at least one stone in
the span; no culet through to the finger; the cap of 400 stones (`MAX_PIECE_STONES`). A band too
narrow fails in words: "The band is too narrow for 1.5 mm pavé: a stone needs 2.1 mm across the
band's outside (0.3 mm of rim each side); this band's outside is 1.6 mm across."

**Beside a head.** A solitaire's or a three-stone ring's pavé starts at the least angle at which a
stone at the crown, seen along the finger, clears the head's outline (stone, prongs and their feet)
by half the prong wire and the larger of `gap` and 0.2 mm; a three-stone ring's starts beyond its
side stones.

**Downstream.** The sheet draws each stone's side profile in the front view (with the scallops
under a scalloped row), one stone per row in the section, the visible stones foreshortened in the
plan, and the outside unrolled under the plan with every stone a `GEM` insert — the stones the
bench sheet counts and groups by size. `PIECEMESH` builds each as a round brilliant on its frame
and bead prongs between neighbours, the eternity row's beads (the halo has a seat plate, not
beads). `propose` reads a pavé change (each `pave` key a line, and the pavé count). In the
interface the Piece section has a Pavé group: the tick, layout, rows, stone size, gap and span.

**Approximations.** The metal between two stones is measured between the girdles' nearest points
along the line joining their centres, projected into each girdle's plane: exact for one row on a
level band (it is the eternity formula), an approximation of the least distance between two
tilted girdle circles. The rim is arc length across the outside to the edge. The head's clearance
is judged in the ring's plane at the crown. `STLOUT`'s merged solid cuts each pavé stone's seat
(a cone seat, a bore to the surface and a hole along the normal) and unions the beads; it does not
cut the scallops yet.

`OBJECTS` (an inquiry command) lists what a space holds for the interface's Objects section: each
object's handle, kind, layer, block, first words, one telling size and its groups, capped at
5,000, and it changes nothing.

### Bezel heads, half eternity, dome rings and signets

The parametric piece covers the ring typology a jewelry course teaches: band, dome, signet,
solitaire, bezel, eternity, half eternity, three-stone. The numbers live in
`crates/engine/src/cmd/jewelry/heads.rs` and `kinds.rs`; the sheet and the solid read them.

- **Bezel** — `head: "prong" | "bezel"` (default prong) on a solitaire or a three-stone ring (all
  three stones). The collar follows the girdle outline of any cut. In section it is the wall
  (`bezelWall`, default 0.6 mm, 0.2–2) from under the band's outside up to `bezelHeight` over the
  top of the girdle (default 12 % of the stone's lesser size, 0.4–1 mm, never over 70 % of the
  crown), and a seat ledge inside the girdle (6 % of the lesser size, 0.2–0.5 mm) the stone rests
  on; below the ledge the collar is open. Checks `bezel-wall` (at least 0.4 mm) and `bezel-lip`
  (at least 0.3 mm over the girdle and short of the table). The collar's weight is reported apart
  as `metal.bezelGrams`: `P·A + 2π·M` (perimeter, section area and its first moment) — exact for
  convex girdles, approximate in a heart's cleft. These are our approximations of bench practice.
- **Half eternity** — `kind: "halfeternity"` (a kind rather than an eternity option, because the
  gallery, the Piece panel's kind list and a proposal switch one key, and it carries its own
  `resize` check): the eternity row packed at the least pitch that keeps `gap`, centred on 12
  o'clock, as many as keep every centre within 90° of it unless `count` asks for fewer; the bottom
  is plain. `resize` passes with at least 10 mm of plain shank.
- **Dome ring** — `kind: "dome"` (profile default dome) with `topWidth`/`topWall` (defaults 3.5 ×
  width and 1.8 × wall); `width`/`wall` are the bottom, where the ring is sized. The bottom section
  is scaled by `f(θ) = ((1 + cos θ)/2)²` round the ring; the weight is the exact swept volume (a
  kind, not a `taper` on band, because the signet shares the shank and a kind is one key to switch).
  `wall` judges the thinnest point.
- **Signet** — `kind: "signet"`: a tapered shank (top `topWidth`, default 60 % of the face length)
  under a flat plate, `face: oval | round | cushion | rectangle` (default oval), `faceLength` along
  the finger (12) by `faceWidth` around (10), its top `topWall` over the finger (default wall +
  1.2, at least 2.6), its underside 0.3 mm over the finger. Grams: the shank exactly plus the plate
  outside it (column integration over the face). Check `face`: at least 1.2 mm thick (a 0.4 mm
  engraving over a 0.8 mm cast wall). A flush-set stone in the face (signet cocktail) is not built yet.

`PIECEMESH` shows a closed shell per part (`bezel`, `face`, the tapered `band`); `STLOUT`'s merged
solid takes each part's signed-distance bound (`BezelBound::distance`, `Taper::distance_by`,
`Face::distance`), so a bezel, a dome's or a signet's shank and a signet's face cast as one body
with the rest.

## In the interface

The interface opens on a jewelry drawing: a size 6 solitaire in 18k gold (Help ▸ Open Sample
Drawing brings it back; Help ▸ Open Sample Bracket opens the mechanical sample). It is built by the
commands on this page, so its bench sheet reads back: 32 stones, 1.35 ct, a 3.86 g band.

- **The Bench section of the sidebar** is the bench sheet, live: every stone by cut and size with
  its count and carats, every band `RING` drew with its size, alloy and grams, and the totals in
  the heading. The engine counts it again when the drawing changes. A press on a line selects
  what it counts on the drawing (every 1.3 mm round, the band) and a second press lets it go;
  the line whose objects are all selected is marked. A stone off the calibrated melee list says
  so in the hint on its row. Window ▸ Bench Sheet shows and hides it.
- **The tool strip** has the four drawing commands after the drafting tools: Ring, Gem, Setting,
  Pavé. Draw ▸ holds the same four.
- **Ring and Gem open a dialog** from the tool strip, the Draw menu and the palette (typed at the
  command line they still ask their prompts). Ring takes a size in any system, the wall, the
  width, the alloy and a position, and shows the size in every system as it is typed. Gem takes a
  cut, its size (a diameter, or a length and a width for an elongated cut), the stone and a
  position, and shows the engine's worked example for the cut. OK runs the command; a refusal
  stays in the dialog beside the field it names. The weight is not shown before OK (the engine
  weighs only what it draws); it is read on the Bench section afterwards.
- **Cost.** With prices set, the Bench section shows a Cost group: metal, stones, any labor, the
  total, and any unpriced lines flagged. "Set prices to estimate cost" opens a Price Book editor
  whose metal and stone fields are the materials actually in the piece.
- **Tech Sheet** (the ribbon's tool, or Window ▸ Tech Sheet) is a page to print: the piece
  rendered from the top, the front, the side and in perspective, its sizes, the metal, the stones
  and the checks, on one printed page. Typed at the command line, `TECHSHEET` draws its table.
- **Templates** (the Piece section's empty state, or Window ▸ Templates…) is a gallery of rings
  to start from, each a named set of the piece's parameters with a rendered thumbnail.
- **The Piece section** of the sidebar starts a band, a solitaire or an eternity band and edits
  its numbers in place; each edit rebuilds the sheet, and the engine's weight, stones and checks
  are under the numbers. A refusal marks the row it names.
- **The 3D tab** over the drawing shows the piece as a solid: orbit, pan and zoom, the standard
  views, a gizmo that flies to a view along an axis, Realistic (the default), Shaded, Wireframe,
  Ghosted and X-ray, labels for the ring's regions, the part under the pointer named, and
  Download STL. The stills (the Templates thumbnails, the Tech Sheet's views, the proposal
  cards' before and after) are drawn the same way, Realistic unless the Tech Sheet is told
  otherwise.
- **Four views** (`apps/ui/src/fourview.ts`, tested): on a wide stage the 3D tab opens tiled
  2×2, Top, Perspective, Front and Right, each named in its corner. Top looks down on the head
  (−Y), Front along the finger (−Z, the ring seen round), Right down −X (the ring edge-on). The
  three orthographic panes are flat-shaded with their feature edges in one ink and the ground's
  grid, not Realistic: a size is read off a sharp silhouette, and the studio's highlights move
  and blur the edges. They are fitted at one shared scale (a millimetre is as long in all three);
  after that each is panned (any drag, or the arrows) and zoomed (the wheel, a pinch, + and −)
  on its own, and F fits all four again. Perspective keeps the display mode. A double-click on a
  pane, M, or the bar's Maximise fills the stage with it and restores the four; the bar's
  "4 views" toggles the single Perspective view, which is the default under 560 px (a phone).
  The layout is remembered by the browser. All four are drawn on one WebGL context, each
  scissored to its rectangle of a store kept between frames, so only the pane whose eye or
  piece changed is drawn again: turning the Perspective pane draws that pane alone.
- **Handles on the piece** (`apps/ui/src/handles.ts`, tested) stand where the parameter shows:
  the centre stone's girdle (`stoneWidth`, the length keeping its proportion), the halo's outer
  melee (`halo`), an eternity's stone at twelve o'clock (`melee`), the band's outside on the right
  (`wall`; the inside is the finger's size and does not move) and the band's edge on the left
  (`width`). A handle is offered on every pane where its direction is not foreshortened toward the
  eye. Dragging follows the pointer along that direction, snapped (0.05 mm for wall and width,
  0.1 mm for melee, the stock centre sizes: tenths under 3 mm, quarters to 10 mm, halves above;
  Shift for hundredths) and held to the ranges `piece` takes; the piece is previewed at draft
  quality (`piecemesh`, at most one in 50 ms) and the number, its unit and what it was stand by
  the pointer, with the checks it would break (`propose`, read and dropped at once, after 220 ms
  at rest) or the engine's refusal. The release makes one `piece` change (one undo step); with Alt
  held it is a proposal, which the assistant shows as a card. To the keyboard each handle is a
  slider with a name: the arrows nudge it a stop, Enter commits (Alt+Enter proposes), Escape or
  leaving it puts it back. A refused value is said in a short line and nothing changes.
- **Realistic** shows the piece as jewelry (`apps/ui/src/materials.ts` holds its numbers, tested;
  the shaders are in `render3d.ts`). It is an honest approximation drawn in WebGL 1, not a ray
  tracer:
  - *Metal* is physically based: the GGX/Cook-Torrance response in its image-based split-sum
    form (Karis's analytic fit stands in for the lookup table), with Fresnel-Schlick from each
    alloy's own reflectance at normal incidence (18k and the other golds, platinum, palladium,
    silver, steel, titanium, brass, copper; wax is a dull dielectric). The values are the
    project's own rounded approximations of commonly quoted optical constants. The engine has no
    rose gold. The renderer knows the metal and the stone only by the colour the engine gives
    the part, matched against the engine's palette.
  - *Warm gold*: a polished metal mostly shows what it mirrors, and through a grey sweep and a
    per-channel tone curve gold read pale and khaki (its lit areas paled to cream, its mid-tones to
    an olive brown). Two display-only corrections fix it. Metal is tone-mapped by its brightest
    channel with the others scaled alongside (`toneKeepHue`; an eighth of the per-channel curve is
    mixed back so the hottest glints still go white), so a highlight stays gold. And where a
    coloured alloy mirrors the dim sweep rather than a box it shows its deeper tint (`deepTint`:
    the reflectance raised to a power that grows with the alloy's saturation, as gold's shadows
    are lit by the gold and by warm cards in a jeweller's tent). The white metals, whose
    reflectance is nearly grey, are left as they were; the stones keep the per-channel curve.
  - *The studio* that lights it is drawn by formula, not loaded: six soft rectangular boxes
    (overhead, a key strip high on the left, a narrow fill on the right, a low kicker behind and
    tall strips behind on either side), a set of *concentric gradient rings* round the lens, and
    a sweep that is bright at the horizon and dark at the floor, with a small spot round the eye's
    own direction held dark (the lens a polished piece mirrors). It hangs in the eye's frame, so
    what a face shows depends only on how it is turned to the camera, and the bands slide across
    the faces as the piece turns. A flat face mirrors only a patch some 10–15° across (the spread
    of the view over it), so in front of the piece the rings stand one every 22°, strong and faint
    in turn: whatever way a flat face is turned — front, top, side, anywhere through an orbit — its
    patch holds part of a ring and part of a gap, and it carries a soft band beside a dark one.
    Behind the piece two broad soft rings take over, so a band seen edge on (the side view, whose
    outside sweeps every angle) shows a few calm bands rather than a ladder of stripes. Below the
    lens the rings show only where a card stands on the table, low left and low right, so straight
    down stays dark. The light of the boxes and rings is eased toward a ceiling
    (`LIGHT_PEAK`, `peak · (1 − e^(−L/peak))`), so silver and platinum no longer burn to paper white
    in a band, and a strip mirrors a coloured alloy a shade deeper (`STRIP_DEEP`), so gold's lit
    band stays yellow rather than cream. Instead of a prefiltered environment map, a rough surface
    sees each box and ring with a wider, dimmer edge (analytic, so there is nothing to prefilter
    and no float texture is needed).
  - *Stones* are the engine's faceted cuts (a round brilliant has table, star, kite, upper and
    lower girdle, pavilion and culet facets), each facet shaded flat: what it mirrors by the
    stone's own Fresnel (diamond 2.42, coloured stones their own index), over a fake of the light
    returned from inside: the facet's tilt from the line of sight, multiplied and scattered,
    picks a direction in the studio's boxes and a lattice of small lamps, tinted by the body
    colour raised to a power (`BODY_POWER`, light that comes back out has crossed the stone more
    than once), so a sapphire's or ruby's pavilion is a deep, saturated blue or red while a
    diamond stays white. A stone mirrors the rings at a sixth of their strength (`STONE_RINGS`),
    so their lines do not wash its crown pale. Red, green and blue each take their own index (the dispersion, widened so it shows
    on screen), which is the fire. There is no refraction through the stone and no light path
    is traced: a facet shows one value, so a large table cannot show the pavilion's arrows.
    Opaque stones (opal, pearl, onyx, turquoise, lapis, jade, moonstone, coral) are polished
    bodies of their colour.
  - *Grounding*: a seamless backdrop over the canvas colour (`--canvas`, dark in both interface
    themes on purpose: the drawing area keeps its own colours whichever theme the chrome takes, see
    `apps/ui/docs/system/colors.md`, so the metals are tuned against one dark stage), a soft contact shadow under
    the piece (a quad on its lowest plane, two soft falloffs; no shadow map and no ambient
    occlusion on the piece itself), ACES tone mapping (hue-keeping for metal) and gamma. The ground grid is not drawn in
    Realistic; the other modes keep it.
  - *Anti-aliasing*: the stage asks for MSAA; stills are drawn at twice their size (held to the
    still ceiling) and scaled down. With `OES_standard_derivatives` the metal's roughness grows
    where its normal turns fast across a pixel, so a tight curve does not shimmer.
  - *Fallbacks*: without the derivatives extension the program is built without that term;
    where the realistic programs cannot be built at all, a Realistic pass is drawn Shaded; where
    WebGL is missing the stage and the stills say so in words, as before.
- **The Objects section** lists the piece and its parts, the stones by cut and size, the bands
  and everything else by layer and kind, with a search; a press on a row selects it on the
  drawing and a selection on the drawing marks its row.
- **Source** (Ctrl+U) shows the drawing as its script beside the drawing and applies an edit. The
  script rebuilds lines, polylines, circles, arcs, points, text and layers; blocks (rings and
  stones among them), dimensions and hatches are comments in it and are left as they are.
- **The ribbon** has a Jewelry tab: Ring, Gem, Setting, Pavé; Ring Sizes, Gem Fit; Tech Sheet and
  the Bench section.
- **A new drawing is millimetres.**
- **On a phone** the sidebar, with the Bench section, takes the workspace when its title-bar key
  is on, and starts closed.
- **The assistant** is told these commands and the trade's units at the start of every turn, and
  its first suggestions are a jeweler's sentences. Ctrl+K asks it from the drawing
  ([assistant.md](assistant.md#open-it)).

`TECHSHEET` replies with the bands as well as the stones (`bands: [{block, handle, size, mm,
metal, grams, width, wall}]`), its message carries a line for each, and each stone group carries
the `handles` of its stones (the first 5,000).

The sample is drawn to be read: gold for the metal, pale blue for the stones, greys for
dimensions and notes, with the finger, the section, the stone and the strip dimensioned at 1 mm
text.

## Property tests

Besides the worked examples, the jewelry commands are tested by properties
(`crates/engine/src/cmd/jewelry/property_tests.rs`, with [Hegel](https://hegel.dev), a
dev-dependency only): a rule is stated once and tried on hundreds of generated inputs, and a
failure is shrunk to its smallest case. The rules cover ring sizes in every system, every cut's
outline and weight, block names, pavé fit and its cap, settings around a stone wherever it sits,
the bench sheet's counts, a piece's parameters, the sheet against the solid, a piece followed
through any sequence of edits, undo and saves, and hostile input to every command.

What they found and what was fixed: two stones a hundredth of a millimetre apart shared one
block, so placing the second redrew the first; a second ring blank of the same size and width
redefined the first one's wall, metal and weight; a cabochon's ellipse was drawn on the wrong
axis; a cushion's corners were scooped in instead of rounded out; the bench sheet weighed a
shallow stone at the weight of a deeper one of the same size; UK Z½ was not reached.

What they found and is not fixed (each a test set aside with its reason, and a row in
[gaps.md](gaps.md)): on a heart, a bezel's wall, a halo's stones and a channel's rails come too
near the girdle at the cleft; around a sharp tip two halo stones can overlap slightly; and
outside a system's own chart a finger is named by that chart's last size instead of none.

## Where the numbers come from

The formulas are the trade's published ones, and the tests check them against known stones: a
6.5 mm round brilliant is 1.03 ct, a 7×5 emerald 1.13 ct, an 8×4 marquise 0.45 ct, an 8×5 pear
0.74 ct, a 5×5 princess 0.70 ct; US 6 is 16.51 mm inside and UK L, EU 52, JP 12, CN 12; a 6 mm
band takes 3 mm melee; a size 6 band of 1.8 × 2.0 mm cross-section in 18k gold weighs 3.2 g. See
`crates/engine/src/cmd/jewelry/tests.rs`.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-14 | minor | `STLOUT`'s merged solid takes the drawn profile, the bezel collar with its stone's seat, the dome's and signet's tapered shank, the signet's face, and seats and beads for half eternity and pavé stones |
| 2026-11-13 | minor | The 3D tab's four-view workspace (Top, Front, Right orthographic and flat-shaded at one scale; Perspective in its mode; maximise by double-click, M or the bar; remembered; single view under 560 px) on one scissored context, and drag handles on the piece (centre stone, halo melee, eternity stones, wall, width) that preview at draft quality, show the value and the checks it would break, and commit one `piece` change or, with Alt, a proposal; keyboard sliders |
| 2026-11-13 | minor | `PIECE {profile: {curve: handle}}`: a band profile drawn as a closed curve of the drawing (polyline with bulges, spline, circle, ellipse, region), kept by value with its frame (box bottom on the finger, centred across), width and wall read from it, weight by Pappus, the wall check at its thinnest, the solid revolved from it; the Piece panel names it "Custom (from drawing)" with Update from curve. Rails are not built yet (J8) |
| 2026-11-13 | minor | Pavé on the band: `PIECE {pave}` (row, rows, honeycomb, scallop; 1–3 rows; a named span or angles, mirrored; graduated sizes) placed on the outside of every profile with tables square to the surface, auto-fitted to the span with the residual shared, clear of the head and the rim; a `pave` check; the sheet, the bench sheet, `PIECEMESH`, `propose` and the Piece section's Pavé group read it |
| 2026-11-13 | minor | `PIECE`: a bezel head (`head`, `bezelWall`, `bezelHeight`, checks `bezel-wall`/`bezel-lip`, `metal.bezelGrams`) and three kinds — `halfeternity` (`resize` check), `dome` (`topWidth`, `topWall`, tapered weight) and `signet` (`face`, `faceLength`, `faceWidth`, `face` check); solids, proposals, templates and the Piece panel |
| 2026-11-13 | patch | Realistic studio: concentric gradient rings round the lens replace the front strips and low cards, so flat faces carry a band from the front, top, side and through an orbit and the side view is calm; the lights are eased toward a ceiling and strips mirror coloured alloys a shade deeper (gold18 lit-pixel median saturation 0.53 → 0.59, silver near-white pixels 19% → 0%); coloured stones return a deeper body colour and mirror the rings dimmed; the derivatives variant of the shader compiles again; the stage stays dark in the light theme by design |
| 2026-11-13 | minor | `STLOUT` writes the metal as one closed, manifold shell (implicit CSG, marching tetrahedra) with stone seats cut: prong bearings and culet holes, cone seats with bores and through-holes for halo and eternity melee; reports the cast weight beside the band's; `maxTriangles`, `step`, `seats`, `bodies` |
| 2026-11-13 | patch | Realistic studio: gradient strips round the lens, tall side strips and low cards, a smaller dark lens spot, so broad polished faces carry a bright highlight band beside a dark one instead of reading as flat bronze |
| 2026-11-13 | patch | Realistic gold reads warm: metal keeps its hue through the tone curve, and a coloured alloy's dim reflections take its deeper tint; platinum, silver and the stones unchanged |
| 2026-11-13 | minor | A Realistic display mode, the 3D tab's default and the stills': physically based metal under a procedural studio, faceted stones with Fresnel, a faked internal return and fire, a backdrop and a contact shadow, tone mapping, supersampled stills |
| 2026-11-13 | minor | The piece card, the bench sheet page, the terminal dashboard and `(card)` removed with Slab |
| 2026-11-12 | minor | The piece card, the bench sheet as a page and a terminal dashboard (`cadcraft-cli run --card/--sheet`, `tui`, `(card)`): an optional build of the command-line tool, laid out by Slab without its fonts |
| 2026-11-12 | minor | `PIECE` gains five band profiles and a three-stone ring; property tests with Hegel, with six faults fixed and three set aside as gap rows J5–J7 |
| 2026-11-12 | minor | `PRICEBOOK` and a `cost` on the bench sheet, from the user's own prices; in the interface a Cost group and Price Book editor, a rendered Tech Sheet, and a gallery of templates |
| 2026-11-12 | major | A parametric piece: `PIECE` (sheet, stored parameters, checks), `PIECEMESH` and `STLOUT` (the solid), one shared definition for both; `OBJECTS`. In the interface: the Piece section, the 3D tab with display modes, the Objects section, Source, a tabbed ribbon; new drawings are millimetres |
| 2026-11-12 | minor | `RINGSIZES` measures a drawn ring (`handle`); `PAVE` and `GEMFIT` fit cuts that are not round by their own outline at their rotation (`rotate`, `ratio`); a region fill no longer ignores the edge that closes its outline (round stones could hang over it), and square cuts are no longer fitted as circles |
| 2026-11-12 | patch | Ring and Gem dialogs in the interface; the sidebar is reachable at a phone's width |
| 2026-11-12 | patch | A bench line selects what it counts (`TECHSHEET` groups carry `handles`, bands a `handle`); the sample is dimensioned and its layers recoloured |
| 2026-11-12 | minor | The interface opens on a solitaire sample (`sample::solitaire`), the sidebar has a live Bench section, the tool strip has Ring, Gem, Setting and Pavé, and the assistant is briefed on the jewelry commands. `TECHSHEET` reports bands. Three faults fixed, each with a test: a stone placed with `stone: "diamond"` got a block name (`GEM-…-DIAMOND`) that did not read back, so `SETTING` refused it and the sheet did not count it (diamond is now the default block whether named or not, and a material that begins with `D` is no longer read as a depth); a halo was laid around the origin instead of around its stone; in an inch drawing prongs, halos and pavé were placed 25.4 times too far out |
