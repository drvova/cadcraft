//! What a parametric piece is made from: the handful of numbers a jeweler changes, read from JSON
//! with every one checked. `PIECE` draws the sheet from them and `PIECEMESH` the solid, so both
//! are the same piece; neither reads a parameter any other way.
//!
//! All lengths are millimetres. A parameter that is absent takes the trade's usual value; one
//! that is present and wrong is refused, never clamped.
//!
//! # One piece, decided once
//!
//! Every decision the sheet and the solid share is made here, so the two cannot drift apart:
//!
//! - **The band's section** ([`Section`]): `width` across by `wall` high, measured from the finger
//!   at the middle of the width (where the finger's size is taken) to the highest point of the
//!   outside. Its outline, its outside and inside heights, its exact area and the height of its
//!   centroid are here; the sheet draws the outline, the solid revolves it, and the **band's
//!   weight** is the area swept around the finger at the centroid (Pappus) at the alloy's density
//!   ([`PieceParams::band_grams`]) — for a flat band exactly the annulus `RING` weighs. With
//!   `w` the width, `a = w/2`, `t` the wall, and a circular segment of half-chord `h` and sagitta
//!   `s` written `seg(h, s)` (radius `R = (h² + s²)/2s`, half-angle `φ = atan2(h, R − s)`, area
//!   `R²(2φ − sin 2φ)/2`, centroid `4R·sin³φ / (3(2φ − sin 2φ)) − (R − s)` beyond its chord), the
//!   profiles are, each with its area `A` and first moment `M` about the finger (centroid `M/A`):
//!   - `flat`: the rectangle. `A = w·t`, `M = w·t²/2`.
//!   - `dome`: a half-round (a D-section): a circular arc over the full width whose rise is
//!     `r = min(t, a)`, on straight sides of `e = t − r`. `A = w·e + seg(a, r)`,
//!     `M = w·e²/2 + seg(a, r)·(e + its centroid)`.
//!   - `comfort`: comfort fit. The finger side is eased: a circular arc that touches the finger in
//!     the middle and stands `c` (`comfort`, default the lesser of a sixth of the wall and `a`;
//!     0.05 mm to the lesser of 40 % of the wall and `a`) off it at the edges. The outside is the dome, kept `c` clear of the inside at the
//!     edges: `r = min(a, t − 2c)`, `e = t − r`. `A = seg(a, c) + w·(e − c) + seg(a, r)`,
//!     `M = seg(a, c)·(c − its centroid) + w·(e² − c²)/2 + seg(a, r)·(e + its centroid)`.
//!   - `court`: the classic wedding band, a lens: the same eased inside, and an outside arc that
//!     comes down to the inside's edges: `r = min(a, t − c)` (straight sides only when the wall
//!     is more than `a + c`). The formulas are `comfort`'s with this `r`.
//!   - `knife`: two flat faces meeting at a ridge along the middle of the outside: a triangle
//!     `p` high (`ridge`, default 60 % of the wall, 0.05 mm to 90 % of the wall) on a rectangle.
//!     `A = w·(t − p) + a·p`, `M = w·(t − p)²/2 + a·p·(t − p + p/3)`.
//!   - `bevel`: flat with both outside edges chamfered at 45°, `b` each way (`bevel`, default the
//!     lesser of a fifth of the width and half the wall; 0.05 mm to the lesser of 40 % of the
//!     width and 80 % of the wall, so the flat keeps a fifth of the width).
//!     `A = w·t − b²`, `M = w·t²/2 − b²·(t − b/3)`.
//!   - `concave`: flat inside, the outside hollowed between two raised edges each 15 % of the
//!     width: a circular arc of half-chord `h = 0.35·w` sunk `d` in the middle (`hollow`, default
//!     the lesser of a quarter of the wall and `h`; 0.05 mm to the lesser of 60 % of the wall and
//!     `h`). `A = w·t − seg(h, d)`, `M = w·t²/2 − seg(h, d)·(t − its centroid)`.
//!
//!   The **thinnest wall** ([`Section::thinnest`]) is what the `wall` check reads: the wall itself
//!   for flat, dome, comfort and court (a rounded outside that falls to the edge is the profile,
//!   not a thin wall), `t − p` at a knife band's edges, `t − b` at a bevelled band's edges and
//!   `t − d` in the middle of a concave one. A stone stands on the band at the outside's height in
//!   the middle of the width ([`PieceParams::crown`]): the wall, less the hollow on a concave band.
//! - **A stone's proportions**: its depth is the cut's usual proportion of its width (as `GEM`
//!   has it), split crown 26 %, girdle 4 %, pavilion 70 % ([`proportions`]), under a table that is
//!   the fraction of the width `GEM` draws for the cut ([`table_ratio`]: 57 % a round, 65 % the
//!   step cuts, 60 % an oval, 62 % the rest).
//! - **A solitaire's head** ([`Head`]): the stone's lowest point stands [`CULET_CLEAR`] over the
//!   band (more only when a halo's seat would otherwise foul the band); the prong wire is 15 % of
//!   the stone's lesser dimension, kept between 0.8 and 1.2 mm in diameter ([`prong_wire`]); the
//!   prongs stand on the girdle where `SETTING` puts them, evenly on a round ([`prong_sites`]),
//!   and reach [`PRONG_OVER`] wire diameters over the girdle.
//! - **A three-stone ring's side stones** ([`Sides`]): one each side of the centre stone around
//!   the band, each in a prong head of its own that stands on the band as the centre's does (its
//!   axis along its own radius, its culet [`CULET_CLEAR`] over the band, its width around the
//!   band and its length along the finger). `sideWidth` is 60 % of the centre's width unless
//!   given, `sideLength` keeps the centre's proportion, `sideCut` is the centre's cut. The angle
//!   from 12 o'clock is the least at which the two heads, seen along the finger ([`head_polygon`]:
//!   the stone's table, crown and girdle, and under the girdle the prongs running in to their
//!   feet on the band), stand apart by `gap` and half of each stone's prong wire, found by
//!   bisection between 0 and [`MAX_SIDE_ANGLE`] (60°); a side stone that does not clear the
//!   centre within that angle does not fit, and `PIECE` refuses it.
//! - **A halo** ([`halo_sites`]): round diamonds of the `halo` width on the centre stone's girdle
//!   offset outward by half the prong wire, `gap`, and half a melee; as many as keep `gap` of
//!   metal between every pair.
//! - **An eternity row** ([`Row`]): stones as long as they are wide (`melee`), in the piece's
//!   cut, tables level with the band's outside in the middle of its width, so their girdles lie
//!   on a circle of radius `crown − 0.28 × depth`; the metal between two neighbours' girdles for
//!   `n` stones is `2·√(R² + (melee/2)²)·sin(π/n − atan(melee/2R))`, and the most that fit is the
//!   largest `n` that leaves `gap`. Stone `i` of `n` is `2π·i/n` clockwise from 12 o'clock. On a
//!   profile that is not level across the stone (dome, comfort, court, knife) the row still sits
//!   on the crown, and the seat is judged by how far the outside falls from the middle of the
//!   width to the stone's edge ([`Row::fall`]): when that is more than the girdle lies under the
//!   table (`0.28 × depth`) the girdle has no metal beside it, and the `stone-seat` check fails
//!   (the piece is not refused). On a concave band the row sits in the hollow, where the outside
//!   rises beside it.
//! - **The parameters as JSON** ([`PieceParams::json`]): the size as a US number rounded to
//!   1e-9, with `sizeSystem` naming the system it was given in; [`PieceParams::parse`] reads that
//!   back to the same piece.

use cadcraft_doc::{Entity, Handle};
use cadcraft_geom::{PI, TAU, Vec2};
use serde_json::{Map, Value, json};

use std::sync::Arc;

use super::heads::{Bezel, HeadStyle};
use super::kinds::FaceShape;
use super::profile::CustomProfile;
use super::sizes::{self, RingSize};
use super::*;

/// The kinds of piece the engine can build from parameters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PieceKind {
    /// A plain band.
    Band,
    /// A band with one centre stone in a prong head, and optionally a halo of melee around it.
    Solitaire,
    /// A band with a centre stone and one side stone each side of it, each in its own head.
    ThreeStone,
    /// A band with stones of one size all the way around.
    Eternity,
    /// An eternity row across the top half only, the bottom of the shank plain ([`super::kinds::HalfRow`]).
    HalfEternity,
    /// A band much wider and thicker at the top than at the bottom ([`super::kinds::Taper`]).
    Dome,
    /// A tapered shank under a flat face ([`super::kinds::Face`]).
    Signet,
}

