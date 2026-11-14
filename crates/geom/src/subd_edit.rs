//! Editing primitives on a [`SubdCage`]: primitive cages (box, cylinder, torus), extrude and
//! inset faces, bridge two faces, loop cut, move, crease and corner tags. Each is a pure function
//! returning a new cage that has been validated again, or an error; the input is never changed.

use crate::Vec3;
use crate::subd_cage::{MAX_CAGE_FACES, SubdCage, SubdError, edge_key, newell};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::f64::consts::TAU;

/// Most segments a primitive may have in one direction.
pub const MAX_PRIMITIVE_SEGMENTS: u32 = 1024;

fn finite(name: &str, x: f64) -> Result<f64, SubdError> {
    if x.is_finite() { Ok(x) } else { Err(SubdError::NonFinite(name.into())) }
}

fn positive(name: &str, x: f64) -> Result<f64, SubdError> {
    if finite(name, x)? > 0.0 { Ok(x) } else { Err(SubdError::BadParam(format!("{name} must be positive"))) }
}

fn segments(name: &str, n: u32, min: u32) -> Result<u32, SubdError> {
    if (min..=MAX_PRIMITIVE_SEGMENTS).contains(&n) {
        Ok(n)
    } else {
        Err(SubdError::BadParam(format!("{name} must be {min} to {MAX_PRIMITIVE_SEGMENTS}")))
    }
}

/// A box of size `sx × sy × sz` centred on the origin: 8 vertices, 6 quads.
pub fn box_cage(sx: f64, sy: f64, sz: f64) -> Result<SubdCage, SubdError> {
    let (hx, hy, hz) = (positive("width", sx)? * 0.5, positive("depth", sy)? * 0.5, positive("height", sz)? * 0.5);
    let p = (0..8u32)
        .map(|i| {
            let s = |bit: u32, h: f64| if i & bit != 0 { h } else { -h };
            Vec3::new(s(1, hx), s(2, hy), s(4, hz))
        })
        .collect();
    let f = vec![vec![0, 2, 3, 1], vec![4, 5, 7, 6], vec![0, 1, 5, 4], vec![2, 6, 7, 3], vec![0, 4, 6, 2], vec![1, 3, 7, 5]];
    SubdCage::new(p, &f)
}

/// A cylinder about +Z from `z = 0` to `height`: `n` side quads and two n-gon caps.
pub fn cylinder_cage(radius: f64, height: f64, n: u32) -> Result<SubdCage, SubdError> {
    let (r, h, n) = (positive("radius", radius)?, positive("height", height)?, segments("segments", n, 3)?);
    let mut p = Vec::with_capacity(2 * n as usize);
    for z in [0.0, h] {
        for i in 0..n {
            let a = TAU * f64::from(i) / f64::from(n);
            p.push(Vec3::new(r * a.cos(), r * a.sin(), z));
        }
    }
    let mut f: Vec<Vec<u32>> = (0..n).map(|i| vec![i, (i + 1) % n, n + (i + 1) % n, n + i]).collect();
    f.push((0..n).rev().collect());
    f.push((n..2 * n).collect());
    SubdCage::new(p, &f)
}

