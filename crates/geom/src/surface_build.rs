//! Surface constructors: bilinear patch, extrusion, revolution, ruled surface, loft (skinning).
//! Sweeps along a rail are in `sweep_frame`.

use crate::Vec3;
use crate::nurbs_surface::{H4, MAX_SURFACE_DEGREE, NurbsCurve3, NurbsSurface, SurfaceError, SurfaceResult, arc_ring, to_h};
use crate::spline::{basis, find_span};

/// Most section curves a loft takes.
pub const MAX_LOFT_SECTIONS: usize = 1024;

impl NurbsSurface {
    /// The bilinear patch `S(u, v) = (1−u)(1−v)·p00 + u(1−v)·p10 + (1−u)v·p01 + uv·p11` on `[0,1]²`.
    pub fn bilinear(p00: Vec3, p10: Vec3, p01: Vec3, p11: Vec3) -> SurfaceResult<Self> {
        NurbsSurface::new(1, 1, vec![0.0, 0.0, 1.0, 1.0], vec![0.0, 0.0, 1.0, 1.0], 2, 2, vec![p00, p01, p10, p11], Vec::new())
    }

    /// The extrusion `S(u, v) = C(u) + v·dir`, `v ∈ [0, 1]`.
    pub fn extrude(curve: &NurbsCurve3, dir: Vec3) -> SurfaceResult<Self> {
        if !dir.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        if dir.len() <= 1e-300 {
            return Err(SurfaceError::BadInput("zero extrusion direction"));
        }
        let n = curve.points().len();
        let mut pts = Vec::with_capacity(2 * n);
        let mut wts = Vec::with_capacity(2 * n);
        for (p, w) in curve.points().iter().zip(curve.weights()) {
            pts.extend([*p, *p + dir]);
            wts.extend([*w, *w]);
        }
        NurbsSurface::new(curve.degree(), 1, curve.knots().to_vec(), vec![0.0, 0.0, 1.0, 1.0], n, 2, pts, wts)
    }

    /// The surface swept by `profile` revolving about the axis through `origin` along `axis` by
    /// `angle` radians (right-handed about `axis`; `0 < |angle| ≤ 2π`). Exact: every profile control
    /// point becomes a rational quadratic circle (pieces of at most 90°, middle weight
    /// `cos(Δ/2)`), multiplied by the profile weight. u follows the profile, v the revolution
    /// (`v ∈ [0, 1]`). Profile points on the axis give a pole.
    pub fn revolve(profile: &NurbsCurve3, origin: Vec3, axis: Vec3, angle: f64) -> SurfaceResult<Self> {
        if !(origin.is_finite() && axis.is_finite() && angle.is_finite()) {
            return Err(SurfaceError::NonFinite);
        }
        let a = axis.normalized();
        if a.len() < 0.5 {
            return Err(SurfaceError::BadInput("zero axis"));
        }
        if angle.abs() < 1e-12 || angle.abs() > std::f64::consts::TAU + 1e-12 {
            return Err(SurfaceError::BadInput("revolution angle must be in (0, 2π]"));
        }
        let (fx, fy) = crate::nurbs_surface::perpendicular_pair(a).ok_or(SurfaceError::BadInput("zero axis"))?;
        let n = profile.points().len();
        let mut pts = Vec::new();
        let mut wts = Vec::new();
        let mut knots_v = Vec::new();
        let mut count_v = 0;
        for (p, w) in profile.points().iter().zip(profile.weights()) {
            let c = origin + a * (*p - origin).dot(a);
            let x = *p - c;
            let r = x.len();
            let (xd, yd) = if r > 1e-300 { (x, a.cross(x.normalized()) * r) } else { (fx * 0.0, fy * 0.0) };
            let (rp, rw, rk) = arc_ring(c, xd, yd, 0.0, angle);
            count_v = rp.len();
            knots_v = rk;
            pts.extend(rp);
            wts.extend(rw.iter().map(|q| q * w));
        }
        NurbsSurface::new(profile.degree(), 2, profile.knots().to_vec(), knots_v, n, count_v, pts, wts)
    }

    /// The ruled surface `S(u, v) = (1−v)·A(u) + v·B(u)` between two curves (made compatible first:
    /// both mapped to `u ∈ [0, 1]`, the lower degree raised, the knot vectors merged; for rational
    /// curves the blend is in homogeneous coordinates).
    pub fn ruled(a: &NurbsCurve3, b: &NurbsCurve3) -> SurfaceResult<Self> {
        let c = make_compatible(&[a.clone(), b.clone()])?;
        let (ca, cb) = match (c.first(), c.get(1)) {
            (Some(x), Some(y)) => (x, y),
            _ => return Err(SurfaceError::BadInput("two curves needed")),
        };
        let n = ca.points().len();
        let mut pts = Vec::with_capacity(2 * n);
        let mut wts = Vec::with_capacity(2 * n);
        for i in 0..n {
            for c in [ca, cb] {
                pts.push(c.points().get(i).copied().unwrap_or_default());
                wts.push(c.weights().get(i).copied().unwrap_or(1.0));
            }
        }
        NurbsSurface::new(ca.degree(), 1, ca.knots().to_vec(), vec![0.0, 0.0, 1.0, 1.0], n, 2, pts, wts)
    }

