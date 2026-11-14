//! The sheet of a piece not worn on a finger (`PIECE` with `kind: pendant | stud | drop`): the
//! **front view** (looking at the table: the stone as a real `GEM` insert, its prongs or collar,
//! the halo's melee as `GEM` inserts, and every finding as it shows from the front) and the
//! **side view** to its right (the stone's profile along its length, the prongs or the collar's
//! section, the base, and the findings from the side). A pair draws both pieces' front views, so
//! every stone of the pair is an insert the bench sheet counts. Every number is worked out in
//! [`super::super::findings`] and [`super::super::piece_params`]; this only draws them.
//!
//! On the sheet, X is across the stone and Y runs up the piece (towards the bail, or the ear),
//! along the stone's length as `GEM` draws it; the side view's X is the depth, the table to the
//! right.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PolyVertex, Vec2, Vec3};

use super::super::findings::{self, Back, Bail, Finding, Top};
use super::super::heads::HeadStyle;
use super::*;

/// One head drawn: its stone in the front view (an insert, the centre's or an extra), its prongs
/// or collar, and its side view.
struct Drawn {
    carat: f64,
}

/// Draw one head with its stone's centre at `o` (front view) and its girdle's middle at height
/// `z` up the side view at `so`.
#[allow(clippy::too_many_arguments, reason = "the head's two views, both offsets and where its stones go")]
fn draw_head(
    p: &PieceParams,
    stone: &gem::Stone,
    o: Vec2,
    so: Vec2,
    shapes: &mut Vec<(On, Shape)>,
    placed: &mut Vec<Placed>,
    extra: &mut Vec<(Vec2, gem::Stone)>,
    centre: bool,
) -> Result<Drawn> {
    let head = p.head();
    let mut carat = carat_of(stone);
    if centre {
        placed.push(Placed { melee: false, at: o });
    } else {
        extra.push((o, p.centre_stone(CMD)?));
    }
    let (l, half) = (stone.length / 2.0, stone.width / 2.0);
    // The side view: the stone's profile along its length, its culet `clear` over the base plane.
    let side = shared::side_profile(stone.cut, stone.length, head.depth);
    shapes.push((On::Stones, place_profile(&side, so + Vec2::new(head.clear, 0.0), Vec2::new(0.0, 1.0), Vec2::new(1.0, 0.0))));
    let base = findings::base_of(p);
    match head.bezel {
        Some(b) => {
            for sign in [-1.0, 1.0] {
                let pts: Vec<Vec2> = b.profile().iter().map(|q| so + Vec2::new(head.girdle_height() + q.y, sign * (l + q.x))).collect();
                shapes.push((On::Settings, closed(&pts)));
            }
            shapes.push((On::Settings, rect(so + Vec2::new(base, 0.0), 2.0 * findings::BAR, 2.0 * (l + b.wall))));
            let outline =
                if stone.cut.is_circle(stone.length, stone.width) { None } else { shared::girdle_outline(stone.cut, stone.length, stone.width) };
            match outline {
                None => {
                    shapes.push((On::Settings, Shape::Circle { c: o, r: half + b.wall }));
                    shapes.push((On::Settings, Shape::Circle { c: o, r: (half - b.ledge).max(0.05) }));
                }
                Some(girdle) => {
                    for by in [b.wall, -b.ledge] {
                        if let Ok(ring) = super::super::setting::offset_loop(&girdle, by) {
                            shapes.push((On::Settings, closed(&ring.iter().map(|q| o + *q).collect::<Vec<_>>())));
                        }
                    }
                }
            }
        }
        None => {
            let sites = if centre { p.prong_sites()? } else { shared::prong_sites(stone.cut, stone.length, stone.width, p.prongs)? };
            for site in &sites {
                shapes.push((On::Settings, Shape::Circle { c: o + *site, r: head.prong / 2.0 }));
            }
            let (girdle_bottom, tip) = (head.girdle_height() - head.girdle / 2.0, head.prong_height());
            for sign in [-1.0, 1.0] {
                let line =
                    [so + Vec2::new(base, sign * shared::PRONG_FOOT * l), so + Vec2::new(girdle_bottom, sign * l), so + Vec2::new(tip, sign * l)];
                shapes.push((On::Settings, Shape::Poly { v: line.into_iter().map(|q| (q, 0.0)).collect(), closed: false }));
            }
            shapes.push((On::Settings, rect(so + Vec2::new(base, 0.0), head.prong, 2.0 * shared::PRONG_FOOT * l + head.prong)));
        }
    }
    if centre && let (Some(sites), Some(_)) = (p.halo_sites(), p.haloed()) {
        for site in &sites {
            placed.push(Placed { melee: true, at: o + *site });
        }
        carat += sites.len() as f64 * p.halo_stone(CMD)?.map_or(0.0, |m| carat_of(&m));
    }
    Ok(Drawn { carat })
}

