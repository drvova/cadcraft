//! The bezel head: its numbers, the sheet, the solid and the checks; its weight against an
//! analytic reference and the tessellated collar; propose, DXF and properties over drawn
//! parameters.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use hegel::TestCase;
use hegel::generators::{self as gs, Generator};
use serde_json::{Value, json};

use super::heads::{BEZEL_WALL, MIN_BEZEL_LIP, MIN_BEZEL_WALL};
use super::mesh::{Quality, piece_mesh};
use super::mesh_tests::{check as check_mesh, part, shells};
use super::piece_params::{CROWN, GIRDLE, PieceParams};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap()
}

fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn piece(s: &mut Session, p: Value) -> Value {
    s.execute("piece", &p).unwrap_or_else(|e| panic!("PIECE {p}: {e}"))["piece"].clone()
}

fn check_of<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no check {id} in {}", piece["checks"]))
}

#[test]
fn a_bezel_is_a_head_choice_that_reads_back() {
    let p = params(json!({"kind": "solitaire", "head": "bezel"}));
    let j = p.json();
    assert_eq!(j["head"], "bezel");
    assert_eq!(j["bezelWall"], Value::Null, "the default is said as null");
    assert_eq!(PieceParams::parse("test", &j).unwrap(), p);
    assert_eq!(params(json!({"kind": "solitaire"})).json()["head"], "prong", "prong stays the default");
    for bad in [json!("claw"), json!(3), json!(true)] {
        let e = PieceParams::parse("piece", &json!({"kind": "solitaire", "head": bad})).unwrap_err().to_string();
        assert!(e.contains("`head`"), "{e}");
    }
    for (key, v) in [("bezelWall", 0.1), ("bezelWall", 2.5), ("bezelHeight", -0.1), ("bezelHeight", 6.0)] {
        let e = PieceParams::parse("piece", &json!({"kind": "solitaire", "head": "bezel", key: v})).unwrap_err().to_string();
        assert!(e.contains(key), "{key} {v}: {e}");
    }
}

#[test]
fn the_default_bezel_is_bench_practice() {
    // A 6.5 mm round: 0.6 mm wall, a lip of 12 % of the stone (0.78 mm) under 70 % of the crown.
    let p = params(json!({"kind": "solitaire", "head": "bezel"}));
    let head = p.head();
    let b = head.bezel.unwrap();
    assert_eq!(b.wall, BEZEL_WALL);
    let crown = CROWN * head.depth;
    assert!((b.lip - (0.78f64).min(0.7 * crown)).abs() < 1e-12, "{b:?} crown {crown}");
    assert!((b.ledge - 0.39).abs() < 1e-12, "{b:?}");
    assert!((b.girdle_half - GIRDLE * head.depth / 2.0).abs() < 1e-12);
    // The collar's metal beyond the girdle stands in for the prong wire.
    assert!((head.prong - 2.0 * BEZEL_WALL).abs() < 1e-12);
    // The collar reaches into the band under its outer edge, and no nearer the finger than 0.2 mm.
    let girdle_r = p.crown() + head.girdle_height();
    let bottom_r = girdle_r + b.bottom;
    assert!(bottom_r < p.crown() - 0.2, "the collar's foot {bottom_r} is in the band (crown {})", p.crown());
    assert!(bottom_r >= p.inner() / 2.0 + 0.2 - 1e-9);
    // The tips of the head are the collar's top.
    assert!((head.prong_height() - (head.girdle_height() + b.girdle_half + b.lip)).abs() < 1e-12);
}

/// The collar's volume worked by hand for a round: the wall and the ledge, each a ring of
/// rectangle swept round the girdle at its own radius.
fn round_collar_by_hand(p: &PieceParams) -> f64 {
    let b = p.head().bezel.unwrap();
    let r = p.stone_width / 2.0;
    let ring = |r0: f64, r1: f64, h: f64| PI * (r1 * r1 - r0 * r0) * h;
    ring(r, r + b.wall, b.girdle_half + b.lip - b.bottom) + ring(r - b.ledge, r, -b.girdle_half - b.bottom)
}

