//! A band profile drawn in the drawing: its frame, its measures against analytic answers, the
//! refusals, the piece built from it (sheet, grams, checks, solid, DXF, proposals), and Hegel
//! properties over drawn polygons.

use cadcraft_doc::{EntityKind, Handle, LwPolyline};
use cadcraft_geom::{PI, PolyVertex, TAU, Vec2};
use hegel::TestCase;
use hegel::generators::{self as gs};
use serde_json::{Value, json};

use super::mesh::{Quality, piece_mesh};
use super::mesh_tests::check as check_mesh;
use super::piece_params::{PieceParams, Profile};
use super::piece_tests::{check, mm_drawing, piece, query, state};
use super::profile::{CustomProfile, profile_sdf};
use crate::{EngineError, Session};

/// A polyline of `(x, y, bulge)` vertices, added straight to the drawing.
fn lw(s: &mut Session, v: &[(f64, f64, f64)], closed: bool) -> String {
    let vertices = v.iter().map(|(x, y, b)| PolyVertex { bulge: *b, ..PolyVertex::new(Vec2::new(*x, *y)) }).collect();
    let kind = EntityKind::LwPolyline(LwPolyline { vertices, closed, const_width: 0.0, elevation: 0.0, plinegen: false });
    s.add_entity(kind).unwrap().hex()
}

fn rect(s: &mut Session, at: (f64, f64), w: f64, h: f64) -> String {
    let (x, y) = at;
    lw(s, &[(x, y, 0.0), (x + w, y, 0.0), (x + w, y + h, 0.0), (x, y + h, 0.0)], true)
}

/// A half-disc of radius `r` on its diameter, the round side up.
fn half_disc(s: &mut Session, at: (f64, f64), r: f64) -> String {
    let (x, y) = at;
    lw(s, &[(x - r, y, 0.0), (x + r, y, 1.0)], true)
}

fn params_of(p: &Value) -> PieceParams {
    PieceParams::parse("test", &p["params"]).unwrap()
}

fn grams(p: &Value) -> f64 {
    p["metal"]["grams"].as_f64().unwrap()
}

fn custom(curve: &str) -> Value {
    json!({ "curve": curve })
}

/// Pappus on the stored polygon itself: area × the path of its centroid.
fn pappus_grams(p: &PieceParams) -> f64 {
    let c = p.custom.as_ref().unwrap();
    TAU * (p.inner() / 2.0 + c.centroid()) * c.area() / 1000.0 * p.density
}

fn refused(s: &mut Session, p: Value, says: &str) {
    let before = state(s);
    let r = s.execute("piece", &p);
    match r {
        Err(EngineError::Internal(..)) => panic!("{p}: a panic was caught"),
        Err(e) => assert!(e.to_string().contains(says), "{p}: {e} (wanted `{says}`)"),
        Ok(v) => panic!("{p}: accepted: {v}"),
    }
    assert_eq!(state(s), before, "{p}: a refusal changes nothing");
}

#[test]
fn the_frame_is_the_box_finger_line_down_centred_across() {
    let mut s = mm_drawing();
    let h = rect(&mut s, (10.0, 20.0), 3.0, 1.8);
    let p = piece(&mut s, json!({"kind": "band", "profile": custom(&h), "size": 7}));
    let params = &p["params"];
    assert_eq!(params["profile"], "custom");
    assert!((params["width"].as_f64().unwrap() - 3.0).abs() < 1e-9 && (params["wall"].as_f64().unwrap() - 1.8).abs() < 1e-9, "{params}");
    assert_eq!(params["profileCurve"]["curve"], json!(h));
    let pts: Vec<(f64, f64)> =
        params["profileCurve"]["points"].as_array().unwrap().iter().map(|q| (q[0].as_f64().unwrap(), q[1].as_f64().unwrap())).collect();
    let (minx, maxx) = pts.iter().fold((f64::MAX, f64::MIN), |(a, b), q| (a.min(q.0), b.max(q.0)));
    let (miny, maxy) = pts.iter().fold((f64::MAX, f64::MIN), |(a, b), q| (a.min(q.1), b.max(q.1)));
    assert!((minx + 1.5).abs() < 1e-9 && (maxx - 1.5).abs() < 1e-9 && miny.abs() < 1e-9 && (maxy - 1.8).abs() < 1e-9, "{pts:?}");
    // A drawn rectangle is the flat band exactly.
    let mut t = mm_drawing();
    let flat = piece(&mut t, json!({"kind": "band", "width": 3, "wall": 1.8, "size": 7}));
    assert!((grams(&p) - grams(&flat)).abs() < 1e-9, "{} vs {}", grams(&p), grams(&flat));
    assert_eq!(p["size"], flat["size"]);
}

