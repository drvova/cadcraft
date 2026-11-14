//! Known-answer, hostile-input and property tests for SubD (cage, subdivision, limit, edits).

use crate::subd_edit::*;
use crate::*;
use std::collections::{BTreeMap, BTreeSet, HashMap};

fn v(x: f64, y: f64, z: f64) -> Vec3 {
    Vec3::new(x, y, z)
}

fn dist(a: Vec3, b: Vec3) -> f64 {
    (a - b).len()
}

/// Every directed triangle edge appears once and its reverse once: watertight and oriented.
fn assert_watertight(m: &SubdMesh) {
    let mut d: HashMap<(u32, u32), u32> = HashMap::new();
    for t in m.indices.chunks(3) {
        for i in 0..3 {
            *d.entry((t[i], t[(i + 1) % 3])).or_insert(0) += 1;
        }
    }
    for (&(a, b), &n) in &d {
        assert_eq!(n, 1, "directed edge {a}-{b} used {n} times");
        assert_eq!(d.get(&(b, a)), Some(&1), "edge {a}-{b} has no opposite");
    }
}

fn assert_valid_closed(c: &SubdCage) {
    assert!(c.is_closed());
    assert!(c.positions().iter().all(|p| p.is_finite()));
}

// ---------- cage validation ----------

#[test]
fn box_cage_is_valid_closed_sphere() {
    let c = box_cage(2.0, 2.0, 2.0).unwrap();
    assert_eq!((c.vertex_count(), c.edge_count(), c.face_count()), (8, 12, 6));
    assert!(c.is_closed());
    assert_eq!(c.euler(), 2);
    assert!((0..8).all(|i| c.valence(i) == 3));
    assert!(c.find_edge(0, 1).is_some() && c.find_edge(0, 7).is_none());
}

#[test]
fn hostile_cages_are_refused() {
    let quad = || vec![v(0., 0., 0.), v(1., 0., 0.), v(1., 1., 0.), v(0., 1., 0.)];
    assert_eq!(SubdCage::new(quad(), &[]).unwrap_err(), SubdError::Empty);
    assert!(matches!(SubdCage::new(quad(), &[vec![0, 1]]), Err(SubdError::BadFace(0))));
    assert!(matches!(SubdCage::new(quad(), &[vec![0, 1, 1, 2]]), Err(SubdError::BadFace(0))));
    assert!(matches!(SubdCage::new(quad(), &[vec![0, 1, 9]]), Err(SubdError::BadFace(0))));
    assert!(matches!(SubdCage::new(quad(), &[vec![0, 1, 2]]), Err(SubdError::UnusedVertex(3))));
    let mut nan = quad();
    nan[2].x = f64::NAN;
    assert!(matches!(SubdCage::new(nan, &[vec![0, 1, 2, 3]]), Err(SubdError::NonFinite(_))));
    // Zero area: collinear.
    let line = vec![v(0., 0., 0.), v(1., 0., 0.), v(2., 0., 0.), v(5., 5., 5.)];
    assert!(matches!(SubdCage::new(line, &[vec![0, 1, 2], vec![0, 2, 3]]), Err(SubdError::Degenerate(0))));
    // Two faces running an edge the same way (inconsistent orientation).
    let p = vec![v(0., 0., 0.), v(1., 0., 0.), v(0., 1., 0.), v(0., -1., 0.)];
    assert!(matches!(SubdCage::new(p.clone(), &[vec![0, 1, 2], vec![0, 1, 3]]), Err(SubdError::NonManifoldEdge(0, 1))));
    // Three faces on one edge.
    let mut p3 = p.clone();
    p3.push(v(0., 0., 1.));
    assert!(matches!(SubdCage::new(p3, &[vec![0, 1, 2], vec![1, 0, 3], vec![1, 0, 4]]), Err(SubdError::NonManifoldEdge(..))));
    // Bowtie: two triangles meeting at one vertex.
    let bow = vec![v(0., 0., 0.), v(1., 0., 0.), v(1., 1., 0.), v(-1., 0., 0.), v(-1., -1., 0.)];
    assert!(matches!(SubdCage::new(bow, &[vec![0, 1, 2], vec![0, 3, 4]]), Err(SubdError::NonManifoldVertex(0))));
    // Crease on a missing edge, negative sharpness.
    let mut cr = BTreeMap::new();
    cr.insert((0, 2), 1.0);
    assert!(SubdCage::with_tags(quad(), &[vec![0, 1, 2, 3]], cr, BTreeSet::new()).is_err());
    let mut cr = BTreeMap::new();
    cr.insert((0, 1), -1.0);
    assert!(SubdCage::with_tags(quad(), &[vec![0, 1, 2, 3]], cr, BTreeSet::new()).is_err());
    let mut corners = BTreeSet::new();
    corners.insert(99);
    assert!(SubdCage::with_tags(quad(), &[vec![0, 1, 2, 3]], BTreeMap::new(), corners).is_err());
}

