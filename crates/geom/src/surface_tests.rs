//! Known-answer, property and hostile-input tests for NURBS surfaces (deterministic xorshift).

use std::f64::consts::{FRAC_PI_2, PI, TAU};

use crate::nurbs_surface::basis_derivs;
use crate::spline::find_span;
use crate::{FrameMode, NurbsCurve3, NurbsSurface, SurfaceError, TessOptions, Vec3, rail_frames, tessellate};

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
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.unit()
    }
    fn int(&mut self, a: usize, b: usize) -> usize {
        a + (self.next() % (b - a + 1) as u64) as usize
    }
    fn vec(&mut self, s: f64) -> Vec3 {
        Vec3::new(self.range(-s, s), self.range(-s, s), self.range(-s, s))
    }
}

fn clamped_knots(rng: &mut Rng, n: usize, p: usize) -> Vec<f64> {
    let mut k = vec![0.0; p + 1];
    let mut t = 0.0;
    for _ in 0..n - p - 1 {
        t += rng.range(0.2, 1.0);
        k.push(t);
    }
    t += rng.range(0.2, 1.0);
    k.extend(std::iter::repeat_n(t, p + 1));
    k
}

fn random_surface(rng: &mut Rng, rational: bool) -> NurbsSurface {
    let (pu, pv) = (rng.int(1, 3), rng.int(1, 3));
    let (nu, nv) = (pu + 1 + rng.int(0, 4), pv + 1 + rng.int(0, 4));
    let ku = clamped_knots(rng, nu, pu);
    let kv = clamped_knots(rng, nv, pv);
    let pts = (0..nu * nv).map(|_| rng.vec(10.0)).collect();
    let w = if rational { (0..nu * nv).map(|_| rng.range(0.3, 3.0)).collect() } else { Vec::new() };
    NurbsSurface::new(pu, pv, ku, kv, nu, nv, pts, w).unwrap()
}

fn params(s: &NurbsSurface, n: usize) -> Vec<(f64, f64)> {
    let (ua, ub) = s.domain_u();
    let (va, vb) = s.domain_v();
    let mut out = Vec::new();
    for i in 0..=n {
        for j in 0..=n {
            out.push((ua + (ub - ua) * i as f64 / n as f64, va + (vb - va) * j as f64 / n as f64));
        }
    }
    out
}

fn sphere(r: f64) -> NurbsSurface {
    let arc = NurbsCurve3::arc(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0), Vec3::Z, r, -FRAC_PI_2, PI).unwrap();
    NurbsSurface::revolve(&arc, Vec3::ZERO, Vec3::Z, TAU).unwrap()
}

fn torus(big: f64, small: f64) -> NurbsSurface {
    let c = NurbsCurve3::circle(Vec3::new(big, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), small).unwrap();
    NurbsSurface::revolve(&c, Vec3::ZERO, Vec3::Z, TAU).unwrap()
}

fn torus_dist(p: Vec3, big: f64, small: f64) -> f64 {
    ((p.x.hypot(p.y) - big).hypot(p.z) - small).abs()
}

// ---------- evaluation ----------

#[test]
fn bilinear_patch_points() {
    let (a, b, c, d) = (Vec3::new(0.0, 0.0, 0.0), Vec3::new(4.0, 0.0, 1.0), Vec3::new(0.0, 3.0, 2.0), Vec3::new(5.0, 5.0, -1.0));
    let s = NurbsSurface::bilinear(a, b, c, d).unwrap();
    for (u, v) in params(&s, 10) {
        let e = a * ((1.0 - u) * (1.0 - v)) + b * (u * (1.0 - v)) + c * ((1.0 - u) * v) + d * (u * v);
        assert!((s.point(u, v) - e).len() < 1e-14);
        let dd = s.derivs(u, v);
        assert!((dd.du - ((b - a) * (1.0 - v) + (d - c) * v)).len() < 1e-13);
        assert!((dd.duv - (a - b - c + d)).len() < 1e-13);
        assert!(dd.duu.len() < 1e-13 && dd.dvv.len() < 1e-13);
    }
}

