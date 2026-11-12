//! More of the ring a jeweler orders: the band's other sections, each drawn, revolved and weighed
//! from its one definition.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PI, Vec2};
use serde_json::{Value, json};

use super::gem;
use super::mesh::{Quality, piece_mesh};
use super::mesh_tests::{check as closed, extent, part, shells};
use super::piece_params::{MAX_SIDE_ANGLE, PROFILES, PieceParams, Profile, Section, carat_of, head_polygon, polygons_apart, side_profile};
use super::piece_tests::{assert_no_orphans, check, handles, mm_drawing, piece, query, state, stone_inserts};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

/// A circular segment of half-chord `h` and sagitta `s` worked by hand: its area and how far its
/// centroid lies beyond its chord.
fn seg(h: f64, s: f64) -> (f64, f64) {
    let r = (h * h + s * s) / (2.0 * s);
    // (A half circle's sine may round a hair over one.)
    let theta = 2.0 * (h / r).min(1.0).asin();
    let area = r * r / 2.0 * (theta - theta.sin());
    (area, 4.0 * r * (theta / 2.0).sin().powi(3) / (3.0 * (theta - theta.sin())) - (r - s))
}

/// A profile's area and first moment about the finger from the formulas the module documents,
/// worked here by hand: `n` is the profile's own number.
fn by_hand(profile: Profile, w: f64, t: f64, n: f64) -> (f64, f64) {
    let a = w / 2.0;
    match profile {
        Profile::Flat => (w * t, w * t * t / 2.0),
        Profile::Dome => {
            let r = t.min(a);
            let e = t - r;
            let (s, up) = seg(a, r);
            (w * e + s, w * e * e / 2.0 + s * (e + up))
        }
        Profile::Comfort | Profile::Court => {
            let r = if profile == Profile::Comfort { a.min(t - 2.0 * n) } else { a.min(t - n) };
            let e = t - r;
            let ((top, up), (ease, down)) = (seg(a, r), seg(a, n));
            (ease + w * (e - n) + top, ease * (n - down) + w * (e * e - n * n) / 2.0 + top * (e + up))
        }
        Profile::Knife => (w * (t - n) + a * n, w * (t - n) * (t - n) / 2.0 + a * n * (t - n + n / 3.0)),
        Profile::Bevel => (w * t - n * n, w * t * t / 2.0 - n * n * (t - n / 3.0)),
        Profile::Concave => {
            let (s, down) = seg(0.35 * w, n);
            (w * t - s, w * t * t / 2.0 - s * (t - down))
        }
    }
}

/// The key a profile's own number is given under.
fn key(profile: Profile) -> &'static str {
    profile.key().unwrap_or("comfort")
}

