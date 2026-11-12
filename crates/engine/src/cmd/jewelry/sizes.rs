//! Ring sizes: the trade's systems in one place, and the ring blank that follows from a size.
//!
//! A finger size is a circumference; every system names it differently. US and Canada number it
//! (half sizes between), the UK and Australia letter it, ISO/Europe is the inside circumference
//! in whole millimetres, Japan steps a third of a millimetre, and China numbers circumference
//! minus forty. `RINGSIZE` converts between them and measures a ring the user has; `RING` draws
//! the blank a size and a wall make.

use cadcraft_doc::{Block, Entity, EntityKind, Handle};
use cadcraft_geom::Vec2;
use serde_json::{Value, json};

use super::super::*;
use super::*;
use crate::{Accept, Input, Interactive, Prompt, Step};

/// The US size formula: inside diameter = 0.8128 × size + 11.63 mm (the published linear fit).
const US_STEP: f64 = 0.8128;
const US_BASE: f64 = 11.63;
/// UK/Australia letters: A is US 0½ and each letter is half a US size, which reproduces the
/// published chart exactly (A 12.04, L 16.51, Z 22.20 mm inside diameter); half sizes fall between.
fn uk_diameter(index: f64, half: bool) -> f64 {
    US_BASE + US_STEP * (index + if half { 1.5 } else { 1.0 }) / 2.0
}

/// The UK letter index (A = 0) for an inside diameter, fractional between letters.
fn uk_index_of(diameter: f64) -> f64 {
    (diameter - US_BASE) * 2.0 / US_STEP - 1.0
}
/// Japanese sizes: 1 is 13 mm and each step is a third of a millimetre.
const JP_BASE: f64 = 13.0;
/// Chinese sizes number the inside circumference minus forty.
const CN_OFFSET: f64 = 40.0;
/// The trade's ring diameters: 000 (11.6 mm) to 16 (24.6 mm), with a little room past it.
const MIN_DIA: f64 = 11.6;
const MAX_DIA: f64 = 25.0;

/// One finger size in every system.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RingSize {
    /// Inside diameter (mm).
    pub diameter: f64,
    /// Inside circumference (mm).
    pub circumference: f64,
    /// US/Canada size (half sizes allowed).
    pub us: f64,
    /// UK/Australia letter (A…Z, with halves).
    pub uk_index: f64,
    /// ISO 8653 / European size: the circumference in whole millimetres.
    pub eu: u32,
    /// Japanese (JIS) size.
    pub jp: u32,
    /// Chinese size.
    pub cn: u32,
}

impl RingSize {
    /// The size for an inside diameter in millimetres.
    pub fn from_diameter(diameter: f64) -> Option<RingSize> {
        if !diameter.is_finite() || !(MIN_DIA..=MAX_DIA).contains(&diameter) {
            return None;
        }
        let circumference = diameter * cadcraft_geom::PI;
        Some(RingSize {
            diameter,
            circumference,
            us: (diameter - US_BASE) / US_STEP,
            // The chart's granularity is a half letter; snapping here keeps floating-point noise
            // from naming US 6 as K½.
            uk_index: ((uk_index_of(diameter) * 2.0).round() / 2.0).clamp(0.0, 25.0),
            eu: circumference.round().clamp(0.0, 999.0) as u32,
            jp: ((diameter - JP_BASE) * 3.0 + 1.0).round().clamp(0.0, 999.0) as u32,
            cn: (circumference - CN_OFFSET).round().clamp(0.0, 999.0) as u32,
        })
    }

    /// The size for a US/Canada size (halves allowed: 6, 6.5, 7…).
    pub fn from_us(us: f64) -> Option<RingSize> {
        if !us.is_finite() {
            return None;
        }
        RingSize::from_diameter(US_STEP * us + US_BASE)
    }

    /// The size for a UK/Australia letter (`M`, `M½`, `M1/2`, `m`).
    pub fn from_uk(letter: &str) -> Option<RingSize> {
        let (index, half) = parse_uk(letter)?;
        RingSize::from_diameter(uk_diameter(index, half))
    }

    /// The size for an ISO/European size (the circumference in millimetres).
    pub fn from_eu(eu: f64) -> Option<RingSize> {
        if !eu.is_finite() || eu <= 0.0 {
            return None;
        }
        RingSize::from_diameter(eu / cadcraft_geom::PI)
    }

