//! A drawing flowed onto the band: reading the objects, laying them on the developed band,
//! rigid and stretched fits, cut and raised in the cast solid, the conflict rules, refusals,
//! hostile parameters and properties.

use cadcraft_geom::Vec2;
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::engrave::lettering;
use super::flow::{FlowSpec, fill};
use super::mesh::{Quality, piece_mesh};
use super::piece_params::PieceParams;
use super::solid::{solidify, verify};
use crate::Session;

fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn check_of<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no check {id} in {}", piece["checks"]))
}

/// A zigzag and a circle on the layer `Motif`.
fn motif(s: &mut Session) -> Vec<String> {
    s.execute("layer", &json!({"op": "make", "name": "Motif"})).or_else(|_| s.execute("layer", &json!({"make": "Motif"}))).ok();
    s.execute("setvar", &json!({"name": "CLAYER", "value": "Motif"})).ok();
    let a = s.execute("pline", &json!({"points": [[0, 0], [2, 3], [4, 0], [6, 3], [8, 0]]})).unwrap();
    let b = s.execute("circle", &json!({"center": [12, 1.5], "radius": 1.5})).unwrap();
    s.execute("setvar", &json!({"name": "CLAYER", "value": "0"})).ok();
    [a, b].iter().filter_map(|r| r["handle"].as_str().map(str::to_string)).collect()
}

fn strokes_json() -> Value {
    json!([[[0, 0], [2, 3], [4, 0], [6, 3], [8, 0]], [[10, 0], [14, 0], [14, 3], [10, 3], [10, 0]]])
}

#[test]
fn the_selection_flows_onto_a_band_and_cuts_metal() {
    let mut s = mm_drawing();
    let handles = motif(&mut s);
    assert_eq!(handles.len(), 2);
    let plain = s.execute("piece", &json!({"kind": "band", "width": 5, "wall": 1.8})).unwrap()["piece"]["metal"]["grams"].as_f64().unwrap();
    let r = s.execute("flow", &json!({"handles": handles})).unwrap();
    let piece = &r["piece"];
    let flow = &piece["params"]["flow"];
    assert_eq!(flow["source"], "2 objects");
    assert!(flow["strokes"].as_array().unwrap().len() >= 2);
    assert_eq!(check_of(piece, "flow-fit")["ok"], true, "{}", piece["checks"]);
    assert_eq!(check_of(piece, "flow-depth")["ok"], true);
    assert!(piece["metal"]["grams"].as_f64().unwrap() < plain);
    // The motif stays when its objects go.
    for h in &handles {
        s.execute("erase", &json!({"handles": [h]})).unwrap();
    }
    let again = s.execute("piece", &json!({"flow": {"depth": 0.2}})).unwrap();
    assert_eq!(again["piece"]["params"]["flow"]["depth"], 0.2);
    assert_eq!(again["piece"]["params"]["flow"]["strokes"], flow["strokes"]);
    // And comes off.
    let off = s.execute("flow", &json!({"remove": true})).unwrap();
    assert_eq!(off["piece"]["params"]["flow"], false);
}

#[test]
fn a_layer_flows_raised_and_adds_metal() {
    let mut s = mm_drawing();
    motif(&mut s);
    let plain = s.execute("piece", &json!({"kind": "band", "width": 5})).unwrap()["piece"]["metal"]["grams"].as_f64().unwrap();
    let r = s.execute("piece", &json!({"flow": {"layer": "Motif", "style": "raised"}})).unwrap();
    assert_eq!(r["piece"]["params"]["flow"]["source"], "layer Motif");
    assert!(r["piece"]["metal"]["grams"].as_f64().unwrap() > plain);
}

#[test]
fn stretch_runs_the_motif_round_the_band() {
    let p = |fit: &str| PieceParams::parse("test", &json!({"kind": "band", "width": 5, "flow": {"strokes": strokes_json(), "fit": fit}})).unwrap();
    let (rigid, stretch) = (p("rigid"), p("stretch"));
    let len = |pp: &PieceParams| lettering(pp).unwrap().unwrap().marks[0].length;
    let round = cadcraft_geom::TAU * stretch.crown();
    assert!(len(&rigid) < 0.6 * round);
    assert!((len(&stretch) - round).abs() < 0.5, "{} {round}", len(&stretch));
    // Rigid at a scale that runs round into itself is refused.
    let r = mm_drawing().execute("piece", &json!({"kind": "band", "width": 5, "flow": {"strokes": strokes_json(), "scale": 20}}));
    assert!(r.unwrap_err().to_string().contains("stretch"));
}

#[test]
fn the_conflict_rules_hold() {
    let flow = json!({"strokes": strokes_json()});
    let refused = |v: Value| mm_drawing().execute("piece", &v).unwrap_err().to_string();
    assert!(refused(json!({"kind": "eternity", "flow": flow})).contains("inside"));
    assert!(refused(json!({"kind": "band", "engrave": {"text": "A", "at": "outside"}, "flow": flow})).contains("engraving"));
    assert!(refused(json!({"kind": "band", "pattern": {"hex": {}}, "flow": {"strokes": strokes_json(), "at": "inside"}})).len() > 5);
    assert!(refused(json!({"kind": "band", "pattern": {"twist": {}}, "flow": flow})).contains("cable"));
    assert!(refused(json!({"kind": "band", "flow": {"strokes": strokes_json(), "at": "inside", "style": "raised"}})).contains("finger"));
    // Inside an eternity band, with a hallmark past it, is fine.
    let ok = mm_drawing().execute(
        "piece",
        &json!({"kind": "eternity", "width": 3, "flow": {"strokes": strokes_json(), "at": "inside", "scale": 0.15}, "hallmark": true}),
    );
    assert!(ok.is_ok(), "{ok:?}");
}

