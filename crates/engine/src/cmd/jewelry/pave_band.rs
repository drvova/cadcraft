//! Pavé on the band: melee laid on the outside of a parametric piece's shank, as a bench's
//! pavé plug-ins lay them — one row along the top, two or three rows side by side, a honeycomb
//! (offset rows), or a scalloped row — fitted to a span of the band with the gap asked for.
//!
//! `PIECE {pave: …}` takes it ([`PaveSpec`]); the sheet, the bench sheet, the checks and
//! `PIECEMESH` all read the one placement [`fit`] makes, so they cannot disagree.
//!
//! # Where a stone sits
//!
//! The ring lies in the XY plane with the finger along Z and 12 o'clock at +Y, as `PIECEMESH`
//! builds it. A stone is placed by its **angle** θ round the band (clockwise from 12 o'clock,
//! seen from +Z) and its **across** position `u`: the arc length along the band's outside
//! section from the middle of the width (positive towards +Z). With `x(u)` the point across the
//! width that arc length reaches and `h(x)` the outside's height over the finger
//! ([`Section::height_at`], every profile), the surface point is
//! `P = (rᵢ + h(x))·r̂(θ) + x·Ẑ` with `r̂(θ) = (sin θ, cos θ, 0)`, and the surface's outward
//! normal is `N = (r̂ − h′(x)·Ẑ) / √(1 + h′²)`. A stone's **table** lies on the surface at `P`,
//! square to `N` (its table parallel to the surface), its **girdle** centre is `P − N·0.28·depth`
//! and its culet `P − N·depth`: the seat the eternity row uses ("tables level with the band's
//! outside"), on a tilted surface. Stones are round diamonds (as a halo's melee are), their depth
//! the round's usual proportion of their width.
//!
//! # Metal between two stones
//!
//! Between stones `a` and `b` ([`metal_between`]): each girdle's nearest point to the other is
//! taken along the line between the girdle centres, projected into that girdle's plane; the
//! metal is the distance between those two points (less than nothing when the girdles cross).
//! For two stones of one row on a band that is level across them this is exactly the eternity
//! row's `2·√(R² + r²)·sin(Δ/2 − atan(r/R))`. On a tilted surface it is an approximation of the
//! least distance between the two girdle circles, close for the near-neighbours pavé has.
//!
//! # Auto-fit
//!
//! A span is fitted greedily from the end nearest 12 o'clock (for an asymmetric span, from
//! `from`): the first stone's girdle at the span's end (or, for a span that runs through 12
//! o'clock with no head there, one stone centred at 12), every next stone at the least angle
//! that keeps `gap` of metal ([`metal_between`], bisected) in every row, until the next would
//! leave the span. The angle left over is then shared equally between the gaps, so the stones
//! fill the span exactly and the actual gap is at least the one asked for. A span all the way
//! round a plain band (a closed loop) takes the most stones `n` that keep the gap and stands them
//! `360°/n` apart. The count and the actual gap (the least metal between any two stones) are
//! reported. Graduated sizes run linearly from `graduated.from` at the near end to
//! `graduated.to` at the far end, rounded to the calibrated 0.1 mm, each stone sized where the
//! greedy pass puts it.
//!
//! # Rows
//!
//! - `row`: one row in the middle of the width.
//! - `rows`: `rows` (1–3) rows side by side, every row's stones at the same angles; the rows are
//!   the least distance apart across the surface that keeps `gap` (bisected).
//! - `honeycomb`: offset rows: every other row's stones stand half way between its
//!   neighbours', and the rows close up until the diagonal neighbours keep `gap`.
//! - `scallop`: one row in the middle, each stone in a scalloped cut-out of the band's side: the
//!   sheet draws the scallops in the front view, and `STLOUT`'s merged solid cuts the same arcs
//!   into both sides of the band ([`scallop_region`]), in from each side to a girdle's width
//!   and 0.1 mm from the row's middle, so each stone's seat keeps its walls.
//!
//! # What is checked (the `pave` check)
//!
//! - **Rim**: every girdle at least [`PAVE_RIM`] from the band's edge, measured across the
//!   outside's surface (where the outside meets the band's side). A band too narrow for the
//!   rows fails with how wide it would have to be.
//! - **Spacing**: the least metal between any two stones is at least `gap`.
//! - **Fit**: at least one stone fits the span (beside the head), and no culet reaches the
//!   finger.
//! - **The head**: a solitaire's (and a three-stone ring's) pavé starts where a stone at the
//!   crown, seen along the finger, clears the head's outline ([`shared::head_polygon`]: stone,
//!   prongs and feet) by half the prong wire and the larger of `gap` and [`PAVE_HEAD_CLEAR`].
//!
//! A failed check is information, as the other checks are; parameters out of range are refused.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::piece_params::{self as shared, MAX_PIECE_STONES, PieceKind, PieceParams, Section};
use super::*;

/// The least metal between a pavé stone's girdle and the band's edge, across the outside (mm).
/// The bench's usual minimum rim for melee; an approximation measured along the surface.
pub(super) const PAVE_RIM: f64 = 0.3;
/// The least clearance between pavé and a head's outline, beside half the prong wire (mm), when
/// `gap` is smaller.
pub(super) const PAVE_HEAD_CLEAR: f64 = 0.2;
/// How far round the band each named span reaches from 12 o'clock (degrees, each side).
const SHOULDERS: f64 = 60.0;
const TOP_HALF: f64 = 90.0;
const FULL: f64 = 180.0;
/// Samples across half the outside, for its arc length.
const SAMPLES: usize = 400;
/// The keys `pave` takes.
const KEYS: [&str; 9] = ["layout", "rows", "melee", "gap", "span", "from", "to", "symmetric", "graduated"];
/// How many times the fit is retried with a wider internal gap when a tilted neighbour pair
/// comes out under the gap.
const RETRIES: usize = 8;

// ---------------------------------------------------------------------------------------------
// The parameters
// ---------------------------------------------------------------------------------------------

/// How the stones are laid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Layout {
    Row,
    Rows,
    Honeycomb,
    Scallop,
    /// One row between two rails whose lips cover the girdles ([`super::channel`]).
    Channel,
}

impl Layout {
    pub(super) fn name(self) -> &'static str {
        match self {
            Layout::Row => "row",
            Layout::Rows => "rows",
            Layout::Honeycomb => "honeycomb",
            Layout::Scallop => "scallop",
            Layout::Channel => "channel",
        }
    }
    fn of(name: &str) -> Option<Layout> {
        match name.trim().to_ascii_lowercase().as_str() {
            "row" | "single" => Some(Layout::Row),
            "rows" => Some(Layout::Rows),
            "honeycomb" | "offset" => Some(Layout::Honeycomb),
            "scallop" | "scalloped" => Some(Layout::Scallop),
            "channel" => Some(Layout::Channel),
            _ => None,
        }
    }
    /// One row only.
    fn single(self) -> bool {
        matches!(self, Layout::Row | Layout::Scallop | Layout::Channel)
    }
}

