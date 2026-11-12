//! The piece as a solid: every shell closed and facing outward, the band's volume the analytic
//! one, the reply inside its limits, the STL well formed, and hostile input refused.

use std::collections::HashMap;

use cadcraft_geom::{PI, Vec3};
use serde_json::{Value, json};

use super::gem;
use super::mesh::*;
use super::piece_params::{PieceKind, PieceParams};
use crate::Session;
use crate::cmd::file::base64_decode;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap()
}

/// A part's vertices as the reply rounds them.
fn rounded(m: &PartMesh) -> Vec<Vec3> {
    m.positions.iter().map(|p| Vec3::new(r3(p.x), r3(p.y), r3(p.z))).collect()
}

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// The part's closed shells, each as its triangles' indices.
fn shells(m: &PartMesh) -> Vec<Vec<u32>> {
    let mut parent: Vec<usize> = (0..m.positions.len()).collect();
    for t in m.indices.chunks_exact(3) {
        let a = find(&mut parent, t[0] as usize);
        for v in &t[1..] {
            let b = find(&mut parent, *v as usize);
            parent[b] = a;
        }
    }
    let mut by_root: HashMap<usize, Vec<u32>> = HashMap::new();
    for t in m.indices.chunks_exact(3) {
        by_root.entry(find(&mut parent, t[0] as usize)).or_default().extend_from_slice(t);
    }
    by_root.into_values().collect()
}

/// Everything a mesh must be: indices in range, no NaN, every edge shared by exactly two
/// triangles running opposite ways, and every shell enclosing a positive volume. With `strict`,
/// no triangle is degenerate once rounded to the reply's three decimals.
fn check(mesh: &PieceMesh, strict: bool, what: &str) {
    assert!(!mesh.meshes.is_empty(), "{what}: no meshes");
    assert!(mesh.triangles() <= MAX_TRIANGLES, "{what}: {} triangles", mesh.triangles());
    for m in &mesh.meshes {
        let what = format!("{what}/{}", m.name);
        assert!(m.part == "metal" || m.part == "stone", "{what}: part {}", m.part);
        assert_eq!(m.indices.len() % 3, 0, "{what}");
        assert!(!m.indices.is_empty(), "{what}: empty");
        assert!(m.positions.iter().all(|p| p.is_finite()), "{what}: a position is not finite");
        assert!(m.indices.iter().all(|i| (*i as usize) < m.positions.len()), "{what}: an index is out of range");
        let pos = rounded(m);
        let mut edges: HashMap<(u32, u32), u32> = HashMap::new();
        for t in m.indices.chunks_exact(3) {
            assert!(t[0] != t[1] && t[1] != t[2] && t[0] != t[2], "{what}: a triangle repeats a vertex");
            if strict {
                let (a, b, c) = (pos[t[0] as usize], pos[t[1] as usize], pos[t[2] as usize]);
                assert!((b - a).cross(c - a).len() > 1e-7, "{what}: a triangle has no area: {a:?} {b:?} {c:?}");
            }
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                *edges.entry((a, b)).or_default() += 1;
            }
        }
        for ((a, b), n) in &edges {
            assert_eq!(*n, 1, "{what}: the edge {a}→{b} is used {n} times in one direction");
            assert_eq!(edges.get(&(*b, *a)), Some(&1), "{what}: the edge {a}→{b} has no opposite");
        }
        for shell in shells(m) {
            let v = signed_volume(&m.positions, &shell);
            assert!(v > 0.0, "{what}: a shell of {} triangles faces inward (volume {v})", shell.len() / 3);
        }
    }
}

fn part<'a>(mesh: &'a PieceMesh, name: &str) -> &'a PartMesh {
    mesh.meshes.iter().find(|m| m.name == name).unwrap_or_else(|| panic!("no part named {name}"))
}

fn extent(m: &PartMesh, axis: usize) -> (f64, f64) {
    let get = |p: &Vec3| [p.x, p.y, p.z][axis];
    (m.positions.iter().map(get).fold(f64::INFINITY, f64::min), m.positions.iter().map(get).fold(f64::NEG_INFINITY, f64::max))
}

fn has_note(notes: &Value, word: &str) -> bool {
    notes.as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains(word))
}

// ---------------------------------------------------------------- shells