#[test]
fn basis_derivatives_sum_to_zero_and_match_differences() {
    let knots = [0.0, 0.0, 0.0, 0.0, 0.3, 0.5, 0.5, 0.8, 1.0, 1.0, 1.0, 1.0];
    let (p, n) = (3, 8);
    for k in 0..=200 {
        let u = k as f64 / 200.0;
        let s = find_span(n - 1, p, u, &knots);
        for d in 1..=3 {
            let sum: f64 = basis_derivs(s, u, p, &knots, d).iter().sum();
            assert!(sum.abs() < 1e-9, "d{d} sum {sum} at {u}");
        }
    }
}

#[test]
fn derivatives_match_finite_differences() {
    let mut rng = Rng(0x5eed_0001);
    let mut worst: f64 = 0.0;
    for _ in 0..200 {
        let s = random_surface(&mut rng, true);
        let (ua, ub) = s.domain_u();
        let (va, vb) = s.domain_v();
        for _ in 0..10 {
            let u = rng.range(ua + 0.01, ub - 0.01);
            let v = rng.range(va + 0.01, vb - 0.01);
            // Stay away from knots (derivatives jump there).
            if s.knots_u().iter().any(|k| (k - u).abs() < 2e-3) || s.knots_v().iter().any(|k| (k - v).abs() < 2e-3) {
                continue;
            }
            let h = 1e-5;
            let d = s.derivs(u, v);
            let fd_u = (s.point(u + h, v) - s.point(u - h, v)) * (0.5 / h);
            let fd_v = (s.point(u, v + h) - s.point(u, v - h)) * (0.5 / h);
            let fd_uu = (s.derivs(u + h, v).du - s.derivs(u - h, v).du) * (0.5 / h);
            let fd_uv = (s.derivs(u, v + h).du - s.derivs(u, v - h).du) * (0.5 / h);
            let fd_vv = (s.derivs(u, v + h).dv - s.derivs(u, v - h).dv) * (0.5 / h);
            let scale = 1.0 + d.du.len() + d.dv.len() + d.duu.len() + d.dvv.len() + d.duv.len();
            for (a, b) in [(d.du, fd_u), (d.dv, fd_v), (d.duu, fd_uu), (d.duv, fd_uv), (d.dvv, fd_vv)] {
                let e = (a - b).len() / scale;
                worst = worst.max(e);
                assert!(e < 1e-5, "derivative error {e}");
            }
        }
    }
    eprintln!("worst relative derivative error vs central differences: {worst:e}");
}

#[test]
fn grid_evaluation_matches_points() {
    let mut rng = Rng(77);
    let s = random_surface(&mut rng, true);
    let (ua, ub) = s.domain_u();
    let (va, vb) = s.domain_v();
    let us: Vec<f64> = (0..=13).map(|i| ua + (ub - ua) * i as f64 / 13.0).collect();
    let vs: Vec<f64> = (0..=7).map(|i| va + (vb - va) * i as f64 / 7.0).collect();
    let g = s.eval_grid(&us, &vs).unwrap();
    for (i, u) in us.iter().enumerate() {
        for (j, v) in vs.iter().enumerate() {
            assert!((g[i * vs.len() + j] - s.point(*u, *v)).len() < 1e-12);
        }
    }
}

#[test]
fn normal_of_plane_and_sphere() {
    let s = NurbsSurface::bilinear(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), Vec3::new(1.0, 1.0, 0.0)).unwrap();
    assert!((s.normal(0.3, 0.6).unwrap() - Vec3::Z).len() < 1e-14);
    let sp = sphere(2.0);
    for (u, v) in params(&sp, 20) {
        let n = sp.normal(u, v).unwrap();
        let p = sp.point(u, v).normalized();
        assert!(n.dot(p).abs() > 1.0 - 1e-5, "normal not radial at {u},{v}");
    }
}

// ---------- refinement ----------

fn max_dev(a: &NurbsSurface, b: &NurbsSurface) -> f64 {
    params(a, 24).iter().map(|&(u, v)| (a.point(u, v) - b.point(u, v)).len()).fold(0.0, f64::max)
}

