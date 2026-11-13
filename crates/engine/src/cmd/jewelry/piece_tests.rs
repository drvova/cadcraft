//! `PIECE`: a parametric ring as a sheet — each kind builds, a changed number rebuilds exactly
//! what it should, and nothing hostile leaves half a piece.

use std::sync::Arc;

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::Vec2;
use serde_json::{Value, json};

use super::*;
use crate::{Input, Session};

/// A drawing in millimetres.
pub(super) fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

/// Build or rebuild, and hand back `P`.
pub(super) fn piece(s: &mut Session, p: Value) -> Value {
    let r = s.execute("piece", &p).unwrap_or_else(|e| panic!("{p}: {e}"));
    assert!(r["message"].as_str().is_some_and(|m| !m.is_empty()), "{r}");
    r["piece"].clone()
}

pub(super) fn query(s: &mut Session) -> Value {
    s.execute("piece", &json!({"query": true})).unwrap()["piece"].clone()
}

pub(super) fn handles(p: &Value) -> Vec<Handle> {
    p["handles"].as_array().unwrap().iter().map(|h| Handle::parse_hex(h.as_str().unwrap()).unwrap()).collect()
}

pub(super) fn check<'a>(p: &'a Value, id: &str) -> &'a Value {
    p["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no `{id}` check in {p}"))
}

/// The drawing as a test compares it: its objects, its undo depth and its revision.
pub(super) fn state(s: &Session) -> (usize, usize, u64) {
    let st = s.state().unwrap();
    (st.doc.model.len(), st.undo.len(), st.revision)
}

/// The piece's objects of one kind on one layer.
pub(super) fn on_layer_count(s: &Session, p: &Value, layer: &str, pick: fn(&EntityKind) -> bool) -> usize {
    let d = s.doc().unwrap();
    handles(p).iter().filter_map(|h| d.entity(*h)).filter(|e| e.common.layer == layer && pick(&e.kind)).count()
}

/// Where the piece's stones are, in drawing units, by block.
pub(super) fn stone_inserts(s: &Session, p: &Value) -> Vec<(String, Vec2)> {
    let d = s.doc().unwrap();
    handles(p)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter_map(|e| match &e.kind {
            EntityKind::Insert(i) if i.block.starts_with("GEM-") => Some((i.block.clone(), i.insert.xy())),
            _ => None,
        })
        .collect()
}

/// Every object in model space belongs to the piece: nothing is left over from an old one.
pub(super) fn assert_no_orphans(s: &Session, p: &Value) {
    let d = s.doc().unwrap();
    let hs: std::collections::HashSet<Handle> = handles(p).into_iter().collect();
    assert_eq!(d.model.len(), hs.len(), "objects in the drawing that are not the piece's");
    assert!(d.model.iter().all(|e| hs.contains(&e.handle)));
}

// ------------------------------------------------------------------ each kind

#[test]
fn a_band_is_a_front_view_a_section_and_a_plan() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "band"}));
    assert_eq!(p["params"]["kind"], "band");
    assert_eq!(p["params"]["size"], json!(6.0));
    assert_eq!(p["params"]["wall"], json!(1.8));
    assert_eq!(p["params"]["width"], json!(2.2));
    assert_eq!(p["size"]["mm"], json!(16.507));
    assert_eq!(p["at"], json!([0.0, 0.0]));
    assert_eq!(p["stones"], json!({"count": 0, "carat": 0.0}));
    assert_eq!(p["metal"]["name"], "gold18");
    assert_eq!(p["metal"]["density"], json!(15.5));
    // The ring insert, the section and the plan, all metal.
    assert_eq!(handles(&p).len(), 3);
    assert_eq!(on_layer_count(&s, &p, "Metal", |_| true), 3);
    let ids: Vec<&str> = p["checks"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["wall", "stone-seat", "spacing", "calibrated", "size"]);
    assert!(p["checks"].as_array().unwrap().iter().all(|c| c["ok"] == true && c["message"].as_str().is_some_and(|m| !m.is_empty())), "{p}");
    // The plan is `outer` long by `width` wide, under the front view; the section is to its right.
    let d = s.doc().unwrap();
    let mut boxes: Vec<(f64, f64, Vec2)> = handles(&p)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter_map(|e| match &e.kind {
            EntityKind::LwPolyline(pl) => {
                let b = cadcraft_geom::Bounds2::from_points(pl.vertices.iter().map(|v| v.p));
                Some((b.max.x - b.min.x, b.max.y - b.min.y, (b.min + b.max) * 0.5))
            }
            _ => None,
        })
        .collect();
    boxes.sort_by(|a, b| a.0.total_cmp(&b.0));
    let (section, plan) = (boxes[0], boxes[1]);
    assert!((section.0 - 2.2).abs() < 1e-9 && (section.1 - 1.8).abs() < 1e-9, "the section is width by wall: {section:?}");
    assert!(section.2.x > 10.05 && section.2.y.abs() < 1e-9, "beside the front view: {section:?}");
    assert!((plan.0 - 20.1068).abs() < 1e-3 && (plan.1 - 2.2).abs() < 1e-9, "the plan is outer by width: {plan:?}");
    assert!(plan.2.x.abs() < 1e-9 && plan.2.y < -10.05, "under the front view: {plan:?}");
    // The layers are made, in their colours.
    for (name, colour) in [("Metal", 40), ("Stones", 4), ("Settings", 8)] {
        assert_eq!(d.layer(name).unwrap().color, cadcraft_color::Color::Index(colour), "{name}");
    }
}

