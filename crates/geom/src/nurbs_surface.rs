//! NURBS curves in 3D and tensor-product NURBS surfaces.
//!
//! Written from the mathematics of B-splines (Cox–de Boor recursion, the derivative recurrence
//! of the basis functions, Boehm knot insertion, Bézier degree elevation, the quotient rule for
//! rational derivatives). Everything works in homogeneous coordinates `(w·x, w·y, w·z, w)`, so
//! the rational operations are exact: knot insertion and degree elevation change the
//! representation, never the shape.
//!
//! The basis functions are the curve code's (`spline::basis`, `spline::find_span`); this module
//! adds their derivatives and the surface tensor product on top.
//!
//! Never crash: every constructor validates (degree, knot count and order, multiplicities,
//! finite coordinates, weights > 0, size caps) and returns a [`SurfaceError`]; evaluation takes
//! any `f64` (non-finite parameters evaluate at the domain start, others are clamped into it).

use std::fmt;

use crate::Vec3;
use crate::spline::{Spline, basis, find_span};

/// Highest degree a surface or 3D curve may have in either direction.
pub const MAX_SURFACE_DEGREE: usize = 24;
/// Most control points a surface may have (`count_u · count_v`).
pub const MAX_SURFACE_POINTS: usize = 1 << 20;
/// Most control points a 3D curve may have.
pub const MAX_CURVE_POINTS: usize = 1 << 16;

/// Why a NURBS operation was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SurfaceError {
    /// Degree is 0 or above [`MAX_SURFACE_DEGREE`], or too few control points for it.
    Degree,
    /// The knot vector does not have `count + degree + 1` entries.
    KnotCount,
    /// Knots are non-finite or decreasing.
    KnotOrder,
    /// A knot repeats more often than the degree allows (or an insertion would exceed it).
    KnotMultiplicity,
    /// The parameter domain has zero length.
    EmptyDomain,
    /// A weight is non-finite or not positive (or would become so).
    Weight,
    /// A coordinate or parameter is NaN or infinite.
    NonFinite,
    /// The control grid, sample count or output would exceed the caps.
    TooLarge,
    /// The input is geometrically unusable (the message says why).
    BadInput(&'static str),
    /// An iteration did not converge within its bound.
    NoConvergence,
    /// The surface is not closed (volume needs a closed surface).
    NotClosed,
}

impl fmt::Display for SurfaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SurfaceError::Degree => write!(f, "invalid degree for the number of control points"),
            SurfaceError::KnotCount => write!(f, "wrong number of knots"),
            SurfaceError::KnotOrder => write!(f, "knots must be finite and non-decreasing"),
            SurfaceError::KnotMultiplicity => write!(f, "knot multiplicity exceeds the degree"),
            SurfaceError::EmptyDomain => write!(f, "empty parameter domain"),
            SurfaceError::Weight => write!(f, "weights must be finite and positive"),
            SurfaceError::NonFinite => write!(f, "non-finite coordinate or parameter"),
            SurfaceError::TooLarge => write!(f, "too large"),
            SurfaceError::BadInput(m) => write!(f, "{m}"),
            SurfaceError::NoConvergence => write!(f, "did not converge"),
            SurfaceError::NotClosed => write!(f, "surface is not closed"),
        }
    }
}

impl std::error::Error for SurfaceError {}

pub type SurfaceResult<T> = Result<T, SurfaceError>;

/// A homogeneous point `(w·x, w·y, w·z, w)`.
pub(crate) type H4 = [f64; 4];

pub(crate) fn to_h(p: Vec3, w: f64) -> H4 {
    [p.x * w, p.y * w, p.z * w, w]
}
fn h_xyz(h: H4) -> Vec3 {
    Vec3::new(h[0], h[1], h[2])
}
fn h_axpy(acc: &mut H4, s: f64, h: H4) {
    for (a, b) in acc.iter_mut().zip(h) {
        *a += s * b;
    }
}
fn h_lerp(a: H4, b: H4, t: f64) -> H4 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}
fn from_h(h: H4) -> SurfaceResult<(Vec3, f64)> {
    let w = h[3];
    if !(w.is_finite() && w > 0.0) {
        return Err(SurfaceError::Weight);
    }
    let p = Vec3::new(h[0] / w, h[1] / w, h[2] / w);
    if !p.is_finite() {
        return Err(SurfaceError::NonFinite);
    }
    Ok((p, w))
}

// ---------- knots and basis derivatives ----------

/// Checks a knot vector for `n` control points of degree `p`.
pub(crate) fn check_knots(knots: &[f64], n: usize, p: usize) -> SurfaceResult<()> {
    if p == 0 || p > MAX_SURFACE_DEGREE || n < p + 1 {
        return Err(SurfaceError::Degree);
    }
    if knots.len() != n + p + 1 {
        return Err(SurfaceError::KnotCount);
    }
    if knots.iter().any(|k| !k.is_finite()) || knots.windows(2).any(|w| w.get(1) < w.first()) {
        return Err(SurfaceError::KnotOrder);
    }
    let (a, b) = (knots.get(p).copied().unwrap_or(0.0), knots.get(n).copied().unwrap_or(0.0));
    if b - a <= 0.0 || !(b - a).is_finite() {
        return Err(SurfaceError::EmptyDomain);
    }
    let mut i = 0;
    while i < knots.len() {
        let k = knots.get(i).copied().unwrap_or(0.0);
        let mut m = 1;
        while knots.get(i + m) == Some(&k) {
            m += 1;
        }
        let interior = k > a && k < b;
        if m > p + 1 || (interior && m > p) {
            return Err(SurfaceError::KnotMultiplicity);
        }
        i += m;
    }
    Ok(())
}

