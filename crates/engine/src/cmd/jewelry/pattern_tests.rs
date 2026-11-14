//! Generative patterns on the band: the periodic Voronoi (nearest site, tiling, exact cell
//! distance), the layouts, weight against the cast solid, determinism by seed, refusals,
//! proposals, DXF, and properties (Hegel).
//!
//! References are computed here by brute force from the definitions (every site and its images,
//! a fine grid over the strip), not read back from the code under test.

use cadcraft_geom::{TAU, Vec2, Vec3};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::mesh::{Quality, piece_mesh, solid_stl};
use super::pattern::{self, Layout, MIN_OPENING, PatternSpec};
use super::piece_params::PieceParams;
use super::solid::{Csg, solidify};
use super::voronoi::{self, Rng, Sites};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("piece", &v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn session() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn check<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no {id} check in {}", piece["checks"]))
}

fn voronoi_band(cells: u32, seed: u32) -> Value {
    json!({"kind": "band", "width": 6.0, "wall": 1.6, "pattern": {"voronoi": {"cells": cells, "seed": seed}}})
}

/// Seeded random sites on a `cols × rows` grid, jittered by `j` of a cell.
fn random_sites(cols: usize, rows: usize, cw: f64, ch: f64, j: f64, seed: u64, cap: f64) -> Sites {
    let mut rng = Rng::new(seed);
    let mut pts = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            let (u, v) = (rng.unit() * 2.0 - 1.0, rng.unit() * 2.0 - 1.0);
            pts.push(Vec2::new((c as f64 + 0.5 + j * u) * cw, (r as f64 + 0.5 + j * v) * ch));
        }
    }
    Sites::new(cols, rows, cw, ch, 0.0, pts, (j, j), cap).unwrap()
}

/// Brute force: the nearest site over every site and its images one period either way.
fn nearest_brute(s: &Sites, q: Vec2) -> (usize, f64, f64) {
    let mut d: Vec<(usize, f64)> = Vec::new();
    for (i, p) in s.pts.iter().enumerate() {
        for k in -1..=1 {
            let img = Vec2::new(p.x + k as f64 * s.length, p.y);
            d.push((i, (q - img).len()));
        }
    }
    d.sort_by(|a, b| a.1.total_cmp(&b.1));
    (d[0].0, d[0].1, d[1].1)
}

// ---------------------------------------------------------------------------------------------
// The Voronoi itself
// ---------------------------------------------------------------------------------------------

#[test]
fn every_point_is_nearest_its_own_site() {
    let s = random_sites(9, 3, 2.0, 1.5, 0.45, 7, 0.8);
    let mut rng = Rng::new(99);
    for _ in 0..4000 {
        let q = Vec2::new(rng.unit() * s.length, rng.unit() * 4.5);
        let (i, _) = s.boundary(q);
        let (j, d1, d2) = nearest_brute(&s, q);
        if (d2 - d1) > 1e-9 {
            assert_eq!(i, j, "at {q:?}");
        }
    }
}

#[test]
fn the_boundary_distance_is_exact_up_to_the_cap() {
    let s = random_sites(8, 3, 2.0, 1.8, 0.45, 3, 0.7);
    let mut rng = Rng::new(5);
    for _ in 0..3000 {
        let q = Vec2::new(rng.unit() * s.length, rng.unit() * 5.4);
        let (_, e) = s.boundary(q);
        // Brute force: least over all bisectors (every image) of the nearest site.
        let (i, ..) = nearest_brute(&s, q);
        let a = (0..3)
            .map(|k| Vec2::new(s.pts[i].x + (k as f64 - 1.0) * s.length, s.pts[i].y))
            .min_by(|x, y| (q - *x).len().total_cmp(&(q - *y).len()))
            .unwrap();
        let mut best = f64::INFINITY;
        for p in &s.pts {
            for k in -2..=2 {
                let b = Vec2::new(p.x + k as f64 * s.length, p.y);
                let l = (b - a).len();
                if l > 1e-9 {
                    best = best.min(((q - b).dot(q - b) - (q - a).dot(q - a)) / (2.0 * l));
                }
            }
        }
        assert!((e - best.min(s.cap)).abs() < 1e-9, "{q:?}: {e} vs {best}");
    }
}