#[test]
fn a_flat_band_weighs_what_ring_weighs_and_a_dome_what_its_section_sweeps() {
    let mut s = mm_drawing();
    let ring = s.execute("ring", &json!({"at": [100, 0], "size": 6, "wall": 1.8, "width": 2.2, "gap": 0})).unwrap();
    s.execute("erase", &json!({"handles": [ring["handle"]]})).unwrap();
    let flat = piece(&mut s, json!({"kind": "band"}));
    assert_eq!(flat["metal"]["grams"], ring["weight"]["grams"], "the annulus RING weighs");
    let ri = 16.5068 / 2.0;
    let pi = std::f64::consts::PI;
    // A dome higher than half its width: straight sides under a semicircle.
    let (w, wall, r) = (2.2, 1.8, 1.1);
    let (a_rect, a_semi) = (w * (wall - r), pi * r * r / 2.0);
    let rise = (a_rect * (wall - r) / 2.0 + a_semi * ((wall - r) + 4.0 * r / (3.0 * pi))) / (a_rect + a_semi);
    let grams = 2.0 * pi * (ri + rise) * (a_rect + a_semi) / 1000.0 * 15.5;
    let dome = piece(&mut s, json!({"profile": "dome"}));
    assert!((dome["metal"]["grams"].as_f64().unwrap() - grams).abs() < 2e-3, "{} vs {grams}", dome["metal"]["grams"]);
    assert!(dome["metal"]["grams"].as_f64().unwrap() < flat["metal"]["grams"].as_f64().unwrap());
    // A low dome: one arc over the full width, rising to the wall (a circular segment).
    let (w, wall): (f64, f64) = (4.0, 1.0);
    let big = (w * w / 4.0 + wall * wall) / (2.0 * wall);
    let theta = 2.0 * (w / 2.0 / big).asin();
    let area = big * big / 2.0 * (theta - theta.sin());
    let rise = 4.0 * big * (theta / 2.0).sin().powi(3) / (3.0 * (theta - theta.sin())) - (big - wall);
    let grams = 2.0 * pi * (ri + rise) * area / 1000.0 * 10.4;
    let low = piece(&mut s, json!({"width": 4, "wall": 1, "metal": "silver"}));
    assert_eq!(low["params"]["profile"], "dome", "the profile is kept across a rebuild");
    assert!((low["metal"]["grams"].as_f64().unwrap() - grams).abs() < 2e-3, "{} vs {grams}", low["metal"]["grams"]);
}

#[test]
fn a_solitaire_seats_its_stone_over_the_band_with_prongs_and_a_halo() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "solitaire", "at": [50, 20]}));
    assert_eq!(p["stones"]["count"], json!(1));
    // A 6.5 mm round diamond: 6.5² × 4.0 × 0.0061 ≈ 1.03 ct.
    assert!((p["stones"]["carat"].as_f64().unwrap() - 1.031).abs() < 0.002, "{}", p["stones"]);
    assert_eq!(on_layer_count(&s, &p, "Settings", |k| matches!(k, EntityKind::Circle(_))), 6, "six prongs on the girdle");
    assert_eq!(on_layer_count(&s, &p, "Settings", |k| matches!(k, EntityKind::LwPolyline(_))), 2, "two prongs in the front view");
    let stones = stone_inserts(&s, &p);
    assert_eq!(stones.len(), 1);
    assert_eq!(stones[0].0, "GEM-ROUND-6.5", "the block a bare GEM makes");
    // The plan is under the front view: outside radius, the gap, and the head's reach.
    let prong = 0.975;
    let plan_y = 20.0 - (10.0534 + 8.0 + 3.25 + prong / 2.0);
    assert!((stones[0].1.x - 50.0).abs() < 1e-9 && (stones[0].1.y - plan_y).abs() < 1e-3, "{:?}", stones[0]);
    // The prongs are on the girdle, a sixth of a turn apart.
    let d = s.doc().unwrap();
    let sites: Vec<Vec2> = handles(&p)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter_map(|e| match &e.kind {
            EntityKind::Circle(c) if e.common.layer == "Settings" => {
                assert!((c.radius - prong / 2.0).abs() < 1e-9);
                Some(c.center.xy() - stones[0].1)
            }
            _ => None,
        })
        .collect();
    for (a, b) in sites.iter().zip(sites.iter().cycle().skip(1)) {
        assert!((a.len() - 3.25).abs() < 1e-3, "on the girdle: {a:?}");
        assert!((a.dist(*b) - 3.25).abs() < 0.05, "evenly spaced: {a:?} {b:?}");
    }
    // The front view's stone: its culet half a millimetre over the band, its table a depth above.
    let profile = handles(&p)
        .iter()
        .filter_map(|h| d.entity(*h))
        .find_map(|e| match &e.kind {
            EntityKind::LwPolyline(pl) if e.common.layer == "Stones" => {
                Some(pl.vertices.iter().map(|v| v.p - Vec2::new(50.0, 20.0)).collect::<Vec<_>>())
            }
            _ => None,
        })
        .expect("the stone's side profile");
    let low = profile.iter().map(|q| q.y).fold(f64::INFINITY, f64::min);
    let high = profile.iter().map(|q| q.y).fold(f64::NEG_INFINITY, f64::max);
    let wide = profile.iter().map(|q| q.x.abs()).fold(0.0, f64::max);
    assert!((low - (10.0534 + 0.5)).abs() < 1e-3, "culet at {low}");
    assert!((high - low - 4.0).abs() < 1e-9, "a 6.5 mm round is 4.0 mm deep: {}", high - low);
    assert!((wide - 3.25).abs() < 1e-9);
    assert_eq!(check(&p, "stone-seat")["ok"], true);

    // With a halo: melee around the stone, clear of each other by the gap and counted.
    let h = piece(&mut s, json!({"halo": 1.3}));
    let count = h["stones"]["count"].as_u64().unwrap() as usize;
    let stones = stone_inserts(&s, &h);
    let centre = stones.iter().find(|(b, _)| b == "GEM-ROUND-6.5").unwrap().1;
    let melee: Vec<Vec2> = stones.iter().filter(|(b, _)| b == "GEM-ROUND-1.3").map(|(_, at)| *at).collect();
    assert_eq!(melee.len() + 1, count);
    // On a circle of the girdle + half the prong wire + the gap + half a melee.
    let ring: f64 = 3.25 + prong / 2.0 + 0.2 + 0.65;
    let fit = (std::f64::consts::PI / (1.5 / (2.0 * ring)).asin()).floor() as usize;
    assert_eq!(melee.len(), fit, "π / asin(1.5 / 2R) at R = {ring}");
    assert_eq!(fit, 19);
    for (i, a) in melee.iter().enumerate() {
        assert!((a.dist(centre) - ring).abs() < 1e-9);
        for b in melee.iter().skip(i + 1) {
            assert!(a.dist(*b) >= 1.3 + 0.2 - 1e-9, "melee {} mm apart", a.dist(*b));
        }
    }
    assert_eq!(check(&h, "spacing")["ok"], true);
    assert_eq!(check(&h, "calibrated")["ok"], true);
    assert_no_orphans(&s, &h);
    // A fancy cut keeps its real girdle and its own prong count.
    let m = piece(&mut s, json!({"cut": "marquise", "stoneLength": 10, "stoneWidth": 5, "prongs": 4, "halo": false, "stone": "sapphire"}));
    assert_eq!(stone_inserts(&s, &m).iter().map(|(b, _)| b.as_str()).collect::<Vec<_>>(), ["GEM-MARQUISE-10x5-SAPPHIRE"]);
    assert_eq!(on_layer_count(&s, &m, "Settings", |k| matches!(k, EntityKind::Circle(_))), 4);
    let oval = piece(&mut s, json!({"cut": "oval", "stoneLength": 8, "stoneWidth": 6, "halo": true, "stone": "diamond"}));
    assert_eq!(check(&oval, "spacing")["ok"], true, "{oval}");
    assert!(oval["stones"]["count"].as_u64().unwrap() > 12, "{}", oval["stones"]);
    // A cut with straight sides takes every prong it is asked for: a trillion's fourth prong
    // stands on a side (it used to be left out, and the sheet drew three).
    let trillion = piece(&mut s, json!({"cut": "trillion", "stoneLength": 6, "stoneWidth": 6, "prongs": 4, "halo": false}));
    assert_eq!(on_layer_count(&s, &trillion, "Settings", |k| matches!(k, EntityKind::Circle(_))), 4);
    let square = piece(&mut s, json!({"cut": "princess", "stoneLength": 5, "stoneWidth": 5, "prongs": 6}));
    assert_eq!(on_layer_count(&s, &square, "Settings", |k| matches!(k, EntityKind::Circle(_))), 6);
}