/// A named span of the band.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Span {
    /// From the head to 60° each side.
    Shoulders,
    /// The upper half: 90° each side.
    TopHalf,
    /// All the way round.
    Full,
}

impl Span {
    pub(super) fn name(self) -> &'static str {
        match self {
            Span::Shoulders => "shoulders",
            Span::TopHalf => "top-half",
            Span::Full => "full",
        }
    }
    fn of(name: &str) -> Option<Span> {
        match name.trim().to_ascii_lowercase().as_str() {
            "shoulders" | "shoulder" => Some(Span::Shoulders),
            "top-half" | "tophalf" | "top half" | "top" => Some(Span::TopHalf),
            "full" | "all" => Some(Span::Full),
            _ => None,
        }
    }
    /// The span as angles from 12 o'clock (degrees), mirrored each side.
    fn angles(self) -> (f64, f64) {
        match self {
            Span::Shoulders => (0.0, SHOULDERS),
            Span::TopHalf => (0.0, TOP_HALF),
            Span::Full => (0.0, FULL),
        }
    }
}

/// `PIECE`'s `pave`: what was asked for, complete and checked.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PaveSpec {
    pub layout: Layout,
    /// Rows across the band (1 for `row` and `scallop`).
    pub rows: u32,
    /// The stones' diameter (mm); the largest when graduated.
    pub melee: f64,
    /// The least metal between two stones (mm).
    pub gap: f64,
    /// The named span, or `None` when `from` and `to` were given.
    pub span: Option<Span>,
    /// Degrees clockwise from 12 o'clock.
    pub from: f64,
    pub to: f64,
    /// Mirror `from`–`to` on the other side of 12 o'clock.
    pub symmetric: bool,
    /// Graduated sizes: the diameter at the near end and at the far end.
    pub graduated: Option<(f64, f64)>,
}

impl Default for PaveSpec {
    fn default() -> Self {
        let (from, to) = Span::Shoulders.angles();
        PaveSpec { layout: Layout::Row, rows: 1, melee: 1.3, gap: 0.2, span: Some(Span::Shoulders), from, to, symmetric: true, graduated: None }
    }
}

fn number(cmd: &str, o: &Map<String, Value>, key: &str, default: f64, min: f64, max: f64, unit: &str) -> Result<f64> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= min && *x <= max)
            .ok_or_else(|| bad(cmd, format!("`pave.{key}` must be a number{unit} from {min} to {max}"))),
    }
}

impl PaveSpec {
    /// `pave` from a piece's JSON: absent, `null` or `false` for none, `true` for the usual
    /// (one row of 1.3 mm on the shoulders at a 0.2 mm gap), or an object.
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Option<PaveSpec>> {
        let o = match p.get("pave") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::Bool(true)) => return Ok(Some(PaveSpec::default())),
            Some(Value::Object(o)) => o,
            Some(_) => return Err(bad(cmd, "`pave` must be true, false or {layout, rows, melee, gap, span | from and to, symmetric, graduated}")),
        };
        if let Some(k) = o.keys().find(|k| !KEYS.contains(&k.as_str())) {
            return Err(bad(cmd, format!("`pave` takes {}, not `{}`", KEYS.join(", "), k.chars().take(24).collect::<String>())));
        }
        let layout = match o.get("layout").filter(|v| !v.is_null()) {
            None => Layout::Row,
            Some(v) => v.as_str().and_then(Layout::of).ok_or_else(|| bad(cmd, "`pave.layout` must be row, rows, honeycomb, scallop or channel"))?,
        };
        let rows = match o.get("rows").filter(|v| !v.is_null()) {
            None => {
                if layout.single() {
                    1
                } else {
                    2
                }
            }
            Some(v) => v.as_u64().filter(|n| (1..=3).contains(n)).ok_or_else(|| bad(cmd, "`pave.rows` must be 1, 2 or 3"))? as u32,
        };
        let rows = if layout.single() { 1 } else { rows };
        let melee = number(cmd, o, "melee", 1.3, 0.8, 3.0, " of millimetres")?;
        let gap = number(cmd, o, "gap", 0.2, 0.0, 2.0, " of millimetres")?;
        let span = match o.get("span").filter(|v| !v.is_null()) {
            None => None,
            Some(v) => Some(v.as_str().and_then(Span::of).ok_or_else(|| bad(cmd, "`pave.span` must be shoulders, top-half or full"))?),
        };
        let given = |k: &str| o.get(k).is_some_and(|v| !v.is_null());
        let span = if span.is_none() && !given("from") && !given("to") { Some(Span::Shoulders) } else { span };
        let (from, to) = match span {
            Some(s) => s.angles(),
            None => (number(cmd, o, "from", 0.0, -360.0, 360.0, " of degrees")?, number(cmd, o, "to", SHOULDERS, -360.0, 360.0, " of degrees")?),
        };
        if !(to > from + 1e-9 && to - from <= 360.0 + 1e-9) {
            return Err(bad(cmd, "`pave.to` must be more than `pave.from`, and at most 360° beyond it"));
        }
        let symmetric = match o.get("symmetric").filter(|v| !v.is_null()) {
            None => true,
            Some(v) => v.as_bool().ok_or_else(|| bad(cmd, "`pave.symmetric` must be true or false"))?,
        };
        let graduated = match o.get("graduated").filter(|v| !v.is_null()) {
            None | Some(Value::Bool(false)) => None,
            Some(Value::Object(g)) => {
                let read = |k: &str| -> Result<f64> {
                    g.get(k)
                        .and_then(Value::as_f64)
                        .filter(|x| x.is_finite() && (0.8..=3.0).contains(x))
                        .ok_or_else(|| bad(cmd, format!("`pave.graduated.{k}` must be a stone size in millimetres from 0.8 to 3")))
                };
                Some((read("from")?, read("to")?))
            }
            Some(_) => return Err(bad(cmd, "`pave.graduated` must be {from: mm, to: mm} or null")),
        };
        // Graduated stones are sized by their own range; `melee` reads as the largest of them.
        let melee = graduated.map_or(melee, |(a, b)| a.max(b));
        Ok(Some(PaveSpec { layout, rows, melee, gap, span, from, to, symmetric, graduated }))
    }

    /// The spec as JSON: `parse` reads it back to the same spec.
    pub(super) fn json(&self) -> Value {
        json!({
            "layout": self.layout.name(),
            "rows": self.rows,
            "melee": self.melee,
            "gap": self.gap,
            "span": self.span.map(Span::name),
            "from": self.from,
            "to": self.to,
            "symmetric": self.symmetric,
            "graduated": self.graduated.map(|(a, b)| json!({"from": a, "to": b})),
        })
    }

    /// The size of a stone `t` of the way (0–1) from the near end, rounded to 0.1 mm when graduated.
    fn size_at(&self, t: f64) -> f64 {
        match self.graduated {
            None => self.melee,
            Some((a, b)) => {
                let d = a + (b - a) * t.clamp(0.0, 1.0);
                ((d * 10.0).round() / 10.0).clamp(0.8, 3.0)
            }
        }
    }
}