#[test]
fn random_face_soup_never_panics() {
    let mut rng = Rng(0x5eed_50bd);
    let mut ok = 0;
    for _ in 0..3000 {
        let nv = 3 + rng.below(8) as usize;
        let p: Vec<Vec3> = (0..nv).map(|_| v(rng.f(), rng.f(), rng.f())).collect();
        let nf = 1 + rng.below(8) as usize;
        let faces: Vec<Vec<u32>> = (0..nf).map(|_| (0..2 + rng.below(4)).map(|_| rng.below(nv as u64 + 1) as u32).collect()).collect();
        if let Ok(c) = SubdCage::new(p, &faces) {
            ok += 1;
            if let Ok(s) = subdivide(&c) {
                assert!(s.all_quads());
                let _ = limit_mesh(&c, LimitOptions { levels: 1 });
            }
        }
    }
    assert!(ok > 0, "some random soups are valid");
}

#[test]
fn level_and_size_caps() {
    let c = box_cage(1.0, 1.0, 1.0).unwrap();
    assert!(matches!(subdivide_levels(&c, MAX_SUBD_LEVELS + 1), Err(SubdError::TooLarge(_))));
    let t = torus_cage(10.0, 2.0, 100, 100).unwrap(); // 10^4 faces; 5 levels would be 10^7
    assert!(matches!(subdivide_levels(&t, 5), Err(SubdError::TooLarge(_))));
    assert!(limit_mesh(&t, LimitOptions { levels: 6 }).is_err());
    assert!(torus_cage(1.0, 2.0, 8, 8).is_err());
    assert!(torus_cage(3.0, 1.0, 2, 8).is_err());
    assert!(box_cage(f64::NAN, 1.0, 1.0).is_err());
    assert!(cylinder_cage(1.0, 1.0, 1_000_000).is_err());
}

// ---------- subdivision ----------

#[test]
fn subdivision_keeps_cage_valid_and_closed() {
    let mut c = box_cage(2.0, 2.0, 2.0).unwrap();
    for level in 1..=4 {
        let n = c.face_count();
        let he: usize = (0..n).map(|f| c.face(f).len()).sum();
        c = subdivide(&c).unwrap();
        assert_eq!(c.face_count(), he, "level {level}");
        assert!(c.all_quads());
        assert_valid_closed(&c);
        assert_eq!(c.euler(), 2);
    }
    let m = limit_mesh(&box_cage(2.0, 2.0, 2.0).unwrap(), LimitOptions::default()).unwrap();
    assert!(m.volume().unwrap() > 0.0, "outward orientation kept");
}

#[test]
fn ngons_subdivide_into_quads() {
    let c = cylinder_cage(1.0, 2.0, 7).unwrap();
    let s = subdivide(&c).unwrap();
    assert_eq!(s.face_count(), 7 * 4 + 2 * 7);
    assert!(s.all_quads() && s.is_closed());
    // The cap centres are extraordinary vertices of valence 7.
    assert!((0..s.vertex_count() as u32).any(|v| s.valence(v) == 7));
}

#[test]
fn fully_creased_cube_stays_a_cube() {
    let c = crease_all(&box_cage(2.0, 2.0, 2.0).unwrap(), SHARP).unwrap();
    let s = subdivide_levels(&c, 3).unwrap();
    for p in s.positions() {
        let m = p.x.abs().max(p.y.abs()).max(p.z.abs());
        assert!((m - 1.0).abs() < 1e-12, "{p:?} off the cube");
    }
    let m = limit_mesh(&c, LimitOptions { levels: 3 }).unwrap();
    assert!((m.volume().unwrap() - 8.0).abs() < 1e-9);
    assert!((m.area() - 24.0).abs() < 1e-9);
}

