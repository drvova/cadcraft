//! Ring sizes, gem cuts, pavé fit and the bench sheet: the trade's numbers, checked.

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::Vec2;
use serde_json::{Value, json};

use super::gem::{self, CUTS};
use super::pave::{Region, fill_for_test, max_inscribed};
use super::sizes::{RingSize, density_of};
use super::*;
use crate::Session;

/// The outline of the block a command inserted, sampled in millimetres (blocks of jewelry
/// geometry are millimetres whatever the drawing's units).
fn outline_of(s: &Session, handle: &str) -> (Vec<Vec2>, bool) {
    let h = Handle::parse_hex(handle).unwrap();
    let d = s.doc().unwrap();
    let e = d.entity(h).unwrap();
    let EntityKind::Insert(ins) = &e.kind else { panic!("not an insert") };
    let blk = d.block(&ins.block).unwrap();
    let first = blk.entities.iter().next().unwrap();
    entity_loop(first, 1.0).expect("an outline")
}

/// The area of a closed outline, from its geometry (bulges exact).
fn outline_area(pts: &[Vec2]) -> f64 {
    cadcraft_geom::Polyline::from_points(pts, true).area().abs()
}

pub(super) fn polyline(s: &mut Session, pts: &[Vec2]) -> String {
    let r = s.execute("pline", &json!({"points": pts.iter().map(|p| json!([p.x, p.y])).collect::<Vec<_>>(), "closed": true})).unwrap();
    r["handle"].as_str().unwrap_or_else(|| r["handles"][0].as_str().unwrap()).to_string()
}

/// A drawing in millimetres.
pub(super) fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

// ---------------------------------------------------------------- ring sizes

#[test]
fn us_six_is_the_published_ring_size() {
    let r = RingSize::from_us(6.0).expect("a size");
    assert!((r.diameter - 16.51).abs() < 0.01, "US 6 inside diameter: {}", r.diameter);
    assert!((r.circumference - 51.87).abs() < 0.05);
    assert_eq!(r.eu, 52, "ISO/Europe is the inside circumference in mm");
    assert_eq!(r.jp, 12, "Japan: 13 mm + ⅓ mm per size");
    assert_eq!(r.cn, 12, "China: the circumference less forty");
    assert_eq!(r.uk(), "L", "US 6 is UK L");
}

#[test]
fn the_uk_chart_matches_the_published_letters() {
    // The published chart, spot-checked at A, L, M and Z.
    let cases = [("A", 12.04), ("L", 16.51), ("M", 16.92), ("Z", 22.20)];
    for (letter, mm) in cases {
        let r = RingSize::from_uk(letter).unwrap_or_else(|| panic!("UK {letter}"));
        assert!((r.diameter - mm).abs() < 0.02, "UK {letter}: {} (want {mm})", r.diameter);
    }
    assert_eq!(RingSize::from_uk("l").map(|r| r.uk()), Some("L".to_string()), "case is not a size");
    assert_eq!(RingSize::from_uk("M1/2").map(|r| r.uk()), Some("M½".to_string()));
    assert!(RingSize::from_uk("6").is_none(), "6 is not a UK letter");
}

#[test]
fn every_system_names_the_same_finger() {
    let r = RingSize::from_eu(52.0).unwrap();
    assert_eq!(r.us_text(), "6", "EU 52 is US 6");
    let jp = RingSize::from_jp(12.0).unwrap();
    assert!((jp.diameter - 16.67).abs() < 0.02, "JP 12: {}", jp.diameter);
    let cn = RingSize::from_cn(12.0).unwrap();
    assert!((cn.diameter - 16.55).abs() < 0.05, "CN 12: {}", cn.diameter);
    // Halves round-trip through the text a bench writes.
    for us in [3.0, 6.5, 7.25, 10.0, 13.0] {
        let r = RingSize::from_us(us).unwrap();
        let again = RingSize::from_us(r.us).unwrap();
        assert!((again.diameter - r.diameter).abs() < 1e-9);
    }
    assert_eq!(RingSize::from_us(6.25).map(|r| r.us_text()), Some("6¼".to_string()));
    assert!(RingSize::from_us(40.0).is_none(), "outside the trade's range");
}

#[test]
fn ringsizes_lists_a_range_and_a_single_size() {
    let mut s = Session::new();
    let r = s.execute("ringsizes", &json!({})).unwrap();
    assert_eq!(r["system"], "us");
    assert_eq!(r["count"], 11, "US 3 to 13");
    assert_eq!(r["sizes"][0]["us"], json!(3.0));
    let one = s.execute("ringsizes", &json!({"system": "uk", "size": "N"})).unwrap();
    assert_eq!(one["sizes"][0]["uk"], "N");
    assert!((one["sizes"][0]["mm"].as_f64().unwrap() - 17.32).abs() < 0.02);
    assert!(s.execute("ringsizes", &json!({"system": "uk", "size": "Nope"})).is_err());
}

#[test]
fn ring_draws_the_blank_in_millimetres_of_a_unit_drawing() {
    let mut s = mm_drawing();
    let r = s.execute("ring", &json!({"at": [10, 10], "size": 6, "wall": 1.8, "width": 2.0})).unwrap();
    assert!((r["innerDiameter"].as_f64().unwrap() - 16.55).abs() < 0.02, "size plus the sizing allowance");
    assert!((r["outerDiameter"].as_f64().unwrap() - 20.15).abs() < 0.02);
    assert!(r["weight"]["grams"].as_f64().unwrap() > 0.0);
    let (pts, closed) = outline_of(&s, r["handle"].as_str().unwrap());
    assert!(closed);
    assert!(pts.len() > 2, "the blank's block holds the finger circle and the outside circle");
}

#[test]
fn ring_blank_carries_into_an_inch_drawing_at_the_right_size() {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 1})).unwrap();
    let r = s.execute("ring", &json!({"at": [0, 0], "size": 6})).unwrap();
    // The block is millimetres; the insert scales it into inches.
    let h = Handle::parse_hex(r["handle"].as_str().unwrap()).unwrap();
    let EntityKind::Insert(ins) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not an insert") };
    assert!((ins.scale.x - 1.0 / 25.4).abs() < 1e-12, "one millimetre in inches");
    assert!((ins.insert.xy().x - 0.0).abs() < 1e-12);
}

#[test]
fn metals_carry_their_densities_and_unknown_names_are_refused() {
    assert_eq!(density_of("gold18"), Some(15.5));
    assert_eq!(density_of("PLATINUM"), Some(20.7));
    assert_eq!(density_of("unobtanium"), None);
    let mut s = mm_drawing();
    assert!(s.execute("ring", &json!({"at": [0, 0], "size": 6, "metal": "unobtanium"})).is_err());
}

// ---------------------------------------------------------------- gems

#[test]
fn a_round_brilliant_weighs_what_the_trade_says() {
    // 6.5 mm round, 4.0 mm deep, diamond: the published 1.00 ct stone.
    let round = gem::cut_of("round").unwrap();
    let ct = gem::carat(round, 6.5, 6.5, 4.0, 3.52);
    assert!((ct - 1.03).abs() < 0.02, "6.5 mm round: {ct} ct");
    // And at the cut's usual depth with no depth given.
    let d = gem::default_depth(round, 6.5);
    assert!((d - 4.0).abs() < 0.01, "usual depth: {d}");
    let auto = gem::carat(round, 6.5, 6.5, d, 3.52);
    assert!((auto - 1.03).abs() < 0.03);
}

#[test]
fn the_elongated_cuts_weigh_by_length_by_width() {
    let cases = [
        ("emerald", 7.0, 5.0, 3.5, 1.13),
        ("marquise", 8.0, 4.0, 2.5, 0.45),
        ("pear", 8.0, 5.0, 3.0, 0.74),
        ("oval", 7.0, 5.0, 3.0, 0.65),
        ("princess", 5.0, 5.0, 3.5, 0.70),
    ];
    for (name, l, w, d, want) in cases {
        let cut = gem::cut_of(name).unwrap();
        let ct = gem::carat(cut, l, w, d, 3.52);
        assert!((ct - want).abs() < 0.05, "{name} {l}×{w}×{d}: {ct} ct (want about {want})");
    }
}

#[test]
fn the_same_stone_in_sapphire_is_heavier() {
    let round = gem::cut_of("round").unwrap();
    let diamond = gem::carat(round, 6.5, 6.5, 4.0, 3.52);
    let sapphire = gem::carat(round, 6.5, 6.5, 4.0, gem::sg_of("sapphire").unwrap());
    assert!(sapphire > diamond * 1.13 && sapphire < diamond * 1.14, "SG 4.00 against 3.52");
}

#[test]
fn a_round_gem_is_a_circle_and_an_oval_is_an_ellipse() {
    let mut s = mm_drawing();
    let r = s.execute("gem", &json!({"at": [0, 0], "cut": "round", "width": 6.5})).unwrap();
    assert_eq!(r["block"], "GEM-ROUND-6.5");
    assert!((r["carat"].as_f64().unwrap() - 1.03).abs() < 0.03);
    let h = Handle::parse_hex(r["handle"].as_str().unwrap()).unwrap();
    let EntityKind::Insert(ins) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not an insert") };
    let blk = s.doc().unwrap().block(&ins.block).unwrap();
    let EntityKind::Circle(c) = &blk.entities.iter().next().unwrap().kind else { panic!("a round is a circle") };
    assert!((c.radius - 3.25).abs() < 1e-9);

    let o = s.execute("gem", &json!({"at": [0, 0], "cut": "oval", "length": 8, "width": 6, "stone": "sapphire"})).unwrap();
    let (pts, closed) = outline_of(&s, o["handle"].as_str().unwrap());
    assert!(closed);
    let area = outline_area(&pts);
    let want = std::f64::consts::PI * 4.0 * 3.0;
    assert!((area - want).abs() < 0.05, "an 8×6 oval: {area} mm² (ellipse {want})");
    // 8×6 at the usual depth of 3.6 mm: 8·6·3.6·4.00·0.0017614 ≈ 1.22 ct (a diamond of the same
    // size is 1.07 ct).
    let ct = o["carat"].as_f64().unwrap();
    assert!((ct - 1.22).abs() < 0.05, "8×6 sapphire: {ct} ct");
}

