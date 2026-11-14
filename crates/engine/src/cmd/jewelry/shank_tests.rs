//! Shank shapes: a drawn rail, a split shank, cathedral shoulders and a twisted cable — their
//! weights against analytic and numeric references, the sheet against the mesh against the cast
//! solid, the refusals, DXF, proposals, and Hegel properties.

use cadcraft_doc::{EntityKind, LwPolyline};
use cadcraft_geom::{PI, PolyVertex, TAU, Vec2, Vec3};
use hegel::TestCase;
use hegel::generators::{self as gs};
use serde_json::{Value, json};

use super::mesh::{Quality, SOLID_AGREEMENT_PER_MM, piece_mesh, signed_volume};
use super::mesh_tests::check as check_mesh;
use super::piece_params::PieceParams;
use super::piece_tests::{check, mm_drawing, piece, query, state};
use super::shank;
use crate::{EngineError, Session};

fn lw(s: &mut Session, pts: &[(f64, f64)], closed: bool) -> String {
    let vertices = pts.iter().map(|(x, y)| PolyVertex::new(Vec2::new(*x, *y))).collect();
    s.add_entity(EntityKind::LwPolyline(LwPolyline { vertices, closed, const_width: 0.0, elevation: 0.0, plinegen: false })).unwrap().hex()
}

/// An oval `a` × `b` (half-axes), `n` points, drawn anywhere.
fn oval(s: &mut Session, at: (f64, f64), a: f64, b: f64, n: usize) -> String {
    let pts: Vec<(f64, f64)> = (0..n).map(|i| TAU * i as f64 / n as f64).map(|t| (at.0 + a * t.cos(), at.1 + b * t.sin())).collect();
    lw(s, &pts, true)
}

fn params_of(p: &Value) -> PieceParams {
    PieceParams::parse("test", &p["params"]).unwrap()
}

fn grams(p: &Value) -> f64 {
    p["metal"]["grams"].as_f64().unwrap()
}

fn band_mesh_volume(p: &PieceParams) -> f64 {
    let mesh = piece_mesh(p, Quality::Fine);
    mesh.meshes.iter().filter(|m| m.name == "band").map(|m| signed_volume(&m.positions, &m.indices)).sum()
}

fn solid_volume(p: &PieceParams, step: f64) -> (f64, usize) {
    let mesh = piece_mesh(p, Quality::Draft);
    let (solid, _) = super::solid::solidify(&mesh.csg, step, 600_000).unwrap();
    (solid.volume(), solid.bodies)
}

fn refused(s: &mut Session, p: Value, says: &str) {
    let before = state(s);
    match s.execute("piece", &p) {
        Err(EngineError::Internal(..)) => panic!("{p}: a panic was caught"),
        Err(e) => assert!(e.to_string().contains(says), "{p}: {e} (wanted `{says}`)"),
        Ok(v) => panic!("{p}: accepted: {v}"),
    }
    assert_eq!(state(s), before, "{p}: a refusal changes nothing");
}

// ---------------------------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------------------------

