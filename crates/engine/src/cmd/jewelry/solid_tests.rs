//! The merged solid for the caster: one closed, manifold, consistently oriented and
//! non-self-intersecting shell, the stones in their seats clear of the metal, the seats taking
//! metal away, the band's volume the analytic one, and the STL reading back as the same shell.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use cadcraft_geom::Vec3;
use hegel::TestCase;
use hegel::generators::{self as gs};
use serde_json::{Map, Value, json};

use super::mesh::*;
use super::piece_params::PieceParams;
use super::property_tests::piece_json;
use super::solid::*;
use crate::Session;
use crate::cmd::file::base64_decode;

const KINDS: [&str; 4] = ["band", "solitaire", "threestone", "eternity"];
const PROFILES: [&str; 7] = ["flat", "dome", "comfort", "court", "knife", "bevel", "concave"];
/// The draft grid step the properties sample at, mm.
const STEP: f64 = 0.2;
/// The most triangles a property's solid may take before it is sampled more coarsely.
const TEST_TRIS: usize = 400_000;

fn params(v: &Value) -> PieceParams {
    PieceParams::parse("test", v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn tri(s: &Solid, t: &[u32]) -> [Vec3; 3] {
    [s.positions[t[0] as usize], s.positions[t[1] as usize], s.positions[t[2] as usize]]
}

/// How many pieces (edge-connected) the shell is in.
fn components(s: &Solid) -> usize {
    let mut parent: Vec<usize> = (0..s.positions.len()).collect();
    fn find(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    for t in s.indices.chunks_exact(3) {
        let a = find(&mut parent, t[0] as usize);
        for v in &t[1..] {
            let b = find(&mut parent, *v as usize);
            parent[b] = a;
        }
    }
    let mut roots: Vec<usize> = s.indices.iter().map(|i| find(&mut parent, *i as usize)).collect();
    roots.sort_unstable();
    roots.dedup();
    roots.len()
}

/// Whether segment `p`–`q` passes through the inside of triangle `t` (touching does not count).
fn crosses(p: Vec3, q: Vec3, t: &[Vec3; 3]) -> bool {
    let e1 = t[1] - t[0];
    let e2 = t[2] - t[0];
    let d = q - p;
    let h = d.cross(e2);
    let a = e1.dot(h);
    if a.abs() < 1e-14 {
        return false;
    }
    let f = 1.0 / a;
    let s = p - t[0];
    let u = f * s.dot(h);
    let qv = s.cross(e1);
    let v = f * d.dot(qv);
    let w = f * e2.dot(qv);
    let eps = 1e-9;
    u > eps && v > eps && u + v < 1.0 - eps && w > eps && w < 1.0 - eps
}

/// No two triangles that share no vertex cross each other: every pair in the same grid cell is
/// tested (each triangle binned by its centroid into cells of twice the step, and the 27 cells
/// around it searched), up to `max_pairs` pairs.
fn self_intersections(s: &Solid, max_pairs: usize) -> (usize, usize) {
    let cell = 2.0 * s.step;
    let key = |p: Vec3| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64, (p.z / cell).floor() as i64);
    let mut bins: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::new();
    let tris: Vec<&[u32]> = s.indices.chunks_exact(3).collect();
    for (i, t) in tris.iter().enumerate() {
        let [a, b, c] = tri(s, t);
        bins.entry(key((a + b + c) * (1.0 / 3.0))).or_default().push(i);
    }
    let (mut pairs, mut bad) = (0usize, 0usize);
    for (i, t) in tris.iter().enumerate() {
        let tv = tri(s, t);
        let (x, y, z) = key((tv[0] + tv[1] + tv[2]) * (1.0 / 3.0));
        for dz in -1..=1 {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    for &j in bins.get(&(x + dx, y + dy, z + dz)).map_or(&[][..], Vec::as_slice) {
                        if j <= i || t.iter().any(|v| tris[j].contains(v)) {
                            continue;
                        }
                        pairs += 1;
                        if pairs > max_pairs {
                            return (pairs, bad);
                        }
                        let uv = tri(s, tris[j]);
                        let hit = (0..3).any(|k| crosses(tv[k], tv[(k + 1) % 3], &uv) || crosses(uv[k], uv[(k + 1) % 3], &tv));
                        bad += usize::from(hit);
                    }
                }
            }
        }
    }
    (pairs, bad)
}

