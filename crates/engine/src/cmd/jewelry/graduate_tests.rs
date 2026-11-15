//! Graduated eternity and half eternity rows: the sizes, the spacing by arc length, the symmetry,
//! the sheet, the mesh and the cast solid, refusals, hostile parameters and properties.

use cadcraft_geom::{PI, TAU};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::graduate::{Curve, GradeSpec, row};
use super::mesh::{Quality, piece_mesh};
use super::piece_params::PieceParams;
use super::solid::{solidify, verify};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn check_of<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no check {id} in {}", piece["checks"]))
}

fn eternity() -> Value {
    json!({"kind": "eternity", "size": 6, "width": 3.2, "wall": 2.2, "melee": 2.4, "gap": 0.2, "graduate": {"end": 1.4}})
}

#[test]
fn sizes_grade_from_the_centre_to_the_end() {
    let g = GradeSpec { end: 1.2, curve: Curve::Linear };
    assert_eq!(g.size_at(2.4, 0.0), 2.4);
    assert_eq!(g.size_at(2.4, 1.0), 1.2);
    assert!((g.size_at(2.4, 0.5) - 1.8).abs() < 1e-9);
    let smooth = GradeSpec { end: 1.2, curve: Curve::Smooth };
    // Smooth holds the centre size longer.
    assert!(smooth.size_at(2.4, 0.2) > g.size_at(2.4, 0.2) - 1e-9);
    assert!(smooth.size_at(2.4, 0.8) < g.size_at(2.4, 0.8) + 1e-9);
    assert_eq!(Curve::Smooth.ease(0.5), 0.5);
    assert_eq!(Curve::Smooth.ease(f64::NAN), 0.0);
}

#[test]
fn an_eternity_row_is_symmetric_and_keeps_the_gap() {
    let p = params(eternity());
    let r = row(&p).unwrap();
    assert!(r.closed);
    let n = r.stones.len();
    assert!(n >= 20, "{n}");
    assert_eq!(n as u32, r.most);
    let first = r.stones.first().unwrap();
    assert_eq!(first.size, 2.4);
    assert!(first.angle.abs() < 1e-12);
    // The stone opposite 12 o'clock is the smallest.
    let small = r.stones.iter().map(|s| s.size).fold(f64::INFINITY, f64::min);
    assert!((small - 1.4).abs() < 0.11, "{small}");
    // Mirror: stone i and n − i are one size, at opposite angles.
    for i in 1..n {
        let (a, b) = (&r.stones[i], &r.stones[n - i]);
        assert!((a.size - b.size).abs() < 1e-9);
        assert!((a.angle + b.angle - TAU).abs() < 1e-9, "{} {}", a.angle, b.angle);
    }
    assert!(r.least.unwrap() + 1e-9 >= 0.2);
    // One more does not fit.
    let mut more = eternity();
    more["count"] = json!(r.most + 1);
    assert!(mm_drawing().execute("piece", &more).is_err());
}

#[test]
fn a_half_eternity_row_stays_within_the_top_half() {
    let p = params(json!({"kind": "halfeternity", "width": 3.0, "wall": 2.0, "melee": 2.2, "graduate": {"end": 1.3, "curve": "smooth"}}));
    let r = row(&p).unwrap();
    assert!(!r.closed);
    let n = r.stones.len();
    assert!(n >= 5);
    for s in &r.stones {
        assert!(s.angle.abs() <= PI / 2.0 + 1e-9);
    }
    for i in 0..n {
        assert!((r.stones[i].angle + r.stones[n - 1 - i].angle).abs() < 1e-9);
        assert!((r.stones[i].size - r.stones[n - 1 - i].size).abs() < 1e-9);
    }
    // Packed at the gap.
    assert!((r.least.unwrap() - 0.2).abs() < 1e-6, "{:?}", r.least);
    assert!(r.plain(p.inner() / 2.0) > 0.0);
}

#[test]
fn the_sheet_counts_every_size_and_its_carats() {
    let mut s = mm_drawing();
    let out = s.execute("piece", &eternity()).unwrap();
    let piece = &out["piece"];
    let g = &piece["stones"]["graduated"];
    let sizes = g["sizes"].as_array().unwrap();
    assert!(sizes.len() >= 3, "{g}");
    let n: u64 = sizes.iter().map(|z| z["count"].as_u64().unwrap()).sum();
    assert_eq!(n, piece["stones"]["count"].as_u64().unwrap());
    let ct: f64 = sizes.iter().map(|z| z["carat"].as_f64().unwrap()).sum();
    assert!((ct - piece["stones"]["carat"].as_f64().unwrap()).abs() < 0.01, "{ct} {}", piece["stones"]["carat"]);
    assert_eq!(check_of(piece, "spacing")["ok"], true);
    assert_eq!(check_of(piece, "stone-seat")["ok"], true);
    assert_eq!(check_of(piece, "seat-wall")["ok"], true);
    assert!(out["message"].as_str().unwrap().contains("graduated"), "{}", out["message"]);
    // The layout has one GEM block per size.
    let blocks: Vec<String> = s.doc().unwrap().blocks.keys().filter(|n| n.starts_with("GEM-")).cloned().collect();
    assert!(blocks.len() >= sizes.len(), "{blocks:?}");
    // The bench sheet reads them.
    let bench = s.execute("techsheet", &json!({})).or_else(|_| s.execute("bench", &json!({})));
    assert!(bench.is_ok(), "{bench:?}");
}