#[test]
fn a_marquise_is_two_arcs_and_holds_its_tips() {
    let cut = gem::cut_of("marquise").unwrap();
    let EntityKind::LwPolyline(pl) = gem::outline(cut, 8.0, 4.0) else { panic!("a marquise is a polyline") };
    assert_eq!(pl.vertices.len(), 2, "two tips, two arcs");
    assert!(pl.closed);
    assert!(
        pl.vertices.iter().all(|v| v.bulge < -0.4 && v.bulge > -0.6),
        "each arc's bulge: {:?}",
        pl.vertices.iter().map(|v| v.bulge).collect::<Vec<_>>()
    );
    let poly = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true };
    let area = poly.area().abs();
    // The analytic navette: two circular segments of R = 5 mm and a 106.26° arc.
    let want = 2.0 * (25.0 * (1.85459 - 1.85459f64.sin()) / 2.0);
    assert!((area - want).abs() < 0.05, "8×4 marquise: {area} mm² (want {want})");
    let b = poly.bounds();
    assert!((b.max.y - 4.0).abs() < 1e-9 && (b.min.y + 4.0).abs() < 1e-9, "tips at ±4");
    assert!((b.max.x - 2.0).abs() < 1e-9 && (b.min.x + 2.0).abs() < 1e-9, "width 4");
}

#[test]
fn a_pear_holds_its_point_and_its_round_belly() {
    let cut = gem::cut_of("pear").unwrap();
    let EntityKind::LwPolyline(pl) = gem::outline(cut, 8.0, 5.0) else { panic!("a pear is a polyline") };
    assert_eq!(pl.vertices.len(), 3, "the point and the two tangents");
    assert!(pl.vertices[0].p.near(Vec2::new(0.0, 4.0), 1e-9), "the point is at the top");
    let poly = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true };
    let area = poly.area().abs();
    let ellipse = std::f64::consts::PI * 4.0 * 2.5;
    assert!(area > ellipse * 0.75 && area < ellipse, "a pear is slimmer than its ellipse: {area} vs {ellipse}");
    let b = poly.bounds();
    assert!((b.max.y - 4.0).abs() < 1e-9, "the point");
    assert!((b.min.y + 4.0).abs() < 1e-9, "the belly's bottom: a circle of radius 2.5 centred at −1.5");
    assert!((b.max.x - 2.5).abs() < 1e-9, "the widest point is the belly's radius");
}

#[test]
fn a_cushion_has_rounded_corners_and_a_square_is_square() {
    let cushion = gem::cut_of("cushion").unwrap();
    let EntityKind::LwPolyline(pl) = gem::outline(cushion, 6.0, 6.0) else { panic!("a cushion is a polyline") };
    assert!(pl.vertices.iter().filter(|v| v.bulge.abs() > 1e-9).count() == 4, "four rounded corners");
    let area = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true }.area().abs();
    assert!(area < 36.0 && area > 30.0, "a cushion of 6×6: {area} mm²");

    let square = gem::cut_of("princess").unwrap();
    let EntityKind::LwPolyline(pl) = gem::outline(square, 5.0, 5.0) else { panic!("a princess is a polyline") };
    assert_eq!(pl.vertices.len(), 4);
    assert!(pl.vertices.iter().all(|v| v.bulge.abs() < 1e-12), "square corners");
    let area = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true }.area().abs();
    assert!((area - 25.0).abs() < 1e-9);
}

#[test]
fn the_emerald_cut_is_an_octagon_and_its_table_is_a_smaller_one() {
    let cut = gem::cut_of("emerald").unwrap();
    let EntityKind::LwPolyline(pl) = gem::outline(cut, 7.0, 5.0) else { panic!("an emerald is a polyline") };
    assert_eq!(pl.vertices.len(), 8, "four sides with cut corners");
    let area = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true }.area().abs();
    let full = 35.0;
    let corners = 4.0 * 0.5 * 1.0 * 1.0;
    assert!((area - (full - corners)).abs() < 1e-9, "{area} mm² for a 7×5 emerald with 1 mm corners");
}

#[test]
fn gem_refuses_a_hostile_size_and_reports_calibration() {
    let mut s = mm_drawing();
    assert!(s.execute("gem", &json!({"at": [0, 0], "width": -2})).is_err());
    assert!(s.execute("gem", &json!({"at": [0, 0]})).is_err(), "no size at all");
    assert!(s.execute("gem", &json!({"at": [0, 0], "cut": "blob", "width": 2})).is_err());
    let cal = s.execute("gem", &json!({"at": [0, 0], "width": 1.3})).unwrap();
    assert_eq!(cal["calibrated"], json!(true));
    let odd = s.execute("gem", &json!({"at": [0, 0], "width": 1.35})).unwrap();
    assert_eq!(odd["calibrated"], json!(false), "1.35 mm is not a calibrated melee");
    assert!(s.execute("gem", &json!({"at": [0, 0], "width": 2, "stone": "unobtanium"})).is_err());
    assert!(s.execute("gem", &json!({"at": [0, 0], "width": 2, "sg": -1})).is_err());
}

#[test]
fn gemlist_reports_the_cuts_and_the_stones() {
    let mut s = Session::new();
    let r = s.execute("gemlist", &json!({})).unwrap();
    let cuts = r["cuts"].as_array().unwrap();
    assert!(cuts.iter().any(|c| c["name"] == "round" && c["measure"] == "diameter"));
    assert!(cuts.iter().any(|c| c["name"] == "emerald" && c["measure"] == "length×width"));
    assert!(r["stones"].as_array().unwrap().iter().any(|s| s[0] == "diamond" && s[1] == 3.52));
    let only = s.execute("gemlist", &json!({"cut": "marq"})).unwrap();
    assert_eq!(only["cuts"].as_array().unwrap().len(), 1);
}

// ---------------------------------------------------------------- pavé

#[test]
fn pave_fills_a_rectangle_at_the_pitch_the_clearance_gives() {
    let mut s = mm_drawing();
    let region = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(10.0, 0.0), Vec2::new(10.0, 6.0), Vec2::new(0.0, 6.0)]);
    let r = s.execute("pave", &json!({"handles": [region], "stoneWidth": 1.3, "clearance": 0.15})).unwrap();
    // Brick rows on a 1.45 mm pitch: 6 stones on the even rows, 5 on the offset rows (the last
    // would hang over the edge), 4 rows.
    assert_eq!(r["placed"], json!(22), "{r}");
    assert_eq!(r["skipped"]["edge"], json!(2), "one stone per offset row hangs over the edge");
    assert_eq!(r["largestFitting"], json!(3.0), "a 6 mm wide band takes 3 mm melee");
    assert!(r["carat"].as_f64().unwrap() > 0.0);
    // Every stone is a GEM block insert, so the bench sheet can count them.
    let handles = r["handles"].as_array().unwrap();
    assert_eq!(handles.len(), 22);
    for h in handles {
        let h = Handle::parse_hex(h.as_str().unwrap()).unwrap();
        let EntityKind::Insert(ins) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not an insert") };
        assert!(ins.block.starts_with("GEM-ROUND-1.3"));
    }
}

#[test]
fn pave_lays_a_row_along_a_path_at_the_spacing_asked_for() {
    let mut s = mm_drawing();
    let path = s.execute("pline", &json!({"vertices": [[0, 0], [10, 0]]})).unwrap();
    let path = path["handle"].as_str().unwrap().to_string();
    let r = s.execute("pave", &json!({"along": [path], "stoneWidth": 1.3, "clearance": 0.2})).unwrap();
    // Pitch 1.5 over 10 mm: six stones, centred in their slots.
    assert_eq!(r["placed"], json!(6), "{r}");
    let first = Handle::parse_hex(r["handles"][0].as_str().unwrap()).unwrap();
    let EntityKind::Insert(ins) = &s.doc().unwrap().entity(first).unwrap().kind else { panic!("not an insert") };
    assert!((ins.insert.xy().x - 10.0 / 12.0).abs() < 1e-6, "the first stone sits at half a pitch");
    // A count places exactly that many, evenly spaced.
    let c = s.execute("pave", &json!({"along": [path], "stoneWidth": 1.3, "count": 9})).unwrap();
    assert_eq!(c["placed"], json!(9));
}

#[test]
fn pave_skips_the_hole_in_a_ring() {
    let mut s = mm_drawing();
    let outer = polyline(&mut s, &[Vec2::new(-10.0, -10.0), Vec2::new(10.0, -10.0), Vec2::new(10.0, 10.0), Vec2::new(-10.0, 10.0)]);
    let inner = polyline(&mut s, &[Vec2::new(-4.0, -4.0), Vec2::new(4.0, -4.0), Vec2::new(4.0, 4.0), Vec2::new(-4.0, 4.0)]);
    let r = s.execute("pave", &json!({"handles": [outer, inner], "stoneWidth": 1.0, "clearance": 0.15})).unwrap();
    let placed = r["placed"].as_u64().unwrap();
    // The metal's area is 400 − 64 = 336 mm²; at pitch 1.15 the ring holds far fewer stones than
    // the 400 mm² square alone would, and none of them is inside the hole.
    let whole = s.execute("gemfit", &json!({"handles": [outer, inner], "cut": "round"})).unwrap();
    let single = s.execute("gemfit", &json!({"handles": [outer], "cut": "round"})).unwrap();
    let (ring_fit, square_fit) = (whole["fits"][0]["count"].as_u64().unwrap(), single["fits"][0]["count"].as_u64().unwrap());
    assert!(ring_fit < square_fit, "the hole is not filled: {ring_fit} < {square_fit}");
    for h in r["handles"].as_array().unwrap() {
        let h = Handle::parse_hex(h.as_str().unwrap()).unwrap();
        let EntityKind::Insert(ins) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not an insert") };
        let p = ins.insert.xy();
        assert!(p.x.abs() > 4.0 - 0.5 || p.y.abs() > 4.0 - 0.5, "a stone at {p:?} is in the hole");
    }
    let _ = placed;
}

