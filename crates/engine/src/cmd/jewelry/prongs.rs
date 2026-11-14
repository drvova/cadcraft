//! Prong styles and heights: how a prong head's wires end over the stone.
//!
//! A prong head (the default `head`) holds its stone with `prongs` wires standing on the girdle
//! ([`super::piece_params::prong_sites`]). This module shapes what each wire does over the
//! girdle, read from four parameters of `PIECE`:
//!
//! - **`prongStyle`** (default `round`):
//!   - `round`: a round wire ending in a round bead (what the engine always built).
//!   - `claw`: the wire tapers from the girdle to a pointed tip, [`CLAW_TIP`] of its radius at the
//!     end, that leans further in over the crown.
//!   - `tab`: a flat tab: a wall outside the girdle, [`TAB_WIDTH`] wire diameters wide along the
//!     girdle and [`BAR_THICK`] thick, folded in over the crown as a flat lip that rests on it.
//!   - `v`: a V (chevron) prong that wraps a pointed corner (a pear's point, a marquise's two
//!     points, a princess's or trillion's corners): two flat wings along the corner's two edges.
//!     Sites on a pointed corner (the girdle turns through less than [`V_CORNER`]) take a V; any
//!     other site keeps a round prong. A cut with no pointed corner refuses `v`.
//!   - `double`: each prong is a pair of round wires either side of its site, their centres
//!     [`DOUBLE_SPACING`] wire diameters apart along the girdle (so `prongs: 4` makes eight).
//! - **`prongHeight`** (mm over the top of the girdle to the tip's top; default
//!   [`super::piece_params::PRONG_OVER`] wire diameters, 1.15).
//! - **`prongTip`** (mm: how far the prong's metal reaches in over the crown past the girdle;
//!   default [`TIP_COVER`] of the wire, 0.925 — the bead's reach the round prong always had).
//! - **`prongWire`** (mm; default 15 % of the stone's lesser size, 0.8–1.2): every prong head's.
//!
//! These defaults are our approximation of bench practice (a prong tip covers 0.3–1 mm of the
//! crown and stands about a wire's thickness over the girdle), not a standard.
//!
//! # Checks
//!
//! - `prong-tip`: the tip covers the girdle by at least [`MIN_PRONG_TIP`] (0.3 mm; less lets the
//!   stone out), stays short of the table, and stands over the crown under it (a tip lower than
//!   the crown would be buried in the stone).
//! - `prong-wire`: the wire is at least the least a prong of that metal holds with
//!   ([`min_wire`]: 0.6 mm platinum and palladium, 0.7 mm gold, 0.6 mm steel and titanium,
//!   0.9 mm silver, brass and copper; 0.7 mm for a wax that will be cast).
//!
//! # Weight
//!
//! `metal.prongGrams` (and `prongGrams` in the band's `ring:` record, which Bench reads) is the
//! prongs and the gallery rail: each prong's leg from the band to the girdle as a round wire from
//! its site to its foot ([`super::piece_params::PRONG_FOOT`] of the half-width in, at the band),
//! its top by its style's own solids (a bead, a cone, boxes), and the rail as a wire round half
//! the girdle. Overlaps between parts are counted twice and the seats are not taken off: like
//! the band's figure, it is the metal before setting, within a few hundredths of a gram.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Value, json};

use super::piece_params::{CROWN, Head, PRONG_FOOT, PRONG_OVER, PieceKind, PieceParams, girdle_outline, table_ratio};
use super::*;

/// How a prong ends over the stone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(super) enum ProngStyle {
    #[default]
    Round,
    Claw,
    Tab,
    V,
    Double,
}

/// Every style, in the order a panel lists them.
pub(super) const STYLES: [ProngStyle; 5] = [ProngStyle::Round, ProngStyle::Claw, ProngStyle::Tab, ProngStyle::V, ProngStyle::Double];

impl ProngStyle {
    pub(super) fn name(self) -> &'static str {
        match self {
            ProngStyle::Round => "round",
            ProngStyle::Claw => "claw",
            ProngStyle::Tab => "tab",
            ProngStyle::V => "v",
            ProngStyle::Double => "double",
        }
    }
}