#[test]
fn knot_insertion_and_elevation_preserve_shape() {
    let mut rng = Rng(0xabcdef);
    let mut worst: f64 = 0.0;
    for case in 0..150 {
        let s = random_surface(&mut rng, case % 2 == 0);
        let (ua, ub) = s.domain_u();
        let (va, vb) = s.domain_v();
        let tu = rng.range(ua, ub);
        let tv = rng.range(va, vb);
        let a = s.insert_knot_u(tu, rng.int(1, 3)).unwrap();
        let b = a.insert_knot_v(tv, 1).unwrap();
        let c = b.refine_u(&[ua + (ub - ua) * 0.37, ua + (ub - ua) * 0.71]).unwrap_or(b.clone());
        let d = s.elevate_u(rng.int(1, 2)).unwrap().elevate_v(1).unwrap();
        for t in [&a, &b, &c, &d] {
            let e = max_dev(&s, t);
            worst = worst.max(e);
            assert!(e < 1e-9, "shape changed by {e}");
        }
        assert_eq!(d.degree_v(), s.degree_v() + 1);
    }
    eprintln!("worst deviation after insertion/refinement/elevation: {worst:e}");
}

#[test]
fn insertion_refuses_bad_knots() {
    let s = NurbsSurface::bilinear(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), Vec3::new(1.0, 1.0, 0.0)).unwrap();
    assert!(s.insert_knot_u(f64::NAN, 1).is_err());
    assert!(s.insert_knot_u(2.0, 1).is_err());
    assert!(s.insert_knot_u(0.0, 1).is_err());
    let t = s.insert_knot_u(0.5, 1).unwrap();
    assert_eq!(t.insert_knot_u(0.5, 1), Err(SurfaceError::KnotMultiplicity));
}

// ---------- constructors ----------

#[test]
fn revolved_semicircle_is_exactly_a_sphere() {
    let r = 3.5;
    let s = sphere(r);
    assert!(s.is_rational());
    let mut worst: f64 = 0.0;
    for (u, v) in params(&s, 99) {
        worst = worst.max((s.point(u, v).len() - r).abs());
    }
    eprintln!("sphere radius error over 10 000 samples: {worst:e}");
    assert!(worst <= 1e-9);
}

#[test]
fn revolved_circle_is_exactly_a_torus() {
    let (big, small) = (10.0, 2.5);
    let s = torus(big, small);
    let mut worst: f64 = 0.0;
    for (u, v) in params(&s, 99) {
        worst = worst.max(torus_dist(s.point(u, v), big, small));
    }
    eprintln!("torus error over 10 000 samples: {worst:e}");
    assert!(worst <= 1e-9);
    // Partial revolution: ends at the right angle.
    let c = NurbsCurve3::circle(Vec3::new(big, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), small).unwrap();
    let q = NurbsSurface::revolve(&c, Vec3::ZERO, Vec3::Z, 2.0).unwrap();
    let e = q.point(0.0, 1.0);
    assert!((e.y.atan2(e.x) - 2.0).abs() < 1e-12);
}

#[test]
fn extrusion_matches_definition() {
    let c = NurbsCurve3::arc(Vec3::new(1.0, 2.0, 0.0), Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), 4.0, 0.3, 4.0).unwrap();
    let d = Vec3::new(0.5, -1.0, 7.0);
    let s = NurbsSurface::extrude(&c, d).unwrap();
    let (a, b) = c.domain();
    for i in 0..=40 {
        let u = a + (b - a) * i as f64 / 40.0;
        for j in 0..=10 {
            let v = j as f64 / 10.0;
            assert!((s.point(u, v) - (c.point(u) + d * v)).len() < 1e-12);
        }
    }
    assert!(NurbsSurface::extrude(&c, Vec3::ZERO).is_err());
}

