//! A rail for the band: a closed curve drawn in the drawing (an oval, a shaped shank seen from the
//! front) as the path the band's profile is swept along, kept perpendicular to it.
//!
//! # The frame
//!
//! The rail is drawn in the drawing's XY plane as the band is seen from the front: X across, Y up
//! (12 o'clock is up). It is the **inside** of the band, the line the profile's finger line runs
//! along; the profile stands outward from it (`y` of the profile along the rail's outward
//! normal, `x` along the finger). Where it is drawn and how big does not matter: it is centred on
//! its own centroid and **scaled so its length is the finger's inside circumference**, `π·d` for
//! the piece's size — the inside of the band goes round the finger as a round band's does.
//!
//! # What is kept
//!
//! Like a drawn profile ([`super::profile`]): the curve flattened, thinned to at most
//! [`MAX_RAIL_POINTS`], counter-clockwise, centred, rounded to the micrometre, with the curve's
//! handle; `PIECE {rail: {curve: handle}}` with the same handle reads the curve again ("Update from
//! curve"), and the piece survives the curve being erased.
//!
//! # What is measured
//!
//! The band's volume is the profile swept along the rail with the profile kept square to it:
//! `V = A·L + M·Σ τ`, where `A` is the profile's area, `M` its first moment about the finger line,
//! `L` the rail's length (measured on the stored polygon, scaled) and `τ` the polygon's turning
//! angles, whose sum is `2π` for any simple closed counter-clockwise curve. With `L = π·d`
//! that is a round band's own Pappus — a rail band weighs what a round band of the same profile
//! and inside circumference weighs (exactly, as long as the band does not fold over itself where
//! the rail bends inward, which is refused).
//!
//! # What is refused
//!
//! An open, self-intersecting or degenerate curve; one that bends inward more tightly than the
//! band's wall (the band would fold over itself); one less than half the finger's diameter
//! across anywhere once scaled.

use cadcraft_doc::Entity;
use cadcraft_geom::{PI, Vec2, Vec3};
use serde_json::{Value, json};

use super::*;

/// The most points a stored rail keeps.
pub(super) const MAX_RAIL_POINTS: usize = 400;
/// The most points a rail may come in with.
const MAX_RAW_POINTS: usize = 4_000;
/// Points a rail is resampled to for its checks and for the solid.
pub(super) const FINE: usize = 720;
/// Points are kept to the micrometre.
const ROUND: f64 = 1e6;

/// A drawn rail in millimetres: counter-clockwise, centred on its centroid, at the size drawn.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Rail {
    points: Vec<Vec2>,
    curve: Option<String>,
}

fn twice_area(pts: &[Vec2]) -> f64 {
    let n = pts.len();
    (0..n).filter_map(|i| Some(pts.get(i)?.cross(*pts.get((i + 1) % n)?))).sum()
}

fn centroid(pts: &[Vec2]) -> Vec2 {
    let n = pts.len();
    let (mut a2, mut c) = (0.0, Vec2::ZERO);
    for i in 0..n {
        let (Some(p), Some(q)) = (pts.get(i), pts.get((i + 1) % n)) else { continue };
        let k = p.cross(*q);
        a2 += k;
        c += (*p + *q) * k;
    }
    if a2.abs() > 1e-300 { c * (1.0 / (3.0 * a2)) } else { Vec2::ZERO }
}

/// A closed polygon's length.
pub(super) fn perimeter(pts: &[Vec2]) -> f64 {
    let n = pts.len();
    (0..n).filter_map(|i| Some(pts.get(i)?.dist(*pts.get((i + 1) % n)?))).sum()
}

