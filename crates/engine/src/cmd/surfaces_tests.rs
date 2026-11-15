//! Free-form objects: construction, measuring, transforms, trims, undo, files and hostile input.

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::surface_trim::{mesh_param_area, tessellate_trimmed};
use cadcraft_geom::{NurbsSurface, PI, TAU, TessOptions, Vec2, Vec3};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use crate::Session;

fn h(v: &Value) -> String {
    v["handle"].as_str().unwrap().to_string()
}

fn add(s: &mut Session, kind: EntityKind) -> String {
    s.add_entity(kind).unwrap().hex()
}

fn circle(s: &mut Session, x: f64, y: f64, r: f64) -> String {
    add(s, EntityKind::Circle(cadcraft_doc::Circle { center: Vec3::new(x, y, 0.0), radius: r }))
}

fn line(s: &mut Session, a: (f64, f64), b: (f64, f64)) -> String {
    add(s, EntityKind::Line(cadcraft_doc::Line { a: Vec3::new(a.0, a.1, 0.0), b: Vec3::new(b.0, b.1, 0.0) }))
}

fn rect(s: &mut Session, w: f64, hgt: f64) -> String {
    let v = [(0.0, 0.0), (w, 0.0), (w, hgt), (0.0, hgt)].iter().map(|&(x, y)| cadcraft_geom::PolyVertex::new(Vec2::new(x, y))).collect();
    add(s, super::helpers::lwpoly(v, true))
}

fn props(s: &mut Session, handle: &str) -> Value {
    let r = s.execute("massprop", &json!({"handles": [handle]})).unwrap();
    r["objects"][0].clone()
}

fn surface(s: &Session, handle: &str) -> cadcraft_doc::Surface {
    match &s.doc().unwrap().entity(Handle::parse_hex(handle).unwrap()).unwrap().kind {
        EntityKind::Surface(f) => f.clone(),
        k => panic!("not a surface: {}", k.type_name()),
    }
}

fn rel(a: f64, b: f64) -> f64 {
    (a - b).abs() / b.abs().max(1e-300)
}

#[test]
fn loft_of_two_circles_is_a_cylinder() {
    let mut s = Session::new();
    let a = circle(&mut s, 0.0, 0.0, 5.0);
    let b = circle(&mut s, 0.0, 0.0, 5.0);
    let r = s.execute("loft", &json!({"handles": [a, b], "heights": [0, 10]})).unwrap();
    let p = props(&mut s, &h(&r));
    assert!(rel(p["area"].as_f64().unwrap(), TAU * 5.0 * 10.0) < 1e-6, "{p}");
    assert_eq!(p["closed"], json!(false));
    assert!(p.get("volume").is_none());
}

#[test]
fn revolved_semicircle_is_a_closed_sphere_with_weights() {
    let mut s = Session::new();
    // A half circle right of the Y axis, revolved about it.
    let arc = add(&mut s, EntityKind::Arc(cadcraft_doc::Arc { center: Vec3::ZERO, radius: 4.0, start: -PI / 2.0, end: PI / 2.0 }));
    let r = s.execute("revolve", &json!({"handles": [arc]})).unwrap();
    let p = props(&mut s, &h(&r));
    assert!(rel(p["area"].as_f64().unwrap(), 4.0 * PI * 16.0) < 1e-6, "{p}");
    let v = p["volume"].as_f64().unwrap();
    assert!(rel(v, 4.0 / 3.0 * PI * 64.0) < 1e-6, "{p}");
    let g = p["grams"]["gold18"].as_f64().unwrap();
    assert!(rel(g, v / 1000.0 * 15.5) < 1e-3, "{p}");
}