#[test]
fn ruled_surface_matches_definition() {
    let a = NurbsCurve3::line(Vec3::ZERO, Vec3::new(10.0, 0.0, 0.0)).unwrap();
    let b = NurbsCurve3::new(
        3,
        vec![0.0, 0.0, 0.0, 0.0, 0.4, 1.0, 1.0, 1.0, 1.0],
        vec![Vec3::new(0.0, 5.0, 1.0), Vec3::new(2.0, 7.0, 3.0), Vec3::new(5.0, 3.0, 2.0), Vec3::new(8.0, 6.0, 0.0), Vec3::new(10.0, 5.0, 1.0)],
        Vec::new(),
    )
    .unwrap();
    let s = NurbsSurface::ruled(&a, &b).unwrap();
    for i in 0..=50 {
        let u = i as f64 / 50.0;
        for j in 0..=10 {
            let v = j as f64 / 10.0;
            let e = a.point(u) * (1.0 - v) + b.point(u) * v;
            assert!((s.point(u, v) - e).len() < 1e-11, "ruled mismatch");
        }
    }
}

#[test]
fn loft_passes_through_its_sections() {
    let secs = vec![
        NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, 2.0).unwrap(),
        NurbsCurve3::circle(Vec3::new(0.0, 0.0, 1.0), Vec3::Z, 3.0).unwrap(),
        NurbsCurve3::circle(Vec3::new(0.5, 0.0, 3.0), Vec3::Z, 1.5).unwrap(),
        NurbsCurve3::from_control(vec![Vec3::new(-1.0, 0.0, 5.0), Vec3::new(0.0, 2.0, 5.0), Vec3::new(1.0, 0.0, 5.0), Vec3::new(0.0, -2.0, 5.5)], 3)
            .unwrap(),
    ];
    let s = NurbsSurface::loft(&secs, 3).unwrap();
    let mut worst: f64 = 0.0;
    for c in &secs {
        let (a, b) = c.domain();
        for i in 0..=30 {
            let p = c.point(a + (b - a) * i as f64 / 30.0);
            worst = worst.max(s.closest_point(p).unwrap().distance);
        }
    }
    eprintln!("loft: worst distance from section points to surface {worst:e}");
    assert!(worst < 1e-8);
    assert!(NurbsSurface::loft(&secs[..1], 3).is_err());
    assert!(NurbsSurface::loft(&[secs[0].clone(), secs[0].clone()], 3).is_err());
}

#[test]
fn sweep_along_a_line_is_an_exact_cylinder() {
    let rail = NurbsCurve3::line(Vec3::ZERO, Vec3::new(0.0, 0.0, 12.0)).unwrap();
    let prof = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, 1.25).unwrap();
    for mode in [FrameMode::RotationMinimizing, FrameMode::Upright { axis: Vec3::new(0.0, 1.0, 0.0) }] {
        let s = NurbsSurface::sweep1(&rail, &prof, mode, 8).unwrap();
        for (u, v) in params(&s, 40) {
            let p = s.point(u, v);
            assert!((p.x.hypot(p.y) - 1.25).abs() < 1e-9);
        }
    }
}

#[test]
fn sweep_around_a_circle_approaches_a_torus() {
    let (big, small) = (10.0, 1.0);
    let rail = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, big).unwrap();
    let prof = NurbsCurve3::circle(Vec3::new(big, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), small).unwrap();
    let mut last = f64::MAX;
    for stations in [17, 33, 65, 129] {
        let s = NurbsSurface::sweep1(&rail, &prof, FrameMode::RotationMinimizing, stations).unwrap();
        let e = params(&s, 80).iter().map(|&(u, v)| torus_dist(s.point(u, v), big, small)).fold(0.0, f64::max);
        eprintln!("sweep1 circle rail, {stations} stations: max deviation from the torus {e:e}");
        assert!(e < last);
        last = e;
    }
    assert!(last < 1e-4);
    // The closed rail's frames close up (holonomy spread).
    let f = rail_frames(&rail, &(0..=32).map(|k| k as f64 / 32.0).collect::<Vec<_>>(), FrameMode::RotationMinimizing).unwrap();
    assert!((f[0].normal - f[32].normal).len() < 1e-9);
}

