//! Adaptive tessellation of a NURBS surface into a triangle mesh.
//!
//! The mesh is a tensor grid with **non-uniform, adaptively chosen** u and v parameter lists:
//! a u interval is split while, along any of a set of v test lines, the surface between its ends
//! deviates from the chord by more than the chordal tolerance or the normals at its ends differ by
//! more than the angle tolerance (and likewise for v). Because every row and column shares the
//! same parameters there are no T-junctions, so the mesh of one surface is crack-free by
//! construction. Edges that coincide are welded: a surface closed in u (or v) reuses the first
//! row's vertices for the last, so the seam has no crack, and an edge that collapses to a point (a
//! pole) becomes one vertex with its degenerate triangles dropped. A closed surface (torus,
//! sphere of revolution) gives a closed manifold mesh: every edge is used by exactly two
//! triangles.
//!
//! The grid over-refines a little where only part of a row needs it; a quadtree with crack
//! stitching would use fewer triangles and is listed as next work in `docs/nurbs-surfaces.md`.

use crate::Vec3;
use crate::nurbs_surface::{NurbsSurface, SurfaceError, SurfaceResult};

/// Hard cap on triangles from one surface whatever the options say.
pub const MAX_TESS_TRIANGLES: usize = 8_000_000;

/// Tessellation tolerances.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TessOptions {
    /// Largest distance between the surface and a mesh edge's chord (model units).
    pub chord_tol: f64,
    /// Largest angle between the surface normals at the ends of a mesh edge (radians).
    pub angle_tol: f64,
    /// Most triangles; refinement stops (and `SurfaceMesh::capped` is set) when it would exceed
    /// this. Clamped to [`MAX_TESS_TRIANGLES`].
    pub max_triangles: usize,
}

impl Default for TessOptions {
    fn default() -> Self {
        TessOptions { chord_tol: 0.01, angle_tol: 15f64.to_radians(), max_triangles: 2_000_000 }
    }
}

/// A triangle mesh of a surface: one normal and one `(u, v)` per position; indices are
/// counter-clockwise about `S_u × S_v`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SurfaceMesh {
    pub positions: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    pub uvs: Vec<[f64; 2]>,
    pub indices: Vec<u32>,
    /// The triangle cap stopped refinement before the tolerances were met.
    pub capped: bool,
}

impl SurfaceMesh {
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
    fn tri(&self, t: &[u32]) -> Option<(Vec3, Vec3, Vec3)> {
        let g = |k: usize| t.get(k).and_then(|&i| self.positions.get(i as usize)).copied();
        Some((g(0)?, g(1)?, g(2)?))
    }
    /// Sum of the triangle areas.
    pub fn area(&self) -> f64 {
        self.indices.chunks_exact(3).filter_map(|t| self.tri(t)).map(|(a, b, c)| (b - a).cross(c - a).len() * 0.5).sum()
    }
    /// Signed enclosed volume by the divergence theorem (positive when the normals point out).
    pub fn signed_volume(&self) -> f64 {
        self.indices.chunks_exact(3).filter_map(|t| self.tri(t)).map(|(a, b, c)| a.dot(b.cross(c)) / 6.0).sum()
    }
    /// Edges used by a number of triangles other than two (0 for a closed manifold mesh).
    pub fn open_edges(&self) -> usize {
        let mut edges: std::collections::HashMap<(u32, u32), usize> = std::collections::HashMap::new();
        for t in self.indices.chunks_exact(3) {
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
            }
        }
        edges.values().filter(|&&c| c != 2).count()
    }
}

