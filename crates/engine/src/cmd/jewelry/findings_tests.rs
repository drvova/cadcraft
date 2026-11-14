//! Pendants, studs and drop earrings (`PIECE` with `kind: pendant | stud | drop`): the findings'
//! dimensions and weights against their formulas, the checks passing and failing, a pair counting
//! two of everything, the sheet, the mesh and the cast solid agreeing, ring-only keys ignored,
//! the bench sheet reading "pair", a DXF round trip, and hostile parameters never panicking.

use cadcraft_geom::{PI, Vec3};
use hegel::TestCase;
use hegel::generators::{self as gs};
use serde_json::{Value, json};

use super::findings::{self, Shape};
use super::mesh::{Quality, piece_mesh, solid_stl};
use super::piece_params::PieceParams;
use super::piece_tests::{check, mm_drawing, piece, query, stone_inserts};
use super::solid::{solidify, verify};
use crate::Session;

fn params(v: &Value) -> PieceParams {
    PieceParams::parse("test", v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn grams(p: &Value) -> f64 {
    p["metal"]["grams"].as_f64().unwrap()
}

#[test]
fn a_pendant_has_a_bail_sized_for_its_chain() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "pendant", "stoneWidth": 6.5, "halo": true}));
    assert_eq!(p["params"]["kind"], "pendant");
    assert_eq!(p["params"]["bail"], "loop");
    assert_eq!(p["params"]["bailOpening"], json!(3.0));
    assert_eq!(p["params"]["chain"], json!(1.5));
    assert_eq!(p["size"], Value::Null, "a pendant has no ring size");
    assert_eq!(p["pieces"], json!(1));
    assert_eq!(check(&p, "bail-opening")["ok"], json!(true));
    assert_eq!(check(&p, "bail-wire")["ok"], json!(true));
    // The centre stone and its halo are inserts the bench counts.
    let stones = stone_inserts(&s, &p);
    assert_eq!(stones.len() as u64, p["stones"]["count"].as_u64().unwrap());
    assert!(stones.len() > 10, "{stones:?}");
    assert!(grams(&p) > 0.2 && grams(&p) < 3.0, "{}", grams(&p));
    // A chain too thick for the bail fails the check; a thin wire fails its own.
    let p = piece(&mut s, json!({"chain": 2.8, "bailWire": 0.6}));
    assert_eq!(check(&p, "bail-opening")["ok"], json!(false));
    assert!(check(&p, "bail-opening")["message"].as_str().unwrap().contains("3.3 mm"));
    assert_eq!(check(&p, "bail-wire")["ok"], json!(false));
    let back = query(&mut s);
    assert_eq!(back["params"], p["params"]);
}

#[test]
fn the_bail_weighs_its_torus() {
    let p = params(&json!({"kind": "pendant"}));
    let lay = findings::layout(&p);
    let bail = lay.findings.iter().find(|f| f.what == "bail").unwrap();
    let Shape::Loop { mean, wire, .. } = bail.shape else { panic!("a loop") };
    assert!((mean - 2.0).abs() < 1e-12 && (wire - 1.0).abs() < 1e-12);
    // A torus of mean radius 2 and 1 mm wire: 2π²·2·0.25 = π² mm³.
    assert!((bail.shape.volume() - PI * PI).abs() < 1e-9);
    let tube = params(&json!({"kind": "pendant", "bail": "tube", "bailOpening": 2.5, "bailWire": 0.8, "bailWidth": 4}));
    let t = findings::layout(&tube);
    let bail = t.findings.iter().find(|f| f.what == "bail").unwrap();
    // π(2.05² − 1.25²)·4.
    assert!((bail.shape.volume() - PI * (2.05f64.powi(2) - 1.25f64.powi(2)) * 4.0).abs() < 1e-9);
    // The weight is every part at the alloy's density.
    let (cast, bought) = findings::one_volume(&p);
    assert!((p.band_grams() - (cast + bought) / 1000.0 * p.density).abs() < 1e-12);
    assert_eq!(bought, 0.0, "a plain pendant buys nothing in");
}