/// A torus about +Z in the XY plane: `major` is the distance to the tube's centre, `minor` the
/// tube's radius; `nu` segments around the ring and `nv` around the tube. Every vertex is
/// regular (valence 4), so its limit is a set of bicubic patches: the natural start for a ring.
pub fn torus_cage(major: f64, minor: f64, nu: u32, nv: u32) -> Result<SubdCage, SubdError> {
    let (big, small) = (positive("major radius", major)?, positive("minor radius", minor)?);
    if small >= big {
        return Err(SubdError::BadParam("the minor radius must be smaller than the major radius".into()));
    }
    let (nu, nv) = (segments("ring segments", nu, 3)?, segments("tube segments", nv, 3)?);
    let id = |i: u32, j: u32| (i % nu) * nv + (j % nv);
    let mut p = Vec::with_capacity((nu * nv) as usize);
    for i in 0..nu {
        let u = TAU * f64::from(i) / f64::from(nu);
        for j in 0..nv {
            let v = TAU * f64::from(j) / f64::from(nv);
            let rr = big + small * v.cos();
            p.push(Vec3::new(rr * u.cos(), rr * u.sin(), small * v.sin()));
        }
    }
    let mut f = Vec::with_capacity((nu * nv) as usize);
    for i in 0..nu {
        for j in 0..nv {
            f.push(vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
        }
    }
    SubdCage::new(p, &f)
}

/// A flat `nx × ny` grid of quads in the XY plane, `size` per cell, corner at the origin (open).
pub fn grid_cage(nx: u32, ny: u32, size: f64) -> Result<SubdCage, SubdError> {
    let (nx, ny, s) = (segments("columns", nx, 1)?, segments("rows", ny, 1)?, positive("cell size", size)?);
    let id = |i: u32, j: u32| j * (nx + 1) + i;
    let p = (0..=ny).flat_map(|j| (0..=nx).map(move |i| Vec3::new(f64::from(i) * s, f64::from(j) * s, 0.0))).collect();
    let f: Vec<Vec<u32>> = (0..ny).flat_map(|j| (0..nx).map(move |i| vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)])).collect();
    SubdCage::new(p, &f)
}

fn face_set(cage: &SubdCage, faces: &[usize]) -> Result<BTreeSet<usize>, SubdError> {
    let set: BTreeSet<usize> = faces.iter().copied().collect();
    if set.is_empty() {
        return Err(SubdError::BadParam("no faces given".into()));
    }
    if let Some(&f) = set.iter().find(|&&f| f >= cage.face_count()) {
        return Err(SubdError::BadParam(format!("face {f} does not exist")));
    }
    Ok(set)
}

fn rebuild(p: Vec<Vec3>, faces: Vec<Vec<u32>>, creases: BTreeMap<(u32, u32), f64>, corners: BTreeSet<u32>) -> Result<SubdCage, SubdError> {
    if faces.len() > MAX_CAGE_FACES {
        return Err(SubdError::TooLarge(format!("{} faces", faces.len())));
    }
    SubdCage::with_tags(p, &faces, creases, corners)
}

/// Extrudes the region made of `faces` by `distance` along each vertex's mean region normal,
/// joining it to the rest with a ring of side quads. Negative distances push inward.
pub fn extrude_faces(cage: &SubdCage, faces: &[usize], distance: f64) -> Result<SubdCage, SubdError> {
    let d = finite("distance", distance)?;
    if d == 0.0 {
        return Err(SubdError::BadParam("the extrusion distance must not be zero".into()));
    }
    let set = face_set(cage, faces)?;
    let src = cage.positions();
    // Mean region normal per vertex.
    let mut normal: BTreeMap<u32, Vec3> = BTreeMap::new();
    for &f in &set {
        let n = newell(src, cage.face(f)).normalized();
        for &v in cage.face(f) {
            let e = normal.entry(v).or_insert(Vec3::ZERO);
            *e = *e + n;
        }
    }
    let mut p = src.to_vec();
    let mut lifted: HashMap<u32, u32> = HashMap::new();
    for (&v, &n) in &normal {
        let n = n.normalized();
        if n == Vec3::ZERO {
            return Err(SubdError::BadParam(format!("the region's normal at vertex {v} cancels out")));
        }
        lifted.insert(v, p.len() as u32);
        p.push(src[v as usize] + n * d);
    }
    let mut out_faces = Vec::with_capacity(cage.face_count() + 4 * set.len());
    for f in 0..cage.face_count() {
        let fv = cage.face(f);
        if set.contains(&f) {
            out_faces.push(fv.iter().map(|v| lifted.get(v).copied().unwrap_or(*v)).collect());
        } else {
            out_faces.push(fv.to_vec());
        }
    }
    // Side quads on the region's border half-edges.
    for &f in &set {
        let (s, e) = cage.face_range(f);
        for h in s as u32..e as u32 {
            let inside = cage.twin(h).is_some_and(|t| set.contains(&cage.he_face(t)));
            if !inside {
                let (a, b) = cage.he_ends(h);
                let (la, lb) = (lifted.get(&a).copied().unwrap_or(a), lifted.get(&b).copied().unwrap_or(b));
                out_faces.push(vec![a, b, lb, la]);
            }
        }
    }
    // Creases inside the region move with it.
    let mut creases = BTreeMap::new();
    for (&(a, b), &s) in cage.creases() {
        match (lifted.get(&a), lifted.get(&b)) {
            (Some(&la), Some(&lb)) => creases.insert(edge_key(la, lb), s),
            _ => creases.insert((a, b), s),
        };
    }
    let present: std::collections::HashSet<(u32, u32)> =
        out_faces.iter().flat_map(|f: &Vec<u32>| (0..f.len()).map(move |i| edge_key(f[i], f[(i + 1) % f.len()]))).collect();
    let creases = creases.into_iter().filter(|(k, _)| present.contains(k)).collect();
    rebuild(p, out_faces, creases, cage.corners().clone())
}

