//! Pavé: melee laid along a path or through a region, and the fit check that keeps a design
//! castable.
//!
//! `PAVE` places stones in the trade's patterns — a single row along a path, two rows for a
//! channel, a grid, a brick (half-offset rows) or a tight pavé — with a clearance between stones
//! and from the edge, and it only keeps stones whose whole body fits inside the region. What it
//! cannot place it reports: how many were dropped for the edge, and which calibrated size would
//! have fit better.
//!
//! `GEMFIT` answers the question before the stones are placed: for each calibrated melee size,
//! how many fit in this region, and what is the largest stone the region takes at all.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{Bounds2, Vec2};
use serde_json::{Value, json};

use super::super::*;
use super::gem;
use super::*;
use crate::{Accept, Input, Interactive, Prompt, Step};

/// How the stones are arranged.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pattern {
    /// One stone per cell, rows and columns on the same pitch.
    Grid,
    /// Rows half a pitch apart (the usual pavé).
    Brick,
    /// A single row along the path.
    Trench,
    /// Two rows along the path.
    Double,
}

impl Pattern {
    fn name(self) -> &'static str {
        match self {
            Pattern::Grid => "grid",
            Pattern::Brick => "brick",
            Pattern::Trench => "trench",
            Pattern::Double => "double",
        }
    }

    fn parse(cmd: &str, p: &Value, default: Pattern) -> Result<Pattern> {
        let Some(name) = str_param(p, "pattern") else { return Ok(default) };
        match name.trim().to_ascii_lowercase().as_str() {
            "grid" | "single" => Ok(Pattern::Grid),
            "brick" | "pave" | "pavé" => Ok(Pattern::Brick),
            "trench" | "channel" | "row" => Ok(Pattern::Trench),
            "double" | "two" => Ok(Pattern::Double),
            _ => Err(bad(cmd, "`pattern` must be grid, brick, trench or double")),
        }
    }
}

/// A region to fill: its closed outlines in millimetres, as sampled points.
pub(super) struct Region {
    /// Each closed loop, sampled.
    pub loops: Vec<Vec<Vec2>>,
    pub bounds: Bounds2,
}

impl Region {
    /// Whether `p` is inside every loop (a ring's hole is a loop of its own, so a point in the
    /// hole is outside the metal).
    pub(super) fn contains(&self, p: Vec2) -> bool {
        self.loops.iter().filter(|l| cadcraft_geom::point_in_polygon(l, p)).count() % 2 == 1
    }

    /// The distance from `p` to the nearest outline.
    pub(super) fn distance_to_edge(&self, p: Vec2) -> f64 {
        self.loops.iter().flat_map(|l| edges(l)).map(|(a, b)| segment_distance(p, a, b)).fold(f64::INFINITY, f64::min)
    }
}

/// The edges of a closed loop of points, the closing edge (last point back to the first)
/// included: a loop is stored without a repeated closing point.
fn edges(pts: &[Vec2]) -> impl Iterator<Item = (Vec2, Vec2)> + '_ {
    pts.iter().copied().zip(pts.iter().copied().cycle().skip(1))
}

/// Whether the segments `a`–`b` and `c`–`d` cross each other. Touching is not crossing: each
/// segment's ends must lie on opposite sides of the other by more than a millionth of a micron,
/// so a stone that exactly fills its seat is not refused for a rounding error.
fn segments_cross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool {
    const TOUCH: f64 = 1e-9;
    let (ab, cd) = (b - a, d - c);
    let (lab, lcd) = (ab.len(), cd.len());
    if !(lab > 0.0 && lcd > 0.0) {
        return false;
    }
    let apart = |x: f64, y: f64| (x > TOUCH && y < -TOUCH) || (x < -TOUCH && y > TOUCH);
    apart(ab.cross(c - a) / lab, ab.cross(d - a) / lab) && apart(cd.cross(a - c) / lcd, cd.cross(b - c) / lcd)
}

/// The distance from `p` to the segment `a`–`b`.
pub(super) fn segment_distance(p: Vec2, a: Vec2, b: Vec2) -> f64 {
    let d = b - a;
    let len2 = d.dot(d);
    if len2 < 1e-18 {
        return p.dist(a);
    }
    let t = ((p - a).dot(d) / len2).clamp(0.0, 1.0);
    p.dist(a + d * t)
}

/// Collect the regions named by `handles` (closed polylines, circles, ellipses), in millimetres.
pub(super) fn regions_of(s: &Session, cmd: &str, p: &Value) -> Result<Vec<Region>> {
    let hs = targets(s, p)?;
    if hs.is_empty() {
        return Err(bad(cmd, "give `handles` (a closed region) or `along` (a path)"));
    }
    let k = mm_per_unit(s);
    let d = s.doc()?;
    let mut loops: Vec<Vec<Vec2>> = Vec::new();
    for h in hs {
        let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object {}", h.hex())))?;
        let (pts, closed) =
            entity_loop(e, k).ok_or_else(|| bad(cmd, format!("{} is not a closed region (a closed polyline, circle or ellipse)", h.hex())))?;
        if !closed || pts.len() < 3 {
            return Err(bad(cmd, format!("{} is not a closed region (a closed polyline, circle or ellipse)", h.hex())));
        }
        loops.push(pts);
    }
    // Two or more loops read as one region with holes: a point is inside the metal when it is
    // inside an odd number of them, so a hole in a ring is not filled.
    let bounds = Bounds2::from_points(loops.iter().flatten().copied());
    Ok(vec![Region { loops, bounds }])
}