#[test]
fn extrude_sweep_and_planar_surface_measure_right() {
    let mut s = Session::new();
    let sq = rect(&mut s, 4.0, 3.0);
    let r = s.execute("extrude", &json!({"handles": [sq], "height": 2})).unwrap();
    assert!(rel(props(&mut s, &h(&r))["area"].as_f64().unwrap(), 14.0 * 2.0) < 1e-9);

    // A sweep of a small circle (drawn in plan) round a big one: a torus.
    let rail = circle(&mut s, 0.0, 0.0, 10.0);
    let prof = circle(&mut s, 30.0, 0.0, 1.0);
    let r = s.execute("sweep", &json!({"rail": rail, "profile": prof, "stations": 129})).unwrap();
    let a = props(&mut s, &h(&r))["area"].as_f64().unwrap();
    assert!(rel(a, 4.0 * PI * PI * 10.0) < 1e-3, "{a}");

    // A planar disc with a hole.
    let outer = circle(&mut s, 50.0, 0.0, 5.0);
    let hole = circle(&mut s, 50.0, 0.0, 2.0);
    let r = s.execute("planesrf", &json!({"handles": [outer, hole]})).unwrap();
    let a = props(&mut s, &h(&r))["area"].as_f64().unwrap();
    assert!(rel(a, PI * (25.0 - 4.0)) < 2e-3, "{a}");
    // An open curve is refused.
    let l = line(&mut s, (0.0, 0.0), (1.0, 1.0));
    assert!(s.execute("planesrf", &json!({"handles": [l]})).is_err());
}

#[test]
fn subd_primitives_crease_and_measure() {
    let mut s = Session::new();
    let r = s.execute("subdbox", &json!({"width": 10, "depth": 10, "height": 10, "creased": true})).unwrap();
    let p = props(&mut s, &h(&r));
    assert!(rel(p["volume"].as_f64().unwrap(), 1000.0) < 1e-6, "{p}");
    let r = s.execute("subdbox", &json!({"center": [30, 0, 0]})).unwrap();
    let smooth = props(&mut s, &h(&r))["volume"].as_f64().unwrap();
    assert!(smooth < 1000.0 && smooth > 300.0, "{smooth}");
    s.execute("subdcrease", &json!({"handles": [h(&r)]})).unwrap();
    let creased = props(&mut s, &h(&r))["volume"].as_f64().unwrap();
    assert!(rel(creased, 1000.0) < 1e-6, "{creased}");
    let c = s.execute("subdcylinder", &json!({"radius": 3, "height": 6, "segments": 12})).unwrap();
    assert_eq!(props(&mut s, &h(&c))["closed"], json!(true));
    let cage =
        s.execute("subdfromcage", &json!({"positions": [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], "faces": [[0,1,2,3]], "corners": [0,1,2,3]})).unwrap();
    assert_eq!(props(&mut s, &h(&cage))["closed"], json!(false));
}

#[test]
fn conversions_between_nurbs_and_subd() {
    let mut s = Session::new();
    let r = s.execute("subdbox", &json!({})).unwrap();
    let n = s.execute("tonurbs", &json!({"handles": [h(&r)], "levels": 2})).unwrap();
    let count = n["handles"].as_array().unwrap().len();
    // 96 quads after two levels; the 8 corners (valence 3) leave 24 faces next to them.
    assert!(count > 0 && n["gaps"].as_u64().unwrap() > 0, "{n}");
    let first = n["handles"][0].as_str().unwrap().to_string();
    assert!(surface(&s, &first).nurbs().is_ok());
    // A loft back to SubD.
    let a = circle(&mut s, 0.0, 0.0, 5.0);
    let b = circle(&mut s, 0.0, 0.0, 3.0);
    let l = s.execute("loft", &json!({"handles": [a, b], "heights": [0, 5]})).unwrap();
    let d = s.execute("tosubd", &json!({"handles": [h(&l)]})).unwrap();
    assert!(d["handle"].is_string(), "{d}");
}

