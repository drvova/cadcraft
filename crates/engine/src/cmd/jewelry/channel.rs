//! Channel setting: a row of stones between two rails along the band's top.
//!
//! `PIECE {pave: {layout: "channel", …}}` lays the stones as pavé's single row does
//! ([`super::pave_band::fit`]: the same span, gap and auto-fit, tables level with the band's
//! outside, graduated sizes too); this module builds the setting around them:
//!
//! - **Two rails**, one each side of the row, from [`CHANNEL_SINK`] under the band's outside (so
//!   they join it) to [`CHANNEL_RISE`] over the tables. Across the band each rail runs from the
//!   girdle less the **lip** (`channelLip`, default [`CHANNEL_LIP`] = 0.2 mm: the metal over the
//!   girdle that holds the stone) out to the girdle plus the **wall** (`channelWall`, default
//!   [`CHANNEL_WALL`] = 0.6 mm). Round the band each stone has its own length of rail, from half
//!   way to its neighbour (or a wall's width past its girdle at the row's ends), sized to its own
//!   girdle, so a graduated row's rails step with its stones.
//! - **The channel**: the metal between the lips is cut away from the girdles' top up through
//!   the rails, so the crowns show; each stone's seat (cut as every pavé stone's is, without the
//!   bore that would take its lips away) cuts its girdle's groove into the rails' inner faces
//!   under the lips.
//!
//! These defaults are our approximation of bench practice (channel walls of 0.5–0.8 mm, about
//! 0.2 mm of lip over a melee's girdle), not a standard.
//!
//! # Checks
//!
//! - `channel-lip`: the lip is at least [`MIN_CHANNEL_LIP`] (0.15 mm) and stops short of the
//!   smallest stone's table.
//! - `channel-wall`: the wall is at least [`MIN_CHANNEL_WALL`] (0.4 mm) and the rails stay on the
//!   band (their outsides within the band's half width).
//!
//! # Weight
//!
//! `metal.channelGrams` weighs the rails: each stone's length of both rails as an annular sector
//! (its angle × its mean radius × its section), with the seats' grooves not taken off.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::Value;

use super::pave_band::{self, Layout, PaveStone};
use super::piece_params::{GIRDLE, PieceParams, table_ratio};
use super::*;

/// The wall beyond the girdle when none is given (mm).
pub(super) const CHANNEL_WALL: f64 = 0.6;
/// The thinnest channel wall a bench casts and sets without it splaying (mm).
pub(super) const MIN_CHANNEL_WALL: f64 = 0.4;
/// The lip over the girdle when none is given (mm).
pub(super) const CHANNEL_LIP: f64 = 0.2;
/// The least lip that holds a stone in a channel (mm).
pub(super) const MIN_CHANNEL_LIP: f64 = 0.15;
/// How far the rails stand over the tables (mm).
pub(super) const CHANNEL_RISE: f64 = 0.3;
/// How far the rails reach under the band's outside (mm).
pub(super) const CHANNEL_SINK: f64 = 0.3;

/// `channelWall` and `channelLip` as given (`None`: the usual).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub(super) struct ChannelSpec {
    pub wall: Option<f64>,
    pub lip: Option<f64>,
}

impl ChannelSpec {
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<ChannelSpec> {
        let mm = |key: &str, min: f64, max: f64| -> Result<Option<f64>> {
            match p.get(key).filter(|v| !v.is_null()) {
                None => Ok(None),
                Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= min && *x <= max) {
                    Some(x) => Ok(Some(x)),
                    None => Err(bad(cmd, format!("`{key}` must be a number of millimetres from {min} to {max}, or null for the usual"))),
                },
            }
        };
        Ok(ChannelSpec { wall: mm("channelWall", 0.1, 2.0)?, lip: mm("channelLip", 0.0, 1.0)? })
    }
    pub(super) fn json_into(&self, o: &mut serde_json::Map<String, Value>) {
        o.insert("channelWall".into(), serde_json::json!(self.wall));
        o.insert("channelLip".into(), serde_json::json!(self.lip));
    }
    pub(super) fn wall(&self) -> f64 {
        self.wall.unwrap_or(CHANNEL_WALL)
    }
    pub(super) fn lip(&self) -> f64 {
        self.lip.unwrap_or(CHANNEL_LIP)
    }
}

/// One stone's length of the two rails, and of the channel cut between them, in the ring's
/// cylindrical frame (finger along Z, angles clockwise from 12 o'clock at +Y).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ChannelPiece {
    /// From and to, radians clockwise from 12 o'clock (`to` > `from`).
    pub from: f64,
    pub to: f64,
    /// The row's middle across the band (Z).
    pub z: f64,
    /// Across from the row's middle: the rails' inner faces (the lips' edges) and outer faces.
    pub inner: f64,
    pub outer: f64,
    /// Radii from the finger's axis: the rails' bottom and top, and the girdle's top (where the
    /// channel's cut stops).
    pub bottom: f64,
    pub top: f64,
    pub girdle_top: f64,
}

