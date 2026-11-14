//! Basket heads (`head: basket`): the rails and under-gallery read and written back, refused when
//! wrong, drawn on the sheet, built in the solid on a ring, a pendant and a pair of studs, and
//! weighed within 10 % of the cast solid off the finger (the cross test in `cross_tests.rs`).

use hegel::TestCase;
use hegel::generators::{self as gs};
use serde_json::{Value, json};

use super::basket::Gallery;
use super::heads::HeadStyle;
use super::mesh::{Quality, piece_mesh};
use super::piece_params::PieceParams;
use super::piece_tests::{mm_drawing, on_layer_count, piece, query};
use super::solid::{Prim, solidify, verify};
use crate::EngineError;

fn params(v: &Value) -> PieceParams {
    PieceParams::parse("test", v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

/// The closed wires of a solid's construction: a prong head's gallery rails and a worn head's
/// base ring.
fn closed_wires(p: &PieceParams) -> usize {
    piece_mesh(p, Quality::Draft).csg.add.iter().filter(|q| matches!(q, Prim::Wire { closed: true, .. })).count()
}

fn open_wires(p: &PieceParams) -> usize {
    piece_mesh(p, Quality::Draft).csg.add.iter().filter(|q| matches!(q, Prim::Wire { closed: false, .. })).count()
}

#[test]
fn a_basket_reads_and_writes_its_rails_and_gallery() {
    let p = params(&json!({"kind": "solitaire", "head": "basket", "basketRails": 1, "gallery": "arches"}));
    assert_eq!(p.head, HeadStyle::Basket);
    assert_eq!(p.prong.rails, Some(1));
    assert_eq!(p.prong.gallery, Gallery::Arches);
    let j = p.json();
    assert_eq!(j["head"], "basket");
    assert_eq!(j["basketRails"], json!(1));
    assert_eq!(j["gallery"], "arches");
    assert_eq!(params(&j), p);
    // The usual: two rails, plain.
    let p = params(&json!({"kind": "pendant", "head": "basket"}));
    assert_eq!(p.basket(), Some((None, Gallery::Plain)));
    assert!(p.pronged() || p.kind.worn(), "a basket is a prong head");
}

#[test]
fn bad_basket_parameters_are_refused_in_a_sentence() {
    let mut s = mm_drawing();
    for (v, says) in [
        (json!({"kind": "solitaire", "head": "basket", "basketRails": 3}), "basketRails"),
        (json!({"kind": "solitaire", "head": "basket", "basketRails": "two"}), "basketRails"),
        (json!({"kind": "solitaire", "head": "basket", "gallery": "hearts"}), "gallery"),
        (json!({"kind": "solitaire", "head": "cage"}), "prong, bezel or basket"),
    ] {
        match s.execute("piece", &v) {
            Err(EngineError::Internal(..)) => panic!("{v}: a panic was caught"),
            Err(e) => assert!(e.to_string().contains(says), "{v}: {e}"),
            Ok(r) => panic!("{v}: accepted {r}"),
        }
    }
}

#[test]
fn a_basket_has_its_rails_and_under_gallery_in_the_solid_on_rings_pendants_and_studs() {
    for kind in ["solitaire", "pendant", "stud"] {
        let plain = params(&json!({"kind": kind, "prongs": 4}));
        let one = params(&json!({"kind": kind, "prongs": 4, "head": "basket", "basketRails": 1}));
        let two = params(&json!({"kind": kind, "prongs": 4, "head": "basket"}));
        let pair = if kind == "stud" { 2 } else { 1 };
        // A plain prong head has one gallery rail; a basket one or two.
        assert_eq!(closed_wires(&one), closed_wires(&plain), "{kind}");
        assert_eq!(closed_wires(&two), closed_wires(&plain) + pair, "{kind}");
        for (gallery, more) in [("plain", 0), ("arches", 4), ("scallop", 4)] {
            let g = params(&json!({"kind": kind, "prongs": 4, "head": "basket", "gallery": gallery}));
            assert_eq!(open_wires(&g), open_wires(&two) + pair * more, "{kind} {gallery}");
        }
        let g = params(&json!({"kind": kind, "prongs": 6, "head": "basket", "gallery": "arches"}));
        let (solid, _) = solidify(&piece_mesh(&g, Quality::Draft).csg, 0.12, 3_000_000).unwrap();
        verify(&solid.positions, &solid.indices).unwrap();
        // The basket is heavier than the plain head it replaces.
        let (a, _) = solidify(&piece_mesh(&plain, Quality::Draft).csg, 0.12, 3_000_000).unwrap();
        let (b, _) = solidify(&piece_mesh(&two, Quality::Draft).csg, 0.12, 3_000_000).unwrap();
        assert!(b.volume() > a.volume(), "{kind}: {} against {}", b.volume(), a.volume());
    }
}

#[test]
fn a_double_prong_basket_runs_its_gallery_between_the_pairs() {
    let p = params(&json!({"kind": "pendant", "prongs": 4, "prongStyle": "double", "head": "basket", "gallery": "scallop"}));
    let plain = params(&json!({"kind": "pendant", "prongs": 4, "prongStyle": "double", "head": "basket"}));
    assert_eq!(open_wires(&p), open_wires(&plain) + 4, "one wire between each two pairs, none inside a pair");
}

#[test]
fn the_sheet_draws_the_basket_and_its_weight_counts_it() {
    let mut s = mm_drawing();
    let settings = |s: &crate::Session, p: &Value| on_layer_count(s, p, "Settings", |_| true);
    let plain = piece(&mut s, json!({"kind": "solitaire", "prongs": 4}));
    let n0 = settings(&s, &plain);
    let g0 = plain["metal"]["prongGrams"].as_f64().unwrap();
    let basket = piece(&mut s, json!({"head": "basket", "gallery": "arches"}));
    // Two rails and an arch in the front view.
    assert_eq!(settings(&s, &basket), n0 + 3);
    assert!(basket["metal"]["prongGrams"].as_f64().unwrap() > g0);
    assert_eq!(query(&mut s)["params"], basket["params"]);
    // A stud's side view draws them too.
    let stud = piece(&mut s, json!({"kind": "stud", "head": "prong"}));
    let n1 = settings(&s, &stud);
    let b = piece(&mut s, json!({"head": "basket", "basketRails": 1, "gallery": "scallop"}));
    assert_eq!(settings(&s, &b), n1 + 2);
}

/// Rule: any basket reads back to itself, builds a closed solid, and never panics.
#[hegel::test(test_cases = 20, suppress_health_check = [hegel::HealthCheck::TooSlow])]
fn any_basket_round_trips_and_builds(tc: TestCase) {
    let kind = ["solitaire", "threestone", "pendant", "stud", "drop"][tc.draw(gs::integers::<usize>().min_value(0).max_value(4))];
    let gallery = ["plain", "arches", "scallop", "?"][tc.draw(gs::integers::<usize>().min_value(0).max_value(3))];
    let rails = tc.draw(gs::integers::<i32>().min_value(-1).max_value(3));
    let prongs = tc.draw(gs::integers::<u32>().min_value(3).max_value(8));
    let style = ["round", "claw", "tab", "double"][tc.draw(gs::integers::<usize>().min_value(0).max_value(3))];
    let w = f64::from(tc.draw(gs::integers::<u32>().min_value(6).max_value(24))) / 2.0;
    let cut = ["round", "oval", "princess", "pear", "cabochon"][tc.draw(gs::integers::<usize>().min_value(0).max_value(4))];
    let v = json!({"kind": kind, "head": "basket", "gallery": gallery, "basketRails": rails, "prongs": prongs, "prongStyle": style, "stoneWidth": w, "cut": cut});
    tc.note(&v.to_string());
    let mut s = mm_drawing();
    if let Err(EngineError::Internal(..)) = s.execute("piece", &v) {
        panic!("{v}: a panic was caught");
    }
    let Ok(p) = PieceParams::parse("t", &v) else { return };
    assert_eq!(PieceParams::parse("t", &p.json()).unwrap(), p);
    assert!(super::findings::head_volume(&p).is_finite());
    let mesh = piece_mesh(&p, Quality::Draft);
    if let Ok((solid, _)) = solidify(&mesh.csg, 0.25, 600_000) {
        verify(&solid.positions, &solid.indices).unwrap_or_else(|e| panic!("{v}: {e}"));
    }
}
