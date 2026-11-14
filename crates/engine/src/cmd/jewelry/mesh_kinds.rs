//! The solid of the newer heads and kinds (`PIECEMESH`): a bezel's collar, a half eternity's
//! row, a dome ring's or a signet's tapered shank, and a signet's face plate. Each is one closed
//! shell (or one per stone), wound to face outward, as the other parts are; every number comes
//! from [`super::super::heads`] and [`super::super::kinds`].

use cadcraft_geom::{PI, TAU, Vec2, Vec3};

use super::super::heads::Bezel;
use super::*;

/// Append `part`'s triangles to `to`, turned inside out first when they enclose a negative
/// volume, so the shell faces outward whichever way its outline ran.
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

/// A bezel's collar around a stone's girdle: its section ([`Bezel::profile`]) swept along the
/// girdle polygon, each corner offset along its own outward normal. One closed shell.
pub(super) fn build_bezel(to: &mut Buf, frame: &Frame, poly: &[Vec2], normals: &[Vec2], bezel: &Bezel) {
    let mut part = Buf::default();
    let profile = bezel.profile();
    let mut first: Option<Ring> = None;
    let mut prev: Option<Ring> = None;
    // Each corner moves along its mitre, so the wall keeps its thickness round a sharp corner (a
    // princess's, an emerald's), not only along the straight runs.
    let count = poly.len();
    let mitred: Vec<Vec2> = (0..count)
        .map(|i| {
            let (Some(prev_q), Some(q), Some(next_q), Some(n)) =
                (poly.get((i + count - 1) % count), poly.get(i), poly.get((i + 1) % count), normals.get(i))
            else {
                return Vec2::ZERO;
            };
            let edge = |a: Vec2, b: Vec2| {
                let p = (b - a).perp().normalized();
                if p.dot(*n) < 0.0 { p * -1.0 } else { p }
            };
            let (e1, e2) = (edge(*prev_q, *q), edge(*q, *next_q));
            let denom = 1.0 + e1.dot(e2);
            if denom > 0.3 && e1.is_finite() && e2.is_finite() { (e1 + e2) * (1.0 / denom) } else { *n }
        })
        .collect();
    for (q, n) in poly.iter().zip(&mitred) {
        let ring = part.ring(profile.iter().map(|s| {
            let at = *q + *n * s.x;
            frame.at(at.x, at.y, s.y)
        }));
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

/// A tapered shank: the band's bottom section scaled across and up as it goes round
/// ([`super::super::kinds::Taper::scale`]), so the mesh is inscribed in the solid the sheet weighs.
pub(super) fn build_tapered_band(to: &mut Buf, csg: &mut Csg, s: &Sane, d: &Detail) {
    let mut fine = s.section.polygon(SOLID_SECTION);
    if fine.len() < 3 {
        fine = Section::flat(s.p.width, s.p.wall).polygon(SOLID_SECTION);
    }
    csg.add.push(Prim::Taper { taper: s.p.taper(), section: solid::Section::new(fine), ri: s.ri });
    let m = (d.dome.clamp(2, 256) / 2) * 2;
    let mut polygon = s.section.polygon(m);
    if polygon.len() < 3 {
        polygon = Section::flat(s.p.width, s.p.wall).polygon(m);
    }
    let taper = s.p.taper();
    let n = (d.band.clamp(8, 1024) / 4) * 4;
    let mut part = Buf::default();
    let mut first: Option<Ring> = None;
    let mut prev: Option<Ring> = None;
    for i in 0..n {
        let a = TAU * i as f64 / n as f64;
        // From 12 o'clock (+Y), clockwise seen from +Z: the direction the band's rings run.
        let theta = PI / 2.0 - a;
        let (sx, sy) = taper.scale(theta);
        let (c, sn) = (a.cos(), a.sin());
        let ring = part.ring(polygon.iter().map(|q| {
            let r = s.ri + q.y * sy;
            Vec3::new(r * c, r * sn, q.x * sx)
        }));
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

/// A signet's face plate: its outline in plan between its underside and its top. One closed shell.
pub(super) fn build_face(to: &mut Buf, csg: &mut Csg, s: &Sane, d: &Detail) {
    let face = s.p.signet_face();
    csg.add.push(Prim::Face { face, outline: face.outline(128) });
    let outline = face.outline(d.outline.max(16));
    let mut part = Buf::default();
    let bottom = part.ring(outline.iter().map(|q| Vec3::new(q.x, face.bottom, q.y)));
    let top = part.ring(outline.iter().map(|q| Vec3::new(q.x, face.top, q.y)));
    part.bridge(bottom, top);
    let under = part.v(Vec3::new(0.0, face.bottom, 0.0));
    part.cap_start(under, bottom);
    let over = part.v(Vec3::new(0.0, face.top, 0.0));
    part.cap_end(top, over);
    outward(to, part);
}

/// A half eternity: the eternity row's stones across the top half, packed at the least pitch
/// that keeps the gap, and two bead prongs between neighbours close enough to share them.
pub(super) fn build_half_eternity(s: &Sane, d: &Detail, out: &mut Parts) {
    let p = &s.p;
    let Some(cut) = p.cut_data() else { return };
    let half = p.half_row();
    let row = half.row;
    let n = half.count(p.count);
    out.fits = Some(half.most);
    let (m, radius, depth) = (row.melee, row.melee / 2.0, row.depth);
    let shape = StoneShape::of(cut, m, m, depth, 16 * d.melee.clamp(1, 8));
    let seat_r = if shape.cab { row.top - depth } else { row.radius };
    // Seats as an eternity band's: a bore up through the outside and a hole down to the finger.
    let (girdle, crown, pavilion) = if shape.cab { (0.0, depth, 0.0) } else { proportions(depth) };
    let bore = (s.ri + p.wall + BORE_OVER - seat_r).max(girdle / 2.0 + crown + SEAT_CLEARANCE);
    let through = seat_r - s.ri + BORE_OVER;
    for k in 0..n {
        let o = half.out(k, n);
        let w = Vec3::new(o.x, o.y, 0.0);
        let f = Frame { o: w * seat_r, u: Vec3::new(-w.y, w.x, 0.0), v: Vec3::Z, w };
        shape.build(&mut out.melee, &f, d.melee, 2);
        let mut envelope = seat_envelope(&shape, &f, girdle, crown, pavilion, Some(bore));
        fit_seat(&mut envelope, d, &|b, dd| StoneShape::of(cut, m, m, depth, 16 * dd.melee.clamp(1, 8)).build(b, &f, dd.melee, 2));
        out.csg.cut.push(Prim::Cylinder { axes: axes_of(&f), r: PAVE_HOLE * envelope.reach, lo: -through, hi: 0.0 });
        out.csg.cut.push(Prim::Seat(envelope));
        out.seats += 1;
    }
    out.stones += n;
    let rb = (0.16 * m).clamp(0.2, 0.5);
    let half_pitch = row.radius * (half.pitch / 2.0).sin();
    if n >= 2 && half_pitch <= radius + 0.8 * rb {
        let reach = radius + 0.6 * rb;
        let z0 = (reach * reach - half_pitch * half_pitch).max(0.0).sqrt().min((p.width / 2.0 - rb).max(0.0));
        let zs: &[f64] = if z0 < 0.6 * rb { &[0.0] } else { &[-1.0, 1.0] };
        for k in 0..n - 1 {
            let phi = (half.angle(k, n) + half.angle(k + 1, n)) / 2.0;
            let w = Vec3::new(phi.sin(), phi.cos(), 0.0);
            for sign in zs {
                let z = sign * z0;
                let r = (s.outside_at(z) - 0.2 * rb).max(s.ri + rb + 0.02);
                bead(&mut out.beads, w * r + Vec3::Z * z, w, rb, d.bead_radial, d.bead_lat);
                out.csg.add.push(Prim::Sphere { c: w * r + Vec3::Z * z, r: rb });
            }
        }
    }
    if half.most == 0 {
        out.notes.push(format!("No {} mm stone fits across the top of this band (PIECE refuses it); the {n} shown overlap.", size_json(m)));
    } else if n > half.most {
        out.notes.push(format!(
            "{n} stones of {} mm do not fit across the top half of this band (at most {} do, and PIECE refuses more); they run past 3 and 9 o'clock.",
            size_json(m),
            half.most
        ));
    }
    if shape.stand_in {
        out.notes.push(format!("A {} of {} mm has no usable girdle outline; the stones are shown as rounds.", cut.name, size_json(m)));
    }
    out.notes.push(
        "The band and the bead prongs are separate closed shells that pass through each other, and no seat is cut for a stone; the bottom of the shank is plain for sizing."
            .to_string(),
    );
}