/// Everything a caster's shell must be.
fn assert_castable(s: &Solid, what: &str) {
    verify(&s.positions, &s.indices).unwrap_or_else(|e| panic!("{what}: {e}"));
    assert!(!s.indices.is_empty(), "{what}: empty");
    for t in s.indices.chunks_exact(3) {
        let [a, b, c] = tri(s, t);
        let area = (b - a).cross(c - a).len() / 2.0;
        assert!(area > 1e-10, "{what}: a degenerate triangle ({area} mm²) at {a:?}");
        // In f32, as the STL carries it, it still has an area.
        let f = |v: Vec3| Vec3::new(f64::from(v.x as f32), f64::from(v.y as f32), f64::from(v.z as f32));
        assert!((f(b) - f(a)).cross(f(c) - f(a)).len() > 0.0, "{what}: a triangle with no area in f32 at {a:?}");
    }
    assert!(s.volume() > 0.0, "{what}: volume {}", s.volume());
    let (pairs, bad) = self_intersections(s, 3_000_000);
    assert_eq!(bad, 0, "{what}: {bad} of {pairs} nearby triangle pairs cross");
}

fn solid_of(mesh: &PieceMesh, step: f64, what: &str) -> Solid {
    solidify(&mesh.csg, step, TEST_TRIS).unwrap_or_else(|e| panic!("{what}: {e}")).0
}

/// No stone vertex lies more than `tol` inside the metal (the analytic field: positive outside).
fn deepest_stone_vertex(mesh: &PieceMesh) -> f64 {
    mesh.meshes.iter().filter(|m| m.part == "stone").flat_map(|m| m.positions.iter()).map(|p| mesh.csg.eval(*p)).fold(f64::INFINITY, f64::min)
}

/// How far a stone may reach into the metal: none at all in the analytic field (each seat is the
/// stone grown by its clearance), less a hair for rounding.
const STONE_TOL: f64 = 1e-6;

/// Rule: for every kind × profile × a few sizes and stones, the merged solid is one closed,
/// manifold, outward-facing shell with no degenerate triangle and no self-intersection, the
/// stones sit in their seats without touching the metal, and the seats take metal away.
#[hegel::test(test_cases = 40, suppress_health_check = [hegel::HealthCheck::TooSlow])]
fn every_usual_piece_is_one_castable_shell(tc: TestCase) {
    let kind = KINDS[tc.draw(gs::integers::<usize>().min_value(0).max_value(3))];
    let profile = PROFILES[tc.draw(gs::integers::<usize>().min_value(0).max_value(6))];
    let size = f64::from(tc.draw(gs::integers::<u32>().min_value(8).max_value(52))) / 4.0;
    let cut =
        ["round", "oval", "princess", "emerald", "pear", "marquise", "cushion", "heart"][tc.draw(gs::integers::<usize>().min_value(0).max_value(7))];
    let stone = f64::from(tc.draw(gs::integers::<u32>().min_value(8).max_value(18))) / 2.0;
    let mut p = json!({"kind": kind, "profile": profile, "size": size, "cut": cut, "stoneWidth": stone,
        "prongs": tc.draw(gs::integers::<u32>().min_value(3).max_value(8)), "melee": f64::from(tc.draw(gs::integers::<u32>().min_value(4).max_value(10))) / 4.0});
    if kind == "solitaire" && tc.draw(gs::booleans()) {
        p["halo"] = json!(true);
    }
    if ["oval", "pear", "marquise", "emerald"].contains(&cut) {
        p["stoneLength"] = json!(stone * 1.4);
    }
    tc.note(&format!("{p}"));
    let Ok(piece) = PieceParams::parse("test", &p) else { return };
    let mesh = piece_mesh(&piece, Quality::Draft);
    let what = p.to_string();
    let t = Instant::now();
    let s = solid_of(&mesh, STEP, &what);
    tc.note(&format!("{} triangles in {:?}", s.triangles(), t.elapsed()));
    assert_castable(&s, &what);
    // One body, unless stones crowd each other so a seat cuts a part through; then STLOUT says so.
    assert_eq!(components(&s), s.bodies, "{what}");
    tc.event(if s.bodies == 1 { "one body" } else { "more than one body" });
    if s.bodies > 1 {
        let mut q = p.clone();
        q["quality"] = json!("draft");
        let r = Session::new().execute("stlout", &q).unwrap();
        assert!(r["bodies"].as_u64().unwrap() > 1 && r["notes"].to_string().contains("separate pieces"), "{what}: {}", r["notes"]);
    }
    let deepest = deepest_stone_vertex(&mesh);
    assert!(deepest >= -STONE_TOL, "{what}: a stone reaches {deepest} mm into the metal");
    if mesh.seats > 0 {
        let uncut = Csg { add: mesh.csg.add.clone(), cut: Vec::new() };
        let whole = solidify(&uncut, STEP, TEST_TRIS).unwrap().0;
        assert!(s.volume() < whole.volume(), "{what}: the seats take nothing away ({} vs {})", s.volume(), whole.volume());
    }
}

