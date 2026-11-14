//! Where the jewelry features built side by side meet: the `pattern` key the cable and the
//! generative patterns share, engraving on a patterned band, a pattern on what is not a plain
//! band, the ring-only keys on a pendant or earrings, and prong styles off the finger.

use cadcraft_doc::{EntityKind, LwPolyline};
use cadcraft_geom::{PolyVertex, TAU, Vec2};
use serde_json::{Value, json};

use super::mesh::{Quality, piece_mesh};
use super::piece_params::PieceParams;
use super::piece_tests::{mm_drawing, piece, query, state};
use super::solid::Prim;
use crate::{EngineError, Session};

fn refused(s: &mut Session, p: Value, says: &str) {
    let before = state(s);
    match s.execute("piece", &p) {
        Err(EngineError::Internal(..)) => panic!("{p}: a panic was caught"),
        Err(e) => assert!(e.to_string().contains(says), "{p}: {e} (wanted `{says}`)"),
        Ok(v) => panic!("{p}: accepted: {v}"),
    }
    assert_eq!(state(s), before, "{p}: a refusal changes nothing");
}

fn params_of(p: &Value) -> PieceParams {
    PieceParams::parse("test", &p["params"]).unwrap()
}

fn oval(s: &mut Session) -> String {
    let vertices = (0..64).map(|i| TAU * f64::from(i) / 64.0).map(|t| PolyVertex::new(Vec2::new(10.0 * t.cos(), 8.0 * t.sin()))).collect();
    s.add_entity(EntityKind::LwPolyline(LwPolyline { vertices, closed: true, const_width: 0.0, elevation: 0.0, plinegen: false })).unwrap().hex()
}

const VORONOI: &str = r#"{"voronoi": {"cells": 18, "seed": 7}}"#;

fn voronoi() -> Value {
    serde_json::from_str(VORONOI).unwrap()
}

// ---------------------------------------------------------------------------------------------
// One `pattern` key for the cable and the generative patterns
// ---------------------------------------------------------------------------------------------

#[test]
fn a_cable_keeps_its_twist_through_a_rebuild_and_a_query() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "band", "pattern": {"twist": {"strands": 2, "wire": 1.1}}}));
    assert_eq!(p["params"]["pattern"]["twist"]["strands"], json!(2), "{}", p["params"]);
    // Another key changed: the twist stays (it used to be written back as `pattern: false`).
    let p = piece(&mut s, json!({"metal": "platinum"}));
    assert_eq!(p["params"]["pattern"]["twist"]["strands"], json!(2), "{}", p["params"]);
    assert!(params_of(&p).shape.twist.is_some());
    assert!(params_of(&p).pattern.is_none());
    // One key of the twist changed: the others merge in.
    let p = piece(&mut s, json!({"pattern": {"twist": {"wire": 1.2}}}));
    assert_eq!(p["params"]["pattern"]["twist"], json!({"strands": 2, "turns": null, "wire": 1.2}));
    assert_eq!(query(&mut s)["params"]["pattern"]["twist"]["wire"], json!(1.2));
}

#[test]
fn a_generative_pattern_round_trips_and_can_replace_a_twist_and_back() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "band", "width": 6, "pattern": voronoi()}));
    assert_eq!(p["params"]["pattern"]["voronoi"]["seed"], json!(7));
    let again = PieceParams::parse("test", &params_of(&p).json()).unwrap();
    assert_eq!(again.json(), params_of(&p).json(), "the stored JSON reads back to the same piece");
    let p = piece(&mut s, json!({"metal": "silver"}));
    assert_eq!(p["params"]["pattern"]["voronoi"]["cells"], json!(18));
    // A twist in its place: the pattern is replaced, not merged.
    let p = piece(&mut s, json!({"pattern": {"twist": true}}));
    assert!(p["params"]["pattern"].get("voronoi").is_none(), "{}", p["params"]["pattern"]);
    assert!(params_of(&p).shape.twist.is_some() && params_of(&p).pattern.is_none());
    // And back: the cable's width was its bundle's, too narrow for rims and cells, so the
    // band is widened with it.
    let p = piece(&mut s, json!({"pattern": voronoi(), "width": 6}));
    assert!(params_of(&p).shape.twist.is_none() && params_of(&p).pattern.is_some());
    // Off.
    let p = piece(&mut s, json!({"pattern": null}));
    assert_eq!(p["params"]["pattern"], json!(false));
}

#[test]
fn a_twist_and_a_generative_pattern_together_are_refused() {
    let mut s = mm_drawing();
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": true, "voronoi": {}}}), "cannot carry `voronoi` as well");
    refused(&mut s, json!({"kind": "band", "pattern": {"weave": {}}}), "or a cable's twist");
}