#[test]
fn gemfit_names_the_largest_melee_a_region_takes() {
    let mut s = mm_drawing();
    let band = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(20.0, 0.0), Vec2::new(20.0, 2.5), Vec2::new(0.0, 2.5)]);
    let r = s.execute("gemfit", &json!({"handles": [band], "clearance": 0.15})).unwrap();
    assert_eq!(r["largestFitting"], json!(2.2), "2.5 mm wide less two clearances");
    let fits = r["fits"].as_array().unwrap();
    assert_eq!(fits.len(), 15, "every calibrated size that fits is reported");
    assert_eq!(fits[0]["mm"], json!(2.2), "largest first");
    assert!(fits[0]["count"].as_u64().unwrap() > 0);
    assert!(fits.iter().all(|f| f["count"].as_u64().is_some()));
}

#[test]
fn pave_refuses_hostile_input() {
    let mut s = mm_drawing();
    assert!(s.execute("pave", &json!({"handles": []})).is_err(), "nothing to fill");
    assert!(s.execute("pave", &json!({"along": ["not-a-handle"], "stoneWidth": 1.3})).is_err());
    assert!(s.execute("pave", &json!({"handles": ["zz"], "stoneWidth": 1.3})).is_err());
    assert!(s.execute("pave", &json!({"handles": [], "stoneWidth": -1.3})).is_err());
    let line = s.execute("pline", &json!({"vertices": [[0, 0], [5, 0]]})).unwrap();
    let line = line["handle"].as_str().unwrap().to_string();
    // An open path is not a region.
    assert!(s.execute("pave", &json!({"handles": [line], "stoneWidth": 1.3})).is_err());
}

#[test]
fn region_fill_keeps_stones_clear_of_the_edge() {
    // The fill's own arithmetic, without a drawing: a 4×4 square takes 2 mm stones on a 2.15
    // pitch with 0.15 clearance and none may hang over.
    let loop_pts = vec![Vec2::new(-2.0, -2.0), Vec2::new(2.0, -2.0), Vec2::new(2.0, 2.0), Vec2::new(-2.0, 2.0)];
    let region = Region { loops: vec![loop_pts], bounds: cadcraft_geom::Bounds2::new(Vec2::new(-2.0, -2.0), Vec2::new(2.0, 2.0)) };
    let fill = fill_for_test(&region, 2.0, 0.15, 0.0, true);
    assert_eq!(fill.stones.len(), 1, "one 2 mm stone fits a 4 mm square with clearance: {:?}", fill.stones);
    assert!(fill.stones[0].0.near(Vec2::ZERO, 1e-9));
    assert!(max_inscribed(&region) - 2.0 < 1e-6, "the inscribed circle of a 4×4 square is 2 mm");
}

// ---------------------------------------------------------------- settings

#[test]
fn prongs_sit_on_a_marquises_tips_and_shoulders() {
    let mut s = mm_drawing();
    let g = s.execute("gem", &json!({"at": [0, 0], "cut": "marquise", "length": 8, "width": 4})).unwrap();
    let target = setting::target_of(&s, "setting", &json!({"handle": g["handle"]})).unwrap();
    let sites = setting::prong_sites(&target, None).unwrap();
    assert_eq!(sites.len(), 4, "a marquise is set with four prongs");
    let near = |p: Vec2, q: Vec2| p.dist(q) < 0.1;
    assert!(sites.iter().any(|p| near(*p, Vec2::new(0.0, 4.0))), "a tip: {sites:?}");
    assert!(sites.iter().any(|p| near(*p, Vec2::new(0.0, -4.0))), "the other tip: {sites:?}");
    // The shoulders are the points on the arcs furthest from the tips: near the widest points.
    assert_eq!(sites.iter().filter(|p| p.x.abs() > 1.9).count(), 2, "the shoulders: {sites:?}");
}

#[test]
fn prongs_on_a_round_are_evenly_spaced() {
    let mut s = mm_drawing();
    let g = s.execute("gem", &json!({"at": [0, 0], "width": 1.3})).unwrap();
    let target = setting::target_of(&s, "setting", &json!({"handle": g["handle"]})).unwrap();
    let sites = setting::prong_sites(&target, None).unwrap();
    assert_eq!(sites.len(), 6, "a round takes six claws");
    for p in &sites {
        assert!((p.len() - 0.65).abs() < 1e-3, "on the girdle: {p:?}");
    }
    for i in 0..sites.len() {
        let a = sites[i];
        let b = sites[(i + 1) % sites.len()];
        let step = (b - a).len();
        assert!((step - 0.65).abs() < 1e-3, "equal spacing: {step}");
    }
    let three = setting::prong_sites(&target, Some(3)).unwrap();
    assert_eq!(three.len(), 3);
}

#[test]
fn a_setting_is_built_on_the_stone() {
    let mut s = mm_drawing();
    let g = s.execute("gem", &json!({"at": [5, 5], "cut": "oval", "length": 8, "width": 6})).unwrap();
    let r = s.execute("setting", &json!({"handle": g["handle"], "style": "bezel", "wall": 1.0})).unwrap();
    assert_eq!(r["handles"].as_array().unwrap().len(), 2, "the wall and the seat line");
    let h = Handle::parse_hex(r["handles"][0].as_str().unwrap()).unwrap();
    let EntityKind::LwPolyline(pl) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("a bezel is a polyline") };
    assert!(pl.closed);
    let area = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true }.area().abs();
    // The wall adds a 1 mm rim around an 8×6 oval: about the ellipse's area plus its perimeter.
    // The wall adds a 1 mm rim to an 8×6 oval: π·5·4 ≈ 63 mm².
    assert!(area > 58.0 && area < 68.0, "bezel wall area {area} mm²");

    let p = s.execute("setting", &json!({"handle": g["handle"], "style": "prong", "prongs": 4})).unwrap();
    assert_eq!(p["prongs"], json!(4));
    for c in p["handles"].as_array().unwrap() {
        let h = Handle::parse_hex(c.as_str().unwrap()).unwrap();
        let EntityKind::Circle(c) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("a prong is a circle") };
        assert!((c.radius - 0.4).abs() < 1e-9, "0.8 mm prongs");
    }
}

#[test]
fn a_halo_is_melee_around_the_girdle() {
    let mut s = mm_drawing();
    let g = s.execute("gem", &json!({"at": [0, 0], "cut": "round", "width": 6.5})).unwrap();
    let r = s.execute("setting", &json!({"handle": g["handle"], "style": "halo", "stoneWidth": 1.3, "gap": 0.2})).unwrap();
    let n = r["stones"].as_u64().unwrap();
    // The ring of melee runs at 3.25 + 0.2 + 0.65 = 4.1 mm radius: 2π·4.1 / 1.45 ≈ 17.7 stones.
    assert!((16..=19).contains(&n), "a halo of 1.3 mm melee around a 6.5 mm stone: {n} stones");
    assert!(r["carat"].as_f64().unwrap() > 0.1);
    // And the melee sits outside the stone.
    for h in r["handles"].as_array().unwrap() {
        let h = Handle::parse_hex(h.as_str().unwrap()).unwrap();
        let EntityKind::Insert(ins) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not an insert") };
        assert!(ins.insert.xy().len() > 3.4, "outside the girdle: {:?}", ins.insert.xy());
    }
}

// ---------------------------------------------------------------- bench sheet

#[test]
fn the_bench_sheet_counts_the_stones_of_the_drawing() {
    let mut s = mm_drawing();
    s.execute("gem", &json!({"at": [0, 0], "width": 1.3})).unwrap();
    s.execute("gem", &json!({"at": [2, 0], "width": 1.3})).unwrap();
    s.execute("gem", &json!({"at": [4, 0], "width": 1.3, "stone": "sapphire"})).unwrap();
    s.execute("gem", &json!({"at": [0, 4], "cut": "emerald", "length": 7, "width": 5, "stone": "emerald"})).unwrap();
    let r = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(r["stones"]["count"], json!(4));
    let groups = r["stones"]["groups"].as_array().unwrap();
    let diamond = groups.iter().find(|g| g["cut"] == "round" && g["sg"] == json!(3.52)).unwrap_or_else(|| panic!("{r}"));
    assert_eq!(diamond["count"], json!(2), "two 1.3 mm diamonds");
    assert_eq!(diamond["depthFrom"], "block", "the stone's own description is read back");
    let sapphire = groups.iter().find(|g| g["sg"] == json!(4.0)).unwrap();
    assert_eq!(sapphire["count"], json!(1));
    let emerald = groups.iter().find(|g| g["cut"] == "emerald").unwrap();
    assert!((emerald["caratEach"].as_f64().unwrap() - 0.79).abs() < 0.05, "7×5 emerald: {emerald}");
    assert!(r["stones"]["carat"].as_f64().unwrap() > 0.8);
    assert!(r["warnings"].as_array().unwrap().is_empty());
    assert!(r["message"].as_str().unwrap().contains("stones"));
}