/// The sheet's section: the closed polyline on `Metal` to the right of the front view.
fn drawn_section(s: &Session, p: &Value, outer: f64) -> cadcraft_geom::Polyline {
    let d = s.doc().unwrap();
    handles(p)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter(|e| e.common.layer == "Metal")
        .find_map(|e| match &e.kind {
            EntityKind::LwPolyline(pl) if pl.closed && pl.vertices.iter().all(|v| v.p.x >= outer) => {
                Some(cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true })
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("no section in {p}"))
}

// ------------------------------------------------------------------ the sections

#[test]
fn each_profile_has_the_area_and_centroid_of_its_formula() {
    // A usual band, a wide low one, a tall narrow one, and the thinnest and thickest allowed.
    for (w, t) in [(2.2f64, 1.8f64), (4.0, 2.0), (6.0, 1.5), (3.0, 2.5), (0.5, 0.3), (30.0, 10.0), (30.0, 0.3), (0.5, 10.0)] {
        for profile in PROFILES {
            let (most, _) = profile.most(w, t);
            // The default, the least, the most, and one in between.
            let numbers = if profile.key().is_some() { vec![None, Some(0.05), Some(most), Some((0.05 + most) / 2.0)] } else { vec![None] };
            for given in numbers {
                let mut build = json!({"kind": "band", "width": w, "wall": t, "profile": profile.name()});
                if let Some(n) = given {
                    build[key(profile)] = json!(n);
                }
                let what = build.to_string();
                let section = params(build).section();
                let n = given.unwrap_or_else(|| profile.usual(w, t));
                assert!((section.number() - n).abs() < 1e-12 || profile.key().is_none(), "{what}: {} for {n}", section.number());
                // The formulas, by hand.
                let (area, moment) = by_hand(profile, w, t, n);
                assert!((section.area() - area).abs() < 1e-9 * area.max(1.0), "{what}: area {} against {area}", section.area());
                assert!((section.centroid() - moment / area).abs() < 1e-9, "{what}: centroid {} against {}", section.centroid(), moment / area);
                // The heights the solid revolves enclose that area: integrated across the width.
                let steps = 40_000;
                let (mut sum, mut first) = (0.0, 0.0);
                for i in 0..steps {
                    let x = -w / 2.0 + w * (f64::from(i) + 0.5) / f64::from(steps);
                    let (hi, lo) = (section.height_at(x), section.inside_at(x));
                    assert!(hi >= lo - 1e-12 && lo >= 0.0 && hi <= t + 1e-12, "{what}: at {x} the outside is {hi}, the inside {lo}");
                    sum += (hi - lo) * w / f64::from(steps);
                    first += (hi * hi - lo * lo) / 2.0 * w / f64::from(steps);
                }
                assert!((sum - area).abs() < 2e-6 * area.max(1.0), "{what}: the heights enclose {sum}, the formula {area}");
                assert!((first / sum - moment / area).abs() < 2e-6 * t.max(1.0), "{what}: {} against {}", first / sum, moment / area);
                // The outline the sheet draws is that same shape, bulges and all.
                let poly = cadcraft_geom::Polyline {
                    vertices: section.outline().iter().map(|(q, b)| cadcraft_geom::PolyVertex::with_bulge(*q, *b)).collect(),
                    closed: true,
                };
                assert!((poly.area().abs() - area).abs() < 1e-9 * area.max(1.0), "{what}: the outline encloses {}, the formula {area}", poly.area());
                assert!((poly.centroid().unwrap().y - moment / area).abs() < 1e-9 * t.max(1.0), "{what}");
                let b = poly.bounds();
                assert!((b.min.x + w / 2.0).abs() < 1e-9 && (b.max.x - w / 2.0).abs() < 1e-9, "{what}: the outline is the width across");
                assert!(b.min.y.abs() < 1e-9 && (b.max.y - t).abs() < 1e-9, "{what}: the outline is {}..{} high", b.min.y, b.max.y);
                // The middle of the inside is the finger; the height in the middle is the wall,
                // less the hollow of a concave band.
                assert_eq!(section.inside_at(0.0), 0.0, "{what}");
                let crown = if profile == Profile::Concave { t - n } else { t };
                assert!((section.height_at(0.0) - crown).abs() < 1e-9, "{what}");
                // The polygon a mesh is built through is inscribed: never more than the section.
                for segments in [2, 8, 16, 32] {
                    let pts = section.polygon(segments);
                    let inscribed = cadcraft_geom::shoelace(&pts);
                    assert!(inscribed > 0.0 && inscribed <= area + 1e-9, "{what}: a polygon of {inscribed} in a section of {area}");
                    for q in &pts {
                        assert!(q.x.abs() <= w / 2.0 + 1e-9, "{what}");
                        assert!(q.y <= section.height_at(q.x) + 1e-9 && q.y >= section.inside_at(q.x) - 1e-9, "{what}: {q:?} is outside the section");
                    }
                }
                let fine = cadcraft_geom::shoelace(&section.polygon(1024));
                // (The smallest bands are cut no finer than 4 µm a piece.)
                assert!((area - fine) / area < 1e-4, "{what}: a fine polygon is the section ({fine} of {area})");
            }
        }
    }
}

#[test]
fn each_profile_weighs_its_section_swept_around_the_finger() {
    // A size 6 band, 4 mm wide with a 2 mm wall, in 18k gold (15.5 g/cm³), every number written out.
    let (w, t, density) = (4.0f64, 2.0f64, 15.5);
    let mut s = mm_drawing();
    let mut flat = 0.0;
    for (profile, n, area, centroid) in [
        // The rectangle.
        (Profile::Flat, 0.0, 8.0, 1.0),
        // A semicircle of radius 2: π·2²/2, centroid 4·2/3π.
        (Profile::Dome, 0.0, 2.0 * PI, 8.0 / (3.0 * PI)),
        // c = 1/3: the dome rises 4/3 from sides 2/3 high.
        (Profile::Comfort, 1.0 / 3.0, f64::NAN, f64::NAN),
        // c = 1/3: a lens, the outside rising 5/3 from the inside's edges.
        (Profile::Court, 1.0 / 3.0, f64::NAN, f64::NAN),
        // p = 1.2: a rectangle 4 × 0.8 under a triangle 4 × 1.2. A = 3.2 + 2.4, M = 1.28 + 2.4·1.2.
        (Profile::Knife, 1.2, 5.6, 4.16 / 5.6),
        // b = 0.8: 8 less two triangles of 0.32. M = 8 − 0.64·(2 − 0.8/3).
        (Profile::Bevel, 0.8, 7.36, (8.0 - 0.64 * (2.0 - 0.8 / 3.0)) / 7.36),
        // d = 0.5 over a half-chord of 1.4: R = 2.21.
        (Profile::Concave, 0.5, f64::NAN, f64::NAN),
    ] {
        let p = piece(&mut s, json!({"kind": "band", "size": 6, "width": w, "wall": t, "profile": profile.name(), "metal": "gold18"}));
        let inner = params(p["params"].clone()).inner() / 2.0;
        let section = params(p["params"].clone()).section();
        assert!((section.number() - n).abs() < 1e-12, "{}: the default is {}", profile.name(), section.number());
        let (a, m) = by_hand(profile, w, t, n);
        if area.is_finite() {
            assert!((a - area).abs() < 1e-12 && (m / a - centroid).abs() < 1e-12, "{}: {a} {}", profile.name(), m / a);
        }
        let grams = 2.0 * PI * (inner + m / a) * a / 1000.0 * density;
        let said = p["metal"]["grams"].as_f64().unwrap();
        println!("{}: area {a:.4} mm², centroid {:.4} mm, {said} g", profile.name(), m / a);
        assert!((said - grams).abs() < 5.1e-4, "{}: PIECE weighs {said} g, the formula {grams} g", profile.name());
        // The solid weighs the same, and its band's mesh is that volume from inside.
        let solid = s.execute("piecemesh", &p["params"]).unwrap();
        assert_eq!(solid["metal"]["grams"], p["metal"]["grams"], "{}", profile.name());
        let mesh = piece_mesh(&params(p["params"].clone()), Quality::Fine);
        let meshed = part(&mesh, "band").volume() / 1000.0 * density;
        assert!(meshed <= grams && (grams - meshed) / grams < 2.5e-3, "{}: the mesh weighs {meshed} g of {grams} g", profile.name());
        if profile == Profile::Flat {
            flat = said;
        } else {
            assert!(said < flat, "{}: every other profile is lighter than the flat band it is cut from", profile.name());
        }
    }
}

#[test]
fn the_sheet_draws_each_profiles_exact_outline() {
    let mut s = mm_drawing();
    for profile in PROFILES {
        for (w, t) in [(2.2, 1.8), (6.0, 1.5), (3.0, 2.5)] {
            let p = piece(&mut s, json!({"kind": "band", "width": w, "wall": t, "profile": profile.name()}));
            let q = params(p["params"].clone());
            let section = q.section();
            let poly = drawn_section(&s, &p, q.outer() / 2.0);
            assert!((poly.area().abs() - section.area()).abs() < 1e-9, "{} {w}×{t}: the sheet's section is {}", profile.name(), poly.area());
            let b = poly.bounds();
            assert!((b.max.x - b.min.x - w).abs() < 1e-9 && (b.max.y - b.min.y - t).abs() < 1e-9, "{} {w}×{t}", profile.name());
            // Arcs are arcs: a rounded profile is drawn with bulges, a faceted one without.
            let bulged = poly.vertices.iter().filter(|v| v.bulge != 0.0).count();
            let expected = match profile {
                Profile::Flat | Profile::Knife | Profile::Bevel => 0,
                Profile::Dome | Profile::Concave => 1,
                Profile::Comfort | Profile::Court => 2,
            };
            assert_eq!(bulged, expected, "{} {w}×{t}", profile.name());
            assert_eq!(p["params"]["profile"], profile.name());
            assert_no_orphans(&s, &p);
        }
    }
}

// ------------------------------------------------------------------ the solid

#[test]
fn every_profile_revolves_into_a_closed_band_inside_its_section() {
    for profile in PROFILES {
        for (w, t) in [(2.2, 1.8), (6.0, 1.5), (3.0, 2.5), (0.5, 0.3), (30.0, 10.0)] {
            for kind in ["band", "solitaire", "eternity"] {
                let p = params(json!({"kind": kind, "width": w, "wall": t, "profile": profile.name()}));
                let (section, ri) = (p.section(), p.inner() / 2.0);
                for quality in [Quality::Draft, Quality::Fine] {
                    let what = format!("{kind} {} {w}×{t} {quality:?}", profile.name());
                    let mesh = piece_mesh(&p, quality);
                    closed(&mesh, w > 1.0, &what);
                    let band = part(&mesh, "band");
                    assert_eq!(shells(band).len(), 1, "{what}: the band is one shell");
                    let volume = band.volume();
                    assert!(volume > 0.0 && volume <= p.band_volume(), "{what}: {volume} mm³ in a band of {}", p.band_volume());
                    assert!((p.band_volume() - volume) / p.band_volume() < 0.01, "{what}: {volume} of {}", p.band_volume());
                    let mut nearest = f64::INFINITY;
                    for q in &band.positions {
                        let radius = q.x.hypot(q.y);
                        nearest = nearest.min(radius);
                        assert!(
                            radius <= ri + section.height_at(q.z) + 1e-9 && radius >= ri + section.inside_at(q.z) - 1e-9,
                            "{what}: a vertex at z {} stands outside the section",
                            q.z
                        );
                    }
                    // The finger's size is the inside at its narrowest, whatever the profile.
                    assert!((nearest - ri).abs() < 1e-9, "{what}: the inside is {nearest}, the finger {ri}");
                    let (lo, hi) = extent(band, 2);
                    assert!((hi - w / 2.0).abs() < 1e-9 && (lo + w / 2.0).abs() < 1e-9, "{what}");
                    let (_, top) = extent(band, 1);
                    assert!((top - (ri + t)).abs() < 1e-9, "{what}: the band reaches {top}, the wall is at {}", ri + t);
                }
            }
        }
    }
}

#[test]
fn an_eased_inside_touches_the_finger_only_in_the_middle() {
    let p = params(json!({"kind": "band", "profile": "comfort", "width": 4, "wall": 2, "comfort": 0.3}));
    let (section, ri) = (p.section(), p.inner() / 2.0);
    assert_eq!(section.ease(), 0.3);
    assert!((section.inside_at(2.0) - 0.3).abs() < 1e-12 && (section.inside_at(-2.0) - 0.3).abs() < 1e-12);
    // The outside is the dome, kept the easing clear of the inside at the edges.
    assert!((section.rise() - 1.4).abs() < 1e-12 && (section.height_at(2.0) - 0.6).abs() < 1e-9);
    let mesh = piece_mesh(&p, Quality::Fine);
    let band = part(&mesh, "band");
    let at = |z: f64| band.positions.iter().filter(|q| (q.z - z).abs() < 1e-9).map(|q| q.x.hypot(q.y)).fold(f64::INFINITY, f64::min);
    assert!((at(0.0) - ri).abs() < 1e-9, "the middle touches the finger");
    assert!((at(2.0) - (ri + 0.3)).abs() < 1e-9 && (at(-2.0) - (ri + 0.3)).abs() < 1e-9, "the edges stand 0.3 mm off it");
    // A court is the lens: its outside comes down to the inside's edges.
    let court = params(json!({"kind": "band", "profile": "court", "width": 4, "wall": 2, "comfort": 0.3})).section();
    assert!((court.rise() - 1.7).abs() < 1e-12 && (court.height_at(2.0) - 0.3).abs() < 1e-9);
    assert_eq!(court.outline().len(), 2, "two arcs and nothing else");
    // A tall narrow court stands on sides, as a tall dome does.
    let tall = params(json!({"kind": "band", "profile": "court", "width": 2, "wall": 3})).section();
    assert!((tall.rise() - 1.0).abs() < 1e-12 && (tall.side() - 2.0).abs() < 1e-12 && tall.outline().len() == 4);
}

// ------------------------------------------------------------------ the checks

#[test]
fn the_wall_check_reads_the_band_where_it_is_thinnest() {
    let mut s = mm_drawing();
    // A 1.8 mm wall is fine flat, domed, eased and as a lens.
    for profile in ["flat", "dome", "comfort", "court"] {
        let p = piece(&mut s, json!({"kind": "band", "profile": profile, "wall": 1.8, "width": 4}));
        assert_eq!(check(&p, "wall")["ok"], true, "{profile}");
        assert!(check(&p, "wall")["message"].as_str().unwrap().starts_with("The wall is 1.8 mm, at or over"), "{profile}");
    }
    // A knife band's edges are the wall less the ridge: 1.8 − 1.08 = 0.72 mm.
    let knife = piece(&mut s, json!({"kind": "band", "profile": "knife", "wall": 1.8, "width": 4}));
    assert_eq!(check(&knife, "wall")["ok"], false, "{}", check(&knife, "wall"));
    let message = check(&knife, "wall")["message"].as_str().unwrap();
    assert!(message.contains("0.72 mm") && message.contains("at its edges"), "{message}");
    let low = piece(&mut s, json!({"ridge": 0.6}));
    assert_eq!(check(&low, "wall")["ok"], true, "1.2 mm at the edges");
    assert!(check(&low, "wall")["message"].as_str().unwrap().contains("1.2 mm"));
    // A bevelled band's edges: 1.8 − 0.8.
    let bevel = piece(&mut s, json!({"kind": "band", "profile": "bevel", "wall": 1.8, "width": 4}));
    assert_eq!(check(&bevel, "wall")["ok"], true);
    assert!(check(&bevel, "wall")["message"].as_str().unwrap().contains("chamfered edges: 1 mm"), "{}", check(&bevel, "wall"));
    let deep = piece(&mut s, json!({"bevel": 1.2}));
    assert_eq!(check(&deep, "wall")["ok"], false);
    assert!(check(&deep, "wall")["message"].as_str().unwrap().contains("0.6 mm"));
    // A concave band is thinnest in the middle of its hollow: 1.2 − 0.3 = 0.9, then 1.2 − 0.6.
    let concave = piece(&mut s, json!({"kind": "band", "profile": "concave", "wall": 1.2, "width": 4}));
    assert_eq!(check(&concave, "wall")["ok"], true, "{}", check(&concave, "wall"));
    assert!(check(&concave, "wall")["message"].as_str().unwrap().contains("in the middle of the hollow: 0.9 mm"));
    let hollowed = piece(&mut s, json!({"hollow": 0.6}));
    assert_eq!(check(&hollowed, "wall")["ok"], false);
    let said = s.execute("piece", &json!({})).unwrap()["message"].as_str().unwrap().to_string();
    assert!(said.contains("Check: ") && said.contains("0.6 mm") && said.contains("concave band"), "{said}");
}

#[test]
fn an_eternity_row_needs_the_band_to_stay_up_beside_its_girdles() {
    let mut s = mm_drawing();
    // 2.2 mm stones are 1.36 mm deep or so: their girdles lie about 0.38 mm under their tables.
    let build = |profile: &str| json!({"kind": "eternity", "profile": profile, "width": 3.2, "wall": 2.0, "melee": 2.2});
    let flat = piece(&mut s, build("flat"));
    assert_eq!(check(&flat, "stone-seat")["ok"], true, "{}", check(&flat, "stone-seat"));
    let count = flat["stones"]["count"].clone();
    for profile in ["bevel", "concave"] {
        let p = piece(&mut s, build(profile));
        assert_eq!(check(&p, "stone-seat")["ok"], true, "{profile}: {}", check(&p, "stone-seat"));
    }
    // A wide low dome falls little across the stone; a knife edge falls away at once.
    let low = piece(&mut s, json!({"kind": "eternity", "profile": "dome", "width": 6.0, "wall": 2.0, "melee": 2.2}));
    assert_eq!(check(&low, "stone-seat")["ok"], true, "{}", check(&low, "stone-seat"));
    for profile in ["dome", "comfort", "court", "knife"] {
        let p = piece(&mut s, build(profile));
        let row = params(p["params"].clone()).eternity_row();
        assert!(!row.level() && row.fall > 0.28 * row.depth, "{profile}: falls {}", row.fall);
        assert_eq!(check(&p, "stone-seat")["ok"], false, "{profile}: {}", check(&p, "stone-seat"));
        let message = check(&p, "stone-seat")["message"].as_str().unwrap();
        assert!(message.contains("girdle has no metal beside it") && message.contains(profile), "{message}");
        // It is information: the row is still built, the same stones on the same crown.
        assert_eq!(p["stones"]["count"], count, "{profile}");
        let solid = s.execute("piecemesh", &p["params"]).unwrap();
        assert!(solid["notes"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("stone-seat")), "{profile}: {}", solid["notes"]);
    }
    // A concave band carries the row in its hollow: the tables are level with the hollow's floor.
    let p = piece(&mut s, json!({"kind": "eternity", "profile": "concave", "width": 4.0, "wall": 2.0, "melee": 1.8, "hollow": 0.5}));
    let q = params(p["params"].clone());
    let row = q.eternity_row();
    assert!((row.top - (q.outer() / 2.0 - 0.5)).abs() < 1e-9 && row.fall < 0.0, "{} {}", row.top, row.fall);
    assert!((q.crown() - row.top).abs() < 1e-12);
    let mesh = piece_mesh(&q, Quality::Draft);
    let (_, top) = extent(part(&mesh, "melee"), 1);
    assert!((top - row.top).abs() < 1e-9, "the solid's tables are at {top}, the hollow's floor at {}", row.top);
    // The hollow leaves less wall under the culet, and the check counts from there.
    let message = check(&p, "stone-seat")["message"].as_str().unwrap().to_string();
    assert!(message.contains(&super::fmt_mm(1.5 - row.depth)), "{message}");
    // A solitaire stands in the hollow too: its culet 0.5 mm over the hollow's floor.
    let solitaire = params(json!({"kind": "solitaire", "profile": "concave", "width": 4.0, "wall": 2.0, "hollow": 0.5}));
    let mesh = piece_mesh(&solitaire, Quality::Draft);
    let (low, _) = extent(part(&mesh, "centre stone"), 1);
    assert!((low - (solitaire.crown() + 0.5)).abs() < 1e-9, "the culet is at {low}");
}

// ------------------------------------------------------------------ the parameters

#[test]
fn a_profiles_number_is_held_to_the_band_and_only_by_its_profile() {
    let mut s = mm_drawing();
    let there = piece(&mut s, json!({"kind": "eternity", "profile": "comfort", "width": 3.2, "wall": 2.0}));
    assert_eq!(there["params"]["comfort"], Value::Null, "an easing that was not given stays automatic");
    let refused = [
        // A comfort depth larger than the wall, and one just over the limit.
        json!({"profile": "comfort", "comfort": 2.5}),
        json!({"profile": "comfort", "comfort": 0.81}),
        json!({"profile": "court", "comfort": 0.81}),
        // A bevel wider than the band, and one that leaves no flat.
        json!({"profile": "bevel", "bevel": 4}),
        json!({"profile": "bevel", "bevel": 1.3}),
        json!({"profile": "bevel", "bevel": 1.61, "width": 30}),
        // A ridge that is the whole wall; a hollow through it.
        json!({"profile": "knife", "ridge": 2}),
        json!({"profile": "knife", "ridge": 1.81}),
        json!({"profile": "concave", "hollow": 2}),
        json!({"profile": "concave", "hollow": 1.13}),
        // A wall that no longer carries the easing it had.
        json!({"profile": "comfort", "comfort": 0.8, "wall": 1.9}),
        // Not numbers, not sizes.
        json!({"profile": "comfort", "comfort": -0.3}),
        json!({"profile": "comfort", "comfort": 0}),
        json!({"profile": "comfort", "comfort": "deep"}),
        json!({"profile": "comfort", "comfort": [0.3]}),
        json!({"profile": "comfort", "comfort": 1e308}),
        json!({"profile": "comfort", "comfort": true}),
        json!({"comfort": 1e-320}),
        json!({"ridge": -1}),
        json!({"ridge": "high"}),
        json!({"ridge": 1e308}),
        json!({"bevel": {"mm": 0.4}}),
        json!({"bevel": -1e308}),
        json!({"hollow": 0.01}),
        json!({"hollow": "0.3"}),
        json!({"profile": "wavy"}),
        json!({"profile": "comfort fit"}),
        json!({"profile": 3}),
        json!({"profile": ["court"]}),
    ];
    for p in &refused {
        let before = state(&s);
        let r = s.execute("piece", p);
        assert!(r.is_err(), "{p} was accepted: {r:?}");
        assert!(!matches!(r, Err(crate::EngineError::Internal(..))), "{p} panicked: {r:?}");
        assert_eq!(state(&s), before, "{p} changed the drawing");
        assert_eq!(query(&mut s), there, "{p} changed the piece");
        let mut whole = json!({"kind": "band", "width": 3.2, "wall": 2.0});
        for (k, v) in p.as_object().unwrap() {
            whole[k] = v.clone();
        }
        for cmd in ["piecemesh", "stlout"] {
            assert!(s.execute(cmd, &whole).is_err(), "{cmd} {whole} should be refused");
        }
    }
    // The refusal says what the band allows.
    let e = s.execute("piece", &json!({"comfort": 2.5})).unwrap_err().to_string();
    assert!(e.contains("`comfort`") && e.contains("0.8 mm on this band"), "{e}");
    let e = s.execute("piece", &json!({"profile": "bevel", "bevel": 4})).unwrap_err().to_string();
    assert!(e.contains("`bevel`") && e.contains("1.28 mm on this band"), "{e}");
    // The limits themselves are allowed, and build whole pieces.
    for p in [
        json!({"profile": "comfort", "comfort": 0.8}),
        json!({"profile": "court", "comfort": 0.05}),
        json!({"profile": "knife", "ridge": 1.8}),
        json!({"profile": "bevel", "bevel": 1.28}),
        json!({"profile": "concave", "hollow": 1.12}),
    ] {
        let r = piece(&mut s, p.clone());
        assert_no_orphans(&s, &r);
        closed(&piece_mesh(&params(r["params"].clone()), Quality::Draft), false, &p.to_string());
    }
    // A number another profile uses is kept and not held against this one: a deep chamfer
    // stays with a piece that is flat for now.
    let flat = piece(&mut s, json!({"profile": "flat", "bevel": 1.28, "ridge": 1.8, "hollow": 1.12, "comfort": 0.8}));
    let thin = piece(&mut s, json!({"wall": 0.9}));
    assert_eq!(thin["params"]["bevel"], json!(1.28));
    assert_eq!(thin["metal"]["grams"], piece(&mut s, json!({"bevel": null, "ridge": null, "hollow": null, "comfort": null}))["metal"]["grams"]);
    assert_ne!(flat["metal"]["grams"], thin["metal"]["grams"]);
    let e = s.execute("piece", &json!({"profile": "bevel", "bevel": 1.28})).unwrap_err().to_string();
    assert!(e.contains("0.72 mm on this band"), "{e}");
    // `null` puts a number back to automatic.
    let auto = piece(&mut s, json!({"profile": "knife", "ridge": 0.3}));
    assert_eq!(auto["params"]["ridge"], json!(0.3));
    let auto = piece(&mut s, json!({"ridge": null}));
    assert_eq!(auto["params"]["ridge"], Value::Null);
    assert!((params(auto["params"].clone()).section().number() - 0.54).abs() < 1e-12, "60 % of a 0.9 mm wall");
}

#[test]
fn hostile_profile_numbers_never_panic_in_the_section() {
    // Numbers that never went through the parser: the section still answers, and the solid is
    // finite and closed.
    let nasty = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0, 0.0, 1e-300, 1e300, 0.3, 5.0];
    for profile in PROFILES {
        for wall in nasty {
            for width in nasty {
                for by in nasty {
                    let section = Section { width, wall, profile, by };
                    let _ = (section.area(), section.centroid(), section.thinnest(), section.number(), section.ease(), section.rise());
                    let _ = (section.height_at(by), section.inside_at(by), section.outline(), section.polygon(usize::MAX), section.polygon(0));
                    assert!(section.outside(usize::MAX).len() <= 1100 && section.inside(usize::MAX).len() <= 1100);
                }
            }
        }
        let mut wild = params(json!({"kind": "eternity", "profile": profile.name()}));
        for by in nasty {
            for wall in [f64::NAN, 0.3, 1e300] {
                (wild.comfort, wild.ridge, wild.bevel, wild.hollow, wild.wall) = (Some(by), Some(by), Some(by), Some(by), wall);
                let _ = (wild.section(), wild.crown(), wild.band_grams(), wild.eternity_row());
                let mesh = piece_mesh(&wild, Quality::Draft);
                closed(&mesh, false, &format!("{} {by} {wall}", profile.name()));
            }
        }
    }
}