#[test]
fn cells_tile_the_periodic_strip() {
    for seed in [1, 2, 3, 40] {
        let s = random_sites(7, 4, 2.3, 1.2, 0.45, seed, 0.5);
        let h = 2.4;
        let total: f64 = (0..s.pts.len())
            .map(|i| {
                let c = s.cell(i, 0.0, h);
                // Each cell is counter-clockwise and convex.
                assert!(c.is_empty() || voronoi::area(&c) > 0.0);
                voronoi::area(&c)
            })
            .sum();
        // The strip z ∈ [−h, h] is 2h across, but the sites stand in [0, 4·1.2] = [0, 4.8]: the
        // cells cover the clipping window [−2.4, 2.4], so compare with the strip area.
        assert!((total - s.length * 2.0 * h).abs() < 1e-6 * s.length * h, "seed {seed}: {total} vs {}", s.length * 2.0 * h);
    }
}

#[test]
fn an_inset_cell_is_its_points_at_least_the_inset_from_the_boundary() {
    let s = random_sites(6, 3, 2.5, 2.0, 0.4, 11, 0.9);
    let mut rng = Rng::new(17);
    let inset = 0.4;
    for _ in 0..3000 {
        let q = Vec2::new(rng.unit() * s.length, rng.unit() * 6.0);
        let (i, e) = s.boundary(q);
        let cell = s.cell(i, inset, 10.0);
        // Inside the polygon (any image) ⇔ e ≥ inset.
        let inside = (-1..=1).any(|k| {
            let p = Vec2::new(q.x + k as f64 * s.length, q.y);
            let n = cell.len();
            (0..n).all(|m| {
                let (a, b) = (cell[m], cell[(m + 1) % n]);
                (b - a).cross(p - a) >= -1e-9
            })
        });
        if (e - inset).abs() > 1e-6 {
            assert_eq!(inside, e > inset, "{q:?}: e {e}");
        }
    }
}

#[test]
fn a_rng_is_its_seed() {
    let (mut a, mut b, mut c) = (Rng::new(4), Rng::new(4), Rng::new(5));
    let x: Vec<u64> = (0..8).map(|_| a.next_u64()).collect();
    assert_eq!(x, (0..8).map(|_| b.next_u64()).collect::<Vec<_>>());
    assert_ne!(x, (0..8).map(|_| c.next_u64()).collect::<Vec<_>>());
}

// ---------------------------------------------------------------------------------------------
// The layouts
// ---------------------------------------------------------------------------------------------

/// Brute force over a fine grid of the developed strip: the openings polygons are where the
/// field is positive.
fn field_agrees_with_polygons(l: &Layout) {
    let n = 600;
    let mut disagree = 0;
    let mut total = 0;
    for a in 0..n {
        for b in 0..40 {
            let q = Vec2::new((a as f64 + 0.37) / n as f64 * l.length, -l.h + (b as f64 + 0.5) / 40.0 * 2.0 * l.h);
            let f = l.open(q);
            if f.abs() < 0.02 {
                continue;
            }
            total += 1;
            let polys = if l.lines.is_empty() { &l.openings } else { &l.lines };
            let inside = polys.iter().any(|p| {
                (-1..=1).any(|k| {
                    let r = Vec2::new(q.x + k as f64 * l.length, q.y);
                    winding(p, r)
                })
            });
            let expect = if l.lines.is_empty() { f > 0.0 } else { f < 0.0 };
            if inside != expect {
                disagree += 1;
            }
        }
    }
    assert!(disagree == 0, "{:?}: {disagree} of {total} samples disagree", l.spec.motif);
}

fn winding(p: &[Vec2], q: Vec2) -> bool {
    let mut inside = false;
    let n = p.len();
    for i in 0..n {
        let (a, b) = (p[i], p[(i + 1) % n]);
        if (a.y > q.y) != (b.y > q.y) && q.x < a.x + (q.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            inside = !inside;
        }
    }
    inside
}

#[test]
fn every_motif_lays_openings_where_its_field_says() {
    for pat in [
        json!({"voronoi": {"cells": 30, "seed": 3}}),
        json!({"hex": {"size": 2.0}}),
        json!({"wave": {"count": 12}}),
        json!({"truchet": {"tile": 1.6, "seed": 2, "depth": 0.3}}),
        json!({"voronoi": {"cells": 18, "seed": 9, "depth": 0.4, "relief": "recessed"}}),
    ] {
        let p = params(json!({"kind": "band", "width": 6.0, "wall": 1.8, "pattern": pat}));
        let l = Layout::of(&p).unwrap();
        assert!(!l.openings.is_empty() || !l.lines.is_empty(), "{pat}");
        field_agrees_with_polygons(&l);
    }
}