// ---------------------------------------------------------------------------------------------
// Engraving on a patterned band
// ---------------------------------------------------------------------------------------------

#[test]
fn a_pierced_band_refuses_engraving_and_a_hallmark() {
    let mut s = mm_drawing();
    refused(&mut s, json!({"kind": "band", "width": 6, "pattern": voronoi(), "engrave": "Anna"}), "pierced band");
    refused(&mut s, json!({"kind": "band", "width": 6, "pattern": voronoi(), "engrave": {"text": "Anna", "at": "outside"}}), "pierced band");
    refused(&mut s, json!({"kind": "band", "width": 6, "pattern": voronoi(), "hallmark": true}), "pierced band");
}

#[test]
fn a_relief_band_takes_engraving_inside_and_refuses_it_outside() {
    let mut s = mm_drawing();
    let relief = json!({"hex": {"size": 2.4, "depth": 0.3}});
    refused(
        &mut s,
        json!({"kind": "band", "width": 6, "wall": 2, "pattern": relief, "engrave": {"text": "Anna", "at": "outside"}}),
        "engrave it inside",
    );
    let p = piece(
        &mut s,
        json!({"kind": "band", "width": 6, "wall": 2, "pattern": relief, "engrave": {"text": "Anna", "at": "inside"}, "hallmark": true}),
    );
    assert_eq!(p["params"]["engrave"]["text"], json!("Anna"));
    assert!(p["params"]["pattern"]["hex"].is_object());
}

#[test]
fn a_cable_refuses_engraving() {
    let mut s = mm_drawing();
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": true}, "engrave": "Anna"}), "no surface to engrave");
}

// ---------------------------------------------------------------------------------------------
// A pattern only on a plain band
// ---------------------------------------------------------------------------------------------

#[test]
fn a_pattern_is_refused_on_what_is_not_a_plain_band() {
    let mut s = mm_drawing();
    refused(
        &mut s,
        json!({"kind": "solitaire", "shank": {"split": 2}, "width": 3, "pattern": voronoi()}),
        "a pattern is laid on a plain band (kind band)",
    );
    refused(&mut s, json!({"kind": "solitaire", "shank": {"cathedral": true}, "pattern": voronoi()}), "plain band (kind band)");
    refused(&mut s, json!({"kind": "band", "width": 6, "pattern": voronoi(), "pave": {"layout": "channel"}}), "pavé and a pattern");
    refused(&mut s, json!({"kind": "band", "width": 6, "pattern": voronoi(), "pave": {"layout": "rows", "rows": 2}}), "pavé and a pattern");
    let o = oval(&mut s);
    refused(&mut s, json!({"kind": "band", "width": 6, "rail": {"curve": o}, "pattern": voronoi()}), "drawn rail");
}

// ---------------------------------------------------------------------------------------------
// Pendants and earrings: the ring-only keys are noted, not used
// ---------------------------------------------------------------------------------------------

#[test]
fn ring_only_keys_on_a_pendant_or_earrings_are_noted_and_not_used() {
    for kind in ["pendant", "stud", "drop"] {
        let mut s = mm_drawing();
        let asked = json!({"kind": kind, "engrave": "Anna", "hallmark": true, "pattern": voronoi(), "shank": {"split": 2}});
        let r = s.execute("piece", &asked).unwrap_or_else(|e| panic!("{kind}: {e}"));
        let message = r["message"].as_str().unwrap();
        for key in ["`shank`", "`pattern`", "`engrave`", "`hallmark`"] {
            assert!(message.contains(key), "{kind}: {key} not named in {message}");
        }
        let p = params_of(&r["piece"]);
        assert!(p.engrave.is_none() && p.hallmark.is_none() && p.pattern.is_none() && !p.shape.shaped(), "{kind}");
        // A twist is not used either, and nothing is engraved in the solid.
        let r = s.execute("piece", &json!({"pattern": {"twist": true}})).unwrap();
        assert!(params_of(&r["piece"]).shape.twist.is_none(), "{kind}");
        let mesh = piece_mesh(&params_of(&r["piece"]), Quality::Draft);
        assert!(!mesh.csg.add.iter().chain(&mesh.csg.cut).any(|p| matches!(p, Prim::Groove(_) | Prim::Pattern(_) | Prim::Shank(_))), "{kind}");
    }
}

// ---------------------------------------------------------------------------------------------
// Prong styles off the finger
// ---------------------------------------------------------------------------------------------

