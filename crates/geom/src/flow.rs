//! Flow: bend geometry from a base frame onto a target surface or along a target curve.
//!
//! Surface flow maps a base point to local coordinates `(s, t, h)` — lengths along the base's two
//! directions and the height off it — and places it at `S(u, v) + (h + offset)·N(u, v)` on the
//! target, where `u` and `v` are found from `s` and `t` by arc length along the target's middle
//! iso-curves. With *stretch* the base's extent is scaled to the target's (`s/W` of the target's
//! length); without it lengths are kept (`s` itself). The base is a rectangle in any plane or a
//! base NURBS surface (closest-point inversion, then arc length along its own middle
//! iso-curves). Curve flow maps a base line to a target curve the same way with a
//! rotation-minimising frame (double reflection, Wang–Jüttler–Zheng–Liu 2008).
//!
//! *Deforming* flow maps every vertex and refines each segment adaptively until the mapped
//! midpoint is within the tolerance of the mapped chord; meshes are subdivided uniformly (one
//! global level, so shared edges stay watertight). *Rigid* flow moves and orients each object by
//! its anchor only. All refinement is bounded by depth and by output caps.

use crate::{NurbsCurve3, NurbsSurface, SurfaceError, SurfaceResult, Vec3};

/// Most points one mapped polyline (or point set) may have.
pub const MAX_FLOW_POINTS: usize = 500_000;
/// Deepest bisection of one segment.
pub const MAX_FLOW_DEPTH: usize = 16;
/// Most triangles a mapped mesh may have.
pub const MAX_FLOW_TRIANGLES: usize = 400_000;
/// Finest uniform subdivision of one mesh triangle (per edge).
pub const MAX_MESH_SPLIT: usize = 64;
/// Samples of an arc-length table.
const TABLE: usize = 1024;
/// Segments longer than `extent / PRESPLIT` are pre-split before the bisection test, so a
/// symmetric bend cannot hide behind a straight-looking midpoint.
const PRESPLIT: f64 = 16.0;

/// How the flow places geometry. Options shared by surface and curve flow.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FlowOptions {
    /// Scale the base's extent to the target's (true), or keep lengths (false).
    pub stretch: bool,
    /// Reverse the target's normal (surface) or up direction (curve).
    pub flip: bool,
    /// Extra height added along the normal.
    pub offset: f64,
    /// Chordal tolerance of the refinement (model units); non-positive means 1/1000 of the base.
    pub tol: f64,
}

impl Default for FlowOptions {
    fn default() -> Self {
        FlowOptions { stretch: true, flip: false, offset: 0.0, tol: 0.0 }
    }
}

/// A mapped point with the target's frame there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FlowPoint {
    pub point: Vec3,
    /// Target axes matching the base axes: for a surface `[S_u dir, N × S_u dir, N]`, for a
    /// curve `[tangent, normal, up]`.
    pub axes: [Vec3; 3],
    /// Target parameters (`v` is 0 for a curve).
    pub u: f64,
    pub v: f64,
    /// False when the base point lies beyond the target's extent (it is clamped to the edge).
    pub inside: bool,
}

impl FlowPoint {
    /// The normal (surface) or up direction (curve) the point was lifted along.
    pub fn normal(&self) -> Vec3 {
        self.axes[2]
    }
}

/// Cumulative chord length of a curve sampled at `TABLE + 1` parameters.
#[derive(Clone, Debug)]
struct ArcTable {
    params: Vec<f64>,
    lens: Vec<f64>,
}

