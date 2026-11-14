//! Pavé on the band: placement on every profile, auto-fit, the layouts, the rim and the head,
//! refusals, the sheet, the bench and the solid agreeing, proposals, and properties (Hegel).
//!
//! The measurements are made here from the definitions in `pave_band`'s module comment (the
//! surface `P = (rᵢ + h(x))·r̂ + x·Ẑ`, the eternity row's metal formula), not read back from the
//! code under test.

use cadcraft_geom::{PI, TAU, Vec3};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::mesh::{Quality, piece_mesh};
use super::pave_band::{self, Layout, PAVE_RIM, PaveFit, PaveSpec, Surface, metal_between, stone_frames};
use super::piece_params::{MAX_PIECE_STONES, PROFILES, PieceParams, girdle_drop};
use crate::{EngineError, Session};

fn params(v: Value) -> PieceParams {
    PieceParams::parse("piece", &v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn fitted(v: Value) -> (PieceParams, PaveFit) {
    let p = params(v);
    let f = pave_band::fit(&p).expect("a fit");
    (p, f)
}

fn session() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn check<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no {id} check in {}", piece["checks"]))
}

/// Every two stones keep at least `gap` (less a hair) between their girdles.
fn least(f: &PaveFit) -> f64 {
    let mut best = f64::INFINITY;
    for (i, a) in f.stones.iter().enumerate() {
        for b in f.stones.iter().skip(i + 1) {
            best = best.min(metal_between(a, b));
        }
    }
    best
}

// ---------------------------------------------------------------------------------------------
// Placement on the surface, per profile
// ---------------------------------------------------------------------------------------------

#[test]
fn every_profile_puts_tables_on_the_outside_square_to_it() {
    for profile in PROFILES {
        let (p, f) = fitted(json!({"kind": "band", "profile": profile.name(), "width": 5.0, "wall": 2.0,
            "pave": {"layout": "rows", "rows": 2, "melee": 1.1, "span": "top-half"}}));
        let section = p.section();
        let ri = p.inner() / 2.0;
        assert!(!f.stones.is_empty(), "{}: no stones", profile.name());
        for s in &f.stones {
            // On the outside: radius rᵢ + h(z) at z.
            let r = s.table.x.hypot(s.table.y);
            assert!((r - (ri + section.height_at(s.table.z))).abs() < 1e-9, "{}: off the surface", profile.name());
            // At its angle.
            assert!((s.table.x.atan2(s.table.y) - s.angle).abs() < 1e-9);
            // The normal is a unit vector square to the outside's slope (central difference).
            assert!((s.normal.len() - 1.0).abs() < 1e-9);
            let dz = 1e-4;
            let (z0, z1) = ((s.table.z - dz).max(-p.width / 2.0), (s.table.z + dz).min(p.width / 2.0));
            let tangent = Vec3::new(0.0, 0.0, z1 - z0) + Vec3::new(s.angle.sin(), s.angle.cos(), 0.0) * (section.height_at(z1) - section.height_at(z0));
            if !matches!(profile.name(), "knife" | "bevel") || s.table.z.abs() > 1e-3 {
                assert!(s.normal.dot(tangent.normalized()).abs() < 2e-3, "{}: normal not square to the section", profile.name());
            }
            assert!(s.normal.dot(s.around).abs() < 1e-12, "around is square to the normal");
            // The seat: girdle 0.28 of the depth under the table, along the normal.
            assert!(((s.table - s.girdle) - s.normal * girdle_drop(s.depth)).len() < 1e-12);
        }
    }
}

#[test]
fn a_flat_band_faces_its_stones_straight_out_and_a_dome_tilts_its_outer_rows() {
    let (_, flat) = fitted(json!({"kind": "band", "width": 5.0, "pave": {"layout": "rows", "rows": 3, "melee": 1.0}}));
    for s in &flat.stones {
        assert!(s.normal.z.abs() < 1e-9, "flat: straight out");
    }
    let (_, dome) = fitted(json!({"kind": "band", "profile": "dome", "width": 6.0, "wall": 2.5, "pave": {"layout": "rows", "rows": 3, "melee": 1.0}}));
    let tilt = |row: usize| dome.stones.iter().find(|s| s.row == row).map(|s| s.normal.z).unwrap();
    assert!(tilt(1).abs() < 1e-9, "the middle row faces out");
    assert!(tilt(0) < -0.05 && tilt(2) > 0.05, "the outer rows lean outward: {} {}", tilt(0), tilt(2));
}

#[test]
fn a_concave_band_seats_its_row_in_the_hollow() {
    let (p, f) = fitted(json!({"kind": "band", "profile": "concave", "width": 5.0, "wall": 2.0, "pave": {"melee": 1.0, "span": "full"}}));
    let ri = p.inner() / 2.0;
    for s in &f.stones {
        assert!((s.table.xy().len() - (ri + 2.0 - p.section().number())).abs() < 1e-9, "at the hollow's bottom");
    }
}

#[test]
fn the_surface_arc_length_runs_across_the_outside() {
    // A flat band's arc length is x; a dome's is longer than half the width (the arc).
    let flat = Surface::of(&params(json!({"kind": "band", "width": 4.0}))).unwrap();
    assert!((flat.edge() - 2.0).abs() < 1e-9);
    assert!((flat.x_of(1.25) - 1.25).abs() < 1e-9 && (flat.x_of(-0.5) + 0.5).abs() < 1e-9);
    let dome = Surface::of(&params(json!({"kind": "band", "profile": "dome", "width": 4.0, "wall": 2.0}))).unwrap();
    // A half-round of radius 2: a quarter circle, π mm.
    assert!((dome.edge() - PI).abs() < 1e-3, "{}", dome.edge());
    assert!((dome.x_of(PI / 4.0 * 2.0) - 2.0 * (PI / 4.0).sin()).abs() < 1e-3);
}

// ---------------------------------------------------------------------------------------------
// Auto-fit
// ---------------------------------------------------------------------------------------------

/// The eternity row's formula for metal between neighbours `step` apart on a circle `rg`.
fn row_metal(rg: f64, d: f64, step: f64) -> f64 {
    2.0 * rg.hypot(d / 2.0) * (step / 2.0 - (d / (2.0 * rg)).atan()).sin()
}

#[test]
fn all_the_way_round_a_flat_band_fits_the_most_that_keep_the_gap() {
    let (p, f) = fitted(json!({"kind": "band", "size": 6, "width": 3.0, "wall": 1.8, "pave": {"melee": 1.5, "gap": 0.2, "span": "full"}}));
    let rg = p.outer() / 2.0 - girdle_drop(f.stones[0].depth);
    let lean = (0.75 / rg).atan();
    let most = (PI / (lean + (0.2 / (2.0 * rg.hypot(0.75))).asin())).floor() as usize;
    assert_eq!(f.stones.len(), most, "the most that keep the gap");
    let actual = row_metal(rg, 1.5, TAU / most as f64);
    assert!((f.gap.unwrap() - actual).abs() < 1e-9, "{} vs {actual}", f.gap.unwrap());
    assert!(actual >= 0.2);
    // One more would not keep it.
    assert!(row_metal(rg, 1.5, TAU / (most + 1) as f64) < 0.2);
    // And they are evenly spaced.
    let mut angles: Vec<f64> = f.stones.iter().map(|s| s.angle.rem_euclid(TAU)).collect();
    angles.sort_by(f64::total_cmp);
    for w in angles.windows(2) {
        assert!((w[1] - w[0] - TAU / most as f64).abs() < 1e-9);
    }
    // Numbers for the record: size 6, 3 × 1.8 flat, 1.5 mm at 0.2 mm.
    assert_eq!(most, 36);
}

#[test]
fn a_span_is_filled_exactly_with_the_residual_shared_equally() {
    for gap in [0.0, 0.1, 0.2, 0.35] {
        let (_, f) = fitted(json!({"kind": "band", "width": 3.0, "pave": {"melee": 1.3, "gap": gap, "from": 20, "to": 80, "symmetric": false}}));
        let n = f.stones.len();
        assert!(n >= 2);
        let mut a: Vec<f64> = f.stones.iter().map(|s| s.angle).collect();
        a.sort_by(f64::total_cmp);
        // Even spacing.
        let steps: Vec<f64> = a.windows(2).map(|w| w[1] - w[0]).collect();
        for s in &steps {
            assert!((s - steps[0]).abs() < 1e-9, "even steps");
        }
        // The first and last girdles at the span's ends: half a girdle in from 20° and 80°.
        let s0 = &f.stones[0];
        let half = (s0.diameter / 2.0).atan2(s0.girdle.xy().len());
        assert!((a[0] - half - 20f64.to_radians()).abs() < 1e-9 && (a[n - 1] + half - 80f64.to_radians()).abs() < 1e-9);
        // The actual gap is at least the one asked, and one more stone would not keep it.
        assert!(f.gap.unwrap() >= gap - 1e-9, "{} < {gap}", f.gap.unwrap());
        let rg = s0.girdle.xy().len();
        let tighter = (60f64.to_radians() - 2.0 * half) / n as f64;
        assert!(row_metal(rg, 1.3, tighter) < gap + 1e-9, "n + 1 would fit");
    }
}

#[test]
fn a_symmetric_span_mirrors_and_a_plain_band_centres_a_stone_at_twelve() {
    let (_, f) = fitted(json!({"kind": "band", "width": 3.0, "pave": {"melee": 1.3, "span": "shoulders"}}));
    assert!(f.stones.iter().any(|s| s.angle.abs() < 1e-12), "one at 12 o'clock");
    assert_eq!(f.stones.len() % 2, 1);
    for s in &f.stones {
        assert!(f.stones.iter().any(|t| (t.angle + s.angle).abs() < 1e-9 && (t.across - s.across).abs() < 1e-12), "mirrored");
        // Within 60° each side, girdle and all.
        assert!(s.angle.abs() + (s.diameter / 2.0).atan2(s.girdle.xy().len()) <= 60f64.to_radians() + 1e-9);
    }
}

#[test]
fn graduated_stones_run_from_the_near_end_to_the_far_end() {
    let (_, f) = fitted(json!({"kind": "solitaire", "width": 3.0, "pave": {"graduated": {"from": 1.6, "to": 1.0}, "span": "top-half"}}));
    let mut right: Vec<_> = f.stones.iter().filter(|s| s.angle > 0.0).collect();
    right.sort_by(|a, b| a.angle.total_cmp(&b.angle));
    assert!(right.len() >= 4);
    assert!((right[0].diameter - 1.6).abs() < 1e-9, "{}", right[0].diameter);
    assert!(right.last().unwrap().diameter < 1.15);
    for w in right.windows(2) {
        assert!(w[1].diameter <= w[0].diameter + 1e-9, "never larger further out");
        assert!(((w[1].diameter * 10.0).round() - w[1].diameter * 10.0).abs() < 1e-9, "calibrated 0.1 mm");
    }
    assert!(f.ok(), "{}", f.message());
    assert!(f.sizes().len() >= 3, "several sizes: {:?}", f.sizes());
    assert!(least(&f) >= 0.2 - 1e-9);
}

// ---------------------------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------------------------

#[test]
fn rows_stand_side_by_side_and_a_honeycomb_offsets_and_closes_them_up() {
    let rows = fitted(json!({"kind": "band", "width": 6.0, "pave": {"layout": "rows", "rows": 2, "melee": 1.2, "span": "top-half"}})).1;
    let honey = fitted(json!({"kind": "band", "width": 6.0, "pave": {"layout": "honeycomb", "rows": 2, "melee": 1.2, "span": "top-half"}})).1;
    assert_eq!(rows.rows.len(), 2);
    let angles = |f: &PaveFit, row: usize| {
        let mut a: Vec<f64> = f.stones.iter().filter(|s| s.row == row).map(|s| s.angle).collect();
        a.sort_by(f64::total_cmp);
        a
    };
    assert_eq!(angles(&rows, 0), angles(&rows, 1), "aligned rows share their angles");
    // Rows: as close as keeps the gap side by side (flat band: d + gap across).
    assert!((rows.rows[1] - rows.rows[0] - 1.4).abs() < 1e-6, "{:?}", rows.rows);
    // Honeycomb: the second row half way between the first's stones, the rows closer.
    let (a0, a1) = (angles(&honey, 0), angles(&honey, 1));
    for m in &a1 {
        assert!(a0.windows(2).any(|w| ((w[0] + w[1]) / 2.0 - m).abs() < 1e-9), "{m} is a midpoint");
    }
    assert!(honey.rows[1] - honey.rows[0] < rows.rows[1] - rows.rows[0] - 0.1, "closer: {:?} vs {:?}", honey.rows, rows.rows);
    for f in [&rows, &honey] {
        assert!(least(f) >= 0.2 - 1e-9, "{}", least(f));
        assert!(f.ok(), "{}", f.message());
    }
}

#[test]
fn three_row_honeycomb_across_the_top_half() {
    let (_, f) = fitted(json!({"kind": "band", "width": 7.0, "wall": 2.0, "profile": "comfort",
        "pave": {"layout": "honeycomb", "rows": 3, "melee": 1.2, "gap": 0.15, "span": "top-half"}}));
    assert_eq!(f.rows.len(), 3);
    assert!(f.ok(), "{}", f.message());
    assert!(f.stones.iter().any(|s| s.row == 1) && f.stones.iter().any(|s| s.row == 2));
    assert!(least(&f) >= 0.15 - 1e-9);
}

#[test]
fn a_scallop_is_one_row_and_the_sheet_draws_its_scallops() {
    let (p, f) = fitted(json!({"kind": "band", "width": 2.6, "pave": {"layout": "scallop", "rows": 3, "melee": 1.5, "span": "full"}}));
    assert_eq!(f.rows, vec![0.0], "one row whatever `rows` says");
    let sheet = pave_band::sheet(&f, &Surface::of(&p).unwrap());
    assert_eq!(sheet.scallops.len(), f.stones.len());
    assert!(stone_frames(&p).iter().all(|s| s.scallop));
}

// ---------------------------------------------------------------------------------------------
// Rim, head, refusals
// ---------------------------------------------------------------------------------------------

#[test]
fn a_band_too_narrow_for_the_stones_fails_the_pave_check_in_words() {
    let mut s = session();
    let r = s.execute("piece", &json!({"kind": "band", "width": 1.6, "pave": {"melee": 1.3}})).unwrap();
    let c = check(&r["piece"], "pave");
    assert_eq!(c["ok"], false);
    let m = c["message"].as_str().unwrap();
    assert!(m.contains("too narrow") && m.contains("1.9 mm across") && m.contains("1.6 mm across"), "{m}");
    // Wide enough: every girdle at least the rim from the edge.
    let (_, f) = fitted(json!({"kind": "band", "width": 1.9, "pave": {"melee": 1.3}}));
    assert!(f.ok(), "{}", f.message());
    assert!(f.rim.unwrap() >= PAVE_RIM - 1e-9);
    // Two rows on a band that takes one.
    let (_, f) = fitted(json!({"kind": "band", "width": 3.0, "pave": {"layout": "rows", "rows": 2, "melee": 1.3}}));
    assert!(!f.ok() && f.message().contains("2 rows"), "{}", f.message());
}

#[test]
fn pave_clears_a_solitaires_head_and_a_three_stone_rings_side_heads() {
    let (p, f) = fitted(json!({"kind": "solitaire", "width": 2.6, "pave": true}));
    assert!(f.head > 0.0);
    assert!(f.ok(), "{}", f.message());
    let first = f.stones.iter().map(|s| s.angle.abs()).fold(f64::INFINITY, f64::min);
    assert!(first > f.head, "no stone inside the head's span");
    // Seen along the finger, the nearest stone is clear of the head's outline.
    let head = p.head();
    let cut = p.cut_data().unwrap();
    let poly: Vec<_> = super::piece_params::head_polygon(cut, p.stone_width, head.depth, head.clear)
        .into_iter()
        .map(|q| cadcraft_geom::Vec2::new(q.x, p.crown() + head.clear + q.y))
        .collect();
    for s in &f.stones {
        let q = s.girdle.xy() + cadcraft_geom::Vec2::new(s.around.x, s.around.y) * (s.diameter / 2.0) * -s.angle.signum();
        let inside = super::piece_params::polygons_apart(&poly, &[q, q + cadcraft_geom::Vec2::new(1e-6, 0.0), q + cadcraft_geom::Vec2::new(0.0, 1e-6)]);
        assert!(inside >= head.prong / 2.0 + 0.2 - 1e-6, "{inside}");
    }
    let (_, three) = fitted(json!({"kind": "threestone", "width": 2.6, "pave": true}));
    let sides = params(json!({"kind": "threestone", "width": 2.6})).sides();
    assert!(three.head > sides.angle, "beyond the side stones");
}

#[test]
fn bad_pave_parameters_are_refused_with_the_key() {
    let mut s = session();
    for (pave, key) in [
        (json!({"layout": "zigzag"}), "pave.layout"),
        (json!({"layout": "rows", "rows": 4}), "pave.rows"),
        (json!({"melee": 5}), "pave.melee"),
        (json!({"gap": -1}), "pave.gap"),
        (json!({"span": "bottom"}), "pave.span"),
        (json!({"from": 50, "to": 20}), "pave.to"),
        (json!({"from": 0, "to": 500}), "pave.to"),
        (json!({"graduated": {"from": 0.2, "to": 1}}), "pave.graduated.from"),
        (json!({"symmetric": "yes"}), "pave.symmetric"),
        (json!({"melee": 1.3, "colour": "red"}), "colour"),
        (json!(7), "pave"),
    ] {
        let e = s.execute("piece", &json!({"kind": "band", "pave": pave})).unwrap_err().to_string();
        assert!(e.contains(&format!("`{key}`")), "{pave}: {e}");
    }
    assert_eq!(s.state().unwrap().doc.model.len(), 0, "nothing drawn");
}

#[test]
fn the_spec_reads_back_and_merges_key_by_key() {
    for v in [json!(true), json!({"layout": "honeycomb", "rows": 3, "gap": 0.1, "from": 10, "to": 120, "symmetric": false, "graduated": {"from": 1, "to": 1.6}})] {
        let spec = PaveSpec::parse("piece", &json!({"pave": v})).unwrap().unwrap();
        assert_eq!(PaveSpec::parse("piece", &json!({"pave": spec.json()})).unwrap().unwrap(), spec);
    }
    let mut s = session();
    s.execute("piece", &json!({"kind": "band", "width": 4, "pave": {"layout": "rows", "melee": 1.1}})).unwrap();
    let r = s.execute("piece", &json!({"pave": {"gap": 0.3}})).unwrap();
    let pave = &r["piece"]["params"]["pave"];
    assert_eq!((pave["layout"].as_str(), pave["melee"].as_f64(), pave["gap"].as_f64()), (Some("rows"), Some(1.1), Some(0.3)));
    // Angles drop the named span.
    let r = s.execute("piece", &json!({"pave": {"from": 0, "to": 100}})).unwrap();
    assert_eq!(r["piece"]["params"]["pave"]["span"], Value::Null);
    assert_eq!(r["piece"]["params"]["pave"]["to"], 100.0);
    let r = s.execute("piece", &json!({"pave": false})).unwrap();
    assert_eq!(r["piece"]["params"]["pave"], false);
    assert!(r["piece"]["checks"].as_array().unwrap().iter().all(|c| c["id"] != "pave"));
}

#[test]
fn an_eternity_band_ignores_pave_and_says_so() {
    let mut s = session();
    let r = s.execute("piece", &json!({"kind": "eternity", "pave": true})).unwrap();
    assert!(r["message"].as_str().unwrap().contains("`pave` is not used"));
    assert!(r["piece"]["stones"].get("pave").is_none());
}

// ---------------------------------------------------------------------------------------------
// The sheet, the bench and the solid agree
// ---------------------------------------------------------------------------------------------

#[test]
fn the_bench_sheet_and_the_solid_count_the_pave_as_the_piece_does() {
    for pave in [
        json!({"span": "shoulders"}),
        json!({"layout": "honeycomb", "rows": 3, "melee": 1.1, "span": "top-half"}),
        json!({"layout": "scallop", "melee": 1.5, "span": "full"}),
        json!({"graduated": {"from": 1.5, "to": 1.0}, "span": "top-half"}),
    ] {
        for kind in ["band", "solitaire", "threestone"] {
            let mut s = session();
            let r = s.execute("piece", &json!({"kind": kind, "width": 6.0, "wall": 2.0, "profile": "comfort", "pave": pave})).unwrap();
            let piece = &r["piece"];
            let n = piece["stones"]["pave"]["count"].as_u64().unwrap() as usize;
            let fixed = match kind {
                "band" => 0,
                "solitaire" => 1,
                _ => 3,
            };
            assert_eq!(piece["stones"]["count"].as_u64().unwrap() as usize, n + fixed, "{kind} {pave}");
            // The bench sheet counts the drawing's GEM inserts: the same stones and carats.
            let sheet = s.execute("techsheet", &json!({})).unwrap();
            assert_eq!(sheet["stones"]["count"].as_u64().unwrap() as usize, n + fixed, "{kind} {pave}");
            assert!((sheet["stones"]["carat"].as_f64().unwrap() - piece["stones"]["carat"].as_f64().unwrap()).abs() < 2e-3, "{kind} {pave}");
            // Grouped by size: each pavé size a line with its pieces.
            let p = params(piece["params"].clone());
            let f = pave_band::fit(&p).unwrap();
            for (d, count) in f.sizes() {
                let group = sheet["stones"]["groups"].as_array().unwrap().iter().find(|g| (g["mm"].as_f64().unwrap_or(g["width"].as_f64().unwrap_or(0.0)) - d).abs() < 1e-6 && g["cut"] == "round");
                let group = group.unwrap_or_else(|| panic!("no group for {d} mm: {}", sheet["stones"]["groups"]));
                assert!(group["count"].as_u64().unwrap() as usize >= count);
            }
            // The solid: the same number of stones, one pavé brilliant per stone.
            let mesh = piece_mesh(&p, Quality::Draft);
            assert_eq!(mesh.stones as usize, n + fixed);
            assert_eq!(mesh.meshes.iter().any(|m| m.name == "pave"), n > 0);
        }
    }
}

#[test]
fn the_solid_builds_each_stone_on_its_frame() {
    let p = params(json!({"kind": "band", "width": 4.0, "profile": "dome", "wall": 2.0, "pave": {"layout": "rows", "rows": 2, "melee": 1.2, "span": "full"}}));
    let frames = stone_frames(&p);
    let mesh = piece_mesh(&p, Quality::Draft);
    let pave = mesh.meshes.iter().find(|m| m.name == "pave").unwrap();
    assert!(pave.volume() > 0.0, "closed and outward");
    // Every frame's girdle centre has the stone's vertices within its radius and depth.
    for f in &frames {
        let near = pave.positions.iter().filter(|q| (**q - f.centre).len() <= f.girdle / 2.0 + f.depth + 1e-6).count();
        assert!(near > 10);
        assert!((f.normal.len() - 1.0).abs() < 1e-9 && f.normal.dot(f.around).abs() < 1e-9);
    }
    assert!(mesh.meshes.iter().any(|m| m.name == "beads"));
}

#[test]
fn the_drawing_shows_pave_in_the_front_view_the_section_the_plan_and_the_layout() {
    let mut a = session();
    let plain = a.execute("piece", &json!({"kind": "solitaire", "width": 2.6})).unwrap()["piece"]["handles"].as_array().unwrap().len();
    let mut b = session();
    let r = b.execute("piece", &json!({"kind": "solitaire", "width": 2.6, "pave": true})).unwrap();
    let n = r["piece"]["stones"]["pave"]["count"].as_u64().unwrap() as usize;
    let handles = r["piece"]["handles"].as_array().unwrap().len();
    let p = params(r["piece"]["params"].clone());
    let f = pave_band::fit(&p).unwrap();
    let sheet = pave_band::sheet(&f, &Surface::of(&p).unwrap());
    // Front outlines (one per angle), section (one per row), plan ellipses, the layout's band and
    // its inserts.
    assert_eq!(sheet.front.len(), n);
    assert_eq!(sheet.section.len(), 1);
    assert_eq!(handles, plain + sheet.front.len() + sheet.section.len() + sheet.plan.len() + 1 + n);
    assert!(r["message"].as_str().unwrap().contains("pavé"));
}

// ---------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------

#[test]
fn a_proposed_pave_change_accepted_is_running_it() {
    let start = || {
        let mut s = session();
        s.execute("piece", &json!({"kind": "solitaire", "width": 2.6})).unwrap();
        s
    };
    let change = json!({"pave": {"layout": "row", "melee": 1.2, "span": "shoulders"}});
    let mut s = start();
    let p = s.execute("propose", &json!({"steps": [{"command": "piece", "params": change}], "title": "Pavé shoulders"})).unwrap();
    let card = &p["proposals"][0];
    let rows = card["changes"].as_array().unwrap();
    assert!(rows.iter().any(|r| r["key"] == "piece.pave.layout" && r["after"] == "row"), "{}", card["changes"]);
    assert!(rows.iter().any(|r| r["key"] == "piece.stones.pave.count"));
    let id = card["id"].as_u64().unwrap();
    s.execute("accept", &json!({"id": id})).unwrap();
    let mut direct = start();
    direct.execute("piece", &change).unwrap();
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are one drawing");
}

// ---------------------------------------------------------------------------------------------
// Hostile input
// ---------------------------------------------------------------------------------------------

#[test]
fn hostile_pave_never_panics() {
    let mut s = session();
    let odd = [
        json!(null),
        json!([]),
        json!("row"),
        json!({"melee": f64::MAX}),
        json!({"rows": u64::MAX}),
        json!({"from": -1e300, "to": 1e300}),
        json!({"graduated": {"from": "a"}}),
        json!({"graduated": [1, 2]}),
        json!({"layout": {"a": 1}}),
        json!({"span": 3}),
        json!({"from": 359.9999999, "to": 360}),
        json!({"from": -360, "to": 0, "symmetric": false}),
        json!({"from": 0, "to": 360, "symmetric": false, "layout": "honeycomb", "rows": 3, "melee": 0.8, "gap": 0}),
        json!({"layout": "honeycomb", "rows": 3, "melee": 3, "gap": 2, "span": "full"}),
    ];
    for pave in odd {
        for kind in ["band", "solitaire", "threestone", "eternity"] {
            for extra in [json!({}), json!({"width": 0.5, "wall": 0.3}), json!({"width": 30, "wall": 10, "profile": "knife"}), json!({"size": 0, "profile": "concave"})] {
                let mut p = json!({"kind": kind, "pave": pave});
                for (k, v) in extra.as_object().unwrap() {
                    p[k] = v.clone();
                }
                let r = s.execute("piece", &p);
                assert!(!matches!(r, Err(EngineError::Internal(..))), "{p}: {r:?}");
                let m = s.execute("piecemesh", &p);
                assert!(!matches!(m, Err(EngineError::Internal(..))), "{p}");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

/// A piece with pavé, each parameter in its range.
fn drawn(tc: &TestCase) -> Value {
    let kind = tc.draw(gs::sampled_from(vec!["band", "solitaire", "threestone"]));
    let profile = tc.draw(gs::sampled_from(PROFILES.iter().map(|p| p.name()).collect::<Vec<_>>()));
    let layout = tc.draw(gs::sampled_from(vec!["row", "rows", "honeycomb", "scallop"]));
    let hundredths = |lo: i64, hi: i64| tc.draw(gs::integers::<i64>().min_value(lo).max_value(hi)) as f64 / 100.0;
    let mut pave = json!({
        "layout": layout,
        "rows": tc.draw(gs::integers::<u64>().min_value(1).max_value(3)),
        "melee": hundredths(80, 300),
        "gap": hundredths(0, 60),
        "symmetric": tc.draw(gs::booleans()),
    });
    if tc.draw(gs::booleans()) {
        pave["span"] = json!(tc.draw(gs::sampled_from(vec!["shoulders", "top-half", "full"])));
    } else {
        let from = tc.draw(gs::integers::<i64>().min_value(-180).max_value(180)) as f64;
        pave["from"] = json!(from);
        pave["to"] = json!((from + tc.draw(gs::integers::<i64>().min_value(5).max_value(360)) as f64).min(360.0));
    }
    if tc.draw(gs::weighted_booleans(0.25)) {
        pave["graduated"] = json!({"from": hundredths(80, 300), "to": hundredths(80, 300)});
    }
    json!({
        "kind": kind,
        "profile": profile,
        "size": tc.draw(gs::integers::<i64>().min_value(3).max_value(13)),
        "width": hundredths(150, 900),
        "wall": hundredths(120, 300),
        "pave": pave,
    })
}

/// Rule: for any piece drawn with pavé, no two stones overlap and every pair keeps the gap asked
/// for (auto-fit's actual gap is at least the asked gap), the stones in one row of one run are
/// evenly spaced, the count never exceeds the cap, a passing check means every girdle keeps the
/// rim, and the piece, the bench sheet and the solid count the same stones.
#[hegel::test(test_cases = 120)]
fn pave_on_any_band_keeps_its_gap_its_rim_and_its_count(tc: TestCase) {
    let asked = drawn(&tc);
    tc.note(&format!("{asked}"));
    let p = match PieceParams::parse("piece", &asked) {
        Ok(p) => p,
        Err(e) => panic!("{asked}: {e}"),
    };
    let Some(f) = pave_band::fit(&p) else { panic!("no fit for {asked}") };
    let gap = p.pave.as_ref().unwrap().gap;
    assert!(f.stones.len() <= MAX_PIECE_STONES as usize);
    let worst = least(&f);
    if f.stones.len() >= 2 {
        assert!(worst > -1e-9, "stones overlap: {worst}");
        // On the band (every girdle inside the rim), auto-fit keeps the gap; rows that run off a
        // band too narrow for them fail the check, which says so.
        let on_band = f.rim.is_some_and(|r| r >= PAVE_RIM - 1e-9);
        if on_band && !f.capped {
            assert!(worst >= gap - 1e-6, "gap {worst} < {gap}");
            assert!(f.gap.unwrap() >= gap - 1e-6);
        } else if worst < gap - 1e-6 {
            assert!(!f.ok(), "{}", f.message());
        }
    }
    if f.ok() {
        for s in &f.stones {
            assert!(f.edge - s.across.abs() - s.diameter / 2.0 >= PAVE_RIM - 1e-9, "inside the rim");
        }
    }
    // Even spacing: within one row, one size, the steps between neighbours in each run are equal.
    if p.pave.as_ref().unwrap().graduated.is_none() && p.pave.as_ref().unwrap().layout == Layout::Row {
        let mut a: Vec<f64> = f.stones.iter().map(|s| s.angle).filter(|a| *a > 1e-12).collect();
        a.sort_by(f64::total_cmp);
        let steps: Vec<f64> = a.windows(2).map(|w| w[1] - w[0]).collect();
        if let Some(min) = steps.iter().copied().reduce(f64::min) {
            // The runs' steps; a gap over the head or between mirrored runs is longer.
            let run: Vec<f64> = steps.iter().copied().filter(|s| *s < min * 1.5).collect();
            for s in &run {
                assert!((s - min).abs() < 1e-6 * (1.0 + min), "uneven: {steps:?}");
            }
        }
    }
    // The command agrees, the bench sheet counts the same stones, the solid builds them.
    let mut s = session();
    match s.execute("piece", &asked) {
        Ok(r) => {
            let piece = &r["piece"];
            assert_eq!(piece["stones"]["pave"]["count"].as_u64().unwrap() as usize, f.stones.len());
            let sheet = s.execute("techsheet", &json!({})).unwrap();
            assert_eq!(sheet["stones"]["count"], piece["stones"]["count"]);
            let mesh = piece_mesh(&p, Quality::Draft);
            assert_eq!(mesh.stones as u64, piece["stones"]["count"].as_u64().unwrap());
        }
        // A three-stone ring whose side stones do not fit is refused whatever its pavé.
        Err(e) => assert!(asked["kind"] == "threestone" && e.to_string().contains("side"), "{asked}: {e}"),
    }
}

/// Rule: any `pave` value at all — numbers out of range, wrong types, nonsense — is refused or
/// built, never a panic.
#[hegel::test(test_cases = 150)]
fn hostile_pave_values_never_panic(tc: TestCase) {
    let any = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u8>().min_value(0).max_value(5)) {
            0 => json!(tc.draw(gs::floats::<f64>().min_value(-1e12).max_value(1e12))),
            1 => json!(tc.draw(gs::integers::<i64>())),
            2 => json!(tc.draw(gs::text().max_size(12))),
            3 => json!(tc.draw(gs::booleans())),
            4 => Value::Null,
            _ => json!({"from": tc.draw(gs::floats::<f64>().min_value(-1e12).max_value(1e12)), "to": 1}),
        }
    };
    let mut pave = serde_json::Map::new();
    for key in ["layout", "rows", "melee", "gap", "span", "from", "to", "symmetric", "graduated"] {
        if tc.draw(gs::booleans()) {
            pave.insert(key.into(), any(&tc));
        }
    }
    let kind = tc.draw(gs::sampled_from(vec!["band", "solitaire", "threestone", "eternity"]));
    let p = json!({"kind": kind, "pave": Value::Object(pave)});
    tc.note(&format!("{p}"));
    let mut s = session();
    let r = s.execute("piece", &p);
    assert!(!matches!(r, Err(EngineError::Internal(..))), "{r:?}");
    let m = s.execute("piecemesh", &p);
    assert!(!matches!(m, Err(EngineError::Internal(..))));
}