#[test]
fn a_torus_subd_converts_to_exact_patches_without_gaps() {
    let mut s = Session::new();
    let cage = cadcraft_geom::subd_edit::torus_cage(10.0, 3.0, 12, 8).unwrap();
    let hd = s.add_entity(EntityKind::SubD(cadcraft_doc::SubD::from_cage(&cage, 2))).unwrap();
    let n = s.execute("tonurbs", &json!({"handles": [hd.hex()], "levels": 0})).unwrap();
    assert_eq!(n["gaps"], json!(0));
    assert_eq!(n["handles"].as_array().unwrap().len(), 96);
    // Each patch matches the limit surface at its corners.
    let lim = cadcraft_geom::limit_positions(&cage).unwrap();
    let f0 = surface(&s, n["handles"][0].as_str().unwrap()).nurbs().unwrap();
    let corner = f0.point(0.0, 0.0);
    assert!(lim.iter().any(|q| (*q - corner).len() < 1e-9), "{corner:?}");
}

#[test]
fn trim_and_split_by_a_projected_circle() {
    let mut s = Session::new();
    let sq = rect(&mut s, 10.0, 10.0);
    let p = s.execute("planesrf", &json!({"handles": [sq]})).unwrap();
    let full = props(&mut s, &h(&p))["area"].as_f64().unwrap();
    assert!(rel(full, 100.0) < 1e-9);
    let c = circle(&mut s, 5.0, 5.0, 2.0);
    let t = s.execute("surftrim", &json!({"surface": h(&p), "curve": c})).unwrap();
    let a = props(&mut s, &h(&p))["area"].as_f64().unwrap();
    assert!(rel(a, 100.0 - PI * 4.0) < 2e-3, "{a} {t}");
    // A lofted (curved) surface split by a circle seen from above: the two parts add up.
    let a1 = line(&mut s, (0.0, 20.0), (10.0, 20.0));
    let a2 = line(&mut s, (0.0, 30.0), (10.0, 30.0));
    let l = s.execute("loft", &json!({"handles": [a1, a2], "heights": [0, 4]})).unwrap();
    let whole = props(&mut s, &h(&l))["area"].as_f64().unwrap();
    let c = circle(&mut s, 5.0, 25.0, 3.0);
    let r = s.execute("split", &json!({"handles": [h(&l), c]})).unwrap();
    let parts: f64 = r["handles"].as_array().unwrap().iter().map(|x| props(&mut s, x.as_str().unwrap())["area"].as_f64().unwrap()).sum();
    assert!(rel(parts, whole) < 2e-3, "{parts} vs {whole}");
    // The inside part is the disc seen from above, on a slope of 4 in 10.
    let inside = props(&mut s, r["handles"][0].as_str().unwrap())["area"].as_f64().unwrap();
    let want = PI * 9.0 * (1.0f64 + 0.16).sqrt();
    assert!(rel(inside, want) < 3e-3, "{inside} vs {want}");
}

#[test]
fn transforms_move_rotate_and_scale_free_form_objects() {
    let mut s = Session::new();
    let r = s.execute("subdbox", &json!({"creased": true})).unwrap();
    let hd = h(&r);
    s.execute("move", &json!({"handles": [hd], "delta": [5, 0]})).unwrap();
    s.execute("rotate", &json!({"handles": [hd], "base": [0, 0], "angle": 90})).unwrap();
    s.execute("scale", &json!({"handles": [hd], "base": [0, 0], "factor": 2})).unwrap();
    let p = props(&mut s, &hd);
    assert!(rel(p["volume"].as_f64().unwrap(), 8000.0) < 1e-6, "{p}");
    let e = s.doc().unwrap().entity(Handle::parse_hex(&hd).unwrap()).unwrap().clone();
    let EntityKind::SubD(d) = &e.kind else { panic!() };
    let (lo, hi) = d.bounds3().unwrap();
    // Moved to x = 5, turned to y = 5, doubled: centre (0, 10).
    assert!(((lo + hi) * 0.5 - Vec3::new(0.0, 10.0, 0.0)).len() < 1e-9, "{lo:?} {hi:?}");
    // Mirror keeps the cage outward-facing (positive volume).
    s.execute("mirror", &json!({"handles": [hd], "p1": [0, 0], "p2": [0, 1], "erase": true})).unwrap();
    let p = props(&mut s, &hd);
    assert!(p["volume"].as_f64().unwrap() > 0.0);
}