/// A claw's tip radius as a fraction of the wire's radius.
pub(super) const CLAW_TIP: f64 = 0.35;
/// A tab's width along the girdle, in wire diameters.
pub(super) const TAB_WIDTH: f64 = 1.5;
/// A tab's or a V wing's thickness, in wire diameters.
pub(super) const BAR_THICK: f64 = 0.55;
/// A V wing's length along its edge from the corner, in wire diameters.
pub(super) const V_WING: f64 = 1.1;
/// A pointed corner: the girdle turns through less than this inside angle (degrees).
pub(super) const V_CORNER: f64 = 120.0;
/// A double prong's two wires, centre to centre, in wire diameters.
pub(super) const DOUBLE_SPACING: f64 = 1.3;
/// The default cover over the girdle, in wire diameters.
pub(super) const TIP_COVER: f64 = 0.925;
/// The least cover over the girdle that holds a stone (mm): the `prong-tip` check.
pub(super) const MIN_PRONG_TIP: f64 = 0.3;
/// How far a tip must stand over the crown under it (mm).
pub(super) const TIP_OVER_CROWN: f64 = 0.1;

/// The least prong wire a metal holds a stone with (mm): the `prong-wire` check.
pub(super) fn min_wire(metal: &str) -> f64 {
    match metal {
        "platinum" | "palladium" => 0.6,
        "steel" | "titanium" => 0.6,
        "silver" | "brass" | "copper" => 0.9,
        _ => 0.7,
    }
}

/// The prong parameters as given (`None`: the default for the stone).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub(super) struct ProngSpec {
    pub style: ProngStyle,
    pub height: Option<f64>,
    pub tip: Option<f64>,
    pub wire: Option<f64>,
}

impl ProngSpec {
    /// Read `prongStyle`, `prongHeight`, `prongTip` and `prongWire`.
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<ProngSpec> {
        let style = match p.get("prongStyle").filter(|v| !v.is_null()) {
            None => ProngStyle::Round,
            Some(v) => {
                let s = v.as_str().map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
                STYLES
                    .into_iter()
                    .find(|st| st.name() == s || (s == "chevron" && *st == ProngStyle::V))
                    .ok_or_else(|| bad(cmd, "`prongStyle` must be round, claw, tab, v or double"))?
            }
        };
        let mm = |key: &str, min: f64, max: f64| -> Result<Option<f64>> {
            match p.get(key).filter(|v| !v.is_null()) {
                None => Ok(None),
                Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= min && *x <= max) {
                    Some(x) => Ok(Some(x)),
                    None => Err(bad(cmd, format!("`{key}` must be a number of millimetres from {min} to {max}, or null for the usual"))),
                },
            }
        };
        Ok(ProngSpec { style, height: mm("prongHeight", 0.1, 4.0)?, tip: mm("prongTip", 0.0, 3.0)?, wire: mm("prongWire", 0.3, 2.5)? })
    }

    /// The keys as JSON, merged into the piece's parameters.
    pub(super) fn json_into(&self, o: &mut serde_json::Map<String, Value>) {
        o.insert("prongStyle".into(), json!(self.style.name()));
        o.insert("prongHeight".into(), json!(self.height));
        o.insert("prongTip".into(), json!(self.tip));
        o.insert("prongWire".into(), json!(self.wire));
    }

    /// The tip's top over the girdle's top for this wire.
    pub(super) fn over(&self, wire: f64) -> f64 {
        self.height.unwrap_or(PRONG_OVER * wire)
    }

    /// How far the tip covers the crown past the girdle for this wire.
    pub(super) fn cover(&self, wire: f64) -> f64 {
        self.tip.unwrap_or(TIP_COVER * wire)
    }
}

/// The crown's height over the girdle's top at `c` in from the girdle, for a stone `lesser` wide
/// with a crown `crown` high and this table: a straight slope from the girdle to the table's edge.
pub(super) fn crown_at(c: f64, lesser: f64, crown: f64, table: f64) -> f64 {
    let run = (lesser / 2.0 * (1.0 - table)).max(1e-6);
    crown * (c / run).clamp(0.0, 1.0)
}

/// How far from the girdle the table starts.
pub(super) fn table_run(lesser: f64, table: f64) -> f64 {
    lesser / 2.0 * (1.0 - table)
}

