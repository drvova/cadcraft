//! Catmull–Clark subdivision of a [`SubdCage`], with boundary and crease rules.
//!
//! Implemented from the published rules (Catmull and Clark 1978; the sharp and semi-sharp crease
//! rules of Hoppe et al. 1994 and DeRose, Kass and Truong 1998):
//!
//! * **face point**: the average of the face's vertices;
//! * **edge point**: smooth edges `(v0 + v1 + f0 + f1) / 4`; sharp and boundary edges the
//!   midpoint; a fractional sharpness `s < 1` blends the two by `s`. The two child edges carry
//!   sharpness `s − 1` (infinite stays infinite);
//! * **vertex point**: with fewer than two sharp edges (smooth or dart) the smooth rule
//!   `(Q + 2R + (n − 3)v) / n`; with two (crease, and every boundary vertex) the curve rule
//!   `(a + 6v + b) / 8`; with three or more, or a corner tag, the vertex stays. When the sharp
//!   edges' mean sharpness is below 1 the result blends towards the smooth rule.
//!
//! Boundary edges are treated as infinitely sharp creases, so open edges subdivide as uniform
//! cubic B-spline curves of the boundary polygon and a corner tag pins a boundary vertex.

use crate::Vec3;
use crate::subd_cage::{MAX_CAGE_FACES, SHARP, SubdCage, SubdError, edge_key};
use std::collections::BTreeMap;

/// Most subdivision levels one call may apply.
pub const MAX_SUBD_LEVELS: u32 = 8;

/// The number of faces one level of subdivision produces.
pub fn subdivided_face_count(cage: &SubdCage) -> usize {
    cage.he_count()
}

/// How a vertex is treated by the rules.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum VertexKind {
    Smooth,
    /// Two sharp edges: the other ends of those edges.
    Crease(u32, u32),
    Corner,
}

/// The rule for vertex `v` and the mean sharpness of its sharp edges.
pub(crate) fn vertex_kind(cage: &SubdCage, v: u32, fan: &mut Vec<u32>) -> (VertexKind, f64) {
    let closing = cage.fan(v, fan);
    // On the boundary only fully sharp edges count: the smooth rule has no boundary form.
    let boundary = closing.is_some();
    let mut ends: [u32; 2] = [0, 0];
    let mut n = 0usize;
    let mut sum = 0.0;
    let mut visit = |e: usize, other: u32| {
        let s = cage.rule_sharpness(e);
        if s > 0.0 && (!boundary || s >= 1.0) {
            if n < 2 {
                ends[n] = other;
            }
            n += 1;
            sum += s.min(1.0);
        }
    };
    for &h in fan.iter() {
        visit(cage.he_edge(h), cage.dest(h));
    }
    if let Some(p) = closing {
        visit(cage.he_edge(p), cage.origin(p));
    }
    let mean = if boundary {
        1.0
    } else if n > 0 {
        sum / n as f64
    } else {
        0.0
    };
    if cage.corners().contains(&v) || n >= 3 {
        (VertexKind::Corner, if cage.corners().contains(&v) { 1.0 } else { mean })
    } else if n == 2 {
        (VertexKind::Crease(ends[0], ends[1]), mean)
    } else {
        (VertexKind::Smooth, 0.0)
    }
}