#[test]
fn a_profile_and_its_number_survive_undo_and_a_saved_drawing() {
    for (profile, number) in [("comfort", 0.25), ("court", 0.4), ("knife", 0.9), ("bevel", 0.5), ("concave", 0.35)] {
        let name = key(PROFILES.into_iter().find(|p| p.name() == profile).unwrap());
        let mut s = mm_drawing();
        let first = piece(&mut s, json!({"kind": "solitaire", "profile": "dome", "width": 3, "wall": 2}));
        let mut change = json!({"profile": profile});
        change[name] = json!(number);
        let second = piece(&mut s, change);
        assert_eq!(second["params"]["profile"], profile);
        assert_eq!(second["params"][name], json!(number));
        assert_ne!(second["metal"]["grams"], first["metal"]["grams"], "{profile}");
        // The parameters read back as the same piece, through text.
        let q = params(serde_json::from_str(&second["params"].to_string()).unwrap());
        assert_eq!(q.json(), second["params"], "{profile}");
        assert_eq!(q.section().number(), number, "{profile}");
        // Undo and redo.
        s.undo().unwrap();
        assert_eq!(query(&mut s), first, "{profile}: undo brings the dome back");
        assert_no_orphans(&s, &first);
        s.redo().unwrap();
        assert_eq!(query(&mut s), second, "{profile}");
        // A DXF save and open.
        let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
        let mut t = Session::new();
        t.open_drawing(cadcraft_io::read_dxf(dxf.as_bytes()).unwrap(), "reopened", None);
        let read = query(&mut t);
        for part in ["params", "size", "metal", "stones", "checks", "at"] {
            assert_eq!(read[part], second[part], "{profile}: {part}");
        }
        let rebuilt = piece(&mut t, json!({"size": 7}));
        assert_eq!(rebuilt["params"][name], json!(number), "{profile}: the number is kept across a rebuild");
        assert_no_orphans(&t, &rebuilt);
        // The bench sheet reads the band with its profile.
        let d = t.doc().unwrap();
        let record = &d.block("RING-PIECE").unwrap().description;
        assert!(record.contains(&format!("profile={profile}")), "{record}");
    }
}

