//! Fine-jewelry drafting: ring sizes, calibrated stones, settings and pavé, and a bench sheet.
//!
//! The trade's numbers, in a drawing: ring sizes in every system a bench uses, gemstone outlines
//! built on each cut's real girdle (not a circle), calibrated melee placed along a path or
//! through a region with the fit checked, settings built on the stone they hold, and a tech sheet
//! that counts the stones and weighs the metal the way a bench does.
//!
//! Every command works in **millimetres** and converts to the drawing's units through `INSUNITS`
//! (a unitless drawing reads as millimetres), so a size-6 finger is the same finger in an inch
//! drawing and a metric one. Stones are inserted as one block per cut and size (`GEM-ROUND-1.3`),
//! so a drawing's stones are countable, replaceable and reusable as a library; the block's
//! description carries the cut data (`gem: cut=round, mm=1.30, depth=0.80, sg=3.52, ct=0.0086`)
//! and the bench sheet reads it back.

mod bench;
mod gem;
mod pave;
mod setting;
mod sizes;
#[cfg(test)]
#[path = "jewelry/tests.rs"]
mod tests;

use cadcraft_doc::EntityKind;

/// The jewelry reading of a set of objects, for DESCRIBE and the bench sheet.
pub(crate) use bench::{JewelryFacts, jewelry_facts};
use serde_json::Value;

use super::*;

pub fn specs() -> Vec<CommandSpec> {
    let mut v = Vec::new();
    v.extend(sizes::specs());
    v.extend(gem::specs());
    v.extend(pave::specs());
    v.extend(setting::specs());
    v.extend(bench::specs());
    v
}

/// Calibrated melee diameters in millimetres: the sizes a bench actually buys (0.8–3.0 in 0.1
/// steps). A size off this list is allowed but reported as not calibrated.
pub(super) const CALIBRATED: [f64; 23] =
    [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0];
/// Default clearance between a stone and its neighbour or the edge of its region (mm).
pub(super) const DEFAULT_CLEARANCE: f64 = 0.15;
/// Most stones one command places (a hostile boundary cannot flood the drawing).
pub(super) const MAX_STONES: usize = 5_000;
/// Points sampled on an outline for length, area and site work.
pub(super) const OUTLINE_SAMPLES: usize = 256;

/// Millimetres in one drawing unit, from `INSUNITS`. A unitless drawing (0, or an unknown code)
/// reads as millimetres, which is how a jeweler drafts.
pub(super) fn mm_per_unit(s: &Session) -> f64 {
    match s.doc().map(|d| d.header.i64("INSUNITS", 1)).unwrap_or(1) {
        1 => 25.4,  // inches
        2 => 304.8, // feet
        3 => 1_609_344.0,
        4 => 1.0,     // millimetres
        5 => 10.0,    // centimetres
        6 => 1_000.0, // metres
        7 => 1_000_000.0,
        8 => 2.54e-5,   // microinches
        9 => 0.0254,    // mils
        10 => 914.4,    // yards
        14 => 100.0,    // decimetres
        15 => 10_000.0, // decametres
        16 => 100_000.0,
        _ => 1.0,
    }
}

/// The calibrated melee size nearest `mm`, when `mm` is one (within a thousandth).
pub(super) fn calibrated(mm: f64) -> Option<f64> {
    CALIBRATED.iter().copied().find(|c| (c - mm).abs() < 1e-3)
}

/// The largest calibrated melee whose diameter plus `2 × gap` fits in `width`, if any.
pub(super) fn largest_fitting(width: f64, gap: f64) -> Option<f64> {
    CALIBRATED.iter().rev().copied().find(|c| *c + 2.0 * gap <= width + 1e-9)
}