#[test]
fn every_kind_and_profile_is_closed_and_faces_outward() {
    for kind in ["band", "solitaire", "eternity"] {
        for profile in ["flat", "dome"] {
            for quality in [Quality::Draft, Quality::Fine] {
                let p = params(json!({"kind": kind, "profile": profile}));
                let mesh = piece_mesh(&p, quality);
                check(&mesh, true, &format!("{kind} {profile} {quality:?}"));
                assert!(!mesh.over);
            }
        }
    }
}

#[test]
fn every_cut_makes_a_closed_solitaire() {
    for cut in gem::CUTS {
        for (length, width) in [(6.5, 6.5), (8.0, 6.0), (10.0, 5.0)] {
            for halo in [json!(false), json!(true), json!(2.0)] {
                for quality in [Quality::Draft, Quality::Fine] {
                    let p =
                        params(json!({"kind": "solitaire", "cut": cut.name, "stoneLength": length, "stoneWidth": width, "halo": halo, "prongs": 4}));
                    let mesh = piece_mesh(&p, quality);
                    check(&mesh, true, &format!("{} {length}×{width} halo {halo} {quality:?}", cut.name));
                    assert_eq!(shells(part(&mesh, "centre stone")).len(), 1, "{}: the stone is one shell", cut.name);
                    assert_eq!(shells(part(&mesh, "prongs")).len(), 4, "{}: four prongs", cut.name);
                    assert!(!mesh.notes.iter().any(|n| n.contains("no usable girdle")), "{}: {:?}", cut.name, mesh.notes);
                }
            }
        }
    }
}

#[test]
fn a_solitaire_has_its_parts_where_the_contract_puts_them() {
    let p = params(json!({"kind": "solitaire", "prongs": 6, "halo": true}));
    let mesh = piece_mesh(&p, Quality::Draft);
    let names: Vec<&str> = mesh.meshes.iter().map(|m| m.name).collect();
    assert_eq!(names, ["band", "head", "prongs", "halo seat", "centre stone", "melee"]);
    assert_eq!(shells(part(&mesh, "prongs")).len(), 6, "one closed shell to a prong");
    assert_eq!(shells(part(&mesh, "head")).len(), 1);
    let halo = shells(part(&mesh, "melee")).len();
    assert_eq!(mesh.stones as usize, 1 + halo);
    // floor(π · (6.5 + 1.3 + 2 × 0.2) / (1.3 + 0.2)) = 17, less the chords' shortfall.
    assert!((16..=17).contains(&halo), "a 6.5 mm round takes {halo} melee of 1.3 mm");
    // The head is at +Y, centred on the finger's axis, and the stone is as deep as the cut says.
    let stone = part(&mesh, "centre stone");
    let outer = p.outer() / 2.0;
    let (y0, y1) = extent(stone, 1);
    let depth = gem::default_depth(gem::cut_of("round").unwrap(), 6.5);
    assert!((y1 - y0 - depth).abs() < 1e-9, "the stone is {} deep, not {depth}", y1 - y0);
    assert!(y0 > outer, "the culet stands clear of the band");
    for axis in [0, 2] {
        let (lo, hi) = extent(stone, axis);
        assert!((lo + 3.25).abs() < 1e-9 && (hi - 3.25).abs() < 1e-9, "the girdle is 6.5 mm across axis {axis}: {lo}..{hi}");
    }
    // A round brilliant: an eight-sided table on top, 57 % of the diameter corner to corner.
    let table: Vec<&Vec3> = stone.positions.iter().filter(|q| (q.y - y1).abs() < 1e-9).collect();
    assert_eq!(table.len(), 8);
    assert!(table.iter().all(|q| (q.x.hypot(q.z) - ROUND_TABLE * 3.25).abs() < 1e-9));
    // No metal reaches into the finger.
    let inner = p.inner() / 2.0;
    for m in mesh.meshes.iter().filter(|m| m.part == "metal") {
        assert!(m.positions.iter().all(|q| q.x.hypot(q.y) >= inner - 1e-9), "{} reaches into the finger", m.name);
    }
    // The stone's length runs along the finger.
    let oval = piece_mesh(&params(json!({"kind": "solitaire", "cut": "oval", "stoneLength": 9, "stoneWidth": 6})), Quality::Draft);
    let (z0, z1) = extent(part(&oval, "centre stone"), 2);
    let (x0, x1) = extent(part(&oval, "centre stone"), 0);
    assert!((z1 - z0 - 9.0).abs() < 1e-6 && (x1 - x0 - 6.0).abs() < 1e-6, "{}×{}", z1 - z0, x1 - x0);
}