    /// A loft (skin) through `sections` in order: they are made compatible, then each column of
    /// corresponding control points is interpolated (in homogeneous coordinates) by a B-spline
    /// of degree `min(degree_v, sections − 1)` with averaged chord-length parameters. The surface
    /// passes exactly through every section (`v` = its parameter, from 0 to 1).
    pub fn loft(sections: &[NurbsCurve3], degree_v: usize) -> SurfaceResult<Self> {
        if sections.len() < 2 {
            return Err(SurfaceError::BadInput("a loft needs at least two sections"));
        }
        if sections.len() > MAX_LOFT_SECTIONS {
            return Err(SurfaceError::TooLarge);
        }
        let c = make_compatible(sections)?;
        let cols: Vec<Vec<H4>> = c.iter().map(NurbsCurve3::homogeneous).collect();
        let first = c.first().ok_or(SurfaceError::BadInput("no sections"))?;
        interpolate_sections(first.degree(), first.knots().to_vec(), &cols, degree_v)
    }
}

/// Interpolates homogeneous section control polygons (`cols[k][i]`: section k, point i) across
/// the sections.
pub(crate) fn interpolate_sections(degree_u: usize, knots_u: Vec<f64>, cols: &[Vec<H4>], degree_v: usize) -> SurfaceResult<NurbsSurface> {
    let m = cols.len().saturating_sub(1);
    let n = cols.first().map_or(0, Vec::len);
    if m < 1 || cols.iter().any(|c| c.len() != n) {
        return Err(SurfaceError::BadInput("sections are not compatible"));
    }
    let q = degree_v.clamp(1, MAX_SURFACE_DEGREE).min(m);
    // Averaged chord-length parameters (Euclidean, on the projected control points).
    let mut params = vec![0.0; m + 1];
    let mut used = 0usize;
    for i in 0..n {
        let pt = |k: usize| {
            let h = cols.get(k).and_then(|c| c.get(i)).copied().unwrap_or([0.0, 0.0, 0.0, 1.0]);
            Vec3::new(h[0] / h[3], h[1] / h[3], h[2] / h[3])
        };
        let d: Vec<f64> = (1..=m).map(|k| (pt(k) - pt(k - 1)).len()).collect();
        let total: f64 = d.iter().sum();
        if !(total.is_finite() && total > 1e-12) {
            continue;
        }
        used += 1;
        let mut acc = 0.0;
        for k in 1..=m {
            acc += d.get(k - 1).copied().unwrap_or(0.0);
            if let Some(p) = params.get_mut(k) {
                *p += acc / total;
            }
        }
    }
    if used == 0 {
        return Err(SurfaceError::BadInput("sections coincide"));
    }
    for p in params.iter_mut() {
        *p /= used as f64;
    }
    if let Some(l) = params.last_mut() {
        *l = 1.0;
    }
    if params.windows(2).any(|w| w.get(1).copied().unwrap_or(0.0) - w.first().copied().unwrap_or(0.0) <= 1e-12) {
        return Err(SurfaceError::BadInput("consecutive sections coincide"));
    }
    // Knots by averaging.
    let mut knots = vec![0.0; q + 1];
    for j in 1..=(m - q) {
        let s: f64 = params.get(j..j + q).map_or(0.0, |w| w.iter().sum());
        knots.push(s / q as f64);
    }
    knots.extend(std::iter::repeat_n(1.0, q + 1));
    // Collocation matrix.
    let dim = m + 1;
    let mut a = vec![0.0; dim * dim];
    for (k, &v) in params.iter().enumerate() {
        let span = find_span(m, q, v, &knots);
        for (r, b) in basis(span, v, q, &knots).iter().enumerate() {
            if let Some(x) = a.get_mut(k * dim + (span + r).saturating_sub(q)) {
                *x = *b;
            }
        }
    }
    let rhs_cols = n * 4;
    let mut rhs = vec![0.0; dim * rhs_cols];
    for (k, c) in cols.iter().enumerate() {
        for (i, h) in c.iter().enumerate() {
            for (d, x) in h.iter().enumerate() {
                if let Some(t) = rhs.get_mut(k * rhs_cols + i * 4 + d) {
                    *t = *x;
                }
            }
        }
    }
    let sol = solve_multi(a, rhs, dim, rhs_cols).ok_or(SurfaceError::BadInput("singular interpolation"))?;
    let mut pts = Vec::with_capacity(n * dim);
    let mut wts = Vec::with_capacity(n * dim);
    for i in 0..n {
        for k in 0..dim {
            let g = |d: usize| sol.get(k * rhs_cols + i * 4 + d).copied().unwrap_or(0.0);
            let w = g(3);
            if !(w.is_finite() && w > 0.0) {
                return Err(SurfaceError::Weight);
            }
            pts.push(Vec3::new(g(0) / w, g(1) / w, g(2) / w));
            wts.push(w);
        }
    }
    NurbsSurface::new(degree_u, q, knots_u, knots, n, dim, pts, wts)
}