#[test]
fn a_round_collar_weighs_what_the_hand_reckoning_says_and_the_solid_holds() {
    for (width, metal) in [(6.5, "gold18"), (4.0, "platinum"), (9.0, "silver")] {
        let p = params(json!({"kind": "solitaire", "head": "bezel", "stoneWidth": width, "metal": metal}));
        let by_hand = round_collar_by_hand(&p);
        assert!((p.bezel_volume() - by_hand).abs() < 1e-9 * by_hand, "{width}: {} vs {by_hand}", p.bezel_volume());
        assert!((p.bezel_grams() - by_hand / 1000.0 * p.density).abs() < 1e-12);
        // The tessellated collar is inscribed in it: a little under, within 1 % at fine.
        let mesh = piece_mesh(&p, Quality::Fine);
        check_mesh(&mesh, false, &format!("bezel {width}"));
        let solid = part(&mesh, "bezel").volume();
        assert!(solid < by_hand * 1.001 && solid > by_hand * 0.99, "{width}: mesh {solid} vs {by_hand}");
        assert_eq!(shells(part(&mesh, "bezel")).len(), 1, "one shell");
        assert!(mesh.meshes.iter().all(|m| m.name != "prongs" && m.name != "head"), "no prongs and no rail");
    }
}

#[test]
fn every_cut_sits_in_a_closed_collar_that_follows_its_girdle() {
    for (cut, l, w) in [
        ("round", 6.5, 6.5),
        ("oval", 8.0, 6.0),
        ("princess", 5.5, 5.5),
        ("cushion", 6.5, 6.0),
        ("emerald", 7.0, 5.0),
        ("pear", 8.0, 5.0),
        ("marquise", 10.0, 5.0),
        ("heart", 6.5, 6.5),
        ("trillion", 6.0, 6.0),
        ("cabochon", 8.0, 6.0),
    ] {
        let p = params(json!({"kind": "solitaire", "head": "bezel", "cut": cut, "stoneLength": l, "stoneWidth": w}));
        let mesh = piece_mesh(&p, Quality::Draft);
        check_mesh(&mesh, false, cut);
        let collar = part(&mesh, "bezel");
        assert_eq!(shells(collar).len(), 1, "{cut}");
        // The swept volume against P·A + 2π·M: exact for convex girdles, close for the rest.
        let (v, want) = (collar.volume(), p.bezel_volume());
        let tolerance = if matches!(cut, "heart" | "pear") { 0.08 } else { 0.03 };
        assert!((v - want).abs() < tolerance * want, "{cut}: mesh {v} vs {want}");
        // The sheet builds and passes its bezel checks at the defaults.
        let mut s = mm_drawing();
        let r = piece(&mut s, json!({"kind": "solitaire", "head": "bezel", "cut": cut, "stoneLength": l, "stoneWidth": w}));
        assert_eq!(check_of(&r, "bezel-wall")["ok"], true, "{cut}");
        assert_eq!(check_of(&r, "bezel-lip")["ok"], true, "{cut}: {}", check_of(&r, "bezel-lip"));
        assert!(r["metal"]["bezelGrams"].as_f64().unwrap() > 0.0, "{cut}");
    }
}