/// A size for a JSON result, in millimetres.
pub(super) fn size_json(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Format a millimetre value for a block name: up to two decimals, trailing zeros trimmed.
pub(super) fn fmt_mm(v: f64) -> String {
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() { "0".to_string() } else { s.to_string() }
}

/// The block a stone is inserted as — the trade's library key: the cut and the size, and then
/// the material and any unusual depth when they are not the default (`GEM-ROUND-1.3`,
/// `GEM-ROUND-1.3-SAPPHIRE`, `GEM-OVAL-8x6-SG4.2-D4.1`). Two stones share a block exactly when
/// they are interchangeable, which is what makes a drawing countable.
pub(super) fn gem_block_name(cut: &str, length: f64, width: f64, material: Option<&str>, sg: Option<f64>, depth: Option<f64>) -> String {
    let cut = cut.to_ascii_uppercase();
    let size = if (length - width).abs() < 1e-6 { fmt_mm(width) } else { format!("{}x{}", fmt_mm(length), fmt_mm(width)) };
    let mut name = format!("GEM-{cut}-{size}");
    match material {
        Some(m) => {
            let m: String = m.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            if !m.is_empty() {
                name.push('-');
                name.push_str(&m.to_ascii_uppercase());
            }
        }
        None => {
            if let Some(sg) = sg {
                name.push_str(&format!("-SG{}", fmt_mm(sg)));
            }
        }
    }
    if let Some(d) = depth {
        name.push_str(&format!("-D{}", fmt_mm(d)));
    }
    name
}

/// A stone as its block name carries it: cut, size, and the material and depth when they were
/// not the default.
pub(super) struct GemName {
    pub cut: String,
    pub length: f64,
    pub width: f64,
    /// The stone's trade name (`sapphire`), when the name carries one.
    pub material: Option<String>,
    /// A specific gravity the name carries (`SG4.2`), when it does.
    pub sg: Option<f64>,
    /// A depth the name carries (`D4.1`), when it does.
    pub depth: Option<f64>,
}

/// Parse a `GEM-<CUT>-<W>[-<MATERIAL>|-SG<sg>][-D<depth>]` block name.
pub(super) fn parse_gem_block(name: &str) -> Option<GemName> {
    let rest = name.strip_prefix("GEM-")?;
    let mut parts = rest.split('-');
    let cut = parts.next()?.to_ascii_lowercase();
    let size = parts.next()?;
    let (length, width) = match size.split_once('x') {
        Some((l, w)) => (l.parse::<f64>().ok()?, w.parse::<f64>().ok()?),
        None => {
            let w = size.parse::<f64>().ok()?;
            (w, w)
        }
    };
    if !(length.is_finite() && width.is_finite() && length > 0.0 && width > 0.0) {
        return None;
    }
    let (mut material, mut sg, mut depth) = (None, None, None);
    for token in parts {
        if token.is_empty() {
            return None;
        }
        if let Some(v) = token.strip_prefix("SG") {
            let v = v.parse::<f64>().ok().filter(|x| x.is_finite() && *x > 0.0)?;
            sg = Some(v);
        } else if let Some(v) = token.strip_prefix('D') {
            let v = v.parse::<f64>().ok().filter(|x| x.is_finite() && *x > 0.0)?;
            depth = Some(v);
        } else {
            material = Some(token.to_ascii_lowercase());
        }
    }
    Some(GemName { cut, length, width, material, sg, depth })
}

/// The cut data a stone's block description carries, so a bench sheet can read a stone back
/// without re-deriving it from the drawing.
pub(super) struct GemMeta {
    pub cut: String,
    pub length: f64,
    pub width: f64,
    pub depth: f64,
    pub sg: f64,
    pub carat: f64,
}

/// The `gem: cut=round, mm=1.30, depth=0.80, sg=3.52, ct=0.0086` line written into a stone
/// block's description. Text a user adds around it is kept.
pub(super) fn gem_description(cut: &str, length: f64, width: f64, depth: f64, sg: f64, carat: f64) -> String {
    let size = if (length - width).abs() < 1e-6 { fmt_mm(width) } else { format!("{}x{}", fmt_mm(length), fmt_mm(width)) };
    format!("gem: cut={cut}, mm={size}, depth={}, sg={sg}, ct={carat:.5}", fmt_mm(depth))
}

/// Read a `gem:` line back out of a block description.
pub(super) fn parse_gem_description(desc: &str) -> Option<GemMeta> {
    let line = desc.lines().find(|l| l.trim_start().starts_with("gem:"))?.trim();
    let body = line.strip_prefix("gem:")?;
    let mut cut = String::new();
    let (mut length, mut width, mut depth, mut sg, mut carat) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for field in body.split(',') {
        let Some((key, value)) = field.split_once('=') else { continue };
        let (key, value) = (key.trim(), value.trim());
        match key {
            "cut" => cut = value.to_ascii_lowercase(),
            "mm" => match value.split_once('x') {
                Some((l, w)) => {
                    length = l.parse().ok()?;
                    width = w.parse().ok()?;
                }
                None => {
                    width = value.parse().ok()?;
                    length = width;
                }
            },
            "depth" => depth = value.parse().ok()?,
            "sg" => sg = value.parse().ok()?,
            "ct" => carat = value.parse().ok()?,
            _ => {}
        }
    }
    if cut.is_empty() || width <= 0.0 {
        return None;
    }
    if length <= 0.0 {
        length = width;
    }
    Some(GemMeta { cut, length, width, depth, sg, carat })
}

/// Ensure a layer exists before new objects are put on it.
pub(super) fn check_layer(s: &Session, cmd: &str, name: &str) -> Result<()> {
    if s.doc()?.layer(name).is_none() {
        return Err(bad(cmd, format!("no layer named `{name}`")));
    }
    Ok(())
}

/// Move a new object onto `layer` when one was given.
pub(super) fn on_layer(s: &mut Session, h: Handle, layer: Option<&str>) -> Result<()> {
    if let Some(name) = layer {
        s.doc_mut()?.modify_entity(h, |e| e.common.layer = name.to_string())?;
    }
    Ok(())
}

/// A positive millimetre parameter, or `None` when absent.
pub(super) fn mm_or(cmd: &str, p: &Value, key: &str) -> Result<Option<f64>> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x > 0.0) {
            Some(x) => Ok(Some(x)),
            None => Err(bad(cmd, format!("`{key}` must be a positive number of millimetres"))),
        },
    }
}