    /// The size for a Japanese size.
    pub fn from_jp(jp: f64) -> Option<RingSize> {
        if !jp.is_finite() {
            return None;
        }
        RingSize::from_diameter(JP_BASE + (jp - 1.0) / 3.0)
    }

    /// The size for a Chinese size.
    pub fn from_cn(cn: f64) -> Option<RingSize> {
        if !cn.is_finite() {
            return None;
        }
        RingSize::from_diameter((cn + CN_OFFSET) / cadcraft_geom::PI)
    }

    /// The UK letter, with ½ when the size falls between letters.
    pub fn uk(&self) -> String {
        let letter = char::from(b'A' + (self.uk_index.floor() as u8).min(25));
        let half = self.uk_index - self.uk_index.floor() >= 0.5;
        format!("{letter}{}", if half { "½" } else { "" })
    }

    /// The US size as a bench writes it: `6`, `6½`, `7¼`.
    pub fn us_text(&self) -> String {
        // Sizes come in eighths; snapping keeps float noise from naming US 6 as 5¾.
        let us = (self.us * 8.0).round() / 8.0;
        let whole = us.floor();
        let frac = us - whole;
        let part = if frac < 0.125 {
            ""
        } else if (frac - 0.25).abs() < 0.125 {
            "¼"
        } else if (frac - 0.5).abs() < 0.125 {
            "½"
        } else {
            "¾"
        };
        format!("{:.0}{part}", whole)
    }

    /// The whole row, as JSON.
    pub fn json(&self) -> Value {
        json!({
            "mm": size_json(self.diameter),
            "diameter": size_json(self.diameter),
            "circumference": size_json(self.circumference),
            "us": size_json(self.us),
            "usText": self.us_text(),
            "uk": self.uk(),
            "eu": self.eu,
            "jp": self.jp,
            "cn": self.cn,
        })
    }

    /// One line naming the size in every system.
    pub fn line(&self) -> String {
        format!("{} mm inside (US {}, UK {}, EU {}, JP {}, CN {})", size_json(self.diameter), self.us_text(), self.uk(), self.eu, self.jp, self.cn)
    }
}

/// `M`, `M½`, `M1/2`, `m½` → (index from A, is half).
fn parse_uk(text: &str) -> Option<(f64, bool)> {
    let t = text.trim().to_ascii_uppercase();
    let mut chars = t.chars();
    let letter = chars.next()?;
    if !letter.is_ascii_uppercase() {
        return None;
    }
    let index = f64::from(letter as u8 - b'A');
    let rest: String = chars.collect();
    let rest = rest.trim();
    match rest {
        "" => Some((index, false)),
        "½" | "1/2" | ".5" => Some((index, true)),
        _ => None,
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("ringsizes", "Ring Sizes", run_table)
            .alias(&["ringsize"])
            .params("{system?: us|uk|eu|jp|cn (default us), size?: number|string (in that system), handle?|handles?: a drawn finger hole to measure (a circle, an arc, a closed polyline or ellipse, or a RING insert; of several concentric ones the smallest is the finger), from?, to?: a range, step?: (default 1), limit? (default 60)} → {system, count, sizes: [{mm, diameter, circumference, us, usText, uk, eu, jp, cn}], measured?: {handle, from: circle|arc|ellipse|polyline|ring, diameter, circumference, nearest: {system, size, …the size's row}, offBy: mm over (+) or under (−) the nearest size, nearestIn: {us|uk|eu|jp|cn: {size, mm, offBy}}, wall?, outOfRound?}, message}: every system for each size; with no `size` the system's usual range is listed; with `handle` the object's inside diameter is measured in millimetres (a polyline's or an ellipse's is its perimeter ÷ π) and refused outside 11.6–25 mm")
            .noundo(),
        CommandSpec::new("ring", "Ring", run_ring)
            .menu(&["Draw", "Ring"])
            .params("{at: [x,y], system?: us|uk|eu|jp|cn (default us), size?, diameter?: mm, wall?: mm (default 1.8, the band's radial thickness), width?: mm (default 2.0, along the finger), gap?: mm (default 0.02 sizing allowance), metal?: gold24|22|18|14|10|9|platinum|palladium|silver|steel|titanium|wax (default gold18), layer?, view?: bool (default true; draws the side view when `width` is given)} → {handle, block, size, innerDiameter, outerDiameter, wall, width, weight: {metal, density, volumeMm3, grams}}")
            .interactive(|_| Ok(Box::new(RingM::default()))),
    ]
}

