//! `PIECE`: a parametric ring drawn as a sheet from [`PieceParams`], and rebuilt when a number
//! changes.
//!
//! One piece lives in a drawing. `PIECE {kind, …}` draws it, `PIECE {size: 7}` merges that one
//! number over the stored parameters, erases the old sheet and draws the new one in a single undo
//! step, `PIECE {query: true}` reads it back without touching anything, and `PIECE {remove: true}`
//! takes it away. A request that cannot be built is refused and leaves the drawing as it was.
//!
//! # The sheet
//!
//! Everything is millimetres, placed through `INSUNITS` like every jewelry command, around `at`
//! (the centre of the front view). The views are laid out as a bench drawing is read:
//!
//! - **Front view** (looking along the finger): the finger circle and the outside circle, as one
//!   insert of the block `RING-PIECE`, whose description is the `ring:` record `RING` writes — so
//!   `TECHSHEET` and `DESCRIBE` read the band's size, metal and weight with no special case, and
//!   `RINGSIZES {handle}` measures it. A solitaire's stone stands on top at 12 o'clock as its
//!   side profile (table, crown, girdle, pavilion, culet) with the culet 0.5 mm clear of the band
//!   and the two prongs the view shows drawn as lines from the band to their tips over the
//!   girdle. An eternity band's stones are drawn as their side profiles at their angles, tables
//!   level with the band's outside.
//! - **Section** (to the right): the band's cross-section, `width` across by `wall` high, the
//!   finger side down, as one closed polyline with exact arcs: flat, dome (a half-round), comfort
//!   (the dome with the finger side eased), court (a lens), knife (two faces meeting at a ridge),
//!   bevel (chamfered edges) or concave (hollowed between two raised edges), each as the shared
//!   module defines it. An eternity band's section carries the stone's profile in its seat.
//! - **Plan** (under the front view, seen from above): the band as a rectangle `outer` long by
//!   `width` wide. A solitaire's stone is here as a real `GEM` insert (its true girdle, its length
//!   along the finger), with its prongs as circles on the girdle where `SETTING` would put them
//!   and the halo's melee around it. An eternity band's visible half is drawn foreshortened: the
//!   stone at angle φ from the top sits at `R·sin φ` and is `cos φ` as wide.
//! - **Layout** (eternity only, under the plan): the band unrolled at the stones' girdle circle,
//!   `2π·R` long, with every stone as a real `GEM` insert on its pitch. This is the view the
//!   stones are counted from; the front view and the plan draw the same stones as plain outlines
//!   so nothing is counted twice.
//!
//! Metal goes on the layer `Metal`, stones on `Stones`, prongs on `Settings`; a layer that is
//! missing is made, one that exists is left as it is.
//!
//! # The numbers
//!
//! Every number the sheet shares with the solid (`PIECEMESH`) is worked out in
//! [`super::piece_params`], where each is defined; the sheet only draws them.
//!
//! - A stone's side profile splits its depth (the cut's usual proportion of its width) into a
//!   crown of 26 %, a girdle of 4 % and a pavilion of 70 %, under the table `GEM` draws for the
//!   cut (57 % of the width for a round, 65 % for the step cuts, 60 % for an oval, 62 % for the
//!   rest). A cabochon is a dome on a flat base.
//! - An eternity band's stones are as long as they are wide (`melee`), seated with their tables
//!   level with the band's outside, so their girdles lie on a circle of radius
//!   `R = outer/2 − 0.28 × depth`. The metal between two neighbours is measured there, between
//!   the girdles' nearest edges: `2·√(R² + (melee/2)²)·sin(π/n − atan(melee/2R))`. The most that
//!   fit is the largest `n` that leaves `gap`; a `count` above it is refused with that number.
//! - A halo's melee (round diamonds of the `halo` width) lie on the centre stone's girdle offset
//!   outward by half the prong wire, `gap`, and half a melee, so they clear the prongs; as many
//!   as keep `gap` of metal between them. The prong wire is 15 % of the stone's lesser
//!   dimension, kept between 0.8 and 1.2 mm; the prongs stand on the girdle where `SETTING` puts
//!   them (evenly on a round) and reach 1.15 wire diameters over it.
//! - **Metal weight** is the band alone: its section's area swept around the finger at the
//!   section's centroid (Pappus), at the alloy's density — for a flat band exactly the annulus
//!   `RING` weighs. The prongs and the head are not weighed, and the seats cut for the stones
//!   are not taken off; a bench should read the figure as the band before setting.
//!
//! # Where the piece is kept
//!
//! The piece is a group named `JEWELRY_PIECE`: its members are the sheet's objects and its
//! description is the parameters and the sheet's position as one line of JSON. A group is part
//! of the drawing, so undo and redo restore the geometry and the parameters together, and a DXF
//! save and open keeps both. A rebuild puts the sheet where the band's front view is now (so a
//! piece that was moved rebuilds where it was moved to), unless `at` is given.

