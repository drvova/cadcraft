//! Prong styles, heights and their checks: the sheet, the mesh, the solid and the weight.

use cadcraft_geom::Vec2;
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::mesh::{Quality, piece_mesh};
use super::piece_params::PieceParams;
use super::prongs::{self, ProngStyle};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("piece", &v).unwrap()
}

fn piece(s: &mut Session, v: Value) -> Value {
    s.execute("piece", &v).unwrap()
}

fn check<'a>(reply: &'a Value, id: &str) -> &'a Value {
    reply["piece"]["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no {id} check in {reply}"))
}

#[test]
fn styles_parse_and_read_back() {
    for style in prongs::STYLES {
        let p = params(json!({"kind": "solitaire", "cut": "pear", "stoneLength": 9, "stoneWidth": 6, "prongStyle": style.name()}));
        assert_eq!(p.prong.style, style);
        let back = PieceParams::parse("piece", &p.json()).unwrap();
        assert_eq!(back.prong, p.prong);
    }
    let p = params(json!({"kind": "solitaire", "prongHeight": 1.4, "prongTip": 0.6, "prongWire": 1.0}));
    assert_eq!((p.prong.height, p.prong.tip, p.prong.wire), (Some(1.4), Some(0.6), Some(1.0)));
    assert_eq!(p.head().prong, 1.0);
    assert!((p.head().over - 1.4).abs() < 1e-12);
    for bad in
        [json!({"prongStyle": "square"}), json!({"prongHeight": -1}), json!({"prongTip": 9}), json!({"prongWire": 0.1}), json!({"prongStyle": 3})]
    {
        let mut v = json!({"kind": "solitaire"});
        v.as_object_mut().unwrap().extend(bad.as_object().unwrap().clone());
        let e = PieceParams::parse("piece", &v).unwrap_err().to_string();
        assert!(e.contains("prong"), "{e}");
    }
}

#[test]
fn round_is_unchanged_by_default() {
    let p = params(json!({"kind": "solitaire"}));
    let head = p.head();
    assert_eq!(p.prong.style, ProngStyle::Round);
    assert!((head.over - super::piece_params::PRONG_OVER * head.prong).abs() < 1e-12);
    assert!((p.prong.cover(head.prong) - 0.925 * head.prong).abs() < 1e-12);
}

#[test]
fn double_makes_pairs_and_v_takes_the_corners() {
    let p = params(json!({"kind": "solitaire", "prongs": 4, "prongStyle": "double"}));
    let sites = p.centre_sites().unwrap();
    assert_eq!(sites.len(), 8);
    // Each pair keeps a gap between its wires.
    for pair in sites.chunks(2) {
        let apart = pair[0].at.dist(pair[1].at);
        assert!(apart > p.head().prong, "{apart}");
        assert!((pair[0].at.len() - 3.25).abs() < 1e-9, "on the girdle");
    }
    // A pear's point and a princess's four corners take V prongs; a pear's other sites stay round.
    let pear = params(json!({"kind": "solitaire", "cut": "pear", "stoneLength": 9, "stoneWidth": 6, "prongs": 5, "prongStyle": "v"}));
    let sites = pear.centre_sites().unwrap();
    let corners: Vec<_> = sites.iter().filter(|s| s.corner.is_some()).collect();
    assert_eq!(corners.len(), 1, "{sites:?}");
    assert!(corners[0].at.y > 4.0, "the pear's point is along +y: {:?}", corners[0].at);
    assert!(corners[0].out.y > 0.9, "and the V faces out of it");
    let princess = params(json!({"kind": "solitaire", "cut": "princess", "stoneWidth": 5.5, "prongs": 4, "prongStyle": "v"}));
    assert_eq!(princess.centre_sites().unwrap().iter().filter(|s| s.corner.is_some()).count(), 4);
}