/// Merge a `pave` change over the stored one: an object's keys over the stored object's, so
/// `{pave: {gap: 0.3}}` changes the gap alone; giving `from` or `to` without `span` drops the
/// stored span (the angles then rule), and `true`, `false`, `null` replace it.
pub(super) fn merge(stored: Option<&Value>, given: &Value) -> Value {
    match (stored.and_then(Value::as_object), given) {
        (Some(old), Value::Object(new)) => {
            let mut out = old.clone();
            let angles = new.contains_key("from") || new.contains_key("to");
            for (k, v) in new {
                out.insert(k.clone(), v.clone());
            }
            if angles && !new.contains_key("span") {
                out.insert("span".into(), Value::Null);
            }
            Value::Object(out)
        }
        _ => given.clone(),
    }
}

// ---------------------------------------------------------------------------------------------
// The band's outside
// ---------------------------------------------------------------------------------------------

/// One stone placed on the band, in the solid's frame (millimetres; finger along Z, 12 o'clock +Y).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct PaveStone {
    /// Radians clockwise from 12 o'clock.
    pub angle: f64,
    /// Arc length across the outside from the middle of the width (towards +Z).
    pub across: f64,
    /// Its row, counted from the −Z side.
    pub row: usize,
    pub diameter: f64,
    pub depth: f64,
    /// The table's centre, on the surface.
    pub table: Vec3,
    /// The girdle's centre.
    pub girdle: Vec3,
    pub culet: Vec3,
    /// The surface's outward normal there: the way the table faces.
    pub normal: Vec3,
    /// The direction round the band, clockwise seen from +Z, square to the normal.
    pub around: Vec3,
}

/// The band's outside as pavé reads it: its section and the arc length across it.
#[derive(Clone, Debug)]
pub(super) struct Surface {
    /// The finger's radius.
    pub ri: f64,
    pub section: Section,
    half: f64,
    /// `x` and the arc length to it from the middle, from 0 to the edge.
    xs: Vec<f64>,
    ss: Vec<f64>,
}

impl Surface {
    pub(super) fn of(p: &PieceParams) -> Option<Surface> {
        let section = p.section();
        let ri = p.inner() / 2.0;
        let half = section.width / 2.0;
        if !(ri.is_finite() && half.is_finite() && ri > 0.0 && half > 0.0 && section.wall.is_finite() && section.wall > 0.0) {
            return None;
        }
        let mut xs = Vec::with_capacity(SAMPLES + 1);
        let mut ss = Vec::with_capacity(SAMPLES + 1);
        let mut s = 0.0;
        let mut prev = Vec2::new(0.0, section.height_at(0.0));
        for k in 0..=SAMPLES {
            let x = half * k as f64 / SAMPLES as f64;
            let q = Vec2::new(x, section.height_at(x));
            s += q.dist(prev);
            prev = q;
            xs.push(x);
            ss.push(s);
        }
        (s.is_finite() && s > 0.0).then_some(Surface { ri, section, half, xs, ss })
    }

    /// The arc length across the outside from the middle to either edge.
    pub(super) fn edge(&self) -> f64 {
        self.ss.last().copied().unwrap_or(self.half)
    }

    /// The point across the width (`x`) an arc length `u` from the middle reaches; past the edge,
    /// straight on along the finger.
    pub(super) fn x_of(&self, u: f64) -> f64 {
        let a = u.abs();
        let k = self.ss.partition_point(|s| *s < a);
        let x = match (k.checked_sub(1).and_then(|i| self.ss.get(i).zip(self.xs.get(i))), self.ss.get(k).zip(self.xs.get(k))) {
            (Some((s0, x0)), Some((s1, x1))) => {
                let t = if s1 - s0 > 1e-15 { (a - s0) / (s1 - s0) } else { 0.0 };
                x0 + (x1 - x0) * t
            }
            (None, Some(_)) => 0.0,
            // Past the edge (a band too narrow for its rows): straight on, so stones never meet.
            _ => self.half + (a - self.edge()).max(0.0),
        };
        if u < 0.0 { -x } else { x }
    }

    /// The outside's slope `dh/dx` at `x`.
    fn slope(&self, x: f64) -> f64 {
        let d = 1e-5 * self.half.max(1e-3);
        let (lo, hi) = ((x - d).max(-self.half), (x + d).min(self.half));
        if hi - lo < 1e-12 {
            return 0.0;
        }
        let k = (self.section.height_at(hi) - self.section.height_at(lo)) / (hi - lo);
        // `height_at` is symmetric in x; its slope changes sign through the middle.
        if k.is_finite() { k } else { 0.0 }
    }

    /// The point on the outside at angle `angle`, across `u`, and the outward normal there.
    pub(super) fn point(&self, angle: f64, u: f64) -> (Vec3, Vec3) {
        let x = self.x_of(u);
        let h = self.section.height_at(x);
        let k = self.slope(x);
        let r = Vec3::new(angle.sin(), angle.cos(), 0.0);
        let n = (r - Vec3::Z * k).normalized();
        (r * (self.ri + h) + Vec3::Z * x, n)
    }

    /// A stone of `diameter` with its table on the outside at `angle`, across `u`.
    pub(super) fn stone(&self, angle: f64, u: f64, row: usize, diameter: f64) -> PaveStone {
        let depth = melee_depth(diameter);
        let (table, normal) = self.point(angle, u);
        let around = Vec3::new(angle.cos(), -angle.sin(), 0.0);
        PaveStone {
            angle,
            across: u,
            row,
            diameter,
            depth,
            table,
            girdle: table - normal * shared::girdle_drop(depth),
            culet: table - normal * depth,
            normal,
            around,
        }
    }

    /// How far a culet stands over the finger's side of the band (less than nothing through it).
    pub(super) fn under(&self, c: Vec3) -> f64 {
        c.xy().len() - self.ri - self.section.inside_at(c.z.clamp(-self.half, self.half))
    }
}

/// A round melee's depth: the round's usual proportion of its width.
pub(super) fn melee_depth(d: f64) -> f64 {
    gem::CUTS.first().map_or(0.6 * d, |c| shared::stone_depth(c, d))
}