#[test]
fn sharp_boundary_with_corners_stays_straight() {
    // An open box (no top), its four rim corners tagged.
    let c = box_cage(2.0, 2.0, 2.0).unwrap();
    let mut faces = c.faces();
    faces.remove(1); // +z
    let mut corners = BTreeSet::new();
    corners.extend([4, 5, 6, 7]);
    let open = SubdCage::with_tags(c.positions().to_vec(), &faces, BTreeMap::new(), corners).unwrap();
    assert!(!open.is_closed());
    let s = subdivide_levels(&open, 3).unwrap();
    let m = limit_mesh(&open, LimitOptions { levels: 3 }).unwrap();
    assert!(m.volume().is_none());
    let mut rim = 0;
    for (i, p) in s.positions().iter().enumerate() {
        if s.is_boundary_vertex(i as u32) {
            rim += 1;
            assert!((p.z - 1.0).abs() < 1e-12, "rim stays in the top plane: {p:?}");
            assert!(((p.x.abs() - 1.0).abs() < 1e-12) || ((p.y.abs() - 1.0).abs() < 1e-12), "rim stays on the square: {p:?}");
        }
    }
    assert_eq!(rim, 4 * 8);
    for (i, p) in m.positions.iter().enumerate() {
        if s.is_boundary_vertex(i as u32) {
            assert!(((p.x.abs() - 1.0).abs() < 1e-12) || ((p.y.abs() - 1.0).abs() < 1e-12), "limit rim straight: {p:?}");
        }
    }
}

#[test]
fn smooth_boundary_is_the_cubic_bspline_of_the_boundary_polygon() {
    // Without corner tags, an open box's rim converges to the uniform cubic B-spline of the
    // square: its limit point at a rim corner is (a + 4v + b)/6.
    let c = box_cage(2.0, 2.0, 2.0).unwrap();
    let mut faces = c.faces();
    faces.remove(1);
    let open = SubdCage::new(c.positions().to_vec(), &faces).unwrap();
    let m = limit_mesh(&open, LimitOptions { levels: 1 }).unwrap();
    // Vertex 7 = (1,1,1); its rim neighbours (−1,1,1) and (1,−1,1).
    let want = (v(-1., 1., 1.) + v(1., 1., 1.) * 4.0 + v(1., -1., 1.)) * (1.0 / 6.0);
    assert!(dist(m.positions[7], want) < 1e-12);
}

#[test]
fn semi_sharp_creases_lie_between_smooth_and_sharp() {
    let base = box_cage(2.0, 2.0, 2.0).unwrap();
    // Crease the four edges of the top face; measure the top-face centre edge's limit height.
    let top: Vec<(u32, u32)> = vec![(4, 5), (5, 7), (7, 6), (6, 4)];
    let mut heights = Vec::new();
    for s in [0.0, 0.5, 1.0, 2.0, SHARP] {
        let mut c = base.clone();
        for &(a, b) in &top {
            c = set_crease(&c, a, b, s).unwrap();
        }
        let m = limit_mesh(&c, LimitOptions { levels: 3 }).unwrap();
        let h = m.positions.iter().map(|p| p.z).fold(f64::NEG_INFINITY, f64::max);
        let corner = m.positions.get(7).map(|p| p.x).unwrap();
        heights.push((s, h, corner));
    }
    for w in heights.windows(2) {
        assert!(w[1].1 >= w[0].1 - 1e-12, "sharper creases hold the top higher: {heights:?}");
        assert!(w[1].2 >= w[0].2 - 1e-12, "and the corners further out: {heights:?}");
    }
    assert!(heights[0].1 < heights[4].1 - 0.05);
}

// ---------- limit surface ----------

#[test]
fn planar_grid_limit_is_planar() {
    let c = grid_cage(5, 4, 1.0).unwrap();
    let m = limit_mesh(&c, LimitOptions { levels: 3 }).unwrap();
    assert_watertight_open(&m);
    for (p, n) in m.positions.iter().zip(&m.normals) {
        assert!(p.z.abs() < 1e-14);
        assert!((n.z - 1.0).abs() < 1e-12, "normal {n:?}");
    }
}