/// The signed distance to a wedge of angles `[from, to]` about Z (its two half-planes through
/// the axis): exact for a point inside, a lower bound outside.
fn wedge(p: Vec3, from: f64, to: f64) -> f64 {
    let around = |a: f64| Vec3::new(a.cos(), -a.sin(), 0.0);
    let (da, db) = (-p.dot(around(from)), p.dot(around(to)));
    if to - from < PI { da.max(db) } else { da.min(db) }
}

impl ChannelPiece {
    /// The two rails (`channel_sdf`): negative inside, 1-Lipschitz.
    pub(crate) fn rails(&self, p: Vec3) -> f64 {
        let rho = p.x.hypot(p.y);
        let az = (p.z - self.z).abs();
        let across = (self.inner - az).max(az - self.outer);
        let radial = (self.bottom - rho).max(rho - self.top);
        across.max(radial).max(wedge(p, self.from, self.to))
    }
    /// The channel cut between the lips, from the girdles' top up past the rails.
    pub(crate) fn opening(&self, p: Vec3) -> f64 {
        let rho = p.x.hypot(p.y);
        let az = (p.z - self.z).abs();
        let radial = (self.girdle_top - rho).max(rho - (self.top + 0.2));
        (az - self.inner).max(radial).max(wedge(p, self.from - 1e-4, self.to + 1e-4))
    }
    /// A box both lie in.
    pub(crate) fn bounds(&self) -> (Vec3, Vec3) {
        let r = self.top + 0.2;
        (Vec3::new(-r, -r, self.z - self.outer), Vec3::new(r, r, self.z + self.outer))
    }
    /// Both rails' volume (mm³).
    pub(crate) fn volume(&self) -> f64 {
        let v = (self.to - self.from) * (self.top * self.top - self.bottom * self.bottom) / 2.0 * 2.0 * (self.outer - self.inner);
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }
}

/// The cast solid's part: a stone's rails, added, or its channel, cut.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ChannelBound {
    pub piece: ChannelPiece,
    /// The channel cut rather than the rails.
    pub opening: bool,
}

impl ChannelBound {
    pub(crate) fn distance(&self, p: Vec3) -> f64 {
        if self.opening { self.piece.opening(p) } else { self.piece.rails(p) }
    }
    pub(crate) fn bounds(&self) -> (Vec3, Vec3) {
        self.piece.bounds()
    }
}

impl PieceParams {
    /// Whether the pavé is a channel.
    pub(super) fn channeled(&self) -> bool {
        self.pave.as_ref().is_some_and(|s| s.layout == Layout::Channel)
    }

    /// Each stone's length of rail, from the pavé's fit. Empty without a channel.
    pub(super) fn channel_pieces(&self) -> Vec<ChannelPiece> {
        if !self.channeled() {
            return Vec::new();
        }
        let Some(fit) = pave_band::fit(self) else { return Vec::new() };
        let Some(surf) = pave_band::Surface::of(self) else { return Vec::new() };
        channel_pieces(&fit.stones, &surf, self.channel.wall(), self.channel.lip())
    }

    /// The `channel-lip` and `channel-wall` checks, as (id, ok, words).
    pub(super) fn channel_checks(&self) -> Vec<(&'static str, bool, String)> {
        if !self.channeled() {
            return Vec::new();
        }
        let Some(fit) = pave_band::fit(self) else { return Vec::new() };
        let (wall, lip) = (self.channel.wall(), self.channel.lip());
        let smallest = fit.stones.iter().map(|s| s.diameter).fold(f64::INFINITY, f64::min);
        let largest = fit.stones.iter().map(|s| s.diameter).fold(0.0, f64::max);
        if !smallest.is_finite() {
            return vec![("channel-lip", false, "No stone fits the channel, so no lip holds one".to_string())];
        }
        let run = smallest / 2.0 * (1.0 - gem::CUTS.first().map_or(0.57, table_ratio));
        let lip_check = if lip + 1e-9 < MIN_CHANNEL_LIP {
            (false, format!("The channel's lips cover the girdles by {} mm, under the {MIN_CHANNEL_LIP} mm it takes to hold a stone", fmt_mm(lip)))
        } else if lip >= run - 1e-9 {
            (
                false,
                format!(
                    "The channel's lips reach {} mm over the crowns and the smallest stone's table starts {} mm in: they would cover it",
                    fmt_mm(lip),
                    fmt_mm(run)
                ),
            )
        } else {
            (true, format!("The channel's lips cover the girdles by {} mm (at least {MIN_CHANNEL_LIP} mm), short of the tables", fmt_mm(lip)))
        };
        let half = self.section().width / 2.0;
        let reach = largest / 2.0 + wall;
        let wall_check = if wall + 1e-9 < MIN_CHANNEL_WALL {
            (
                false,
                format!(
                    "The channel walls are {} mm beyond the girdles, under the {MIN_CHANNEL_WALL} mm a channel needs to hold its stones",
                    fmt_mm(wall)
                ),
            )
        } else if reach > half + 1e-9 {
            (
                false,
                format!(
                    "The channel's rails reach {} mm from the middle of the band and it is {} mm wide: give it at least {} mm, or smaller stones",
                    fmt_mm(reach),
                    fmt_mm(2.0 * half),
                    fmt_mm(2.0 * reach)
                ),
            )
        } else {
            (true, format!("The channel walls are {} mm beyond the girdles (at least {MIN_CHANNEL_WALL} mm) and stay on the band", fmt_mm(wall)))
        };
        vec![("channel-lip", lip_check.0, lip_check.1), ("channel-wall", wall_check.0, wall_check.1)]
    }