#[test]
fn upright_frames_follow_the_axis_and_survive_a_parallel_tangent() {
    // A helix-like rail: upright binormal stays in the plane of axis and tangent.
    let pts: Vec<Vec3> = (0..12).map(|k| Vec3::new((k as f64).cos() * 5.0, (k as f64).sin() * 5.0, k as f64 * 0.3)).collect();
    let rail = NurbsCurve3::from_control(pts, 3).unwrap();
    let ps: Vec<f64> = (0..=50).map(|k| k as f64 / 50.0).collect();
    let fr = rail_frames(&rail, &ps, FrameMode::Upright { axis: Vec3::Z }).unwrap();
    for f in &fr {
        assert!(f.normal.dot(Vec3::Z).abs() < 1e-9, "upright normal must be horizontal");
        assert!(f.binormal.dot(Vec3::Z) > 0.0);
    }
    // Rail parallel to the axis: the upright frame is undefined; falls back to rotation-minimising.
    let up = NurbsCurve3::line(Vec3::ZERO, Vec3::new(0.0, 0.0, 5.0)).unwrap();
    let fr = rail_frames(&up, &ps, FrameMode::Upright { axis: Vec3::Z }).unwrap();
    for f in &fr {
        assert!((f.tangent.len() - 1.0).abs() < 1e-12 && (f.normal.len() - 1.0).abs() < 1e-12);
        assert!(f.tangent.dot(f.normal).abs() < 1e-12);
        assert!((f.normal - fr[0].normal).len() < 1e-9, "no spurious twist");
    }
    let prof = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, 1.0).unwrap();
    assert!(NurbsSurface::sweep1(&up, &prof, FrameMode::Upright { axis: Vec3::Z }, 10).is_ok());
}

// ---------- tessellation ----------

#[test]
fn torus_tessellation_is_watertight_with_correct_area_and_volume() {
    let (big, small) = (10.0, 3.0);
    let s = torus(big, small);
    for tol in [0.1, 0.01] {
        let t0 = std::time::Instant::now();
        let m = tessellate(&s, &TessOptions { chord_tol: tol, ..TessOptions::default() }).unwrap();
        let el = t0.elapsed();
        assert!(!m.capped);
        assert_eq!(m.open_edges(), 0, "torus mesh must be closed");
        let area = 4.0 * PI * PI * big * small;
        let vol = 2.0 * PI * PI * big * small * small;
        let ea = (m.area() - area).abs() / area;
        let ev = (m.signed_volume().abs() - vol).abs() / vol;
        // Deviation of triangle centroids from the torus is bounded by the chordal tolerance.
        let mut dev: f64 = 0.0;
        for t in m.indices.chunks_exact(3) {
            let c = (m.positions[t[0] as usize] + m.positions[t[1] as usize] + m.positions[t[2] as usize]) * (1.0 / 3.0);
            dev = dev.max(torus_dist(c, big, small));
        }
        eprintln!(
            "torus R10 r3 tol {tol}: {} triangles in {el:?}, area err {ea:.2e}, volume err {ev:.2e}, max centroid dev {dev:.2e}",
            m.triangle_count()
        );
        assert!(ea < 20.0 * tol / small && ev < 20.0 * tol / small);
        assert!(dev < 2.0 * tol);
        assert_eq!(m.positions.len(), m.normals.len());
    }
}

#[test]
fn sphere_tessellation_is_closed_at_the_poles() {
    let s = sphere(5.0);
    let m = tessellate(&s, &TessOptions { chord_tol: 0.01, ..TessOptions::default() }).unwrap();
    assert_eq!(m.open_edges(), 0);
    let v = 4.0 / 3.0 * PI * 125.0;
    assert!((m.signed_volume().abs() - v).abs() / v < 5e-3);
}