fn assert_watertight_open(m: &SubdMesh) {
    assert!(!m.closed);
    assert!(m.indices.iter().all(|&i| (i as usize) < m.positions.len()));
}

#[test]
fn regular_limit_points_equal_bicubic_bspline() {
    let c = torus_cage(5.0, 1.5, 8, 6).unwrap();
    let lp = limit_positions(&c).unwrap();
    let patches = regular_patches(&c);
    assert_eq!(patches.len(), c.face_count(), "a torus cage is entirely regular");
    let s = subdivide(&c).unwrap();
    let ls = limit_positions(&s).unwrap();
    let ne = c.edge_count();
    let nv = c.vertex_count();
    let mut worst: f64 = 0.0;
    for &(f, ref patch) in &patches {
        let q = c.face(f);
        // Corners of the patch are the limit points of the face's vertices.
        let corners = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        for (k, &(u, w)) in corners.iter().enumerate() {
            worst = worst.max(dist(patch.eval(u, w), lp[q[k] as usize]));
        }
        // The centre is the limit point of the face point (vertex nv + ne + f after one level).
        worst = worst.max(dist(patch.eval(0.5, 0.5), ls[nv + ne + f]));
        // The middle of the first edge is the limit point of that edge's edge point.
        let e = c.find_edge(q[0], q[1]).unwrap();
        worst = worst.max(dist(patch.eval(0.5, 0.0), ls[nv + e]));
    }
    assert!(worst < 1e-12, "worst {worst:e}");
    // Normals: patch normal at a corner against the mesh normal from the tangent masks.
    let m = mesh_level0(&c);
    for &(f, ref patch) in &patches {
        let q = c.face(f);
        let n = patch.normal(0.0, 0.0);
        assert!(dist(n, m.normals[q[0] as usize]) < 1e-12);
        let p = lp[q[0] as usize];
        let ring = v(p.x, p.y, 0.0).normalized() * 5.0;
        assert!(n.dot((p - ring).normalized()) > 0.5, "outward from the tube's centre");
    }
}

fn mesh_level0(c: &SubdCage) -> SubdMesh {
    crate::subd_limit::mesh_of_quads(c).unwrap()
}

#[test]
fn limit_positions_are_where_subdivision_converges() {
    // The cube's eight valence-3 vertices and a level-1 cage's mixed vertices.
    let c1 = subdivide(&box_cage(2.0, 2.0, 2.0).unwrap()).unwrap();
    let lim = limit_positions(&c1).unwrap();
    let mut errs = Vec::new();
    let mut c = c1.clone();
    for _ in 0..5 {
        c = subdivide(&c).unwrap();
        let e = (0..c1.vertex_count()).map(|i| dist(c.positions()[i], lim[i])).fold(0.0, f64::max);
        errs.push(e);
    }
    eprintln!("cube: max |level k - limit| for k = 2..6: {errs:?}");
    for w in errs.windows(2) {
        assert!(w[1] < w[0] * 0.6, "error shrinks per level: {errs:?}");
    }
    assert!(errs[4] < 1e-3);
    // Limit positions are invariant: computing them at a finer level gives the same points.
    let lf = limit_positions(&c).unwrap();
    let d = (0..c1.vertex_count()).map(|i| dist(lf[i], lim[i])).fold(0.0, f64::max);
    assert!(d < 1e-12, "{d:e}");
}

#[test]
fn cube_limit_is_symmetric_and_inside_the_cage() {
    let m = limit_mesh(&box_cage(2.0, 2.0, 2.0).unwrap(), LimitOptions { levels: 4 }).unwrap();
    assert_watertight(&m);
    assert!(m.closed);
    let (lo, hi) = m.bounds();
    for k in [lo.x, lo.y, lo.z] {
        assert!((k + hi.x).abs() < 1e-12);
    }
    // The face centres' limit points of a [−1,1]³ cube lie at ±5/6... checked: the face centre is a
    // valence-4 vertex after one level, its limit 0.8333 from the centre (from the masks).
    assert!(hi.x < 1.0 && hi.x > 0.8);
    let v = m.volume().unwrap();
    // A sphere of radius 0.83 holds 2.4; the rounded cube a little more.
    assert!(v > 2.4 && v < 8.0, "{v}");
    for (p, n) in m.positions.iter().zip(&m.normals) {
        assert!(n.dot(*p) > 0.0, "normals face outward");
        assert!((n.len() - 1.0).abs() < 1e-12);
    }
}

