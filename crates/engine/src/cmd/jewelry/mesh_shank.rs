//! The solid of the shank shapes (`PIECEMESH`): a band swept along its rail, a split or cathedral
//! shank, a twisted cable. Every shell is closed and wound outward; the cast solid gets each as a
//! signed-distance primitive ([`super::super::sweep::RailBound`], [`super::super::shank::ShankBound`],
//! the cable's strands as round wires). The numbers are [`super::super::shank`]'s.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};

use super::super::shank::{self, ShankBound};
use super::super::sweep::{self, RailBound};
use super::*;

/// Points round each strand's wire for the cast solid's wires, per run.
const WIRE_RUN: usize = 16;

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

/// Rings joined round into one closed tube.
fn tube(to: &mut Buf, rings: impl Iterator<Item = Vec<Vec3>>) {
    let mut part = Buf::default();
    let (mut first, mut prev): (Option<Ring>, Option<Ring>) = (None, None);
    for pts in rings {
        let ring = part.ring(pts);
        if let Some(p) = prev {
            part.bridge(p, ring);
        }
        first = first.or(Some(ring));
        prev = Some(ring);
    }
    if let (Some(a), Some(b)) = (prev, first) {
        part.bridge(a, b);
    }
    outward(to, part);
}

/// Whether the band is one of the shank shapes this module builds.
pub(super) fn shaped(p: &PieceParams) -> bool {
    p.shape.any()
}

fn polygon_of(s: &Sane, m: usize) -> Vec<Vec2> {
    let polygon = s.section.polygon(m);
    if polygon.len() < 3 { Section::flat(s.p.width, s.p.wall).polygon(m) } else { polygon }
}

/// The band of a shaped shank, and its primitive in the cast solid.
pub(super) fn build(to: &mut Buf, csg: &mut Csg, s: &Sane, d: &Detail) {
    let sh = &s.p.shape;
    let m = (d.dome.clamp(2, 256) / 2) * 2;
    if let Some(c) = shank::cable(&s.p) {
        let per = (d.band / 8).clamp(8, 24);
        let sides = d.radial.clamp(6, 16);
        for j in 0..c.strands {
            let axis = c.axis(j, per);
            let n = axis.len();
            let r = c.wire / 2.0;
            // The polygon round the wire encloses the wire's own area, so the mesh weighs what the strand does.
            let ring_r = r * (TAU / (sides as f64 * (TAU / sides as f64).sin())).sqrt();
            tube(
                to,
                (0..n).map(|i| {
                    let theta = TAU * i as f64 / n as f64;
                    let (prev, next) = (axis.get((i + n - 1) % n).copied().unwrap_or_default(), axis.get((i + 1) % n).copied().unwrap_or_default());
                    let t = (next - prev).normalized();
                    // The ring's outward radial, square to the axis's tangent.
                    let radial = Vec3::new(theta.sin(), theta.cos(), 0.0);
                    let u = (radial - t * radial.dot(t)).normalized();
                    let v = t.cross(u);
                    let o = axis.get(i).copied().unwrap_or_default();
                    (0..sides)
                        .map(|k| {
                            let a = TAU * k as f64 / sides as f64;
                            o + (u * a.cos() + v * a.sin()) * ring_r
                        })
                        .collect()
                }),
            );
            // The cast solid: the strand as round wires, in runs, so each grid block meets few.
            let fine = c.axis(j, 96);
            let n = fine.len();
            let mut start = 0;
            while start < n {
                let end = (start + WIRE_RUN).min(n);
                let pts: Vec<Vec3> = (start..=end).filter_map(|i| fine.get(i % n).copied()).collect();
                csg.add.push(Prim::Wire { pts, r, closed: false });
                start = end;
            }
        }
        return;
    }
    if let Some(rail) = &sh.rail {
        csg.add.push(Prim::Rail(RailBound::new(rail.fine(s.p.inner()), polygon_of(s, SOLID_SECTION))));
        let polygon = polygon_of(s, m);
        let n = (d.band.clamp(8, 1024) / 4) * 8;
        let path = sweep::resample(&rail.scaled(s.p.inner()), n);
        let normals = sweep::normals(&path);
        tube(
            to,
            path.iter().zip(&normals).map(|(at, out)| {
                polygon
                    .iter()
                    .map(|q| {
                        let xy = *at + *out * q.y;
                        Vec3::new(xy.x, xy.y, q.x)
                    })
                    .collect()
            }),
        );
        return;
    }
    // A split or cathedral shank: each arm (or the whole band) its own closed loop round the
    // finger, the arms touching where they are not parted.
    csg.add.push(Prim::Shank(ShankBound::new(sh, polygon_of(s, SOLID_SECTION), s.p.width, s.ri)));
    let polygon = polygon_of(s, m);
    let pieces = if sh.split > 1 { shank::strips(&polygon, s.p.width, sh.split) } else { vec![polygon] };
    let n = (d.band.clamp(8, 1024) / 4) * 8;
    for (i, piece) in pieces.iter().enumerate() {
        if piece.len() < 3 {
            continue;
        }
        tube(
            to,
            (0..n).map(|k| {
                let a = TAU * k as f64 / n as f64;
                let theta = PI / 2.0 - a;
                let (lift, shift) = (sh.lift() * sh.s(theta), sh.shift(i as u32, theta));
                let (c, sn) = (a.cos(), a.sin());
                piece
                    .iter()
                    .map(|q| {
                        let r = s.ri + q.y + lift;
                        Vec3::new(r * c, r * sn, q.x + shift)
                    })
                    .collect()
            }),
        );
    }
}