#[test]
fn an_eternity_band_takes_the_stones_that_fit_at_the_gap() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "eternity"}));
    // Size 6, 1.8 mm wall: the girdles of 1.8 mm stones (1.11 mm deep) lie 0.31 mm under the
    // outside, on a circle of radius 9.74 mm, where 30 keep 0.2 mm between them and 31 do not.
    assert_eq!(p["stones"]["count"], json!(30));
    assert_eq!(p["stones"]["fits"], json!(30));
    assert_eq!(p["params"]["count"], Value::Null, "the count stays automatic");
    let (rg, m): (f64, f64) = (10.0534 - 1.11 * 0.28, 1.8);
    let between = |n: f64| 2.0 * rg.hypot(m / 2.0) * (std::f64::consts::PI / n - (m / (2.0 * rg)).atan()).sin();
    assert!(between(30.0) >= 0.2 && between(31.0) < 0.2, "{} {}", between(30.0), between(31.0));
    assert!(check(&p, "spacing")["message"].as_str().unwrap().contains(&fmt_mm(between(30.0))), "{}", check(&p, "spacing"));
    assert_eq!(check(&p, "spacing")["ok"], true);
    assert_eq!(check(&p, "stone-seat")["ok"], false, "a 2.2 mm band leaves 0.2 mm each side of a 1.8 mm stone");
    assert_eq!(check(&p, "calibrated")["ok"], true);
    // 30 stones as inserts on the layout, on their pitch along the unrolled girdle circle.
    let mut xs: Vec<f64> = stone_inserts(&s, &p)
        .iter()
        .map(|(b, at)| {
            assert_eq!(b, "GEM-ROUND-1.8");
            at.x
        })
        .collect();
    xs.sort_by(f64::total_cmp);
    assert_eq!(xs.len(), 30);
    let pitch = std::f64::consts::TAU * rg / 30.0;
    for w in xs.windows(2) {
        assert!((w[1] - w[0] - pitch).abs() < 1e-3, "{} vs {pitch}", w[1] - w[0]);
    }
    // 30 side profiles around the front view (and one in the section), and the visible half in plan.
    assert_eq!(on_layer_count(&s, &p, "Stones", |k| matches!(k, EntityKind::LwPolyline(_))), 31);
    assert_eq!(on_layer_count(&s, &p, "Stones", |k| matches!(k, EntityKind::Ellipse(_))), 15);
    let d = s.doc().unwrap();
    let mut profiles = 0;
    for e in handles(&p).iter().filter_map(|h| d.entity(*h)) {
        if let EntityKind::LwPolyline(pl) = &e.kind
            && e.common.layer == "Stones"
            && pl.vertices.iter().all(|v| v.p.len() < 10.2)
        {
            // A profile in the front view: its table on the outside circle, its culet a depth in.
            let near = pl.vertices.iter().map(|v| v.p.len()).fold(f64::INFINITY, f64::min);
            assert!((near - (10.0534 - 1.11)).abs() < 1e-3, "culet at radius {near}");
            profiles += 1;
        }
    }
    assert_eq!(profiles, 30);
    // An explicit count is kept, and one that cannot fit is refused with the number that does.
    let twenty = piece(&mut s, json!({"count": 20, "width": 2.6}));
    assert_eq!(twenty["stones"]["count"], json!(20));
    assert_eq!(twenty["stones"]["fits"], json!(30));
    assert_eq!(check(&twenty, "stone-seat")["ok"], true, "0.4 mm each side, 0.69 mm under the culet");
    let e = s.execute("piece", &json!({"count": 31})).unwrap_err().to_string();
    assert!(e.contains("30 fit"), "{e}");
    assert_eq!(query(&mut s), twenty, "the refusal changed nothing");
    // A stone deeper than the wall comes through; an odd size is not calibrated.
    let deep = piece(&mut s, json!({"melee": 3.5, "width": 5, "count": null}));
    assert_eq!(check(&deep, "stone-seat")["ok"], false);
    assert!(check(&deep, "stone-seat")["message"].as_str().unwrap().contains("culet"), "{deep}");
    assert_eq!(check(&deep, "calibrated")["ok"], false);
    // Another cut goes around as itself.
    let square = piece(&mut s, json!({"cut": "princess", "melee": 2, "width": 3, "wall": 2}));
    assert!(stone_inserts(&s, &square).iter().all(|(b, _)| b == "GEM-PRINCESS-2"));
    assert_eq!(on_layer_count(&s, &square, "Stones", |k| matches!(k, EntityKind::Ellipse(_))), 0);
    assert_no_orphans(&s, &square);
}

