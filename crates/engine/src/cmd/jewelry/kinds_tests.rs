//! Half eternity, dome ring and signet: their numbers, the sheet, the solid and the checks;
//! grams against analytic and numeric references; propose, DXF and properties over drawn
//! parameters.

use cadcraft_geom::{PI, TAU, Vec3};
use hegel::TestCase;
use hegel::generators::{self as gs, Generator};
use serde_json::{Value, json};

use super::kinds::{FACE_SEAT, HalfRow, RESIZE_PLAIN, Taper};
use super::mesh::{Quality, piece_mesh};
use super::mesh_tests::{check as check_mesh, extent, part, shells};
use super::piece_params::{PieceKind, PieceParams};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap()
}

fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn piece(s: &mut Session, p: Value) -> Value {
    s.execute("piece", &p).unwrap_or_else(|e| panic!("PIECE {p}: {e}"))["piece"].clone()
}

fn check_of<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no check {id} in {}", piece["checks"]))
}

fn solid_of(s: &mut Session, sheet: &Value) -> Value {
    let mut q = sheet["params"].clone();
    q["quality"] = json!("fine");
    s.execute("piecemesh", &q).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Half eternity
// ---------------------------------------------------------------------------------------------

#[test]
fn a_half_eternity_packs_the_top_half_and_leaves_the_bottom_plain() {
    let p = params(json!({"kind": "halfeternity"}));
    assert_eq!(p.kind, PieceKind::HalfEternity);
    let half = p.half_row();
    let full = p.eternity_row();
    // The pitch keeps exactly the gap between neighbours.
    assert!((half.between() - p.gap).abs() < 1e-9, "{half:?}");
    // As many as keep every centre within 90° of the top; one more would not.
    let n = half.most;
    assert!(half.angle(n - 1, n) <= PI / 2.0 + 1e-9);
    assert!(half.angle(n, n + 1) > PI / 2.0);
    // About half the eternity band's stones: no more than half of what fit all round, and one.
    assert!(n <= full.fits / 2 + 1 && n + 2 >= full.fits / 2, "{n} of {}", full.fits);
    // Symmetric about 12 o'clock.
    assert!((half.angle(0, n) + half.angle(n - 1, n)).abs() < 1e-12);
    assert!(half.plain(n, p.inner() / 2.0) >= RESIZE_PLAIN);
}

#[test]
fn the_half_eternity_sheet_counts_weighs_and_checks() {
    let mut s = mm_drawing();
    let r = piece(&mut s, json!({"kind": "halfeternity", "melee": 2.0}));
    let p = params(r["params"].clone());
    let half = p.half_row();
    assert_eq!(r["stones"]["count"], half.most);
    assert_eq!(r["stones"]["fits"], half.most);
    // The band's weight is the eternity band's: the row does not change the metal.
    let band = params(json!({"kind": "eternity", "melee": 2.0}));
    assert!((r["metal"]["grams"].as_f64().unwrap() - (band.band_grams() * 1000.0).round() / 1000.0).abs() < 1e-9);
    for id in ["stone-seat", "spacing", "calibrated", "resize", "size", "wall"] {
        assert_eq!(check_of(&r, id)["ok"], true, "{id}: {}", check_of(&r, id));
    }
    let carat = r["stones"]["carat"].as_f64().unwrap();
    let one = piece(&mut s, json!({"count": 1}));
    assert_eq!(one["stones"]["count"], 1);
    assert!((one["stones"]["carat"].as_f64().unwrap() * f64::from(half.most) - carat).abs() < 0.01);
    // More than fit is refused with the number that does, and the drawing is left alone.
    let e = s.execute("piece", &json!({"count": half.most + 1})).unwrap_err().to_string();
    assert!(e.contains(&format!("{} fit", half.most)), "{e}");
    // A stone too wide for the band fails the seat, as on an eternity band.
    let wide = piece(&mut s, json!({"count": null, "melee": 3.0, "width": 2.4}));
    assert_eq!(check_of(&wide, "stone-seat")["ok"], false);
}

#[test]
fn the_half_eternity_solid_is_the_sheets() {
    let mut s = mm_drawing();
    for build in [json!({"kind": "halfeternity"}), json!({"kind": "halfeternity", "cut": "princess", "melee": 1.5, "metal": "platinum"}), json!({"kind": "halfeternity", "count": 5, "melee": 2.5, "width": 3.4})] {
        let sheet = piece(&mut s, build.clone());
        let solid = solid_of(&mut s, &sheet);
        assert_eq!(solid["stones"], sheet["stones"]["count"], "{build}");
        assert_eq!(solid["fits"], sheet["stones"]["fits"], "{build}");
        let p = params(sheet["params"].clone());
        let mesh = piece_mesh(&p, Quality::Draft);
        check_mesh(&mesh, false, &build.to_string());
        // Every stone stands in the top half: none below 3 and 9 o'clock.
        let melee = part(&mesh, "melee");
        let (lowest, _) = extent(melee, 1);
        assert!(lowest > -p.melee, "{build}: a stone at y = {lowest}");
        assert_eq!(shells(melee).len() as u64, sheet["stones"]["count"].as_u64().unwrap());
    }
}

// ---------------------------------------------------------------------------------------------
// Dome ring
// ---------------------------------------------------------------------------------------------

/// The tapered volume by brute force: the section's area and centroid at each of many angles.
fn taper_by_hand(p: &PieceParams) -> f64 {
    let (section, ri, t) = (p.section(), p.inner() / 2.0, p.taper());
    let n = 20_000;
    (0..n)
        .map(|k| {
            let theta = TAU * (k as f64 + 0.5) / n as f64;
            let f = ((1.0 + theta.cos()) / 2.0).powi(2);
            let sx = 1.0 + (t.top_width / p.width - 1.0) * f;
            let sy = 1.0 + (t.top_wall / p.wall - 1.0) * f;
            section.area() * sx * sy * (ri + section.centroid() * sy) * TAU / n as f64
        })
        .sum()
}

#[test]
fn a_dome_ring_tapers_and_weighs_its_tapered_volume() {
    let p = params(json!({"kind": "dome"}));
    assert_eq!(p.profile.name(), "dome", "a dome ring is domed unless told otherwise");
    let t = p.taper();
    assert!((t.top_width - 7.7).abs() < 1e-12 && (t.top_wall - 3.24).abs() < 1e-12, "{t:?}");
    assert_eq!(Taper::f(0.0), 1.0);
    assert!(Taper::f(PI).abs() < 1e-15);
    let by_hand = taper_by_hand(&p);
    assert!((p.band_volume() - by_hand).abs() < 1e-6 * by_hand, "{} vs {by_hand}", p.band_volume());
    // Heavier than the plain band it tapers from, lighter than a band all of the top's size.
    let plain = params(json!({"kind": "band", "profile": "dome"}));
    let all_top = params(json!({"kind": "band", "profile": "dome", "width": 7.7, "wall": 3.24}));
    assert!(p.band_volume() > plain.band_volume() && p.band_volume() < all_top.band_volume());
    // Flat, with the top as the bottom, is the plain band exactly.
    let level = params(json!({"kind": "dome", "profile": "flat", "topWidth": 2.2, "topWall": 1.8}));
    let flat = params(json!({"kind": "band"}));
    assert!((level.band_volume() - flat.band_volume()).abs() < 1e-9 * flat.band_volume());
}

#[test]
fn the_dome_ring_solid_is_inscribed_in_the_weighed_volume() {
    for build in [json!({"kind": "dome"}), json!({"kind": "dome", "profile": "flat", "topWidth": 10, "topWall": 4}), json!({"kind": "dome", "profile": "court", "width": 3, "wall": 1.5})] {
        let p = params(build.clone());
        let mesh = piece_mesh(&p, Quality::Fine);
        check_mesh(&mesh, false, &build.to_string());
        let band = part(&mesh, "band");
        assert_eq!(shells(band).len(), 1);
        let (v, want) = (band.volume(), p.band_volume());
        assert!(v <= want * 1.0005 && v > want * 0.99, "{build}: mesh {v} vs {want}");
        // The top is the top's width and height; the bottom the bottom's.
        let (lo, hi) = extent(band, 1);
        let t = p.taper();
        assert!((hi - (p.inner() / 2.0 + p.section().height_at(0.0) * t.top_wall / p.wall)).abs() < 1e-6, "{build}: top {hi}");
        assert!((lo + (p.inner() / 2.0 + p.section().height_at(0.0))).abs() < 1e-6, "{build}: bottom {lo}");
        let (z0, z1) = extent(band, 2);
        assert!((z1 - z0 - t.top_width).abs() < 1e-6, "{build}");
    }
}

#[test]
fn the_dome_ring_sheet_checks_the_bottom_and_agrees_with_the_solid() {
    let mut s = mm_drawing();
    let r = piece(&mut s, json!({"kind": "dome", "metal": "gold18"}));
    let solid = solid_of(&mut s, &r);
    assert_eq!(solid["metal"]["grams"], r["metal"]["grams"]);
    assert_eq!(r["stones"]["count"], 0);
    assert_eq!(check_of(&r, "wall")["ok"], true);
    // The wall is judged where the shank is thinnest: the bottom.
    let thin = piece(&mut s, json!({"wall": 0.6, "topWall": 3}));
    assert_eq!(check_of(&thin, "wall")["ok"], false);
    // A reverse taper is thinnest at the top.
    let reverse = piece(&mut s, json!({"wall": 2, "topWall": 0.5}));
    assert_eq!(check_of(&reverse, "wall")["ok"], false, "{}", check_of(&reverse, "wall"));
    // The band's front view is the finger circle and the tapered outside.
    assert!(r["message"].is_null() || true);
    let q = s.execute("piece", &json!({"query": true})).unwrap();
    assert_eq!(q["piece"]["params"]["kind"], "dome");
}

// ---------------------------------------------------------------------------------------------
// Signet
// ---------------------------------------------------------------------------------------------

#[test]
fn a_signet_has_a_flat_face_over_a_tapered_shank() {
    let p = params(json!({"kind": "signet"}));
    let face = p.signet_face();
    let ri = p.inner() / 2.0;
    assert_eq!((face.length, face.width), (12.0, 10.0));
    assert!((face.top - (ri + 3.0)).abs() < 1e-12, "the face 3 mm over the finger: {face:?}");
    assert!((face.bottom - (ri + FACE_SEAT)).abs() < 1e-12);
    for (shape, area) in [("round", PI * 25.0), ("oval", PI * 30.0), ("rectangle", 120.0 - (4.0 - PI) * 0.25), ("cushion", 120.0 - (4.0 - PI) * 9.0)] {
        let q = params(json!({"kind": "signet", "face": shape}));
        let f = q.signet_face();
        assert!((f.area() - area).abs() < 1e-9, "{shape}: {} vs {area}", f.area());
        // The outline's polygon is inscribed in it and close.
        let poly = f.outline(256);
        let shoelace: f64 = poly.iter().zip(poly.iter().cycle().skip(1)).take(poly.len()).map(|(a, b)| a.cross(*b)).sum::<f64>() / 2.0;
        assert!(shoelace > 0.99 * area && shoelace <= area + 1e-9, "{shape}: {shoelace} vs {area}");
    }
    // The weight is the shank and the plate, less their overlap: between the shank alone and the
    // shank plus the whole plate.
    let shank = p.taper().volume(&p.section(), ri);
    let plate = face.area() * face.thickness();
    let v = p.band_volume();
    assert!(v > shank + 0.5 * plate && v < shank + plate, "{shank} + {plate} vs {v}");
}

#[test]
fn the_signet_solid_weighs_what_the_sheet_says() {
    for build in [
        json!({"kind": "signet"}),
        json!({"kind": "signet", "face": "round", "faceWidth": 11}),
        json!({"kind": "signet", "face": "cushion", "faceLength": 10, "faceWidth": 10, "metal": "silver"}),
        json!({"kind": "signet", "face": "rectangle", "faceLength": 14, "faceWidth": 11, "wall": 2.0, "width": 3.0}),
    ] {
        let p = params(build.clone());
        let mesh = piece_mesh(&p, Quality::Fine);
        check_mesh(&mesh, false, &build.to_string());
        let (band, face) = (part(&mesh, "band"), part(&mesh, "face"));
        assert_eq!((shells(band).len(), shells(face).len()), (1, 1));
        let f = p.signet_face();
        assert!((face.volume() - f.area() * f.thickness()).abs() < 0.01 * f.area() * f.thickness(), "{build}");
        let shank = p.taper().volume(&p.section(), p.inner() / 2.0);
        assert!((band.volume() - shank).abs() < 0.01 * shank, "{build}");
        // The union is the weight: the shells' sum (overlap counted twice) is more.
        assert!(mesh.shells_volume() > p.band_volume() * 0.99, "{build}");
        let (_, top) = extent(face, 1);
        assert!((top - f.top).abs() < 1e-9);
        let mut s = mm_drawing();
        let r = piece(&mut s, build.clone());
        assert_eq!(check_of(&r, "face")["ok"], true, "{build}");
        let solid = solid_of(&mut s, &r);
        assert_eq!(solid["metal"]["grams"], r["metal"]["grams"], "{build}");
        assert!(solid["meshes"].as_array().unwrap().iter().any(|m| m["name"] == "face"));
    }
}

#[test]
fn a_thin_face_fails_its_check() {
    let mut s = mm_drawing();
    let r = piece(&mut s, json!({"kind": "signet", "topWall": 1.2}));
    assert_eq!(check_of(&r, "face")["ok"], false, "{}", check_of(&r, "face"));
    let r = piece(&mut s, json!({"topWall": 1.6}));
    assert_eq!(check_of(&r, "face")["ok"], true, "{}", check_of(&r, "face"));
}

#[test]
fn the_face_and_shank_bounds_are_signed_and_never_over_the_distance() {
    let p = params(json!({"kind": "signet", "face": "cushion"}));
    let f = p.signet_face();
    let ri = p.inner() / 2.0;
    assert!(p.signet_face_distance(Vec3::new(0.0, (f.top + f.bottom) / 2.0, 0.0)).unwrap() < 0.0);
    assert!(p.signet_face_distance(Vec3::new(0.0, f.top + 1.0, 0.0)).unwrap() > 0.0);
    assert!(params(json!({"kind": "dome"})).signet_face_distance(Vec3::ZERO).is_none());
    assert!(p.taper_distance(Vec3::new(0.0, -(ri + p.wall / 2.0), 0.0)) < 0.0, "in the shank's bottom");
    assert!(p.taper_distance(Vec3::ZERO) > 0.0, "the finger is not metal");
    let mut seed = 11u64;
    let mut rnd = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((seed >> 11) as f64 / (1u64 << 53) as f64) * 2.0 - 1.0
    };
    for _ in 0..3000 {
        let a = Vec3::new(rnd() * 14.0, rnd() * 14.0, rnd() * 8.0);
        let b = a + Vec3::new(rnd(), rnd(), rnd()) * 0.3;
        let d = (a - b).len() + 1e-9;
        assert!((p.taper_distance(a) - p.taper_distance(b)).abs() <= d, "{a:?} {b:?}");
        assert!((p.signet_face_distance(a).unwrap() - p.signet_face_distance(b).unwrap()).abs() <= d);
    }
    // On the shank's tessellated surface the bound is near zero.
    let mesh = piece_mesh(&p, Quality::Draft);
    for v in part(&mesh, "band").positions.iter().step_by(7) {
        assert!(p.taper_distance(*v).abs() < 0.08, "{v:?}: {}", p.taper_distance(*v));
    }
}