/// The metal between two stones' girdles (less than nothing when they cross), as the module
/// defines it.
pub(super) fn metal_between(a: &PaveStone, b: &PaveStone) -> f64 {
    let v = b.girdle - a.girdle;
    if v.len() < 1e-12 {
        // One on the other.
        return -(a.diameter + b.diameter) / 2.0;
    }
    let edge = |s: &PaveStone, toward: Vec3| -> Vec3 {
        let flat = toward - s.normal * toward.dot(s.normal);
        let dir = if flat.len() > 1e-12 { flat.normalized() } else { s.around };
        s.girdle + dir * (s.diameter / 2.0)
    };
    let (ea, eb) = (edge(a, v), edge(b, -v));
    let between = eb - ea;
    if between.dot(v) < 0.0 { -between.len() } else { between.len() }
}

/// The least `t` in `[lo, hi]` for which `ok(t)` holds, assuming it holds from there on; `hi`
/// when it never does.
fn least(lo: f64, hi: f64, ok: impl Fn(f64) -> bool) -> f64 {
    if ok(lo) {
        return lo;
    }
    if !ok(hi) {
        return hi;
    }
    let (mut a, mut b) = (lo, hi);
    for _ in 0..60 {
        let m = (a + b) / 2.0;
        if ok(m) { b = m } else { a = m }
    }
    b
}

// ---------------------------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------------------------

/// A placement worked out: the stones and what the check reads.
#[derive(Clone, Debug)]
pub(super) struct PaveFit {
    pub spec: PaveSpec,
    pub stones: Vec<PaveStone>,
    /// The rows' positions across the outside.
    pub rows: Vec<f64>,
    /// The least metal between any two stones; `None` with fewer than two.
    pub gap: Option<f64>,
    /// The least rim between a girdle and the band's edge.
    pub rim: Option<f64>,
    /// The least metal under a culet.
    pub under: Option<f64>,
    /// Where the pavé's span starts beside the head (radians from 12 o'clock); 0 with no head.
    pub head: f64,
    /// The arcs fitted (degrees from 12 o'clock, start and end).
    pub arcs: Vec<(f64, f64)>,
    /// The cap on stones cut the fit short.
    pub capped: bool,
    /// The outside's arc length from the middle to an edge.
    pub edge: f64,
    /// Sentences for the check when it fails.
    pub problems: Vec<String>,
}

impl PaveFit {
    /// The stones by size: (diameter, how many), smallest first.
    pub(super) fn sizes(&self) -> Vec<(f64, usize)> {
        let mut out: Vec<(f64, usize)> = Vec::new();
        for s in &self.stones {
            match out.iter_mut().find(|(d, _)| (d - s.diameter).abs() < 1e-9) {
                Some(slot) => slot.1 += 1,
                None => out.push((s.diameter, 1)),
            }
        }
        out.sort_by(|a, b| a.0.total_cmp(&b.0));
        out
    }

    /// Whether the check passes.
    pub(super) fn ok(&self) -> bool {
        self.problems.is_empty()
    }

    /// The check's sentence.
    pub(super) fn message(&self) -> String {
        if !self.problems.is_empty() {
            return self.problems.join(" ");
        }
        let s = &self.spec;
        let n = self.stones.len();
        let size = match s.graduated {
            Some((a, b)) => format!("{}–{} mm graduated", fmt_mm(a), fmt_mm(b)),
            None => format!("{} mm", fmt_mm(s.melee)),
        };
        let rows = if self.rows.len() > 1 { format!(" in {} rows", self.rows.len()) } else { String::new() };
        format!(
            "{n} pavé stones of {size}{rows} ({}), {} mm of metal between neighbours (asked {} mm), at least {} mm of rim{}",
            s.layout.name(),
            fmt_mm(self.gap.unwrap_or(s.gap).max(0.0)),
            fmt_mm(s.gap),
            fmt_mm(self.rim.unwrap_or(0.0).max(0.0)),
            if self.head > 0.0 {
                format!(", starting {}° from 12 o'clock to clear the head", fmt_mm(self.head.to_degrees()))
            } else {
                String::new()
            }
        )
    }

    /// The reply's `stones.pave`.
    pub(super) fn json(&self) -> Value {
        let carat: f64 = self.stones.iter().map(|s| stone_carat(s.diameter)).sum();
        json!({
            "count": self.stones.len(),
            "carat": (carat * 1000.0).round() / 1000.0,
            "layout": self.spec.layout.name(),
            "rows": self.rows.len(),
            "gap": self.gap.map(size_json),
            "asked": self.spec.gap,
            "rim": self.rim.map(size_json),
            "head": size_json(self.head.to_degrees()),
            "arcs": self.arcs.iter().map(|(a, b)| json!([size_json(*a), size_json(*b)])).collect::<Vec<_>>(),
            "sizes": self.sizes().into_iter().map(|(d, n)| json!({"mm": d, "count": n})).collect::<Vec<_>>(),
            "capped": self.capped,
        })
    }
}

/// A round diamond melee's weight in carats.
pub(super) fn stone_carat(d: f64) -> f64 {
    gem::CUTS.first().map_or(0.0, |c| gem::carat(c, d, d, melee_depth(d), 3.52))
}

/// How a run of stones starts and ends.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum End {
    /// A girdle's edge at the end.
    Edge,
    /// A stone centred on the end (the start only).
    Centre,
    /// The run meets its own mirror image at the end (half a gap from it).
    Mirror,
}

/// One run of columns: `origin` angle, `dir` ±1, `length` radians.
#[derive(Clone, Copy, Debug)]
struct Run {
    origin: f64,
    dir: f64,
    length: f64,
    start: End,
    end: End,
    /// Mirror the run's columns to the other side of 12 o'clock.
    mirror: bool,
}

struct Fitter<'a> {
    surf: &'a Surface,
    spec: &'a PaveSpec,
    rows: Vec<f64>,
    gap: f64,
    /// One size throughout: its step, worked out once.
    fixed: Option<f64>,
}