/// Solves `A·X = B` (A `n×n`, B `n×k`, row-major) by Gaussian elimination with partial pivoting.
fn solve_multi(mut a: Vec<f64>, mut b: Vec<f64>, n: usize, k: usize) -> Option<Vec<f64>> {
    let scale = a.iter().fold(0.0f64, |m, x| m.max(x.abs()));
    for c in 0..n {
        let piv = (c..n).max_by(|&i, &j| {
            let ai = a.get(i * n + c).copied().unwrap_or(0.0).abs();
            let aj = a.get(j * n + c).copied().unwrap_or(0.0).abs();
            ai.total_cmp(&aj)
        })?;
        let pv = a.get(piv * n + c).copied().unwrap_or(0.0);
        if !(pv.abs() > 1e-14 * scale.max(1e-300)) {
            return None;
        }
        if piv != c {
            for j in 0..n {
                a.swap(c * n + j, piv * n + j);
            }
            for j in 0..k {
                b.swap(c * k + j, piv * k + j);
            }
        }
        for r in (c + 1)..n {
            let f = a.get(r * n + c).copied().unwrap_or(0.0) / pv;
            if f == 0.0 {
                continue;
            }
            for j in c..n {
                let v = a.get(c * n + j).copied().unwrap_or(0.0);
                if let Some(x) = a.get_mut(r * n + j) {
                    *x -= f * v;
                }
            }
            for j in 0..k {
                let v = b.get(c * k + j).copied().unwrap_or(0.0);
                if let Some(x) = b.get_mut(r * k + j) {
                    *x -= f * v;
                }
            }
        }
    }
    for c in (0..n).rev() {
        let pv = a.get(c * n + c).copied().unwrap_or(1.0);
        for j in 0..k {
            let mut s = b.get(c * k + j).copied().unwrap_or(0.0);
            for r in (c + 1)..n {
                s -= a.get(c * n + r).copied().unwrap_or(0.0) * b.get(r * k + j).copied().unwrap_or(0.0);
            }
            if let Some(x) = b.get_mut(c * k + j) {
                *x = s / pv;
            }
        }
    }
    b.iter().all(|x| x.is_finite()).then_some(b)
}

/// Makes curves compatible for a ruled surface or loft: each is mapped to `[0, 1]`, raised to the
/// highest degree among them, and given the union of their interior knots (values within 1e-10
/// are taken as one, snapping by at most that much). Exact up to that snap. Curves must be
/// clamped.
pub fn make_compatible(curves: &[NurbsCurve3]) -> SurfaceResult<Vec<NurbsCurve3>> {
    if curves.len() > MAX_LOFT_SECTIONS {
        return Err(SurfaceError::TooLarge);
    }
    let p = curves.iter().map(NurbsCurve3::degree).max().ok_or(SurfaceError::BadInput("no curves"))?;
    let mut cs = Vec::with_capacity(curves.len());
    for c in curves {
        if !c.is_clamped() {
            return Err(SurfaceError::BadInput("curves must be clamped"));
        }
        cs.push(c.reparam(0.0, 1.0)?.elevate(p - c.degree())?);
    }
    const TOL: f64 = 1e-10;
    // Merged interior knots with their maximum multiplicity.
    let mut merged: Vec<(f64, usize)> = Vec::new();
    for c in &cs {
        let mut local: Vec<(f64, usize)> = Vec::new();
        for &k in c.knots().iter().filter(|&&k| k > TOL && k < 1.0 - TOL) {
            match local.last_mut() {
                Some((v, m)) if (k - *v).abs() <= TOL => *m += 1,
                _ => local.push((k, 1)),
            }
        }
        for (v, m) in local {
            match merged.iter_mut().find(|(x, _)| (x - v).abs() <= TOL) {
                Some(e) => e.1 = e.1.max(m),
                None => merged.push((v, m)),
            }
        }
    }
    merged.sort_by(|a, b| a.0.total_cmp(&b.0));
    if merged.iter().map(|e| e.1).sum::<usize>() > crate::nurbs_surface::MAX_CURVE_POINTS {
        return Err(SurfaceError::TooLarge);
    }
    let mut out = Vec::with_capacity(cs.len());
    for c in cs {
        // Snap near-equal knots onto the merged values.
        let knots: Vec<f64> = c.knots().iter().map(|&k| merged.iter().find(|(v, _)| (k - v).abs() <= TOL).map_or(k, |e| e.0)).collect();
        let mut c = NurbsCurve3::new(c.degree(), knots, c.points().to_vec(), c.weights().to_vec())?;
        for &(v, m) in &merged {
            let have = c.knots().iter().filter(|&&k| k == v).count();
            if m > have {
                c = c.insert_knot(v, m - have)?;
            }
        }
        out.push(c);
    }
    Ok(out)
}

/// Homogeneous control points of a curve placed by an affine map (for sweeps).
pub(crate) fn placed(curve: &NurbsCurve3, f: impl Fn(Vec3) -> Vec3) -> Vec<H4> {
    curve.points().iter().zip(curve.weights()).map(|(p, w)| to_h(f(*p), *w)).collect()
}