#[test]
fn a_hatch_is_cleared_by_fill_strokes() {
    let square = vec![vec![Vec2::new(0.0, 0.0), Vec2::new(2.0, 0.0), Vec2::new(2.0, 2.0), Vec2::new(0.0, 2.0), Vec2::new(0.0, 0.0)]];
    let lines = fill(&square, 0.25);
    assert_eq!(lines.len(), 8);
    for l in &lines {
        assert!((l[0].x - 0.0).abs() < 1e-9 && (l[1].x - 2.0).abs() < 1e-9);
    }
    assert!(fill(&square, f64::NAN).is_empty());
    let mut s = mm_drawing();
    s.execute("rectang", &json!({"p1": [0, 0], "p2": [6, 2]})).unwrap();
    let h = s.execute("hatch", &json!({"points": [[3, 1]], "pattern": "SOLID"}));
    s.execute("piece", &json!({"kind": "band", "width": 5})).unwrap();
    let h = h.unwrap();
    let hatch = s
        .doc()
        .unwrap()
        .model
        .iter()
        .find(|e| matches!(e.kind, cadcraft_doc::EntityKind::Hatch(_)))
        .map(|e| e.handle.hex())
        .unwrap_or_else(|| panic!("no hatch: {h}"));
    {
        let r = s.execute("flow", &json!({"handles": [hatch]})).unwrap();
        // The loop and its fill.
        let pp = PieceParams::parse("test", &r["piece"]["params"]).unwrap();
        assert!(lettering(&pp).unwrap().unwrap().marks[0].features[0].strokes.len() > 4);
        assert!(r["piece"]["params"]["flow"]["strokes"].as_array().unwrap().len() >= 3, "{}", r["piece"]["params"]["flow"]);
    }
}

#[test]
fn the_cast_solid_stays_watertight() {
    for style in ["cut", "raised"] {
        let p = PieceParams::parse("test", &json!({"kind": "band", "width": 4, "flow": {"strokes": strokes_json(), "style": style}})).unwrap();
        let mesh = piece_mesh(&p, Quality::Draft);
        let solid = solidify(&mesh.csg, 0.2, 1_000_000).unwrap().0;
        verify(&solid.positions, &solid.indices).unwrap();
        assert!(solid.volume() > 0.0);
    }
}

#[test]
fn hostile_flow_params_never_panic() {
    let bad = [
        json!(true),
        json!("x"),
        json!({"strokes": "x"}),
        json!({"strokes": [[["a", 1]]]}),
        json!({"strokes": [[[1e300, 0]]]}),
        json!({"strokes": [[[f64::MAX, 0]]]}),
        json!({"strokes": []}),
        json!({"strokes": [[]]}),
        json!({"strokes": strokes_json(), "scale": -1}),
        json!({"strokes": strokes_json(), "depth": 99}),
        json!({"strokes": strokes_json(), "fit": "wobble"}),
        json!({"strokes": strokes_json(), "nope": 1}),
        json!({"layer": 3}),
        json!({"handles": ["ZZZZ"]}),
        json!({"handles": ["FFFFFF"]}),
        json!({"strokes": vec![vec![json!([0, 0])]; 2_001]}),
        json!({"strokes": [vec![json!([0, 0]); 2_001]]}),
        json!({"strokes": [[[0, 0], [0, 0]]]}),
    ];
    for f in bad {
        let mut s = mm_drawing();
        let r = s.execute("piece", &json!({"kind": "band", "flow": f}));
        assert!(r.is_err(), "{f}");
        assert!(!matches!(r, Err(crate::EngineError::Internal(..))), "{f}");
    }
    // FLOW with no piece and nothing selected is refused.
    assert!(mm_drawing().execute("flow", &json!({})).is_err());
    assert!(mm_drawing().execute("flow", &json!(5)).is_err());
}

#[test]
fn the_json_reads_back() {
    let p = PieceParams::parse("test", &json!({"kind": "band", "flow": {"strokes": strokes_json(), "turn": 30, "across": 0.2, "fit": "stretch"}}))
        .unwrap();
    let again = PieceParams::parse("test", &p.json()).unwrap();
    assert_eq!(p, again);
    let f: &FlowSpec = p.flow.as_ref().unwrap();
    assert_eq!(f.turn, 30.0);
}

/// Rule: any flowed polyline is drawn or refused cleanly, and a cut takes metal away.
#[hegel::test(test_cases = 50)]
fn any_flowed_motif_is_drawn_or_refused(tc: TestCase) {
    let n = tc.draw(gs::integers::<usize>().min_value(1).max_value(12));
    let pts: Vec<Value> = (0..n)
        .map(|_| {
            json!([tc.draw(gs::floats::<f64>().min_value(-50.0).max_value(50.0)), tc.draw(gs::floats::<f64>().min_value(-50.0).max_value(50.0))])
        })
        .collect();
    let raised = tc.draw(gs::booleans());
    let stretch = tc.draw(gs::booleans());
    let build = json!({"kind": "band", "width": 4, "flow": {"strokes": [pts], "style": if raised { "raised" } else { "cut" }, "fit": if stretch { "stretch" } else { "rigid" }}});
    tc.note(&build.to_string());
    match mm_drawing().execute("piece", &build) {
        Ok(r) => {
            let mut bare = build.clone();
            bare["flow"] = json!(false);
            let plain = mm_drawing().execute("piece", &bare).unwrap()["piece"]["metal"]["grams"].as_f64().unwrap();
            let g = r["piece"]["metal"]["grams"].as_f64().unwrap();
            if raised { assert!(g >= plain - 1e-9) } else { assert!(g <= plain + 1e-9) }
        }
        Err(e) => assert!(!matches!(e, crate::EngineError::Internal(..)), "{build}: {e}"),
    }
}
