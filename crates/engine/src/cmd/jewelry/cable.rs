//! A twisted cable (rope) band: two or three round wires twisted round each other as they go
//! round the finger (`kind: "band"`, `pattern: {twist: {strands, turns, wire}}`).
//!
//! # The lay
//!
//! The strands' axes wind round the band's centre line, a circle of radius `R` round the finger,
//! at a distance `e` from it: strand `j` of `n` is at phase `φ = 2πj/n + T·θ` (`θ` round the finger
//! from 12 o'clock, `T` the whole twists in one turn round the finger, so every strand closes on
//! itself), its axis at `((R + e·cos φ)·sin θ, (R + e·cos φ)·cos θ, e·sin φ)`. `e` is the least that
//! keeps neighbouring strands of wire `w` apart along their whole length (the in-plane tangency
//! `w / (2·sin(π/n))`, opened up while the twist is tight enough to bring the strands' helices
//! closer than `w` — the helices taken at the pitch they have on the inside of the ring, `(r + w/2)/T` per radian, where they pass closest — then 4 % more), refused when no offset will do (too many twists: a strand meets the next one's pass), and `R = r + e + w/2`, so the strands
//! rest on the finger. The bundle is `2e + w` across and high: the band's `width` and `wall`.
//!
//! # The weight
//!
//! Each strand is a tube of wire `w` along its axis, which bends nowhere more tightly than `w/2`
//! (refused otherwise), so its volume is exactly the wire's area times the axis's length (the
//! theorem of Pappus–Guldin for a tube): `V = n·π(w/2)²·L`, `L` measured numerically along the axis.
//! The strands do not overlap, so the band is their sum.

use cadcraft_geom::{PI, TAU, Vec3};
use serde_json::{Value, json};

use super::*;

/// Wire limits (mm) and twist limits (whole twists in one turn round the finger).
pub(super) const WIRE_RANGE: (f64, f64) = (0.5, 2.5);
pub(super) const TURNS_RANGE: (u32, u32) = (2, 120);
/// The lay length a cable is usually twisted at, in bundle diameters, when `turns` is not given.
const LAY: f64 = 3.5;
/// The thinnest wire a bench casts as a strand (mm).
pub(super) const MIN_STRAND: f64 = 0.8;
/// Steps the axis's length is measured in per twist.
const STEPS_PER_TWIST: usize = 720;

/// The twist as asked for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Twist {
    pub strands: u32,
    /// Whole twists in one turn round the finger, or `None` for the usual lay.
    pub turns: Option<u32>,
    pub wire: f64,
}

/// The twist laid round a finger.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Cable {
    pub strands: u32,
    pub turns: u32,
    pub wire: f64,
    /// The strands' axes' distance from the centre line.
    pub e: f64,
    /// Whether the strands clear each other: too many twists bring a strand's next pass closer
    /// than its wire, however far apart the strands are set.
    pub clear: bool,
    /// The centre line's radius.
    pub radius: f64,
}

impl Twist {
    /// `pattern: {twist: {strands?: 2|3 (3), turns?: whole 2–120 or null (the usual lay), wire?: mm 0.5–2.5 (1.0)}}`.
    pub(super) fn parse(cmd: &str, v: Option<&Value>) -> Result<Option<Twist>> {
        let v = match v {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::Object(o)) => o,
            Some(_) => return Err(bad(cmd, "`pattern` is {twist: {strands, turns, wire}} for a twisted cable band, or null")),
        };
        // The key is shared with the generative patterns ([`super::pattern`]): without a twist
        // the object is theirs to read, and a twist with a pattern beside it is refused.
        if !v.contains_key("twist") {
            return Ok(None);
        }
        if let Some(k) = v.keys().find(|k| k.as_str() != "twist") {
            return Err(bad(
                cmd,
                format!(
                    "a cable band is its twisted strands: it cannot carry `{}` as well — take the twist or the pattern off",
                    k.chars().take(24).collect::<String>()
                ),
            ));
        }
        let t = match v.get("twist") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::Bool(true)) => return Ok(Some(Twist { strands: 3, turns: None, wire: 1.0 })),
            Some(Value::Object(o)) => o,
            Some(_) => return Err(bad(cmd, "`twist` is {strands: 2 or 3, turns: whole twists round the finger, wire: mm}")),
        };
        if let Some(k) = t.keys().find(|k| !matches!(k.as_str(), "strands" | "turns" | "wire")) {
            return Err(bad(cmd, format!("`twist` takes strands, turns and wire, not `{}`", k.chars().take(24).collect::<String>())));
        }
        let strands = match t.get("strands").filter(|v| !v.is_null()) {
            None => 3,
            Some(v) => match v.as_u64().filter(|n| (2..=3).contains(n)) {
                Some(n) => n as u32,
                None => return Err(bad(cmd, "`strands` is 2 or 3: a cable band twists two or three wires")),
            },
        };
        let turns = match t.get("turns").filter(|v| !v.is_null()) {
            None => None,
            Some(v) => match v.as_f64().filter(|x| x.fract() == 0.0 && *x >= f64::from(TURNS_RANGE.0) && *x <= f64::from(TURNS_RANGE.1)) {
                Some(x) => Some(x as u32),
                None => {
                    return Err(bad(
                        cmd,
                        format!(
                            "`turns` is a whole number of twists from {} to {} in one turn round the finger (whole, so every strand meets itself), or null for the usual lay",
                            TURNS_RANGE.0, TURNS_RANGE.1
                        ),
                    ));
                }
            },
        };
        let wire = match t.get("wire").filter(|v| !v.is_null()) {
            None => 1.0,
            Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= WIRE_RANGE.0 && *x <= WIRE_RANGE.1) {
                Some(x) => x,
                None => return Err(bad(cmd, format!("`wire` is the strands' diameter, {} to {} mm", WIRE_RANGE.0, WIRE_RANGE.1))),
            },
        };
        Ok(Some(Twist { strands, turns, wire }))
    }

    pub(super) fn json(&self) -> Value {
        json!({ "twist": { "strands": self.strands, "turns": self.turns, "wire": self.wire } })
    }

    /// The twist laid round a finger of radius `ri`.
    pub(super) fn lay(&self, ri: f64) -> Cable {
        let (n, w) = (f64::from(self.strands.clamp(2, 3)), self.wire);
        let delta = TAU / n;
        let e0 = w / (2.0 * (delta / 2.0).sin());
        let turns = self.turns.unwrap_or_else(|| {
            let r0 = ri + e0 + w / 2.0;
            let t = (TAU * r0 / (LAY * (2.0 * e0 + w))).round();
            if t.is_finite() { (t as u32).clamp(TURNS_RANGE.0, TURNS_RANGE.1) } else { 12 }
        });
        // The pitch where the strands pass closest: on the inside of the ring, round the finger.
        let k = (ri + w / 2.0) / f64::from(turns.max(1));
        let (at, clear) = apart(w, delta, k, e0);
        let e = at * 1.04;
        Cable { strands: self.strands.clamp(2, 3), turns, wire: w, e, radius: ri + e + w / 2.0, clear }
    }
}