/// Clamps `t` into `[a, b]`; NaN/infinite becomes `a`.
pub(crate) fn clamp_param(t: f64, a: f64, b: f64) -> f64 {
    if t.is_finite() { t.clamp(a, b) } else { a }
}

/// The `d`-th derivatives of the `p + 1` basis functions non-zero in `span`, from the recurrence
/// `N'ᵢ,ₚ = p·(Nᵢ,ₚ₋₁ / (uᵢ₊ₚ − uᵢ) − Nᵢ₊₁,ₚ₋₁ / (uᵢ₊ₚ₊₁ − uᵢ₊₁))` applied `d` times (0/0 = 0).
pub(crate) fn basis_derivs(span: usize, u: f64, p: usize, knots: &[f64], d: usize) -> Vec<f64> {
    if d == 0 {
        return basis(span, u, p, knots);
    }
    if d > p {
        return vec![0.0; p + 1];
    }
    // Derivatives of order d − 1 of the degree p − 1 functions span−p+1 ..= span.
    let lower = basis_derivs(span, u, p - 1, knots, d - 1);
    let k = |i: usize| knots.get(i).copied().unwrap_or(0.0);
    let pf = p as f64;
    (0..=p)
        .map(|a| {
            let i = (span + a).saturating_sub(p); // function index span − p + a
            let left = if a >= 1 { lower.get(a - 1).copied().unwrap_or(0.0) } else { 0.0 };
            let right = lower.get(a).copied().unwrap_or(0.0);
            let d1 = k(i + p) - k(i);
            let d2 = k(i + p + 1) - k(i + 1);
            let t1 = if d1 > 0.0 { left / d1 } else { 0.0 };
            let t2 = if d2 > 0.0 { right / d2 } else { 0.0 };
            pf * (t1 - t2)
        })
        .collect()
}

/// Homogeneous curve derivatives `0..=d` at `t` (clamped into the domain).
fn h_curve_derivs(p: usize, knots: &[f64], pts: &[H4], t: f64, d: usize) -> Vec<H4> {
    let n = pts.len();
    let (a, b) = (knots.get(p).copied().unwrap_or(0.0), knots.get(n).copied().unwrap_or(1.0));
    let t = clamp_param(t, a, b);
    let span = find_span(n.saturating_sub(1), p, t, knots);
    (0..=d)
        .map(|k| {
            let nb = basis_derivs(span, t, p, knots, k);
            let mut acc = [0.0; 4];
            for (r, nv) in nb.iter().enumerate() {
                if let Some(h) = pts.get((span + r).saturating_sub(p)) {
                    h_axpy(&mut acc, *nv, *h);
                }
            }
            acc
        })
        .collect()
}

/// Boehm insertion of `t` once into a homogeneous curve; `t` must lie strictly inside the domain
/// and have multiplicity below `p`.
fn h_insert(p: usize, knots: &[f64], pts: &[H4], t: f64) -> SurfaceResult<(Vec<f64>, Vec<H4>)> {
    let n = pts.len();
    if !t.is_finite() {
        return Err(SurfaceError::NonFinite);
    }
    let (a, b) = (knots.get(p).copied().unwrap_or(0.0), knots.get(n).copied().unwrap_or(0.0));
    if !(t > a && t < b) {
        return Err(SurfaceError::BadInput("knot must lie inside the domain"));
    }
    let s = knots.iter().filter(|&&k| k == t).count();
    if s >= p {
        return Err(SurfaceError::KnotMultiplicity);
    }
    if n + 1 > MAX_SURFACE_POINTS {
        return Err(SurfaceError::TooLarge);
    }
    let k = find_span(n - 1, p, t, knots);
    let kv = |i: usize| knots.get(i).copied().unwrap_or(0.0);
    let mut out = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let q = if i + p <= k {
            pts.get(i).copied()
        } else if i + s > k {
            i.checked_sub(1).and_then(|m| pts.get(m)).copied()
        } else {
            let den = kv(i + p) - kv(i);
            let alpha = if den > 0.0 { (t - kv(i)) / den } else { 0.0 };
            match (i.checked_sub(1).and_then(|m| pts.get(m)), pts.get(i)) {
                (Some(&p0), Some(&p1)) => Some(h_lerp(p0, p1, alpha)),
                _ => None,
            }
        };
        out.push(q.ok_or(SurfaceError::BadInput("internal: insertion index"))?);
    }
    let mut nk = Vec::with_capacity(knots.len() + 1);
    nk.extend_from_slice(knots.get(..=k).unwrap_or(knots));
    nk.push(t);
    nk.extend_from_slice(knots.get(k + 1..).unwrap_or(&[]));
    Ok((nk, out))
}

fn is_clamped(p: usize, knots: &[f64]) -> bool {
    let first = knots.first().copied();
    let last = knots.last().copied();
    knots.iter().take(p + 1).all(|&k| Some(k) == first) && knots.iter().rev().take(p + 1).all(|&k| Some(k) == last)
}

