//! The merged solid's creases: a flat band's corners, a box's edges and corners, a bezel's rim
//! stand where the true surface's do, not chamfered by the grid.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::time::Instant;

use cadcraft_geom::{Vec2, Vec3};
use hegel::TestCase;
use hegel::generators::{self as gs};

use super::mesh::*;
use super::solid::*;
use super::solid_sharp::qef_point;
use super::solid_tests::{assert_castable, params, report_pieces, surface_error, tri, write_stl};

/// The nearest point of triangle `t` to `p` (Ericson, *Real-Time Collision Detection*, §5.1.5).
fn closest_on_triangle(p: Vec3, [a, b, c]: [Vec3; 3]) -> Vec3 {
    let (ab, ac, ap) = (b - a, c - a, p - a);
    let (d1, d2) = (ab.dot(ap), ac.dot(ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = p - b;
    let (d3, d4) = (ab.dot(bp), ac.dot(bp));
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return a + ab * (d1 / (d1 - d3));
    }
    let cp = p - c;
    let (d5, d6) = (ab.dot(cp), ac.dot(cp));
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return a + ac * (d2 / (d2 - d6));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    }
    let denom = 1.0 / (va + vb + vc);
    a + ab * (vb * denom) + ac * (vc * denom)
}

/// How far each true crease point is from the shell: mean and max, mm.
fn crease_error(s: &Solid, crease: &[Vec3]) -> (f64, f64) {
    let reach = 4.0 * s.step;
    let cell = reach;
    let key = |p: Vec3| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64, (p.z / cell).floor() as i64);
    let mut bins: std::collections::HashMap<(i64, i64, i64), Vec<usize>> = std::collections::HashMap::new();
    let tris: Vec<[Vec3; 3]> = s.indices.chunks_exact(3).map(|t| tri(s, t)).collect();
    for (i, t) in tris.iter().enumerate() {
        bins.entry(key((t[0] + t[1] + t[2]) * (1.0 / 3.0))).or_default().push(i);
    }
    let mut d = Vec::new();
    for p in crease {
        let (x, y, z) = key(*p);
        let mut best = f64::INFINITY;
        for dz in -1..=1 {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    for &i in bins.get(&(x + dx, y + dy, z + dz)).map_or(&[][..], Vec::as_slice) {
                        best = best.min((closest_on_triangle(*p, tris[i]) - *p).len());
                    }
                }
            }
        }
        d.push(best.min(reach));
    }
    (d.iter().sum::<f64>() / d.len().max(1) as f64, d.iter().copied().fold(0.0, f64::max))
}

/// The worst bend across an edge between two triangles that both lie on one flat side (all three
/// corners within `tol` of a face plane), in degrees: zero for a crisp, flat-sided solid.
fn flat_side_bend(s: &Solid, on_face: &dyn Fn(Vec3) -> Option<usize>) -> f64 {
    let mut faces: std::collections::HashMap<(u32, u32), (Vec3, Option<usize>)> = std::collections::HashMap::new();
    let mut worst: f64 = 0.0;
    for t in s.indices.chunks_exact(3) {
        let [a, b, c] = tri(s, t);
        let n = (b - a).cross(c - a);
        let n = n * (1.0 / n.len());
        let fa = on_face(a);
        let face = if fa.is_some() && fa == on_face(b) && fa == on_face(c) { fa } else { None };
        for k in 0..3 {
            let (i, j) = (t[k], t[(k + 1) % 3]);
            if let Some((m, g)) = faces.get(&(j, i)) {
                if face.is_some() && *g == face {
                    worst = worst.max(n.dot(*m).clamp(-1.0, 1.0).acos().to_degrees());
                }
            } else {
                faces.insert((i, j), (n, face));
            }
        }
    }
    worst
}

