//! Hoop earrings (`PIECE {kind: hoop}`): the hoop's weight against its formula and against the
//! cast solid, every section and both closures building a closed solid, pavé and a channel along
//! the front staying clear of the closure, the checks passing and failing, a pair counting two
//! of everything, the JSON round trip, the bench sheet, and hostile parameters never panicking.

use cadcraft_geom::PI;
use hegel::TestCase;
use hegel::generators::{self as gs};
use serde_json::{Value, json};

use super::hoop::{self, Hoop};
use super::mesh::{Quality, piece_mesh, solid_stl};
use super::piece_params::PieceParams;
use super::piece_tests::{check, mm_drawing, piece, query, stone_inserts};
use super::solid::{solidify, verify};
use crate::{EngineError, Session};

fn params(v: &Value) -> PieceParams {
    PieceParams::parse("test", v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn grams(p: &Value) -> f64 {
    p["metal"]["grams"].as_f64().unwrap()
}

#[test]
fn a_plain_round_hoop_weighs_its_torus_less_the_gap_and_the_hole_plus_the_post() {
    let p = params(&json!({"kind": "hoop", "hoopDiameter": 20, "hoopThickness": 2, "hoopGap": 1.2, "postDiameter": 0.8, "metal": "silver"}));
    let h = Hoop::of(&p);
    assert!((h.ri - 8.0).abs() < 1e-12 && (h.rc - 9.0).abs() < 1e-12);
    let alpha = (1.2f64 / 18.0).asin();
    let torus = PI * 1.0 * 9.0 * (2.0 * PI - 2.0 * alpha);
    let rh = (0.8 + hoop::HOLE_CLEARANCE) / 2.0;
    let hole = PI * rh * rh * (hoop::INTO + hoop::HOLE_DEEPER);
    let post = PI * 0.16 * 1.2;
    let one = hoop::volume(&p);
    assert!((one - (torus - hole + post)).abs() < 1e-6, "{one} against {}", torus - hole + post);
    // A pair: twice one.
    assert!((p.band_volume() - 2.0 * one).abs() < 1e-9);
}

#[test]
fn hoop_earrings_draw_as_a_pair_with_their_checks() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "hoop"}));
    assert_eq!(p["params"]["kind"], "hoop");
    assert_eq!(p["params"]["hoopSection"], "round");
    assert_eq!(p["params"]["closure"], "post");
    assert_eq!(p["pieces"], json!(2));
    assert_eq!(p["size"], Value::Null);
    assert_eq!(check(&p, "hoop-wall")["ok"], json!(true));
    assert_eq!(check(&p, "post")["ok"], json!(true));
    let g = grams(&p);
    assert!(g > 2.0 && g < 8.0, "{g}");
    // A thin wire fails its wall; a fat post fails its own; a tube's thin wall fails.
    let p = piece(&mut s, json!({"hoopThickness": 0.6, "postDiameter": 1.4}));
    assert_eq!(check(&p, "hoop-wall")["ok"], json!(false));
    assert_eq!(check(&p, "post")["ok"], json!(false));
    let p = piece(&mut s, json!({"hoopThickness": 2.4, "hoopSection": "tube", "hoopWall": 0.2, "postDiameter": 0.8}));
    assert_eq!(check(&p, "hoop-wall")["ok"], json!(false));
    assert!(check(&p, "hoop-wall")["message"].as_str().unwrap().contains("tube"));
    let back = query(&mut s);
    assert_eq!(back["params"], p["params"]);
}

#[test]
fn every_section_and_closure_builds_a_closed_solid_within_ten_percent_of_its_weight() {
    for v in [
        json!({"kind": "hoop"}),
        json!({"kind": "hoop", "hoopSection": "square", "hoopThickness": 1.6, "hoopWidth": 2.2}),
        json!({"kind": "hoop", "hoopSection": "knife", "hoopThickness": 2.4, "hoopWidth": 1.4}),
        json!({"kind": "hoop", "hoopSection": "tube", "hoopThickness": 3, "hoopWall": 0.4}),
        json!({"kind": "hoop", "closure": "click", "hoopDiameter": 14}),
    ] {
        let p = params(&v);
        let mesh = piece_mesh(&p, Quality::Draft);
        let (tris, solid, _) = solid_stl(&mesh, Quality::Draft, 900_000).unwrap_or_else(|e| panic!("{v}: {e}"));
        assert!(!tris.is_empty());
        verify(&solid.positions, &solid.indices).unwrap_or_else(|e| panic!("{v}: {e}"));
        assert_eq!(solid.bodies, 2, "{v}: two hoops, each one body");
        let ratio = solid.volume() / p.band_volume();
        assert!((0.9..=1.1).contains(&ratio), "{v}: solid {} mm³ against {} mm³ ({ratio:.3})", solid.volume(), p.band_volume());
    }
}