/// A closed polygon resampled to `n` points evenly along its length.
pub(super) fn resample(pts: &[Vec2], n: usize) -> Vec<Vec2> {
    let total = perimeter(pts);
    let m = pts.len();
    if m < 3 || !(total.is_finite() && total > 0.0) {
        return pts.to_vec();
    }
    let n = n.clamp(8, 100_000);
    let mut out = Vec::with_capacity(n);
    let (mut i, mut walked) = (0usize, 0.0);
    for k in 0..n {
        let want = total * k as f64 / n as f64;
        while i < m {
            let (Some(a), Some(b)) = (pts.get(i), pts.get((i + 1) % m)) else { break };
            let len = a.dist(*b);
            if walked + len >= want || i + 1 == m {
                let t = if len > 1e-300 { ((want - walked) / len).clamp(0.0, 1.0) } else { 0.0 };
                out.push(*a + (*b - *a) * t);
                break;
            }
            walked += len;
            i += 1;
        }
    }
    out
}

/// The outward normals of a counter-clockwise closed polygon at its vertices: the mean of the two
/// edges' normals.
pub(super) fn normals(pts: &[Vec2]) -> Vec<Vec2> {
    let n = pts.len();
    (0..n)
        .map(|i| {
            let (Some(a), Some(b), Some(c)) = (pts.get((i + n - 1) % n), pts.get(i), pts.get((i + 1) % n)) else { return Vec2::ZERO };
            let edge = |e: Vec2| {
                let l = e.len();
                if l > 1e-300 { Vec2::new(e.y, -e.x) * (1.0 / l) } else { Vec2::ZERO }
            };
            let m = edge(*b - *a) + edge(*c - *b);
            let l = m.len();
            if l > 1e-12 { m * (1.0 / l) } else { edge(*c - *b) }
        })
        .collect()
}

/// The signed turning angle at each vertex (left turns positive) and the length the vertex stands
/// for (half of each edge beside it).
fn turns(pts: &[Vec2]) -> Vec<(f64, f64)> {
    let n = pts.len();
    (0..n)
        .filter_map(|i| {
            let (a, b, c) = (pts.get((i + n - 1) % n)?, pts.get(i)?, pts.get((i + 1) % n)?);
            let (u, v) = (*b - *a, *c - *b);
            Some((u.cross(v).atan2(u.dot(v)), (u.len() + v.len()) / 2.0))
        })
        .collect()
}

/// The least width of a closed polygon over 180 directions.
fn narrowest(pts: &[Vec2]) -> f64 {
    (0..180)
        .map(|k| {
            let a = PI * k as f64 / 180.0;
            let d = Vec2::new(a.cos(), a.sin());
            let (lo, hi) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| (lo.min(p.dot(d)), hi.max(p.dot(d))));
            hi - lo
        })
        .fold(f64::INFINITY, f64::min)
}

impl Rail {
    /// Read a curve of the drawing (drawing units; `mm` millimetres to one unit).
    pub(super) fn from_entity(cmd: &str, e: &Entity, mm: f64) -> Result<Rail> {
        let name = format!("the rail {}", e.handle.hex());
        if !(mm.is_finite() && mm > 0.0) {
            return Err(bad(cmd, "the drawing's units cannot be read"));
        }
        let raw = super::profile::entity_loop(cmd, e, &name).map_err(|err| bad(cmd, err.to_string().replace("a profile", "a rail")))?;
        let pts: Vec<Vec2> = raw.into_iter().map(|p| p * mm).collect();
        Rail::from_points(cmd, pts, Some(e.handle.hex()), &name)
    }