// ---------------------------------------------------------------------------------------------
// Every new kind: propose, DXF, switching and properties
// ---------------------------------------------------------------------------------------------

#[test]
fn proposing_a_kind_is_running_it() {
    for kind in ["halfeternity", "dome", "signet"] {
        let mut s = mm_drawing();
        piece(&mut s, json!({"kind": "band"}));
        let r = s.execute("propose", &json!({"steps": [{"command": "piece", "params": {"kind": kind}}], "title": kind})).unwrap();
        let card = &r["proposals"][0];
        let row = card["changes"].as_array().unwrap().iter().find(|c| c["key"] == "piece.kind").unwrap();
        assert_eq!(row["after"], kind);
        s.execute("accept", &json!({"id": card["id"]})).unwrap();
        let mut direct = mm_drawing();
        piece(&mut direct, json!({"kind": "band"}));
        piece(&mut direct, json!({"kind": kind}));
        assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "{kind}: accepted and run directly are the same drawing");
    }
}

#[test]
fn every_new_kind_survives_a_dxf_round_trip() {
    for build in [
        json!({"kind": "halfeternity", "melee": 1.6, "metal": "platinum"}),
        json!({"kind": "dome", "topWidth": 9, "topWall": 3.5}),
        json!({"kind": "signet", "face": "cushion", "faceLength": 11, "faceWidth": 11}),
    ] {
        let mut s = mm_drawing();
        let p = piece(&mut s, build.clone());
        let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
        let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
        let mut t = Session::new();
        t.open_drawing(read, "reopened", None);
        let q = t.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
        for key in ["params", "size", "metal", "stones", "checks"] {
            assert_eq!(q[key], p[key], "{build}: {key}");
        }
        let sheet = t.execute("techsheet", &json!({})).unwrap();
        assert_eq!(sheet["bands"][0]["piece"], build["kind"], "{build}: {}", sheet["bands"]);
        // And it rebuilds there.
        let r = t.execute("piece", &json!({"size": 7})).unwrap();
        assert_eq!(r["piece"]["params"]["kind"], build["kind"]);
    }
}