// ------------------------------------------------------------------ the bench sheet

#[test]
fn the_bench_sheet_counts_the_piece_with_no_special_case() {
    for build in [
        json!({"kind": "band", "profile": "dome"}),
        json!({"kind": "solitaire", "halo": 1.3, "stone": "sapphire"}),
        json!({"kind": "eternity", "count": 24, "metal": "platinum"}),
    ] {
        let mut s = mm_drawing();
        let p = piece(&mut s, build.clone());
        let sheet = s.execute("techsheet", &json!({})).unwrap();
        assert_eq!(sheet["stones"]["count"], p["stones"]["count"], "{build}");
        assert!((sheet["stones"]["carat"].as_f64().unwrap() - p["stones"]["carat"].as_f64().unwrap()).abs() < 2e-3, "{build}: {sheet}");
        let bands = sheet["bands"].as_array().unwrap();
        assert_eq!(bands.len(), 1, "{build}");
        assert_eq!(bands[0]["size"], "US 6");
        assert_eq!(bands[0]["metal"], p["metal"]["name"]);
        assert_eq!(bands[0]["wall"], json!(1.8));
        assert!((bands[0]["grams"].as_f64().unwrap() - p["metal"]["grams"].as_f64().unwrap()).abs() < 0.006, "{build}: {sheet}");
        // The band's front view measures as the finger it is.
        let ring = bands[0]["handle"].as_str().unwrap();
        let measured = s.execute("ringsizes", &json!({"handle": ring})).unwrap();
        assert_eq!(measured["measured"]["diameter"], json!(16.507));
        assert_eq!(measured["measured"]["wall"], json!(1.8));
    }
    // The centre stone is counted as the sapphire it is.
    let mut s = mm_drawing();
    piece(&mut s, json!({"kind": "solitaire", "stone": "sapphire"}));
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["groups"][0]["sg"], json!(4.0));
}

// ------------------------------------------------------------------ rebuilding

#[test]
fn a_changed_size_rebuilds_the_piece_and_leaves_nothing_behind() {
    let mut s = mm_drawing();
    let six = piece(&mut s, json!({"kind": "eternity", "count": 24, "width": 2.6, "at": [5, 5]}));
    assert_eq!(six["size"]["mm"], json!(16.507));
    let depth = state(&s).1;
    let seven = piece(&mut s, json!({"size": 7}));
    assert_eq!(state(&s).1, depth + 1, "one undo step");
    assert_eq!(seven["size"]["mm"], json!(17.32), "US 7 is 17.32 mm inside");
    assert_eq!(seven["params"]["size"], json!(7.0));
    assert_eq!(seven["params"]["sizeText"], "7");
    assert_eq!(seven["stones"]["count"], json!(24), "an explicit count is kept");
    assert_eq!(seven["stones"]["fits"], json!(31), "and one more now fits");
    assert_eq!(seven["at"], json!([5.0, 5.0]), "the sheet stays where it is");
    for key in ["kind", "wall", "width", "profile", "metal", "melee", "gap", "count", "cut", "stone"] {
        assert_eq!(seven["params"][key], six["params"][key], "{key} is untouched");
    }
    assert!(seven["metal"]["grams"].as_f64().unwrap() > six["metal"]["grams"].as_f64().unwrap());
    assert_no_orphans(&s, &seven);
    // The same piece drawn fresh is the same drawing.
    let mut fresh = mm_drawing();
    let direct = piece(&mut fresh, json!({"kind": "eternity", "count": 24, "width": 2.6, "at": [5, 5], "size": 7}));
    assert_eq!(direct["params"], seven["params"]);
    assert_eq!(direct["metal"], seven["metal"]);
    assert_eq!(direct["stones"], seven["stones"]);
    assert_eq!(direct["checks"], seven["checks"]);
    assert_eq!(fresh.doc().unwrap().model.len(), s.doc().unwrap().model.len());
    // An automatic count follows the size.
    let auto = piece(&mut s, json!({"count": null}));
    assert_eq!(auto["stones"]["count"], json!(31));
    let back = piece(&mut s, json!({"size": 6}));
    assert_eq!(back["stones"]["count"], json!(30));
    assert_no_orphans(&s, &back);
    // The ring's block follows: one band on the sheet, the new size.
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["bands"].as_array().unwrap().len(), 1);
    assert_eq!(sheet["stones"]["count"], json!(30));
    // A kind can change too, and takes the piece's other numbers with it.
    let band = piece(&mut s, json!({"kind": "band"}));
    assert_eq!(band["params"]["width"], json!(2.6));
    assert_eq!(handles(&band).len(), 3);
    assert_no_orphans(&s, &band);
}