/// Splits `params` (ascending) where `needs(a, b)` says so, at most `rounds` times, keeping
/// `count · other ≤ budget`. Returns whether the budget stopped it.
fn refine(params: &mut Vec<f64>, other: usize, budget: usize, rounds: usize, needs: &dyn Fn(f64, f64) -> bool) -> bool {
    for _ in 0..rounds {
        let mut out = Vec::with_capacity(params.len() * 2);
        let mut split = false;
        let mut capped = false;
        let mut count = params.len();
        for w in params.windows(2) {
            let (a, b) = (w.first().copied().unwrap_or(0.0), w.get(1).copied().unwrap_or(0.0));
            out.push(a);
            if b - a > 1e-12 * (1.0 + a.abs()) && needs(a, b) {
                if (count + 1).saturating_mul(other.max(1)).saturating_mul(2) > budget {
                    capped = true;
                } else {
                    out.push((a + b) / 2.0);
                    count += 1;
                    split = true;
                }
            }
        }
        if let Some(&l) = params.last() {
            out.push(l);
        }
        *params = out;
        if capped {
            return true;
        }
        if !split {
            break;
        }
    }
    false
}

/// `n` values evenly between the breaks of a list (test lines for refinement).
fn sample_lines(breaks: &[f64], per: usize, cap: usize) -> Vec<f64> {
    let mut out = Vec::new();
    for w in breaks.windows(2) {
        let (a, b) = (w.first().copied().unwrap_or(0.0), w.get(1).copied().unwrap_or(0.0));
        for k in 0..per {
            out.push(a + (b - a) * (k as f64 + 0.5) / per as f64);
        }
    }
    if let Some(&l) = breaks.last() {
        out.push(l);
    }
    if let Some(&f) = breaks.first() {
        out.insert(0, f);
    }
    if out.len() > cap {
        let step = out.len() as f64 / cap as f64;
        out = (0..cap).filter_map(|i| out.get((i as f64 * step) as usize).copied()).collect();
    }
    out
}