#[test]
fn a_profile_drawn_in_inches_becomes_millimetres() {
    let mut s = Session::new();
    let h = rect(&mut s, (0.0, 0.0), 0.1, 0.07);
    let p = piece(&mut s, json!({"kind": "band", "profile": custom(&h)}));
    assert!((p["params"]["width"].as_f64().unwrap() - 2.54).abs() < 1e-6, "{}", p["params"]);
    assert!((p["params"]["wall"].as_f64().unwrap() - 1.778).abs() < 1e-6, "{}", p["params"]);
}

#[test]
fn a_half_disc_weighs_what_pappus_says() {
    let r = 2.0;
    let mut s = mm_drawing();
    let h = half_disc(&mut s, (5.0, 5.0), r);
    let p = piece(&mut s, json!({"kind": "band", "profile": custom(&h), "metal": "platinum"}));
    let params = params_of(&p);
    let c = params.custom.as_ref().unwrap();
    let (area, centroid) = (PI * r * r / 2.0, 4.0 * r / (3.0 * PI));
    assert!((c.area() - area).abs() / area < 2e-4, "area {} vs {area}", c.area());
    assert!((c.centroid() - centroid).abs() < 2e-4, "centroid {} vs {centroid}", c.centroid());
    let exact = TAU * (params.inner() / 2.0 + centroid) * area / 1000.0 * params.density;
    let g = grams(&p);
    assert!((g - exact).abs() / exact < 2e-4, "grams {g} vs analytic {exact}");
    // And exactly the polygon's own Pappus.
    assert!((params.band_grams() - pappus_grams(&params)).abs() < 1e-9);
    assert!((params.width - 2.0 * r).abs() < 1e-6 && (params.wall - r).abs() < 1e-6);
}

#[test]
fn the_thinnest_wall_is_found_in_a_notch_and_at_a_knife_edge() {
    let mut s = mm_drawing();
    // A 4 × 2 bar with a V notch down to 1.2 mm in the middle of the top.
    let notch =
        lw(&mut s, &[(0.0, 0.0, 0.0), (4.0, 0.0, 0.0), (4.0, 2.0, 0.0), (2.5, 2.0, 0.0), (2.0, 1.2, 0.0), (1.5, 2.0, 0.0), (0.0, 2.0, 0.0)], true);
    let p = piece(&mut s, json!({"kind": "band", "profile": custom(&notch)}));
    let c = params_of(&p).custom.unwrap();
    let (thin, at) = c.thinnest();
    assert!((thin - 1.2).abs() < 1e-6 && at.abs() < 1e-6, "{thin} at {at}");
    let wall = check(&p, "wall");
    assert_eq!(wall["ok"], true, "{wall}");
    assert!(wall["message"].as_str().unwrap().contains("1.2"), "{wall}");
    // A knife-edge triangle 3 wide and 2 high: 0.4 mm in from an edge it is 0.53 mm thick.
    let knife = lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (1.5, 2.0, 0.0)], true);
    let p = piece(&mut s, json!({"profile": custom(&knife)}));
    let (thin, _) = params_of(&p).custom.unwrap().thinnest();
    assert!((thin - 2.0 * 0.4 / 1.5).abs() < 1e-6, "{thin}");
    assert_eq!(check(&p, "wall")["ok"], false);
}