#[test]
fn tessellation_respects_the_triangle_cap() {
    let s = torus(10.0, 3.0);
    let m = tessellate(&s, &TessOptions { chord_tol: 1e-7, angle_tol: 1e-3, max_triangles: 5000 }).unwrap();
    assert!(m.capped);
    assert!(m.triangle_count() <= 5000);
    assert_eq!(m.open_edges(), 0);
    assert!(tessellate(&s, &TessOptions { chord_tol: f64::NAN, ..TessOptions::default() }).is_err());
    assert!(tessellate(&s, &TessOptions { chord_tol: -1.0, ..TessOptions::default() }).is_err());
}

// ---------- projection, area, volume ----------

#[test]
fn closest_point_on_torus_matches_analytic_distance() {
    let (big, small) = (10.0, 3.0);
    let s = torus(big, small);
    let mut rng = Rng(99);
    let mut worst: f64 = 0.0;
    for _ in 0..300 {
        let p = rng.vec(16.0);
        if p.x.hypot(p.y) < 1.0 {
            continue; // near the axis the nearest circle is ambiguous
        }
        let c = s.closest_point(p).unwrap();
        let exact = torus_dist(p, big, small);
        worst = worst.max((c.distance - exact).abs());
        assert!(torus_dist(c.point, big, small) < 1e-9);
    }
    eprintln!("closest point on torus: worst |distance − exact| {worst:e}");
    assert!(worst < 1e-8);
}

#[test]
fn closest_point_beats_dense_sampling_on_random_surfaces() {
    let mut rng = Rng(4242);
    for case in 0..60 {
        let s = random_surface(&mut rng, case % 2 == 1);
        let p = rng.vec(12.0);
        let c = s.closest_point(p).unwrap();
        let dense = params(&s, 120).iter().map(|&(u, v)| (s.point(u, v) - p).len()).fold(f64::MAX, f64::min);
        assert!(c.distance <= dense + 1e-9, "case {case}: newton {} vs dense {dense}", c.distance);
        let (u, v) = s.invert(c.point, 1e-9).unwrap();
        assert!((s.point(u, v) - c.point).len() < 1e-7);
    }
}

#[test]
fn area_and_volume_by_quadrature() {
    let (big, small) = (10.0, 3.0);
    let t = torus(big, small);
    let a = t.area().unwrap();
    let v = t.volume().unwrap();
    let ea = (a - 4.0 * PI * PI * big * small).abs() / a;
    let ev = (v - 2.0 * PI * PI * big * small * small).abs() / v;
    eprintln!("quadrature torus: area rel err {ea:e}, volume rel err {ev:e}");
    assert!(ea < 1e-9 && ev < 1e-9);
    let s = sphere(2.0);
    assert!((s.area().unwrap() - 16.0 * PI).abs() < 1e-8);
    assert!((s.volume().unwrap() - 32.0 / 3.0 * PI).abs() < 1e-8);
    let open = NurbsSurface::bilinear(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), Vec3::new(1.0, 1.0, 0.0)).unwrap();
    assert!((open.area().unwrap() - 1.0).abs() < 1e-12);
    assert_eq!(open.volume(), Err(SurfaceError::NotClosed));
}

// ---------- properties and hostile input ----------

#[test]
fn random_surfaces_evaluate_finite_and_tessellate_bounded() {
    let mut rng = Rng(0xfeed);
    for case in 0..80 {
        let s = random_surface(&mut rng, case % 3 != 0);
        for (u, v) in params(&s, 10) {
            let d = s.derivs(u, v);
            assert!(d.point.is_finite() && d.du.is_finite() && d.dvv.is_finite());
        }
        let m = tessellate(&s, &TessOptions { chord_tol: 0.05, angle_tol: 0.3, max_triangles: 20_000 }).unwrap();
        assert!(m.triangle_count() <= 20_000);
        // Every edge is shared by at most two triangles; the open edges are the boundary.
        let mut edges = std::collections::HashMap::new();
        for t in m.indices.chunks_exact(3) {
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                *edges.entry((a.min(b), a.max(b))).or_insert(0usize) += 1;
            }
        }
        assert!(edges.values().all(|&c| c <= 2), "non-manifold edge");
        assert!(m.positions.iter().all(|p| p.is_finite()));
    }
}