/// A path to lay stones along: its sampled polyline in millimetres, and whether it closes.
pub(super) struct Path {
    pub pts: Vec<Vec2>,
    pub closed: bool,
}

impl Path {
    /// The path's length.
    fn length(&self) -> f64 {
        let mut t = 0.0;
        for w in self.pts.windows(2) {
            if let [a, b] = w {
                t += a.dist(*b);
            }
        }
        if self.closed
            && let (Some(a), Some(b)) = (self.pts.first(), self.pts.last())
        {
            t += a.dist(*b);
        }
        t
    }
    /// The point `d` along the path, and its tangent.
    fn at(&self, d: f64) -> Option<(Vec2, Vec2)> {
        let mut left = d;
        let n = self.pts.len();
        let last = if self.closed { n } else { n.saturating_sub(1) };
        for i in 0..last {
            let a = *self.pts.get(i)?;
            let b = *self.pts.get((i + 1) % n)?;
            let len = a.dist(b);
            if len < 1e-12 {
                continue;
            }
            if left <= len {
                let t = left / len;
                return Some((a + (b - a) * t, (b - a).normalized()));
            }
            left -= len;
        }
        None
    }
}

/// Collect the paths named by `along` (any open or closed curve), in millimetres.
pub(super) fn paths_of(s: &Session, cmd: &str, p: &Value) -> Result<Vec<Path>> {
    let list = p.get("along").filter(|v| !v.is_null()).ok_or_else(|| bad(cmd, "`along` is required for a path"))?;
    let hs: Vec<Handle> = match list {
        Value::Array(a) => a
            .iter()
            .map(|v| v.as_str().and_then(Handle::parse_hex).ok_or_else(|| bad(cmd, "`along` must be object handles")))
            .collect::<Result<Vec<_>>>()?,
        Value::String(t) => vec![Handle::parse_hex(t).ok_or_else(|| bad(cmd, "`along` must be object handles"))?],
        _ => return Err(bad(cmd, "`along` must be a list of object handles")),
    };
    let k = mm_per_unit(s);
    let d = s.doc()?;
    let mut out = Vec::new();
    for h in hs {
        let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object {}", h.hex())))?;
        let (pts, closed) =
            entity_loop(e, k).ok_or_else(|| bad(cmd, format!("{} is not a path (a polyline, line, arc, circle or ellipse)", h.hex())))?;
        if pts.len() < 2 {
            return Err(bad(cmd, format!("{} has no length", h.hex())));
        }
        out.push(Path { pts, closed });
    }
    Ok(out)
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("pave", "Pavé", run_pave)
            .menu(&["Draw", "Pavé"])
            .params("{handles?: [closed region] | along: [path handles], pattern?: grid|brick|trench|double (default: brick in a region, trench along a path), rows?: 1..4 (along a path), count?: per path (even spacing), stoneWidth?: mm (the melee, default 1.3), length?: mm (an elongated cut's length, default the width), cut?: (default round), depth?, stone?:|sg?, rotate?: degrees counter-clockwise, for a stone that is not round in a region (0 = its length along Y; default: the length along the long axis of the region's bounding box), clearance?: mm (default 0.15), edge?: mm (extra inset from the region's edge, default 0), layer?} → {placed, handles: [...], pattern, pitch: {along, across}, rotate, skipped: {edge, outside}, carat, stone: {cut, length, width, depth, caratEach}, largestFitting (round melee), notes}: in a region a stone is kept only when its own outline at its rotation is clear of every edge")
            .interactive(|_| Ok(Box::new(PaveM::default()))),
        CommandSpec::new("gemfit", "Gem Fit", run_fit)
            .alias(&["pavefit"])
            .params("{handles?: [closed region], clearance?: mm (default 0.15), cut?: (default round), ratio?: length ÷ width for a cut that is not round, 1 to 20 (default the cut's usual: marquise and baguette 2, pear 1.5, emerald and radiant 1.4, oval 1.333, the rest 1), rotate?: degrees counter-clockwise (0 = length along Y; default: the length along the long axis of the region's bounding box), stone?:|sg?, limit?: the largest sizes to report (default all)} → {region: {narrowest}, cut, ratio, rotate, largestFitting, fits: [{mm (the width), length? (a cut that is not round), count, carat}], notes, message}: each calibrated width counted with the fit PAVE places it with (brick rows)")
            .noundo(),
    ]
}

/// One region's fill: the stones kept and what was dropped.
pub(super) struct Fill {
    /// Each stone's centre (mm) and its rotation (radians).
    pub(super) stones: Vec<(Vec2, f64)>,
    pub(super) dropped_edge: usize,
    pub(super) dropped_outside: usize,
    /// The pitch along a row and between rows (mm).
    pub(super) pitch: Vec2,
    /// The fill stopped early: the region asked for more sites, or more fit tests, than one
    /// command runs. What was placed is still correct; the region is not full.
    pub(super) truncated: bool,
}

/// How far apart the rows of a brick of round stones are, as a fraction of the pitch along a
/// row: √3/2, rounded up to the next float, so a stone is never nearer its neighbours in the next
/// row than the pitch. (At 0.866, as it used to be, they were 0.00002 of a pitch too near: under
/// the clearance asked for, and overlapping when it was zero.)
const BRICK_ROWS: f64 = 0.866_025_403_784_438_7;
/// Most grid sites one fill visits.
const MAX_SITES: f64 = 4_000_000.0;
/// Most outline-against-edge tests one fill runs for stones that are not round (a hostile
/// region cannot hold the command for minutes).
const FIT_BUDGET: u64 = 20_000_000;
/// Points an elongated stone's outline is tested with at most; past it the stone's box is used.
const MAX_FOOTPRINT_POINTS: usize = 2_048;

