//! A channel setting's rails as the display mesh draws them, and the cast solid's parts
//! ([`super::super::channel`]): each stone's length of each rail one closed, outward shell.

use cadcraft_geom::Vec3;

use super::super::channel::{ChannelBound, ChannelPiece};
use super::*;

/// One rail of a piece: its rectangle (across × radius) swept round from `from` to `to`.
fn rail(to: &mut Buf, c: &ChannelPiece, side: f64, steps: usize) {
    let (z0, z1) = (c.z + side * c.inner, c.z + side * c.outer);
    if !(c.to > c.from && c.top > c.bottom && (z1 - z0).abs() > 1e-6 && z0.is_finite() && z1.is_finite()) {
        return;
    }
    let steps = steps.clamp(1, 64);
    let mut part = Buf::default();
    // Each section's four corners, counter-clockwise seen along the sweep.
    let section = |a: f64| -> [Vec3; 4] {
        let r = Vec3::new(a.sin(), a.cos(), 0.0);
        [r * c.bottom + Vec3::Z * z0, r * c.bottom + Vec3::Z * z1, r * c.top + Vec3::Z * z1, r * c.top + Vec3::Z * z0]
    };
    let rings: Vec<Ring> = (0..=steps).map(|k| part.ring(section(c.from + (c.to - c.from) * k as f64 / steps as f64))).collect();
    for pair in rings.windows(2) {
        if let [a, b] = pair {
            part.bridge(*a, *b);
        }
    }
    // The two end faces.
    if let (Some(first), Some(last)) = (rings.first(), rings.last()) {
        part.tri(first.at(0), first.at(2), first.at(1));
        part.tri(first.at(0), first.at(3), first.at(2));
        part.tri(last.at(0), last.at(1), last.at(2));
        part.tri(last.at(0), last.at(2), last.at(3));
    }
    if part.idx.is_empty() {
        return;
    }
    // Wound outward whichever way the side runs.
    let flip = signed_volume(&part.pos, &part.idx) < 0.0;
    let base = u32::try_from(to.pos.len()).unwrap_or(u32::MAX);
    to.pos.extend(part.pos);
    for t in part.idx.chunks_exact(3) {
        let (Some(a), Some(b), Some(cc)) = (t.first(), t.get(1), t.get(2)) else { continue };
        let (a, b, cc) = (base.saturating_add(*a), base.saturating_add(*b), base.saturating_add(*cc));
        if flip { to.tri(a, cc, b) } else { to.tri(a, b, cc) }
    }
}

/// Every piece's rails into the channel's mesh, and its rails (added) and channel (cut) into the solid.
pub(super) fn build(out: &mut Parts, pieces: &[ChannelPiece], radial: usize) {
    for c in pieces {
        let steps = (((c.to - c.from) * c.top / 0.3).ceil() as usize).clamp(1, radial.clamp(4, 32));
        for side in [-1.0, 1.0] {
            rail(&mut out.channel, c, side, steps);
        }
        out.csg.add.push(Prim::Channel(ChannelBound { piece: *c, opening: false }));
        out.csg.cut.push(Prim::Channel(ChannelBound { piece: *c, opening: true }));
    }
}