#[test]
fn the_params_line_names_every_profile_and_its_number() {
    let specs = crate::command_specs();
    for id in ["piece", "piecemesh"] {
        let spec = specs.iter().find(|c| c.id == id).unwrap();
        for word in ["comfort", "court", "knife", "bevel", "concave", "ridge", "hollow"] {
            assert!(spec.params.contains(word), "{id}: the params line does not mention `{word}`");
        }
    }
    // A point of the middle of a hollow, for the record: the sheet's section dips there.
    let q = params(json!({"kind": "band", "profile": "concave", "width": 4, "wall": 2}));
    let outline: Vec<Vec2> = q.section().outline().iter().map(|(p, _)| *p).collect();
    assert_eq!(outline.len(), 6);
}

// ------------------------------------------------------------------ a three-stone ring

/// The piece's objects of one kind on one layer, by a test of the object.
fn count_on(s: &Session, p: &Value, layer: &str, pick: impl Fn(&EntityKind) -> bool) -> usize {
    let d = s.doc().unwrap();
    handles(p).iter().filter_map(|h| d.entity(*h)).filter(|e| e.common.layer == layer && pick(&e.kind)).count()
}

#[test]
fn a_three_stone_ring_sets_a_side_stone_each_side_of_the_centre() {
    let mut s = mm_drawing();
    let band = piece(&mut s, json!({"kind": "band"}));
    let p = piece(&mut s, json!({"kind": "threestone"}));
    assert_eq!(p["params"]["kind"], "threestone");
    // Nothing given: side stones 60 % of the centre's 6.5 mm, the centre's cut, four prongs each.
    assert_eq!(p["params"]["sideWidth"], Value::Null);
    assert_eq!(p["params"]["sideLength"], Value::Null);
    assert_eq!(p["params"]["sideCut"], Value::Null);
    assert_eq!(p["params"]["sideProngs"], json!(4));
    let q = params(p["params"].clone());
    let (length, width) = q.side_size();
    assert!((width - 3.9).abs() < 1e-12 && (length - 3.9).abs() < 1e-12, "{length}×{width}");
    assert_eq!(p["stones"]["count"], json!(3));
    let stones = stone_inserts(&s, &p);
    assert_eq!(stones.iter().map(|(b, _)| b.as_str()).collect::<Vec<_>>(), ["GEM-ROUND-6.5", "GEM-ROUND-3.9", "GEM-ROUND-3.9"]);
    // The weight is the band's, as a solitaire's is; the carats are the three stones'.
    assert_eq!(p["metal"]["grams"], band["metal"]["grams"]);
    let (centre, small) = (q.centre_stone("test").unwrap(), q.side_stone("test").unwrap());
    let carat = carat_of(&centre) + 2.0 * carat_of(&small);
    assert!((p["stones"]["carat"].as_f64().unwrap() - carat).abs() < 5.1e-4, "{} against {carat}", p["stones"]["carat"]);
    // The side stones stand at the least angle that clears the centre's head: there the two
    // heads, seen along the finger, are the gap and half of each prong wire apart.
    let sides = q.sides();
    assert!(sides.fits);
    let (head, top) = (q.head(), q.crown());
    assert!((sides.metal - (head.prong + sides.head.prong) / 2.0).abs() < 1e-12 && (head.prong - 0.975).abs() < 1e-12 && sides.head.prong == 0.8);
    let stand = |polygon: Vec<Vec2>, clear: f64, angle: f64| -> Vec<Vec2> {
        polygon.iter().map(|v| Vec2::new(angle.sin(), angle.cos()) * (top + clear + v.y) + Vec2::new(angle.cos(), -angle.sin()) * v.x).collect()
    };
    let round = gem::cut_of("round").unwrap();
    let middle = stand(head_polygon(round, 6.5, head.depth, head.clear), head.clear, 0.0);
    let beside = |angle: f64| stand(head_polygon(round, 3.9, sides.head.depth, sides.head.clear), sides.head.clear, angle);
    let need = sides.metal + 0.2;
    assert!((polygons_apart(&middle, &beside(sides.angle)) - need).abs() < 1e-9, "{} against {need}", polygons_apart(&middle, &beside(sides.angle)));
    assert!((sides.apart - need).abs() < 1e-9 && (sides.between() - 0.2).abs() < 1e-9);
    assert!(polygons_apart(&middle, &beside(sides.angle - 1e-3)) < need, "a hair nearer and they crowd");
    assert_eq!(polygons_apart(&middle, &beside(0.05)), 0.0, "near the top the heads overlap");
    println!(
        "three-stone, size 6, 6.5 mm centre and 3.9 mm sides: {:.2}° from the top, {:.4} mm between the heads, {} ct, {} g",
        sides.angle.to_degrees(),
        sides.apart,
        p["stones"]["carat"],
        p["metal"]["grams"]
    );
    // The sheet: three side profiles and six prong lines in the front view, three stones and
    // 6 + 4 + 4 prongs in the plan.
    assert_eq!(count_on(&s, &p, "Stones", |k| matches!(k, EntityKind::LwPolyline(pl) if pl.closed)), 3);
    assert_eq!(count_on(&s, &p, "Settings", |k| matches!(k, EntityKind::LwPolyline(pl) if !pl.closed)), 6);
    assert_eq!(count_on(&s, &p, "Settings", |k| matches!(k, EntityKind::Circle(_))), 14);
    let x = (top + sides.head.girdle_height()) * sides.angle.sin();
    assert!((stones[1].1.x + x).abs() < 1e-9 && (stones[2].1.x - x).abs() < 1e-9 && stones[0].1.x.abs() < 1e-9, "{stones:?}");
    assert!(stones.iter().all(|(_, at)| (at.y - stones[0].1.y).abs() < 1e-9), "the three stones lie along the band in the plan");
    // The checks: the seat covers all three heads, the spacing is the metal between settings.
    assert_eq!(check(&p, "stone-seat")["ok"], true, "{}", check(&p, "stone-seat"));
    assert!(check(&p, "stone-seat")["message"].as_str().unwrap().contains("two 3.9×3.9 mm side stones"), "{}", check(&p, "stone-seat"));
    assert_eq!(check(&p, "spacing")["ok"], true);
    let spacing = check(&p, "spacing")["message"].as_str().unwrap();
    assert!(spacing.contains("0.2 mm of metal between their settings") && spacing.contains(&super::fmt_mm(sides.angle.to_degrees())), "{spacing}");
    assert_eq!(check(&p, "calibrated")["ok"], true);
    let said = s.execute("piece", &json!({})).unwrap()["message"].as_str().unwrap().to_string();
    assert!(said.starts_with("Three-stone ring") && said.contains("2 × 3.9 mm round at the sides") && said.contains("in 6 prongs"), "{said}");
    // The bench sheet counts three stones in two groups.
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(sheet["stones"]["count"], json!(3), "{sheet}");
    let groups = sheet["stones"]["groups"].as_array().unwrap();
    assert_eq!(groups.len(), 2, "{sheet}");
    let mut counts: Vec<u64> = groups.iter().map(|g| g["count"].as_u64().unwrap()).collect();
    counts.sort_unstable();
    assert_eq!(counts, [1, 2]);
    assert!((sheet["stones"]["carat"].as_f64().unwrap() - carat).abs() < 2e-3);
    // The solid: three stones, three rails, fourteen prongs, every shell closed and outward.
    let solid = s.execute("piecemesh", &p["params"]).unwrap();
    assert_eq!(solid["stones"], json!(3));
    assert_eq!(solid["metal"]["grams"], p["metal"]["grams"]);
    for quality in [Quality::Draft, Quality::Fine] {
        let mesh = piece_mesh(&q, quality);
        closed(&mesh, true, &format!("three-stone {quality:?}"));
        let names: Vec<&str> = mesh.meshes.iter().map(|m| m.name).collect();
        assert_eq!(names, ["band", "head", "prongs", "centre stone", "side stones"]);
        assert_eq!(shells(part(&mesh, "head")).len(), 3, "a gallery rail to a head");
        assert_eq!(shells(part(&mesh, "prongs")).len(), 14);
        assert_eq!(shells(part(&mesh, "side stones")).len(), 2);
        assert_eq!(mesh.stones, 3);
        // No metal reaches into the finger, and the side stones stand clear of the band.
        let inner = q.inner() / 2.0;
        for m in mesh.meshes.iter().filter(|m| m.part == "metal") {
            assert!(m.positions.iter().all(|v| v.x.hypot(v.y) >= inner - 1e-9), "{} reaches into the finger", m.name);
        }
        let nearest = part(&mesh, "side stones").positions.iter().map(|v| v.x.hypot(v.y)).fold(f64::INFINITY, f64::min);
        assert!((nearest - (top + 0.5)).abs() < 1e-9, "the side stones' culets are {} over the band", nearest - top);
        // They mirror each other across the finger's axis.
        let (lo, hi) = extent(part(&mesh, "side stones"), 0);
        assert!((lo + hi).abs() < 1e-9 && hi > 3.25);
    }
}