#[test]
fn an_eternity_band_carries_the_number_that_fits() {
    // n = floor(π · outside diameter / (melee + gap)).
    let p = params(json!({"kind": "eternity", "size": 6, "wall": 1.8, "melee": 1.8, "gap": 0.2}));
    let expected = (PI * (p.size.diameter + 3.6) / 2.0).floor() as u32;
    assert_eq!(eternity_count(&p), expected);
    assert_eq!(expected, 31, "a size 6 band with a 1.8 mm wall takes 31 stones of 1.8 mm at 0.2 mm");
    let mesh = piece_mesh(&p, Quality::Draft);
    assert_eq!(mesh.stones, expected);
    assert_eq!(shells(part(&mesh, "melee")).len(), expected as usize);
    assert_eq!(shells(part(&mesh, "beads")).len(), 2 * expected as usize, "two beads between neighbours");
    let inner = p.inner() / 2.0;
    assert!(part(&mesh, "beads").positions.iter().all(|q| q.x.hypot(q.y) >= inner), "no bead reaches into the finger");
    // A given count is taken as given.
    let p = params(json!({"kind": "eternity", "count": 20}));
    assert_eq!(eternity_count(&p), 20);
    let mesh = piece_mesh(&p, Quality::Draft);
    assert_eq!(shells(part(&mesh, "melee")).len(), 20);
    // The tables face outward: the first stone is at 12 o'clock, its table the highest thing.
    let (_, top) = extent(part(&mesh, "melee"), 1);
    let depth = gem::default_depth(gem::cut_of("round").unwrap(), 1.8);
    let want = p.outer() / 2.0 + 0.08 * 1.8 + (GIRDLE / 2.0 + CROWN) * depth;
    assert!((top - want).abs() < 1e-9, "table at {top}, not {want}");
    let (lo, hi) = mesh.bounds();
    assert_eq!(hi[1], r3(want));
    assert!(lo[1] < -p.outer() / 2.0, "a stone at 6 o'clock too");
    // More stones than fit are shown, and said to overlap.
    let crowded = piece_mesh(&params(json!({"kind": "eternity", "count": 60})), Quality::Draft);
    assert!(crowded.notes.iter().any(|n| n.contains("overlap")), "{:?}", crowded.notes);
    check(&crowded, true, "crowded");
}

// ---------------------------------------------------------------- volume and weight

#[test]
fn the_band_is_the_analytic_volume() {
    for (size, wall, width) in [(6.0, 1.8, 2.2), (3.0, 0.8, 1.5), (13.0, 3.0, 8.0)] {
        let p = params(json!({"kind": "band", "size": size, "wall": wall, "width": width}));
        let (r, big) = (p.inner() / 2.0, p.outer() / 2.0);
        let flat = PI * (big * big - r * r) * width;
        // Pappus: the half-ellipse's area times the path of its centroid.
        let dome = 2.0 * PI * (r + 4.0 * wall / (3.0 * PI)) * (PI * (width / 2.0) * wall / 2.0);
        for (profile, exact, draft_tol, fine_tol) in [("flat", flat, 1e-3, 2.5e-4), ("dome", dome, 8e-3, 2.5e-3)] {
            let p = params(json!({"kind": "band", "size": size, "wall": wall, "width": width, "profile": profile}));
            let draft = piece_mesh(&p, Quality::Draft).metal_volume();
            let fine = piece_mesh(&p, Quality::Fine).metal_volume();
            let (ed, ef) = ((draft - exact).abs() / exact, (fine - exact).abs() / exact);
            println!(
                "band size {size} wall {wall} width {width} {profile}: exact {exact:.4} mm³, draft {draft:.4} ({:.4} %), fine {fine:.4} ({:.4} %)",
                ed * 100.0,
                ef * 100.0
            );
            assert!(ed < draft_tol, "{profile} draft: {draft} against {exact} ({ed})");
            assert!(ef < fine_tol, "{profile} fine: {fine} against {exact} ({ef})");
            assert!(ef < ed, "fine is closer than draft");
            assert!(draft < exact && fine < exact, "an inscribed mesh is never more than the solid");
        }
    }
}

