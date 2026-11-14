//! The cast solid's creases made crisp: a flat band's corners, a bezel's rim, a seat's edge.
//!
//! Marching tetrahedra puts every vertex on a grid edge, so a crease (where two smooth sides of
//! the metal meet at an angle) falls between vertices and the grid cuts it off as a chamfer about
//! a third of a step wide. After extraction, each vertex whose neighbours' true normals part by
//! more than about 30° is moved to the point that best meets their tangent planes — the quadric
//! error function of Ju et al., *Dual Contouring of Hermite Data* (SIGGRAPH 2002), minimised with
//! a truncated eigen-decomposition — and edges are then flipped so the crease's vertices are
//! joined along it rather than across it (as in Kobbelt et al., *Feature Sensitive Surface
//! Extraction from Volume Data*, SIGGRAPH 2001). Moves and flips both keep every edge used once
//! each way, so the shell stays closed, manifold and wound outward; a move that turns a triangle
//! over, leaves a sliver or makes two triangles cross is put back, a flip that would is not made,
//! and if anything still crosses at the end the unsharpened shell is kept.

use std::collections::HashMap;

use cadcraft_geom::Vec3;

fn grow(b: &mut (Vec3, Vec3), p: Vec3) {
    b.0 = Vec3::new(b.0.x.min(p.x), b.0.y.min(p.y), b.0.z.min(p.z));
    b.1 = Vec3::new(b.1.x.max(p.x), b.1.y.max(p.y), b.1.z.max(p.z));
}

/// The rounds of putting back vertices whose move spoilt the shell.
const UNDO_ROUNDS: usize = 12;
/// The least area a triangle keeps, mm².
const MIN_AREA: f64 = 1e-9;
/// The field's gradient at `p` by central differences `h` apart.
fn gradient(f: &dyn Fn(Vec3) -> f64, p: Vec3, h: f64) -> Vec3 {
    let d = |e: Vec3| (f(p + e) - f(p - e)) / (2.0 * h);
    Vec3::new(d(Vec3::new(h, 0.0, 0.0)), d(Vec3::new(0.0, h, 0.0)), d(Vec3::new(0.0, 0.0, h)))
}

/// Sharpens the shell's creases in place. `field(v, p)` is the field at `p` for vertex `v`'s
/// neighbourhood. The shell must be closed and sound; it stays so.
pub(super) fn sharpen_shell(positions: &mut [Vec3], indices: &mut [u32], step: f64, field: &dyn Fn(usize, Vec3) -> f64) {
    let tris: Vec<[u32; 3]> = indices.chunks_exact(3).filter_map(|t| Some([*t.first()?, *t.get(1)?, *t.get(2)?])).collect();
    let mut around: Vec<Vec<u32>> = vec![Vec::new(); positions.len()];
    for (i, t) in tris.iter().enumerate() {
        for v in t {
            if let Some(list) = around.get_mut(*v as usize) {
                list.push(u32::try_from(i).unwrap_or(u32::MAX));
            }
        }
    }
    // Then the creases: the vertices next to one moved onto it, the moves that spoil the shell
    // put back to the projected surface, and the edges round them flipped to run along it; again,
    // where a flip lets more vertices move.
    let smooth: Vec<Vec3> = positions.to_vec();
    // Only near a bend in the shell itself (a chamfer bends it by about 45° each side) are the
    // true normals worth finding: that and its ring.
    let at = |i: u32| smooth.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let face: Vec<Vec3> = tris
        .iter()
        .map(|t| {
            let n = (at(t[1]) - at(t[0])).cross(at(t[2]) - at(t[0]));
            let l = n.len();
            if l > 2.0 * SLIVER * step * step { n * (1.0 / l) } else { Vec3::ZERO }
        })
        .collect();
    let mut wanted = vec![false; positions.len()];
    for ts in &around {
        let ns: Vec<Vec3> = ts.iter().filter_map(|t| face.get(*t as usize).copied()).filter(|n| *n != Vec3::ZERO).collect();
        if ns.iter().enumerate().any(|(i, a)| ns.iter().skip(i + 1).any(|b| a.dot(*b) < BEND_COS)) {
            for t in ts {
                for u in tris.get(*t as usize).map_or(&[][..], |t| &t[..]) {
                    if let Some(w) = wanted.get_mut(*u as usize) {
                        *w = true;
                    }
                }
            }
        }
    }
    let normals = surface_normals(&smooth, &wanted, step, field);
    let mut snapped = vec![false; positions.len()];
    let mut tris = tris;
    let mut flipped = false;
    for _ in 0..SHARP_ROUNDS {
        // What the round starts from: a sound shell with the connectivity it has now.
        let start: Vec<Vec3> = positions.to_vec();
        let earlier = snapped.clone();
        if sharpen(positions, &smooth, &normals, &tris, &around, &mut snapped, step, field) == 0 {
            break;
        }
        settle(positions, &start, &tris, &around, step);
        for ((f, p), q) in snapped.iter_mut().zip(positions.iter()).zip(&smooth) {
            *f = p != q;
        }
        // Flips are looked for round the vertices this round moved.
        let fresh: Vec<bool> = snapped.iter().zip(&earlier).map(|(now, then)| *now && !*then).collect();
        let flipped_now = flip_creases(positions, &mut tris, &fresh, step, field);
        if !flipped_now {
            break;
        }
        flipped = true;
        for list in &mut around {
            list.clear();
        }
        for (i, t) in tris.iter().enumerate() {
            for v in t {
                if let Some(list) = around.get_mut(*v as usize) {
                    list.push(u32::try_from(i).unwrap_or(u32::MAX));
                }
            }
        }
    }
    if flipped {
        for (slot, v) in indices.iter_mut().zip(tris.iter().flatten()) {
            *slot = *v;
        }
    }
}