#[test]
fn pave_along_the_front_keeps_clear_of_the_closure_and_counts_both_hoops() {
    let mut s = mm_drawing();
    let v = json!({"kind": "hoop", "hoopDiameter": 22, "hoopThickness": 2.2, "pave": {"melee": 1.3, "from": 0, "to": 180, "symmetric": false}});
    let p = piece(&mut s, v.clone());
    assert_eq!(check(&p, "pave")["ok"], json!(true), "{}", check(&p, "pave"));
    let n = p["stones"]["pave"]["count"].as_u64().unwrap();
    assert!(n > 10, "{n}");
    // Both hoops' stones are inserts the bench counts.
    assert_eq!(p["stones"]["count"].as_u64().unwrap(), 2 * n);
    assert_eq!(stone_inserts(&s, &p).len() as u64, 2 * n);
    // Every stone on the front (+X), clear of the post's hole at the top.
    let pp = params(&v);
    let edge = hoop::closure_edge(&pp, &super::pave_band::Surface::of(&pp).unwrap(), 0.2);
    let fit = super::pave_band::fit(&pp).unwrap();
    for st in &fit.stones {
        assert!(st.girdle.x > 0.0, "{st:?}");
        assert!(st.angle > edge, "{} inside the closure's {edge}", st.angle);
    }
    // The mesh holds the same stones, the solid cuts a seat for each.
    let mesh = piece_mesh(&pp, Quality::Draft);
    assert_eq!(u64::from(mesh.stones), 2 * n);
    assert_eq!(u64::from(mesh.seats), 2 * n);
    // A channel along the front too.
    let p = piece(&mut s, json!({"pave": {"layout": "channel"}}));
    assert!(p["stones"]["pave"]["count"].as_u64().unwrap() > 5);
    assert!(p["metal"]["channelGrams"].as_f64().unwrap() > 0.0);
    let mesh = piece_mesh(&params(&p["params"]), Quality::Draft);
    let (solid, _) = solidify(&mesh.csg, 0.15, 2_000_000).unwrap();
    verify(&solid.positions, &solid.indices).unwrap();
}

#[test]
fn a_click_top_has_a_knuckle_and_keeps_pave_off_its_seam() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "hoop", "closure": "click", "pave": {"span": "full"}}));
    assert_eq!(check(&p, "post")["ok"], json!(true));
    assert_eq!(check(&p, "click-seam")["ok"], json!(false), "stones all round cross the seam");
    let r = s.execute("piece", &json!({"pave": {"from": 0, "to": 180, "symmetric": false}})).unwrap();
    assert_eq!(check(&r["piece"], "click-seam")["ok"], json!(true));
    assert!(r["message"].as_str().unwrap().contains("click-top"), "{}", r["message"]);
}

#[test]
fn the_bench_sheet_reads_a_pair_of_hoops() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "hoop", "pave": {"from": 0, "to": 180, "symmetric": false}}));
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"], p["stones"]["count"]);
    let text = sheet.to_string();
    assert!(text.contains("hoop"), "{text}");
    // And a DXF round trip keeps the piece.
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let back = query(&mut t);
    for key in ["params", "metal", "stones", "checks", "pieces"] {
        assert_eq!(back[key], p[key], "{key}");
    }
}

