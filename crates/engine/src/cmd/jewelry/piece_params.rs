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
//! - **The band's section** ([`Section`]): `width` across by `wall` high, the finger side flat. A
//!   dome is a half-round (a D-section): a circular arc over the full width whose rise is the
//!   wall, and when the wall is more than half the width, straight sides of `wall − width/2`
//!   under a semicircle. Its outline height, its exact area and the height of its centroid are
//!   here; the sheet draws the outline, the solid revolves it, and the **band's weight** is the
//!   area swept around the finger at the centroid (Pappus) at the alloy's density
//!   ([`PieceParams::band_grams`]) — for a flat band exactly the annulus `RING` weighs.
//! - **A stone's proportions**: its depth is the cut's usual proportion of its width (as `GEM`
//!   has it), split crown 26 %, girdle 4 %, pavilion 70 % ([`proportions`]), under a table that is
//!   the fraction of the width `GEM` draws for the cut ([`table_ratio`]: 57 % a round, 65 % the
//!   step cuts, 60 % an oval, 62 % the rest).
//! - **A solitaire's head** ([`Head`]): the stone's lowest point stands [`CULET_CLEAR`] over the
//!   band (more only when a halo's seat would otherwise foul the band); the prong wire is 15 % of
//!   the stone's lesser dimension, kept between 0.8 and 1.2 mm in diameter ([`prong_wire`]); the
//!   prongs stand on the girdle where `SETTING` puts them, evenly on a round ([`prong_sites`]),
//!   and reach [`PRONG_OVER`] wire diameters over the girdle.
//! - **A halo** ([`halo_sites`]): round diamonds of the `halo` width on the centre stone's girdle
//!   offset outward by half the prong wire, `gap`, and half a melee; as many as keep `gap` of
//!   metal between every pair.
//! - **An eternity row** ([`Row`]): stones as long as they are wide (`melee`), in the piece's
//!   cut, tables level with the band's outside, so their girdles lie on a circle of radius
//!   `outer/2 − 0.28 × depth`; the metal between two neighbours' girdles for `n` stones is
//!   `2·√(R² + (melee/2)²)·sin(π/n − atan(melee/2R))`, and the most that fit is the largest `n`
//!   that leaves `gap`. Stone `i` of `n` is `2π·i/n` clockwise from 12 o'clock.
//! - **The parameters as JSON** ([`PieceParams::json`]): the size as a US number rounded to
//!   1e-9, with `sizeSystem` naming the system it was given in; [`PieceParams::parse`] reads that
//!   back to the same piece.

use cadcraft_doc::{Entity, Handle};
use cadcraft_geom::{PI, TAU, Vec2};
use serde_json::{Map, Value, json};

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
    /// The system the size was given in (`us`, `uk`, `eu`, `jp`, `cn`), kept so a panel shows it
    /// back: `sizeSystem` in the JSON (whose `system` is always `us`, the system `size` is in).
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

/// The band's cross-section: `width` across (along the finger) by `wall` high (radially), its
/// base — the finger side — flat. Flat is the rectangle; a dome is a circular arc over the full
/// width whose rise is the wall, on straight sides when the wall is more than half the width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Section {
    pub width: f64,
    pub wall: f64,
    pub domed: bool,
}

impl Section {
    fn half(&self) -> f64 {
        self.width / 2.0
    }

    /// How far a dome's arc rises above its chord (nothing for a flat band).
    pub(super) fn rise(&self) -> f64 {
        if self.domed { self.wall.min(self.half()).max(0.0) } else { 0.0 }
    }

    /// The height of the straight sides under a dome's arc (the whole wall for a flat band).
    pub(super) fn side(&self) -> f64 {
        self.wall - self.rise()
    }

    /// The arc's radius and half the angle it spans, when there is an arc.
    fn arc(&self) -> Option<(f64, f64)> {
        let (a, rise) = (self.half(), self.rise());
        if !(a.is_finite() && rise.is_finite() && a > 1e-9 && rise > 1e-9) {
            return None;
        }
        let r = (a * a + rise * rise) / (2.0 * rise);
        Some((r, a.atan2(r - rise)))
    }

    /// The outline's height above the finger side at `x` across the width (`x = 0` is the middle
    /// of the band, `±width/2` its edges).
    pub(super) fn height_at(&self, x: f64) -> f64 {
        let Some((r, _)) = self.arc() else { return self.wall };
        let x = x.abs().min(self.half());
        let rise = self.rise();
        self.side() + ((r * r - x * x).max(0.0).sqrt() - (r - rise)).clamp(0.0, rise)
    }

    /// The section's area, exactly.
    pub(super) fn area(&self) -> f64 {
        self.area_and_moment().0
    }

    /// The height of the section's centroid above the finger side, exactly.
    pub(super) fn centroid(&self) -> f64 {
        let (area, moment) = self.area_and_moment();
        if area > 0.0 { moment / area } else { self.wall / 2.0 }
    }