#[test]
fn the_mesh_weighs_what_ring_weighs() {
    let mut s = Session::new();
    let ring = s.execute("ring", &json!({"at": [0, 0], "size": 6, "wall": 1.8, "width": 2.2, "gap": 0, "metal": "gold18"})).unwrap();
    let grams = ring["weight"]["grams"].as_f64().unwrap();
    for (quality, tol) in [("draft", 0.01), ("fine", 0.001)] {
        let r =
            s.execute("piecemesh", &json!({"kind": "band", "size": 6, "wall": 1.8, "width": 2.2, "metal": "gold18", "quality": quality})).unwrap();
        let mesh = r["metal"]["grams"].as_f64().unwrap();
        println!("RING {grams} g, PIECEMESH {quality} {mesh} g ({:.4} %)", (mesh - grams).abs() / grams * 100.0);
        assert!((mesh - grams).abs() / grams < tol, "{quality}: {mesh} g against RING's {grams} g");
        assert_eq!(r["metal"]["density"], json!(15.5));
    }
}

// ---------------------------------------------------------------- the reply

#[test]
fn bounds_are_the_true_extents() {
    for profile in ["flat", "dome"] {
        for quality in ["draft", "fine"] {
            let mut s = Session::new();
            let r = s
                .execute("piecemesh", &json!({"kind": "band", "size": 6, "wall": 1.8, "width": 2.2, "profile": profile, "quality": quality}))
                .unwrap();
            let size = params(json!({"kind": "band", "size": 6}));
            let outer = r3(size.inner() / 2.0 + 1.8);
            assert_eq!(r["bounds"]["min"], json!([-outer, -outer, -1.1]), "{profile} {quality}");
            assert_eq!(r["bounds"]["max"], json!([outer, outer, 1.1]), "{profile} {quality}");
            // The inside is the finger: no vertex nearer the axis than the size's radius.
            let pos: Vec<f64> = r["meshes"][0]["positions"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
            let nearest = pos.chunks_exact(3).map(|q| q[0].hypot(q[1])).fold(f64::INFINITY, f64::min);
            assert!((nearest - size.inner() / 2.0).abs() < 1e-3, "{nearest}");
        }
    }
    // A solitaire's top is its stone's table or its prongs' tips, whichever is higher.
    let p = params(json!({"kind": "solitaire"}));
    let mesh = piece_mesh(&p, Quality::Fine);
    let (lo, hi) = mesh.bounds();
    let (_, table) = extent(part(&mesh, "centre stone"), 1);
    let (_, tips) = extent(part(&mesh, "prongs"), 1);
    assert_eq!(hi[1], r3(table.max(tips)));
    assert_eq!(lo[1], r3(-p.outer() / 2.0));
    let depth = gem::default_depth(gem::cut_of("round").unwrap(), 6.5);
    let (g, hc, hp) = proportions(depth);
    assert!((table - (p.outer() / 2.0 + CULET_CLEARANCE + hp + g + hc)).abs() < 1e-9);
    assert!((g + hc + hp - depth).abs() < 1e-12);
}

#[test]
fn the_reply_is_what_the_viewport_reads() {
    let mut s = Session::new();
    let before = s.doc().unwrap().model.len();
    let r = s.execute("piecemesh", &json!({"kind": "solitaire", "size": 6, "wall": 1.8, "metal": "platinum", "stone": "sapphire"})).unwrap();
    assert_eq!(s.doc().unwrap().model.len(), before, "the drawing is not touched");
    let meshes = r["meshes"].as_array().unwrap();
    let mut total = 0;
    for m in meshes {
        assert!(matches!(m["part"].as_str(), Some("metal" | "stone")));
        assert!(m["name"].is_string());
        let color = m["color"].as_array().unwrap();
        assert!(color.len() == 3 && color.iter().all(|c| c.as_u64().is_some_and(|c| c <= 255)));
        let positions = m["positions"].as_array().unwrap();
        let indices = m["indices"].as_array().unwrap();
        assert!(positions.len() % 3 == 0 && indices.len() % 3 == 0);
        for v in positions {
            let x = v.as_f64().expect("a number, never null");
            assert!((x * 1000.0 - (x * 1000.0).round()).abs() < 1e-6, "{x} is not rounded to three decimals");
        }
        assert!(indices.iter().all(|i| (i.as_u64().unwrap() as usize) < positions.len() / 3));
        total += indices.len() / 3;
    }
    assert_eq!(r["triangles"], json!(total));
    assert_eq!(meshes[0]["name"], "band");
    assert_eq!(meshes[0]["color"], json!(metal_color("platinum")));
    assert_eq!(meshes.last().unwrap()["color"], json!(stone_color("sapphire")));
    assert_ne!(metal_color("gold18"), metal_color("platinum"));
    assert_eq!(r["size"]["us"], json!(6.0));
    assert_eq!(r["size"]["eu"], json!(52));
    assert_eq!(r["quality"], "draft");
    assert_eq!(r["kind"], "solitaire");
    assert_eq!(r["stones"], json!(1));
    assert!(has_note(&r["notes"], "separate closed shells"));
    // The parameters come back complete, and build the same piece again.
    let again = s.execute("piecemesh", &r["params"]).unwrap();
    assert_eq!(again["meshes"], r["meshes"]);
    // Fine is finer.
    let fine = s.execute("piecemesh", &json!({"kind": "solitaire", "quality": "fine"})).unwrap();
    assert!(fine["triangles"].as_u64() > r["triangles"].as_u64());
    assert_eq!(fine["quality"], "fine");
    // Neither command is undoable, and neither needs a drawing.
    for id in ["piecemesh", "stlout"] {
        let specs = crate::command_specs();
        let spec = specs.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} is registered"));
        assert!(!spec.undoable, "{id}");
        assert!((spec.enabled)(&s).is_ok());
    }
}