/// A finding in both views.
fn draw_finding(f: &Finding, o: Vec2, so: Vec2, shapes: &mut Vec<(On, Shape)>) {
    let front = |q: Vec3| o + Vec2::new(q.x, q.z);
    let side = |q: Vec3| so + Vec2::new(q.y, q.z);
    match &f.shape {
        findings::Shape::Loop { c, axis, mean, wire } => {
            let (a, b) = (mean - wire / 2.0, mean + wire / 2.0);
            if axis.x.abs() > 0.5 {
                // In the YZ plane: edge on from the front, round from the side.
                shapes.push((On::Metal, rect(front(*c), *wire, 2.0 * b)));
                shapes.push((On::Metal, Shape::Circle { c: side(*c), r: b }));
                shapes.push((On::Metal, Shape::Circle { c: side(*c), r: a.max(0.01) }));
            } else {
                shapes.push((On::Metal, Shape::Circle { c: front(*c), r: b }));
                shapes.push((On::Metal, Shape::Circle { c: front(*c), r: a.max(0.01) }));
                shapes.push((On::Metal, rect(side(*c), *wire, 2.0 * b)));
            }
        }
        findings::Shape::Tube { c, ri, ro, len, .. } => {
            shapes.push((On::Metal, rect(front(*c), *len, 2.0 * ro)));
            shapes.push((On::Metal, Shape::Circle { c: side(*c), r: *ro }));
            shapes.push((On::Metal, Shape::Circle { c: side(*c), r: ri.max(0.01) }));
        }
        findings::Shape::Wire { pts, wire } => {
            for view in [&front as &dyn Fn(Vec3) -> Vec2, &side] {
                let v: Vec<Vec2> = pts.iter().map(|q| view(*q)).collect();
                let length: f64 = v.windows(2).filter_map(|w| Some((*w.get(1)? - *w.first()?).len())).sum();
                match v.first() {
                    Some(at) if length < 1e-6 => shapes.push((On::Metal, Shape::Circle { c: *at, r: wire / 2.0 })),
                    Some(_) => shapes.push((On::Metal, Shape::Poly { v: v.into_iter().map(|q| (q, 0.0)).collect(), closed: false })),
                    None => {}
                }
            }
        }
    }
}

/// Where the front views of a piece stand: one in the middle, or a pair either side of it.
fn fronts(p: &PieceParams, lay: &findings::Layout) -> Vec<Vec2> {
    if p.kind.pair() {
        let dx = lay.across + findings::PAIR_GAP / 2.0;
        vec![Vec2::new(-dx, 0.0), Vec2::new(dx, 0.0)]
    } else {
        vec![Vec2::ZERO]
    }
}