/// The least distance between two helices of radius `e` and pitch `k` (per radian) whose phases
/// differ by `delta`.
fn least(e: f64, delta: f64, k: f64) -> f64 {
    let f = |u: f64| 2.0 * e * e * (1.0 - (u + delta).cos()) + k * k * u * u;
    let (mut best, mut at) = (f64::INFINITY, 0.0);
    for i in 0..=800 {
        let u = -TAU + 2.0 * TAU * f64::from(i) / 800.0;
        let v = f(u);
        if v < best {
            (best, at) = (v, u);
        }
    }
    // Refine round the best sample.
    let (mut a, mut b) = (at - TAU / 400.0, at + TAU / 400.0);
    for _ in 0..60 {
        let (m1, m2) = (a + (b - a) / 3.0, b - (b - a) / 3.0);
        if f(m1) < f(m2) { b = m2 } else { a = m1 }
    }
    best.min(f((a + b) / 2.0)).max(0.0).sqrt()
}

/// The least strand offset at or over `e0` that keeps two strands of wire `w` apart, and whether
/// any does: a strand passes its neighbour's place `k·delta` further along, whatever the offset.
fn apart(w: f64, delta: f64, k: f64, e0: f64) -> (f64, bool) {
    if least(e0, delta, k) >= w {
        return (e0, true);
    }
    let (mut lo, mut hi) = (e0, e0 + 10.0 * w);
    if least(hi, delta, k) < w {
        return (e0, false);
    }
    for _ in 0..60 {
        let mid = (lo + hi) / 2.0;
        if least(mid, delta, k) >= w { hi = mid } else { lo = mid }
    }
    (hi, true)
}

impl Cable {
    /// The bundle's size across and high: the band's width and wall.
    pub(super) fn bundle(&self) -> f64 {
        2.0 * self.e + self.wire
    }
    /// Strand `j`'s axis at `theta` round the finger from 12 o'clock (clockwise seen from +Z).
    pub(super) fn point(&self, j: u32, theta: f64) -> Vec3 {
        let phi = TAU * f64::from(j) / f64::from(self.strands) + f64::from(self.turns) * theta;
        let rho = self.radius + self.e * phi.cos();
        Vec3::new(rho * theta.sin(), rho * theta.cos(), self.e * phi.sin())
    }
    /// Points along strand `j`'s axis, `per` to a twist, closed (the last is not the first again).
    pub(super) fn axis(&self, j: u32, per: usize) -> Vec<Vec3> {
        let steps = (per.max(8) * self.turns.max(1) as usize).min(200_000);
        (0..steps).map(|i| self.point(j, TAU * i as f64 / steps as f64)).collect()
    }
    /// One strand's axis length, measured.
    pub(super) fn length(&self) -> f64 {
        let pts = self.axis(0, STEPS_PER_TWIST);
        let n = pts.len();
        (0..n).filter_map(|i| Some((*pts.get((i + 1) % n)? - *pts.get(i)?).len())).sum()
    }
    /// The band's volume (mm³): every strand's wire area times its length.
    pub(super) fn volume(&self) -> f64 {
        let v = f64::from(self.strands) * PI * (self.wire / 2.0).powi(2) * self.length();
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }
    /// The tightest bend of a strand's axis (its radius, mm): the helix's `(e² + k²)/e` on the
    /// inside of the ring, where the ring's own bend adds to it.
    pub(super) fn tightest(&self) -> f64 {
        let pts = self.axis(0, 360);
        let n = pts.len();
        (0..n)
            .filter_map(|i| {
                let (a, b, c) = (*pts.get((i + n - 1) % n)?, *pts.get(i)?, *pts.get((i + 1) % n)?);
                // The circle through three points: |ab|·|bc|·|ca| / (2·|ab × bc|).
                let cross = (b - a).cross(c - b).len();
                (cross > 1e-15).then(|| (b - a).len() * (c - b).len() * (c - a).len() / (2.0 * cross))
            })
            .fold(f64::INFINITY, f64::min)
    }
}