/// Insets each of `faces` on its own: a smaller copy, `amount` (0 to 1) of the way towards the
/// face's centroid, ringed by quads.
pub fn inset_faces(cage: &SubdCage, faces: &[usize], amount: f64) -> Result<SubdCage, SubdError> {
    let t = finite("amount", amount)?;
    if !(t > 0.0 && t < 1.0) {
        return Err(SubdError::BadParam("the inset amount must be between 0 and 1".into()));
    }
    let set = face_set(cage, faces)?;
    let mut p = cage.positions().to_vec();
    let mut out = Vec::with_capacity(cage.face_count() + 4 * set.len());
    for f in 0..cage.face_count() {
        let fv = cage.face(f);
        if !set.contains(&f) {
            out.push(fv.to_vec());
            continue;
        }
        let c = fv.iter().fold(Vec3::ZERO, |s, &v| s + p[v as usize]) * (1.0 / fv.len() as f64);
        let base = p.len() as u32;
        for &v in fv {
            let q = p[v as usize];
            p.push(q + (c - q) * t);
        }
        let k = fv.len() as u32;
        for i in 0..k {
            let j = (i + 1) % k;
            out.push(vec![fv[i as usize], fv[j as usize], base + j, base + i]);
        }
        out.push((0..k).map(|i| base + i).collect());
    }
    rebuild(p, out, cage.creases().clone(), cage.corners().clone())
}

/// Removes faces `a` and `b` (same number of sides, no shared vertex) and joins their loops with
/// a tube of quads, choosing the rotation that pairs the nearest vertices.
pub fn bridge_faces(cage: &SubdCage, a: usize, b: usize) -> Result<SubdCage, SubdError> {
    if a >= cage.face_count() || b >= cage.face_count() || a == b {
        return Err(SubdError::BadParam("bridge needs two different existing faces".into()));
    }
    let fa = cage.face(a).to_vec();
    let fb = cage.face(b).to_vec();
    let k = fa.len();
    if fb.len() != k {
        return Err(SubdError::BadParam("bridged faces must have the same number of sides".into()));
    }
    if fa.iter().any(|v| fb.contains(v)) {
        return Err(SubdError::BadParam("bridged faces must not share a vertex".into()));
    }
    let p = cage.positions();
    // b's loop is paired in reverse: a_i with b_{(off - i) mod k}.
    let pair = |off: usize, i: usize| fb[(off + k * 2 - i % k) % k];
    let mut best = (f64::INFINITY, 0usize);
    for off in 0..k {
        let cost: f64 = (0..k).map(|i| (p[fa[i] as usize] - p[pair(off, i) as usize]).len()).sum();
        if cost < best.0 {
            best = (cost, off);
        }
    }
    let off = best.1;
    let mut out: Vec<Vec<u32>> = (0..cage.face_count()).filter(|&f| f != a && f != b).map(|f| cage.face(f).to_vec()).collect();
    for i in 0..k {
        let j = (i + 1) % k;
        out.push(vec![fa[i], fa[j], pair(off, j), pair(off, i)]);
    }
    rebuild(p.to_vec(), out, cage.creases().clone(), cage.corners().clone())
}