#[test]
fn checks_fail_on_a_thin_wall_and_a_narrow_band() {
    let mut s = mm_drawing();
    let mut p = eternity();
    p["wall"] = json!(1.2);
    p["width"] = json!(2.6);
    let piece = s.execute("piece", &p).unwrap()["piece"].clone();
    assert_eq!(check_of(&piece, "seat-wall")["ok"], false, "{}", piece["checks"]);
    assert_eq!(check_of(&piece, "stone-seat")["ok"], false);
}

#[test]
fn graduation_merges_and_comes_off() {
    let mut s = mm_drawing();
    s.execute("piece", &eternity()).unwrap();
    let r = s.execute("piece", &json!({"graduate": {"curve": "smooth"}})).unwrap();
    assert_eq!(r["piece"]["params"]["graduate"], json!({"end": 1.4, "curve": "smooth"}));
    let r = s.execute("piece", &json!({"graduate": false})).unwrap();
    assert!(r["piece"]["stones"]["graduated"].is_null());
    // On a band it is noted, not used.
    let r = s.execute("piece", &json!({"kind": "band", "graduate": 1.5})).unwrap();
    assert!(r["message"].as_str().unwrap().contains("graduate"), "{}", r["message"]);
}

#[test]
fn the_mesh_and_the_cast_solid_seat_every_stone() {
    let p = params(json!({"kind": "halfeternity", "width": 3.2, "wall": 2.2, "melee": 2.4, "graduate": {"end": 1.5}}));
    let r = row(&p).unwrap();
    let mesh = piece_mesh(&p, Quality::Draft);
    assert_eq!(mesh.stones as usize, r.stones.len());
    let solid = solidify(&mesh.csg, 0.2, 1_000_000).unwrap().0;
    verify(&solid.positions, &solid.indices).unwrap();
    assert!(solid.volume() > 0.0);
}

#[test]
fn hostile_graduation_is_refused_without_a_panic() {
    for g in [
        json!("big"),
        json!(-1),
        json!(0.1),
        json!(1e308),
        json!({"end": "x"}),
        json!({"end": 2, "curve": 3}),
        json!({"end": 2, "what": 1}),
        json!([1]),
    ] {
        let mut p = eternity();
        p["graduate"] = g.clone();
        let r = mm_drawing().execute("piece", &p);
        assert!(r.is_err(), "{g}");
        assert!(!matches!(r, Err(crate::EngineError::Internal(..))), "{g}");
    }
    // A row that cannot go round is refused, not drawn.
    let r = mm_drawing().execute("piece", &json!({"kind": "eternity", "size": 3, "melee": 6, "graduate": 6, "count": 400}));
    assert!(r.is_err());
}

/// Rule: every graduated row PIECE draws keeps the gap, is symmetric and never panics.
#[hegel::test(test_cases = 80)]
fn any_graduated_row_keeps_the_gap(tc: TestCase) {
    let half = tc.draw(gs::booleans());
    let melee = tc.draw(gs::floats::<f64>().min_value(0.8).max_value(4.0));
    let end = tc.draw(gs::floats::<f64>().min_value(0.8).max_value(4.0));
    let gap = tc.draw(gs::floats::<f64>().min_value(0.0).max_value(1.0));
    let size = tc.draw(gs::integers::<i64>().min_value(3).max_value(13));
    let smooth = tc.draw(gs::booleans());
    let build = json!({"kind": if half { "halfeternity" } else { "eternity" }, "size": size, "width": 4.5, "wall": 2.5, "melee": melee, "gap": gap, "graduate": {"end": end, "curve": if smooth { "smooth" } else { "linear" }}});
    tc.note(&build.to_string());
    let Ok(p) = PieceParams::parse("test", &build) else { return };
    let Some(r) = row(&p) else { panic!("no row") };
    if let Some(least) = r.least {
        assert!(least + 1e-6 >= gap, "{least} < {gap}");
    }
    let n = r.stones.len();
    for s in &r.stones {
        assert!(s.size >= melee.min(end) - 1e-9 && s.size <= melee.max(end) + 1e-9);
    }
    if half {
        for i in 0..n {
            assert!((r.stones[i].angle + r.stones[n - 1 - i].angle).abs() < 1e-6);
        }
    }
    match mm_drawing().execute("piece", &build) {
        Ok(_) => {}
        Err(e) => assert!(!matches!(e, crate::EngineError::Internal(..)), "{build}: {e}"),
    }
}
