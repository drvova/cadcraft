//! The hallmark: a small cartouche inside the shank with the metal's fineness (`750` for 18k gold,
//! `585` for 14k, `PT950` for platinum, `925` for silver) and optionally a maker's mark, punched
//! flat-bottomed and shallow.
//!
//! `hallmark: true | {maker?: text, height?: mm, depth?: mm}`. The cartouche is a flat stadium
//! recess [`RECESS`] deep; the characters are punched [`depth`](HallmarkSpec::depth) deeper in it.
//! It goes inside, at the bottom of the shank, or just past the end of an inside engraving.

use cadcraft_geom::{PI, Vec2};
use serde_json::{Map, Value, json};

use super::engrave::{EDGE, Feature, Font, MAX_ARC_SHARE, MIN_FEATURE, Mark, Place, lay_text, mm_opt, read_text};
use super::piece_params::PieceParams;
use super::*;

/// The most characters of a maker's mark.
pub(super) const MAX_MAKER: usize = 8;
/// The cartouche's recess, mm.
pub(super) const RECESS: f64 = 0.08;
/// How far the characters go under the recess by default, mm.
pub(super) const PUNCH: f64 = 0.1;
/// The cartouche's margin round the characters, mm.
const PAD: f64 = 0.15;
/// The gap round the band between an engraving and the hallmark, mm.
const GAP: f64 = 1.0;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct HallmarkSpec {
    pub maker: Option<String>,
    pub height: Option<f64>,
    pub depth: Option<f64>,
}

/// The fineness a metal is marked with (parts per thousand, or the platinum-group mark); `None`
/// for a metal that has no fineness mark.
pub(super) fn fineness(metal: &str) -> Option<&'static str> {
    Some(match metal.trim().to_ascii_lowercase().as_str() {
        "gold24" | "24k" => "999",
        "gold22" | "22k" => "916",
        "gold18" | "18k" => "750",
        "gold14" | "14k" => "585",
        "gold10" | "10k" => "417",
        "gold9" | "9k" => "375",
        "platinum" | "pt950" => "PT950",
        "palladium" | "pd950" => "PD950",
        "silver" | "ag925" | "sterling" => "925",
        _ => return None,
    })
}

impl HallmarkSpec {
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Option<HallmarkSpec>> {
        let o: Map<String, Value> = match p.get("hallmark") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::Bool(true)) => Map::new(),
            Some(Value::Object(o)) => o.clone(),
            Some(_) => return Err(bad(cmd, "`hallmark` must be true, false or {maker?, height?, depth?}")),
        };
        let maker = match o.get("maker").filter(|v| !v.is_null()) {
            None => None,
            Some(v) => Some(read_text(cmd, "hallmark.maker", Some(v), MAX_MAKER)?),
        };
        Ok(Some(HallmarkSpec {
            maker,
            height: mm_opt(cmd, &o, "hallmark", "height", 0.3, 3.0)?,
            depth: mm_opt(cmd, &o, "hallmark", "depth", 0.03, 0.5)?,
        }))
    }

    pub(super) fn json(&self) -> Value {
        json!({ "maker": self.maker, "height": self.height, "depth": self.depth })
    }

    /// The characters' height: half the band's width, from 0.4 to 0.8 mm.
    pub(super) fn height_on(&self, p: &PieceParams) -> f64 {
        self.height.unwrap_or((0.5 * p.width - 0.3).clamp(0.4, 0.8))
    }

    /// How far the characters are punched under the recess.
    pub(super) fn depth(&self) -> f64 {
        self.depth.unwrap_or(PUNCH)
    }

    /// What it says: the fineness, then the maker's mark.
    pub(super) fn text(&self, p: &PieceParams) -> Option<String> {
        let f = fineness(&p.metal)?;
        Some(match &self.maker {
            Some(m) => format!("{f} {m}"),
            None => f.to_string(),
        })
    }
}

/// The hallmark on a piece: its mark and checks, refused (a sentence) when the metal has no
/// fineness or there is no room for it.
pub(super) fn mark(
    p: &PieceParams,
    h: &HallmarkSpec,
    engraving: Option<&Mark>,
) -> std::result::Result<(Mark, Vec<(&'static str, bool, String)>), String> {
    let text =
        h.text(p).ok_or_else(|| format!("{} has no fineness mark to hallmark: hallmarks are for gold, platinum, palladium and silver", p.metal))?;
    let ch = h.height_on(p);
    let stroke = (0.22 * ch).max(MIN_FEATURE);
    let (strokes, width) = lay_text(&text, ch, Font::Block);
    let punch = RECESS + h.depth();
    let letters = Feature { strokes, r: stroke / 2.0, depth: punch, flat: true, outline: false };
    // The cartouche: a stadium round the characters, its centreline along the band.
    let half = (ch + stroke) / 2.0 + PAD;
    let run = (width / 2.0 + stroke / 2.0 + PAD - half).max(0.0);
    let cartouche = Feature { strokes: vec![vec![Vec2::new(-run, 0.0), Vec2::new(run, 0.0)]], r: half, depth: RECESS, flat: true, outline: true };
    let length = 2.0 * (run + half);
    let r_ref = p.inner() / 2.0;
    let round = cadcraft_geom::TAU * r_ref;
    // At the bottom, or just past the end of the engraving inside (the way it reads).
    let centre = match engraving {
        None => -PI / 2.0,
        Some(e) => {
            if e.length + GAP * 2.0 + length > MAX_ARC_SHARE * round {
                return Err(format!(
                    "there is no room inside for the hallmark: the engraving takes {} mm of the {} mm inside; shorten it",
                    fmt_mm(e.length),
                    fmt_mm(round)
                ));
            }
            e.angle(e.length / 2.0 + GAP + length / 2.0)
        }
    };
    let mark = Mark { place: Place::Inside, raised: false, centre, r_ref, length, height: 2.0 * half, features: vec![cartouche, letters] };
    let mut checks = Vec::new();
    let room = p.width - 2.0 * EDGE;
    let fits = mark.height <= room + 1e-9;
    checks.push((
        "hallmark",
        fits && punch <= p.wall / 3.0 + 1e-9,
        if !fits {
            format!(
                "The hallmark “{text}” is {} mm high but the band is {} mm wide: give it a lower `hallmark.height` or widen the band",
                fmt_mm(mark.height),
                fmt_mm(p.width)
            )
        } else if punch > p.wall / 3.0 + 1e-9 {
            format!("The hallmark is punched {} mm deep, more than a third of the {} mm wall", fmt_mm(punch), fmt_mm(p.wall))
        } else {
            format!(
                "Hallmark “{text}” inside the shank: a {}×{} mm cartouche {} mm deep, the characters {} mm high punched {} mm",
                fmt_mm(mark.length),
                fmt_mm(mark.height),
                fmt_mm(RECESS),
                fmt_mm(ch),
                fmt_mm(punch)
            )
        },
    ));
    Ok((mark, checks))
}