#[test]
fn the_bench_sheet_weighs_a_band_by_pappus() {
    let mut s = mm_drawing();
    // A 2.0 × 1.8 mm cross-section, its outer face 2.0 mm from the finger's surface, for a
    // size 6 finger (16.51 mm inside diameter, so a 8.255 mm inside radius).
    let section = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(1.8, 0.0), Vec2::new(1.8, 2.0), Vec2::new(0.0, 2.0)]);
    let r = s.execute("techsheet", &json!({"section": section, "size": 6, "metal": "gold18"})).unwrap();
    let m = &r["metal"];
    assert!((m["sectionArea"].as_f64().unwrap() - 3.6).abs() < 1e-6, "1.8 × 2.0 mm");
    // The centroid is 0.9 mm out from the finger's surface: 8.255 + 0.9 = 9.155 mm.
    assert!((m["centroidFromAxis"].as_f64().unwrap() - 9.155).abs() < 0.02);
    // V = 2π·9.155·3.6 = 207.1 mm³; at 15.5 g/cm³ that is 3.21 g.
    let want = 2.0 * std::f64::consts::PI * 9.155 * 3.6 / 1000.0 * 15.5;
    assert!((m["grams"].as_f64().unwrap() - want).abs() < 0.02, "grams {} want {want}", m["grams"]);
    assert!(r["message"].as_str().unwrap().contains("18"));
    // A radius works just as well, and an unknown metal is refused.
    let r2 = s.execute("techsheet", &json!({"section": section, "radius": 8.255})).unwrap();
    assert!((r2["metal"]["grams"].as_f64().unwrap() - want).abs() < 0.02);
    assert!(s.execute("techsheet", &json!({"section": section, "radius": 8.255, "metal": "unobtanium"})).is_err());
    assert!(s.execute("techsheet", &json!({"section": section})).is_err(), "no size and no radius");
}

#[test]
fn the_bench_sheet_can_write_itself_into_the_drawing() {
    let mut s = mm_drawing();
    s.execute("gem", &json!({"at": [0, 0], "width": 1.3})).unwrap();
    let r = s.execute("techsheet", &json!({"table": true, "at": [20, 20]})).unwrap();
    let h = Handle::parse_hex(r["table"].as_str().unwrap()).unwrap();
    let EntityKind::Table(t) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not a table") };
    assert!(t.cells.len() > 1, "a header row and at least one stone row");
    assert!(r["message"].as_str().unwrap().contains("1.3"));
}

#[test]
fn the_bench_sheet_flags_a_block_whose_description_disagrees_with_its_name() {
    let mut s = mm_drawing();
    s.execute("gem", &json!({"at": [0, 0], "width": 1.3})).unwrap();
    let b = s.doc_mut().unwrap().blocks.get_mut("GEM-ROUND-1.3").unwrap();
    std::sync::Arc::make_mut(b).description = "gem: cut=oval, mm=6x4, depth=3.6, sg=3.52, ct=0.79".into();
    let r = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(r["stones"]["count"], json!(1), "counted by its name");
    assert_eq!(r["warnings"].as_array().unwrap().len(), 1, "{r}");
    assert!(r["warnings"][0].as_str().unwrap().contains("counted by the name"));
}

// ---------------------------------------------------------------- unit conversions

#[test]
fn millimetres_are_read_through_insunits() {
    let mut s = Session::new();
    assert_eq!(mm_per_unit(&s), 25.4, "a new drawing is inches, as AutoCAD's own template");
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 0})).unwrap();
    assert_eq!(mm_per_unit(&s), 1.0, "a unitless drawing reads as millimetres");
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    assert_eq!(mm_per_unit(&s), 1.0);
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 1})).unwrap();
    assert_eq!(mm_per_unit(&s), 25.4);
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 5})).unwrap();
    assert_eq!(mm_per_unit(&s), 10.0);
}

#[test]
fn the_block_name_round_trips_a_stone() {
    assert_eq!(gem_block_name("round", 1.3, 1.3, None, None, None), "GEM-ROUND-1.3");
    assert_eq!(gem_block_name("emerald", 7.0, 5.0, None, None, None), "GEM-EMERALD-7x5");
    assert_eq!(gem_block_name("round", 1.3, 1.3, Some("sapphire"), None, None), "GEM-ROUND-1.3-SAPPHIRE");
    assert_eq!(gem_block_name("oval", 8.0, 6.0, None, Some(4.2), Some(4.1)), "GEM-OVAL-8x6-SG4.2-D4.1");
    let name = parse_gem_block("GEM-EMERALD-7x5").unwrap();
    assert_eq!(name.cut, "emerald");
    assert!((name.length - 7.0).abs() < 1e-9 && (name.width - 5.0).abs() < 1e-9);
    assert_eq!(name.material, None);
    let round = parse_gem_block("GEM-ROUND-1.3").unwrap();
    assert!((round.length - 1.3).abs() < 1e-9 && (round.width - 1.3).abs() < 1e-9);
    let sapphire = parse_gem_block("GEM-ROUND-1.3-SAPPHIRE").unwrap();
    assert_eq!(sapphire.material.as_deref(), Some("sapphire"));
    assert_eq!(sapphire.sg, None);
    let custom = parse_gem_block("GEM-OVAL-8x6-SG4.2-D4.1").unwrap();
    assert_eq!(custom.sg, Some(4.2));
    assert_eq!(custom.depth, Some(4.1));
    assert!(parse_gem_block("WING-1.3").is_none());
    assert!(parse_gem_block("GEM-ROUND-").is_none());
    assert!(parse_gem_block("GEM-ROUND--2").is_none());
    assert!(parse_gem_block("GEM-ROUND-1.3-SGzz").is_none());
}

#[test]
fn the_description_round_trips_a_stone() {
    let line = gem_description("oval", 8.0, 6.0, 3.6, 4.0, 1.41);
    let meta = parse_gem_description(&format!("A hand-written note.\n{line}\n")).unwrap();
    assert_eq!(meta.cut, "oval");
    assert!((meta.length - 8.0).abs() < 1e-9 && (meta.width - 6.0).abs() < 1e-9);
    assert!((meta.depth - 3.6).abs() < 1e-9);
    assert_eq!(meta.sg, 4.0);
    assert!((meta.carat - 1.41).abs() < 1e-5);
    assert!(parse_gem_description("no gem line here").is_none());
}

#[test]
fn calibrated_melee_is_the_trade_list() {
    assert_eq!(calibrated(1.3), Some(1.3));
    assert_eq!(calibrated(1.35), None);
    assert_eq!(largest_fitting(6.0, 0.15), Some(3.0), "a 6 mm band takes 3 mm melee");
    assert_eq!(largest_fitting(3.0, 0.15), Some(2.7), "and a 3 mm band 2.7 mm");
    assert_eq!(largest_fitting(1.0, 0.15), None, "nothing fits with 0.3 mm of clearance");
}

#[test]
fn every_cut_draws_a_closed_outline_of_the_size_asked_for() {
    for cut in CUTS {
        let (l, w) = if cut.name == "round" { (6.0, 6.0) } else { (8.0, 5.0) };
        let kind = gem::outline(cut, l, w);
        let (pts, closed) = match &kind {
            EntityKind::Circle(_) => (Vec::new(), true),
            EntityKind::Ellipse(_) => (Vec::new(), true),
            _ => entity_loop(&cadcraft_doc::Entity::new(Handle(1), kind.clone()), 1.0).unwrap(),
        };
        assert!(closed, "{} is closed", cut.name);
        if !pts.is_empty() {
            let b = cadcraft_geom::Bounds2::from_points(pts.iter().copied());
            assert!((b.max.x - b.min.x - w).abs() < 0.05, "{} is {w} wide: {:?}", cut.name, b);
            assert!((b.max.y - b.min.y - l).abs() < 0.05, "{} is {l} long: {:?}", cut.name, b);
            let area = outline_area(&pts);
            let ellipse = std::f64::consts::PI * l / 2.0 * w / 2.0;
            assert!(area > ellipse * 0.4 && area < ellipse * 1.4, "{}: {area} mm² against its ellipse {ellipse}", cut.name);
        }
        // A weight for every cut, at a size the trade sells.
        let ct = gem::carat(cut, l, w, gem::default_depth(cut, w), 3.52);
        assert!(ct > 0.0 && ct < 5.0, "{}: {ct} ct", cut.name);
    }
}

#[test]
fn jewelry_commands_are_registered_with_their_prompts() {
    let ids = command_specs().iter().map(|c| c.id.to_string()).collect::<Vec<_>>();
    for want in ["ringsizes", "ring", "gem", "gemlist", "pave", "gemfit", "setting", "techsheet"] {
        assert!(ids.iter().any(|i| i == want), "{want} is missing");
    }
    // Run with no parameters they refuse (or answer an empty sheet), never panic.
    let mut s = Session::new();
    for id in ["ring", "gem", "pave", "gemfit", "setting"] {
        let r = s.execute(id, &json!({}));
        assert!(r.is_err(), "{id} with no parameters");
    }
    let empty = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(empty["stones"]["count"], json!(0), "an empty drawing has an empty sheet");
    let _: Value = s.execute("ringsizes", &json!({})).unwrap();
}

#[test]
fn describe_reads_the_drawing_as_jewelry() {
    let mut s = mm_drawing();
    s.execute("gem", &json!({"at": [0, 0], "width": 1.3})).unwrap();
    s.execute("gem", &json!({"at": [2, 0], "cut": "oval", "length": 6, "width": 4, "stone": "sapphire"})).unwrap();
    s.execute("ring", &json!({"at": [0, 20], "size": 6})).unwrap();
    let r = s.execute("describe", &json!({})).unwrap();
    let j = &r["jewelry"];
    assert_eq!(j["stones"]["count"], json!(2), "{r}");
    assert_eq!(j["stones"]["groups"].as_array().unwrap().len(), 2);
    let sapphire = j["stones"]["groups"].as_array().unwrap().iter().find(|g| g["cut"] == "oval").unwrap();
    assert_eq!(sapphire["sg"], json!(4.0), "the material comes from the block name");
    assert_eq!(sapphire["depthFrom"], "block", "and the depth from the block's own record");
    // 6×4 at the usual depth in sapphire: 6·4·2.4·4.00·0.0017614 ≈ 0.41 ct.
    assert!((sapphire["caratEach"].as_f64().unwrap() - 0.41).abs() < 0.05, "{sapphire}");
    assert_eq!(j["bands"].as_array().unwrap().len(), 1);
    assert_eq!(j["bands"][0]["metal"], "gold18");
    assert!(j["bands"][0]["grams"].as_f64().unwrap() > 3.0);
    let message = r["message"].as_str().unwrap();
    assert!(message.contains("stone(s)"), "{message}");
    assert!(message.contains("size US 6 band"), "{message}");
}