fn run_table(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "ringsizes";
    let system = system_param(p);
    let has = |key: &str| p.get(key).is_some_and(|v| !v.is_null());
    if has("handle") || has("handles") {
        if has("size") {
            return Err(bad(cmd, "give `size` to convert or `handle` to measure, not both"));
        }
        return run_measure(s, p, &system);
    }
    let rows: Vec<RingSize> = if let Some(size) = p.get("size").filter(|v| !v.is_null()) {
        vec![one(cmd, &system, size)?]
    } else {
        let step = match p.get("step") {
            None | Some(Value::Null) => 1.0,
            Some(v) => v.as_f64().filter(|x| x.is_finite() && *x > 0.0).ok_or_else(|| bad(cmd, "`step` must be a positive number"))?,
        };
        let limit = match p.get("limit") {
            None | Some(Value::Null) => 60usize,
            Some(v) => v.as_u64().map(|n| usize::try_from(n).unwrap_or(usize::MAX)).ok_or_else(|| bad(cmd, "`limit` must be a whole number"))?,
        };
        let (from, to) = match (p.get("from").and_then(Value::as_f64), p.get("to").and_then(Value::as_f64)) {
            (Some(a), Some(b)) => (a, b),
            _ => default_range(&system),
        };
        if to < from {
            return Err(bad(cmd, "`to` must not be smaller than `from`"));
        }
        let mut v = Vec::new();
        let mut x = from;
        while x <= to + 1e-9 && v.len() < limit {
            if let Some(r) = by_size(&system, x) {
                v.push(r);
            }
            x += step;
        }
        v
    };
    if rows.is_empty() {
        return Err(bad(cmd, "no ring size in that range"));
    }
    let _ = s;
    Ok(json!({
        "system": system,
        "count": rows.len(),
        "sizes": rows.iter().map(|r| r.json()).collect::<Vec<_>>(),
        "message": rows.iter().map(|r| r.line()).collect::<Vec<_>>().join("\n"),
    }))
}

// ---------------------------------------------------------------------------------------------
// Measuring a drawn ring
// ---------------------------------------------------------------------------------------------

/// Most objects one measurement reads.
const MAX_MEASURED: usize = 16;
/// How far apart two centres may be and still be the same ring (mm).
const CONCENTRIC: f64 = 0.05;

/// A finger hole read off a drawn object, in millimetres.
struct Hole {
    handle: Handle,
    /// What the object is: `circle`, `arc`, `ellipse`, `polyline` or `ring`.
    from: &'static str,
    /// The inside diameter: a circle's own, or the perimeter over π (a finger size is a
    /// circumference).
    diameter: f64,
    centre: Vec2,
    /// The widest less the narrowest diameter through the centre, when the hole is not a circle.
    out_of_round: f64,
    /// The outside diameter, when the object carries one (a RING insert).
    outer: Option<f64>,
}

