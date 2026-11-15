//! Trimmed NURBS surfaces: trim loops in parameter space, the point-in-trim test, trimmed
//! tessellation and the area of a trimmed surface.
//!
//! A trim is a list of closed polygons in `(u, v)` (the first is usually the outer boundary, the
//! rest holes). The kept region is by the even–odd rule: a parameter point is kept when it is
//! inside an odd number of loops, so an outer loop with holes, or holes alone inside the whole
//! domain (given as its boundary loop), both work. No loops means the untrimmed surface.
//!
//! Tessellation is a tensor grid refined from [`tessellate`]'s parameter lists (and finer than
//! the smallest loop), cut by marching triangles: an edge with one end kept and one dropped is
//! cut where it crosses a loop (the exact segment intersection, computed once per grid edge, so
//! the triangles on both sides of an edge share the cut vertex: no cracks inside the surface).
//! The cut vertices lie on the trim loops, so the mesh's open boundary follows the trim to within
//! the grid's chord error. Area integrates `|S_u × S_v|` over the kept parameter triangles with a
//! degree-2 rule, so it converges to the trimmed area as the tolerance falls.

use std::collections::HashMap;

use crate::tessellate::{SurfaceMesh, TessOptions, tessellate};
use crate::{NurbsSurface, SurfaceError, SurfaceResult, Vec2, Vec3};

/// Most loops in one trim.
pub const MAX_TRIM_LOOPS: usize = 4096;
/// Most points over every loop of one trim.
pub const MAX_TRIM_POINTS: usize = 1 << 18;
/// Most grid intervals in each direction of a trimmed tessellation.
const MAX_TRIM_GRID: usize = 1024;
/// Least grid intervals in each direction of a trimmed tessellation.
const MIN_TRIM_GRID: usize = 32;

/// Checks a trim: loop and point counts, at least three finite points per loop.
pub fn validate_trims(loops: &[Vec<Vec2>]) -> SurfaceResult<()> {
    if loops.len() > MAX_TRIM_LOOPS {
        return Err(SurfaceError::TooLarge);
    }
    let total: usize = loops.iter().map(Vec::len).fold(0usize, usize::saturating_add);
    if total > MAX_TRIM_POINTS {
        return Err(SurfaceError::TooLarge);
    }
    for l in loops {
        if l.len() < 3 {
            return Err(SurfaceError::BadInput("a trim loop needs at least three points"));
        }
        if l.iter().any(|p| !p.is_finite()) {
            return Err(SurfaceError::BadInput("a trim point is not finite"));
        }
    }
    Ok(())
}