#[test]
fn prong_styles_apply_to_pendants_and_both_earrings_of_a_pair() {
    for (kind, bodies) in [("pendant", 1usize), ("stud", 2), ("drop", 2)] {
        let mut s = mm_drawing();
        let p = piece(&mut s, json!({"kind": kind, "prongs": 4, "prongStyle": "claw", "prongHeight": 0.9}));
        assert_eq!(p["params"]["prongStyle"], json!("claw"), "{kind}");
        assert_eq!(p["params"]["prongHeight"], json!(0.9), "{kind}");
        let mesh = piece_mesh(&params_of(&p), Quality::Draft);
        let tops: Vec<f64> = mesh
            .csg
            .add
            .iter()
            .filter_map(|q| match q {
                Prim::Prong(t) => Some((t.bounds().0.x + t.bounds().1.x) / 2.0),
                _ => None,
            })
            .collect();
        assert_eq!(tops.len(), 4 * bodies, "{kind}: a claw top per prong of every head");
        if bodies == 2 {
            // The second earring's prongs moved with it.
            let (lo, hi) = tops.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| (a.min(*x), b.max(*x)));
            assert!(hi - lo > 6.0, "{kind}: both earrings' claws, {lo}..{hi}");
        }
    }
}

#[test]
#[ignore = "measurement"]
fn measure_prong_head_estimate_against_the_cast_solid() {
    use super::solid::solidify;
    for (kind, w, prongs, extra) in [
        ("pendant", 6.5, 4, json!({})),
        ("pendant", 6.5, 6, json!({})),
        ("pendant", 6.5, 6, json!({"halo": 1.3, "gap": 0.15})),
        ("stud", 4.0, 4, json!({})),
        ("stud", 6.0, 6, json!({})),
        ("drop", 5.0, 3, json!({"cut": "pear", "stoneLength": 7})),
        ("pendant", 8.0, 4, json!({"prongStyle": "claw"})),
    ] {
        let mut v = json!({"kind": kind, "stoneWidth": w, "stoneLength": w, "prongs": prongs, "metal": "gold18"});
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        let p = PieceParams::parse("t", &v).unwrap();
        let est_cast = super::findings::one_volume(&p).0 * f64::from(super::findings::pieces(&p));
        let mesh = piece_mesh(&p, Quality::Draft);
        let (solid, _) = solidify(&mesh.csg, 0.1, 2_000_000).unwrap();
        let head = super::findings::head_volume(&p) * f64::from(super::findings::pieces(&p));
        println!(
            "MEASURE {kind} {w} {prongs} {extra}: estimate cast {est_cast:.2} mm3 (head {head:.2}), solid {:.2} mm3, ratio {:.3}",
            solid.volume(),
            est_cast / solid.volume()
        );
    }
}

#[test]
fn the_display_notes_say_what_the_view_and_the_cast_solid_hold() {
    for (v, says) in [
        (json!({"kind": "band", "engrave": "Anna", "hallmark": true}), "STLOUT cuts the grooves"),
        (json!({"kind": "band", "width": 6, "pattern": {"voronoi": {}}}), "STLOUT cuts the same pattern"),
        (json!({"kind": "band", "width": 6, "pattern": {"hex": {"depth": 0.3}}}), "STLOUT cuts the same pattern"),
        (json!({"kind": "band", "pattern": {"twist": true}}), "STLOUT unions them into one solid"),
        (json!({"kind": "band", "width": 4, "pave": {"layout": "channel", "melee": 1.5}}), "cuts the channel between the lips"),
        (json!({"kind": "solitaire", "shank": {"split": 2}, "width": 3, "prongStyle": "claw"}), "a seat cut for every stone"),
        (json!({"kind": "pendant", "halo": 1.3}), "STLOUT unions them and cuts every seat"),
        (json!({"kind": "stud"}), "STLOUT unions them and cuts every seat"),
    ] {
        let mut s = mm_drawing();
        let r = s.execute("piecemesh", &v).unwrap_or_else(|e| panic!("{v}: {e}"));
        let notes: Vec<&str> = r["notes"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert!(notes.iter().any(|n| n.contains(says)), "{v}: no note says `{says}`: {notes:?}");
        if v["kind"] == json!("pendant") || v["kind"] == json!("stud") {
            assert!(!notes.iter().any(|n| n.contains("draws the band")), "{v}: a worn piece has no band: {notes:?}");
        }
        if v["pave"]["layout"] == json!("channel") {
            assert!(!notes.iter().any(|n| n.contains("beads")), "{v}: a channel has no beads: {notes:?}");
        }
    }
}