// ---------------------------------------------------------------- the sample

#[test]
fn the_solitaire_sample_reads_back_on_the_bench_sheet() {
    let mut s = Session::empty();
    s.open_drawing(crate::sample::solitaire(), "Solitaire", None);
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    let count = sheet["stones"]["count"].as_u64().unwrap();
    // The centre stone, its halo and the shank's row.
    assert!(count > 20, "stones on the sheet: {sheet}");
    let groups = sheet["stones"]["groups"].as_array().unwrap();
    assert!(
        groups.iter().any(|g| g["mm"].as_str().is_some_and(|m| m.contains("6.5")) || g["width"].as_f64() == Some(6.5)),
        "the centre stone is on the sheet: {sheet}"
    );
    assert!(sheet["stones"]["carat"].as_f64().unwrap() > 1.0, "the centre stone alone is over a carat: {sheet}");
    // The band RING drew is on the sheet with its weight.
    let bands = sheet["bands"].as_array().unwrap();
    assert_eq!(bands.len(), 1, "one band: {sheet}");
    assert_eq!(bands[0]["size"].as_str(), Some("US 6"));
    assert!((bands[0]["grams"].as_f64().unwrap() - 3.86).abs() < 0.01, "the band's weight: {sheet}");
    assert!(sheet["message"].as_str().unwrap().contains("band US 6"), "{sheet}");
    // Each line of the sheet names its own stones, and the band its insert, so a reader can
    // find the line on the drawing.
    for g in groups {
        let handles = g["handles"].as_array().unwrap();
        assert_eq!(handles.len() as u64, g["count"].as_u64().unwrap(), "{g}");
        for h in handles {
            let h = Handle::parse_hex(h.as_str().unwrap()).unwrap();
            assert!(matches!(s.doc().unwrap().entity(h).unwrap().kind, EntityKind::Insert(_)));
        }
    }
    assert!(bands[0]["handle"].as_str().is_some_and(|h| Handle::parse_hex(h).is_some()), "{sheet}");
    assert_eq!(s.doc().unwrap().header.i64("INSUNITS", 0), 4);
}
#[test]
fn a_stone_named_diamond_is_still_a_stone() {
    // `DIAMOND` begins with the depth token's letter: it read as a depth that would not parse,
    // so SETTING refused the stone and the bench sheet did not count it.
    assert_eq!(parse_gem_block("GEM-ROUND-6.5-DIAMOND").unwrap().material.as_deref(), Some("diamond"));
    assert_eq!(parse_gem_block("GEM-ROUND-6.5-DIOPSIDE-D4.1").unwrap().depth, Some(4.1));
    let mut s = mm_drawing();
    let named = s.execute("gem", &json!({"at": [0, 0], "diameter": 6.5, "stone": "diamond"})).unwrap();
    let plain = s.execute("gem", &json!({"at": [20, 0], "diameter": 6.5})).unwrap();
    assert_eq!(named["block"], plain["block"], "diamond is the default: one block either way");
    let h = named["handle"].as_str().unwrap();
    let prongs = s.execute("setting", &json!({"handle": h, "style": "prong"})).unwrap();
    assert!(prongs["handles"].as_array().is_some_and(|a| !a.is_empty()), "prongs on the stone: {prongs}");
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"].as_u64(), Some(2), "both stones are counted: {sheet}");
}

#[test]
fn an_empty_bench_sheet_has_no_negative_zero() {
    let mut s = mm_drawing();
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert!(!sheet["message"].as_str().unwrap().contains("-0"), "{sheet}");
}

// ---------------------------------------------------------------- settings and pavé in place

/// The centre of an insert, in drawing units.
fn insert_at(s: &Session, handle: &Value) -> Vec2 {
    let h = Handle::parse_hex(handle.as_str().unwrap()).unwrap();
    match &s.doc().unwrap().entity(h).unwrap().kind {
        EntityKind::Insert(ins) => ins.insert.xy(),
        EntityKind::Circle(c) => c.center.xy(),
        other => panic!("not an insert or a circle: {other:?}"),
    }
}

#[test]
fn a_halo_and_prongs_follow_a_stone_that_is_not_at_the_origin() {
    // The halo was laid around the origin whatever the stone's place: a stone at 30,0 got its
    // melee 30 mm away.
    let mut s = mm_drawing();
    let g = s.execute("gem", &json!({"at": [30, 10], "cut": "round", "width": 6.5, "rotate": 30})).unwrap();
    let centre = Vec2::new(30.0, 10.0);
    let halo = s.execute("setting", &json!({"handle": g["handle"], "style": "halo", "stoneWidth": 1.3, "gap": 0.2})).unwrap();
    assert!(halo["stones"].as_u64().unwrap() >= 16, "{halo}");
    for h in halo["handles"].as_array().unwrap() {
        let d = (insert_at(&s, h) - centre).len();
        assert!((d - 4.1).abs() < 0.05, "a halo stone sits 4.1 mm from the stone's centre, not {d}");
    }
    let prongs = s.execute("setting", &json!({"handle": g["handle"], "style": "prong", "prongs": 6})).unwrap();
    for h in prongs["handles"].as_array().unwrap() {
        let d = (insert_at(&s, h) - centre).len();
        assert!((d - 3.25).abs() < 0.05, "a prong sits on the girdle, not {d} mm out");
    }
}

#[test]
fn settings_and_pave_keep_their_place_in_an_inch_drawing() {
    let mut s = Session::new();
    assert_eq!(mm_per_unit(&s), 25.4);
    let k = 25.4;
    // A 6.5 mm stone one inch right of the origin.
    let g = s.execute("gem", &json!({"at": [1, 0], "cut": "round", "width": 6.5})).unwrap();
    let centre = Vec2::new(1.0, 0.0);
    let prongs = s.execute("setting", &json!({"handle": g["handle"], "style": "prong", "prongs": 4})).unwrap();
    for h in prongs["handles"].as_array().unwrap() {
        let d = (insert_at(&s, h) - centre).len() * k;
        assert!((d - 3.25).abs() < 0.05, "a prong sits on the girdle: {d} mm out");
    }
    let halo = s.execute("setting", &json!({"handle": g["handle"], "style": "halo", "stoneWidth": 1.3, "gap": 0.2})).unwrap();
    for h in halo["handles"].as_array().unwrap() {
        let d = (insert_at(&s, h) - centre).len() * k;
        assert!((d - 4.1).abs() < 0.05, "a halo stone sits 4.1 mm out: {d}");
    }
    // A strip 24 × 2.4 mm, drawn in inches, takes its row of melee inside itself.
    let (w, h) = (24.0 / k, 2.4 / k);
    let strip = polyline(&mut s, &[Vec2::new(3.0, 0.0), Vec2::new(3.0 + w, 0.0), Vec2::new(3.0 + w, h), Vec2::new(3.0, h)]);
    let pave = s.execute("pave", &json!({"handles": [strip], "pattern": "grid", "stoneWidth": 1.5})).unwrap();
    assert!(pave["placed"].as_u64().unwrap() >= 10, "{pave}");
    for st in pave["handles"].as_array().unwrap() {
        let at = insert_at(&s, st);
        assert!(at.x > 3.0 && at.x < 3.0 + w && at.y > 0.0 && at.y < h, "a stone inside the strip: {at:?}");
    }
    // And a row along a line one inch long.
    let line = s.execute("line", &json!({"points": [[0, 2], [1, 2]]})).unwrap();
    let path = line["handle"].as_str().or_else(|| line["handles"][0].as_str()).unwrap().to_string();
    let row = s.execute("pave", &json!({"along": [path], "stoneWidth": 1.5})).unwrap();
    assert!(row["placed"].as_u64().unwrap() >= 10, "{row}");
    for st in row["handles"].as_array().unwrap() {
        let at = insert_at(&s, st);
        assert!(at.x > 0.0 && at.x < 1.0 && (at.y - 2.0).abs() < 1e-6, "a stone on the line: {at:?}");
    }
}

// ---------------------------------------------------------------- measuring a ring (J4)

pub(super) fn handle_of(r: &Value) -> String {
    r["handle"].as_str().unwrap_or_else(|| r["handles"][0].as_str().unwrap()).to_string()
}

pub(super) fn circle(s: &mut Session, centre: [f64; 2], radius: f64) -> String {
    handle_of(&s.execute("circle", &json!({"center": centre, "radius": radius})).unwrap())
}

#[test]
fn ringsizes_measures_a_drawn_circle() {
    let mut s = mm_drawing();
    // US 6 is 16.51 mm inside (0.8128 × 6 + 11.63 = 16.5068).
    let c = circle(&mut s, [5.0, 5.0], 8.255);
    let r = s.execute("ringsizes", &json!({"handle": c})).unwrap();
    assert_eq!(r["count"], json!(1));
    let m = &r["measured"];
    assert_eq!(m["from"], "circle");
    assert_eq!(m["handle"], json!(c));
    assert_eq!(m["diameter"], json!(16.51));
    assert_eq!(r["sizes"][0]["usText"], "6");
    assert_eq!(r["sizes"][0]["uk"], "L");
    assert_eq!(r["sizes"][0]["eu"], json!(52));
    assert_eq!(m["nearest"]["size"], "6");
    assert_eq!(m["nearest"]["system"], "us");
    assert_eq!(m["offBy"], json!(0.003), "16.51 less 16.5068");
    assert_eq!(m["nearestIn"]["uk"]["size"], "L");
    assert_eq!(m["nearestIn"]["eu"]["size"], "52");
    assert!(m.get("wall").is_none() && m.get("outOfRound").is_none(), "{m}");
    assert!(r["message"].as_str().unwrap().contains("nearest US 6"), "{r}");

    // 16.7 mm is between sizes: (16.7 − 11.63) / 0.8128 = 6.24, so 6¼ (16.71 mm), 0.01 under.
    let between = circle(&mut s, [40.0, 0.0], 8.35);
    let r = s.execute("ringsizes", &json!({"handles": [between]})).unwrap();
    assert_eq!(r["measured"]["nearest"]["size"], "6¼");
    assert_eq!(r["measured"]["offBy"], json!(-0.01));
    assert!(r["message"].as_str().unwrap().contains("0.01 mm under"), "{r}");
    // In the system asked for: EU sizes are whole millimetres of circumference (52.46 → 52).
    let eu = s.execute("ringsizes", &json!({"handle": between, "system": "eu"})).unwrap();
    assert_eq!(eu["measured"]["nearest"]["size"], "52");
    assert_eq!(eu["measured"]["nearest"]["system"], "eu");
    assert!((eu["measured"]["offBy"].as_f64().unwrap() - (16.7 - 52.0 / std::f64::consts::PI)).abs() < 1e-3);
    // The table is still the table.
    assert_eq!(s.execute("ringsizes", &json!({})).unwrap()["count"], json!(11));
}