#[test]
fn v_on_a_round_is_refused_in_words() {
    let mut s = Session::new();
    let e = s.execute("piece", &json!({"kind": "solitaire", "prongStyle": "v"})).unwrap_err().to_string();
    assert!(e.contains("pointed corners") && e.contains("round"), "{e}");
    assert_eq!(s.execute("piece", &json!({"query": true})).unwrap()["piece"], Value::Null, "nothing drawn");
}

#[test]
fn checks_pass_by_default_and_fail_when_asked_for() {
    let mut s = Session::new();
    for style in ["round", "claw", "tab", "double"] {
        let r = piece(&mut s, json!({"kind": "solitaire", "prongStyle": style}));
        assert_eq!(check(&r, "prong-tip")["ok"], true, "{style}: {}", check(&r, "prong-tip"));
        assert_eq!(check(&r, "prong-wire")["ok"], true, "{style}");
        assert!(r["piece"]["metal"]["prongGrams"].as_f64().unwrap() > 0.0);
    }
    let r = piece(&mut s, json!({"prongTip": 0.1}));
    assert_eq!(check(&r, "prong-tip")["ok"], false);
    assert!(check(&r, "prong-tip")["message"].as_str().unwrap().contains("0.3 mm"));
    let r = piece(&mut s, json!({"prongTip": 2.5}));
    assert_eq!(check(&r, "prong-tip")["ok"], false, "reaches the table");
    let r = piece(&mut s, json!({"prongTip": 0.9, "prongHeight": 0.2}));
    assert_eq!(check(&r, "prong-tip")["ok"], false, "buried in the crown");
    let r = piece(&mut s, json!({"prongTip": null, "prongHeight": null, "prongWire": 0.5}));
    assert_eq!(check(&r, "prong-wire")["ok"], false);
    let r = piece(&mut s, json!({"metal": "platinum"}));
    assert_eq!(check(&r, "prong-wire")["ok"], false, "0.5 mm is under platinum's 0.6");
    let r = piece(&mut s, json!({"prongWire": 0.65}));
    assert_eq!(check(&r, "prong-wire")["ok"], true, "0.65 mm platinum holds");
    let r = piece(&mut s, json!({"metal": "silver"}));
    assert_eq!(check(&r, "prong-wire")["ok"], false, "silver needs 0.9");
    // A bezel has no prong checks.
    let r = piece(&mut s, json!({"head": "bezel"}));
    assert!(r["piece"]["checks"].as_array().unwrap().iter().all(|c| c["id"] != "prong-tip"));
}

#[test]
fn heavier_styles_weigh_more_and_bench_reads_them() {
    let round = params(json!({"kind": "solitaire", "prongs": 4})).prong_grams();
    let double = params(json!({"kind": "solitaire", "prongs": 4, "prongStyle": "double"})).prong_grams();
    let tab = params(json!({"kind": "solitaire", "prongs": 4, "prongStyle": "tab"})).prong_grams();
    assert!(round > 0.02 && round < 0.5, "{round}");
    assert!(double > 1.6 * round, "{double} vs {round}");
    assert!(tab > 0.0);
    let mut s = Session::new();
    piece(&mut s, json!({"kind": "solitaire", "prongStyle": "claw"}));
    let t = s.execute("techsheet", &json!({})).unwrap();
    let band = &t["bands"][0];
    assert_eq!(band["prongs"], "claw");
    assert!(band["prongGrams"].as_f64().unwrap() > 0.0, "{band}");
}

/// Whether a point `inward` from the girdle and `h` over its middle plane is inside the stone
/// (under the crown's slope, over the girdle's underside), allowing the seat's 0.02 mm notch.
fn inside_crown(inward: f64, h: f64, girdle: f64, crown: f64, run: f64) -> bool {
    inward > 0.02 && h < girdle / 2.0 + crown * (inward / run).min(1.0) - 1e-6 && h > -girdle / 2.0
}