/// The kinds, as a refusal lists them.
pub(super) const KINDS: &str = "band, solitaire, threestone, eternity, halfeternity, dome or signet";

impl PieceKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            PieceKind::Band => "band",
            PieceKind::Solitaire => "solitaire",
            PieceKind::ThreeStone => "threestone",
            PieceKind::Eternity => "eternity",
            PieceKind::HalfEternity => "halfeternity",
            PieceKind::Dome => "dome",
            PieceKind::Signet => "signet",
        }
    }
    fn parse(cmd: &str, s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "band" => Ok(PieceKind::Band),
            "solitaire" => Ok(PieceKind::Solitaire),
            "threestone" | "three-stone" | "trilogy" => Ok(PieceKind::ThreeStone),
            "eternity" => Ok(PieceKind::Eternity),
            "halfeternity" | "half-eternity" | "half eternity" => Ok(PieceKind::HalfEternity),
            "dome" | "domed" => Ok(PieceKind::Dome),
            "signet" => Ok(PieceKind::Signet),
            _ => Err(bad(cmd, format!("`kind` must be {KINDS}"))),
        }
    }
}

/// The band's shape across its width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Profile {
    /// A rectangle: flat outside.
    Flat,
    /// Domed outside (a half-round), flat inside.
    Dome,
    /// Comfort fit: the dome outside, the inside eased.
    Comfort,
    /// Curved outside and inside: a lens.
    Court,
    /// Two flat faces meeting at a ridge.
    Knife,
    /// Flat with chamfered edges.
    Bevel,
    /// The outside hollowed between two raised edges.
    Concave,
    /// A closed curve the jeweller drew ([`super::profile`]); not in [`PROFILES`].
    Custom,
}

/// Every profile, in the order a list shows them.
pub(super) const PROFILES: [Profile; 7] =
    [Profile::Flat, Profile::Dome, Profile::Comfort, Profile::Court, Profile::Knife, Profile::Bevel, Profile::Concave];
/// The least a profile's own number may be (mm).
const MIN_SHAPE: f64 = 0.05;
/// How much of the width each raised edge of a concave band takes.
const CONCAVE_LAND: f64 = 0.15;

impl Profile {
    pub(super) fn name(self) -> &'static str {
        match self {
            Profile::Flat => "flat",
            Profile::Dome => "dome",
            Profile::Comfort => "comfort",
            Profile::Court => "court",
            Profile::Knife => "knife",
            Profile::Bevel => "bevel",
            Profile::Concave => "concave",
            Profile::Custom => "custom",
        }
    }

    /// The parameter that carries the profile's own number, when it has one.
    pub(super) fn key(self) -> Option<&'static str> {
        match self {
            Profile::Flat | Profile::Dome | Profile::Custom => None,
            Profile::Comfort | Profile::Court => Some("comfort"),
            Profile::Knife => Some("ridge"),
            Profile::Bevel => Some("bevel"),
            Profile::Concave => Some("hollow"),
        }
    }

    /// The most the profile's own number may be on a band `width` by `wall`, and that limit in
    /// words.
    pub(super) fn most(self, width: f64, wall: f64) -> (f64, &'static str) {
        match self {
            Profile::Flat | Profile::Dome | Profile::Custom => (0.0, ""),
            Profile::Comfort | Profile::Court => ((0.4 * wall).min(0.5 * width), "the lesser of 40 % of the wall and half the width"),
            Profile::Knife => (0.9 * wall, "90 % of the wall"),
            Profile::Bevel => ((0.4 * width).min(0.8 * wall), "the lesser of 40 % of the width and 80 % of the wall"),
            Profile::Concave => ((0.6 * wall).min((0.5 - CONCAVE_LAND) * width), "the lesser of 60 % of the wall and 35 % of the width"),
        }
    }

    /// The profile's own number when none is given.
    pub(super) fn usual(self, width: f64, wall: f64) -> f64 {
        match self {
            Profile::Flat | Profile::Dome | Profile::Custom => 0.0,
            Profile::Comfort | Profile::Court => (wall / 6.0).min(0.5 * width),
            Profile::Knife => 0.6 * wall,
            Profile::Bevel => (0.2 * width).min(0.5 * wall),
            Profile::Concave => (0.25 * wall).min((0.5 - CONCAVE_LAND) * width),
        }
    }
}