#[test]
fn the_bezel_checks_pass_and_fail_where_the_bench_says() {
    let mut s = mm_drawing();
    let r = piece(&mut s, json!({"kind": "solitaire", "head": "bezel"}));
    assert_eq!(check_of(&r, "bezel-wall")["ok"], true);
    assert_eq!(check_of(&r, "bezel-lip")["ok"], true);
    let thin = piece(&mut s, json!({"bezelWall": MIN_BEZEL_WALL - 0.1}));
    assert_eq!(check_of(&thin, "bezel-wall")["ok"], false, "{}", check_of(&thin, "bezel-wall"));
    let at = piece(&mut s, json!({"bezelWall": MIN_BEZEL_WALL}));
    assert_eq!(check_of(&at, "bezel-wall")["ok"], true);
    let low = piece(&mut s, json!({"bezelHeight": MIN_BEZEL_LIP - 0.05}));
    assert_eq!(check_of(&low, "bezel-lip")["ok"], false);
    assert!(check_of(&low, "bezel-lip")["message"].as_str().unwrap().contains("hold the stone"));
    let high = piece(&mut s, json!({"bezelHeight": 3.0}));
    assert_eq!(check_of(&high, "bezel-lip")["ok"], false);
    assert!(check_of(&high, "bezel-lip")["message"].as_str().unwrap().contains("reaches the table"));
    // The failing checks are said in the reply's message, as every failing check is.
    let r = s.execute("piece", &json!({"bezelWall": 0.3, "bezelHeight": 0.6})).unwrap();
    assert!(r["message"].as_str().unwrap().contains("Check: The bezel wall is 0.3 mm"), "{}", r["message"]);
    // Back to prongs: no bezel checks and no collar weight.
    let prong = piece(&mut s, json!({"head": "prong"}));
    assert!(prong["checks"].as_array().unwrap().iter().all(|c| c["id"] != "bezel-wall" && c["id"] != "bezel-lip"));
    assert!(prong["metal"].get("bezelGrams").is_none());
}

#[test]
fn a_three_stone_ring_sets_all_three_in_bezels() {
    let p = params(json!({"kind": "threestone", "head": "bezel", "stoneWidth": 5.0}));
    let sides = p.sides();
    assert!(sides.fits, "{sides:?}");
    assert!(sides.head.bezel.is_some());
    // The side stones clear the centre's collar by the gap and both walls.
    assert!(sides.between() + 1e-6 >= p.gap, "{sides:?}");
    assert!((sides.metal - BEZEL_WALL * 2.0).abs() < 1e-12);
    let mesh = piece_mesh(&p, Quality::Draft);
    check_mesh(&mesh, false, "three-stone bezel");
    assert_eq!(shells(part(&mesh, "bezel")).len(), 3);
    let by_parts = p.bezel_volume();
    let solid = part(&mesh, "bezel").volume();
    assert!((solid - by_parts).abs() < 0.02 * by_parts, "{solid} vs {by_parts}");
    let mut s = mm_drawing();
    let r = piece(&mut s, json!({"kind": "threestone", "head": "bezel", "stoneWidth": 5.0}));
    assert_eq!(r["stones"]["count"], 3);
    assert!(s.execute("piece", &json!({"query": true})).unwrap()["piece"]["params"]["head"] == "bezel");
}

#[test]
fn the_sheet_and_the_solid_agree_on_a_bezel() {
    for build in [
        json!({"kind": "solitaire", "head": "bezel"}),
        json!({"kind": "solitaire", "head": "bezel", "cut": "oval", "stoneLength": 8, "stoneWidth": 6, "metal": "platinum"}),
        json!({"kind": "solitaire", "head": "bezel", "halo": 1.3}),
        json!({"kind": "threestone", "head": "bezel", "stoneWidth": 5.5, "profile": "comfort"}),
    ] {
        let mut s = mm_drawing();
        let sheet = piece(&mut s, build.clone());
        let mut q = sheet["params"].clone();
        q["quality"] = json!("draft");
        let solid = s.execute("piecemesh", &q).unwrap();
        assert_eq!(solid["stones"], sheet["stones"]["count"], "{build}");
        assert_eq!(solid["metal"]["grams"], json!((sheet["metal"]["grams"].as_f64().unwrap() * 1000.0).round() / 1000.0), "{build}");
        let (a, b) = (solid["metal"]["bezelGrams"].as_f64().unwrap(), sheet["metal"]["bezelGrams"].as_f64().unwrap());
        assert!((a - b).abs() <= 1e-3, "{build}: {a} vs {b}");
        assert!(solid["meshes"].as_array().unwrap().iter().any(|m| m["name"] == "bezel"));
        // The front view draws the collar's two sides in section on the Settings layer.
        let n = sheet["handles"].as_array().unwrap().len();
        assert!(n > 4, "{build}");
    }
}

