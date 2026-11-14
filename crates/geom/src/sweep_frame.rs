//! Moving frames along a rail curve and the one-rail sweep (Sweep1).
//!
//! Two frame modes:
//! - **Rotation-minimising** (the double reflection method of Wang, Jüttler, Zheng and Liu,
//!   2008): each frame is the previous one reflected across the bisector plane of the chord, then
//!   across the plane that maps the reflected tangent onto the new tangent. It has no twist about
//!   the tangent beyond what the curve's geometry forces. On a closed rail the remaining
//!   mismatch (the holonomy) is spread linearly along the rail so the end frame meets the start.
//! - **Upright** about a fixed axis (the "keep the profile upright" option of jewellery sweeps):
//!   the frame's binormal is the axis projected perpendicular to the tangent. Where the axis is
//!   parallel to the rail tangent the projection vanishes and the frame is undefined; there (when
//!   the angle between them is under about 0.06°, `|axis × T| < 1e-3`) the frame continues by one
//!   rotation-minimising step from the previous station instead, and resumes the upright rule as
//!   soon as it is defined again.

use crate::Vec3;
use crate::nurbs_surface::{NurbsCurve3, NurbsSurface, SurfaceError, SurfaceResult, perpendicular_pair};
use crate::surface_build::{interpolate_sections, placed};

/// Most stations a sweep places its profile at.
pub const MAX_SWEEP_STATIONS: usize = 2048;

/// A right-handed orthonormal frame on a rail: `binormal = tangent × normal`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub origin: Vec3,
    pub tangent: Vec3,
    pub normal: Vec3,
    pub binormal: Vec3,
}

impl Frame {
    /// World point of local coordinates `(x along normal, y along binormal, z along tangent)`.
    pub fn to_world(&self, l: Vec3) -> Vec3 {
        self.origin + self.normal * l.x + self.binormal * l.y + self.tangent * l.z
    }
    /// Local coordinates of a world point.
    pub fn to_local(&self, p: Vec3) -> Vec3 {
        let d = p - self.origin;
        Vec3::new(d.dot(self.normal), d.dot(self.binormal), d.dot(self.tangent))
    }
}

/// How a sweep orients its profile.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FrameMode {
    RotationMinimizing,
    /// Keep the profile's local y (binormal) as close to `axis` as possible.
    Upright {
        axis: Vec3,
    },
}

/// One double-reflection step: the normal at `x1` with tangent `t1` from the frame at `x0`.
fn reflect_step(x0: Vec3, t0: Vec3, r0: Vec3, x1: Vec3, t1: Vec3) -> Vec3 {
    let v1 = x1 - x0;
    let c1 = v1.dot(v1);
    let (rl, tl) = if c1 > 1e-300 { (r0 - v1 * (2.0 / c1 * v1.dot(r0)), t0 - v1 * (2.0 / c1 * v1.dot(t0))) } else { (r0, t0) };
    let v2 = t1 - tl;
    let c2 = v2.dot(v2);
    let r = if c2 > 1e-300 { rl - v2 * (2.0 / c2 * v2.dot(rl)) } else { rl };
    // Re-orthonormalise against drift.
    (r - t1 * r.dot(t1)).normalized()
}

fn rotate_about(v: Vec3, axis: Vec3, ang: f64) -> Vec3 {
    let (s, c) = ang.sin_cos();
    v * c + axis.cross(v) * s + axis * (axis.dot(v) * (1.0 - c))
}