/// Read one object as a finger hole. `k` is the millimetres one drawing unit measures.
fn hole_of(d: &cadcraft_doc::Drawing, h: Handle, k: f64) -> std::result::Result<Hole, String> {
    let e = d.entity(h).ok_or_else(|| format!("no object {}", h.hex()))?;
    let not_closed = || format!("{} is not closed: a finger hole is a closed outline", h.hex());
    let hole = match &e.kind {
        EntityKind::Circle(c) => {
            Hole { handle: h, from: "circle", diameter: 2.0 * c.radius * k, centre: c.center.xy() * k, out_of_round: 0.0, outer: None }
        }
        // An arc is part of the hole's circle (a ring drawn as two arcs, or a sector of it).
        EntityKind::Arc(a) => {
            Hole { handle: h, from: "arc", diameter: 2.0 * a.radius * k, centre: a.center.xy() * k, out_of_round: 0.0, outer: None }
        }
        EntityKind::Ellipse(el) => {
            if (cadcraft_geom::ccw_sweep(el.start, el.end) - cadcraft_geom::TAU).abs() > 1e-9 {
                return Err(not_closed());
            }
            let (pts, _) = entity_loop(e, k).ok_or_else(not_closed)?;
            let centre = el.center.xy() * k;
            Hole {
                handle: h,
                from: "ellipse",
                diameter: loop_length(&pts) / cadcraft_geom::PI,
                centre,
                out_of_round: spread(&pts, centre),
                outer: None,
            }
        }
        EntityKind::LwPolyline(pl) => {
            if !pl.closed {
                return Err(not_closed());
            }
            let poly = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true };
            let (pts, _) = entity_loop(e, k).ok_or_else(not_closed)?;
            if pts.len() < 3 {
                return Err(format!("{} has no inside", h.hex()));
            }
            let centre = poly.centroid().map(|c| c * k).filter(|c| c.is_finite()).ok_or_else(|| format!("{} has no inside", h.hex()))?;
            // The perimeter with its arcs exact: a finger size is a circumference.
            Hole {
                handle: h,
                from: "polyline",
                diameter: poly.len() * k / cadcraft_geom::PI,
                centre,
                out_of_round: spread(&pts, centre),
                outer: None,
            }
        }
        EntityKind::Insert(ins) if ins.block.to_ascii_uppercase().starts_with("RING-") => {
            let blk = d.block(&ins.block).ok_or_else(|| format!("{} names a block that is not in the drawing", h.hex()))?;
            let (sx, sy) = (ins.scale.x.abs(), ins.scale.y.abs());
            if (sx - sy).abs() > 1e-9 * sx.max(sy) {
                return Err(format!("{} is scaled unevenly: its hole is not round", h.hex()));
            }
            // The blank's circles: the smallest is the finger, the largest the outside.
            let radii = || {
                blk.entities.iter().filter_map(|b| match &b.kind {
                    EntityKind::Circle(c) if c.radius.is_finite() && c.radius > 0.0 => Some(c.radius),
                    _ => None,
                })
            };
            let inner = radii().fold(f64::INFINITY, f64::min);
            let outer = radii().fold(0.0f64, f64::max);
            if !inner.is_finite() {
                return Err(format!("{} holds no finger circle", h.hex()));
            }
            let outer = if outer > inner { Some(2.0 * outer * sx * k) } else { None };
            Hole { handle: h, from: "ring", diameter: 2.0 * inner * sx * k, centre: ins.insert.xy() * k, out_of_round: 0.0, outer }
        }
        _ => return Err(format!("{} is not a finger hole (a circle, an arc, a closed polyline or ellipse, or a RING insert)", h.hex())),
    };
    if !(hole.diameter.is_finite() && hole.diameter > 0.0 && hole.centre.is_finite() && hole.out_of_round.is_finite()) {
        return Err(format!("{} has no size to measure", h.hex()));
    }
    Ok(hole)
}

/// The length of a closed loop of sampled points.
fn loop_length(pts: &[Vec2]) -> f64 {
    pts.iter().zip(pts.iter().cycle().skip(1)).map(|(a, b)| a.dist(*b)).sum()
}

/// How far from round a sampled outline is: twice its furthest point from `centre` less twice
/// its nearest (the widest diameter less the narrowest).
fn spread(pts: &[Vec2], centre: Vec2) -> f64 {
    let far = pts.iter().map(|p| p.dist(centre)).fold(0.0f64, f64::max);
    let near = pts.iter().zip(pts.iter().cycle().skip(1)).map(|(a, b)| super::pave::segment_distance(centre, *a, *b)).fold(f64::INFINITY, f64::min);
    if near.is_finite() { 2.0 * (far - near).max(0.0) } else { 0.0 }
}

/// The standard size of `system` nearest an inside diameter: a quarter size in the US, a half
/// letter in the UK, a whole number elsewhere. `None` when no standard size is in the trade's
/// range on either side.
fn nearest_in(system: &str, diameter: f64) -> Option<RingSize> {
    let pi = cadcraft_geom::PI;
    let index = match system {
        "us" => (diameter - US_BASE) / US_STEP * 4.0,
        "uk" => uk_index_of(diameter) * 2.0,
        "eu" => diameter * pi,
        "jp" => (diameter - JP_BASE) * 3.0 + 1.0,
        "cn" => diameter * pi - CN_OFFSET,
        _ => return None,
    };
    let make = |i: f64| match system {
        "us" => RingSize::from_us(i / 4.0),
        "uk" if (0.0..=51.0).contains(&i) => RingSize::from_diameter(uk_diameter((i / 2.0).floor(), i.rem_euclid(2.0) >= 0.5)),
        "eu" => RingSize::from_eu(i),
        "jp" => RingSize::from_jp(i),
        "cn" => RingSize::from_cn(i),
        _ => None,
    };
    [index.floor(), index.ceil()].into_iter().filter_map(make).min_by(|a, b| (a.diameter - diameter).abs().total_cmp(&(b.diameter - diameter).abs()))
}

