//! Generative patterns on a band: a pierced lattice (Voronoi cells, a honeycomb, a chain of wave
//! lenses) or the same patterns as relief on the outside — a parameter of `PIECE`, a handful of
//! numbers and a seed, no code and no node graph.
//!
//! `PIECE {kind: "band", pattern: {voronoi: {cells?, seed?, jitter?, wall?, rim?, depth?, relief?}}}`
//! (or `{hex: {size?, …}}`, `{wave: {count?, amplitude?, …}}`, `{truchet: {tile?, seed?, depth, …}}`).
//! The same `pattern` key carries the twisted cable's `{twist: …}` (its own module reads that);
//! one key at a time.
//!
//! # The developed surface
//!
//! The band is developed at its **inside** (the finger's circle, radius `rᵢ`): a point at angle
//! θ clockwise from 12 o'clock (seen from +Z, `θ = atan2(x, y)`) and `z` along the finger is
//! `(s, z) = (θ·rᵢ, z)`, `0 ≤ s < L = 2π·rᵢ`, periodic in `s`. The pattern is drawn on the
//! strip `|z| ≤ h = width/2 − rim`; the rims either side stay whole. A pierced opening goes
//! straight through the wall along the radius, so it is the same angular shape at every radius:
//! a rib is `wall` wide on the inside and wider outward (by `r/rᵢ`) — the least rib is the
//! inside one, the one checked.
//!
//! # The field
//!
//! [`Layout::open`] is a signed distance bound on the developed strip, positive inside an
//! opening: for a Voronoi or honeycomb cell the distance to the cell's boundary less half the
//! wall (exact, [`super::voronoi`]); for a wave lens `(a·|sin ks| − |z|)/√(1 + a²k²) − wall/2`
//! (a bound: its gradient is at most one); for Truchet tiles the distance to the nearest quarter
//! arc less half the wall. The cast solid's cut ([`PatternCut::distance`]) maps it onto the band:
//! `(s, z)` from the 3D point, the field scaled by `(rᵢ − 0.3)/rᵢ` so it stays 1-Lipschitz down
//! to 0.3 mm inside the finger, intersected with the wall's radial span (pierced) or with the
//! skin `depth` under the outside (relief).
//!
//! # Weight
//!
//! The metal taken away is `∫∫ t(z) dθ dz` over the openings (or over the lines, for recessed
//! relief), `dθ = ds/rᵢ`: each opening is an exact polygon on the developed strip and the
//! integral runs over its chords `z` by `z` (midpoint rule, 96 slices), `t(z)` the radial
//! `∫ r dr` across the wall there — `((rᵢ + h(z))² − (rᵢ + i(z))²)/2` for a piercing (`h` the
//! outside's height, `i` the eased inside), `(rₒ² − (rₒ − d′)²)/2` for relief, `d′` the depth
//! measured along the radius (`depth·√(1 + h′²)`). This is exact for a pierced band but for the
//! slicing (well under 0.1 %); relief on a curved outside is an approximation (the solid cuts
//! the depth along the surface's normal). The cast solid agrees within its sampling (tests:
//! 3 % at a 0.1 mm grid).
//!
//! # Checks (`pattern`)
//!
//! - **Ribs**: `wall` at least [`MIN_RIB`] (a bench's least castable wire), the rims too.
//! - **Openings**: a cell whose opening is under [`MIN_OPENING`] across (`4·area/perimeter`, a
//!   circle's diameter, a square's side) is left closed, not pierced, and counted.
//! - **Strength** (an approximation, stated): the band holds when at most [`MAX_OPEN`] of its
//!   developed outside is open and every rib's cross-section — `wall` × the band's thinnest
//!   radial thickness — is at least [`MIN_RIB_SECTION`].
//! - **Relief**: the metal left under the relief (thinnest wall less `depth`) at least the
//!   thinnest wall a bench casts.
//!
//! # Engraving
//!
//! A pierced band has no whole inside or outside to engrave: engraving is refused on it with a
//! sentence ([`engraving_conflict`]). A relief band keeps a plain inside, where engraving goes;
//! its outside carries the relief, so an outside engraving is refused.

use std::sync::Arc;

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::piece_params::{MIN_CAST_WALL, PieceKind, PieceParams, Section};
use super::solid::Prim;
use super::voronoi::{self, Rng, Sites};
use super::*;