impl Fitter<'_> {
    /// Every row's stone of `d` at `angle`.
    fn metal_at(&self, d1: f64, d2: f64, step: f64) -> f64 {
        self.rows.iter().map(|u| metal_between(&self.surf.stone(0.0, *u, 0, d1), &self.surf.stone(step, *u, 0, d2))).fold(f64::INFINITY, f64::min)
    }
    /// The least angle between a stone of `d1` and the next of `d2` along every row.
    fn step(&self, d1: f64, d2: f64) -> f64 {
        if let Some(step) = self.fixed {
            return step;
        }
        least(0.0, PI, |a| self.metal_at(d1, d2, a) >= self.gap)
    }
    /// The most angle half a girdle of `d` takes in any row.
    fn half(&self, d: f64) -> f64 {
        self.rows
            .iter()
            .map(|u| {
                let s = self.surf.stone(0.0, *u, 0, d);
                (d / 2.0).atan2(s.girdle.xy().len().max(1e-6))
            })
            .fold(0.0, f64::max)
    }

    /// The columns of a run: (angle from its origin, diameter), at most `budget`.
    fn columns(&self, run: &Run, budget: usize, capped: &mut bool) -> Vec<(f64, f64)> {
        let l = run.length;
        if !(l.is_finite() && l > 0.0) || budget == 0 {
            return Vec::new();
        }
        let size = |phi: f64| self.spec.size_at(phi / l);
        let d0 = size(0.0);
        let first = if run.start == End::Centre { 0.0 } else { self.half(d0) };
        let fits = |phi: f64, d: f64| match run.end {
            End::Edge => phi + self.half(d) <= l + 1e-12,
            _ => phi + self.step(d, d) / 2.0 <= l + 1e-12,
        };
        let start_fits = match (run.start, run.end) {
            (End::Centre, End::Edge) => self.half(d0) <= l + 1e-12,
            _ => fits(first, d0),
        };
        if !start_fits {
            return Vec::new();
        }
        let mut cols = vec![(first, d0)];
        while let Some(&(phi, d)) = cols.last() {
            if cols.len() >= budget {
                *capped = true;
                break;
            }
            let guess = size(phi + self.step(d, d));
            let next = phi + self.step(d, guess);
            if !(next.is_finite() && next > phi) || !fits(next, guess) {
                break;
            }
            cols.push((next, guess));
        }
        // Share what is left over equally between the gaps.
        if let Some(&(phi, d)) = cols.last() {
            let gaps = cols.len() as f64 - 1.0;
            let (left, share) = match run.end {
                End::Edge => (l - phi - self.half(d), gaps),
                _ => (l - phi - self.step(d, d) / 2.0, gaps + 0.5),
            };
            if left > 0.0 && share > 0.0 {
                let each = left / share;
                for (i, c) in cols.iter_mut().enumerate() {
                    c.0 += each * i as f64;
                }
            } else if left > 0.0 && cols.len() == 1 && run.start == End::Edge && run.end == End::Edge {
                // One stone: in the middle of the run.
                if let Some(c) = cols.first_mut() {
                    c.0 = l / 2.0;
                }
            }
        }
        cols
    }
}

/// The span asked for, cut around the head: the runs to fill.
fn runs(spec: &PaveSpec, head: f64, close: f64) -> Vec<Run> {
    let (from, to) = (spec.from.to_radians(), spec.to.to_radians());
    let loop_run = |head: f64| -> Run {
        if head > 0.0 {
            Run { origin: head, dir: 1.0, length: PI - head, start: End::Edge, end: End::Mirror, mirror: true }
        } else {
            Run { origin: 0.0, dir: 1.0, length: PI, start: End::Centre, end: End::Mirror, mirror: true }
        }
    };
    // Two ends nearer than a gap round the band are one span all the way round.
    let close = close.max(1e-9);
    if spec.symmetric {
        // The right-hand arc; the left is its mirror.
        let (a, b) = if to <= 0.0 { (-to, -from) } else { (from, to) };
        let centred = |m: f64| -> Run {
            if head > 0.0 {
                Run { origin: head, dir: 1.0, length: m - head, start: End::Edge, end: End::Edge, mirror: true }
            } else {
                Run { origin: 0.0, dir: 1.0, length: m, start: End::Centre, end: End::Edge, mirror: true }
            }
        };
        if a <= 1e-12 {
            // Through 12 o'clock.
            let m = b.max(-a);
            return vec![if m >= PI - close { loop_run(head) } else { centred(m) }];
        }
        if b >= PI - close {
            // The arc and its mirror meet through 6 o'clock.
            let start = a.min(TAU - b);
            if start <= 1e-12 {
                return vec![loop_run(head)];
            }
            let start = start.max(head);
            return vec![Run { origin: start, dir: 1.0, length: PI - start, start: End::Edge, end: End::Mirror, mirror: true }];
        }
        let start = a.max(head);
        return vec![Run { origin: start, dir: 1.0, length: b - start, start: End::Edge, end: End::Edge, mirror: true }];
    }
    if to - from >= TAU - close {
        return vec![loop_run(head)];
    }
    // One arc, less the head's (−head, head) wherever it falls round the band.
    let mut parts = vec![(from, to)];
    if head > 0.0 {
        for k in [-1.0, 0.0, 1.0] {
            let (lo, hi) = (k * TAU - head, k * TAU + head);
            parts = parts
                .into_iter()
                .flat_map(|(a, b)| {
                    if b <= lo || a >= hi {
                        vec![(a, b)]
                    } else {
                        let mut v = Vec::new();
                        if a < lo {
                            v.push((a, lo));
                        }
                        if b > hi {
                            v.push((hi, b));
                        }
                        v
                    }
                })
                .collect();
        }
    }
    parts
        .into_iter()
        .filter(|(a, b)| b - a > 1e-9)
        .map(|(a, b)| Run { origin: a, dir: 1.0, length: b - a, start: End::Edge, end: End::Edge, mirror: false })
        .collect()
}

/// Where the pavé must start beside the head: the angle (radians) of the span's edge at which a
/// stone of `d` at the crown clears the head's outline; 0 for a plain band.
fn head_edge(p: &PieceParams, surf: &Surface, d: f64, gap: f64) -> f64 {
    if !matches!(p.kind, PieceKind::Solitaire | PieceKind::ThreeStone) {
        return 0.0;
    }
    let Some(cut) = p.cut_data() else { return 0.0 };
    let top = p.crown();
    let depth = melee_depth(d);
    let gd = shared::girdle_drop(depth);
    let table = d / 2.0 * gem::CUTS.first().map_or(0.57, shared::table_ratio);
    let stand = |poly: &[Vec2], base: f64, angle: f64| -> Vec<Vec2> {
        let (up, across) = (Vec2::new(angle.sin(), angle.cos()), Vec2::new(angle.cos(), -angle.sin()));
        poly.iter().map(|q| up * (base + q.y) + across * q.x).collect()
    };
    let head = p.head();
    let clear = gap.max(PAVE_HEAD_CLEAR);
    let centre = stand(&shared::head_polygon(cut, p.stone_width, head.depth, head.clear), top + head.clear, 0.0);
    let pave = [Vec2::new(0.0, -depth), Vec2::new(d / 2.0, -gd), Vec2::new(table, 0.0), Vec2::new(-table, 0.0), Vec2::new(-d / 2.0, -gd)];
    let side = (p.kind == PieceKind::ThreeStone).then(|| {
        let sides = p.sides();
        let poly = p.side_cut_data().map_or_else(Vec::new, |c| shared::head_polygon(c, sides.width, sides.head.depth, sides.head.clear));
        (stand(&poly, top + sides.head.clear, sides.angle), sides.head.prong / 2.0 + clear, sides.angle)
    });
    let ok = |a: f64| -> bool {
        let me = stand(&pave, top, a);
        let centre_ok = shared::polygons_apart(&centre, &me) >= head.prong / 2.0 + clear;
        let side_ok = side.as_ref().is_none_or(|(poly, need, _)| poly.is_empty() || shared::polygons_apart(poly, &me) >= *need);
        centre_ok && side_ok
    };
    let lo = side.as_ref().map_or(0.0, |(_, _, a)| *a);
    let at = least(lo, PI, ok);
    let half = (d / 2.0).atan2((surf.ri + surf.section.height_at(0.0) - gd).max(1e-6));
    (at - half).max(1e-6)
}