/// A stone's footprint at its rotation: what the fit test and the pitch are taken from.
///
/// A round stone is its circle. Any other cut is its own girdle — the outline `GEM` draws,
/// turned by the stone's rotation — and not the box around it: a marquise's tips and a
/// trillion's corners reach the edge of a curved region where the box's empty corners would
/// refuse the stone. Arcs are tested as chords, and the chord error (`sag`) is added to every
/// clearance, so the test errs towards dropping a stone, never towards keeping one that
/// crosses the edge.
pub(super) struct Footprint {
    /// The radius, when the girdle is a circle.
    circle: Option<f64>,
    /// The outline about the stone's centre, turned to its rotation (not used for a circle).
    pts: Vec<Vec2>,
    /// How far the true outline may lie outside the chords of `pts`.
    sag: f64,
    /// The stone's turned box, when the outline has arcs: the stone is inside it too.
    boxed: Option<Vec<Vec2>>,
    /// The stone's extent along a row (x) and across it (y).
    extent: Vec2,
    /// The middle of that extent from the stone's centre (a pear's is not at its centre).
    middle: Vec2,
    /// A circle about the centre that holds the whole stone, and one the stone wholly holds.
    r_out: f64,
    r_in: f64,
    /// The rotation the stone is inserted at (radians).
    rotate: f64,
}

impl Footprint {
    /// A round stone of `width`.
    fn round(width: f64, rotate: f64) -> Footprint {
        let r = width / 2.0;
        Footprint {
            circle: Some(r),
            pts: Vec::new(),
            sag: 0.0,
            boxed: None,
            extent: Vec2::new(width, width),
            middle: Vec2::ZERO,
            r_out: r,
            r_in: r,
            rotate,
        }
    }

    /// The footprint of a cut `length` × `width`, turned by `rotate` (radians, counter-clockwise;
    /// at 0 the length runs along the drawing's Y, as `GEM` draws it).
    pub(super) fn of(cut: &gem::Cut, length: f64, width: f64, rotate: f64) -> Footprint {
        if cut.is_circle(length, width) {
            return Footprint::round(width, rotate);
        }
        // The chord tolerance follows the stone, so the outline's point count does not depend
        // on the stone's size.
        let tol = length.max(width) * 1e-3;
        let (mut pts, mut sag) = match gem::outline(cut, length, width) {
            EntityKind::LwPolyline(pl) => {
                let curved = pl.vertices.iter().any(|v| v.bulge.abs() > 1e-12);
                (cadcraft_geom::Polyline { vertices: pl.vertices, closed: true }.tessellate(tol), if curved { tol } else { 0.0 })
            }
            EntityKind::Ellipse(el) => {
                const N: usize = 128;
                let e = cadcraft_geom::Ellipse::full(el.center.xy(), el.major.xy(), el.ratio);
                let sag = el.major.xy().len() * (1.0 - (cadcraft_geom::PI / N as f64).cos());
                ((0..N).map(|i| e.at_param(cadcraft_geom::TAU * i as f64 / N as f64)).collect(), sag)
            }
            _ => (Vec::new(), 0.0),
        };
        if pts.len() > 1
            && let (Some(first), Some(last)) = (pts.first(), pts.last())
            && first.near(*last, 1e-12)
        {
            pts.pop();
        }
        let (a, b) = (width / 2.0, length / 2.0);
        if pts.len() < 3
            || pts.len() > MAX_FOOTPRINT_POINTS
            || pts.iter().any(|q| !q.is_finite())
            || !cadcraft_geom::point_in_polygon(&pts, Vec2::ZERO)
        {
            // An outline that cannot be used (or one that does not hold the stone's own centre,
            // which the fit test starts from): the stone's box, which holds every cut.
            pts = vec![Vec2::new(-a, -b), Vec2::new(a, -b), Vec2::new(a, b), Vec2::new(-a, b)];
            sag = 0.0;
        }
        for q in &mut pts {
            *q = q.rotate(rotate);
        }
        let bounds = Bounds2::from_points(pts.iter().copied());
        // The outline's own extent at this rotation, with the chord error, and never more than
        // the turned box's (which is exact at 0° and 90°).
        let (sin, cos) = (rotate.sin().abs(), rotate.cos().abs());
        let boxed = Vec2::new(width * cos + length * sin, width * sin + length * cos);
        let extent = Vec2::new((bounds.max.x - bounds.min.x + 2.0 * sag).min(boxed.x), (bounds.max.y - bounds.min.y + 2.0 * sag).min(boxed.y));
        let middle = (bounds.min + bounds.max) * 0.5;
        let r_out = pts.iter().map(|q| q.len()).fold(0.0f64, f64::max) + sag;
        // The centre is inside the outline, so the circle about it that reaches the nearest edge
        // is inside the stone.
        let r_in = edges(&pts).map(|(p, q)| segment_distance(Vec2::ZERO, p, q)).fold(f64::INFINITY, f64::min);
        let r_in = if r_in.is_finite() { r_in } else { 0.0 };
        let corners =
            (sag > 0.0).then(|| [Vec2::new(-a, -b), Vec2::new(a, -b), Vec2::new(a, b), Vec2::new(-a, b)].iter().map(|q| q.rotate(rotate)).collect());
        Footprint { circle: None, pts, sag, boxed: corners, extent, middle, r_out, r_in, rotate }
    }