/// The least rib (and rim) a bench casts, mm: about the thinnest wire that fills in a casting.
pub(super) const MIN_RIB: f64 = 0.6;
/// The least opening across, mm: smaller ones are left closed.
pub(super) const MIN_OPENING: f64 = 0.6;
/// The most of the band's developed outside that may be open for it to hold its round.
pub(super) const MAX_OPEN: f64 = 0.65;
/// The least cross-section of a rib (width × radial thickness), mm².
pub(super) const MIN_RIB_SECTION: f64 = 0.4;
/// The most cells (or tiles, or lenses) a pattern has.
pub(super) const MAX_CELLS: u32 = 600;
/// How far inside the finger and outside the band a piercing reaches, mm.
const MARGIN: f64 = 0.3;
/// Slices across an opening for its weight.
const SLICES: usize = 96;
/// Points along half a wave lens's outline.
const LENS_POINTS: usize = 24;
/// Points along a Truchet arc's outline.
const ARC_POINTS: usize = 10;

// ---------------------------------------------------------------------------------------------
// The parameters
// ---------------------------------------------------------------------------------------------

/// What the pattern is made of.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Motif {
    /// Seeded Voronoi cells: `cells` of them round the band, each site moved from its grid
    /// cell's centre by up to `jitter` (0 a regular grid, 1 the most).
    Voronoi { cells: u32, seed: u32, jitter: f64 },
    /// A honeycomb of hexagons `size` across the flats.
    Hex { size: f64 },
    /// A chain of `count` lens openings between two crossing waves of `amplitude` (mm; `None`
    /// for nine tenths of the strip's half-width).
    Wave { count: u32, amplitude: Option<f64> },
    /// Truchet tiles `tile` mm square, each with two quarter arcs turned by the seed (relief only).
    Truchet { tile: f64, seed: u32 },
}

impl Motif {
    pub(super) fn name(&self) -> &'static str {
        match self {
            Motif::Voronoi { .. } => "voronoi",
            Motif::Hex { .. } => "hex",
            Motif::Wave { .. } => "wave",
            Motif::Truchet { .. } => "truchet",
        }
    }
    /// The usual rib for the motif, mm.
    fn wall(&self) -> f64 {
        match self {
            Motif::Voronoi { .. } | Motif::Wave { .. } => 0.8,
            Motif::Hex { .. } => 0.7,
            Motif::Truchet { .. } => 0.5,
        }
    }
}

/// Pierced through, or relief on the outside.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Finish {
    Pierced,
    /// `depth` into the outside; `raised`: the lines stand proud and the cells are sunk
    /// (else the lines are sunk as grooves).
    Relief {
        depth: f64,
        raised: bool,
    },
}

/// `pattern` as asked for.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PatternSpec {
    pub motif: Motif,
    /// The rib (line) width, mm.
    pub wall: f64,
    /// The plain rim each side, mm (`None`: the larger of the wall and [`MIN_RIB`]).
    pub rim: Option<f64>,
    pub finish: Finish,
}

const COMMON: [&str; 4] = ["wall", "rim", "depth", "relief"];

fn short(k: &str) -> String {
    k.chars().take(24).collect()
}

fn num(o: &Map<String, Value>, key: &str, default: f64, min: f64, max: f64, what: &str) -> Result<f64> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && (min..=max).contains(x))
            .ok_or_else(|| bad(CMD, format!("`pattern.{key}` must be {what} from {min} to {max}"))),
    }
}

fn whole(o: &Map<String, Value>, key: &str, default: u32, min: u32, max: u32, what: &str) -> Result<u32> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => v
            .as_u64()
            .filter(|n| (u64::from(min)..=u64::from(max)).contains(n))
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| bad(CMD, format!("`pattern.{key}` must be {what} from {min} to {max}"))),
    }
}

const CMD: &str = "piece";