#[test]
fn ringsizes_measures_in_millimetres_whatever_the_drawing_units() {
    let mut s = Session::new();
    assert_eq!(mm_per_unit(&s), 25.4);
    let c = circle(&mut s, [1.0, 1.0], 8.255 / 25.4);
    let r = s.execute("ringsizes", &json!({"handle": c})).unwrap();
    assert_eq!(r["measured"]["diameter"], json!(16.51));
    assert_eq!(r["measured"]["nearest"]["size"], "6");
    // And the blank RING drew reads back: the size plus its 0.02 mm sizing allowance each side.
    let ring = s.execute("ring", &json!({"at": [3, 0], "size": 6, "wall": 1.8})).unwrap();
    let r = s.execute("ringsizes", &json!({"handle": ring["handle"]})).unwrap();
    let m = &r["measured"];
    assert_eq!(m["from"], "ring");
    assert_eq!(m["diameter"], json!(16.547));
    assert_eq!(m["nearest"]["size"], "6");
    assert_eq!(m["offBy"], json!(0.04));
    assert_eq!(m["wall"], json!(1.8), "the blank's outside circle: {m}");
}

#[test]
fn of_two_concentric_circles_the_inside_one_is_the_finger() {
    let mut s = mm_drawing();
    let inner = circle(&mut s, [0.0, 0.0], 8.255);
    let outer = circle(&mut s, [0.0, 0.0], 10.055);
    for order in [[&outer, &inner], [&inner, &outer]] {
        let r = s.execute("ringsizes", &json!({"handles": order})).unwrap();
        assert_eq!(r["measured"]["handle"], json!(inner));
        assert_eq!(r["measured"]["diameter"], json!(16.51));
        assert_eq!(r["measured"]["wall"], json!(1.8));
    }
    // Two arcs that make the hole measure as it does.
    let a = handle_of(&s.execute("arc", &json!({"center": [50, 0], "radius": 8.255, "start": 0, "end": 180})).unwrap());
    let b = handle_of(&s.execute("arc", &json!({"center": [50, 0], "radius": 8.255, "start": 180, "end": 360})).unwrap());
    let r = s.execute("ringsizes", &json!({"handles": [a, b]})).unwrap();
    assert_eq!(r["measured"]["from"], "arc");
    assert_eq!(r["measured"]["diameter"], json!(16.51));
    assert!(r["measured"].get("wall").is_none());
    // Circles that are not one ring are not chosen between.
    let elsewhere = circle(&mut s, [30.0, 0.0], 9.0);
    let e = s.execute("ringsizes", &json!({"handles": [inner, elsewhere]})).unwrap_err();
    assert!(e.to_string().contains("do not share a centre"), "{e}");
}

#[test]
fn a_hole_that_is_not_a_circle_is_sized_by_its_perimeter() {
    let mut s = mm_drawing();
    // A 64-sided hole on the 16.51 mm circle: its perimeter is 64 · 2 · 8.255 · sin(π/64) =
    // 51.847 mm, so 16.503 mm.
    let pts: Vec<Vec2> = (0..64).map(|i| Vec2::polar(Vec2::new(3.0, 4.0), 8.255, std::f64::consts::TAU * f64::from(i) / 64.0)).collect();
    let poly = polyline(&mut s, &pts);
    let r = s.execute("ringsizes", &json!({"handle": poly})).unwrap();
    let m = &r["measured"];
    assert_eq!(m["from"], "polyline");
    assert!((m["diameter"].as_f64().unwrap() - 16.503).abs() < 0.002, "{m}");
    assert_eq!(m["nearest"]["size"], "6");
    assert!(m.get("outOfRound").is_none_or(|v| v.as_f64().unwrap() < 0.05), "{m}");
    // A 17 × 16 mm ellipse: perimeter 51.85 mm (Ramanujan), so 16.504 mm, and 1 mm out of round.
    let e = handle_of(&s.execute("ellipse", &json!({"center": [40, 0], "major": [8.5, 0], "ratio": 8.0 / 8.5})).unwrap());
    let r = s.execute("ringsizes", &json!({"handle": e})).unwrap();
    let m = &r["measured"];
    assert_eq!(m["from"], "ellipse");
    assert!((m["diameter"].as_f64().unwrap() - 16.504).abs() < 0.002, "{m}");
    assert!((m["outOfRound"].as_f64().unwrap() - 1.0).abs() < 0.01, "{m}");
    assert!(r["message"].as_str().unwrap().contains("out of round"), "{r}");
}

#[test]
fn ringsizes_refuses_what_it_cannot_measure() {
    let mut s = mm_drawing();
    let fine = circle(&mut s, [0.0, 0.0], 8.255);
    // Outside the trade's range: refused as RING refuses it, never clamped to the nearest size.
    for radius in [3.0, 5.79, 12.51, 40.0, 1e-6, 1e12] {
        let c = circle(&mut s, [0.0, 0.0], radius);
        let e = s.execute("ringsizes", &json!({"handle": c})).unwrap_err();
        assert!(e.to_string().contains("outside the ring sizes"), "{radius}: {e}");
    }
    // Not an object, not a handle, not a hole.
    let line = handle_of(&s.execute("line", &json!({"points": [[0, 0], [16, 0]]})).unwrap());
    let open = s.execute("pline", &json!({"vertices": [[0, 0], [16, 0], [16, 16]]})).unwrap();
    let half = handle_of(&s.execute("ellipse", &json!({"center": [0, 0], "major": [8.5, 0], "ratio": 0.9, "start": 0, "end": 180})).unwrap());
    let stone = s.execute("gem", &json!({"at": [0, 0], "diameter": 16.5})).unwrap();
    let flat = s.execute("pline", &json!({"vertices": [[0, 0], [16, 0], [32, 0]], "closed": true})).unwrap();
    for bad in [
        json!({"handle": "FFFFFF"}),
        json!({"handle": "zz"}),
        json!({"handle": 1e308}),
        json!({"handle": -1}),
        json!({"handle": {}}),
        json!({"handles": "1A"}),
        json!({"handles": []}),
        json!({"handles": [fine, "zz"]}),
        json!({"handles": vec![fine.clone(); 17]}),
        json!({"handle": line}),
        json!({"handle": open["handle"]}),
        json!({"handle": half}),
        json!({"handle": stone["handle"]}),
        json!({"handle": flat["handle"]}),
        json!({"handle": fine, "size": 6}),
    ] {
        assert!(s.execute("ringsizes", &bad).is_err(), "{bad}");
    }
    // A RING insert scaled unevenly has no round hole, and one whose block is empty has none.
    let ring = s.execute("ring", &json!({"at": [0, 0], "size": 6})).unwrap();
    let h = Handle::parse_hex(ring["handle"].as_str().unwrap()).unwrap();
    s.doc_mut()
        .unwrap()
        .modify_entity(h, |e| {
            if let EntityKind::Insert(i) = &mut e.kind {
                i.scale.x *= 2.0;
            }
        })
        .unwrap();
    assert!(s.execute("ringsizes", &json!({"handle": ring["handle"]})).is_err());
    // The same handle sixteen times over is still one ring.
    assert!(s.execute("ringsizes", &json!({"handles": vec![fine.clone(); 16]})).is_ok());
}

// ---------------------------------------------------------------- elongated melee (J1)

/// The corners of a `length` × `width` stone inserted at `h`, in drawing units.
fn box_corners(s: &Session, h: &Value, length: f64, width: f64) -> Vec<Vec2> {
    let h = Handle::parse_hex(h.as_str().unwrap()).unwrap();
    let EntityKind::Insert(ins) = &s.doc().unwrap().entity(h).unwrap().kind else { panic!("not an insert") };
    [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]
        .iter()
        .map(|(x, y)| ins.insert.xy() + Vec2::new(x * width / 2.0, y * length / 2.0).rotate(ins.rotation))
        .collect()
}