#[test]
fn torus_volume_and_area_converge() {
    let c = torus_cage(10.0, 3.0, 12, 8).unwrap();
    let mut vols = Vec::new();
    let mut areas = Vec::new();
    for l in 1..=5 {
        let m = limit_mesh(&c, LimitOptions { levels: l }).unwrap();
        assert_watertight(&m);
        vols.push(m.volume().unwrap());
        areas.push(m.area());
    }
    let dv: Vec<f64> = vols.windows(2).map(|w| (w[1] - w[0]).abs()).collect();
    let da: Vec<f64> = areas.windows(2).map(|w| (w[1] - w[0]).abs()).collect();
    eprintln!("torus volumes {vols:?}\n  deltas {dv:?}\n areas {areas:?}\n  deltas {da:?}");
    for w in dv.windows(2) {
        assert!(w[1] < w[0] * 0.5, "{dv:?}");
    }
    for w in da.windows(2) {
        assert!(w[1] < w[0] * 0.5, "{da:?}");
    }
    // The cage's circle of 8 points shrinks under subdivision; the volume is near, and below, a
    // torus with tube radius 3: 2π²·R·r² ≈ 1776.
    assert!(vols[4] > 1300.0 && vols[4] < 1776.5, "{}", vols[4]);
}

fn worst_normal_angle(cage: &SubdCage, finer: u32) -> f64 {
    let c = subdivide(cage).unwrap();
    let m = mesh_level0(&c);
    let fine = subdivide_levels(&c, finer).unwrap();
    let lf = limit_positions(&fine).unwrap();
    let mut worst: f64 = 0.0;
    let mut fan = Vec::new();
    for vtx in 0..c.vertex_count() as u32 {
        assert!(fine.fan(vtx, &mut fan).is_none());
        let ring: Vec<u32> = fan.iter().map(|&h| fine.dest(h)).collect();
        let mut n = Vec3::ZERO;
        for i in 0..ring.len() {
            let a = lf[ring[i] as usize] - lf[vtx as usize];
            let b = lf[ring[(i + 1) % ring.len()] as usize] - lf[vtx as usize];
            n = n + a.cross(b);
        }
        worst = worst.max(n.normalized().dot(m.normals[vtx as usize]).clamp(-1.0, 1.0).acos());
    }
    worst
}

#[test]
fn limit_normals_match_finite_differences() {
    // On a cube (valence 3 and 4) and a cylinder (valence 3, 4 and 7): the tangent-mask normal at
    // each smooth vertex against the normal of its limit 1-ring several levels finer. The ring
    // estimate is first-order, so the gap must shrink as the ring does.
    for cage in [box_cage(2.0, 2.0, 2.0).unwrap(), cylinder_cage(1.0, 2.0, 7).unwrap()] {
        let w3 = worst_normal_angle(&cage, 2);
        let w5 = worst_normal_angle(&cage, 4);
        eprintln!("worst normal angle vs finite differences: {w3:.3e} rad (ring 2 levels finer), {w5:.3e} (4 levels)");
        assert!(w5 < 5e-3, "{w5}");
        assert!(w5 < 1e-7 || w5 < w3 * 0.5, "{w3} {w5}");
    }
}

#[test]
fn signed_distance_of_a_limit_mesh() {
    let m = limit_mesh(&box_cage(2.0, 2.0, 2.0).unwrap(), LimitOptions { levels: 3 }).unwrap();
    let (_, hi) = m.bounds();
    assert!(m.signed_distance(Vec3::ZERO) < -0.5);
    let d = m.signed_distance(v(5.0, 0.0, 0.0));
    assert!((d - (5.0 - hi.x)).abs() < 1e-9, "{d}");
    assert!(m.signed_distance(v(hi.x, 0.0, 0.0)).abs() < 1e-9);
}

// ---------- edits ----------

