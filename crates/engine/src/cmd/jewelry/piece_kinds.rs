//! The sheet of the newer heads and kinds (`PIECE`): a bezel's collar in the front view and the
//! plan; a half eternity's row; a dome ring's and a signet's tapered shank, and a signet's face.
//! Every number is worked out in [`super::super::heads`] and [`super::super::kinds`]; this only
//! draws them.

use cadcraft_geom::{PI, TAU, Vec2};
use serde_json::Value;

use super::super::heads::Bezel;
use super::super::kinds::{ENGRAVE_DEPTH, FACE_SEAT, RESIZE_PLAIN, US_STEP_CIRCUMFERENCE};
use super::*;

/// What a kind adds to the sheet.
#[derive(Default)]
pub(super) struct KindSheet {
    pub shapes: Vec<(On, Shape)>,
    /// The plan view's shapes; with `own_plan` they replace the band's rectangle.
    pub plan: Vec<(On, Shape)>,
    pub own_plan: bool,
    pub plan_stones: Vec<Placed>,
    pub checks: Vec<Value>,
    pub notes: Vec<String>,
    pub melee: Option<gem::Stone>,
    pub carat: f64,
    pub fits: Option<u32>,
    pub front_reach: f64,
    pub plan_reach: f64,
    pub seated: Option<Vec<(Vec2, f64)>>,
    pub unrolled: Option<f64>,
    pub row: Vec<f64>,
    /// The section view, base centred on the origin, and how wide it is; `None` for the band's own.
    pub sections: Option<(Vec<(On, Shape)>, f64)>,
}

/// The sheet of a half eternity, a dome ring or a signet.
pub(super) fn draw_kind(p: &PieceParams, section: &Section) -> Result<KindSheet> {
    match p.kind {
        PieceKind::HalfEternity => half_eternity(p, section),
        PieceKind::Dome | PieceKind::Signet => tapered(p, section),
        _ => Ok(KindSheet::default()),
    }
}

/// What the band's `ring:` record adds for the newer heads and kinds, so a bench sheet reads them:
/// `, head=bezel`, and a tapered shank's top `, top=8x3.24`.
pub(super) fn record_extra(p: &PieceParams) -> String {
    let mut out = String::new();
    if p.bezeled() {
        out.push_str(&format!(", head=bezel, bezelGrams={:.2}", p.bezel_grams()));
    }
    if p.tapered() {
        let t = p.taper();
        out.push_str(&format!(", top={}x{}", fmt_mm(t.top_width), fmt_mm(t.top_wall)));
    }
    if p.kind == PieceKind::Signet {
        let (l, w) = p.face_size();
        out.push_str(&format!(", face={} {}x{}", p.face.name(), fmt_mm(l), fmt_mm(w)));
    }
    out
}

/// The reply's `metal`: the band's weight, and the bezels' apart when there are any.
pub(super) fn metal_json(p: &PieceParams, grams: f64) -> Value {
    let mut metal = serde_json::json!({ "name": p.metal, "density": p.density, "grams": (grams * 1000.0).round() / 1000.0 });
    if p.bezeled()
        && let Some(o) = metal.as_object_mut()
    {
        o.insert("bezelGrams".into(), serde_json::json!((p.bezel_grams() * 1000.0).round() / 1000.0));
    }
    metal
}

// ---------------------------------------------------------------------------------------------
// The bezel
// ---------------------------------------------------------------------------------------------