/// Where one prong stands: its site on the girdle (plan, mm), its outward direction and the
/// girdle's direction there, and, for a V, the two edges leaving its corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Site {
    pub at: Vec2,
    pub out: Vec2,
    pub along: Vec2,
    /// A V's two edges from the corner (unit vectors), when this site takes a V.
    pub corner: Option<(Vec2, Vec2)>,
}

/// The inside angle of the girdle at the outline vertex nearest `at` (degrees), taken between the
/// points about `reach` along the outline either way, and the two directions to them.
fn corner_at(outline: &[Vec2], at: Vec2, reach: f64) -> Option<(f64, Vec2, Vec2)> {
    let n = outline.len();
    if n < 3 {
        return None;
    }
    let (i, _) = outline.iter().enumerate().min_by(|a, b| a.1.dist(at).total_cmp(&b.1.dist(at)))?;
    let walk = |step: isize| -> Option<Vec2> {
        let mut gone = 0.0;
        let mut k = i as isize;
        let mut prev = *outline.get(i)?;
        for _ in 0..n {
            k = (k + step).rem_euclid(n as isize);
            let q = *outline.get(k as usize)?;
            gone += q.dist(prev);
            prev = q;
            if gone >= reach {
                break;
            }
        }
        Some(prev)
    };
    let c = *outline.get(i)?;
    let (a, b) = (walk(-1)?, walk(1)?);
    let (e1, e2) = ((a - c).normalized(), (b - c).normalized());
    if e1.len() < 0.5 || e2.len() < 0.5 {
        return None;
    }
    Some((e1.dot(e2).clamp(-1.0, 1.0).acos().to_degrees(), e1, e2))
}

/// The two edges leaving a pointed, outward corner of the girdle at `at` (the girdle turns through
/// less than [`V_CORNER`] there, and the corner points away from the stone's centre — not a
/// heart's cleft).
fn pointed(outline: &[Vec2], at: Vec2, reach: f64) -> Option<(Vec2, Vec2)> {
    let (angle, e1, e2) = corner_at(outline, at, reach)?;
    (angle < V_CORNER && (e1 + e2).dot(-at) > 0.0).then_some((e1, e2))
}

/// The nearest point of a closed outline to `q`.
fn nearest_on(outline: &[Vec2], q: Vec2) -> Vec2 {
    let n = outline.len();
    let mut best = (f64::INFINITY, q);
    for k in 0..n {
        let (Some(a), Some(b)) = (outline.get(k).copied(), outline.get((k + 1) % n).copied()) else { continue };
        let ab = b - a;
        let t = if ab.len2() > 1e-24 { ((q - a).dot(ab) / ab.len2()).clamp(0.0, 1.0) } else { 0.0 };
        let p = a + ab * t;
        let d = p.dist(q);
        if d < best.0 {
            best = (d, p);
        }
    }
    best.1
}

/// Whether a cut of this size has a pointed corner a V prong can guard.
pub(super) fn has_points(cut: &gem::Cut, length: f64, width: f64) -> bool {
    if cut.is_circle(length, width) || cut.name == "cabochon" {
        return false;
    }
    let Some(outline) = girdle_outline(cut, length, width) else { return false };
    let reach = 0.08 * length.min(width);
    outline.iter().any(|q| pointed(&outline, *q, reach).is_some())
}