#[test]
fn impossible_hoops_are_refused_and_ring_keys_are_kept() {
    let mut s = mm_drawing();
    for (v, says) in [
        (json!({"kind": "hoop", "hoopDiameter": 8, "hoopThickness": 3}), "hoopThickness"),
        (json!({"kind": "hoop", "hoopSection": "tube", "hoopThickness": 2, "hoopWall": 0.98}), "hoopWall"),
        (json!({"kind": "hoop", "hoopSection": "oval"}), "hoopSection"),
        (json!({"kind": "hoop", "closure": "magnet"}), "closure"),
        (json!({"kind": "hoop", "hoopGap": 50}), "hoopGap"),
    ] {
        match s.execute("piece", &v) {
            Err(EngineError::Internal(..)) => panic!("{v}: a panic was caught"),
            Err(e) => assert!(e.to_string().contains(says), "{v}: {e}"),
            Ok(r) => panic!("{v}: accepted {r}"),
        }
    }
    // A ring's own keys are kept off the finger and come back with the ring.
    let r = s.execute("piece", &json!({"kind": "hoop", "size": 7, "width": 3})).unwrap();
    assert!(r["message"].as_str().unwrap().contains("not used"), "{}", r["message"]);
    let p = piece(&mut s, json!({"kind": "band"}));
    assert_eq!(p["params"]["width"], json!(3.0));
}

/// Rule: a hoop's JSON reads back to the same hoop, and a pair weighs exactly twice one.
#[hegel::test(test_cases = 60)]
fn a_hoop_round_trips_and_a_pair_is_twice_one(tc: TestCase) {
    let section = ["round", "square", "knife", "tube"][tc.draw(gs::integers::<usize>().min_value(0).max_value(3))];
    let closure = ["post", "click"][tc.draw(gs::integers::<usize>().min_value(0).max_value(1))];
    let d = f64::from(tc.draw(gs::integers::<u32>().min_value(12).max_value(80))) / 2.0;
    let t = f64::from(tc.draw(gs::integers::<u32>().min_value(8).max_value(40))) / 10.0;
    let v = json!({"kind": "hoop", "hoopSection": section, "closure": closure, "hoopDiameter": d, "hoopThickness": t, "hoopWidth": t * 1.2});
    tc.note(&v.to_string());
    let Ok(p) = PieceParams::parse("t", &v) else { return };
    let again = PieceParams::parse("t", &p.json()).unwrap();
    assert_eq!(again, p);
    let one = hoop::volume(&p);
    assert!(one > 0.0 && one.is_finite(), "{v}");
    assert!((p.band_volume() - 2.0 * one).abs() < 1e-9 * (1.0 + one));
}

/// Rule: hostile hoop numbers never panic, and the cast solid of whatever builds is a closed shell.
#[hegel::test(test_cases = 25, suppress_health_check = [hegel::HealthCheck::TooSlow])]
fn hostile_hoops_never_panic(tc: TestCase) {
    let wild = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u32>().min_value(0).max_value(5)) {
            0 => json!(f64::from(tc.draw(gs::integers::<i32>().min_value(-1000).max_value(1000))) / 10.0),
            1 => json!("x"),
            2 => Value::Null,
            3 => json!(1e300),
            4 => json!(true),
            _ => json!(f64::from(tc.draw(gs::integers::<u32>().min_value(1).max_value(300))) / 10.0),
        }
    };
    let mut v = json!({"kind": "hoop"});
    for key in ["hoopDiameter", "hoopThickness", "hoopWidth", "hoopWall", "hoopGap", "postDiameter"] {
        if tc.draw(gs::booleans()) {
            v[key] = wild(&tc);
        }
    }
    for (key, words) in [("hoopSection", ["round", "tube", "knife"]), ("closure", ["post", "click", "?"])] {
        if tc.draw(gs::booleans()) {
            v[key] = json!(words[tc.draw(gs::integers::<usize>().min_value(0).max_value(2))]);
        }
    }
    if tc.draw(gs::booleans()) {
        let layout = ["row", "channel", "honeycomb"][tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
        v["pave"] = json!({"layout": layout, "span": "full"});
    }
    tc.note(&v.to_string());
    let mut s = mm_drawing();
    if let Err(EngineError::Internal(..)) = s.execute("piece", &v) {
        panic!("{v}: a panic was caught");
    }
    let _ = s.execute("piecemesh", &v);
    if let Ok(p) = PieceParams::parse("t", &v) {
        assert!(p.band_volume().is_finite() && p.band_volume() > 0.0, "{v}");
        let mesh = piece_mesh(&p, Quality::Draft);
        if let Ok((solid, _)) = solidify(&mesh.csg, 0.25, 400_000) {
            verify(&solid.positions, &solid.indices).unwrap_or_else(|e| panic!("{v}: {e}"));
        }
    }
}