/// Frames at `params` along `rail` (computed on a finer sampling for the rotation-minimising
/// steps). `params` must be ascending.
pub fn rail_frames(rail: &NurbsCurve3, params: &[f64], mode: FrameMode) -> SurfaceResult<Vec<Frame>> {
    if params.is_empty() || params.len() > MAX_SWEEP_STATIONS {
        return Err(SurfaceError::TooLarge);
    }
    if params.iter().any(|t| !t.is_finite()) {
        return Err(SurfaceError::NonFinite);
    }
    if params.windows(2).any(|w| w.get(1) < w.first()) {
        return Err(SurfaceError::BadInput("rail parameters must ascend"));
    }
    let axis = match mode {
        FrameMode::Upright { axis } => {
            if !axis.is_finite() || axis.len() < 1e-300 {
                return Err(SurfaceError::BadInput("zero upright axis"));
            }
            Some(axis.normalized())
        }
        FrameMode::RotationMinimizing => None,
    };
    const SUB: usize = 8;
    let tangent = |t: f64| -> SurfaceResult<Vec3> {
        let d = rail.derivs(t);
        let tn = d[1].normalized();
        if tn.len() > 0.5 {
            return Ok(tn);
        }
        // Zero derivative (a cusp or repeated control points): look a little way in.
        let (a, b) = rail.domain();
        let e = (b - a) * 1e-6;
        let tn = (rail.point((t + e).min(b)) - rail.point((t - e).max(a))).normalized();
        if tn.len() > 0.5 { Ok(tn) } else { Err(SurfaceError::BadInput("rail has no tangent")) }
    };
    let upright = |t: Vec3| -> Option<Vec3> {
        let a = axis?;
        let side = a.cross(t);
        if side.len() < 1e-3 {
            return None;
        }
        Some(side.normalized()) // normal = axis × T, so binormal = T × normal ≈ axis
    };
    let mut frames = Vec::with_capacity(params.len());
    let first = params.first().copied().unwrap_or(0.0);
    let (mut x, mut t) = (rail.point(first), tangent(first)?);
    let mut r = match upright(t) {
        Some(n) => n,
        None => perpendicular_pair(t).ok_or(SurfaceError::BadInput("rail has no tangent"))?.0,
    };
    frames.push(Frame { origin: x, tangent: t, normal: r, binormal: t.cross(r) });
    for w in params.windows(2) {
        let (t0, t1) = (w.first().copied().unwrap_or(0.0), w.get(1).copied().unwrap_or(0.0));
        for s in 1..=SUB {
            let tt = t0 + (t1 - t0) * s as f64 / SUB as f64;
            let (x1, tg1) = (rail.point(tt), tangent(tt)?);
            r = match upright(tg1) {
                Some(n) => n,
                None => reflect_step(x, t, r, x1, tg1),
            };
            x = x1;
            t = tg1;
        }
        frames.push(Frame { origin: x, tangent: t, normal: r, binormal: t.cross(r) });
    }
    // Closed rail, rotation-minimising: spread the holonomy so the end frame meets the start.
    if axis.is_none()
        && frames.len() > 2
        && let (Some(f0), Some(fe)) = (frames.first().copied(), frames.last().copied())
    {
        let scale = rail.points().iter().fold(0.0f64, |m, p| m.max(p.len())).max(1.0);
        if (f0.origin - fe.origin).len() <= 1e-9 * scale && f0.tangent.dot(fe.tangent) > 1.0 - 1e-9 {
            let phi = fe.normal.cross(f0.normal).dot(f0.tangent).atan2(fe.normal.dot(f0.normal));
            let last = (frames.len() - 1) as f64;
            for (k, f) in frames.iter_mut().enumerate() {
                let ang = phi * k as f64 / last;
                f.normal = rotate_about(f.normal, f.tangent, ang).normalized();
                f.binormal = f.tangent.cross(f.normal);
            }
        }
    }
    Ok(frames)
}

impl NurbsSurface {
    /// One-rail sweep: `profile` (given in world coordinates where it sits at the rail's start)
    /// is carried along `rail` by the frames of `mode`, placed exactly at `stations` rail
    /// parameters spaced evenly over the domain, and skinned across them with a cubic. The
    /// surface is exact at the stations and an interpolation between them; more stations give a
    /// closer sweep (see the tests for the measured error). u follows the profile, v the rail.
    pub fn sweep1(rail: &NurbsCurve3, profile: &NurbsCurve3, mode: FrameMode, stations: usize) -> SurfaceResult<Self> {
        if !(2..=MAX_SWEEP_STATIONS).contains(&stations) {
            return Err(SurfaceError::BadInput("stations must be between 2 and 2048"));
        }
        let (a, b) = rail.domain();
        let params: Vec<f64> = (0..stations).map(|k| a + (b - a) * k as f64 / (stations - 1) as f64).collect();
        let frames = rail_frames(rail, &params, mode)?;
        let f0 = frames.first().copied().ok_or(SurfaceError::BadInput("no frames"))?;
        let local = profile.map(|p| f0.to_local(p))?;
        let cols: Vec<_> = frames.iter().map(|f| placed(&local, |l| f.to_world(l))).collect();
        interpolate_sections(profile.degree(), profile.knots().to_vec(), &cols, 3)
    }
}