#[test]
fn an_oval_rail_band_weighs_a_round_band_of_the_same_circumference() {
    for profile in ["flat", "dome", "comfort", "knife"] {
        let mut s = mm_drawing();
        let h = oval(&mut s, (40.0, 10.0), 12.0, 9.0, 96);
        let p = piece(&mut s, json!({"kind": "band", "rail": {"curve": h}, "profile": profile, "size": 7, "width": 3, "wall": 1.6}));
        assert_eq!(p["params"]["rail"]["curve"], json!(h));
        let mut t = mm_drawing();
        let round = piece(&mut t, json!({"kind": "band", "profile": profile, "size": 7, "width": 3, "wall": 1.6}));
        let (g, r) = (grams(&p), grams(&round));
        assert!((g - r).abs() / r < 1e-9, "{profile}: rail {g} g vs round {r} g");
        // The rail's length is the finger's circumference.
        let params = params_of(&p);
        let rail = params.shape.rail.as_ref().unwrap();
        let l = super::sweep::perimeter(&rail.scaled(params.inner()));
        assert!((l - PI * params.inner()).abs() < 1e-9);
        assert!(check(&p, "rail")["ok"].as_bool().unwrap(), "{p}");
        // The mesh and the cast solid weigh the same band.
        let mesh = piece_mesh(&params, Quality::Fine);
        check_mesh(&mesh, true, profile);
        let v = band_mesh_volume(&params);
        let want = params.band_volume();
        assert!((v - want).abs() / want < 0.01, "{profile}: mesh {v} vs {want}");
        let (sv, bodies) = solid_volume(&params, 0.1);
        assert_eq!(bodies, 1);
        assert!((sv - want).abs() / want < 2.0 * SOLID_AGREEMENT_PER_MM * 0.1, "{profile}: solid {sv} vs {want}");
    }
}

#[test]
fn the_front_view_follows_the_rail_and_the_piece_keeps_it_by_value() {
    let mut s = mm_drawing();
    let h = oval(&mut s, (0.0, 0.0), 10.0, 8.0, 64);
    let p = piece(&mut s, json!({"kind": "band", "rail": {"curve": h}}));
    // The RING block holds the rail and its outside, not circles.
    let d = s.doc().unwrap();
    let block = d.blocks.iter().find(|b| b.0.eq_ignore_ascii_case("RING-PIECE")).unwrap().1;
    let polys = block.entities.iter().filter(|e| matches!(e.kind, EntityKind::LwPolyline(_))).count();
    assert_eq!(polys, 2, "the front view is two polylines");
    // The stored points survive the curve's erasure, and a rebuild keeps them.
    let stored = p["params"]["rail"].clone();
    s.execute("erase", &json!({"handles": [h]})).unwrap();
    let again = piece(&mut s, json!({"metal": "platinum"}));
    assert_eq!(again["params"]["rail"], stored);
    // "Update from curve": a new curve under the same request reads again.
    let h2 = oval(&mut s, (0.0, 0.0), 10.0, 6.0, 64);
    let updated = piece(&mut s, json!({"rail": {"curve": h2}}));
    assert_ne!(updated["params"]["rail"]["points"], stored["points"]);
    // Taking it off is the round band.
    let off = piece(&mut s, json!({"rail": null}));
    assert!(off["params"]["rail"].is_null());
}

#[test]
fn a_rail_refuses_what_cannot_be_made() {
    let mut s = mm_drawing();
    let o = oval(&mut s, (0.0, 0.0), 10.0, 8.0, 64);
    refused(&mut s, json!({"kind": "solitaire", "rail": {"curve": o}}), "a rail shapes a plain band");
    refused(&mut s, json!({"kind": "band", "rail": {"curve": o}, "pave": true}), "pavé on a band that follows a rail");
    refused(&mut s, json!({"kind": "band", "rail": {"curve": o}, "pattern": {"twist": true}}), "does not take a rail");
    // A bean with a sharp notch folds the band.
    let bean = lw(&mut s, &[(-10.0, -8.0), (10.0, -8.0), (10.0, 8.0), (0.5, 8.0), (0.0, 2.0), (-0.5, 8.0), (-10.0, 8.0)], true);
    refused(&mut s, json!({"kind": "band", "rail": {"curve": bean}}), "bends inward");
    let thin = oval(&mut s, (0.0, 0.0), 30.0, 3.0, 64);
    refused(&mut s, json!({"kind": "band", "rail": {"curve": thin}}), "at its narrowest");
    let open = lw(&mut s, &[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)], false);
    refused(&mut s, json!({"kind": "band", "rail": {"curve": open}}), "open");
    refused(&mut s, json!({"kind": "band", "rail": {"curve": "FFFFF"}}), "no object");
    refused(&mut s, json!({"kind": "band", "rail": 3}), "`rail` is");
}