    /// Whether a stone centred at `p` lies wholly inside `region`, `clearance + edge` clear of
    /// every edge.
    fn fit(&self, region: &Region, p: Vec2, clearance: f64, edge: f64, budget: &mut u64) -> Fit {
        if !region.contains(p) {
            return Fit::Outside;
        }
        let d = region.distance_to_edge(p);
        if let Some(r) = self.circle {
            return if d < r + clearance + edge - 1e-9 { Fit::Edge } else { Fit::Inside };
        }
        let gap = clearance + edge;
        // The circle that holds the stone is clear: so is the stone. The circle the stone holds
        // is not: neither is the stone. Between the two, the outline itself decides.
        if d >= self.r_out + gap - 1e-9 {
            return Fit::Inside;
        }
        if d < self.r_in + gap - 1e-9 {
            return Fit::Edge;
        }
        let reach = self.r_out + gap;
        let outline: Vec<Vec2> = self.pts.iter().map(|q| *q + p).collect();
        let boxed: Option<Vec<Vec2>> = self.boxed.as_ref().map(|b| b.iter().map(|q| *q + p).collect());
        // The stone's centre is in the region and in the stone, so the stone is wholly in the
        // region unless an edge of the region reaches it.
        let cost = outline.len() as u64;
        for (a, b) in region.loops.iter().flat_map(|l| edges(l)) {
            if segment_distance(p, a, b) > reach {
                continue;
            }
            if *budget < cost {
                return Fit::Spent;
            }
            *budget -= cost;
            // The stone lies inside its chords grown by the chord error, and inside its box. An
            // edge that is clear of either is clear of the stone; one clear of neither may not be.
            if polygon_distance(&outline, a, b) < gap + self.sag - 1e-9 && boxed.as_ref().is_none_or(|bx| polygon_distance(bx, a, b) < gap - 1e-9) {
                return Fit::Edge;
            }
        }
        Fit::Inside
    }
}

/// The distance from the segment `a`–`b` to a closed polygon and its inside: zero when they
/// touch, and negative infinity when the segment crosses the polygon's edge or runs inside it
/// (so that it fails a zero clearance, which touching passes).
fn polygon_distance(poly: &[Vec2], a: Vec2, b: Vec2) -> f64 {
    let mut least = f64::INFINITY;
    for (c, e) in edges(poly) {
        if segments_cross(a, b, c, e) {
            return f64::NEG_INFINITY;
        }
        least = least.min(segment_distance(c, a, b)).min(segment_distance(a, c, e)).min(segment_distance(b, c, e));
    }
    if least > 1e-9 && cadcraft_geom::point_in_polygon(poly, a) { f64::NEG_INFINITY } else { least }
}

/// What the fit test says of one site.
enum Fit {
    Inside,
    /// The centre is in the region but the stone's body is not clear of the edge.
    Edge,
    /// The centre is outside the region.
    Outside,
    /// The fit tests one fill may run are spent.
    Spent,
}

/// The rotation an elongated stone takes in a region when none is given: its length along the
/// long axis of the region's bounding box (a quarter turn in a region wider than tall, since a
/// stone is drawn with its length along Y). A stone as long as wide is not turned.
fn default_rotation(region: &Region, length: f64, width: f64) -> f64 {
    let b = &region.bounds;
    if length > width + 1e-9 && !b.is_empty() && (b.max.x - b.min.x) >= (b.max.y - b.min.y) { cadcraft_geom::PI / 2.0 } else { 0.0 }
}

/// The brick fill, for a test that checks the arithmetic without a drawing.
#[cfg(test)]
pub(super) fn fill_for_test(region: &Region, width: f64, clearance: f64, edge: f64, brick: bool) -> Fill {
    fill_region(region, &Footprint::round(width, 0.0), clearance, edge, if brick { Pattern::Brick } else { Pattern::Grid }, FIT_BUDGET)
}

/// The fill of an oriented stone, for a test that checks the fit without a drawing.
#[cfg(test)]
pub(super) fn oriented_fill_for_test(region: &Region, stone: &Footprint, clearance: f64, edge: f64, brick: bool) -> Fill {
    fill_region(region, stone, clearance, edge, if brick { Pattern::Brick } else { Pattern::Grid }, FIT_BUDGET)
}