/// Whether `p` is inside polygon `poly` (closed implicitly), by ray crossing.
fn inside_loop(poly: &[Vec2], p: Vec2) -> bool {
    let n = poly.len();
    let mut inside = false;
    for i in 0..n {
        let (Some(a), Some(b)) = (poly.get(i), poly.get((i + 1) % n)) else { continue };
        if (a.y > p.y) != (b.y > p.y) {
            let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
            if p.x < x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Whether `p` lies on an edge of `poly` (within `tol`).
fn on_loop(poly: &[Vec2], p: Vec2, tol: f64) -> bool {
    let n = poly.len();
    (0..n).any(|i| {
        let (Some(&a), Some(&b)) = (poly.get(i), poly.get((i + 1) % n)) else { return false };
        let ab = b - a;
        let l2 = ab.len2();
        let t = if l2 > 0.0 { ((p - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
        (a + ab * t).dist(p) <= tol
    })
}

/// Whether parameter point `p` is kept by the trim (even–odd over every loop; no loops: kept).
/// A point on a loop is kept (the trim's boundary belongs to the surface).
pub fn point_in_trims(loops: &[Vec<Vec2>], p: Vec2) -> bool {
    if loops.is_empty() {
        return true;
    }
    let tol = 1e-12 * (1.0 + p.x.abs().max(p.y.abs()));
    if loops.iter().any(|l| on_loop(l, p, tol)) {
        return true;
    }
    loops.iter().filter(|l| inside_loop(l, p)).count() % 2 == 1
}

/// Signed area of a closed polygon (positive counter-clockwise).
pub fn loop_area(poly: &[Vec2]) -> f64 {
    let n = poly.len();
    (0..n).filter_map(|i| Some(poly.get(i)?.cross(*poly.get((i + 1) % n)?))).sum::<f64>() * 0.5
}

/// The parameter `t` in `[0, 1]` where segment `a`→`b` first crosses a loop edge, if it does.
fn first_crossing(loops: &[Vec<Vec2>], a: Vec2, b: Vec2) -> Option<f64> {
    let d = b - a;
    let mut best: Option<f64> = None;
    for l in loops {
        let n = l.len();
        for i in 0..n {
            let (Some(&p), Some(&q)) = (l.get(i), l.get((i + 1) % n)) else { continue };
            let e = q - p;
            let den = d.cross(e);
            if den.abs() < 1e-300 {
                continue;
            }
            let w = p - a;
            let t = w.cross(e) / den;
            let s = w.cross(d) / den;
            if (-1e-12..=1.0 + 1e-12).contains(&t) && (-1e-12..=1.0 + 1e-12).contains(&s) && best.is_none_or(|b| t < b) {
                best = Some(t.clamp(0.0, 1.0));
            }
        }
    }
    best
}

/// Bounding box of every loop: `(min, max)`.
fn loops_box(loops: &[Vec<Vec2>]) -> Option<(Vec2, Vec2)> {
    let mut it = loops.iter().flatten();
    let f = *it.next()?;
    let (mut lo, mut hi) = (f, f);
    for p in it {
        lo = Vec2::new(lo.x.min(p.x), lo.y.min(p.y));
        hi = Vec2::new(hi.x.max(p.x), hi.y.max(p.y));
    }
    Some((lo, hi))
}

/// Sorted, de-duplicated parameters, refined so no interval exceeds `step`, at most `cap` long.
fn grid_list(mut vals: Vec<f64>, lo: f64, hi: f64, step: f64, cap: usize) -> Vec<f64> {
    vals.push(lo);
    vals.push(hi);
    vals.retain(|v| v.is_finite() && *v >= lo && *v <= hi);
    vals.sort_by(f64::total_cmp);
    vals.dedup_by(|a, b| (*a - *b).abs() <= 1e-12 * (1.0 + b.abs()));
    let mut out = Vec::with_capacity(vals.len());
    for w in vals.windows(2) {
        let (a, b) = (w.first().copied().unwrap_or(lo), w.get(1).copied().unwrap_or(hi));
        let n = if step > 0.0 { ((b - a) / step).ceil().clamp(1.0, cap as f64) as usize } else { 1 };
        for k in 0..n {
            out.push(a + (b - a) * k as f64 / n as f64);
        }
    }
    out.push(hi);
    if out.len() > cap + 1 {
        // Too many: keep an even selection (always the ends).
        let m = out.len() - 1;
        out = (0..=cap).filter_map(|i| out.get(i * m / cap).copied()).collect();
    }
    out
}

/// Tessellates `s` with its trim `loops` (see the module notes). No loops: [`tessellate`].
pub fn tessellate_trimmed(s: &NurbsSurface, loops: &[Vec<Vec2>], opts: &TessOptions) -> SurfaceResult<SurfaceMesh> {
    if loops.is_empty() {
        return tessellate(s, opts);
    }
    validate_trims(loops)?;
    let base = tessellate(s, opts)?;
    let (u0, u1) = s.domain_u();
    let (v0, v1) = s.domain_v();
    // Finer than the smallest loop, so no loop slips between grid lines.
    let smallest =
        loops.iter().filter_map(|l| loops_box(std::slice::from_ref(l))).map(|(a, b)| (b.x - a.x).max(b.y - a.y)).fold(f64::INFINITY, f64::min);
    let du = ((u1 - u0) / MIN_TRIM_GRID as f64).min(smallest / 8.0).max((u1 - u0) / MAX_TRIM_GRID as f64);
    let dv = ((v1 - v0) / MIN_TRIM_GRID as f64).min(smallest / 8.0).max((v1 - v0) / MAX_TRIM_GRID as f64);
    // And fine enough for the chord tolerance along the trims: a cut's error falls with the
    // square of the cell size.
    let rel = (opts.chord_tol / s.size().max(1e-300)).max(0.0).sqrt() * 0.5;
    let du = du.min((u1 - u0) * rel).max((u1 - u0) / MAX_TRIM_GRID as f64);
    let dv = dv.min((v1 - v0) * rel).max((v1 - v0) / MAX_TRIM_GRID as f64);
    let budget = opts.max_triangles.clamp(2, crate::MAX_TESS_TRIANGLES);
    // Within the triangle budget: fewer grid lines (evenly kept) when the tolerances ask for more.
    let cap = (((budget / 2) as f64).sqrt() as usize).saturating_sub(1).clamp(2, MAX_TRIM_GRID);
    let mut capped = base.capped;
    let us = grid_list(base.uvs.iter().map(|p| p[0]).collect(), u0, u1, du, MAX_TRIM_GRID);
    let vs = grid_list(base.uvs.iter().map(|p| p[1]).collect(), v0, v1, dv, MAX_TRIM_GRID);
    let (us, vs) = if us.len().saturating_mul(vs.len()).saturating_mul(2) > budget {
        capped = true;
        (grid_list(us, u0, u1, 0.0, cap), grid_list(vs, v0, v1, 0.0, cap))
    } else {
        (us, vs)
    };
    let nv = vs.len();
    let mut mesh = SurfaceMesh { capped, ..SurfaceMesh::default() };
    let push = |mesh: &mut SurfaceMesh, uv: Vec2| -> u32 {
        let n = s.normal(uv.x, uv.y).unwrap_or(Vec3::ZERO);
        mesh.positions.push(s.point(uv.x, uv.y));
        mesh.normals.push(n);
        mesh.uvs.push([uv.x, uv.y]);
        (mesh.positions.len() - 1) as u32
    };
    // Grid vertices (index i * nv + j), and whether each is kept.
    let mut kept = Vec::with_capacity(us.len() * nv);
    let mut grid_uv = Vec::with_capacity(us.len() * nv);
    for &u in &us {
        for &v in &vs {
            let p = Vec2::new(u, v);
            grid_uv.push(p);
            kept.push(point_in_trims(loops, p));
        }
    }
    let mut index: Vec<Option<u32>> = vec![None; grid_uv.len()];
    let mut cuts: HashMap<(usize, usize), u32> = HashMap::new();
    let mut vertex = |mesh: &mut SurfaceMesh, g: usize| -> Option<u32> {
        if let Some(Some(i)) = index.get(g) {
            return Some(*i);
        }
        let i = push(mesh, *grid_uv.get(g)?);
        if let Some(slot) = index.get_mut(g) {
            *slot = Some(i);
        }
        Some(i)
    };
    // The cut on grid edge a–b (a kept, b dropped), shared by both triangles of the edge.
    let mut cut = |mesh: &mut SurfaceMesh, a: usize, b: usize| -> Option<u32> {
        let key = (a.min(b), a.max(b));
        if let Some(&i) = cuts.get(&key) {
            return Some(i);
        }
        let (pa, pb) = (*grid_uv.get(key.0)?, *grid_uv.get(key.1)?);
        let t = first_crossing(loops, pa, pb).unwrap_or(0.5);
        let i = push(mesh, pa.lerp(pb, t));
        cuts.insert(key, i);
        Some(i)
    };
    for i in 0..us.len().saturating_sub(1) {
        for j in 0..nv.saturating_sub(1) {
            let (g00, g10, g11, g01) = (i * nv + j, (i + 1) * nv + j, (i + 1) * nv + j + 1, i * nv + j + 1);
            for tri in [[g00, g10, g11], [g00, g11, g01]] {
                let k: Vec<bool> = tri.iter().map(|&g| kept.get(g).copied().unwrap_or(false)).collect();
                let count = k.iter().filter(|&&x| x).count();
                if count == 0 {
                    continue;
                }
                if count == 3 {
                    let (Some(a), Some(b), Some(c)) = (vertex(&mut mesh, tri[0]), vertex(&mut mesh, tri[1]), vertex(&mut mesh, tri[2])) else {
                        continue;
                    };
                    mesh.indices.extend([a, b, c]);
                    continue;
                }
                // Rotate so the odd one out is first.
                let odd = if count == 1 { k.iter().position(|&x| x) } else { k.iter().position(|&x| !x) }.unwrap_or(0);
                let (p, q, r) = (tri[odd], tri[(odd + 1) % 3], tri[(odd + 2) % 3]);
                if count == 1 {
                    // p kept: triangle p, cut(p,q), cut(p,r).
                    let (Some(a), Some(b), Some(c)) = (vertex(&mut mesh, p), cut(&mut mesh, p, q), cut(&mut mesh, p, r)) else { continue };
                    mesh.indices.extend([a, b, c]);
                } else {
                    // p dropped: quad cut(p,q), q, r, cut(p,r).
                    let (Some(a), Some(b), Some(c), Some(d)) =
                        (cut(&mut mesh, q, p), vertex(&mut mesh, q), vertex(&mut mesh, r), cut(&mut mesh, r, p))
                    else {
                        continue;
                    };
                    mesh.indices.extend([a, b, c, a, c, d]);
                }
            }
        }
    }
    Ok(mesh)
}

/// `∫|S_u × S_v|` over the parameter triangles of `mesh` (a degree-2 rule on each).
pub fn mesh_param_area(s: &NurbsSurface, mesh: &SurfaceMesh) -> f64 {
    let uv = |i: u32| mesh.uvs.get(i as usize).map(|p| Vec2::new(p[0], p[1]));
    let jac = |p: Vec2| {
        let d = s.derivs(p.x, p.y);
        d.du.cross(d.dv).len()
    };
    let mut total = 0.0;
    for t in mesh.indices.chunks_exact(3) {
        let (Some(a), Some(b), Some(c)) = (uv(t[0]), uv(t[1]), uv(t[2])) else { continue };
        let area = ((b - a).cross(c - a) * 0.5).abs();
        if area <= 0.0 {
            continue;
        }
        let m = (jac(a.lerp(b, 0.5)) + jac(b.lerp(c, 0.5)) + jac(c.lerp(a, 0.5))) / 3.0;
        if m.is_finite() {
            total += area * m;
        }
    }
    total
}

/// The area of `s` kept by `loops` (no loops: the exact quadrature [`NurbsSurface::area`]).
pub fn trimmed_area(s: &NurbsSurface, loops: &[Vec<Vec2>], opts: &TessOptions) -> SurfaceResult<f64> {
    if loops.is_empty() {
        return s.area();
    }
    let mesh = tessellate_trimmed(s, loops, opts)?;
    Ok(mesh_param_area(s, &mesh))
}

/// The parameter point whose surface point is `p` seen along `dir` (a unit direction): Newton
/// on the two components across `dir`, seeded by the closest point. `None` when it does not
/// converge inside the domain.
pub fn project_along(s: &NurbsSurface, p: Vec3, dir: Vec3) -> Option<Vec2> {
    let dir = dir.normalized();
    if dir.len() < 0.5 {
        return None;
    }
    // Two axes across the direction.
    let helper = if dir.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 1.0, 0.0) };
    let ax = dir.cross(helper).normalized();
    let ay = dir.cross(ax).normalized();
    let seed = s.closest_point(p).ok()?;
    let (u0, u1) = s.domain_u();
    let (v0, v1) = s.domain_v();
    let (mut u, mut v) = (seed.u, seed.v);
    for _ in 0..60 {
        let d = s.derivs(u, v);
        let r = d.point - p;
        let (rx, ry) = (r.dot(ax), r.dot(ay));
        if rx.abs().max(ry.abs()) < 1e-11 * (1.0 + s.size()) {
            return Some(Vec2::new(u, v));
        }
        let (a, b, c, e) = (d.du.dot(ax), d.dv.dot(ax), d.du.dot(ay), d.dv.dot(ay));
        let det = a * e - b * c;
        if det.abs() < 1e-300 || !det.is_finite() {
            break;
        }
        let du = (rx * e - b * ry) / det;
        let dv = (a * ry - c * rx) / det;
        u = (u - du).clamp(u0, u1);
        v = (v - dv).clamp(v0, v1);
    }
    let d = s.point(u, v) - p;
    let off = (d - dir * d.dot(dir)).len();
    (off < 1e-6 * (1.0 + s.size())).then_some(Vec2::new(u, v))
}

/// A planar surface for closed planar `loops` (3D polygons; the first the outer boundary): the
/// plane's rectangle over the loops' bounds, trimmed by the loops in its parameter space.
pub fn planar_trimmed(loops: &[Vec<Vec3>]) -> SurfaceResult<(NurbsSurface, Vec<Vec<Vec2>>)> {
    let outer = loops.first().ok_or(SurfaceError::BadInput("no boundary"))?;
    if outer.len() < 3 || loops.iter().flatten().any(|p| !p.is_finite()) {
        return Err(SurfaceError::BadInput("a boundary needs three finite points"));
    }
    // Newell's normal of the outer loop.
    let n = outer.len();
    let mut normal = Vec3::ZERO;
    for i in 0..n {
        let (Some(a), Some(b)) = (outer.get(i), outer.get((i + 1) % n)) else { continue };
        normal = normal + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
    }
    let nl = normal.len();
    if !(nl > 1e-300 && nl.is_finite()) {
        return Err(SurfaceError::BadInput("the boundary encloses no area"));
    }
    let normal = normal * (1.0 / nl);
    let origin = *outer.first().ok_or(SurfaceError::BadInput("no boundary"))?;
    let size = outer.iter().map(|p| (*p - origin).len()).fold(0.0, f64::max);
    let flat = loops.iter().flatten().all(|p| (*p - origin).dot(normal).abs() <= 1e-6 * (1.0 + size));
    if !flat {
        return Err(SurfaceError::BadInput("the boundary is not planar"));
    }
    let helper = if normal.z.abs() > 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 0.0, 1.0) };
    // In the XY plane, keep the drawing's own axes.
    let ex = if normal.z.abs() > 0.9 { helper } else { helper.cross(normal).normalized() };
    let ey = normal.cross(ex).normalized();
    let ex = ey.cross(normal).normalized();
    let to2 = |p: Vec3| Vec2::new((p - origin).dot(ex), (p - origin).dot(ey));
    let flat_loops: Vec<Vec<Vec2>> = loops.iter().map(|l| l.iter().map(|&p| to2(p)).collect()).collect();
    let (lo, hi) = loops_box(&flat_loops).ok_or(SurfaceError::BadInput("no boundary"))?;
    let (w, h) = (hi.x - lo.x, hi.y - lo.y);
    if !(w > 0.0 && h > 0.0) {
        return Err(SurfaceError::BadInput("the boundary encloses no area"));
    }
    let at = |x: f64, y: f64| origin + ex * x + ey * y;
    let srf = NurbsSurface::bilinear(at(lo.x, lo.y), at(hi.x, lo.y), at(lo.x, hi.y), at(hi.x, hi.y))?;
    let (u0, u1) = srf.domain_u();
    let (v0, v1) = srf.domain_v();
    let uv: Vec<Vec<Vec2>> = flat_loops
        .iter()
        .map(|l| l.iter().map(|p| Vec2::new(u0 + (p.x - lo.x) / w * (u1 - u0), v0 + (p.y - lo.y) / h * (v1 - v0))).collect())
        .collect();
    validate_trims(&uv)?;
    Ok((srf, uv))
}