#[test]
fn a_size_is_read_in_the_system_the_piece_was_given_in() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "band", "system": "eu", "size": 54}));
    assert_eq!(p["size"]["eu"], json!(54));
    assert_eq!(p["params"]["sizeSystem"], "eu");
    assert_eq!(p["params"]["system"], "us", "the stored size is the US number");
    assert_eq!(check(&p, "size")["ok"], true, "EU 54 is a standard size: {}", check(&p, "size"));
    // A rebuild that does not touch the size keeps the finger and the system.
    let wider = piece(&mut s, json!({"width": 3}));
    assert_eq!(wider["size"], p["size"]);
    assert_eq!(wider["params"]["sizeSystem"], "eu");
    // A new size without a system is read as the piece's own system.
    let bigger = piece(&mut s, json!({"size": 56}));
    assert_eq!(bigger["size"]["eu"], json!(56));
    // A new system without a size renames the same finger.
    let renamed = piece(&mut s, json!({"system": "us"}));
    assert_eq!(renamed["size"]["mm"], bigger["size"]["mm"]);
    assert_eq!(renamed["params"]["sizeSystem"], "us");
    assert_eq!(check(&renamed, "size")["ok"], false, "EU 56 is not a US quarter size");
    assert!(check(&renamed, "size")["message"].as_str().unwrap().contains("nearest quarter size"), "{}", check(&renamed, "size"));
    let uk = piece(&mut s, json!({"system": "uk", "size": "M"}));
    assert_eq!(uk["size"]["uk"], "M");
    assert_eq!(check(&uk, "size")["ok"], true);
    let off = piece(&mut s, json!({"system": "us", "size": 6.1}));
    assert_eq!(check(&off, "size")["ok"], false);
    assert!(check(&off, "size")["message"].as_str().unwrap().contains("0.08 mm over US 6"), "{}", check(&off, "size"));
}

#[test]
fn checks_inform_and_do_not_refuse() {
    let mut s = mm_drawing();
    let thin = piece(&mut s, json!({"kind": "solitaire", "wall": 0.5, "width": 1.2, "stoneWidth": 12}));
    assert_eq!(check(&thin, "wall")["ok"], false);
    assert!(check(&thin, "wall")["message"].as_str().unwrap().contains("0.5 mm"));
    assert_eq!(check(&thin, "stone-seat")["ok"], false, "a 1.2 mm band under a 12 mm stone");
    assert!(s.execute("piece", &json!({"query": true})).unwrap()["piece"].is_object(), "it was still built");
    let message = s.execute("piece", &json!({})).unwrap()["message"].as_str().unwrap().to_string();
    assert!(message.contains("Check: "), "the failed checks are in the message: {message}");
}

// ------------------------------------------------------------------ query, undo, remove

#[test]
fn query_reads_the_piece_and_changes_nothing() {
    let mut s = mm_drawing();
    assert_eq!(s.execute("piece", &json!({"query": true})).unwrap(), json!({"piece": null}));
    assert_eq!(state(&s).0, 0);
    let built = piece(&mut s, json!({"kind": "solitaire", "halo": true, "system": "jp", "size": 12}));
    let before = state(&s);
    let doc = s.state().unwrap().doc.clone();
    for _ in 0..3 {
        assert_eq!(query(&mut s), built, "query is the piece the build reported");
    }
    assert_eq!(state(&s), before, "no object, no undo step, no revision");
    assert!(Arc::ptr_eq(&doc, &s.state().unwrap().doc), "the drawing itself is untouched");
}

#[test]
fn undo_restores_the_previous_piece_and_its_parameters() {
    let mut s = mm_drawing();
    let first = piece(&mut s, json!({"kind": "solitaire"}));
    let second = piece(&mut s, json!({"size": 8, "halo": 1.5, "metal": "platinum"}));
    assert_ne!(first, second);
    s.undo().unwrap();
    assert_eq!(query(&mut s), first, "the geometry and the parameters come back together");
    assert_no_orphans(&s, &first);
    s.redo().unwrap();
    assert_eq!(query(&mut s), second);
    assert_no_orphans(&s, &second);
    s.undo().unwrap();
    s.undo().unwrap();
    assert_eq!(query(&mut s), Value::Null, "before the first build there was no piece");
    assert_eq!(s.doc().unwrap().model.len(), 0);
}

#[test]
fn remove_erases_the_piece_and_only_the_piece() {
    let mut s = mm_drawing();
    s.execute("circle", &json!({"center": [40, 0], "radius": 3})).unwrap();
    let others = s.doc().unwrap().model.len();
    assert_eq!(others, 1);
    assert_eq!(s.execute("piece", &json!({"remove": true})).unwrap()["removed"], json!(0), "nothing to remove");
    let p = piece(&mut s, json!({"kind": "eternity"}));
    let n = handles(&p).len();
    let depth = state(&s).1;
    let r = s.execute("piece", &json!({"remove": true})).unwrap();
    assert_eq!(r["piece"], Value::Null);
    assert_eq!(r["removed"], json!(n));
    assert_eq!(s.doc().unwrap().model.len(), others, "the rest of the drawing stays");
    assert_eq!(query(&mut s), Value::Null);
    assert_eq!(state(&s).1, depth + 1, "one undo step");
    s.undo().unwrap();
    assert_eq!(query(&mut s), p, "and undo brings it back");
    // After a remove, a build needs its kind again.
    s.redo().unwrap();
    assert!(s.execute("piece", &json!({"size": 7})).is_err());
    assert!(s.execute("piece", &json!({"query": true, "remove": true})).is_err());
}