#[test]
fn a_drop_pendant_hangs_from_a_jump_ring() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "pendant", "drop": true}));
    assert_eq!(check(&p, "jump-ring")["ok"], json!(true));
    assert_eq!(check(&p, "jump-ring-wire")["ok"], json!(true));
    let lay = findings::layout(&params(&p["params"]));
    let names: Vec<&str> = lay.findings.iter().map(|f| f.what).collect();
    assert!(names.contains(&"eye") && names.contains(&"jump ring") && names.contains(&"bail"), "{names:?}");
    // The links rest wire on wire.
    let at = |what: &str| match &lay.findings.iter().find(|f| f.what == what).unwrap().shape {
        Shape::Loop { c, mean, wire, .. } => (*c, *mean, *wire),
        _ => panic!(),
    };
    let ((e, re, we), (j, rj, wj)) = (at("eye"), at("jump ring"));
    assert!(((j.z - e.z) - (re + rj - (we + wj) / 2.0)).abs() < 1e-12);
    let p = piece(&mut s, json!({"jumpRing": 1.2, "jumpRingWire": 0.5}));
    assert_eq!(check(&p, "jump-ring")["ok"], json!(false));
    assert_eq!(check(&p, "jump-ring-wire")["ok"], json!(false));
}

#[test]
fn studs_are_a_pair() {
    let mut s = mm_drawing();
    let one = params(&json!({"kind": "stud", "head": "bezel", "stoneWidth": 5}));
    let p = piece(&mut s, json!({"kind": "stud", "head": "bezel", "stoneWidth": 5}));
    assert_eq!(p["pieces"], json!(2));
    assert_eq!(p["stones"]["count"], json!(2), "a stone in each stud");
    assert_eq!(stone_inserts(&s, &p).len(), 2);
    let centre = super::piece_params::carat_of(&one.centre_stone("t").unwrap());
    assert!((p["stones"]["carat"].as_f64().unwrap() - (2.0 * centre * 1000.0).round() / 1000.0).abs() < 1e-9);
    let (cast, bought) = findings::one_volume(&one);
    assert!((one.band_grams() - 2.0 * (cast + bought) / 1000.0 * one.density).abs() < 1e-12, "a pair weighs two");
    assert!((p["metal"]["eachGrams"].as_f64().unwrap() * 2.0 - grams(&p)).abs() < 2e-3);
    assert_eq!(check(&p, "post")["ok"], json!(true));
    assert_eq!(check(&p, "bezel-wall")["ok"], json!(true));
    let message = s.execute("piece", &json!({"postLength": 5})).unwrap()["message"].as_str().unwrap().to_string();
    assert!(message.contains("Stud earrings, a pair") && message.contains("backs"), "{message}");
    assert!(message.contains("butterfly backs are bought in"), "{message}");
    let p = query(&mut s);
    assert_eq!(check(&p, "post")["ok"], json!(false));
    // The bench sheet reads the pair.
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"], json!(2));
    assert_eq!(sheet["bands"][0]["pieces"], json!(2));
    assert_eq!(sheet["bands"][0]["piece"], "stud");
    assert!(sheet["message"].as_str().unwrap().contains("stud earrings, a pair"), "{}", sheet["message"]);
}

#[test]
fn drop_earrings_hang_from_a_hook_or_a_stud() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "drop", "cut": "pear", "stoneLength": 9, "stoneWidth": 6}));
    assert_eq!(p["stones"]["count"], json!(2));
    assert_eq!(check(&p, "ear-wire")["ok"], json!(true));
    assert_eq!(check(&p, "jump-ring")["ok"], json!(true));
    let lay = findings::layout(&params(&p["params"]));
    assert!(lay.findings.iter().any(|f| f.what == "ear wire" && !f.cast));
    let p = piece(&mut s, json!({"top": "stud", "topStone": 3}));
    // A hanging stone and a top stone in each earring.
    assert_eq!(p["stones"]["count"], json!(4));
    assert_eq!(stone_inserts(&s, &p).len(), 4);
    assert_eq!(check(&p, "post")["ok"], json!(true));
    let p = piece(&mut s, json!({"top": "hook", "hookWire": 0.5}));
    assert_eq!(check(&p, "ear-wire")["ok"], json!(false));
}