/// A flat band (a rectangle revolved about Z): its field and its four corner circles.
fn flat_band(ri: f64, wall: f64, width: f64) -> (Csg, Vec<Vec3>, f64) {
    let (ro, hw) = (ri + wall, width / 2.0);
    let section = Section::new(vec![Vec2::new(ri, -hw), Vec2::new(ro, -hw), Vec2::new(ro, hw), Vec2::new(ri, hw)]);
    let csg = Csg { add: vec![Prim::Revolve(section)], cut: Vec::new() };
    let mut crease = Vec::new();
    for (r, z) in [(ri, -hw), (ro, -hw), (ro, hw), (ri, hw)] {
        for k in 0..400 {
            let a = (k as f64 + 0.37) / 400.0 * std::f64::consts::TAU;
            crease.push(Vec3::new(r * a.cos(), r * a.sin(), z));
        }
    }
    let volume = std::f64::consts::PI * (ro * ro - ri * ri) * width;
    (csg, crease, volume)
}

/// A box `a × b × c` turned by Euler angles: its field, points along its twelve edges, its
/// volume and its axes.
fn tilted_box(dims: [f64; 3], angles: [f64; 3]) -> (Csg, Vec<Vec3>, f64, Axes) {
    let [x, y, z] = angles;
    let rot = |v: Vec3| {
        let v = Vec3::new(v.x, v.y * x.cos() - v.z * x.sin(), v.y * x.sin() + v.z * x.cos());
        let v = Vec3::new(v.x * y.cos() + v.z * y.sin(), v.y, -v.x * y.sin() + v.z * y.cos());
        Vec3::new(v.x * z.cos() - v.y * z.sin(), v.x * z.sin() + v.y * z.cos(), v.z)
    };
    let axes = Axes {
        o: Vec3::new(0.013, -0.021, 0.007),
        u: rot(Vec3::new(1.0, 0.0, 0.0)),
        v: rot(Vec3::new(0.0, 1.0, 0.0)),
        w: rot(Vec3::new(0.0, 0.0, 1.0)),
    };
    let [a, b, c] = dims.map(|d| d / 2.0);
    let outline = Outline::Poly(vec![Vec2::new(-a, -b), Vec2::new(a, -b), Vec2::new(a, b), Vec2::new(-a, b)]);
    let csg = Csg { add: vec![Prim::Plate { axes, outline, inner: -1e3, outer: 0.0, lo: -c, hi: c }], cut: Vec::new() };
    let mut crease = Vec::new();
    let corner = |i: usize| Vec3::new(if i & 1 == 0 { -a } else { a }, if i & 2 == 0 { -b } else { b }, if i & 4 == 0 { -c } else { c });
    for i in 0..8usize {
        for bit in [1usize, 2, 4] {
            if i & bit == 0 {
                let (p, q) = (corner(i), corner(i | bit));
                // Away from the corners, which are a separate matter (three faces).
                for k in 1..60 {
                    let t = k as f64 / 60.0;
                    let l = p + (q - p) * t;
                    crease.push(axes.o + axes.u * l.x + axes.v * l.y + axes.w * l.z);
                }
            }
        }
    }
    (csg, crease, dims[0] * dims[1] * dims[2], axes)
}

fn solid(csg: &Csg, step: f64, finish: Finish) -> Solid {
    solidify_with(csg, step, 1_000_000, finish).unwrap().0
}

/// Rule: a flat band's corners stand where the true ones do. Projected only, the grid leaves a
/// chamfer about a third of a step deep; with the creases sharpened the corner circles lie on the
/// shell to a small fraction of the step, the band's flat sides are flat, its volume nearer the
/// analytic one, and the shell is still everything a caster's must be.
#[test]
fn a_flat_band_has_crisp_corners() {
    for (ri, wall, width, step) in [(8.5, 1.8, 4.0, 0.2), (8.5, 1.8, 4.0, 0.1), (7.0, 1.2, 2.0, 0.2)] {
        let (csg, crease, volume) = flat_band(ri, wall, width);
        let smooth = solid(&csg, step, Finish::Smooth);
        let sharp = solid(&csg, step, Finish::Sharp);
        assert_castable(&sharp, "flat band");
        assert_eq!(smooth.triangles(), sharp.triangles(), "the same connectivity");
        let (sm, sx) = crease_error(&smooth, &crease);
        let (hm, hx) = crease_error(&sharp, &crease);
        let (ve0, ve1) = ((smooth.volume() / volume - 1.0).abs(), (sharp.volume() / volume - 1.0).abs());
        let side = |p: Vec3| {
            let (r, z) = (p.x.hypot(p.y), p.z);
            let tol = 1e-6;
            if (z + width / 2.0).abs() < tol {
                Some(0)
            } else if (z - width / 2.0).abs() < tol {
                Some(1)
            } else {
                None
            }
            .filter(|_| r > ri - tol && r < ri + wall + tol)
        };
        let (b0, b1) = (flat_side_bend(&smooth, &side), flat_side_bend(&sharp, &side));
        println!(
            "flat band {ri}+{wall}×{width} at {step}: crease mean {sm:.4} → {hm:.4} mm, max {sx:.4} → {hx:.4} mm; volume off {:.3}% → {:.3}%; side bend {b0:.2}° → {b1:.2}°",
            ve0 * 100.0,
            ve1 * 100.0
        );
        assert!(hm < 0.25 * sm, "crease mean {hm} vs {sm}");
        assert!(hm < 0.05 * step, "crease mean {hm} at {step}");
        assert!(hx < sx, "crease max {hx} vs {sx}");
        assert!(ve1 < ve0, "volume {ve1} vs {ve0}");
        assert!(b1 < 1.0, "the sides are flat: {b1}°");
    }
}