/// A piece's parameters, complete and checked.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PieceParams {
    pub kind: PieceKind,
    /// The finger: its size in every system and its inside diameter.
    pub size: RingSize,
    /// The system the size was given in (`us`, `uk`, `eu`, `jp`, `cn`), kept so a panel shows it
    /// back: `sizeSystem` in the JSON (whose `system` is always `us`, the system `size` is in).
    pub system: String,
    /// The band's radial thickness.
    pub wall: f64,
    /// The band's width along the finger.
    pub width: f64,
    pub profile: Profile,
    /// Custom: the drawn profile, by value (`profileCurve` in the JSON); its box gives `width`
    /// and `wall`.
    pub custom: Option<Arc<CustomProfile>>,
    /// Comfort and court: how far the eased inside stands off the finger at the band's edges, or
    /// `None` for a sixth of the wall.
    pub comfort: Option<f64>,
    /// Knife: the height of the peak, or `None` for 60 % of the wall.
    pub ridge: Option<f64>,
    /// Bevel: the chamfer's size, or `None` for the lesser of a fifth of the width and half the wall.
    pub bevel: Option<f64>,
    /// Concave: the depth of the hollow, or `None` for a quarter of the wall.
    pub hollow: Option<f64>,
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
    /// Three-stone: a side stone's width (around the band), or `None` for 60 % of the centre's.
    pub side_width: Option<f64>,
    /// Three-stone: a side stone's length (along the finger), or `None` for the centre stone's
    /// proportion of its width.
    pub side_length: Option<f64>,
    /// Three-stone: the side stones' cut, or `None` for the centre stone's.
    pub side_cut: Option<String>,
    /// Three-stone: how many prongs hold each side stone (3–8).
    pub side_prongs: u32,
    /// Eternity: the stones' diameter.
    pub melee: f64,
    /// Eternity: how many stones go around, or `None` for as many as fit at `gap`.
    pub count: Option<u32>,
    /// Eternity and halo: the least metal between two stones.
    pub gap: f64,
    /// Band, solitaire, three-stone: pavé on the band's outside ([`super::pave_band`]), or none.
    pub pave: Option<super::pave_band::PaveSpec>,
    /// A generative pattern on the band (pierced or relief), when asked for.
    pub pattern: Option<super::pattern::PatternSpec>,
    /// Solitaire and three-stone: how every stone is held (`head`: prong or bezel).
    pub head: HeadStyle,
    /// Bezel: the collar's wall, or `None` for [`super::heads::BEZEL_WALL`].
    pub bezel_wall: Option<f64>,
    /// Bezel: how far the collar stands over the top of the girdle, or `None` for the usual lip.
    pub bezel_height: Option<f64>,
    /// Dome and signet: the band's width and wall at 12 o'clock (`width` and `wall` are the bottom's).
    pub top_width: Option<f64>,
    pub top_wall: Option<f64>,
    /// Signet: the face's shape, its length along the finger and its width around it.
    pub face: FaceShape,
    pub face_length: f64,
    pub face_width: f64,
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
        let kind = PieceKind::parse(cmd, str_param(p, "kind").ok_or_else(|| bad(cmd, format!("give `kind`: {KINDS}")))?)?;
        // The system the piece is labelled in: `sizeSystem` when the JSON carries one (it is this
        // type's own JSON, whose `system` only says that `size` is a US number), else `system`.
        let system = system_name(str_param(p, "sizeSystem").or_else(|| str_param(p, "system")).unwrap_or("us"));
        let size = match sizes::size_param(cmd, p)? {
            Some(size) => size,
            None => RingSize::from_us(6.0).ok_or_else(|| bad(cmd, "no ring size"))?,
        };
        // The finger is the one its rounded US size names, so the piece and its JSON are one piece.
        let size = RingSize::from_us(round_us(size.us))
            .ok_or_else(|| bad(cmd, "that size is at the very edge of the ring sizes; give one a little inside the range"))?;
        let (metal, density) = sizes::metal_density(cmd, p)?;
        let profile = match p.get("profile").filter(|v| !v.is_null()) {
            None if kind == PieceKind::Dome => Profile::Dome,
            None => Profile::Flat,
            Some(v) => v
                .as_str()
                .map(|s| s.trim().to_ascii_lowercase())
                .and_then(|s| PROFILES.into_iter().chain([Profile::Custom]).find(|profile| profile.name() == s))
                .ok_or_else(|| {
                    bad(
                        cmd,
                        "`profile` must be flat, dome, comfort, court, knife, bevel or concave, or {curve: handle} for a closed curve of the drawing",
                    )
                })?,
        };
        // A drawn profile brings its own width and wall: its box, read-only.
        let custom = match profile {
            Profile::Custom => Some(Arc::new(CustomProfile::from_json(cmd, p.get("profileCurve"))?)),
            _ => None,
        };
        let (wall, width) = match &custom {
            Some(c) => (c.wall(), c.width()),
            None => (mm_in(cmd, p, "wall", 1.8, 0.3, 10.0)?, mm_in(cmd, p, "width", 2.2, 0.5, 30.0)?),
        };
        // A profile's own number is read whatever the profile, and held to the band only by the
        // profile that uses it, so changing the profile never trips over a number it ignores.
        let shape = |key: &str, max: f64| -> Result<Option<f64>> {
            if p.get(key).is_none_or(Value::is_null) {
                return Ok(None);
            }
            let x = mm_in(cmd, p, key, MIN_SHAPE, MIN_SHAPE, max)?;
            let (most, words) = profile.most(width, wall);
            if profile.key() == Some(key) && x > most + 1e-9 {
                return Err(bad(cmd, format!("`{key}` is at most {words}: {} mm on this band, not {} mm", fmt_mm(most), fmt_mm(x))));
            }
            Ok(Some(x))
        };
        let (comfort, ridge, bevel, hollow) = (shape("comfort", 4.0)?, shape("ridge", 9.0)?, shape("bevel", 12.0)?, shape("hollow", 6.0)?);
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
        let prong_count = |key: &str, default: u32| -> Result<u32> {
            match p.get(key).filter(|v| !v.is_null()) {
                None => Ok(default),
                Some(v) => match v.as_u64().filter(|n| (3..=8).contains(n)) {
                    Some(n) => Ok(n as u32),
                    None => Err(bad(cmd, format!("`{key}` must be a whole number from 3 to 8"))),
                },
            }
        };
        let prongs = prong_count("prongs", 6)?;
        let side_prongs = prong_count("sideProngs", 4)?;
        let side_size = |key: &str| -> Result<Option<f64>> {
            if p.get(key).is_none_or(Value::is_null) { Ok(None) } else { mm_in(cmd, p, key, 0.5, 0.5, 30.0).map(Some) }
        };
        let (side_width, side_length) = (side_size("sideWidth")?, side_size("sideLength")?);
        let side_cut = match p.get("sideCut").filter(|v| !v.is_null()) {
            None => None,
            Some(v) => {
                let name = v.as_str().map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
                if gem::cut_of(&name).is_none() {
                    return Err(bad(cmd, format!("`sideCut`: `{}` is not a cut (GEMLIST lists them)", name.chars().take(24).collect::<String>())));
                }
                Some(name)
            }
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
        let optional = |key: &str, min: f64, max: f64| -> Result<Option<f64>> {
            if p.get(key).is_none_or(Value::is_null) { Ok(None) } else { mm_in(cmd, p, key, min, min, max).map(Some) }
        };
        let (bezel_wall, bezel_height) = (optional("bezelWall", 0.2, 2.0)?, optional("bezelHeight", 0.0, 5.0)?);
        let (top_width, top_wall) = (optional("topWidth", 0.5, 30.0)?, optional("topWall", 0.3, 10.0)?);
        let head = HeadStyle::parse(cmd, p.get("head"))?;
        let face = FaceShape::parse(cmd, p.get("face"))?;
        let face_length = mm_in(cmd, p, "faceLength", 12.0, 4.0, 30.0)?;
        let face_width = mm_in(cmd, p, "faceWidth", 10.0, 4.0, 30.0)?;
        Ok(PieceParams {
            head,
            bezel_wall,
            bezel_height,
            top_width,
            top_wall,
            face,
            face_length,
            face_width,
            kind,
            size,
            system,
            wall,
            width,
            profile,
            custom,
            comfort,
            ridge,
            bevel,
            hollow,
            metal,
            density,
            cut,
            stone_length,
            stone_width,
            stone,
            prongs,
            halo,
            side_width,
            side_length,
            side_cut,
            side_prongs,
            melee: mm_in(cmd, p, "melee", 1.8, 0.8, 6.0)?,
            count,
            gap: mm_in(cmd, p, "gap", 0.2, 0.0, 5.0)?,
            pave: super::pave_band::PaveSpec::parse(cmd, p)?,
            pattern: super::pattern::PatternSpec::parse(cmd, p)?,
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
    /// a panel shows and what is stored with the drawing. The size is the US number, freed of the
    /// float noise its formula leaves (`5.999999999999997` reads `6`), and `sizeSystem` is the
    /// system the piece was given in.
    pub(super) fn json(&self) -> Value {
        json!({
            "kind": self.kind.name(),
            "system": "us",
            "size": round_us(self.size.us),
            "sizeText": self.size.us_text(),
            "sizeSystem": self.system,
            "wall": self.wall,
            "width": self.width,
            "profile": self.profile.name(),
            "profileCurve": self.custom.as_ref().map(|c| c.json()),
            "comfort": self.comfort,
            "ridge": self.ridge,
            "bevel": self.bevel,
            "hollow": self.hollow,
            "metal": self.metal,
            "cut": self.cut,
            "stoneLength": self.stone_length,
            "stoneWidth": self.stone_width,
            "stone": self.stone,
            "prongs": self.prongs,
            "halo": self.halo.map(Value::from).unwrap_or(Value::Bool(false)),
            "sideWidth": self.side_width,
            "sideLength": self.side_length,
            "sideCut": self.side_cut,
            "sideProngs": self.side_prongs,
            "melee": self.melee,
            "count": self.count,
            "gap": self.gap,
            "pave": self.pave.as_ref().map_or(Value::Bool(false), super::pave_band::PaveSpec::json),
            "pattern": self.pattern.as_ref().map_or(Value::Bool(false), super::pattern::PatternSpec::json),
            "head": self.head.name(),
            "bezelWall": self.bezel_wall,
            "bezelHeight": self.bezel_height,
            "topWidth": self.top_width,
            "topWall": self.top_wall,
            "face": self.face.name(),
            "faceLength": self.face_length,
            "faceWidth": self.face_width,
        })
    }
}

/// A ring-size system's name, or `us` for anything else.
pub(super) fn system_name(s: &str) -> String {
    let s = s.trim().to_ascii_lowercase();
    if matches!(s.as_str(), "us" | "uk" | "eu" | "jp" | "cn") { s } else { "us".to_string() }
}

/// A US size as the JSON carries it: rounded to 1e-9.
pub(super) fn round_us(us: f64) -> f64 {
    (us * 1e9).round() / 1e9
}

// ---------------------------------------------------------------------------------------------
// The band's section and its weight
// ---------------------------------------------------------------------------------------------

/// The band's cross-section: `width` across (along the finger) by `wall` high (radially), heights
/// measured from the finger at the middle of the width. The module's comment defines each profile
/// and gives its area and centroid.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Section {
    pub width: f64,
    pub wall: f64,
    pub profile: Profile,
    /// The profile's own number in millimetres (the easing, the ridge, the chamfer, the hollow);
    /// nothing for flat and dome.
    pub by: f64,
    /// A drawn profile, which every measure below defers to (a custom section without one is flat).
    pub custom: Option<Arc<CustomProfile>>,
}

/// A circular segment of half-chord `h` and sagitta `s` (no more than a half circle): its radius,
/// half the angle it spans, its area, and how far its centroid lies beyond its chord.
fn segment(h: f64, s: f64) -> Option<(f64, f64, f64, f64)> {
    if !(h.is_finite() && s.is_finite() && h > 1e-9 && s > 1e-9) {
        return None;
    }
    let r = (h * h + s * s) / (2.0 * s);
    let half = h.atan2(r - s);
    let lens = 2.0 * half - (2.0 * half).sin();
    if !(r.is_finite() && lens > 1e-300) {
        return None;
    }
    Some((r, half, r * r / 2.0 * lens, 4.0 * r * half.sin().powi(3) / (3.0 * lens) - (r - s)))
}

/// How many pieces an arc of this length is cut into when `segments` are asked for: an even
/// number from 2 to 1024, and no more than leaves each piece 4 µm long, so that no two points of
/// a section fall together.
fn pieces(segments: usize, length: f64) -> usize {
    let most = if length.is_finite() && length > 0.0 { (length / 4e-3) as usize } else { 2 };
    (segments.min(most).clamp(2, 1024) / 2) * 2
}

impl Section {
    /// A flat section.
    pub(super) fn flat(width: f64, wall: f64) -> Section {
        Section { width, wall, profile: Profile::Flat, by: 0.0, custom: None }
    }

    /// A half-round.
    pub(super) fn dome(width: f64, wall: f64) -> Section {
        Section { width, wall, profile: Profile::Dome, by: 0.0, custom: None }
    }

    fn half(&self) -> f64 {
        self.width / 2.0
    }

    /// The profile's own number, held inside what the band allows whatever it was given.
    pub(super) fn number(&self) -> f64 {
        let (most, _) = self.profile.most(self.width, self.wall);
        if self.by.is_finite() && most.is_finite() && most > 0.0 { self.by.clamp(0.0, most) } else { 0.0 }
    }

    /// How far the eased inside of a comfort or court band stands off the finger at the edges.
    pub(super) fn ease(&self) -> f64 {
        if matches!(self.profile, Profile::Comfort | Profile::Court) { self.number() } else { 0.0 }
    }

    /// How far the outside's arc rises above its chord (nothing for a profile without one).
    pub(super) fn rise(&self) -> f64 {
        let a = self.half();
        match self.profile {
            Profile::Dome => self.wall.min(a).max(0.0),
            Profile::Comfort => a.min(self.wall - 2.0 * self.ease()).max(0.0),
            Profile::Court => a.min(self.wall - self.ease()).max(0.0),
            _ => 0.0,
        }
    }

    /// The height of the outside at the band's edge under an arc (the whole wall for a profile
    /// without one): the straight sides of a dome.
    pub(super) fn side(&self) -> f64 {
        self.wall - self.rise()
    }

    /// The outside arc's radius and half the angle it spans, when there is an arc.
    fn arc(&self) -> Option<(f64, f64)> {
        segment(self.half(), self.rise()).map(|(r, half, ..)| (r, half))
    }

    /// The eased inside's radius and half the angle it spans, when the inside is eased.
    fn inner_arc(&self) -> Option<(f64, f64)> {
        segment(self.half(), self.ease()).map(|(r, half, ..)| (r, half))
    }

    /// A concave band's hollow: its half-chord, its depth, its radius and half the angle it spans.
    fn hollow(&self) -> Option<(f64, f64, f64, f64)> {
        if self.profile != Profile::Concave {
            return None;
        }
        let (h, d) = ((0.5 - CONCAVE_LAND) * self.width, self.number());
        segment(h, d).map(|(r, half, ..)| (h, d, r, half))
    }

    /// The outside's height above the finger at `x` across the width (`x = 0` is the middle of
    /// the band, `±width/2` its edges).
    pub(super) fn height_at(&self, x: f64) -> f64 {
        if let Some(c) = &self.custom {
            return c.top_at(x);
        }
        let a = self.half();
        let x = x.abs().min(a);
        match self.profile {
            Profile::Flat | Profile::Custom => self.wall,
            Profile::Dome | Profile::Comfort | Profile::Court => {
                let Some((r, _)) = self.arc() else { return self.wall };
                let rise = self.rise();
                self.side() + ((r * r - x * x).max(0.0).sqrt() - (r - rise)).clamp(0.0, rise)
            }
            Profile::Knife => self.wall - self.number() * if a > 1e-12 { (x / a).min(1.0) } else { 0.0 },
            Profile::Bevel => self.wall - (x - (a - self.number())).max(0.0),
            Profile::Concave => match self.hollow() {
                Some((h, d, r, _)) if x < h => self.wall - d + (r - (r * r - x * x).max(0.0).sqrt()).clamp(0.0, d),
                _ => self.wall,
            },
        }
    }

    /// The inside's height above the finger at `x` across the width: nothing, but for an eased
    /// inside, which stands off the finger towards the edges.
    pub(super) fn inside_at(&self, x: f64) -> f64 {
        if let Some(c) = &self.custom {
            return c.bottom_at(x);
        }
        let Some((r, _)) = self.inner_arc() else { return 0.0 };
        let x = x.abs().min(self.half());
        (r - (r * r - x * x).max(0.0).sqrt()).clamp(0.0, self.ease())
    }

    /// The least radial thickness a bench should judge the band by, and where it is when it is
    /// not simply the wall: a knife or bevelled band's edges, the middle of a concave one.
    pub(super) fn thinnest(&self) -> (f64, Option<&'static str>) {
        if let Some(c) = &self.custom {
            return (c.thinnest().0, Some("where the drawn profile has the least metal, 0.4 mm or more in from its edges"));
        }
        let n = self.number();
        let place = match self.profile {
            Profile::Knife => "at its edges, beside the ridge's two faces",
            Profile::Bevel => "at its chamfered edges",
            Profile::Concave => "in the middle of the hollow",
            _ => return (self.wall, None),
        };
        if n > 0.0 { (self.wall - n, Some(place)) } else { (self.wall, None) }
    }

    /// The section's area, exactly.
    pub(super) fn area(&self) -> f64 {
        self.area_and_moment().0
    }

    /// The height of the section's centroid above the finger, exactly.
    pub(super) fn centroid(&self) -> f64 {
        let (area, moment) = self.area_and_moment();
        if area > 0.0 { moment / area } else { self.wall / 2.0 }
    }

    /// The area, and its first moment about the finger (the line the heights are measured from).
    fn area_and_moment(&self) -> (f64, f64) {
        if let Some(c) = &self.custom {
            return (c.area(), c.area() * c.centroid());
        }
        let (a, w, t) = (self.half(), self.width, self.wall);
        // A rectangle the full width from `y0` up to `y1`.
        let rect = |y0: f64, y1: f64| (w * (y1 - y0), w * (y1 * y1 - y0 * y0) / 2.0);
        match self.profile {
            Profile::Flat | Profile::Custom => rect(0.0, t),
            Profile::Dome | Profile::Comfort | Profile::Court => {
                let (c, side) = (self.ease(), self.side());
                let mut out = rect(c, side);
                // The arc over the sides, and the easing under them.
                if let Some((_, _, area, beyond)) = segment(a, self.rise()) {
                    out.0 += area;
                    out.1 += area * (side + beyond);
                }
                if let Some((_, _, area, beyond)) = segment(a, c) {
                    out.0 += area;
                    out.1 += area * (c - beyond);
                }
                out
            }
            Profile::Knife => {
                let p = self.number();
                let (area, moment) = rect(0.0, t - p);
                (area + a * p, moment + a * p * (t - p + p / 3.0))
            }
            Profile::Bevel => {
                let b = self.number();
                let (area, moment) = rect(0.0, t);
                (area - b * b, moment - b * b * (t - b / 3.0))
            }
            Profile::Concave => {
                let mut out = rect(0.0, t);
                if let Some((h, d, ..)) = self.hollow()
                    && let Some((_, _, area, beyond)) = segment(h, d)
                {
                    out.0 -= area;
                    out.1 -= area * (t - beyond);
                }
                out
            }
        }
    }

    /// The outline as a closed polyline, counter-clockwise from the lower left corner, centred
    /// across the width with the finger at `y = 0`: each vertex with the bulge of the edge that
    /// follows it. Exact.
    pub(super) fn outline(&self) -> Vec<(Vec2, f64)> {
        if let Some(c) = &self.custom {
            return c.points().iter().map(|p| (*p, 0.0)).collect();
        }
        let (a, t) = (self.half(), self.wall);
        let straight = |pts: &[(f64, f64)]| pts.iter().map(|(x, y)| (Vec2::new(*x, *y), 0.0)).collect::<Vec<_>>();
        let rectangle = || straight(&[(-a, 0.0), (a, 0.0), (a, t), (-a, t)]);
        match self.profile {
            Profile::Flat | Profile::Custom => rectangle(),
            Profile::Dome | Profile::Comfort | Profile::Court => {
                if self.arc().is_none() {
                    return rectangle();
                }
                // A bulge is the arc's rise over half its chord.
                let c = if self.inner_arc().is_some() { self.ease() } else { 0.0 };
                let (side, inside, outside) = (self.side(), c / a, self.rise() / a);
                if side - c <= 1e-9 {
                    vec![(Vec2::new(-a, c), inside), (Vec2::new(a, c), outside)]
                } else {
                    vec![(Vec2::new(-a, c), inside), (Vec2::new(a, c), 0.0), (Vec2::new(a, side), outside), (Vec2::new(-a, side), 0.0)]
                }
            }
            Profile::Knife => {
                let e = t - self.number();
                straight(&[(-a, 0.0), (a, 0.0), (a, e), (0.0, t), (-a, e)])
            }
            Profile::Bevel => {
                let b = self.number();
                straight(&[(-a, 0.0), (a, 0.0), (a, t - b), (a - b, t), (b - a, t), (-a, t - b)])
            }
            Profile::Concave => match self.hollow() {
                None => rectangle(),
                Some((h, d, ..)) => vec![
                    (Vec2::new(-a, 0.0), 0.0),
                    (Vec2::new(a, 0.0), 0.0),
                    (Vec2::new(a, t), 0.0),
                    (Vec2::new(h, t), -d / h),
                    (Vec2::new(-h, t), 0.0),
                    (Vec2::new(-a, t), 0.0),
                ],
            },
        }
    }

    /// The outside of the section from `x = +width/2` to `x = −width/2` as points `(x, height)`
    /// that a mesh is built through, never outside the section: an arc that bulges outward is
    /// sampled evenly along itself in `segments` chords (its ends and its crown exact), a hollow
    /// is the `segments + 1` tangents to it, and straight faces are their corners.
    pub(super) fn outside(&self, segments: usize) -> Vec<Vec2> {
        let (a, t) = (self.half(), self.wall);
        match self.profile {
            Profile::Flat | Profile::Custom => vec![Vec2::new(a, t), Vec2::new(-a, t)],
            Profile::Dome | Profile::Comfort | Profile::Court => {
                let Some((r, half)) = self.arc() else { return vec![Vec2::new(a, t), Vec2::new(-a, t)] };
                let n = pieces(segments, 2.0 * r * half);
                (0..=n)
                    .map(|j| {
                        // The ends and the crown are the exact points, whatever the sine rounds to.
                        let x = if j == 0 {
                            a
                        } else if j == n {
                            -a
                        } else if 2 * j == n {
                            0.0
                        } else {
                            r * (half * (1.0 - 2.0 * j as f64 / n as f64)).sin()
                        };
                        Vec2::new(x, self.height_at(x))
                    })
                    .collect()
            }
            Profile::Knife => {
                let e = t - self.number();
                vec![Vec2::new(a, e), Vec2::new(0.0, t), Vec2::new(-a, e)]
            }
            Profile::Bevel => {
                let b = self.number();
                vec![Vec2::new(a, t - b), Vec2::new(a - b, t), Vec2::new(b - a, t), Vec2::new(-a, t - b)]
            }
            Profile::Concave => {
                let mut out = vec![Vec2::new(a, t)];
                if let Some((h, d, r, half)) = self.hollow() {
                    // Where neighbouring tangents to the hollow cross: under the arc, in the metal.
                    let n = pieces(segments, 2.0 * r * half);
                    let step = 2.0 * half / n as f64;
                    let reach = r / (step / 2.0).cos();
                    out.push(Vec2::new(h, t));
                    out.extend((0..n).map(|k| {
                        let at = half - (k as f64 + 0.5) * step;
                        Vec2::new(reach * at.sin(), t - d + r - reach * at.cos())
                    }));
                    out.push(Vec2::new(-h, t));
                }
                out.push(Vec2::new(-a, t));
                out
            }
        }
    }

    /// The inside of the section from `x = −width/2` to `x = +width/2` as points `(x, height)`:
    /// the two corners, or an eased inside sampled evenly along its arc in `segments` chords (its
    /// ends, and the point that touches the finger, exact).
    pub(super) fn inside(&self, segments: usize) -> Vec<Vec2> {
        let a = self.half();
        let Some((r, half)) = self.inner_arc() else { return vec![Vec2::new(-a, 0.0), Vec2::new(a, 0.0)] };
        let (n, c) = (pieces(segments, 2.0 * r * half), self.ease());
        (0..=n)
            .map(|j| {
                if j == 0 {
                    Vec2::new(-a, c)
                } else if j == n {
                    Vec2::new(a, c)
                } else if 2 * j == n {
                    Vec2::ZERO
                } else {
                    let x = r * (half * (2.0 * j as f64 / n as f64 - 1.0)).sin();
                    Vec2::new(x, self.inside_at(x))
                }
            })
            .collect()
    }

    /// The whole section as a closed polygon, counter-clockwise (the inside from left to right,
    /// then the outside back), inscribed in the section. Where the outside comes down to the
    /// inside (a dome with no sides to speak of, a lens) the two share the corner.
    pub(super) fn polygon(&self, segments: usize) -> Vec<Vec2> {
        if let Some(c) = &self.custom {
            return c.polygon(segments.saturating_mul(6));
        }
        let mut out: Vec<Vec2> = Vec::new();
        for p in self.inside(segments).into_iter().chain(self.outside(segments)) {
            if out.last().is_none_or(|l| l.dist(p) > 2e-3) {
                out.push(p);
            }
        }
        while out.len() > 3 && out.first().zip(out.last()).is_some_and(|(first, last)| first.dist(*last) <= 2e-3) {
            out.pop();
        }
        out
    }
}

impl PieceParams {
    /// The band's section.
    pub(super) fn section(&self) -> Section {
        let given = match self.profile {
            Profile::Flat | Profile::Dome | Profile::Custom => None,
            Profile::Comfort | Profile::Court => self.comfort,
            Profile::Knife => self.ridge,
            Profile::Bevel => self.bevel,
            Profile::Concave => self.hollow,
        };
        let by = given.filter(|x| x.is_finite()).unwrap_or_else(|| self.profile.usual(self.width, self.wall));
        let custom = if self.profile == Profile::Custom { self.custom.clone() } else { None };
        Section { width: self.width, wall: self.wall, profile: self.profile, by, custom }
    }

    /// The radius of the band's outside in the middle of its width, where a stone stands: the
    /// outside radius, less the hollow on a concave band.
    pub(super) fn crown(&self) -> f64 {
        let sunk = self.wall - self.section().height_at(0.0);
        self.outer() / 2.0 - if sunk.is_finite() { sunk.max(0.0) } else { 0.0 }
    }

    /// The band's volume in cubic millimetres: its section swept around the finger at the
    /// section's centroid. The stones' seats are not taken off and no head is added.
    pub(super) fn band_volume(&self) -> f64 {
        let section = self.section();
        match self.kind {
            PieceKind::Dome | PieceKind::Signet => self.taper_volume(),
            _ => TAU * (self.inner() / 2.0 + section.centroid()) * section.area() - super::pattern::removed(self),
        }
    }

    /// The band's weight in grams at the alloy's density: the one metal weight a piece reports.
    pub(super) fn band_grams(&self) -> f64 {
        self.band_volume() / 1000.0 * self.density
    }
}

// ---------------------------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------------------------

/// A stone's crown, girdle and pavilion as fractions of its depth.
pub(super) const CROWN: f64 = 0.26;
pub(super) const GIRDLE: f64 = 0.04;
pub(super) const PAVILION: f64 = 0.70;

/// A stone's girdle thickness, crown height and pavilion depth from its whole depth.
pub(super) fn proportions(depth: f64) -> (f64, f64, f64) {
    (GIRDLE * depth, CROWN * depth, PAVILION * depth)
}

/// How far below its table the middle of a stone's girdle lies.
pub(super) fn girdle_drop(depth: f64) -> f64 {
    depth * (CROWN + GIRDLE / 2.0)
}

/// How far above its culet the middle of a stone's girdle lies.
pub(super) fn girdle_rise(depth: f64) -> f64 {
    depth * (PAVILION + GIRDLE / 2.0)
}

/// A cut's table as a fraction of its width: the table `GEM` draws on the stone's plan.
pub(super) fn table_ratio(cut: &gem::Cut) -> f64 {
    match cut.name {
        "round" => 0.57,
        "emerald" | "baguette" | "rect" | "radiant" => 0.65,
        "oval" | "cabochon" => 0.60,
        _ => 0.62,
    }
}

/// The depth a stone of this cut and width is drawn and weighed at: the cut's usual proportion
/// of its width, as `GEM` has it.
pub(super) fn stone_depth(cut: &gem::Cut, width: f64) -> f64 {
    gem::default_depth(cut, width)
}

/// A stone as `GEM` reads one, so a piece's stones are `GEM`'s own blocks.
fn stone_of(cmd: &str, cut: &str, length: f64, width: f64, material: &str) -> Result<gem::Stone> {
    let mut p = Map::new();
    p.insert("cut".into(), json!(cut));
    p.insert("length".into(), json!(length));
    p.insert("width".into(), json!(width));
    // Diamond is the stone a bare `GEM` places, so a piece's diamonds share its blocks.
    if material != "diamond" {
        p.insert("stone".into(), json!(material));
    }
    gem::stone_params(cmd, &Value::Object(p))
}

/// A stone's weight in carats.
pub(super) fn carat_of(s: &gem::Stone) -> f64 {
    gem::carat(s.cut, s.length, s.width, s.depth, s.sg)
}

/// A cut's girdle sampled in millimetres, centred on the stone, its length along +y.
pub(super) fn girdle_outline(cut: &gem::Cut, length: f64, width: f64) -> Option<Vec<Vec2>> {
    if !(length.is_finite() && width.is_finite() && length > 0.0 && width > 0.0) {
        return None;
    }
    let e = Entity::new(Handle(0), gem::outline(cut, length, width));
    let (pts, _) = entity_loop(&e, 1.0)?;
    (pts.len() >= 3 && pts.iter().all(|p| p.is_finite())).then_some(pts)
}

// ---------------------------------------------------------------------------------------------
// A solitaire's head
// ---------------------------------------------------------------------------------------------

/// How far a solitaire's lowest point stands clear of the band (mm).
pub(super) const CULET_CLEAR: f64 = 0.5;
/// The metal a halo's seat keeps under its melee's culets (mm).
pub(super) const HALO_UNDER: f64 = 0.2;
/// How far a prong reaches over the top of the girdle, in wire diameters.
pub(super) const PRONG_OVER: f64 = 1.15;

/// The prong wire's diameter for a stone: 15 % of its lesser dimension, between 0.8 and 1.2 mm.
pub(super) fn prong_wire(length: f64, width: f64) -> f64 {
    let lesser = length.min(width);
    if lesser.is_finite() { (0.15 * lesser).clamp(0.8, 1.2) } else { 0.8 }
}

/// Where a stone's prongs stand on its girdle, in the stone's plan (its length along +y). A
/// girdle that is a circle takes them evenly, the first half a step from +x; any other cut takes
/// them where `SETTING` puts them (its corners first, then the points furthest apart).
pub(super) fn prong_sites(cut: &gem::Cut, length: f64, width: f64, prongs: u32) -> Result<Vec<Vec2>> {
    let n = prongs.clamp(2, 12);
    if cut.is_circle(length, width) {
        let step = TAU / f64::from(n);
        return Ok((0..n)
            .map(|k| {
                let a = step * (f64::from(k) + 0.5);
                Vec2::new(a.cos(), a.sin()) * (width / 2.0)
            })
            .collect());
    }
    let outline = girdle_outline(cut, length, width).ok_or_else(|| bad("setting", "the stone has no outline"))?;
    // The corners stay vertices; the straight runs between them get points a prong can stand on
    // (a trillion's fourth prong goes on a side).
    let target = setting::Target { outline: densified(&outline, 128), at: Vec2::ZERO, rotation: 0.0, scale: 1.0, cut: Some(cut.name.to_string()) };
    setting::prong_sites(&target, Some(n as usize))
}

/// A closed polygon with its long edges divided, so no two neighbours are further apart than
/// about one `steps`-th of the way around. Every original vertex is kept.
fn densified(pts: &[Vec2], steps: usize) -> Vec<Vec2> {
    let n = pts.len();
    let steps = steps.clamp(8, 1024);
    let edge = |i: usize| pts.get(i).copied().zip(pts.get((i + 1) % n.max(1)).copied());
    let total: f64 = (0..n).filter_map(edge).map(|(a, b)| a.dist(b)).sum();
    let spacing = total / steps as f64;
    if !(spacing.is_finite() && spacing > 1e-9) {
        return pts.to_vec();
    }
    let mut out = Vec::with_capacity(n + steps);
    for (a, b) in (0..n).filter_map(edge) {
        let pieces = ((a.dist(b) / spacing).ceil() as usize).clamp(1, steps);
        out.extend((0..pieces).map(|k| a + (b - a) * (k as f64 / pieces as f64)));
    }
    out
}

/// A side stone's width as a fraction of the centre stone's, when none is given.
pub(super) const SIDE_WIDTH: f64 = 0.6;
/// The furthest from 12 o'clock a three-stone ring's side stones may stand (60°).
pub(super) const MAX_SIDE_ANGLE: f64 = PI / 3.0;

/// A stone's side profile, `w` across and `depth` high, with its culet (or a cabochon's base) on
/// the origin and its table up: counter-clockwise, each vertex with the bulge of the edge that
/// follows it. A faceted stone is its table, crown, girdle and pavilion; a cabochon is a dome
/// on a flat base.
pub(super) fn side_profile(cut: &gem::Cut, w: f64, depth: f64) -> Vec<(Vec2, f64)> {
    if cut.name == "cabochon" {
        return Section::dome(w, depth).outline();
    }
    let a = w / 2.0;
    let table = a * table_ratio(cut);
    let girdle_top = depth * (1.0 - CROWN);
    let girdle_bottom = depth * (1.0 - CROWN - GIRDLE);
    [
        Vec2::new(-table, depth),
        Vec2::new(-a, girdle_top),
        Vec2::new(-a, girdle_bottom),
        Vec2::new(0.0, 0.0),
        Vec2::new(a, girdle_bottom),
        Vec2::new(a, girdle_top),
        Vec2::new(table, depth),
    ]
    .into_iter()
    .map(|p| (p, 0.0))
    .collect()
}

/// Where a prong's foot stands on the band, as a fraction of its site's distance from the
/// stone's axis: the prongs lean in under the stone.
pub(super) const PRONG_FOOT: f64 = 0.45;

/// A head seen along the finger, as a convex polygon of straight edges, counter-clockwise, with
/// the stone's culet (or a cabochon's base) on the origin: the stone's table, crown and girdle
/// (a cabochon's dome in twelve chords), and under the girdle the prongs running in to their
/// feet on the band, [`PRONG_FOOT`] of the half-width either side of the axis and `clear` under
/// the culet. It is what two heads' clearance is measured between.
pub(super) fn head_polygon(cut: &gem::Cut, w: f64, depth: f64, clear: f64) -> Vec<Vec2> {
    let a = w / 2.0;
    let feet = [Vec2::new(-PRONG_FOOT * a, -clear), Vec2::new(PRONG_FOOT * a, -clear)];
    let mut out = Vec::with_capacity(20);
    if cut.name == "cabochon" {
        out.push(Vec2::new(-a, 0.0));
        out.extend(feet);
        out.push(Vec2::new(a, 0.0));
        out.extend(Section::dome(w, depth).outside(12).into_iter().filter(|q| q.y > 1e-9));
        return out;
    }
    // The profile runs table, girdle, culet, girdle, table: the feet take the culet's place.
    for (i, (p, _)) in side_profile(cut, w, depth).into_iter().enumerate() {
        if i == 3 { out.extend(feet) } else { out.push(p) }
    }
    out
}

/// The distance from `p` to the segment `a`–`b`.
fn point_to_segment(p: Vec2, a: Vec2, b: Vec2) -> f64 {
    let (ab, len2) = (b - a, (b - a).dot(b - a));
    let t = if len2 > 1e-24 { ((p - a).dot(ab) / len2).clamp(0.0, 1.0) } else { 0.0 };
    p.dist(a + ab * t)
}

/// The distance between two convex polygons given counter-clockwise: nothing when they touch or
/// overlap, and without bound when either is not a polygon of finite points.
pub(super) fn polygons_apart(a: &[Vec2], b: &[Vec2]) -> f64 {
    if a.len() < 3 || b.len() < 3 || a.len() > 64 || b.len() > 64 || a.iter().chain(b).any(|p| !p.is_finite()) {
        return f64::INFINITY;
    }
    let edges = |pts: &[Vec2]| -> Vec<(Vec2, Vec2)> { pts.iter().copied().zip(pts.iter().copied().cycle().skip(1)).take(pts.len()).collect() };
    let (ea, eb) = (edges(a), edges(b));
    // A point inside a convex polygon is to the left of every edge.
    let inside = |p: Vec2, es: &[(Vec2, Vec2)]| es.iter().all(|(s, e)| (*e - *s).cross(p - *s) >= 0.0);
    if a.iter().any(|p| inside(*p, &eb)) || b.iter().any(|p| inside(*p, &ea)) {
        return 0.0;
    }
    let mut least = f64::INFINITY;
    for (p, q) in &ea {
        for (r, s) in &eb {
            // Two edges that cross are no distance apart.
            let (d1, d2) = ((*q - *p).cross(*r - *p), (*q - *p).cross(*s - *p));
            let (d3, d4) = ((*s - *r).cross(*p - *r), (*s - *r).cross(*q - *r));
            if d1 * d2 < 0.0 && d3 * d4 < 0.0 {
                return 0.0;
            }
            least = least.min(point_to_segment(*p, *r, *s)).min(point_to_segment(*q, *r, *s));
            least = least.min(point_to_segment(*r, *p, *q)).min(point_to_segment(*s, *p, *q));
        }
    }
    least
}

/// A three-stone ring's side stones: one each side of the centre stone, `angle` from 12 o'clock.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Sides {
    /// A side stone's length (along the finger) and width (around the band).
    pub length: f64,
    pub width: f64,
    /// Its head: its depth, its prong wire and how it stands over the band along its own radius.
    pub head: Head,
    /// How far from 12 o'clock each stands, in radians: the least that clears the centre stone,
    /// or [`MAX_SIDE_ANGLE`] when none does.
    pub angle: f64,
    /// The distance between the centre stone's head and a side stone's at that angle, seen along
    /// the finger.
    pub apart: f64,
    /// The metal the two stones carry into that distance: half of each one's prong wire.
    pub metal: f64,
    /// Whether the side stones clear the centre by `gap` within [`MAX_SIDE_ANGLE`].
    pub fits: bool,
}