#[test]
fn ring_only_keys_are_noted_and_not_used() {
    let mut s = mm_drawing();
    let a = piece(&mut s, json!({"kind": "pendant"}));
    let r = s.execute("piece", &json!({"size": 9, "wall": 3, "pave": true})).unwrap();
    let m = r["message"].as_str().unwrap();
    assert!(m.contains("has no ring size") && m.contains("has no band"), "{m}");
    let b = &r["piece"];
    // Kept for a ring, not used: no pavé stones, the weight unchanged.
    assert!(b["params"]["pave"].is_object(), "{}", b["params"]["pave"]);
    assert_eq!(b["stones"]["pave"], Value::Null);
    assert!((grams(&a) - grams(b)).abs() < 1e-9, "the size and wall change nothing");
    // Back to a ring, the ring's own keys are there.
    let ring = piece(&mut s, json!({"kind": "solitaire"}));
    assert_eq!(ring["size"]["us"], json!(9.0));
    assert!(ring["stones"]["pave"]["count"].as_u64().is_some_and(|n| n > 0), "the pavé is back: {}", ring["stones"]);
}

/// A band's pattern, lettering and hallmark, and a solitaire's shank and pavé, survive a stop as
/// a pendant or earrings: kept (unused) while worn, and back when the kind is a ring again.
#[test]
fn ring_only_keys_survive_a_worn_kind_and_come_back() {
    let mut s = mm_drawing();
    let band = piece(&mut s, json!({"kind": "band", "width": 6, "pattern": {"hex": {"depth": 0.3}}, "engrave": "Anna", "hallmark": {"maker": "CC"}}));
    let keys = ["pattern", "engrave", "hallmark"];
    let before: Vec<Value> = keys.iter().map(|k| band["params"][*k].clone()).collect();
    for kind in ["pendant", "stud", "drop"] {
        let worn = piece(&mut s, json!({"kind": kind}));
        for (k, was) in keys.iter().zip(&before) {
            assert_eq!(&worn["params"][*k], was, "{kind} keeps `{k}`");
        }
        // A rebuild of the worn piece keeps them too.
        let again = piece(&mut s, json!({"stoneWidth": 5}));
        assert_eq!(again["params"]["engrave"], before[1], "{kind}: a rebuild keeps them");
        assert_eq!(query(&mut s)["params"]["hallmark"], before[2], "{kind}: stored");
    }
    let back = piece(&mut s, json!({"kind": "band"}));
    for (k, was) in keys.iter().zip(&before) {
        assert_eq!(&back["params"][*k], was, "the band's `{k}` is back");
    }
    assert!(back["pattern"].is_object(), "the pattern is cut again: {back}");

    let mut s = mm_drawing();
    let ring = piece(&mut s, json!({"kind": "solitaire", "pave": {"melee": 1.5}}));
    let worn = piece(&mut s, json!({"kind": "pendant"}));
    assert_eq!(worn["params"]["pave"], ring["params"]["pave"]);
    assert_eq!(worn["stones"]["count"], json!(1), "a pendant's one stone, no pavé: {}", worn["stones"]);
    // A pavé change while worn merges over the kept pavé, as on a ring.
    let worn = piece(&mut s, json!({"pave": {"gap": 0.3}}));
    assert_eq!(worn["params"]["pave"]["melee"], ring["params"]["pave"]["melee"]);
    let back = piece(&mut s, json!({"kind": "solitaire"}));
    assert_eq!(back["params"]["pave"]["gap"], json!(0.3));
    assert_eq!(back["params"]["pave"]["melee"], ring["params"]["pave"]["melee"]);
    // Taking a kept key off while worn takes it off for good; one given while worn is kept.
    piece(&mut s, json!({"kind": "stud"}));
    let off = piece(&mut s, json!({"pave": false, "shank": {"split": 2}}));
    assert_eq!(off["params"]["pave"], json!(false));
    let split = off["params"]["shank"].clone();
    assert_eq!(split["split"], json!(2), "{split}");
    let back = piece(&mut s, json!({"kind": "solitaire"}));
    assert_eq!(back["params"]["pave"], json!(false));
    assert_eq!(back["params"]["shank"], split, "the split shank is the solitaire's now");
}