#[test]
fn no_kind_says_there_is_no_piece() {
    let mut s = Session::new();
    for cmd in ["piecemesh", "stlout"] {
        for p in [json!({}), json!(null), json!({"size": 6}), json!({"kind": null}), json!({"kind": 3})] {
            let e = s.execute(cmd, &p).unwrap_err().to_string();
            assert!(e.contains("no piece to show"), "{cmd} {p}: {e}");
        }
    }
}

#[test]
fn the_cap_holds_for_the_largest_piece() {
    let mut s = Session::new();
    let largest = [
        json!({"kind": "eternity", "count": 400, "quality": "fine", "profile": "dome"}),
        json!({"kind": "eternity", "count": 400, "quality": "fine", "size": 16, "wall": 10, "width": 30, "melee": 6, "profile": "dome"}),
        json!({"kind": "eternity", "count": 400, "quality": "draft", "size": 16, "melee": 0.8}),
        json!({"kind": "solitaire", "quality": "fine", "cut": "oval", "stoneLength": 30, "stoneWidth": 30, "halo": 0.8, "gap": 0, "prongs": 8, "size": 16, "profile": "dome"}),
        json!({"kind": "solitaire", "quality": "fine", "cut": "cushion", "stoneLength": 30, "stoneWidth": 30, "halo": 0.8, "gap": 0, "prongs": 8}),
    ];
    for p in largest {
        let r = s.execute("piecemesh", &p).unwrap();
        let triangles = r["triangles"].as_u64().unwrap() as usize;
        let bytes = serde_json::to_string(&r).unwrap().len();
        println!("{} {} stones: {triangles} triangles, {bytes} bytes of JSON, level {}", r["kind"], r["stones"], r["level"]);
        assert!(triangles <= MAX_TRIANGLES, "{triangles} triangles");
        assert!(bytes < 4_000_000, "{bytes} bytes");
        let pp = PieceParams::parse("test", &p).unwrap();
        let quality = if p["quality"] == "fine" { Quality::Fine } else { Quality::Draft };
        let mesh = piece_mesh(&pp, quality);
        // Coarser, never cut short: every shell is still whole.
        check(&mesh, false, "largest");
        assert!(!mesh.over);
        assert_eq!(mesh.triangles(), triangles);
        if r["level"].as_u64() != Some(if quality == Quality::Fine { 0 } else { 1 }) {
            assert!(has_note(&r["notes"], "coarsely"), "{}", r["notes"]);
        }
    }
    // 400 stones do not fit at fine quality, and the reply says so.
    let r = s.execute("piecemesh", &json!({"kind": "eternity", "count": 400, "quality": "fine"})).unwrap();
    assert_eq!(r["stones"], json!(400));
    assert!(r["level"].as_u64().unwrap() >= 1);
    assert!(has_note(&r["notes"], "coarsely"));
}

#[test]
fn the_usual_pieces_are_small() {
    // The numbers the report quotes: a default band, solitaire and a 20-stone eternity band.
    let mut s = Session::new();
    for p in
        [json!({"kind": "band"}), json!({"kind": "band", "profile": "dome"}), json!({"kind": "solitaire"}), json!({"kind": "eternity", "count": 20})]
    {
        for quality in ["draft", "fine"] {
            let mut q = p.clone();
            q["quality"] = json!(quality);
            let r = s.execute("piecemesh", &q).unwrap();
            let bytes = serde_json::to_string(&r).unwrap().len();
            println!("{p} {quality}: {} triangles, {bytes} bytes of JSON, metal {} g", r["triangles"], r["metal"]["grams"]);
            assert_eq!(r["level"], json!(if quality == "fine" { 0 } else { 1 }), "no reduction for an ordinary piece");
            assert!(bytes < 600_000);
        }
    }
}