impl ArcTable {
    fn build(a: f64, b: f64, f: impl Fn(f64) -> Vec3) -> SurfaceResult<Self> {
        let mut params = Vec::with_capacity(TABLE + 1);
        let mut lens = Vec::with_capacity(TABLE + 1);
        let mut prev: Option<Vec3> = None;
        let mut acc = 0.0;
        for i in 0..=TABLE {
            let t = a + (b - a) * i as f64 / TABLE as f64;
            let p = f(t);
            if !p.is_finite() {
                return Err(SurfaceError::NonFinite);
            }
            if let Some(q) = prev {
                acc += (p - q).len();
            }
            prev = Some(p);
            params.push(t);
            lens.push(acc);
        }
        if !acc.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        Ok(ArcTable { params, lens })
    }
    fn total(&self) -> f64 {
        self.lens.last().copied().unwrap_or(0.0)
    }
    /// The parameter at arc length `len` (clamped), and whether `len` was in range.
    fn param_at(&self, len: f64) -> (f64, bool) {
        let total = self.total();
        let first = self.params.first().copied().unwrap_or(0.0);
        let last = self.params.last().copied().unwrap_or(0.0);
        let slack = total * 1e-9 + 1e-12;
        let inside = len.is_finite() && len >= -slack && len <= total + slack;
        if !len.is_finite() || len <= 0.0 || total <= 0.0 {
            return (first, inside);
        }
        if len >= total {
            return (last, inside);
        }
        let i = self.lens.partition_point(|&l| l < len).max(1);
        let (l0, l1) = (self.lens.get(i - 1).copied().unwrap_or(0.0), self.lens.get(i).copied().unwrap_or(total));
        let (t0, t1) = (self.params.get(i - 1).copied().unwrap_or(first), self.params.get(i).copied().unwrap_or(last));
        let f = if l1 > l0 { (len - l0) / (l1 - l0) } else { 0.0 };
        (t0 + (t1 - t0) * f, inside)
    }
    /// The arc length at parameter `t` (clamped).
    fn len_at(&self, t: f64) -> f64 {
        let first = self.params.first().copied().unwrap_or(0.0);
        let last = self.params.last().copied().unwrap_or(0.0);
        if !t.is_finite() || t <= first {
            return 0.0;
        }
        if t >= last {
            return self.total();
        }
        let i = self.params.partition_point(|&p| p < t).max(1);
        let (t0, t1) = (self.params.get(i - 1).copied().unwrap_or(first), self.params.get(i).copied().unwrap_or(last));
        let (l0, l1) = (self.lens.get(i - 1).copied().unwrap_or(0.0), self.lens.get(i).copied().unwrap_or(0.0));
        let f = if t1 > t0 { (t - t0) / (t1 - t0) } else { 0.0 };
        l0 + (l1 - l0) * f
    }
}

/// Shared mapping behaviour: base point → local coordinates → placed point.
pub trait Flow {
    /// Local coordinates `(s, t, h)` of a base point.
    fn local(&self, p: Vec3) -> SurfaceResult<Vec3>;
    /// The base's orthonormal axes at a base point (the frame `local` measures in).
    fn base_axes(&self, p: Vec3) -> SurfaceResult<[Vec3; 3]>;
    /// The target point (and frame) of local coordinates.
    fn place(&self, l: Vec3) -> SurfaceResult<FlowPoint>;
    /// A length for the base's size (sets the default tolerance and the pre-split).
    fn extent(&self) -> f64;
    /// The chordal tolerance in use.
    fn tolerance(&self) -> f64;

    /// Map one point (deforming).
    fn map_point(&self, p: Vec3) -> SurfaceResult<FlowPoint> {
        if !p.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        self.place(self.local(p)?)
    }

    /// Map a point set (deforming), e.g. stone positions; each comes with the target frame.
    fn map_points(&self, pts: &[Vec3]) -> SurfaceResult<Vec<FlowPoint>> {
        if pts.len() > MAX_FLOW_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        pts.iter().map(|&p| self.map_point(p)).collect()
    }

    /// Map a polyline (deforming), refining every segment so the result follows the target
    /// within the tolerance. `closed` maps the closing segment too (the result then repeats its
    /// first point at the end).
    fn map_polyline(&self, pts: &[Vec3], closed: bool) -> SurfaceResult<Vec<Vec3>> {
        if pts.len() > MAX_FLOW_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        let locals: Vec<Vec3> =
            pts.iter().map(|&p| if p.is_finite() { self.local(p) } else { Err(SurfaceError::NonFinite) }).collect::<SurfaceResult<_>>()?;
        let mut ring = locals.clone();
        if closed && let Some(&f) = locals.first() {
            ring.push(f);
        }
        let Some(&first) = ring.first() else { return Ok(Vec::new()) };
        let mut prev = self.place(first)?.point;
        let mut out = vec![prev];
        let tol = self.tolerance();
        let step = (self.extent() / PRESPLIT).max(1e-300);
        for w in ring.windows(2) {
            let (Some(&la), Some(&lb)) = (w.first(), w.get(1)) else { continue };
            let n = (((lb - la).len() / step).ceil() as usize).clamp(1, 64);
            let mut a = la;
            for k in 1..=n {
                let b = lerp(la, lb, k as f64 / n as f64);
                let pb = self.place(b)?.point;
                bisect(self, a, b, prev, pb, tol, 0, &mut out)?;
                a = b;
                prev = pb;
            }
        }
        Ok(out)
    }