/// A ring-only key a worn piece cannot read is not kept and not refused (it is not used).
#[test]
fn a_worn_piece_drops_an_unreadable_ring_key() {
    let p = params(&json!({"kind": "pendant", "pave": {"layout": "nonsense"}, "engrave": 7, "pattern": "x"}));
    assert!(p.held.is_empty(), "{:?}", p.held);
    let p = params(&json!({"kind": "pendant", "engrave": "Ok"}));
    let again = params(&p.json());
    assert_eq!(p, again, "the kept keys read back the same");
}

#[test]
fn refusals_are_sentences() {
    let mut s = mm_drawing();
    for (p, words) in [
        (json!({"kind": "pendant", "bail": "hoop"}), "`bail` must be loop or tube"),
        (json!({"kind": "stud", "postLength": 99}), "`postLength` must be"),
        (json!({"kind": "drop", "top": "clip"}), "`top` must be hook or stud"),
        (json!({"kind": "pendant", "drop": 3}), "`drop` must be true or false"),
        (json!({"kind": "brooch"}), "`kind` must be band, solitaire, threestone, eternity, halfeternity, dome, signet, pendant, stud or drop"),
    ] {
        let e = s.execute("piece", &p).unwrap_err().to_string();
        assert!(e.contains(words), "{p}: {e}");
    }
    assert_eq!(query(&mut s), Value::Null, "a refusal leaves nothing");
}

/// The mesh, the cast solid and the sheet are the same piece.
#[test]
fn sheet_mesh_and_solid_agree() {
    for (v, bodies) in [
        (json!({"kind": "pendant", "halo": true}), 1),
        (json!({"kind": "pendant", "head": "bezel", "bail": "tube"}), 1),
        (json!({"kind": "pendant", "drop": true}), 2),
        (json!({"kind": "stud", "head": "bezel", "stoneWidth": 5}), 2),
        (json!({"kind": "stud", "stoneWidth": 4}), 2),
        (json!({"kind": "drop", "top": "stud"}), 4),
        (json!({"kind": "drop"}), 2),
    ] {
        let p = params(&v);
        let mesh = piece_mesh(&p, Quality::Draft);
        let mut s = mm_drawing();
        let sheet = piece(&mut s, v.clone());
        assert_eq!(u64::from(mesh.stones), sheet["stones"]["count"].as_u64().unwrap(), "{v}");
        assert!(mesh.meshes.iter().any(|m| m.name == "findings"), "{v}");
        // The bought-in parts are shown but not cast.
        let (tris, solid, _) = solid_stl(&mesh, Quality::Draft, 600_000).unwrap_or_else(|e| panic!("{v}: {e}"));
        assert!(!tris.is_empty());
        verify(&solid.positions, &solid.indices).unwrap_or_else(|e| panic!("{v}: {e}"));
        assert_eq!(solid.bodies, bodies, "{v}");
        // The weight: findings exact, the head's wires along their paths, overlaps counted twice,
        // so the analytic figure stands over the merged solid but near it.
        let cast = findings::one_volume(&p).0 * f64::from(findings::pieces(&p));
        let ratio = solid.volume() / cast;
        assert!((0.6..=1.15).contains(&ratio), "{v}: solid {} mm³ against {cast} mm³ ({ratio})", solid.volume());
        eprintln!("{v}: solid {:.2} mm³, analytic cast {:.2} mm³, ratio {ratio:.3}", solid.volume(), cast);
    }
}

#[test]
fn a_pair_is_two_side_by_side_in_the_mesh() {
    let p = params(&json!({"kind": "stud"}));
    let m = piece_mesh(&p, Quality::Draft);
    let xs: Vec<f64> = m.meshes.iter().filter(|m| m.name == "centre stone").flat_map(|m| m.positions.iter().map(|q| q.x)).collect();
    assert!(xs.iter().any(|x| *x < -3.0) && xs.iter().any(|x| *x > 3.0));
    // The post runs back from the head (−Y).
    let post: Vec<Vec3> = m.meshes.iter().filter(|m| m.name == "findings").flat_map(|m| m.positions.clone()).collect();
    assert!(post.iter().any(|q| q.y < -10.0));
}

#[test]
fn the_piece_survives_a_dxf_round_trip() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "drop", "top": "stud", "head": "bezel"}));
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let back = query(&mut t);
    for key in ["params", "metal", "stones", "checks", "pieces"] {
        assert_eq!(back[key], p[key], "{key}");
    }
    let sheet = t.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"], json!(4));
}