#[test]
fn every_closed_curve_kind_is_a_profile() {
    let mut s = mm_drawing();
    let circle = super::tests::circle(&mut s, [3.0, 3.0], 1.0);
    let p = piece(&mut s, json!({"kind": "band", "profile": custom(&circle)}));
    let c = params_of(&p).custom.unwrap();
    assert!((c.area() - PI).abs() / PI < 1e-3 && (c.centroid() - 1.0).abs() < 1e-4, "{} {}", c.area(), c.centroid());
    let ellipse = s
        .add_entity(EntityKind::Ellipse(cadcraft_doc::Ellipse {
            center: cadcraft_geom::Vec3::new(0.0, 0.0, 0.0),
            major: cadcraft_geom::Vec3::new(2.0, 0.0, 0.0),
            ratio: 0.5,
            start: 0.0,
            end: TAU,
        }))
        .unwrap()
        .hex();
    let p = piece(&mut s, json!({"profile": custom(&ellipse)}));
    assert!(
        (p["params"]["width"].as_f64().unwrap() - 4.0).abs() < 1e-3 && (p["params"]["wall"].as_f64().unwrap() - 2.0).abs() < 1e-3,
        "{}",
        p["params"]
    );
    let spline = s.add_entity(EntityKind::Spline(cadcraft_geom::Spline::from_fit_points(&[
        Vec2::new(0.0, 0.0),
        Vec2::new(3.0, 0.0),
        Vec2::new(2.6, 1.6),
        Vec2::new(0.4, 1.6),
        Vec2::new(0.0, 0.0),
    ])));
    let spline = spline.unwrap().hex();
    let p = piece(&mut s, json!({"profile": custom(&spline)}));
    assert_eq!(p["params"]["profile"], "custom");
    let region = s.add_entity(EntityKind::Region(cadcraft_doc::Region::from_loop(vec![
        PolyVertex::new(Vec2::new(0.0, 0.0)),
        PolyVertex::new(Vec2::new(2.5, 0.0)),
        PolyVertex { bulge: 0.5, ..PolyVertex::new(Vec2::new(2.5, 1.5)) },
        PolyVertex::new(Vec2::new(0.0, 1.5)),
    ])));
    let region = region.unwrap().hex();
    let p = piece(&mut s, json!({"profile": custom(&region)}));
    assert_eq!(p["params"]["profile"], "custom");
}

#[test]
fn bad_curves_and_hostile_handles_are_refused_with_a_sentence() {
    let mut s = mm_drawing();
    piece(&mut s, json!({"kind": "band"}));
    let open = lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (3.0, 2.0, 0.0)], false);
    refused(&mut s, json!({"profile": custom(&open)}), "is open");
    let bowtie = lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 2.0, 0.0), (3.0, 0.0, 0.0), (0.0, 1.5, 0.0)], true);
    refused(&mut s, json!({"profile": custom(&bowtie)}), "crosses itself");
    let flat = lw(&mut s, &[(0.0, 0.0, 0.0), (1.5, 0.0, 0.0), (3.0, 0.0, 0.0)], true);
    refused(&mut s, json!({"profile": custom(&flat)}), "too small");
    let sliver = lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (3.0, 0.31, 0.0), (2.99, 0.01, 0.0), (0.0, 0.01, 0.0)], true);
    refused(&mut s, json!({"profile": custom(&sliver)}), "degenerate");
    let tiny = rect(&mut s, (0.0, 0.0), 0.2, 0.1);
    refused(&mut s, json!({"profile": custom(&tiny)}), "too small");
    let huge = rect(&mut s, (0.0, 0.0), 40.0, 5.0);
    refused(&mut s, json!({"profile": custom(&huge)}), "too large");
    // An arch: the middle stands off the finger.
    let arch = lw(
        &mut s,
        &[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.5, 0.0), (3.0, 1.5, 0.0), (3.0, 0.0, 0.0), (4.0, 0.0, 0.0), (4.0, 2.0, 0.0), (0.0, 2.0, 0.0)],
        true,
    );
    refused(&mut s, json!({"profile": custom(&arch)}), "off the finger");
    let line = s
        .add_entity(EntityKind::Line(cadcraft_doc::Line { a: cadcraft_geom::Vec3::new(0.0, 0.0, 0.0), b: cadcraft_geom::Vec3::new(3.0, 3.0, 0.0) }))
        .unwrap()
        .hex();
    refused(&mut s, json!({"profile": custom(&line)}), "is a line");
    for hostile in [json!("zz"), json!(""), json!(-1), json!(1e300), json!(true), json!([1]), json!("FFFFFFFFFFFFFFFFFFFF"), json!("DEADBEEF")] {
        refused(&mut s, json!({"profile": {"curve": hostile}}), "");
    }
    refused(&mut s, json!({"profile": {}}), "{curve: handle}");
    refused(&mut s, json!({"profile": "custom"}), "needs its curve");
    for bad in [json!({"points": [[0, 0], [1, "x"]]}), json!({"points": "no"}), json!({"points": [[0, 0], [1e308, 1e308], [0, 1]]}), json!(7)] {
        let r = s.execute("piece", &json!({"profile": "custom", "profileCurve": bad}));
        assert!(matches!(r, Err(ref e) if !matches!(e, EngineError::Internal(..))), "{bad}: {r:?}");
    }
}