#[test]
fn a_drawn_profile_sweeps_along_a_rail() {
    let mut s = mm_drawing();
    let prof = lw(&mut s, &[(0.0, 0.0), (3.0, 0.0), (3.0, 1.2), (1.5, 2.0), (0.0, 1.2)], true);
    let rail = oval(&mut s, (50.0, 0.0), 11.0, 9.0, 80);
    let p = piece(&mut s, json!({"kind": "band", "profile": {"curve": prof}, "rail": {"curve": rail}}));
    let params = params_of(&p);
    let c = params.custom.as_ref().unwrap();
    let want = TAU * (params.inner() / 2.0 + c.centroid()) * c.area();
    assert!((params.band_volume() - want).abs() / want < 1e-9);
    check_mesh(&piece_mesh(&params, Quality::Draft), true, "custom on rail");
}

// ---------------------------------------------------------------------------------------------
// Split shank and cathedral
// ---------------------------------------------------------------------------------------------

#[test]
fn a_split_shank_weighs_the_band_it_was_cut_from() {
    for split in [2, 3] {
        let mut s = mm_drawing();
        let p = piece(&mut s, json!({"kind": "solitaire", "width": 2.4, "wall": 1.8, "profile": "dome", "shank": {"split": split, "gap": 1.5}}));
        let mut t = mm_drawing();
        let plain = piece(&mut t, json!({"kind": "solitaire", "width": 2.4, "wall": 1.8, "profile": "dome"}));
        assert!((grams(&p) - grams(&plain)).abs() < 1e-9, "split {split}");
        let c = check(&p, "split");
        assert_eq!(c["ok"].as_bool().unwrap(), split == 2, "{c}");
        let params = params_of(&p);
        let mesh = piece_mesh(&params, Quality::Fine);
        check_mesh(&mesh, true, "split");
        let v = band_mesh_volume(&params);
        let want = params.band_volume();
        assert!((v - want).abs() / want < 0.01, "split {split}: mesh {v} vs {want}");
        // The arms stand `gap` apart under the head.
        let sh = &params.shape;
        let apart = sh.shift(1, 0.0) - sh.shift(0, 0.0);
        assert!((apart - 1.5).abs() < 1e-12);
    }
}

#[test]
fn the_cast_solid_has_the_split_and_cathedral_band() {
    for shank in [json!({"split": 2}), json!({"cathedral": true}), json!({"split": 2, "cathedral": true, "height": 1.5})] {
        let p = PieceParams::parse("test", &json!({"kind": "solitaire", "width": 3.2, "shank": shank})).unwrap();
        let mesh = piece_mesh(&p, Quality::Draft);
        let band = super::solid::Csg { add: mesh.csg.add.iter().take(1).cloned().collect(), cut: Vec::new() };
        let (solid, _) = super::solid::solidify(&band, 0.1, 600_000).unwrap();
        let (v, want) = (solid.volume(), p.band_volume());
        assert!((v - want).abs() / want < 2.0 * SOLID_AGREEMENT_PER_MM * 0.1, "{shank}: solid {v} vs {want}");
        let (whole, _) = super::solid::solidify(&mesh.csg, 0.2, 600_000).unwrap();
        assert_eq!(whole.bodies, 1, "{shank}: one body with the head");
        // The bound is never steeper than one away from the axis.
        let b = mesh.csg.add.first().unwrap();
        let mut seed = 11u64;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 11) as f64 / (1u64 << 53) as f64
        };
        for _ in 0..4000 {
            let r = 6.0 + next() * 8.0;
            let (a, z) = (next() * TAU, next() * 6.0 - 3.0);
            let p1 = Vec3::new(r * a.cos(), r * a.sin(), z);
            let p2 = p1 + Vec3::new(next() - 0.5, next() - 0.5, next() - 0.5) * 0.6;
            assert!((b.eval(p1) - b.eval(p2)).abs() <= (p2 - p1).len() + 1e-9, "{shank}");
        }
    }
}