impl PatternSpec {
    /// `pattern` from a piece's parameters: `None` when absent, null, false, or the cable's
    /// `{twist}` (which is not this module's).
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Option<PatternSpec>> {
        let o = match p.get("pattern") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::Object(o)) => o,
            Some(_) => {
                return Err(bad(cmd, "`pattern` is {voronoi: {…}}, {hex: {…}}, {wave: {…}} or {truchet: {…}} (or a cable's {twist: {…}}), or null"));
            }
        };
        if o.contains_key("twist") {
            return Ok(None);
        }
        let mut keys = o.keys();
        let (Some(name), None) = (keys.next(), keys.next()) else {
            return Err(bad(cmd, "`pattern` takes one of voronoi, hex, wave or truchet"));
        };
        let empty = Map::new();
        let inner = match o.get(name) {
            Some(Value::Object(m)) => m,
            Some(Value::Null) | Some(Value::Bool(true)) => &empty,
            _ => return Err(bad(cmd, format!("`pattern.{}` must be an object of its settings", short(name)))),
        };
        let (motif, own): (Motif, &[&str]) = match name.as_str() {
            "voronoi" => (
                Motif::Voronoi {
                    cells: whole(inner, "cells", 24, 3, MAX_CELLS, "a whole number of cells")?,
                    seed: whole(inner, "seed", 1, 0, u32::MAX, "a whole number")?,
                    jitter: num(inner, "jitter", 0.8, 0.0, 1.0, "a number")?,
                },
                &["cells", "seed", "jitter"],
            ),
            "hex" | "honeycomb" => (Motif::Hex { size: num(inner, "size", 2.4, 1.0, 12.0, "millimetres across the flats")? }, &["size"]),
            "wave" => (
                Motif::Wave {
                    count: whole(inner, "count", 10, 2, 120, "a whole number of openings round the band")?,
                    amplitude: match inner.get("amplitude").filter(|v| !v.is_null()) {
                        None => None,
                        Some(_) => Some(num(inner, "amplitude", 1.0, 0.2, 15.0, "millimetres")?),
                    },
                },
                &["count", "amplitude"],
            ),
            "truchet" => (
                Motif::Truchet {
                    tile: num(inner, "tile", 2.0, 1.0, 10.0, "millimetres")?,
                    seed: whole(inner, "seed", 1, 0, u32::MAX, "a whole number")?,
                },
                &["tile", "seed"],
            ),
            other => {
                return Err(bad(cmd, format!("`pattern` is voronoi, hex, wave or truchet (or a cable's twist), not `{}`", short(other))));
            }
        };
        if let Some(k) = inner.keys().find(|k| !own.contains(&k.as_str()) && !COMMON.contains(&k.as_str())) {
            return Err(bad(cmd, format!("`pattern.{name}` takes {} and {}, not `{}`", own.join(", "), COMMON.join(", "), short(k))));
        }
        let wall = num(inner, "wall", motif.wall(), 0.3, 3.0, "millimetres of rib")?;
        let rim = match inner.get("rim").filter(|v| !v.is_null()) {
            None => None,
            Some(_) => Some(num(inner, "rim", 0.8, 0.3, 5.0, "millimetres of plain rim each side")?),
        };
        let raised = match inner.get("relief").filter(|v| !v.is_null()) {
            None => true,
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()) {
                Some(s) if s == "raised" => true,
                Some(s) if s == "recessed" || s == "sunk" => false,
                _ => return Err(bad(cmd, "`pattern.relief` must be raised (the lines stand proud) or recessed (the lines sunk)")),
            },
        };
        let finish = match inner.get("depth").filter(|v| !v.is_null()) {
            None => Finish::Pierced,
            Some(_) => Finish::Relief { depth: num(inner, "depth", 0.3, 0.05, 2.0, "millimetres of relief")?, raised },
        };
        if matches!(motif, Motif::Truchet { .. }) && finish == Finish::Pierced {
            return Err(bad(
                cmd,
                "a Truchet pattern's arcs close into rings, which would fall out of a pierced band: give it a `depth` to make it relief",
            ));
        }
        Ok(Some(PatternSpec { motif, wall, rim, finish }))
    }

    /// The spec as `parse` reads it back.
    pub(super) fn json(&self) -> Value {
        let mut m = match &self.motif {
            Motif::Voronoi { cells, seed, jitter } => json!({ "cells": cells, "seed": seed, "jitter": jitter }),
            Motif::Hex { size } => json!({ "size": size }),
            Motif::Wave { count, amplitude } => json!({ "count": count, "amplitude": amplitude }),
            Motif::Truchet { tile, seed } => json!({ "tile": tile, "seed": seed }),
        };
        if let Some(o) = m.as_object_mut() {
            o.insert("wall".into(), json!(self.wall));
            o.insert("rim".into(), json!(self.rim));
            let (depth, relief) = match self.finish {
                Finish::Pierced => (Value::Null, Value::Null),
                Finish::Relief { depth, raised } => (json!(depth), json!(if raised { "raised" } else { "recessed" })),
            };
            o.insert("depth".into(), depth);
            o.insert("relief".into(), relief);
        }
        json!({ self.motif.name(): m })
    }

    /// The rim each side, mm.
    pub(super) fn rim(&self) -> f64 {
        self.rim.unwrap_or(self.wall.max(MIN_RIB))
    }
}

/// A change to `pattern` over the stored one: the same motif merges key by key (so a new seed
/// alone reshuffles), another motif (or anything not an object) replaces it.
pub(super) fn merge(stored: Option<&Value>, given: &Value) -> Value {
    let (Some(Value::Object(old)), Value::Object(new)) = (stored, given) else { return given.clone() };
    let (Some((k_new, v_new)), Some((k_old, v_old))) = (new.iter().next(), old.iter().next()) else { return given.clone() };
    if new.len() != 1 || k_new != k_old {
        return given.clone();
    }
    match (v_old, v_new) {
        (Value::Object(a), Value::Object(b)) => {
            let mut m = a.clone();
            for (k, v) in b {
                m.insert(k.clone(), v.clone());
            }
            json!({ k_new.clone(): Value::Object(m) })
        }
        _ => given.clone(),
    }
}