/// Work a pendant or a pair of earrings out from its parameters.
pub(super) fn design(p: &PieceParams) -> Result<Design> {
    let stone = p.centre_stone(CMD)?;
    if let Some(h) = p.haloed()
        && p.halo_sites().is_none()
    {
        return Err(bad(CMD, format!("a halo of {} mm melee does not fit around this stone at a {} mm gap", fmt_mm(h), fmt_mm(p.gap))));
    }
    let lay = findings::layout(p);
    let top = match &lay.top {
        Some((t, z)) => Some((t.clone(), t.centre_stone(CMD)?, *z)),
        None => None,
    };
    let mut shapes: Vec<(On, Shape)> = Vec::new();
    let mut placed: Vec<Placed> = Vec::new();
    let mut extra: Vec<(Vec2, gem::Stone)> = Vec::new();
    let fronts = fronts(p, &lay);
    let right = fronts.last().map_or(0.0, |o| o.x) + lay.across;
    let so = Vec2::new(right + VIEW_GAP + lay.back, 0.0);
    let mut carat = 0.0;
    for (i, o) in fronts.iter().enumerate() {
        // The side view is drawn once, with the first piece.
        let mut scratch = Vec::new();
        let into = if i == 0 { &mut shapes } else { &mut scratch };
        let d = draw_head(p, &stone, *o, so, into, &mut placed, &mut extra, true)?;
        carat += d.carat;
        if let Some((t, ts, z)) = &top {
            let d = draw_head(t, ts, *o + Vec2::new(0.0, *z), so + Vec2::new(0.0, *z), into, &mut placed, &mut extra, false)?;
            carat += d.carat;
        }
        for f in &lay.findings {
            draw_finding(f, *o, so, into);
        }
        if i > 0 {
            // The second piece's front view only.
            shapes.extend(scratch.into_iter().filter(|(_, s)| front_of(s, so)));
        }
    }
    let mut checks = findings::checks(p);
    checks.extend(piece_kinds::bezel_checks(p));
    match (p.haloed(), p.halo_sites()) {
        (Some(h), Some(sites)) => {
            let between = least_spacing(&sites) - h;
            checks.push(check(
                "spacing",
                between + 1e-9 >= p.gap,
                format!(
                    "{} halo stones of {} mm with {} mm of metal between them (the least asked for is {} mm)",
                    sites.len(),
                    fmt_mm(h),
                    fmt_mm(between.max(0.0)),
                    fmt_mm(p.gap)
                ),
            ));
            checks.push(calibrated_check("halo", Some(h)));
        }
        _ => {
            checks.push(check("spacing", true, "One stone to a head: nothing to space".to_string()));
            checks.push(calibrated_check("halo", None));
        }
    }
    let mut notes = Vec::new();
    if p.kind.pair() && p.worn.back != Back::None && (p.kind == PieceKind::Stud || p.worn.top == Top::Stud) {
        notes.push(format!("Two {} backs are bought in: they are counted here, not drawn or cast.", p.worn.back.name()));
    }
    let bought: Vec<&str> = lay.findings.iter().filter(|f| !f.cast).map(|f| f.what).collect();
    if !bought.is_empty() {
        notes.push(format!(
            "The {} {} bought in: drawn and weighed, but not in the cast solid.",
            dedup(&bought).join(" and "),
            if bought.len() == 1 { "is" } else { "are" }
        ));
    }

    let grams = p.band_grams();
    if !(grams.is_finite() && carat.is_finite()) {
        return Err(bad(CMD, "the piece has no weight"));
    }
    let melee = p.halo_stone(CMD)?.filter(|_| p.haloed().is_some());
    Ok(Design {
        params: p.clone(),
        centre: Some(stone),
        melee,
        shapes,
        placed,
        grams,
        carat,
        fits: None,
        checks,
        notes,
        pave: None,
        pattern: None,
        pave_stones: extra,
    })
}

