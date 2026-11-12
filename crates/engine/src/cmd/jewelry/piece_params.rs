//! What a parametric piece is made from: the handful of numbers a jeweler changes, read from JSON
//! with every one checked. `PIECE` draws the sheet from them and `PIECEMESH` the solid, so both
//! are the same piece; neither reads a parameter any other way.
//!
//! All lengths are millimetres. A parameter that is absent takes the trade's usual value; one
//! that is present and wrong is refused, never clamped.

use serde_json::{Value, json};

use super::sizes::{self, RingSize};
use super::*;

/// The kinds of piece the engine can build from parameters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PieceKind {
    /// A plain band.
    Band,
    /// A band with one centre stone in a prong head, and optionally a halo of melee around it.
    Solitaire,
    /// A band with stones of one size all the way around.
    Eternity,
}

impl PieceKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            PieceKind::Band => "band",
            PieceKind::Solitaire => "solitaire",
            PieceKind::Eternity => "eternity",
        }
    }
    fn parse(cmd: &str, s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "band" => Ok(PieceKind::Band),
            "solitaire" => Ok(PieceKind::Solitaire),
            "eternity" => Ok(PieceKind::Eternity),
            _ => Err(bad(cmd, "`kind` must be band, solitaire or eternity")),
        }
    }
}

/// The band's outside shape across its width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Profile {
    /// A rectangle: flat outside.
    Flat,
    /// Domed outside (a half-round), flat inside.
    Dome,
}

impl Profile {
    pub(super) fn name(self) -> &'static str {
        match self {
            Profile::Flat => "flat",
            Profile::Dome => "dome",
        }
    }
}

/// A piece's parameters, complete and checked.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PieceParams {
    pub kind: PieceKind,
    /// The finger: its size in every system and its inside diameter.
    pub size: RingSize,
    /// The system the size was given in (`us`, `uk`, `eu`, `jp`, `cn`), kept so a panel shows it back.
    pub system: String,
    /// The band's radial thickness.
    pub wall: f64,
    /// The band's width along the finger.
    pub width: f64,
    pub profile: Profile,
    /// The alloy's name (`gold18`) and its density in g/cm³.
    pub metal: String,
    pub density: f64,
    /// Solitaire: the centre stone's cut name and its size. Eternity: the cut of every stone.
    pub cut: String,
    /// Solitaire: the centre stone's length (along the finger) and width; a round has both equal.
    pub stone_length: f64,
    pub stone_width: f64,
    /// The stone material's name (`diamond`), as `GEM` takes it.
    pub stone: String,
    /// Solitaire: how many prongs hold the centre stone (3–8).
    pub prongs: u32,
    /// Solitaire: the width of the halo's melee, or `None` for no halo.
    pub halo: Option<f64>,
    /// Eternity: the stones' diameter.
    pub melee: f64,
    /// Eternity: how many stones go around, or `None` for as many as fit at `gap`.
    pub count: Option<u32>,
    /// Eternity and halo: the least metal between two stones.
    pub gap: f64,
}

/// The most stones an eternity band may be asked for.
pub(super) const MAX_PIECE_STONES: u32 = 400;
/// The thinnest wall a bench casts without it failing (a check, not a refusal).
pub(super) const MIN_CAST_WALL: f64 = 0.8;

fn mm_in(cmd: &str, p: &Value, key: &str, default: f64, min: f64, max: f64) -> Result<f64> {
    match p.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= min && *x <= max) {
            Some(x) => Ok(x),
            None => Err(bad(cmd, format!("`{key}` must be a number of millimetres from {min} to {max}"))),
        },
    }
}