impl Sides {
    /// The outward direction of the side stone on the right (`side` = 1) or the left (−1), in
    /// the ring's plane (+x right, +y to 12 o'clock).
    pub(super) fn out(&self, side: f64) -> Vec2 {
        Vec2::new(side * self.angle.sin(), self.angle.cos())
    }
    /// The direction across that stone, around the band clockwise.
    pub(super) fn across(&self, side: f64) -> Vec2 {
        Vec2::new(self.angle.cos(), -side * self.angle.sin())
    }
    /// The clear metal between the centre stone's setting and a side stone's.
    pub(super) fn between(&self) -> f64 {
        self.apart - self.metal
    }
}

/// How far outside the centre stone's girdle a halo's melee are centred: half the prong wire,
/// the gap, and half a melee, so the melee clear the prongs.
pub(super) fn halo_offset(prong: f64, gap: f64, melee: f64) -> f64 {
    prong / 2.0 + gap + melee / 2.0
}

/// `n` points evenly spaced by length around a closed loop.
fn around(loop_pts: &[Vec2], n: usize) -> Vec<Vec2> {
    let count = loop_pts.len();
    let edges: Vec<(Vec2, Vec2, f64)> = loop_pts.iter().zip(loop_pts.iter().cycle().skip(1)).take(count).map(|(a, b)| (*a, *b, a.dist(*b))).collect();
    let total: f64 = edges.iter().map(|e| e.2).sum();
    let mut out = Vec::with_capacity(n);
    if !(total.is_finite() && total > 1e-9) || n == 0 {
        return out;
    }
    let step = total / n as f64;
    let (mut walked, mut edge) = (0.0, 0usize);
    for i in 0..n {
        let want = (i as f64 + 0.5) * step;
        while let Some((a, b, len)) = edges.get(edge) {
            if walked + len >= want || edge + 1 == edges.len() {
                let t = if *len > 1e-12 { ((want - walked) / len).clamp(0.0, 1.0) } else { 0.0 };
                out.push(*a + (*b - *a) * t);
                break;
            }
            walked += len;
            edge += 1;
        }
    }
    out
}