/// The prongs' sites for a style: the girdle sites, each with its directions; a double's pairs
/// either side of each site; a V's corner sites with their edges.
pub(super) fn styled_sites(cut: &gem::Cut, length: f64, width: f64, sites: &[Vec2], style: ProngStyle, wire: f64) -> Vec<Site> {
    let circle = cut.is_circle(length, width);
    let outline = if circle { None } else { girdle_outline(cut, length, width) };
    let frame = |at: Vec2| -> Site {
        let out = match &outline {
            Some(o) => {
                // The outward normal: square to the girdle's direction there, away from the centre.
                let a = nearest_on(o, at);
                let (_, e1, e2) = corner_at(o, a, 0.05 * length.min(width)).unwrap_or((180.0, Vec2::ZERO, Vec2::ZERO));
                let tangent = (e2 - e1).normalized();
                let nrm = Vec2::new(tangent.y, -tangent.x);
                if nrm.len() < 0.5 {
                    at.normalized()
                } else if nrm.dot(at) < 0.0 {
                    -nrm
                } else {
                    nrm
                }
            }
            None => at.normalized(),
        };
        let out = if out.len() < 0.5 { Vec2::new(0.0, 1.0) } else { out };
        Site { at, out, along: Vec2::new(-out.y, out.x), corner: None }
    };
    let mut out = Vec::with_capacity(sites.len() * 2);
    for at in sites.iter().copied().filter(|q| q.is_finite()) {
        match style {
            ProngStyle::Double => {
                let half = DOUBLE_SPACING * wire / 2.0;
                for sign in [-1.0, 1.0] {
                    let q = if circle {
                        let r = (width / 2.0).max(1e-6);
                        at.rotate(sign * half / r)
                    } else {
                        let s = frame(at);
                        outline.as_deref().map_or(at + s.along * (sign * half), |o| nearest_on(o, at + s.along * (sign * half)))
                    };
                    out.push(frame(q));
                }
            }
            ProngStyle::V => {
                let mut s = frame(at);
                if let Some(o) = &outline
                    && let Some((e1, e2)) = pointed(o, at, 0.08 * length.min(width))
                {
                    s.out = -(e1 + e2).normalized();
                    s.along = Vec2::new(-s.out.y, s.out.x);
                    s.corner = Some((e1, e2));
                }
                out.push(s);
            }
            _ => out.push(frame(at)),
        }
    }
    out
}

/// One solid part of a styled prong's top, in the ring's 3D space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ProngPart {
    /// A round cone with spherical ends: radius `ra` at `a`, `rb` at `b`.
    Cone { a: Vec3, ra: f64, b: Vec3, rb: f64 },
    /// A box centred on `c`, its half-sizes `h` along the unit axes `x`, `y`, `z`.
    Bar { c: Vec3, x: Vec3, y: Vec3, z: Vec3, h: Vec3 },
}

/// The signed distance to a round cone (exact: Inigo Quilez's formula), or to the larger ball
/// when one end swallows the other.
fn round_cone(p: Vec3, a: Vec3, b: Vec3, r1: f64, r2: f64) -> f64 {
    let ba = b - a;
    let l2 = ba.dot(ba);
    let rr = r1 - r2;
    let a2 = l2 - rr * rr;
    if a2.is_nan() || a2 <= 1e-12 {
        return ((p - a).len() - r1).min((p - b).len() - r2);
    }
    let il2 = 1.0 / l2;
    let pa = p - a;
    let y = pa.dot(ba);
    let z = y - l2;
    let x = pa * l2 - ba * y;
    let x2 = x.dot(x);
    let (y2, z2) = (y * y * l2, z * z * l2);
    let k = rr.signum() * rr * rr * x2;
    if z.signum() * a2 * z2 > k {
        return (x2 + z2).sqrt() * il2 - r2;
    }
    if y.signum() * a2 * y2 < k {
        return (x2 + y2).sqrt() * il2 - r1;
    }
    ((x2 * a2 * il2).sqrt() + y * rr) * il2 - r1
}

impl ProngPart {
    /// The signed distance to the part: negative inside, exact for both kinds.
    pub(crate) fn distance(&self, p: Vec3) -> f64 {
        match *self {
            ProngPart::Cone { a, ra, b, rb } => round_cone(p, a, b, ra, rb),
            ProngPart::Bar { c, x, y, z, h } => {
                let r = p - c;
                let q = Vec3::new(r.dot(x).abs() - h.x, r.dot(y).abs() - h.y, r.dot(z).abs() - h.z);
                let outside = Vec3::new(q.x.max(0.0), q.y.max(0.0), q.z.max(0.0)).len();
                outside + q.x.max(q.y).max(q.z).min(0.0)
            }
        }
    }

    /// A box the part lies in.
    pub(crate) fn bounds(&self) -> (Vec3, Vec3) {
        match *self {
            ProngPart::Cone { a, ra, b, rb } => {
                let r = ra.max(rb).max(0.0);
                let rv = Vec3::new(r, r, r);
                let (lo, hi) = (min3(a, b), max3(a, b));
                (lo - rv, hi + rv)
            }
            ProngPart::Bar { c, x, y, z, h } => {
                let e = |k: fn(Vec3) -> f64| (k(x) * h.x).abs() + (k(y) * h.y).abs() + (k(z) * h.z).abs();
                let ext = Vec3::new(e(|v| v.x), e(|v| v.y), e(|v| v.z));
                (c - ext, c + ext)
            }
        }
    }