/// Rule: any piece `PIECE` takes — awkward proportions meant — is a closed, consistently oriented
/// shell with no degenerate triangle and no self-intersection, or a clear refusal; never a broken
/// file, never a panic.
#[hegel::test(test_cases = 60, suppress_health_check = [hegel::HealthCheck::TooSlow])]
fn any_piece_is_a_shell_or_a_refusal(tc: TestCase) {
    let mut p: Map<String, Value> = piece_json(&tc);
    if tc.draw(gs::weighted_booleans(0.25)) {
        p.insert("kind".into(), json!("threestone"));
    }
    let p = Value::Object(p);
    tc.note(&format!("{p}"));
    let Ok(piece) = PieceParams::parse("test", &p) else { return };
    let mesh = piece_mesh(&piece, Quality::Draft);
    let what = p.to_string();
    let t = Instant::now();
    match solidify(&mesh.csg, STEP, TEST_TRIS) {
        Ok((s, _)) => {
            assert_castable(&s, &what);
            assert!(deepest_stone_vertex(&mesh) >= -STONE_TOL, "{what}: a stone reaches into the metal");
        }
        Err(e) => assert!(e.contains("too") && !e.contains("failed its own check"), "{what}: {e}"),
    }
    assert!(t.elapsed() < Duration::from_secs(20), "{what}: {:?}", t.elapsed());
}

/// The merged band is the analytic band: within [`SOLID_AGREEMENT_PER_MM`] × the step at every profile and the
/// steps STLOUT uses.
#[test]
fn the_merged_band_weighs_what_the_engine_says() {
    for profile in PROFILES {
        for (size, wall, width) in [(3.0, 1.2, 1.8), (6.0, 1.8, 2.2), (11.0, 2.5, 6.0)] {
            let p = params(&json!({"kind": "band", "profile": profile, "size": size, "wall": wall, "width": width}));
            let mesh = piece_mesh(&p, Quality::Draft);
            for step in [0.1, 0.2] {
                let s = solid_of(&mesh, step, profile);
                let (v, b) = (s.volume(), p.band_volume());
                let off = (v - b) / b;
                println!("{profile} US {size} {wall}×{width} at {step} mm: solid {v:.2} mm³, analytic {b:.2} mm³, {:+.3}%", off * 100.0);
                assert!(off.abs() < SOLID_AGREEMENT_PER_MM * step, "{profile} US {size} at {step}: {v} vs {b}");
            }
        }
    }
}

/// A prong head's seat: the bearing notch is cut into every prong at girdle height (metal there
/// before, none after), and a clearance hole opens under the culet.
#[test]
fn a_prong_head_is_notched_and_drilled() {
    let p = params(&json!({"kind": "solitaire"}));
    let mesh = piece_mesh(&p, Quality::Draft);
    let uncut = Csg { add: mesh.csg.add.clone(), cut: Vec::new() };
    // The stone's girdle: the widest ring of the centre stone's vertices.
    let stone = mesh.meshes.iter().find(|m| m.part == "stone").unwrap();
    let centre = stone.positions.iter().fold(Vec3::ZERO, |a, b| a + *b) * (1.0 / stone.positions.len() as f64);
    // Just inside the girdle's radius at girdle height, in the plane of the stone, all round:
    // the uncut prongs fill some of those points; the cut piece none.
    let girdle = stone.positions.iter().map(|v| (v.x - centre.x).hypot(v.z - centre.z)).fold(0.0, f64::max);
    let mut filled = 0;
    for k in 0..720 {
        let a = k as f64 / 720.0 * std::f64::consts::TAU;
        // The girdle plane is the one through the widest ring: sample a band of heights around it.
        for dy in [-0.05, 0.0, 0.05] {
            let q = Vec3::new(centre.x + (girdle - 0.02) * a.cos(), girdle_height(stone) + dy, centre.z + (girdle - 0.02) * a.sin());
            if uncut.eval(q) < 0.0 {
                filled += 1;
                assert!(mesh.csg.eval(q) > 0.0, "the seat leaves metal at the girdle at {q:?}");
            }
        }
    }
    assert!(filled > 0, "the prongs reach the girdle (else nothing is notched)");
    // Under the culet, on the axis, there is a hole through the gallery.
    let culet = stone.positions.iter().fold(Vec3::new(0.0, f64::INFINITY, 0.0), |a, b| if b.y < a.y { *b } else { a });
    for k in 1..6 {
        let q = culet - Vec3::new(0.0, 0.1 * k as f64, 0.0);
        assert!(mesh.csg.eval(q) > 0.0, "metal under the culet at {q:?}");
    }
}