#[test]
fn a_refusal_leaves_the_drawing_and_the_piece_as_they_were() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "eternity", "count": 20}));
    let before = state(&s);
    let doc = s.state().unwrap().doc.clone();
    for bad in [
        json!({"count": 99}),
        json!({"wall": -1}),
        json!({"kind": "tiara"}),
        json!({"size": 40}),
        json!({"melee": 6, "wall": 0.3, "gap": 5, "count": 30}),
        json!({"kind": "solitaire", "cut": "marquise", "stoneLength": 4, "stoneWidth": 8}),
        json!({"at": [1, "two"]}),
    ] {
        assert!(s.execute("piece", &bad).is_err(), "{bad}");
        assert_eq!(state(&s), before, "{bad}");
        assert!(Arc::ptr_eq(&doc, &s.state().unwrap().doc), "{bad}: the drawing is the same drawing");
        assert_eq!(query(&mut s), p, "{bad}");
    }
    // A locked layer is respected: the piece is not half rebuilt.
    s.doc_mut().unwrap().layer_mut("Stones").unwrap().locked = true;
    let before = state(&s);
    let e = s.execute("piece", &json!({"size": 7})).unwrap_err().to_string();
    assert!(e.contains("locked"), "{e}");
    assert_eq!(state(&s), before);
    assert_eq!(query(&mut s), p);
    assert!(s.execute("piece", &json!({"remove": true})).is_err());
    assert_eq!(query(&mut s), p);
}

#[test]
fn existing_layers_keep_their_properties() {
    let mut s = mm_drawing();
    let mut mine = cadcraft_doc::Layer::new("metal");
    mine.color = cadcraft_color::Color::Index(1);
    mine.description = "my own".into();
    s.doc_mut().unwrap().layers.push(mine.clone());
    let p = piece(&mut s, json!({"kind": "solitaire"}));
    assert_eq!(s.doc().unwrap().layer("Metal").unwrap(), &mine);
    assert_eq!(s.doc().unwrap().layers.iter().filter(|l| l.name.eq_ignore_ascii_case("metal")).count(), 1);
    assert!(handles(&p).len() > 3);
}

// ------------------------------------------------------------------ units, position, files

#[test]
fn an_inch_drawing_holds_the_same_piece_at_the_right_size() {
    // A new drawing is inches.
    let mut s = Session::new();
    let p = piece(&mut s, json!({"kind": "solitaire", "at": [2, 1], "halo": 1.3}));
    let mut mm = mm_drawing();
    let q = piece(&mut mm, json!({"kind": "solitaire", "at": [2, 1], "halo": 1.3}));
    for key in ["params", "size", "metal", "stones", "checks", "at"] {
        assert_eq!(p[key], q[key], "{key} does not depend on the drawing's units");
    }
    let (d, dm) = (s.doc().unwrap(), mm.doc().unwrap());
    let at = Vec2::new(2.0, 1.0);
    assert_eq!(handles(&p).len(), handles(&q).len());
    for (h, hm) in handles(&p).iter().zip(handles(&q).iter()) {
        let (e, em) = (d.entity(*h).unwrap(), dm.entity(*hm).unwrap());
        match (&e.kind, &em.kind) {
            (EntityKind::Insert(a), EntityKind::Insert(b)) => {
                assert_eq!(a.block, b.block);
                assert!((a.scale.x - 1.0 / 25.4).abs() < 1e-12 && (b.scale.x - 1.0).abs() < 1e-12, "a millimetre block scaled into inches");
                assert!(((a.insert.xy() - at) * 25.4).dist(b.insert.xy() - at) < 1e-9);
            }
            (EntityKind::Circle(a), EntityKind::Circle(b)) => {
                assert!((a.radius * 25.4 - b.radius).abs() < 1e-9);
                assert!(((a.center.xy() - at) * 25.4).dist(b.center.xy() - at) < 1e-9);
            }
            (EntityKind::LwPolyline(a), EntityKind::LwPolyline(b)) => {
                assert_eq!(a.vertices.len(), b.vertices.len());
                for (v, w) in a.vertices.iter().zip(&b.vertices) {
                    assert!(((v.p - at) * 25.4).dist(w.p - at) < 1e-9);
                    assert_eq!(v.bulge, w.bulge);
                }
            }
            (a, b) => panic!("{a:?} is not {b:?}"),
        }
    }
    // The finger measures 16.51 mm in the inch drawing, and the section is 2.2 mm in inches.
    let narrowest = handles(&p)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter_map(|e| match &e.kind {
            EntityKind::LwPolyline(pl) if e.common.layer == "Metal" => {
                let b = cadcraft_geom::Bounds2::from_points(pl.vertices.iter().map(|v| v.p));
                Some(b.max.x - b.min.x)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!((narrowest - 2.2 / 25.4).abs() < 1e-12, "{narrowest}");
    let ring = handles(&p)[0].hex();
    let measured = s.execute("ringsizes", &json!({"handle": ring})).unwrap();
    assert_eq!(measured["measured"]["diameter"], json!(16.507));
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"], p["stones"]["count"]);
}

#[test]
fn a_moved_piece_rebuilds_where_it_was_moved_to() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "solitaire", "at": [10, 10]}));
    let hs: Vec<String> = handles(&p).iter().map(|h| h.hex()).collect();
    s.execute("move", &json!({"handles": hs, "delta": [30, -5]})).unwrap();
    let r = piece(&mut s, json!({"size": 7}));
    assert_eq!(r["at"], json!([40.0, 5.0]));
    assert_no_orphans(&s, &r);
    let there = piece(&mut s, json!({"at": [0, 0]}));
    assert_eq!(there["at"], json!([0.0, 0.0]), "and goes where `at` says");
    let stone = stone_inserts(&s, &there)[0].1;
    assert!(stone.x.abs() < 1e-9 && stone.y < -10.0);
}