/// Rounds of moving vertices onto creases and flipping edges along them.
const SHARP_ROUNDS: usize = 3;

/// Passes of edge flips along the creases.
const FLIP_PASSES: usize = 3;

/// How far a triangle stands off the true surface: the field at its centroid and at the middle
/// of each edge, summed (the field is a distance bound, so about millimetres).
fn off_surface(positions: &[Vec3], t: [u32; 3], field: &dyn Fn(usize, Vec3) -> f64) -> f64 {
    let at = |i: u32| positions.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let [a, b, c] = t.map(at);
    let v = t[0] as usize;
    [(a + b + c) * (1.0 / 3.0), (a + b) * 0.5, (b + c) * 0.5, (c + a) * 0.5]
        .iter()
        .map(|p| field(v, *p).abs())
        .map(|x| if x.is_finite() { x } else { 1e9 })
        .sum()
}

/// Flips edges next to the moved vertices where the two triangles across them then lie nearer the
/// true surface: a crease's vertices, once on it, are joined along it rather than across it
/// (feature-edge recovery by flips, as Kobbelt et al., *Feature Sensitive Surface Extraction from
/// Volume Data*, 2001). A flip keeps every edge used once each way, so the shell stays closed,
/// manifold and wound outward; one that would turn a triangle over, leave it a sliver, repeat an
/// edge or cross another triangle is not made, and the whole is checked again at the end (and
/// every flip undone if anything crosses). Whether anything was flipped.
fn flip_creases(positions: &[Vec3], tris: &mut [[u32; 3]], snapped: &[bool], step: f64, field: &dyn Fn(usize, Vec3) -> f64) -> bool {
    let at = |i: u32| positions.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let is_snapped = |i: u32| snapped.get(i as usize).copied().unwrap_or(false);
    let mut edges: HashMap<(u32, u32), u32> = HashMap::with_capacity(tris.len() * 3);
    for (i, t) in tris.iter().enumerate() {
        let i = u32::try_from(i).unwrap_or(u32::MAX);
        for k in 0..3 {
            edges.insert((t[k], t[(k + 1) % 3]), i);
        }
    }
    let original: Vec<[u32; 3]> = tris.to_vec();
    fn set(tris: &mut [[u32; 3]], i: u32, t: [u32; 3]) {
        if let Some(x) = tris.get_mut(i as usize) {
            *x = t;
        }
    }
    let bins = bin_triangles(positions, tris, step);
    let min_area = 0.02 * step * step;
    let mut flipped = false;
    let mut flips: Vec<u32> = Vec::new();
    for _ in 0..FLIP_PASSES {
        let mut any = false;
        // Every edge of a triangle with a moved corner.
        let mut candidates: Vec<(u32, u32)> = tris
            .iter()
            .filter(|t| t.iter().any(|v| is_snapped(*v)))
            .flat_map(|t| [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])])
            .map(|(p, q)| if p < q { (p, q) } else { (q, p) })
            .collect();
        candidates.dedup();
        // In a fixed order, so the same piece gives the same file.
        candidates.sort_unstable();
        candidates.dedup();
        for (p, q) in candidates {
            let (Some(&t1), Some(&t2)) = (edges.get(&(p, q)), edges.get(&(q, p))) else { continue };
            let (Some(&a), Some(&b)) = (tris.get(t1 as usize), tris.get(t2 as usize)) else { continue };
            let Some(r) = a.iter().copied().find(|v| *v != p && *v != q) else { continue };
            let Some(s) = b.iter().copied().find(|v| *v != p && *v != q) else { continue };
            if r == s || edges.contains_key(&(r, s)) || edges.contains_key(&(s, r)) {
                continue;
            }
            // (p, q, r) and (q, p, s) become (p, s, r) and (s, q, r).
            let (n1, n2) = ([p, s, r], [s, q, r]);
            let normal = |t: [u32; 3]| (at(t[1]) - at(t[0])).cross(at(t[2]) - at(t[0]));
            let old = normal(a) + normal(b);
            let (m1, m2) = (normal(n1), normal(n2));
            if m1.len() < 2.0 * min_area || m2.len() < 2.0 * min_area || m1.dot(old) <= 0.0 || m2.dot(old) <= 0.0 || m1.dot(m2) <= 0.0 {
                continue;
            }
            // Two triangles that hardly bend across their edge gain nothing by a flip.
            let (na, nb) = (normal(a), normal(b));
            if na.dot(nb) > BEND_COS * na.len() * nb.len() {
                continue;
            }
            let before = off_surface(positions, a, field) + off_surface(positions, b, field);
            let after = off_surface(positions, n1, field) + off_surface(positions, n2, field);
            if !(after < 0.5 * before && before > 1e-4 * step) {
                continue;
            }
            set(tris, t1, n1);
            set(tris, t2, n2);
            if !crossings_in(positions, tris, &bins, &[t1, t2], step).is_empty() {
                set(tris, t1, a);
                set(tris, t2, b);
                continue;
            }
            for e in [(p, q), (q, p)] {
                edges.remove(&e);
            }
            for (t, i) in [(n1, t1), (n2, t2)] {
                for k in 0..3 {
                    edges.insert((t[k], t[(k + 1) % 3]), i);
                }
            }
            flips.extend([t1, t2]);
            any = true;
            flipped = true;
        }
        if !any {
            break;
        }
    }
    if flipped {
        flips.sort_unstable();
        flips.dedup();
        if !crossings(positions, tris, &flips, step).is_empty() {
            tris.copy_from_slice(&original);
            return false;
        }
    }
    flipped
}

