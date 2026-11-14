//! The sheet of a pair of hoop earrings (`PIECE {kind: hoop}`): each hoop's **front view**
//! (seen along its axis: the wire with its gap and post, or its click-top's knuckle and seam, and
//! the pavé's stones as their side profiles round the outside), the **section** to their right
//! (the wire's own, with a pavé stone in its seat), the **side view** (the hoop edge-on) and,
//! under each hoop, its pavé **layout** (the outside unrolled, every stone a `GEM` insert, so
//! the bench sheet counts both hoops' stones). Every number is worked out in
//! [`super::super::hoop`] and `pave_band`; this only draws them.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PolyVertex, Vec2};

use super::super::hoop::{self, Closure, Hoop, HoopSection};
use super::*;

/// A point of the front view at angle `theta` clockwise from the top, radius `r`, about `o`.
fn polar(o: Vec2, theta: f64, r: f64) -> Vec2 {
    o + Vec2::new(r * theta.sin(), r * theta.cos())
}

/// One hoop's front view about `o`.
fn front(h: &Hoop, o: Vec2, shapes: &mut Vec<(On, Shape)>) {
    if h.alpha <= 0.0 {
        shapes.push((On::Metal, Shape::Circle { c: o, r: h.ro }));
        shapes.push((On::Metal, Shape::Circle { c: o, r: h.ri }));
    } else {
        // Round the outside from one end to the other (clockwise), back round the inside.
        let sweep = h.arc();
        let bulge = (sweep / 4.0).tan();
        let a = h.alpha;
        let v = vec![(polar(o, a, h.ro), -bulge), (polar(o, -a, h.ro), 0.0), (polar(o, -a, h.ri), bulge), (polar(o, a, h.ri), 0.0)];
        shapes.push((On::Metal, Shape::Poly { v, closed: true }));
    }
    if let Some((a, b)) = h.post_wire() {
        let (a, b) = (o + a.xy(), o + b.xy());
        let along = (b - a).normalized();
        let side = Vec2::new(-along.y, along.x) * (h.post / 2.0);
        shapes.push((On::Settings, closed(&[a - side, b - side, b + side, a + side])));
    }
    if let Some((mouth, dir, r, depth)) = h.hole() {
        let (m, d) = (o + mouth.xy(), Vec2::new(dir.x, dir.y).normalized());
        let side = Vec2::new(-d.y, d.x) * r;
        let end = m + d * depth;
        shapes.push((On::Settings, Shape::Poly { v: vec![(m + side, 0.0), (end + side, 0.0), (end - side, 0.0), (m - side, 0.0)], closed: false }));
    }
    if let Some((c, r, _)) = h.knuckle() {
        shapes.push((On::Settings, Shape::Circle { c: o + c.xy(), r }));
        let seam = h.seam();
        shapes.push((On::Settings, Shape::Poly { v: vec![(polar(o, seam, h.ri), 0.0), (polar(o, seam, h.ro), 0.0)], closed: false }));
    }
}

/// The wire's section about `at` (its inside edge on the base line, the axis across).
fn section(h: &Hoop, at: Vec2, shapes: &mut Vec<(On, Shape)>) {
    let local = |q: Vec2| at + Vec2::new(q.y, q.x - h.ri);
    match h.section {
        HoopSection::Round | HoopSection::Tube => {
            shapes.push((On::Metal, Shape::Circle { c: at + Vec2::new(0.0, h.t / 2.0), r: h.t / 2.0 }));
            if h.bore > 0.0 {
                shapes.push((On::Metal, Shape::Circle { c: at + Vec2::new(0.0, h.t / 2.0), r: h.bore / 2.0 }));
            }
        }
        _ => shapes.push((On::Metal, closed(&h.outline().into_iter().map(local).collect::<Vec<_>>()))),
    }
}