#[test]
fn a_saved_and_reopened_drawing_keeps_the_piece_and_its_parameters() {
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "solitaire", "halo": 1.3, "size": 7.5, "profile": "dome", "metal": "platinum", "at": [12.5, -3]}));
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let q = query(&mut t);
    assert!(q.is_object(), "the piece is in the reopened drawing");
    for key in ["params", "size", "metal", "stones", "checks", "at"] {
        assert_eq!(q[key], p[key], "{key}");
    }
    assert_eq!(handles(&q).len(), handles(&p).len(), "every object of the piece is still its object");
    // And it rebuilds there, leaving nothing behind.
    let r = piece(&mut t, json!({"size": 6}));
    assert_eq!(r["size"]["mm"], json!(16.507));
    assert_eq!(r["params"]["metal"], "platinum");
    assert_eq!(r["at"], json!([12.5, -3.0]));
    assert_no_orphans(&t, &r);
    let sheet = t.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"], r["stones"]["count"]);
}

#[test]
fn a_group_of_the_same_name_that_is_not_a_piece_is_left_alone() {
    let mut s = mm_drawing();
    s.execute("circle", &json!({"center": [0, 0], "radius": 3})).unwrap();
    let h = s.doc().unwrap().model.iter().next().unwrap().handle;
    s.doc_mut().unwrap().groups.push(cadcraft_doc::Group {
        name: "jewelry_piece".into(),
        description: "my own".into(),
        selectable: true,
        members: vec![h],
    });
    assert_eq!(query(&mut s), Value::Null);
    assert!(s.execute("piece", &json!({"kind": "band"})).is_err());
    assert_eq!(s.execute("piece", &json!({"remove": true})).unwrap()["removed"], json!(0));
    assert_eq!(s.doc().unwrap().model.len(), 1);
    assert_eq!(s.doc().unwrap().groups.len(), 1);
    // A piece's record that has been damaged reads as no piece, and a build replaces it.
    let mut s = mm_drawing();
    let p = piece(&mut s, json!({"kind": "eternity"}));
    s.doc_mut().unwrap().groups[0].description = r#"{"at":[1e400,0],"params":{"kind":"eternity","size":1e308,"wall":"thick"}}"#.into();
    assert_eq!(query(&mut s), Value::Null);
    s.doc_mut().unwrap().groups[0].description = r#"{"at":["x"],"params":{"kind":"eternity","wall":"thick"}}"#.into();
    let r = s.execute("piece", &json!({"query": true})).unwrap();
    assert_eq!(r["piece"], Value::Null);
    assert!(r["message"].as_str().unwrap().contains("cannot be read"), "{r}");
    assert!(s.execute("piece", &json!({"size": 7})).is_err(), "there is no kind to merge over");
    let b = piece(&mut s, json!({"kind": "band"}));
    assert_ne!(handles(&b).len(), handles(&p).len());
    assert_no_orphans(&s, &b);
}

// ------------------------------------------------------------------ hostile input