/// The least distance between any two of `pts`.
pub(super) fn least_spacing(pts: &[Vec2]) -> f64 {
    let mut least = f64::INFINITY;
    for (i, a) in pts.iter().enumerate() {
        for b in pts.iter().skip(i + 1) {
            least = least.min(a.dist(*b));
        }
    }
    least
}

/// Where a halo's melee of width `melee` are centred around a stone, in the stone's plan: on the
/// girdle offset by [`halo_offset`], as many as keep `gap` of metal between every pair. Around a
/// circle they are spaced by their chord, the first at +y and on clockwise; around any other cut
/// they are spaced along the offset girdle, fewer until they keep the gap. `None` when fewer
/// than three fit.
pub(super) fn halo_sites(cut: &gem::Cut, length: f64, width: f64, melee: f64, gap: f64) -> Option<Vec<Vec2>> {
    let off = halo_offset(prong_wire(length, width), gap, melee);
    let pitch = melee + gap;
    if !(off.is_finite() && pitch.is_finite() && pitch > 1e-6 && length.is_finite() && width.is_finite()) {
        return None;
    }
    let most = MAX_PIECE_STONES as usize;
    let sites = if cut.is_circle(length, width) {
        let r = width / 2.0 + off;
        let n = (PI / (pitch / (2.0 * r)).clamp(0.0, 1.0).asin() + 1e-9).floor();
        let n = if n.is_finite() && n >= 0.0 { (n as usize).min(most) } else { 0 };
        (0..n)
            .map(|i| {
                let a = PI / 2.0 - TAU * i as f64 / n as f64;
                Vec2::new(a.cos(), a.sin()) * r
            })
            .collect::<Vec<_>>()
    } else {
        let outline = girdle_outline(cut, length, width)?;
        let ring = setting::offset_loop(&outline, off).ok()?;
        let total: f64 = ring.iter().zip(ring.iter().cycle().skip(1)).take(ring.len()).map(|(a, b)| a.dist(*b)).sum();
        let first = if total.is_finite() && total > 0.0 { ((total / pitch).floor() as usize).min(most) } else { 0 };
        let mut sites = around(&ring, first);
        for n in (3..first).rev().take(64) {
            if least_spacing(&sites) + 1e-9 >= pitch {
                break;
            }
            sites = around(&ring, n);
        }
        sites
    };
    (sites.len() >= 3 && sites.iter().all(|p| p.is_finite())).then_some(sites)
}

