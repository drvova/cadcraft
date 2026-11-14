//! The solid of a piece not worn on a finger (`PIECEMESH`, `STLOUT` with `kind: pendant | stud |
//! drop`): the head built as a solitaire's is (the stone, its prongs and gallery rail or its
//! collar, the halo and its seat, every seat cut) standing on the plane Y = 0 instead of a band,
//! with its base (a wire ring through the prongs' feet and a cross to the middle, or a cross
//! under the collar) and the findings laid out in [`super::super::findings`]. The findings'
//! frame runs up the piece along +Z of the stone's own plan; the solid's world has the stone's
//! length along −Z (as a ring's head has it), so a finding at `(x, y, z)` stands at `(x, y, −z)`.
//! A pair is two pieces side by side along X, `PAIR_GAP` apart.
//!
//! The jump rings and ear wires are bought in: they are their own part (`bought-in findings`)
//! and are not in the cast solid. A drop's head and its top are then separate cast bodies, as a
//! pair's two pieces are.

use cadcraft_geom::{TAU, Vec2, Vec3};

use super::super::findings::{self, Finding, Shape as F};
use super::*;

const X: Vec3 = Vec3 { x: 1.0, y: 0.0, z: 0.0 };
const Y: Vec3 = Vec3 { x: 0.0, y: 1.0, z: 0.0 };
const Z: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 1.0 };
/// Points around a finding's loop.
const LOOP_POINTS: usize = 48;

fn world(q: Vec3) -> Vec3 {
    Vec3::new(q.x, q.y, -q.z)
}