use cadcraft_doc::{EntityKind, Group, Handle, Layer};
use cadcraft_geom::{PolyVertex, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::super::*;
use super::pave_band;
use super::piece_params::{self as shared, MIN_CAST_WALL, PieceKind, PieceParams, Row, Section, carat_of, least_spacing};
use super::sizes::RingSize;
use super::*;
use crate::{Accept, Input, Interactive, Prompt, Step};

const CMD: &str = "piece";
/// The group a piece is kept as.
const GROUP: &str = "JEWELRY_PIECE";
/// The block the band's front view is inserted as.
const RING_BLOCK: &str = "RING-PIECE";
/// Most handles a reply lists.
const MAX_HANDLES: usize = 5_000;
/// The space between two views of the sheet (mm).
const VIEW_GAP: f64 = 8.0;
/// The least metal either side of a stone set into a band (mm).
const MIN_EDGE: f64 = 0.3;
/// Furthest a sheet may be placed from the origin, in drawing units.
const MAX_AT: f64 = 1.0e9;
/// The layers a piece is drawn on, with the colour each is made in when it is missing.
const LAYERS: [(&str, u8); 3] = [("Metal", 40), ("Stones", 4), ("Settings", 8)];

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("piece", "Piece", run_piece)
            .menu(&["Draw", "Piece"])
            .alias(&["ringpiece"])
            .params("One parametric ring per drawing, drawn as a sheet (front view, section, plan; an eternity band also its stone layout) in millimetres through INSUNITS, and rebuilt when a number changes. {query: true} → {piece: null | P}, changes nothing. {remove: true} → {piece: null, removed: n objects}. Anything else builds or rebuilds in one undo step: the keys given are merged over the stored piece (or over the defaults, and then `kind` is required): {kind: band|solitaire|threestone|eternity (threestone = a solitaire with one side stone each side of the centre, around the band, each in its own prong head), at?: [x,y] (the front view's centre; default 0,0 for a new piece, where the band is now for a rebuild), system?: us|uk|eu|jp|cn (default us), size?: number|string in that system (default US 6), wall?: mm 0.3–10 (default 1.8, radial thickness), width?: mm 0.5–30 (default 2.2, along the finger), profile?: flat|dome|comfort|court|knife|bevel|concave|{curve: handle} (default flat; {curve} = a closed polyline, spline, circle, ellipse or region of the drawing as the section, X across the width and Y outward, placed by its box (bottom on the finger, centred across), kept by value as profile \"custom\" with profileCurve {curve, points} so it survives the curve; width and wall then come from it and a different one is refused; the same handle again updates from the curve; dome = half-round, comfort = dome outside with the finger side eased, court = a lens curved outside and inside, knife = two faces meeting at a ridge, bevel = flat with 45° chamfered edges, concave = the outside hollowed between two raised edges), comfort?: mm or null (comfort and court: how far the eased inside stands off the finger at the edges; null = a sixth of the wall; 0.05 to the lesser of 40 % of the wall and half the width), ridge?: mm or null (knife: the peak's height; null = 60 % of the wall; 0.05 to 90 % of the wall), bevel?: mm or null (bevel: the chamfer; null = the lesser of a fifth of the width and half the wall; 0.05 to the lesser of 40 % of the width and 80 % of the wall), hollow?: mm or null (concave: the hollow's depth; null = a quarter of the wall; 0.05 to the lesser of 60 % of the wall and 35 % of the width), metal?: gold24|22|18|14|10|9|platinum|palladium|silver|steel|titanium|brass|copper|wax (default gold18), cut?: a GEMLIST cut (default round; the solitaire's centre stone, or every eternity stone), stone?: a GEMLIST stone (default diamond), stoneWidth?: mm 0.5–30 (default 6.5), stoneLength?: mm (default stoneWidth; along the finger), prongs?: 3–8 (default 6), halo?: false|true (1.3)|melee mm 0.8–3 (solitaire: round diamonds around the centre stone; a three-stone ring has none), sideWidth?: mm 0.5–30 or null (threestone: a side stone's width, around the band; null = 60 % of stoneWidth), sideLength?: mm 0.5–30 or null (along the finger; null = the centre stone's proportion of sideWidth), sideCut?: a GEMLIST cut or null (null = `cut`), sideProngs?: 3–8 (default 4; the side stones are the piece's `stone`, and stand at the least angle from the top, at most 60°, that keeps `gap` and half of each prong wire between their side profile and the centre stone's), melee?: mm 0.8–6 (default 1.8, the eternity stones' diameter), count?: 1–400 or null (eternity; null = as many as fit at `gap`), gap?: mm 0–5 (default 0.2, least metal between two stones), pave?: false|true|{layout?: row|rows|honeycomb|scallop (default row; rows = rows side by side, honeycomb = every other row offset half a stone, scallop = one row, each stone in a scallop cut into the band's side), rows?: 1–3 (rows and honeycomb; default 2), melee?: mm 0.8–3 (default 1.3; round diamonds), gap?: mm 0–2 (default 0.2, least metal between two pavé stones), span?: shoulders|top-half|full (60°, 90° or 180° each side of 12 o'clock; default shoulders) or from?/to?: degrees clockwise from 12 o'clock −360–360 (giving them drops `span`), symmetric?: bool (default true: mirrored the other side of 12 o'clock), graduated?: {from: mm, to: mm} or null (sizes from the end nearest 12 o'clock to the far end, to 0.1 mm)} (band, solitaire, threestone: melee on the band's outside, tables square to the surface and level with it, never nearer than 0.3 mm to the band's edge nor overlapping each other or the head; auto-fit: as many as keep `gap` in the span, the rest shared equally between the gaps; an object merges over the stored pavé key by key; true = one row of 1.3 mm on the shoulders)} → {piece: P, message}, P = {params: {kind, system: \"us\", size, sizeText, sizeSystem, wall, width, profile, profileCurve, comfort, ridge, bevel, hollow, metal, cut, stoneLength, stoneWidth, stone, prongs, halo, sideWidth, sideLength, sideCut, sideProngs, melee, count, gap, pave}, handles: [every object of the piece, at most 5000], size: {mm, diameter, circumference, us, usText, uk, eu, jp, cn}, metal: {name, density, grams (the band alone: prongs, head and stone seats are not weighed)}, stones: {count, carat, fits? (eternity: the most that fit at `gap`), pave? {count, carat, layout, rows, gap (the least metal between two pavé stones), asked, rim, head (degrees from 12 o'clock the pavé starts at), arcs, sizes: [{mm, count}], capped}}, checks: [{id: wall|stone-seat|spacing|calibrated|size|pave (when pavé is asked for: rim, spacing and fit), ok, message}], at: [x,y]}. The finger's size is measured where the inside is narrowest (the middle of the width) and the weight is the profile's exact section swept around the finger. `wall` judges the band where it is thinnest (a knife or bevelled band's edges, the middle of a concave one). A stone stands on the outside in the middle of the width; an eternity row on a band that falls away under the stones' girdles (dome, comfort, court, knife) fails `stone-seat`. A failed check is information; a bad parameter, or an eternity `count` that cannot fit at `gap`, or side stones that do not clear the centre stone within 60° of the top, is refused and nothing changes. For a three-stone ring stones.count is 3, `stone-seat` covers all three heads and `spacing` is the metal between the centre stone's setting and a side stone's")
            .interactive(|_| Ok(Box::new(PieceM::default()))),
    ]
}

// ---------------------------------------------------------------------------------------------
// The design: everything a piece is, worked out from its parameters before anything is drawn
// ---------------------------------------------------------------------------------------------

/// The layer a shape goes on.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum On {
    Metal,
    Stones,
    Settings,
}

impl On {
    fn layer(self) -> &'static str {
        match self {
            On::Metal => "Metal",
            On::Stones => "Stones",
            On::Settings => "Settings",
        }
    }
}

/// A shape of the sheet, in millimetres from the front view's centre.
#[derive(Clone, Debug)]
enum Shape {
    Circle {
        c: Vec2,
        r: f64,
    },
    /// Vertices with the bulge of the segment that follows each.
    Poly {
        v: Vec<(Vec2, f64)>,
        closed: bool,
    },
    /// A full ellipse: its centre, its major semi-axis and the minor's ratio to it.
    Ellipse {
        c: Vec2,
        major: Vec2,
        ratio: f64,
    },
}

/// A stone placed as a `GEM` insert, in millimetres from the front view's centre.
struct Placed {
    /// One of the melee (the halo, the eternity row) rather than the centre stone.
    melee: bool,
    at: Vec2,
}

/// A piece worked out: what to draw, what it weighs and what a bench should know about it.
struct Design {
    params: PieceParams,
    centre: Option<gem::Stone>,
    melee: Option<gem::Stone>,
    shapes: Vec<(On, Shape)>,
    placed: Vec<Placed>,
    /// The band's weight in grams.
    grams: f64,
    carat: f64,
    /// Eternity: the most stones that fit at the gap.
    fits: Option<u32>,
    checks: Vec<Value>,
    /// What the piece did not use of what it was given, said in the reply's message.
    notes: Vec<String>,
    /// Pavé on the band, when asked for, and its stones placed in the layout.
    pave: Option<pave_band::PaveFit>,
    pave_stones: Vec<(Vec2, gem::Stone)>,
}