/// The centre stone's girdle height: the height of its widest ring.
fn girdle_height(stone: &PartMesh) -> f64 {
    let centre = stone.positions.iter().fold(Vec3::ZERO, |a, b| a + *b) * (1.0 / stone.positions.len() as f64);
    stone
        .positions
        .iter()
        .max_by(|a, b| (a.x - centre.x).hypot(a.z - centre.z).total_cmp(&(b.x - centre.x).hypot(b.z - centre.z)))
        .map_or(0.0, |v| v.y)
}

/// Reads a binary STL back as triangles, welding equal `f32` vertices.
fn weld(bytes: &[u8]) -> Solid {
    let n = u32::from_le_bytes(bytes[80..84].try_into().unwrap()) as usize;
    assert_eq!(bytes.len(), 84 + 50 * n);
    let mut at: HashMap<[u32; 3], u32> = HashMap::new();
    let mut positions = Vec::new();
    let mut indices = Vec::new();
    for t in 0..n {
        let base = 84 + 50 * t + 12;
        for v in 0..3 {
            let mut q = [0u32; 3];
            for (c, slot) in q.iter_mut().enumerate() {
                let o = base + 12 * v + 4 * c;
                *slot = u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
            }
            let i = *at.entry(q).or_insert_with(|| {
                positions.push(Vec3::new(f64::from(f32::from_bits(q[0])), f64::from(f32::from_bits(q[1])), f64::from(f32::from_bits(q[2]))));
                (positions.len() - 1) as u32
            });
            indices.push(i);
        }
    }
    let bodies = components(&Solid { positions: positions.clone(), indices: indices.clone(), step: 0.0, bodies: 0 });
    Solid { positions, indices, step: 0.0, bodies }
}

/// STLOUT's file reads back, welded on its `f32` vertices, as the same closed shell, of the volume
/// and grams the reply reports; with `stones` the stones follow as shells of their own.
#[test]
fn the_stl_reads_back_as_the_same_shell() {
    let mut s = Session::new();
    for p in [
        json!({"kind": "band", "quality": "draft"}),
        json!({"kind": "solitaire", "quality": "draft"}),
        json!({"kind": "solitaire", "halo": true, "quality": "draft"}),
        json!({"kind": "threestone", "quality": "draft"}),
        json!({"kind": "eternity", "quality": "draft"}),
    ] {
        let r = s.execute("stlout", &p).unwrap();
        let bytes = base64_decode(r["base64"].as_str().unwrap()).unwrap();
        let back = weld(&bytes);
        verify(&back.positions, &back.indices).unwrap_or_else(|e| panic!("{p}: {e}"));
        assert_eq!(components(&back), 1, "{p}: one body");
        assert_eq!(r["bodies"], json!(1), "{p}");
        let v = back.volume();
        let said = r["metal"]["volumeMm3"].as_f64().unwrap();
        assert!((v - said).abs() / said < 1e-4, "{p}: the file holds {v} mm³, the reply says {said}");
        let grams = r["metal"]["grams"].as_f64().unwrap();
        assert!((grams - said / 1000.0 * r["metal"]["density"].as_f64().unwrap()).abs() < 2e-3, "{p}");
        assert!(r["metal"]["band"]["grams"].as_f64().unwrap() > 0.0);
        if p["kind"] == "band" {
            assert!(
                (grams / r["metal"]["band"]["grams"].as_f64().unwrap() - 1.0).abs() < SOLID_AGREEMENT_PER_MM * r["step"].as_f64().unwrap(),
                "{p}: {r}"
            );
        } else {
            assert!(r["seats"].as_u64().unwrap() >= 1, "{p}");
        }
        // With the stones, they come after the metal, as more shells.
        let mut q = p.clone();
        q["stones"] = json!(true);
        let with = s.execute("stlout", &q).unwrap();
        let more = weld(&base64_decode(with["base64"].as_str().unwrap()).unwrap());
        verify(&more.positions, &more.indices).unwrap_or_else(|e| panic!("{q}: {e}"));
        if p["kind"] != "band" {
            assert!(components(&more) > 1 && more.triangles() > back.triangles(), "{q}");
        }
    }
}