/// Rule: a box turned off the grid's axes keeps its edges: the crease points lie on the shell to
/// a small fraction of the step, and its volume is the box's.
#[test]
fn a_tilted_box_keeps_its_edges() {
    let (csg, crease, volume, _) = tilted_box([3.0, 2.0, 1.5], [0.3, 0.5, 0.7]);
    for step in [0.1, 0.2] {
        let smooth = solid(&csg, step, Finish::Smooth);
        let sharp = solid(&csg, step, Finish::Sharp);
        assert_castable(&sharp, "tilted box");
        let (sm, sx) = crease_error(&smooth, &crease);
        let (hm, hx) = crease_error(&sharp, &crease);
        println!(
            "box at {step}: crease mean {sm:.4} → {hm:.4} mm, max {sx:.4} → {hx:.4} mm; volume off {:.3}% → {:.3}%",
            (smooth.volume() / volume - 1.0) * 100.0,
            (sharp.volume() / volume - 1.0) * 100.0
        );
        assert!(hm < 0.3 * sm, "crease mean {hm} vs {sm}");
        assert!(hx < sx, "crease max {hx} vs {sx}");
        assert!((sharp.volume() / volume - 1.0).abs() < (smooth.volume() / volume - 1.0).abs());
    }
}

/// Rule: any box, any size and turn, at any usual step: the sharpened shell is castable, its
/// creases no farther from the true ones than the projected shell's, its volume no farther off.
#[hegel::test(test_cases = 25, suppress_health_check = [hegel::HealthCheck::TooSlow])]
fn any_box_is_sharpened_and_castable(tc: TestCase) {
    let d = |tc: &TestCase| f64::from(tc.draw(gs::integers::<u32>().min_value(6).max_value(40))) / 10.0;
    let dims = [d(&tc), d(&tc), d(&tc)];
    let a = |tc: &TestCase| f64::from(tc.draw(gs::integers::<i32>().min_value(-314).max_value(314))) / 100.0;
    let angles = [a(&tc), a(&tc), a(&tc)];
    let step = [0.1, 0.15, 0.2, 0.25][tc.draw(gs::integers::<usize>().min_value(0).max_value(3))];
    tc.note(&format!("{dims:?} {angles:?} {step}"));
    let (csg, crease, volume, _) = tilted_box(dims, angles);
    let smooth = solid(&csg, step, Finish::Smooth);
    let sharp = solid(&csg, step, Finish::Sharp);
    assert_castable(&sharp, "box");
    assert_eq!(smooth.triangles(), sharp.triangles());
    let (sm, _) = crease_error(&smooth, &crease);
    let (hm, _) = crease_error(&sharp, &crease);
    assert!(hm <= sm + 1e-9, "crease mean {hm} vs {sm}");
    assert!((sharp.volume() / volume - 1.0).abs() <= (smooth.volume() / volume - 1.0).abs() + 1e-4);
}