/// Puts back to `before` every vertex (and the ring round it) whose move turned one of its
/// triangles over (against its normal in `before`), left it without area, or made it cross
/// another, round by round; everything, when that does not settle.
fn settle(positions: &mut [Vec3], before: &[Vec3], tris: &[[u32; 3]], around: &[Vec<u32>], step: f64) {
    let at = |ps: &[Vec3], i: u32| ps.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    // The triangles whose shape changed since they were last checked: at first, those with a
    // vertex moved from `before`.
    let moved = |i: &u32| positions.get(*i as usize) != before.get(*i as usize);
    let mut dirty: Vec<u32> =
        tris.iter().enumerate().filter(|(_, t)| t.iter().any(moved)).map(|(i, _)| u32::try_from(i).unwrap_or(u32::MAX)).collect();
    for round in 0..=UNDO_ROUNDS {
        let mut undo: Vec<u32> = Vec::new();
        for &ti in &dirty {
            let Some(&[a, b, c]) = tris.get(ti as usize) else { continue };
            let n0 = (at(before, b) - at(before, a)).cross(at(before, c) - at(before, a));
            let n1 = (at(positions, b) - at(positions, a)).cross(at(positions, c) - at(positions, a));
            if n0.dot(n1) <= 0.0 || n1.len() < 2.0 * MIN_AREA {
                undo.extend([a, b, c]);
            }
        }
        undo.extend(crossings(positions, tris, &dirty, step));
        if undo.is_empty() {
            return;
        }
        if round == UNDO_ROUNDS {
            break;
        }
        // Put back each offending vertex and the ring round it, and check again what that moved.
        let mut moved: Vec<u32> = Vec::new();
        for i in undo {
            for &ti in around.get(i as usize).map_or(&[][..], Vec::as_slice) {
                if let Some(t) = tris.get(ti as usize) {
                    moved.extend(t.iter().copied());
                }
            }
        }
        moved.sort_unstable();
        moved.dedup();
        let mut next: Vec<u32> = Vec::new();
        for i in moved {
            if let (Some(p), Some(q)) = (positions.get_mut(i as usize), before.get(i as usize))
                && *p != *q
            {
                *p = *q;
                next.extend(around.get(i as usize).map_or(&[][..], Vec::as_slice));
            }
        }
        next.sort_unstable();
        next.dedup();
        dirty = next;
    }
    // Still turned over or crossing after every round: the shell as it was.
    positions.copy_from_slice(before);
}