// ---------------------------------------------------------------------------------------------
// The layout on the developed strip
// ---------------------------------------------------------------------------------------------

/// The motif laid on the strip.
#[derive(Clone, Debug)]
enum Geom {
    Cells {
        sites: Sites,
        closed: Vec<bool>,
    },
    /// `k` the wave number, `a` the amplitude, `g = √(1 + a²k²)`.
    Wave {
        k: f64,
        a: f64,
        g: f64,
    },
    /// Tiles `t` square, `cols × rows` from `z0`, `turn[r·cols + c]`.
    Truchet {
        t: f64,
        cols: usize,
        rows: usize,
        z0: f64,
        turn: Vec<bool>,
    },
}

/// A pattern worked out on a band.
#[derive(Clone, Debug)]
pub(super) struct Layout {
    pub spec: PatternSpec,
    /// The finger's radius (the developed surface's), the strip's length round and half-width.
    pub ri: f64,
    pub length: f64,
    pub h: f64,
    pub width: f64,
    geom: Geom,
    /// The openings (cells, lenses; for Truchet the spaces are not polygons, so none), each a
    /// closed polygon on the strip, `0 ≤ s` about `L`.
    pub openings: Vec<Vec<Vec2>>,
    /// Truchet's arcs as closed polygons (the lines; empty for the other motifs).
    pub lines: Vec<Vec<Vec2>>,
    /// Cells too small to pierce, left closed.
    pub closed: usize,
    /// The least opening across among those kept, mm.
    pub least_opening: f64,
    section: Section,
}

/// Why a pattern cannot be laid on a piece, in a sentence.
pub(super) fn refusal(p: &PieceParams) -> Option<String> {
    let spec = p.pattern.as_ref()?;
    if p.kind != PieceKind::Band {
        return Some(format!("a pattern is laid on a plain band (kind band); this piece is a {}", p.kind.name()));
    }
    if p.pave.is_some() {
        return Some("pavé and a pattern both want the band's outside: give one of them up".into());
    }
    if p.custom.is_some() {
        return Some("a pattern follows one of the named profiles; a drawn profile cannot carry one yet".into());
    }
    let h = p.width / 2.0 - spec.rim();
    if h < 0.4 {
        return Some(format!(
            "a {} mm band with {} mm rims leaves no room for a pattern: make it at least {} mm wide or the rims narrower",
            fmt_mm(p.width),
            fmt_mm(spec.rim()),
            fmt_mm(2.0 * spec.rim() + 0.8)
        ));
    }
    match Layout::of(p) {
        Ok(_) => None,
        Err(e) => Some(e),
    }
}