#[test]
fn hostile_piece_params_never_panic_and_never_leave_half_a_piece() {
    let hostile = [
        json!([]),
        json!("solitaire"),
        json!(7),
        json!({"kind": 3}),
        json!({"kind": "necklace"}),
        json!({"kind": "band", "size": 1e308}),
        json!({"kind": "band", "size": -1e308}),
        json!({"kind": "band", "size": "∞"}),
        json!({"kind": "band", "size": [6]}),
        json!({"kind": "band", "system": "uk", "size": "ZZ"}),
        json!({"kind": "band", "wall": 1e308}),
        json!({"kind": "band", "wall": -1.8}),
        json!({"kind": "band", "wall": 0}),
        json!({"kind": "band", "wall": "1.8"}),
        json!({"kind": "band", "width": 1e308}),
        json!({"kind": "band", "width": {"mm": 2}}),
        json!({"kind": "band", "profile": "wavy"}),
        json!({"kind": "band", "metal": "unobtanium"}),
        json!({"kind": "band", "at": [1e308, 0]}),
        json!({"kind": "band", "at": [0, -1e300]}),
        json!({"kind": "band", "at": ["NaN", "Infinity"]}),
        json!({"kind": "band", "at": "nan,nan"}),
        json!({"kind": "band", "at": [0]}),
        json!({"kind": "band", "at": [0, 0, 0]}),
        json!({"kind": "band", "at": {"x": 0, "y": 0}}),
        json!({"kind": "band", "query": "yes"}),
        json!({"kind": "band", "remove": 1}),
        json!({"kind": "solitaire", "cut": "banana"}),
        json!({"kind": "solitaire", "stone": "kryptonite"}),
        json!({"kind": "solitaire", "stoneWidth": 1e308}),
        json!({"kind": "solitaire", "stoneWidth": -6.5}),
        json!({"kind": "solitaire", "stoneLength": 0}),
        json!({"kind": "solitaire", "stoneWidth": 9, "stoneLength": 3, "cut": "pear"}),
        json!({"kind": "solitaire", "prongs": 0}),
        json!({"kind": "solitaire", "prongs": 400}),
        json!({"kind": "solitaire", "prongs": 4.5}),
        json!({"kind": "solitaire", "prongs": -6}),
        json!({"kind": "solitaire", "halo": 1e308}),
        json!({"kind": "solitaire", "halo": -1}),
        json!({"kind": "solitaire", "halo": "yes"}),
        json!({"kind": "eternity", "count": 401}),
        json!({"kind": "eternity", "count": 4_000_000_000_u64}),
        json!({"kind": "eternity", "count": 0}),
        json!({"kind": "eternity", "count": -3}),
        json!({"kind": "eternity", "count": 2.5}),
        json!({"kind": "eternity", "count": 400}),
        json!({"kind": "eternity", "melee": 1e308}),
        json!({"kind": "eternity", "melee": 0}),
        json!({"kind": "eternity", "gap": -0.2}),
        json!({"kind": "eternity", "gap": 1e308}),
        json!({"kind": "eternity", "melee": 6, "gap": 5, "count": 12}),
    ];
    // On an empty drawing, and over a piece that is already there.
    let mut empty = mm_drawing();
    let mut full = mm_drawing();
    let there = piece(&mut full, json!({"kind": "solitaire", "halo": true}));
    for p in hostile.iter().chain(&[json!(null), json!({}), json!({"size": 7})]) {
        let before = state(&empty);
        let r = empty.execute("piece", p);
        assert!(r.is_err(), "{p} was accepted: {r:?}");
        assert!(!matches!(r, Err(crate::EngineError::Internal(..))), "{p} panicked: {r:?}");
        assert_eq!(state(&empty), before, "{p} left something behind");
        assert!(empty.doc().unwrap().groups.is_empty(), "{p}");
    }
    for p in &hostile {
        let before = state(&full);
        let r = full.execute("piece", p);
        assert!(r.is_err(), "{p} was accepted: {r:?}");
        assert!(!matches!(r, Err(crate::EngineError::Internal(..))), "{p} panicked: {r:?}");
        assert_eq!(state(&full), before, "{p} changed the drawing");
        assert_eq!(query(&mut full), there, "{p} changed the piece");
    }
    // Parameters that carry nothing new rebuild the piece as it is.
    for p in [json!(null), json!({}), json!({"nonsense": [1, 2, 3]})] {
        let r = piece(&mut full, p.clone());
        assert_eq!(r["params"], there["params"], "{p}");
        assert_no_orphans(&full, &r);
    }
    // The extremes that are allowed build whole pieces: the most stones, the largest of everything.
    let mut s = mm_drawing();
    let many = piece(&mut s, json!({"kind": "eternity", "system": "jp", "size": 36, "wall": 10, "melee": 0.8, "gap": 0, "width": 30}));
    let n = many["stones"]["count"].as_u64().unwrap();
    assert!((100..=400).contains(&n), "{n}");
    assert!(handles(&many).len() < 5000);
    assert_no_orphans(&s, &many);
    let big = piece(&mut s, json!({"kind": "solitaire", "stoneWidth": 30, "stoneLength": 30, "halo": 0.8, "gap": 0, "prongs": 8, "cut": "heart"}));
    assert!(big["stones"]["count"].as_u64().unwrap() <= 401);
    assert_no_orphans(&s, &big);
    for cut in gem::CUTS {
        let p = piece(&mut s, json!({"kind": "solitaire", "cut": cut.name, "stoneWidth": 5, "stoneLength": 7, "halo": true, "gap": 0.2}));
        assert_eq!(check(&p, "spacing")["ok"], true, "{}: {}", cut.name, check(&p, "spacing"));
        let e = piece(&mut s, json!({"kind": "eternity", "cut": cut.name, "count": null}));
        assert_eq!(e["stones"]["count"], e["stones"]["fits"], "{}", cut.name);
        assert_no_orphans(&s, &e);
    }
}

// ------------------------------------------------------------------ the command itself

#[test]
fn piece_is_registered_and_starts_from_the_menu() {
    let spec = command_specs().iter().find(|c| c.id == "piece").expect("piece is a command");
    assert_eq!(spec.label, "Piece");
    assert_eq!(spec.menu, ["Draw", "Piece"]);
    assert!(spec.aliases.contains(&"ringpiece"));
    for word in ["query", "remove", "kind", "eternity", "halo", "count", "checks", "handles", "grams", "at?"] {
        assert!(spec.params.contains(word), "the params line does not mention `{word}`");
    }
    // From the menu: the kind, then the centre of the front view.
    let mut s = mm_drawing();
    s.start("piece").unwrap();
    assert!(s.prompt_text().contains("Kind of piece"), "{}", s.prompt_text());
    s.input(Input::Text("tiara".into())).unwrap();
    assert!(s.prompt_text().contains("Kind of piece"), "an unknown kind asks again");
    s.input(Input::Text("Solitaire".into())).unwrap();
    assert!(s.prompt_text().contains("centre"), "{}", s.prompt_text());
    s.input(Input::Point(Vec2::new(30.0, 30.0))).unwrap();
    let p = query(&mut s);
    assert_eq!(p["params"]["kind"], "solitaire");
    assert_eq!(p["at"], json!([30.0, 30.0]));
    s.undo().unwrap();
    assert_eq!(query(&mut s), Value::Null, "one undo takes the piece away");
    assert_eq!(s.doc().unwrap().model.len(), 0);
    // Cancelling draws nothing.
    s.start("piece").unwrap();
    s.input(Input::Cancel).unwrap();
    assert_eq!(query(&mut s), Value::Null);
}

#[test]
fn a_piece_is_not_drawn_in_a_layout() {
    let mut s = mm_drawing();
    let name = s.doc().unwrap().layouts.first().map(|l| l.name.clone()).expect("a new drawing has a layout");
    s.execute("layout", &json!({"option": "set", "name": name})).unwrap();
    assert!(s.space().is_paper(), "the layout is current");
    let before = state(&s);
    let e = s.execute("piece", &json!({"kind": "band"})).unwrap_err().to_string();
    assert!(e.contains("model space"), "{e}");
    assert_eq!(state(&s), before);
    assert_eq!(s.execute("piece", &json!({"query": true})).unwrap(), json!({"piece": null}));
}