// ---------------------------------------------------------------- STL

/// A binary STL read back: the normal and three vertices of each triangle.
fn read_stl(bytes: &[u8]) -> Vec<[[f32; 3]; 4]> {
    assert!(bytes.len() >= 84);
    assert!(!bytes.starts_with(b"solid"), "a binary STL must not begin with `solid`");
    let n = u32::from_le_bytes(bytes[80..84].try_into().unwrap()) as usize;
    assert_eq!(bytes.len(), 84 + 50 * n, "84 + 50·n bytes");
    let f = |at: usize| f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    (0..n)
        .map(|i| {
            let base = 84 + 50 * i;
            assert_eq!(&bytes[base + 48..base + 50], &[0, 0], "the attribute word is zero");
            let mut t = [[0f32; 3]; 4];
            for (v, row) in t.iter_mut().enumerate() {
                for (c, slot) in row.iter_mut().enumerate() {
                    *slot = f(base + 12 * v + 4 * c);
                }
            }
            t
        })
        .collect()
}

#[test]
fn a_binary_stl_is_84_plus_50_bytes_a_triangle_and_reads_back() {
    let mut s = Session::new();
    for (p, stones) in [
        (json!({"kind": "band"}), false),
        (json!({"kind": "band", "profile": "dome", "quality": "draft"}), false),
        (json!({"kind": "solitaire", "halo": true}), false),
        (json!({"kind": "solitaire", "halo": true, "stones": true}), true),
        (json!({"kind": "eternity", "count": 20, "stones": true, "quality": "draft"}), true),
    ] {
        let r = s.execute("stlout", &p).unwrap();
        assert_eq!(r["format"], "stl-binary");
        let bytes = base64_decode(r["base64"].as_str().unwrap()).unwrap();
        let n = r["triangles"].as_u64().unwrap() as usize;
        assert_eq!(bytes.len(), 84 + 50 * n);
        assert_eq!(r["bytes"], json!(bytes.len()));
        assert!(r.get("text").is_none());
        let tris = read_stl(&bytes);
        assert_eq!(tris.len(), n);
        // The same triangles the mesh has: the metal, and the stones only when asked.
        let pp = PieceParams::parse("test", &p).unwrap();
        let quality = if p["quality"] == "draft" { Quality::Draft } else { Quality::Fine };
        let mesh = piece_mesh(&pp, quality);
        let want: usize = mesh.meshes.iter().filter(|m| stones || m.part == "metal").map(PartMesh::triangles).sum();
        assert_eq!(n, want, "{p}");
        let mut six = 0.0f64;
        for [normal, a, b, c] in &tris {
            let v = |q: &[f32; 3]| Vec3::new(f64::from(q[0]), f64::from(q[1]), f64::from(q[2]));
            let len = v(normal).len();
            assert!((len - 1.0).abs() < 1e-4, "a normal of length {len}");
            six += v(a).dot(v(b).cross(v(c)));
        }
        if !stones {
            assert!((six / 6.0 - mesh.metal_volume()).abs() / mesh.metal_volume() < 1e-4, "the STL encloses the metal's volume");
        }
        assert!(r["name"].as_str().unwrap().ends_with("-us6-gold18.stl"), "{}", r["name"]);
        assert_eq!(r["quality"], quality.name());
        assert!(has_note(&r["notes"], if stones { "stones are included" } else { "metal only" }));
    }
    // The normals are the triangles' own, by the right-hand rule (checked where no triangle is a sliver).
    let r = s.execute("stlout", &json!({"kind": "band", "profile": "dome"})).unwrap();
    for [normal, a, b, c] in read_stl(&base64_decode(r["base64"].as_str().unwrap()).unwrap()) {
        let v = |q: [f32; 3]| Vec3::new(f64::from(q[0]), f64::from(q[1]), f64::from(q[2]));
        assert!((v(b) - v(a)).cross(v(c) - v(a)).normalized().dot(v(normal)) > 0.99, "a normal does not follow the winding");
    }
    assert_eq!(s.execute("stlout", &json!({"kind": "solitaire", "metal": "platinum", "size": 7.5})).unwrap()["name"], "solitaire-us7.5-platinum.stl");
    assert!(has_note(&s.execute("stlout", &json!({"kind": "band", "wall": 0.5})).unwrap()["notes"], "thinner than a bench casts"));
}