/// The cosine of the least angle between two surface normals near a vertex that makes it a
/// crease's (about 30°).
const CREASE_COS: f64 = 0.866;
/// The cosine of the least bend between two of the shell's own triangles round a vertex that
/// makes it worth looking for a crease there (about 20°).
const BEND_COS: f64 = 0.94;
/// The least area a triangle is left with by a move onto a crease, in square steps.
const SLIVER: f64 = 1e-3;
/// The farthest a vertex is moved onto a crease, as a fraction of the grid step.
const MAX_SNAP: f64 = 0.75;
/// Eigenvalues of the quadric under this fraction of its largest are left out: the directions
/// along a crease (or across a flat), where the vertex stays where it is.
const QEF_TRUNCATE: f64 = 0.08;

/// The eigenvalues and unit eigenvectors of a symmetric 3×3 matrix, by cyclic Jacobi rotations.
fn eigen3(m: [[f64; 3]; 3]) -> ([f64; 3], [Vec3; 3]) {
    let mut a = m;
    let mut v = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for _ in 0..24 {
        let off = a[0][1] * a[0][1] + a[0][2] * a[0][2] + a[1][2] * a[1][2];
        if !(off.is_finite() && off > 1e-30) {
            break;
        }
        for (p, q) in [(0usize, 1usize), (0, 2), (1, 2)] {
            let apq = a[p][q];
            if apq.abs() < 1e-300 {
                continue;
            }
            let theta = (a[q][q] - a[p][p]) / (2.0 * apq);
            let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
            let t = if theta == 0.0 { 1.0 } else { t };
            let c = 1.0 / (t * t + 1.0).sqrt();
            let s = t * c;
            for row in &mut a {
                let (akp, akq) = (row[p], row[q]);
                row[p] = c * akp - s * akq;
                row[q] = s * akp + c * akq;
            }
            let (rp, rq) = (a[p], a[q]);
            a[p] = std::array::from_fn(|k| c * rp[k] - s * rq[k]);
            a[q] = std::array::from_fn(|k| s * rp[k] + c * rq[k]);
            for row in &mut v {
                let (vp, vq) = (row[p], row[q]);
                row[p] = c * vp - s * vq;
                row[q] = s * vp + c * vq;
            }
        }
    }
    let col = |k: usize| Vec3::new(v[0][k], v[1][k], v[2][k]);
    ([a[0][0], a[1][1], a[2][2]], [col(0), col(1), col(2)])
}

/// The point nearest `x0` that best meets the planes `(p, n)` in the least-squares sense (the
/// quadric error function of Ju et al., *Dual Contouring of Hermite Data*, 2002), the quadric's
/// small eigen-directions truncated so the point slides no further than it must.
pub(super) fn qef_point(x0: Vec3, planes: &[(Vec3, Vec3)]) -> Option<Vec3> {
    let mut a = [[0.0f64; 3]; 3];
    let mut r = Vec3::ZERO;
    for (p, n) in planes {
        let nv = [n.x, n.y, n.z];
        for (i, row) in a.iter_mut().enumerate() {
            for (j, x) in row.iter_mut().enumerate() {
                *x += nv[i] * nv[j];
            }
        }
        r = r + *n * n.dot(*p - x0);
    }
    let (vals, vecs) = eigen3(a);
    let top = vals.iter().copied().fold(0.0, f64::max);
    if !(top.is_finite() && top > 0.0) {
        return None;
    }
    let mut d = Vec3::ZERO;
    for (l, e) in vals.iter().zip(&vecs) {
        if *l > QEF_TRUNCATE * top {
            d = d + *e * (e.dot(r) / l);
        }
    }
    let x = x0 + d;
    x.is_finite().then_some(x)
}

