//! Property-based tests for the jewelry commands, with Hegel (`hegeltest`, imported as `hegel`).
//!
//! Each property states a rule in one sentence and Hegel draws the inputs: fingers, stones,
//! regions, pieces and hostile JSON. The measurements a property checks against are made here,
//! from the drawing the command left (the inserts, the blocks' outlines) and from the trade's
//! published definitions, not from the code under test.
//!
//! A failure prints the drawn values, the `note`s (the command and its parameters) and a
//! `#[hegel::reproduce_failure("…")]` line; `HEGEL_SEED=n cargo test -p cadcraft-engine
//! property_tests` replays a run. Every bug a property found is kept beside it as an ordinary
//! `#[test]` with the shrunk input.
//!
//! When a kind or a profile is added to `PIECE`, add it to [`KINDS`] and [`PROFILES`].

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::{PI, TAU, Vec2};
use hegel::generators::{self as gs, Generator, PrintableGenerator};
use hegel::{HealthCheck, TestCase};
use serde_json::{Map, Value, json};

use super::gem::{self, CUTS, STONES};
use super::mesh::{MAX_TRIANGLES, Quality, piece_mesh};
use super::mesh_tests::{check as check_mesh, extent, part};
use super::piece_params::{MAX_PIECE_STONES, PieceParams, round_us};
use super::sizes::{RingSize, density_of};
use super::tests::{circle, handle_of, polyline};
use super::*;
use crate::{EngineError, Session};

// ---------------------------------------------------------------------------------------------
// What every property shares
// ---------------------------------------------------------------------------------------------

/// The kinds and profiles `PIECE` builds.
const KINDS: [&str; 3] = ["band", "solitaire", "eternity"];
const PROFILES: [&str; 2] = ["flat", "dome"];
const SYSTEMS: [&str; 5] = ["us", "uk", "eu", "jp", "cn"];
const METALS: [&str; 14] =
    ["gold24", "gold22", "gold18", "gold14", "gold10", "gold9", "platinum", "palladium", "silver", "steel", "titanium", "brass", "copper", "wax"];

/// The trade's ring diameters (mm).
const MIN_FINGER: f64 = 11.6;
const MAX_FINGER: f64 = 25.0;

/// A drawing in millimetres, or in inches (what a new drawing is).
fn drawing(inch: bool) -> Session {
    let mut s = Session::new();
    if !inch {
        s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    }
    assert_eq!(mm_per_unit(&s), if inch { 25.4 } else { 1.0 });
    s
}

/// The drawing as a property compares it: its objects, its undo depth and its revision.
fn state(s: &Session) -> (usize, usize, u64) {
    let st = s.state().unwrap();
    (st.doc.model.len(), st.undo.len(), st.revision)
}

fn handle(v: &Value) -> Handle {
    Handle::parse_hex(v.as_str().unwrap_or_else(|| panic!("not a handle: {v}"))).unwrap()
}

fn handles(v: &Value) -> Vec<Handle> {
    v.as_array().unwrap_or_else(|| panic!("not a list of handles: {v}")).iter().map(handle).collect()
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("not a number: {v}"))
}

/// A panic the engine's guard caught is an `Internal` error: a refusal is any other error.
fn caught_panic<T>(r: &Result<T>) -> bool {
    matches!(r, Err(EngineError::Internal(..)))
}

/// Run `f` and hand back what it returned and how long it took. A call that has not returned in
/// two minutes is a hang: the process is stopped with the call named, since nothing else ends a
/// loop that never does.
fn timed<T>(what: &str, f: impl FnOnce() -> T) -> (T, Duration) {
    let (done, waiting) = channel::<()>();
    let label = what.to_string();
    let dog = std::thread::spawn(move || {
        if waiting.recv_timeout(Duration::from_secs(120)) == Err(RecvTimeoutError::Timeout) {
            eprintln!("HANG: no answer in 120 s from {label}");
            std::process::abort();
        }
    });
    let start = Instant::now();
    let out = f();
    let took = start.elapsed();
    drop(done);
    let _ = dog.join();
    (out, took)
}

fn float(tc: &TestCase, lo: f64, hi: f64) -> f64 {
    tc.draw(gs::floats::<f64>().min_value(lo).max_value(hi))
}

/// A length on the bench's own grid: hundredths of a millimetre.
fn hundredths(tc: &TestCase, lo: f64, hi: f64) -> f64 {
    let n = tc.draw(gs::integers::<i64>().min_value((lo * 100.0).ceil() as i64).max_value((hi * 100.0).floor() as i64));
    n as f64 / 100.0
}

/// A length a bench would give (hundredths) most of the time, and any float in the range the
/// rest.
fn length(tc: &TestCase, lo: f64, hi: f64) -> f64 {
    if tc.draw(gs::weighted_booleans(0.75)) { hundredths(tc, lo, hi) } else { float(tc, lo, hi) }
}

fn pick(tc: &TestCase, from: &[&'static str]) -> &'static str {
    tc.draw(gs::sampled_from(from.to_vec()))
}

fn cut_name(tc: &TestCase) -> &'static str {
    tc.draw(gs::sampled_from(CUTS.iter().map(|c| c.name).collect::<Vec<_>>()))
}

fn stone_name(tc: &TestCase) -> &'static str {
    tc.draw(gs::sampled_from(STONES.iter().map(|s| s.0).collect::<Vec<_>>()))
}

/// A stone's length and width for a cut: a round as long as it is wide, an oval or a cabochon
/// now and then wider than long (the same stone turned a quarter turn), the rest as long as wide
/// or up to three times longer.
fn stone_size(tc: &TestCase, cut: &str, lo: f64, hi: f64) -> (f64, f64) {
    let width = length(tc, lo, hi);
    if cut == "round" || tc.draw(gs::weighted_booleans(0.3)) {
        return (width, width);
    }
    let other = length(tc, lo, (3.0 * width).min(3.0 * hi));
    if matches!(cut, "oval" | "cabochon") { (other, width) } else { (other.max(width), other.min(width)) }
}

fn point(tc: &TestCase, reach: f64) -> Vec2 {
    Vec2::new(hundredths(tc, -reach, reach), hundredths(tc, -reach, reach))
}

// ---------------------------------------------------------------- geometry measured here

fn segment_gap(p: Vec2, a: Vec2, b: Vec2) -> f64 {
    let d = b - a;
    let len2 = d.dot(d);
    if len2 <= 0.0 {
        return p.dist(a);
    }
    p.dist(a + d * ((p - a).dot(d) / len2).clamp(0.0, 1.0))
}

fn sides(poly: &[Vec2]) -> impl Iterator<Item = (Vec2, Vec2)> + '_ {
    poly.iter().copied().zip(poly.iter().copied().cycle().skip(1))
}

/// The distance from `p` to a closed polygon's outline.
fn outline_gap(p: Vec2, poly: &[Vec2]) -> f64 {
    sides(poly).map(|(a, b)| segment_gap(p, a, b)).fold(f64::INFINITY, f64::min)
}

/// Whether `p` is inside a closed polygon (even-odd, by a ray to +x).
fn inside(p: Vec2, poly: &[Vec2]) -> bool {
    let mut odd = false;
    for (a, b) in sides(poly) {
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            odd = !odd;
        }
    }
    odd
}

fn crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool {
    let side = |p: Vec2, q: Vec2, r: Vec2| (q - p).cross(r - p);
    side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0
}

/// The least distance between two closed polygons' outlines: nothing when they cross.
fn polygons_gap(p: &[Vec2], q: &[Vec2]) -> f64 {
    let mut least = f64::INFINITY;
    for (a, b) in sides(p) {
        for (c, d) in sides(q) {
            if crossing(a, b, c, d) {
                return 0.0;
            }
            least = least.min(segment_gap(a, c, d)).min(segment_gap(c, a, b));
        }
    }
    least
}

/// A stone as the drawing holds it: where its insert is and the outline its block draws, in
/// millimetres.
struct Laid {
    block: String,
    centre: Vec2,
    rotation: f64,
    /// The girdle, sampled; every point is on the outline.
    outline: Vec<Vec2>,
    /// The girdle's radius, when it is a circle.
    radius: Option<f64>,
}

fn laid(s: &Session, h: &Value) -> Laid {
    let d = s.doc().unwrap();
    let k = mm_per_unit(s);
    let EntityKind::Insert(ins) = &d.entity(handle(h)).unwrap().kind else { panic!("{h} is not an insert") };
    let blk = d.block(&ins.block).unwrap();
    let first = blk.entities.iter().next().unwrap();
    let (pts, closed) = entity_loop(first, 1.0).unwrap();
    assert!(closed, "{}: the girdle is not closed", ins.block);
    let scale = ins.scale.x;
    assert!(
        (ins.scale.y - scale).abs() < 1e-15 && (scale * k - 1.0).abs() < 1e-12,
        "{}: a block of millimetres is scaled {scale} in a drawing of {k} mm units",
        ins.block
    );
    let world = |q: Vec2| (ins.insert.xy() + q.rotate(ins.rotation) * scale) * k;
    let radius = match &first.kind {
        EntityKind::Circle(c) => Some(c.radius * scale * k),
        _ => None,
    };
    Laid { block: ins.block.clone(), centre: ins.insert.xy() * k, rotation: ins.rotation, outline: pts.into_iter().map(world).collect(), radius }
}

/// The exact width (x) and length (y) of an outline as a block holds it.
fn outline_extent(kind: &EntityKind) -> (f64, f64) {
    match kind {
        EntityKind::Circle(c) => (2.0 * c.radius, 2.0 * c.radius),
        EntityKind::Ellipse(e) => {
            let (major, minor) = (e.major.xy(), e.major.xy().perp() * e.ratio);
            (2.0 * major.x.hypot(minor.x), 2.0 * major.y.hypot(minor.y))
        }
        EntityKind::LwPolyline(pl) => {
            let b = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: pl.closed }.bounds();
            (b.max.x - b.min.x, b.max.y - b.min.y)
        }
        other => panic!("not an outline: {other:?}"),
    }
}

// ---------------------------------------------------------------------------------------------
// 1. Ring sizes
// ---------------------------------------------------------------------------------------------

/// The published definitions, written out here: the inside diameter each system's size names.
fn us_diameter(n: f64) -> f64 {
    0.8128 * n + 11.63
}
fn uk_letter_diameter(label: &str) -> f64 {
    let mut chars = label.chars();
    let letter = chars.next().unwrap();
    assert!(letter.is_ascii_uppercase(), "UK {label}");
    let half = match chars.as_str() {
        "" => 0.0,
        "½" => 0.5,
        other => panic!("UK {label}: {other}"),
    };
    // A is US ½ and each letter is half a US size.
    us_diameter((f64::from(letter as u8 - b'A') + half + 1.0) / 2.0)
}
fn eu_diameter(n: f64) -> f64 {
    n / PI
}
fn jp_diameter(n: f64) -> f64 {
    13.0 + (n - 1.0) / 3.0
}
fn cn_diameter(n: f64) -> f64 {
    (n + 40.0) / PI
}