/// How long the merged solid takes, piece by piece, at both qualities (run with `--ignored
/// --nocapture` in release to see the figures the docs quote).
#[test]
#[ignore = "a timing report, not a check: run in release with --ignored --nocapture"]
fn timing() {
    for (what, v) in [
        ("band", json!({"kind": "band"})),
        ("solitaire", json!({"kind": "solitaire"})),
        ("halo", json!({"kind": "solitaire", "halo": true})),
        ("threestone", json!({"kind": "threestone"})),
        ("eternity", json!({"kind": "eternity"})),
    ] {
        let mut s = Session::new();
        for quality in ["draft", "fine"] {
            let mut p = v.clone();
            p["quality"] = json!(quality);
            let t = Instant::now();
            let r = s.execute("stlout", &p).unwrap();
            println!(
                "{what} {quality}: {} triangles, {} MB, step {} mm, {} g (band alone {} g), {:?}",
                r["triangles"],
                r["bytes"].as_f64().unwrap() / 1e6,
                r["step"],
                r["metal"]["grams"],
                r["metal"]["band"]["grams"],
                t.elapsed()
            );
        }
    }
}

/// The newer heads, kinds and pavé reach the merged solid: each is one castable body, its stones
/// clear of the metal, a seat cut for every stone, and every metal part the display mesh shows
/// (a bezel's collar, a signet's face, a dome's taller top) lies within the solid.
#[test]
fn the_newer_parts_are_in_the_merged_solid() {
    let cases = [
        json!({"kind": "solitaire", "head": "bezel"}),
        json!({"kind": "solitaire", "head": "bezel", "cut": "oval", "stoneWidth": 6.0, "stoneLength": 8.0}),
        json!({"kind": "threestone", "head": "bezel"}),
        json!({"kind": "halfeternity"}),
        json!({"kind": "dome"}),
        json!({"kind": "signet"}),
        json!({"kind": "band", "width": 6.0, "wall": 2.0, "pave": {"layout": "honeycomb", "rows": 2, "span": "top-half"}}),
        json!({"kind": "solitaire", "pave": true}),
    ];
    for p in cases {
        let what = p.to_string();
        let piece = params(&p);
        let mesh = piece_mesh(&piece, Quality::Draft);
        let s = solid_of(&mesh, STEP, &what);
        assert_castable(&s, &what);
        assert_eq!(components(&s), 1, "{what}: one body");
        assert_eq!(s.bodies, 1, "{what}");
        let deepest = deepest_stone_vertex(&mesh);
        assert!(deepest >= -STONE_TOL, "{what}: a stone reaches {deepest} mm into the metal");
        assert_eq!(mesh.seats, mesh.stones, "{what}: a seat for every stone");
        if mesh.seats > 0 {
            let uncut = Csg { add: mesh.csg.add.clone(), cut: Vec::new() };
            let whole = solidify(&uncut, STEP, TEST_TRIS).unwrap().0;
            assert!(s.volume() < whole.volume(), "{what}: the seats take nothing away");
        }
        let uncut = Csg { add: mesh.csg.add.clone(), cut: Vec::new() };
        for m in mesh.meshes.iter().filter(|m| m.part == "metal") {
            let out = m.positions.iter().map(|q| uncut.eval(*q)).fold(f64::NEG_INFINITY, f64::max);
            assert!(out < 0.05, "{what}: the {} stands {out} mm outside the solid", m.name);
        }
    }
    // A dome's tapered top is in the solid: it weighs what the engine's tapered shank weighs.
    let dome = params(&json!({"kind": "dome"}));
    let s = solid_of(&piece_mesh(&dome, Quality::Draft), 0.1, "dome");
    let (v, b) = (s.volume(), dome.band_volume());
    assert!(((v - b) / b).abs() < 2.0 * SOLID_AGREEMENT_PER_MM * 0.1, "dome: solid {v} mm³ vs shank {b} mm³");
}

/// A pavé band's seats take metal away on purpose: STLOUT does not call the band thin for it.
#[test]
fn a_pave_band_s_seats_are_not_reported_as_a_thin_band() {
    let r = Session::new()
        .execute("stlout", &json!({"kind": "band", "width": 6.0, "wall": 2.0, "pave": {"layout": "honeycomb", "rows": 2}, "quality": "draft"}))
        .unwrap();
    assert!(r["seats"].as_u64().unwrap() > 0, "{r}");
    assert!(!r["notes"].to_string().contains("is thin for"), "{}", r["notes"]);
}

/// How far a point is from the true surface, to first order: the field over its gradient.
fn surface_distance(csg: &Csg, p: Vec3) -> f64 {
    let f = |q: Vec3| csg.eval(q);
    let h = 1e-4;
    let g = Vec3::new(
        (f(p + Vec3::new(h, 0.0, 0.0)) - f(p - Vec3::new(h, 0.0, 0.0))) / (2.0 * h),
        (f(p + Vec3::new(0.0, h, 0.0)) - f(p - Vec3::new(0.0, h, 0.0))) / (2.0 * h),
        (f(p + Vec3::new(0.0, 0.0, h)) - f(p - Vec3::new(0.0, 0.0, h))) / (2.0 * h),
    );
    f(p).abs() / g.len().max(0.5)
}

