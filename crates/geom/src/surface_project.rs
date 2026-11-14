//! Closest point on a surface (projection), point inversion, and the surface's area and enclosed
//! volume.
//!
//! Projection seeds from a grid of samples (at least 8 and at most 64 per direction, more per knot
//! span), then runs a damped Newton iteration on `f(u, v) = ½|S(u, v) − P|²` from the best eight
//! seeds: the full Hessian when it is positive definite, Gauss–Newton with Levenberg damping
//! otherwise, a halving line search, at most 100 iterations from each of the 8 best seeds; on a domain edge the outward parameter is frozen. Closed directions wrap.
//!
//! Area is `∬ |S_u × S_v| du dv` and volume `⅓ ∬ S · (S_u × S_v) du dv` (the divergence theorem),
//! both by 8-point Gauss–Legendre quadrature on every knot-span patch, each split into a few
//! sub-patches.

use crate::Vec3;
use crate::nurbs_surface::{NurbsSurface, SurfaceError, SurfaceResult};

/// The result of a projection.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClosestPoint {
    pub u: f64,
    pub v: f64,
    pub point: Vec3,
    pub distance: f64,
}

const MAX_NEWTON: usize = 100;
const SEEDS: usize = 8;

fn grid_params(breaks: &[f64]) -> Vec<f64> {
    let spans = breaks.len().saturating_sub(1).max(1);
    let per = (64 / spans).clamp(1, 8).max(8usize.div_ceil(spans));
    let mut out = Vec::new();
    for w in breaks.windows(2) {
        let (a, b) = (w.first().copied().unwrap_or(0.0), w.get(1).copied().unwrap_or(0.0));
        for k in 0..per {
            out.push(a + (b - a) * k as f64 / per as f64);
        }
    }
    if let Some(&l) = breaks.last() {
        out.push(l);
    }
    if out.len() > 65 {
        let step = (out.len() - 1) as f64 / 64.0;
        out = (0..=64).filter_map(|i| out.get((i as f64 * step).round() as usize).copied()).collect();
    }
    out
}

impl NurbsSurface {
    /// The point of the surface closest to `p`, with its parameters.
    pub fn closest_point(&self, p: Vec3) -> SurfaceResult<ClosestPoint> {
        if !p.is_finite() {
            return Err(SurfaceError::NonFinite);
        }
        let us = grid_params(&self.breaks_u());
        let vs = grid_params(&self.breaks_v());
        let grid = self.eval_grid(&us, &vs)?;
        let mut cand: Vec<(f64, usize)> = grid.iter().enumerate().map(|(k, q)| ((*q - p).len(), k)).collect();
        cand.sort_by(|a, b| a.0.total_cmp(&b.0));
        let size = self.size().max(1e-300);
        let tol = size * 1e-9;
        let (wrap_u, wrap_v) = (self.is_closed_u(tol), self.is_closed_v(tol));
        let mut best: Option<ClosestPoint> = None;
        for &(_, k) in cand.iter().take(SEEDS) {
            let nv = vs.len().max(1);
            let (u0, v0) = (us.get(k / nv).copied().unwrap_or(0.0), vs.get(k % nv).copied().unwrap_or(0.0));
            let r = self.newton(p, u0, v0, wrap_u, wrap_v);
            if best.is_none_or(|b| r.distance < b.distance) {
                best = Some(r);
            }
        }
        best.ok_or(SurfaceError::NoConvergence)
    }

    fn newton(&self, p: Vec3, mut u: f64, mut v: f64, wrap_u: bool, wrap_v: bool) -> ClosestPoint {
        let (ua, ub) = self.domain_u();
        let (va, vb) = self.domain_v();
        let fix = |t: f64, a: f64, b: f64, wrap: bool| {
            if wrap && (t < a || t > b) { a + (t - a).rem_euclid(b - a) } else { t.clamp(a, b) }
        };
        let f = |u: f64, v: f64| {
            let d = self.point(u, v) - p;
            0.5 * d.dot(d)
        };
        let mut fc = f(u, v);
        for _ in 0..MAX_NEWTON {
            let d = self.derivs(u, v);
            let r = d.point - p;
            let g = [d.du.dot(r), d.dv.dot(r)];
            let (huu, huv, hvv) = (d.du.dot(d.du), d.du.dot(d.dv), d.dv.dot(d.dv));
            let full = [huu + r.dot(d.duu), huv + r.dot(d.duv), hvv + r.dot(d.dvv)];
            let solve = |h: [f64; 3]| {
                let det = h[0] * h[2] - h[1] * h[1];
                if !(det.is_finite() && det > 0.0 && h[0] > 0.0) {
                    return None;
                }
                let du = -(h[2] * g[0] - h[1] * g[1]) / det;
                let dv = -(-h[1] * g[0] + h[0] * g[1]) / det;
                (du.is_finite() && dv.is_finite()).then_some((du, dv))
            };
            let lambda = 1e-9 * (huu + hvv).max(1e-300);
            let descent = {
                let sc = (huu + hvv).max(1e-300);
                (-g[0] / sc, -g[1] / sc)
            };
            let newton = solve(full).or_else(|| solve([huu + lambda, huv, hvv + lambda])).unwrap_or(descent);
            // On a domain edge with the step pointing out, freeze that parameter (1D Newton in
            // the other) — the constrained minimum lies along the edge.
            let at_u = (u <= ua && newton.0 < 0.0 || u >= ub && newton.0 > 0.0) && !wrap_u;
            let at_v = (v <= va && newton.1 < 0.0 || v >= vb && newton.1 > 0.0) && !wrap_v;
            let edge = |h: f64, gg: f64| if h > 0.0 { -gg / h } else { -gg / (huu + hvv).max(1e-300) };
            let constrained = match (at_u, at_v) {
                (true, true) => (0.0, 0.0),
                (true, false) => (0.0, edge(full[2], g[1])),
                (false, true) => (edge(full[0], g[0]), 0.0),
                (false, false) => newton,
            };
            let mut accepted = false;
            for (mut du, mut dv) in [constrained, newton, descent] {
                for _ in 0..30 {
                    let (nu, nv) = (fix(u + du, ua, ub, wrap_u), fix(v + dv, va, vb, wrap_v));
                    let fnew = f(nu, nv);
                    if fnew < fc {
                        let moved = (nu - u).abs() + (nv - v).abs();
                        u = nu;
                        v = nv;
                        fc = fnew;
                        accepted = moved > 1e-15 * (1.0 + (ub - ua) + (vb - va));
                        break;
                    }
                    du *= 0.5;
                    dv *= 0.5;
                }
                if accepted {
                    break;
                }
            }
            if !accepted {
                break;
            }
        }
        let point = self.point(u, v);
        ClosestPoint { u, v, point, distance: (point - p).len() }
    }