#[test]
fn no_styled_tip_goes_through_the_crown() {
    for (cut, l, w, style) in [
        ("round", 6.5f64, 6.5f64, "claw"),
        ("round", 6.5, 6.5, "tab"),
        ("pear", 9.0, 6.0, "v"),
        ("princess", 5.5, 5.5, "v"),
        ("cushion", 7.0, 7.0, "tab"),
    ] {
        let p = params(json!({"kind": "solitaire", "cut": cut, "stoneLength": l, "stoneWidth": w, "prongs": 4, "prongStyle": style}));
        let head = p.head();
        let c = p.cut_data().unwrap();
        let t = p.top_spec(&head, l.min(w), c);
        let plane = prongs::Plane {
            o: cadcraft_geom::Vec3::ZERO,
            u: cadcraft_geom::Vec3::new(1.0, 0.0, 0.0),
            v: cadcraft_geom::Vec3::new(0.0, 1.0, 0.0),
            w: cadcraft_geom::Vec3::Z,
        };
        let run = prongs::table_run(l.min(w), super::piece_params::table_ratio(c));
        let crown = super::piece_params::CROWN * head.depth;
        let outline = super::piece_params::girdle_outline(c, l, w).unwrap();
        for site in p.centre_sites().unwrap() {
            for part in prongs::top_parts(&plane, &site, &t) {
                if let prongs::ProngPart::Bar { .. } = part {
                    // Sample the bar: no point of it lies under the crown's slope inside the girdle.
                    let (lo, hi) = part.bounds();
                    for i in 0..=12 {
                        for j in 0..=12 {
                            for k in 0..=12 {
                                let q = cadcraft_geom::Vec3::new(
                                    lo.x + (hi.x - lo.x) * i as f64 / 12.0,
                                    lo.y + (hi.y - lo.y) * j as f64 / 12.0,
                                    lo.z + (hi.z - lo.z) * k as f64 / 12.0,
                                );
                                if part.distance(q) > -1e-6 {
                                    continue;
                                }
                                let inward = -super::heads::polygon_distance(Vec2::new(q.x, q.y), &outline);
                                assert!(!inside_crown(inward, q.z, t.girdle, crown, run), "{cut} {style}: {q:?} is in the crown");
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn mesh_and_solid_carry_every_style() {
    for (cut, l, w, style, prongs, want_extra) in
        [("round", 6.5, 6.5, "claw", 6, 6), ("round", 6.5, 6.5, "tab", 4, 8), ("pear", 9.0, 6.0, "v", 5, 4), ("cushion", 7.0, 7.0, "double", 4, 0)]
    {
        let p = params(json!({"kind": "solitaire", "cut": cut, "stoneLength": l, "stoneWidth": w, "prongs": prongs, "prongStyle": style}));
        let mesh = piece_mesh(&p, Quality::Draft);
        let styled = mesh.csg.add.iter().filter(|q| matches!(q, super::solid::Prim::Prong(_))).count();
        let parts: usize = mesh.csg.add.iter().map(|q| if let super::solid::Prim::Prong(s) = q { s.parts.len() } else { 0 }).sum();
        assert_eq!(parts, want_extra, "{style}: {styled} styled prongs");
        let wires = mesh.csg.add.iter().filter(|q| matches!(q, super::solid::Prim::Wire { closed: false, .. })).count();
        let n = if style == "double" { 2 * prongs } else { prongs };
        assert_eq!(wires, n, "{style}: a leg per prong");
        // The prongs part reaches the tips' height over the band.
        let prong_mesh = mesh.meshes.iter().find(|m| m.name == "prongs").unwrap();
        let reach = prong_mesh.positions.iter().map(|q| q.y).fold(f64::MIN, f64::max);
        let tip = p.crown() + p.head().prong_height();
        assert!(reach <= tip + 1e-6 && reach > tip - 0.15, "{style}: reaches {reach}, the sheet {tip}");
        assert!(prong_mesh.volume() > 0.0, "{style}: outward shells");
    }
}

#[test]
fn the_sheet_draws_each_style_in_the_plan() {
    let mut s = Session::new();
    let r = piece(&mut s, json!({"kind": "solitaire", "prongs": 4, "prongStyle": "double"}));
    assert_eq!(r["piece"]["params"]["prongStyle"], "double");
    let circles = super::piece_tests::on_layer_count(&s, &r["piece"], "Settings", |k| matches!(k, cadcraft_doc::EntityKind::Circle { .. }));
    assert_eq!(circles, 8);
    let r = piece(&mut s, json!({"prongStyle": "tab"}));
    let circles = super::piece_tests::on_layer_count(&s, &r["piece"], "Settings", |k| matches!(k, cadcraft_doc::EntityKind::Circle { .. }));
    assert_eq!(circles, 0, "tabs are drawn as their footprints");
}

#[test]
fn hostile_prong_params_never_panic() {
    let mut s = Session::new();
    for v in [
        json!({"kind": "solitaire", "prongStyle": "claw", "prongTip": 3, "prongHeight": 4, "prongWire": 2.5, "stoneWidth": 0.5}),
        json!({"kind": "threestone", "prongStyle": "double", "prongs": 8, "sideProngs": 8, "prongWire": 2.5}),
        json!({"kind": "solitaire", "cut": "marquise", "stoneLength": 30, "stoneWidth": 0.5, "prongStyle": "v", "prongs": 8}),
        json!({"kind": "solitaire", "cut": "heart", "prongStyle": "v", "prongTip": 0}),
        json!({"kind": "solitaire", "cut": "cabochon", "prongStyle": "tab", "prongHeight": 0.1}),
        json!({"kind": "eternity", "prongStyle": "v"}),
        json!({"kind": "solitaire", "prongStyle": null, "prongHeight": "x"}),
        json!({"kind": "solitaire", "prongStyle": {"a": 1}}),
    ] {
        let _ = s.execute("piece", &v);
        if let Ok(p) = PieceParams::parse("piece", &v) {
            let _ = piece_mesh(&p, Quality::Draft);
            let _ = p.prong_grams();
        }
    }
}

fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

#[test]
fn proposing_claw_prongs_is_running_them() {
    let mut s = mm_drawing();
    piece(&mut s, json!({"kind": "solitaire"}));
    let r =
        s.execute("propose", &json!({"steps": [{"command": "piece", "params": {"prongStyle": "claw", "prongTip": 0.7}}], "title": "Claws"})).unwrap();
    let card = &r["proposals"][0];
    let change = card["changes"].as_array().unwrap().iter().find(|c| c["key"] == "piece.prongStyle").unwrap();
    assert_eq!((change["before"].as_str(), change["after"].as_str()), (Some("round"), Some("claw")), "{change}");
    s.execute("accept", &json!({"id": card["id"].as_u64().unwrap()})).unwrap();
    let mut direct = mm_drawing();
    piece(&mut direct, json!({"kind": "solitaire"}));
    piece(&mut direct, json!({"prongStyle": "claw", "prongTip": 0.7}));
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are the same drawing");
}

#[test]
fn prong_styles_survive_a_dxf_round_trip() {
    let mut s = mm_drawing();
    let p = piece(
        &mut s,
        json!({"kind": "solitaire", "cut": "pear", "stoneLength": 9, "stoneWidth": 6, "prongs": 5, "prongStyle": "v", "prongHeight": 1.3}),
    )["piece"]
        .clone();
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let q = t.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    for key in ["params", "metal", "stones", "checks"] {
        assert_eq!(q[key], p[key], "{key}");
    }
    let sheet = t.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["bands"][0]["prongs"], "v", "{}", sheet["bands"]);
}

/// Rule: any prong style, height, tip and wire the parser takes builds a mesh and a weight, the
/// checks agree with the numbers, a styled bar never enters the stone's crown, and the piece is
/// built or refused cleanly (V on a cut without corners in words).
#[hegel::test(test_cases = 50)]
fn any_prong_style_builds_or_is_refused_in_words(tc: TestCase) {
    let cuts = ["round", "oval", "princess", "pear", "cushion", "marquise", "heart", "emerald"];
    let cut = cuts[tc.draw(gs::integers::<usize>().min_value(0).max_value(cuts.len() - 1))];
    let style = prongs::STYLES[tc.draw(gs::integers::<usize>().min_value(0).max_value(4))].name();
    let width = tc.draw(gs::floats::<f64>().min_value(3.0).max_value(10.0));
    let mut build = json!({"kind": if tc.draw(gs::booleans()) { "solitaire" } else { "threestone" }, "cut": cut, "stoneWidth": width, "prongStyle": style,
        "prongs": tc.draw(gs::integers::<u32>().min_value(3).max_value(8))});
    if !matches!(cut, "round" | "princess" | "heart") {
        build["stoneLength"] = json!(width * tc.draw(gs::floats::<f64>().min_value(1.0).max_value(1.6)));
    }
    for (key, lo, hi) in [("prongHeight", 0.1, 4.0), ("prongTip", 0.0, 3.0), ("prongWire", 0.3, 2.5)] {
        if tc.draw(gs::booleans()) {
            build[key] = json!(tc.draw(gs::floats::<f64>().min_value(lo).max_value(hi)));
        }
    }
    tc.note(&format!("{build}"));
    let p = params(build.clone());
    let mesh = piece_mesh(&p, Quality::Draft);
    assert!(mesh.meshes.iter().all(|m| m.positions.iter().all(|q| q.is_finite())));
    assert!(p.prong_grams().is_finite() && p.prong_grams() > 0.0, "{build}");
    let mut s = mm_drawing();
    match s.execute("piece", &build) {
        Ok(r) => {
            let r = &r["piece"];
            let head = p.head();
            assert_eq!(
                check(&serde_json::json!({"piece": r}), "prong-wire")["ok"] == true,
                head.prong + 1e-9 >= prongs::min_wire(&p.metal),
                "{build}"
            );
            if p.kind.name() == "solitaire" {
                let t = p.top_spec(&head, p.stone_length.min(p.stone_width), p.cut_data().unwrap());
                let ok = check(&serde_json::json!({"piece": r}), "prong-tip")["ok"] == true;
                assert!(!(ok && t.cover + 1e-9 < prongs::MIN_PRONG_TIP), "{build}");
            }
        }
        Err(e) => {
            assert!(!matches!(e, crate::EngineError::Internal(..)), "{build} panicked: {e}");
            let words = e.to_string();
            assert!(words.contains("V prongs") || words.contains("side stones") || words.contains("fit"), "{build}: {words}");
        }
    }
}

#[test]
fn the_cast_solid_carries_each_style() {
    let mut s = Session::new();
    let volume = |s: &mut Session, style: &str| -> f64 {
        let r = s.execute("stlout", &json!({"kind": "solitaire", "prongs": 4, "prongStyle": style, "quality": "draft"})).unwrap();
        r["metal"]["volumeMm3"].as_f64().unwrap()
    };
    let (round, tab, double) = (volume(&mut s, "round"), volume(&mut s, "tab"), volume(&mut s, "double"));
    assert!(tab > round + 0.5, "the tabs' bars add metal: {tab} vs {round}");
    assert!(double > round + 0.5, "four more wires: {double} vs {round}");
    let pear = s
        .execute(
            "stlout",
            &json!({"kind": "solitaire", "cut": "pear", "stoneLength": 9, "stoneWidth": 6, "prongs": 5, "prongStyle": "v", "quality": "draft"}),
        )
        .unwrap();
    assert!(pear["metal"]["volumeMm3"].as_f64().unwrap() > 0.0);
}
