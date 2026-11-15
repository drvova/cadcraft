//! Flow along a surface / curve: known answers (identity, exact wrap, kept length), deterministic
//! property sweeps (mapped points lie on the target lifted by h, no NaN, bounded refinement) and
//! hostile input.

use super::*;
use crate::{NurbsCurve3, NurbsSurface, TAU, Vec3};

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn plane(w: f64, h: f64) -> NurbsSurface {
    NurbsSurface::bilinear(v(0.0, 0.0, 0.0), v(w, 0.0, 0.0), v(0.0, h, 0.0), v(w, h, 0.0)).unwrap()
}

/// Cylinder of radius `r` about Z, height `h`: u around, v up.
fn cylinder(r: f64, h: f64) -> NurbsSurface {
    let c = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, r).unwrap();
    NurbsSurface::extrude(&c, v(0.0, 0.0, h)).unwrap()
}

fn radius(p: Vec3) -> f64 {
    (p.x * p.x + p.y * p.y).sqrt()
}

fn opts(stretch: bool, tol: f64) -> FlowOptions {
    FlowOptions { stretch, tol, ..FlowOptions::default() }
}

fn polylen(p: &[Vec3]) -> f64 {
    p.windows(2).map(|w| (w[1] - w[0]).len()).sum()
}

#[test]
fn planar_target_is_identity() {
    for stretch in [true, false] {
        let f = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 10.0, 5.0), plane(10.0, 5.0), opts(stretch, 1e-6)).unwrap();
        for p in [v(0.0, 0.0, 0.0), v(3.0, 4.0, 0.0), v(10.0, 5.0, 0.0), v(7.5, 1.25, 2.0), v(1.0, 2.0, -0.5)] {
            let q = f.map_point(p).unwrap();
            assert!((q.point - p).len() < 1e-9, "{p:?} -> {:?}", q.point);
            assert!((q.normal() - Vec3::Z).len() < 1e-12);
        }
        let line = f.map_polyline(&[v(1.0, 1.0, 0.0), v(9.0, 4.0, 0.0)], false).unwrap();
        assert!(line.iter().all(|q| q.z.abs() < 1e-12));
        // A flat target needs no refinement beyond the pre-split.
        assert!(line.len() <= 66);
    }
}

#[test]
fn base_surface_equals_base_rectangle() {
    let rect = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 4.0, 2.0), cylinder(1.0, 2.0), opts(true, 1e-5)).unwrap();
    let srf = SurfaceFlow::new(FlowBase::Surface(plane(4.0, 2.0)), cylinder(1.0, 2.0), opts(true, 1e-5)).unwrap();
    for p in [v(0.5, 0.5, 0.0), v(2.0, 1.0, 0.1), v(3.9, 1.9, -0.2)] {
        let (a, b) = (rect.map_point(p).unwrap().point, srf.map_point(p).unwrap().point);
        assert!((a - b).len() < 1e-6, "{a:?} vs {b:?}");
    }
}

#[test]
fn cylinder_target_wraps_exactly() {
    let (r, h) = (2.0, 3.0);
    let w = TAU * r;
    let f = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, w, h), cylinder(r, h), opts(true, 1e-4)).unwrap();
    // The seam closes: s = 0 and s = W land on the same point.
    let (a, b) = (f.map_point(v(0.0, 1.0, 0.0)).unwrap().point, f.map_point(v(w, 1.0, 0.0)).unwrap().point);
    assert!((a - b).len() < 1e-9);
    // A line across the full width becomes the circle; every point (and every chord's middle,
    // within tolerance) lies on it.
    let ring = f.map_polyline(&[v(0.0, 1.5, 0.0), v(w, 1.5, 0.0)], false).unwrap();
    for p in &ring {
        assert!((radius(*p) - r).abs() < 1e-9 && (p.z - 1.5).abs() < 1e-9);
    }
    for s in ring.windows(2) {
        assert!(r - radius((s[0] + s[1]) * 0.5) <= 1e-4 + 1e-12);
    }
    assert!((polylen(&ring) - w).abs() < 1e-3);
    // Height lifts along the normal by exactly h.
    let up = f.map_point(v(1.0, 1.0, 0.25)).unwrap();
    assert!(((radius(up.point) - r).abs() - 0.25).abs() < 1e-9);
    let flipped = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, w, h), cylinder(r, h), FlowOptions { flip: true, ..opts(true, 1e-4) }).unwrap();
    let down = flipped.map_point(v(1.0, 1.0, 0.25)).unwrap();
    assert!(((radius(down.point) - radius(up.point)).abs() - 0.5).abs() < 1e-9);
    let off = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, w, h), cylinder(r, h), FlowOptions { offset: 0.5, ..opts(true, 1e-4) }).unwrap();
    assert!(((radius(off.map_point(v(1.0, 1.0, 0.0)).unwrap().point) - r).abs() - 0.5).abs() < 1e-9);
}