/// The rows' positions across the outside for `c` between neighbouring rows.
fn row_positions(n: u32, c: f64) -> Vec<f64> {
    match n {
        2 => vec![-c / 2.0, c / 2.0],
        3 => vec![-c, 0.0, c],
        _ => vec![0.0],
    }
}

/// The pavé on a piece, worked out; `None` when the piece has none (or is an eternity band, whose
/// row is its own stones).
pub(super) fn fit(p: &PieceParams) -> Option<PaveFit> {
    let spec = p.pave.as_ref()?;
    if p.kind == PieceKind::Eternity {
        return None;
    }
    let surf = Surface::of(p)?;
    let mut extra = 0.0;
    let mut out = fit_with(p, spec, &surf, spec.gap);
    for _ in 0..RETRIES {
        match out.gap {
            Some(g) if g + 1e-9 < spec.gap => {
                extra += spec.gap - g + 0.005;
                out = fit_with(p, spec, &surf, spec.gap + extra);
            }
            _ => break,
        }
    }
    judge(&mut out);
    Some(out)
}

/// The note a piece's reply carries when it was given pavé it cannot use.
pub(super) fn unused(p: &PieceParams) -> Option<String> {
    (p.pave.is_some() && p.kind == PieceKind::Eternity).then(|| "An eternity band's stones are its own row: `pave` is not used.".to_string())
}

fn fit_with(p: &PieceParams, spec: &PaveSpec, surf: &Surface, gap: f64) -> PaveFit {
    let d = spec.melee;
    let k = spec.rows.clamp(1, 3);
    let edge = surf.edge();
    // The rows: as close as keeps the gap, side by side, then (honeycomb) offset.
    let mut rows = vec![0.0];
    if k > 1 {
        let reach = 4.0 * (d + gap) + 2.0 * edge;
        let apart = |c: f64| {
            let r = row_positions(k, c);
            let (a, b) = (r.first().copied().unwrap_or(0.0), r.get(1).copied().unwrap_or(0.0));
            metal_between(&surf.stone(0.0, a, 0, d), &surf.stone(0.0, b, 1, d)) >= gap
        };
        let aligned = least(0.0, reach, apart);
        rows = row_positions(k, aligned);
        if spec.layout == Layout::Honeycomb {
            let probe = Fitter { surf, spec, rows: rows.clone(), gap, fixed: None };
            let half_step = probe.step(d, d) / 2.0;
            // For three rows the outer two stay aligned with each other: at least `aligned` apart.
            let lo = if k == 3 { aligned / 2.0 } else { 0.0 };
            let offset = |c: f64| {
                let r = row_positions(k, c);
                let (a, b) = if k == 3 { (0.0, c) } else { (r.first().copied().unwrap_or(0.0), r.get(1).copied().unwrap_or(0.0)) };
                metal_between(&surf.stone(0.0, a, 0, d), &surf.stone(half_step, b, 1, d)) >= gap
            };
            rows = row_positions(k, least(lo, aligned, offset));
        }
    }
    let mut fitter = Fitter { surf, spec, rows: rows.clone(), gap, fixed: None };
    if spec.graduated.is_none() {
        fitter.fixed = Some(fitter.step(d, d));
    }
    // Two mirrored runs must not meet at 12 o'clock: the first girdle is at least half a gap out.
    let head = head_edge(p, surf, d, gap).max(if spec.symmetric && spec.from > 0.0 { gap / (2.0 * surf.ri) } else { 0.0 });
    let runs = runs(spec, head, gap / surf.ri);
    let honey = spec.layout == Layout::Honeycomb && rows.len() > 1;
    // Rows offset in a honeycomb: the middle one of three, the second of two.
    let offset_row = |j: usize| honey && j == 1;
    let per_column = rows.len().max(1);
    let cap = MAX_PIECE_STONES as usize;
    let mut capped = false;
    let mut stones: Vec<PaveStone> = Vec::new();
    let mut arcs = Vec::new();
    for run in &runs {
        let mirror_mult = if run.mirror { 2 } else { 1 };
        let left = cap.saturating_sub(stones.len());
        let budget = left / (per_column * mirror_mult).max(1);
        // A plain band all the way round with one size: the most that keep the gap, evenly.
        let even_loop = run.start == End::Centre && run.end == End::Mirror && spec.graduated.is_none();
        if even_loop {
            let step = fitter.step(d, d);
            let n = if step > 1e-9 { ((TAU / step) + 1e-9).floor() } else { 0.0 };
            let n = if n.is_finite() { (n as usize).min(cap / per_column.max(1)) } else { 0 };
            if n > 0 && (n as f64) < (TAU / step.max(1e-9)).floor() {
                capped = true;
            }
            let pitch = TAU / n.max(1) as f64;
            let cols = (0..n).map(|i| (pitch * i as f64, d)).collect::<Vec<_>>();
            let mids = (0..n).map(|i| (pitch * (i as f64 + 0.5), d)).collect::<Vec<_>>();
            arcs.push((0.0, 360.0));
            for (j, u) in rows.iter().enumerate() {
                let list = if offset_row(j) { &mids } else { &cols };
                stones.extend(list.iter().map(|(a, dd)| surf.stone(*a, *u, j, *dd)));
            }
            continue;
        }
        let cols = fitter.columns(run, budget, &mut capped);
        let mut mids: Vec<(f64, f64)> = cols
            .windows(2)
            .filter_map(|w| match w {
                [a, b] => Some(((a.0 + b.0) / 2.0, a.1.min(b.1))),
                _ => None,
            })
            .collect();
        if run.end == End::Mirror
            && let Some(last) = cols.last()
        {
            mids.push((run.length, last.1));
        }
        let place = |phi: f64| run.origin + run.dir * phi;
        let deg = |a: f64| a.to_degrees();
        arcs.push((deg(run.origin), deg(place(run.length))));
        if run.mirror {
            arcs.push((-deg(place(run.length)), -deg(run.origin)));
        }
        for (j, u) in rows.iter().enumerate() {
            let list = if offset_row(j) { &mids } else { &cols };
            for (phi, dd) in list {
                let a = place(*phi);
                stones.push(surf.stone(a, *u, j, *dd));
                // The mirror: every stone but one on 12 or 6 o'clock itself.
                let on_axis = a.abs() < 1e-9 || (a - PI).abs() < 1e-9;
                if run.mirror && !on_axis {
                    stones.push(surf.stone(-a, *u, j, *dd));
                }
            }
        }
    }
    if stones.len() > cap {
        stones.truncate(cap);
        capped = true;
    }
    let least_gap = least_metal(&stones);
    let rim = stones.iter().map(|s| edge - s.across.abs() - s.diameter / 2.0).fold(None, |m: Option<f64>, r| Some(m.map_or(r, |m| m.min(r))));
    let under = stones.iter().map(|s| surf.under(s.culet)).fold(None, |m: Option<f64>, r| Some(m.map_or(r, |m| m.min(r))));
    PaveFit { spec: spec.clone(), stones, rows, gap: least_gap, rim, under, head, arcs, capped, edge, problems: Vec::new() }
}