/// One-degree elevation of a clamped homogeneous curve: split into Bézier pieces, elevate each
/// (`Qᵢ = i/(p+1)·Pᵢ₋₁ + (1 − i/(p+1))·Pᵢ`), join. Exact; interior knots end with
/// multiplicity `p + 1` (no knot removal).
fn h_elevate(p: usize, knots: &[f64], pts: &[H4]) -> SurfaceResult<(Vec<f64>, Vec<H4>)> {
    if !is_clamped(p, knots) {
        return Err(SurfaceError::BadInput("degree elevation needs a clamped knot vector"));
    }
    if p + 1 > MAX_SURFACE_DEGREE {
        return Err(SurfaceError::Degree);
    }
    let (mut kn, mut pt) = (knots.to_vec(), pts.to_vec());
    let n = pts.len();
    let (a, b) = (knots.get(p).copied().unwrap_or(0.0), knots.get(n).copied().unwrap_or(0.0));
    let mut interior: Vec<f64> = knots.iter().copied().filter(|&k| k > a && k < b).collect();
    interior.dedup();
    if (interior.len() + 1).saturating_mul(p + 2) > MAX_SURFACE_POINTS {
        return Err(SurfaceError::TooLarge);
    }
    for &t in &interior {
        while kn.iter().filter(|&&k| k == t).count() < p {
            let (k2, p2) = h_insert(p, &kn, &pt, t)?;
            kn = k2;
            pt = p2;
        }
    }
    let segs = interior.len() + 1;
    let mut out: Vec<H4> = Vec::with_capacity(segs * (p + 1) + 1);
    for s in 0..segs {
        let seg = pt.get(s * p..=s * p + p).ok_or(SurfaceError::BadInput("internal: bezier split"))?;
        let q = p + 1;
        for i in 0..=q {
            if s > 0 && i == 0 {
                continue;
            }
            let c = i as f64 / q as f64;
            let prev = if i >= 1 { seg.get(i - 1).copied() } else { None };
            let cur = seg.get(i).copied();
            let v = match (prev, cur) {
                (Some(a0), Some(a1)) => h_lerp(a1, a0, c),
                (None, Some(a1)) => a1,
                (Some(a0), None) => a0,
                (None, None) => return Err(SurfaceError::BadInput("internal: bezier elevate")),
            };
            out.push(v);
        }
    }
    let mut nk = vec![a; p + 2];
    for &t in &interior {
        nk.extend(std::iter::repeat_n(t, p + 1));
    }
    nk.extend(std::iter::repeat_n(b, p + 2));
    Ok((nk, out))
}

/// Rational value and first two derivatives from homogeneous ones (quotient rule).
fn rational_curve(h: &[H4]) -> [Vec3; 3] {
    let g = |i: usize| h.get(i).copied().unwrap_or([0.0; 4]);
    let (h0, h1, h2) = (g(0), g(1), g(2));
    let w = if h0[3] > 0.0 { h0[3] } else { 1.0 };
    let c0 = h_xyz(h0) * (1.0 / w);
    let c1 = (h_xyz(h1) - c0 * h1[3]) * (1.0 / w);
    let c2 = (h_xyz(h2) - c1 * (2.0 * h1[3]) - c0 * h2[3]) * (1.0 / w);
    [c0, c1, c2]
}

// ---------- 3D curve ----------

/// A NURBS curve in 3D (the building block of surface constructors).
#[derive(Clone, Debug, PartialEq)]
pub struct NurbsCurve3 {
    degree: usize,
    knots: Vec<f64>,
    points: Vec<Vec3>,
    weights: Vec<f64>,
}

impl NurbsCurve3 {
    /// A validated curve. `weights` empty means all 1.
    pub fn new(degree: usize, knots: Vec<f64>, points: Vec<Vec3>, weights: Vec<f64>) -> SurfaceResult<Self> {
        if points.len() > MAX_CURVE_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        let weights = if weights.is_empty() { vec![1.0; points.len()] } else { weights };
        if weights.len() != points.len() {
            return Err(SurfaceError::BadInput("one weight per control point"));
        }
        check_knots(&knots, points.len(), degree)?;
        if points.iter().any(|p| !p.is_finite()) {
            return Err(SurfaceError::NonFinite);
        }
        if weights.iter().any(|w| !(w.is_finite() && *w > 0.0)) {
            return Err(SurfaceError::Weight);
        }
        Ok(NurbsCurve3 { degree, knots, points, weights })
    }

    /// A clamped uniform non-rational curve through (approximating) `points`.
    pub fn from_control(points: Vec<Vec3>, degree: usize) -> SurfaceResult<Self> {
        if degree == 0 || degree > MAX_SURFACE_DEGREE || points.len() < degree + 1 {
            return Err(SurfaceError::Degree);
        }
        let knots = crate::spline::clamped_uniform_knots(points.len(), degree);
        NurbsCurve3::new(degree, knots, points, Vec::new())
    }

    /// The segment `a → b` as a degree-1 curve.
    pub fn line(a: Vec3, b: Vec3) -> SurfaceResult<Self> {
        NurbsCurve3::new(1, vec![0.0, 0.0, 1.0, 1.0], vec![a, b], Vec::new())
    }