#[test]
fn width_and_wall_come_from_the_curve_and_the_size_keeps_the_shape() {
    let mut s = mm_drawing();
    let h = half_disc(&mut s, (0.0, 0.0), 1.5);
    let first = piece(&mut s, json!({"kind": "band", "profile": custom(&h), "size": 6}));
    refused(&mut s, json!({"width": 5}), "comes from its curve");
    refused(&mut s, json!({"wall": 0.5}), "comes from its curve");
    // The same numbers are fine (a panel sends the whole piece back).
    piece(&mut s, json!({"width": first["params"]["width"], "wall": first["params"]["wall"]}));
    let bigger = piece(&mut s, json!({"size": 10}));
    assert_eq!(bigger["params"]["profileCurve"], first["params"]["profileCurve"]);
    assert!(bigger["size"]["diameter"].as_f64().unwrap() > first["size"]["diameter"].as_f64().unwrap());
    assert!(grams(&bigger) > grams(&first));
    // The curve erased: the piece keeps its stored profile and still rebuilds.
    s.doc_mut().unwrap().remove_entity(Handle::parse_hex(&h).unwrap());
    let again = piece(&mut s, json!({"size": 8}));
    assert_eq!(again["params"]["profileCurve"], first["params"]["profileCurve"]);
    refused(&mut s, json!({"profile": custom(&h)}), "keeps the one it stored");
    // Update from a moved copy: the frame makes it the same profile.
    let moved = half_disc(&mut s, (40.0, -12.0), 1.5);
    let updated = piece(&mut s, json!({"profile": custom(&moved)}));
    assert_eq!(updated["params"]["profileCurve"]["points"], first["params"]["profileCurve"]["points"]);
    assert_eq!(updated["params"]["profileCurve"]["curve"], json!(moved));
    assert_eq!(params_of(&updated).custom.unwrap().curve(), Some(moved.as_str()));
    // Back to a named profile.
    let dome = piece(&mut s, json!({"profile": "dome"}));
    assert_eq!(dome["params"]["profile"], "dome");
    assert!(dome["params"]["profileCurve"].is_null());
}

#[test]
fn the_sheet_draws_the_drawn_section() {
    let mut s = mm_drawing();
    let h = lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (3.0, 1.0, 0.6), (0.0, 1.0, 0.0)], true);
    let p = piece(&mut s, json!({"kind": "solitaire", "profile": custom(&h)}));
    let points = p["params"]["profileCurve"]["points"].as_array().unwrap().len();
    let d = s.doc().unwrap();
    let found = super::piece_tests::handles(&p).iter().filter_map(|h| d.entity(*h)).any(|e| match &e.kind {
        EntityKind::LwPolyline(pl) => pl.closed && pl.vertices.len() == points && e.common.layer == "Metal",
        _ => false,
    });
    assert!(found, "the section is the drawn profile");
    assert_eq!(check(&p, "stone-seat")["id"], "stone-seat");
    // A stone stands on the profile's top in the middle.
    let params = params_of(&p);
    assert!((params.crown() - (params.inner() / 2.0 + params.custom.as_ref().unwrap().top_at(0.0))).abs() < 1e-9);
}