impl Layout {
    /// The pattern on `p`'s band, or why not.
    pub(super) fn of(p: &PieceParams) -> std::result::Result<Layout, String> {
        let spec = p.pattern.clone().ok_or_else(|| "no pattern".to_string())?;
        let ri = p.inner() / 2.0;
        let length = TAU * ri;
        let h = p.width / 2.0 - spec.rim();
        let w = spec.wall;
        if !(ri.is_finite() && ri > 1.0 && h > 0.2) {
            return Err("the band is too narrow for a pattern between its rims".into());
        }
        let section = p.section();
        let mut layout = Layout {
            spec: spec.clone(),
            ri,
            length,
            h,
            width: p.width,
            geom: Geom::Wave { k: 1.0, a: 0.0, g: 1.0 },
            openings: Vec::new(),
            lines: Vec::new(),
            closed: 0,
            least_opening: f64::INFINITY,
            section,
        };
        let too_wide = || format!("a {} mm rib is too wide for cells this small: fewer cells, or a thinner wall", fmt_mm(w));
        match &spec.motif {
            Motif::Voronoi { cells, seed, jitter } => {
                let n = f64::from(*cells);
                let side = (length * 2.0 * h / n).sqrt();
                let rows = ((2.0 * h / side).round().max(1.0) as usize).min(64);
                let cols = ((n / rows as f64).round().max(3.0) as usize).min(MAX_CELLS as usize);
                let (cw, ch) = (length / cols as f64, 2.0 * h / rows as f64);
                let j = jitter.clamp(0.0, 1.0) * 0.45;
                let mut rng = Rng::new(u64::from(*seed));
                let mut pts = Vec::with_capacity(rows * cols);
                for r in 0..rows {
                    for c in 0..cols {
                        let (u, v) = (rng.unit() * 2.0 - 1.0, rng.unit() * 2.0 - 1.0);
                        pts.push(Vec2::new((c as f64 + 0.5 + j * u) * cw, -h + (r as f64 + 0.5 + j * v) * ch));
                    }
                }
                let sites = Sites::new(cols, rows, cw, ch, -h, pts, (j, j), w).ok_or_else(too_wide)?;
                layout.cells(sites);
            }
            Motif::Hex { size } => {
                let cols = ((length / size).round().max(3.0) as usize).min(MAX_CELLS as usize);
                let cw = length / cols as f64;
                let ch = cw * 3f64.sqrt() / 2.0;
                // Rows enough to cover the strip, centred on it.
                let rows = ((2.0 * h / ch).ceil() as usize + 1).clamp(1, 64);
                if rows.saturating_mul(cols) > MAX_CELLS as usize * 2 {
                    return Err(format!("hexagons of {} mm are too many for this band: make them larger", fmt_mm(*size)));
                }
                let z0 = -(rows as f64) * ch / 2.0;
                let mut pts = Vec::with_capacity(rows * cols);
                for r in 0..rows {
                    let shift = if r % 2 == 1 { 0.5 } else { 0.0 };
                    for c in 0..cols {
                        pts.push(Vec2::new((c as f64 + 0.5 + shift) * cw, z0 + (r as f64 + 0.5) * ch));
                    }
                }
                let sites = Sites::new(cols, rows, cw, ch, z0, pts, (0.5, 0.0), w).ok_or_else(too_wide)?;
                layout.cells(sites);
            }
            Motif::Wave { count, amplitude } => {
                let k = PI * f64::from(*count) / length;
                let a = amplitude.unwrap_or(0.9 * h).max(0.05);
                let g = (1.0 + (a * k).powi(2)).sqrt();
                layout.geom = Geom::Wave { k, a, g };
                for i in 0..*count {
                    let (s0, s1) = (f64::from(i) * PI / k, f64::from(i + 1) * PI / k);
                    let top: Vec<Vec2> = (0..=LENS_POINTS)
                        .filter_map(|m| {
                            let s = s0 + (s1 - s0) * m as f64 / LENS_POINTS as f64;
                            let z = (a * (k * s).sin().abs() - g * w / 2.0).min(h);
                            (z > 1e-6).then_some(Vec2::new(s, z))
                        })
                        .collect();
                    if top.len() < 2 {
                        continue;
                    }
                    let mut poly: Vec<Vec2> = top.iter().map(|q| Vec2::new(q.x, -q.y)).collect();
                    poly.extend(top.iter().rev().copied());
                    layout.keep(poly);
                }
            }
            Motif::Truchet { tile, seed } => {
                let cols = ((length / tile).round().max(3.0) as usize).min(MAX_CELLS as usize);
                let t = length / cols as f64;
                let rows = (2.0 * h / t).floor() as usize;
                if rows == 0 {
                    return Err(format!(
                        "a {} mm tile is wider than the {} mm strip between the rims: make the tiles smaller",
                        fmt_mm(t),
                        fmt_mm(2.0 * h)
                    ));
                }
                if rows.saturating_mul(cols) > MAX_CELLS as usize {
                    return Err(format!("{} tiles are more than {MAX_CELLS}: make them larger", rows * cols));
                }
                if w > 0.4 * t {
                    return Err(format!("a {} mm line is too wide for {} mm tiles (at most 40 % of a tile)", fmt_mm(w), fmt_mm(t)));
                }
                let mut rng = Rng::new(u64::from(*seed));
                let turn: Vec<bool> = (0..rows * cols).map(|_| rng.next_u64() & 1 == 1).collect();
                let z0 = -(rows as f64) * t / 2.0;
                for (i, turned) in turn.iter().enumerate() {
                    let (r, c) = (i / cols, i % cols);
                    let o = Vec2::new(c as f64 * t, z0 + r as f64 * t);
                    for (corner, dir) in arcs(*turned) {
                        layout.lines.push(quarter_annulus(o + corner * t, dir, t / 2.0, w / 2.0));
                    }
                }
                layout.geom = Geom::Truchet { t, cols, rows, z0, turn };
            }
        }
        Ok(layout)
    }

    /// Lay Voronoi (or hexagonal) cells: each kept when its opening is wide enough.
    fn cells(&mut self, sites: Sites) {
        let (w, h) = (self.spec.wall, self.h);
        let mut closed = vec![false; sites.pts.len()];
        for (i, shut) in closed.iter_mut().enumerate() {
            let poly = sites.cell(i, w / 2.0, h);
            if poly.is_empty() {
                // Nothing of it is in the strip once inset: it stays metal either way.
                continue;
            }
            if across(&poly) < MIN_OPENING {
                *shut = true;
                self.closed += 1;
                continue;
            }
            self.keep(poly);
        }
        self.geom = Geom::Cells { sites, closed };
    }

    fn keep(&mut self, poly: Vec<Vec2>) {
        let a = across(&poly);
        if a < MIN_OPENING && !matches!(self.geom, Geom::Cells { .. }) {
            self.closed += 1;
            return;
        }
        self.least_opening = self.least_opening.min(a);
        self.openings.push(poly);
    }