#[test]
fn cathedral_arches_lift_the_head_and_weigh_their_arch() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "solitaire", "shank": {"cathedral": true, "height": 2.5, "from": 40}}));
    let params = params_of(&p);
    let mut t = mm_drawing();
    let plain = params_of(&piece(&mut t, json!({"kind": "solitaire"})));
    assert!((params.crown() - plain.crown() - 2.5).abs() < 1e-12, "the head stands 2.5 mm higher");
    // The weight against a numeric integral of the lifted section over the turn.
    let section = params.section();
    let (a, c, ri) = (section.area(), section.centroid(), params.inner() / 2.0);
    let n = 100_000;
    let numeric: f64 =
        (0..n).map(|k| TAU * k as f64 / n as f64).map(|th| a * (ri + c + params.shape.lift() * params.shape.s(th))).sum::<f64>() * TAU / n as f64;
    assert!((params.band_volume() - numeric).abs() / numeric < 1e-6, "{} vs {numeric}", params.band_volume());
    assert!(grams(&p) > plain.band_grams());
    assert!(check(&p, "cathedral")["ok"].as_bool().unwrap());
    let v = band_mesh_volume(&params);
    assert!((v - params.band_volume()).abs() / params.band_volume() < 0.01, "mesh {v}");
    check_mesh(&piece_mesh(&params, Quality::Fine), true, "cathedral");
}

#[test]
fn split_and_cathedral_refuse_what_cannot_be_made() {
    let mut s = mm_drawing();
    refused(&mut s, json!({"kind": "band", "shank": {"split": 2}}), "for kind solitaire");
    refused(&mut s, json!({"kind": "eternity", "shank": {"cathedral": true}}), "for kind solitaire");
    refused(&mut s, json!({"kind": "solitaire", "width": 1.0, "shank": {"split": 3}}), "cannot part into 3 arms");
    refused(&mut s, json!({"kind": "solitaire", "pave": true, "shank": {"split": 2}}), "pavé on a split shank");
    refused(&mut s, json!({"kind": "solitaire", "shank": {"split": 4}}), "1 (none), 2 or 3");
    refused(&mut s, json!({"kind": "solitaire", "shank": {"gap": 9}}), "`gap` is");
    refused(&mut s, json!({"kind": "solitaire", "shank": {"splt": 2}}), "not `splt`");
    refused(&mut s, json!({"kind": "solitaire", "shank": {"cathedral": "yes"}}), "true or false");
}

#[test]
fn a_shank_change_merges_over_the_stored_one() {
    let mut s = mm_drawing();
    piece(&mut s, json!({"kind": "solitaire", "shank": {"split": 2, "gap": 2.0}}));
    let p = piece(&mut s, json!({"shank": {"cathedral": true}}));
    assert_eq!(p["params"]["shank"]["split"], json!(2));
    assert_eq!(p["params"]["shank"]["gap"], json!(2.0));
    assert_eq!(p["params"]["shank"]["cathedral"], json!(true));
    let plain = piece(&mut s, json!({"shank": null}));
    assert!(plain["params"]["shank"].is_null());
}

// ---------------------------------------------------------------------------------------------
// Cable
// ---------------------------------------------------------------------------------------------