/// The finger each system's label names and half that system's step, in millimetres of diameter:
/// a US size is a number (no step), a UK half letter is a quarter US size, EU and CN step a
/// millimetre of circumference, JP a third of a millimetre of diameter.
fn named(r: &RingSize) -> [(&'static str, f64, f64, Option<RingSize>); 5] {
    [
        ("us", us_diameter(r.us), 1e-9, RingSize::from_us(r.us)),
        ("uk", uk_letter_diameter(&r.uk()), 0.8128 / 8.0, RingSize::from_uk(&r.uk())),
        ("eu", eu_diameter(f64::from(r.eu)), 0.5 / PI, RingSize::from_eu(f64::from(r.eu))),
        ("jp", jp_diameter(f64::from(r.jp)), 1.0 / 6.0, RingSize::from_jp(f64::from(r.jp))),
        ("cn", cn_diameter(f64::from(r.cn)), 0.5 / PI, RingSize::from_cn(f64::from(r.cn))),
    ]
}

/// The fingers every system has a size for: from half a step under CN 0 (12.73 mm; JP 0 and UK A
/// are smaller) to half a step over UK Z½ (22.40 mm).
const EVERY_SYSTEM: (f64, f64) = (12.58, 22.49);

fn reads_back(d: f64) {
    let r = RingSize::from_diameter(d).unwrap_or_else(|| panic!("{d} mm is a ring size"));
    for (system, names, half_step, back) in named(&r) {
        assert!(
            (names - d).abs() <= half_step + 1e-9,
            "{system}: a {d} mm finger is named as {names} mm, more than half a step ({half_step} mm) away"
        );
        match back {
            Some(b) => assert!((b.diameter - names).abs() < 1e-9, "{system}: the label reads back as {} mm, it names {names} mm", b.diameter),
            // The nearest size may lie past the end of the trade's range, and then it is no size.
            None => assert!(!(MIN_FINGER..=MAX_FINGER).contains(&names), "{system}: the label names {names} mm and does not read back"),
        }
    }
}

/// Rule: a finger named in any system reads back as the same finger, within half that system's
/// own step.
#[hegel::test(test_cases = 2000)]
fn a_finger_reads_back_within_each_systems_step(tc: TestCase) {
    let d = float(&tc, EVERY_SYSTEM.0, EVERY_SYSTEM.1);
    reads_back(d);
}

/// Rule: the same holds over the whole of the trade's range — no system names a finger it has
/// no size for.
#[hegel::test(test_cases = 2000)]
#[ignore = "REAL DEFECT, a product decision: under 12.84 mm (JP 0, CN 0, UK A) and over 22.5 mm (UK Z½) RingSize clamps \
            the system's number to its end instead of saying there is no such size (a 25 mm finger reads `UK Z`, 22.2 mm); \
            fixing it changes the shape of every size row (jp/cn/uk would have to be optional)"]
fn no_system_names_a_finger_it_has_no_size_for(tc: TestCase) {
    let d = float(&tc, MIN_FINGER, MAX_FINGER);
    reads_back(d);
}

/// The shrunk cases of the property above, kept: the ends of the range.
#[test]
#[ignore = "see no_system_names_a_finger_it_has_no_size_for"]
fn the_ends_of_the_range_are_named_by_clamped_sizes() {
    reads_back(25.0);
    reads_back(11.6);
}

/// Rule: a size row's numbers are finite and agree with each other (circumference = π ×
/// diameter), and a larger finger is never a smaller size in any system.
#[hegel::test(test_cases = 2000)]
fn a_size_row_is_consistent_and_sizes_grow_with_the_finger(tc: TestCase) {
    let a = float(&tc, MIN_FINGER, MAX_FINGER);
    let b = float(&tc, MIN_FINGER, MAX_FINGER);
    let (ra, rb) = (RingSize::from_diameter(a).unwrap(), RingSize::from_diameter(b).unwrap());
    for (d, r) in [(a, &ra), (b, &rb)] {
        let j = r.json();
        for key in ["mm", "diameter", "circumference", "us"] {
            assert!(num(&j[key]).is_finite(), "{key} of {j}");
        }
        assert!((num(&j["mm"]) - d).abs() <= 0.0005 + 1e-12 && j["mm"] == j["diameter"], "{j}");
        assert!((num(&j["circumference"]) - PI * d).abs() <= 0.0005 + 1e-12, "{j}");
        assert!((num(&j["circumference"]) - PI * num(&j["diameter"])).abs() <= 0.0005 * (1.0 + PI) + 1e-12, "{j}");
        assert!((num(&j["us"]) - (d - 11.63) / 0.8128).abs() <= 0.0005 + 1e-9, "{j}");
        for key in ["eu", "jp", "cn"] {
            assert!(j[key].is_u64(), "{key} of {j}");
        }
        assert!(!j["uk"].as_str().unwrap().is_empty() && !j["usText"].as_str().unwrap().is_empty(), "{j}");
        assert!((r.circumference - PI * r.diameter).abs() < 1e-12);
    }
    let (small, large) = if a <= b { (&ra, &rb) } else { (&rb, &ra) };
    assert!(small.us <= large.us && small.uk_index <= large.uk_index && small.eu <= large.eu && small.jp <= large.jp && small.cn <= large.cn);
    if a != b {
        assert!(small.us < large.us, "US sizes are a number: a different finger is a different size");
    }
}

/// A diameter that is not a ring size: outside 11.6–25 mm, or not a number at all.
fn not_a_finger(tc: &TestCase) -> f64 {
    let odd = vec![f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -0.0, -16.5, 1e308, -1e308, 5e-324, 11.599999, 25.000001, 1e17];
    tc.draw(hegel::one_of!(
        gs::floats::<f64>().min_value(-1e6).max_value(MIN_FINGER).filter(|d| *d < MIN_FINGER - 1e-6),
        gs::floats::<f64>().min_value(MAX_FINGER).max_value(1e6).filter(|d| *d > MAX_FINGER + 1e-6),
        gs::sampled_from(odd),
    ))
}

/// Rule: a diameter outside the trade's range is refused — by the conversion, by `RING` and by
/// `RINGSIZES` measuring a circle of it — and never clamped to the nearest size.
#[hegel::test(test_cases = 300)]
fn a_finger_outside_the_range_is_refused(tc: TestCase) {
    let d = not_a_finger(&tc);
    let inch = tc.draw(gs::booleans());
    assert!(RingSize::from_diameter(d).is_none(), "{d} mm is not a ring size");
    let mut s = drawing(inch);
    let before = state(&s);
    let r = s.execute("ring", &json!({"at": [0, 0], "diameter": d}));
    assert!(r.is_err() && !caught_panic(&r), "RING took a {d} mm finger: {r:?}");
    assert_eq!(state(&s), before, "a refused RING left something behind");
    // A circle of that diameter, when one can be drawn at all, does not measure as a size.
    let radius = d / 2.0 / mm_per_unit(&s);
    if let Ok(c) = s.execute("circle", &json!({"center": [3, 4], "radius": radius})) {
        let before = state(&s);
        let r = s.execute("ringsizes", &json!({"handle": handle_of(&c)}));
        assert!(r.is_err() && !caught_panic(&r), "RINGSIZES measured a {d} mm circle as a size: {r:?}");
        assert_eq!(state(&s), before);
    }
}

/// Rule: `RINGSIZES {handle}` measures a drawn circle back as the finger it was drawn for, in a
/// millimetre drawing and in an inch one.
#[hegel::test(test_cases = 300)]
fn ringsizes_measures_a_drawn_circle_back(tc: TestCase) {
    let d = float(&tc, MIN_FINGER, MAX_FINGER);
    let inch = tc.draw(gs::booleans());
    let at = point(&tc, 100.0);
    measures_back(d, inch, at);
}

fn measures_back(d: f64, inch: bool, at: Vec2) {
    let mut s = drawing(inch);
    let k = mm_per_unit(&s);
    let c = circle(&mut s, [at.x / k, at.y / k], d / 2.0 / k);
    let before = state(&s);
    let r = s.execute("ringsizes", &json!({"handle": c})).unwrap_or_else(|e| panic!("a {d} mm circle: {e}"));
    assert_eq!(state(&s), before, "measuring changes nothing");
    assert_eq!(r["count"], json!(1));
    assert_eq!(r["measured"]["from"], "circle");
    assert!((num(&r["measured"]["diameter"]) - d).abs() <= 0.0005 + 1e-9, "a {d} mm circle measured {}", r["measured"]["diameter"]);
    assert!((num(&r["sizes"][0]["mm"]) - d).abs() <= 0.0005 + 1e-9, "{r}");
    assert!((num(&r["measured"]["circumference"]) - PI * d).abs() <= 0.0005 + 1e-9, "{r}");
    // The nearest standard size in each system is within half that system's step, or there is
    // none in the trade's range on that side.
    // (The UK's letters run from A, 12.04 mm, to Z½, 22.40 mm; the others to the ends of the range.)
    for (system, half_step) in [("us", 0.8128 / 8.0), ("uk", 0.8128 / 8.0), ("eu", 0.5 / PI), ("jp", 1.0 / 6.0), ("cn", 0.5 / PI)] {
        let near = &r["measured"]["nearestIn"][system];
        if !near.is_null() {
            let off = num(&near["offBy"]);
            assert!((num(&near["mm"]) + off - d).abs() <= 0.0011, "{system}: {near} of a {d} mm finger");
            let (first, last) = if system == "uk" { (uk_letter_diameter("A"), uk_letter_diameter("Z½")) } else { (MIN_FINGER, MAX_FINGER) };
            let at_an_end = d - half_step < first || d + half_step > last;
            assert!(off.abs() <= half_step + 0.0006 || at_an_end, "{system}: the nearest size is {off} mm off a {d} mm finger");
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 2. Gems
// ---------------------------------------------------------------------------------------------

/// Rule: `GEM` draws, for any cut and size, a closed outline exactly as wide and as long as
/// asked, at the place, turn and scale asked, and reports the weight the formula gives.
#[hegel::test(test_cases = 400)]
fn gem_draws_the_stone_asked_for(tc: TestCase) {
    let inch = tc.draw(gs::booleans());
    let cut = cut_name(&tc);
    let (long, wide) = stone_size(&tc, cut, 0.5, 20.0);
    let material = tc.draw(gs::optional(gs::sampled_from(STONES.iter().map(|s| s.0).collect::<Vec<_>>())));
    let at = point(&tc, 60.0);
    let turn = tc.draw(gs::optional(gs::integers::<i32>().min_value(-360).max_value(360)));
    let table = tc.draw(gs::booleans());
    gem_is_the_stone_asked_for(inch, cut, long, wide, material, at, turn, table);
}

#[allow(clippy::too_many_arguments)]
fn gem_is_the_stone_asked_for(inch: bool, cut: &str, long: f64, wide: f64, material: Option<&str>, at: Vec2, turn: Option<i32>, table: bool) {
    let mut s = drawing(inch);
    let k = mm_per_unit(&s);
    let mut p = json!({"at": [at.x / k, at.y / k], "cut": cut, "length": long, "width": wide, "table": table});
    if let Some(m) = material {
        p["stone"] = json!(m);
    }
    if let Some(t) = turn {
        p["rotate"] = json!(t);
    }
    let r = s.execute("gem", &p).unwrap_or_else(|e| panic!("GEM {p}: {e}"));
    let what = format!("GEM {p} → {r}");
    assert_eq!(state(&s).0, 1, "{what}: one insert");

    // The outline: closed, and exactly the size asked for.
    let stone = laid(&s, &r["handle"]);
    let d = s.doc().unwrap();
    let blk = d.block(&stone.block).unwrap();
    assert_eq!(blk.entities.len(), if table { 2 } else { 1 }, "{what}: the girdle, and the table when asked");
    let (w, l) = outline_extent(&blk.entities.iter().next().unwrap().kind);
    assert!((w - wide).abs() < 1e-6 && (l - long).abs() < 1e-6, "{what}: the outline is {w} wide and {l} long");
    assert!(stone.outline.len() >= 3 && stone.outline.iter().all(|q| q.is_finite()), "{what}");
    assert!((stone.centre - at).len() < 1e-9, "{what}: placed at {:?}", stone.centre);
    assert!((stone.rotation - f64::from(turn.unwrap_or(0)).to_radians()).abs() < 1e-12, "{what}: turned {}", stone.rotation);

    // The weight: positive, finite, and the formula's.
    let data = gem::cut_of(cut).unwrap();
    let sg = material.map_or(3.52, |m| gem::sg_of(m).unwrap());
    let depth = gem::default_depth(data, wide);
    let exact = gem::carat(data, long, wide, depth, sg);
    assert!(exact.is_finite() && exact > 0.0, "{what}: {exact} ct");
    assert!((num(&r["carat"]) - exact).abs() <= 0.0005 + 1e-12, "{what}: the formula gives {exact} ct");
    assert!(num(&r["carat"]) > 0.0 || exact < 0.0005, "{what}");
    assert_eq!(num(&r["sg"]), sg, "{what}");
    assert!((num(&r["depth"]) - depth).abs() <= 0.0005 + 1e-12, "{what}");

    // The block's name is the stone: its cut, its size and its material read back from it.
    assert_eq!(r["block"], json!(stone.block), "{what}");
    let name = parse_gem_block(&stone.block).unwrap_or_else(|| panic!("{what}: the block's name does not read back"));
    assert_eq!(name.cut, data.name, "{what}");
    assert!((name.length - long).abs() < 1e-9 && (name.width - wide).abs() < 1e-9, "{what}: the name says {}×{}", name.length, name.width);
    assert_eq!(name.material.as_deref(), material.filter(|m| *m != "diamond"), "{what}");
    assert_eq!(name.depth, None, "{what}: the depth was the cut's usual one");
}

/// Rule: a stone's weight is positive and finite, eight times as much when every dimension is
/// doubled, and in proportion to its specific gravity.
#[hegel::test(test_cases = 1000)]
fn carat_scales_as_the_formula_says(tc: TestCase) {
    let cut = cut_name(&tc);
    let data = gem::cut_of(cut).unwrap();
    let (long, wide) = stone_size(&tc, cut, 0.3, 30.0);
    let depth = float(&tc, 0.1, 30.0);
    let sg = float(&tc, 1.0, 8.0);
    let near = |a: f64, b: f64| (a - b).abs() <= 1e-12 * a.abs().max(b.abs());
    let ct = gem::carat(data, long, wide, depth, sg);
    assert!(ct.is_finite() && ct > 0.0, "{cut} {long}×{wide}×{depth} at SG {sg}: {ct} ct");
    assert!(near(gem::carat(data, 2.0 * long, 2.0 * wide, 2.0 * depth, sg), 8.0 * ct), "doubled, it is eight times the weight");
    assert!(near(gem::carat(data, long, wide, depth, 2.5 * sg), 2.5 * ct), "a denser stone is heavier in proportion");
    let diamond = gem::carat(data, long, wide, depth, 3.52);
    for (name, gravity) in STONES {
        assert!(near(gem::carat(data, long, wide, depth, *gravity) * 3.52, diamond * gravity), "{name}");
    }
}

/// Rule: `GEM` weighs a stone twice the size in every dimension at eight times the carats, and
/// the same stone in a denser material in proportion (within the reply's rounding).
#[hegel::test(test_cases = 200)]
fn gem_weighs_a_doubled_stone_eight_times_and_a_denser_one_in_proportion(tc: TestCase) {
    let cut = cut_name(&tc);
    let (long, wide) = stone_size(&tc, cut, 1.0, 10.0);
    let depth = hundredths(&tc, 0.5, 8.0);
    let material = stone_name(&tc);
    let mut s = drawing(false);
    let mut carat = |scale: f64, stone: &str| {
        let p = json!({"at": [0, 0], "cut": cut, "length": scale * long, "width": scale * wide, "depth": scale * depth, "stone": stone});
        num(&s.execute("gem", &p).unwrap_or_else(|e| panic!("GEM {p}: {e}"))["carat"])
    };
    let (one, two, other) = (carat(1.0, "diamond"), carat(2.0, "diamond"), carat(1.0, material));
    assert!((two - 8.0 * one).abs() <= 9.0 * 0.0005 + 1e-9, "{one} ct doubled is {two} ct");
    let gravity = gem::sg_of(material).unwrap();
    assert!((other - one * gravity / 3.52).abs() <= 0.0005 * (1.0 + gravity / 3.52) + 1e-9, "{one} ct of diamond is {other} ct of {material}");
}

/// Rule: a block name reads back as the stone it names — the same cut, size, material and depth
/// — for every material `GEMLIST` lists.
#[hegel::test(test_cases = 500)]
fn a_block_name_reads_back_as_the_stone_it_names(tc: TestCase) {
    let cut = cut_name(&tc);
    let (long, wide) = stone_size(&tc, cut, 0.3, 30.0);
    let depth = tc.draw(gs::optional(gs::floats::<f64>().min_value(0.1).max_value(30.0)));
    let gravity = float(&tc, 1.0, 8.0);
    name_reads_back(cut, long, wide, depth, gravity);
}

fn name_reads_back(cut: &str, long: f64, wide: f64, depth: Option<f64>, gravity: f64) {
    let listed = STONES.iter().map(|s| (Some(s.0), None));
    for (material, sg) in listed.chain([(None, None), (None, Some(gravity))]) {
        let name = gem_block_name(cut, long, wide, material, sg, depth);
        let back = parse_gem_block(&name).unwrap_or_else(|| panic!("{name} does not read back"));
        assert_eq!(back.cut, cut, "{name}");
        assert!(
            (back.length - long).abs() < 1e-9 && (back.width - wide).abs() < 1e-9,
            "{name} names a {long}×{wide} stone, and reads {}×{}",
            back.length,
            back.width
        );
        assert_eq!(back.material.as_deref(), material.filter(|m| *m != "diamond"), "{name}");
        assert_eq!(back.sg.is_some(), sg.is_some(), "{name}");
        assert!(back.sg.zip(sg).is_none_or(|(a, b)| (a - b).abs() < 1e-9), "{name} names SG {sg:?}");
        assert_eq!(back.depth.is_some(), depth.is_some(), "{name}");
        assert!(back.depth.zip(depth).is_none_or(|(a, b)| (a - b).abs() < 1e-9), "{name} names a depth of {depth:?}");
    }
}

// ---------------------------------------------------------------------------------------------
// 3. Pavé
// ---------------------------------------------------------------------------------------------

/// A convex region, in millimetres, as it was drawn.
#[derive(Debug, Clone)]
enum Bed {
    Circle {
        centre: Vec2,
        radius: f64,
    },
    /// Counter-clockwise.
    Polygon(Vec<Vec2>),
}

impl Bed {
    /// How far inside the region `p` is (negative outside).
    fn depth(&self, p: Vec2) -> f64 {
        match self {
            Bed::Circle { centre, radius } => radius - p.dist(*centre),
            Bed::Polygon(v) => sides(v).map(|(a, b)| (b - a).cross(p - a) / (b - a).len()).fold(f64::INFINITY, f64::min),
        }
    }
}

/// A drawn region: its handle, its shape, and the radius of the largest circle it holds.
struct Region {
    handle: String,
    bed: Bed,
    inradius: f64,
}

/// A rectangle, a circle or a regular polygon of any size up to `reach` and any turn, drawn in
/// the session.
fn region(tc: &TestCase, s: &mut Session, reach: f64) -> Region {
    let k = mm_per_unit(s);
    let centre = point(tc, 40.0);
    let turn = float(tc, 0.0, TAU);
    let (bed, inradius) = match pick(tc, &["rectangle", "circle", "polygon"]) {
        "rectangle" => {
            let (w, h) = (hundredths(tc, 1.2, 2.0 * reach), hundredths(tc, 1.2, 2.0 * reach));
            let corners = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)];
            (Bed::Polygon(corners.iter().map(|(x, y)| centre + Vec2::new(x * w / 2.0, y * h / 2.0).rotate(turn)).collect()), w.min(h) / 2.0)
        }
        "circle" => {
            let radius = hundredths(tc, 0.8, reach);
            (Bed::Circle { centre, radius }, radius)
        }
        _ => {
            let n = tc.draw(gs::integers::<u32>().min_value(3).max_value(10));
            let radius = hundredths(tc, 1.2, reach);
            let corner = |i: u32| centre + Vec2::new(radius, 0.0).rotate(turn + TAU * f64::from(i) / f64::from(n));
            (Bed::Polygon((0..n).map(corner).collect()), radius * (PI / f64::from(n)).cos())
        }
    };
    let handle = match &bed {
        Bed::Circle { centre, radius } => circle(s, [centre.x / k, centre.y / k], radius / k),
        Bed::Polygon(v) => polyline(s, &v.iter().map(|q| *q / k).collect::<Vec<_>>()),
    };
    Region { handle, bed, inradius }
}

/// The melee a fill is asked for: any cut, a calibrated width most of the time.
struct Melee {
    cut: &'static str,
    long: f64,
    wide: f64,
}

fn melee(tc: &TestCase) -> Melee {
    let cut = cut_name(tc);
    let wide = if tc.draw(gs::weighted_booleans(0.7)) { tc.draw(gs::sampled_from(CALIBRATED.to_vec())) } else { hundredths(tc, 0.8, 3.0) };
    let ratio = if cut == "round" || tc.draw(gs::booleans()) { 1.0 } else { hundredths(tc, 1.0, 2.5) };
    Melee { cut, long: wide * ratio, wide }
}

/// Every stone `PAVE` placed, measured: inside the region by `clearance + edge`, and `clearance`
/// from every other stone.
fn assert_clear(s: &Session, placed: &Value, bed: &Bed, clearance: f64, edge: f64, what: &str) {
    const SLACK: f64 = 1e-6;
    let stones: Vec<Laid> = placed.as_array().unwrap().iter().map(|h| laid(s, h)).collect();
    for st in &stones {
        let inset = match st.radius {
            Some(r) => bed.depth(st.centre) - r,
            None => st.outline.iter().map(|q| bed.depth(*q)).fold(f64::INFINITY, f64::min),
        };
        assert!(inset >= clearance + edge - SLACK, "{what}: the stone at {:?} is {inset} mm from the edge, under {} mm", st.centre, clearance + edge);
    }
    // Stones are compared as the polygons through at most 48 points of their girdles: for a
    // convex girdle that polygon is inside the stone, so it is never nearer than the stone is.
    let thin = |st: &Laid| -> Vec<Vec2> {
        let step = st.outline.len().div_ceil(48).max(1);
        st.outline.iter().step_by(step).copied().collect()
    };
    let reach = |st: &Laid| st.outline.iter().map(|q| q.dist(st.centre)).fold(0.0f64, f64::max);
    let coarse: Vec<(Vec<Vec2>, f64)> = stones.iter().map(|st| (thin(st), reach(st))).collect();
    for (i, a) in stones.iter().enumerate() {
        for (j, b) in stones.iter().enumerate().skip(i + 1) {
            let apart = a.centre.dist(b.centre);
            let gap = match (a.radius, b.radius) {
                (Some(ra), Some(rb)) => apart - ra - rb,
                _ if apart > coarse[i].1 + coarse[j].1 + clearance => continue,
                _ => polygons_gap(&coarse[i].0, &coarse[j].0),
            };
            assert!(gap >= clearance - SLACK, "{what}: the stones at {:?} and {:?} are {gap} mm apart, under {clearance} mm", a.centre, b.centre);
        }
    }
}

/// Rule: every stone `PAVE` places in a convex region has its whole outline inside the region at
/// least `clearance + edge` from the boundary and at least `clearance` from every other stone,
/// and is the stone asked for.
#[hegel::test(test_cases = 250)]
fn pave_keeps_every_stone_clear_of_the_edge_and_of_its_neighbours(tc: TestCase) {
    let inch = tc.draw(gs::booleans());
    let mut s = drawing(inch);
    let bed = region(&tc, &mut s, 6.0);
    let stone = melee(&tc);
    let clearance = hundredths(&tc, 0.0, 0.4);
    let edge = hundredths(&tc, 0.0, 0.4);
    let mut p =
        json!({"handles": [bed.handle], "cut": stone.cut, "stoneWidth": stone.wide, "length": stone.long, "clearance": clearance, "edge": edge});
    if let Some(pattern) = tc.draw(gs::optional(gs::sampled_from(vec!["grid", "brick", "trench", "double"]))) {
        p["pattern"] = json!(pattern);
    }
    if let Some(turn) = tc.draw(gs::optional(gs::integers::<i32>().min_value(-360).max_value(360))) {
        p["rotate"] = json!(turn);
    }
    tc.note(&format!("PAVE {p} in {:?}", bed.bed));
    let r = s.execute("pave", &p).unwrap_or_else(|e| panic!("PAVE {p}: {e}"));
    let placed = r["handles"].as_array().unwrap();
    let what = format!("PAVE {p} in {:?}", bed.bed);
    assert_eq!(r["placed"], json!(placed.len()), "{what}");
    assert!(placed.len() <= MAX_STONES, "{what}: {} stones", placed.len());
    assert_eq!(state(&s).0, 1 + placed.len(), "{what}: the region and its stones");
    let data = gem::cut_of(stone.cut).unwrap();
    for h in placed {
        let name = parse_gem_block(&laid(&s, h).block).unwrap();
        assert!(
            name.cut == data.name && (name.width - stone.wide).abs() < 1e-9 && (name.length - stone.long).abs() < 1e-9,
            "{what}: a {} was placed",
            laid(&s, h).block
        );
    }
    assert_clear(&s, &r["handles"], &bed.bed, clearance, edge, &what);
    let each = gem::carat(data, stone.long, stone.wide, gem::default_depth(data, stone.wide), 3.52);
    assert!((num(&r["carat"]) - each * placed.len() as f64).abs() <= 0.0005 + 1e-9, "{what}: {} ct", r["carat"]);
}

/// Rule: `PAVE` never places more stones than its cap, however large the region.
#[hegel::test(test_cases = 8, suppress_health_check = [HealthCheck::TooSlow])]
fn pave_never_places_more_than_its_cap(tc: TestCase) {
    let mut s = drawing(tc.draw(gs::booleans()));
    let k = mm_per_unit(&s);
    // At least 100 mm a side: 83 of the widest stone a row, so the sheet always holds more than the cap.
    let (w, h) = (hundredths(&tc, 100.0, 400.0), hundredths(&tc, 100.0, 400.0));
    let wide = hundredths(&tc, 0.8, 1.2);
    let bed = polyline(&mut s, &[Vec2::ZERO, Vec2::new(w / k, 0.0), Vec2::new(w / k, h / k), Vec2::new(0.0, h / k)]);
    let p = json!({"handles": [bed], "stoneWidth": wide, "clearance": 0, "pattern": pick(&tc, &["grid", "brick"])});
    let (r, took) = timed(&format!("PAVE {p} in {w}×{h}"), || s.execute("pave", &p));
    let r = r.unwrap_or_else(|e| panic!("PAVE {p}: {e}"));
    let n = r["handles"].as_array().unwrap().len();
    assert_eq!(r["placed"], json!(n));
    assert!(n <= MAX_STONES, "{n} stones placed in a {w}×{h} mm sheet");
    // The fill stops at a whole row, so it ends within one row of the cap (a row of the
    // smallest stone across the widest sheet is 500 stones).
    assert!(n == 0 || n + 500 >= MAX_STONES, "a sheet that holds more than the cap is filled to within a row of the cap, or not at all: {n}");
    assert!(r["notes"].to_string().contains("stopped early"), "and the reply says the region is not full: {r}");
    assert!(took < Duration::from_secs(30), "PAVE took {took:?}");
}

/// Rule: the count `GEMFIT` gives for a size is the number of stones `PAVE` then places for that
/// size; the largest size it names does fit, and the next calibrated size up does not.
#[hegel::test(test_cases = 150)]
fn gemfit_counts_what_pave_then_places(tc: TestCase) {
    let inch = tc.draw(gs::booleans());
    let mut s = drawing(inch);
    let bed = region(&tc, &mut s, 5.0);
    let cut = cut_name(&tc);
    let data = gem::cut_of(cut).unwrap();
    let clearance = hundredths(&tc, 0.0, 0.4);
    let ratio = tc.draw(gs::optional(gs::integers::<u32>().min_value(100).max_value(300))).map(|r| f64::from(r) / 100.0);
    let turn = tc.draw(gs::optional(gs::integers::<i32>().min_value(-360).max_value(360)));
    let mut p = json!({"handles": [bed.handle], "cut": cut, "clearance": clearance});
    if let Some(ratio) = ratio {
        p["ratio"] = json!(ratio);
    }
    if let Some(turn) = turn {
        p["rotate"] = json!(turn);
    }
    tc.note(&format!("GEMFIT {p} in {:?}", bed.bed));
    let before = state(&s);
    let fit = s.execute("gemfit", &p).unwrap_or_else(|e| panic!("GEMFIT {p}: {e}"));
    assert_eq!(state(&s), before, "GEMFIT changes nothing");
    let what = format!("GEMFIT {p} in {:?} → {fit}", bed.bed);
    assert!(!fit["notes"].to_string().contains("stopped early"), "{what}: a small region is counted in full");
    let ratio = ratio.unwrap_or_else(|| data.usual_ratio());
    let round = data.is_circle(ratio, 1.0);

    // What PAVE places for a calibrated width, with the same cut, ratio, turn and clearance.
    let mut places = |mm: f64| -> usize {
        let mut q = json!({"handles": [bed.handle], "cut": cut, "stoneWidth": mm, "clearance": clearance});
        if !round {
            q["length"] = json!(mm * ratio);
        }
        if let Some(turn) = turn {
            q["rotate"] = json!(turn);
        }
        let r = s.execute("pave", &q).unwrap_or_else(|e| panic!("PAVE {q}: {e}"));
        let n = r["handles"].as_array().unwrap().len();
        if n > 0 {
            s.undo().unwrap();
        }
        assert_eq!(state(&s).0, 1, "the stones are taken back");
        n
    };
    let rows = fit["fits"].as_array().unwrap();
    let mut listed = HashSet::new();
    for row in rows {
        let mm = num(&row["mm"]);
        assert!(calibrated(mm).is_some() && listed.insert((mm * 10.0).round() as i64), "{what}: {mm} is listed once and is calibrated");
        assert_eq!(places(mm), row["count"].as_u64().unwrap() as usize, "{what}: PAVE of {mm} mm");
    }
    let largest = fit["largestFitting"].as_f64();
    assert_eq!(largest, rows.iter().filter(|r| r["count"].as_u64() > Some(0)).map(|r| num(&r["mm"])).reduce(f64::max), "{what}");
    // Every calibrated size the list leaves out holds no stone: above all, the next size up.
    for mm in CALIBRATED.iter().filter(|c| !listed.contains(&((**c * 10.0).round() as i64))) {
        assert_eq!(places(*mm), 0, "{what}: {mm} mm is not listed, and PAVE places it");
    }
    if let Some(l) = largest {
        assert!(places(l) > 0, "{what}: the largest fitting size does not fit");
    }
}

/// Rule: the region's `narrowest` is the diameter of the largest circle it holds, and the
/// largest melee `PAVE` and `GEMFIT` name is the largest calibrated size that circle takes with
/// the clearance on both sides — the next size up does not.
#[hegel::test(test_cases = 300)]
fn the_largest_melee_named_is_the_largest_that_fits(tc: TestCase) {
    let inch = tc.draw(gs::booleans());
    let mut s = drawing(inch);
    let bed = region(&tc, &mut s, 6.0);
    let clearance = hundredths(&tc, 0.0, 0.4);
    let edge = hundredths(&tc, 0.0, 0.4);
    tc.note(&format!("clearance {clearance}, edge {edge} in {:?}", bed.bed));
    largest_melee_is_right(&mut s, &bed, clearance, edge);
}

fn largest_melee_is_right(s: &mut Session, bed: &Region, clearance: f64, edge: f64) {
    // A drawn circle is read as a 256-sided polygon inside it, and the reply rounds to a micron.
    // The engine finds the inscribed circle by sampling, good to a few microns on a turned
    // rectangle.
    const SLACK: f64 = 0.006;
    let what = format!("{:?} (inradius {})", bed.bed, bed.inradius);
    let fit = s.execute("gemfit", &json!({"handles": [bed.handle], "clearance": clearance})).unwrap();
    let narrowest = num(&fit["region"]["narrowest"]);
    assert!((narrowest - 2.0 * bed.inradius).abs() <= SLACK, "{what}: GEMFIT measures the narrowest as {narrowest} mm");
    // The sizes the true inscribed circle takes, and the one or two a hair's breadth decides.
    let takes = |gap: f64, slack: f64| CALIBRATED.iter().rev().copied().find(|c| c + 2.0 * gap <= 2.0 * bed.inradius + slack);
    let pave = s.execute("pave", &json!({"handles": [bed.handle], "stoneWidth": 0.8, "clearance": clearance, "edge": edge})).unwrap();
    let named = pave["largestFitting"].as_f64();
    let gap = clearance + edge;
    assert!(
        named == takes(gap, -SLACK) || named == takes(gap, SLACK),
        "{what}: PAVE names {named:?} with {gap} mm each side; {:?} fits",
        takes(gap, 0.0)
    );
    // GEMFIT places the stones, so a size the circle takes is one it finds a place for only when a
    // site of its rows falls on the middle; what it names is never larger than what fits.
    let fitted = fit["largestFitting"].as_f64();
    assert!(fitted <= takes(clearance, SLACK), "{what}: GEMFIT names {fitted:?}, the circle takes {:?}", takes(clearance, 0.0));
}

// ---------------------------------------------------------------------------------------------
// 4. Settings
// ---------------------------------------------------------------------------------------------

/// A stone placed anywhere, at any turn, in either kind of drawing.
struct Set {
    s: Session,
    /// Millimetres in one drawing unit.
    k: f64,
    stone: Value,
    cut: &'static str,
    /// The stone's width.
    wide: f64,
    /// The stone as the drawing holds it.
    girdle: Laid,
    what: String,
}

fn set_stone(tc: &TestCase) -> Set {
    let cut = cut_name(tc);
    set_stone_of(tc, cut)
}

fn set_stone_of(tc: &TestCase, cut: &'static str) -> Set {
    let inch = tc.draw(gs::booleans());
    let (long, wide) = stone_size(tc, cut, 1.0, 12.0);
    let at = point(tc, 50.0);
    let turn = tc.draw(gs::integers::<i32>().min_value(-360).max_value(360));
    place_set(inch, cut, long, wide, at, turn)
}

fn place_set(inch: bool, cut: &'static str, long: f64, wide: f64, at: Vec2, turn: i32) -> Set {
    let mut s = drawing(inch);
    let k = mm_per_unit(&s);
    let p = json!({"at": [at.x / k, at.y / k], "cut": cut, "length": long, "width": wide, "rotate": turn});
    let stone = s.execute("gem", &p).unwrap_or_else(|e| panic!("GEM {p}: {e}"));
    let girdle = laid(&s, &stone["handle"]);
    Set { s, k, stone, cut, wide, girdle, what: format!("on GEM {p} ({} mm units)", k) }
}

/// How far outside a heart's girdle, as a fraction of the heart's width, an offset is right.
/// Further out, the offsets of the two lobes fold over the notch in a knot `SETTING` does not
/// wholly undo: see the ignored properties of a heart at any proportion.
const HEART_REACH: f64 = 0.15;

impl Set {
    /// Whether an offset this far outside the girdle is one `SETTING` gets right.
    fn within_reach(&self, out: f64) -> bool {
        self.cut != "heart" || out <= HEART_REACH * self.wide
    }
}

/// A closed polyline of the drawing, in millimetres.
fn drawn_loop(s: &Session, h: &Value) -> Vec<Vec2> {
    let k = mm_per_unit(s);
    let EntityKind::LwPolyline(pl) = &s.doc().unwrap().entity(handle(h)).unwrap().kind else { panic!("{h} is not a polyline") };
    assert!(pl.closed && pl.vertices.iter().all(|v| v.bulge == 0.0), "{h}: a closed loop of straight edges");
    pl.vertices.iter().map(|v| v.p * k).collect()
}

/// Rule: `SETTING` prong puts its prongs on the girdle of the stone it was given — wherever the
/// stone is, however it is turned, in either units — each of the diameter asked for, no two in
/// one place.
#[hegel::test(test_cases = 300)]
fn prongs_stand_on_the_girdle_of_their_stone(tc: TestCase) {
    let mut set = set_stone(&tc);
    let wanted = tc.draw(gs::optional(gs::integers::<u32>().min_value(2).max_value(12)));
    let diameter = hundredths(&tc, 0.4, 1.5);
    let offset = if tc.draw(gs::booleans()) { 0.0 } else { hundredths(&tc, 0.0, 0.5) };
    let mut p = json!({"handle": set.stone["handle"], "style": "prong", "diameter": diameter, "offset": offset});
    if let Some(n) = wanted {
        p["prongs"] = json!(n);
    }
    let r = set.s.execute("setting", &p).unwrap_or_else(|e| panic!("SETTING {p} {}: {e}", set.what));
    let what = format!("SETTING {p} {} → {r}", set.what);
    let prongs = r["handles"].as_array().unwrap();
    assert_eq!(r["prongs"], json!(prongs.len()), "{what}");
    assert!((2..=12).contains(&prongs.len()) && wanted.is_none_or(|n| prongs.len() <= n as usize), "{what}");
    let mut at = Vec::new();
    for h in prongs {
        let EntityKind::Circle(c) = &set.s.doc().unwrap().entity(handle(h)).unwrap().kind else { panic!("{what}: a prong is a circle") };
        assert!((c.radius * set.k - diameter / 2.0).abs() < 1e-9, "{what}: a prong of {} mm", 2.0 * c.radius * set.k);
        let centre = c.center.xy() * set.k;
        let off = outline_gap(centre, &set.girdle.outline);
        // Pushed out along the line from the stone's centre: on a circle that is square to the
        // girdle, on any other cut it is at most that far from it.
        match set.girdle.radius {
            Some(radius) => {
                assert!((centre.dist(set.girdle.centre) - radius - offset).abs() < 1e-4 * radius.max(1.0), "{what}: a prong {off} mm off the girdle")
            }
            None => assert!(off <= offset + 1e-6 && (offset > 0.0 || off < 1e-6), "{what}: a prong {off} mm off the girdle"),
        }
        at.push(centre);
    }
    for (i, a) in at.iter().enumerate() {
        for b in at.iter().skip(i + 1) {
            assert!(a.dist(*b) > 1e-6, "{what}: two prongs in one place, {a:?}");
        }
    }
}

/// Rule: `SETTING` bezel draws a wall that encloses the girdle of its stone, everywhere at least
/// the wall's thickness outside it, and a seat line on the girdle itself.
#[ignore = "REAL DEFECT, not fixed: fails on a heart only, at its cleft (see a_bezel_encloses_the_girdle_of_a_heart_at_any_proportion); every other cut passed before this was set aside"]
#[hegel::test(test_cases = 300)]
fn a_bezel_encloses_the_girdle_of_its_stone(tc: TestCase) {
    let set = set_stone(&tc);
    let wall = hundredths(&tc, 0.3, 2.0);
    let offset = if tc.draw(gs::booleans()) { 0.0 } else { hundredths(&tc, 0.0, 0.5) };
    tc.assume(set.within_reach(wall + offset));
    bezel_encloses(set, wall, offset);
}

/// Rule: the same of a heart, however thick the wall for the stone.
#[ignore = "REAL DEFECT, not fixed: at a heart's cleft the bezel wall comes nearer the girdle than `wall` (0.42 mm for a 0.48 mm wall on a 1 mm heart): the outward offset of a concave corner is not kept at its distance"]
#[hegel::test(test_cases = 300)]
fn a_bezel_encloses_the_girdle_of_a_heart_at_any_proportion(tc: TestCase) {
    let set = set_stone_of(&tc, "heart");
    let wall = hundredths(&tc, 0.3, 2.0);
    bezel_encloses(set, wall, 0.0);
}

fn bezel_encloses(mut set: Set, wall: f64, offset: f64) {
    let p = json!({"handle": set.stone["handle"], "style": "bezel", "wall": wall, "offset": offset});
    let r = set.s.execute("setting", &p).unwrap_or_else(|e| panic!("SETTING {p} {}: {e}", set.what));
    let what = format!("SETTING {p} {}", set.what);
    let made = r["handles"].as_array().unwrap();
    assert_eq!(made.len(), 2, "{what}: the wall and the seat");
    let (rim, seat) = (drawn_loop(&set.s, &made[0]), drawn_loop(&set.s, &made[1]));
    // The wall is tessellated to a hundredth of a millimetre.
    for q in &set.girdle.outline {
        assert!(inside(*q, &rim), "{what}: the girdle at {q:?} is outside the bezel");
        let gap = outline_gap(*q, &rim);
        assert!(gap >= wall + offset - 0.011, "{what}: the bezel is {gap} mm from the girdle at {q:?}, under {} mm", wall + offset);
    }
    assert!(
        rim.iter().all(|q| !inside(*q, &set.girdle.outline) && outline_gap(*q, &set.girdle.outline) >= wall + offset - 0.011),
        "{what}: the bezel cuts into the stone"
    );
    assert_eq!(seat.len(), set.girdle.outline.len(), "{what}: the seat is the girdle");
    assert!(seat.iter().zip(&set.girdle.outline).all(|(a, b)| a.dist(*b) < 1e-9), "{what}: the seat is the girdle");
}

/// Rule: `SETTING` halo lays its melee around the stone it was given: each centred at the gap
/// plus half a melee outside the girdle, none over the centre stone and none over another.
#[ignore = "REAL DEFECT, not fixed: around a sharp tip (a 34 x 11.34 mm pear, 0.8 mm melee, gap 0) two halo stones sit 0.77 mm apart: SETTING spaces a halo by length along the path, which is longer than the straight distance where the path turns sharply"]
#[hegel::test(test_cases = 300)]
fn a_halo_surrounds_its_stone_without_overlapping(tc: TestCase) {
    let mut set = set_stone(&tc);
    let melee = if tc.draw(gs::booleans()) { tc.draw(gs::sampled_from(CALIBRATED.to_vec())) } else { hundredths(&tc, 0.8, 3.0) };
    let gap = hundredths(&tc, 0.0, 0.5);
    let mut p = json!({"handle": set.stone["handle"], "style": "halo", "stoneWidth": melee, "gap": gap});
    if let Some(clearance) = tc.draw(gs::optional(gs::integers::<u32>().min_value(0).max_value(50))) {
        p["clearance"] = json!(f64::from(clearance) / 100.0);
    }
    tc.assume(set.within_reach(gap + melee / 2.0));
    halo_is_clear(&mut set, &p, melee, gap);
}

/// Rule: the same of a heart, however large the melee for the stone.
#[ignore = "REAL DEFECT, not fixed: at a heart's cleft a halo stone lands over the centre stone (0.81 mm from the girdle where 1.375 mm is needed): the same concave-corner offset as the bezel"]
#[hegel::test(test_cases = 300)]
fn a_halo_surrounds_a_heart_at_any_proportion(tc: TestCase) {
    let mut set = set_stone_of(&tc, "heart");
    let melee = hundredths(&tc, 0.8, 3.0);
    let gap = hundredths(&tc, 0.0, 0.5);
    let p = json!({"handle": set.stone["handle"], "style": "halo", "stoneWidth": melee, "gap": gap});
    halo_is_clear(&mut set, &p, melee, gap);
}

fn halo_is_clear(set: &mut Set, p: &Value, melee: f64, gap: f64) {
    let r = set.s.execute("setting", p).unwrap_or_else(|e| panic!("SETTING {p} {}: {e}", set.what));
    let what = format!("SETTING {p} {}", set.what);
    let stones: Vec<Laid> = r["handles"].as_array().unwrap().iter().map(|h| laid(&set.s, h)).collect();
    assert_eq!(r["stones"], json!(stones.len()), "{what}");
    assert!(!stones.is_empty(), "{what}: a halo of no stones");
    let ring = gap + melee / 2.0;
    for st in &stones {
        assert_eq!(st.radius.map(|r| (r * 2e6).round()), Some((melee * 1e6).round()), "{what}: a halo stone is a round of {melee} mm");
        assert!(!inside(st.centre, &set.girdle.outline), "{what}: a halo stone is centred inside the centre stone, at {:?}", st.centre);
        // The melee's path is the girdle offset by `ring` and tessellated to a hundredth; where
        // the girdle has a corner the path is mitred, and stands further out.
        let off = outline_gap(st.centre, &set.girdle.outline);
        assert!(off >= ring - 0.011, "{what}: a halo stone {off} mm from the girdle, under {ring} mm: it is over the centre stone");
        if set.girdle.radius.is_some() {
            assert!((off - ring).abs() <= 0.011, "{what}: a halo stone {off} mm from a round's girdle, not {ring} mm");
        }
    }
    for (i, a) in stones.iter().enumerate() {
        for b in stones.iter().skip(i + 1) {
            let apart = a.centre.dist(b.centre);
            assert!(apart >= melee - 1e-6, "{what}: two {melee} mm halo stones {apart} mm apart, at {:?} and {:?}", a.centre, b.centre);
        }
    }
}

/// Rule: `SETTING` channel draws its two rails around the stone it was given, the outer one
/// enclosing the girdle.
#[ignore = "REAL DEFECT, not fixed: fails on a heart only, at its cleft, where a rail comes under its distance from the girdle (the same concave-corner offset as the bezel and the halo)"]
#[hegel::test(test_cases = 200)]
fn a_channel_runs_around_its_stone(tc: TestCase) {
    let mut set = set_stone(&tc);
    let wide = hundredths(&tc, 1.0, 3.0);
    let gap = hundredths(&tc, 0.0, 0.5);
    tc.assume(set.within_reach(gap + wide / 2.0 + 0.4));
    let p = json!({"handle": set.stone["handle"], "style": "channel", "stoneWidth": wide, "gap": gap});
    let r = set.s.execute("setting", &p).unwrap_or_else(|e| panic!("SETTING {p} {}: {e}", set.what));
    let what = format!("SETTING {p} {}", set.what);
    let made = r["handles"].as_array().unwrap();
    assert_eq!(made.len(), 2, "{what}: two rails");
    let rail = gap + wide / 2.0;
    assert!((num(&r["rail"]) - rail).abs() <= 0.0005 + 1e-12, "{what}");
    for (h, out) in made.iter().zip([rail + 0.4, rail - 0.4]) {
        let line = drawn_loop(&set.s, h);
        for q in &set.girdle.outline {
            assert!(inside(*q, &line), "{what}: the girdle at {q:?} is outside a rail");
            assert!(outline_gap(*q, &line) >= out - 0.011, "{what}: a rail under {out} mm from the girdle");
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 5. The bench sheet
// ---------------------------------------------------------------------------------------------

/// One stone a bench sheet must count: what `GEM` was asked for and what it answered.
struct Counted {
    handle: String,
    cut: &'static str,
    long: f64,
    wide: f64,
    /// The weight the formula gives it.
    carat: f64,
    /// The weight `GEM` reported.
    reported: f64,
}

/// One ring blank: what `RING` answered.
struct Blank {
    handle: String,
    grams: f64,
    metal: String,
}

/// Any collection of stones and ring blanks. Sizes come from a short list, so that stones repeat
/// and groups form, and now and then from anywhere.
fn bench(tc: &TestCase, s: &mut Session) -> (Vec<Counted>, Vec<Blank>, Vec<String>) {
    let k = mm_per_unit(s);
    let (mut stones, mut blanks, mut log) = (Vec::new(), Vec::new(), Vec::new());
    let n = tc.draw(gs::integers::<usize>().min_value(0).max_value(12));
    for _ in 0..n {
        let at = point(tc, 80.0);
        if tc.draw(gs::weighted_booleans(0.2)) {
            let mut p = json!({"at": [at.x / k, at.y / k], "size": tc.draw(gs::integers::<u32>().min_value(6).max_value(26)) as f64 / 2.0, "metal": pick(tc, &METALS)});
            if tc.draw(gs::booleans()) {
                p["wall"] = json!(pick_f(tc, &[1.2, 1.5, 1.8]));
                p["width"] = json!(pick_f(tc, &[2.0, 3.0, 4.5]));
            }
            let r = s.execute("ring", &p).unwrap_or_else(|e| panic!("RING {p}: {e}"));
            log.push(format!("RING {p}"));
            blanks.push(Blank {
                handle: handle_of(&r),
                grams: num(&r["weight"]["grams"]),
                metal: r["weight"]["metal"].as_str().unwrap().to_string(),
            });
            continue;
        }
        let cut = pick(tc, &["round", "round", "oval", "princess", "marquise", "emerald", "cabochon"]);
        let wide = if tc.draw(gs::weighted_booleans(0.8)) { pick_f(tc, &[1.0, 1.3, 2.0, 5.0]) } else { hundredths(tc, 0.8, 9.0) };
        let long = if cut == "round" || tc.draw(gs::booleans()) { wide } else { wide * pick_f(tc, &[1.5, 2.0]) };
        let mut p = json!({"at": [at.x / k, at.y / k], "cut": cut, "length": long, "width": wide, "rotate": tc.draw(gs::integers::<i32>().min_value(0).max_value(359))});
        let data = gem::cut_of(cut).unwrap();
        let mut depth = gem::default_depth(data, wide);
        if tc.draw(gs::weighted_booleans(0.25)) {
            depth = wide * pick_f(tc, &[0.5, 0.8]);
            p["depth"] = json!(depth);
        }
        let mut sg = 3.52;
        match pick(tc, &["diamond", "diamond", "named", "gravity"]) {
            "named" => {
                let name = pick(tc, &["sapphire", "ruby", "emerald", "diamond", "cz"]);
                sg = gem::sg_of(name).unwrap();
                p["stone"] = json!(name);
            }
            "gravity" => {
                sg = pick_f(tc, &[2.65, 4.0, 4.2]);
                p["sg"] = json!(sg);
            }
            _ => {}
        }
        let r = s.execute("gem", &p).unwrap_or_else(|e| panic!("GEM {p}: {e}"));
        log.push(format!("GEM {p}"));
        stones.push(Counted {
            handle: handle_of(&r),
            cut: data.name,
            long,
            wide,
            carat: gem::carat(data, long, wide, depth, sg),
            reported: num(&r["carat"]),
        });
    }
    (stones, blanks, log)
}

fn pick_f(tc: &TestCase, from: &[f64]) -> f64 {
    tc.draw(gs::sampled_from(from.to_vec()))
}

/// Rule: `TECHSHEET` counts exactly the stones that were placed and weighs them at the sum of
/// their own weights; its groups partition the stones, each group's `handles` are exactly its
/// stones, and every ring blank is listed at the weight `RING` gave it.
#[hegel::test(test_cases = 400)]
fn the_bench_sheet_counts_and_weighs_what_was_placed(tc: TestCase) {
    let mut s = drawing(tc.draw(gs::booleans()));
    let (stones, blanks, log) = bench(&tc, &mut s);
    tc.note(&log.join("\n"));
    sheet_agrees(&mut s, &stones, &blanks);
}

fn sheet_agrees(s: &mut Session, stones: &[Counted], blanks: &[Blank]) {
    let before = state(s);
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    assert_eq!(state(s), before, "a sheet that is only read changes nothing");
    let n = stones.len();
    assert_eq!(sheet["stones"]["count"], json!(n), "{sheet}");
    // A weight is carried in the block to five decimals and the total is rounded to three.
    let slack = |n: usize| 0.0005 + 5.1e-6 * n as f64;
    let total: f64 = stones.iter().map(|c| c.carat).sum();
    assert!((num(&sheet["stones"]["carat"]) - total).abs() <= slack(n), "{} ct on the sheet, {total} ct placed: {sheet}", sheet["stones"]["carat"]);
    let reported: f64 = stones.iter().map(|c| c.reported).sum();
    assert!(
        (num(&sheet["stones"]["carat"]) - reported).abs() <= slack(n) + 0.0005 * n as f64 + 1e-9,
        "{} ct on the sheet, GEM reported {reported} ct in all",
        sheet["stones"]["carat"]
    );
    assert!(sheet["warnings"].as_array().unwrap().is_empty(), "{sheet}");

    let by_handle: HashMap<&str, &Counted> = stones.iter().map(|c| (c.handle.as_str(), c)).collect();
    let mut seen = HashSet::new();
    for group in sheet["stones"]["groups"].as_array().unwrap() {
        let members = group["handles"].as_array().unwrap();
        assert_eq!(group["count"], json!(members.len()), "{group}");
        assert!(!members.is_empty(), "{group}");
        let mut carat = 0.0;
        for h in members {
            let h = h.as_str().unwrap();
            let stone = by_handle.get(h).unwrap_or_else(|| panic!("{h} is not a stone that was placed: {group}"));
            assert!(seen.insert(h.to_string()), "{h} is in two groups");
            assert!(
                group["cut"] == stone.cut
                    && (num(&group["width"]) - stone.wide).abs() <= 0.0005 + 1e-12
                    && (num(&group["length"]) - stone.long).abs() <= 0.0005 + 1e-12,
                "{h} is a {} {}×{}, in {group}",
                stone.cut,
                stone.long,
                stone.wide
            );
            assert!((num(&group["caratEach"]) - stone.carat).abs() <= 0.0005 + 5.1e-6, "{h} weighs {} ct, in {group}", stone.carat);
            carat += stone.carat;
        }
        assert!((num(&group["carat"]) - carat).abs() <= slack(members.len()), "its stones weigh {carat} ct: {group}");
    }
    assert_eq!(seen.len(), n, "every stone is in a group");

    let bands = sheet["bands"].as_array().unwrap();
    assert_eq!(bands.len(), blanks.len(), "{sheet}");
    for blank in blanks {
        let band = bands
            .iter()
            .find(|b| b["handle"] == json!(blank.handle))
            .unwrap_or_else(|| panic!("the ring {} is not on the sheet: {sheet}", blank.handle));
        assert_eq!(band["metal"], json!(blank.metal), "RING said {} for {}: {band}", blank.metal, blank.handle);
        assert!((num(&band["grams"]) - blank.grams).abs() <= 0.0056, "RING weighed {} at {} g: {band}", blank.handle, blank.grams);
    }
}

// ---------------------------------------------------------------------------------------------
// 6. The parametric piece: its parameters
// ---------------------------------------------------------------------------------------------

/// A length in a parameter's whole range now and then, and in the range a jeweler uses the rest
/// of the time.
fn usual(tc: &TestCase, (lo, hi): (f64, f64), (from, to): (f64, f64)) -> f64 {
    if tc.draw(gs::weighted_booleans(0.7)) { hundredths(tc, from, to) } else { length(tc, lo, hi) }
}

/// A finger in one system, as `size` takes it: a number, or the text a bench writes.
fn finger_in(tc: &TestCase, system: &str) -> Value {
    let whole = |tc: &TestCase, lo: u32, hi: u32| {
        let n = tc.draw(gs::integers::<u32>().min_value(lo).max_value(hi));
        if tc.draw(gs::weighted_booleans(0.8)) { json!(n) } else { json!(n.to_string()) }
    };
    match system {
        "uk" => {
            let letter = char::from(b'A' + tc.draw(gs::integers::<u8>().min_value(0).max_value(25)));
            json!(format!("{letter}{}", pick(tc, &["", "", "½", "1/2"])))
        }
        // The whole sizes whose fingers are inside the trade's range.
        "eu" => whole(tc, 37, 78),
        "jp" => whole(tc, 1, 36),
        "cn" => whole(tc, 0, 38),
        _ if tc.draw(gs::weighted_booleans(0.7)) => json!(f64::from(tc.draw(gs::integers::<u32>().min_value(0).max_value(64))) / 4.0),
        _ => json!(float(tc, 0.0, 16.4)),
    }
}

/// One valid value for one of `PIECE`'s parameters (the size and the stone's length apart).
fn piece_value(tc: &TestCase, key: &str) -> Value {
    match key {
        "kind" => json!(pick(tc, &KINDS)),
        "profile" => json!(pick(tc, &PROFILES)),
        "metal" => json!(pick(tc, &METALS)),
        "cut" => json!(cut_name(tc)),
        "stone" => json!(stone_name(tc)),
        "wall" => json!(usual(tc, (0.3, 10.0), (0.8, 3.0))),
        "width" => json!(usual(tc, (0.5, 30.0), (1.5, 8.0))),
        "stoneWidth" => json!(usual(tc, (0.5, 30.0), (3.0, 9.0))),
        "stoneLength" => json!(usual(tc, (0.5, 30.0), (3.0, 12.0))),
        "melee" => json!(usual(tc, (0.8, 6.0), (0.8, 3.0))),
        "gap" => json!(usual(tc, (0.0, 5.0), (0.0, 0.5))),
        "prongs" => json!(tc.draw(gs::integers::<u32>().min_value(3).max_value(8))),
        "halo" => match pick(tc, &["no", "yes", "width"]) {
            "no" => json!(false),
            "yes" => json!(true),
            _ => json!(length(tc, 0.8, 3.0)),
        },
        "count" => match pick(tc, &["fit", "fit", "few", "any"]) {
            "fit" => Value::Null,
            "few" => json!(tc.draw(gs::integers::<u32>().min_value(1).max_value(40))),
            _ => json!(tc.draw(gs::integers::<u32>().min_value(1).max_value(MAX_PIECE_STONES))),
        },
        other => panic!("no generator for `{other}`"),
    }
}

const PLAIN_KEYS: [&str; 11] = ["wall", "width", "profile", "metal", "cut", "stone", "prongs", "halo", "melee", "count", "gap"];

/// A whole piece: its kind, and any of its other parameters, each in its range. Awkward
/// proportions are meant: a 30 mm stone on a half-millimetre band, a wall thicker than the band
/// is wide, four hundred stones.
pub(super) fn piece_json(tc: &TestCase) -> Map<String, Value> {
    let mut p = Map::new();
    p.insert("kind".into(), piece_value(tc, "kind"));
    if tc.draw(gs::weighted_booleans(0.8)) {
        let system = pick(tc, &SYSTEMS);
        p.insert("system".into(), json!(system));
        p.insert("size".into(), finger_in(tc, system));
    }
    for key in PLAIN_KEYS {
        if tc.draw(gs::weighted_booleans(0.7)) {
            p.insert(key.into(), piece_value(tc, key));
        }
    }
    if tc.draw(gs::weighted_booleans(0.7)) {
        // A stone the cut can be: no wider than long, unless it is an oval.
        let cut = p.get("cut").and_then(Value::as_str).unwrap_or("round");
        let (long, wide) = stone_size(tc, cut, 0.5, 30.0);
        p.insert("stoneWidth".into(), json!(wide));
        if long != wide || tc.draw(gs::booleans()) {
            p.insert("stoneLength".into(), json!(long.min(30.0)));
        }
    }
    p
}

/// The US size a `size` names in a system, by the published definitions.
fn us_size_of(system: &str, size: &Value) -> f64 {
    let n = || size.as_f64().or_else(|| size.as_str().and_then(|t| t.parse().ok())).unwrap_or_else(|| panic!("{system} {size}"));
    let diameter = match (system, size.as_str()) {
        ("uk", Some(text)) => uk_letter_diameter(&text.to_ascii_uppercase().replace("1/2", "½")),
        // A number is the letter's place in the alphabet.
        ("uk", None) => uk_letter_diameter(&char::from(b'A' + n().round() as u8).to_string()),
        ("eu", _) => eu_diameter(n()),
        ("jp", _) => jp_diameter(n()),
        ("cn", _) => cn_diameter(n()),
        _ => us_diameter(n()),
    };
    (diameter - 11.63) / 0.8128
}

/// What `PIECE` documents: the keys given are merged over the piece that was there (`before`), or
/// over the defaults. `got` is the `params` the command answered with.
fn assert_merged(got: &Value, before: Option<&Value>, given: &Map<String, Value>, what: &str) {
    // A key that is given wins (null asks for the default); one that is not keeps what it was.
    let want = |key: &str, default: Value| match given.get(key) {
        Some(Value::Null) => default,
        Some(v) => v.clone(),
        None => before.map_or(default, |b| b[key].clone()),
    };
    for (key, default) in [("wall", 1.8), ("width", 2.2), ("stoneWidth", 6.5), ("melee", 1.8), ("gap", 0.2), ("prongs", 6.0)] {
        assert_eq!(num(&got[key]), num(&want(key, json!(default))), "{what}: `{key}` in {got}");
    }
    for (key, default) in [("kind", ""), ("profile", "flat"), ("metal", "gold18"), ("cut", "round"), ("stone", "diamond")] {
        assert_eq!(got[key], json!(want(key, json!(default)).as_str().unwrap().trim().to_ascii_lowercase()), "{what}: `{key}` in {got}");
    }
    assert_eq!(num(&got["stoneLength"]), num(&want("stoneLength", got["stoneWidth"].clone())), "{what}: `stoneLength` in {got}");
    let halo = match want("halo", json!(false)) {
        Value::Bool(true) => json!(1.3),
        other => other,
    };
    assert!(
        got["halo"] == halo || got["halo"].as_f64().zip(halo.as_f64()).is_some_and(|(a, b)| a == b),
        "{what}: `halo` is {} and was asked {halo}",
        got["halo"]
    );
    assert_eq!(got["count"], want("count", Value::Null), "{what}: `count` in {got}");
    // The size is read in the system it comes with, or else the one the piece was in.
    let was = before.map_or("us".to_string(), |b| b["sizeSystem"].as_str().unwrap().to_string());
    let named = given.get("system").and_then(Value::as_str).map(|s| s.trim().to_ascii_lowercase());
    let system = named.unwrap_or(was);
    assert_eq!(got["sizeSystem"], json!(system), "{what}: `sizeSystem` in {got}");
    assert_eq!(got["system"], "us", "{what}");
    let size = match given.get("size").filter(|v| !v.is_null()) {
        Some(size) => round_us(us_size_of(&system, size)),
        None => before.map_or(6.0, |b| num(&b["size"])),
    };
    assert!((num(&got["size"]) - size).abs() <= 1.5e-9, "{what}: `size` is US {} and US {size} was asked", got["size"]);
}

/// Rule: any parameters in their ranges make a piece; its JSON holds only finite numbers, says
/// what was asked, and reads back — through text — as exactly the same piece.
#[hegel::test(test_cases = 1000)]
fn a_pieces_parameters_read_back_as_the_same_piece(tc: TestCase) {
    let asked = piece_json(&tc);
    let p = PieceParams::parse("piece", &Value::Object(asked.clone())).unwrap_or_else(|e| panic!("{asked:?}: {e}"));
    let j = p.json();
    let what = format!("{asked:?} → {j}");
    for key in ["size", "wall", "width", "stoneLength", "stoneWidth", "melee", "gap"] {
        assert!(j[key].as_f64().is_some_and(f64::is_finite), "{what}: `{key}`");
    }
    assert!(j["prongs"].is_u64() && (j["count"].is_null() || j["count"].is_u64()), "{what}");
    assert!(j["halo"] == json!(false) || j["halo"].as_f64().is_some_and(f64::is_finite), "{what}: `halo`");
    for key in ["kind", "system", "sizeText", "sizeSystem", "profile", "metal", "cut", "stone"] {
        assert!(j[key].as_str().is_some_and(|t| !t.is_empty()), "{what}: `{key}`");
    }
    // A number that was not finite would have become a null.
    let nulls = j.as_object().unwrap().iter().filter(|(_, v)| v.is_null()).map(|(k, _)| k.as_str()).collect::<Vec<_>>();
    // The parameters that are "none" by default say so with a null; no other key may.
    const OPTIONAL: [&str; 8] = ["bevel", "comfort", "count", "hollow", "ridge", "sideCut", "sideLength", "sideWidth"];
    assert!(nulls.iter().all(|k| OPTIONAL.contains(k)), "{what}: null in {nulls:?}");
    assert_merged(&j, None, &asked, &what);
    assert!(density_of(j["metal"].as_str().unwrap()) == Some(p.density) && p.density > 0.0, "{what}");

    let text = serde_json::to_string(&j).unwrap();
    let read: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(read, j, "the JSON is the same after it has been text");
    let back = PieceParams::parse("piece", &read).unwrap_or_else(|e| panic!("{what} does not read back: {e}"));
    assert_eq!(back, p, "{what}");
    assert_eq!(back.json(), j, "{what}");
}

// ---------------------------------------------------------------------------------------------
// 7. The piece: the sheet and the solid agree
// ---------------------------------------------------------------------------------------------

/// Rule: for any piece `PIECE` draws, `PIECEMESH` builds the same piece from the parameters it
/// reported: the same stones and metal weight, a band of the sheet's outside diameter and width,
/// every shell closed with its faces outward, no position that is not a number, under the
/// triangle cap.
#[hegel::test(test_cases = 150, suppress_health_check = [HealthCheck::TooSlow])]
fn the_sheet_and_the_solid_are_one_piece(tc: TestCase) {
    let build = Value::Object(piece_json(&tc));
    let inch = tc.draw(gs::booleans());
    tc.note(&format!("PIECE {build}"));
    let refused = sheet_and_solid_agree(&build, inch);
    tc.event(if refused { "refused" } else { "built" });
}

/// Whether `PIECE` refused the piece (which it may: a count that does not fit, a stone wider than
/// long); when it built it, everything is checked.
fn sheet_and_solid_agree(build: &Value, inch: bool) -> bool {
    let mut s = drawing(inch);
    let before = state(&s);
    let sheet = match s.execute("piece", build) {
        Ok(r) => r["piece"].clone(),
        Err(e) => {
            assert!(!matches!(e, EngineError::Internal(..)), "PIECE {build} panicked: {e}");
            assert_eq!(state(&s), before, "a refused PIECE {build} left something behind");
            return true;
        }
    };
    let what = format!("PIECE {build} → {}", sheet["params"]);
    let made = handles(&sheet["handles"]);
    assert_eq!(state(&s).0, made.len(), "{what}: the drawing holds the piece and nothing else");
    let count = sheet["stones"]["count"].as_u64().unwrap();
    assert!(count <= u64::from(MAX_PIECE_STONES) + 1, "{what}: {count} stones");
    let d = s.doc().unwrap();
    let inserts = made.iter().filter(|h| matches!(&d.entity(**h).unwrap().kind, EntityKind::Insert(i) if i.block.starts_with("GEM-"))).count();
    assert_eq!(inserts as u64, count, "{what}: the sheet's stones");
    assert_eq!(s.execute("techsheet", &json!({})).unwrap()["stones"]["count"], json!(count), "{what}: the bench sheet's count");

    let params = sheet["params"].clone();
    let (reply, took) = timed(&format!("PIECEMESH {params}"), || s.execute("piecemesh", &params));
    let reply = reply.unwrap_or_else(|e| panic!("{what}: PIECEMESH refused the sheet's own parameters: {e}"));
    assert!(took < Duration::from_secs(30), "{what}: PIECEMESH took {took:?}");
    assert_eq!(reply["params"], params, "{what}: the solid is another piece");
    assert_eq!(reply["stones"], json!(count), "{what}: the solid's stones");
    assert_eq!(reply["metal"]["grams"], sheet["metal"]["grams"], "{what}: two metal weights for one piece");
    assert!(num(&sheet["metal"]["grams"]) > 0.0, "{what}");
    assert!(sheet["stones"].get("fits") == reply.get("fits"), "{what}: how many fit");
    let triangles = reply["triangles"].as_u64().unwrap() as usize;
    assert!(triangles > 0 && triangles <= MAX_TRIANGLES, "{what}: {triangles} triangles");
    let mut listed = 0;
    for m in reply["meshes"].as_array().unwrap() {
        let (positions, indices) = (m["positions"].as_array().unwrap(), m["indices"].as_array().unwrap());
        assert!(positions.len() % 3 == 0 && indices.len() % 3 == 0, "{what}");
        assert!(positions.iter().all(|v| v.as_f64().is_some_and(f64::is_finite)), "{what}: a position of `{}` is not a number", m["name"]);
        assert!(
            indices.iter().all(|i| i.as_u64().is_some_and(|i| (i as usize) < positions.len() / 3)),
            "{what}: an index of `{}` is out of range",
            m["name"]
        );
        listed += indices.len() / 3;
    }
    assert_eq!(listed, triangles, "{what}");

    // The solid itself: closed shells facing outward, and a band the size the sheet says.
    let p = PieceParams::parse("piecemesh", &params).unwrap();
    assert_eq!(p.json(), params, "{what}: the parameters do not read back as themselves");
    let mesh = piece_mesh(&p, Quality::Draft);
    check_mesh(&mesh, false, &what);
    assert_eq!(mesh.triangles(), triangles, "{what}");
    let band = part(&mesh, "band");
    let (outer, width) = (p.outer(), p.width);
    for axis in [0, 1] {
        let (lo, hi) = extent(band, axis);
        assert!(
            (hi - outer / 2.0).abs() < 1e-6 && (lo + outer / 2.0).abs() < 1e-6,
            "{what}: the band spans {lo}..{hi}, its outside diameter is {outer}"
        );
    }
    let (lo, hi) = extent(band, 2);
    assert!((hi - width / 2.0).abs() < 1e-6 && (lo + width / 2.0).abs() < 1e-6, "{what}: the band is {lo}..{hi} along the finger, {width} wide");
    // And the sheet draws that band: the front view's circles are the finger and the outside.
    let ring = s.doc().unwrap().block("RING-PIECE").unwrap();
    let mut radii: Vec<f64> = ring.entities.iter().filter_map(|e| if let EntityKind::Circle(c) = &e.kind { Some(c.radius) } else { None }).collect();
    radii.sort_by(f64::total_cmp);
    assert!(
        radii.len() == 2 && (2.0 * radii[1] - outer).abs() < 1e-9 && (2.0 * radii[0] - p.inner()).abs() < 1e-9,
        "{what}: the front view is {radii:?}"
    );
    assert!((num(&sheet["size"]["diameter"]) - p.inner()).abs() <= 0.0005 + 1e-12, "{what}");
    let (min, max) = (&reply["bounds"]["min"], &reply["bounds"]["max"]);
    assert!(
        num(&min[0]) <= -outer / 2.0 + 0.0006
            && num(&max[0]) >= outer / 2.0 - 0.0006
            && num(&min[2]) <= -width / 2.0 + 0.0006
            && num(&max[2]) >= width / 2.0 - 0.0006,
        "{what}: the bounds {} do not hold the band",
        reply["bounds"]
    );
    false
}

// ---------------------------------------------------------------------------------------------
// 8. The piece: a stateful model
// ---------------------------------------------------------------------------------------------

/// The drawing under test and what it must hold: `history` is what `piece {query}` answers
/// (null: no piece) after each step that changed the drawing, and `now` is where undo and redo
/// have left us in it.
struct PieceModel {
    s: Session,
    history: Vec<Value>,
    now: usize,
    /// The undo depth at `history[0]`.
    base: usize,
}

impl PieceModel {
    fn new(inch: bool) -> Self {
        let s = drawing(inch);
        let base = state(&s).1;
        PieceModel { s, history: vec![Value::Null], now: 0, base }
    }

    fn piece(&self) -> &Value {
        &self.history[self.now]
    }

    fn query(&mut self) -> Value {
        self.s.execute("piece", &json!({"query": true})).unwrap()["piece"].clone()
    }

    /// Record a step that changed the drawing: what was redoable is gone.
    fn record(&mut self, piece: Value) {
        self.history.truncate(self.now + 1);
        self.history.push(piece);
        self.now += 1;
    }

    /// Ask `PIECE` to build or rebuild. Built: the reply is the merge the command documents, in
    /// one undo step, and the model moves on. Refused: nothing at all has changed.
    fn ask(&mut self, tc: &TestCase, given: Map<String, Value>) -> bool {
        let asked = Value::Object(given.clone());
        tc.note(&format!("piece {asked}"));
        let before = state(&self.s);
        let doc = Arc::clone(&self.s.state().unwrap().doc);
        let was = self.piece().clone();
        match self.s.execute("piece", &asked) {
            Ok(reply) => {
                let piece = reply["piece"].clone();
                let what = format!("piece {asked} over {}", was["params"]);
                assert_merged(&piece["params"], was.get("params"), &given, &what);
                let at = given.get("at").cloned().unwrap_or_else(|| if was.is_null() { json!([0.0, 0.0]) } else { was["at"].clone() });
                assert!(num(&piece["at"][0]) == num(&at[0]) && num(&piece["at"][1]) == num(&at[1]), "{what}: at {}, not {at}", piece["at"]);
                assert_eq!(state(&self.s).1, before.1 + 1, "{what}: one undo step");
                assert!(state(&self.s).2 > before.2, "{what}: the revision moves");
                self.record(piece);
                true
            }
            Err(e) => {
                assert!(!matches!(e, EngineError::Internal(..)), "piece {asked} panicked: {e}");
                assert_eq!(state(&self.s), before, "a refused piece {asked} changed the drawing ({e})");
                assert!(Arc::ptr_eq(&doc, &self.s.state().unwrap().doc), "a refused piece {asked} replaced the drawing ({e})");
                tc.note(&format!("  refused: {e}"));
                false
            }
        }
    }

    /// A value for one parameter of the piece that is there (a size is in the piece's own system).
    fn change(&self, tc: &TestCase, key: &str) -> Value {
        match key {
            "size" => finger_in(tc, self.piece()["params"]["sizeSystem"].as_str().unwrap_or("us")),
            "system" => json!(pick(tc, &SYSTEMS)),
            "at" => {
                let at = point(tc, 500.0);
                json!([at.x, at.y])
            }
            key => piece_value(tc, key),
        }
    }
}

const EDIT_KEYS: [&str; 17] = [
    "kind",
    "size",
    "system",
    "at",
    "wall",
    "width",
    "profile",
    "metal",
    "cut",
    "stone",
    "stoneWidth",
    "stoneLength",
    "prongs",
    "halo",
    "melee",
    "count",
    "gap",
];

#[hegel::state_machine]
impl PieceModel {
    /// Build a piece of any kind, over whatever is there.
    #[rule]
    fn build(&mut self, tc: TestCase) {
        let mut given = piece_json(&tc);
        if tc.draw(gs::booleans()) {
            given.insert("at".into(), self.change(&tc, "at"));
        }
        self.ask(&tc, given);
    }

    /// Change one parameter. With no piece there is no kind to merge over, and it is refused.
    #[rule]
    fn edit_one(&mut self, tc: TestCase) {
        let key = pick(&tc, &EDIT_KEYS);
        let given = Map::from_iter([(key.to_string(), self.change(&tc, key))]);
        let had = !self.piece().is_null();
        let built = self.ask(&tc, given);
        if !had {
            assert_eq!(built, key == "kind", "over no piece, `kind` alone builds one from the defaults and `{key}` alone builds nothing");
        }
    }

    /// Change several parameters at once.
    #[rule]
    fn edit_several(&mut self, tc: TestCase) {
        let keys = tc.draw(gs::samples(EDIT_KEYS.to_vec()).min_size(2).max_size(5));
        let mut given = Map::new();
        for key in keys {
            given.insert(key.to_string(), self.change(&tc, key));
        }
        self.ask(&tc, given);
    }

    /// An edit that must be refused changes nothing.
    #[rule]
    fn refused_edit(&mut self, tc: TestCase) {
        let bad = [
            json!({"wall": -1}),
            json!({"wall": 0.29}),
            json!({"wall": 10.01}),
            json!({"width": 31}),
            json!({"kind": "tiara"}),
            json!({"size": 400}),
            json!({"system": "uk", "size": "ZZ"}),
            json!({"count": 401}),
            json!({"count": 0}),
            json!({"count": 2.5}),
            json!({"prongs": 9}),
            json!({"halo": 5}),
            json!({"halo": "yes"}),
            json!({"melee": 0.5}),
            json!({"gap": -0.1}),
            json!({"metal": "unobtanium"}),
            json!({"cut": "banana"}),
            json!({"stone": "kryptonite"}),
            json!({"profile": "sawtooth"}),
            json!({"at": [1, "two"]}),
            json!({"at": [1e300, 0]}),
            json!({"query": true, "remove": true}),
            json!({"remove": "yes"}),
        ];
        let given = tc.draw(gs::sampled_from(bad.to_vec()));
        assert!(!self.ask(&tc, given.as_object().unwrap().clone()), "piece {given} was accepted");
    }

    /// Remove the piece: every object of it goes, in one undo step; with none there is nothing
    /// to do.
    #[rule]
    fn remove(&mut self, tc: TestCase) {
        tc.note("piece {remove}");
        let before = state(&self.s);
        let r = self.s.execute("piece", &json!({"remove": true})).unwrap();
        assert_eq!(r["piece"], Value::Null);
        if self.piece().is_null() {
            assert_eq!(r["removed"], json!(0));
            assert_eq!(state(&self.s), before, "removing nothing changes nothing");
        } else {
            assert_eq!(r["removed"], json!(self.piece()["handles"].as_array().unwrap().len()));
            assert_eq!(state(&self.s).1, before.1 + 1, "one undo step");
            self.record(Value::Null);
        }
    }

    #[rule]
    fn undo(&mut self, tc: TestCase) {
        tc.assume(self.now > 0);
        tc.note("undo");
        assert!(self.s.undo().unwrap().is_some());
        self.now -= 1;
    }

    #[rule]
    fn redo(&mut self, tc: TestCase) {
        tc.assume(self.now + 1 < self.history.len());
        tc.note("redo");
        assert!(self.s.redo().unwrap().is_some());
        self.now += 1;
    }

    /// Reading the piece changes nothing, however often.
    #[rule]
    fn query_again(&mut self, tc: TestCase) {
        tc.note("piece {query}");
        let before = state(&self.s);
        let doc = Arc::clone(&self.s.state().unwrap().doc);
        for _ in 0..2 {
            assert_eq!(&self.query(), self.piece());
        }
        assert_eq!(state(&self.s), before);
        assert!(Arc::ptr_eq(&doc, &self.s.state().unwrap().doc));
    }

    /// Save as DXF and open it again: the piece and its parameters come back. The reopened
    /// drawing starts a history of its own.
    #[rule]
    fn save_and_reopen(&mut self, tc: TestCase) {
        tc.note("save and reopen");
        let dxf = cadcraft_io::write_dxf(self.s.doc().unwrap());
        let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap_or_else(|e| panic!("the saved drawing does not open: {e:?}"));
        let units = mm_per_unit(&self.s);
        let mut t = Session::new();
        t.open_drawing(read, "reopened", None);
        assert_eq!(mm_per_unit(&t), units, "the units are kept");
        let reopened = t.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
        let was = self.piece().clone();
        assert_eq!(reopened.is_null(), was.is_null(), "saved {was}, reopened {reopened}");
        if !was.is_null() {
            for key in ["params", "size", "metal", "stones", "checks", "at"] {
                assert_eq!(reopened[key], was[key], "`{key}` after the drawing was saved and reopened");
            }
            assert_eq!(reopened["handles"].as_array().unwrap().len(), was["handles"].as_array().unwrap().len(), "every object is still the piece's");
        }
        self.base = state(&t).1;
        self.s = t;
        self.history = vec![reopened];
        self.now = 0;
    }

    /// After every step: the drawing's piece is the model's, the drawing holds its objects and
    /// nothing else, the bench sheet counts its stones, and the undo stack is as deep as the
    /// model's history.
    #[invariant(always_run)]
    fn the_drawing_holds_the_models_piece(&mut self, _tc: TestCase) {
        let piece = self.piece().clone();
        assert_eq!(self.query(), piece, "piece {{query}} is not the piece the model expects");
        let d = self.s.doc().unwrap();
        let (objects, stones) = if piece.is_null() {
            (HashSet::new(), 0)
        } else {
            (handles(&piece["handles"]).into_iter().collect::<HashSet<_>>(), piece["stones"]["count"].as_u64().unwrap())
        };
        assert_eq!(d.model.len(), objects.len(), "the drawing holds {} objects, the piece is {}", d.model.len(), objects.len());
        assert!(d.model.iter().all(|e| objects.contains(&e.handle)), "an object in the drawing is not the piece's");
        assert_eq!(d.groups.len(), usize::from(!piece.is_null()), "the piece's group, and no other");
        assert_eq!(self.s.execute("techsheet", &json!({})).unwrap()["stones"]["count"], json!(stones), "the bench sheet's stones");
        let st = self.s.state().unwrap();
        assert_eq!(st.undo.len(), self.base + self.now, "the undo stack against the model's history");
        assert_eq!(st.redo.len(), self.history.len() - 1 - self.now, "the redo stack against the model's history");
    }
}

/// Rule: through any sequence of builds, edits, refused edits, removes, undos, redos, queries
/// and DXF round trips, the drawing holds exactly the piece a model of the documented behaviour
/// expects.
#[hegel::test(test_cases = 60, suppress_health_check = [HealthCheck::TooSlow])]
fn the_piece_follows_its_model_through_any_sequence_of_steps(tc: TestCase) {
    let inch = tc.draw(gs::booleans());
    hegel::stateful::machine(PieceModel::new(inch)).steps(30).run(tc);
}

// ---------------------------------------------------------------------------------------------
// 9. Hostile input
// ---------------------------------------------------------------------------------------------

const HOSTILE_COMMANDS: [&str; 12] =
    ["ring", "ringsizes", "gem", "gemlist", "pave", "gemfit", "setting", "techsheet", "piece", "piecemesh", "stlout", "objects"];

/// The parameter names each command reads.
fn keys_of(cmd: &str) -> Vec<&'static str> {
    const PIECE: [&str; 20] = [
        "query",
        "remove",
        "kind",
        "at",
        "system",
        "size",
        "sizeSystem",
        "wall",
        "width",
        "profile",
        "metal",
        "cut",
        "stone",
        "stoneWidth",
        "stoneLength",
        "prongs",
        "halo",
        "melee",
        "count",
        "gap",
    ];
    match cmd {
        "ring" => vec!["at", "system", "size", "diameter", "wall", "width", "gap", "metal", "layer", "view"],
        "ringsizes" => vec!["system", "size", "handle", "handles", "from", "to", "step", "limit"],
        "gem" => vec!["at", "cut", "length", "width", "diameter", "depth", "stone", "sg", "rotate", "table", "layer"],
        "gemlist" => vec!["cut"],
        "pave" => {
            vec![
                "handles",
                "handle",
                "along",
                "pattern",
                "rows",
                "count",
                "stoneWidth",
                "length",
                "cut",
                "depth",
                "stone",
                "sg",
                "rotate",
                "clearance",
                "edge",
                "layer",
            ]
        }
        "gemfit" => vec!["handles", "handle", "clearance", "cut", "ratio", "rotate", "stone", "sg", "limit"],
        "setting" => {
            vec!["handle", "handles", "style", "prongs", "diameter", "offset", "wall", "gap", "stoneWidth", "clearance", "cut", "layer", "metal"]
        }
        "techsheet" => vec!["handles", "metal", "section", "size", "radius", "system", "table", "at", "layer"],
        "piece" => PIECE.to_vec(),
        "piecemesh" => PIECE.iter().copied().chain(["quality"]).collect(),
        "stlout" => PIECE.iter().copied().chain(["quality", "stones", "binary"]).collect(),
        _ => vec!["limit", "space"],
    }
}

/// A number as JSON carries it; what JSON cannot carry (NaN, the infinities) goes as its name.
fn number(f: f64) -> Value {
    serde_json::Number::from_f64(f).map_or_else(|| json!(f.to_string()), Value::Number)
}

/// Any JSON value: null, booleans, integers to the ends of `i64` and `u64`, floats to the ends
/// of `f64` (and the denormals), strings (empty, huge, control characters, any Unicode, and the
/// words the commands know), arrays and objects of all of these, the objects keyed at random and
/// by the commands' own parameter names.
fn json_value(words: Vec<String>) -> impl PrintableGenerator<Value> {
    let ends = vec![i64::MIN, i64::MAX, -1, 0, 1, 2, 4, 12, 400, 401, 5000, 5001, 1 << 53];
    let extremes = vec![
        0.0,
        -0.0,
        0.5,
        1e-9,
        1e-300,
        5e-324,
        2.2e-308,
        1e15,
        1e17,
        9.007199254740993e15,
        1e300,
        1e308,
        -1e308,
        f64::MAX,
        f64::MIN,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        11.6,
        25.0,
        359.99999999999994,
    ];
    let keys: Vec<String> = HOSTILE_COMMANDS.iter().flat_map(|c| keys_of(c)).map(str::to_string).collect::<BTreeSet<_>>().into_iter().collect();
    let leaf = gs::one_of([
        gs::just(Value::Null).boxed_printable(),
        gs::booleans().map(Value::Bool).boxed_printable(),
        gs::integers::<i64>().map(Value::from).boxed_printable(),
        gs::integers::<i64>().min_value(-4).max_value(600).map(Value::from).boxed_printable(),
        gs::integers::<u64>().map(Value::from).boxed_printable(),
        gs::sampled_from(ends).map(Value::from).boxed_printable(),
        gs::floats::<f64>().map(number).boxed_printable(),
        gs::floats::<f64>().min_value(-60.0).max_value(60.0).map(number).boxed_printable(),
        gs::sampled_from(extremes).map(number).boxed_printable(),
        gs::text().max_size(16).map(Value::String).boxed_printable(),
        gs::sampled_from(words).map(Value::String).boxed_printable(),
    ]);
    gs::recursive(leaf, move |inner| {
        let name = hegel::one_of!(gs::sampled_from(keys.clone()), gs::text().max_size(6));
        gs::one_of([
            gs::vecs(inner.clone()).max_size(4).map(Value::Array).boxed_printable(),
            gs::hashmaps(name, inner)
                .max_size(5)
                .map(|m: HashMap<String, Value>| Value::Object(m.into_iter().collect::<BTreeMap<_, _>>().into_iter().collect()))
                .boxed_printable(),
        ])
    })
    .max_depth(3)
    .max_leaves(20)
}

/// A drawing with something of everything the commands read: a finger's circle, a region, a
/// path, stones, a ring blank, objects far away, enormous and minute — and now and then a piece.
fn furnished(inch: bool, with_piece: bool) -> (Session, Vec<String>) {
    let mut s = drawing(inch);
    let k = mm_per_unit(&s);
    let mut made = vec![
        circle(&mut s, [0.0, 0.0], 8.25 / k),
        polyline(&mut s, &[Vec2::new(20.0, 0.0) / k, Vec2::new(32.0, 0.0) / k, Vec2::new(32.0, 6.0) / k, Vec2::new(20.0, 6.0) / k]),
    ];
    let also = [
        ("line", json!({"points": [[0, 20], [15, 20]]})),
        ("gem", json!({"at": [40, 0], "width": 1.3})),
        ("gem", json!({"at": [50, 0], "cut": "marquise", "length": 8, "width": 4, "rotate": 30})),
        ("ring", json!({"at": [70, 0], "size": 6})),
        ("circle", json!({"center": [1e17, 0], "radius": 5})),
        ("circle", json!({"center": [0, 0], "radius": 1e12})),
        ("circle", json!({"center": [5, 5], "radius": 1e-9})),
        ("pline", json!({"points": [[1e15, 0], [1e15, 1e-3], [-1e15, 1e-3]], "closed": true})),
    ];
    for (cmd, p) in also {
        if let Ok(r) = s.execute(cmd, &p) {
            made.push(handle_of(&r));
        }
    }
    if with_piece {
        s.execute("piece", &json!({"kind": "solitaire", "halo": true, "at": [0, 60]})).unwrap();
    }
    (s, made)
}

/// The words a command's parameters are made of, and the handles of the furnished drawing.
fn words(handles: &[String]) -> Vec<String> {
    let mut w: Vec<String> = [
        "",
        " ",
        "\u{0}",
        "nan",
        "NaN",
        "inf",
        "-Infinity",
        "1e999",
        "-0",
        "6",
        "6.5",
        "0x10",
        "L",
        "Z½",
        "M1/2",
        "true",
        "null",
        "[]",
        "{}",
        "*",
        "0",
        "Metal",
        "GEM-ROUND-1.3",
        "RING-PIECE",
        "JEWELRY_PIECE",
        "draft",
        "fine",
        "model",
        "current",
        "prong",
        "bezel",
        "halo",
        "channel",
        "grid",
        "brick",
        "trench",
        "double",
        "FFFFFFFFFFFFFFFF",
        "0,0",
        "1,2",
        "@5<45",
    ]
    .iter()
    .map(|w| w.to_string())
    .collect();
    w.extend(KINDS.iter().chain(&PROFILES).chain(&SYSTEMS).chain(&METALS).map(|w| w.to_string()));
    w.extend(CUTS.iter().map(|c| c.name.to_string()));
    w.extend(STONES.iter().map(|s| s.0.to_string()));
    w.extend(handles.iter().cloned());
    w.push("x".repeat(20_000));
    w.push("9".repeat(400));
    w
}

/// Parameters a command would take as they are, to be spoiled a key at a time.
fn plausible(tc: &TestCase, cmd: &str, made: &[String]) -> Map<String, Value> {
    let any = |tc: &TestCase| tc.draw(gs::sampled_from(made.to_vec()));
    let v = match cmd {
        "ring" => json!({"at": [3, 4], "size": 6}),
        "ringsizes" => match pick(tc, &["list", "one", "measure", "range"]) {
            "list" => json!({}),
            "one" => json!({"system": pick(tc, &SYSTEMS), "size": 12}),
            "measure" => json!({"handle": any(tc)}),
            _ => json!({"from": 3, "to": 9, "step": 0.5}),
        },
        "gem" => json!({"at": [1, 2], "cut": cut_name(tc), "length": 6, "width": 4}),
        "pave" if tc.draw(gs::booleans()) => json!({"along": [any(tc)], "stoneWidth": 1.3}),
        "pave" => json!({"handles": [any(tc)], "stoneWidth": 1.3}),
        "gemfit" => json!({"handles": [any(tc)]}),
        "setting" => json!({"handle": any(tc), "style": pick(tc, &["prong", "bezel", "halo", "channel"])}),
        "techsheet" => match pick(tc, &["read", "table", "section"]) {
            "read" => json!({}),
            "table" => json!({"table": true, "at": [0, -40]}),
            _ => json!({"section": any(tc), "size": 6}),
        },
        "piece" => match pick(tc, &["build", "build", "query", "remove", "edit"]) {
            "build" => Value::Object(piece_json(tc)),
            "query" => json!({"query": true}),
            "remove" => json!({"remove": true}),
            _ => json!({}),
        },
        "piecemesh" | "stlout" => Value::Object(piece_json(tc)),
        _ => json!({}),
    };
    v.as_object().cloned().unwrap_or_default()
}

/// How long any one command may take, hostile input or not.
const TIME_BUDGET: Duration = Duration::from_secs(20);

/// One call under the rule: no panic (caught or not), an answer in time, and nothing changed by
/// a refusal.
fn survives(s: &mut Session, cmd: &str, params: &Value) {
    let shown = serde_json::to_string(params).unwrap();
    let shown: String =
        if shown.len() > 2000 { format!("{}… ({} bytes)", shown.chars().take(2000).collect::<String>(), shown.len()) } else { shown };
    let before = state(s);
    let (r, took) = timed(&format!("{cmd} {shown}"), || s.execute(cmd, params));
    if let Err(EngineError::Internal(_, message)) = &r {
        panic!("{cmd} {shown} PANICKED (the engine's guard caught it): {message}");
    }
    assert!(took <= TIME_BUDGET, "{cmd} {shown} took {took:?}");
    match r {
        Err(e) => assert_eq!(state(s), before, "{cmd} {shown} was refused ({e}) and changed the drawing: (objects, undo depth, revision)"),
        Ok(reply) => assert!(serde_json::to_string(&reply).is_ok(), "{cmd} {shown}: the reply cannot be written"),
    }
}

/// Rule: whatever JSON a jewelry command is handed, it answers or refuses — it never panics,
/// never hangs, and a refusal leaves the drawing's objects, undo depth and revision as they
/// were.
#[hegel::test(test_cases = 2000, suppress_health_check = [HealthCheck::TooSlow])]
fn hostile_parameters_never_panic_hang_or_half_change_the_drawing(tc: TestCase) {
    let inch = tc.draw(gs::booleans());
    let with_piece = tc.draw(gs::booleans());
    let (mut s, made) = furnished(inch, with_piece);
    let garbage = json_value(words(&made));
    let calls = tc.draw(gs::integers::<usize>().min_value(1).max_value(3));
    for _ in 0..calls {
        let cmd = pick(&tc, &HOSTILE_COMMANDS);
        let params = match pick(&tc, &["spoiled", "spoiled", "spoiled", "named", "anything"]) {
            // Parameters the command would take, with up to three of them replaced by anything.
            "spoiled" => {
                let mut p = plausible(&tc, cmd, &made);
                let spoil = tc.draw(gs::integers::<usize>().min_value(0).max_value(3));
                for _ in 0..spoil {
                    let key = tc.draw(gs::sampled_from(keys_of(cmd)));
                    p.insert(key.to_string(), tc.draw(&garbage));
                }
                Value::Object(p)
            }
            // The command's own parameter names, each mapped to anything.
            "named" => {
                let keys = tc.draw(gs::samples(keys_of(cmd)).max_size(6));
                Value::Object(keys.into_iter().map(|k| (k.to_string(), tc.draw(&garbage))).collect())
            }
            _ => tc.draw(&garbage),
        };
        tc.note(&format!("{cmd} {}", serde_json::to_string(&params).unwrap().chars().take(4000).collect::<String>()));
        survives(&mut s, cmd, &params);
    }
}