/// Inserts an edge loop across the ring of quads through edge `a`–`b`, splitting each crossed
/// edge at `t` (0 to 1, measured from `a` along the starting edge and consistently along the
/// ring). The loop stops at a boundary or a non-quad face, which gains a vertex.
pub fn loop_cut(cage: &SubdCage, a: u32, b: u32, t: f64) -> Result<SubdCage, SubdError> {
    let t = finite("position", t)?;
    if !(t > 0.0 && t < 1.0) {
        return Err(SubdError::BadParam("the loop position must be between 0 and 1".into()));
    }
    let Some(e0) = cage.find_edge(a, b) else {
        return Err(SubdError::BadParam(format!("no edge {a}-{b}")));
    };
    let mut h0 = cage.edge_he(e0);
    if cage.origin(h0) != a {
        h0 = cage.twin(h0).unwrap_or(h0);
    }
    // Split edges: undirected key -> (origin it is measured from, t).
    let mut splits: BTreeMap<(u32, u32), (u32, f64)> = BTreeMap::new();
    let mut quads: BTreeSet<usize> = BTreeSet::new();
    splits.insert(edge_key(a, b), (a, t));
    let walks = [Some((h0, t)), cage.twin(h0).map(|tw| (tw, 1.0 - t))];
    for (h_start, t_start) in walks.into_iter().flatten() {
        let (mut h, tt) = (h_start, t_start);
        for _ in 0..cage.face_count() + 1 {
            let f = cage.he_face(h);
            if cage.face(f).len() != 4 || quads.contains(&f) {
                break;
            }
            quads.insert(f);
            let h2 = cage.next(cage.next(h));
            let (c, d) = cage.he_ends(h2);
            // d is next to h's origin, so the split sits at tt from d.
            let key = edge_key(c, d);
            if splits.contains_key(&key) {
                break;
            }
            splits.insert(key, (d, tt));
            match cage.twin(h2) {
                Some(tw) => h = tw,
                None => break,
            }
            // tw starts at d, where the split was measured from: tt carries over unchanged.
        }
    }
    let src = cage.positions();
    let mut p = src.to_vec();
    let mut mid: BTreeMap<(u32, u32), u32> = BTreeMap::new();
    for (&(x, y), &(from, s)) in &splits {
        let to = if from == x { y } else { x };
        mid.insert((x, y), p.len() as u32);
        p.push(src[from as usize] + (src[to as usize] - src[from as usize]) * s);
    }
    let mut out = Vec::with_capacity(cage.face_count() + quads.len());
    for f in 0..cage.face_count() {
        let fv = cage.face(f);
        let k = fv.len();
        if quads.contains(&f) {
            // Find the two split edges (opposite), split into two quads.
            let cut: Vec<usize> = (0..k).filter(|&i| mid.contains_key(&edge_key(fv[i], fv[(i + 1) % k]))).collect();
            if let [i, j] = cut[..]
                && j == i + 2
            {
                {
                    let m = |i: usize| mid.get(&edge_key(fv[i], fv[(i + 1) % k])).copied().unwrap_or(0);
                    let (mi, mj) = (m(i), m(j));
                    let v = |o: usize| fv[(i + o) % 4];
                    out.push(vec![v(0), mi, mj, v(3)]);
                    out.push(vec![mi, v(1), v(2), mj]);
                    continue;
                }
            }
        }
        let mut g = Vec::with_capacity(k + 2);
        for i in 0..k {
            g.push(fv[i]);
            if let Some(&m) = mid.get(&edge_key(fv[i], fv[(i + 1) % k])) {
                g.push(m);
            }
        }
        out.push(g);
    }
    // A crease on a split edge carries over to both halves.
    let mut creases = BTreeMap::new();
    for (&(x, y), &s) in cage.creases() {
        if let Some(&m) = mid.get(&(x, y)) {
            creases.insert(edge_key(x, m), s);
            creases.insert(edge_key(m, y), s);
        } else {
            creases.insert((x, y), s);
        }
    }
    rebuild(p, out, creases, cage.corners().clone())
}