#[test]
fn undo_and_redo_free_form_objects() {
    let mut s = Session::new();
    let a = circle(&mut s, 0.0, 0.0, 5.0);
    let b = circle(&mut s, 0.0, 0.0, 2.0);
    let r = s.execute("loft", &json!({"handles": [a, b], "heights": [0, 3]})).unwrap();
    let hd = Handle::parse_hex(&h(&r)).unwrap();
    assert!(s.doc().unwrap().entity(hd).is_some());
    s.undo().unwrap();
    assert!(s.doc().unwrap().entity(hd).is_none());
    s.redo().unwrap();
    assert!(s.doc().unwrap().entity(hd).is_some());
}

#[test]
fn dxf_keeps_free_form_objects_in_cadcrafts_record_and_reports_them() {
    let mut s = Session::new();
    s.execute("subdbox", &json!({"creased": true})).unwrap();
    let a = circle(&mut s, 0.0, 0.0, 5.0);
    let b = circle(&mut s, 0.0, 0.0, 2.0);
    s.execute("loft", &json!({"handles": [a, b], "heights": [0, 3]})).unwrap();
    let d = s.doc().unwrap().clone();
    let bytes = cadcraft_io::write(&d, "x.dxf").unwrap();
    let text = String::from_utf8_lossy(&bytes);
    assert!(!text.contains("\nSURFACE\n") && text.contains("CADCRAFT_FREEFORM"));
    let back = cadcraft_io::read(&bytes, "x.dxf").unwrap();
    let n = back.model.iter().filter(|e| matches!(e.kind, EntityKind::Surface(_) | EntityKind::SubD(_))).count();
    assert_eq!(n, 2);
    // Saving says they are not exported as DXF objects.
    let counts = super::file::freeform_counts(s.doc().unwrap());
    let mut r = json!({"path": "x.dxf"});
    super::file::report_not_exported(&mut s, &mut r, &counts, true);
    assert_eq!(r["notExported"]["SubD"], json!(1), "{r}");
    assert_eq!(r["notExported"]["Surface"], json!(1), "{r}");
}

#[test]
fn snapping_finds_corners_and_midpoints() {
    let mut s = Session::new();
    let sq = rect(&mut s, 10.0, 10.0);
    let a = s.execute("extrude", &json!({"handles": [sq], "height": 5})).unwrap();
    let f = surface(&s, &h(&a));
    let pts = f.snap_points();
    assert!(pts.iter().any(|q| (*q - Vec3::new(0.0, 0.0, 5.0)).len() < 1e-9));
    assert_eq!(f.wires().len(), 4 + 2 * cadcraft_doc::SURFACE_ISOCURVES);
}

#[test]
fn mesh_and_surfmesh_hand_back_triangles() {
    let mut s = Session::new();
    let r = s.execute("subdbox", &json!({})).unwrap();
    let m = s.execute("mesh", &json!({"handles": [h(&r)]})).unwrap();
    assert!(m["triangles"].as_u64().unwrap() > 100);
    assert_eq!(m["meshes"][0]["closed"], json!(true));
    let v = s.execute("surfmesh", &json!({"quality": "fine"})).unwrap();
    assert_eq!(v["meshes"][0]["part"], json!("metal"));
    assert!(v["bounds"]["min"][0].as_f64().unwrap() < -4.0);
    assert!(s.execute("surfmesh", &json!({"metal": "unobtainium"})).is_err());
    let mut empty = Session::new();
    assert!(empty.execute("surfmesh", &json!({})).is_err());
}