    /// The parameters of a point lying on the surface (within `tol`), or an error if it does not.
    pub fn invert(&self, p: Vec3, tol: f64) -> SurfaceResult<(f64, f64)> {
        let c = self.closest_point(p)?;
        if c.distance <= tol.max(0.0) { Ok((c.u, c.v)) } else { Err(SurfaceError::BadInput("the point is not on the surface")) }
    }

    fn quadrature(&self, f: impl Fn(&crate::nurbs_surface::SurfaceDerivs) -> f64) -> SurfaceResult<f64> {
        let bu = self.breaks_u();
        let bv = self.breaks_v();
        let patches = bu.len().saturating_sub(1).saturating_mul(bv.len().saturating_sub(1));
        if patches > 1 << 18 {
            return Err(SurfaceError::TooLarge);
        }
        let sub = if patches > 4096 { 1 } else { 4 };
        let mut total = 0.0;
        for wu in bu.windows(2) {
            for wv in bv.windows(2) {
                let (u0, u1) = (wu.first().copied().unwrap_or(0.0), wu.get(1).copied().unwrap_or(0.0));
                let (v0, v1) = (wv.first().copied().unwrap_or(0.0), wv.get(1).copied().unwrap_or(0.0));
                for a in 0..sub {
                    for b in 0..sub {
                        let (ua, ub) = (u0 + (u1 - u0) * a as f64 / sub as f64, u0 + (u1 - u0) * (a + 1) as f64 / sub as f64);
                        let (va, vb) = (v0 + (v1 - v0) * b as f64 / sub as f64, v0 + (v1 - v0) * (b + 1) as f64 / sub as f64);
                        let (hu, hv) = ((ub - ua) / 2.0, (vb - va) / 2.0);
                        for (xu, wu) in GAUSS8 {
                            for (xv, wv) in GAUSS8 {
                                let d = self.derivs(ua + hu * (1.0 + xu), va + hv * (1.0 + xv));
                                total += wu * wv * hu * hv * f(&d);
                            }
                        }
                    }
                }
            }
        }
        Ok(total)
    }

    /// The surface area.
    pub fn area(&self) -> SurfaceResult<f64> {
        self.quadrature(|d| d.du.cross(d.dv).len())
    }

    /// The signed volume enclosed by a closed surface: positive when `S_u × S_v` points outward.
    /// Errors when the surface is not closed (see [`NurbsSurface::is_closed`]).
    pub fn signed_volume(&self) -> SurfaceResult<f64> {
        if !self.is_closed(self.size().max(1e-300) * 1e-9) {
            return Err(SurfaceError::NotClosed);
        }
        self.quadrature(|d| d.point.dot(d.du.cross(d.dv)) / 3.0)
    }

    /// The enclosed volume (absolute value of [`NurbsSurface::signed_volume`]).
    pub fn volume(&self) -> SurfaceResult<f64> {
        self.signed_volume().map(f64::abs)
    }
}

/// 8-point Gauss–Legendre nodes and weights on [−1, 1].
pub(crate) const GAUSS8: [(f64, f64); 8] = [
    (-0.960_289_856_497_536_2, 0.101_228_536_290_376_26),
    (-0.796_666_477_413_626_7, 0.222_381_034_453_374_47),
    (-0.525_532_409_916_329_0, 0.313_706_645_877_887_3),
    (-0.183_434_642_495_649_8, 0.362_683_783_378_362_0),
    (0.183_434_642_495_649_8, 0.362_683_783_378_362_0),
    (0.525_532_409_916_329_0, 0.313_706_645_877_887_3),
    (0.796_666_477_413_626_7, 0.222_381_034_453_374_47),
    (0.960_289_856_497_536_2, 0.101_228_536_290_376_26),
];
