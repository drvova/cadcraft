//! The Catmull–Clark limit surface: limit positions and normals, the display triangle mesh,
//! volume and area, a signed-distance query, and bicubic B-spline patches for regular quads.
//!
//! For a vertex of an all-quad cage with no fractional sharpness left (after enough levels of
//! subdivision), the published limit masks are:
//!
//! * smooth vertex of valence `n`, edge neighbours `e_i`, diagonal neighbours `f_i`:
//!   `(n² v + 4 Σ e_i + Σ f_i) / (n (n + 5))`;
//! * crease or boundary vertex with crease neighbours `a`, `b`: `(a + 4v + b) / 6` (the uniform
//!   cubic B-spline limit of the crease polygon);
//! * corner: `v`.
//!
//! The tangents at a smooth vertex use the masks `Σ A_n cos(2πi/n) e_i + (cos(2πi/n) +
//! cos(2π(i+1)/n)) f_i` and the same with `sin`, where `A_n = 1 + cos(2π/n) + cos(π/n)
//! √(2(9 + cos(2π/n)))`; at valence 4 they are the bicubic B-spline derivatives. At crease,
//! boundary and corner vertices the normal is the area-weighted mean of the adjacent limit
//! faces' normals (the display mesh is smooth-shaded across creases).

use crate::Vec3;
use crate::subd::{VertexKind, subdivide_levels, vertex_kind};
use crate::subd_cage::{SubdCage, SubdError, bounds_of, newell};
use std::f64::consts::{PI, TAU};

/// How finely to build the limit mesh.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LimitOptions {
    /// Levels of subdivision before the limit masks are applied (at least 1, and at least the
    /// ceiling of the largest finite crease sharpness).
    pub levels: u32,
}

impl Default for LimitOptions {
    fn default() -> Self {
        LimitOptions { levels: 2 }
    }
}

/// A triangle mesh on the limit surface.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SubdMesh {
    pub positions: Vec<Vec3>,
    /// Unit normals, one per position, facing out of a consistently oriented cage.
    pub normals: Vec<Vec3>,
    /// Counter-clockwise triangles (seen from outside), three indices each.
    pub indices: Vec<u32>,
    /// Every edge has two triangles: the mesh is watertight.
    pub closed: bool,
}

/// Limit positions of every vertex of an all-quad cage without fractional sharpness.
pub fn limit_positions(cage: &SubdCage) -> Result<Vec<Vec3>, SubdError> {
    if !cage.all_quads() {
        return Err(SubdError::BadParam("limit positions need an all-quad cage (subdivide once first)".into()));
    }
    let p = cage.positions();
    let mut out = Vec::with_capacity(p.len());
    let mut fan = Vec::new();
    for v in 0..p.len() as u32 {
        let pv = p[v as usize];
        let (kind, w) = vertex_kind(cage, v, &mut fan);
        if w > 0.0 && w < 1.0 {
            return Err(SubdError::BadParam("fractional sharpness remains; subdivide further first".into()));
        }
        let q = match kind {
            VertexKind::Corner => pv,
            VertexKind::Crease(a, b) => (p[a as usize] + pv * 4.0 + p[b as usize]) * (1.0 / 6.0),
            VertexKind::Smooth => {
                let n = fan.len() as f64;
                let mut s = pv * (n * n);
                for &h in &fan {
                    s = s + p[cage.dest(h) as usize] * 4.0 + p[cage.dest(cage.next(h)) as usize];
                }
                s * (1.0 / (n * (n + 5.0)))
            }
        };
        out.push(q);
    }
    Ok(out)
}

/// The two limit tangents at a smooth vertex of an all-quad cage (their cross product faces out).
pub(crate) fn smooth_tangents(cage: &SubdCage, fan: &[u32]) -> (Vec3, Vec3) {
    let p = cage.positions();
    let n = fan.len() as f64;
    let a = 1.0 + (TAU / n).cos() + (PI / n).cos() * (2.0 * (9.0 + (TAU / n).cos())).sqrt();
    let mut t1 = Vec3::ZERO;
    let mut t2 = Vec3::ZERO;
    for (i, &h) in fan.iter().enumerate() {
        let th0 = TAU * i as f64 / n;
        let th1 = TAU * (i + 1) as f64 / n;
        let e = p[cage.dest(h) as usize];
        let f = p[cage.dest(cage.next(h)) as usize];
        t1 = t1 + e * (a * th0.cos()) + f * (th0.cos() + th1.cos());
        t2 = t2 + e * (a * th0.sin()) + f * (th0.sin() + th1.sin());
    }
    (t1, t2)
}