/// One level of Catmull–Clark subdivision. The result is all quads and again a valid cage.
pub fn subdivide(cage: &SubdCage) -> Result<SubdCage, SubdError> {
    let nv = cage.vertex_count();
    let ne = cage.edge_count();
    let nf = cage.face_count();
    let n_out = subdivided_face_count(cage);
    if n_out > MAX_CAGE_FACES {
        return Err(SubdError::TooLarge(format!("subdividing would make {n_out} faces (at most {MAX_CAGE_FACES})")));
    }
    let p = cage.positions();
    let fv = cage.face_verts();
    let fs = cage.face_start();

    // Face points.
    let mut face_pt = Vec::with_capacity(nf);
    for f in 0..nf {
        let (a, b) = cage.face_range(f);
        let mut c = Vec3::ZERO;
        for &v in &fv[a..b] {
            c = c + p[v as usize];
        }
        face_pt.push(c * (1.0 / (b - a) as f64));
    }
    // Edge points.
    let mut edge_pt = Vec::with_capacity(ne);
    for e in 0..ne {
        let h = cage.edge_he(e);
        let (a, b) = cage.he_ends(h);
        let mid = (p[a as usize] + p[b as usize]) * 0.5;
        let s = cage.rule_sharpness(e);
        let pt = match cage.twin(h) {
            Some(t) if s < 1.0 => {
                let smooth = (p[a as usize] + p[b as usize] + face_pt[cage.he_face(h)] + face_pt[cage.he_face(t)]) * 0.25;
                smooth + (mid - smooth) * s
            }
            _ => mid,
        };
        edge_pt.push(pt);
    }
    // Vertex points.
    let mut vert_pt = Vec::with_capacity(nv);
    let mut fan = Vec::new();
    for v in 0..nv as u32 {
        let pv = p[v as usize];
        let (kind, w) = vertex_kind(cage, v, &mut fan);
        let smooth = || -> Vec3 {
            // Only interior vertices reach here with full weight; a blended boundary vertex is
            // impossible because boundary edges are infinitely sharp (w = 1).
            let n = fan.len() as f64;
            let mut q = Vec3::ZERO;
            let mut r = Vec3::ZERO;
            for &h in fan.iter() {
                q = q + face_pt[cage.he_face(h)];
                r = r + (pv + p[cage.dest(h) as usize]) * 0.5;
            }
            (q * (1.0 / n) + r * (2.0 / n) + pv * (n - 3.0)) * (1.0 / n)
        };
        let sharp_pt = match kind {
            VertexKind::Smooth => None,
            VertexKind::Crease(a, b) => Some((p[a as usize] + pv * 6.0 + p[b as usize]) * 0.125),
            VertexKind::Corner => Some(pv),
        };
        let pt = match sharp_pt {
            None => smooth(),
            Some(q) if w >= 1.0 => q,
            Some(q) => {
                let s = smooth();
                s + (q - s) * w
            }
        };
        vert_pt.push(pt);
    }

    let mut positions = vert_pt;
    positions.extend_from_slice(&edge_pt);
    positions.extend_from_slice(&face_pt);
    let e_base = nv as u32;
    let f_base = (nv + ne) as u32;

    let mut face_start = Vec::with_capacity(n_out + 1);
    let mut face_verts = Vec::with_capacity(n_out * 4);
    face_start.push(0u32);
    for f in 0..nf {
        let (a, b) = (fs[f], fs[f + 1]);
        for h in a..b {
            let pr = cage.prev(h);
            face_verts.extend_from_slice(&[fv[h as usize], e_base + cage.he_edge(h) as u32, f_base + f as u32, e_base + cage.he_edge(pr) as u32]);
            face_start.push(face_verts.len() as u32);
        }
    }
    let mut creases = BTreeMap::new();
    for e in 0..ne {
        let s = cage.edge_sharpness(e);
        if s <= 0.0 {
            continue;
        }
        let child = if s == SHARP { SHARP } else { s - 1.0 };
        if child > 0.0 {
            let (a, b) = cage.he_ends(cage.edge_he(e));
            let m = e_base + e as u32;
            creases.insert(edge_key(a, m), child);
            creases.insert(edge_key(m, b), child);
        }
    }
    SubdCage::from_flat(positions, face_start, face_verts, creases, cage.corners().clone())
}

/// `levels` levels of subdivision (0 returns a copy). Refused beyond [`MAX_SUBD_LEVELS`] or when
/// the result would exceed the face cap, before any work is done.
pub fn subdivide_levels(cage: &SubdCage, levels: u32) -> Result<SubdCage, SubdError> {
    if levels > MAX_SUBD_LEVELS {
        return Err(SubdError::TooLarge(format!("{levels} subdivision levels (at most {MAX_SUBD_LEVELS})")));
    }
    let mut faces = cage.face_count() as u128;
    let first = subdivided_face_count(cage) as u128;
    for l in 0..levels {
        faces = if l == 0 { first } else { faces * 4 };
        if faces > MAX_CAGE_FACES as u128 {
            return Err(SubdError::TooLarge(format!("{levels} levels would make {faces} faces (at most {MAX_CAGE_FACES})")));
        }
    }
    let mut c = cage.clone();
    for _ in 0..levels {
        c = subdivide(&c)?;
    }
    Ok(c)
}