    /// Map a triangle mesh (deforming): every triangle is split uniformly into `k²` (one `k`
    /// for the whole mesh, so shared edges stay watertight) with `k` the finest any edge needs
    /// for the tolerance, bounded by [`MAX_MESH_SPLIT`] and [`MAX_FLOW_TRIANGLES`]. Returns
    /// a triangle soup.
    fn map_mesh(&self, tris: &[[Vec3; 3]]) -> SurfaceResult<Vec<[Vec3; 3]>> {
        if tris.len() > MAX_FLOW_TRIANGLES {
            return Err(SurfaceError::TooLarge);
        }
        let tol = self.tolerance();
        let mut locals = Vec::with_capacity(tris.len());
        let mut depth = 0usize;
        for t in tris {
            let l = [self.local(t[0])?, self.local(t[1])?, self.local(t[2])?];
            let p = [self.place(l[0])?.point, self.place(l[1])?.point, self.place(l[2])?.point];
            for (i, j) in [(0, 1), (1, 2), (2, 0)] {
                depth = depth.max(needed_depth(self, l[i], l[j], p[i], p[j], tol, 0)?);
            }
            locals.push(l);
        }
        let mut k = (1usize << depth.min(6)).min(MAX_MESH_SPLIT);
        while k > 1 && tris.len().saturating_mul(k * k) > MAX_FLOW_TRIANGLES {
            k /= 2;
        }
        let mut out = Vec::with_capacity(tris.len().saturating_mul(k * k));
        for l in &locals {
            let at = |i: usize, j: usize| -> Vec3 {
                let (a, b) = (i as f64 / k as f64, j as f64 / k as f64);
                l[0] * (1.0 - a - b) + l[1] * a + l[2] * b
            };
            // Mapped lattice rows: row `j` holds points `i = 0..=k-j`.
            let mut rows: Vec<Vec<Vec3>> = Vec::with_capacity(k + 1);
            for j in 0..=k {
                rows.push((0..=k - j).map(|i| self.place(at(i, j)).map(|f| f.point)).collect::<SurfaceResult<_>>()?);
            }
            for j in 0..k {
                let (Some(r0), Some(r1)) = (rows.get(j), rows.get(j + 1)) else { continue };
                for i in 0..k - j {
                    let (Some(&a), Some(&b), Some(&c)) = (r0.get(i), r0.get(i + 1), r1.get(i)) else { continue };
                    out.push([a, b, c]);
                    if let (Some(&d), true) = (r1.get(i + 1), i + 1 < k - j) {
                        out.push([b, d, c]);
                    }
                }
            }
        }
        Ok(out)
    }

    /// Map an object rigidly: it is moved and oriented by `anchor` (the centre of its bounding
    /// box when `None`) and keeps its shape. Returns the mapped points and the anchor's frame.
    fn map_rigid(&self, pts: &[Vec3], anchor: Option<Vec3>) -> SurfaceResult<(Vec<Vec3>, FlowPoint)> {
        if pts.len() > MAX_FLOW_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        if pts.iter().any(|p| !p.is_finite()) {
            return Err(SurfaceError::NonFinite);
        }
        let anchor = match anchor {
            Some(a) => a,
            None => bbox_centre(pts).ok_or(SurfaceError::BadInput("nothing to flow"))?,
        };
        let base = self.base_axes(anchor)?;
        let fp = self.map_point(anchor)?;
        let out = pts
            .iter()
            .map(|&p| {
                let d = p - anchor;
                fp.point + fp.axes[0] * d.dot(base[0]) + fp.axes[1] * d.dot(base[1]) + fp.axes[2] * d.dot(base[2])
            })
            .collect();
        Ok((out, fp))
    }
}

