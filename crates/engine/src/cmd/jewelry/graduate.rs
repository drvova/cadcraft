//! Graduated stones on an eternity or a half eternity band: `PIECE {graduate: {end, curve}}`.
//!
//! The row's stone at 12 o'clock is `melee` (the centre size) and the stones grade, the same on
//! both sides, to `end` at the row's ends: 6 o'clock all the way round an eternity band, 3 and 9
//! o'clock across a half eternity's top. A stone `t` of the way out (0 at the centre, 1 at the
//! end) is `melee + (end − melee) × f(t)`, with `f(t) = t` (`linear`) or the smoothstep
//! `3t² − 2t³` (`smooth`, which holds the centre size longer and eases into the end size),
//! rounded to the 0.1 mm a bench buys melee in (the centre and the end stones are exact).
//!
//! Every stone is seated as an eternity band's are, its table level with the band's outside in
//! the middle of the width, so its girdle lies on its own circle `R_i = top − girdle_drop(depth_i)`.
//! The gap between two neighbours is the arc between their girdles' nearest edges at the mean of
//! their two girdle radii: centres `Δ = lean_i + lean_j + gap / R̄` apart, `lean = atan(d / 2R)`.
//! An eternity band takes the most stones whose pitches go round in 2π and shares what is left
//! equally between every gap (so the row stays symmetric about 12 o'clock); a half eternity packs
//! them at the gap with every centre within 90° of the top. The setting follows each pair: the
//! bead prongs between two stones are sized from the smaller and stand on their mean radius.
//!
//! Stated approximations: the gap is measured along the arc at the mean girdle radius, not as the
//! chord in 3D (within 1 % for stones under a third of the radius); the plan view foreshortens
//! each stone by the cosine of its angle as an ungraduated row does.

use cadcraft_geom::{PI, TAU, Vec2};
use serde_json::{Map, Value, json};

use super::piece_params::{MAX_PIECE_STONES, PieceKind, PieceParams, girdle_drop, stone_depth};
use super::*;

/// The keys `graduate` takes.
const KEYS: [&str; 2] = ["end", "curve"];
/// The least metal each side of the largest stone (mm), as an ungraduated row keeps.
pub(super) const SEAT_EDGE: f64 = 0.3;
/// The least metal a cast seat keeps under the deepest culet (mm).
pub(super) const SEAT_FLOOR: f64 = 0.3;
/// How many counts past the last that fitted the search keeps trying (the pitch of a graduated
/// row is not monotone in the count at small counts).
const SEARCH_PAST: u32 = 24;

/// How the sizes go from the centre to the ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Curve {
    Linear,
    Smooth,
}

impl Curve {
    pub(super) fn name(self) -> &'static str {
        match self {
            Curve::Linear => "linear",
            Curve::Smooth => "smooth",
        }
    }
    pub(super) fn of(name: &str) -> Option<Curve> {
        match name.trim().to_ascii_lowercase().as_str() {
            "linear" | "straight" => Some(Curve::Linear),
            "smooth" | "ease" | "eased" => Some(Curve::Smooth),
            _ => None,
        }
    }
    /// The share of the way from the centre size to the end size at `t` (0–1).
    pub(super) fn ease(self, t: f64) -> f64 {
        let t = if t.is_finite() { t.clamp(0.0, 1.0) } else { 0.0 };
        match self {
            Curve::Linear => t,
            Curve::Smooth => t * t * (3.0 - 2.0 * t),
        }
    }
}

/// `graduate`: the end size and the curve.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct GradeSpec {
    pub end: f64,
    pub curve: Curve,
}

