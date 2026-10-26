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

fn polyline(s: &mut Session, pts: &[Vec2]) -> String {
    let r = s.execute("pline", &json!({"points": pts.iter().map(|p| json!([p.x, p.y])).collect::<Vec<_>>(), "closed": true})).unwrap();
    r["handle"].as_str().unwrap_or_else(|| r["handles"][0].as_str().unwrap()).to_string()
}

/// A drawing in millimetres.
fn mm_drawing() -> Session {
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