/// A closed outline of straight edges.
fn closed(points: &[Vec2]) -> Shape {
    Shape::Poly { v: points.iter().map(|p| (*p, 0.0)).collect(), closed: true }
}

/// A rectangle centred on `c`, `w` across by `h` high.
fn rect(c: Vec2, w: f64, h: f64) -> Shape {
    let (a, b) = (w / 2.0, h / 2.0);
    closed(&[c + Vec2::new(-a, -b), c + Vec2::new(a, -b), c + Vec2::new(a, b), c + Vec2::new(-a, b)])
}

/// Where a head stands on the sheet: on the band along `up` in the front view (`across` is the
/// stone's width there), and around `plan_at` in the plan.
struct Standing {
    /// The radius of the band's outside where the head stands, and the band's outside radius.
    top: f64,
    ro: f64,
    up: Vec2,
    across: Vec2,
    plan_at: Vec2,
}

/// One stone in its prong head: in the front view its side profile over the band and the two
/// prongs the view shows, as lines from the band to their tips over the girdle; in the plan its
/// prongs as circles on the girdle. The stone itself is placed in the plan by the caller. Answers
/// with how far the head reaches to either side of the front view's middle.
fn draw_head(
    shapes: &mut Vec<(On, Shape)>,
    plan: &mut Vec<(On, Shape)>,
    stone: &gem::Stone,
    head: &shared::Head,
    sites: &[Vec2],
    at: &Standing,
) -> f64 {
    let (top, ro) = (at.top, at.ro);
    let local = |x: f64, y: f64| at.across * x + at.up * y;
    let side = shared::side_profile(stone.cut, stone.width, head.depth);
    shapes.push((On::Stones, place_profile(&side, at.up * (top + head.clear), at.across, at.up)));
    let half = stone.width / 2.0;
    let foot = (shared::PRONG_FOOT * half).min(0.9 * ro);
    let foot_y = (ro * ro - foot * foot).max(0.0).sqrt();
    let (girdle_bottom, tip) = (top + head.girdle_height() - head.girdle / 2.0, top + head.prong_height());
    let mut reach = 0.0f64;
    for sign in [-1.0, 1.0] {
        let line = [local(sign * foot, foot_y), local(sign * half, girdle_bottom), local(sign * half, tip)];
        reach = line.iter().fold(reach, |far, q| far.max(q.x.abs()));
        shapes.push((On::Settings, Shape::Poly { v: line.into_iter().map(|q| (q, 0.0)).collect(), closed: false }));
    }
    for site in sites {
        plan.push((On::Settings, Shape::Circle { c: at.plan_at + *site, r: head.prong / 2.0 }));
    }
    reach
}

/// A profile moved so its origin is at `at`, its across direction is `across` and its up
/// direction is `up` (unit vectors at right angles).
fn place_profile(v: &[(Vec2, f64)], at: Vec2, across: Vec2, up: Vec2) -> Shape {
    Shape::Poly { v: v.iter().map(|(p, b)| (at + across * p.x + up * p.y, *b)).collect(), closed: true }
}

/// A check for the reply, in a jeweler's words.
fn check(id: &str, ok: bool, message: String) -> Value {
    json!({ "id": id, "ok": ok, "message": message })
}

/// Whether a ring size is a standard one in the system it was given in, and how far off if not.
fn size_check(p: &PieceParams) -> Value {
    let size = &p.size;
    let (system, nearest) = match p.system.as_str() {
        "eu" => ("EU", RingSize::from_eu(f64::from(size.eu)).map(|r| (r, r.eu.to_string()))),
        "jp" => ("JP", RingSize::from_jp(f64::from(size.jp)).map(|r| (r, r.jp.to_string()))),
        "cn" => ("CN", RingSize::from_cn(f64::from(size.cn)).map(|r| (r, r.cn.to_string()))),
        "uk" => ("UK", RingSize::from_us((size.us * 4.0).round() / 4.0).map(|r| (r, r.uk()))),
        _ => ("US", RingSize::from_us((size.us * 4.0).round() / 4.0).map(|r| (r, r.us_text()))),
    };
    let step = match system {
        "US" => "quarter size",
        "UK" => "half letter",
        _ => "whole size",
    };
    match nearest {
        Some((r, label)) => {
            let off = size.diameter - r.diameter;
            if off.abs() < 0.005 {
                check("size", true, format!("{system} {label} is a standard size: {} mm inside", fmt_mm(size.diameter)))
            } else {
                check(
                    "size",
                    false,
                    format!(
                        "{} mm inside is not a standard {system} size: {} mm {} {system} {label}, the nearest {step}",
                        fmt_mm(size.diameter),
                        fmt_mm(off.abs()),
                        if off > 0.0 { "over" } else { "under" }
                    ),
                )
            }
        }
        None => check("size", false, format!("{} mm inside is past the last standard {system} size", fmt_mm(size.diameter))),
    }
}

/// Whether a melee size is one a bench buys.
fn calibrated_check(what: &str, mm: Option<f64>) -> Value {
    match mm {
        None => check("calibrated", true, "No melee in this piece".to_string()),
        Some(mm) if calibrated(mm).is_some() => check("calibrated", true, format!("The {what} melee is {} mm, a calibrated size", fmt_mm(mm))),
        Some(mm) => check("calibrated", false, format!("The {what} melee is {} mm, not a calibrated size (0.8–3.0 mm in 0.1 steps)", fmt_mm(mm))),
    }
}

/// Whether the band is thick enough to cast, judged at its thinnest ([`Section::thinnest`]).
fn wall_check(p: &PieceParams, section: &Section) -> Value {
    let (thin, place) = section.thinnest();
    let ok = thin + 1e-9 >= MIN_CAST_WALL;
    match place {
        None if ok => check("wall", true, format!("The wall is {} mm, at or over the {MIN_CAST_WALL} mm a bench casts", fmt_mm(p.wall))),
        None => check("wall", false, format!("The wall is {} mm, under the {MIN_CAST_WALL} mm a bench casts without it failing", fmt_mm(p.wall))),
        Some(place) if ok => check(
            "wall",
            true,
            format!(
                "The wall is {} mm and a {} band is thinnest {place}: {} mm, at or over the {MIN_CAST_WALL} mm a bench casts",
                fmt_mm(p.wall),
                p.profile.name(),
                fmt_mm(thin)
            ),
        ),
        Some(place) => check(
            "wall",
            false,
            format!(
                "The wall is {} mm but a {} band is thinnest {place}: {} mm, under the {MIN_CAST_WALL} mm a bench casts without it failing",
                fmt_mm(p.wall),
                p.profile.name(),
                fmt_mm(thin)
            ),
        ),
    }
}