/// Fill a region with one stone on its pitch, keeping whole stones inside.
///
/// Rows run along X. The pitch along a row is the stone's extent in that direction plus the
/// clearance, and the rows are its extent across plus the clearance apart, so neighbours are a
/// clearance apart whatever the cut and its rotation. Round stones in a brick nest: their rows
/// are √3/2 of the pitch apart ([`BRICK_ROWS`]), which keeps the same clearance between circles.
fn fill_region(region: &Region, stone: &Footprint, clearance: f64, edge: f64, pattern: Pattern, mut budget: u64) -> Fill {
    let pitch = stone.extent.x + clearance;
    let row_pitch = match (pattern, stone.circle) {
        (Pattern::Brick, Some(_)) => pitch * BRICK_ROWS,
        _ => stone.extent.y + clearance,
    };
    let mut fill = Fill { stones: Vec::new(), dropped_edge: 0, dropped_outside: 0, pitch: Vec2::new(pitch, row_pitch), truncated: false };
    if region.bounds.is_empty() || !(pitch > 0.0 && row_pitch > 0.0 && pitch.is_finite() && row_pitch.is_finite()) {
        return fill;
    }
    let (min, max) = (region.bounds.min, region.bounds.max);
    // As many whole stones as the region takes, centred on it, so a run reads symmetrically.
    let margin = Vec2::new(stone.extent.x / 2.0 + clearance + edge, stone.extent.y / 2.0 + clearance + edge);
    let cols = (((max.x - min.x) - 2.0 * margin.x) / pitch).floor().max(0.0) + 1.0;
    let rows = (((max.y - min.y) - 2.0 * margin.y) / row_pitch).floor().max(0.0) + 1.0;
    // Counted as floats: a vast region and a tiny stone must not overflow the count.
    if !(cols.is_finite() && rows.is_finite()) || (cols + 1.0) * (rows + 1.0) > MAX_SITES {
        fill.truncated = true;
        return fill;
    }
    let (cols, rows) = (cols as i64, rows as i64);
    let start_x = (min.x + max.x) / 2.0 - pitch * (cols - 1) as f64 / 2.0 - stone.middle.x;
    let start_y = (min.y + max.y) / 2.0 - row_pitch * (rows - 1) as f64 / 2.0 - stone.middle.y;
    for row in 0..rows {
        let y = start_y + row as f64 * row_pitch;
        let offset = if pattern == Pattern::Brick && row % 2 == 1 { pitch / 2.0 } else { 0.0 };
        for col in 0..cols {
            let x = start_x + col as f64 * pitch + offset;
            let p = Vec2::new(x, y);
            match stone.fit(region, p, clearance, edge, &mut budget) {
                Fit::Outside => fill.dropped_outside += 1,
                Fit::Edge => fill.dropped_edge += 1,
                Fit::Spent => {
                    fill.truncated = true;
                    return fill;
                }
                Fit::Inside => {
                    fill.stones.push((p, stone.rotate));
                    if fill.stones.len() > MAX_STONES {
                        fill.truncated = true;
                        return fill;
                    }
                }
            }
        }
    }
    fill
}

/// The `rotate` parameter: `None` when absent, else radians.
fn rotate_param(cmd: &str, p: &Value) -> Result<Option<f64>> {
    match p.get("rotate") {
        None | Some(Value::Null) => Ok(None),
        Some(_) => angle_or(cmd, p, "rotate", 0.0).map(Some),
    }
}

/// An angle in radians as degrees for a reply: 0 to 360, to a thousandth.
fn degrees_json(a: f64) -> f64 {
    let d = (a.to_degrees().rem_euclid(360.0) * 1000.0).round() / 1000.0;
    if d >= 360.0 { 0.0 } else { d }
}