    /// The rails' weight in grams (none without a channel).
    pub(super) fn channel_grams(&self) -> f64 {
        self.channel_pieces().iter().map(ChannelPiece::volume).sum::<f64>() / 1000.0 * self.density
    }
}

/// Each stone's length of rail: half way to a neighbour that stands within a wall's reach of it,
/// else a wall's width past its girdle.
pub(super) fn channel_pieces(stones: &[PaveStone], surf: &pave_band::Surface, wall: f64, lip: f64) -> Vec<ChannelPiece> {
    let mut out = Vec::with_capacity(stones.len());
    for s in stones {
        let r = s.diameter / 2.0;
        let rho = s.table.xy().len();
        if !(rho.is_finite() && rho > 1e-6 && r.is_finite()) {
            continue;
        }
        // The nearest neighbours either way round, as angles (cyclic).
        let mut back = f64::INFINITY;
        let mut ahead = f64::INFINITY;
        for t in stones {
            if std::ptr::eq(s, t) || (t.across - s.across).abs() > 1e-6 {
                continue;
            }
            let d = (t.angle - s.angle).rem_euclid(TAU);
            if d > 1e-9 {
                ahead = ahead.min(d);
                back = back.min(TAU - d);
            }
        }
        let reach = |d: f64| -> f64 {
            // Neighbours closer than both girdles and two walls share a boundary half way.
            if d * rho <= 4.0 * r + 2.0 * wall { d / 2.0 } else { (r + wall) / rho }
        };
        let (from, to) = (s.angle - reach(back), s.angle + reach(ahead));
        let x = s.table.z;
        let (inner, outer) = ((r - lip).max(0.0), r + wall);
        let low = surf.section.height_at((x.abs() + outer).min(surf.section.width / 2.0)).min(surf.section.height_at(x.abs()));
        let girdle = GIRDLE * s.depth;
        let girdle_top = s.girdle.xy().len() + girdle / 2.0;
        out.push(ChannelPiece { from, to, z: x, inner, outer, bottom: surf.ri + low - CHANNEL_SINK, top: rho + CHANNEL_RISE, girdle_top });
    }
    out
}

/// What the sheet draws of a channel: in the front view, each run of rail's top as an open
/// polyline about the ring's centre; in the layout (the outside unrolled at `top`, 12 o'clock in
/// the middle), each piece's rails as two closed outlines.
pub(super) fn sheet(pieces: &[ChannelPiece], top: f64) -> (Vec<Vec<Vec2>>, Vec<Vec<Vec2>>) {
    let mut front = Vec::new();
    let mut layout = Vec::new();
    for c in pieces {
        let steps = (((c.to - c.from) * c.top / 0.25).ceil() as usize).clamp(2, 64);
        front.push((0..=steps).map(|k| Vec2::from_angle(PI / 2.0 - (c.from + (c.to - c.from) * k as f64 / steps as f64)) * c.top).collect());
        let wrap = |a: f64| (a + PI).rem_euclid(TAU) - PI;
        let (a, b) = (wrap(c.from) * top, wrap(c.from) * top + (c.to - c.from) * top);
        for side in [-1.0, 1.0] {
            let (y0, y1) = (c.z + side * c.inner, c.z + side * c.outer);
            layout.push(vec![Vec2::new(a, y0), Vec2::new(b, y0), Vec2::new(b, y1), Vec2::new(a, y1)]);
        }
    }
    (front, layout)
}