fn dist_to_segment(p: Vec3, a: Vec3, b: Vec3) -> f64 {
    let ab = b - a;
    let l2 = ab.dot(ab);
    let t = if l2 > 1e-300 { ((p - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (p - (a + ab * t)).len()
}

/// Tessellates `s` to the tolerances in `opts`.
pub fn tessellate(s: &NurbsSurface, opts: &TessOptions) -> SurfaceResult<SurfaceMesh> {
    if !(opts.chord_tol.is_finite() && opts.chord_tol > 0.0 && opts.angle_tol.is_finite() && opts.angle_tol > 0.0) {
        return Err(SurfaceError::BadInput("tolerances must be positive and finite"));
    }
    let size = s.size();
    // A chord tolerance far below the surface's size would only hit the cap; floor it.
    let chord = opts.chord_tol.max(size * 1e-9);
    let cos_tol = opts.angle_tol.min(std::f64::consts::PI).cos();
    let budget = opts.max_triangles.clamp(2, MAX_TESS_TRIANGLES);

    let bu = s.breaks_u();
    let bv = s.breaks_v();
    if bu.len().saturating_mul(bv.len()) * 2 > budget {
        return Err(SurfaceError::TooLarge);
    }
    let mut us = bu.clone();
    let mut vs = bv.clone();
    let normal = |u: f64, v: f64| s.normal(u, v).unwrap_or(Vec3::ZERO);
    let bad = |a: Vec3, b: Vec3, m: Vec3, na: Vec3, nb: Vec3, nm: Vec3| {
        let normals_ok = |x: Vec3, y: Vec3| x.len() < 0.5 || y.len() < 0.5 || x.dot(y) >= cos_tol;
        dist_to_segment(m, a, b) > chord || !normals_ok(na, nb) || !normals_ok(na, nm) || !normals_ok(nm, nb)
    };
    let mut capped = false;
    for _pass in 0..2 {
        let lines_v = sample_lines(&vs, 2, 96);
        capped |= refine(&mut us, vs.len(), budget, 24, &|a, b| {
            let m = (a + b) / 2.0;
            lines_v.iter().any(|&v| bad(s.point(a, v), s.point(b, v), s.point(m, v), normal(a, v), normal(b, v), normal(m, v)))
        });
        let lines_u = sample_lines(&us, 2, 96);
        capped |= refine(&mut vs, us.len(), budget, 24, &|a, b| {
            let m = (a + b) / 2.0;
            lines_u.iter().any(|&u| bad(s.point(u, a), s.point(u, b), s.point(u, m), normal(u, a), normal(u, b), normal(u, m)))
        });
    }
    // A closed direction needs at least three intervals to make a proper ring.
    for list in [&mut us, &mut vs] {
        while list.len() < 4 {
            let mut out = Vec::with_capacity(list.len() * 2);
            for w in list.windows(2) {
                let (a, b) = (w.first().copied().unwrap_or(0.0), w.get(1).copied().unwrap_or(0.0));
                out.extend([a, (a + b) / 2.0]);
            }
            if let Some(&l) = list.last() {
                out.push(l);
            }
            *list = out;
        }
    }
    build_mesh(s, &us, &vs, size, capped)
}

fn build_mesh(s: &NurbsSurface, us: &[f64], vs: &[f64], size: f64, capped: bool) -> SurfaceResult<SurfaceMesh> {
    let (nu, nv) = (us.len(), vs.len());
    if nu.saturating_mul(nv) > u32::MAX as usize / 2 {
        return Err(SurfaceError::TooLarge);
    }
    let pts = s.eval_grid(us, vs)?;
    let weld = (size * 1e-9).max(1e-12);
    let closed_u = s.is_closed_u(weld * 10.0);
    let closed_v = s.is_closed_v(weld * 10.0);
    let poles = s.poles(weld * 10.0);
    // Map each grid node to a vertex index.
    let mut id = vec![u32::MAX; nu * nv];
    let mut mesh = SurfaceMesh { capped, ..SurfaceMesh::default() };
    let mut pole_ids: [Option<u32>; 4] = [None; 4];
    for i in 0..nu {
        for j in 0..nv {
            let k = i * nv + j;
            // Seams: reuse the first row/column.
            let src = if closed_u && i == nu - 1 {
                Some(j)
            } else if closed_v && j == nv - 1 {
                Some(i * nv)
            } else {
                None
            };
            if let Some(src) = src {
                if let (Some(&v), Some(slot)) = (id.get(src), id.get(k)) {
                    if v != u32::MAX && *slot == u32::MAX {
                        if let Some(x) = id.get_mut(k) {
                            *x = v;
                        }
                        continue;
                    }
                }
            }
            let pole = if i == 0 && poles[0] {
                Some(0)
            } else if i == nu - 1 && poles[1] {
                Some(1)
            } else if j == 0 && poles[2] {
                Some(2)
            } else if j == nv - 1 && poles[3] {
                Some(3)
            } else {
                None
            };
            if let Some(e) = pole {
                if let Some(v) = pole_ids.get(e).copied().flatten() {
                    if let Some(x) = id.get_mut(k) {
                        *x = v;
                    }
                    continue;
                }
            }
            let (u, v) = (us.get(i).copied().unwrap_or(0.0), vs.get(j).copied().unwrap_or(0.0));
            let idx = mesh.positions.len() as u32;
            mesh.positions.push(pts.get(k).copied().unwrap_or_default());
            mesh.normals.push(s.normal(u, v).unwrap_or(Vec3::Z));
            mesh.uvs.push([u, v]);
            if let Some(x) = id.get_mut(k) {
                *x = idx;
            }
            if let Some(e) = pole {
                if let Some(slot) = pole_ids.get_mut(e) {
                    *slot = Some(idx);
                }
            }
        }
    }
    let g = |i: usize, j: usize| id.get(i * nv + j).copied().unwrap_or(u32::MAX);
    mesh.indices.reserve((nu - 1) * (nv - 1) * 6);
    for i in 0..nu - 1 {
        for j in 0..nv - 1 {
            let (a, b, c, d) = (g(i, j), g(i + 1, j), g(i + 1, j + 1), g(i, j + 1));
            // Split along the shorter diagonal.
            let p = |x: u32| mesh.positions.get(x as usize).copied().unwrap_or_default();
            let tris = if (p(a) - p(c)).len() <= (p(b) - p(d)).len() { [[a, b, c], [a, c, d]] } else { [[a, b, d], [b, c, d]] };
            for t in tris {
                if t.iter().any(|&x| x == u32::MAX) || t[0] == t[1] || t[1] == t[2] || t[0] == t[2] {
                    continue;
                }
                mesh.indices.extend(t);
            }
        }
    }
    Ok(mesh)
}