/// One stone in its bezel: in the front view its side profile over the band and the collar's two
/// sides in section (the wall, the seat ledge under the girdle, the opening below); in the plan
/// the collar's outside and its seat's opening around the girdle. Answers with how far it reaches
/// to either side of the front view's middle.
pub(super) fn draw_bezel(
    shapes: &mut Vec<(On, Shape)>,
    plan: &mut Vec<(On, Shape)>,
    stone: &gem::Stone,
    head: &shared::Head,
    b: &Bezel,
    at: &Standing,
) -> f64 {
    let local = |x: f64, y: f64| at.across * x + at.up * y;
    let side = shared::side_profile(stone.cut, stone.width, head.depth);
    shapes.push((On::Stones, place_profile(&side, at.up * (at.top + head.clear), at.across, at.up)));
    let (half, girdle) = (stone.width / 2.0, at.top + head.girdle_height());
    let mut reach = 0.0f64;
    for sign in [-1.0, 1.0] {
        // The collar's section, from the inside of the seat round to the outside.
        let pts: Vec<Vec2> = b.profile().iter().map(|q| local(sign * (half + q.x), girdle + q.y)).collect();
        reach = pts.iter().fold(reach, |far, q| far.max(q.x.abs()));
        shapes.push((On::Settings, closed(&pts)));
    }
    let outline = if stone.cut.is_circle(stone.length, stone.width) { None } else { shared::girdle_outline(stone.cut, stone.length, stone.width) };
    match outline {
        None => {
            plan.push((On::Settings, Shape::Circle { c: at.plan_at, r: half + b.wall }));
            plan.push((On::Settings, Shape::Circle { c: at.plan_at, r: (half - b.ledge).max(0.05) }));
        }
        Some(girdle) => {
            for by in [b.wall, -b.ledge] {
                if let Ok(ring) = super::super::setting::offset_loop(&girdle, by) {
                    plan.push((On::Settings, closed(&ring.iter().map(|q| at.plan_at + *q).collect::<Vec<_>>())));
                }
            }
        }
    }
    reach
}