    /// A rail from points in millimetres: checked, oriented, centred, thinned.
    pub(super) fn from_points(cmd: &str, pts: Vec<Vec2>, curve: Option<String>, name: &str) -> Result<Rail> {
        if pts.len() > MAX_RAW_POINTS {
            return Err(bad(cmd, format!("{name} has too many points to be a rail")));
        }
        if pts.iter().any(|p| !(p.is_finite() && p.x.abs() <= 1e6 && p.y.abs() <= 1e6)) {
            return Err(bad(cmd, format!("{name} has a point that is not a number or is out of reach")));
        }
        let extent = pts.iter().fold(0.0f64, |m, p| pts.first().map_or(m, |f| m.max(f.dist(*p))));
        let mut pts = super::profile::deduped(pts, (extent * 1e-9).max(1e-9));
        if pts.len() < 3 || !(extent.is_finite() && extent > 1e-6) {
            return Err(bad(cmd, format!("{name} is degenerate: it has no inside")));
        }
        if super::profile::self_intersects(&pts) {
            return Err(bad(cmd, format!("{name} crosses itself; a rail is one simple closed curve round the finger")));
        }
        let a2 = twice_area(&pts);
        if !(a2.is_finite() && a2.abs() > 1e-6 * extent * extent) {
            return Err(bad(cmd, format!("{name} is degenerate: it encloses no area")));
        }
        if a2 < 0.0 {
            pts.reverse();
        }
        let pts = super::profile::thinned(pts, MAX_RAIL_POINTS);
        let c = centroid(&pts);
        let round = |v: f64| (v * ROUND).round() / ROUND;
        let pts: Vec<Vec2> = pts.into_iter().map(|p| p - c).map(|p| Vec2::new(round(p.x), round(p.y))).collect();
        let pts = super::profile::deduped(pts, 1.5 / ROUND);
        if pts.len() < 3 || twice_area(&pts) <= 0.0 || super::profile::self_intersects(&pts) {
            return Err(bad(cmd, format!("{name} has features too fine to keep; draw it simpler")));
        }
        Ok(Rail { points: pts, curve: curve.map(|c| c.chars().take(16).collect()) })
    }

    /// The stored form: `{curve, points: [[x, y], …]}` in millimetres.
    pub(super) fn json(&self) -> Value {
        json!({ "curve": self.curve, "points": self.points.iter().map(|p| [p.x, p.y]).collect::<Vec<_>>() })
    }

    /// Read the stored form back (hostile: bounded and checked like a drawn curve).
    pub(super) fn from_json(cmd: &str, v: &Value) -> Result<Rail> {
        let missing =
            || bad(cmd, "a rail is {curve: handle}: the handle of a closed curve of the drawing (an oval, a shaped shank seen from the front)");
        let list = v.get("points").and_then(Value::as_array).ok_or_else(missing)?;
        if list.len() > MAX_RAW_POINTS {
            return Err(bad(cmd, "the stored rail has too many points"));
        }
        let mut pts = Vec::with_capacity(list.len());
        for p in list {
            let xy = p.as_array().filter(|a| a.len() == 2);
            match (xy.and_then(|a| a.first()).and_then(Value::as_f64), xy.and_then(|a| a.get(1)).and_then(Value::as_f64)) {
                (Some(x), Some(y)) => pts.push(Vec2::new(x, y)),
                _ => return Err(bad(cmd, "the stored rail's points must be [x, y] pairs of numbers")),
            }
        }
        let curve = v.get("curve").and_then(Value::as_str).map(str::to_string);
        Rail::from_points(cmd, pts, curve, "the stored rail")
    }

    /// The rail scaled so its length is a finger of `diameter`'s circumference, centred on the
    /// front view's middle (mm).
    pub(super) fn scaled(&self, diameter: f64) -> Vec<Vec2> {
        let l = perimeter(&self.points);
        let k = if l > 1e-12 && diameter.is_finite() { PI * diameter / l } else { 1.0 };
        self.points.iter().map(|p| *p * k).collect()
    }

    /// The scaled rail resampled to [`FINE`] points.
    pub(super) fn fine(&self, diameter: f64) -> Vec<Vec2> {
        resample(&self.scaled(diameter), FINE)
    }

    /// The band's volume (mm³) with a profile of `area` and first moment `moment` about the
    /// finger line: `A·L + M·Σ τ` on the scaled polygon.
    pub(super) fn volume(&self, diameter: f64, area: f64, moment: f64) -> f64 {
        let pts = self.scaled(diameter);
        let v: f64 = turns(&pts).into_iter().map(|(tau, len)| area * len + moment * tau).sum();
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }

