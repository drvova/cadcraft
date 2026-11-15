# NURBS surfaces

> **Last updated:** 2026-11-15 · **Change:** minor (surfaces are drawing objects; commands; trims) · **Target:** Rhino-class free-form modelling for the jewelry layer

Rhino, the jeweller's standard, is a NURBS surface modeller. CADCraft had NURBS **curves**
(`crates/geom/src/spline.rs`, `nurbs.rs`); this is the foundation for **surfaces**, in
`crates/geom` (L0: pure maths, no I/O, no UI). It is written from the mathematics of B-splines
(Cox–de Boor recursion, the basis derivative recurrence, Boehm knot insertion, Bézier degree
elevation, the rational quotient rule, the double reflection frame) in our own code, with no
dependency added. Since 2026-11-15 surfaces are **drawing objects** (see *Surfaces in the drawing* below).

## What exists

| Area | API (`cadcraft_geom::…`) | Notes |
|---|---|---|
| 3D curve | `NurbsCurve3::{new, from_control, line, arc, circle, from_spline}`, `point`, `derivs` (C, C′, C″), `tangent`, `insert_knot`, `elevate`, `reparam`, `map`, `is_closed` | Validated; weights > 0; exact rational arcs (≤ 90° pieces) |
| Surface | `NurbsSurface::new(degree_u, degree_v, knots_u, knots_v, count_u, count_v, points, weights)` | Row-major grid `points[i·count_v + j]`; validation of degree, knot count/order/multiplicity, finiteness, weights, size caps (`MAX_SURFACE_POINTS` = 2²⁰, `MAX_SURFACE_DEGREE` = 24) |
| Evaluation | `point`, `derivs` → `SurfaceDerivs {point, du, dv, duu, duv, dvv}`, `normal` (pole-safe), `eval_grid(us, vs)`, `iso_u`, `iso_v`, `transposed` | Basis functions reuse `spline::basis`/`find_span`; derivatives by the recurrence (`basis_derivs`) and the quotient rule in homogeneous coordinates |
| Refinement | `insert_knot_u/v`, `refine_u/v`, `elevate_u/v` | Exact. Elevation goes through Bézier pieces and leaves interior knots at full multiplicity (no knot removal yet); clamped knots only |
| Constructors | `bilinear`, `extrude`, `revolve`, `ruled`, `loft`, `sweep1`, `make_compatible` | Revolution is exact (rational quadratic circles). Loft interpolates homogeneous control columns (averaged chord length, averaged knots): exact through each section |
| Frames | `rail_frames(rail, params, FrameMode)`, `Frame`, `FrameMode::{RotationMinimizing, Upright{axis}}` | Double reflection RMF; closed rails spread the holonomy so the end frame meets the start. Upright: binormal = axis projected off the tangent; **where the axis is parallel to the tangent (`|axis × T| < 1e-3`) the frame is undefined and continues by a rotation-minimising step**, resuming upright when defined |
| Sweep1 | `NurbsSurface::sweep1(rail, profile, mode, stations)` | Profile placed exactly at `stations` evenly spaced rail parameters, skinned with a cubic across them (an interpolation between stations) |
| Tessellation | `tessellate(&s, &TessOptions {chord_tol, angle_tol, max_triangles})` → `SurfaceMesh {positions, normals, uvs, indices, capped}`; `area`, `signed_volume`, `open_edges` | Tensor grid with adaptive u and v lists (no T-junctions); seams of closed directions welded, poles collapsed; closed surfaces give closed manifold meshes. Hard cap `MAX_TESS_TRIANGLES` = 8 M. `positions`/`indices` match the engine's `PartMesh` (`Vec<Vec3>`, `Vec<u32>`) |
| Projection | `closest_point(p)` → `ClosestPoint {u, v, point, distance}`, `invert(p, tol)` | Grid seed (≤ 65² samples), damped Newton from the 8 best seeds, ≤ 100 iterations each, edges handled by freezing the outward parameter, closed directions wrap |
| Mass properties | `area()`, `signed_volume()`, `volume()`, `is_closed`, `is_closed_u/v`, `poles` | 8×8 Gauss–Legendre on every knot span, 4×4 sub-patches; volume by the divergence theorem, refused (`NotClosed`) for open surfaces |