#[test]
fn extrude_inset_bridge_loop_cut() {
    let b = box_cage(2.0, 2.0, 2.0).unwrap();
    let e = extrude_faces(&b, &[1], 1.0).unwrap();
    assert_eq!(e.face_count(), 10);
    assert_valid_closed(&e);
    let ce = crease_all(&e, SHARP).unwrap();
    let vol = limit_mesh(&ce, LimitOptions { levels: 1 }).unwrap().volume().unwrap();
    assert!((vol - 12.0).abs() < 1e-9, "sharp extruded box is 2×2×3: {vol}");
    // Extruding two adjacent faces makes one region.
    let e2 = extrude_faces(&b, &[1, 2], 0.5).unwrap();
    assert_eq!(e2.face_count(), 6 + 6);
    assert_valid_closed(&e2);

    let i = inset_faces(&b, &[0, 1], 0.25).unwrap();
    assert_eq!(i.face_count(), 6 + 2 * 4);
    assert_valid_closed(&i);

    // A box's top and bottom cannot be bridged directly (the tube would duplicate the box's
    // vertical edges); inset them first, then bridge the inner faces: a hole through the box.
    assert!(matches!(bridge_faces(&b, 0, 1), Err(SubdError::NonManifoldEdge(..))));
    let inner = (4, 9); // face 0 became four sides and its inner face, then face 1 the same
    let br = bridge_faces(&i, inner.0, inner.1).unwrap();
    assert_eq!(br.face_count(), 16);
    assert!(br.is_closed());
    assert_eq!(br.euler(), 0, "a bridged box is a torus");
    assert!(bridge_faces(&b, 0, 2).is_err(), "adjacent faces share vertices");

    let lc = loop_cut(&b, 0, 1, 0.5).unwrap();
    assert_eq!(lc.face_count(), 6 + 4);
    assert_valid_closed(&lc);
    assert_eq!(lc.euler(), 2);

    let cy = cylinder_cage(1.0, 2.0, 6).unwrap();
    let around = loop_cut(&cy, 0, 6, 0.3).unwrap(); // a vertical side edge: a ring round the side
    assert_eq!(around.face_count(), 8 + 6);
    assert!(around.positions()[12..].iter().all(|p| (p.z - 0.6).abs() < 1e-12));
    let down = loop_cut(&cy, 0, 1, 0.5).unwrap(); // a bottom edge: one side quad, caps gain vertices
    assert_eq!(down.face_count(), 9);
    assert_valid_closed(&down);
    assert!(loop_cut(&b, 0, 7, 0.5).is_err());
    assert!(loop_cut(&b, 0, 1, 1.0).is_err());
}

#[test]
fn moves_and_tags() {
    let b = box_cage(2.0, 2.0, 2.0).unwrap();
    let m = move_faces(&b, &[1], v(0., 0., 1.)).unwrap();
    assert!(m.positions()[7].z == 2.0 && m.positions()[0].z == -1.0);
    assert!(move_vertices(&b, &[99], v(1., 0., 0.)).is_err());
    assert!(move_vertices(&b, &[0], v(f64::NAN, 0., 0.)).is_err());
    // Collapsing a face is refused.
    assert!(move_vertices(&b, &[0, 1], v(0., 2., 0.)).is_err());
    let e = move_edges(&b, &[(0, 1)], v(0., 0., -1.)).unwrap();
    assert_eq!(e.positions()[1].z, -2.0);
    let c = set_corner(&b, 0, true).unwrap();
    let s = subdivide(&c).unwrap();
    assert_eq!(s.positions()[0], b.positions()[0]);
    let cr = set_crease(&b, 0, 1, 2.5).unwrap();
    assert_eq!(cr.crease(1, 0), 2.5);
    let s = subdivide(&cr).unwrap();
    assert_eq!(s.creases().len(), 2);
    assert!(s.creases().values().all(|&x| (x - 1.5).abs() < 1e-15));
    assert!(set_crease(&b, 0, 7, 1.0).is_err());
    assert!(set_crease(&b, 0, 1, f64::NAN).is_err());
    assert_eq!(set_crease(&cr, 0, 1, 0.0).unwrap().creases().len(), 0);
}