/// Mean and max surface distance over the vertices, then over the triangles' centroids.
fn surface_error(csg: &Csg, s: &Solid) -> (f64, f64, f64, f64) {
    let v: Vec<f64> = s.positions.iter().map(|p| surface_distance(csg, *p)).collect();
    let c: Vec<f64> = s
        .indices
        .chunks_exact(3)
        .map(|t| {
            let [a, b, c] = tri(s, t);
            surface_distance(csg, (a + b + c) * (1.0 / 3.0))
        })
        .collect();
    let mean = |x: &[f64]| x.iter().sum::<f64>() / x.len().max(1) as f64;
    let max = |x: &[f64]| x.iter().copied().fold(0.0, f64::max);
    (mean(&v), max(&v), mean(&c), max(&c))
}

fn write_stl(path: &std::path::Path, s: &Solid) {
    let mut out = vec![0u8; 80];
    out.extend((s.triangles() as u32).to_le_bytes());
    for t in s.indices.chunks_exact(3) {
        let [a, b, c] = tri(s, t);
        let n = (b - a).cross(c - a);
        for v in [n, a, b, c] {
            for x in [v.x, v.y, v.z] {
                out.extend((x as f32).to_le_bytes());
            }
        }
        out.extend([0, 0]);
    }
    std::fs::write(path, out).unwrap();
}

/// The pieces the surface report measures.
fn report_pieces() -> Vec<(&'static str, Value)> {
    vec![
        ("band", json!({"kind": "band"})),
        ("halo", json!({"kind": "solitaire", "halo": true})),
        ("bezel", json!({"kind": "solitaire", "head": "bezel"})),
        ("honeycomb", json!({"kind": "band", "width": 6.0, "wall": 2.0, "pave": {"layout": "honeycomb", "rows": 2, "span": "top-half"}})),
        ("scallop", json!({"kind": "band", "width": 3.0, "wall": 2.0, "pave": {"layout": "scallop", "span": "top-half"}})),
        ("signet", json!({"kind": "signet"})),
        ("eternity", json!({"kind": "eternity"})),
    ]
}

/// The surface's distance from the true surface, raw (the grid's piecewise-linear zero set) and
/// smoothed (vertices projected onto the field's zero set), at STLOUT's default fine step and
/// triangle cap; with `MAKING_DIR` set, the STLs too (run in release with `--ignored --nocapture`).
#[test]
#[ignore = "a report, not a check: run in release with --ignored --nocapture"]
fn surface_report() {
    let dir = std::env::var("MAKING_DIR").ok();
    for (what, v) in report_pieces() {
        let mesh = piece_mesh(&params(&v), Quality::Fine);
        for smooth in [false, true] {
            let t = Instant::now();
            let (s, _) = solidify_with(&mesh.csg, 0.1, 150_000, smooth).unwrap();
            let el = t.elapsed();
            let (vm, vx, cm, cx) = surface_error(&mesh.csg, &s);
            println!(
                "{what:10} {}: step {:.3} mm, {} triangles, {el:?}; vertices mean {:.4} max {:.4} mm; centroids mean {:.4} max {:.4} mm",
                if smooth { "smooth" } else { "raw   " },
                s.step,
                s.triangles(),
                vm,
                vx,
                cm,
                cx
            );
            if let Some(d) = &dir {
                write_stl(&std::path::Path::new(d).join(format!("{what}-{}.stl", if smooth { "smooth" } else { "raw" })), &s);
            }
        }
    }
}

/// The vertices lie on the true surface: projected onto the field's zero set, they stand far
/// nearer it than the grid's piecewise-linear surface does, on curved bands, beads and seats, and
/// the shell stays everything a caster's must be.
#[test]
fn the_smoothed_surface_lies_on_the_true_one() {
    for (what, v) in report_pieces() {
        let mesh = piece_mesh(&params(&v), Quality::Draft);
        let raw = solidify_with(&mesh.csg, STEP, TEST_TRIS, false).unwrap().0;
        let smooth = solid_of(&mesh, STEP, what);
        assert_castable(&smooth, what);
        assert_eq!(raw.triangles(), smooth.triangles(), "{what}: the same connectivity");
        let (rm, rx, _, _) = surface_error(&mesh.csg, &raw);
        let (sm, sx, _, _) = surface_error(&mesh.csg, &smooth);
        println!("{what}: vertices mean {rm:.5} → {sm:.5} mm, max {rx:.4} → {sx:.4} mm");
        assert!(sm < 0.5 * rm, "{what}: mean {sm} vs raw {rm}");
        assert!(sx <= rx + 1e-9, "{what}: max {sx} vs raw {rx}");
        // The volume moves little: the projection takes off facets, it does not reshape.
        assert!((smooth.volume() / raw.volume() - 1.0).abs() < 0.02, "{what}: {} vs {}", smooth.volume(), raw.volume());
    }
}

