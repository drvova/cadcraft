# NURBS surfaces

> **Last updated:** 2026-11-15 · **Change:** minor (flow along a surface or curve) · **Target:** Rhino-class free-form modelling for the jewelry layer

Rhino, the jeweller's standard, is a NURBS surface modeller. CADCraft had NURBS **curves**
(`crates/geom/src/spline.rs`, `nurbs.rs`); this is the foundation for **surfaces**, in
`crates/geom` (L0: pure maths, no I/O, no UI). It is written from the mathematics of B-splines
(Cox–de Boor recursion, the basis derivative recurrence, Boehm knot insertion, Bézier degree
elevation, the rational quotient rule, the double reflection frame) in our own code, with no
dependency added. It is **not yet a drawing entity**: nothing in the engine, files or UI uses it.

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

## Flow along a surface or curve (`crates/geom/src/flow.rs`)

`SurfaceFlow::new(base, target, FlowOptions {stretch, flip, offset, tol})` maps a base point to
local `(s, t, h)` — lengths along the base and the height off it — and places it at
`S(u, v) + (h + offset)·N(u, v)`, `u`/`v` found from `s`/`t` by arc length along the target's
middle iso-curves (a 1024-sample chord table each way). The base is `FlowBase::Rect` (any plane)
or `FlowBase::Surface` (closest point, then arc length along the base's own middle iso-curves).
`stretch` scales the base extent to the target's; off, lengths are kept (exact on developable
targets, along the middle iso-curves on others). `CurveFlow::new(from, to, curve, opts)` maps a
base line onto a curve with a rotation-minimising frame (double reflection, initial normal by the
minimal rotation from the base direction to the start tangent). Both implement `Flow`:
`map_point`/`map_points` (a `FlowPoint` with the target frame: stone positions and normals),
`map_polyline` (deforming: segments pre-split to 1/16 of the base, then bisected until the mapped
midpoint is within `tol`, depth ≤ 16), `map_mesh` (one global uniform split k ≤ 64 so shared edges
stay watertight, ≤ 400 000 triangles), `map_rigid` (each object moved and oriented by its anchor,
shape kept). Points beyond the target's extent are clamped and flagged (`inside: false`). Caps:
`MAX_FLOW_POINTS` = 500 000 per polyline. `surface_from_net` builds a clamped uniform surface from
a control net. Engine: FLOWALONGSRF and FLOW (`crates/engine/src/cmd/flow_surface.rs`); the
target is a JSON control net until surface entities exist (`target: {handle}` is the hook).
Tests (`flow_tests.rs`): a planar target is the identity, a cylinder wraps exactly (seam closes,
every point at the radius, chords within tolerance), kept length within 1e-3 of 3 on a cylinder,
rigid keeps edge lengths to 1e-12, property sweep (60 random surfaces: every point equals
`S(u,v) + h·N`, polylines on the surface to 1e-6), hostile input.

## Next (estimates in Opus 5.5 hours)

1. **Trimmed surfaces** (outer/inner loops in (u, v), point-in-trim, tessellation honouring trims with exact boundary vertices): 8–12 h.
2. **A surface entity in `crates/doc`** (persisted, drawn, gripped, transformed) and the commands (LOFT, REVSURF, EXTRUDE surface, SWEEP, RULESURF, PLANESRF), MCP params: 12–20 h.
3. **DXF/3dm surfaces** (DXF SURFACE/ACIS is proprietary-shaped: 3dm NURBS surfaces first via the 3dm reader): 8–16 h.
4. Tessellation: quadtree refinement with crack-free stitching (fewer triangles), mesh across several surfaces sharing edges: 6–10 h. Knot removal after elevation: 3–4 h. Periodic/unclamped support: 3 h.
5. ~~Flow along a surface~~ (done 2026-11-15, above). **Pavé on a free-form surface** (FLOWALONGSRF `points` already returns positions and normals; left: arc-length spacing and auto-fit by gap on a free-form surface, a pick prompt): 6–10 h.
6. Surface–surface intersection, offset surface, two-rail sweep, network surface: 30–50 h.
7. **Booleans / B-rep solids**: a major project (60–120 h); the jewelry cast solid keeps using implicit CSG (ADR 0002) meanwhile.

## Revision history

| Date | Change | Summary |
|---|---|---|
| 2026-11-15 | minor | Flow along a surface or curve (`flow.rs`; FLOWALONGSRF, FLOW) |
| 2026-11-14 | new | Surface type, evaluation, refinement, constructors, sweep frames, tessellation, projection, area and volume |