    /// The part's volume (mm³).
    pub(crate) fn volume(&self) -> f64 {
        match *self {
            ProngPart::Cone { a, ra, b, rb } => {
                let l = (b - a).len();
                PI * l / 3.0 * (ra * ra + ra * rb + rb * rb) + 2.0 / 3.0 * PI * (ra.powi(3) + rb.powi(3))
            }
            ProngPart::Bar { h, .. } => 8.0 * h.x * h.y * h.z,
        }
    }
}

fn min3(a: Vec3, b: Vec3) -> Vec3 {
    Vec3::new(a.x.min(b.x), a.y.min(b.y), a.z.min(b.z))
}
fn max3(a: Vec3, b: Vec3) -> Vec3 {
    Vec3::new(a.x.max(b.x), a.y.max(b.y), a.z.max(b.z))
}

/// A styled prong's parts in the cast solid ([`ProngSolid::distance`] is `prong_sdf`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProngSolid {
    pub parts: Vec<ProngPart>,
}

impl ProngSolid {
    /// The same prong moved by `by` (a pair's second earring).
    pub(crate) fn shifted(self, by: Vec3) -> Self {
        let parts = self
            .parts
            .into_iter()
            .map(|q| match q {
                ProngPart::Cone { a, ra, b, rb } => ProngPart::Cone { a: a + by, ra, b: b + by, rb },
                ProngPart::Bar { c, x, y, z, h } => ProngPart::Bar { c: c + by, x, y, z, h },
            })
            .collect();
        Self { parts }
    }
    /// The least of the parts' distances: an exact union's bound, 1-Lipschitz.
    pub(crate) fn distance(&self, p: Vec3) -> f64 {
        self.parts.iter().map(|q| q.distance(p)).fold(f64::INFINITY, f64::min)
    }
    pub(crate) fn bounds(&self) -> (Vec3, Vec3) {
        let inf = f64::INFINITY;
        self.parts
            .iter()
            .map(ProngPart::bounds)
            .fold((Vec3::new(inf, inf, inf), Vec3::new(-inf, -inf, -inf)), |(lo, hi), (a, b)| (min3(lo, a), max3(hi, b)))
    }
}

/// The numbers a styled prong is built from, for one head.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct TopSpec {
    pub style: ProngStyle,
    /// The wire's diameter.
    pub wire: f64,
    /// The girdle's thickness.
    pub girdle: f64,
    /// The tip's top over the girdle's top.
    pub over: f64,
    /// How far the tip covers the crown past the girdle.
    pub cover: f64,
    /// The crown's height over the girdle's top where the tip ends.
    pub crown_under: f64,
}

/// A stone's girdle plane in 3D: origin, `u` (plan x), `v` (plan y) and `w` (out through the table).
#[derive(Clone, Copy, Debug)]
pub(super) struct Plane {
    pub o: Vec3,
    pub u: Vec3,
    pub v: Vec3,
    pub w: Vec3,
}

impl Plane {
    fn at(&self, q: Vec2, h: f64) -> Vec3 {
        self.o + self.u * q.x + self.v * q.y + self.w * h
    }
    fn dir(&self, q: Vec2) -> Vec3 {
        self.u * q.x + self.v * q.y
    }
}