/// A size as its own system writes it: `6¼`, `L½`, `52`.
fn label(system: &str, r: &RingSize) -> String {
    match system {
        "uk" => r.uk(),
        "eu" => r.eu.to_string(),
        "jp" => r.jp.to_string(),
        "cn" => r.cn.to_string(),
        _ => r.us_text(),
    }
}

/// `RINGSIZES {handle}`: measure a drawn finger hole and name its size in every system.
fn run_measure(s: &mut Session, p: &Value, system: &str) -> Result<Value> {
    let cmd = "ringsizes";
    let hs = targets(s, p)?;
    if hs.is_empty() {
        return Err(bad(cmd, "give `handle`: the circle, arc, closed outline or RING insert to measure"));
    }
    if hs.len() > MAX_MEASURED {
        return Err(bad(cmd, format!("give at most {MAX_MEASURED} objects: one ring's outlines")));
    }
    let k = mm_per_unit(s);
    let d = s.doc()?;
    let mut holes = Vec::with_capacity(hs.len());
    for h in hs {
        holes.push(hole_of(d, h, k).map_err(|m| bad(cmd, m))?);
    }
    // Of several outlines of one ring, the smallest is the finger; the rest must share its
    // centre, or they are not one ring and there is nothing to choose between them by.
    let Some(hole) = holes.iter().min_by(|a, b| a.diameter.total_cmp(&b.diameter)) else {
        return Err(bad(cmd, "nothing to measure"));
    };
    if let Some(stray) = holes.iter().find(|o| o.centre.dist(hole.centre) > CONCENTRIC) {
        return Err(bad(
            cmd,
            format!(
                "{} and {} do not share a centre: give the finger's own outline, or the concentric outlines of one ring",
                hole.handle.hex(),
                stray.handle.hex()
            ),
        ));
    }
    let outer = holes.iter().map(|o| o.diameter).chain(hole.outer).fold(hole.diameter, f64::max);
    let wall = (outer - hole.diameter) / 2.0;
    let dia = hole.diameter;
    let size = RingSize::from_diameter(dia).ok_or_else(|| {
        bad(cmd, format!("{} measures {} mm inside, which is outside the ring sizes ({MIN_DIA}–{MAX_DIA} mm)", hole.handle.hex(), size_json(dia)))
    })?;
    let off = |r: &RingSize| size_json(dia - r.diameter);
    let nearest = nearest_in(system, dia);
    let mut each = serde_json::Map::new();
    for sys in ["us", "uk", "eu", "jp", "cn"] {
        let v = match nearest_in(sys, dia) {
            Some(r) => json!({ "size": label(sys, &r), "mm": size_json(r.diameter), "offBy": off(&r) }),
            None => Value::Null,
        };
        each.insert(sys.to_string(), v);
    }
    let nearest_json = nearest.map(|r| {
        let mut v = r.json();
        if let Some(o) = v.as_object_mut() {
            o.insert("system".into(), json!(system));
            o.insert("size".into(), json!(label(system, &r)));
        }
        v
    });
    let mut measured = json!({
        "handle": hole.handle.hex(),
        "from": hole.from,
        "diameter": size_json(dia),
        "circumference": size_json(size.circumference),
        "nearest": nearest_json,
        "offBy": nearest.as_ref().map(off),
        "nearestIn": each,
    });
    if let Some(o) = measured.as_object_mut() {
        if wall > 1e-6 {
            o.insert("wall".into(), json!(size_json(wall)));
        }
        if hole.out_of_round > 1e-6 {
            o.insert("outOfRound".into(), json!(size_json(hole.out_of_round)));
        }
    }
    let mut message = format!("Measured {} {}: {}", hole.from, hole.handle.hex(), size.line());
    if let Some(r) = &nearest {
        let by = off(r);
        let name = format!("{} {}", system.to_ascii_uppercase(), label(system, r));
        message.push_str(&if by.abs() < 0.0005 {
            format!("; exactly {name}")
        } else {
            format!("; nearest {name} ({} mm), {} mm {}", size_json(r.diameter), by.abs(), if by > 0.0 { "over" } else { "under" })
        });
    }
    if wall > 1e-6 {
        message.push_str(&format!("; wall {} mm", size_json(wall)));
    }
    if hole.out_of_round > 0.1 {
        message.push_str(&format!("; out of round by {} mm, sized by its perimeter", size_json(hole.out_of_round)));
    }
    Ok(json!({
        "system": system,
        "count": 1,
        "sizes": [size.json()],
        "measured": measured,
        "message": message,
    }))
}

