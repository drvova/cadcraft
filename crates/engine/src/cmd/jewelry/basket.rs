//! A **basket head** (`head: basket`): a prong head whose prongs are joined below the girdle by
//! one or two horizontal rails (gallery wires), with an optional decorative **under-gallery**
//! between the prongs under the lowest rail. Everything else is the prong head's own: the prongs'
//! count, sites and style (`prongs`, `prongStyle`, `prongHeight`, `prongTip`, `prongWire`), the
//! seat cut and the culet hole.
//!
//! # Where the rails run (this project's approximation of a bench basket)
//!
//! A rail is a round wire of 0.7 prong wires' diameter (the plain prong head's gallery rail),
//! running round the pavilion a fraction `f` of the way from the girdle's underside down to the
//! culet (or the keel), its axis 1.2 of its radius outside the pavilion, at the height
//! `−(girdle/2 + f·pavilion)` under the girdle's middle plane:
//!
//! - one rail (`basketRails: 1`): `f` = 0.3, just under the girdle;
//! - two rails (`basketRails: 2`, the default): `f` = 0.2 and 0.6.
//!
//! Each prong's leg runs from its foot up through every rail to the girdle, so the rails are
//! held by the prongs and the prongs by the rails.
//!
//! # The under-gallery (`gallery`)
//!
//! Between two neighbouring prongs (a double prong's pair counts as one), under the lowest rail:
//!
//! - `plain` (the default): nothing — the rails alone.
//! - `arches`: a wire of the rail's size from each leg, [`DROP`] of the pavilion's depth under
//!   the lowest rail, rising to touch the rail half-way between the prongs.
//! - `scallop`: a wire hanging from the lowest rail at each prong, falling [`DROP`] of the
//!   pavilion's depth half-way between them.
//!
//! Each is a quadratic Bézier through its two ends and its middle point.

use cadcraft_geom::{PI, Vec2, Vec3};
use serde_json::Value;

use super::*;

/// The fraction of the pavilion the under-gallery reaches below the lowest rail.
pub(super) const DROP: f64 = 0.3;
/// Points along one under-gallery wire.
const GALLERY_POINTS: usize = 13;
/// The most rails a basket takes.
pub(super) const MAX_RAILS: u32 = 2;

/// The decoration under a basket's rails.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(super) enum Gallery {
    #[default]
    Plain,
    Arches,
    Scallop,
}

impl Gallery {
    pub(super) fn name(self) -> &'static str {
        match self {
            Gallery::Plain => "plain",
            Gallery::Arches => "arches",
            Gallery::Scallop => "scallop",
        }
    }
    pub(super) fn parse(cmd: &str, v: Option<&Value>) -> Result<Gallery> {
        match v.filter(|v| !v.is_null()) {
            None => Ok(Gallery::Plain),
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("plain" | "none") => Ok(Gallery::Plain),
                Some("arches" | "arch" | "arched") => Ok(Gallery::Arches),
                Some("scallop" | "scallops" | "scalloped") => Ok(Gallery::Scallop),
                _ => Err(bad(cmd, "`gallery` must be plain, arches or scallop")),
            },
        }
    }
}

/// `basketRails`: 1 or 2, or `None` for the usual two.
pub(super) fn parse_rails(cmd: &str, v: Option<&Value>) -> Result<Option<u32>> {
    match v.filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => match v.as_u64().filter(|n| (1..=u64::from(MAX_RAILS)).contains(n)) {
            Some(n) => Ok(Some(n as u32)),
            None => Err(bad(cmd, "`basketRails` must be 1 or 2, or null for the usual two")),
        },
    }
}

/// How far down the pavilion each rail runs (0 the girdle's underside, 1 the culet), lowest
/// first: a basket's rails, or the plain prong head's one gallery rail half-way down.
pub(super) fn rail_fractions(basket: bool, rails: Option<u32>) -> &'static [f64] {
    if !basket {
        return &[0.5];
    }
    match rails.unwrap_or(2) {
        1 => &[0.3],
        _ => &[0.6, 0.2],
    }
}