/// Work a piece out from its parameters. Nothing is drawn; a piece that cannot be made is
/// refused here, before the drawing is touched.
fn design(p: &PieceParams) -> Result<Design> {
    let (ri, ro) = (p.inner() / 2.0, p.outer() / 2.0);
    if !(ri.is_finite() && ro.is_finite() && ri > 0.0 && ro > ri) {
        return Err(bad(CMD, "the band has no size"));
    }
    let grams = p.band_grams();
    let mut shapes: Vec<(On, Shape)> = Vec::new();
    let mut placed: Vec<Placed> = Vec::new();
    let section = p.section();
    // Where a stone stands: the band's outside in the middle of its width.
    let top = p.crown();
    let mut checks = vec![wall_check(p, &section)];
    let mut notes: Vec<String> = Vec::new();
    let (mut centre, mut melee, mut carat, mut fits) = (None, None, 0.0, None);
    // How far the front view reaches to the right, and the plan view above and below its middle.
    let mut front_reach = ro;
    let mut plan_reach = p.width / 2.0;
    // The stone drawn in the section's seat (an eternity band's).
    let mut seated: Option<Vec<(Vec2, f64)>> = None;
    // What is laid out under the plan: the unrolled band's length.
    let mut unrolled: Option<f64> = None;
    // Shapes of the plan view, relative to its centre, placed once the views' reach is known.
    let mut plan: Vec<(On, Shape)> = vec![(On::Metal, rect(Vec2::ZERO, 2.0 * ro, p.width))];
    let mut plan_stones: Vec<Placed> = Vec::new();
    // Stones of the layout, by their distance along it.
    let mut row: Vec<f64> = Vec::new();

    match p.kind {
        PieceKind::Band => {
            checks.push(check("stone-seat", true, "A plain band: no stone to seat".to_string()));
            checks.push(check("spacing", true, "A plain band: no stones to space".to_string()));
            checks.push(calibrated_check("", None));
        }
        PieceKind::Solitaire | PieceKind::ThreeStone => {
            let stone = p.centre_stone(CMD)?;
            let head = p.head();
            let prong = head.prong;
            // Front view: the stone's side profile over the band, and the two prongs the view shows.
            // Plan: the stone itself, its prongs on the girdle, and the halo around it.
            let upright = Standing { top, ro, up: Vec2::new(0.0, 1.0), across: Vec2::new(1.0, 0.0), plan_at: Vec2::ZERO };
            front_reach = front_reach.max(draw_head(&mut shapes, &mut plan, &stone, &head, &p.prong_sites()?, &upright));
            plan_stones.push(Placed { melee: false, at: Vec2::ZERO });
            let mut reach = stone.length.max(stone.width) / 2.0 + prong / 2.0;
            carat = carat_of(&stone);
            let over = (stone.length - p.width).max(0.0) / 2.0;
            let seat_ok = p.width + 1e-9 >= 0.25 * stone.length && 2.0 * ro + 1e-9 >= stone.width + prong;
            let side_stones = if p.kind == PieceKind::ThreeStone { Some((p.sides(), p.side_stone(CMD)?)) } else { None };
            match &side_stones {
                None => checks.push(check(
                    "stone-seat",
                    seat_ok,
                    if seat_ok {
                        format!(
                            "A {} mm band carries the head of a {}×{} mm stone, which overhangs it {} mm each side",
                            fmt_mm(p.width),
                            fmt_mm(stone.length),
                            fmt_mm(stone.width),
                            fmt_mm(over)
                        )
                    } else {
                        format!(
                            "A {} mm band is slight for the head of a {}×{} mm stone: as a rule of thumb give it at least a quarter of the stone's length ({} mm), and a ring wider outside than the stone",
                            fmt_mm(p.width),
                            fmt_mm(stone.length),
                            fmt_mm(stone.width),
                            fmt_mm(0.25 * stone.length)
                        )
                    },
                )),
                Some((_, small)) => {
                    // All three heads stand on the band: the same rule of thumb for each.
                    let sides_ok = p.width + 1e-9 >= 0.25 * small.length;
                    let long = stone.length.max(small.length);
                    checks.push(check(
                        "stone-seat",
                        seat_ok && sides_ok,
                        if seat_ok && sides_ok {
                            format!(
                                "A {} mm band carries the heads of a {}×{} mm stone and two {}×{} mm side stones; the longest overhangs it {} mm each side",
                                fmt_mm(p.width),
                                fmt_mm(stone.length),
                                fmt_mm(stone.width),
                                fmt_mm(small.length),
                                fmt_mm(small.width),
                                fmt_mm((long - p.width).max(0.0) / 2.0)
                            )
                        } else {
                            format!(
                                "A {} mm band is slight for the heads of a {}×{} mm stone and two {}×{} mm side stones: as a rule of thumb give it at least a quarter of the longest stone's length ({} mm), and a ring wider outside than the centre stone",
                                fmt_mm(p.width),
                                fmt_mm(stone.length),
                                fmt_mm(stone.width),
                                fmt_mm(small.length),
                                fmt_mm(small.width),
                                fmt_mm(0.25 * long)
                            )
                        },
                    ));
                }
            }
            match (side_stones, p.halo) {
                (Some((sides, small)), _) => {
                    if !sides.fits {
                        return Err(bad(
                            CMD,
                            format!(
                                "{}×{} mm side stones do not fit beside a {}×{} mm centre stone on a size {} band: within {}° of the top they stand {} mm from it, and their settings need {} mm with a {} mm gap. Give smaller side stones, a smaller gap or a larger ring",
                                fmt_mm(small.length),
                                fmt_mm(small.width),
                                fmt_mm(stone.length),
                                fmt_mm(stone.width),
                                p.size.us_text(),
                                fmt_mm(shared::MAX_SIDE_ANGLE.to_degrees()),
                                fmt_mm(sides.apart.max(0.0)),
                                fmt_mm(sides.metal + p.gap),
                                fmt_mm(p.gap)
                            ),
                        ));
                    }
                    // One side stone each side of the centre, around the band, in its own head.
                    let sites = p.side_prong_sites()?;
                    for side in [-1.0, 1.0] {
                        let out = sides.out(side);
                        let plan_at = Vec2::new(out.x * (top + sides.head.girdle_height()), 0.0);
                        let standing = Standing { top, ro, up: out, across: sides.across(side), plan_at };
                        front_reach = front_reach.max(draw_head(&mut shapes, &mut plan, &small, &sides.head, &sites, &standing));
                        plan_stones.push(Placed { melee: true, at: plan_at });
                    }
                    reach = reach.max(small.length.max(small.width) / 2.0 + sides.head.prong / 2.0);
                    checks.push(check(
                        "spacing",
                        sides.between() + 1e-6 >= p.gap,
                        format!(
                            "The side stones stand {}° from the centre stone, {} mm from it: {} mm of metal between their settings (the least asked for is {} mm)",
                            fmt_mm(sides.angle.to_degrees()),
                            fmt_mm(sides.apart),
                            fmt_mm(sides.between().max(0.0)),
                            fmt_mm(p.gap)
                        ),
                    ));
                    checks.push(calibrated_check("halo", None));
                    carat += 2.0 * carat_of(&small);
                    if p.halo.is_some() {
                        notes.push("A three-stone ring has no halo: `halo` is not used.".to_string());
                    }
                    melee = Some(small);
                }
                (None, None) => {
                    checks.push(check("spacing", true, "One stone: nothing to space".to_string()));
                    checks.push(calibrated_check("halo", None));
                }
                (None, Some(h)) => {
                    let small = p.halo_stone(CMD)?.ok_or_else(|| bad(CMD, "the halo has no stone"))?;
                    let off = head.halo.map_or(shared::halo_offset(prong, p.gap, h), |seat| seat.offset);
                    let sites = p.halo_sites().ok_or_else(|| {
                        bad(CMD, format!("a halo of {} mm melee does not fit around this stone at a {} mm gap", fmt_mm(h), fmt_mm(p.gap)))
                    })?;
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
                    carat += carat_of(&small) * sites.len() as f64;
                    reach = stone.length.max(stone.width) / 2.0 + off + h / 2.0;
                    plan_stones.extend(sites.into_iter().map(|at| Placed { melee: true, at }));
                    melee = Some(small);
                }
            }
            plan_reach = plan_reach.max(reach);
            centre = Some(stone);
        }
        PieceKind::Eternity => {
            let m = p.melee;
            let stone = p.row_stone(CMD)?;
            // The girdles' circle (the tables are level with the band's outside) and the count.
            let seats = p.eternity_row();
            let (depth, rg, most) = (seats.depth, seats.radius, seats.fits);
            if !(rg.is_finite() && rg > m / 2.0) {
                return Err(bad(CMD, format!("{} mm stones are too large to go around this band", fmt_mm(m))));
            }
            if most == 0 {
                return Err(bad(CMD, format!("no {} mm stone fits around this band at a {} mm gap", fmt_mm(m), fmt_mm(p.gap))));
            }
            if let Some(n) = p.count.filter(|n| *n > most) {
                return Err(bad(
                    CMD,
                    format!(
                        "{n} stones of {} mm do not fit around a size {} band at a {} mm gap: {most} fit",
                        fmt_mm(m),
                        p.size.us_text(),
                        fmt_mm(p.gap)
                    ),
                ));
            }
            let n = seats.count(p.count);
            fits = Some(most);
            let side = shared::side_profile(stone.cut, m, depth);
            let outline = if stone.cut.is_circle(m, m) {
                None
            } else {
                Some(shared::girdle_outline(stone.cut, m, m).ok_or_else(|| bad(CMD, "the stone has no outline"))?)
            };
            let length = cadcraft_geom::TAU * rg;
            for i in 0..n {
                // The angle from 12 o'clock, clockwise.
                let phi = Row::angle(i, n);
                let out = Row::out(i, n);
                let along = Vec2::new(-out.y, out.x);
                // Front view: the stone's side, its table on the band's outside.
                shapes.push((On::Stones, place_profile(&side, out * (seats.top - depth), along, out)));
                // Plan: the upper half, each stone as wide as the cosine of its angle leaves it.
                let squeeze = phi.cos();
                if squeeze > 0.05 {
                    let c = Vec2::new(rg * phi.sin(), 0.0);
                    plan.push((
                        On::Stones,
                        match &outline {
                            None => Shape::Ellipse { c, major: Vec2::new(0.0, m / 2.0), ratio: squeeze },
                            Some(pts) => closed(&pts.iter().map(|q| c + Vec2::new(q.x * squeeze, q.y)).collect::<Vec<_>>()),
                        },
                    ));
                }
                row.push((f64::from(i) + 0.5) * length / f64::from(n));
            }
            seated = Some(side);
            unrolled = Some(length);
            let metal = seats.between(n);
            let edge = (p.width - m) / 2.0;
            // The metal under the culet: the outside's height where the row sits, less the stone.
            let seat_height = section.height_at(0.0);
            let under = seat_height - depth;
            let seat_ok = edge + 1e-9 >= MIN_EDGE && under >= -1e-9 && seats.level();
            checks.push(check(
                "stone-seat",
                seat_ok,
                if edge + 1e-9 >= MIN_EDGE && under >= -1e-9 && !seats.level() {
                    format!(
                        "A {} band falls {} mm from its middle to the edge of a {} mm stone, more than the {} mm the girdle lies under the table: the girdle has no metal beside it",
                        p.profile.name(),
                        fmt_mm(seats.fall),
                        fmt_mm(m),
                        fmt_mm(shared::girdle_drop(depth))
                    )
                } else if seat_ok {
                    format!(
                        "A {} mm stone in a {} mm band leaves {} mm of metal each side, and its {} mm depth leaves {} mm of the wall under the culet",
                        fmt_mm(m),
                        fmt_mm(p.width),
                        fmt_mm(edge),
                        fmt_mm(depth),
                        fmt_mm(under)
                    )
                } else if edge + 1e-9 < MIN_EDGE {
                    format!(
                        "A {} mm stone needs a band at least {} mm wide ({MIN_EDGE} mm of metal each side); this one is {} mm",
                        fmt_mm(m),
                        fmt_mm(m + 2.0 * MIN_EDGE),
                        fmt_mm(p.width)
                    )
                } else {
                    format!(
                        "A {} mm stone is {} mm deep and the wall is {} mm: the culet comes through to the finger",
                        fmt_mm(m),
                        fmt_mm(depth),
                        fmt_mm(seat_height)
                    )
                },
            ));
            checks.push(check(
                "spacing",
                metal + 1e-9 >= p.gap,
                format!(
                    "{n} stones of {} mm around the band with {} mm of metal between girdles (the least asked for is {} mm; {most} fit)",
                    fmt_mm(m),
                    fmt_mm(metal.max(0.0)),
                    fmt_mm(p.gap)
                ),
            ));
            checks.push(calibrated_check("eternity", Some(m)));
            carat = carat_of(&stone) * f64::from(n);
            melee = Some(stone);
        }
    }
    checks.push(size_check(p));
    // Pavé on the band: its own check, and its stones in the front view, the plan and the layout.
    let pave = pave_band::fit(p);
    let pave_sheet = pave.as_ref().zip(pave_band::Surface::of(p)).map(|(f, surf)| pave_band::sheet(f, &surf));
    notes.extend(pave_band::unused(p));
    if let Some(f) = &pave {
        checks.push(check("pave", f.ok(), f.message()));
        carat += f.stones.iter().map(|s| pave_band::stone_carat(s.diameter)).sum::<f64>();
    }
    if let Some(sh) = &pave_sheet {
        shapes.extend(sh.front.iter().map(|v| (On::Stones, Shape::Poly { v: v.clone(), closed: true })));
        shapes.extend(sh.scallops.iter().map(|v| (On::Metal, Shape::Poly { v: v.clone(), closed: false })));
        plan.extend(
            sh.plan.iter().map(|(c, r, ratio)| (On::Stones, Shape::Ellipse { c: *c, major: Vec2::new(0.0, *r), ratio: ratio.clamp(0.05, 1.0) })),
        );
    }

    // The section, to the right of the front view, its base (the finger side) down.
    let section_at = Vec2::new(front_reach + VIEW_GAP + p.width / 2.0, -p.wall / 2.0);
    shapes.push((On::Metal, Shape::Poly { v: section.outline().into_iter().map(|(q, b)| (section_at + q, b)).collect(), closed: true }));
    if let Some(side) = &seated {
        let seat = section_at + Vec2::new(0.0, section.height_at(0.0) - p.eternity_row().depth);
        shapes.push((On::Stones, place_profile(side, seat, Vec2::new(1.0, 0.0), Vec2::new(0.0, 1.0))));
    }
    if let Some(sh) = &pave_sheet {
        shapes
            .extend(sh.section.iter().map(|v| (On::Stones, Shape::Poly { v: v.iter().map(|(q, b)| (section_at + *q, *b)).collect(), closed: true })));
    }
    // The plan, under the front view.
    let plan_at = Vec2::new(0.0, -(ro + VIEW_GAP + plan_reach));
    for (on, shape) in plan {
        shapes.push((on, moved(shape, plan_at)));
    }
    placed.extend(plan_stones.into_iter().map(|s| Placed { melee: s.melee, at: plan_at + s.at }));
    // The layout, under the plan: the band unrolled at the girdles' circle.
    if let Some(length) = unrolled {
        let layout_at = plan_at + Vec2::new(0.0, -(plan_reach + VIEW_GAP + p.width / 2.0));
        shapes.push((On::Metal, rect(layout_at, length, p.width)));
        placed.extend(row.into_iter().map(|d| Placed { melee: true, at: layout_at + Vec2::new(d - length / 2.0, 0.0) }));
    }
    // The pavé's layout, under the plan (and under an eternity's layout, which never has pavé):
    // the outside unrolled at the crown, every stone a `GEM` insert. The stones are counted here.
    let mut pave_stones: Vec<(Vec2, gem::Stone)> = Vec::new();
    if let Some(sh) = &pave_sheet {
        let (length, height) = sh.layout;
        let layout_at = plan_at + Vec2::new(0.0, -(plan_reach + VIEW_GAP + height / 2.0));
        shapes.push((On::Metal, rect(layout_at, length, height)));
        for (at, d) in &sh.inserts {
            pave_stones.push((layout_at + *at, pave_band::melee_stone(CMD, *d)?));
        }
    }
    if !(grams.is_finite() && carat.is_finite()) {
        return Err(bad(CMD, "the piece has no weight"));
    }
    Ok(Design { params: p.clone(), centre, melee, shapes, placed, grams, carat, fits, checks, notes, pave, pave_stones })
}