#[test]
fn side_stones_take_their_own_size_cut_and_prongs() {
    let mut s = mm_drawing();
    // An oval centre: the side stones keep its proportion and its cut unless told otherwise.
    let p = piece(&mut s, json!({"kind": "threestone", "cut": "oval", "stoneLength": 8, "stoneWidth": 6, "prongs": 4}));
    let q = params(p["params"].clone());
    let (length, width) = q.side_size();
    assert!((width - 3.6).abs() < 1e-12 && (length - 4.8).abs() < 1e-12);
    assert_eq!(q.side_cut_data().unwrap().name, "oval");
    assert_eq!(stone_inserts(&s, &p)[1].0, "GEM-OVAL-4.8x3.6");
    // Pear side stones of their own size, three prongs each.
    let pears = piece(&mut s, json!({"sideCut": "pear", "sideWidth": 3, "sideLength": 4.5, "sideProngs": 3}));
    assert_eq!(pears["params"]["sideCut"], "pear");
    assert_eq!(stone_inserts(&s, &pears)[2].0, "GEM-PEAR-4.5x3");
    assert_eq!(count_on(&s, &pears, "Settings", |k| matches!(k, EntityKind::Circle(_))), 4 + 3 + 3);
    assert_no_orphans(&s, &pears);
    // A width alone keeps the centre's proportion; `null` goes back to the centre's cut and size.
    let wide = piece(&mut s, json!({"sideCut": null, "sideLength": null, "sideWidth": 4.2}));
    let q = params(wide["params"].clone());
    assert!((q.side_size().0 - 5.6).abs() < 1e-12 && q.side_cut_data().unwrap().name == "oval");
    assert_eq!(wide["params"]["sideProngs"], json!(3), "the prongs stay as they were set");
    // Larger side stones stand further round; a larger gap further still.
    let angle = |p: &Value| params(p["params"].clone()).sides().angle;
    let small = piece(&mut s, json!({"sideWidth": 3}));
    let large = piece(&mut s, json!({"sideWidth": 5}));
    assert!(angle(&large) > angle(&small), "{} {}", angle(&large), angle(&small));
    let apart = piece(&mut s, json!({"gap": 1.0}));
    assert!(angle(&apart) > angle(&large));
    assert!(check(&apart, "spacing")["message"].as_str().unwrap().contains("1 mm of metal between their settings"), "{}", check(&apart, "spacing"));
    // A halo is a solitaire's: a three-stone ring keeps the number and says it is not drawn.
    let r = s.execute("piece", &json!({"halo": true, "gap": 0.2})).unwrap();
    assert_eq!(r["piece"]["params"]["halo"], json!(1.3));
    assert_eq!(r["piece"]["stones"]["count"], json!(3));
    assert!(r["message"].as_str().unwrap().contains("Note: A three-stone ring has no halo"), "{}", r["message"]);
    let solid = s.execute("piecemesh", &r["piece"]["params"]).unwrap();
    assert!(solid["notes"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("has no halo")), "{}", solid["notes"]);
    // The same piece as a solitaire has its halo back.
    let solitaire = piece(&mut s, json!({"kind": "solitaire"}));
    assert!(solitaire["stones"]["count"].as_u64().unwrap() > 10);
    // Slight bands fail the seat for any of the three heads.
    let slight = piece(&mut s, json!({"kind": "threestone", "width": 1.2, "sideLength": 5.5, "sideWidth": 3, "sideCut": "oval"}));
    assert_eq!(check(&slight, "stone-seat")["ok"], false);
    assert!(check(&slight, "stone-seat")["message"].as_str().unwrap().contains("side stones"));
}