    /// The tightest inward bend of the scaled rail (its radius, mm), or infinity when it never
    /// bends inward.
    pub(super) fn tightest_inward(&self, diameter: f64) -> f64 {
        turns(&self.fine(diameter)).into_iter().filter(|(tau, _)| *tau < -1e-9).map(|(tau, len)| len / -tau).fold(f64::INFINITY, f64::min)
    }

    /// How wide the scaled rail is across, at its narrowest and its widest and tallest.
    pub(super) fn spans(&self, diameter: f64) -> (f64, f64, f64) {
        let pts = self.scaled(diameter);
        let (lo, hi) = pts
            .iter()
            .fold((Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY)), |(lo, hi), p| (lo.min(*p), hi.max(*p)));
        (narrowest(&pts), hi.x - lo.x, hi.y - lo.y)
    }

    /// Whether the band on this rail is buildable: refused when the rail bends inward more tightly
    /// than the wall, or is narrower than half the finger anywhere.
    pub(super) fn validate(&self, cmd: &str, diameter: f64, wall: f64) -> Result<()> {
        let tight = self.tightest_inward(diameter);
        if tight < wall {
            return Err(bad(
                cmd,
                format!(
                    "the rail bends inward as tightly as a {} mm radius once its inside is the finger's {} mm circumference; the band's {} mm wall would fold over itself there — ease that bend",
                    fmt_mm(tight),
                    fmt_mm(PI * diameter),
                    fmt_mm(wall)
                ),
            ));
        }
        let (narrow, _, _) = self.spans(diameter);
        if narrow < diameter / 2.0 {
            return Err(bad(
                cmd,
                format!(
                    "the rail is only {} mm across at its narrowest once its inside is the finger's circumference; a {} mm finger needs at least half that ({} mm) — draw it rounder",
                    fmt_mm(narrow),
                    fmt_mm(diameter),
                    fmt_mm(diameter / 2.0)
                ),
            ));
        }
        Ok(())
    }

    /// The band's outside in the front view: the scaled rail offset outward by `wall`.
    pub(super) fn outside(&self, diameter: f64, wall: f64, n: usize) -> Vec<Vec2> {
        let pts = resample(&self.scaled(diameter), n);
        pts.iter().zip(normals(&pts)).map(|(p, m)| *p + m * wall).collect()
    }
}

/// The rail band in the cast solid: the distance to the rail in the section plane (negative
/// inside the rail, so the profile's height over the finger line) and the distance along the
/// finger, fed to the profile's own signed distance. Both coordinates are 1-Lipschitz and square
/// to each other, so the bound is too; its zero set is the profile swept square to the rail.
#[derive(Clone, Debug)]
pub(super) struct RailBound {
    pub rail: super::solid::Section,
    pub section: super::solid::Section,
    pub lo: Vec3,
    pub hi: Vec3,
}

impl RailBound {
    pub(super) fn new(rail: Vec<Vec2>, section: Vec<Vec2>) -> RailBound {
        let reach = section.iter().fold(0.0f64, |m, q| m.max(q.y.abs()));
        let across = section.iter().fold(0.0f64, |m, q| m.max(q.x.abs()));
        let (lo, hi) = rail
            .iter()
            .fold((Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY)), |(lo, hi), p| (lo.min(*p), hi.max(*p)));
        RailBound {
            lo: Vec3::new(lo.x - reach, lo.y - reach, -across),
            hi: Vec3::new(hi.x + reach, hi.y + reach, across),
            rail: super::solid::Section::new(rail),
            section: super::solid::Section::new(section),
        }
    }
    pub(super) fn distance(&self, p: Vec3) -> f64 {
        let u = self.rail.dist(Vec2::new(p.x, p.y));
        self.section.dist(Vec2::new(p.z, u))
    }
    pub(super) fn bounds(&self) -> (Vec3, Vec3) {
        (self.lo, self.hi)
    }
}