#[test]
fn a_cable_weighs_its_strands_and_they_never_touch() {
    for (strands, wire, turns) in [(2, 1.0, None), (3, 1.0, None), (3, 1.4, Some(10)), (2, 0.8, Some(28))] {
        let mut s = mm_drawing();
        let p = piece(&mut s, json!({"kind": "band", "pattern": {"twist": {"strands": strands, "wire": wire, "turns": turns}}}));
        let params = params_of(&p);
        let c = shank::cable(&params).unwrap();
        // The width and wall are the bundle's.
        assert!((params.wall - c.bundle()).abs() < 1e-12 && (params.width - c.bundle()).abs() < 1e-12);
        // The strands rest on the finger.
        let lowest = (0..2000).map(|i| c.point(0, TAU * i as f64 / 2000.0)).map(|q| q.x.hypot(q.y) - wire / 2.0).fold(f64::INFINITY, f64::min);
        assert!((lowest - params.inner() / 2.0).abs() < 1e-3, "{lowest}");
        // Weight: strands × wire area × length, the length against a much finer measure.
        let fine: f64 = {
            let n = 400_000;
            (0..n).map(|i| (c.point(0, TAU * (i + 1) as f64 / n as f64) - c.point(0, TAU * i as f64 / n as f64)).len()).sum()
        };
        let want = f64::from(strands) * PI * (wire / 2.0).powi(2) * fine;
        assert!((params.band_volume() - want).abs() / want < 1e-5, "{strands}×{wire}: {} vs {want}", params.band_volume());
        // No two strands come closer than the wire, anywhere.
        let a: Vec<Vec3> = c.axis(0, 64);
        let b: Vec<Vec3> = c.axis(1, 64);
        let near = a.iter().step_by(3).map(|p| b.iter().map(|q| (*p - *q).len()).fold(f64::INFINITY, f64::min)).fold(f64::INFINITY, f64::min);
        assert!(near >= wire * 0.995, "{strands}×{wire}: strands {near} apart");
        assert_eq!(check(&p, "cable")["ok"].as_bool().unwrap(), wire >= 0.8);
        let mesh = piece_mesh(&params, Quality::Fine);
        check_mesh(&mesh, true, "cable");
        let v = band_mesh_volume(&params);
        assert!((v - want).abs() / want < 0.01, "{strands}×{wire}: mesh {v} vs {want}");
    }
}

#[test]
fn the_cast_solid_of_a_cable_is_one_body_of_its_weight() {
    let p = PieceParams::parse("test", &json!({"kind": "band", "pattern": {"twist": {"strands": 3, "wire": 1.2}}})).unwrap();
    let (v, bodies) = solid_volume(&p, 0.08);
    let want = p.band_volume();
    assert_eq!(bodies, 1);
    assert!((v - want).abs() / want < 0.03, "solid {v} vs {want}");
}

#[test]
fn a_cable_refuses_what_cannot_be_made() {
    let mut s = mm_drawing();
    refused(&mut s, json!({"kind": "solitaire", "pattern": {"twist": true}}), "a band of its own");
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": {"strands": 4}}}), "2 or 3");
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": {"turns": 2.5}}}), "whole number");
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": {"wire": 9}}}), "`wire` is");
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": true}, "width": 7}), "comes from its strands");
    refused(&mut s, json!({"kind": "band", "pattern": {"weave": {}}}), "or a cable's twist");
    refused(&mut s, json!({"kind": "band", "pattern": {"twist": {"strands": 3, "wire": 1.4, "turns": 30}}}), "too many for 3 strands");
}

// ---------------------------------------------------------------------------------------------
// DXF, proposals, properties
// ---------------------------------------------------------------------------------------------

#[test]
fn shank_shapes_survive_a_dxf_round_trip() {
    let mut s = mm_drawing();
    let o = oval(&mut s, (0.0, 0.0), 10.0, 8.0, 64);
    let cases = [
        json!({"kind": "band", "rail": {"curve": o}, "profile": "dome"}),
        json!({"kind": "solitaire", "shank": {"split": 3, "gap": 1.0, "cathedral": true}, "width": 3.6}),
        json!({"kind": "band", "pattern": {"twist": {"strands": 2, "wire": 1.1}}}),
    ];
    for case in cases {
        let built = piece(&mut s, case.clone());
        let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
        let mut t = Session::new();
        t.open_drawing(cadcraft_io::read_dxf(dxf.as_bytes()).unwrap(), "reopened", None);
        let read = query(&mut t);
        for part in ["params", "metal", "checks"] {
            assert_eq!(read[part], built[part], "{case}: {part}");
        }
        piece(&mut s, json!({"rail": null, "shank": null, "pattern": null, "kind": "band"}));
    }
}

