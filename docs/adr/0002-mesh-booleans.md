# ADR 0002: One solid for the caster — implicit CSG and marching tetrahedra, not a general mesh Boolean

Status: accepted, 2026-11-13.

## Context

`STLOUT` handed the caster the parametric piece as separate closed shells (band, gallery rail,
prongs, halo seat, beads) that pass through each other, with no seat cut for any stone. A caster
needs one closed, manifold, consistently oriented, non-self-intersecting shell for the metal:
band ∪ rail ∪ prongs ∪ halo ∪ beads, minus a seat for every stone. That is a union and a
difference of solids. The engine is pure Rust, must build for `wasm32-unknown-unknown`, may only
depend on permissive (MIT/Apache/BSD/zlib) crates from crates.io, and must never panic.

## Options weighed (checked on crates.io, 2026-11-13)

- **`csgrs` 0.20.1** (MIT): BSP-tree CSG on polygons. Licence fine; it pulls `nalgebra`, `geo`,
  `robust`, `hashbrown` and more. BSP CSG splits polygons against planes in floating point and
  leaves T-junctions and slivers. Its output is not guaranteed to be a closed 2-manifold, and its
  cost grows badly with the many small primitives a pavé or eternity piece has (400 stones). Rejected:
  it does not give us the property we need.
- **`boolmesh` 0.2.2**: "robust mesh boolean in pure Rust", but **MPL-2.0**, which is not on our
  permitted list. Rejected on licence; its sources were not read.
- **`manifold3d` 0.4.2** (Apache-2.0 OR MIT): bindings to the C++ Manifold library. Not pure Rust,
  does not build for `wasm32-unknown-unknown` without a C++ toolchain. Rejected.
- **Writing a general exact-predicate mesh Boolean** (Shewchuk-style orientation tests,
  intersection curves, retriangulation, inside/outside classification): the right tool for
  arbitrary meshes, but weeks of work to make robust on the coincident and tangent faces this
  geometry is full of (prongs centred exactly on a girdle, seats tangent to a band). Rejected for now.
- **Constructing the final solid directly**: build the band with its holes in its own
  tessellation, and so on. Clean for the band alone, but prongs meet the band, the rail and each
  other at arbitrary angles, and the seat cuts notches in round wire: every join is a special
  case, and each new head style would need new ones.
- **Implicit CSG, then one isosurface (chosen).** Every part is already defined analytically
  (`piece_params.rs`): the band is a section revolved about the finger, a prong is a round wire
  along a path, the rail a wire loop, a bead a sphere, a seat the stone's own envelope. Each
  becomes a signed distance bound `f` (negative inside, 1-Lipschitz). The metal is
  `max(min(adds), −min(cuts))`. That field is sampled on a sparse grid and its zero set extracted
  by **marching tetrahedra** on the Kuhn (Freudenthal) split of each cube.

## Why marching tetrahedra gives the properties by construction

The extracted surface is the zero set of the piecewise-linear interpolant of the sampled field
over a conforming tetrahedral mesh. With samples that are exactly zero counted as outside, that
zero set:

- is **closed**: the grid is padded so every node on its boundary is outside;
- is a **2-manifold**: each surface vertex lies inside one grid edge, and the tetrahedra around
  that edge contribute one cycle of triangles around it;
- is **consistently oriented**: each triangle is wound from the tetrahedron's own vertex parity,
  so every triangle faces from the inside nodes to the outside ones;
- **does not intersect itself**: each triangle lies in one tetrahedron, and neighbouring
  tetrahedra share only the face between them, where their triangles share the same segment
  (vertices are keyed by grid edge, so they are one vertex, not two equal ones).

Interpolation parameters are clamped to [0.01, 0.99] of the edge, so no triangle is degenerate.
The extractor also verifies the result (every edge used once each way) before it is written,
and the tests check the four properties and self-intersection independently.

## Costs and what is approximated

- Sharp edges (a flat band's corners, a knife edge) are chamfered by about half a grid step
  (0.06–0.1 mm at fine quality). Smooth surfaces are within a few micrometres at that step.
- Triangle count grows with surface area over the step squared; the step coarsens until the
  solid is under `MAX_TRIANGLES`, and `notes` says so.
- Work is bounded: candidates per grid block come from a binned index, block count and field
  evaluations are capped, and a piece over the caps is sampled more coarsely or refused.
- Volume and grams come from the merged solid. The analytic band weight
  (`PieceParams::band_grams`) remains the bench sheet's figure; the solid of a plain band agrees
  with it within 1 % (fine), and the solid's figure adds the head and takes off the seats.

## Consequences

No new dependency. The same code runs in wasm. A future exact Boolean (or a feature-preserving
dual contouring) can replace the extractor without changing the CSG description of the piece.