#[test]
fn keep_length_preserves_arc_length() {
    let (r, h) = (2.0, 3.0);
    // A base twice the target's size: with stretch the line would halve, without it keeps 3.
    let f = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 2.0 * TAU * r, 2.0 * h), cylinder(r, h), opts(false, 1e-6)).unwrap();
    let line = f.map_polyline(&[v(1.0, 1.0, 0.0), v(4.0, 1.0, 0.0)], false).unwrap();
    assert!((polylen(&line) - 3.0).abs() < 1e-3, "{}", polylen(&line));
    let up = f.map_polyline(&[v(1.0, 0.5, 0.0), v(1.0, 2.5, 0.0)], false).unwrap();
    assert!((polylen(&up) - 2.0).abs() < 1e-6);
    // A diagonal on the developable cylinder keeps its length too.
    let d = f.map_polyline(&[v(0.5, 0.5, 0.0), v(3.5, 2.5, 0.0)], false).unwrap();
    assert!((polylen(&d) - 13f64.sqrt()).abs() < 1e-3);
    let s = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 2.0 * TAU * r, 2.0 * h), cylinder(r, h), opts(true, 1e-6)).unwrap();
    let half = s.map_polyline(&[v(1.0, 1.0, 0.0), v(4.0, 1.0, 0.0)], false).unwrap();
    assert!((polylen(&half) - 1.5).abs() < 1e-3);
    // Beyond the target's extent points are clamped and say so.
    assert!(!f.map_point(v(100.0, 1.0, 0.0)).unwrap().inside);
    assert!(f.map_point(v(1.0, 1.0, 0.0)).unwrap().inside);
}

#[test]
fn rigid_keeps_shape() {
    let f = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 10.0, 3.0), cylinder(1.5, 3.0), opts(true, 1e-4)).unwrap();
    let sq = [v(4.0, 1.0, 0.0), v(5.0, 1.0, 0.0), v(5.0, 2.0, 0.0), v(4.0, 2.0, 0.0)];
    let (out, anchor) = f.map_rigid(&sq, None).unwrap();
    for i in 0..4 {
        let (a, b) = (out[i], out[(i + 1) % 4]);
        assert!(((a - b).len() - 1.0).abs() < 1e-12);
    }
    // The anchor sits on the surface and the motif lies in its tangent plane.
    assert!((radius(anchor.point) - 1.5).abs() < 1e-9);
    for p in &out {
        assert!((*p - anchor.point).dot(anchor.normal()).abs() < 1e-12);
    }
}

#[test]
fn mesh_is_subdivided_onto_the_target() {
    let r = 1.0;
    let f = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, TAU * r, 1.0), cylinder(r, 1.0), opts(true, 1e-3)).unwrap();
    let a = [v(0.0, 0.0, 0.0), v(3.0, 0.0, 0.0), v(3.0, 1.0, 0.0)];
    let b = [v(0.0, 0.0, 0.0), v(3.0, 1.0, 0.0), v(0.0, 1.0, 0.0)];
    let out = f.map_mesh(&[a, b]).unwrap();
    assert!(out.len() > 2 && out.len() <= 2 * MAX_MESH_SPLIT * MAX_MESH_SPLIT);
    assert_eq!(out.len() % 2, 0);
    for t in &out {
        for p in t {
            assert!((radius(*p) - r).abs() < 1e-9);
        }
        // Each small triangle's centroid hugs the surface within tolerance-ish.
        let c = (t[0] + t[1] + t[2]) * (1.0 / 3.0);
        assert!(r - radius(c) < 2e-3);
    }
}

#[test]
fn curve_flow_identity_and_circle() {
    let base = (v(0.0, 0.0, 0.0), v(10.0, 0.0, 0.0));
    let line = NurbsCurve3::line(base.0, base.1).unwrap();
    let f = CurveFlow::new(base.0, base.1, line, opts(true, 1e-6)).unwrap();
    for p in [v(0.0, 0.0, 0.0), v(3.0, 1.0, 0.0), v(7.0, -2.0, 1.5)] {
        assert!((f.map_point(p).unwrap().point - p).len() < 1e-9, "{p:?}");
    }
    let rr = 3.0;
    let circle = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, rr).unwrap();
    let c = CurveFlow::new(v(0.0, 0.0, 0.0), v(TAU * rr, 0.0, 0.0), circle.clone(), opts(true, 1e-5)).unwrap();
    for s in [0.0, 1.0, 5.0, 12.0] {
        for (y, z) in [(0.0, 0.0), (0.5, 0.0), (-0.5, 0.7)] {
            let q = c.map_point(v(s, y, z)).unwrap().point;
            assert!((q.z - z).abs() < 1e-6, "z {q:?}");
            assert!((radius(q) - rr).abs() - y.abs() < 1e-6 && (radius(q) - rr).abs() - y.abs() > -1e-6, "{s} {y}: {q:?}");
        }
    }
    let keep = CurveFlow::new(v(0.0, 0.0, 0.0), v(1.0, 0.0, 0.0), circle, opts(false, 1e-6)).unwrap();
    let arc = keep.map_polyline(&[v(0.0, 0.0, 0.0), v(4.0, 0.0, 0.0)], false).unwrap();
    assert!((polylen(&arc) - 4.0).abs() < 1e-3);
    assert!((keep.target_len() - TAU * rr).abs() < 1e-3);
}