fn dedup<'a>(v: &[&'a str]) -> Vec<&'a str> {
    let mut out: Vec<&str> = Vec::new();
    for s in v {
        let name = s.trim_start_matches("ear wire loop");
        let name = if name.is_empty() { "ear wire" } else { s };
        if !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// Whether a shape is the front view's (left of the side view).
fn front_of(s: &Shape, so: Vec2) -> bool {
    let x = match s {
        Shape::Circle { c, .. } | Shape::Ellipse { c, .. } => c.x,
        Shape::Poly { v, .. } => v.iter().map(|(q, _)| q.x).fold(f64::NEG_INFINITY, f64::max),
    };
    x < so.x - VIEW_GAP / 2.0
}

/// The block's outline: a frame around the front view(s), so `TECHSHEET` and a rebuild find the
/// piece by its insert.
pub(super) fn block_outline(p: &PieceParams) -> EntityKind {
    let lay = findings::layout(p);
    let fronts = fronts(p, &lay);
    let left = fronts.first().map_or(0.0, |o| o.x) - lay.across - 1.0;
    let right = fronts.last().map_or(0.0, |o| o.x) + lay.across + 1.0;
    let (lo, hi) = (lay.low - 1.0, lay.high + 1.0);
    let pts = [Vec2::new(left, lo), Vec2::new(right, lo), Vec2::new(right, hi), Vec2::new(left, hi)];
    helpers::lwpoly(pts.into_iter().map(|q| PolyVertex::with_bulge(q, 0.0)).collect(), true)
}

/// The block's `ring:` record, which the bench sheet reads: the kind, the metal, the grams of
/// the whole piece (both of a pair) and how many pieces.
pub(super) fn record(d: &Design) -> String {
    let p = &d.params;
    let mut out = format!("ring: piece={}, metal={}, grams={:.2}, pieces={}", p.kind.name(), p.metal, d.grams, findings::pieces(p));
    if p.head == HeadStyle::Bezel {
        out.push_str(&format!(", head=bezel, bezelGrams={:.2}", p.bezel_grams() * f64::from(findings::pieces(p))));
    }
    if p.kind.pair() && (p.kind == PieceKind::Stud || p.worn.top == Top::Stud) {
        out.push_str(&format!(", back={}", p.worn.back.name()));
    }
    out
}

/// One line a jeweler reads.
pub(super) fn line(d: &Design) -> String {
    let p = &d.params;
    let w = &p.worn;
    let n = findings::pieces(p);
    let held = if p.bezeled() { "a bezel".to_string() } else { format!("{} prongs", p.prongs) };
    let stone = d.centre.as_ref().map_or(String::new(), |c| {
        let size = if (c.length - c.width).abs() < 1e-6 {
            format!("{} mm", fmt_mm(c.width))
        } else {
            format!("{}×{} mm", fmt_mm(c.length), fmt_mm(c.width))
        };
        format!("{size} {} {} of {:.2} ct in {held}", c.cut.name, p.stone, carat_of(c))
    });
    let halo = match (&d.melee, p.halo_sites()) {
        (Some(m), Some(sites)) => format!(", a halo of {} × {} mm", sites.len(), fmt_mm(m.width)),
        _ => String::new(),
    };
    let mut out = match p.kind {
        PieceKind::Pendant => {
            let bail = match w.bail {
                Bail::Loop => format!("a {} mm loop bail of {} mm wire", fmt_mm(w.bail_opening), fmt_mm(w.bail_wire)),
                Bail::Tube => format!("a {} mm tube bail {} mm long", fmt_mm(w.bail_opening), fmt_mm(w.bail_width)),
            };
            format!(
                "Pendant — a {stone}{halo}, {}on {bail} for a {} mm chain, in {}, about {:.2} g",
                if w.drop { "hanging from a jump ring " } else { "" },
                fmt_mm(w.chain),
                p.metal,
                d.grams
            )
        }
        PieceKind::Stud => format!(
            "Stud earrings, a pair — each a {stone}{halo} on a {} × {} mm post, {} backs; in {}, about {:.2} g the pair ({:.2} g each), {:.2} ct the pair",
            fmt_mm(w.post_diameter),
            fmt_mm(w.post_length),
            w.back.name(),
            p.metal,
            d.grams,
            d.grams / f64::from(n),
            d.carat
        ),
        _ => format!(
            "Drop earrings, a pair — each a {stone}{halo} hanging on a jump ring from {}; in {}, about {:.2} g the pair ({:.2} g each), {:.2} ct the pair",
            match w.top {
                Top::Hook => "a French wire".to_string(),
                Top::Stud => format!("a {} mm stud top on a post", fmt_mm(w.top_stone)),
            },
            p.metal,
            d.grams,
            d.grams / f64::from(n),
            d.carat
        ),
    };
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