#[test]
fn hostile_params_are_refused() {
    let mut s = Session::new();
    let c = circle(&mut s, 0.0, 0.0, 5.0);
    let deep = (0..200).fold(json!(1), |v, _| json!([v]));
    let ids = [
        "loft",
        "revolve",
        "extrude",
        "sweep",
        "planesrf",
        "subdbox",
        "subdcylinder",
        "subdfromcage",
        "subdcrease",
        "tosubd",
        "tonurbs",
        "mesh",
        "surfmesh",
        "surftrim",
        "split",
    ];
    let bad = [
        json!(null),
        json!({"handles": [c, c], "heights": [1e308, f64::MAX]}),
        json!({"handles": [c], "height": 1e300, "direction": ["x"]}),
        json!({"handles": [c], "angle": 1e9, "axisStart": [0, 0], "axisEnd": [0, 0]}),
        json!({"rail": c, "profile": c, "stations": 1_000_000_000u64}),
        json!({"width": -1, "height": 1e300, "level": 99, "segments": 1_000_000}),
        json!({"positions": [[0, 0, 0]], "faces": [[0, 0, 0, 99999999]]}),
        json!({"positions": [[1e308, 0, 0], [0, 1, 0], [1, 1, 0]], "faces": [[0, 1, 2]], "creases": [[0, 1, -5]]}),
        json!({"positions": deep, "faces": "x"}),
        json!({"handles": [c], "tolerance": 0, "angle": -1, "quality": "ultra", "keep": "both", "direction": "sideways"}),
        json!({"handles": ["zz", 99999], "edges": [[1e20, -1]], "sharpness": f64::NAN}),
    ];
    for id in ids {
        for p in &bad {
            let _ = s.execute(id, p);
        }
    }
    // Still a working drawing.
    assert!(s.execute("subdbox", &json!({})).is_ok());
}

// ---------------- properties (Hegel) ----------------

/// A random curved surface: a bicubic Bézier patch over the unit square with random heights.
fn random_patch(tc: &TestCase) -> NurbsSurface {
    let mut pts = Vec::with_capacity(16);
    for i in 0..4 {
        for j in 0..4 {
            let z = tc.draw(gs::floats::<f64>().min_value(-3.0).max_value(3.0));
            pts.push(Vec3::new(i as f64 * 10.0 / 3.0, j as f64 * 10.0 / 3.0, z));
        }
    }
    let k = vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
    NurbsSurface::new(3, 3, k.clone(), k, 4, 4, pts, Vec::new()).unwrap()
}

fn random_hole(tc: &TestCase) -> Vec<Vec2> {
    let cx = tc.draw(gs::floats::<f64>().min_value(0.3).max_value(0.7));
    let cy = tc.draw(gs::floats::<f64>().min_value(0.3).max_value(0.7));
    let r = tc.draw(gs::floats::<f64>().min_value(0.02).max_value(0.25));
    let n = tc.draw(gs::integers::<usize>().min_value(3).max_value(200));
    let wobble = tc.draw(gs::floats::<f64>().min_value(0.0).max_value(0.3));
    (0..n)
        .map(|k| {
            let a = TAU * k as f64 / n as f64;
            let rr = r * (1.0 + wobble * (3.0 * a).sin());
            Vec2::new(cx + rr * a.cos(), cy + rr * a.sin())
        })
        .collect()
}