/// A scalloped row's scallops are cut into both sides of the band: the solid is one castable
/// body, lighter than the same band with the scallops left out, its stones clear of the metal,
/// and the metal gone where the sheet's arc dips under a stone at the band's side.
#[test]
fn a_scalloped_row_is_cut_into_the_band() {
    let p = json!({"kind": "band", "width": 3.0, "wall": 2.0, "pave": {"layout": "scallop", "span": "top-half"}});
    let piece = params(&p);
    let mesh = piece_mesh(&piece, Quality::Draft);
    let s = solid_of(&mesh, STEP, "scallop");
    assert_castable(&s, "scallop");
    assert_eq!(s.bodies, 1);
    assert!(deepest_stone_vertex(&mesh) >= -STONE_TOL);
    let plates = mesh.csg.cut.iter().filter(|q| matches!(q, Prim::Plate { .. })).count();
    assert_eq!(plates, 2 * mesh.stones as usize, "two scallops a stone");
    let plain = Csg { add: mesh.csg.add.clone(), cut: mesh.csg.cut.iter().filter(|q| !matches!(q, Prim::Plate { .. })).cloned().collect() };
    let whole = solid_of(&PieceMesh { csg: plain.clone(), ..piece_mesh(&piece, Quality::Draft) }, STEP, "plain");
    assert!(s.volume() < whole.volume() - 0.5, "the scallops take metal away: {} vs {}", s.volume(), whole.volume());
    // Under the stone at 12 o'clock, at the band's side, a little below the outside: metal before,
    // none after.
    let fit = super::pave_band::fit(&piece).unwrap();
    let top = fit.stones.iter().min_by(|a, b| a.angle.abs().total_cmp(&b.angle.abs())).unwrap();
    let out = Vec3::new(top.angle.sin(), top.angle.cos(), 0.0);
    let probe = out * (top.table.x.hypot(top.table.y) - 0.3 * top.diameter) + Vec3::Z * 1.4;
    assert!(plain.eval(probe) < 0.0, "metal there without the scallop");
    assert!(mesh.csg.eval(probe) > 0.0, "no metal there with it");
    // The notes say the solid cuts them.
    let r = Session::new()
        .execute("stlout", &json!({"kind": "band", "width": 3.0, "wall": 2.0, "pave": {"layout": "scallop"}, "quality": "draft"}))
        .unwrap();
    assert!(r["notes"].to_string().contains("scallops are cut"), "{}", r["notes"]);
}

/// Every vertex of a file, read back.
fn stl_of(r: &Value) -> Solid {
    weld(&base64_decode(r["base64"].as_str().unwrap()).unwrap())
}

fn bbox(s: &Solid) -> (Vec3, Vec3) {
    s.positions.iter().fold((Vec3::new(1e9, 1e9, 1e9), Vec3::new(-1e9, -1e9, -1e9)), |(lo, hi), p| {
        (Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z)), Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z)))
    })
}