#[test]
fn proposals_rebuild_the_same_piece() {
    for change in [json!({"kind": "pendant", "bail": "tube"}), json!({"kind": "stud", "postLength": 9}), json!({"kind": "drop", "top": "stud"})] {
        let mut s = mm_drawing();
        piece(&mut s, json!({"kind": "solitaire"}));
        let r = s.execute("propose", &json!({"steps": [{"command": "piece", "params": change}], "title": "Worn"})).unwrap();
        let id = r["proposals"][0]["id"].as_u64().unwrap();
        s.execute("accept", &json!({"id": id})).unwrap();
        let mut direct = mm_drawing();
        piece(&mut direct, json!({"kind": "solitaire"}));
        piece(&mut direct, change.clone());
        assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "{change}: accepted and run directly are the same drawing");
    }
}

/// Rule: a worn piece's weight is positive, a pair is exactly twice one, and its stones are two
/// of each.
#[hegel::test(test_cases = 40)]
fn a_pair_is_exactly_twice_one(tc: TestCase) {
    let kind = ["stud", "drop"][tc.draw(gs::integers::<usize>().min_value(0).max_value(1))];
    let stone = f64::from(tc.draw(gs::integers::<u32>().min_value(4).max_value(20))) / 2.0;
    let head = ["prong", "bezel"][tc.draw(gs::integers::<usize>().min_value(0).max_value(1))];
    let v = json!({"kind": kind, "stoneWidth": stone, "head": head, "top": if tc.draw(gs::booleans()) { "stud" } else { "hook" }});
    let p = params(&v);
    let (cast, bought) = findings::one_volume(&p);
    assert!(cast > 0.0, "{v}");
    assert!((p.band_volume() - 2.0 * (cast + bought)).abs() < 1e-9 * (1.0 + cast), "{v}");
    let mut s = mm_drawing();
    let Ok(r) = s.execute("piece", &v) else { return };
    let per = if kind == "drop" && v["top"] == "stud" { 2 } else { 1 };
    assert_eq!(r["piece"]["stones"]["count"], json!(2 * per), "{v}");
    assert!(grams(&r["piece"]) > 0.0);
}

/// Rule: hostile numbers for every finding never panic, and the cast solid of whatever builds is
/// a closed shell.
#[hegel::test(test_cases = 25, suppress_health_check = [hegel::HealthCheck::TooSlow])]
fn hostile_findings_never_panic(tc: TestCase) {
    let kind = ["pendant", "stud", "drop"][tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    let wild = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u32>().min_value(0).max_value(5)) {
            0 => json!(f64::from(tc.draw(gs::integers::<i32>().min_value(-1000).max_value(1000))) / 10.0),
            1 => json!("x"),
            2 => Value::Null,
            3 => json!(1e300),
            4 => json!(true),
            _ => json!(f64::from(tc.draw(gs::integers::<u32>().min_value(1).max_value(60))) / 10.0),
        }
    };
    let mut v = json!({"kind": kind});
    for key in [
        "bailWire",
        "bailOpening",
        "bailWidth",
        "chain",
        "jumpRing",
        "jumpRingWire",
        "postDiameter",
        "postLength",
        "topStone",
        "hookWire",
        "stoneWidth",
        "size",
    ] {
        if tc.draw(gs::booleans()) {
            v[key] = wild(&tc);
        }
    }
    for (key, words) in [("bail", ["loop", "tube", "?"]), ("top", ["hook", "stud", "?"]), ("head", ["prong", "bezel", "?"])] {
        if tc.draw(gs::booleans()) {
            v[key] = json!(words[tc.draw(gs::integers::<usize>().min_value(0).max_value(2))]);
        }
    }
    tc.note(&v.to_string());
    let mut s = mm_drawing();
    let _ = s.execute("piece", &v);
    let _ = s.execute("piecemesh", &v);
    if let Ok(p) = PieceParams::parse("t", &v) {
        assert!(p.band_volume().is_finite() && p.band_volume() > 0.0, "{v}");
        let mesh = piece_mesh(&p, Quality::Draft);
        if let Ok((solid, _)) = solidify(&mesh.csg, 0.25, 400_000) {
            verify(&solid.positions, &solid.indices).unwrap_or_else(|e| panic!("{v}: {e}"));
        }
    }
}