#[test]
fn the_bezel_bound_is_negative_in_the_collar_and_never_over_the_distance() {
    for build in [json!({"kind": "solitaire", "head": "bezel"}), json!({"kind": "threestone", "head": "bezel", "cut": "oval", "stoneLength": 6, "stoneWidth": 4.5})] {
        let p = params(build.clone());
        let bounds = p.bezel_bounds();
        assert_eq!(bounds.len(), if p.kind.name() == "threestone" { 3 } else { 1 }, "{build}");
        let mesh = piece_mesh(&p, Quality::Draft);
        let collar = part(&mesh, "bezel");
        let f = |q: Vec3| bounds.iter().map(|b| b.distance(q)).fold(f64::INFINITY, f64::min);
        // On the tessellated surface the bound is about zero.
        for v in &collar.positions {
            assert!(f(*v).abs() < 0.06, "{build}: {v:?} → {}", f(*v));
        }
        let b = &bounds[0];
        let mid = b.o + b.w * ((b.bezel.top() + b.bezel.bottom) / 2.0);
        let wall = b.girdle.iter().map(|q| q.len()).fold(0.0, f64::max);
        let _ = wall;
        // Inside the collar's wall, outside at the stone's middle.
        let g = b.girdle[0];
        let n = g.normalized();
        let inside = b.o + b.u * (g.x + n.x * b.bezel.wall / 2.0) + b.v * (g.y + n.y * b.bezel.wall / 2.0);
        assert!(b.distance(inside) < 0.0, "{build}");
        assert!(b.distance(mid) > 0.0, "{build}");
        // 1-Lipschitz on pairs of points round the head.
        let mut seed = 7u64;
        let mut rnd = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 11) as f64 / (1u64 << 53) as f64) * 2.0 - 1.0
        };
        for _ in 0..2000 {
            let a = b.o + Vec3::new(rnd() * 6.0, rnd() * 6.0, rnd() * 6.0);
            let c = a + Vec3::new(rnd(), rnd(), rnd()) * 0.5;
            assert!((b.distance(a) - b.distance(c)).abs() <= (a - c).len() + 1e-9, "{build}");
        }
    }
}

#[test]
fn proposing_a_bezel_is_running_it() {
    let mut s = mm_drawing();
    piece(&mut s, json!({"kind": "solitaire"}));
    let r = s.execute("propose", &json!({"steps": [{"command": "piece", "params": {"head": "bezel"}}], "title": "A bezel"})).unwrap();
    let card = &r["proposals"][0];
    let head = card["changes"].as_array().unwrap().iter().find(|c| c["key"] == "piece.head").unwrap();
    assert_eq!((head["before"].as_str(), head["after"].as_str()), (Some("prong"), Some("bezel")), "{head}");
    let id = card["id"].as_u64().unwrap();
    s.execute("accept", &json!({"id": id})).unwrap();
    let mut direct = mm_drawing();
    piece(&mut direct, json!({"kind": "solitaire"}));
    piece(&mut direct, json!({"head": "bezel"}));
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are the same drawing");
}

#[test]
fn a_bezel_survives_a_dxf_round_trip() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "solitaire", "head": "bezel", "bezelWall": 0.7, "cut": "oval", "stoneLength": 8, "stoneWidth": 6}));
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let q = t.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    for key in ["params", "metal", "stones", "checks"] {
        assert_eq!(q[key], p[key], "{key}");
    }
    // The bench sheet reads the head off the band's record.
    let sheet = t.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["bands"][0]["head"], "bezel", "{}", sheet["bands"]);
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

fn drawn_bezel(tc: &TestCase) -> Value {
    let cuts = ["round", "oval", "princess", "emerald", "pear", "cushion", "marquise", "cabochon", "heart"];
    let cut = cuts[tc.draw(gs::integers::<usize>().min_value(0).max_value(cuts.len() - 1))];
    let width = tc.draw(gs::floats::<f64>().min_value(2.0).max_value(10.0));
    let long = if cut == "round" || cut == "princess" || cut == "heart" { width } else { width * tc.draw(gs::floats::<f64>().min_value(1.0).max_value(1.6)) };
    let mut p = json!({"kind": if tc.draw(gs::booleans()) { "solitaire" } else { "threestone" }, "head": "bezel", "cut": cut, "stoneWidth": width, "stoneLength": long.min(30.0)});
    if tc.draw(gs::booleans()) {
        p["bezelWall"] = json!(tc.draw(gs::floats::<f64>().min_value(0.2).max_value(2.0)));
    }
    if tc.draw(gs::booleans()) {
        p["bezelHeight"] = json!(tc.draw(gs::floats::<f64>().min_value(0.0).max_value(5.0)));
    }
    if tc.draw(gs::booleans()) {
        p["profile"] = json!(["flat", "dome", "comfort", "court", "knife", "bevel", "concave"][tc.draw(gs::integers::<usize>().min_value(0).max_value(6))]);
    }
    p
}