fn lerp(a: Vec3, b: Vec3, f: f64) -> Vec3 {
    a + (b - a) * f
}

/// The centre of the bounding box of `pts`.
pub fn bbox_centre(pts: &[Vec3]) -> Option<Vec3> {
    let first = *pts.first()?;
    let (mut lo, mut hi) = (first, first);
    for p in pts {
        lo = Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
        hi = Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
    }
    Some((lo + hi) * 0.5)
}

/// Bisect local segment `a → b` (mapped ends `pa`, `pb`) until the mapped midpoint is within
/// `tol` of the chord; pushes every point after `pa`.
#[allow(clippy::too_many_arguments)]
fn bisect<F: Flow + ?Sized>(f: &F, a: Vec3, b: Vec3, pa: Vec3, pb: Vec3, tol: f64, depth: usize, out: &mut Vec<Vec3>) -> SurfaceResult<()> {
    if depth < MAX_FLOW_DEPTH {
        let m = lerp(a, b, 0.5);
        let pm = f.place(m)?.point;
        if (pm - lerp(pa, pb, 0.5)).len() > tol {
            bisect(f, a, m, pa, pm, tol, depth + 1, out)?;
            return bisect(f, m, b, pm, pb, tol, depth + 1, out);
        }
    }
    if out.len() >= MAX_FLOW_POINTS {
        return Err(SurfaceError::TooLarge);
    }
    out.push(pb);
    Ok(())
}

/// The bisection depth segment `a → b` needs (uniformly) for the tolerance.
fn needed_depth<F: Flow + ?Sized>(f: &F, a: Vec3, b: Vec3, pa: Vec3, pb: Vec3, tol: f64, depth: usize) -> SurfaceResult<usize> {
    if depth >= 6 {
        return Ok(depth);
    }
    let m = lerp(a, b, 0.5);
    let pm = f.place(m)?.point;
    if (pm - lerp(pa, pb, 0.5)).len() <= tol {
        return Ok(depth);
    }
    Ok(needed_depth(f, a, m, pa, pm, tol, depth + 1)?.max(needed_depth(f, m, b, pm, pb, tol, depth + 1)?))
}

fn clean_tol(tol: f64, extent: f64) -> f64 {
    let floor = (extent * 1e-7).max(1e-9);
    if tol.is_finite() && tol > 0.0 { tol.max(floor) } else { (extent * 1e-3).max(floor) }
}

fn finite(v: f64) -> SurfaceResult<f64> {
    if v.is_finite() { Ok(v) } else { Err(SurfaceError::NonFinite) }
}

// ------------------------------------------------------------------ surface flow

/// Where geometry is measured from.
#[derive(Clone, Debug, PartialEq)]
pub enum FlowBase {
    /// A rectangle: `origin` is a corner, `x_axis`/`y_axis` its directions (made orthonormal),
    /// `width`/`height` its size; the normal is `x × y`.
    Rect { origin: Vec3, x_axis: Vec3, y_axis: Vec3, width: f64, height: f64 },
    /// A base surface: points are found on it by closest point.
    Surface(NurbsSurface),
}

impl FlowBase {
    /// The rectangle `[x0, x0+width] × [y0, y0+height]` in the XY plane.
    pub fn rect_xy(x0: f64, y0: f64, width: f64, height: f64) -> Self {
        FlowBase::Rect { origin: Vec3::new(x0, y0, 0.0), x_axis: Vec3::new(1.0, 0.0, 0.0), y_axis: Vec3::new(0.0, 1.0, 0.0), width, height }
    }
}

#[derive(Clone, Debug)]
enum Base {
    Rect { origin: Vec3, axes: [Vec3; 3], width: f64, height: f64 },
    Surface { s: NurbsSurface, lu: ArcTable, lv: ArcTable },
}