    /// The circular arc `center + r·(cos θ·x + sin θ·y)` for θ from `start` over `sweep` as an
    /// exact rational quadratic (pieces of at most a quarter turn). `x` and `y` are made
    /// orthonormal (`y` is re-orthogonalised against `x`).
    pub fn arc(center: Vec3, x: Vec3, y: Vec3, radius: f64, start: f64, sweep: f64) -> SurfaceResult<Self> {
        if !(center.is_finite() && x.is_finite() && y.is_finite() && radius.is_finite() && start.is_finite() && sweep.is_finite()) {
            return Err(SurfaceError::NonFinite);
        }
        let xu = x.normalized();
        let yu = (y - xu * y.dot(xu)).normalized();
        if xu.len() < 0.5 || yu.len() < 0.5 || radius <= 0.0 || sweep.abs() < 1e-12 || sweep.abs() > std::f64::consts::TAU + 1e-12 {
            return Err(SurfaceError::BadInput("degenerate arc"));
        }
        let (pts, wts, knots) = arc_ring(center, xu * radius, yu * radius, start, sweep);
        NurbsCurve3::new(2, knots, pts, wts)
    }

    /// The full circle of `radius` about `center` in the plane with unit `normal`.
    pub fn circle(center: Vec3, normal: Vec3, radius: f64) -> SurfaceResult<Self> {
        let (x, y) = perpendicular_pair(normal).ok_or(SurfaceError::BadInput("zero normal"))?;
        NurbsCurve3::arc(center, x, y, radius, 0.0, std::f64::consts::TAU)
    }

    /// A 2D [`Spline`] lifted to the plane `z = 0`.
    pub fn from_spline(s: &Spline) -> SurfaceResult<Self> {
        let pts = s.control.iter().map(|p| p.to3(0.0)).collect();
        NurbsCurve3::new(s.degree, s.knots.clone(), pts, s.weights.clone())
    }

    pub fn degree(&self) -> usize {
        self.degree
    }
    pub fn knots(&self) -> &[f64] {
        &self.knots
    }
    pub fn points(&self) -> &[Vec3] {
        &self.points
    }
    pub fn weights(&self) -> &[f64] {
        &self.weights
    }
    /// `(t_min, t_max)`.
    pub fn domain(&self) -> (f64, f64) {
        let n = self.points.len();
        (self.knots.get(self.degree).copied().unwrap_or(0.0), self.knots.get(n).copied().unwrap_or(1.0))
    }
    pub fn is_rational(&self) -> bool {
        self.weights.iter().any(|w| (w - 1.0).abs() > 1e-15)
    }
    pub(crate) fn homogeneous(&self) -> Vec<H4> {
        self.points.iter().zip(&self.weights).map(|(p, w)| to_h(*p, *w)).collect()
    }
    fn from_parts(degree: usize, knots: Vec<f64>, h: &[H4]) -> SurfaceResult<Self> {
        let mut points = Vec::with_capacity(h.len());
        let mut weights = Vec::with_capacity(h.len());
        for &q in h {
            let (p, w) = from_h(q)?;
            points.push(p);
            weights.push(w);
        }
        NurbsCurve3::new(degree, knots, points, weights)
    }

    /// The point at `t`.
    pub fn point(&self, t: f64) -> Vec3 {
        self.derivs(t)[0]
    }
    /// `[C(t), C'(t), C''(t)]`.
    pub fn derivs(&self, t: f64) -> [Vec3; 3] {
        rational_curve(&h_curve_derivs(self.degree, &self.knots, &self.homogeneous(), t, 2))
    }
    /// The unit tangent at `t` (zero where the derivative vanishes).
    pub fn tangent(&self, t: f64) -> Vec3 {
        self.derivs(t)[1].normalized()
    }

    /// The curve with `t` inserted `times` times.
    pub fn insert_knot(&self, t: f64, times: usize) -> SurfaceResult<Self> {
        let (mut k, mut h) = (self.knots.clone(), self.homogeneous());
        for _ in 0..times.min(self.degree) {
            let r = h_insert(self.degree, &k, &h, t)?;
            k = r.0;
            h = r.1;
        }
        NurbsCurve3::from_parts(self.degree, k, &h)
    }

    /// The curve with its degree raised by `times` (clamped curves only).
    pub fn elevate(&self, times: usize) -> SurfaceResult<Self> {
        let (mut k, mut h, mut p) = (self.knots.clone(), self.homogeneous(), self.degree);
        for _ in 0..times {
            let r = h_elevate(p, &k, &h)?;
            k = r.0;
            h = r.1;
            p += 1;
        }
        NurbsCurve3::from_parts(p, k, &h)
    }

    /// The same curve with its domain mapped affinely onto `[a, b]`.
    pub fn reparam(&self, a: f64, b: f64) -> SurfaceResult<Self> {
        let (t0, t1) = self.domain();
        if !(a.is_finite() && b.is_finite() && b > a) {
            return Err(SurfaceError::EmptyDomain);
        }
        let s = (b - a) / (t1 - t0);
        let knots = self.knots.iter().map(|k| a + (k - t0) * s).collect();
        NurbsCurve3::new(self.degree, knots, self.points.clone(), self.weights.clone())
    }

