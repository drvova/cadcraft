//! The solid of a pair of hoop earrings (`PIECEMESH`, `STLOUT` with `kind: hoop`): each hoop's
//! section swept round its arc and capped at the gap, its hinged post and the post's hole (or a
//! click-top's knuckle), and its pavé or channel, as [`super::super::hoop`] works them out. The
//! hoop lies in the ring's plane (XY, its axis along Z, the closure at +Y); the pair stands side
//! by side along X.

use cadcraft_geom::{TAU, Vec2, Vec3};

use super::super::hoop::{self, Hoop, HoopBound};
use super::mesh_findings::{merge, outward_into};
use super::*;

/// A point of the hoop's section `(r, z)` at angle `theta` clockwise from the top.
fn at(theta: f64, q: Vec2) -> Vec3 {
    Vec3::new(q.x * theta.sin(), q.x * theta.cos(), q.y)
}

/// The wire: the section swept round the arc, capped at the gap's two ends; a tube's bore too.
fn body(h: &Hoop, d: &Detail, out: &mut Parts) {
    let outline = h.outline();
    let closed = h.alpha <= 0.0;
    // An open tube's ends are capped: the display shows it solid, its bore hidden in the ends.
    let bore = h.bore_outline().filter(|_| closed);
    let steps = ((d.band as f64 * h.arc() / TAU).ceil() as usize).clamp(16, 512);
    let theta = |k: usize| h.alpha + h.arc() * k as f64 / steps as f64;
    let count = if closed { steps } else { steps + 1 };
    let mut part = Buf::default();
    let outer: Vec<Ring> = (0..count).map(|k| part.ring(outline.iter().map(|q| at(theta(k), *q)))).collect();
    let inner: Vec<Ring> = match &bore {
        Some(b) => (0..count).map(|k| part.ring(b.iter().map(|q| at(theta(k), *q)))).collect(),
        None => Vec::new(),
    };
    for w in outer.windows(2) {
        if let [a, b] = w {
            part.bridge(*a, *b);
        }
    }
    for w in inner.windows(2) {
        if let [a, b] = w {
            part.bridge(*b, *a);
        }
    }
    if closed {
        if let (Some(a), Some(b)) = (outer.last(), outer.first()) {
            part.bridge(*a, *b);
        }
        if let (Some(a), Some(b)) = (inner.last(), inner.first()) {
            part.bridge(*b, *a);
        }
    } else {
        match (inner.first(), inner.last(), outer.first(), outer.last()) {
            (Some(i0), Some(i1), Some(o0), Some(o1)) => {
                part.bridge(*i0, *o0);
                part.bridge(*o1, *i1);
            }
            _ => {
                let n = outline.len().max(1) as f64;
                let middle = outline.iter().fold(Vec2::ZERO, |s, q| s + *q) * (1.0 / n);
                if let (Some(o0), Some(o1)) = (outer.first(), outer.last()) {
                    let p0 = part.v(at(theta(0), middle));
                    part.cap_start(p0, *o0);
                    let p1 = part.v(at(theta(steps), middle));
                    part.cap_end(*o1, p1);
                }
            }
        }
    }
    outward_into(&mut out.band, part);
    out.csg.add.push(Prim::Hoop(Box::new(HoopBound::new(*h, Vec3::ZERO))));
}

/// A barrel along Z: its shell, closed at both ends.
fn barrel(buf: &mut Buf, c: Vec3, r: f64, half: f64, n: usize) {
    let n = n.clamp(8, 96);
    let ring = |buf: &mut Buf, z: f64| buf.ring((0..n).map(|k| TAU * k as f64 / n as f64).map(|a| c + Vec3::new(r * a.cos(), r * a.sin(), z)));
    let mut part = Buf::default();
    let (a, b) = (ring(&mut part, -half), ring(&mut part, half));
    part.bridge(a, b);
    let p0 = part.v(c - Vec3::new(0.0, 0.0, half));
    part.cap_start(p0, a);
    let p1 = part.v(c + Vec3::new(0.0, 0.0, half));
    part.cap_end(b, p1);
    outward_into(buf, part);
}