/// Flow from a base onto a target surface.
#[derive(Clone, Debug)]
pub struct SurfaceFlow {
    base: Base,
    target: NurbsSurface,
    tu: ArcTable,
    tv: ArcTable,
    opts: FlowOptions,
    tol: f64,
}

fn middle_tables(s: &NurbsSurface) -> SurfaceResult<(ArcTable, ArcTable)> {
    let (ua, ub) = s.domain_u();
    let (va, vb) = s.domain_v();
    let (um, vm) = ((ua + ub) / 2.0, (va + vb) / 2.0);
    Ok((ArcTable::build(ua, ub, |u| s.point(u, vm))?, ArcTable::build(va, vb, |v| s.point(um, v))?))
}

/// Surface frame at `(u, v)`: `[S_u dir, N × S_u dir, N]` with `N` flipped when asked.
fn surface_axes(s: &NurbsSurface, u: f64, v: f64, flip: bool) -> SurfaceResult<(Vec3, [Vec3; 3])> {
    let d = s.derivs(u, v);
    let n = s.normal(u, v).ok_or(SurfaceError::BadInput("the surface has no normal there"))?;
    let mut x = d.du - n * d.du.dot(n);
    if x.len() < 1e-300 {
        x = d.dv.cross(n);
    }
    let x = x.normalized();
    if x.len() < 0.5 {
        return Err(SurfaceError::BadInput("the surface has no tangent there"));
    }
    let y = n.cross(x);
    let nn = if flip { -n } else { n };
    Ok((d.point, [x, y, nn]))
}

impl SurfaceFlow {
    pub fn new(base: FlowBase, target: NurbsSurface, opts: FlowOptions) -> SurfaceResult<Self> {
        finite(opts.offset)?;
        let base = match base {
            FlowBase::Rect { origin, x_axis, y_axis, width, height } => {
                if !(origin.is_finite() && x_axis.is_finite() && y_axis.is_finite()) {
                    return Err(SurfaceError::NonFinite);
                }
                let (width, height) = (finite(width)?, finite(height)?);
                if width <= 0.0 || height <= 0.0 {
                    return Err(SurfaceError::BadInput("the base rectangle needs a positive width and height"));
                }
                let x = x_axis.normalized();
                let y = (y_axis - x * y_axis.dot(x)).normalized();
                if x.len() < 0.5 || y.len() < 0.5 {
                    return Err(SurfaceError::BadInput("the base rectangle's axes are degenerate"));
                }
                Base::Rect { origin, axes: [x, y, x.cross(y)], width, height }
            }
            FlowBase::Surface(s) => {
                let (lu, lv) = middle_tables(&s)?;
                if lu.total() <= 0.0 || lv.total() <= 0.0 {
                    return Err(SurfaceError::BadInput("the base surface is degenerate"));
                }
                Base::Surface { s, lu, lv }
            }
        };
        let (tu, tv) = middle_tables(&target)?;
        if tu.total() <= 0.0 || tv.total() <= 0.0 {
            return Err(SurfaceError::BadInput("the target surface is degenerate"));
        }
        let mut f = SurfaceFlow { base, target, tu, tv, opts, tol: 0.0 };
        f.tol = clean_tol(opts.tol, f.extent());
        Ok(f)
    }

    /// The base's extent `(W, H)` (lengths along its two directions).
    pub fn base_size(&self) -> (f64, f64) {
        match &self.base {
            Base::Rect { width, height, .. } => (*width, *height),
            Base::Surface { lu, lv, .. } => (lu.total(), lv.total()),
        }
    }
    /// The target's extent along its middle iso-curves.
    pub fn target_size(&self) -> (f64, f64) {
        (self.tu.total(), self.tv.total())
    }
    pub fn target(&self) -> &NurbsSurface {
        &self.target
    }
}

