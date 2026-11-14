//! Channel setting: the rails, the lips, the checks, the solid and the weight.

use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::channel::{CHANNEL_LIP, CHANNEL_WALL, MIN_CHANNEL_LIP, MIN_CHANNEL_WALL};
use super::mesh::{Quality, piece_mesh};
use super::pave_band;
use super::piece_params::PieceParams;
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("piece", &v).unwrap()
}

fn check<'a>(reply: &'a Value, id: &str) -> &'a Value {
    reply["piece"]["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no {id} check in {reply}"))
}

fn channel_band() -> Value {
    json!({"kind": "band", "width": 3.5, "wall": 2.0, "pave": {"layout": "channel", "melee": 2.0, "gap": 0.1, "span": "top-half"}})
}

#[test]
fn a_channel_is_one_row_with_rails_either_side() {
    let p = params(channel_band());
    assert!(p.channeled());
    let fit = pave_band::fit(&p).unwrap();
    assert_eq!(fit.rows.len(), 1);
    let pieces = p.channel_pieces();
    assert_eq!(pieces.len(), fit.stones.len());
    for (c, s) in pieces.iter().zip(&fit.stones) {
        let r = s.diameter / 2.0;
        assert!((c.inner - (r - CHANNEL_LIP)).abs() < 1e-12 && (c.outer - (r + CHANNEL_WALL)).abs() < 1e-12);
        assert!(c.from < s.angle && s.angle < c.to);
        // The rails stand over the table and reach into the band.
        assert!(c.top > s.table.xy().len() && c.bottom < p.inner() / 2.0 + p.section().height_at(0.0));
        // The lip covers the girdle: the rail's inner face is inside the girdle, over its top.
        assert!(c.inner < r && c.girdle_top < c.top);
    }
    // Neighbours share a boundary half way between them: the rails run unbroken.
    let mut sorted = pieces.clone();
    sorted.sort_by(|a, b| a.from.total_cmp(&b.from));
    let joined = sorted.windows(2).filter(|w| (w[0].to - w[1].from).abs() < 1e-9).count();
    assert!(joined + 2 >= sorted.len(), "{joined} of {} pieces join", sorted.len());
}

#[test]
fn stones_never_overlap_in_a_channel_and_the_gap_holds() {
    for gap in [0.05, 0.1, 0.2] {
        let mut v = channel_band();
        v["pave"]["gap"] = json!(gap);
        let fit = pave_band::fit(&params(v)).unwrap();
        let least = pave_band::least_metal(&fit.stones).unwrap();
        assert!(least + 1e-9 >= gap, "{least} < {gap}");
    }
}

#[test]
fn checks_pass_by_default_and_fail_when_asked_for() {
    let mut s = Session::new();
    let r = s.execute("piece", &channel_band()).unwrap();
    assert_eq!(check(&r, "channel-lip")["ok"], true, "{}", check(&r, "channel-lip"));
    assert_eq!(check(&r, "channel-wall")["ok"], true, "{}", check(&r, "channel-wall"));
    assert!(r["piece"]["metal"]["channelGrams"].as_f64().unwrap() > 0.0);
    let r = s.execute("piece", &json!({"channelLip": 0.1})).unwrap();
    assert_eq!(check(&r, "channel-lip")["ok"], false);
    assert!(check(&r, "channel-lip")["message"].as_str().unwrap().contains(&MIN_CHANNEL_LIP.to_string()));
    let r = s.execute("piece", &json!({"channelLip": 0.6})).unwrap();
    assert_eq!(check(&r, "channel-lip")["ok"], false, "reaches the table");
    let r = s.execute("piece", &json!({"channelLip": null, "channelWall": 0.3})).unwrap();
    assert_eq!(check(&r, "channel-wall")["ok"], false);
    assert!(check(&r, "channel-wall")["message"].as_str().unwrap().contains(&MIN_CHANNEL_WALL.to_string()));
    let r = s.execute("piece", &json!({"channelWall": null, "width": 2.5})).unwrap();
    assert_eq!(check(&r, "channel-wall")["ok"], false, "rails past the band's edge");
    assert!(check(&r, "channel-wall")["message"].as_str().unwrap().contains("give it at least"));
    // No channel, no channel checks.
    let r = s.execute("piece", &json!({"pave": {"layout": "row"}, "width": 3.5})).unwrap();
    assert!(r["piece"]["checks"].as_array().unwrap().iter().all(|c| c["id"] != "channel-lip"));
    for bad in [json!({"channelWall": 5}), json!({"channelLip": -1}), json!({"channelLip": "x"})] {
        let e = s.execute("piece", &bad).unwrap_err().to_string();
        assert!(e.contains("channel"), "{e}");
    }
}