impl GradeSpec {
    /// `graduate` from a piece's JSON: absent, `null` or `false` for none; `true` for linear to
    /// 60 % of the centre size `melee` (to 0.1 mm, at least 0.8); a number for the end size,
    /// linear; or `{end, curve?}`.
    pub(super) fn parse(cmd: &str, p: &Value, melee: f64) -> Result<Option<GradeSpec>> {
        let end_of = |v: Option<&Value>| -> Result<f64> {
            v.and_then(Value::as_f64)
                .filter(|x| x.is_finite() && (0.8..=6.0).contains(x))
                .ok_or_else(|| bad(cmd, "`graduate.end` must be a stone size in millimetres from 0.8 to 6"))
        };
        match p.get("graduate") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => Ok(None),
            Some(Value::Bool(true)) => {
                let end = if melee.is_finite() { ((melee * 6.0).round() / 10.0).clamp(0.8, 6.0) } else { 1.0 };
                Ok(Some(GradeSpec { end, curve: Curve::Linear }))
            }
            Some(v @ Value::Number(_)) => Ok(Some(GradeSpec { end: end_of(Some(v))?, curve: Curve::Linear })),
            Some(Value::Object(o)) => {
                if let Some(k) = o.keys().find(|k| !KEYS.contains(&k.as_str())) {
                    return Err(bad(cmd, format!("`graduate` takes {}, not `{}`", KEYS.join(", "), k.chars().take(24).collect::<String>())));
                }
                let curve = match o.get("curve").filter(|v| !v.is_null()) {
                    None => Curve::Linear,
                    Some(v) => v.as_str().and_then(Curve::of).ok_or_else(|| bad(cmd, "`graduate.curve` must be linear or smooth"))?,
                };
                Ok(Some(GradeSpec { end: end_of(o.get("end"))?, curve }))
            }
            Some(_) => Err(bad(cmd, "`graduate` must be true, false, an end size in mm, or {end: mm, curve?: linear|smooth}")),
        }
    }

    pub(super) fn json(&self) -> Value {
        json!({ "end": self.end, "curve": self.curve.name() })
    }

    /// The size of a stone `t` of the way from the centre (`centre`) to the end.
    pub(super) fn size_at(&self, centre: f64, t: f64) -> f64 {
        let t = if t.is_finite() { t.clamp(0.0, 1.0) } else { 0.0 };
        if t <= 1e-12 {
            return centre;
        }
        if t >= 1.0 - 1e-12 {
            return self.end;
        }
        let d = centre + (self.end - centre) * self.curve.ease(t);
        let (lo, hi) = (centre.min(self.end), centre.max(self.end));
        ((d * 10.0).round() / 10.0).clamp(lo, hi)
    }
}

/// Merge a `graduate` change over the stored one, key by key.
pub(super) fn merge(stored: Option<&Value>, given: &Value) -> Value {
    match (stored.and_then(Value::as_object), given) {
        (Some(old), Value::Object(new)) => {
            let mut out: Map<String, Value> = old.clone();
            for (k, v) in new {
                out.insert(k.clone(), v.clone());
            }
            Value::Object(out)
        }
        _ => given.clone(),
    }
}

/// One stone of a graduated row.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct GradedStone {
    /// Clockwise from 12 o'clock (radians).
    pub angle: f64,
    /// Its diameter (mm).
    pub size: f64,
    pub depth: f64,
    /// The circle its girdle lies on.
    pub radius: f64,
}

impl GradedStone {
    /// The angle half its girdle takes at the ring's centre.
    pub(super) fn lean(&self) -> f64 {
        (self.size / (2.0 * self.radius)).atan()
    }
    /// Its outward direction in the ring's plane (+x right, +y to 12 o'clock).
    pub(super) fn out(&self) -> Vec2 {
        Vec2::new(self.angle.sin(), self.angle.cos())
    }
}

/// A graduated row, worked out.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct GradedRow {
    pub spec: GradeSpec,
    pub stones: Vec<GradedStone>,
    /// The most stones that keep the gap.
    pub most: u32,
    /// All the way round (an eternity band) rather than across the top.
    pub closed: bool,
    /// The radius the tables lie at.
    pub top: f64,
    /// The least metal between neighbouring girdles (`None` with fewer than two stones).
    pub least: Option<f64>,
}

impl GradedRow {
    /// Each size with how many stones are that size, largest first.
    pub(super) fn sizes(&self) -> Vec<(f64, usize)> {
        let mut out: Vec<(f64, usize)> = Vec::new();
        for s in &self.stones {
            match out.iter_mut().find(|(d, _)| (d - s.size).abs() < 1e-6) {
                Some(e) => e.1 += 1,
                None => out.push((s.size, 1)),
            }
        }
        out.sort_by(|a, b| b.0.total_cmp(&a.0));
        out
    }
    /// The largest stone, and the deepest.
    pub(super) fn largest(&self) -> Option<&GradedStone> {
        self.stones.iter().max_by(|a, b| a.size.total_cmp(&b.size))
    }
    /// The plain shank between the end stones' outer girdle edges round the bottom, at radius
    /// `ri` (a half eternity's resizing room); the whole round for an eternity band is none.
    pub(super) fn plain(&self, ri: f64) -> f64 {
        if self.closed {
            return 0.0;
        }
        let far = self.stones.iter().map(|s| s.angle.abs() + s.lean()).fold(0.0, f64::max);
        ((TAU - 2.0 * far) * ri).max(0.0)
    }
}