#[test]
fn ribs_are_at_least_the_wall_and_openings_at_least_the_minimum() {
    let p = params(voronoi_band(40, 12));
    let l = Layout::of(&p).unwrap();
    let w = l.spec.wall;
    // Any two points in different openings are at least `wall` apart.
    for (i, a) in l.openings.iter().enumerate() {
        assert!(pattern::across(a) >= MIN_OPENING - 1e-9);
        for b in l.openings.iter().skip(i + 1) {
            for k in -1..=1 {
                let shift = Vec2::new(k as f64 * l.length, 0.0);
                let d = poly_gap(a, &b.iter().map(|q| *q + shift).collect::<Vec<_>>());
                assert!(d >= w - 1e-6, "openings {i} are {d} apart");
            }
        }
        // And every opening stays inside the rims.
        assert!(a.iter().all(|q| q.y.abs() <= l.h + 1e-9));
    }
}

/// The least distance between two convex polygons' outlines (they do not overlap).
fn poly_gap(a: &[Vec2], b: &[Vec2]) -> f64 {
    let seg = |p: Vec2, s: Vec2, t: Vec2| {
        let e = t - s;
        let u = ((p - s).dot(e) / e.dot(e)).clamp(0.0, 1.0);
        (p - (s + e * u)).len()
    };
    let mut best = f64::INFINITY;
    for (x, y) in [(a, b), (b, a)] {
        for p in x {
            for k in 0..y.len() {
                best = best.min(seg(*p, y[k], y[(k + 1) % y.len()]));
            }
        }
    }
    best
}

#[test]
fn hexagons_are_regular_and_all_alike() {
    let p = params(json!({"kind": "band", "width": 8.0, "wall": 1.8, "pattern": {"hex": {"size": 2.0, "wall": 0.6}}}));
    let l = Layout::of(&p).unwrap();
    // The whole hexagons (not clipped by the rims) have six sides and one area.
    let whole: Vec<&Vec<Vec2>> = l.openings.iter().filter(|q| q.len() == 6).collect();
    assert!(whole.len() >= 10, "{} whole hexagons", whole.len());
    let a0 = voronoi::area(whole[0]);
    let cw = l.length / (l.length / 2.0).round();
    let flats = cw - 0.6;
    assert!((a0 - 3f64.sqrt() / 2.0 * flats * flats).abs() < 1e-6, "{a0}");
    assert!(whole.iter().all(|q| (voronoi::area(q) - a0).abs() < 1e-6));
}

#[test]
fn the_same_seed_is_the_same_band_and_another_is_not() {
    let a = Layout::of(&params(voronoi_band(24, 5))).unwrap();
    let b = Layout::of(&params(voronoi_band(24, 5))).unwrap();
    let c = Layout::of(&params(voronoi_band(24, 6))).unwrap();
    assert_eq!(format!("{:?}", a.openings), format!("{:?}", b.openings));
    assert_ne!(format!("{:?}", a.openings), format!("{:?}", c.openings));
}

// ---------------------------------------------------------------------------------------------
// Weight against the cast solid
// ---------------------------------------------------------------------------------------------

fn solid_volume(p: &PieceParams) -> (f64, usize) {
    let mesh = piece_mesh(p, Quality::Fine);
    let (_, solid, _) = solid_stl(&mesh, Quality::Fine, 1_000_000).unwrap();
    (solid.volume(), solid.bodies)
}