Errors are `SurfaceError`; nothing panics (crate deny lints; hostile tests).

## Trimmed surfaces (`crates/geom/src/surface_trim.rs`)

| Part | What it does |
|---|---|
| Trim loops | Closed polygons in (u, v): the first usually the outer boundary, the rest holes; kept region by the **even–odd rule** (no loops: untrimmed). `validate_trims`: ≤ 4 096 loops, ≤ 2¹⁸ points, ≥ 3 finite points each |
| Point in trim | `point_in_trims(loops, p)`: ray crossing per loop; a point on a loop is kept |
| Trimmed tessellation | `tessellate_trimmed(s, loops, opts)`: the tensor grid of `tessellate`'s parameter lists, refined to ≥ 32 and ≤ 1 024 intervals per direction, finer than ⅛ of the smallest loop and than `½·√(chord/size)` of the domain, cut by **marching triangles**: an edge with one end kept and one dropped is cut at its exact crossing with the loop, computed once per grid edge, so both triangles of an edge share the cut vertex. No cracks inside the surface; the open boundary's vertices lie on the trim loops |
| Trimmed area | `trimmed_area` / `mesh_param_area`: ∫\|S_u × S_v\| over the kept parameter triangles with a degree-2 rule (exact metric, region approximated by the cut grid) |
| Projection along a direction | `project_along(s, p, dir)`: Newton on the two components across `dir`, seeded by `closest_point` (the trim commands project a curve as seen from above) |
| Planar surfaces | `planar_trimmed(loops3d)`: Newell normal, flatness check, a bilinear rectangle over the loops in their plane, trimmed by them |

Measured (tests): open edges of 60 random trimmed bicubic patches (random wobbly holes of 3–200 points) all lie on the trim loop or the domain border, every interior edge has two triangles running it in opposite directions; a 10 × 10 plane with a radius-2.5 hole: area to 2e-3 at the default tolerance; a unit square with a circular hole (40 random sizes): relative area error < 1e-2 at chord 5 % of the size and smaller at 0.05 % (it falls about linearly with the cell size, since a cut joins two exact crossings by a chord).

## Surfaces in the drawing

`EntityKind::Surface` (`crates/doc/src/entity/surface.rs`) stores the plain data — degrees, knots, counts, the control net, weights, trim loops — so it serialises with the drawing and every undo step, and rebuilds (validated) into `NurbsSurface` when evaluated; a hostile object is an error, never a panic. It has a layer, colour and every common property; it is drawn in 2D as its edges (or trim loops) and 5 isocurves each way clipped to the trims; it snaps to its corners and edge midpoints (endpoint/midpoint) and its middle (node); MOVE, ROTATE, SCALE, MIRROR and grips transform its control net (Z scales with the factor); MASSPROP gives its area, and for a closed untrimmed surface its volume (quadrature) and grams in every metal.

| Command | What it makes |
|---|---|
| `loft {handles, heights?, degree?}` | A skin through 2–1 024 sections in order (`heights` lifts plan-drawn sections) |
| `revolve {handles, axisStart?, axisEnd?, angle?}` | An exact revolution about a line in the plane |
| `extrude {handles, height? \| direction?}` | One extrusion per curve |
| `sweep {rail, profile, stations?, upright?, orient?}` (alias `sweep1`) | One-rail sweep; `orient` stands a plan-drawn profile up across the rail's start |
| `planesrf {handles}` (alias `planarsrf`) | A trimmed plane from closed planar curves (first the boundary, the rest holes) |
| `surftrim {surface, curve, keep?, direction?}` | Trims by a closed curve projected onto the surface (seen from above, or closest point): `outside` (default) cuts a hole, `inside` keeps the inside |
| `split {surface, curve}` | Two surfaces, inside and outside the projected curve |
| `mesh {handles, tolerance?, angle?}` | The triangles of surfaces and SubD objects (read-only) |
| `surfmesh {quality?, metal?}` | Every visible free-form object as the 3D view's metal meshes (a layer named after a metal picks it) |
| `tosubd`, `tonurbs` | See [subd.md](subd.md) |