    /// The signed distance bound on the strip, positive inside an opening (for Truchet: away
    /// from every line), negative in the ribs, the rims and outside the strip.
    pub(super) fn open(&self, q: Vec2) -> f64 {
        let (w, h) = (self.spec.wall, self.h);
        let zc = q.y.clamp(-h, h);
        let base = match &self.geom {
            Geom::Cells { sites, closed } => {
                let (i, e) = sites.boundary(Vec2::new(q.x, zc));
                if closed.get(i).copied().unwrap_or(true) { -(e + w / 2.0) } else { e - w / 2.0 }
            }
            Geom::Wave { k, a, g } => {
                let v = (a * (k * q.x).sin().abs() - zc.abs()) / g - w / 2.0;
                // Lenses under the least opening are left closed (as the polygons are).
                if self.openings.is_empty() { -w } else { v }
            }
            Geom::Truchet { t, cols, rows, z0, turn } => truchet_dist(Vec2::new(q.x, zc), *t, w / 2.0, *cols, *rows, *z0, turn, self.length),
        };
        let v = base.min(h - q.y.abs());
        if v.is_finite() { v } else { -1.0 }
    }

    /// The radial `∫ r dr` across the wall at `z`: the metal a piercing takes there per radian.
    fn through(&self, z: f64) -> f64 {
        let (a, b) = (self.ri + self.section.inside_at(z), self.ri + self.section.height_at(z));
        ((b * b - a * a) / 2.0).max(0.0)
    }

    /// The same for relief `depth` under the outside.
    fn skin(&self, z: f64, depth: f64) -> f64 {
        let dz = 1e-4;
        let slope = (self.section.height_at(z + dz) - self.section.height_at(z - dz)) / (2.0 * dz);
        let d = depth * (1.0 + slope * slope).sqrt();
        let ro = self.ri + self.section.height_at(z);
        let lo = (ro - d).max(self.ri + self.section.inside_at(z));
        ((ro * ro - lo * lo) / 2.0).max(0.0)
    }

    /// The metal the pattern takes away, mm³.
    pub(super) fn removed(&self) -> f64 {
        let f = |z: f64| match self.spec.finish {
            Finish::Pierced => self.through(z),
            Finish::Relief { depth, .. } => self.skin(z, depth),
        };
        let over = |polys: &[Vec<Vec2>]| polys.iter().map(|q| voronoi::integrate(q, SLICES, f)).sum::<f64>() / self.ri;
        let strip = || {
            let n = 400;
            let dz = 2.0 * self.h / n as f64;
            (0..n).map(|k| f(-self.h + (k as f64 + 0.5) * dz)).sum::<f64>() * dz * self.length / self.ri
        };
        let truchet = matches!(self.geom, Geom::Truchet { .. });
        let v = match (self.spec.finish, truchet) {
            (Finish::Pierced, _) | (Finish::Relief { raised: true, .. }, false) => over(&self.openings),
            (Finish::Relief { raised: false, .. }, false) => strip() - over(&self.openings),
            (Finish::Relief { raised: true, .. }, true) => strip() - over(&self.lines),
            (Finish::Relief { raised: false, .. }, true) => over(&self.lines),
        };
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }

    /// The open fraction of the band's developed outside (pierced bands).
    pub(super) fn open_fraction(&self) -> f64 {
        let a: f64 = self.openings.iter().map(|q| voronoi::area(q).abs()).sum();
        a / (self.length * self.width).max(1e-9)
    }

    /// The cut the cast solid makes, for a band whose revolved section is `band`.
    pub(super) fn cut(self: &Arc<Self>, band: Prim) -> Prim {
        let ri = self.ri;
        let rmax = ri + self.section.wall.max(self.section.height_at(0.0)).max(0.0);
        Prim::Pattern(Box::new(PatternCut { layout: Arc::clone(self), ri, rmax, kappa: ((ri - MARGIN) / ri).clamp(0.1, 1.0), band }))
    }

    /// The developed band and its pattern for the sheet: the outline `L × width` and every
    /// opening (or line), centred on the strip's middle.
    pub(super) fn sheet(&self) -> (f64, Vec<Vec<Vec2>>) {
        let half = self.length / 2.0;
        let polys = if self.lines.is_empty() { &self.openings } else { &self.lines };
        (self.length, polys.iter().take(MAX_CELLS as usize * 2).map(|q| q.iter().map(|p| Vec2::new(p.x - half, p.y)).collect()).collect())
    }
}

/// An opening's size across: `4·area/perimeter`.
pub(super) fn across(poly: &[Vec2]) -> f64 {
    let p = voronoi::perimeter(poly);
    if p > 1e-12 { 4.0 * voronoi::area(poly).abs() / p } else { 0.0 }
}