#[test]
fn an_ascii_stl_begins_solid_and_ends_endsolid() {
    let mut s = Session::new();
    let r = s.execute("stlout", &json!({"kind": "solitaire", "binary": false, "quality": "draft"})).unwrap();
    assert_eq!(r["format"], "stl-ascii");
    assert!(r.get("base64").is_none());
    let text = r["text"].as_str().unwrap();
    assert!(text.starts_with("solid "));
    assert!(text.trim_end().lines().last().unwrap().starts_with("endsolid"));
    assert_eq!(r["bytes"], json!(text.len()));
    let n = r["triangles"].as_u64().unwrap() as usize;
    assert_eq!(text.matches("facet normal").count(), n);
    assert_eq!(text.matches("endfacet").count(), n);
    assert_eq!(text.matches("vertex").count(), 3 * n);
    assert!(!text.contains("NaN") && !text.contains("inf"));
    // Too large for text is refused, with the way out.
    let e = s.execute("stlout", &json!({"kind": "eternity", "count": 400, "stones": true, "binary": false})).unwrap_err().to_string();
    assert!(e.contains("binary"), "{e}");
    // The metal alone of the same ring is small enough at a coarser level.
    let r = s.execute("stlout", &json!({"kind": "eternity", "count": 400, "binary": false})).unwrap();
    assert!(r["triangles"].as_u64().unwrap() <= 30_000);
    assert!(has_note(&r["notes"], "coarsely"));
}

#[test]
fn an_stl_written_to_disk_is_the_size_it_says() {
    let mut s = Session::new();
    let r = s.execute("stlout", &json!({"kind": "solitaire", "halo": true})).unwrap();
    let bytes = base64_decode(r["base64"].as_str().unwrap()).unwrap();
    let path = std::env::temp_dir().join(format!("cadcraft-stlout-test-{}.stl", std::process::id()));
    std::fs::write(&path, &bytes).unwrap();
    let read = std::fs::read(&path).unwrap();
    let _ = std::fs::remove_file(&path);
    let n = r["triangles"].as_u64().unwrap() as usize;
    println!("{}: {} bytes on disk, {n} triangles", r["name"], read.len());
    assert_eq!(read.len(), 84 + 50 * n);
    assert_eq!(read_stl(&read).len(), n);
}

// ---------------------------------------------------------------- hostile input