/// The height of a rail at fraction `f` under the girdle's middle plane.
pub(super) fn rail_height(girdle: f64, pavilion: f64, f: f64) -> f64 {
    -(girdle / 2.0 + f * pavilion)
}

/// A point of a leg at height `h`, between its foot and its lowest rail point (both in the
/// girdle plane's own coordinates: x, y in the plane, z over it).
pub(super) fn leg_at(foot: Vec3, rail: Vec3, h: f64) -> Vec3 {
    let span = rail.z - foot.z;
    if !(span.is_finite() && span.abs() > 1e-9) {
        return rail;
    }
    let t = ((h - foot.z) / span).clamp(0.0, 1.0);
    foot + (rail - foot) * t
}

/// One leg as the under-gallery reads it: its foot, its point on the lowest rail, and its plan
/// position on the girdle (for its angle round the stone).
#[derive(Clone, Copy, Debug)]
pub(super) struct Leg {
    pub foot: Vec3,
    pub rail: Vec3,
    pub site: Vec2,
}

/// The under-gallery's wires, in the girdle plane's coordinates: one between each pair of
/// neighbouring legs. `rail_loop` is the lowest rail's points (same coordinates), `drop` how far
/// under (arches) or along (scallop) the rail the wires reach, `close` the plan distance under
/// which two legs are one prong's pair. Nothing for a plain gallery or fewer than three legs.
pub(super) fn gallery_wires(gallery: Gallery, legs: &[Leg], centre: Vec2, rail_loop: &[Vec3], drop: f64, close: f64) -> Vec<Vec<Vec3>> {
    if gallery == Gallery::Plain || legs.len() < 3 || rail_loop.is_empty() || !(drop.is_finite() && drop > 0.0) {
        return Vec::new();
    }
    let angle = |q: Vec2| (q.y - centre.y).atan2(q.x - centre.x);
    let mut sorted: Vec<&Leg> = legs.iter().filter(|l| l.foot.is_finite() && l.rail.is_finite() && l.site.is_finite()).collect();
    sorted.sort_by(|a, b| angle(a.site).total_cmp(&angle(b.site)));
    // A double prong's pair is one: keep the first of legs nearer than `close`.
    let mut kept: Vec<&Leg> = Vec::with_capacity(sorted.len());
    for l in sorted {
        if kept.last().is_none_or(|k| (k.site - l.site).len() >= close) {
            kept.push(l);
        }
    }
    if kept.len() >= 2
        && let (Some(a), Some(b)) = (kept.first(), kept.last())
        && (a.site - b.site).len() < close
    {
        kept.pop();
    }
    let n = kept.len();
    if n < 3 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let (Some(a), Some(b)) = (kept.get(i), kept.get((i + 1) % n)) else { continue };
        let (aa, mut ab) = (angle(a.site), angle(b.site));
        if ab <= aa {
            ab += 2.0 * PI;
        }
        let mid_angle = (aa + ab) / 2.0;
        // The rail's point nearest that angle round the stone.
        let Some(m) = rail_loop.iter().copied().min_by(|p, q| {
            let d = |r: Vec3| {
                let x = angle(Vec2::new(r.x, r.y)) - mid_angle;
                (x.sin()).hypot(1.0 - x.cos())
            };
            d(*p).total_cmp(&d(*q))
        }) else {
            continue;
        };
        let (p0, p2, mid) = match gallery {
            Gallery::Arches => {
                let h = a.rail.z.min(b.rail.z) - drop;
                (leg_at(a.foot, a.rail, h), leg_at(b.foot, b.rail, h), m)
            }
            _ => (a.rail, b.rail, m - Vec3::new(0.0, 0.0, drop)),
        };
        let c = mid * 2.0 - (p0 + p2) * 0.5;
        let pts: Vec<Vec3> = (0..GALLERY_POINTS)
            .map(|k| {
                let t = k as f64 / (GALLERY_POINTS - 1) as f64;
                p0 * ((1.0 - t) * (1.0 - t)) + c * (2.0 * t * (1.0 - t)) + p2 * (t * t)
            })
            .collect();
        if pts.iter().all(|q| q.is_finite()) {
            out.push(pts);
        }
    }
    out
}