#[test]
fn the_solid_is_watertight_and_weighs_the_sheet() {
    let mut s = mm_drawing();
    let shapes = [
        half_disc(&mut s, (0.0, 0.0), 1.6),
        lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (1.5, 2.0, 0.0)], true),
        lw(&mut s, &[(0.0, 0.0, 0.0), (4.0, 0.0, 0.0), (4.0, 2.0, 0.0), (2.5, 2.0, 0.0), (2.0, 1.2, 0.0), (1.5, 2.0, 0.0), (0.0, 2.0, 0.0)], true),
        lw(&mut s, &[(0.0, 0.3, -0.3), (3.0, 0.3, 0.0), (3.4, 1.4, 0.5), (0.2, 1.8, 0.0)], true),
    ];
    for h in shapes {
        for kind in ["band", "solitaire", "eternity"] {
            let p = piece(&mut s, json!({"kind": kind, "profile": custom(&h)}));
            let params = params_of(&p);
            for quality in [Quality::Draft, Quality::Fine] {
                let mesh = piece_mesh(&params, quality);
                check_mesh(&mesh, true, &format!("{h}/{kind}"));
                if kind == "band" {
                    let v = mesh.shells_volume();
                    let want = params.band_volume();
                    assert!((v - want).abs() / want < 4e-3, "{h}: mesh {v} vs Pappus {want}");
                }
            }
        }
    }
}

#[test]
fn a_custom_profile_survives_a_dxf_round_trip() {
    let mut s = mm_drawing();
    let h = lw(&mut s, &[(0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (3.0, 1.0, 0.6), (0.0, 1.0, 0.0)], true);
    let built = piece(&mut s, json!({"kind": "band", "profile": custom(&h), "size": 8}));
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let mut t = Session::new();
    t.open_drawing(cadcraft_io::read_dxf(dxf.as_bytes()).unwrap(), "reopened", None);
    let read = query(&mut t);
    for part in ["params", "size", "metal", "checks"] {
        assert_eq!(read[part], built[part], "{part}");
    }
    let rebuilt = piece(&mut t, json!({"size": 9}));
    assert_eq!(rebuilt["params"]["profileCurve"], built["params"]["profileCurve"]);
}

#[test]
fn proposing_a_profile_change_and_accepting_it_is_running_it() {
    let make = || {
        let mut s = mm_drawing();
        piece(&mut s, json!({"kind": "band", "size": 7}));
        let h = half_disc(&mut s, (0.0, 0.0), 1.4);
        (s, h)
    };
    let (mut a, h) = make();
    let (mut b, h2) = make();
    assert_eq!(h, h2);
    let step = json!({"command": "piece", "params": {"profile": custom(&h)}});
    let r = a.execute("propose", &json!({"steps": [step]})).unwrap();
    let card = &r["proposals"][0];
    assert!(card.to_string().contains("custom"), "{card}");
    a.execute("accept", &json!({"id": card["id"]})).unwrap();
    b.execute("piece", &json!({"profile": custom(&h)})).unwrap();
    let (qa, qb) = (query(&mut a), query(&mut b));
    for part in ["params", "metal", "checks"] {
        assert_eq!(qa[part], qb[part], "{part}");
    }
}

#[test]
fn the_sdf_is_signed_exact_and_one_lipschitz() {
    let pts = vec![Vec2::new(0.0, 0.0), Vec2::new(4.0, 0.0), Vec2::new(4.0, 2.0), Vec2::new(0.0, 2.0)];
    let c = CustomProfile::from_points("test", pts, None, "a rectangle").unwrap();
    assert!((c.sdf(Vec2::new(0.0, 1.0)) + 1.0).abs() < 1e-12);
    assert!((c.sdf(Vec2::new(0.0, 5.0)) - 3.0).abs() < 1e-12);
    assert!((c.sdf(Vec2::new(5.0, 3.0)) - 10f64.sqrt()).abs() < 1e-9);
    let mut seed = 7u64;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 11) as f64 / (1u64 << 53) as f64
    };
    for _ in 0..2000 {
        let p = Vec2::new(next() * 10.0 - 5.0, next() * 6.0 - 2.0);
        let q = Vec2::new(next() * 10.0 - 5.0, next() * 6.0 - 2.0);
        assert!((c.sdf(p) - c.sdf(q)).abs() <= p.dist(q) + 1e-9);
    }
    // The hand-off: a piece's profile_sdf, custom or named.
    let mut s = mm_drawing();
    let h = rect(&mut s, (0.0, 0.0), 4.0, 2.0);
    let p = params_of(&piece(&mut s, json!({"kind": "band", "profile": custom(&h)})));
    assert!((profile_sdf(&p, Vec2::new(0.0, 1.0)) + 1.0).abs() < 1e-9);
    let flat = PieceParams::parse("test", &json!({"kind": "band", "width": 4, "wall": 2})).unwrap();
    assert!((profile_sdf(&flat, Vec2::new(0.0, 1.0)) + 1.0).abs() < 1e-9);
    assert_eq!(flat.profile, Profile::Flat);
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