#[test]
fn a_pierced_bands_weight_agrees_with_its_cast_solid() {
    for (v, tol) in [
        (json!({"kind": "band", "width": 6.0, "wall": 1.6, "pattern": {"voronoi": {"cells": 20, "seed": 2}}}), 0.03),
        (json!({"kind": "band", "width": 6.0, "wall": 1.6, "profile": "dome", "pattern": {"hex": {"size": 2.6}}}), 0.03),
        (json!({"kind": "band", "width": 5.0, "wall": 1.6, "pattern": {"wave": {"count": 10}}}), 0.03),
        (json!({"kind": "band", "width": 6.0, "wall": 1.8, "pattern": {"voronoi": {"cells": 16, "depth": 0.4}}}), 0.03),
    ] {
        let p = params(v.clone());
        let l = Layout::of(&p).unwrap();
        let plain = {
            let mut q = p.clone();
            q.pattern = None;
            q.band_volume()
        };
        let want = p.band_volume();
        assert!((plain - want - l.removed()).abs() < 1e-9);
        assert!(l.removed() > 0.05 * plain, "{v}: the pattern takes something ({})", l.removed());
        let (got, bodies) = solid_volume(&p);
        assert_eq!(bodies, 1, "{v}: one body");
        assert!(((got - want) / want).abs() < tol, "{v}: solid {got:.2} vs weighed {want:.2} (plain {plain:.2})");
    }
}

#[test]
fn a_flat_pierced_bands_removal_is_the_developed_area_times_the_curvature() {
    // For a flat band the wall is the same across: removed = A·((rᵢ + t)² − rᵢ²)/(2rᵢ) exactly.
    let p = params(json!({"kind": "band", "width": 6.0, "wall": 1.5, "pattern": {"voronoi": {"cells": 22, "seed": 4}}}));
    let l = Layout::of(&p).unwrap();
    let ri = p.inner() / 2.0;
    let area: f64 = l.openings.iter().map(|q| voronoi::area(q)).sum();
    let exact = area * ((ri + 1.5f64).powi(2) - ri * ri) / (2.0 * ri);
    assert!((l.removed() - exact).abs() < 1e-3 * exact, "{} vs {exact}", l.removed());
}

#[test]
fn the_pattern_cut_is_a_distance_bound() {
    let p = params(voronoi_band(20, 3));
    let mesh = piece_mesh(&p, Quality::Draft);
    let cut = mesh.csg.cut.last().unwrap().clone();
    let mut rng = Rng::new(8);
    let ri = p.inner() / 2.0;
    for _ in 0..3000 {
        let a = Vec3::new((rng.unit() - 0.5) * 2.0 * (ri + 3.0), (rng.unit() - 0.5) * 2.0 * (ri + 3.0), (rng.unit() - 0.5) * 8.0);
        let d = Vec3::new(rng.unit() - 0.5, rng.unit() - 0.5, rng.unit() - 0.5) * 0.6;
        let b = a + d;
        assert!((cut.eval(a) - cut.eval(b)).abs() <= d.len() * (1.0 + 1e-6) + 1e-9, "{a:?}");
    }
    let _ = (TAU, Csg::default(), solidify);
}

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

#[test]
fn piece_lays_a_voronoi_band_with_its_check_and_drawing() {
    let mut s = session();
    let r = s.execute("piece", &voronoi_band(24, 1)).unwrap();
    let pc = &r["piece"];
    assert_eq!(pc["params"]["pattern"]["voronoi"]["cells"], 24);
    assert_eq!(pc["pattern"]["motif"], "voronoi");
    assert!(pc["pattern"]["openings"].as_u64().unwrap() >= 18);
    assert_eq!(check(pc, "pattern")["ok"], true, "{}", check(pc, "pattern"));
    let plain = s.execute("piece", &json!({"pattern": null})).unwrap();
    assert!(plain["piece"]["metal"]["grams"].as_f64().unwrap() > pc["metal"]["grams"].as_f64().unwrap());
    assert!(plain["piece"]["handles"].as_array().unwrap().len() < pc["handles"].as_array().unwrap().len(), "the openings are drawn");
}

#[test]
fn a_new_seed_alone_reshuffles_and_keeps_the_rest() {
    let mut s = session();
    let a = s.execute("piece", &voronoi_band(24, 1)).unwrap();
    let b = s.execute("piece", &json!({"pattern": {"voronoi": {"seed": 2}}})).unwrap();
    assert_eq!(b["piece"]["params"]["pattern"]["voronoi"]["cells"], 24);
    assert_eq!(b["piece"]["params"]["pattern"]["voronoi"]["seed"], 2);
    assert_ne!(a["piece"]["metal"]["grams"], b["piece"]["metal"]["grams"]);
}