/// The true surface's unit normal at each vertex (none off the surface or where the field is flat).
fn surface_normals(positions: &[Vec3], wanted: &[bool], step: f64, field: &dyn Fn(usize, Vec3) -> f64) -> Vec<Option<Vec3>> {
    let h = 0.02 * step;
    positions
        .iter()
        .enumerate()
        .map(|(v, p)| {
            if !wanted.get(v).copied().unwrap_or(false) {
                return None;
            }
            let f = |q: Vec3| field(v, q);
            let fp = f(*p);
            if !(fp.is_finite() && fp.abs() < 0.05 * step) {
                return None;
            }
            let g = gradient(&f, *p, h);
            let l = g.len();
            (l.is_finite() && l > 0.3).then(|| g * (1.0 / l))
        })
        .collect()
}

/// Moves vertices next to a crease (a flat band's corner, a bezel's rim, a seat's edge) onto it:
/// where the true surface's normals round a vertex part by more than about 30°, the vertex goes
/// to the point that best meets the tangent planes there ([`qef_point`]) when that lies on the
/// surface within [`MAX_SNAP`] steps. The nearest go first, and no triangle gets more than two of
/// its corners moved, so none is flattened onto the crease line.
/// Only vertices not moved yet are tried; how many were moved.
#[allow(clippy::too_many_arguments)]
fn sharpen(
    positions: &mut [Vec3],
    smooth: &[Vec3],
    normals: &[Option<Vec3>],
    tris: &[[u32; 3]],
    around: &[Vec<u32>],
    snapped: &mut [bool],
    step: f64,
    field: &dyn Fn(usize, Vec3) -> f64,
) -> usize {
    let mut wanted: Vec<(f64, u32, Vec3)> = Vec::new();
    let mut ring: Vec<u32> = Vec::new();
    for (v, p) in positions.iter().enumerate() {
        if snapped.get(v).copied().unwrap_or(true) {
            continue;
        }
        let Some(Some(nv)) = normals.get(v) else { continue };
        ring.clear();
        for &ti in around.get(v).map_or(&[][..], Vec::as_slice) {
            if let Some(t) = tris.get(ti as usize) {
                ring.extend(t.iter().copied());
            }
        }
        ring.sort_unstable();
        ring.dedup();
        let planes: Vec<(Vec3, Vec3)> = ring.iter().filter_map(|j| Some((*smooth.get(*j as usize)?, (*normals.get(*j as usize)?)?))).collect();
        if !planes.iter().any(|(_, n)| n.dot(*nv) < CREASE_COS) {
            continue;
        }
        let Some(x) = qef_point(*p, &planes) else { continue };
        let d = (x - *p).len();
        if !(d > 1e-6 * step && d <= MAX_SNAP * step) {
            continue;
        }
        let fx = field(v, x);
        if !(fx.is_finite() && fx.abs() <= 0.02 * step) {
            continue;
        }
        wanted.push((d, u32::try_from(v).unwrap_or(u32::MAX), x));
    }
    wanted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let is = |v: &u32| snapped.get(*v as usize).copied().unwrap_or(false);
    let mut moved_in: Vec<u8> = tris.iter().map(|t| t.iter().filter(|v| is(v)).count() as u8).collect();
    let mut count = 0usize;
    for (_, v, x) in wanted {
        let ts = around.get(v as usize).map_or(&[][..], Vec::as_slice);
        if ts.iter().any(|t| moved_in.get(*t as usize).copied().unwrap_or(2) >= 2) {
            continue;
        }
        let Some(old) = positions.get(v as usize).copied() else { continue };
        let normal = |ps: &[Vec3], t: [u32; 3]| {
            let at = |i: u32| ps.get(i as usize).copied().unwrap_or(Vec3::ZERO);
            (at(t[1]) - at(t[0])).cross(at(t[2]) - at(t[0]))
        };
        let before: Vec<Vec3> = ts.iter().filter_map(|t| tris.get(*t as usize)).map(|t| normal(positions, *t)).collect();
        if let Some(p) = positions.get_mut(v as usize) {
            *p = x;
        }
        // Not if a triangle round it turns over or is left a sliver.
        let bad = ts.iter().filter_map(|t| tris.get(*t as usize)).zip(&before).any(|(t, n0)| {
            let n1 = normal(positions, *t);
            n1.dot(*n0) <= 0.0 || n1.len() < 2.0 * SLIVER * step * step
        });
        if bad {
            if let Some(p) = positions.get_mut(v as usize) {
                *p = old;
            }
            continue;
        }
        for t in ts {
            if let Some(m) = moved_in.get_mut(*t as usize) {
                *m += 1;
            }
        }
        if let Some(f) = snapped.get_mut(v as usize) {
            *f = true;
        }
        count += 1;
    }
    count
}