/// Moves the vertices `ids` by `delta`.
pub fn move_vertices(cage: &SubdCage, ids: &[u32], delta: Vec3) -> Result<SubdCage, SubdError> {
    if !delta.is_finite() {
        return Err(SubdError::NonFinite("move".into()));
    }
    let mut p = cage.positions().to_vec();
    let set: BTreeSet<u32> = ids.iter().copied().collect();
    for &v in &set {
        let q = p.get_mut(v as usize).ok_or_else(|| SubdError::BadParam(format!("vertex {v} does not exist")))?;
        *q = *q + delta;
    }
    let mut c = cage.clone();
    c.replace_positions(p)?;
    Ok(c)
}

/// Moves the end vertices of the edges `edges` (vertex pairs) by `delta`.
pub fn move_edges(cage: &SubdCage, edges: &[(u32, u32)], delta: Vec3) -> Result<SubdCage, SubdError> {
    let mut ids = Vec::with_capacity(edges.len() * 2);
    for &(a, b) in edges {
        if cage.find_edge(a, b).is_none() {
            return Err(SubdError::BadParam(format!("no edge {a}-{b}")));
        }
        ids.extend_from_slice(&[a, b]);
    }
    move_vertices(cage, &ids, delta)
}

/// Moves the vertices of the faces `faces` by `delta`.
pub fn move_faces(cage: &SubdCage, faces: &[usize], delta: Vec3) -> Result<SubdCage, SubdError> {
    let set = face_set(cage, faces)?;
    let ids: Vec<u32> = set.iter().flat_map(|&f| cage.face(f).iter().copied()).collect();
    move_vertices(cage, &ids, delta)
}

/// Sets the crease sharpness of edge `a`–`b` (0 smooth, [`crate::SHARP`] sharp, fractional
/// values soften the crease over the first levels).
pub fn set_crease(cage: &SubdCage, a: u32, b: u32, sharpness: f64) -> Result<SubdCage, SubdError> {
    if sharpness.is_nan() || sharpness < 0.0 {
        return Err(SubdError::BadParam("sharpness must be 0 or more".into()));
    }
    if cage.find_edge(a, b).is_none() {
        return Err(SubdError::BadParam(format!("no edge {a}-{b}")));
    }
    let (p, f, mut creases, corners) = cage.clone().into_parts();
    if sharpness == 0.0 {
        creases.remove(&edge_key(a, b));
    } else {
        creases.insert(edge_key(a, b), sharpness);
    }
    rebuild(p, f, creases, corners)
}

/// Tags (or untags) vertex `v` as a corner: it stays put under subdivision.
pub fn set_corner(cage: &SubdCage, v: u32, corner: bool) -> Result<SubdCage, SubdError> {
    if v as usize >= cage.vertex_count() {
        return Err(SubdError::BadParam(format!("vertex {v} does not exist")));
    }
    let (p, f, creases, mut corners) = cage.clone().into_parts();
    if corner {
        corners.insert(v);
    } else {
        corners.remove(&v);
    }
    rebuild(p, f, creases, corners)
}

/// Marks every edge of the cage with `sharpness`.
pub fn crease_all(cage: &SubdCage, sharpness: f64) -> Result<SubdCage, SubdError> {
    if sharpness.is_nan() || sharpness < 0.0 {
        return Err(SubdError::BadParam("sharpness must be 0 or more".into()));
    }
    let creases = if sharpness == 0.0 { BTreeMap::new() } else { cage.edges().into_iter().map(|(a, b)| (edge_key(a, b), sharpness)).collect() };
    let (p, f, _, corners) = cage.clone().into_parts();
    rebuild(p, f, creases, corners)
}