/// The two bezel checks: the thinnest wall and the least lip of every collar in the piece.
pub(super) fn bezel_checks(p: &PieceParams) -> Vec<Value> {
    let mut collars: Vec<Bezel> = p.head().bezel.into_iter().collect();
    if p.kind == PieceKind::ThreeStone {
        collars.extend(p.sides().head.bezel);
    }
    let thinnest = collars.iter().copied().min_by(|a, b| a.wall.total_cmp(&b.wall));
    // The collar that holds least: the smallest lip, or the one nearest its table.
    let least = collars.iter().copied().min_by(|a, b| (a.lip.min(a.crown - a.lip)).total_cmp(&b.lip.min(b.crown - b.lip)));
    let mut out = Vec::new();
    if let Some(b) = thinnest {
        let (ok, words) = b.wall_check();
        out.push(check("bezel-wall", ok, words));
    }
    if let Some(b) = least {
        let (ok, words) = b.lip_check();
        out.push(check("bezel-lip", ok, words));
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Half eternity
// ---------------------------------------------------------------------------------------------

fn half_eternity(p: &PieceParams, section: &Section) -> Result<KindSheet> {
    let mut k = KindSheet::default();
    let m = p.melee;
    let stone = p.row_stone(CMD)?;
    let half = p.half_row();
    let seats = half.row;
    let (depth, rg, most) = (seats.depth, seats.radius, half.most);
    if !(rg.is_finite() && rg > m / 2.0) {
        return Err(bad(CMD, format!("{} mm stones are too large to go around this band", fmt_mm(m))));
    }
    if most == 0 {
        return Err(bad(CMD, format!("no {} mm stone fits across the top of this band at a {} mm gap", fmt_mm(m), fmt_mm(p.gap))));
    }
    if let Some(n) = p.count.filter(|n| *n > most) {
        return Err(bad(
            CMD,
            format!(
                "{n} stones of {} mm do not fit across the top half of a size {} band at a {} mm gap: {most} fit",
                fmt_mm(m),
                p.size.us_text(),
                fmt_mm(p.gap)
            ),
        ));
    }
    let n = half.count(p.count);
    k.fits = Some(most);
    let side = shared::side_profile(stone.cut, m, depth);
    let outline = if stone.cut.is_circle(m, m) {
        None
    } else {
        Some(shared::girdle_outline(stone.cut, m, m).ok_or_else(|| bad(CMD, "the stone has no outline"))?)
    };
    let length = TAU * rg;
    for i in 0..n {
        let phi = half.angle(i, n);
        let out = half.out(i, n);
        let along = Vec2::new(-out.y, out.x);
        k.shapes.push((On::Stones, place_profile(&side, out * (seats.top - depth), along, out)));
        let squeeze = phi.cos();
        if squeeze > 0.05 {
            let c = Vec2::new(rg * phi.sin(), 0.0);
            k.plan.push((
                On::Stones,
                match &outline {
                    None => Shape::Ellipse { c, major: Vec2::new(0.0, m / 2.0), ratio: squeeze },
                    Some(pts) => closed(&pts.iter().map(|q| c + Vec2::new(q.x * squeeze, q.y)).collect::<Vec<_>>()),
                },
            ));
        }
        // Along the unrolled band, 12 o'clock in its middle.
        k.row.push((phi / TAU + 0.5) * length);
    }
    k.seated = Some(side);
    k.unrolled = Some(length);
    let edge = (p.width - m) / 2.0;
    let seat_height = section.height_at(0.0);
    let under = seat_height - depth;
    let seat_ok = edge + 1e-9 >= MIN_EDGE && under >= -1e-9 && seats.level();
    k.checks.push(check(
        "stone-seat",
        seat_ok,
        if seat_ok {
            format!(
                "A {} mm stone in a {} mm band leaves {} mm of metal each side, and its {} mm depth leaves {} mm of the wall under the culet",
                fmt_mm(m),
                fmt_mm(p.width),
                fmt_mm(edge),
                fmt_mm(depth),
                fmt_mm(under)
            )
        } else if edge + 1e-9 < MIN_EDGE {
            format!("A {} mm stone needs a band at least {} mm wide ({MIN_EDGE} mm of metal each side); this one is {} mm", fmt_mm(m), fmt_mm(m + 2.0 * MIN_EDGE), fmt_mm(p.width))
        } else if under < -1e-9 {
            format!("A {} mm stone is {} mm deep and the wall is {} mm: the culet comes through to the finger", fmt_mm(m), fmt_mm(depth), fmt_mm(seat_height))
        } else {
            format!(
                "A {} band falls {} mm from its middle to the edge of a {} mm stone, more than the {} mm the girdle lies under the table: the girdle has no metal beside it",
                p.profile.name(),
                fmt_mm(seats.fall),
                fmt_mm(m),
                fmt_mm(shared::girdle_drop(depth))
            )
        },
    ));
    let metal = half.between();
    k.checks.push(check(
        "spacing",
        n < 2 || metal + 1e-9 >= p.gap,
        format!(
            "{n} stones of {} mm across the top with {} mm of metal between girdles (the least asked for is {} mm; {most} fit)",
            fmt_mm(m),
            fmt_mm(metal.max(0.0)),
            fmt_mm(p.gap)
        ),
    ));
    k.checks.push(calibrated_check("half eternity", Some(m)));
    let plain = half.plain(n, p.inner() / 2.0);
    let sizes = (plain - RESIZE_PLAIN).max(0.0) / US_STEP_CIRCUMFERENCE;
    k.checks.push(check(
        "resize",
        plain + 1e-9 >= RESIZE_PLAIN,
        if plain + 1e-9 >= RESIZE_PLAIN {
            format!(
                "{} mm of plain shank at the bottom: room to size the ring by about {} sizes either way",
                fmt_mm(plain),
                fmt_mm((sizes * 10.0).floor() / 10.0)
            )
        } else {
            format!("Only {} mm of plain shank at the bottom, under the {RESIZE_PLAIN} mm a bench cuts to size a ring", fmt_mm(plain))
        },
    ));
    k.carat = carat_of(&stone) * f64::from(n);
    k.melee = Some(stone);
    Ok(k)
}

// ---------------------------------------------------------------------------------------------
// Dome ring and signet
// ---------------------------------------------------------------------------------------------

/// Steps round a tapered band's outline.
const OUTLINE_STEPS: usize = 144;

/// The outside of a tapered band in the front view, as a closed polyline.
pub(super) fn tapered_outside(p: &PieceParams) -> Vec<Vec2> {
    let (taper, section, ri) = (p.taper(), p.section(), p.inner() / 2.0);
    (0..OUTLINE_STEPS)
        .map(|k| {
            let theta = TAU * k as f64 / OUTLINE_STEPS as f64;
            Vec2::new(theta.sin(), theta.cos()) * taper.crown_at(&section, ri, theta)
        })
        .collect()
}

fn tapered(p: &PieceParams, section: &Section) -> Result<KindSheet> {
    let mut k = KindSheet::default();
    let (taper, ri) = (p.taper(), p.inner() / 2.0);
    let top_r = taper.crown_at(section, ri, 0.0);
    k.front_reach = top_r;
    k.checks.push(check("stone-seat", true, format!("A {}: no stone to seat", p.kind.name())));
    k.checks.push(check("spacing", true, "No stones to space".to_string()));
    k.checks.push(calibrated_check("", None));

    // The plan: the shank's top half seen from above, as wide as it is where it passes.
    let steps = 48;
    let mut rim: Vec<Vec2> = Vec::with_capacity(2 * steps + 2);
    let at = |j: usize| -PI / 2.0 + PI * j as f64 / steps as f64;
    for j in 0..=steps {
        let theta = at(j);
        rim.push(Vec2::new(taper.crown_at(section, ri, theta) * theta.sin(), taper.scale(theta).0 * p.width / 2.0));
    }
    for j in (0..=steps).rev() {
        let theta = at(j);
        rim.push(Vec2::new(taper.crown_at(section, ri, theta) * theta.sin(), -taper.scale(theta).0 * p.width / 2.0));
    }
    k.plan.push((On::Metal, closed(&rim)));
    k.own_plan = true;
    k.plan_reach = taper.top_width / 2.0;

    // The sections: the bottom's (exact), and the top's, scaled from it.
    let bottom = section.outline();
    let (sx, sy) = taper.scale(0.0);
    let top: Vec<Vec2> = section.polygon(48).into_iter().map(|q| Vec2::new(q.x * sx, q.y * sy)).collect();
    let mut sections = vec![(On::Metal, Shape::Poly { v: top.iter().map(|q| (*q, 0.0)).collect(), closed: true })];
    let mut span = taper.top_width;

    if p.kind == PieceKind::Signet {
        let face = p.signet_face();
        let (fl, fw) = face.size();
        // Front view: the face plate's side; plan: its outline at the top.
        k.shapes.push((On::Metal, rect(Vec2::new(0.0, (face.bottom + face.top) / 2.0), fw, face.thickness())));
        k.front_reach = k.front_reach.max(fw / 2.0);
        let outline = face.outline(96);
        k.plan.push((On::Metal, closed(&outline.iter().map(|q| Vec2::new(q.x, q.y)).collect::<Vec<_>>())));
        k.plan_reach = k.plan_reach.max(fl / 2.0);
        // The section through the face, along the finger: the plate over the shank's top.
        sections.push((On::Metal, rect(Vec2::new(0.0, (FACE_SEAT + p.face_height()) / 2.0), fl, face.thickness())));
        span = span.max(fl);
        let thick = face.thickness();
        let need = ENGRAVE_DEPTH + MIN_CAST_WALL;
        k.checks.push(check(
            "face",
            thick + 1e-9 >= need,
            if thick + 1e-9 >= need {
                format!(
                    "The face is {} mm thick: room to engrave {ENGRAVE_DEPTH} mm deep and keep the {MIN_CAST_WALL} mm a bench casts",
                    fmt_mm(thick)
                )
            } else {
                format!(
                    "The face is {} mm thick, under the {} mm it takes to engrave {ENGRAVE_DEPTH} mm deep over a {MIN_CAST_WALL} mm cast wall",
                    fmt_mm(thick),
                    fmt_mm(need)
                )
            },
        ));
    }
    // The bottom's section beside the top's.
    let gap = VIEW_GAP / 2.0;
    let shift = span / 2.0 + gap + p.width / 2.0;
    sections.push((On::Metal, Shape::Poly { v: bottom.into_iter().map(|(q, b)| (q + Vec2::new(shift, 0.0), b)).collect(), closed: true }));
    // The pair runs from the top's left edge to the bottom's right edge: centred on the origin.
    let total = span / 2.0 + shift + p.width / 2.0;
    let by = Vec2::new(-(shift + p.width / 2.0 - span / 2.0) / 2.0, 0.0);
    k.sections = Some((sections.into_iter().map(|(on, s)| (on, moved(s, by))).collect(), total));
    Ok(k)
}