/// The `system` parameter, checked.
fn system_param(p: &Value) -> String {
    let system = str_param(p, "system").map(|s| s.trim().to_ascii_lowercase()).unwrap_or_else(|| "us".to_string());
    if matches!(system.as_str(), "us" | "uk" | "eu" | "jp" | "cn") { system } else { "us".to_string() }
}

/// One size in the given system.
fn one(cmd: &str, system: &str, size: &Value) -> Result<RingSize> {
    if let Some(text) = size.as_str() {
        let r = match system {
            "us" => text.parse::<f64>().ok().and_then(RingSize::from_us),
            "uk" => RingSize::from_uk(text),
            "eu" => text.parse::<f64>().ok().and_then(RingSize::from_eu),
            "jp" => text.parse::<f64>().ok().and_then(RingSize::from_jp),
            "cn" => text.parse::<f64>().ok().and_then(RingSize::from_cn),
            _ => return Err(bad(cmd, "`system` must be us, uk, eu, jp or cn")),
        };
        return r.ok_or_else(|| bad(cmd, format!("`{text}` is not a {} ring size", system.to_ascii_uppercase())));
    }
    let n = size.as_f64().ok_or_else(|| bad(cmd, "`size` must be a number, or a UK letter"))?;
    by_size(system, n).ok_or_else(|| bad(cmd, format!("{n} is not a {} ring size", system.to_ascii_uppercase())))
}

/// A size number in a system, or `None` outside the trade's range.
fn by_size(system: &str, n: f64) -> Option<RingSize> {
    match system {
        "us" => RingSize::from_us(n),
        "eu" => RingSize::from_eu(n),
        "jp" => RingSize::from_jp(n),
        "cn" => RingSize::from_cn(n),
        "uk" => {
            let index = n.round();
            if !(0.0..=25.0).contains(&index) {
                return None;
            }
            RingSize::from_uk(&char::from(b'A' + index as u8).to_string())
        }
        _ => None,
    }
}

/// The range `ringsizes` lists when none is given: the sizes a bench stocks.
fn default_range(system: &str) -> (f64, f64) {
    match system {
        "eu" => (41.0, 70.0),
        "jp" => (1.0, 27.0),
        "cn" => (1.0, 26.0),
        "uk" => (0.0, 25.0),
        _ => (3.0, 13.0),
    }
}

/// The ring size a JSON object names (`system` + `size`), when it names one.
pub(super) fn size_param(cmd: &str, p: &Value) -> Result<Option<RingSize>> {
    let Some(v) = p.get("size").filter(|v| !v.is_null()) else { return Ok(None) };
    let system = system_param(p);
    Ok(Some(one(cmd, &system, v)?))
}

// ---------------------------------------------------------------------------------------------
// RING
// ---------------------------------------------------------------------------------------------

/// The ring a size and a wall make, in millimetres.
struct RingGeom {
    /// Inside diameter, including the sizing allowance.
    inner: f64,
    /// Outside diameter.
    outer: f64,
    /// The band's width along the finger.
    width: f64,
}

impl RingGeom {
    /// The metal's volume in cubic millimetres: the annulus swept along the band's width.
    fn volume_mm3(&self) -> f64 {
        let (ri, ro) = (self.inner / 2.0, self.outer / 2.0);
        cadcraft_geom::PI * (ro * ro - ri * ri) * self.width
    }
    /// Grams, given a metal density in g/cm³.
    fn grams(&self, density: f64) -> f64 {
        self.volume_mm3() / 1000.0 * density
    }
}