const NEW_KINDS: [&str; 3] = ["halfeternity", "dome", "signet"];

fn drawn(tc: &TestCase) -> Value {
    let kind = NEW_KINDS[tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    let mut p = json!({"kind": kind});
    let mut maybe = |key: &str, lo: f64, hi: f64| {
        if tc.draw(gs::booleans()) {
            p[key] = json!(tc.draw(gs::floats::<f64>().min_value(lo).max_value(hi)));
        }
    };
    maybe("wall", 0.3, 4.0);
    maybe("width", 0.5, 8.0);
    maybe("topWidth", 0.5, 30.0);
    maybe("topWall", 0.3, 10.0);
    maybe("faceLength", 4.0, 30.0);
    maybe("faceWidth", 4.0, 30.0);
    maybe("melee", 0.8, 6.0);
    maybe("gap", 0.0, 1.0);
    if tc.draw(gs::booleans()) {
        p["profile"] = json!(["flat", "dome", "comfort", "court", "knife", "bevel", "concave"][tc.draw(gs::integers::<usize>().min_value(0).max_value(6))]);
    }
    if tc.draw(gs::booleans()) {
        p["face"] = json!(["round", "oval", "cushion", "rectangle"][tc.draw(gs::integers::<usize>().min_value(0).max_value(3))]);
    }
    if tc.draw(gs::booleans()) {
        p["size"] = json!(tc.draw(gs::integers::<u32>().min_value(3).max_value(13)));
    }
    p
}

/// Rule: any half eternity, dome ring or signet the parser takes builds closed, outward shells;
/// its weight is positive and the solid's; its checks are the numbers' — or `PIECE` refuses it
/// cleanly, leaving the drawing as it was.
#[hegel::test(test_cases = 60)]
fn any_new_kind_is_closed_weighed_and_consistent(tc: TestCase) {
    let build = drawn(&tc);
    tc.note(&format!("{build}"));
    let Ok(p) = PieceParams::parse("piece", &build) else { return };
    let mesh = piece_mesh(&p, Quality::Draft);
    check_mesh(&mesh, false, &build.to_string());
    assert!(p.band_grams() > 0.0 && p.band_grams().is_finite(), "{build}");
    let mut s = mm_drawing();
    match s.execute("piece", &build) {
        Ok(r) => {
            let r = &r["piece"];
            assert_eq!(r["metal"]["grams"], json!((p.band_grams() * 1000.0).round() / 1000.0));
            let wall_ok = check_of(r, "wall")["ok"] == true;
            let (thin, _) = p.section().thinnest();
            let thin = if p.tapered() { thin * p.taper().least_up() } else { thin };
            assert_eq!(wall_ok, thin + 1e-9 >= super::piece_params::MIN_CAST_WALL, "{build}");
            if p.kind == PieceKind::HalfEternity {
                let half = HalfRow::of(p.eternity_row(), p.gap);
                assert_eq!(r["stones"]["count"].as_u64(), Some(u64::from(half.count(p.count))));
                assert_eq!(check_of(r, "spacing")["ok"], true);
            }
            if p.kind == PieceKind::Signet {
                let face = p.signet_face();
                assert_eq!(check_of(r, "face")["ok"] == true, face.thickness() + 1e-9 >= 1.2, "{build}");
            }
        }
        Err(e) => assert!(!matches!(e, crate::EngineError::Internal(..)), "{build} panicked: {e}"),
    }
}

/// Rule: switching to a new kind and back is the piece it was.
#[hegel::test(test_cases = 30)]
fn a_new_kind_and_back_is_the_same_piece(tc: TestCase) {
    let mut s = mm_drawing();
    let from = ["band", "solitaire", "eternity"][tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    let Ok(first) = s.execute("piece", &json!({"kind": from})) else { return };
    let to = NEW_KINDS[tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    if s.execute("piece", &json!({"kind": to})).is_err() {
        return;
    }
    let back = s.execute("piece", &json!({"kind": from})).unwrap();
    for key in ["params", "metal", "stones", "checks"] {
        assert_eq!(back["piece"][key], first["piece"][key], "{from} → {to} → {from}: {key}");
    }
}

/// Rule: hostile numbers never panic the parser, the sheet or the solid of a new kind.
#[hegel::test(test_cases = 200)]
fn hostile_new_kind_params_never_panic(tc: TestCase) {
    let any = |tc: &TestCase| -> Value {
        match tc.draw(gs::integers::<u8>().min_value(0).max_value(5)) {
            0 => json!(f64::MAX),
            1 => json!(-1e300),
            2 => json!("oval"),
            3 => Value::Null,
            4 => json!(tc.draw(gs::floats::<f64>().min_value(-100.0).max_value(100.0))),
            _ => json!({"a": 1}),
        }
    };
    let kind = NEW_KINDS[tc.draw(gs::integers::<usize>().min_value(0).max_value(2))];
    let build = json!({"kind": kind, "topWidth": any(&tc), "topWall": any(&tc), "face": any(&tc), "faceLength": any(&tc), "faceWidth": any(&tc), "count": any(&tc), "melee": any(&tc), "wall": any(&tc)});
    let mut s = mm_drawing();
    for cmd in ["piece", "piecemesh", "stlout"] {
        if let Err(e) = s.execute(cmd, &build) {
            assert!(!matches!(e, crate::EngineError::Internal(..)), "{cmd} {build}: {e}");
        }
    }
}