fn run_pave(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "pave";
    let has_along = p.get("along").is_some_and(|v| !v.is_null());
    let stone_width = mm_default(cmd, p, "stoneWidth", 1.3)?;
    let clearance = mm_zero_or(cmd, p, "clearance", DEFAULT_CLEARANCE)?;
    let edge = mm_zero_or(cmd, p, "edge", 0.0)?;
    let layer = str_param(p, "layer").map(str::to_string);
    if let Some(name) = &layer {
        check_layer(s, cmd, name)?;
    }
    // The stone, from the melee size and the cut (default: a round of the given width).
    let stone = gem::stone_params(cmd, &with_size(p, stone_width))?;
    let width = stone.width;
    let rotate = rotate_param(cmd, p)?;
    let round = stone.cut.is_circle(stone.length, stone.width);
    let elongated = stone.length > stone.width + 1e-9 && !round;
    let size_text = if elongated { format!("{}×{}", size_json(stone.length), size_json(width)) } else { format!("{}", size_json(width)) };
    let pattern_used;
    let mut pitch_used: Option<Vec2> = None;
    let mut rotate_used: Option<f64> = None;
    let mut placed: Vec<Handle> = Vec::new();
    let mut skipped_edge = 0usize;
    let mut skipped_outside = 0usize;
    let mut notes: Vec<String> = Vec::new();
    let mut largest: Option<f64> = None;

    if has_along {
        let pattern = Pattern::parse(cmd, p, Pattern::Trench)?;
        pattern_used = pattern;
        if rotate.is_some() {
            notes.push("`rotate` is for a region; along a path each stone follows the path, its width along it".to_string());
        }
        let rows = match p.get("rows") {
            None | Some(Value::Null) => match pattern {
                Pattern::Double => 2u32,
                _ => 1,
            },
            Some(v) => match v.as_u64() {
                Some(n @ 1..=4) => n as u32,
                _ => return Err(bad(cmd, "`rows` must be 1 to 4")),
            },
        };
        let count = match p.get("count") {
            None | Some(Value::Null) => None,
            Some(v) => match v.as_u64() {
                Some(n) if (1..=MAX_STONES as u64).contains(&n) => Some(n as usize),
                _ => return Err(bad(cmd, "`count` must be 1 or more")),
            },
        };
        let paths = paths_of(s, cmd, p)?;
        for path in &paths {
            let len = path.length();
            if len <= 1e-9 {
                continue;
            }
            let (n, step) = match count {
                Some(n) if n > 0 => (n, len / f64::from(n as u32)),
                _ => {
                    let pitch = width + clearance;
                    let n = (len / pitch).floor().max(1.0) as usize;
                    (n, len / n as f64)
                }
            };
            pitch_used = Some(Vec2::new(step, width + clearance));
            if n > MAX_STONES {
                notes.push(format!("a path asked for {n} stones; only the first {MAX_STONES} are placed"));
            }
            // Paths and regions are read in millimetres; a stone is placed in the drawing's units.
            let k = mm_per_unit(s);
            let row_offsets: Vec<f64> = (0..rows).map(|r| (f64::from(r) - f64::from(rows - 1) / 2.0) * (width + clearance)).collect();
            for i in 0..n.min(MAX_STONES) {
                // Stones sit at the middle of their slot, so a row is centred on the path.
                let d = (f64::from(i as u32) + 0.5) * step;
                let Some((at, tangent)) = path.at(d) else { continue };
                let normal = Vec2::new(-tangent.y, tangent.x);
                for off in &row_offsets {
                    let site = at + normal * *off;
                    placed.push(gem::place_stone(s, &stone, site / k, tangent.y.atan2(tangent.x), layer.as_deref())?);
                }
            }
        }
    } else {
        let pattern = Pattern::parse(cmd, p, Pattern::Brick)?;
        pattern_used = pattern;
        let regions = regions_of(s, cmd, p)?;
        for region in &regions {
            // A stone that is not round is laid at `rotate`, or with its length along the
            // region's long axis, and fitted by its own outline at that rotation.
            let angle = rotate.unwrap_or_else(|| default_rotation(region, stone.length, width));
            let footprint = Footprint::of(stone.cut, stone.length, width, angle);
            let fill = fill_region(region, &footprint, clearance, edge, pattern, FIT_BUDGET);
            pitch_used = Some(fill.pitch);
            rotate_used = Some(angle);
            if !round {
                notes.push(format!(
                    "{} {size_text} mm fitted by its own outline, its length at {}° from the Y axis ({}); pitch {} mm along a row, {} mm between rows",
                    stone.cut.name,
                    degrees_json(angle),
                    match rotate {
                        Some(_) => "as asked",
                        None if elongated => "along the region's long axis",
                        None => "not turned",
                    },
                    size_json(fill.pitch.x),
                    size_json(fill.pitch.y)
                ));
            }
            if fill.truncated {
                notes.push("the fill stopped early (more sites or fit tests than one command runs): the region is not full".to_string());
            }
            skipped_edge += fill.dropped_edge;
            skipped_outside += fill.dropped_outside;
            // The largest calibrated melee this region would take: the widest that still fits
            // between the edges at its own pitch.
            largest = super::largest_fitting(2.0 * max_inscribed(region), clearance + edge);
            let k = mm_per_unit(s);
            for (at, turn) in fill.stones.iter().take(MAX_STONES) {
                placed.push(gem::place_stone(s, &stone, *at / k, *turn, layer.as_deref())?);
            }
        }
    }

    let carat_each = gem::carat(stone.cut, stone.length, stone.width, stone.depth, stone.sg);
    let total = carat_each * placed.len() as f64;
    if calibrated(width).is_none() {
        notes.push(format!("{} mm is not a calibrated melee size", size_json(width)));
    }
    if skipped_edge > 0 {
        notes.push(format!("{skipped_edge} stone(s) dropped: they would have hung over the edge"));
    }
    // `largestFitting` is a round melee's diameter; it says nothing of a stone that is not round.
    if let Some(l) = largest
        && round
        && l > width + 1e-9
    {
        notes.push(format!("a {} mm melee would have fitted this region", size_json(l)));
    }
    Ok(json!({
        "placed": placed.len(),
        "handles": placed.iter().map(|h| h.hex()).collect::<Vec<_>>(),
        "stone": { "cut": stone.cut.name, "length": size_json(stone.length), "width": size_json(width), "depth": size_json(stone.depth), "caratEach": (carat_each * 1000.0).round() / 1000.0 },
        "pattern": pattern_used.name(),
        "pitch": pitch_used.map(|v| json!({ "along": size_json(v.x), "across": size_json(v.y) })),
        "rotate": rotate_used.map(degrees_json),
        "clearance": size_json(clearance),
        "carat": (total * 1000.0).round() / 1000.0,
        "largestFitting": largest.map(size_json),
        "skipped": { "edge": skipped_edge, "outside": skipped_outside },
        "notes": notes,
        "message": format!(
            "Pavé: {} stone(s) of {} {} mm — {:.3} ct total{}",
            placed.len(), stone.cut.name, size_text, total,
            if notes.is_empty() { String::new() } else { format!(" ({})", notes.join("; ")) }
        ),
    }))
}

/// The `{cut, width, depth, stone, sg}` view of a pavé call, so `stone_params` can read it.
fn with_size(p: &Value, width: f64) -> Value {
    let mut v = p.clone();
    if let Some(o) = v.as_object_mut() {
        o.insert("width".into(), json!(width));
        o.remove("diameter");
        o.remove("rotate");
        o.remove("along");
        o.remove("handles");
    }
    v
}