fn limit_normals(cage: &SubdCage, lp: &[Vec3]) -> Vec<Vec3> {
    let nv = lp.len();
    // Area-weighted face normals of the limit quads.
    let mut acc = vec![Vec3::ZERO; nv];
    for f in 0..cage.face_count() {
        let idx = cage.face(f);
        let n = newell(lp, idx);
        for &v in idx {
            if let Some(a) = acc.get_mut(v as usize) {
                *a = *a + n;
            }
        }
    }
    let mut out = Vec::with_capacity(nv);
    let mut fan = Vec::new();
    for v in 0..nv as u32 {
        let avg = acc[v as usize].normalized();
        let (kind, _) = vertex_kind(cage, v, &mut fan);
        let n = if kind == VertexKind::Smooth {
            let (t1, t2) = smooth_tangents(cage, &fan);
            let n = t1.cross(t2).normalized();
            if n.dot(avg) < 0.0 { -n } else { n }
        } else {
            avg
        };
        out.push(if n == Vec3::ZERO { avg } else { n });
    }
    out
}

/// Subdivides, pushes the vertices to the limit surface and triangulates.
pub fn limit_mesh(cage: &SubdCage, opts: LimitOptions) -> Result<SubdMesh, SubdError> {
    let sharp = cage.max_finite_sharpness().ceil();
    let need = if sharp > crate::subd::MAX_SUBD_LEVELS as f64 { crate::subd::MAX_SUBD_LEVELS + 1 } else { sharp as u32 };
    let levels = opts.levels.max(1).max(need);
    let fine = subdivide_levels(cage, levels)?;
    mesh_of_quads(&fine)
}