/// A shape moved by `by`.
fn moved(shape: Shape, by: Vec2) -> Shape {
    match shape {
        Shape::Circle { c, r } => Shape::Circle { c: c + by, r },
        Shape::Poly { v, closed } => Shape::Poly { v: v.into_iter().map(|(p, b)| (p + by, b)).collect(), closed },
        Shape::Ellipse { c, major, ratio } => Shape::Ellipse { c: c + by, major, ratio },
    }
}

impl Design {
    /// The band's `ring:` record, as `RING` writes one, so a bench sheet reads the band.
    fn ring_record(&self) -> String {
        let (p, size) = (&self.params, &self.params.size);
        format!(
            "ring: us={} uk={} eu={} jp={} cn={}, mm={}, wall={}, width={}, metal={}, grams={:.2}, profile={}, piece={}",
            size.us_text(),
            size.uk(),
            size.eu,
            size.jp,
            size.cn,
            fmt_mm(size.diameter),
            fmt_mm(p.wall),
            fmt_mm(p.width),
            p.metal,
            self.grams,
            p.profile.name(),
            p.kind.name()
        )
    }

    /// The piece as a reply: `P` of the command's contract.
    fn json(&self, handles: &[Handle], at: Vec2) -> Value {
        let p = &self.params;
        let mut stones = json!({ "count": self.placed.len() + self.pave_stones.len(), "carat": (self.carat * 1000.0).round() / 1000.0 });
        if let (Some(fits), Some(o)) = (self.fits, stones.as_object_mut()) {
            o.insert("fits".into(), json!(fits));
        }
        if let (Some(f), Some(o)) = (&self.pave, stones.as_object_mut()) {
            o.insert("pave".into(), f.json());
        }
        json!({
            "params": p.json(),
            "handles": handles.iter().take(MAX_HANDLES).map(|h| h.hex()).collect::<Vec<_>>(),
            "size": p.size.json(),
            "metal": { "name": p.metal, "density": p.density, "grams": (self.grams * 1000.0).round() / 1000.0 },
            "stones": stones,
            "checks": self.checks,
            "at": [at.x, at.y],
        })
    }