#[test]
fn proposing_a_shank_and_accepting_it_is_running_it() {
    for step in
        [json!({"kind": "solitaire", "shank": {"split": 2, "cathedral": true}}), json!({"kind": "band", "pattern": {"twist": {"strands": 3}}})]
    {
        let mut a = mm_drawing();
        let mut b = mm_drawing();
        piece(&mut a, json!({"kind": "band", "size": 7}));
        piece(&mut b, json!({"kind": "band", "size": 7}));
        let r = a.execute("propose", &json!({"steps": [{"command": "piece", "params": step}]})).unwrap();
        let card = &r["proposals"][0];
        a.execute("accept", &json!({"id": card["id"]})).unwrap();
        b.execute("piece", &step).unwrap();
        let (qa, qb) = (query(&mut a), query(&mut b));
        for part in ["params", "metal", "checks"] {
            assert_eq!(qa[part], qb[part], "{step}: {part}");
        }
    }
    // And a rail drawn in the drawing.
    let make = || {
        let mut s = mm_drawing();
        piece(&mut s, json!({"kind": "band"}));
        let h = oval(&mut s, (0.0, 0.0), 10.0, 8.5, 48);
        (s, h)
    };
    let ((mut a, h), (mut b, _)) = (make(), make());
    let step = json!({"command": "piece", "params": {"rail": {"curve": h}}});
    let r = a.execute("propose", &json!({"steps": [step]})).unwrap();
    a.execute("accept", &json!({"id": r["proposals"][0]["id"]})).unwrap();
    b.execute("piece", &json!({"rail": {"curve": h}})).unwrap();
    assert_eq!(query(&mut a)["params"], query(&mut b)["params"]);
}

#[hegel::test(test_cases = 80)]
fn any_oval_rail_is_a_closed_band_of_the_round_weight_or_a_refusal(tc: TestCase) {
    let mut s = mm_drawing();
    let a = tc.draw(gs::floats::<f64>().min_value(0.5).max_value(40.0));
    let b = tc.draw(gs::floats::<f64>().min_value(0.5).max_value(40.0));
    let n = tc.draw(gs::integers::<usize>().min_value(3).max_value(200));
    let h = oval(&mut s, (0.0, 0.0), a, b, n);
    let size = tc.draw(gs::floats::<f64>().min_value(3.0).max_value(13.0));
    let before = state(&s);
    match s.execute("piece", &json!({"kind": "band", "rail": {"curve": h}, "size": size})) {
        Err(e @ EngineError::Internal(..)) => panic!("caught a panic: {e}"),
        Err(_) => assert_eq!(state(&s), before),
        Ok(r) => {
            let params = params_of(&r["piece"]);
            let round = PieceParams::parse("test", &json!({"kind": "band", "size": params.size.us})).unwrap();
            let (g, want) = (params.band_grams(), round.band_grams());
            assert!(g > 0.0 && (g - want).abs() / want < 1e-9, "{g} vs {want}");
            check_mesh(&piece_mesh(&params, Quality::Draft), true, "oval");
        }
    }
}