Curves accepted: lines, arcs, circles, ellipses, polylines (bulges tessellated), 3D polylines and splines. **Files:** no DXF entity carries a NURBS surface (DXF's SURFACE is ACIS data), so a DXF keeps model space's free-form objects in CADCraft's own XRECORD (`CADCRAFT_FREEFORM`, JSON) and reopens them; other programs do not see them, and saving says so (`notExported` in the reply and a command-line note). The 3D view shows the drawing's free-form objects when the drawing has no parametric piece.

## Accuracy (measured by the tests in `crates/geom/src/surface_tests.rs`)

| Check | Result |
|---|---|
| Revolved semicircle vs sphere, 10 000 samples | max radius error 1.8e-15 |
| Revolved circle vs torus (R 10, r 2.5), 10 000 samples | max error 6.2e-15 |
| Derivatives (1st and 2nd, rational random surfaces) vs central differences | worst relative 1.0e-7 (the difference quotient's own error) |
| Knot insertion, refinement, degree elevation (150 random surfaces) | worst deviation 7.4e-15 |
| Loft through 4 sections (circles and a cubic) | section points on the surface to 1.8e-15 |
| Sweep1, straight rail, circle profile | exact cylinder (< 1e-9) |
| Sweep1, circle rail R 10, profile r 1, vs torus | 17 stations 6.8e-3; 33: 3.7e-4; 65: 5.2e-6; 129: 2.6e-7 |
| Quadrature area / volume of a torus | relative 4e-15 / 1.6e-14; sphere to 1e-8 absolute |
| Closest point on torus vs analytic distance (300 points) | 7e-15 |
| Torus tessellation, tol 0.1 / 0.01 | watertight (0 open edges); area rel. err 5.6e-3 / 6.6e-4; volume 1.3e-2 / 2.0e-3; centroid deviation ≤ 0.72·tol |

Use `volume()` (quadrature) for grams, not the mesh volume.

Performance (release, one core, rational bi-quadratic torus): 3.6 M points/s, 0.93 M full
second-derivative evaluations/s, 32 M points/s on a grid; tessellation 22 ms (0.1 tolerance,
2 048 triangles), 110 ms (0.01, 16 384), 383 ms (0.001, 110 592); closest point ≈ 0.29 ms.

## Next (estimates in Opus 5.5 hours)

1. Done 2026-11-15: trimmed surfaces, the surface entity and its commands. Left: trims by open curves and by iso-curves, trims that follow the true curve (insert its vertices into the grid, so corners are not cut off), curve-on-surface trims for `.3dm`, a surface-level edit (control points, grips per point), the interactive prompts beyond "select objects" (axis, heights): 8–14 h.
2. Merging surfaces in the 3D view with a piece (both at once) and per-object materials: 3–5 h.
3. **3dm surfaces** (DXF SURFACE/ACIS is proprietary-shaped: 3dm NURBS surfaces first via the 3dm reader): 8–16 h.
4. Tessellation: quadtree refinement with crack-free stitching (fewer triangles), mesh across several surfaces sharing edges: 6–10 h. Knot removal after elevation: 3–4 h. Periodic/unclamped support: 3 h.
5. **Flow along a surface** (map a drawing through (u, v) onto a free-form surface) and **pavé on a free-form surface** (arc-length spacing in uv, normals from `normal`, closest-point snapping): 10–16 h.
6. Surface–surface intersection, offset surface, two-rail sweep, network surface: 30–50 h.
7. **Booleans / B-rep solids**: a major project (60–120 h); the jewelry cast solid keeps using implicit CSG (ADR 0002) meanwhile.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-15 | minor | Trimmed surfaces (loops, point in trim, marching-triangles tessellation, trimmed area, projection along a direction, planar surfaces); `EntityKind::Surface` in the drawing; LOFT, REVOLVE, EXTRUDE, SWEEP, PLANESRF, SURFTRIM, SPLIT, MESH, SURFMESH; MASSPROP of surfaces; DXF keeps them in CADCraft's record |
| 2026-11-14 | new | Surface type, evaluation, refinement, constructors, sweep frames, tessellation, projection, area and volume |
