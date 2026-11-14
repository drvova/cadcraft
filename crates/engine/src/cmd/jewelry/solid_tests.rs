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