/// The metal between two neighbours `delta` apart (radians), along the arc at their mean radius.
fn metal(a: &GradedStone, b: &GradedStone, delta: f64) -> f64 {
    (a.radius + b.radius) / 2.0 * (delta - a.lean() - b.lean())
}

/// The angle between two neighbours' centres that leaves exactly `gap`.
fn pitch(a: &GradedStone, b: &GradedStone, gap: f64) -> f64 {
    a.lean() + b.lean() + gap / ((a.radius + b.radius) / 2.0).max(1e-6)
}

/// Lay `n` stones; `None` when they do not fit (or a stone is too large for the band).
fn lay(p: &PieceParams, spec: &GradeSpec, n: u32, closed: bool) -> Option<(Vec<GradedStone>, Option<f64>)> {
    let cut = p.cut_data()?;
    let top = p.crown();
    if n == 0 || n > MAX_PIECE_STONES || !top.is_finite() {
        return None;
    }
    let count = n as usize;
    let t_of = |i: usize| -> f64 {
        if closed {
            let k = i.min(count - i) as f64;
            if count < 2 { 0.0 } else { k / (count as f64 / 2.0) }
        } else {
            let c = (count as f64 - 1.0) / 2.0;
            if c <= 0.0 { 0.0 } else { (i as f64 - c).abs() / c }
        }
    };
    let mut stones = Vec::with_capacity(count);
    for i in 0..count {
        let size = spec.size_at(p.melee, t_of(i));
        let depth = stone_depth(cut, size);
        let radius = top - girdle_drop(depth);
        if !(size.is_finite() && depth.is_finite() && radius.is_finite() && radius > size / 2.0 && size > 0.0) {
            return None;
        }
        stones.push(GradedStone { angle: 0.0, size, depth, radius });
    }
    let gap = p.gap;
    let pairs = if closed { count } else { count - 1 };
    let deltas: Vec<f64> = (0..pairs).filter_map(|i| Some(pitch(stones.get(i)?, stones.get((i + 1) % count)?, gap))).collect();
    if deltas.len() != pairs || deltas.iter().any(|d| !d.is_finite()) {
        return None;
    }
    if closed {
        let total: f64 = deltas.iter().sum();
        if count >= 2 && total > TAU + 1e-9 {
            return None;
        }
        let spare = if count >= 2 { (TAU - total) / count as f64 } else { 0.0 };
        let mut at = 0.0;
        for (i, s) in stones.iter_mut().enumerate() {
            s.angle = at;
            at += deltas.get(i).copied().unwrap_or(0.0) + spare;
        }
    } else {
        let mut at = 0.0;
        for (i, s) in stones.iter_mut().enumerate() {
            s.angle = at;
            at += deltas.get(i).copied().unwrap_or(0.0);
        }
        let first = stones.first().map_or(0.0, |s| s.angle);
        let last = stones.last().map_or(0.0, |s| s.angle);
        let mid = (first + last) / 2.0;
        for s in stones.iter_mut() {
            s.angle -= mid;
        }
        if stones.iter().any(|s| s.angle.abs() > PI / 2.0 + 1e-9) {
            return None;
        }
    }
    // The metal between every pair of neighbours, as laid.
    let mut least: Option<f64> = None;
    if count >= 2 {
        for i in 0..pairs {
            let (Some(a), Some(b)) = (stones.get(i), stones.get((i + 1) % count)) else { continue };
            let mut delta = b.angle - a.angle;
            if delta <= 0.0 {
                delta += TAU;
            }
            let m = metal(a, b, delta);
            least = Some(least.map_or(m, |x: f64| x.min(m)));
        }
    }
    Some((stones, least))
}

/// The piece's graduated row: an eternity or half eternity band with `graduate`; `None` for any
/// other piece. A row whose count does not fit has no stones and `most` says how many do.
pub(super) fn row(p: &PieceParams) -> Option<GradedRow> {
    let spec = p.graduate?;
    let closed = match p.kind {
        PieceKind::Eternity => true,
        PieceKind::HalfEternity => false,
        _ => return None,
    };
    let mut most = 0u32;
    let mut misses = 0u32;
    for n in 1..=MAX_PIECE_STONES {
        if lay(p, &spec, n, closed).is_some() {
            most = n;
            misses = 0;
        } else {
            misses += 1;
            if misses > SEARCH_PAST {
                break;
            }
        }
    }
    let n = p.count.unwrap_or(most);
    let (stones, least) = if n == 0 { (Vec::new(), None) } else { lay(p, &spec, n, closed).unwrap_or((Vec::new(), None)) };
    Some(GradedRow { spec, stones, most, closed, top: p.crown(), least })
}

