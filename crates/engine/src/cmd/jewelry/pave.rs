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
        self.loops
            .iter()
            .flat_map(|l| l.windows(2))
            .filter_map(|w| w.first().zip(w.get(1)).map(|(a, b)| segment_distance(p, *a, *b)))
            .fold(f64::INFINITY, f64::min)
    }
}

/// The distance from `p` to the segment `a`–`b`.
fn segment_distance(p: Vec2, a: Vec2, b: Vec2) -> f64 {
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
            .params("{handles?: [closed region] | along: [path handles], pattern?: grid|brick|trench|double (default: brick in a region, trench along a path), rows?: 1..4 (along a path), count?: per path (even spacing), stoneWidth?: mm (the melee, default 1.3), cut?: (default round), depth?, stone?:|sg?, clearance?: mm (default 0.15), edge?: mm (extra inset from the region's edge, default 0), layer?, highlight?: bool} → {placed, handles: [...], pattern, pitch, skipped: {edge, outside}, carat, stone: {...}, largestFitting, notes}")
            .interactive(|_| Ok(Box::new(PaveM::default()))),
        CommandSpec::new("gemfit", "Gem Fit", run_fit)
            .alias(&["pavefit"])
            .params("{handles?: [closed region], clearance?: mm (default 0.15), cut?, depth?, stone?:|sg?, limit?: calibrated sizes to test (default all)} → {region: {area, narrowest}, largestFitting, fits: [{mm, count, carat}], message}")
            .noundo(),
    ]
}

/// One region's fill: the stones kept and what was dropped.
pub(super) struct Fill {
    pub(super) stones: Vec<(Vec2, f64)>,
    pub(super) dropped_edge: usize,
    pub(super) dropped_outside: usize,
}

/// The brick fill, for a test that checks the arithmetic without a drawing.
#[cfg(test)]
pub(super) fn fill_for_test(region: &Region, width: f64, clearance: f64, edge: f64, brick: bool) -> Fill {
    fill_region(region, width, clearance, edge, if brick { Pattern::Brick } else { Pattern::Grid })
}