    /// The curve transformed point-wise by `f` (affine maps keep it exact).
    pub fn map(&self, f: impl Fn(Vec3) -> Vec3) -> SurfaceResult<Self> {
        NurbsCurve3::new(self.degree, self.knots.clone(), self.points.iter().map(|p| f(*p)).collect(), self.weights.clone())
    }

    pub fn is_clamped(&self) -> bool {
        is_clamped(self.degree, &self.knots)
    }

    /// Whether the end meets the start within `tol`.
    pub fn is_closed(&self, tol: f64) -> bool {
        let (a, b) = self.domain();
        (self.point(a) - self.point(b)).len() <= tol
    }
}

/// Two unit vectors completing `n` to a right-handed orthonormal frame.
pub(crate) fn perpendicular_pair(n: Vec3) -> Option<(Vec3, Vec3)> {
    let n = n.normalized();
    if !n.is_finite() || n.len() < 0.5 {
        return None;
    }
    let helper = if n.x.abs() <= n.y.abs() && n.x.abs() <= n.z.abs() {
        Vec3::new(1.0, 0.0, 0.0)
    } else if n.y.abs() <= n.z.abs() {
        Vec3::new(0.0, 1.0, 0.0)
    } else {
        Vec3::Z
    };
    let x = (helper - n * helper.dot(n)).normalized();
    let y = n.cross(x);
    Some((x, y))
}

/// The control points, weights and knots of the arc `center + cos θ·x + sin θ·y` (x, y carry the
/// radius), split into `k ≤ 4` equal pieces of at most 90°, knots in `[0, 1]`.
pub(crate) fn arc_ring(center: Vec3, x: Vec3, y: Vec3, start: f64, sweep: f64) -> (Vec<Vec3>, Vec<f64>, Vec<f64>) {
    let k = ((sweep.abs() / std::f64::consts::FRAC_PI_2) - 1e-9).ceil().clamp(1.0, 4.0) as usize;
    let d = sweep / k as f64;
    let w = (d / 2.0).cos();
    let at = |t: f64, s: f64| center + (x * t.cos() + y * t.sin()) * s;
    let mut pts = vec![at(start, 1.0)];
    let mut wts = vec![1.0];
    for i in 0..k {
        let a0 = start + d * i as f64;
        pts.push(at(a0 + d / 2.0, 1.0 / w));
        wts.push(w);
        pts.push(at(a0 + d, 1.0));
        wts.push(1.0);
    }
    let mut knots = vec![0.0; 3];
    for i in 1..k {
        let t = i as f64 / k as f64;
        knots.push(t);
        knots.push(t);
    }
    knots.extend([1.0; 3]);
    (pts, wts, knots)
}

// ---------- surface ----------

/// A point on a surface with its first and second partial derivatives.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SurfaceDerivs {
    pub point: Vec3,
    pub du: Vec3,
    pub dv: Vec3,
    pub duu: Vec3,
    pub duv: Vec3,
    pub dvv: Vec3,
}

/// A tensor-product NURBS surface. Control points are stored row-major: the point with u-index
/// `i` and v-index `j` is `points[i · count_v + j]`.
#[derive(Clone, Debug, PartialEq)]
pub struct NurbsSurface {
    degree_u: usize,
    degree_v: usize,
    knots_u: Vec<f64>,
    knots_v: Vec<f64>,
    count_u: usize,
    count_v: usize,
    points: Vec<Vec3>,
    weights: Vec<f64>,
}