#[test]
fn bad_patterns_are_refused_in_a_sentence() {
    let mut s = session();
    for (v, says) in [
        (json!({"kind": "band", "pattern": {"voronoi": {"cells": 100000}}}), "cells"),
        (json!({"kind": "band", "pattern": {"zigzag": {}}}), "voronoi, hex, wave or truchet"),
        (json!({"kind": "band", "pattern": {"voronoi": {}, "hex": {}}}), "one of"),
        (json!({"kind": "band", "pattern": {"voronoi": {"colour": 1}}}), "colour"),
        (json!({"kind": "band", "width": 6, "pattern": {"truchet": {}}}), "relief"),
        (json!({"kind": "solitaire", "width": 6, "pattern": {"voronoi": {}}}), "plain band"),
        (json!({"kind": "band", "width": 2.0, "pattern": {"voronoi": {}}}), "no room"),
        (json!({"kind": "band", "width": 6, "pave": true, "pattern": {"voronoi": {}}}), "pavé"),
        (json!({"kind": "band", "width": 6, "pattern": {"voronoi": {"relief": "bumpy"}}}), "raised"),
        (json!({"kind": "band", "pattern": 3}), "pattern"),
    ] {
        let e = s.execute("piece", &v).unwrap_err().to_string();
        assert!(e.contains(says), "{v}: {e}");
    }
    assert!(s.execute("piece", &json!({"query": true})).unwrap()["piece"].is_null(), "nothing was built");
}

#[test]
fn thin_ribs_and_too_much_open_fail_the_check_not_the_command() {
    let mut s = session();
    let r = s.execute("piece", &json!({"kind": "band", "width": 6.0, "wall": 1.6, "pattern": {"voronoi": {"cells": 20, "wall": 0.4}}})).unwrap();
    let c = check(&r["piece"], "pattern");
    assert_eq!(c["ok"], false);
    assert!(c["message"].as_str().unwrap().contains("thinner than a bench casts"), "{c}");
    let r = s.execute("piece", &json!({"kind": "band", "width": 10.0, "wall": 1.6, "pattern": {"hex": {"size": 6, "wall": 0.6}, }})).unwrap();
    let c = check(&r["piece"], "pattern");
    assert!(c["message"].as_str().unwrap().contains("% open"), "{c}");
}

#[test]
fn tiny_cells_are_left_closed() {
    let p = params(json!({"kind": "band", "width": 4.0, "wall": 1.6, "pattern": {"voronoi": {"cells": 400, "wall": 0.3, "jitter": 1}}}));
    let l = Layout::of(&p).unwrap();
    assert!(l.openings.iter().all(|q| pattern::across(q) >= MIN_OPENING - 1e-9));
    assert!(l.closed > 0, "some cells are too small to pierce");
}

#[test]
fn a_proposed_pattern_accepted_is_running_it() {
    let start = || {
        let mut s = session();
        s.execute("piece", &json!({"kind": "band", "width": 6.0, "wall": 1.6})).unwrap();
        s
    };
    let variants: Vec<Value> = (1..=3).map(|seed| json!({"title": format!("Seed {seed}"), "steps": [{"command": "piece", "params": {"pattern": {"voronoi": {"cells": 20, "seed": seed}}}}]})).collect();
    let mut s = start();
    let p = s.execute("propose", &json!({"variants": variants})).unwrap();
    let cards = p["proposals"].as_array().unwrap();
    assert_eq!(cards.len(), 3, "{p}");
    let id = cards[1]["id"].as_u64().unwrap();
    s.execute("accept", &json!({"id": id})).unwrap();
    let mut direct = start();
    direct.execute("piece", &json!({"pattern": {"voronoi": {"cells": 20, "seed": 2}}})).unwrap();
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are one drawing");
}

#[test]
fn a_patterned_band_survives_dxf() {
    let mut s = session();
    let p = s
        .execute("piece", &json!({"kind": "band", "width": 6.0, "wall": 1.6, "pattern": {"hex": {"size": 2.4, "depth": 0.3, "relief": "recessed"}}}))
        .unwrap();
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let q = t.execute("piece", &json!({"query": true})).unwrap();
    assert_eq!(q["piece"]["params"], p["piece"]["params"]);
    assert_eq!(q["piece"]["pattern"], p["piece"]["pattern"]);
}