/// Work a pair of hoops out from their parameters.
pub(super) fn design(p: &PieceParams) -> Result<Design> {
    let h = Hoop::of(p);
    let offsets = hoop::pair_offsets(p);
    let mut shapes: Vec<(On, Shape)> = Vec::new();
    let fit = pave_band::fit(p);
    let surf = pave_band::Surface::of(p);
    let sheet = fit.as_ref().zip(surf.as_ref()).map(|(f, s)| pave_band::sheet(f, s));
    let rails = super::super::channel::sheet(&p.channel_pieces(), h.ri + surf.as_ref().map_or(h.t, |s| s.section.height_at(0.0)));
    for x in offsets {
        let o = Vec2::new(x, 0.0);
        front(&h, o, &mut shapes);
        if let Some(sh) = &sheet {
            shapes.extend(sh.front.iter().map(|v| (On::Stones, Shape::Poly { v: v.iter().map(|(q, b)| (o + *q, *b)).collect(), closed: true })));
        }
        shapes.extend(rails.0.iter().map(|v| (On::Metal, Shape::Poly { v: v.iter().map(|q| (o + *q, 0.0)).collect(), closed: false })));
    }
    let [_, last] = offsets;
    let right = last + h.ro;
    // The section, and the hoop edge-on beside it.
    let section_at = Vec2::new(right + VIEW_GAP + h.w / 2.0, -h.t / 2.0);
    section(&h, section_at, &mut shapes);
    if let Some(sh) = &sheet {
        shapes
            .extend(sh.section.iter().map(|v| (On::Stones, Shape::Poly { v: v.iter().map(|(q, b)| (section_at + *q, *b)).collect(), closed: true })));
    }
    let side_at = Vec2::new(section_at.x + h.w.max(h.t) / 2.0 + VIEW_GAP + h.w / 2.0, 0.0);
    shapes.push((On::Metal, rect(side_at, h.w, 2.0 * h.ro)));
    shapes.push((On::Metal, rect(side_at, h.w, 2.0 * h.ri)));
    // The pavé's layout under each hoop: the outside unrolled, every stone an insert.
    let mut pave_stones: Vec<(Vec2, gem::Stone)> = Vec::new();
    if let Some(sh) = &sheet {
        let (length, height) = sh.layout;
        // One under the other: a layout is the hoop's whole outside unrolled, wider than the pair.
        for (i, _) in offsets.iter().enumerate() {
            let at = Vec2::new(0.0, -(h.ro + VIEW_GAP + height / 2.0 + i as f64 * (height + VIEW_GAP)));
            shapes.push((On::Metal, rect(at, length, height)));
            for (q, d) in &sh.inserts {
                pave_stones.push((at + *q, pave_band::melee_stone(CMD, *d)?));
            }
            shapes.extend(rails.1.iter().map(|v| (On::Metal, Shape::Poly { v: v.iter().map(|q| (at + *q, 0.0)).collect(), closed: true })));
        }
    }
    let mut checks = hoop::checks(p);
    let mut carat = 0.0;
    match &fit {
        Some(f) => {
            checks.push(check("pave", f.ok(), f.message()));
            checks.extend(p.channel_checks().into_iter().map(|(id, ok, words)| check(id, ok, words)));
            checks.extend(hoop::seam_check(p, &f.stones));
            carat = 2.0 * f.stones.iter().map(|s| pave_band::stone_carat(s.diameter)).sum::<f64>();
            checks.push(calibrated_check("pavé", Some(f.spec.melee)));
        }
        None => checks.push(calibrated_check("", None)),
    }
    let grams = p.band_grams();
    if !(grams.is_finite() && carat.is_finite()) {
        return Err(bad(CMD, "the piece has no weight"));
    }
    let mut notes = Vec::new();
    if h.closure == Closure::Click {
        notes.push("The click's seam is drawn on the sheet and cut at the bench: the cast solid is the hoop closed.".to_string());
    }
    Ok(Design {
        params: p.clone(),
        centre: None,
        melee: None,
        shapes,
        placed: Vec::new(),
        grams,
        carat,
        fits: None,
        checks,
        notes,
        pave: fit,
        pattern: None,
        pave_stones,
    })
}

/// The block's outline: a frame round both hoops' front views.
pub(super) fn block_outline(p: &PieceParams) -> EntityKind {
    let h = Hoop::of(p);
    let [l, r] = hoop::pair_offsets(p);
    let (x0, x1, y) = (l - h.ro - 1.0, r + h.ro + 1.0, h.ro + 1.0);
    let pts = [Vec2::new(x0, -y), Vec2::new(x1, -y), Vec2::new(x1, y), Vec2::new(x0, y)];
    helpers::lwpoly(pts.into_iter().map(|q| PolyVertex::with_bulge(q, 0.0)).collect(), true)
}

/// The block's `ring:` record the bench sheet reads.
pub(super) fn record(d: &Design) -> String {
    let p = &d.params;
    let h = Hoop::of(p);
    format!(
        "ring: piece=hoop, metal={}, grams={:.2}, pieces=2, hoop={}x{} {}, closure={}",
        p.metal,
        d.grams,
        fmt_mm(2.0 * h.ro),
        fmt_mm(h.t),
        h.section.name(),
        h.closure.name()
    )
}

/// One line a jeweler reads.
pub(super) fn line(d: &Design) -> String {
    let p = &d.params;
    let h = Hoop::of(p);
    let closure = match h.closure {
        Closure::Post => format!("a {} mm hinged post across a {} mm gap", fmt_mm(h.post), fmt_mm(h.gap)),
        Closure::Click => "a click-top".to_string(),
    };
    let wire = if matches!(h.section, HoopSection::Round | HoopSection::Tube) {
        format!("{} mm {}", fmt_mm(h.t), h.section.name())
    } else {
        format!("{} × {} mm {}", fmt_mm(h.t), fmt_mm(h.w), h.section.name())
    };
    let mut out = format!(
        "Hoop earrings, a pair — each {} mm across of {wire} wire with {closure}; in {}, about {:.2} g the pair ({:.2} g each)",
        fmt_mm(2.0 * h.ro),
        p.metal,
        d.grams,
        d.grams / 2.0
    );
    if let Some(f) = d.pave.as_ref().filter(|f| !f.stones.is_empty()) {
        out.push_str(&format!(
            "; {} {} stones a hoop along the front, {:.3} ct the pair",
            f.stones.len(),
            if f.spec.layout == pave_band::Layout::Channel { "channel-set" } else { "pavé" },
            d.carat
        ));
    }
    let failed: Vec<&str> = d.checks.iter().filter(|c| c["ok"] == serde_json::json!(false)).filter_map(|c| c["message"].as_str()).collect();
    for message in failed {
        out.push_str("\nCheck: ");
        out.push_str(message);
    }
    for note in &d.notes {
        out.push_str("\nNote: ");
        out.push_str(note);
    }
    out
}