#[test]
fn hostile_surfaces_are_refused() {
    let k = vec![0.0, 0.0, 1.0, 1.0];
    let p4 = vec![Vec3::ZERO; 4];
    let mk = |pu, pv, ku: Vec<f64>, kv: Vec<f64>, nu, nv, pts: Vec<Vec3>, w: Vec<f64>| NurbsSurface::new(pu, pv, ku, kv, nu, nv, pts, w);
    assert!(mk(1, 1, k.clone(), k.clone(), 2, 2, p4.clone(), vec![1.0, 0.0, 1.0, 1.0]).is_err());
    assert!(mk(1, 1, k.clone(), k.clone(), 2, 2, p4.clone(), vec![1.0, f64::NAN, 1.0, 1.0]).is_err());
    assert!(mk(1, 1, k.clone(), k.clone(), 2, 2, p4.clone(), vec![1.0, -2.0, 1.0, 1.0]).is_err());
    assert!(mk(1, 1, vec![0.0, 1.0, 0.0, 1.0], k.clone(), 2, 2, p4.clone(), vec![]).is_err());
    assert!(mk(1, 1, vec![0.0, 0.0, 1.0], k.clone(), 2, 2, p4.clone(), vec![]).is_err());
    assert!(mk(1, 1, vec![0.0, 0.0, 0.0, 0.0], k.clone(), 2, 2, p4.clone(), vec![]).is_err());
    assert!(mk(0, 1, vec![0.0, 1.0], k.clone(), 1, 2, vec![Vec3::ZERO; 2], vec![]).is_err());
    assert!(mk(1, 1, k.clone(), k.clone(), 2, 2, vec![Vec3::new(f64::INFINITY, 0.0, 0.0); 4], vec![]).is_err());
    assert!(mk(1, 1, k.clone(), k.clone(), usize::MAX, 2, p4.clone(), vec![]).is_err());
    assert!(mk(1, 1, k.clone(), k.clone(), 4096, 4096, p4.clone(), vec![]).is_err());
    assert!(mk(30, 1, vec![0.0; 62], k.clone(), 31, 2, vec![Vec3::ZERO; 62], vec![]).is_err());
    // Interior multiplicity above the degree.
    assert!(mk(2, 1, vec![0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0], k.clone(), 6, 2, vec![Vec3::ZERO; 12], vec![]).is_err());
    // Degenerate constructors.
    let c = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, 1.0).unwrap();
    assert!(NurbsSurface::revolve(&c, Vec3::ZERO, Vec3::ZERO, TAU).is_err());
    assert!(NurbsSurface::revolve(&c, Vec3::ZERO, Vec3::Z, 0.0).is_err());
    assert!(NurbsSurface::revolve(&c, Vec3::ZERO, Vec3::Z, f64::NAN).is_err());
    assert!(NurbsCurve3::circle(Vec3::ZERO, Vec3::ZERO, 1.0).is_err());
    assert!(NurbsCurve3::arc(Vec3::ZERO, Vec3::Z, Vec3::Z, 1.0, 0.0, 1.0).is_err());
    let pt = NurbsCurve3::line(Vec3::ZERO, Vec3::ZERO).unwrap();
    assert!(NurbsSurface::sweep1(&pt, &c, FrameMode::RotationMinimizing, 10).is_err());
    assert!(NurbsSurface::sweep1(&c, &c, FrameMode::RotationMinimizing, 1).is_err());
    assert!(NurbsSurface::sweep1(&c, &c, FrameMode::Upright { axis: Vec3::new(f64::NAN, 0.0, 0.0) }, 5).is_err());
    assert!(sphere(1.0).closest_point(Vec3::new(f64::NAN, 0.0, 0.0)).is_err());
}