/// A halo's seat on a solitaire's head.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct HaloSeat {
    /// The melee's width and depth.
    pub melee: f64,
    pub depth: f64,
    /// How far outside the centre stone's girdle the melee are centred.
    pub offset: f64,
    /// How far under the girdles' plane the seat's metal reaches.
    pub under: f64,
}

/// A solitaire's head: how its centre stone sits over the band. Heights are from the band's
/// outside at 12 o'clock.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Head {
    /// The centre stone's depth.
    pub depth: f64,
    /// The prong wire's diameter.
    pub prong: f64,
    /// The stone's lowest point (its culet; a cabochon's base) over the band.
    pub clear: f64,
    /// The girdle's plane over the stone's lowest point (a cabochon's girdle is its base).
    pub below: f64,
    /// The girdle's thickness (none on a cabochon).
    pub girdle: f64,
    pub halo: Option<HaloSeat>,
    /// A bezel's collar, when the stone is held by one rather than by prongs.
    pub bezel: Option<Bezel>,
}

impl Head {
    /// The girdle's plane over the band.
    pub(super) fn girdle_height(&self) -> f64 {
        self.clear + self.below
    }
    /// The prongs' tips over the band.
    pub(super) fn prong_height(&self) -> f64 {
        match self.bezel {
            Some(b) => self.girdle_height() + b.top(),
            None => self.girdle_height() + self.girdle / 2.0 + PRONG_OVER * self.prong,
        }
    }
}