    /// One line a jeweler reads.
    fn line(&self) -> String {
        let p = &self.params;
        let mut out = format!(
            "{} — size {} ({} mm inside), {} × {} mm {} band in {}, about {:.2} g",
            match p.kind {
                PieceKind::Band => "Band",
                PieceKind::Solitaire => "Solitaire",
                PieceKind::ThreeStone => "Three-stone ring",
                PieceKind::Eternity => "Eternity band",
            },
            p.size.us_text(),
            fmt_mm(p.size.diameter),
            fmt_mm(p.width),
            fmt_mm(p.wall),
            p.profile.name(),
            p.metal,
            self.grams
        );
        if let Some(c) = &self.centre {
            let size = if (c.length - c.width).abs() < 1e-6 {
                format!("{} mm", fmt_mm(c.width))
            } else {
                format!("{}×{} mm", fmt_mm(c.length), fmt_mm(c.width))
            };
            out.push_str(&format!("; {} {size} {} of {:.2} ct in {} prongs", c.cut.name, p.stone, carat_of(c), p.prongs));
        }
        let small = self.placed.iter().filter(|s| s.melee).count();
        if let (Some(m), true) = (&self.melee, small > 0) {
            out.push_str(&format!(
                "; {small} × {} mm {}{}, {:.3} ct",
                fmt_mm(m.width),
                m.cut.name,
                match p.kind {
                    PieceKind::ThreeStone => " at the sides",
                    PieceKind::Solitaire => " in the halo",
                    _ => "",
                },
                carat_of(m) * small as f64
            ));
        }
        if let Some(f) = self.pave.as_ref().filter(|f| !f.stones.is_empty()) {
            let carat: f64 = f.stones.iter().map(|s| pave_band::stone_carat(s.diameter)).sum();
            out.push_str(&format!(
                "; {} pavé ({}{}), {:.3} ct, {} mm between stones",
                f.stones.len(),
                f.spec.layout.name(),
                if f.rows.len() > 1 { format!(", {} rows", f.rows.len()) } else { String::new() },
                carat,
                fmt_mm(f.gap.unwrap_or(f.spec.gap).max(0.0))
            ));
        }
        let failed: Vec<&str> = self.checks.iter().filter(|c| c["ok"] == json!(false)).filter_map(|c| c["message"].as_str()).collect();
        for message in failed {
            out.push_str("\nCheck: ");
            out.push_str(message);
        }
        for note in &self.notes {
            out.push_str("\nNote: ");
            out.push_str(note);
        }
        out
    }
}

// ---------------------------------------------------------------------------------------------
// The piece as the drawing keeps it
// ---------------------------------------------------------------------------------------------

