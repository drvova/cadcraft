//! The display mesh of a styled prong's top ([`super::super::prongs::top_parts`]): a claw's
//! tapered cone and a tab's or V's bars, each one closed shell wound to face outward.

use cadcraft_geom::{PI, TAU, Vec3};

use super::super::prongs::ProngPart;
use super::*;

/// Append `part`'s triangles to `to`, turned inside out first when they enclose a negative volume.
fn outward(to: &mut Buf, part: Buf) {
    if part.idx.is_empty() {
        return;
    }
    let flip = signed_volume(&part.pos, &part.idx) < 0.0;
    let base = u32::try_from(to.pos.len()).unwrap_or(u32::MAX);
    to.pos.extend(part.pos);
    for t in part.idx.chunks_exact(3) {
        let (Some(a), Some(b), Some(c)) = (t.first(), t.get(1), t.get(2)) else { continue };
        let (a, b, c) = (base.saturating_add(*a), base.saturating_add(*b), base.saturating_add(*c));
        if flip { to.tri(a, c, b) } else { to.tri(a, b, c) }
    }
}

/// A cone from radius `ra` at `a` to `rb` at `b`, closed by a ball cap at each end (each cap a
/// hemisphere of its own radius): one closed shell.
fn cone(to: &mut Buf, a: Vec3, ra: f64, b: Vec3, rb: f64, radial: usize, cap: usize) {
    let axis = b - a;
    if !(axis.len() > 1e-6 && ra.is_finite() && rb.is_finite() && ra > 1e-6 && rb > 1e-6 && a.is_finite() && b.is_finite()) {
        return;
    }
    let t = axis.normalized();
    let n = any_perp(t);
    let m = t.cross(n);
    let (radial, cap) = (radial.clamp(3, 64), cap.clamp(1, 16));
    let circle = |c: Vec3, r: f64| {
        (0..radial).map(move |k| {
            let ang = TAU * k as f64 / radial as f64;
            c + (n * ang.cos() + m * ang.sin()) * r
        })
    };
    let mut part = Buf::default();
    let pole0 = part.v(a - t * ra);
    let mut prev: Option<Ring> = None;
    let mut link = |part: &mut Buf, ring: Ring| {
        match prev {
            Some(p) => part.bridge(p, ring),
            None => part.cap_start(pole0, ring),
        }
        prev = Some(ring);
    };
    for j in (1..cap).rev() {
        let ang = (PI / 2.0) * j as f64 / cap as f64;
        let ring = part.ring(circle(a - t * (ra * ang.sin()), ra * ang.cos()));
        link(&mut part, ring);
    }
    let ring = part.ring(circle(a, ra));
    link(&mut part, ring);
    let ring = part.ring(circle(b, rb));
    link(&mut part, ring);
    for j in 1..cap {
        let ang = (PI / 2.0) * j as f64 / cap as f64;
        let ring = part.ring(circle(b + t * (rb * ang.sin()), rb * ang.cos()));
        link(&mut part, ring);
    }
    let pole1 = part.v(b + t * rb);
    if let Some(p) = prev {
        part.cap_end(p, pole1);
    }
    outward(to, part);
}

/// A box: eight corners, twelve triangles.
fn bar(to: &mut Buf, c: Vec3, x: Vec3, y: Vec3, z: Vec3, h: Vec3) {
    if !(c.is_finite() && h.is_finite() && h.x > 1e-6 && h.y > 1e-6 && h.z > 1e-6) {
        return;
    }
    let mut part = Buf::default();
    let corner = |i: u32| -> Vec3 {
        let s = |bit: u32| if i & bit != 0 { 1.0 } else { -1.0 };
        c + x * (s(1) * h.x) + y * (s(2) * h.y) + z * (s(4) * h.z)
    };
    let v: Vec<u32> = (0..8).map(|i| part.v(corner(i))).collect();
    let at = |i: usize| v.get(i).copied().unwrap_or(0);
    // Each face as a quad of corner numbers, wound one way; `outward` puts it right.
    for [a, b, cc, d] in [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] {
        part.tri(at(a), at(b), at(cc));
        part.tri(at(a), at(cc), at(d));
    }
    outward(to, part);
}

/// Every part of a styled prong's top into the prongs' mesh.
pub(super) fn build_parts(to: &mut Buf, parts: &[ProngPart], radial: usize, cap: usize) {
    for part in parts {
        match *part {
            ProngPart::Cone { a, ra, b, rb } => cone(to, a, ra, b, rb, radial, cap),
            ProngPart::Bar { c, x, y, z, h } => bar(to, c, x, y, z, h),
        }
    }
}