    /// The area, and its first moment about the base.
    fn area_and_moment(&self) -> (f64, f64) {
        let side = self.side();
        let rect = self.width * side;
        let mut out = (rect, rect * side / 2.0);
        if let Some((r, half)) = self.arc() {
            // A circular segment: its area, and its centroid's distance from the circle's centre.
            let lens = 2.0 * half - (2.0 * half).sin();
            if lens > 1e-300 {
                let area = r * r / 2.0 * lens;
                let from_centre = 4.0 * r * half.sin().powi(3) / (3.0 * lens);
                out.0 += area;
                out.1 += area * (side + self.rise() - r + from_centre);
            }
        }
        out
    }

    /// The outline as a closed polyline, counter-clockwise from the lower left corner, the base
    /// centred on the origin: each vertex with the bulge of the edge that follows it. Exact.
    pub(super) fn outline(&self) -> Vec<(Vec2, f64)> {
        let (a, h) = (self.half(), self.wall);
        if self.arc().is_none() {
            return vec![(Vec2::new(-a, 0.0), 0.0), (Vec2::new(a, 0.0), 0.0), (Vec2::new(a, h), 0.0), (Vec2::new(-a, h), 0.0)];
        }
        // A bulge is the arc's rise over half its chord.
        let (side, bulge) = (self.side(), self.rise() / a);
        if side <= 1e-9 {
            vec![(Vec2::new(-a, 0.0), 0.0), (Vec2::new(a, 0.0), bulge)]
        } else {
            vec![(Vec2::new(-a, 0.0), 0.0), (Vec2::new(a, 0.0), 0.0), (Vec2::new(a, side), bulge), (Vec2::new(-a, side), 0.0)]
        }
    }

    /// The outside of the section from `x = +width/2` to `x = −width/2` as `segments + 1` points
    /// `(x, height)`: evenly along a dome's arc, so a mesh of them is inscribed in the section.
    pub(super) fn outside(&self, segments: usize) -> Vec<Vec2> {
        let a = self.half();
        let Some((r, half)) = self.arc() else { return vec![Vec2::new(a, self.wall), Vec2::new(-a, self.wall)] };
        let n = segments.clamp(2, 1024);
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
}

impl PieceParams {
    /// The band's section.
    pub(super) fn section(&self) -> Section {
        Section { width: self.width, wall: self.wall, domed: self.profile == Profile::Dome }
    }

    /// The band's volume in cubic millimetres: its section swept around the finger at the
    /// section's centroid. The stones' seats are not taken off and no head is added.
    pub(super) fn band_volume(&self) -> f64 {
        let section = self.section();
        TAU * (self.inner() / 2.0 + section.centroid()) * section.area()
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
}

impl Head {
    /// The girdle's plane over the band.
    pub(super) fn girdle_height(&self) -> f64 {
        self.clear + self.below
    }
    /// The prongs' tips over the band.
    pub(super) fn prong_height(&self) -> f64 {
        self.girdle_height() + self.girdle / 2.0 + PRONG_OVER * self.prong
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

    /// A solitaire's head.
    pub(super) fn head(&self) -> Head {
        let cab = self.cut_data().is_some_and(|c| c.name == "cabochon");
        let depth = self.cut_data().map_or(0.6 * self.stone_width, |c| stone_depth(c, self.stone_width));
        let below = if cab { 0.0 } else { girdle_rise(depth) };
        let prong = prong_wire(self.stone_length, self.stone_width);
        let halo = self.halo.map(|h| {
            let melee_depth = gem::CUTS.first().map_or(0.6 * h, |c| stone_depth(c, h));
            HaloSeat { melee: h, depth: melee_depth, offset: halo_offset(prong, self.gap, h), under: girdle_rise(melee_depth) + HALO_UNDER }
        });
        // A halo's seat under a shallow stone would foul the band: the head stands that much higher.
        let lift = halo.map_or(0.0, |h| (h.under - below).max(0.0));
        Head { depth, prong, clear: CULET_CLEAR + lift, below, girdle: if cab { 0.0 } else { GIRDLE * depth }, halo }
    }

    /// Where a solitaire's prongs stand on its stone's girdle ([`prong_sites`]).
    pub(super) fn prong_sites(&self) -> Result<Vec<Vec2>> {
        let cut = self.cut_data().ok_or_else(|| bad("setting", "the stone has no cut"))?;
        prong_sites(cut, self.stone_length, self.stone_width, self.prongs)
    }

    /// Where a solitaire's halo melee are centred ([`halo_sites`]); `None` without a halo, or
    /// when fewer than three fit.
    pub(super) fn halo_sites(&self) -> Option<Vec<Vec2>> {
        halo_sites(self.cut_data()?, self.stone_length, self.stone_width, self.halo?, self.gap)
    }

    /// An eternity band's row of stones.
    pub(super) fn eternity_row(&self) -> Row {
        let melee = self.melee;
        let depth = self.cut_data().map_or(0.6 * melee, |c| stone_depth(c, melee));
        let radius = self.outer() / 2.0 - girdle_drop(depth);
        let mut row = Row { melee, depth, radius, fits: 0 };
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
    /// The radius of the circle the girdles lie on: the band's outside less the crown.
    pub radius: f64,
    /// The most stones that keep the gap between neighbouring girdles; none when the stones are
    /// too large to go around the band at all.
    pub fits: u32,
}

impl Row {
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