/// What the drawing holds under the piece's name.
enum Kept {
    /// No piece.
    Nothing,
    /// A piece: its parameters, where its sheet was put, and its objects that still exist.
    Piece { params: Box<PieceParams>, at: Vec2, members: Vec<Handle> },
    /// A piece's record that can no longer be read (its objects are still known).
    Unreadable { members: Vec<Handle>, why: String },
    /// A group of that name that is not a piece.
    Foreign,
}

/// A sheet position: two finite numbers within reach.
fn at_value(v: &Value) -> Option<Vec2> {
    let a = v.as_array().filter(|a| a.len() == 2)?;
    let (x, y) = (a.first()?.as_f64()?, a.get(1)?.as_f64()?);
    (x.is_finite() && y.is_finite() && x.abs() <= MAX_AT && y.abs() <= MAX_AT).then_some(Vec2::new(x, y))
}

/// Parameters read through their own JSON, so what is drawn, stored and read back are one piece.
fn settled(p: &PieceParams) -> Result<PieceParams> {
    PieceParams::parse(CMD, &p.json())
}

/// Read the stored piece.
fn kept(d: &cadcraft_doc::Drawing) -> Kept {
    let Some(g) = d.groups.iter().find(|g| g.name.eq_ignore_ascii_case(GROUP)) else { return Kept::Nothing };
    let members: Vec<Handle> = g.members.iter().copied().filter(|h| d.entity(*h).is_some()).take(MAX_STONES * 2).collect();
    let Ok(record) = serde_json::from_str::<Value>(&g.description) else { return Kept::Foreign };
    let Some(stored) = record.get("params").filter(|v| v.is_object()) else { return Kept::Foreign };
    match PieceParams::parse(CMD, stored) {
        Ok(params) => Kept::Piece { params: Box::new(params), at: record.get("at").and_then(at_value).unwrap_or(Vec2::ZERO), members },
        Err(e) => Kept::Unreadable { members, why: e.to_string() },
    }
}

/// The one line a piece is stored as.
fn record(p: &PieceParams, at: Vec2) -> String {
    json!({ "at": [at.x, at.y], "params": p.json() }).to_string()
}

/// A `true`/`false` switch that is refused when it is anything else.
fn switch(p: &Value, key: &str) -> Result<bool> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(bad(CMD, format!("`{key}` must be true or false"))),
    }
}

fn run_piece(s: &mut Session, p: &Value) -> Result<Value> {
    let (query, remove) = (switch(p, "query")?, switch(p, "remove")?);
    if query && remove {
        return Err(bad(CMD, "give `query` or `remove`, not both"));
    }
    if query {
        return run_query(s);
    }
    // A refusal part-way leaves the drawing exactly as it was.
    let (doc, selection) = {
        let st = s.state()?;
        (st.doc.clone(), st.selection.clone())
    };
    let result = if remove { run_remove(s) } else { run_build(s, p) };
    if result.is_err()
        && let Ok(st) = s.state_mut()
    {
        st.doc = doc;
        st.selection = selection;
    }
    result
}

/// `PIECE {query}`: the stored piece, read and worked out again; nothing changes.
fn run_query(s: &mut Session) -> Result<Value> {
    match kept(s.doc()?) {
        Kept::Nothing | Kept::Foreign => Ok(json!({ "piece": Value::Null })),
        Kept::Unreadable { why, .. } => Ok(json!({ "piece": Value::Null, "message": format!("The stored piece cannot be read: {why}") })),
        Kept::Piece { params, at, members } => match design(&params) {
            Ok(d) => Ok(json!({ "piece": d.json(&members, at) })),
            Err(e) => Ok(json!({ "piece": Value::Null, "message": format!("The stored piece cannot be built: {e}") })),
        },
    }
}

/// Erase a piece's objects. A piece with an object on a locked layer is not touched.
fn erase_members(s: &mut Session, members: &[Handle]) -> Result<usize> {
    let d = s.doc()?;
    if let Some(layer) = members.iter().filter_map(|h| d.entity(*h)).filter_map(|e| d.layer(&e.common.layer)).find(|l| l.locked) {
        return Err(bad(CMD, format!("the layer `{}` is locked; unlock it to change the piece", layer.name)));
    }
    let d = s.doc_mut()?;
    let mut n = 0;
    for h in members {
        if d.remove_entity(*h).is_some() {
            n += 1;
        }
    }
    d.groups.retain(|g| !g.name.eq_ignore_ascii_case(GROUP));
    let gone: std::collections::HashSet<Handle> = members.iter().copied().collect();
    let selection: Vec<Handle> = s.selection().into_iter().filter(|h| !gone.contains(h)).collect();
    s.set_selection(selection);
    Ok(n)
}

/// `PIECE {remove}`: the piece's objects and its record go.
fn run_remove(s: &mut Session) -> Result<Value> {
    let removed = match kept(s.doc()?) {
        Kept::Nothing | Kept::Foreign => 0,
        Kept::Piece { members, .. } | Kept::Unreadable { members, .. } => erase_members(s, &members)?,
    };
    Ok(
        json!({ "piece": Value::Null, "removed": removed, "message": if removed > 0 { format!("Piece removed ({removed} objects)") } else { "No piece to remove".to_string() } }),
    )
}