/// The radius of the largest circle that fits inside a region: how far the interior point
/// furthest from the edge is from it.
///
/// The middles of a 48 × 48 grid over the bounding box are looked at first, each axis divided on
/// its own, so a long narrow region has rows inside it; then the best of them climbs — to the
/// better of sixteen neighbours a step away, the step halved when none is better — until the
/// step is a millionth of the region. Inside a convex region the distance to the edge has one
/// summit, so the climb ends on it. (The grid alone, as it used to be, read a 1.62 mm circle as
/// 1.59 mm across and a 100 × 2 mm strip as nothing, so `GEMFIT` and `PAVE` named a melee a
/// size too small, or none.) Both loops are counted, so no coordinate, however large, keeps
/// them running.
pub(super) fn max_inscribed(region: &Region) -> f64 {
    const CELLS: u32 = 48;
    const DIRECTIONS: u32 = 16;
    const CLIMB: usize = 256;
    if region.bounds.is_empty() {
        return 0.0;
    }
    let (min, max) = (region.bounds.min, region.bounds.max);
    let (dx, dy) = ((max.x - min.x) / f64::from(CELLS), (max.y - min.y) / f64::from(CELLS));
    if !(dx.is_finite() && dy.is_finite() && min.is_finite()) {
        return 0.0;
    }
    // How far inside the region a point is: nothing, outside it.
    let depth = |p: Vec2| if region.contains(p) { region.distance_to_edge(p) } else { 0.0 };
    let (mut at, mut best) = (min, 0.0f64);
    for row in 0..CELLS {
        for col in 0..CELLS {
            let p = Vec2::new(min.x + (f64::from(col) + 0.5) * dx, min.y + (f64::from(row) + 0.5) * dy);
            let d = depth(p);
            if d > best {
                (at, best) = (p, d);
            }
        }
    }
    if !(best > 0.0 && best.is_finite()) {
        return 0.0;
    }
    let mut step = dx.max(dy);
    let fine = step * f64::from(CELLS) * 1e-6;
    for _ in 0..CLIMB {
        if step <= fine {
            break;
        }
        let mut moved = false;
        for k in 0..DIRECTIONS {
            let a = cadcraft_geom::TAU * f64::from(k) / f64::from(DIRECTIONS);
            let p = at + Vec2::new(a.cos(), a.sin()) * step;
            let d = depth(p);
            if d > best {
                (at, best, moved) = (p, d, true);
            }
        }
        if !moved {
            step /= 2.0;
        }
    }
    best
}

fn run_fit(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "gemfit";
    let clearance = mm_zero_or(cmd, p, "clearance", DEFAULT_CLEARANCE)?;
    let regions = regions_of(s, cmd, p)?;
    let cut_name = str_param(p, "cut").unwrap_or("round");
    let cut = gem::cut_of(cut_name).ok_or_else(|| bad(cmd, format!("`{cut_name}` is not a cut")))?;
    let sg = match (str_param(p, "stone"), p.get("sg").and_then(Value::as_f64)) {
        (Some(name), _) => gem::sg_of(name).ok_or_else(|| bad(cmd, format!("`{name}` is not a stone")))?,
        (None, Some(sg)) if sg.is_finite() && sg > 0.0 => sg,
        (None, Some(_)) => return Err(bad(cmd, "`sg` must be positive")),
        (None, None) => 3.52,
    };
    // A cut that is not round is sized by its calibrated width and a length-to-width ratio, and
    // counted with the same oriented fit PAVE places it with.
    let ratio = match p.get("ratio") {
        None | Some(Value::Null) => cut.usual_ratio(),
        Some(v) => {
            v.as_f64().filter(|r| r.is_finite() && (1.0..=20.0).contains(r)).ok_or_else(|| bad(cmd, "`ratio` (length ÷ width) must be 1 to 20"))?
        }
    };
    let rotate = rotate_param(cmd, p)?;
    let limit = match p.get("limit") {
        None | Some(Value::Null) => CALIBRATED.len(),
        Some(v) => match v.as_u64() {
            Some(n) if n >= 1 => usize::try_from(n).unwrap_or(usize::MAX),
            _ => return Err(bad(cmd, "`limit` must be 1 or more")),
        },
    };
    let round = cut.is_circle(ratio, 1.0);
    let mut rows: Vec<Value> = Vec::new();
    let mut largest: Option<f64> = None;
    let mut truncated = false;
    let mut turned: Option<f64> = None;
    let narrowest = regions.iter().map(max_inscribed).fold(0.0f64, f64::max) * 2.0;
    for size in CALIBRATED {
        let length = if round { size } else { size * ratio };
        let mut count = 0usize;
        for region in &regions {
            let angle = rotate.unwrap_or_else(|| default_rotation(region, length, size));
            turned = Some(angle);
            let fill = fill_region(region, &Footprint::of(cut, length, size, angle), clearance, 0.0, Pattern::Brick, FIT_BUDGET / 8);
            truncated |= fill.truncated;
            count += fill.stones.len();
        }
        let depth = gem::default_depth(cut, size);
        let carat = gem::carat(cut, length, size, depth, sg) * count as f64;
        // A size is listed when a stone of it was placed; a round one also when the region's
        // inscribed circle takes it and no site of its rows fell there. The count decides, not the
        // circle: measured to a micron, the circle said a 1.2 mm round does not go in a 1.2 mm
        // square, and `PAVE` placed it.
        if count > 0 {
            largest = Some(size);
        } else if !round || size + 2.0 * clearance > narrowest + 1e-9 {
            continue;
        }
        let mut row = json!({ "mm": size_json(size), "count": count, "carat": (carat * 1000.0).round() / 1000.0 });
        if !round && let Some(o) = row.as_object_mut() {
            o.insert("length".into(), json!(size_json(length)));
        }
        rows.push(row);
    }
    rows.reverse();
    rows.truncate(limit);
    let mut notes: Vec<String> = Vec::new();
    if !round {
        notes.push(format!(
            "{} sized by its width, {} long for 1 wide, fitted by its own outline with its length at {}° from the Y axis ({})",
            cut.name,
            size_json(ratio),
            degrees_json(turned.unwrap_or(0.0)),
            if rotate.is_some() {
                "as asked"
            } else if ratio > 1.0 + 1e-9 {
                "along the region's long axis"
            } else {
                "not turned"
            }
        ));
    }
    if truncated {
        notes.push("a count stopped early (more sites or fit tests than one command runs): it is a lower bound".to_string());
    }
    Ok(json!({
        "region": { "narrowest": size_json(narrowest) },
        "cut": cut.name,
        "ratio": if round { 1.0 } else { size_json(ratio) },
        "rotate": if round { Value::Null } else { json!(degrees_json(turned.unwrap_or(0.0))) },
        "largestFitting": largest.map(size_json),
        "fits": rows,
        "clearance": size_json(clearance),
        "notes": notes,
        "message": match largest {
            Some(l) if round => format!(
                "The region takes melee up to {} mm ({}) with {} mm clearance",
                size_json(l), cut.name, size_json(clearance)
            ),
            Some(l) => format!(
                "The region takes {} up to {}×{} mm with {} mm clearance ({})",
                cut.name, size_json(l * ratio), size_json(l), size_json(clearance), notes.join("; ")
            ),
            None => format!("No calibrated melee fits with {} mm clearance", size_json(clearance)),
        },
    }))
}