/// A tile's two arcs: each a corner (in tile units) and the direction into the tile.
fn arcs(turned: bool) -> [(Vec2, Vec2); 2] {
    if turned {
        [(Vec2::new(1.0, 0.0), Vec2::new(-1.0, 1.0)), (Vec2::new(0.0, 1.0), Vec2::new(1.0, -1.0))]
    } else {
        [(Vec2::new(0.0, 0.0), Vec2::new(1.0, 1.0)), (Vec2::new(1.0, 1.0), Vec2::new(-1.0, -1.0))]
    }
}

/// A quarter annulus round `c`, radius `r ± hw`, in the quadrant `dir` points into.
fn quarter_annulus(c: Vec2, dir: Vec2, r: f64, hw: f64) -> Vec<Vec2> {
    let at = |rad: f64, t: f64| {
        let a = t * PI / 2.0;
        c + Vec2::new(dir.x * rad * a.cos(), dir.y * rad * a.sin())
    };
    let mut poly: Vec<Vec2> = (0..=ARC_POINTS).map(|m| at(r + hw, m as f64 / ARC_POINTS as f64)).collect();
    poly.extend((0..=ARC_POINTS).rev().map(|m| at(r - hw, m as f64 / ARC_POINTS as f64)));
    // Counter-clockwise, as every other polygon.
    if voronoi::area(&poly) < 0.0 {
        poly.reverse();
    }
    poly
}

/// A signed distance bound to the nearest Truchet line (a quarter annulus `hw` either side of
/// its arc, cut square at the tile's edges), negative inside a line; exact within a tile.
fn truchet_dist(q: Vec2, t: f64, hw: f64, cols: usize, rows: usize, z0: f64, turn: &[bool], length: f64) -> f64 {
    let s = q.x.rem_euclid(length);
    let c = (s / t).floor() as i64;
    let r = ((q.y - z0) / t).floor().clamp(0.0, rows.saturating_sub(1) as f64) as i64;
    let mut best = 0.99 * t - hw;
    for rr in (r - 1)..=(r + 1) {
        if rr < 0 || rr >= rows as i64 {
            continue;
        }
        for cc in (c - 1)..=(c + 1) {
            let k = cc.rem_euclid(cols as i64);
            let Some(turned) = usize::try_from(rr * cols as i64 + k).ok().and_then(|i| turn.get(i)) else { continue };
            let o = Vec2::new(cc as f64 * t, z0 + rr as f64 * t);
            for (corner, dir) in arcs(*turned) {
                let v = Vec2::new(s, q.y) - (o + corner * t);
                let ring = (v.len() - t / 2.0).abs() - hw;
                // The quadrant the arc lies in, as a signed distance.
                let (a, b) = (v.x * dir.x, v.y * dir.y);
                let quadrant = if a >= 0.0 && b >= 0.0 {
                    -a.min(b)
                } else if a < 0.0 && b < 0.0 {
                    a.hypot(b)
                } else {
                    (-a).max(-b)
                };
                best = best.min(ring.max(quadrant));
            }
        }
    }
    best
}

// ---------------------------------------------------------------------------------------------
// The cast solid's cut
// ---------------------------------------------------------------------------------------------

/// The pattern as a cut of the cast solid ([`Prim::Pattern`]).
#[derive(Clone, Debug)]
pub(super) struct PatternCut {
    layout: Arc<Layout>,
    ri: f64,
    rmax: f64,
    kappa: f64,
    /// The band's own revolved section, for relief's depth under the outside.
    band: Prim,
}

impl PatternCut {
    /// A signed distance bound, negative where metal is cut away.
    pub(super) fn distance(&self, p: Vec3) -> f64 {
        let r = p.x.hypot(p.y);
        let theta = p.x.atan2(p.y);
        let l = &self.layout;
        let o = self.kappa * l.open(Vec2::new(theta * self.ri, p.z));
        match l.spec.finish {
            Finish::Pierced => (-o).max(self.ri - MARGIN - r).max(r - self.rmax - MARGIN),
            Finish::Relief { depth, raised } => {
                let region = if raised { -o } else { o.max(self.kappa * (p.z.abs() - l.h)) };
                let guard = self.ri + 0.35 * l.section.wall - r;
                region.max(-(self.band.eval(p) + depth)).max(guard)
            }
        }
    }

    /// The box outside which the cut is positive.
    pub(super) fn bounds(&self) -> (Vec3, Vec3) {
        let (r, h) = (self.rmax + MARGIN, self.layout.h + 0.05);
        (Vec3::new(-r, -r, -h), Vec3::new(r, r, h))
    }
}

// ---------------------------------------------------------------------------------------------
// The check, the reply, the line
// ---------------------------------------------------------------------------------------------