#[test]
fn the_cable_twist_is_left_to_its_own_module() {
    let p = params(json!({"kind": "band", "pattern": {"twist": {"strands": 3}}}));
    assert!(p.pattern.is_none());
}

#[test]
fn engraving_on_a_patterned_band() {
    let pierced = params(voronoi_band(20, 1));
    assert!(pattern::engraving_conflict(&pierced, true).is_some());
    let relief = params(json!({"kind": "band", "width": 6, "pattern": {"voronoi": {"depth": 0.3}}}));
    assert!(pattern::engraving_conflict(&relief, true).is_none());
    assert!(pattern::engraving_conflict(&relief, false).is_some());
}

#[test]
fn piecemesh_shows_the_piercing_within_its_budget() {
    let p = params(voronoi_band(24, 3));
    let mesh = piece_mesh(&p, Quality::Fine);
    assert!(mesh.triangles() <= super::mesh::MAX_TRIANGLES);
    let plain = piece_mesh(&params(json!({"kind": "band", "width": 6.0, "wall": 1.6})), Quality::Fine);
    let (a, b) = (mesh.shells_volume(), plain.shells_volume());
    assert!(a < 0.9 * b, "the 3D band is pierced: {a} vs {b}");
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

#[hegel::test(test_cases = 60)]
fn any_voronoi_within_limits_never_panics_and_keeps_its_ribs(tc: TestCase) {
    let cells = tc.draw(gs::integers::<u32>().min_value(3).max_value(600));
    let seed = tc.draw(gs::integers::<u32>());
    let jitter = tc.draw(gs::floats::<f64>().min_value(0.0).max_value(1.0));
    let wall = tc.draw(gs::floats::<f64>().min_value(0.3).max_value(3.0));
    let width = tc.draw(gs::floats::<f64>().min_value(0.5).max_value(30.0));
    let v =
        json!({"kind": "band", "width": width, "wall": 1.8, "pattern": {"voronoi": {"cells": cells, "seed": seed, "jitter": jitter, "wall": wall}}});
    tc.note(&format!("{v}"));
    let mut s = session();
    match s.execute("piece", &v) {
        Err(e) => assert!(!e.to_string().is_empty()),
        Ok(r) => {
            let p = params(r["piece"]["params"].clone());
            let l = Layout::of(&p).unwrap();
            for q in &l.openings {
                assert!(pattern::across(q) >= MIN_OPENING - 1e-9);
            }
            assert!(p.band_volume() > 0.0);
        }
    }
}

#[hegel::test(test_cases = 6)]
fn a_patterned_band_casts_as_one_watertight_body(tc: TestCase) {
    let seed = tc.draw(gs::integers::<u32>());
    let cells = tc.draw(gs::integers::<u32>().min_value(8).max_value(30));
    let p = params(json!({"kind": "band", "width": 6.0, "wall": 1.6, "pattern": {"voronoi": {"cells": cells, "seed": seed}}}));
    let mesh = piece_mesh(&p, Quality::Draft);
    let (solid, _) = solidify(&mesh.csg, 0.15, 400_000).unwrap();
    super::solid::verify(&solid.positions, &solid.indices).unwrap();
    assert_eq!(solid.bodies, 1);
}

#[hegel::test(test_cases = 100)]
fn hostile_pattern_values_never_panic(tc: TestCase) {
    let any = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u8>().min_value(0).max_value(4)) {
            0 => json!(tc.draw(gs::floats::<f64>().min_value(-1e12).max_value(1e12))),
            1 => json!(tc.draw(gs::integers::<i64>())),
            2 => json!(tc.draw(gs::text().max_size(12))),
            3 => json!(tc.draw(gs::booleans())),
            _ => Value::Null,
        }
    };
    let motif = ["voronoi", "hex", "wave", "truchet", "twist"][tc.draw(gs::integers::<usize>().min_value(0).max_value(4))];
    let mut inner = serde_json::Map::new();
    for key in ["cells", "seed", "jitter", "size", "count", "amplitude", "tile", "wall", "rim", "depth", "relief"] {
        if tc.draw(gs::booleans()) {
            inner.insert(key.into(), any(&tc));
        }
    }
    let v = json!({"kind": "band", "width": 6.0, "pattern": {motif: inner}});
    let _ = PatternSpec::parse("piece", &v);
    let mut s = session();
    let _ = s.execute("piece", &v);
}