/// The top of a styled prong over its site, from the girdle's middle plane up: the parts the
/// mesh draws and the solid adds. A round or double prong has none (its wire runs to its bead);
/// a site of a V prong that is not on a corner neither.
pub(super) fn top_parts(plane: &Plane, site: &Site, t: &TopSpec) -> Vec<ProngPart> {
    let rp = t.wire / 2.0;
    let top = t.girdle / 2.0 + t.over;
    let girdle_top = t.girdle / 2.0;
    let bar = BAR_THICK * t.wire;
    // The lip rests on the crown where it ends, and is at least a third of the bar thick.
    let lip_bottom = (girdle_top + t.crown_under).min(top - bar / 3.0);
    let w = plane.w;
    match t.style {
        ProngStyle::Round | ProngStyle::Double => Vec::new(),
        ProngStyle::Claw => {
            let rt = CLAW_TIP * rp;
            let tip = site.at - site.out * (t.cover - rt);
            vec![ProngPart::Cone { a: plane.at(site.at, 0.0), ra: rp, b: plane.at(tip, top - rt), rb: rt }]
        }
        ProngStyle::Tab => {
            let (x, y) = (plane.dir(site.out), plane.dir(site.along));
            let half_w = TAB_WIDTH * t.wire / 2.0;
            let bottom = -t.girdle / 2.0 - 0.4 * t.wire;
            let wall = ProngPart::Bar {
                c: plane.at(site.at + site.out * (bar / 2.0), (bottom + top) / 2.0),
                x,
                y,
                z: w,
                h: Vec3::new(bar / 2.0, half_w, (top - bottom) / 2.0),
            };
            let lip = ProngPart::Bar {
                c: plane.at(site.at + site.out * ((bar - t.cover) / 2.0), (lip_bottom + top) / 2.0),
                x,
                y,
                z: w,
                h: Vec3::new((bar + t.cover) / 2.0, half_w, ((top - lip_bottom) / 2.0).max(1e-3)),
            };
            vec![wall, lip]
        }
        ProngStyle::V => {
            let Some((e1, e2)) = site.corner else { return Vec::new() };
            let bottom = -t.girdle / 2.0 - 0.4 * t.wire;
            let len = V_WING * t.wire;
            let mut parts = Vec::with_capacity(4);
            for (e, other) in [(e1, e2), (e2, e1)] {
                // The wing's outward normal: square to its edge, away from the other edge.
                let n0 = Vec2::new(e.y, -e.x);
                let n = if n0.dot(other) > 0.0 { -n0 } else { n0 };
                // From a bar's width past the corner to the wing's length along the edge.
                let (from, to) = (-bar, len);
                let mid = site.at + e * ((from + to) / 2.0);
                let (x, y) = (plane.dir(e), plane.dir(n));
                parts.push(ProngPart::Bar {
                    c: plane.at(mid + n * (bar / 2.0), (bottom + top) / 2.0),
                    x,
                    y,
                    z: w,
                    h: Vec3::new((to - from) / 2.0, bar / 2.0, (top - bottom) / 2.0),
                });
                parts.push(ProngPart::Bar {
                    c: plane.at(mid + n * ((bar - t.cover) / 2.0), (lip_bottom + top) / 2.0),
                    x,
                    y,
                    z: w,
                    h: Vec3::new((to - from) / 2.0, (bar + t.cover) / 2.0, ((top - lip_bottom) / 2.0).max(1e-3)),
                });
            }
            parts
        }
    }
}

/// Whether this site's prong is a plain round wire to a bead (the round and double styles, and a
/// V style's sites that are not on a corner).
pub(super) fn is_round(style: ProngStyle, site: &Site) -> bool {
    match style {
        ProngStyle::Round | ProngStyle::Double => true,
        ProngStyle::V => site.corner.is_none(),
        ProngStyle::Claw | ProngStyle::Tab => false,
    }
}

/// What the plan shows of a prong.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum PlanMark {
    Circle { c: Vec2, r: f64 },
    Poly(Vec<Vec2>),
}