/// The row's checks: `stone-seat` (metal each side of the largest stone and the band level under
/// its girdle), `seat-wall` (metal under the deepest culet), `spacing` and `calibrated`.
pub(super) fn checks(p: &PieceParams, row: &GradedRow) -> Vec<(&'static str, bool, String)> {
    let mut out = Vec::new();
    let section = p.section();
    let Some(big) = row.largest() else { return out };
    let deep = row.stones.iter().map(|s| s.depth).fold(0.0, f64::max);
    let edge = (p.width - big.size) / 2.0;
    let fall = section.height_at(0.0) - section.height_at(big.size / 2.0);
    let level = !fall.is_finite() || fall <= girdle_drop(big.depth) + 1e-9;
    let seat_ok = edge + 1e-9 >= SEAT_EDGE && level;
    out.push((
        "stone-seat",
        seat_ok,
        if !level {
            format!(
                "A {} band falls {} mm from its middle to the edge of the {} mm stone, more than its girdle lies under the table: the girdle has no metal beside it",
                p.profile.name(),
                fmt_mm(fall),
                fmt_mm(big.size)
            )
        } else if seat_ok {
            format!("The largest stone ({} mm) leaves {} mm of metal each side of the {} mm band", fmt_mm(big.size), fmt_mm(edge), fmt_mm(p.width))
        } else {
            format!(
                "The largest stone ({} mm) needs a band at least {} mm wide ({SEAT_EDGE} mm of metal each side); this one is {} mm",
                fmt_mm(big.size),
                fmt_mm(big.size + 2.0 * SEAT_EDGE),
                fmt_mm(p.width)
            )
        },
    ));
    let floor = section.height_at(0.0) - deep;
    out.push((
        "seat-wall",
        floor + 1e-9 >= SEAT_FLOOR,
        if floor + 1e-9 >= SEAT_FLOOR {
            format!("The deepest stone ({} mm deep) leaves {} mm of the wall under its culet", fmt_mm(deep), fmt_mm(floor))
        } else {
            format!(
                "The deepest stone is {} mm deep in a {} mm wall: {} mm under the culet, less than the {SEAT_FLOOR} mm a cast seat keeps; thicken the wall or make the stones smaller",
                fmt_mm(deep),
                fmt_mm(section.height_at(0.0)),
                fmt_mm(floor)
            )
        },
    ));
    let n = row.stones.len();
    let where_ = if row.closed { "around the band" } else { "across the top" };
    let least = row.least.unwrap_or(f64::INFINITY);
    out.push((
        "spacing",
        n < 2 || least + 1e-9 >= p.gap,
        format!(
            "{n} graduated stones {where_} with at least {} mm of metal between girdles (the least asked for is {} mm; {} fit)",
            fmt_mm(if least.is_finite() { least.max(0.0) } else { 0.0 }),
            fmt_mm(p.gap),
            row.most
        ),
    ));
    let odd: Vec<String> = row.sizes().iter().filter(|(d, _)| calibrated(*d).is_none()).map(|(d, _)| fmt_mm(*d)).collect();
    out.push((
        "calibrated",
        odd.is_empty(),
        if odd.is_empty() {
            format!("Every size of the graduated row is calibrated ({})", row.sizes().iter().map(|(d, _)| fmt_mm(*d)).collect::<Vec<_>>().join(", "))
        } else {
            format!("The graduated row has sizes a bench does not buy calibrated: {} mm", odd.join(", "))
        },
    ));
    out
}

/// The reply's `stones.graduated`: the spec and every size with its count and carats.
pub(super) fn json(p: &PieceParams, row: &GradedRow) -> Value {
    let sizes: Vec<Value> = row
        .sizes()
        .into_iter()
        .map(|(d, n)| {
            let each = p.stone_sized(CMD_PIECE, d).map(|s| super::piece_params::carat_of(&s)).unwrap_or(0.0);
            json!({ "mm": d, "count": n, "caratEach": (each * 10_000.0).round() / 10_000.0, "carat": (each * n as f64 * 1000.0).round() / 1000.0 })
        })
        .collect();
    json!({
        "end": row.spec.end,
        "curve": row.spec.curve.name(),
        "centre": p.melee,
        "most": row.most,
        "least": row.least.map(size_json),
        "sizes": sizes,
    })
}

const CMD_PIECE: &str = "piece";