/// The metal of a round wire of radius `r` along `path`, less what of it lies inside `others`
/// (wires of their own radius, closed or not) — sampled on its section at each step.
pub(super) fn wire_outside(path: &[Vec3], r: f64, others: &[(&[Vec3], f64, bool)]) -> f64 {
    if !(r.is_finite() && r > 0.0) {
        return 0.0;
    }
    let inside = |q: Vec3| {
        others.iter().any(|(pts, rr, closed)| {
            let n = pts.len();
            let spans = if *closed { n } else { n.saturating_sub(1) };
            (0..spans).any(|i| match (pts.get(i), pts.get((i + 1) % n.max(1))) {
                (Some(a), Some(b)) => segment_dist(q, *a, *b) <= *rr,
                _ => false,
            })
        })
    };
    let mut v = 0.0;
    for w in path.windows(2) {
        let [a, b] = w else { continue };
        let along = *b - *a;
        let len = along.len();
        if !(len.is_finite() && len > 1e-12) {
            continue;
        }
        let t = along * (1.0 / len);
        let u = if t.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 1.0, 0.0) };
        let u = (u - t * u.dot(t)).normalized();
        let w2 = t.cross(u);
        let c = (*a + *b) * 0.5;
        // The centre, and two rings of eight (each sample standing for an equal area).
        let mut samples = vec![c];
        for (rad, count) in [(0.5 * r, 8usize), (0.85 * r, 8usize)] {
            for k in 0..count {
                let ang = 2.0 * PI * k as f64 / count as f64;
                samples.push(c + u * (rad * ang.cos()) + w2 * (rad * ang.sin()));
            }
        }
        let free = samples.iter().filter(|q| !inside(**q)).count() as f64 / samples.len() as f64;
        v += len * PI * r * r * free;
    }
    if v.is_finite() { v.max(0.0) } else { 0.0 }
}

fn segment_dist(p: Vec3, a: Vec3, b: Vec3) -> f64 {
    let e = b - a;
    let l2 = e.dot(e);
    let t = if l2 > 1e-300 { ((p - a).dot(e) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (p - (a + e * t)).len()
}

/// What a sheet draws of a basket seen from the side, in the head's own plane (x across, y up
/// from the girdle's middle plane): each rail as a line between the two prongs the view shows,
/// and the under-gallery between them as one arc (an arch rising to the lowest rail, or a
/// scallop falling from it). `foot` and `girdle` are the right-hand prong's foot and the point
/// where it meets the girdle's underside; its leg is taken as straight between them. Each mark is
/// an open polyline, every vertex with the bulge of the segment after it.
pub(super) fn side_marks(gallery: Gallery, rails: Option<u32>, girdle_t: f64, pavilion: f64, foot: Vec2, girdle: Vec2) -> Vec<Vec<(Vec2, f64)>> {
    let leg_x = |y: f64| {
        let span = girdle.y - foot.y;
        if span.abs() < 1e-9 { girdle.x } else { foot.x + (girdle.x - foot.x) * ((y - foot.y) / span).clamp(0.0, 1.0) }
    };
    let fractions = rail_fractions(true, rails);
    let mut out = Vec::new();
    for f in fractions {
        let y = rail_height(girdle_t, pavilion, *f);
        let x = leg_x(y);
        out.push(vec![(Vec2::new(-x, y), 0.0), (Vec2::new(x, y), 0.0)]);
    }
    let low = rail_height(girdle_t, pavilion, fractions.first().copied().unwrap_or(0.5));
    let drop = DROP * pavilion;
    match gallery {
        Gallery::Plain => {}
        Gallery::Arches => {
            let (y, x) = (low - drop, leg_x(low - drop));
            if x > 1e-6 {
                out.push(vec![(Vec2::new(-x, y), -drop / x), (Vec2::new(x, y), 0.0)]);
            }
        }
        Gallery::Scallop => {
            let x = leg_x(low);
            if x > 1e-6 {
                out.push(vec![(Vec2::new(-x, low), drop / x), (Vec2::new(x, low), 0.0)]);
            }
        }
    }
    out
}