/// Fill a region with stones of `width` on `pitch`, keeping whole stones inside.
fn fill_region(region: &Region, width: f64, clearance: f64, edge: f64, pattern: Pattern) -> Fill {
    let radius = width / 2.0;
    let margin = radius + clearance + edge;
    let pitch = width + clearance;
    let row_pitch = match pattern {
        Pattern::Brick => pitch * 0.866,
        _ => pitch,
    };
    let mut stones = Vec::new();
    let (mut dropped_edge, mut dropped_outside) = (0usize, 0usize);
    if region.bounds.is_empty() || pitch <= 0.0 {
        return Fill { stones, dropped_edge, dropped_outside };
    }
    let (min, max) = (region.bounds.min, region.bounds.max);
    // As many whole stones as the region takes, centred on it, so a run reads symmetrically.
    let cols = (((max.x - min.x) - 2.0 * margin) / pitch).floor().max(0.0) as i64 + 1;
    let rows = (((max.y - min.y) - 2.0 * margin) / row_pitch).floor().max(0.0) as i64 + 1;
    if (cols + 1) * (rows + 1) > 4_000_000 {
        return Fill { stones, dropped_edge, dropped_outside };
    }
    let start_x = (min.x + max.x) / 2.0 - pitch * (cols - 1) as f64 / 2.0;
    let start_y = (min.y + max.y) / 2.0 - row_pitch * (rows - 1) as f64 / 2.0;
    for row in 0..rows {
        let y = start_y + row as f64 * row_pitch;
        let offset = if pattern == Pattern::Brick && row % 2 == 1 { pitch / 2.0 } else { 0.0 };
        for col in 0..cols {
            let x = start_x + col as f64 * pitch + offset;
            let p = Vec2::new(x, y);
            if !region.contains(p) {
                dropped_outside += 1;
                continue;
            }
            if region.distance_to_edge(p) < margin - 1e-9 {
                dropped_edge += 1;
                continue;
            }
            stones.push((p, 0.0));
            if stones.len() > MAX_STONES {
                return Fill { stones, dropped_edge, dropped_outside };
            }
        }
    }
    Fill { stones, dropped_edge, dropped_outside }
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
    let mut placed: Vec<Handle> = Vec::new();
    let mut skipped_edge = 0usize;
    let mut skipped_outside = 0usize;
    let mut notes: Vec<String> = Vec::new();
    let mut largest: Option<f64> = None;

    if has_along {
        let pattern = Pattern::parse(cmd, p, Pattern::Trench)?;
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
            if n > MAX_STONES {
                notes.push(format!("a path asked for {n} stones; only the first {MAX_STONES} are placed"));
            }
            let row_offsets: Vec<f64> = (0..rows).map(|r| (f64::from(r) - f64::from(rows - 1) / 2.0) * (width + clearance)).collect();
            for i in 0..n.min(MAX_STONES) {
                // Stones sit at the middle of their slot, so a row is centred on the path.
                let d = (f64::from(i as u32) + 0.5) * step;
                let Some((at, tangent)) = path.at(d) else { continue };
                let normal = Vec2::new(-tangent.y, tangent.x);
                for off in &row_offsets {
                    let site = at + normal * *off;
                    placed.push(gem::place_stone(s, &stone, site, tangent.y.atan2(tangent.x), layer.as_deref())?);
                }
            }
        }
    } else {
        let pattern = Pattern::parse(cmd, p, Pattern::Brick)?;
        let regions = regions_of(s, cmd, p)?;
        for region in &regions {
            let fill = fill_region(region, width, clearance, edge, pattern);
            skipped_edge += fill.dropped_edge;
            skipped_outside += fill.dropped_outside;
            // The largest calibrated melee this region would take: the widest that still fits
            // between the edges at its own pitch.
            largest = super::largest_fitting(2.0 * max_inscribed(region), clearance + edge);
            for (at, _) in fill.stones.iter().take(MAX_STONES) {
                placed.push(gem::place_stone(s, &stone, *at, 0.0, layer.as_deref())?);
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
    if let Some(l) = largest
        && l > width + 1e-9
    {
        notes.push(format!("a {} mm melee would have fitted this region", size_json(l)));
    }
    Ok(json!({
        "placed": placed.len(),
        "handles": placed.iter().map(|h| h.hex()).collect::<Vec<_>>(),
        "stone": { "cut": stone.cut.name, "width": size_json(width), "depth": size_json(stone.depth), "caratEach": (carat_each * 1000.0).round() / 1000.0 },
        "clearance": size_json(clearance),
        "carat": (total * 1000.0).round() / 1000.0,
        "largestFitting": largest.map(size_json),
        "skipped": { "edge": skipped_edge, "outside": skipped_outside },
        "notes": notes,
        "message": format!(
            "Pavé: {} stone(s) of {} {} mm — {:.3} ct total{}",
            placed.len(), stone.cut.name, size_json(width), total,
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
        o.remove("along");
        o.remove("handles");
    }
    v
}

/// The largest circle that fits inside a region: the furthest interior point from its edge.
pub(super) fn max_inscribed(region: &Region) -> f64 {
    if region.bounds.is_empty() {
        return 0.0;
    }
    let (min, max) = (region.bounds.min, region.bounds.max);
    let step = ((max.x - min.x).max(max.y - min.y) / 48.0).max(0.05);
    let mut best = 0.0f64;
    let mut y = min.y;
    while y <= max.y {
        let mut x = min.x;
        while x <= max.x {
            let p = Vec2::new(x, y);
            if region.contains(p) {
                let d = region.distance_to_edge(p);
                if d > best {
                    best = d;
                }
            }
            x += step;
        }
        y += step;
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
    let mut rows: Vec<Value> = Vec::new();
    let mut largest: Option<f64> = None;
    let narrowest = regions.iter().map(max_inscribed).fold(0.0f64, f64::max) * 2.0;
    for size in CALIBRATED {
        if size + 2.0 * clearance > narrowest + 1e-9 {
            continue;
        }
        let mut count = 0usize;
        for region in &regions {
            let fill = fill_region(region, size, clearance, 0.0, Pattern::Brick);
            count += fill.stones.len();
        }
        let depth = gem::default_depth(cut, size);
        let carat = gem::carat(cut, size, size, depth, sg) * count as f64;
        if count > 0 {
            largest = Some(size);
        }
        rows.push(json!({ "mm": size_json(size), "count": count, "carat": (carat * 1000.0).round() / 1000.0 }));
    }
    rows.reverse();
    Ok(json!({
        "region": { "narrowest": size_json(narrowest) },
        "largestFitting": largest.map(size_json),
        "fits": rows,
        "clearance": size_json(clearance),
        "message": match largest {
            Some(l) => format!(
                "The region takes melee up to {} mm ({}) with {} mm clearance",
                size_json(l), cut.name, size_json(clearance)
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

/// Lay stones of `stone` along `path` on a fixed pitch, each rotated to the path's tangent
/// (a halo, a channel of melee, a stone run). Returns the inserts.
pub(super) fn lay_along(s: &mut Session, path: &Path, stone: &gem::Stone, pitch: f64, layer: Option<&str>) -> Result<Vec<Handle>> {
    let len = path.length();
    if len <= 1e-9 || pitch <= 0.0 {
        return Ok(Vec::new());
    }
    let n = ((len / pitch).round() as usize).clamp(1, MAX_STONES);
    let step = len / n as f64;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let d = (i as f64 + 0.5) * step;
        let Some((at, tangent)) = path.at(d) else { continue };
        out.push(gem::place_stone(s, stone, at, tangent.y.atan2(tangent.x), layer)?);
    }
    Ok(out)
}