#[test]
fn side_stones_that_cannot_stand_beside_the_centre_are_refused() {
    let mut s = mm_drawing();
    let there = piece(&mut s, json!({"kind": "threestone", "size": 4}));
    // Too large to clear the centre within 60° of the top: the limit is the angle, so each is
    // refused exactly when the shared decision says it does not fit.
    let mut refused = Vec::new();
    for p in [
        json!({"sideWidth": 14}),
        json!({"sideWidth": 30, "sideLength": 30}),
        json!({"stoneWidth": 30, "stoneLength": 30}),
        json!({"stoneWidth": 12, "stoneLength": 12, "sideWidth": 12}),
        json!({"stoneWidth": 20, "stoneLength": 20, "sideWidth": 20, "gap": 2}),
        json!({"gap": 5}),
    ] {
        let mut whole = there["params"].clone();
        for (k, v) in p.as_object().unwrap() {
            whole[k] = v.clone();
        }
        let sides = params(whole).sides();
        println!("{p}: fits {} at {:.1}°, {:.2} mm apart", sides.fits, sides.angle.to_degrees(), sides.apart);
        if sides.fits {
            let mut t = mm_drawing();
            piece(&mut t, there["params"].clone());
            let built = piece(&mut t, p.clone());
            assert_eq!(built["stones"]["count"], json!(3), "{p}");
            assert_eq!(check(&built, "spacing")["ok"], true, "{p}");
            assert_no_orphans(&t, &built);
        } else {
            refused.push(p);
        }
    }
    assert!(refused.len() >= 2, "{refused:?}");
    let too_large = refused[0].clone();
    refused.extend([
        // Not sizes, not cuts, not counts.
        json!({"sideWidth": 0}),
        json!({"sideWidth": -3.9}),
        json!({"sideWidth": 1e308}),
        json!({"sideWidth": "3.9"}),
        json!({"sideWidth": [3.9]}),
        json!({"sideWidth": true}),
        json!({"sideLength": 0.1}),
        json!({"sideLength": 31}),
        json!({"sideLength": {"mm": 4}}),
        json!({"sideCut": "banana"}),
        json!({"sideCut": 3}),
        json!({"sideCut": ["round"]}),
        json!({"sideCut": ""}),
        json!({"sideProngs": 0}),
        json!({"sideProngs": 2}),
        json!({"sideProngs": 9}),
        json!({"sideProngs": 4.5}),
        json!({"sideProngs": -4}),
        json!({"sideProngs": "four"}),
        json!({"sideProngs": 1e308}),
        // A pear wider than it is long is no pear, at the side as in the middle.
        json!({"sideCut": "pear", "sideWidth": 5, "sideLength": 2}),
        json!({"kind": "three stones"}),
        json!({"kind": "trio"}),
    ]);
    let mut empty = mm_drawing();
    for p in &refused {
        let before = state(&s);
        let r = s.execute("piece", p);
        assert!(r.is_err(), "{p} was accepted: {r:?}");
        assert!(!matches!(r, Err(crate::EngineError::Internal(..))), "{p} panicked: {r:?}");
        assert_eq!(state(&s), before, "{p} changed the drawing");
        assert_eq!(query(&mut s), there, "{p} changed the piece");
        // And from nothing: no half a piece.
        let mut whole = json!({"kind": "threestone", "size": 4});
        for (k, v) in p.as_object().unwrap() {
            whole[k] = v.clone();
        }
        let before = state(&empty);
        let r = empty.execute("piece", &whole);
        assert!(r.is_err() && !matches!(r, Err(crate::EngineError::Internal(..))), "{whole}: {r:?}");
        assert_eq!(state(&empty), before, "{whole} left something behind");
        assert!(empty.doc().unwrap().groups.is_empty(), "{whole}");
    }
    // The refusal gives the reason and the numbers.
    let e = s.execute("piece", &too_large).unwrap_err().to_string();
    println!("{too_large}: {e}");
    assert!(e.contains("do not fit beside") && e.contains("60°") && e.contains("size 4"), "{e}");
    // The solid, a viewer, still shows them, at the limit, and says PIECE refuses them.
    let mut whole = json!({"kind": "threestone", "size": 4});
    for (k, v) in too_large.as_object().unwrap() {
        whole[k] = v.clone();
    }
    let shown = s.execute("piecemesh", &whole).unwrap();
    assert_eq!(shown["stones"], json!(3));
    assert!(
        shown["notes"].as_array().unwrap().iter().any(|n| n.as_str().is_some_and(|t| t.contains("PIECE refuses them") && t.contains("60"))),
        "{}",
        shown["notes"]
    );
    let q = params(whole);
    assert!(!q.sides().fits && q.sides().angle == MAX_SIDE_ANGLE);
    closed(&piece_mesh(&q, Quality::Draft), false, "side stones that do not fit");
    // Side stones larger than the centre are a jeweler's business: they are built when they fit.
    let large = piece(&mut s, json!({"stoneWidth": 3, "sideWidth": 4.5}));
    assert_eq!(large["stones"]["count"], json!(3));
    assert_no_orphans(&s, &large);
}