/// Rule: a trimmed mesh has no cracks — every edge is used by one or two triangles, and an edge
/// used once (an open edge) lies on the domain's boundary or on the trim loop.
#[hegel::test(test_cases = 60)]
fn trimmed_tessellation_is_crack_free_and_its_open_edges_lie_on_the_trims(tc: TestCase) {
    let s = random_patch(&tc);
    let hole = random_hole(&tc);
    let outer = vec![Vec2::new(0.0, 0.0), Vec2::new(1.0, 0.0), Vec2::new(1.0, 1.0), Vec2::new(0.0, 1.0)];
    let loops = vec![outer, hole.clone()];
    let m = tessellate_trimmed(&s, &loops, &TessOptions { chord_tol: 0.02, ..TessOptions::default() }).unwrap();
    let mut edges: std::collections::HashMap<(u32, u32), (usize, i32)> = std::collections::HashMap::new();
    for t in m.indices.chunks_exact(3) {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let e = edges.entry((a.min(b), a.max(b))).or_insert((0, 0));
            e.0 += 1;
            e.1 += if a < b { 1 } else { -1 };
        }
    }
    let on_loop = |p: Vec2| {
        let n = hole.len();
        (0..n).any(|i| {
            let (a, b) = (hole[i], hole[(i + 1) % n]);
            let ab = b - a;
            let t = ((p - a).dot(ab) / ab.len2()).clamp(0.0, 1.0);
            (a + ab * t).dist(p) < 1e-9
        })
    };
    let on_border = |p: Vec2| p.x.abs() < 1e-12 || p.y.abs() < 1e-12 || (p.x - 1.0).abs() < 1e-12 || (p.y - 1.0).abs() < 1e-12;
    let uv = |i: u32| Vec2::new(m.uvs[i as usize][0], m.uvs[i as usize][1]);
    for ((a, b), (count, dir)) in &edges {
        assert!(*count <= 2, "an edge used {count} times");
        if *count == 2 {
            assert_eq!(*dir, 0, "neighbours disagree on an edge's direction");
        } else {
            let (pa, pb) = (uv(*a), uv(*b));
            let ok = (on_loop(pa) && on_loop(pb)) || (on_border(pa) && on_border(pb));
            assert!(ok, "open edge {pa:?}–{pb:?} is on neither the trim nor the border");
        }
    }
    // Every kept triangle's centre is kept by the trim.
    for t in m.indices.chunks_exact(3) {
        let c = (uv(t[0]) + uv(t[1]) + uv(t[2])) * (1.0 / 3.0);
        let near_trim = hole.iter().any(|q| q.dist(c) < 0.05);
        assert!(near_trim || cadcraft_geom::point_in_trims(&loops, c));
    }
}

/// Rule: the trimmed area converges — a planar square with a circular hole tends to its exact
/// area as the tolerance falls, and the error shrinks.
#[hegel::test(test_cases = 40)]
fn trimmed_area_converges_to_the_exact_area(tc: TestCase) {
    let w = tc.draw(gs::floats::<f64>().min_value(1.0).max_value(100.0));
    let s = NurbsSurface::bilinear(Vec3::ZERO, Vec3::new(w, 0.0, 0.0), Vec3::new(0.0, w, 0.0), Vec3::new(w, w, 0.0)).unwrap();
    let r = tc.draw(gs::floats::<f64>().min_value(0.05).max_value(0.4));
    let n = 2048;
    let hole: Vec<Vec2> =
        (0..n).map(|k| Vec2::new(0.5 + r * (TAU * k as f64 / n as f64).cos(), 0.5 + r * (TAU * k as f64 / n as f64).sin())).collect();
    let loops = vec![vec![Vec2::new(0.0, 0.0), Vec2::new(1.0, 0.0), Vec2::new(1.0, 1.0), Vec2::new(0.0, 1.0)], hole];
    let exact = w * w * (1.0 - PI * r * r);
    let err = |tol: f64| {
        let m = tessellate_trimmed(&s, &loops, &TessOptions { chord_tol: tol, ..TessOptions::default() }).unwrap();
        (mesh_param_area(&s, &m) - exact).abs() / exact
    };
    let coarse = err(w * 0.05);
    let fine = err(w * 0.0005);
    assert!(coarse < 1e-2, "coarse error {coarse}");
    assert!(fine < coarse || fine < 1e-6, "fine {fine} vs coarse {coarse}");
}