/// The least metal between any two of `stones` (`None` with fewer than two).
pub(super) fn least_metal(stones: &[PaveStone]) -> Option<f64> {
    let mut best: Option<f64> = None;
    for (i, a) in stones.iter().enumerate() {
        for b in stones.iter().skip(i + 1) {
            // Only near neighbours can be the least.
            if let Some(x) = best
                && (a.girdle - b.girdle).len() > (a.diameter + b.diameter) / 2.0 + x.max(0.0) + 1.0
            {
                continue;
            }
            let m = metal_between(a, b);
            best = Some(best.map_or(m, |x| x.min(m)));
        }
    }
    best
}

/// The check's verdict on a fit.
fn judge(f: &mut PaveFit) {
    let s = f.spec.clone();
    let d = s.melee;
    if f.stones.is_empty() {
        f.problems.push(if f.head >= PI - 1e-6 {
            format!("No {} mm pavé stone clears the head anywhere round this band.", fmt_mm(d))
        } else {
            format!(
                "No {} mm pavé stone fits between {}° and {}° from 12 o'clock{} at a {} mm gap.",
                fmt_mm(d),
                fmt_mm(s.from),
                fmt_mm(s.to),
                if f.head > 0.0 { format!(" beside the head (it starts {}° out)", fmt_mm(f.head.to_degrees())) } else { String::new() },
                fmt_mm(s.gap)
            )
        });
        return;
    }
    let reach = f.rows.iter().fold(0.0f64, |m, u| m.max(u.abs())) + d / 2.0;
    if reach + PAVE_RIM > f.edge + 1e-9 {
        let rows = f.rows.len();
        f.problems.push(format!(
            "The band is too narrow for {}{} mm pavé: {} {} mm across the band's outside ({PAVE_RIM} mm of rim each side); this band's outside is {} mm across.",
            if rows > 1 { format!("{rows} rows of ") } else { String::new() },
            fmt_mm(d),
            if rows > 1 { "they need".to_string() } else { "a stone needs".to_string() },
            fmt_mm(2.0 * (reach + PAVE_RIM)),
            fmt_mm(2.0 * f.edge)
        ));
    }
    if let Some(g) = f.gap
        && g + 1e-6 < s.gap
    {
        f.problems.push(format!("The pavé keeps only {} mm of metal between stones, under the {} mm asked for.", fmt_mm(g.max(0.0)), fmt_mm(s.gap)));
    }
    if let Some(u) = f.under
        && u < -1e-9
    {
        f.problems.push(format!(
            "The {} mm pavé stones are {} mm deep: their culets come through the band to the finger.",
            fmt_mm(d),
            fmt_mm(melee_depth(d))
        ));
    }
    if f.capped {
        f.problems.push(format!("The pavé stops at {} stones, the most a piece carries.", MAX_PIECE_STONES));
    }
}

// ---------------------------------------------------------------------------------------------
// For the solid builder
// ---------------------------------------------------------------------------------------------

/// A pavé stone's seat, as a seat cutter reads it. (The solid builder's seat cutter is its
/// reader; until it lands, the tests are.)
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct StoneFrame {
    /// The girdle's centre (mm; the solid's frame: finger along Z, 12 o'clock +Y).
    pub centre: Vec3,
    /// The way the table faces: the band's outward normal there (unit).
    pub normal: Vec3,
    /// Round the band, clockwise seen from +Z, square to `normal` (unit).
    pub around: Vec3,
    /// The girdle's diameter.
    pub girdle: f64,
    /// The stone's whole depth: the table is `0.26 × depth + half the girdle` over `centre`
    /// along `normal` (0.28 × depth), the culet `0.72 × depth` under it.
    pub depth: f64,
    /// The stone stands in a scallop cut into the band's side (layout `scallop`).
    pub scallop: bool,
}

/// Every pavé stone's frame on a piece, in the solid's coordinates: what a seat cutter needs to
/// cut a seat for each stone. Empty when the piece has no pavé.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn stone_frames(p: &PieceParams) -> Vec<StoneFrame> {
    fit(p).map_or_else(Vec::new, |f| {
        let scallop = f.spec.layout == Layout::Scallop;
        f.stones
            .iter()
            .map(|s| StoneFrame { centre: s.girdle, normal: s.normal, around: s.around, girdle: s.diameter, depth: s.depth, scallop })
            .collect()
    })
}