#[test]
fn every_cut_and_profile_makes_a_closed_three_stone_ring() {
    for profile in PROFILES {
        for quality in [Quality::Draft, Quality::Fine] {
            let p = params(json!({"kind": "threestone", "profile": profile.name(), "width": 3}));
            let mesh = piece_mesh(&p, quality);
            closed(&mesh, true, &format!("three-stone {} {quality:?}", profile.name()));
            assert!(!mesh.over && mesh.triangles() < 40_000, "{} triangles", mesh.triangles());
        }
    }
    let mut s = mm_drawing();
    for cut in gem::CUTS {
        for side in gem::CUTS {
            // Each cut in the middle beside each cut at the sides, in the sizes it is bought in.
            let long =
                |name: &str| if matches!(name, "marquise" | "baguette" | "rect" | "pear" | "emerald" | "radiant" | "oval") { 1.5 } else { 1.0 };
            let build = json!({
                "kind": "threestone", "cut": cut.name, "stoneWidth": 5, "stoneLength": 5.0 * long(cut.name), "prongs": 4,
                "sideCut": side.name, "sideWidth": 3, "sideLength": 3.0 * long(side.name), "sideProngs": 3,
            });
            let p = piece(&mut s, build.clone());
            assert_eq!(p["stones"]["count"], json!(3), "{build}");
            assert_no_orphans(&s, &p);
            let mesh = piece_mesh(&params(p["params"].clone()), Quality::Draft);
            closed(&mesh, true, &build.to_string());
            assert_eq!(shells(part(&mesh, "side stones")).len(), 2, "{build}");
            assert_eq!(shells(part(&mesh, "prongs")).len(), 4 + 3 + 3, "{build}");
            assert!(!mesh.notes.iter().any(|n| n.contains("no usable girdle") || n.contains("PIECE")), "{build}: {:?}", mesh.notes);
        }
    }
}