/// The `pattern` check: ok and its sentence.
pub(super) fn judge(l: &Layout) -> (bool, String) {
    let spec = &l.spec;
    let (thin, _) = l.section.thinnest();
    let mut problems: Vec<String> = Vec::new();
    if spec.wall + 1e-9 < MIN_RIB {
        problems.push(format!("a {} mm rib is thinner than a bench casts ({MIN_RIB} mm)", fmt_mm(spec.wall)));
    }
    if spec.rim() + 1e-9 < MIN_RIB {
        problems.push(format!("a {} mm rim is thinner than a bench casts ({MIN_RIB} mm)", fmt_mm(spec.rim())));
    }
    let what = match spec.motif {
        Motif::Voronoi { .. } => "cells",
        Motif::Hex { .. } => "hexagons",
        Motif::Wave { .. } => "lenses",
        Motif::Truchet { .. } => "tiles",
    };
    match spec.finish {
        Finish::Pierced => {
            if l.openings.is_empty() {
                problems.push(format!("no opening is {MIN_OPENING} mm across: the {what} are too small for a {} mm rib", fmt_mm(spec.wall)));
            }
            let open = l.open_fraction();
            if open > MAX_OPEN {
                problems.push(format!(
                    "{:.0} % of the band is open, more than the {:.0} % it can lose and hold its round",
                    open * 100.0,
                    MAX_OPEN * 100.0
                ));
            }
            let section = spec.wall * thin;
            if section + 1e-9 < MIN_RIB_SECTION {
                problems.push(format!(
                    "a rib is {} × {} mm, {:.2} mm² across, under the {MIN_RIB_SECTION} mm² that keeps it from bending",
                    fmt_mm(spec.wall),
                    fmt_mm(thin),
                    section
                ));
            }
        }
        Finish::Relief { depth, .. } => {
            if thin - depth + 1e-9 < MIN_CAST_WALL {
                problems.push(format!(
                    "{} mm of relief in a {} mm wall leaves {} mm under it, under the {MIN_CAST_WALL} mm a bench casts",
                    fmt_mm(depth),
                    fmt_mm(thin),
                    fmt_mm((thin - depth).max(0.0))
                ));
            }
        }
    }
    let lead = match spec.finish {
        Finish::Pierced => format!(
            "{} {what} pierced through ({} left closed as too small), ribs {} mm on the inside and wider outward, rims {} mm, {:.0} % open",
            l.openings.len(),
            l.closed,
            fmt_mm(spec.wall),
            fmt_mm(spec.rim()),
            l.open_fraction() * 100.0
        ),
        Finish::Relief { depth, raised } => format!(
            "{} {what} in relief {} mm deep, the lines {} mm and {}, rims {} mm",
            if l.lines.is_empty() { l.openings.len() } else { l.lines.len() / 2 },
            fmt_mm(depth),
            fmt_mm(spec.wall),
            if raised { "raised" } else { "recessed" },
            fmt_mm(spec.rim())
        ),
    };
    if problems.is_empty() { (true, lead) } else { (false, format!("{lead}; but {}", problems.join("; "))) }
}

/// The reply's `pattern` record.
pub(super) fn json(l: &Layout) -> Value {
    json!({
        "motif": l.spec.motif.name(),
        "finish": match l.spec.finish { Finish::Pierced => "pierced", Finish::Relief { .. } => "relief" },
        "openings": l.openings.len(),
        "closed": l.closed,
        "openFraction": (l.open_fraction() * 1000.0).round() / 1000.0,
        "leastOpening": if l.least_opening.is_finite() { json!((l.least_opening * 1000.0).round() / 1000.0) } else { Value::Null },
        "rib": l.spec.wall,
        "rim": l.spec.rim(),
        "removedMm3": (l.removed() * 1000.0).round() / 1000.0,
        "developed": { "length": (l.length * 1000.0).round() / 1000.0, "width": l.width },
    })
}

/// The pattern on a piece, when it has one that can be laid.
pub(super) fn layout(p: &PieceParams) -> Option<Layout> {
    if p.pattern.is_none() || p.kind != PieceKind::Band || p.pave.is_some() || p.custom.is_some() {
        return None;
    }
    Layout::of(p).ok()
}

/// The metal the pattern takes from `p`'s band, mm³ (nothing without one).
pub(super) fn removed(p: &PieceParams) -> f64 {
    layout(p).map_or(0.0, |l| l.removed())
}

/// Why an engraving cannot go on a patterned band (`inside`: the engraving is inside the band).
pub(super) fn engraving_conflict(p: &PieceParams, inside: bool) -> Option<&'static str> {
    let spec = p.pattern.as_ref()?;
    match (spec.finish, inside) {
        (Finish::Pierced, _) => {
            Some("a pierced band has no whole surface to engrave: engrave a band without piercing, or give the pattern a depth to make it relief")
        }
        (Finish::Relief { .. }, false) => Some("the band's outside carries the pattern's relief: engrave it inside"),
        (Finish::Relief { .. }, true) => None,
    }
}