#[test]
fn hostile_input_is_refused_or_handled_and_never_nan() {
    let mut s = Session::new();
    let refused = [
        json!({"kind": "tiara"}),
        json!({"kind": "band", "size": 1e308}),
        json!({"kind": "band", "size": -6}),
        json!({"kind": "band", "size": "huge"}),
        json!({"kind": "band", "wall": 1e308}),
        json!({"kind": "band", "wall": -1}),
        json!({"kind": "band", "wall": 0}),
        json!({"kind": "band", "width": "wide"}),
        json!({"kind": "band", "width": [2]}),
        json!({"kind": "band", "profile": "knife"}),
        json!({"kind": "band", "metal": "unobtainium"}),
        json!({"kind": "band", "quality": "ultra"}),
        json!({"kind": "band", "quality": 7}),
        json!({"kind": "solitaire", "cut": "pyramid"}),
        json!({"kind": "solitaire", "stone": "kryptonite"}),
        json!({"kind": "solitaire", "stoneWidth": 0}),
        json!({"kind": "solitaire", "stoneWidth": -6.5}),
        json!({"kind": "solitaire", "stoneLength": 1e308}),
        json!({"kind": "solitaire", "prongs": 0}),
        json!({"kind": "solitaire", "prongs": 1e9}),
        json!({"kind": "solitaire", "prongs": 4.5}),
        json!({"kind": "solitaire", "halo": -1}),
        json!({"kind": "solitaire", "halo": 1e308}),
        json!({"kind": "eternity", "melee": 0}),
        json!({"kind": "eternity", "count": 0}),
        json!({"kind": "eternity", "count": 401}),
        json!({"kind": "eternity", "count": -3}),
        json!({"kind": "eternity", "count": 1e308}),
        json!({"kind": "eternity", "gap": -0.1}),
        json!({"kind": "eternity", "gap": 1e308}),
        json!([]),
        json!("solitaire"),
    ];
    for p in &refused {
        for cmd in ["piecemesh", "stlout"] {
            assert!(s.execute(cmd, p).is_err(), "{cmd} {p} should be refused");
        }
    }
    // The edges of what is allowed, and shapes a cut does not usually take: built, closed, finite.
    let mut handled = vec![
        json!({"kind": "band", "size": 0, "wall": 0.3, "width": 0.5}),
        json!({"kind": "band", "size": 16, "wall": 10, "width": 30, "profile": "dome"}),
        json!({"kind": "band", "wall": 0.3, "width": 30, "profile": "dome"}),
        json!({"kind": "eternity", "melee": 6, "wall": 0.3, "width": 0.5, "count": 400, "gap": 5}),
        json!({"kind": "eternity", "melee": 0.8, "count": 1}),
        json!({"kind": "eternity", "melee": 6, "gap": 5, "size": 0}),
        json!({"kind": "eternity", "melee": 0.8, "gap": 0, "size": 16, "wall": 10}),
        json!({"kind": "eternity", "count": 2, "profile": "dome"}),
        json!({"kind": "solitaire", "stoneWidth": 0.5, "halo": 3, "wall": 0.3, "width": 0.5, "prongs": 8}),
        json!({"kind": "solitaire", "stoneWidth": 30, "stoneLength": 30, "wall": 0.3, "width": 0.5, "size": 0, "prongs": 3}),
    ];
    for cut in gem::CUTS {
        for (length, width) in [(0.5, 0.5), (30.0, 0.5), (0.5, 30.0), (30.0, 30.0), (0.51, 0.5)] {
            handled
                .push(json!({"kind": "solitaire", "cut": cut.name, "stoneLength": length, "stoneWidth": width, "halo": 0.8, "gap": 0, "prongs": 8}));
        }
    }
    for p in &handled {
        let pp = PieceParams::parse("test", p).unwrap_or_else(|e| panic!("{p}: {e}"));
        for quality in [Quality::Draft, Quality::Fine] {
            check(&piece_mesh(&pp, quality), false, &p.to_string());
        }
        let r = s.execute("piecemesh", p).unwrap();
        for m in r["meshes"].as_array().unwrap() {
            assert!(m["positions"].as_array().unwrap().iter().all(|v| v.as_f64().is_some_and(f64::is_finite)), "{p}: a position is not a number");
        }
        let (lo, hi) = (&r["bounds"]["min"], &r["bounds"]["max"]);
        for axis in 0..3 {
            let (a, b) = (lo[axis].as_f64().unwrap(), hi[axis].as_f64().unwrap());
            assert!(a.is_finite() && b.is_finite() && a < b && b - a < 200.0, "{p}: bounds {a}..{b}");
        }
        assert!(r["metal"]["grams"].as_f64().is_some_and(|g| g.is_finite() && g > 0.0), "{p}");
        let mut q = p.clone();
        q["stones"] = json!(true);
        q["quality"] = json!("draft");
        let stl = s.execute("stlout", &q).unwrap();
        assert_eq!(base64_decode(stl["base64"].as_str().unwrap()).unwrap().len(), 84 + 50 * stl["triangles"].as_u64().unwrap() as usize);
    }
    // Parameters that never went through the parser (NaN, infinities, nonsense counts) still
    // make a finite, closed solid.
    let mut wild = params(json!({"kind": "solitaire", "halo": true}));
    wild.wall = f64::NAN;
    wild.width = f64::INFINITY;
    wild.stone_width = -4.0;
    wild.stone_length = f64::NAN;
    wild.halo = Some(f64::NAN);
    wild.prongs = u32::MAX;
    wild.melee = f64::NEG_INFINITY;
    wild.gap = f64::NAN;
    wild.cut = "no such cut".to_string();
    check(&piece_mesh(&wild, Quality::Fine), false, "wild solitaire");
    wild.kind = PieceKind::Eternity;
    wild.count = Some(u32::MAX);
    let mesh = piece_mesh(&wild, Quality::Fine);
    check(&mesh, false, "wild eternity");
    assert!(mesh.stones <= 400);
    wild.count = None;
    wild.melee = 1e-300;
    wild.gap = 0.0;
    assert!(eternity_count(&wild) <= 400);
    check(&piece_mesh(&wild, Quality::Draft), false, "wild eternity, no count");
}
