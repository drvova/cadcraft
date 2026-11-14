# SubD (subdivision surfaces)

> **Status:** 2026-11-14 · foundation in `crates/geom` (L0, pure maths); not yet a drawing object.

Rhino's SubD is how jewellers model organic forms: baskets, wavy and twisted shanks, sculpted
pieces, finished with ShrinkWrap for printing. CADCraft's SubD is Catmull–Clark subdivision,
implemented clean-room from the published mathematics (Catmull and Clark 1978; Hoppe et al. 1994
for sharp creases and boundaries; DeRose, Kass and Truong 1998 for semi-sharp creases; the
published limit-position and limit-tangent masks; Stam 1998 / Halstead et al. 1993 for limit
evaluation). No other implementation's source was read.

## What exists

| Part | File | What it does |
|---|---|---|
| Control cage | `crates/geom/src/subd_cage.rs` | `SubdCage`: positions, quads and n-gons (3–1024 sides), half-edge topology. Validation: indices, repeated vertices, unused vertices, NaN/∞, zero-area faces (relative to the cage size), non-manifold or inconsistently oriented edges, non-manifold (bowtie) vertices; boundaries detected. Per-edge crease sharpness (0 smooth, `SHARP` = ∞, fractional semi-sharp), per-vertex corner tags. Caps: 2M vertices, 1M faces. Errors are `SubdError`, never panics. |
| Subdivision | `crates/geom/src/subd.rs` | `subdivide` (one level), `subdivide_levels` (up to `MAX_SUBD_LEVELS` = 8, refused before any work if the result would pass 1M faces). Face, edge and vertex points; boundary edges are infinitely sharp creases (curve rule); sharp edges, darts (smooth rule), creases `(a + 6v + b)/8`, corners (3+ sharp edges or tagged); semi-sharp edges blend and decay by 1 per level. Output is all quads and a valid cage again; old vertices keep their indices, then edge points, then face points. |
| Limit surface | `crates/geom/src/subd_limit.rs` | `limit_positions` (smooth `(n²v + 4Σe + Σf)/(n(n+5))`, crease `(a + 4v + b)/6`, corner `v`), normals from the limit tangent masks at smooth vertices of any valence (area-weighted limit-face normals at crease, boundary and corner vertices), `limit_mesh` → `SubdMesh { positions, normals, indices, closed }` (two triangles per quad, shorter diagonal, watertight for a closed cage), `area`, `volume`, `signed_distance` (closest triangle; sign by generalised winding number), `regular_patches` → `BicubicPatch` (exact uniform bicubic B-spline of each regular quad; `eval`, `derivs`, `normal`). |
| Editing | `crates/geom/src/subd_edit.rs` | `box_cage`, `cylinder_cage` (n-gon caps), `torus_cage` (all regular: the natural ring start), `grid_cage`; `extrude_faces` (region with side ring), `inset_faces`, `bridge_faces` (best rotation), `loop_cut` (edge loop across a quad ring, stops at boundaries and n-gons), `move_vertices` / `move_edges` / `move_faces`, `set_crease`, `set_corner`, `crease_all`. Pure functions; every result is re-validated. |

The mesh is plain data (`Vec<Vec3>` positions, `Vec<u32>` indices) matching the engine's
`PartMesh` in `crates/engine/src/cmd/jewelry/mesh.rs`, so the engine can convert it directly.

## Accuracy (from the known-answer tests, `crates/geom/src/subd_tests.rs`)

- Regular region: torus cage limit points equal the bicubic B-spline patch at patch corners, edge
  midpoints and centres to < 1e-12; patch normals equal the tangent-mask normals to < 1e-12.
- Convergence to the limit (cube, level-1 cage): max |level k − limit| = 4.8e-2, 1.2e-2, 2.9e-3,
  7.3e-4, 1.8e-4 for k = 2…6 (a factor 4 per level, as the theory predicts); limit points computed
  at a finer level agree to < 1e-12.
- Normals vs finite differences of the limit 1-ring: cube 2e-8 rad; cylinder with valence-7 cap
  centres 1.3e-2 rad (ring 2 levels finer) → 2.0e-3 rad (4 levels finer), shrinking as expected.
- Torus cage (R 10, r 3, 12×8) volume at 1…5 levels: 1270.2, 1306.2, 1315.3, 1317.6, 1318.2
  (differences 36, 9.1, 2.3, 0.57: factor 4 per level); area differences 9.9, 2.5, 0.63, 0.16.
- Fully creased cube stays a cube (vertices on the cube to 1e-12; volume 8 and area 24 to 1e-9);
  an open box with corner-tagged rim keeps a straight rim; a smooth rim converges to the cubic
  B-spline of the boundary polygon; a regular planar grid stays planar with +Z normals.
- Semi-sharp sharpness 0, 0.5, 1, 2, ∞ gives monotonically sharper results.

## Performance (dev profile, optimised, this container)

1,000-face torus cage: one level (→ 4,000 faces) ≈ 1.6 ms; next level (→ 16,000) ≈ 7 ms; limit
mesh at 2 levels (32,000 triangles, positions and normals) ≈ 22 ms. `signed_distance` is brute
force, O(triangles) per query.

## Property tests

- 3,000 random face soups: `SubdCage::new` returns Ok or Err, never panics; valid ones subdivide.
- 120 random edit sequences (box, cylinder, torus; extrude, inset, loop cut, move, crease, corner,
  bridge, inward extrude): every step that succeeds is valid, closed, of even Euler
  characteristic ≤ 2; the final limit mesh is watertight, finite, has a finite volume; a further
  subdivision keeps the Euler characteristic (650 steps applied, 70 refused with errors).
- Random tori with an inset: subdivision keeps Euler characteristic and closedness and stays in the
  cage's bounds (convex hull property).

## Limits, honestly

- Normals are smooth across creases in the display mesh (no split normals yet).
- Semi-sharp creases use the simple decay (s − 1 per level), not Chaikin-averaged child sharpness.
- Loop cut on n-gons ends the loop (the n-gon gains a vertex); extrude moves along mean normals
  (no offset correction at sharp region corners); bridge needs faces with no shared vertex and
  the same side count, and refuses results that would duplicate an edge.
- `signed_distance` has no acceleration structure; fine for checks, slow for a full CSG field.
- No exact evaluation at arbitrary parameters near extraordinary vertices (Stam's eigen-basis
  method); use more levels or the regular patches.

## What is next (estimates in Opus 5.5 hours)

1. **SubD object in `crates/doc`** (cage, creases, display level; DXF/own-format round trip): 6–10 h.
2. **Editing commands and a gumball in the interface** (select vertices/edges/faces, move, extrude,
   inset, loop cut, crease, primitives; the engine commands plus `apps/ui` tools): 15–25 h.
3. **SubD in the cast solid** (`crates/engine/src/cmd/jewelry/solid.rs`): a BVH over the limit
   mesh for fast signed distance, then a CSG leaf: 6–10 h.
4. **SubD from and to `.3dm`** (waits on ADR 0003 for the reader): 8–15 h after the reader.
5. **Conversion to NURBS**: regular quads are already exact bicubic patches (`regular_patches`,
   knots −3…4, domain [0,1]²); hand them to the NURBS surface type being built in `crates/geom`,
   and fill extraordinary regions with approximating G1 patches: 10–20 h.
6. Split normals at creases, Chaikin sharpness, exact limit evaluation (Stam): 6–10 h.