#[test]
fn a_marquise_is_laid_by_its_length_and_not_as_a_round() {
    let mut s = mm_drawing();
    let band = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(10.0, 0.0), Vec2::new(10.0, 2.0), Vec2::new(0.0, 2.0)]);
    let stone = json!({"handles": [band], "pattern": "grid", "cut": "marquise", "length": 3.0, "stoneWidth": 1.5, "clearance": 0.15});
    // The band is wider than tall, so the length runs along it: a quarter turn. The pitch along
    // the row is the 3 mm length plus the clearance, and (10 − 2·1.65) / 3.15 leaves three.
    // Taken as a round of its width, as it used to be, five would have been placed on a 1.65
    // pitch, each overlapping the next by half its length.
    let r = s.execute("pave", &stone).unwrap();
    assert_eq!(r["placed"], json!(3), "{r}");
    assert_eq!(r["rotate"], json!(90.0));
    assert_eq!(r["pattern"], "grid");
    assert_eq!(r["pitch"], json!({"along": 3.15, "across": 1.65}));
    assert_eq!(r["stone"]["length"], json!(3.0));
    let note = r["notes"].as_array().unwrap().iter().filter_map(Value::as_str).find(|n| n.contains("marquise")).unwrap_or_else(|| panic!("{r}"));
    assert!(note.contains("90°") && note.contains("long axis") && note.contains("3.15"), "{note}");
    assert!(!r["notes"].to_string().contains("would have fitted"), "a round melee's size says nothing of a marquise: {r}");
    let mut xs = Vec::new();
    for h in r["handles"].as_array().unwrap() {
        let id = Handle::parse_hex(h.as_str().unwrap()).unwrap();
        let EntityKind::Insert(ins) = &s.doc().unwrap().entity(id).unwrap().kind else { panic!("not an insert") };
        assert_eq!(ins.block, "GEM-MARQUISE-3x1.5");
        assert!((ins.rotation - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
        xs.push(ins.insert.xy().x);
        for c in box_corners(&s, h, 3.0, 1.5) {
            assert!(c.x > 0.15 - 1e-9 && c.x < 9.85 + 1e-9 && c.y > 0.15 - 1e-9 && c.y < 1.85 + 1e-9, "the stone's box is in the band: {c:?}");
        }
    }
    assert!((xs[1] - xs[0] - 3.15).abs() < 1e-9 && (xs[1] - 5.0).abs() < 1e-9, "centred, on the pitch: {xs:?}");

    // Asked to stand across the band, a 3 mm stone does not fit a 2 mm band: none is kept.
    let mut across = stone.clone();
    across["rotate"] = json!(0);
    let r = s.execute("pave", &across).unwrap();
    assert_eq!(r["placed"], json!(0), "{r}");
    assert_eq!(r["rotate"], json!(0.0));
    assert!(r["skipped"]["edge"].as_u64().unwrap() > 0, "{r}");
    assert!(r["notes"].to_string().contains("as asked"), "{r}");
    // In a band 3.3 mm tall it does, and now the 1.5 mm width sets the pitch along the row.
    let tall = polyline(&mut s, &[Vec2::new(0.0, 10.0), Vec2::new(10.0, 10.0), Vec2::new(10.0, 13.3), Vec2::new(0.0, 13.3)]);
    across["handles"] = json!([tall]);
    let r = s.execute("pave", &across).unwrap();
    assert_eq!(r["placed"], json!(5), "(10 − 2·0.9) / 1.65 leaves five: {r}");
    assert_eq!(r["pitch"], json!({"along": 1.65, "across": 3.15}));
}

#[test]
fn no_elongated_stone_is_kept_with_its_body_over_the_edge() {
    let mut s = mm_drawing();
    let disc = circle(&mut s, [0.0, 0.0], 5.0);
    for (cut, length, width) in [("baguette", 3.0, 1.0), ("marquise", 3.0, 1.5), ("emerald", 2.8, 2.0), ("princess", 1.5, 1.5)] {
        for rotate in [0.0, 30.0, 45.0, 90.0, 137.0] {
            for pattern in ["grid", "brick"] {
                let r = s
                    .execute(
                        "pave",
                        &json!({"handles": [disc], "pattern": pattern, "cut": cut, "length": length, "stoneWidth": width, "rotate": rotate, "clearance": 0.15}),
                    )
                    .unwrap();
                let handles = r["handles"].as_array().unwrap();
                assert!(!handles.is_empty(), "{cut} at {rotate}° ({pattern}) fits a 10 mm disc: {r}");
                let mut boxes: Vec<Vec<Vec2>> = Vec::new();
                for h in handles {
                    let corners = box_corners(&s, h, length, width);
                    if cut == "baguette" || cut == "princess" {
                        // A baguette's body is its box: every corner is inside the disc, the
                        // clearance from its edge.
                        for c in &corners {
                            assert!(c.len() <= 5.0 - 0.15 + 1e-6, "{cut} at {rotate}°: a corner at {c:?} ({} mm out)", c.len());
                        }
                    }
                    boxes.push(corners);
                }
                // Neighbours never overlap: no box's centre is inside another's box.
                for (i, a) in boxes.iter().enumerate() {
                    let centre = a.iter().fold(Vec2::ZERO, |acc, c| acc + *c) * 0.25;
                    assert!(centre.len() < 5.0);
                    for (j, b) in boxes.iter().enumerate() {
                        assert!(i == j || !cadcraft_geom::point_in_polygon(b, centre), "{cut} at {rotate}°: two stones overlap");
                    }
                }
                s.execute("erase", &json!({"handles": handles})).unwrap();
            }
        }
    }
}

#[test]
fn the_footprint_is_the_cut_s_own_outline() {
    use super::pave::{Footprint, oriented_fill_for_test};
    let square = |half: f64| {
        let pts = vec![Vec2::new(-half, -half), Vec2::new(half, -half), Vec2::new(half, half), Vec2::new(-half, half)];
        Region { bounds: cadcraft_geom::Bounds2::from_points(pts.iter().copied()), loops: vec![pts] }
    };
    let marquise = gem::cut_of("marquise").unwrap();
    let baguette = gem::cut_of("baguette").unwrap();
    // A stone that fits its region exactly, with no clearance, is kept; a hair larger is not.
    let exact = square(1.5);
    assert_eq!(oriented_fill_for_test(&exact, &Footprint::of(baguette, 3.0, 3.0, 0.0), 0.0, 0.0, false).stones.len(), 1);
    assert_eq!(
        oriented_fill_for_test(&exact, &Footprint::of(baguette, 3.0, 1.0, 0.0), 0.0, 0.0, false).stones.len(),
        3,
        "three 1 mm baguettes side by side"
    );
    assert_eq!(oriented_fill_for_test(&exact, &Footprint::of(baguette, 3.01, 1.0, 0.0), 0.0, 0.0, false).stones.len(), 0);
    assert_eq!(oriented_fill_for_test(&exact, &Footprint::of(marquise, 3.0, 1.5, 0.0), 0.0, 0.0, false).stones.len(), 2, "the arcs touch the edge");
    assert_eq!(oriented_fill_for_test(&exact, &Footprint::of(marquise, 3.01, 1.5, 0.0), 0.0, 0.0, false).stones.len(), 0);
    // Turned 45°, a 3 × 1 baguette's corners reach 2·(1.5 + 0.5)·sin 45° = 2.83 mm across: it
    // fits a 2.9 mm square and not a 2.8 mm one, though its centre is 1.4 mm from every edge
    // and its width is only 1 mm.
    let turned = Footprint::of(baguette, 3.0, 1.0, std::f64::consts::FRAC_PI_4);
    assert_eq!(oriented_fill_for_test(&square(1.45), &turned, 0.0, 0.0, false).stones.len(), 1);
    assert_eq!(oriented_fill_for_test(&square(1.40), &turned, 0.0, 0.0, false).stones.len(), 0);
    // A marquise's tips are narrower than its box: on the diagonal of a square it reaches into
    // the corners where a baguette of the same size cannot.
    let fill = |cut| oriented_fill_for_test(&square(1.3), &Footprint::of(cut, 3.0, 1.5, std::f64::consts::FRAC_PI_4), 0.0, 0.0, false).stones.len();
    assert_eq!((fill(marquise), fill(baguette)), (1, 0));
    // A small hole under a stone's tip is an edge the stone crosses, though no edge of the hole
    // crosses the stone's own outline and the stone's centre is 2 mm clear of it.
    let mut holed = square(4.0);
    assert_eq!(oriented_fill_for_test(&holed, &Footprint::of(marquise, 6.0, 3.0, 0.0), 0.0, 0.0, false).stones.len(), 2);
    holed.loops.push(vec![Vec2::new(-1.55, 2.0), Vec2::new(-1.45, 2.0), Vec2::new(-1.45, 2.2), Vec2::new(-1.55, 2.2)]);
    let over = oriented_fill_for_test(&holed, &Footprint::of(marquise, 6.0, 3.0, 0.0), 0.0, 0.0, false);
    assert_eq!((over.stones.len(), over.dropped_edge), (1, 1), "the stone over the hole is dropped, its neighbour kept");
}

#[test]
fn a_fill_respects_the_edge_that_closes_the_outline() {
    // A triangle whose last edge (back to the first point) is the slanted one. The fill used to
    // measure only the edges between listed points, so stones hung over the closing edge.
    let pts = vec![Vec2::new(0.0, 10.0), Vec2::new(0.0, 0.0), Vec2::new(10.0, 0.0)];
    let region = Region { bounds: cadcraft_geom::Bounds2::from_points(pts.iter().copied()), loops: vec![pts] };
    let fill = fill_for_test(&region, 1.0, 0.15, 0.0, true);
    assert!(fill.stones.len() > 10, "{}", fill.stones.len());
    for (p, _) in &fill.stones {
        let to_slant = (10.0 - p.x - p.y) / std::f64::consts::SQRT_2;
        assert!(to_slant >= 0.65 - 1e-9, "a stone at {p:?} is {to_slant} mm from the slanted edge");
    }
    assert!(fill.dropped_edge > 0);
    assert!((max_inscribed(&region) - 10.0 / (2.0 + std::f64::consts::SQRT_2)).abs() < 0.15, "the triangle's inscribed circle");
}

#[test]
fn round_melee_is_laid_as_before_whatever_rotate_says() {
    let mut s = mm_drawing();
    let region = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(10.0, 0.0), Vec2::new(10.0, 6.0), Vec2::new(0.0, 6.0)]);
    let plain = s.execute("pave", &json!({"handles": [region], "stoneWidth": 1.3, "clearance": 0.15})).unwrap();
    assert_eq!(plain["rotate"], json!(0.0));
    assert_eq!(plain["pitch"], json!({"along": 1.45, "across": 1.256}), "brick rows of rounds nest at 0.866 of the pitch");
    assert!(!plain["notes"].to_string().contains("outline"), "nothing to say of a round's orientation: {plain}");
    let turned = s.execute("pave", &json!({"handles": [region], "stoneWidth": 1.3, "clearance": 0.15, "rotate": 37})).unwrap();
    assert_eq!(turned["placed"], plain["placed"]);
    assert_eq!(turned["skipped"], plain["skipped"]);
    for (a, b) in plain["handles"].as_array().unwrap().iter().zip(turned["handles"].as_array().unwrap()) {
        assert!(insert_at(&s, a).near(insert_at(&s, b), 1e-12));
    }
    // An oval as long as wide is a circle too.
    let oval = s.execute("pave", &json!({"handles": [region], "cut": "oval", "stoneWidth": 1.3, "clearance": 0.15})).unwrap();
    assert_eq!(oval["placed"], plain["placed"]);
    // Along a path the stones follow the path; `rotate` is said to be ignored.
    let path = handle_of(&s.execute("pline", &json!({"vertices": [[0, 20], [10, 20]]})).unwrap());
    let row = s.execute("pave", &json!({"along": [path], "cut": "baguette", "length": 2.0, "stoneWidth": 1.0, "rotate": 45})).unwrap();
    assert_eq!(row["placed"], json!(8), "10 mm at a 1.15 pitch: {row}");
    assert_eq!(row["rotate"], Value::Null);
    assert!(row["notes"].to_string().contains("along a path"), "{row}");
}