/// A sprue: merged into the metal as one body, standing out of the bottom of the shank by its
/// length (or where `at` puts it), the reply's weight the piece's without it; refused where it
/// would touch a stone or a seat, and refused when its numbers are out of range.
#[test]
fn a_sprue_is_merged_where_it_is_asked() {
    let mut s = Session::new();
    for kind in ["band", "solitaire", "threestone", "signet"] {
        let base = json!({"kind": kind, "quality": "draft"});
        let plain = s.execute("stlout", &base).unwrap();
        let mut q = base.clone();
        q["sprue"] = json!(true);
        let r = s.execute("stlout", &q).unwrap();
        let back = stl_of(&r);
        verify(&back.positions, &back.indices).unwrap_or_else(|e| panic!("{kind}: {e}"));
        assert_eq!(components(&back), 1, "{kind}: the sprue is merged, one body");
        assert_eq!(r["sprue"], json!({"diameter": 2.5, "length": 6.0, "at": 180.0}), "{kind}");
        let piece = params(&base);
        let bottom = piece.inner() / 2.0 + piece.section().height_at(0.0);
        let (lo, _) = bbox(&back);
        assert!((lo.y + bottom + 6.0).abs() < 0.25, "{kind}: the sprue's end at y = {} (the band's bottom at {})", lo.y, -bottom);
        // The weight is the piece's own, give or take the sprue's root in the band.
        let (a, b) = (r["metal"]["volumeMm3"].as_f64().unwrap(), plain["metal"]["volumeMm3"].as_f64().unwrap());
        assert!((a - b).abs() / b < 0.05, "{kind}: {a} vs {b} mm³");
        assert!(r["notes"].to_string().contains("sprue"), "{kind}");
    }
    // Elsewhere round the band, and its own size.
    let r = s.execute("stlout", &json!({"kind": "band", "quality": "draft", "sprue": {"at": 90, "diameter": 1.5, "length": 3}})).unwrap();
    let (_, hi) = bbox(&stl_of(&r));
    let band = params(&json!({"kind": "band"}));
    let side = band.inner() / 2.0 + band.section().height_at(0.0) + 3.0;
    assert!((hi.x - side).abs() < 0.25, "the sprue at 3 o'clock ends at x = {} (asked {side})", hi.x);
    // Under the head, or on a full eternity's stones: refused.
    for q in [
        json!({"kind": "solitaire", "sprue": {"at": 0}}),
        json!({"kind": "eternity", "sprue": true}),
        json!({"kind": "solitaire", "halo": true, "sprue": {"at": 10}}),
    ] {
        let e = s.execute("stlout", &q).unwrap_err().to_string();
        assert!(e.contains("sprue") && (e.contains("stone") || e.contains("seat")), "{q}: {e}");
    }
    for bad in
        [json!("yes"), json!(3), json!({"diameter": 0}), json!({"diameter": 9}), json!({"length": -1}), json!({"at": 1e9}), json!({"diameter": "x"})]
    {
        let e = s.execute("stlout", &json!({"kind": "band", "sprue": bad})).unwrap_err().to_string();
        assert!(e.contains("sprue"), "{bad}: {e}");
    }
    assert!(s.execute("stlout", &json!({"kind": "band", "sprue": false, "quality": "draft"})).unwrap()["sprue"].is_null());
}

/// Shrinkage: the file is the same solid scaled up about the finger's centre by 1 + shrink/100,
/// the reply's weight the drawn piece's; out of range is refused.
#[test]
fn shrink_scales_the_file_and_not_the_weight() {
    let mut s = Session::new();
    let base = json!({"kind": "solitaire", "quality": "draft", "stones": true});
    let a = s.execute("stlout", &base).unwrap();
    let mut q = base.clone();
    q["shrink"] = json!(2.5);
    let b = s.execute("stlout", &q).unwrap();
    assert_eq!(a["triangles"], b["triangles"]);
    assert_eq!(a["metal"], b["metal"], "the weight is the drawn piece's");
    assert_eq!(b["shrink"], json!(2.5));
    let (sa, sb) = (stl_of(&a), stl_of(&b));
    let (la, ha) = bbox(&sa);
    let (lb, hb) = bbox(&sb);
    for (x, y) in [(la.x, lb.x), (la.y, lb.y), (la.z, lb.z), (ha.x, hb.x), (ha.y, hb.y), (ha.z, hb.z)] {
        assert!((y - x * 1.025).abs() < 1e-4, "{x} × 1.025 vs {y}");
    }
    assert!((sb.volume() / sa.volume() - 1.025f64.powi(3)).abs() < 1e-4);
    assert!(b["notes"].to_string().contains("shrinkage"), "{}", b["notes"]);
    for bad in [json!(-1), json!(10.5), json!("2%"), json!(true)] {
        let e = s.execute("stlout", &json!({"kind": "band", "shrink": bad})).unwrap_err().to_string();
        assert!(e.contains("shrink"), "{bad}: {e}");
    }
}

/// The display mesh's notes describe the display mesh, and STLOUT's describe the merged solid.
#[test]
fn the_notes_say_what_each_mesh_is() {
    let mut s = Session::new();
    for kind in ["solitaire", "eternity", "halfeternity"] {
        let m = s.execute("piecemesh", &json!({"kind": kind})).unwrap();
        let notes = m["notes"].to_string();
        assert!(notes.contains("This view draws") && notes.contains("STLOUT writes the metal as one merged closed solid"), "{kind}: {notes}");
        assert!(!notes.contains("slicer"), "{kind}: {notes}");
        let r = s.execute("stlout", &json!({"kind": kind, "quality": "draft"})).unwrap();
        let notes = r["notes"].to_string();
        assert!(!notes.contains("This view draws") && notes.contains("one closed shell with a seat cut"), "{kind}: {notes}");
    }
}