/// Rule: any bezel the parser takes builds a closed, outward collar with positive weight, its
/// checks agree with the numbers, and the sheet either builds it or refuses it cleanly.
#[hegel::test(test_cases = 60)]
fn any_bezel_is_a_closed_collar_with_consistent_checks(tc: TestCase) {
    let build = drawn_bezel(&tc);
    tc.note(&format!("{build}"));
    let p = params(build.clone());
    let mesh = piece_mesh(&p, Quality::Draft);
    check_mesh(&mesh, false, &build.to_string());
    assert!(part(&mesh, "bezel").volume() > 0.0);
    assert!(p.bezel_grams() > 0.0 && p.bezel_grams().is_finite());
    let mut s = mm_drawing();
    match s.execute("piece", &build) {
        Ok(r) => {
            let r = &r["piece"];
            let b = p.head().bezel.unwrap();
            let wall_ok = check_of(r, "bezel-wall")["ok"] == true;
            let lip_ok = check_of(r, "bezel-lip")["ok"] == true;
            if p.kind.name() == "solitaire" {
                assert_eq!(wall_ok, b.wall + 1e-9 >= MIN_BEZEL_WALL, "{build}");
                assert_eq!(lip_ok, b.lip + 1e-9 >= MIN_BEZEL_LIP && b.lip < b.crown - 1e-9, "{build}");
            }
            assert!(r["metal"]["bezelGrams"].as_f64().unwrap() > 0.0);
        }
        Err(e) => assert!(!matches!(e, crate::EngineError::Internal(..)), "{build} panicked: {e}"),
    }
}

/// Rule: switching the head to a bezel and back is the piece it was.
#[hegel::test(test_cases = 30)]
fn a_bezel_and_back_is_the_same_piece(tc: TestCase) {
    let mut build = drawn_bezel(&tc);
    build["head"] = json!("prong");
    let mut s = mm_drawing();
    let Ok(first) = s.execute("piece", &build) else { return };
    if s.execute("piece", &json!({"head": "bezel"})).is_err() {
        return;
    }
    let back = s.execute("piece", &json!({"head": "prong"})).unwrap();
    for key in ["params", "metal", "stones", "checks"] {
        assert_eq!(back["piece"][key], first["piece"][key], "{key}");
    }
}

/// Rule: hostile numbers never panic the parser, the sheet or the solid.
#[hegel::test(test_cases = 200)]
fn hostile_bezel_params_never_panic(tc: TestCase) {
    let any = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u8>().min_value(0).max_value(5)) {
            0 => json!(f64::MAX),
            1 => json!(-1e300),
            2 => json!("bezel"),
            3 => Value::Null,
            4 => json!(tc.draw(gs::floats::<f64>().min_value(-100.0).max_value(100.0))),
            _ => json!([1, 2]),
        }
    };
    let build = json!({"kind": "solitaire", "head": if tc.draw(gs::booleans()) { any(&tc) } else { json!("bezel") }, "bezelWall": any(&tc), "bezelHeight": any(&tc), "stoneWidth": any(&tc)});
    let mut s = mm_drawing();
    if let Err(e) = s.execute("piece", &build) {
        assert!(!matches!(e, crate::EngineError::Internal(..)), "{build}: {e}");
    }
    if let Err(e) = s.execute("piecemesh", &build) {
        assert!(!matches!(e, crate::EngineError::Internal(..)), "{build}: {e}");
    }
    let _ = (TAU, Vec2::ZERO);
}