/// Interactive PAVÉ: pick the region, then the melee width.
#[derive(Default)]
pub(super) struct PaveM {
    picked: Vec<Handle>,
    width: Option<f64>,
}

impl Interactive for PaveM {
    fn name(&self) -> &'static str {
        "PAVE"
    }
    fn prompt(&self, _s: &Session) -> Prompt {
        if self.picked.is_empty() {
            Prompt::new("Select the region to pavé", Accept::SELECT)
        } else {
            Prompt::new("Melee width in mm", Accept::NUMBER).default("1.3")
        }
    }
    fn input(&mut self, s: &mut Session, i: Input) -> Result<Step> {
        match i {
            Input::Cancel => Ok(Step::Cancel),
            Input::Pick(hs) => {
                self.picked = hs;
                Ok(Step::Continue)
            }
            Input::Enter if !self.picked.is_empty() && self.width.is_none() => {
                self.width = Some(1.3);
                self.finish(s)
            }
            Input::Text(t) if !self.picked.is_empty() && self.width.is_none() => match crate::cmd::machines::number(&t).filter(|w| *w > 0.0) {
                Some(w) => {
                    self.width = Some(w);
                    self.finish(s)
                }
                None => {
                    s.echo("The melee width must be a positive number of mm.");
                    Ok(Step::Continue)
                }
            },
            _ => Ok(Step::Continue),
        }
    }
}

impl PaveM {
    fn finish(&mut self, s: &mut Session) -> Result<Step> {
        let width = self.width.unwrap_or(1.3);
        let hs: Vec<String> = self.picked.iter().map(|h| h.hex()).collect();
        let r = run_pave(s, &json!({"handles": hs, "stoneWidth": width}))?;
        if let Some(m) = r.get("message").and_then(Value::as_str) {
            s.echo(m.to_string());
        }
        Ok(Step::Done)
    }
}

/// Lay stones of `stone` along `path` (in millimetres of the drawing) on a fixed pitch, each
/// rotated to the path's tangent (a halo, a channel of melee, a stone run). Returns the inserts.
pub(super) fn lay_along(s: &mut Session, path: &Path, stone: &gem::Stone, pitch: f64, layer: Option<&str>) -> Result<Vec<Handle>> {
    let len = path.length();
    if len <= 1e-9 || pitch <= 0.0 {
        return Ok(Vec::new());
    }
    // As many as go along the path a pitch apart; and since two stones are nearer each other
    // around a bend than they are along it, fewer until every pair is a pitch apart. (Rounded to
    // the nearest count and never checked, as it used to be, a halo's melee overlapped: 1.43 mm
    // stones 1.428 mm apart around a 1 mm round.)
    let sites = |n: usize| -> Vec<(Vec2, Vec2)> {
        let step = len / n as f64;
        (0..n).filter_map(|i| path.at((i as f64 + 0.5) * step)).collect()
    };
    let mut n = ((len / pitch).floor() as usize).clamp(1, MAX_STONES);
    let mut laid = sites(n);
    for _ in 0..FEWER {
        if n <= 1 || least_apart(&laid) + 1e-9 >= pitch {
            break;
        }
        n -= 1;
        laid = sites(n);
    }
    let k = mm_per_unit(s);
    let mut out = Vec::with_capacity(laid.len());
    for (at, tangent) in laid {
        out.push(gem::place_stone(s, stone, at / k, tangent.y.atan2(tangent.x), layer)?);
    }
    Ok(out)
}

/// How many times a row along a path is laid again with one stone fewer, to clear a bend.
const FEWER: usize = 64;
/// The most stones every pair of which is measured; of more, each is measured against the
/// [`NEIGHBOURS`] that follow it along the path.
const ALL_PAIRS: usize = 512;
const NEIGHBOURS: usize = 8;

/// The least distance between two of the sites of a row around a closed path.
fn least_apart(sites: &[(Vec2, Vec2)]) -> f64 {
    let n = sites.len();
    let reach = if n <= ALL_PAIRS { n } else { NEIGHBOURS + 1 };
    let mut least = f64::INFINITY;
    for (i, (a, _)) in sites.iter().enumerate() {
        for (b, _) in sites.iter().cycle().skip(i + 1).take(reach.min(n).saturating_sub(1)) {
            least = least.min(a.dist(*b));
        }
    }
    least
}