/// A named precious metal's density in g/cm³.
pub(super) fn density_of(name: &str) -> Option<f64> {
    Some(match name.trim().to_ascii_lowercase().as_str() {
        "gold24" | "24k" => 19.32,
        "gold22" | "22k" => 17.4,
        "gold18" | "18k" => 15.5,
        "gold14" | "14k" => 13.6,
        "gold10" | "10k" => 11.6,
        "gold9" | "9k" => 11.1,
        "platinum" | "pt950" => 20.7,
        "palladium" | "pd950" => 11.8,
        "silver" | "ag925" | "sterling" => 10.4,
        "steel" => 7.9,
        "titanium" => 4.5,
        "brass" => 8.5,
        "copper" => 8.9,
        "wax" => 0.95,
        _ => return None,
    })
}

/// The `metal` parameter's name, defaulting to 18k yellow gold.
pub(super) fn metal_name(p: &Value) -> String {
    str_param(p, "metal").map(|m| m.trim().to_ascii_lowercase()).unwrap_or_else(|| "gold18".to_string())
}

/// The metal's density, refusing a name the bench does not know.
pub(super) fn metal_density(cmd: &str, p: &Value) -> Result<(String, f64)> {
    let name = metal_name(p);
    density_of(&name).map(|d| (name.clone(), d)).ok_or_else(|| {
        bad(cmd, format!("`{name}` is not a metal (gold24|22|18|14|10|9, platinum, palladium, silver, steel, titanium, brass, copper, wax)"))
    })
}

fn run_ring(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "ring";
    let at = point_req(cmd, p, "at")?;
    let system = system_param(p);
    let size = match p.get("size").filter(|v| !v.is_null()) {
        Some(v) => one(cmd, &system, v)?,
        None => match mm_or(cmd, p, "diameter")? {
            Some(d) => RingSize::from_diameter(d).ok_or_else(|| bad(cmd, format!("{d} mm is outside the ring sizes ({MIN_DIA}–{MAX_DIA} mm)")))?,
            None => return Err(bad(cmd, "give `size` (with `system`) or `diameter` in millimetres")),
        },
    };
    let wall = mm_default(cmd, p, "wall", 1.8)?;
    let width = mm_default(cmd, p, "width", 2.0)?;
    let gap = mm_zero_or(cmd, p, "gap", 0.02)?;
    let (metal, density) = metal_density(cmd, p)?;
    let layer = str_param(p, "layer").map(str::to_string);
    if let Some(name) = &layer {
        check_layer(s, cmd, name)?;
    }
    let geom = RingGeom { inner: size.diameter + 2.0 * gap, outer: size.diameter + 2.0 * gap + 2.0 * wall, width };
    // The blank, in millimetres: the finger circle and the outside circle. Blocks of jewelry
    // geometry are millimetres whatever the drawing's units, so a stone or a blank carries to
    // another drawing; the insert scales it into this one.
    let mut kinds = vec![
        EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: geom.inner / 2.0 }),
        EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: geom.outer / 2.0 }),
    ];
    // The side view below the blank: the band's width by its wall, which the bench cuts the
    // blank from. Drawn a little under the outside circle.
    let side_top = -(geom.outer / 2.0 + 6.0);
    if bool_or(p, "view", true) {
        kinds.push(EntityKind::LwPolyline(cadcraft_doc::LwPolyline {
            vertices: vec![
                cadcraft_geom::PolyVertex::new(Vec2::new(-width / 2.0, side_top)),
                cadcraft_geom::PolyVertex::new(Vec2::new(width / 2.0, side_top)),
                cadcraft_geom::PolyVertex::new(Vec2::new(width / 2.0, side_top - wall)),
                cadcraft_geom::PolyVertex::new(Vec2::new(-width / 2.0, side_top - wall)),
            ],
            closed: true,
            const_width: 0.0,
            elevation: 0.0,
            plinegen: false,
        }));
    }
    let name = format!("RING-{}x{}", fmt_mm(size.diameter), fmt_mm(width));
    let desc = format!(
        "ring: us={} uk={} eu={} jp={} cn={}, mm={}, wall={}, width={}, metal={}, grams={:.2}",
        size.us_text(),
        size.uk(),
        size.eu,
        size.jp,
        size.cn,
        fmt_mm(size.diameter),
        fmt_mm(wall),
        fmt_mm(width),
        metal,
        geom.grams(density)
    );
    let scale = 1.0 / mm_per_unit(s);
    let h = define_block_and_insert(s, &name, kinds, &desc, at, scale)?;
    on_layer(s, h, layer.as_deref())?;
    Ok(json!({
        "handle": h.hex(),
        "block": name,
        "size": size.json(),
        "innerDiameter": size_json(geom.inner),
        "outerDiameter": size_json(geom.outer),
        "wall": size_json(wall),
        "width": size_json(width),
        "gap": size_json(gap),
        "sideView": if bool_or(p, "view", true) { json!({"at": [0.0, size_json(side_top)], "width": size_json(width), "wall": size_json(wall)}) } else { Value::Null },
        "weight": { "metal": metal, "density": density, "volumeMm3": (geom.volume_mm3() * 1000.0).round() / 1000.0, "grams": (geom.grams(density) * 1000.0).round() / 1000.0 },
        "message": format!(
            "Ring size {} — {}; band {} mm wide, {} mm wall, {metal}: about {:.2} g",
            size.us_text(),
            size.line(),
            size_json(width),
            size_json(wall),
            geom.grams(density)
        ),
    }))
}