#[hegel::test(test_cases = 200)]
fn hostile_shank_params_never_panic(tc: TestCase) {
    let num = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u8>().max_value(5)) {
            0 => json!(tc.draw(gs::floats::<f64>().min_value(-1e9).max_value(1e9))),
            1 => json!(tc.draw(gs::integers::<i64>().min_value(-5).max_value(500))),
            2 => Value::Null,
            3 => json!(true),
            4 => json!("x"),
            _ => json!(tc.draw(gs::floats::<f64>().min_value(0.0).max_value(10.0))),
        }
    };
    let kind = ["band", "solitaire", "eternity", "dome"][tc.draw(gs::integers::<usize>().max_value(3))];
    let shank = json!({"split": num(&tc), "gap": num(&tc), "from": num(&tc), "cathedral": num(&tc), "height": num(&tc)});
    let pattern = json!({"twist": {"strands": num(&tc), "turns": num(&tc), "wire": num(&tc)}});
    let n = tc.draw(gs::integers::<usize>().max_value(30));
    let pts: Vec<Value> = (0..n).map(|_| json!([num(&tc), num(&tc)])).collect();
    let mut s = mm_drawing();
    for p in [
        json!({"kind": kind, "shank": shank}),
        json!({"kind": kind, "pattern": pattern}),
        json!({"kind": kind, "rail": {"points": pts}}),
        json!({"kind": kind, "rail": {"curve": num(&tc)}}),
    ] {
        let r = s.execute("piece", &p);
        assert!(!matches!(r, Err(EngineError::Internal(..))), "{p}: {r:?}");
        if let Ok(v) = &r {
            let params = params_of(&v["piece"]);
            assert!(params.band_grams() > 0.0);
            let _ = shank::volume(&params);
        }
    }
}

#[hegel::test(test_cases = 40)]
fn any_split_cathedral_or_cable_is_watertight_and_weighs_positive(tc: TestCase) {
    let split = tc.draw(gs::integers::<u32>().min_value(1).max_value(3));
    let gap = tc.draw(gs::floats::<f64>().min_value(0.3).max_value(5.0));
    let from = tc.draw(gs::floats::<f64>().min_value(20.0).max_value(90.0));
    let cathedral = tc.draw(gs::booleans());
    let height = tc.draw(gs::floats::<f64>().min_value(0.3).max_value(6.0));
    let width = tc.draw(gs::floats::<f64>().min_value(1.5).max_value(6.0));
    let profile = ["flat", "dome", "comfort", "court", "knife", "bevel", "concave"][tc.draw(gs::integers::<usize>().max_value(6))];
    let p = json!({"kind": "solitaire", "width": width, "profile": profile, "shank": {"split": split, "gap": gap, "from": from, "cathedral": cathedral, "height": height}});
    if let Ok(params) = PieceParams::parse("test", &p) {
        assert!(params.band_grams() > 0.0);
        check_mesh(&piece_mesh(&params, Quality::Draft), true, &p.to_string());
        let v = band_mesh_volume(&params);
        assert!((v - params.band_volume()).abs() / params.band_volume() < 0.02, "{p}: mesh {v} vs {}", params.band_volume());
    }
    let strands = tc.draw(gs::integers::<u32>().min_value(2).max_value(3));
    let wire = tc.draw(gs::floats::<f64>().min_value(0.5).max_value(2.5));
    let size = tc.draw(gs::floats::<f64>().min_value(3.0).max_value(13.0));
    let c = json!({"kind": "band", "size": size, "pattern": {"twist": {"strands": strands, "wire": wire}}});
    if let Ok(params) = PieceParams::parse("test", &c) {
        assert!(params.band_grams() > 0.0);
        check_mesh(&piece_mesh(&params, Quality::Draft), true, &c.to_string());
    }
}

#[test]
fn the_blend_is_one_at_the_top_and_nothing_past_from() {
    let from = 50f64.to_radians();
    assert!((shank::blend(0.0, from) - 1.0).abs() < 1e-12);
    assert!(shank::blend(from, from).abs() < 1e-12);
    assert_eq!(shank::blend(PI, from), 0.0);
    assert!((shank::blend(TAU - 0.1, from) - shank::blend(0.1, from)).abs() < 1e-12);
    // Its integral over the arch is half the span.
    let n = 100_000;
    let i: f64 = (0..n).map(|k| -PI + TAU * k as f64 / n as f64).map(|t| shank::blend(t, from)).sum::<f64>() * TAU / n as f64;
    assert!((i - from).abs() < 1e-6, "{i} vs {from}");
}