/// Rule: the quadric point of two planes is on their line, nearest the start along it; of three,
/// their corner; of one, the foot of the start on it; of none, nothing.
#[test]
fn the_quadric_point_meets_its_planes() {
    let x0 = Vec3::new(0.3, 0.2, 0.7);
    let (nx, ny, nz) = (Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 0.0, 1.0));
    let o = Vec3::ZERO;
    let two = qef_point(x0, &[(o, nx), (o, ny), (o, nx)]).unwrap();
    assert!((two - Vec3::new(0.0, 0.0, 0.7)).len() < 1e-9, "{two:?}");
    let three = qef_point(x0, &[(o, nx), (o, ny), (o, nz)]).unwrap();
    assert!(three.len() < 1e-9, "{three:?}");
    let one = qef_point(x0, &[(Vec3::new(5.0, 0.0, 0.0), nx)]).unwrap();
    assert!((one - Vec3::new(5.0, 0.2, 0.7)).len() < 1e-9, "{one:?}");
    assert!(qef_point(x0, &[]).is_none());
    // Nearly parallel planes (a gently curved surface): no slide along the curve.
    let n2 = Vec3::new(0.02, 1.0, 0.0) * (1.0 / 1.0002f64.sqrt());
    let flat = qef_point(x0, &[(o, ny), (o, n2)]).unwrap();
    assert!((flat.x - x0.x).abs() < 0.01, "{flat:?}");
    // Hostile input never panics.
    assert!(qef_point(x0, &[(o, Vec3::new(f64::NAN, 0.0, 0.0))]).is_none_or(|p| p.is_finite()));
    let _ = qef_point(Vec3::new(f64::INFINITY, 0.0, 0.0), &[(o, nx), (o, ny)]);
}

/// Rule: the usual pieces stay castable with their creases sharpened, keep their volume within
/// a hair of the projected shell's, and their surface no farther from the true one.
#[test]
fn the_sharpened_pieces_are_castable() {
    for (what, v) in report_pieces() {
        let mesh = piece_mesh(&params(&v), Quality::Draft);
        let smooth = solidify_with(&mesh.csg, 0.2, 400_000, Finish::Smooth).unwrap().0;
        let sharp = solidify_with(&mesh.csg, 0.2, 400_000, Finish::Sharp).unwrap().0;
        assert_castable(&sharp, what);
        let (m0, _, c0, _) = surface_error(&mesh.csg, &smooth);
        let (m1, _, c1, _) = surface_error(&mesh.csg, &sharp);
        println!(
            "{what}: vertices mean {m0:.5} → {m1:.5}, centroids mean {c0:.5} → {c1:.5} mm; volume {:.2} → {:.2} mm³",
            smooth.volume(),
            sharp.volume()
        );
        assert!(c1 <= c0 * 1.05 + 1e-6, "{what}: centroids {c1} vs {c0}");
        assert!((sharp.volume() / smooth.volume() - 1.0).abs() < 0.01, "{what}");
    }
}

/// The before/after figures and STLs (with `MAKING_DIR` set) for the docs: run in release with
/// `--ignored --nocapture`.
#[test]
#[ignore = "a report, not a check: run in release with --ignored --nocapture"]
fn sharp_report() {
    let dir = std::env::var("MAKING_DIR").ok();
    let (band, crease, _) = flat_band(8.5, 1.8, 4.0);
    let mut cases: Vec<(String, Csg, Option<Vec<Vec3>>)> = vec![("flatband".into(), band, Some(crease))];
    for (what, v) in report_pieces() {
        cases.push((what.into(), piece_mesh(&params(&v), Quality::Fine).csg, None));
    }
    for (what, csg, crease) in cases {
        for finish in [Finish::Smooth, Finish::Sharp] {
            let t = Instant::now();
            let s = solidify_with(&csg, 0.1, 150_000, finish).unwrap().0;
            let el = t.elapsed();
            let (_, _, cm, cx) = surface_error(&csg, &s);
            let ce = crease.as_ref().map(|c| crease_error(&s, c));
            println!(
                "{what:10} {finish:?}: step {:.3}, {} triangles, {el:?}, {:.2} mm³; centroids mean {cm:.4} max {cx:.4}; crease {ce:?}",
                s.step,
                s.triangles(),
                s.volume()
            );
            if let Some(d) = &dir {
                write_stl(&std::path::Path::new(d).join(format!("{what}-{finish:?}.stl").to_lowercase()), &s);
            }
        }
    }
}