#[test]
fn hostile_params_never_panic() {
    let mut rng = Rng(0xbad);
    let nasty = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e308, -1e308, 0.0, f64::MIN_POSITIVE, -0.0];
    for case in 0..60 {
        let s = random_surface(&mut rng, true);
        for &a in &nasty {
            for &b in &nasty {
                let _ = s.point(a, b);
                let _ = s.derivs(a, b);
                let _ = s.normal(a, b);
                let _ = s.insert_knot_u(a, 2);
                let _ = s.insert_knot_v(b, 9);
                let _ = s.refine_u(&[a, b]);
                let _ = s.eval_grid(&[a, b], &[b, a]);
                let _ = s.iso_u(a);
                let _ = s.invert(Vec3::new(a, b, 0.0), a);
                let _ = tessellate(&s, &TessOptions { chord_tol: a, angle_tol: b, max_triangles: case });
            }
        }
        // Random raw mutations of a valid surface's arrays.
        let mut ku = s.knots_u().to_vec();
        if let Some(x) = ku.get_mut(rng.int(0, s.knots_u().len() - 1)) {
            *x = nasty[rng.int(0, nasty.len() - 1)];
        }
        let _ = NurbsSurface::new(s.degree_u(), s.degree_v(), ku, s.knots_v().to_vec(), s.count_u(), s.count_v(), s.points().to_vec(), vec![]);
        let mut w = s.weights().to_vec();
        if let Some(x) = w.get_mut(0) {
            *x = nasty[rng.int(0, nasty.len() - 1)];
        }
        let _ = NurbsSurface::new(
            s.degree_u(),
            s.degree_v(),
            s.knots_u().to_vec(),
            s.knots_v().to_vec(),
            s.count_u(),
            s.count_v(),
            s.points().to_vec(),
            w,
        );
    }
    // Coincident sections and coincident control points.
    let p = NurbsCurve3::line(Vec3::ZERO, Vec3::ZERO).unwrap();
    let _ = NurbsSurface::loft(&[p.clone(), p.clone(), p.clone()], 3);
    let _ = NurbsSurface::ruled(&p, &p);
    let flat = NurbsSurface::ruled(&p, &p).unwrap();
    let _ = tessellate(&flat, &TessOptions::default());
    let _ = flat.closest_point(Vec3::new(1.0, 2.0, 3.0));
    let _ = flat.normal(0.5, 0.5);
}

/// Throughput numbers for the report (`cargo test --release -- --ignored perf --nocapture`).
#[test]
#[ignore]
fn perf_report() {
    let t = torus(10.0, 3.0);
    let n = 400_000;
    let t0 = std::time::Instant::now();
    let mut acc = 0.0;
    for k in 0..n {
        acc += t.point((k % 977) as f64 / 977.0, (k % 631) as f64 / 631.0).x;
    }
    let pe = t0.elapsed().as_secs_f64();
    let t0 = std::time::Instant::now();
    for k in 0..n / 4 {
        acc += t.derivs((k % 977) as f64 / 977.0, (k % 631) as f64 / 631.0).du.x;
    }
    let de = t0.elapsed().as_secs_f64();
    let us: Vec<f64> = (0..=999).map(|i| i as f64 / 999.0).collect();
    let t0 = std::time::Instant::now();
    let g = t.eval_grid(&us, &us).unwrap();
    let ge = t0.elapsed().as_secs_f64();
    eprintln!(
        "point: {:.2} M/s; derivs: {:.2} M/s; grid: {:.2} M/s ({acc:.1} {})",
        n as f64 / pe / 1e6,
        n as f64 / 4.0 / de / 1e6,
        g.len() as f64 / ge / 1e6,
        g.len()
    );
    for tol in [0.1, 0.01, 0.001] {
        let t0 = std::time::Instant::now();
        let m = tessellate(&t, &TessOptions { chord_tol: tol, ..TessOptions::default() }).unwrap();
        eprintln!("torus R10 r3 tol {tol}: {} tris in {:?}", m.triangle_count(), t0.elapsed());
    }
    let mut rng = Rng(5);
    let t0 = std::time::Instant::now();
    for _ in 0..1000 {
        let _ = t.closest_point(rng.vec(15.0));
    }
    eprintln!("closest point: {:.1} µs each", t0.elapsed().as_secs_f64() * 1e3);
}