impl PieceParams {
    /// Read a piece from a command's JSON. `kind` is required; everything else has a default.
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Self> {
        let kind = PieceKind::parse(cmd, str_param(p, "kind").ok_or_else(|| bad(cmd, "give `kind`: band, solitaire or eternity"))?)?;
        let system = str_param(p, "system").unwrap_or("us").trim().to_ascii_lowercase();
        let size = match sizes::size_param(cmd, p)? {
            Some(size) => size,
            None => RingSize::from_us(6.0).ok_or_else(|| bad(cmd, "no ring size"))?,
        };
        let (metal, density) = sizes::metal_density(cmd, p)?;
        let profile = match str_param(p, "profile").map(|s| s.trim().to_ascii_lowercase()) {
            None => Profile::Flat,
            Some(s) if s == "flat" => Profile::Flat,
            Some(s) if s == "dome" => Profile::Dome,
            Some(_) => return Err(bad(cmd, "`profile` must be flat or dome")),
        };
        let cut = str_param(p, "cut").unwrap_or("round").trim().to_ascii_lowercase();
        if gem::cut_of(&cut).is_none() {
            return Err(bad(cmd, format!("`{}` is not a cut (GEMLIST lists them)", cut.chars().take(24).collect::<String>())));
        }
        let stone = str_param(p, "stone").unwrap_or("diamond").trim().to_ascii_lowercase();
        if gem::sg_of(&stone).is_none() {
            return Err(bad(cmd, format!("`{}` is not a stone (GEMLIST lists them)", stone.chars().take(24).collect::<String>())));
        }
        let stone_width = mm_in(cmd, p, "stoneWidth", 6.5, 0.5, 30.0)?;
        let stone_length = mm_in(cmd, p, "stoneLength", stone_width, 0.5, 30.0)?;
        let prongs = match p.get("prongs").filter(|v| !v.is_null()) {
            None => 6,
            Some(v) => match v.as_u64().filter(|n| (3..=8).contains(n)) {
                Some(n) => n as u32,
                None => return Err(bad(cmd, "`prongs` must be a whole number from 3 to 8")),
            },
        };
        let halo = match p.get("halo").filter(|v| !v.is_null()) {
            None | Some(Value::Bool(false)) => None,
            Some(Value::Bool(true)) => Some(1.3),
            Some(v) => match v.as_f64().filter(|x| x.is_finite() && (0.8..=3.0).contains(x)) {
                Some(x) => Some(x),
                None => return Err(bad(cmd, "`halo` must be true, false or a melee width from 0.8 to 3 millimetres")),
            },
        };
        let count = match p.get("count").filter(|v| !v.is_null()) {
            None => None,
            Some(v) => match v.as_u64().filter(|n| (1..=u64::from(MAX_PIECE_STONES)).contains(n)) {
                Some(n) => Some(n as u32),
                None => return Err(bad(cmd, format!("`count` must be a whole number from 1 to {MAX_PIECE_STONES}"))),
            },
        };
        Ok(PieceParams {
            kind,
            size,
            system,
            wall: mm_in(cmd, p, "wall", 1.8, 0.3, 10.0)?,
            width: mm_in(cmd, p, "width", 2.2, 0.5, 30.0)?,
            profile,
            metal,
            density,
            cut,
            stone_length,
            stone_width,
            stone,
            prongs,
            halo,
            melee: mm_in(cmd, p, "melee", 1.8, 0.8, 6.0)?,
            count,
            gap: mm_in(cmd, p, "gap", 0.2, 0.0, 5.0)?,
        })
    }

    /// The finger's inside diameter.
    pub(super) fn inner(&self) -> f64 {
        self.size.diameter
    }

    /// The band's outside diameter.
    pub(super) fn outer(&self) -> f64 {
        self.size.diameter + 2.0 * self.wall
    }

    /// The parameters as JSON, complete: `parse` reads this back to the same piece, so it is what
    /// a panel shows and what is stored with the drawing.
    pub(super) fn json(&self) -> Value {
        json!({
            "kind": self.kind.name(),
            "system": "us",
            "size": self.size.us,
            "sizeText": self.size.us_text(),
            "sizeSystem": self.system,
            "wall": self.wall,
            "width": self.width,
            "profile": self.profile.name(),
            "metal": self.metal,
            "cut": self.cut,
            "stoneLength": self.stone_length,
            "stoneWidth": self.stone_width,
            "stone": self.stone,
            "prongs": self.prongs,
            "halo": self.halo.map(Value::from).unwrap_or(Value::Bool(false)),
            "melee": self.melee,
            "count": self.count,
            "gap": self.gap,
        })
    }
}