// ---------------------------------------------------------------- properties

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn wavy(rng: &mut Rng) -> NurbsSurface {
    let (nu, nv) = (5, 4);
    let mut pts = Vec::new();
    for i in 0..nu {
        for j in 0..nv {
            pts.push(v(i as f64 * 2.0, j as f64 * 2.0, (rng.unit() - 0.5) * 3.0));
        }
    }
    surface_from_net(3, 2, nu, nv, pts, Vec::new()).unwrap()
}

#[test]
fn mapped_points_lie_on_target_lifted_by_h() {
    let mut rng = Rng(0x9E3779B97F4A7C15);
    for _ in 0..60 {
        let target = wavy(&mut rng);
        let stretch = rng.unit() < 0.5;
        let f = SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 6.0, 4.0), target.clone(), opts(stretch, 1e-3)).unwrap();
        for _ in 0..20 {
            let p = v(rng.unit() * 6.0, rng.unit() * 4.0, (rng.unit() - 0.5) * 0.4);
            let q = f.map_point(p).unwrap();
            assert!(q.point.is_finite());
            let on = target.point(q.u, q.v);
            let n = target.normal(q.u, q.v).unwrap();
            assert!((q.point - (on + n * p.z)).len() < 1e-9);
            assert!((q.normal().len() - 1.0).abs() < 1e-9);
        }
        let poly: Vec<Vec3> = (0..6).map(|_| v(rng.unit() * 6.0, rng.unit() * 4.0, 0.0)).collect();
        let out = f.map_polyline(&poly, true).unwrap();
        assert!(out.len() <= MAX_FLOW_POINTS && out.iter().all(|p| p.is_finite()));
        assert!((out[0] - *out.last().unwrap()).len() < 1e-9);
        for p in out.iter().step_by(7) {
            let cp = target.closest_point(*p).unwrap();
            assert!(cp.distance < 1e-6, "off surface by {}", cp.distance);
        }
    }
}

// ---------------------------------------------------------------- hostile

#[test]
fn hostile_flow_input_is_an_error_not_a_panic() {
    let target = cylinder(1.0, 1.0);
    let base = || FlowBase::rect_xy(0.0, 0.0, 1.0, 1.0);
    assert!(SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 0.0, 1.0), target.clone(), FlowOptions::default()).is_err());
    assert!(SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, f64::NAN, 1.0), target.clone(), FlowOptions::default()).is_err());
    assert!(SurfaceFlow::new(base(), target.clone(), FlowOptions { offset: f64::INFINITY, ..FlowOptions::default() }).is_err());
    let flat = surface_from_net(1, 1, 2, 2, vec![Vec3::ZERO; 4], Vec::new()).unwrap();
    assert!(SurfaceFlow::new(base(), flat, FlowOptions::default()).is_err());
    assert!(surface_from_net(3, 3, 2, 2, vec![Vec3::ZERO; 4], Vec::new()).is_err());
    // A NaN tolerance falls back to the default.
    let f = SurfaceFlow::new(base(), target, FlowOptions { tol: f64::NAN, ..FlowOptions::default() }).unwrap();
    assert!(f.tolerance() > 0.0 && f.tolerance().is_finite());
    assert!(f.map_point(v(f64::NAN, 0.0, 0.0)).is_err());
    assert!(f.map_polyline(&[v(0.0, 0.0, 0.0), v(f64::INFINITY, 0.0, 0.0)], false).is_err());
    assert!(f.map_rigid(&[], None).is_err());
    assert!(f.map_polyline(&[], false).unwrap().is_empty());
    // Huge coordinates: clamped, finite.
    let q = f.map_point(v(1e300, -1e300, 0.0)).unwrap();
    assert!(q.point.is_finite() && !q.inside);
    // A tiny tolerance on a long line stays bounded.
    let tight =
        SurfaceFlow::new(FlowBase::rect_xy(0.0, 0.0, 1.0, 1.0), cylinder(1.0, 1.0), FlowOptions { tol: 1e-300, ..FlowOptions::default() }).unwrap();
    match tight.map_polyline(&[v(0.0, 0.5, 0.0), v(1.0, 0.5, 0.0)], false) {
        Ok(p) => assert!(p.len() <= MAX_FLOW_POINTS),
        Err(e) => assert_eq!(e, SurfaceError::TooLarge),
    }
    assert!(CurveFlow::new(Vec3::ZERO, Vec3::ZERO, NurbsCurve3::line(Vec3::ZERO, Vec3::Z).unwrap(), FlowOptions::default()).is_err());
    assert!(CurveFlow::new(Vec3::ZERO, Vec3::Z, NurbsCurve3::line(Vec3::Z, Vec3::Z).unwrap(), FlowOptions::default()).is_err());
}
