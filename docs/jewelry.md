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
| `STLOUT` | The same solid as a binary or ASCII STL in millimetres, the metal only unless `stones` is set. |

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
girdle outline tapered to a table and to a culet or keel, not its real facet pattern. Each part is
a closed shell wound counter-clockwise from outside; shells pass through each other where they
join and no seats are cut, which a slicer unions. A reply holds at most 150,000 triangles; a
larger piece is tessellated more coarsely and `notes` says so. `STLOUT` defaults to fine quality,
binary, metal only; an ASCII STL is limited to 30,000 triangles.

`OBJECTS` (an inquiry command) lists what a space holds for the interface's Objects section: each
object's handle, kind, layer, block, first words, one telling size and its groups, capped at
5,000, and it changes nothing.

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
  views, a gizmo that flies to a view along an axis, Shaded, Wireframe, Ghosted and X-ray, labels
  for the ring's regions, the part under the pointer named, and Download STL.
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
| 2026-11-13 | minor | The piece card, the bench sheet page, the terminal dashboard and `(card)` removed with Slab |
| 2026-11-12 | minor | The piece card, the bench sheet as a page and a terminal dashboard (`cadcraft-cli run --card/--sheet`, `tui`, `(card)`): an optional build of the command-line tool, laid out by Slab without its fonts |
| 2026-11-12 | minor | `PIECE` gains five band profiles and a three-stone ring; property tests with Hegel, with six faults fixed and three set aside as gap rows J5–J7 |
| 2026-11-12 | minor | `PRICEBOOK` and a `cost` on the bench sheet, from the user's own prices; in the interface a Cost group and Price Book editor, a rendered Tech Sheet, and a gallery of templates |
| 2026-11-12 | major | A parametric piece: `PIECE` (sheet, stored parameters, checks), `PIECEMESH` and `STLOUT` (the solid), one shared definition for both; `OBJECTS`. In the interface: the Piece section, the 3D tab with display modes, the Objects section, Source, a tabbed ribbon; new drawings are millimetres |
| 2026-11-12 | minor | `RINGSIZES` measures a drawn ring (`handle`); `PAVE` and `GEMFIT` fit cuts that are not round by their own outline at their rotation (`rotate`, `ratio`); a region fill no longer ignores the edge that closes its outline (round stones could hang over it), and square cuts are no longer fitted as circles |
| 2026-11-12 | patch | Ring and Gem dialogs in the interface; the sidebar is reachable at a phone's width |
| 2026-11-12 | patch | A bench line selects what it counts (`TECHSHEET` groups carry `handles`, bands a `handle`); the sample is dimensioned and its layers recoloured |
| 2026-11-12 | minor | The interface opens on a solitaire sample (`sample::solitaire`), the sidebar has a live Bench section, the tool strip has Ring, Gem, Setting and Pavé, and the assistant is briefed on the jewelry commands. `TECHSHEET` reports bands. Three faults fixed, each with a test: a stone placed with `stone: "diamond"` got a block name (`GEM-…-DIAMOND`) that did not read back, so `SETTING` refused it and the sheet did not count it (diamond is now the default block whether named or not, and a material that begins with `D` is no longer read as a depth); a halo was laid around the origin instead of around its stone; in an inch drawing prongs, halos and pavé were placed 25.4 times too far out |