impl PieceParams {
    /// The piece's cut (a round when the name is not a cut's, which `parse` never lets through).
    pub(super) fn cut_data(&self) -> Option<&'static gem::Cut> {
        gem::cut_of(&self.cut).or(gem::CUTS.first())
    }

    /// A solitaire's centre stone, as `GEM` reads it.
    pub(super) fn centre_stone(&self, cmd: &str) -> Result<gem::Stone> {
        stone_of(cmd, &self.cut, self.stone_length, self.stone_width, &self.stone)
    }

    /// A halo's melee: round diamonds of the `halo` width.
    pub(super) fn halo_stone(&self, cmd: &str) -> Result<Option<gem::Stone>> {
        self.halo.map(|h| stone_of(cmd, "round", h, h, "diamond")).transpose()
    }

    /// An eternity band's stone: the piece's cut and material, as long as it is wide.
    pub(super) fn row_stone(&self, cmd: &str) -> Result<gem::Stone> {
        stone_of(cmd, &self.cut, self.melee, self.melee, &self.stone)
    }

    /// The head a stone of this cut and size stands in, with a halo of `halo` melee or none.
    fn head_of(&self, cut: Option<&gem::Cut>, length: f64, width: f64, halo: Option<f64>) -> Head {
        let cab = cut.is_some_and(|c| c.name == "cabochon");
        let depth = cut.map_or(0.6 * width, |c| stone_depth(c, width));
        let below = if cab { 0.0 } else { girdle_rise(depth) };
        let bezel = self.bezel_of(cut, length, width, depth);
        // A bezel's metal beyond the girdle is its wall: it stands in for the prong wire's diameter.
        let prong = bezel.map_or_else(|| prong_wire(length, width), |b| 2.0 * b.wall);
        let halo = halo.map(|h| {
            let melee_depth = gem::CUTS.first().map_or(0.6 * h, |c| stone_depth(c, h));
            HaloSeat { melee: h, depth: melee_depth, offset: halo_offset(prong, self.gap, h), under: girdle_rise(melee_depth) + HALO_UNDER }
        });
        // A halo's seat under a shallow stone would foul the band: the head stands that much higher.
        let lift = halo.map_or(0.0, |h| (h.under - below).max(0.0));
        let mut head = Head { depth, prong, clear: CULET_CLEAR + lift, below, girdle: if cab { 0.0 } else { GIRDLE * depth }, halo, bezel };
        if let Some(b) = head.bezel.as_mut() {
            b.bottom -= lift;
        }
        head
    }

    /// Whether the centre stone has a halo: a solitaire asked for one. (A three-stone ring has
    /// none: its side stones stand where a halo would be.)
    pub(super) fn haloed(&self) -> Option<f64> {
        self.halo.filter(|_| self.kind == PieceKind::Solitaire)
    }

    /// The centre stone's head (a solitaire's, a three-stone ring's).
    pub(super) fn head(&self) -> Head {
        self.head_of(self.cut_data(), self.stone_length, self.stone_width, self.haloed())
    }

    /// A three-stone ring's side stones' cut: `sideCut`, else the centre stone's.
    pub(super) fn side_cut_data(&self) -> Option<&'static gem::Cut> {
        self.side_cut.as_deref().and_then(gem::cut_of).or_else(|| self.cut_data())
    }

    /// A side stone's length and width: `sideWidth` or 60 % of the centre's width, and
    /// `sideLength` or the centre stone's proportion of that.
    pub(super) fn side_size(&self) -> (f64, f64) {
        let width = self.side_width.unwrap_or(SIDE_WIDTH * self.stone_width);
        let ratio = self.stone_length / self.stone_width;
        let length = self.side_length.unwrap_or(if ratio.is_finite() && ratio > 0.0 { width * ratio } else { width });
        (length, width)
    }

    /// A side stone, as `GEM` reads it: the piece's material.
    pub(super) fn side_stone(&self, cmd: &str) -> Result<gem::Stone> {
        let (length, width) = self.side_size();
        stone_of(cmd, self.side_cut_data().map_or("round", |c| c.name), length, width, &self.stone)
    }

    /// Where a side stone's prongs stand on its girdle ([`prong_sites`]).
    pub(super) fn side_prong_sites(&self) -> Result<Vec<Vec2>> {
        let cut = self.side_cut_data().ok_or_else(|| bad("setting", "the stone has no cut"))?;
        let (length, width) = self.side_size();
        prong_sites(cut, length, width, self.side_prongs)
    }

    /// A three-stone ring's side stones: their size, their head and the angle they stand at.
    pub(super) fn sides(&self) -> Sides {
        let (length, width) = self.side_size();
        let (head, centre) = (self.head_of(self.side_cut_data(), length, width, None), self.head());
        let top = self.crown();
        // Each stone's side, seen along the finger: the centre's upright at 12 o'clock.
        let stand = |polygon: &[Vec2], clear: f64, angle: f64| -> Vec<Vec2> {
            let (up, across) = (Vec2::new(angle.sin(), angle.cos()), Vec2::new(angle.cos(), -angle.sin()));
            polygon.iter().map(|q| up * (top + clear + q.y) + across * q.x).collect()
        };
        let middle = stand(&self.cut_data().map_or_else(Vec::new, |c| self.head_outline(c, self.stone_width, &centre)), centre.clear, 0.0);
        let beside = self.side_cut_data().map_or_else(Vec::new, |c| self.head_outline(c, width, &head));
        // The metal each stone carries beyond its girdle: half its prong wire.
        let metal = (centre.prong + head.prong) / 2.0;
        let apart = |angle: f64| polygons_apart(&middle, &stand(&beside, head.clear, angle));
        let need = metal + self.gap;
        let mut sides = Sides { length, width, head, angle: MAX_SIDE_ANGLE, apart: apart(MAX_SIDE_ANGLE), metal, fits: false };
        if !(sides.apart.is_finite() && need.is_finite() && top.is_finite()) || sides.apart + 1e-9 < need {
            return sides;
        }
        // The least angle that clears: the stones overlap at 12 o'clock and clear at the limit.
        let (mut near, mut far) = (0.0, MAX_SIDE_ANGLE);
        for _ in 0..60 {
            let mid = (near + far) / 2.0;
            if apart(mid) >= need { far = mid } else { near = mid }
        }
        sides.angle = far;
        sides.apart = apart(far);
        sides.fits = true;
        sides
    }

    /// Where a solitaire's prongs stand on its stone's girdle ([`prong_sites`]).
    pub(super) fn prong_sites(&self) -> Result<Vec<Vec2>> {
        let cut = self.cut_data().ok_or_else(|| bad("setting", "the stone has no cut"))?;
        prong_sites(cut, self.stone_length, self.stone_width, self.prongs)
    }

    /// Where a solitaire's halo melee are centred ([`halo_sites`]); `None` without a halo, or
    /// when fewer than three fit.
    pub(super) fn halo_sites(&self) -> Option<Vec<Vec2>> {
        halo_sites(self.cut_data()?, self.stone_length, self.stone_width, self.haloed()?, self.gap)
    }

    /// An eternity band's row of stones.
    pub(super) fn eternity_row(&self) -> Row {
        let melee = self.melee;
        let depth = self.cut_data().map_or(0.6 * melee, |c| stone_depth(c, melee));
        let (top, section) = (self.crown(), self.section());
        let radius = top - girdle_drop(depth);
        let fall = section.height_at(0.0) - section.height_at(melee / 2.0);
        let mut row = Row { melee, depth, radius, fits: 0, top, fall: if fall.is_finite() { fall } else { 0.0 } };
        if radius.is_finite() && melee.is_finite() && self.gap.is_finite() && radius > melee / 2.0 && melee > 0.0 && self.gap >= 0.0 {
            let most = (PI / (row.lean() + (self.gap / (2.0 * row.reach())).clamp(0.0, 1.0).asin()) + 1e-9).floor();
            if most.is_finite() && most >= 1.0 {
                row.fits = (most.min(f64::from(MAX_PIECE_STONES))) as u32;
            }
        }
        row
    }
}