/// A prong as the sheet's plan draws it, relative to the stone's centre: a round wire as a circle
/// on its site; a claw as that circle with its point leaning in; a tab and a V's wings as their
/// footprints (from the cover over the crown out to the bar's outside).
pub(super) fn plan_marks(style: ProngStyle, site: &Site, wire: f64, cover: f64) -> Vec<PlanMark> {
    let rp = wire / 2.0;
    let bar = BAR_THICK * wire;
    let rect = |c: Vec2, x: Vec2, y: Vec2, hx: f64, hy: f64| -> PlanMark {
        PlanMark::Poly(vec![c - x * hx - y * hy, c + x * hx - y * hy, c + x * hx + y * hy, c - x * hx + y * hy])
    };
    if is_round(style, site) {
        return vec![PlanMark::Circle { c: site.at, r: rp }];
    }
    match style {
        ProngStyle::Claw => {
            let tip = site.at - site.out * cover;
            vec![PlanMark::Circle { c: site.at, r: rp }, PlanMark::Poly(vec![site.at + site.along * rp, tip, site.at - site.along * rp])]
        }
        ProngStyle::Tab => vec![rect(site.at + site.out * ((bar - cover) / 2.0), site.out, site.along, (bar + cover) / 2.0, TAB_WIDTH * wire / 2.0)],
        ProngStyle::V => {
            let Some((e1, e2)) = site.corner else { return Vec::new() };
            let len = V_WING * wire;
            [(e1, e2), (e2, e1)]
                .into_iter()
                .map(|(e, other)| {
                    let n0 = Vec2::new(e.y, -e.x);
                    let n = if n0.dot(other) > 0.0 { -n0 } else { n0 };
                    let mid = site.at + e * ((len - bar) / 2.0);
                    rect(mid + n * ((bar - cover) / 2.0), e, n, (len + bar) / 2.0, (bar + cover) / 2.0)
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

impl PieceParams {
    /// Whether the piece's stones stand in prong heads (a solitaire's or three-stone ring's,
    /// without bezels).
    pub(super) fn pronged(&self) -> bool {
        matches!(self.kind, PieceKind::Solitaire | PieceKind::ThreeStone) && !self.bezeled()
    }

    /// The top of the prongs of a head: what the mesh, the solid and the checks share.
    pub(super) fn top_spec(&self, head: &Head, lesser: f64, cut: &gem::Cut) -> TopSpec {
        let (over, cover) = (self.prong.over(head.prong), self.prong.cover(head.prong));
        let crown = CROWN * head.depth;
        TopSpec {
            style: self.prong.style,
            wire: head.prong,
            girdle: head.girdle,
            over,
            cover,
            crown_under: crown_at(cover, lesser, crown, table_ratio(cut)),
        }
    }

    /// A head's styled sites: the centre stone's.
    pub(super) fn centre_sites(&self) -> Result<Vec<Site>> {
        let cut = self.cut_data().ok_or_else(|| bad("piece", "the stone has no cut"))?;
        let sites = self.prong_sites()?;
        Ok(styled_sites(cut, self.stone_length, self.stone_width, &sites, self.prong.style, self.head().prong))
    }

    /// A three-stone ring's side stones' styled sites.
    pub(super) fn side_sites(&self) -> Result<Vec<Site>> {
        let cut = self.side_cut_data().ok_or_else(|| bad("piece", "the stone has no cut"))?;
        let (length, width) = self.side_size();
        let sites = self.side_prong_sites()?;
        Ok(styled_sites(cut, length, width, &sites, self.prong.style, self.sides().head.prong))
    }

    /// Refuse a style the stones cannot take, in plain words: V prongs guard pointed corners.
    pub(super) fn prong_refusal(&self) -> Result<()> {
        if !self.pronged() || self.prong.style != ProngStyle::V {
            return Ok(());
        }
        let Some(cut) = self.cut_data() else { return Ok(()) };
        if !has_points(cut, self.stone_length, self.stone_width) {
            return Err(bad(
                "piece",
                format!(
                    "V prongs guard a stone's pointed corners, and a {} has none: choose a pear, marquise, princess, trillion or heart, or round, claw, tab or double prongs",
                    cut.name
                ),
            ));
        }
        Ok(())
    }

    /// The `prong-tip` and `prong-wire` checks for every prong head, as (id, ok, words).
    pub(super) fn prong_checks(&self) -> Vec<(&'static str, bool, String)> {
        if !self.pronged() {
            return Vec::new();
        }
        let mut heads: Vec<(Head, f64, &gem::Cut, &str)> = Vec::new();
        if let Some(cut) = self.cut_data() {
            heads.push((self.head(), self.stone_length.min(self.stone_width), cut, "centre stone"));
        }
        if self.kind == PieceKind::ThreeStone
            && let Some(cut) = self.side_cut_data()
        {
            let sides = self.sides();
            heads.push((sides.head, sides.length.min(sides.width), cut, "side stones"));
        }
        let mut tip: Option<(bool, String)> = None;
        let mut wire: Option<(bool, String)> = None;
        let least = min_wire(&self.metal);
        for (head, lesser, cut, what) in heads {
            let t = self.top_spec(&head, lesser, cut);
            let run = table_run(lesser, table_ratio(cut));
            let (ok, words) = if t.cover + 1e-9 < MIN_PRONG_TIP {
                (
                    false,
                    format!(
                        "The {what}'s prongs cover the girdle by {} mm, under the {MIN_PRONG_TIP} mm it takes to hold the stone",
                        fmt_mm(t.cover)
                    ),
                )
            } else if t.cover >= run - 1e-9 {
                (
                    false,
                    format!(
                        "The {what}'s prongs reach {} mm over the crown and the table starts {} mm in: they would cover the table",
                        fmt_mm(t.cover),
                        fmt_mm(run)
                    ),
                )
            } else if t.over < t.crown_under + TIP_OVER_CROWN - 1e-9 {
                (
                    false,
                    format!(
                        "The {what}'s prong tips stand {} mm over the girdle, but the crown under them is {} mm high: give them at least {} mm",
                        fmt_mm(t.over),
                        fmt_mm(t.crown_under),
                        fmt_mm(t.crown_under + TIP_OVER_CROWN)
                    ),
                )
            } else {
                (
                    true,
                    format!(
                        "The {what}'s {} prongs cover the girdle by {} mm (at least {MIN_PRONG_TIP} mm) and stand {} mm over it, short of the table",
                        self.prong.style.name(),
                        fmt_mm(t.cover),
                        fmt_mm(t.over)
                    ),
                )
            };
            if tip.as_ref().is_none_or(|(was, _)| *was && !ok) {
                tip = Some((ok, words));
            }
            let ok = head.prong + 1e-9 >= least;
            let words = if ok {
                format!("The {what}'s prong wire is {} mm, at or over the {} mm a {} prong holds with", fmt_mm(head.prong), fmt_mm(least), self.metal)
            } else {
                format!(
                    "The {what}'s prong wire is {} mm, under the {} mm a {} prong needs to hold a stone",
                    fmt_mm(head.prong),
                    fmt_mm(least),
                    self.metal
                )
            };
            if wire.as_ref().is_none_or(|(was, _)| *was && !ok) {
                wire = Some((ok, words));
            }
        }
        let mut out = Vec::new();
        if let Some((ok, w)) = tip {
            out.push(("prong-tip", ok, w));
        }
        if let Some((ok, w)) = wire {
            out.push(("prong-wire", ok, w));
        }
        out
    }

    /// One head's prongs and rail (mm³): each leg from the girdle to its foot, its top by style,
    /// and the gallery rail round half the girdle.
    fn head_prong_volume(&self, head: &Head, cut: &gem::Cut, length: f64, width: f64, sites: &[Site]) -> f64 {
        let rp = head.prong / 2.0;
        let lesser = length.min(width);
        let t = self.top_spec(head, lesser, cut);
        let wire_area = PI * rp * rp;
        let plane = Plane { o: Vec3::ZERO, u: Vec3::new(1.0, 0.0, 0.0), v: Vec3::new(0.0, 1.0, 0.0), w: Vec3::Z };
        let mut v = 0.0;
        for s in sites {
            let reach = s.at.len() * (1.0 - PRONG_FOOT);
            v += wire_area * reach.hypot(head.girdle_height());
            if is_round(t.style, s) {
                // The wire on up to its bead's centre, and the bead.
                v += wire_area * (t.girdle / 2.0 + t.over - rp).max(0.0) + 2.0 / 3.0 * PI * rp.powi(3);
            } else {
                v += top_parts(&plane, s, &t).iter().map(ProngPart::volume).sum::<f64>();
            }
        }
        if cut.name != "cabochon" {
            let rail_r = 0.7 * rp;
            let perimeter = if cut.is_circle(length, width) { PI * width } else { PI * (length + width) / 2.0 };
            v += PI * rail_r * rail_r * (0.5 * perimeter + TAU * 1.2 * rail_r);
        }
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }

    /// Every prong head's prongs and rails (mm³): none without prong heads.
    pub(super) fn prong_volume(&self) -> f64 {
        if !self.pronged() {
            return 0.0;
        }
        let mut v = 0.0;
        if let (Some(cut), Ok(sites)) = (self.cut_data(), self.centre_sites()) {
            v += self.head_prong_volume(&self.head(), cut, self.stone_length, self.stone_width, &sites);
        }
        if self.kind == PieceKind::ThreeStone
            && let (Some(cut), Ok(sites)) = (self.side_cut_data(), self.side_sites())
        {
            let sides = self.sides();
            v += 2.0 * self.head_prong_volume(&sides.head, cut, sides.length, sides.width, &sites);
        }
        v
    }

    /// The prongs' and rails' weight in grams.
    pub(super) fn prong_grams(&self) -> f64 {
        self.prong_volume() / 1000.0 * self.density
    }
}