#[test]
fn gemfit_counts_an_elongated_cut_by_its_oriented_fit() {
    let mut s = mm_drawing();
    let band = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(20.0, 0.0), Vec2::new(20.0, 2.5), Vec2::new(0.0, 2.5)]);
    // A marquise is twice as long as wide unless told otherwise, and lies along the band: its
    // 2.2 mm width is what the 2.5 mm band limits, and (20 − 2·2.35) / 4.55 leaves four.
    let r = s.execute("gemfit", &json!({"handles": [band], "cut": "marquise", "clearance": 0.15})).unwrap();
    assert_eq!(r["cut"], "marquise");
    assert_eq!(r["ratio"], json!(2.0));
    assert_eq!(r["rotate"], json!(90.0));
    assert_eq!(r["largestFitting"], json!(2.2), "{r}");
    assert_eq!(r["fits"][0], json!({"mm": 2.2, "length": 4.4, "count": 4, "carat": r["fits"][0]["carat"]}));
    assert!(r["fits"][0]["carat"].as_f64().unwrap() > 0.0);
    assert!(r["notes"][0].as_str().unwrap().contains("long axis"), "{r}");
    assert!(r["message"].as_str().unwrap().contains("4.4×2.2"), "{r}");
    // Stood across the band, the length is what the band limits: 2 × 1.1 + 0.3 = 2.5.
    let across = s.execute("gemfit", &json!({"handles": [band], "cut": "marquise", "rotate": 0})).unwrap();
    assert_eq!(across["largestFitting"], json!(1.1), "{across}");
    assert_eq!(across["fits"].as_array().unwrap().len(), 4, "0.8 to 1.1 mm");
    // A longer stone: 3:1 along the band.
    let long = s.execute("gemfit", &json!({"handles": [band], "cut": "baguette", "ratio": 3, "limit": 2})).unwrap();
    assert_eq!(long["fits"].as_array().unwrap().len(), 2, "`limit` keeps the largest sizes");
    assert_eq!(long["fits"][0]["length"], json!(6.6));
    assert_eq!(long["fits"][0]["count"], json!(2), "(20 − 2·3.45) / 6.75 leaves two");
    // What GEMFIT counts, PAVE places.
    let placed = s.execute("pave", &json!({"handles": [band], "cut": "marquise", "length": 4.4, "stoneWidth": 2.2})).unwrap();
    assert_eq!(placed["placed"], json!(4), "{placed}");
    // And a round is counted as it always was.
    let round = s.execute("gemfit", &json!({"handles": [band], "ratio": 2, "rotate": 30})).unwrap();
    assert_eq!(round["largestFitting"], json!(2.2));
    assert_eq!(round["fits"].as_array().unwrap().len(), 15);
    assert!(round["fits"][0].get("length").is_none() && round["rotate"].is_null(), "{round}");
}

#[test]
fn oriented_pave_refuses_hostile_input() {
    let mut s = mm_drawing();
    let band = polyline(&mut s, &[Vec2::new(0.0, 0.0), Vec2::new(10.0, 0.0), Vec2::new(10.0, 2.0), Vec2::new(0.0, 2.0)]);
    let base = json!({"handles": [band], "cut": "marquise", "length": 3.0, "stoneWidth": 1.5});
    let with = |key: &str, v: Value| {
        let mut p = base.clone();
        p[key] = v;
        p
    };
    for bad in [
        with("rotate", json!("sideways")),
        with("rotate", json!([90])),
        with("rotate", json!(true)),
        with("length", json!(0)),
        with("length", json!(-3)),
        with("length", json!("long")),
        with("length", json!(1.0)), // shorter than the width
        with("stoneWidth", json!(0)),
        with("clearance", json!(-1)),
        with("edge", json!("wide")),
    ] {
        assert!(s.execute("pave", &bad).is_err(), "{bad}");
    }
    // Numbers JSON can carry that mean nothing as a size: refused or answered, never a panic.
    for rotate in [1e308, -1e308, 1e-320, 360.0 * 1e15, -0.0] {
        let r = s.execute("pave", &with("rotate", json!(rotate))).unwrap();
        assert!(r["rotate"].as_f64().is_some_and(|d| (0.0..360.0).contains(&d)), "{rotate}: {r}");
        assert!(r["placed"].as_u64().unwrap() <= 3, "{rotate}: {r}");
    }
    // A stone far too small or far too large for the region places nothing and says why.
    let dust =
        s.execute("pave", &json!({"handles": [band], "cut": "baguette", "length": 2e-3, "stoneWidth": 1e-3, "depth": 1e-3, "clearance": 0})).unwrap();
    assert_eq!(dust["placed"], json!(0));
    assert!(dust["notes"].to_string().contains("stopped early"), "{dust}");
    let round_dust = s.execute("pave", &json!({"handles": [band], "stoneWidth": 1e-300, "depth": 1e-300, "clearance": 0})).unwrap();
    assert_eq!(round_dust["placed"], json!(0));
    assert!(round_dust["notes"].to_string().contains("stopped early"), "{round_dust}");
    // A stone too small to have a depth is refused like any other stone with none.
    assert!(s.execute("pave", &json!({"handles": [band], "cut": "baguette", "length": 2e-9, "stoneWidth": 1e-9})).is_err());
    let boulder = s.execute("pave", &json!({"handles": [band], "cut": "marquise", "length": 1e300, "stoneWidth": 1e150})).unwrap();
    assert_eq!(boulder["placed"], json!(0));
    // A region with no inside, and one too vast to count sites in.
    let flat = s.execute("pline", &json!({"vertices": [[0, 0], [10, 0], [20, 0]], "closed": true})).unwrap();
    let r = s.execute("pave", &with("handles", json!([flat["handle"]]))).unwrap();
    assert_eq!(r["placed"], json!(0), "{r}");
    let vast = polyline(&mut s, &[Vec2::new(-1e200, -1e200), Vec2::new(1e200, -1e200), Vec2::new(1e200, 1e200), Vec2::new(-1e200, 1e200)]);
    let r = s.execute("pave", &with("handles", json!([vast]))).unwrap();
    assert_eq!(r["placed"], json!(0), "{r}");
    assert!(r["notes"].to_string().contains("stopped early"), "{r}");
    // GEMFIT's new parameters.
    for bad in [
        json!({"handles": [band], "cut": "marquise", "ratio": 0}),
        json!({"handles": [band], "cut": "marquise", "ratio": 0.5}),
        json!({"handles": [band], "cut": "marquise", "ratio": 1e308}),
        json!({"handles": [band], "cut": "marquise", "ratio": "2:1"}),
        json!({"handles": [band], "cut": "marquise", "rotate": "flat"}),
        json!({"handles": [band], "cut": "marquise", "limit": 0}),
        json!({"handles": [band], "cut": "marquise", "limit": -3}),
        json!({"handles": [band], "cut": "marquise", "limit": 2.5}),
        json!({"handles": [band], "cut": "blob"}),
    ] {
        assert!(s.execute("gemfit", &bad).is_err(), "{bad}");
    }
    assert!(s.execute("gemfit", &json!({"handles": [band], "cut": "marquise", "ratio": 20, "rotate": 1e308, "limit": u64::MAX})).is_ok());
    let r = s.execute("gemfit", &json!({"handles": [vast], "cut": "marquise"})).unwrap();
    assert!(r["notes"].to_string().contains("stopped early"), "{r}");
}

/// The bench sheet counts the whole drawing and the piece counts itself: on the solitaire sample
/// (32 stones of its own) a halo solitaire piece (20) makes 52 on the sheet, and the sheet of the
/// piece's own objects says 20. Nothing is counted twice.
#[test]
fn the_bench_sheet_adds_a_piece_to_the_drawing_s_own_stones() {
    let mut s = crate::Session::empty();
    s.open_drawing(crate::sample::solitaire(), "Solitaire", None);
    let own = s.execute("techsheet", &json!({})).unwrap()["stones"]["count"].as_u64().unwrap();
    let p = s.execute("piece", &json!({"kind": "solitaire", "halo": true, "at": [0, -60]})).unwrap();
    let piece = p["piece"]["stones"]["count"].as_u64().unwrap();
    let all = s.execute("techsheet", &json!({})).unwrap()["stones"]["count"].as_u64().unwrap();
    let only = s.execute("techsheet", &json!({"handles": p["piece"]["handles"]})).unwrap()["stones"]["count"].as_u64().unwrap();
    assert_eq!((own, piece, all, only), (32, 20, 52, 20));
}