/// A star-shaped closed polygon (simple by construction): `n` corners at increasing angles
/// around a centre, each at its own radius.
fn star(tc: &TestCase) -> Vec<(f64, f64, f64)> {
    let n = tc.draw(gs::integers::<usize>().min_value(3).max_value(24));
    let rx = tc.draw(gs::floats::<f64>().min_value(0.4).max_value(6.0));
    let ry = tc.draw(gs::floats::<f64>().min_value(0.3).max_value(3.0));
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let jitter = tc.draw(gs::floats::<f64>().min_value(-0.4).max_value(0.4));
        let radius = tc.draw(gs::floats::<f64>().min_value(0.45).max_value(1.0));
        let a = TAU * (i as f64 + jitter) / n as f64;
        out.push((rx * radius * a.cos(), ry * radius * a.sin(), 0.0));
    }
    out
}

#[hegel::test(test_cases = 120)]
fn a_drawn_polygon_builds_a_closed_band_that_weighs_its_pappus(tc: TestCase) {
    let mut s = mm_drawing();
    let v = star(&tc);
    let h = lw(&mut s, &v, true);
    let before = state(&s);
    match s.execute("piece", &json!({"kind": "band", "profile": custom(&h)})) {
        Err(e @ EngineError::Internal(..)) => panic!("caught a panic: {e}"),
        Err(e) => {
            assert!(!e.to_string().is_empty());
            assert_eq!(state(&s), before);
        }
        Ok(r) => {
            let p = r["piece"].clone();
            let params = params_of(&p);
            let g = grams(&p);
            assert!(g > 0.0);
            assert!((params.band_grams() - pappus_grams(&params)).abs() <= 1e-9 * g.max(1.0));
            let mesh = piece_mesh(&params, Quality::Draft);
            check_mesh(&mesh, true, "star");
            let size = tc.draw(gs::floats::<f64>().min_value(3.0).max_value(13.0));
            let again = piece(&mut s, json!({"size": size}));
            assert_eq!(again["params"]["profileCurve"], p["params"]["profileCurve"], "a size change keeps the profile");
        }
    }
}

#[hegel::test(test_cases = 200)]
fn hostile_point_lists_never_panic(tc: TestCase) {
    let n = tc.draw(gs::integers::<usize>().min_value(0).max_value(40));
    let mut v = Vec::with_capacity(n);
    for _ in 0..n {
        let x = tc.draw(gs::floats::<f64>().min_value(-1e7).max_value(1e7));
        let y = tc.draw(gs::floats::<f64>().min_value(-1e7).max_value(1e7));
        let b = tc.draw(gs::floats::<f64>().min_value(-50.0).max_value(50.0));
        v.push((x, y, b));
    }
    let closed = tc.draw(gs::booleans());
    let mut s = mm_drawing();
    let h = lw(&mut s, &v, closed);
    let r = s.execute("piece", &json!({"kind": "band", "profile": custom(&h)}));
    assert!(!matches!(r, Err(EngineError::Internal(..))), "{r:?}");
    let pts: Vec<Value> = v.iter().map(|(x, y, _)| json!([x, y])).collect();
    let r = s.execute("piece", &json!({"kind": "band", "profile": "custom", "profileCurve": {"points": pts}}));
    assert!(!matches!(r, Err(EngineError::Internal(..))), "{r:?}");
}