/// Append `part`, turned inside out first when it encloses a negative volume.
fn outward_into(to: &mut Buf, part: Buf) {
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

fn shift_buf(to: &mut Buf, from: Buf, by: Vec3) {
    let base = u32::try_from(to.pos.len()).unwrap_or(u32::MAX);
    to.pos.extend(from.pos.into_iter().map(|q| q + by));
    to.idx.extend(from.idx.into_iter().map(|i| base.saturating_add(i)));
}

/// A primitive moved by `by` (one a worn piece never holds is left as it is).
fn shift_prim(p: Prim, by: Vec3) -> Prim {
    match p {
        Prim::Wire { pts, r, closed } => Prim::Wire { pts: pts.into_iter().map(|q| q + by).collect(), r, closed },
        Prim::Sphere { c, r } => Prim::Sphere { c: c + by, r },
        Prim::Cylinder { axes, r, lo, hi } => Prim::Cylinder { axes: Axes { o: axes.o + by, ..axes }, r, lo, hi },
        Prim::Plate { axes, outline, inner, outer, lo, hi } => Prim::Plate { axes: Axes { o: axes.o + by, ..axes }, outline, inner, outer, lo, hi },
        Prim::Seat(mut e) => {
            e.axes.o = e.axes.o + by;
            Prim::Seat(e)
        }
        Prim::Bezel(mut b) => {
            b.o = b.o + by;
            Prim::Bezel(b)
        }
        Prim::Prong(prong) => Prim::Prong(prong.shifted(by)),
        other => other,
    }
}

fn merge(to: &mut Parts, from: Parts, by: Vec3) {
    let Parts {
        band,
        head,
        prongs,
        seat,
        beads,
        bezel,
        face,
        centre,
        sides,
        melee,
        pave,
        findings,
        bought,
        notes,
        stones,
        fits: _,
        csg,
        seats,
        channel,
        lettering,
        engraving,
    } = from;
    for (t, f) in [
        (&mut to.band, band),
        (&mut to.head, head),
        (&mut to.prongs, prongs),
        (&mut to.seat, seat),
        (&mut to.beads, beads),
        (&mut to.bezel, bezel),
        (&mut to.face, face),
        (&mut to.centre, centre),
        (&mut to.sides, sides),
        (&mut to.melee, melee),
        (&mut to.pave, pave),
        (&mut to.findings, findings),
        (&mut to.bought, bought),
        (&mut to.channel, channel),
        (&mut to.lettering, lettering),
        (&mut to.engraving, engraving),
    ] {
        shift_buf(t, f, by);
    }
    to.csg.add.extend(csg.add.into_iter().map(|p| shift_prim(p, by)));
    to.csg.cut.extend(csg.cut.into_iter().map(|p| shift_prim(p, by)));
    for n in notes {
        to.note(n);
    }
    to.stones = to.stones.saturating_add(stones);
    to.seats = to.seats.saturating_add(seats);
}

/// A straight round wire, cast.
fn rod(buf: &mut Buf, csg: &mut Csg, a: Vec3, b: Vec3, r: f64, d: &Detail) {
    capsule(buf, &[a, b], r, d.radial, d.cap);
    csg.add.push(Prim::Wire { pts: vec![a, b], r, closed: false });
}

/// One head and its base, the band's outside being the plane Y = 0.
fn head(p: &PieceParams, d: &Detail, out: &mut Parts) {
    let mut s = Sane::of(p);
    s.ri = 0.0;
    s.top = 0.0;
    build_solitaire(&s, d, out);
    // The solitaire's own note speaks of a band; a worn piece's head has its own note.
    out.notes.retain(|n| !(n.starts_with("The band, the gallery rail") || n.starts_with("This view draws the band")));
    let h = p.head();
    let y = findings::base_of(p);
    let middle = Vec3::new(0.0, y, 0.0);
    match h.bezel {
        Some(b) => {
            let (a, l) = (p.stone_width / 2.0 + b.wall / 2.0, p.stone_length / 2.0 + b.wall / 2.0);
            for end in [Vec3::new(a, y, 0.0), Vec3::new(-a, y, 0.0), Vec3::new(0.0, y, l), Vec3::new(0.0, y, -l)] {
                rod(&mut out.findings, &mut out.csg, middle, end, findings::BAR, d);
            }
        }
        None => {
            let r = h.prong / 2.0;
            let gh = h.girdle_height();
            let mut feet: Vec<(f64, Vec3)> = p
                .prong_sites()
                .unwrap_or_default()
                .into_iter()
                .filter(|q| q.is_finite())
                .map(|site| {
                    let (q, fh) = findings::foot(p, site);
                    (q.y.atan2(q.x), Vec3::new(q.x, gh + fh, -q.y))
                })
                .collect();
            feet.sort_by(|a, b| a.0.total_cmp(&b.0));
            let ring: Vec<Vec3> = feet.iter().map(|f| f.1).collect();
            if ring.len() >= 3 {
                let mut part = Buf::default();
                loop_wire(&mut part, &ring, Y, r, d.radial);
                outward_into(&mut out.findings, part);
                out.csg.add.push(Prim::Wire { pts: ring.clone(), r, closed: true });
            }
            for f in &ring {
                rod(&mut out.findings, &mut out.csg, middle, *f, r, d);
            }
        }
    }
}

/// One finding: its shell, and when it is cast its part of the solid.
fn finding(f: &Finding, d: &Detail, out: &mut Parts) {
    let buf = if f.cast { &mut out.findings } else { &mut out.bought };
    match &f.shape {
        F::Loop { c, axis, mean, wire } => {
            let pts: Vec<Vec3> = F::loop_points(*c, *axis, *mean, LOOP_POINTS).into_iter().map(world).collect();
            let mut part = Buf::default();
            loop_wire(&mut part, &pts, *axis, wire / 2.0, d.radial);
            outward_into(buf, part);
            if f.cast {
                out.csg.add.push(Prim::Wire { pts, r: wire / 2.0, closed: true });
            }
        }
        F::Tube { c, ri, ro, len, .. } => {
            let c = world(*c);
            let h = len / 2.0;
            let section = [Vec2::new(*ri, -h), Vec2::new(*ro, -h), Vec2::new(*ro, h), Vec2::new(*ri, h)];
            let n = (d.band.clamp(16, 192) / 4) * 4;
            let mut part = Buf::default();
            let (mut first, mut prev): (Option<Ring>, Option<Ring>) = (None, None);
            for i in 0..n {
                let a = TAU * i as f64 / n as f64;
                let out_dir = Y * a.cos() + Z * a.sin();
                let ring = part.ring(section.iter().map(|q| c + X * q.y + out_dir * q.x));
                if let Some(q) = prev {
                    part.bridge(q, ring);
                }
                first = first.or(Some(ring));
                prev = Some(ring);
            }
            if let (Some(a), Some(b)) = (prev, first) {
                part.bridge(a, b);
            }
            outward_into(buf, part);
            if f.cast {
                let axes = Axes { o: c, u: Y, v: Z, w: X };
                out.csg.add.push(Prim::Cylinder { axes, r: *ro, lo: -h, hi: h });
                out.csg.cut.push(Prim::Cylinder { axes, r: *ri, lo: -h - 0.5, hi: h + 0.5 });
            }
        }
        F::Wire { pts, wire } => {
            let pts: Vec<Vec3> = pts.iter().copied().map(world).collect();
            capsule(buf, &pts, wire / 2.0, d.radial, d.cap);
            if f.cast {
                out.csg.add.push(Prim::Wire { pts, r: wire / 2.0, closed: false });
            }
        }
    }
}

/// One piece: its head (and a drop's stud top), its base and its findings.
fn one(p: &PieceParams, lay: &findings::Layout, d: &Detail) -> Parts {
    let mut out = Parts::default();
    head(p, d, &mut out);
    if let Some((t, z)) = &lay.top {
        let mut top = Parts::default();
        head(t, d, &mut top);
        merge(&mut out, top, world(Vec3::new(0.0, 0.0, *z)));
    }
    for f in &lay.findings {
        finding(f, d, &mut out);
    }
    out
}

/// A pendant, or both pieces of a pair.
pub(super) fn build_worn(p: &PieceParams, d: &Detail, parts: &mut Parts) {
    let lay = findings::layout(p);
    if p.kind.pair() {
        let dx = lay.across + findings::PAIR_GAP / 2.0;
        for x in [-dx, dx] {
            merge(parts, one(p, &lay, d), Vec3::new(x, 0.0, 0.0));
        }
        parts.note("A pair: both pieces are built side by side, and the solid holds both (cast two).".to_string());
    } else {
        merge(parts, one(p, &lay, d), Vec3::ZERO);
    }
    if lay.findings.iter().any(|f| !f.cast) {
        parts.note("The jump rings and ear wires are bought in: shown as their own part, not in the cast solid.".to_string());
    }
    parts.note(
        "The head, its base and the findings are separate closed shells that pass through each other where they join; STLOUT unions them and cuts every seat."
            .to_string(),
    );
}