#[test]
fn the_mesh_draws_the_rails_and_the_solid_cuts_the_channel() {
    let p = params(channel_band());
    let mesh = piece_mesh(&p, Quality::Draft);
    let rails = mesh.meshes.iter().find(|m| m.name == "channel").unwrap();
    assert!(rails.volume() > 0.0);
    let n = p.channel_pieces().len();
    let adds = mesh.csg.add.iter().filter(|q| matches!(q, super::solid::Prim::Channel(c) if !c.opening)).count();
    let cuts = mesh.csg.cut.iter().filter(|q| matches!(q, super::solid::Prim::Channel(c) if c.opening)).count();
    assert_eq!((adds, cuts), (n, n));
    assert!(mesh.meshes.iter().all(|m| m.name != "beads"), "a channel has no beads");
    // The rails' display volume is the weight's volume.
    let grams = p.channel_grams();
    assert!((rails.volume() / 1000.0 * p.density - grams).abs() / grams < 0.05, "{} vs {grams}", rails.volume() / 1000.0 * p.density);
    // The cast solid: the rails add metal over the plain band with the same stones in a row.
    let mut s = Session::new();
    let channel = s.execute("stlout", &json!({"kind": "band", "width": 3.5, "wall": 2.0, "quality": "draft", "pave": {"layout": "channel", "melee": 2.0, "gap": 0.1, "span": "top-half"}})).unwrap();
    let row = s.execute("stlout", &json!({"kind": "band", "width": 3.5, "wall": 2.0, "quality": "draft", "pave": {"layout": "row", "melee": 2.0, "gap": 0.1, "span": "top-half"}})).unwrap();
    let (vc, vr) = (channel["metal"]["volumeMm3"].as_f64().unwrap(), row["metal"]["volumeMm3"].as_f64().unwrap());
    assert!(vc > vr, "rails {vc} vs a pavé row {vr}");
}

#[test]
fn the_lip_is_metal_over_the_girdle_in_the_solid() {
    // Over a stone's girdle, between the rail's inner face and the girdle, there is metal (the
    // lip); over its table, none (the channel).
    let p = params(channel_band());
    let mesh = piece_mesh(&p, Quality::Draft);
    let fit = pave_band::fit(&p).unwrap();
    let s = fit.stones[fit.stones.len() / 2];
    let c = p.channel_pieces()[fit.stones.len() / 2];
    let r = s.diameter / 2.0;
    let rho = c.girdle_top + 0.05;
    let at = |z: f64| cadcraft_geom::Vec3::new(s.angle.sin() * rho, s.angle.cos() * rho, s.table.z + z);
    let solid = |q: cadcraft_geom::Vec3| {
        let add = mesh.csg.add.iter().map(|x| x.eval(q)).fold(f64::INFINITY, f64::min);
        let cut = mesh.csg.cut.iter().map(|x| x.eval(q)).fold(f64::INFINITY, f64::min);
        add.max(-cut)
    };
    assert!(solid(at(r - 0.5 * CHANNEL_LIP + 0.25)) < 0.0, "the rail beyond the girdle is metal");
    assert!(solid(at(0.0)) > 0.0, "over the table the channel is open");
}

#[test]
fn a_channel_survives_proposals_and_a_dxf_round_trip() {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s.execute("piece", &json!({"kind": "band", "width": 3.5, "wall": 2.0})).unwrap();
    let change = json!({"pave": {"layout": "channel", "melee": 2.0, "gap": 0.1, "span": "top-half"}, "channelWall": 0.7});
    let r = s.execute("propose", &json!({"steps": [{"command": "piece", "params": change}], "title": "Channel"})).unwrap();
    s.execute("accept", &json!({"id": r["proposals"][0]["id"].as_u64().unwrap()})).unwrap();
    let mut direct = Session::new();
    direct.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    direct.execute("piece", &json!({"kind": "band", "width": 3.5, "wall": 2.0})).unwrap();
    let p = direct.execute("piece", &change).unwrap()["piece"].clone();
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are the same drawing");
    let dxf = cadcraft_io::write_dxf(direct.doc().unwrap());
    let mut t = Session::new();
    t.open_drawing(cadcraft_io::read_dxf(dxf.as_bytes()).unwrap(), "reopened", None);
    let q = t.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    for key in ["params", "metal", "stones", "checks"] {
        assert_eq!(q[key], p[key], "{key}");
    }
    assert!(t.execute("techsheet", &json!({})).unwrap()["bands"][0]["channelGrams"].as_f64().unwrap() > 0.0);
}

/// Rule: any channel the parser takes lays stones that never overlap (the gap holds), builds
/// rails whose lips sit inside every girdle, and is built or refused cleanly.
#[hegel::test(test_cases = 40)]
fn any_channel_keeps_its_stones_apart_and_its_lips_on_them(tc: TestCase) {
    let kinds = ["band", "solitaire", "threestone"];
    let kind = kinds[tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    let melee = tc.draw(gs::floats::<f64>().min_value(0.8).max_value(3.0));
    let gap = tc.draw(gs::floats::<f64>().min_value(0.0).max_value(0.5));
    let span = ["shoulders", "top-half", "full"][tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    let mut build = json!({"kind": kind, "width": tc.draw(gs::floats::<f64>().min_value(1.5).max_value(6.0)), "pave": {"layout": "channel", "melee": melee, "gap": gap, "span": span}});
    if tc.draw(gs::booleans()) {
        build["channelLip"] = json!(tc.draw(gs::floats::<f64>().min_value(0.0).max_value(1.0)));
    }
    if tc.draw(gs::booleans()) {
        build["channelWall"] = json!(tc.draw(gs::floats::<f64>().min_value(0.1).max_value(2.0)));
    }
    tc.note(&format!("{build}"));
    let p = params(build.clone());
    if let Some(fit) = pave_band::fit(&p)
        && fit.stones.len() > 1
    {
        assert!(pave_band::least_metal(&fit.stones).unwrap() + 1e-6 >= gap, "{build}");
    }
    for c in p.channel_pieces() {
        assert!(c.inner <= c.outer && c.to > c.from && c.top > c.bottom, "{build}: {c:?}");
    }
    let _ = piece_mesh(&p, Quality::Draft);
    assert!(p.channel_grams().is_finite());
    let mut s = Session::new();
    if let Err(e) = s.execute("piece", &build) {
        assert!(!matches!(e, crate::EngineError::Internal(..)), "{build} panicked: {e}");
    }
}