/// The closure: a hinged post across the gap and its hole, or a click-top's knuckle.
fn closure(h: &Hoop, d: &Detail, out: &mut Parts) {
    if let Some((a, b)) = h.post_wire() {
        let r = h.post / 2.0;
        capsule(&mut out.findings, &[a, b], r, d.radial, d.cap);
        out.csg.add.push(Prim::Wire { pts: vec![a, b], r, closed: false });
    }
    if let Some((mouth, dir, r, depth)) = h.hole() {
        let u = any_perp(dir);
        let axes = Axes { o: mouth, u, v: dir.cross(u), w: dir };
        out.csg.cut.push(Prim::Cylinder { axes, r, lo: -0.05, hi: depth });
    }
    if let Some((c, r, half)) = h.knuckle() {
        barrel(&mut out.findings, c, r, half, 4 * d.radial);
        let axes = Axes { o: c, u: Vec3::new(1.0, 0.0, 0.0), v: Vec3::new(0.0, 1.0, 0.0), w: Vec3::Z };
        out.csg.add.push(Prim::Cylinder { axes, r, lo: -half, hi: half });
    }
}

/// The hoop's pavé or channel, as a band's ([`build_pave`]) with the hoop's inside as its finger.
fn pave(p: &PieceParams, h: &Hoop, d: &Detail, out: &mut Parts) {
    use super::super::pave_band;
    let Some(fit) = pave_band::fit(p) else { return };
    let table = gem::CUTS.first().map_or(0.57, shared::table_ratio);
    let channel = fit.spec.layout == pave_band::Layout::Channel;
    for st in &fit.stones {
        let (w, u) = (st.normal, -st.around);
        let f = Frame { o: st.girdle, u, v: w.cross(u), w };
        round_brilliant(&mut out.pave, &f, st.diameter / 2.0, st.depth, table, d.melee);
        if let Some(cut) = gem::CUTS.first() {
            let shape = StoneShape::of(cut, st.diameter, st.diameter, st.depth, 16 * d.melee.clamp(1, 8));
            let (girdle, crown, pavilion) = proportions(st.depth);
            let bore = (!channel).then_some(girdle / 2.0 + crown + SEAT_CLEARANCE + BORE_OVER);
            let mut envelope = seat_envelope(&shape, &f, girdle, crown, pavilion, bore);
            fit_seat(&mut envelope, d, &|b, dd| round_brilliant(b, &f, st.diameter / 2.0, st.depth, table, dd.melee));
            let through = (Vec2::new(st.girdle.x, st.girdle.y).len() - h.ri + BORE_OVER).max(BORE_OVER);
            out.csg.cut.push(Prim::Cylinder { axes: axes_of(&f), r: PAVE_HOLE * envelope.reach, lo: -through, hi: 0.0 });
            out.csg.cut.push(Prim::Seat(envelope));
            out.seats += 1;
        }
    }
    out.stones = out.stones.saturating_add(u32::try_from(fit.stones.len()).unwrap_or(u32::MAX));
    if channel {
        channel_mesh::build(out, &p.channel_pieces(), d.radial);
    } else if let Some(surf) = pave_band::Surface::of(p) {
        for (c, up, rb) in pave_band::beads(&fit, &surf) {
            bead(&mut out.beads, c, up, rb, d.bead_radial, d.bead_lat);
            out.csg.add.push(Prim::Sphere { c, r: rb });
        }
    }
    if !fit.ok() {
        out.note(format!("Pavé: {}", fit.message()));
    }
    out.note(if channel {
        "The channel runs along the hoop between two rails, tables level with its outside; STLOUT unions the rails, cuts the channel and each stone's seat."
            .to_string()
    } else {
        "Pavé stones sit on the hoop's outside, tables level with it, the beads passing into the wire; STLOUT cuts each stone's seat.".to_string()
    });
}

/// Both hoops of the pair.
pub(super) fn build(p: &PieceParams, d: &Detail, parts: &mut Parts) {
    let h = Hoop::of(p);
    for x in hoop::pair_offsets(p) {
        let mut one = Parts::default();
        body(&h, d, &mut one);
        closure(&h, d, &mut one);
        pave(p, &h, d, &mut one);
        merge(parts, one, Vec3::new(x, 0.0, 0.0));
    }
    parts.note("A pair: both hoops are built side by side, and the solid holds both (cast two).".to_string());
    parts.note(match h.closure {
        hoop::Closure::Post => {
            "The hinged post is shown closed across the gap, seated in its hole; STLOUT drills the hole and unions the post with the hoop it is hinged to."
                .to_string()
        }
        hoop::Closure::Click => {
            "The click-top is shown closed: its knuckle stands at the top, and the click's seam is cut at the bench, not in the cast solid.".to_string()
        }
    });
}
