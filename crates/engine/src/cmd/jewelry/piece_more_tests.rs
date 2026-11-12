//! More of the ring a jeweler orders: the band's other sections, each drawn, revolved and weighed
//! from its one definition.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PI, Vec2};
use serde_json::{Value, json};

use super::mesh::{Quality, piece_mesh};
use super::mesh_tests::{check as closed, extent, part, shells};
use super::piece_params::{PROFILES, PieceParams, Profile, Section};
use super::piece_tests::{assert_no_orphans, check, handles, mm_drawing, piece, query, state};
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