impl NurbsSurface {
    /// A validated surface. `weights` empty means all 1.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        degree_u: usize,
        degree_v: usize,
        knots_u: Vec<f64>,
        knots_v: Vec<f64>,
        count_u: usize,
        count_v: usize,
        points: Vec<Vec3>,
        weights: Vec<f64>,
    ) -> SurfaceResult<Self> {
        let total = count_u.checked_mul(count_v).ok_or(SurfaceError::TooLarge)?;
        if total > MAX_SURFACE_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        if points.len() != total {
            return Err(SurfaceError::BadInput("control grid size does not match count_u × count_v"));
        }
        let weights = if weights.is_empty() { vec![1.0; total] } else { weights };
        if weights.len() != total {
            return Err(SurfaceError::BadInput("one weight per control point"));
        }
        check_knots(&knots_u, count_u, degree_u)?;
        check_knots(&knots_v, count_v, degree_v)?;
        if points.iter().any(|p| !p.is_finite()) {
            return Err(SurfaceError::NonFinite);
        }
        if weights.iter().any(|w| !(w.is_finite() && *w > 0.0)) {
            return Err(SurfaceError::Weight);
        }
        Ok(NurbsSurface { degree_u, degree_v, knots_u, knots_v, count_u, count_v, points, weights })
    }

    fn from_h_grid(degree_u: usize, degree_v: usize, knots_u: Vec<f64>, knots_v: Vec<f64>, cu: usize, cv: usize, h: &[H4]) -> SurfaceResult<Self> {
        let mut points = Vec::with_capacity(h.len());
        let mut weights = Vec::with_capacity(h.len());
        for &q in h {
            let (p, w) = from_h(q)?;
            points.push(p);
            weights.push(w);
        }
        NurbsSurface::new(degree_u, degree_v, knots_u, knots_v, cu, cv, points, weights)
    }

    pub fn degree_u(&self) -> usize {
        self.degree_u
    }
    pub fn degree_v(&self) -> usize {
        self.degree_v
    }
    pub fn knots_u(&self) -> &[f64] {
        &self.knots_u
    }
    pub fn knots_v(&self) -> &[f64] {
        &self.knots_v
    }
    pub fn count_u(&self) -> usize {
        self.count_u
    }
    pub fn count_v(&self) -> usize {
        self.count_v
    }
    pub fn points(&self) -> &[Vec3] {
        &self.points
    }
    pub fn weights(&self) -> &[f64] {
        &self.weights
    }
    /// The control point `(i, j)`.
    pub fn control(&self, i: usize, j: usize) -> Option<(Vec3, f64)> {
        if i >= self.count_u || j >= self.count_v {
            return None;
        }
        let k = i * self.count_v + j;
        Some((*self.points.get(k)?, *self.weights.get(k)?))
    }
    pub fn domain_u(&self) -> (f64, f64) {
        (self.knots_u.get(self.degree_u).copied().unwrap_or(0.0), self.knots_u.get(self.count_u).copied().unwrap_or(1.0))
    }
    pub fn domain_v(&self) -> (f64, f64) {
        (self.knots_v.get(self.degree_v).copied().unwrap_or(0.0), self.knots_v.get(self.count_v).copied().unwrap_or(1.0))
    }
    pub fn is_rational(&self) -> bool {
        self.weights.iter().any(|w| (w - 1.0).abs() > 1e-15)
    }
    fn hw(&self, i: usize, j: usize) -> H4 {
        let k = i * self.count_v + j;
        match (self.points.get(k), self.weights.get(k)) {
            (Some(p), Some(w)) => to_h(*p, *w),
            _ => [0.0; 4],
        }
    }
    /// The distinct knot values of the u domain (span breaks), ascending.
    pub fn breaks_u(&self) -> Vec<f64> {
        breaks(&self.knots_u, self.domain_u())
    }
    pub fn breaks_v(&self) -> Vec<f64> {
        breaks(&self.knots_v, self.domain_v())
    }
    /// The diagonal of the control points' bounding box (a scale for tolerances).
    pub fn size(&self) -> f64 {
        let mut lo = Vec3::new(f64::MAX, f64::MAX, f64::MAX);
        let mut hi = Vec3::new(f64::MIN, f64::MIN, f64::MIN);
        for p in &self.points {
            lo = Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
            hi = Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
        }
        let d = (hi - lo).len();
        if d.is_finite() { d } else { 0.0 }
    }

    fn spans(&self, u: f64, v: f64) -> (f64, f64, usize, usize) {
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        let u = clamp_param(u, ua, ub);
        let v = clamp_param(v, va, vb);
        let su = find_span(self.count_u - 1, self.degree_u, u, &self.knots_u);
        let sv = find_span(self.count_v - 1, self.degree_v, v, &self.knots_v);
        (u, v, su, sv)
    }

    /// Homogeneous point from precomputed spans and basis values.
    fn combine(&self, su: usize, nu: &[f64], sv: usize, nv: &[f64]) -> H4 {
        let mut acc = [0.0; 4];
        let (pu, pv) = (self.degree_u, self.degree_v);
        for (a, bu) in nu.iter().enumerate() {
            if *bu == 0.0 {
                continue;
            }
            let i = (su + a).saturating_sub(pu);
            let mut row = [0.0; 4];
            for (b, bv) in nv.iter().enumerate() {
                h_axpy(&mut row, *bv, self.hw(i, (sv + b).saturating_sub(pv)));
            }
            h_axpy(&mut acc, *bu, row);
        }
        acc
    }

    /// The point at `(u, v)` (parameters clamped into the domain; non-finite → domain start).
    pub fn point(&self, u: f64, v: f64) -> Vec3 {
        let (u, v, su, sv) = self.spans(u, v);
        let nu = basis(su, u, self.degree_u, &self.knots_u);
        let nv = basis(sv, v, self.degree_v, &self.knots_v);
        let h = self.combine(su, &nu, sv, &nv);
        if h[3] > 0.0 { h_xyz(h) * (1.0 / h[3]) } else { Vec3::ZERO }
    }

    /// The point and its first and second partial derivatives at `(u, v)` (the rational quotient
    /// rule applied to the homogeneous derivatives).
    pub fn derivs(&self, u: f64, v: f64) -> SurfaceDerivs {
        let (u, v, su, sv) = self.spans(u, v);
        let nu: Vec<Vec<f64>> = (0..=2).map(|d| basis_derivs(su, u, self.degree_u, &self.knots_u, d)).collect();
        let nv: Vec<Vec<f64>> = (0..=2).map(|d| basis_derivs(sv, v, self.degree_v, &self.knots_v, d)).collect();
        let e = |k: usize, l: usize| match (nu.get(k), nv.get(l)) {
            (Some(a), Some(b)) => self.combine(su, a, sv, b),
            _ => [0.0; 4],
        };
        let (a00, a10, a01, a20, a11, a02) = (e(0, 0), e(1, 0), e(0, 1), e(2, 0), e(1, 1), e(0, 2));
        let w = if a00[3] > 0.0 { a00[3] } else { 1.0 };
        let iw = 1.0 / w;
        let s00 = h_xyz(a00) * iw;
        let s10 = (h_xyz(a10) - s00 * a10[3]) * iw;
        let s01 = (h_xyz(a01) - s00 * a01[3]) * iw;
        let s20 = (h_xyz(a20) - s10 * (2.0 * a10[3]) - s00 * a20[3]) * iw;
        let s02 = (h_xyz(a02) - s01 * (2.0 * a01[3]) - s00 * a02[3]) * iw;
        let s11 = (h_xyz(a11) - s00 * a11[3] - s01 * a10[3] - s10 * a01[3]) * iw;
        SurfaceDerivs { point: s00, du: s10, dv: s01, duu: s20, duv: s11, dvv: s02 }
    }

    /// The unit normal `S_u × S_v` at `(u, v)`. Where it degenerates (a pole such as a sphere's,
    /// a collapsed edge) the normal is taken a little way into the domain; `None` when it stays
    /// degenerate.
    pub fn normal(&self, u: f64, v: f64) -> Option<Vec3> {
        let d = self.derivs(u, v);
        let n = d.du.cross(d.dv);
        let scale = (d.du.len() + d.dv.len()).powi(2);
        if n.len() > 1e-10 * scale && n.len() > 1e-300 {
            return Some(n.normalized());
        }
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        let (uc, vc) = ((ua + ub) / 2.0, (va + vb) / 2.0);
        for f in [1e-6, 1e-4, 1e-2] {
            let uu = u + (uc - u) * f;
            let vv = v + (vc - v) * f;
            let d = self.derivs(uu, vv);
            let n = d.du.cross(d.dv);
            if n.len() > 1e-10 * (d.du.len() + d.dv.len()).powi(2) && n.len() > 1e-300 {
                return Some(n.normalized());
            }
        }
        None
    }

    /// Points at every `(us[i], vs[j])`, row-major (`i · vs.len() + j`). Basis functions are
    /// computed once per parameter, so a grid costs `O(n·(p+1)(q+1))`.
    pub fn eval_grid(&self, us: &[f64], vs: &[f64]) -> SurfaceResult<Vec<Vec3>> {
        let total = us.len().checked_mul(vs.len()).ok_or(SurfaceError::TooLarge)?;
        if total > 16 * MAX_SURFACE_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        let bu: Vec<(usize, Vec<f64>)> = us
            .iter()
            .map(|&u| {
                let u = clamp_param(u, ua, ub);
                let s = find_span(self.count_u - 1, self.degree_u, u, &self.knots_u);
                (s, basis(s, u, self.degree_u, &self.knots_u))
            })
            .collect();
        let bv: Vec<(usize, Vec<f64>)> = vs
            .iter()
            .map(|&v| {
                let v = clamp_param(v, va, vb);
                let s = find_span(self.count_v - 1, self.degree_v, v, &self.knots_v);
                (s, basis(s, v, self.degree_v, &self.knots_v))
            })
            .collect();
        let mut out = Vec::with_capacity(total);
        for (su, nu) in &bu {
            for (sv, nv) in &bv {
                let h = self.combine(*su, nu, *sv, nv);
                out.push(if h[3] > 0.0 { h_xyz(h) * (1.0 / h[3]) } else { Vec3::ZERO });
            }
        }
        Ok(out)
    }

    /// The isoparametric curve `u = const` (a curve in v).
    pub fn iso_u(&self, u: f64) -> SurfaceResult<NurbsCurve3> {
        let (ua, ub) = self.domain_u();
        let u = clamp_param(u, ua, ub);
        let su = find_span(self.count_u - 1, self.degree_u, u, &self.knots_u);
        let nu = basis(su, u, self.degree_u, &self.knots_u);
        let h: Vec<H4> = (0..self.count_v)
            .map(|j| {
                let mut acc = [0.0; 4];
                for (a, b) in nu.iter().enumerate() {
                    h_axpy(&mut acc, *b, self.hw((su + a).saturating_sub(self.degree_u), j));
                }
                acc
            })
            .collect();
        NurbsCurve3::from_parts(self.degree_v, self.knots_v.clone(), &h)
    }

    /// The isoparametric curve `v = const` (a curve in u).
    pub fn iso_v(&self, v: f64) -> SurfaceResult<NurbsCurve3> {
        self.transposed()?.iso_u(v)
    }

    /// The same surface with u and v exchanged.
    pub fn transposed(&self) -> SurfaceResult<Self> {
        let mut pts = Vec::with_capacity(self.points.len());
        let mut wts = Vec::with_capacity(self.points.len());
        for j in 0..self.count_v {
            for i in 0..self.count_u {
                let k = i * self.count_v + j;
                pts.push(self.points.get(k).copied().unwrap_or_default());
                wts.push(self.weights.get(k).copied().unwrap_or(1.0));
            }
        }
        NurbsSurface::new(self.degree_v, self.degree_u, self.knots_v.clone(), self.knots_u.clone(), self.count_v, self.count_u, pts, wts)
    }

    /// Applies a homogeneous curve operation to every u-column (fixed j), rebuilding the grid.
    fn map_u_columns(&self, op: impl Fn(usize, &[f64], &[H4]) -> SurfaceResult<(usize, Vec<f64>, Vec<H4>)>) -> SurfaceResult<Self> {
        let mut cols: Vec<Vec<H4>> = Vec::with_capacity(self.count_v);
        let mut new_knots = Vec::new();
        let mut new_deg = self.degree_u;
        for j in 0..self.count_v {
            let col: Vec<H4> = (0..self.count_u).map(|i| self.hw(i, j)).collect();
            let (p, k, c) = op(self.degree_u, &self.knots_u, &col)?;
            new_deg = p;
            new_knots = k;
            cols.push(c);
        }
        let cu = cols.first().map_or(0, Vec::len);
        if cu.checked_mul(self.count_v).is_none_or(|t| t > MAX_SURFACE_POINTS) {
            return Err(SurfaceError::TooLarge);
        }
        let mut h = Vec::with_capacity(cu * self.count_v);
        for i in 0..cu {
            for c in &cols {
                h.push(c.get(i).copied().unwrap_or([0.0; 4]));
            }
        }
        NurbsSurface::from_h_grid(new_deg, self.degree_v, new_knots, self.knots_v.clone(), cu, self.count_v, &h)
    }

    /// The surface with `u = t` inserted `times` times (shape unchanged).
    pub fn insert_knot_u(&self, t: f64, times: usize) -> SurfaceResult<Self> {
        let times = times.min(self.degree_u);
        self.map_u_columns(|p, k, c| {
            let (mut k, mut c) = (k.to_vec(), c.to_vec());
            for _ in 0..times {
                let r = h_insert(p, &k, &c, t)?;
                k = r.0;
                c = r.1;
            }
            Ok((p, k, c))
        })
    }
    /// The surface with `v = t` inserted `times` times.
    pub fn insert_knot_v(&self, t: f64, times: usize) -> SurfaceResult<Self> {
        self.transposed()?.insert_knot_u(t, times)?.transposed()
    }
    /// Knot refinement in u: inserts every value of `ts` (each once, in order).
    pub fn refine_u(&self, ts: &[f64]) -> SurfaceResult<Self> {
        if ts.len() > MAX_CURVE_POINTS {
            return Err(SurfaceError::TooLarge);
        }
        self.map_u_columns(|p, k, c| {
            let (mut k, mut c) = (k.to_vec(), c.to_vec());
            for &t in ts {
                let r = h_insert(p, &k, &c, t)?;
                k = r.0;
                c = r.1;
            }
            Ok((p, k, c))
        })
    }
    pub fn refine_v(&self, ts: &[f64]) -> SurfaceResult<Self> {
        self.transposed()?.refine_u(ts)?.transposed()
    }
    /// The surface with its u degree raised by `times` (clamped knots in u only).
    pub fn elevate_u(&self, times: usize) -> SurfaceResult<Self> {
        if self.degree_u.saturating_add(times) > MAX_SURFACE_DEGREE {
            return Err(SurfaceError::Degree);
        }
        self.map_u_columns(|p, k, c| {
            let (mut k, mut c, mut p) = (k.to_vec(), c.to_vec(), p);
            for _ in 0..times {
                let r = h_elevate(p, &k, &c)?;
                k = r.0;
                c = r.1;
                p += 1;
            }
            Ok((p, k, c))
        })
    }
    pub fn elevate_v(&self, times: usize) -> SurfaceResult<Self> {
        self.transposed()?.elevate_u(times)?.transposed()
    }

    /// Whether the edges `u = u_min` and `u = u_max` coincide within `tol` (sampled).
    pub fn is_closed_u(&self, tol: f64) -> bool {
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        (0..=32).all(|k| {
            let v = va + (vb - va) * k as f64 / 32.0;
            (self.point(ua, v) - self.point(ub, v)).len() <= tol
        })
    }
    pub fn is_closed_v(&self, tol: f64) -> bool {
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        (0..=32).all(|k| {
            let u = ua + (ub - ua) * k as f64 / 32.0;
            (self.point(u, va) - self.point(u, vb)).len() <= tol
        })
    }
    /// Which of the four edges collapse to a point within `tol`: `[u_min, u_max, v_min, v_max]`.
    pub fn poles(&self, tol: f64) -> [bool; 4] {
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        let edge = |f: &dyn Fn(f64) -> Vec3| {
            let p0 = f(0.0);
            (1..=32).all(|k| (f(k as f64 / 32.0) - p0).len() <= tol)
        };
        [
            edge(&|t| self.point(ua, va + (vb - va) * t)),
            edge(&|t| self.point(ub, va + (vb - va) * t)),
            edge(&|t| self.point(ua + (ub - ua) * t, va)),
            edge(&|t| self.point(ua + (ub - ua) * t, vb)),
        ]
    }
    /// Whether the surface bounds a volume: each direction is closed or both its edges are poles.
    pub fn is_closed(&self, tol: f64) -> bool {
        let p = self.poles(tol);
        let u_ok = self.is_closed_u(tol) || (p[0] && p[1]);
        let v_ok = self.is_closed_v(tol) || (p[2] && p[3]);
        // A torus is closed in both; a sphere of revolution is closed in one with poles in the other.
        (self.is_closed_u(tol) && v_ok) || (self.is_closed_v(tol) && u_ok)
    }
}

fn breaks(knots: &[f64], (a, b): (f64, f64)) -> Vec<f64> {
    let mut out = vec![a];
    for &k in knots {
        if k > a && k < b && out.last().is_some_and(|&l| k > l) {
            out.push(k);
        }
    }
    out.push(b);
    out
}