/// Whether the segment `p`–`q` passes through the inside of triangle `t`.
fn segment_crosses(p: Vec3, q: Vec3, t: &[Vec3; 3]) -> bool {
    let [t0, t1, t2] = *t;
    let (e1, e2, d) = (t1 - t0, t2 - t0, q - p);
    let h = d.cross(e2);
    let a = e1.dot(h);
    if a.is_nan() || a.abs() < 1e-14 {
        return false;
    }
    let f = 1.0 / a;
    let s = p - t0;
    let u = f * s.dot(h);
    let qv = s.cross(e1);
    let v = f * d.dot(qv);
    let w = f * e2.dot(qv);
    let eps = 1e-9;
    u > -eps && v > -eps && u + v < 1.0 + eps && w > -eps && w < 1.0 + eps
}

/// The vertices of every pair of triangles, sharing no vertex, one of them in `check`, that pass
/// through each other: each triangle binned by its centroid in cells of 2.5 steps and the
/// 27 cells around each checked one searched (a moved triangle is never longer than about
/// two and a half steps).
fn crossings(positions: &[Vec3], tris: &[[u32; 3]], check: &[u32], step: f64) -> Vec<u32> {
    if check.is_empty() {
        return Vec::new();
    }
    crossings_in(positions, tris, &bin_triangles(positions, tris, step), check, step)
}

/// The triangles binned by centroid for [`crossings_in`].
type Bins = HashMap<(i64, i64, i64), Vec<u32>>;

fn bin_key(p: Vec3, step: f64) -> (i64, i64, i64) {
    let cell = 2.5 * step;
    ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64, (p.z / cell).floor() as i64)
}

fn bin_triangles(positions: &[Vec3], tris: &[[u32; 3]], step: f64) -> Bins {
    let pos = |i: u32| positions.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let mut bins: Bins = HashMap::new();
    for (i, t) in tris.iter().enumerate() {
        let c = (pos(t[0]) + pos(t[1]) + pos(t[2])) * (1.0 / 3.0);
        bins.entry(bin_key(c, step)).or_default().push(u32::try_from(i).unwrap_or(u32::MAX));
    }
    bins
}

/// [`crossings`] with the triangles already binned (a triangle changed since by less than a step
/// is still found).
fn crossings_in(positions: &[Vec3], tris: &[[u32; 3]], bins: &Bins, check: &[u32], step: f64) -> Vec<u32> {
    let pos = |i: u32| positions.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let key = |p: Vec3| bin_key(p, step);
    let boxed = |v: &[Vec3; 3]| {
        let mut b = (v[0], v[0]);
        grow(&mut b, v[1]);
        grow(&mut b, v[2]);
        b
    };
    let mut out = Vec::new();
    for &i in check {
        let Some(t) = tris.get(i as usize) else { continue };
        let tv = [pos(t[0]), pos(t[1]), pos(t[2])];
        let (tlo, thi) = boxed(&tv);
        let (x, y, z) = key((tv[0] + tv[1] + tv[2]) * (1.0 / 3.0));
        for dz in -1..=1 {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let Some(list) = bins.get(&(x + dx, y + dy, z + dz)) else { continue };
                    for &j in list {
                        let Some(u) = tris.get(j as usize) else { continue };
                        if j == i || t.iter().any(|v| u.contains(v)) {
                            continue;
                        }
                        let uv = [pos(u[0]), pos(u[1]), pos(u[2])];
                        let (ulo, uhi) = boxed(&uv);
                        if ulo.x > thi.x || ulo.y > thi.y || ulo.z > thi.z || tlo.x > uhi.x || tlo.y > uhi.y || tlo.z > uhi.z {
                            continue;
                        }
                        let hit = (0..3).any(|k| {
                            let (a, b) = (k, (k + 1) % 3);
                            segment_crosses(tv[a], tv[b], &uv) || segment_crosses(uv[a], uv[b], &tv)
                        });
                        if hit {
                            out.extend(t.iter().chain(u.iter()).copied());
                        }
                    }
                }
            }
        }
    }
    out
}