/// A millimetre parameter with a default.
pub(super) fn mm_default(cmd: &str, p: &Value, key: &str, default: f64) -> Result<f64> {
    Ok(mm_or(cmd, p, key)?.unwrap_or(default))
}

/// A non-negative millimetre parameter with a default (clearances and gaps may be zero).
pub(super) fn mm_zero_or(cmd: &str, p: &Value, key: &str, default: f64) -> Result<f64> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= 0.0) {
            Some(x) => Ok(x),
            None => Err(bad(cmd, format!("`{key}` must be zero or a positive number of millimetres"))),
        },
    }
}

/// An angle parameter in degrees (radians out).
pub(super) fn angle_or(cmd: &str, p: &Value, key: &str, default: f64) -> Result<f64> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(default.to_radians()),
        Some(v) => match v.as_f64().filter(|x| x.is_finite()) {
            Some(a) => Ok(a.to_radians()),
            None => Err(bad(cmd, format!("`{key}` must be an angle in degrees"))),
        },
    }
}

/// A drawing entity's outline sampled in millimetres: the points (without a repeated closing
/// point) and whether it closes. `k` is the drawing units one millimetre measures.
pub(super) fn entity_loop(e: &cadcraft_doc::Entity, k: f64) -> Option<(Vec<Vec2>, bool)> {
    match &e.kind {
        EntityKind::LwPolyline(pl) => {
            let poly = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: pl.closed };
            let mut pts: Vec<Vec2> = poly.tessellate(0.02).into_iter().map(|q| q * k).collect();
            trim_close(&mut pts);
            Some((pts, pl.closed))
        }
        EntityKind::Circle(c) => {
            let mut pts = Vec::with_capacity(OUTLINE_SAMPLES);
            for i in 0..OUTLINE_SAMPLES {
                let a = cadcraft_geom::TAU * (i as f64) / (OUTLINE_SAMPLES as f64);
                pts.push(c.center.xy() * k + Vec2::new(a.cos(), a.sin()) * (c.radius * k));
            }
            Some((pts, true))
        }
        EntityKind::Ellipse(el) => {
            // Sampled at the parameter, like a circle: the sample is the girdle itself, so an
            // area taken from it is the stone's area and not the tessellation's.
            let ellipse = cadcraft_geom::Ellipse::full(el.center.xy() * k, el.major.xy() * k, el.ratio);
            let mut pts = Vec::with_capacity(OUTLINE_SAMPLES);
            for i in 0..OUTLINE_SAMPLES {
                pts.push(ellipse.at_param(cadcraft_geom::TAU * (i as f64) / (OUTLINE_SAMPLES as f64)));
            }
            trim_close(&mut pts);
            Some((pts, true))
        }
        EntityKind::Arc(a) => {
            let arc = cadcraft_geom::Arc::new(a.center.xy() * k, a.radius * k, a.start, a.end);
            let steps = ((arc.sweep().abs() / (cadcraft_geom::TAU / 64.0)).ceil() as usize).max(2);
            Some(((0..=steps).map(|i| arc.at(i as f64 / steps as f64)).collect(), false))
        }
        EntityKind::Line(l) => Some((vec![l.a.xy() * k, l.b.xy() * k], false)),
        _ => None,
    }
}

/// Drop a repeated closing point from a sampled loop.
fn trim_close(pts: &mut Vec<Vec2>) {
    if pts.len() > 1
        && let (Some(first), Some(last)) = (pts.first(), pts.last())
        && first.near(*last, 1e-9)
    {
        pts.pop();
    }
}