/// Build the piece, or rebuild it with the given keys merged over what is stored.
fn run_build(s: &mut Session, p: &Value) -> Result<Value> {
    if s.space().is_paper() {
        return Err(bad(CMD, "a piece is drawn in model space; switch to the Model tab"));
    }
    let mut given = match p {
        Value::Object(o) => o.clone(),
        Value::Null => Map::new(),
        _ => return Err(bad(CMD, "the parameters must be an object")),
    };
    // A drawn profile is read from the drawing here and goes on by value.
    super::profile::resolve(s, CMD, &mut given)?;
    let at_given = match given.get("at").filter(|v| !v.is_null()) {
        None => None,
        Some(v) => Some(at_value(v).ok_or_else(|| bad(CMD, "`at` must be [x, y]: two finite numbers"))?),
    };
    let (base, old_at, members) = match kept(s.doc()?) {
        Kept::Foreign => return Err(bad(CMD, format!("a group named {GROUP} that is not a piece is in the way; rename it"))),
        Kept::Nothing => (None, None, Vec::new()),
        Kept::Unreadable { members, .. } => (None, None, members),
        Kept::Piece { params, at, members } => (Some(*params), Some(at), members),
    };
    // The given keys over the stored piece. The stored size is kept as a US number, so a new
    // `size` without a `system` is read in the system the piece was given in, and a new `system`
    // without a `size` renames the size without changing the finger.
    let has = |key: &str| given.get(key).is_some_and(|v| !v.is_null());
    let (new_size, new_system) = (has("size"), has("system"));
    let mut merged = base.as_ref().map(PieceParams::json).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    for (key, value) in &given {
        if key == "pave" {
            // A pavé change merges over the stored pavé, key by key.
            let next = pave_band::merge(merged.get("pave"), value);
            merged.insert(key.clone(), next);
        } else if !matches!(key.as_str(), "query" | "remove" | "at") {
            merged.insert(key.clone(), value.clone());
        }
    }
    let was = base.as_ref().map(|b| b.system.clone());
    let asked = given.get("system").and_then(Value::as_str).map(shared::system_name);
    let system = match (new_size, new_system) {
        (true, false) => {
            let system = was.unwrap_or_else(|| "us".to_string());
            merged.insert("system".into(), json!(system));
            system
        }
        (false, _) => {
            // The finger stays: the stored size, in the system it is stored in.
            match &base {
                Some(b) => {
                    merged.insert("system".into(), json!("us"));
                    merged.insert("size".into(), json!(shared::round_us(b.size.us)));
                }
                None => {
                    merged.remove("size");
                }
            }
            asked.or(was).unwrap_or_else(|| "us".to_string())
        }
        (true, true) => asked.unwrap_or_else(|| "us".to_string()),
    };
    // What is stored is read back before it is drawn, so a later `query` is this same piece.
    let mut asked_for = PieceParams::parse(CMD, &Value::Object(merged))?;
    asked_for.system = system;
    super::profile::box_given(CMD, &given, &asked_for)?;
    let stored = settled(&asked_for)?;
    let params = stored.clone();
    let plan = design(&params)?;
    // Where the sheet goes: where it was asked for, else where the band is now, else where it was.
    let at = at_given
        .or_else(|| {
            let d = s.doc().ok()?;
            members.iter().filter_map(|h| d.entity(*h)).find_map(|e| match &e.kind {
                EntityKind::Insert(ins) if ins.block.eq_ignore_ascii_case(RING_BLOCK) => Some(ins.insert.xy()),
                _ => None,
            })
        })
        .or(old_at)
        .filter(|at| at.is_finite() && at.x.abs() <= MAX_AT && at.y.abs() <= MAX_AT)
        .unwrap_or(Vec2::ZERO);
    let replaced = erase_members(s, &members)?;
    let handles = draw(s, &plan, at)?;
    let d = s.doc_mut()?;
    d.groups.retain(|g| !g.name.eq_ignore_ascii_case(GROUP));
    d.groups.push(Group { name: GROUP.to_string(), description: record(&stored, at), selectable: true, members: handles.clone() });
    let mut message = plan.line();
    if replaced > 0 {
        message.push_str(&format!("\nRebuilt: {replaced} objects replaced by {}", handles.len()));
    }
    Ok(json!({ "piece": plan.json(&handles, at), "message": message }))
}

/// Draw a design's sheet with its front view centred on `at` (drawing units).
fn draw(s: &mut Session, plan: &Design, at: Vec2) -> Result<Vec<Handle>> {
    // Drawing units in one millimetre.
    let u = 1.0 / mm_per_unit(s);
    if !(u.is_finite() && u > 0.0) {
        return Err(bad(CMD, "the drawing's units cannot be read"));
    }
    let d = s.doc_mut()?;
    for (name, colour) in LAYERS {
        if d.layer(name).is_none() {
            d.layers.push(Layer { color: cadcraft_color::Color::Index(colour), ..Layer::new(name) });
        }
    }
    let p = &plan.params;
    let mut handles = Vec::with_capacity(plan.shapes.len() + plan.placed.len() + 1);
    // The band's front view: the finger circle and the outside circle, as RING's own block.
    let circles = vec![
        EntityKind::Circle(cadcraft_doc::Circle { center: Vec3::ZERO, radius: p.inner() / 2.0 }),
        EntityKind::Circle(cadcraft_doc::Circle { center: Vec3::ZERO, radius: p.outer() / 2.0 }),
    ];
    let ring = sizes::define_block_and_insert(s, RING_BLOCK, circles, &plan.ring_record(), at, u)?;
    on_layer(s, ring, Some(On::Metal.layer()))?;
    handles.push(ring);
    let pt = |q: Vec2| at + q * u;
    for (on, shape) in &plan.shapes {
        let kind = match shape {
            Shape::Circle { c, r } => helpers::circle(pt(*c), r * u),
            Shape::Poly { v, closed } => helpers::lwpoly(v.iter().map(|(q, b)| PolyVertex::with_bulge(pt(*q), *b)).collect(), *closed),
            Shape::Ellipse { c, major, ratio } => EntityKind::Ellipse(cadcraft_doc::Ellipse {
                center: helpers::v3(pt(*c)),
                major: helpers::v3(*major * u),
                ratio: *ratio,
                start: 0.0,
                end: cadcraft_geom::TAU,
            }),
        };
        let h = s.add_entity(kind)?;
        on_layer(s, h, Some(on.layer()))?;
        handles.push(h);
    }
    for stone in &plan.placed {
        let which = if stone.melee { &plan.melee } else { &plan.centre };
        let Some(which) = which else { continue };
        handles.push(gem::place_stone(s, which, pt(stone.at), 0.0, Some(On::Stones.layer()))?);
    }
    for (at, stone) in &plan.pave_stones {
        handles.push(gem::place_stone(s, stone, pt(*at), 0.0, Some(On::Stones.layer()))?);
    }
    Ok(handles)
}

// ---------------------------------------------------------------------------------------------
// From the menu: a kind, then where the sheet goes
// ---------------------------------------------------------------------------------------------

/// Interactive PIECE: the kind of piece, then the front view's centre.
#[derive(Default)]
pub(super) struct PieceM {
    kind: Option<&'static str>,
}

impl PieceM {
    fn choose(&mut self, s: &mut Session, text: &str) -> Step {
        self.kind = match text.trim().to_ascii_lowercase().as_str() {
            "b" | "band" => Some("band"),
            "s" | "solitaire" => Some("solitaire"),
            "t" | "three" | "threestone" | "three-stone" | "trilogy" => Some("threestone"),
            "e" | "eternity" => Some("eternity"),
            _ => {
                s.echo("The piece must be Band, Solitaire, Threestone or Eternity.");
                None
            }
        };
        Step::Continue
    }
}

impl Interactive for PieceM {
    fn name(&self) -> &'static str {
        "PIECE"
    }
    fn prompt(&self, _s: &Session) -> Prompt {
        if self.kind.is_none() {
            Prompt::new("Kind of piece", Accept::TEXT).kw(&["Band", "Solitaire", "Threestone", "Eternity"]).default("Band")
        } else {
            Prompt::new("Specify the centre of the front view", Accept::POINT)
        }
    }
    fn input(&mut self, s: &mut Session, i: Input) -> Result<Step> {
        match i {
            Input::Cancel => Ok(Step::Cancel),
            Input::Enter if self.kind.is_none() => {
                self.kind = Some("band");
                Ok(Step::Continue)
            }
            Input::Text(t) | Input::Keyword(t) if self.kind.is_none() => Ok(self.choose(s, &t)),
            Input::Point(at) => {
                let Some(kind) = self.kind else { return Ok(Step::Continue) };
                let r = run_piece(s, &json!({ "kind": kind, "at": [at.x, at.y] }))?;
                if let Some(m) = r.get("message").and_then(Value::as_str) {
                    s.echo(m.to_string());
                }
                Ok(Step::Done)
            }
            _ => Ok(Step::Continue),
        }
    }
}