/// A bead prong between two neighbours: its centre, the way it faces, its radius.
pub(super) fn beads(f: &PaveFit, surf: &Surface) -> Vec<(Vec3, Vec3, f64)> {
    let mut out: Vec<(Vec3, Vec3, f64)> = Vec::new();
    for row in 0..f.rows.len() {
        let mut list: Vec<&PaveStone> = f.stones.iter().filter(|s| s.row == row).collect();
        list.sort_by(|a, b| a.angle.rem_euclid(TAU).total_cmp(&b.angle.rem_euclid(TAU)));
        let n = list.len();
        for i in 0..n {
            let (Some(a), Some(b)) = (list.get(i), list.get((i + 1) % n.max(1))) else { continue };
            if i + 1 == n && n < 3 {
                continue;
            }
            let r = a.diameter.min(b.diameter) / 2.0;
            let rb = (0.32 * r).clamp(0.2, 0.5);
            let half_pitch = (a.girdle - b.girdle).len() / 2.0;
            if half_pitch > r + 0.8 * rb {
                continue;
            }
            let reach = r + 0.6 * rb;
            let z0 = (reach * reach - half_pitch * half_pitch).max(0.0).sqrt();
            let mut da = b.angle - a.angle;
            if da < 0.0 {
                da += TAU;
            }
            let mid = a.angle + da / 2.0;
            let u = (a.across + b.across) / 2.0;
            let sides: &[f64] = if z0 < 0.6 * rb { &[0.0] } else { &[-1.0, 1.0] };
            for sign in sides {
                let across = (u + sign * z0).clamp(-(f.edge - rb).max(0.0), (f.edge - rb).max(0.0));
                let (q, nrm) = surf.point(mid, across);
                let c = q - nrm * (0.2 * rb);
                if out.iter().all(|(o, _, orb)| (*o - c).len() > 0.5 * orb.min(rb)) {
                    out.push((c, nrm, rb));
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// For the sheet
// ---------------------------------------------------------------------------------------------

/// What the sheet draws of the pavé, in millimetres: the front view about the ring's centre, the
/// section about its own origin (the finger at y = 0, the middle of the width at x = 0), the plan
/// about its centre, and the layout (the outside unrolled) about its centre.
#[derive(Clone, Debug, Default)]
pub(super) struct PaveSheet {
    /// Closed outlines (each vertex with the bulge of the edge after it).
    pub front: Vec<Vec<(Vec2, f64)>>,
    /// Open polylines: the scallops.
    pub scallops: Vec<Vec<(Vec2, f64)>>,
    pub section: Vec<Vec<(Vec2, f64)>>,
    /// Ellipses: centre, semi-axis along the finger, the across axis's ratio to it.
    pub plan: Vec<(Vec2, f64, f64)>,
    /// The unrolled outside: its length and its height.
    pub layout: (f64, f64),
    /// Each stone in the layout: where, and its diameter.
    pub inserts: Vec<(Vec2, f64)>,
}

/// The sheet's drawing of a fit.
pub(super) fn sheet(f: &PaveFit, surf: &Surface) -> PaveSheet {
    let mut out = PaveSheet::default();
    let round = gem::CUTS.first();
    let profile = |d: f64| round.map_or_else(Vec::new, |c| shared::side_profile(c, d, melee_depth(d)));
    let top = surf.ri + surf.section.height_at(0.0);
    // Front view: each angle once, the stone of the row that stands highest.
    let mut seen: Vec<f64> = Vec::new();
    let mut by_height: Vec<&PaveStone> = f.stones.iter().collect();
    by_height.sort_by(|a, b| b.table.xy().len().total_cmp(&a.table.xy().len()));
    for s in by_height {
        if seen.iter().any(|a| (a - s.angle).abs() < 1e-9) {
            continue;
        }
        seen.push(s.angle);
        let out_dir = Vec2::new(s.angle.sin(), s.angle.cos());
        let along = Vec2::new(-out_dir.y, out_dir.x);
        let rho = s.table.xy().len();
        let at = out_dir * (rho - s.depth);
        out.front.push(profile(s.diameter).into_iter().map(|(q, b)| (at + along * q.x + out_dir * q.y, b)).collect());
        if f.spec.layout == Layout::Scallop
            && let Some((a, b, sag)) = scallop_arc(s, surf.ri)
        {
            out.scallops.push(vec![(a, -2.0 * sag / a.dist(b)), (b, 0.0)]);
        }
    }
    // Section: the stones of the rows at the top of the band (one per row).
    let mut rows_done: Vec<usize> = Vec::new();
    let mut nearest: Vec<&PaveStone> = f.stones.iter().collect();
    nearest.sort_by(|a, b| a.angle.cos().total_cmp(&b.angle.cos()).reverse());
    for s in nearest {
        if rows_done.contains(&s.row) {
            continue;
        }
        rows_done.push(s.row);
        let x = s.table.z;
        let h = s.table.xy().len() - surf.ri;
        // The normal in the section: (across, up).
        let n = Vec2::new(s.normal.z, (s.normal.x * s.angle.sin() + s.normal.y * s.angle.cos()).max(1e-9)).normalized();
        let across = Vec2::new(n.y, -n.x);
        let at = Vec2::new(x, h) - n * s.depth;
        out.section.push(profile(s.diameter).into_iter().map(|(q, b)| (at + across * q.x + n * q.y, b)).collect());
    }
    // Plan, from above: the stones on the upper half, foreshortened.
    for s in &f.stones {
        let c = s.angle.cos();
        if c > 0.05 {
            out.plan.push((Vec2::new(s.girdle.xy().len() * s.angle.sin(), s.girdle.z), s.diameter / 2.0, c));
        }
    }
    // Layout: the outside unrolled at the crown, 12 o'clock in the middle.
    out.layout = (TAU * top, 2.0 * f.edge);
    for s in &f.stones {
        let a = (s.angle + PI).rem_euclid(TAU) - PI;
        out.inserts.push((Vec2::new(a * top, s.across), s.diameter));
    }
    out
}

/// The scallop under a stone in the band's side, in the ring's plane (the front view, about the
/// ring's centre): the arc's ends at the table's radius, a girdle and 0.1 mm each side of the
/// stone, and how far it dips toward the finger (half the stone, at most 80 % of the way down).
pub(super) fn scallop_arc(s: &PaveStone, ri: f64) -> Option<(Vec2, Vec2, f64)> {
    let out_dir = Vec2::new(s.angle.sin(), s.angle.cos());
    let along = Vec2::new(-out_dir.y, out_dir.x);
    let rho = s.table.xy().len();
    let r = s.diameter / 2.0 + 0.1;
    let sag = (0.5 * s.diameter).min(0.8 * (rho - ri));
    let (a, b) = (out_dir * rho - along * r, out_dir * rho + along * r);
    (a.dist(b) > 1e-9 && sag > 1e-9 && sag.is_finite()).then_some((a, b, sag))
}

/// Segments in a scallop's arc as the solid cuts it.
const SCALLOP_SEGMENTS: usize = 24;

/// The scallop's cut-out as the solid takes it: the region between its arc and its chord (and
/// above the chord to beyond the band's outside), a simple polygon in the ring's plane.
pub(super) fn scallop_region(s: &PaveStone, ri: f64) -> Option<Vec<Vec2>> {
    let (a, b, sag) = scallop_arc(s, ri)?;
    let half = a.dist(b) / 2.0;
    let mid = (a + b) * 0.5;
    let out_dir = Vec2::new(s.angle.sin(), s.angle.cos());
    let along = Vec2::new(-out_dir.y, out_dir.x);
    let radius = (half * half + sag * sag) / (2.0 * sag);
    let centre = mid + out_dir * (radius - sag);
    let t0 = (half / radius).clamp(-1.0, 1.0).asin();
    let mut poly: Vec<Vec2> = (0..=SCALLOP_SEGMENTS)
        .map(|k| {
            let t = -t0 + 2.0 * t0 * k as f64 / SCALLOP_SEGMENTS as f64;
            centre - out_dir * (radius * t.cos()) + along * (radius * t.sin())
        })
        .collect();
    // Up past the outside, so no skin of metal is left over the scallop.
    let up = out_dir * (s.diameter + 1.0);
    poly.push(b + up);
    poly.push(a + up);
    Some(poly)
}

/// A round diamond melee as `GEM` reads it.
pub(super) fn melee_stone(cmd: &str, d: f64) -> Result<gem::Stone> {
    let mut p = Map::new();
    p.insert("cut".into(), json!("round"));
    p.insert("length".into(), json!(d));
    p.insert("width".into(), json!(d));
    gem::stone_params(cmd, &Value::Object(p))
}