/// The limit mesh of an all-quad cage as it stands (no further subdivision).
pub(crate) fn mesh_of_quads(fine: &SubdCage) -> Result<SubdMesh, SubdError> {
    let positions = limit_positions(fine)?;
    let normals = limit_normals(fine, &positions);
    let mut indices = Vec::with_capacity(fine.face_count() * 6);
    for f in 0..fine.face_count() {
        let q = fine.face(f);
        let [a, b, c, d] = [q[0], q[1], q[2], q[3]];
        let (pa, pb, pc, pd) = (positions[a as usize], positions[b as usize], positions[c as usize], positions[d as usize]);
        if (pc - pa).len() <= (pd - pb).len() {
            indices.extend_from_slice(&[a, b, c, a, c, d]);
        } else {
            indices.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    if positions.iter().chain(normals.iter()).any(|v| !v.is_finite()) {
        return Err(SubdError::NonFinite("limit mesh".into()));
    }
    Ok(SubdMesh { positions, normals, indices, closed: fine.is_closed() })
}

impl SubdMesh {
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
    fn tri(&self, t: usize) -> Option<[Vec3; 3]> {
        let i = self.indices.get(t * 3..t * 3 + 3)?;
        Some([*self.positions.get(i[0] as usize)?, *self.positions.get(i[1] as usize)?, *self.positions.get(i[2] as usize)?])
    }
    /// Surface area.
    pub fn area(&self) -> f64 {
        (0..self.triangle_count()).filter_map(|t| self.tri(t)).map(|[a, b, c]| (b - a).cross(c - a).len() * 0.5).sum()
    }
    /// Enclosed volume (positive for an outward-facing closed mesh); `None` when open.
    pub fn volume(&self) -> Option<f64> {
        if !self.closed {
            return None;
        }
        let v: f64 = (0..self.triangle_count()).filter_map(|t| self.tri(t)).map(|[a, b, c]| a.dot(b.cross(c)) / 6.0).sum();
        Some(v)
    }
    /// Axis-aligned bounds (min, max).
    pub fn bounds(&self) -> (Vec3, Vec3) {
        bounds_of(&self.positions)
    }
    /// Distance from `p` to the mesh, negative inside (closed meshes; the generalised winding
    /// number decides inside). An open mesh gives the unsigned distance. Brute force over the
    /// triangles: O(triangles) per query.
    pub fn signed_distance(&self, p: Vec3) -> f64 {
        let mut best = f64::INFINITY;
        let mut wind = 0.0;
        for t in 0..self.triangle_count() {
            let Some([a, b, c]) = self.tri(t) else { continue };
            let q = closest_on_triangle(p, a, b, c);
            best = best.min((q - p).len());
            if self.closed {
                wind += solid_angle(a - p, b - p, c - p);
            }
        }
        if self.closed && wind / (4.0 * PI) > 0.5 { -best } else { best }
    }
}

/// Solid angle subtended by a triangle at the origin (Van Oosterom and Strackee 1983).
fn solid_angle(a: Vec3, b: Vec3, c: Vec3) -> f64 {
    let (la, lb, lc) = (a.len(), b.len(), c.len());
    let num = a.dot(b.cross(c));
    let den = la * lb * lc + a.dot(b) * lc + b.dot(c) * la + c.dot(a) * lb;
    2.0 * num.atan2(den)
}

/// The closest point to `p` on triangle `abc` (by Voronoi regions of the vertices and edges).
pub(crate) fn closest_on_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> Vec3 {
    let ab = b - a;
    let ac = c - a;
    let ap = p - a;
    let d1 = ab.dot(ap);
    let d2 = ac.dot(ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = p - b;
    let d3 = ab.dot(bp);
    let d4 = ac.dot(bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let den = d1 - d3;
        return if den > 0.0 { a + ab * (d1 / den) } else { a };
    }
    let cp = p - c;
    let d5 = ab.dot(cp);
    let d6 = ac.dot(cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let den = d2 - d6;
        return if den > 0.0 { a + ac * (d2 / den) } else { a };
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let den = (d4 - d3) + (d5 - d6);
        return if den > 0.0 { b + (c - b) * ((d4 - d3) / den) } else { b };
    }
    let den = va + vb + vc;
    if den.is_nan() || den == 0.0 {
        return a;
    }
    let v = vb / den;
    let w = vc / den;
    a + ab * v + ac * w
}

// ---------- bicubic B-spline patches ----------

/// A uniform bicubic B-spline patch: the limit surface over one regular quad of a cage.
/// `control[j][i]` is the 4×4 grid, `i` along the quad's first edge (u), `j` along its last
/// edge reversed (v). As a NURBS surface: degree 3 in both directions, unit weights, knots
/// `[-3, -2, -1, 0, 1, 2, 3, 4]` in u and v, domain `[0, 1]²`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BicubicPatch {
    pub control: [[Vec3; 4]; 4],
}

fn basis(t: f64) -> [f64; 4] {
    let s = 1.0 - t;
    [s * s * s / 6.0, (3.0 * t * t * t - 6.0 * t * t + 4.0) / 6.0, (-3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0) / 6.0, t * t * t / 6.0]
}

fn dbasis(t: f64) -> [f64; 4] {
    let s = 1.0 - t;
    [-s * s / 2.0, (3.0 * t * t - 4.0 * t) / 2.0, (-3.0 * t * t + 2.0 * t + 1.0) / 2.0, t * t / 2.0]
}

impl BicubicPatch {
    fn combine(&self, bu: [f64; 4], bv: [f64; 4]) -> Vec3 {
        let mut s = Vec3::ZERO;
        for (j, row) in self.control.iter().enumerate() {
            for (i, c) in row.iter().enumerate() {
                s = s + *c * (bu[i] * bv[j]);
            }
        }
        s
    }
    /// The point at `(u, v)` in `[0, 1]²`.
    pub fn eval(&self, u: f64, v: f64) -> Vec3 {
        self.combine(basis(u), basis(v))
    }
    /// The partial derivatives at `(u, v)`.
    pub fn derivs(&self, u: f64, v: f64) -> (Vec3, Vec3) {
        (self.combine(dbasis(u), basis(v)), self.combine(basis(u), dbasis(v)))
    }
    /// The unit normal at `(u, v)` (outward for a consistently oriented cage).
    pub fn normal(&self, u: f64, v: f64) -> Vec3 {
        let (du, dv) = self.derivs(u, v);
        du.cross(dv).normalized()
    }
}

fn is_regular_vertex(cage: &SubdCage, v: u32, fan: &mut Vec<u32>) -> bool {
    if cage.corners().contains(&v) || cage.fan(v, fan).is_some() || fan.len() != 4 {
        return false;
    }
    fan.iter().all(|&h| cage.rule_sharpness(cage.he_edge(h)) == 0.0 && cage.face(cage.he_face(h)).len() == 4)
}

/// The bicubic patch of quad `f`, when all four of its vertices are regular (interior, valence 4,
/// quads around, no creases or corners).
pub fn regular_patch(cage: &SubdCage, f: usize) -> Option<BicubicPatch> {
    let (s, e) = cage.face_range(f);
    if e - s != 4 {
        return None;
    }
    let mut fan = Vec::new();
    for h in s..e {
        if !is_regular_vertex(cage, cage.origin(h as u32), &mut fan) {
            return None;
        }
    }
    let p = cage.positions();
    let mut g = [[Vec3::ZERO; 4]; 4];
    for k in 0..4usize {
        let h = (s + k) as u32;
        let t = cage.twin(h)?;
        let n1 = cage.next(t);
        let n2 = cage.next(n1);
        let d = cage.twin(n1)?;
        let d2 = cage.next(cage.next(d));
        let local = [((1, 1), cage.origin(h)), ((1, 0), cage.dest(n1)), ((2, 0), cage.dest(n2)), ((0, 0), cage.dest(d2))];
        for ((x, y), vid) in local {
            let (mut gx, mut gy) = (x, y);
            for _ in 0..k {
                (gx, gy) = (3 - gy, gx);
            }
            g[gy][gx] = *p.get(vid as usize)?;
        }
    }
    Some(BicubicPatch { control: g })
}

/// Every regular quad's bicubic patch, with its face index. Together they are the exact limit
/// surface over the regular region; faces at extraordinary vertices or creases are left out.
pub fn regular_patches(cage: &SubdCage) -> Vec<(usize, BicubicPatch)> {
    (0..cage.face_count()).filter_map(|f| regular_patch(cage, f).map(|p| (f, p))).collect()
}