// ---------- property tests ----------

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0.max(1);
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next() % n }
    }
    fn f(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[test]
fn random_edit_sequences_keep_the_cage_valid() {
    let mut rng = Rng(0xC0FF_EE15_5EED);
    let mut applied = 0;
    let mut refused = 0;
    for case in 0..120 {
        let mut c = match case % 3 {
            0 => box_cage(1.0 + rng.f(), 1.0 + rng.f(), 1.0 + rng.f()).unwrap(),
            1 => cylinder_cage(1.0 + rng.f(), 1.0 + rng.f(), 3 + rng.below(6) as u32).unwrap(),
            _ => torus_cage(5.0, 1.0 + rng.f(), 3 + rng.below(6) as u32, 3 + rng.below(5) as u32).unwrap(),
        };
        for _ in 0..6 {
            let nf = c.face_count();
            let f = rng.below(nf as u64) as usize;
            let edges = c.edges();
            let (a, b) = edges[rng.below(edges.len() as u64) as usize];
            let r = match rng.below(8) {
                0 => extrude_faces(&c, &[f], 0.1 + rng.f()),
                1 => inset_faces(&c, &[f], 0.1 + 0.8 * rng.f()),
                2 => loop_cut(&c, a, b, 0.1 + 0.8 * rng.f()),
                3 => move_faces(&c, &[f], v(rng.f() - 0.5, rng.f() - 0.5, rng.f() - 0.5)),
                4 => set_crease(&c, a, b, [0.5, 1.0, 2.0, SHARP][rng.below(4) as usize]),
                5 => set_corner(&c, a, true),
                6 => bridge_faces(&c, f, rng.below(nf as u64) as usize),
                _ => extrude_faces(&c, &[f, (f + 1) % nf], -0.2),
            };
            match r {
                Ok(n) => {
                    // The result is valid by construction (it was re-validated); it stays closed
                    // and its Euler characteristic is that of a closed orientable surface.
                    assert!(n.is_closed(), "case {case}");
                    assert!(n.euler() <= 2 && n.euler() % 2 == 0);
                    c = n;
                    applied += 1;
                }
                Err(_) => refused += 1,
            }
            if c.face_count() > 400 {
                break;
            }
        }
        let m = limit_mesh(&c, LimitOptions { levels: 2 }).unwrap();
        assert!(m.closed);
        assert_watertight(&m);
        assert!(m.positions.iter().chain(&m.normals).all(|p| p.is_finite()));
        assert!(m.volume().unwrap().is_finite());
        let s = subdivide(&c).unwrap();
        assert!(s.all_quads() && s.is_closed() && s.euler() == c.euler());
    }
    eprintln!("edit sequences: {applied} applied, {refused} refused");
    assert!(applied > refused);
}

#[test]
fn subdivision_preserves_topology_of_random_cages() {
    let mut rng = Rng(42);
    for _ in 0..40 {
        let c = torus_cage(4.0, 1.0 + rng.f() * 2.0, 3 + rng.below(10) as u32, 3 + rng.below(10) as u32).unwrap();
        let c = inset_faces(&c, &[rng.below(c.face_count() as u64) as usize], 0.5).unwrap();
        let s = subdivide_levels(&c, 2).unwrap();
        assert_eq!(s.euler(), 0);
        assert!(s.is_closed());
        let (lo, hi) = c.bounds();
        let (slo, shi) = s.bounds();
        // Convex hull property: the subdivided cage stays within the cage's bounds.
        assert!(slo.x >= lo.x - 1e-12 && shi.x <= hi.x + 1e-12 && slo.z >= lo.z - 1e-12 && shi.z <= hi.z + 1e-12);
    }
}

#[test]
fn performance_of_a_thousand_face_cage() {
    let c = torus_cage(10.0, 3.0, 40, 25).unwrap();
    assert_eq!(c.face_count(), 1000);
    let t = std::time::Instant::now();
    let s = subdivide(&c).unwrap();
    let one = t.elapsed();
    let t = std::time::Instant::now();
    let s2 = subdivide(&s).unwrap();
    let two = t.elapsed();
    let t = std::time::Instant::now();
    let m = limit_mesh(&c, LimitOptions { levels: 2 }).unwrap();
    let lim = t.elapsed();
    eprintln!(
        "1000 faces -> {} in {one:?}; {} -> {} in {two:?}; limit mesh (2 levels, {} triangles) in {lim:?}",
        s.face_count(),
        s.face_count(),
        s2.face_count(),
        m.triangle_count()
    );
}