// ---------------------------------------------------------------------------------------------
// An eternity band's row
// ---------------------------------------------------------------------------------------------

/// An eternity band's stones: seated with their tables level with the band's outside, evenly
/// around it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Row {
    /// The stones' width (and length).
    pub melee: f64,
    /// The stones' depth.
    pub depth: f64,
    /// The radius of the circle the girdles lie on: the tables' radius less the crown.
    pub radius: f64,
    /// The most stones that keep the gap between neighbouring girdles; none when the stones are
    /// too large to go around the band at all.
    pub fits: u32,
    /// The radius the tables lie at: the band's outside in the middle of its width.
    pub top: f64,
    /// How far the band's outside falls from the middle of the width to the stone's edge (less
    /// than nothing where it rises, on a concave band).
    pub fall: f64,
}

impl Row {
    /// Whether the band's outside stays at or over the girdle across the stone: it falls no more
    /// than the girdle lies under the table.
    pub(super) fn level(&self) -> bool {
        self.fall <= girdle_drop(self.depth) + 1e-9
    }
    /// From the ring's centre to a girdle's edge.
    fn reach(&self) -> f64 {
        self.radius.hypot(self.melee / 2.0)
    }
    /// The angle half a girdle takes at the ring's centre.
    fn lean(&self) -> f64 {
        (self.melee / (2.0 * self.radius)).atan()
    }
    /// The metal between two neighbours' girdles when `n` stones go around.
    pub(super) fn between(&self, n: u32) -> f64 {
        2.0 * self.reach() * (PI / f64::from(n.max(1)) - self.lean()).sin()
    }
    /// How many stones the band carries: the count asked for, else the most that fit.
    pub(super) fn count(&self, asked: Option<u32>) -> u32 {
        asked.unwrap_or(self.fits).clamp(1, MAX_PIECE_STONES)
    }
    /// The angle of stone `i` of `n`, clockwise from 12 o'clock.
    pub(super) fn angle(i: u32, n: u32) -> f64 {
        TAU * f64::from(i) / f64::from(n.max(1))
    }
    /// The outward direction of stone `i` of `n` in the ring's plane (+x right, +y to 12 o'clock).
    pub(super) fn out(i: u32, n: u32) -> Vec2 {
        let phi = Row::angle(i, n);
        Vec2::new(phi.sin(), phi.cos())
    }
}