impl Flow for SurfaceFlow {
    fn local(&self, p: Vec3) -> SurfaceResult<Vec3> {
        match &self.base {
            Base::Rect { origin, axes, .. } => {
                let d = p - *origin;
                Ok(Vec3::new(d.dot(axes[0]), d.dot(axes[1]), d.dot(axes[2])))
            }
            Base::Surface { s, lu, lv } => {
                let cp = s.closest_point(p)?;
                let (q, ax) = surface_axes(s, cp.u, cp.v, false)?;
                Ok(Vec3::new(lu.len_at(cp.u), lv.len_at(cp.v), (p - q).dot(ax[2])))
            }
        }
    }
    fn base_axes(&self, p: Vec3) -> SurfaceResult<[Vec3; 3]> {
        match &self.base {
            Base::Rect { axes, .. } => Ok(*axes),
            Base::Surface { s, .. } => {
                let cp = s.closest_point(p)?;
                Ok(surface_axes(s, cp.u, cp.v, false)?.1)
            }
        }
    }
    fn place(&self, l: Vec3) -> SurfaceResult<FlowPoint> {
        if !l.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        let (w, h) = self.base_size();
        let (su, sv) = if self.opts.stretch { (l.x / w * self.tu.total(), l.y / h * self.tv.total()) } else { (l.x, l.y) };
        let (u, iu) = self.tu.param_at(su);
        let (v, iv) = self.tv.param_at(sv);
        let (q, axes) = surface_axes(&self.target, u, v, self.opts.flip)?;
        let point = q + axes[2] * (l.z + self.opts.offset);
        if !point.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        Ok(FlowPoint { point, axes, u, v, inside: iu && iv })
    }
    fn extent(&self) -> f64 {
        let (w, h) = self.base_size();
        w.max(h)
    }
    fn tolerance(&self) -> f64 {
        self.tol
    }
}

// ------------------------------------------------------------------ curve flow

/// Flow from a base line onto a target curve with a rotation-minimising frame.
#[derive(Clone, Debug)]
pub struct CurveFlow {
    from: Vec3,
    base_axes: [Vec3; 3],
    base_len: f64,
    curve: NurbsCurve3,
    table: ArcTable,
    /// Rotation-minimising normals at the table's parameters.
    normals: Vec<Vec3>,
    opts: FlowOptions,
    tol: f64,
}

fn rotate_about(v: Vec3, axis: Vec3, ang: f64) -> Vec3 {
    let (s, c) = ang.sin_cos();
    v * c + axis.cross(v) * s + axis * (axis.dot(v) * (1.0 - c))
}

fn unit_tangent(c: &NurbsCurve3, t: f64, fallback: Vec3) -> Vec3 {
    let d = c.derivs(t)[1];
    if d.len() > 1e-300 && d.is_finite() { d.normalized() } else { fallback }
}

impl CurveFlow {
    /// Base line `from → to` (its axes: along the line, then `Z × dir` in plan, then up).
    pub fn new(from: Vec3, to: Vec3, curve: NurbsCurve3, opts: FlowOptions) -> SurfaceResult<Self> {
        if !(from.is_finite() && to.is_finite()) {
            return Err(SurfaceError::NonFinite);
        }
        finite(opts.offset)?;
        let base_len = (to - from).len();
        if base_len <= 1e-12 {
            return Err(SurfaceError::BadInput("the base line has no length"));
        }
        let dir = (to - from) * (1.0 / base_len);
        let side = Vec3::Z.cross(dir);
        let n0 = if side.len() > 1e-6 { side.normalized() } else { Vec3::new(1.0, 0.0, 0.0).cross(dir).normalized() };
        let b0 = dir.cross(n0);
        let (a, b) = curve.domain();
        let table = ArcTable::build(a, b, |t| curve.point(t))?;
        if table.total() <= 0.0 {
            return Err(SurfaceError::BadInput("the target curve has no length"));
        }
        // Initial normal: the minimal rotation taking the base direction to the start tangent.
        let t0 = unit_tangent(&curve, a, dir);
        let axis = dir.cross(t0);
        let cos = dir.dot(t0).clamp(-1.0, 1.0);
        let mut r = if axis.len() > 1e-12 {
            rotate_about(n0, axis.normalized(), axis.len().atan2(cos))
        } else if cos < 0.0 {
            -n0
        } else {
            n0
        };
        r = (r - t0 * r.dot(t0)).normalized();
        let mut normals = Vec::with_capacity(table.params.len());
        let mut prev: Option<(Vec3, Vec3)> = None;
        let mut tan = t0;
        for &t in &table.params {
            let x1 = curve.point(t);
            let t1 = unit_tangent(&curve, t, tan);
            if let Some((x0, r0)) = prev {
                // Double reflection.
                let v1 = x1 - x0;
                let c1 = v1.dot(v1);
                let (rl, tl) = if c1 > 1e-300 { (r0 - v1 * (2.0 / c1 * v1.dot(r0)), tan - v1 * (2.0 / c1 * v1.dot(tan))) } else { (r0, tan) };
                let v2 = t1 - tl;
                let c2 = v2.dot(v2);
                let rr = if c2 > 1e-300 { rl - v2 * (2.0 / c2 * v2.dot(rl)) } else { rl };
                let rr = (rr - t1 * rr.dot(t1)).normalized();
                r = if rr.len() > 0.5 { rr } else { r0 };
            }
            if !r.is_finite() {
                return Err(SurfaceError::NonFinite);
            }
            normals.push(r);
            prev = Some((x1, r));
            tan = t1;
        }
        let mut f = CurveFlow { from, base_axes: [dir, n0, b0], base_len, curve, table, normals, opts, tol: 0.0 };
        f.tol = clean_tol(opts.tol, base_len);
        Ok(f)
    }
    /// The target curve's length.
    pub fn target_len(&self) -> f64 {
        self.table.total()
    }
}