/// Define a block of jewelry geometry (in millimetres) and insert it at `at` in drawing units,
/// scaled by `scale` (the units one millimetre measures).
pub(super) fn define_block_and_insert(s: &mut Session, name: &str, kinds: Vec<EntityKind>, desc: &str, at: Vec2, scale: f64) -> Result<Handle> {
    if !super::blocks::valid_block_name(name) {
        return Err(bad("jewelry", format!("`{name}` is not a usable block name")));
    }
    let mut b = Block::new(name);
    b.base = cadcraft_geom::Vec3::ZERO;
    b.description = desc.to_string();
    let doc = s.doc_mut()?;
    for k in kinds {
        let h = doc.new_handle();
        b.entities.push(Entity::new(h, k));
    }
    doc.blocks.insert(name.to_string(), std::sync::Arc::new(b));
    super::blocks::insert_with(s, name, at, Vec2::new(scale, scale), 0.0, None, &serde_json::Map::new())
}

/// Interactive RING: a size, then a centre point.
#[derive(Default)]
pub(super) struct RingM {
    size: Option<RingSize>,
}

impl Interactive for RingM {
    fn name(&self) -> &'static str {
        "RING"
    }
    fn prompt(&self, _s: &Session) -> Prompt {
        if self.size.is_none() {
            Prompt::new("Specify inside diameter or size", Accept::NUMBER).default("6")
        } else {
            Prompt::new("Specify centre point", Accept::POINT)
        }
    }
    fn input(&mut self, s: &mut Session, i: Input) -> Result<Step> {
        match i {
            Input::Cancel => Ok(Step::Cancel),
            Input::Enter if self.size.is_none() => {
                self.size = RingSize::from_us(6.0);
                Ok(Step::Continue)
            }
            Input::Text(t) if self.size.is_none() => {
                let text = t.trim();
                let size = match crate::cmd::machines::number(text) {
                    Some(n) => RingSize::from_us(n),
                    None => RingSize::from_uk(text),
                };
                match size {
                    Some(r) => {
                        self.size = Some(r);
                        Ok(Step::Continue)
                    }
                    None => {
                        s.echo(format!("{text} is not a ring size."));
                        Ok(Step::Continue)
                    }
                }
            }
            Input::Point(p) if self.size.is_some() => {
                let Some(size) = self.size else { return Ok(Step::Continue) };
                let r = run_ring(s, &json!({"at": [p.x, p.y], "diameter": size.diameter}))?;
                if let Some(m) = r.get("message").and_then(Value::as_str) {
                    s.echo(m.to_string());
                }
                Ok(Step::Done)
            }
            _ => Ok(Step::Continue),
        }
    }
    fn preview(&self, s: &Session, c: Vec2) -> Vec<EntityKind> {
        let Some(size) = self.size else { return Vec::new() };
        let scale = 1.0 / mm_per_unit(s);
        let m = cadcraft_geom::Mat3::translate(c).then(cadcraft_geom::Mat3::scale(scale, scale));
        let r = size.diameter / 2.0;
        // The blank as it will be drawn: the finger circle and a nominal 1.8 mm wall.
        let mut inner = EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: r });
        let mut outer = EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: r + 1.8 });
        inner.transform(&m);
        outer.transform(&m);
        vec![inner, outer]
    }
}