#[test]
fn hostile_side_stone_numbers_never_panic() {
    // Parameters that never went through the parser.
    let nasty = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0, 0.0, 1e-300, 1e300, 3.9];
    let mut wild = params(json!({"kind": "threestone"}));
    for a in nasty {
        for b in nasty {
            wild.side_width = Some(a);
            wild.side_length = Some(b);
            wild.stone_width = b;
            wild.gap = a;
            wild.wall = b;
            wild.side_prongs = u32::MAX;
            wild.side_cut = Some("no such cut".to_string());
            let sides = wild.sides();
            assert!(sides.angle >= 0.0 && sides.angle <= MAX_SIDE_ANGLE, "{a} {b}: {sides:?}");
            let _ = (
                wild.side_size(),
                wild.side_stone("test").is_ok(),
                wild.side_prong_sites().is_ok(),
                sides.between(),
                sides.out(1.0),
                sides.across(-1.0),
            );
            let mesh = piece_mesh(&wild, Quality::Draft);
            closed(&mesh, false, &format!("wild three-stone {a} {b}"));
            assert!(mesh.stones == 3);
        }
    }
    for cut in gem::CUTS {
        for a in nasty {
            for b in nasty {
                let polygon = head_polygon(cut, a, b, a);
                let _ = polygons_apart(&polygon, &polygon);
                let _ = side_profile(cut, a, b);
            }
        }
    }
    // Polygons that are not polygons are no distance at all to measure.
    let square = [Vec2::new(0.0, 0.0), Vec2::new(1.0, 0.0), Vec2::new(1.0, 1.0), Vec2::new(0.0, 1.0)];
    let away: Vec<Vec2> = square.iter().map(|q| *q + Vec2::new(3.0, 4.0)).collect();
    assert!((polygons_apart(&square, &away) - 13.0f64.sqrt()).abs() < 1e-12, "corner to corner: √(2² + 3²)");
    let beside: Vec<Vec2> = square.iter().map(|q| *q + Vec2::new(1.5, 0.25)).collect();
    assert!((polygons_apart(&square, &beside) - 0.5).abs() < 1e-12, "edge to edge");
    let across: Vec<Vec2> = square.iter().map(|q| *q + Vec2::new(0.5, 0.5)).collect();
    assert_eq!(polygons_apart(&square, &across), 0.0, "overlapping");
    let within: Vec<Vec2> = square.iter().map(|q| *q * 0.2 + Vec2::new(0.4, 0.4)).collect();
    assert_eq!(polygons_apart(&square, &within), 0.0, "one inside the other");
    assert_eq!(polygons_apart(&square, &[]), f64::INFINITY);
    assert_eq!(polygons_apart(&square, &[Vec2::new(f64::NAN, 0.0), Vec2::ZERO, Vec2::new(1.0, 1.0)]), f64::INFINITY);
}

#[test]
fn a_three_stone_ring_survives_undo_and_a_saved_drawing_and_starts_from_the_menu() {
    let mut s = mm_drawing();
    let first = piece(&mut s, json!({"kind": "solitaire", "halo": true}));
    let second = piece(
        &mut s,
        json!({"kind": "threestone", "sideCut": "pear", "sideWidth": 3.2, "sideLength": 4.6, "sideProngs": 5, "profile": "court", "at": [8, -4]}),
    );
    assert_eq!(second["params"]["sideWidth"], json!(3.2));
    let q = params(serde_json::from_str(&second["params"].to_string()).unwrap());
    assert_eq!(q.json(), second["params"], "the parameters read back as themselves");
    assert_eq!((q.side_size(), q.side_prongs, q.side_cut.as_deref()), ((4.6, 3.2), 5, Some("pear")));
    s.undo().unwrap();
    assert_eq!(query(&mut s), first);
    assert_no_orphans(&s, &first);
    s.redo().unwrap();
    assert_eq!(query(&mut s), second);
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let mut t = Session::new();
    t.open_drawing(cadcraft_io::read_dxf(dxf.as_bytes()).unwrap(), "reopened", None);
    let read = query(&mut t);
    for part in ["params", "size", "metal", "stones", "checks", "at"] {
        assert_eq!(read[part], second[part], "{part}");
    }
    assert_eq!(handles(&read).len(), handles(&second).len());
    let rebuilt = piece(&mut t, json!({"size": 7}));
    for key in ["kind", "sideCut", "sideWidth", "sideLength", "sideProngs", "profile"] {
        assert_eq!(rebuilt["params"][key], second["params"][key], "{key}");
    }
    assert_no_orphans(&t, &rebuilt);
    assert_eq!(t.execute("techsheet", &json!({})).unwrap()["stones"]["count"], json!(3));
    // From the menu.
    let mut m = mm_drawing();
    m.start("piece").unwrap();
    m.input(crate::Input::Text("Threestone".into())).unwrap();
    assert!(m.prompt_text().contains("centre"), "{}", m.prompt_text());
    m.input(crate::Input::Point(Vec2::new(5.0, 5.0))).unwrap();
    assert_eq!(query(&mut m)["params"]["kind"], "threestone");
    m.undo().unwrap();
    assert_eq!(query(&mut m), Value::Null);
    // The commands say what they take.
    let specs = crate::command_specs();
    for id in ["piece", "piecemesh"] {
        let spec = specs.iter().find(|c| c.id == id).unwrap();
        for word in ["threestone", "sideWidth", "sideLength", "sideCut", "sideProngs"] {
            assert!(spec.params.contains(word), "{id}: the params line does not mention `{word}`");
        }
    }
    let e = s.execute("piecemesh", &json!({})).unwrap_err().to_string();
    assert!(e.contains("threestone"), "{e}");
}