impl Flow for CurveFlow {
    fn local(&self, p: Vec3) -> SurfaceResult<Vec3> {
        let d = p - self.from;
        Ok(Vec3::new(d.dot(self.base_axes[0]), d.dot(self.base_axes[1]), d.dot(self.base_axes[2])))
    }
    fn base_axes(&self, _p: Vec3) -> SurfaceResult<[Vec3; 3]> {
        Ok(self.base_axes)
    }
    fn place(&self, l: Vec3) -> SurfaceResult<FlowPoint> {
        if !l.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        let s = if self.opts.stretch { l.x / self.base_len * self.table.total() } else { l.x };
        let (t, inside) = self.table.param_at(s);
        let i = self.table.params.partition_point(|&p| p < t).max(1);
        let (t0, t1) = (self.table.params.get(i - 1).copied().unwrap_or(t), self.table.params.get(i).copied().unwrap_or(t));
        let f = if t1 > t0 { ((t - t0) / (t1 - t0)).clamp(0.0, 1.0) } else { 0.0 };
        let n0 = self.normals.get(i - 1).copied().unwrap_or(self.base_axes[1]);
        let n1 = self.normals.get(i).copied().unwrap_or(n0);
        let tan = unit_tangent(&self.curve, t, self.base_axes[0]);
        let mut n = lerp(n0, n1, f);
        n = (n - tan * n.dot(tan)).normalized();
        if n.len() < 0.5 {
            n = (n0 - tan * n0.dot(tan)).normalized();
        }
        let mut up = tan.cross(n);
        if self.opts.flip {
            up = -up;
        }
        let point = self.curve.point(t) + n * l.y + up * (l.z + self.opts.offset);
        if !point.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        Ok(FlowPoint { point, axes: [tan, n, up], u: t, v: 0.0, inside })
    }
    fn extent(&self) -> f64 {
        self.base_len
    }
    fn tolerance(&self) -> f64 {
        self.tol
    }
}

/// A clamped, uniform-knot NURBS surface from a row-major control net (`points[i·count_v + j]`).
pub fn surface_from_net(
    degree_u: usize,
    degree_v: usize,
    count_u: usize,
    count_v: usize,
    points: Vec<Vec3>,
    weights: Vec<f64>,
) -> SurfaceResult<NurbsSurface> {
    if degree_u == 0 || degree_v == 0 || degree_u >= count_u || degree_v >= count_v {
        return Err(SurfaceError::Degree);
    }
    let ku = crate::spline::clamped_uniform_knots(count_u, degree_u);
    let kv = crate::spline::clamped_uniform_knots(count_v, degree_v);
    NurbsSurface::new(degree_u, degree_v, ku, kv, count_u, count_v, points, weights)
}

#[cfg(test)]
#[path = "flow_tests.rs"]
mod tests;
