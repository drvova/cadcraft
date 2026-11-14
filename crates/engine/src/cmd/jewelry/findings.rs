//! Findings: the parts of a piece that is not worn on a finger — a pendant's **bail** (the loop
//! the chain passes through), a stud's **post**, the **jump rings** a drop hangs from, the cast
//! **eyes** they pass through and a drop earring's **French wire** — and where each one stands
//! around the head, so the sheet (`PIECE`), the solid (`PIECEMESH`, `STLOUT`) and the weight are
//! one piece. Every figure here is millimetres.
//!
//! # The kinds (`kind` of `PIECE`)
//!
//! - **pendant**: the centre stone in its head (prongs or a bezel, a halo optional, exactly as a
//!   solitaire's head) with a bail on top. `bail: loop` (default) is a round wire loop, `tube` a
//!   tube the chain runs through. With `drop: true` the head carries a cast eye and hangs from a
//!   jump ring that passes through the bail (a tube bail then has an eye of its own under it).
//! - **stud**: the head with a post on its back, made **as a pair**. The back (`back: butterfly |
//!   scroll | none`) is bought in: it is counted on the sheet, never drawn or cast.
//! - **drop**: a hanging head (the piece's stone) on a jump ring under a top: `top: hook` (a
//!   French wire, bought in) or `top: stud` (a small round stone of `topStone` mm in a head of the
//!   same style with its own post), made as a pair.
//!
//! # Where everything stands
//!
//! The frame is the ring's: the stone's table faces +Y, its length runs along Z, and the piece's
//! top (where it hangs from) is +Z. The head stands as a solitaire's does on a band whose outside
//! is the plane Y = 0: the culet [`super::piece_params::CULET_CLEAR`] over it. Under a prong head
//! the prongs' feet stand [`PRONG_FOOT`] of their sites' distance from the axis at the **base**
//! (Y = [`PRONG_BASE`]), joined by a wire ring and a cross to the middle; under a bezel the cross
//! touches the collar's bottom (Y = [`BEZEL_BASE`]). Every finding lies in the plane X = 0 at the
//! base's height:
//!
//! - A loop (bail, eye, the French wire's loop) lies in the YZ plane, a jump ring in the XZ plane,
//!   so each passes through the next as a chain's links do; two that pass through each other rest
//!   wire on wire: their centres are `R₁ + R₂ − (w₁ + w₂)/2` apart (`R` the mean radius, `w` the
//!   wire).
//! - A bail or eye fixed to a head reaches 30 % of its wire into the head's outline (the girdle,
//!   plus the halo or the collar's wall or half a prong), and a connector wire runs from the
//!   base's middle to it.
//!
//! # Weight
//!
//! `metal.grams` is every metal part of the piece, of the pair for studs and drops: the findings
//! exactly (a loop is a torus, `2π²·R·(w/2)²`; a tube `π(R²−r²)·L`; a post, a connector or a wire
//! `π(w/2)²·L`), the bezel's collar exactly ([`PieceParams::bezel_volume`]), and the prongs, the
//! gallery rail and the base as wires along their paths — an estimate that counts their overlaps
//! twice, so it reads a little heavy against the merged solid. `castGrams` is what is cast;
//! `boughtGrams` the jump rings and French wires a bench buys in.
//!
//! # The numbers (this project's approximation of usual bench figures, not a cited standard)
//!
//! - Chain: 1.5 mm thick; a bail's opening must pass it with 0.5 mm to spare. Bail: a 3 mm
//!   opening of 1 mm wire (a tube 3 mm long); its wire at least 0.8 mm to cast and wear.
//! - Jump ring: 0.8 mm wire, 3 mm inside; at least 0.6 mm wire, and its opening must hold the
//!   wires it joins with 0.2 mm to spare. A cast eye: 0.9 mm wire, its opening the jump ring's
//!   wire and 0.4 mm.
//! - Post: 0.8 mm × 10 mm (the post check accepts 0.7–1.0 mm by 8–12 mm). French wire: 0.8 mm
//!   (at least 0.7 mm). A stud top's stone: 3 mm.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::piece_params::{PRONG_FOOT, PieceKind, PieceParams};
use super::*;

/// The chain a bail is sized for when none is given.
pub(super) const CHAIN: f64 = 1.5;
/// What a bail's opening must leave beyond the chain.
pub(super) const CHAIN_CLEARANCE: f64 = 0.5;
pub(super) const BAIL_OPENING: f64 = 3.0;
pub(super) const BAIL_WIRE: f64 = 1.0;
pub(super) const BAIL_WIDTH: f64 = 3.0;
/// The thinnest bail wire (or tube wall) that casts and wears.
pub(super) const MIN_BAIL_WIRE: f64 = 0.8;
pub(super) const JUMP_WIRE: f64 = 0.8;
pub(super) const JUMP_OPENING: f64 = 3.0;
pub(super) const MIN_JUMP_WIRE: f64 = 0.6;
/// What a jump ring's opening must leave beyond the wires it joins.
pub(super) const JUMP_CLEARANCE: f64 = 0.2;
/// A cast eye's wire, and what its opening leaves beyond the jump ring's wire.
pub(super) const EYE_WIRE: f64 = 0.9;
pub(super) const EYE_CLEARANCE: f64 = 0.4;
pub(super) const POST_DIAMETER: f64 = 0.8;
pub(super) const POST_LENGTH: f64 = 10.0;
/// The posts a bench fits to a butterfly or scroll back.
pub(super) const POST_DIAMETERS: (f64, f64) = (0.7, 1.0);
pub(super) const POST_LENGTHS: (f64, f64) = (8.0, 12.0);
pub(super) const HOOK_WIRE: f64 = 0.8;
pub(super) const MIN_HOOK_WIRE: f64 = 0.7;
pub(super) const TOP_STONE: f64 = 3.0;
/// The base's height under a prong head and under a bezel (the band's outside would be Y = 0).
pub(super) const PRONG_BASE: f64 = -0.7;
pub(super) const BEZEL_BASE: f64 = -0.25;
/// The cross under a bezel: its wire's radius.
pub(super) const BAR: f64 = 0.4;
/// How much of its wire a fixed bail or eye reaches into the head's outline.
const INTO_HEAD: f64 = 0.3;
/// The French wire: how far it rises over its loop, the radius it turns over the ear at, and how
/// far it falls behind.
const HOOK_RISE: f64 = 6.0;
const HOOK_TURN: f64 = 5.0;
const HOOK_FALL: f64 = 10.0;
/// A French wire's loop: its opening.
const HOOK_LOOP: f64 = 1.2;
/// Space between the two pieces of a pair on the sheet and in the solid.
pub(super) const PAIR_GAP: f64 = 6.0;

/// The ring-only keys a piece not worn on a finger does not use.
pub(super) const RING_ONLY: [&str; 19] = [
    "size", "system", "wall", "width", "profile", "comfort", "ridge", "bevel", "hollow", "topWidth", "topWall", "pave", "count", "melee", "rail",
    "shank", "pattern", "engrave", "hallmark",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Bail {
    Loop,
    Tube,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Top {
    Hook,
    Stud,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Back {
    Butterfly,
    Scroll,
    None,
}

impl Back {
    pub(super) fn name(self) -> &'static str {
        match self {
            Back::Butterfly => "butterfly",
            Back::Scroll => "scroll",
            Back::None => "none",
        }
    }
}

/// The findings' parameters, read from `PIECE`'s JSON whatever the kind (so changing the kind
/// keeps them), used by the kinds that have them.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Worn {
    pub bail: Bail,
    pub bail_wire: f64,
    pub bail_opening: f64,
    pub bail_width: f64,
    pub chain: f64,
    pub drop: bool,
    pub jump_wire: f64,
    pub jump_opening: f64,
    pub post_diameter: f64,
    pub post_length: f64,
    pub back: Back,
    pub top: Top,
    pub top_stone: f64,
    pub hook_wire: f64,
}

fn mm(cmd: &str, p: &Value, key: &str, default: f64, min: f64, max: f64) -> Result<f64> {
    match p.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= min && *x <= max)
            .ok_or_else(|| bad(cmd, format!("`{key}` must be a number of millimetres from {min} to {max}"))),
    }
}

fn word<'a>(cmd: &str, p: &Value, key: &str, choices: &[&'a str]) -> Result<Option<&'a str>> {
    match p.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => {
            let s = v.as_str().map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
            choices.iter().copied().find(|c| *c == s).map(Some).ok_or_else(|| bad(cmd, format!("`{key}` must be {}", choices.join(" or "))))
        }
    }
}

impl Worn {
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Worn> {
        let bail = match word(cmd, p, "bail", &["loop", "tube"])? {
            Some("tube") => Bail::Tube,
            _ => Bail::Loop,
        };
        let top = match word(cmd, p, "top", &["hook", "stud"])? {
            Some("stud") => Top::Stud,
            _ => Top::Hook,
        };
        let back = match word(cmd, p, "back", &["butterfly", "scroll", "none"])? {
            Some("scroll") => Back::Scroll,
            Some("none") => Back::None,
            _ => Back::Butterfly,
        };
        let drop = match p.get("drop") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(bad(cmd, "`drop` must be true or false")),
        };
        Ok(Worn {
            bail,
            bail_wire: mm(cmd, p, "bailWire", BAIL_WIRE, 0.3, 4.0)?,
            bail_opening: mm(cmd, p, "bailOpening", BAIL_OPENING, 0.5, 15.0)?,
            bail_width: mm(cmd, p, "bailWidth", BAIL_WIDTH, 0.5, 15.0)?,
            chain: mm(cmd, p, "chain", CHAIN, 0.2, 10.0)?,
            drop,
            jump_wire: mm(cmd, p, "jumpRingWire", JUMP_WIRE, 0.3, 3.0)?,
            jump_opening: mm(cmd, p, "jumpRing", JUMP_OPENING, 0.8, 15.0)?,
            post_diameter: mm(cmd, p, "postDiameter", POST_DIAMETER, 0.3, 3.0)?,
            post_length: mm(cmd, p, "postLength", POST_LENGTH, 2.0, 30.0)?,
            back,
            top,
            top_stone: mm(cmd, p, "topStone", TOP_STONE, 1.0, 10.0)?,
            hook_wire: mm(cmd, p, "hookWire", HOOK_WIRE, 0.3, 3.0)?,
        })
    }

    /// The keys as `PIECE` reports them.
    pub(super) fn json(&self, into: &mut Map<String, Value>) {
        into.insert("bail".into(), json!(if self.bail == Bail::Tube { "tube" } else { "loop" }));
        into.insert("bailWire".into(), json!(self.bail_wire));
        into.insert("bailOpening".into(), json!(self.bail_opening));
        into.insert("bailWidth".into(), json!(self.bail_width));
        into.insert("chain".into(), json!(self.chain));
        into.insert("drop".into(), json!(self.drop));
        into.insert("jumpRingWire".into(), json!(self.jump_wire));
        into.insert("jumpRing".into(), json!(self.jump_opening));
        into.insert("postDiameter".into(), json!(self.post_diameter));
        into.insert("postLength".into(), json!(self.post_length));
        into.insert("back".into(), json!(self.back.name()));
        into.insert("top".into(), json!(if self.top == Top::Stud { "stud" } else { "hook" }));
        into.insert("topStone".into(), json!(self.top_stone));
        into.insert("hookWire".into(), json!(self.hook_wire));
    }

    /// A cast eye's opening: the jump ring's wire and the eye's clearance.
    pub(super) fn eye_opening(&self) -> f64 {
        self.jump_wire + EYE_CLEARANCE
    }
}

impl PieceKind {
    /// Whether the piece is worn off the finger (a pendant or earrings): it has no ring size.
    pub(super) fn worn(self) -> bool {
        matches!(self, PieceKind::Pendant | PieceKind::Stud | PieceKind::Drop)
    }
    /// Whether the piece is made as a pair.
    pub(super) fn pair(self) -> bool {
        matches!(self, PieceKind::Stud | PieceKind::Drop)
    }
}

/// How many of the piece are made: two of a pair.
pub(super) fn pieces(p: &PieceParams) -> u32 {
    if p.kind.pair() { 2 } else { 1 }
}

// ---------------------------------------------------------------------------------------------
// The findings and where they stand
// ---------------------------------------------------------------------------------------------

/// One finding's shape, in the piece's frame.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Shape {
    /// A round wire loop of mean radius `mean` about `c`, square to `axis`.
    Loop { c: Vec3, axis: Vec3, mean: f64, wire: f64 },
    /// A tube along `axis`, `len` long, from `ri` to `ro`.
    Tube { c: Vec3, axis: Vec3, ri: f64, ro: f64, len: f64 },
    /// A round wire along a path (a post, a connector, a French wire), round at its ends.
    Wire { pts: Vec<Vec3>, wire: f64 },
}

/// A finding: its shape, what it is, and whether it is cast with the head (or bought in).
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Finding {
    pub what: &'static str,
    pub cast: bool,
    pub shape: Shape,
}

const X: Vec3 = Vec3 { x: 1.0, y: 0.0, z: 0.0 };
const Y: Vec3 = Vec3 { x: 0.0, y: 1.0, z: 0.0 };

impl Shape {
    /// The volume, mm³.
    pub(super) fn volume(&self) -> f64 {
        let v = match self {
            Shape::Loop { mean, wire, .. } => 2.0 * PI * PI * mean * (wire / 2.0).powi(2),
            Shape::Tube { ri, ro, len, .. } => PI * (ro * ro - ri * ri) * len,
            Shape::Wire { pts, wire } => {
                let length: f64 = pts.windows(2).filter_map(|w| Some((*w.get(1)? - *w.first()?).len())).sum();
                PI * (wire / 2.0).powi(2) * length
            }
        };
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }
    /// Points along a loop, `n` of them.
    pub(super) fn loop_points(c: Vec3, axis: Vec3, mean: f64, n: usize) -> Vec<Vec3> {
        let (a, b) = if axis.x.abs() > 0.5 { (Y, Vec3::new(0.0, 0.0, 1.0)) } else { (X, Vec3::new(0.0, 0.0, 1.0)) };
        (0..n.clamp(3, 512)).map(|k| TAU * k as f64 / n.clamp(3, 512) as f64).map(|t| c + a * (mean * t.cos()) + b * (mean * t.sin())).collect()
    }
}

/// How far a head reaches from the stone's axis: across (X) and along (Z), its girdle plus the
/// halo, or the collar's wall, or half a prong.
pub(super) fn head_reach(p: &PieceParams) -> (f64, f64) {
    let head = p.head();
    let extra = match (head.halo.filter(|_| p.halo_sites().is_some()), head.bezel) {
        (Some(h), _) => h.offset + h.melee / 2.0 + 0.2,
        (None, Some(b)) => b.wall,
        (None, None) => head.prong / 2.0,
    };
    (p.stone_width / 2.0 + extra, p.stone_length / 2.0 + extra)
}

/// The height of a head's base: where its prongs' feet and its cross stand.
pub(super) fn base_of(p: &PieceParams) -> f64 {
    if p.head().bezel.is_some() { BEZEL_BASE } else { PRONG_BASE }
}

/// A prong's foot for a site on the girdle, in the girdle plane's own coordinates (x, y in the
/// plane, h over it): [`PRONG_FOOT`] of the way out, at the base.
pub(super) fn foot(p: &PieceParams, site: Vec2) -> (Vec2, f64) {
    (site * PRONG_FOOT, base_of(p) - p.head().girdle_height())
}

/// The stud top of a drop earring: a round stone of `topStone` in four prongs or a bezel, the
/// piece's head style, no halo.
pub(super) fn top_params(p: &PieceParams) -> PieceParams {
    let mut t = p.clone();
    t.cut = "round".to_string();
    t.stone_width = p.worn.top_stone;
    t.stone_length = p.worn.top_stone;
    t.prongs = 4;
    t.halo = None;
    t
}

/// One piece (one earring of a pair) laid out: its findings, and the stud top's head and how far
/// up (Z) it stands, when it has one.
pub(super) struct Layout {
    pub findings: Vec<Finding>,
    pub top: Option<(PieceParams, f64)>,
    /// How far it reaches across (X), down and up (Z), and back (−Y).
    pub across: f64,
    pub low: f64,
    pub high: f64,
    pub back: f64,
}

/// Two links that pass through each other, resting wire on wire: how far apart their centres are.
fn linked(mean_a: f64, wire_a: f64, mean_b: f64, wire_b: f64) -> f64 {
    mean_a + mean_b - (wire_a + wire_b) / 2.0
}

/// Where everything of one piece stands.
pub(super) fn layout(p: &PieceParams) -> Layout {
    let w = &p.worn;
    let base = base_of(p);
    let (rx, rz) = head_reach(p);
    let at = |z: f64| Vec3::new(0.0, base, z);
    let mut out: Vec<Finding> = Vec::new();
    let mut top: Option<(PieceParams, f64)> = None;
    let (mut across, mut high, mut back) = (rx, rz, -base + 0.5);
    let fixed = |wire: f64| rz - INTO_HEAD * wire;
    // A cast eye on the head, and the jump ring through it: answers where the jump ring is.
    let eye_and_ring = |out: &mut Vec<Finding>| -> (f64, f64) {
        let re = (w.eye_opening() + EYE_WIRE) / 2.0;
        let ze = fixed(EYE_WIRE) + re;
        out.push(Finding { what: "connector", cast: true, shape: Shape::Wire { pts: vec![at(0.0), at(ze - re)], wire: 2.0 * BAR } });
        out.push(Finding { what: "eye", cast: true, shape: Shape::Loop { c: at(ze), axis: X, mean: re, wire: EYE_WIRE } });
        let rj = (w.jump_opening + w.jump_wire) / 2.0;
        let zj = ze + linked(re, EYE_WIRE, rj, w.jump_wire);
        out.push(Finding { what: "jump ring", cast: false, shape: Shape::Loop { c: at(zj), axis: Y, mean: rj, wire: w.jump_wire } });
        (zj, rj)
    };
    match p.kind {
        PieceKind::Pendant => {
            let rb = (w.bail_opening + w.bail_wire) / 2.0;
            let ro = w.bail_opening / 2.0 + w.bail_wire;
            if !w.drop {
                let (zb, bottom) = match w.bail {
                    Bail::Loop => (fixed(w.bail_wire) + rb, fixed(w.bail_wire) + 0.0),
                    Bail::Tube => (fixed(w.bail_wire) + ro, fixed(w.bail_wire) + w.bail_wire / 2.0),
                };
                out.push(Finding { what: "connector", cast: true, shape: Shape::Wire { pts: vec![at(0.0), at(bottom)], wire: 2.0 * BAR } });
                out.push(bail(w, at(zb)));
                high = zb + ro;
            } else {
                let (zj, rj) = eye_and_ring(&mut out);
                let zb = match w.bail {
                    Bail::Loop => zj + linked(rj, w.jump_wire, rb, w.bail_wire),
                    Bail::Tube => {
                        // The tube's own eye under it, through which the jump ring passes.
                        let re = (w.eye_opening() + EYE_WIRE) / 2.0;
                        let ze = zj + linked(rj, w.jump_wire, re, EYE_WIRE);
                        out.push(Finding { what: "bail eye", cast: true, shape: Shape::Loop { c: at(ze), axis: X, mean: re, wire: EYE_WIRE } });
                        ze + re + ro - w.bail_wire / 2.0
                    }
                };
                out.push(bail(w, at(zb)));
                high = zb + ro;
            }
            if w.bail == Bail::Tube {
                across = across.max(w.bail_width / 2.0);
            }
            back = back.max(-(base - ro));
        }
        PieceKind::Stud => {
            out.push(post(p, base, 0.0));
            back = -(base - w.post_length);
        }
        PieceKind::Drop => {
            let (zj, rj) = eye_and_ring(&mut out);
            match w.top {
                Top::Hook => {
                    let rh = (HOOK_LOOP + w.hook_wire) / 2.0;
                    let zh = zj + linked(rj, w.jump_wire, rh, w.hook_wire);
                    out.push(Finding { what: "ear wire loop", cast: false, shape: Shape::Loop { c: at(zh), axis: X, mean: rh, wire: w.hook_wire } });
                    let z0 = zh + rh;
                    let mut pts = vec![at(z0), at(z0 + HOOK_RISE)];
                    let centre = Vec2::new(base - HOOK_TURN, z0 + HOOK_RISE);
                    for k in 1..=12 {
                        let t = PI * f64::from(k) / 12.0;
                        pts.push(Vec3::new(0.0, centre.x + HOOK_TURN * t.cos(), centre.y + HOOK_TURN * t.sin()));
                    }
                    pts.push(Vec3::new(0.0, base - 2.0 * HOOK_TURN, z0 + HOOK_RISE - HOOK_FALL));
                    out.push(Finding { what: "ear wire", cast: false, shape: Shape::Wire { pts, wire: w.hook_wire } });
                    high = z0 + HOOK_RISE + HOOK_TURN + w.hook_wire / 2.0;
                    back = back.max(-(base - 2.0 * HOOK_TURN) + w.hook_wire);
                }
                Top::Stud => {
                    let t = top_params(p);
                    let (trx, trz) = head_reach(&t);
                    let re = (w.eye_opening() + EYE_WIRE) / 2.0;
                    let ze = zj + linked(rj, w.jump_wire, re, EYE_WIRE);
                    let zt = ze + re + trz - INTO_HEAD * EYE_WIRE;
                    let tb = base_of(&t);
                    out.push(Finding {
                        what: "top eye",
                        cast: true,
                        shape: Shape::Loop { c: Vec3::new(0.0, tb, ze), axis: X, mean: re, wire: EYE_WIRE },
                    });
                    out.push(Finding {
                        what: "connector",
                        cast: true,
                        shape: Shape::Wire { pts: vec![Vec3::new(0.0, tb, zt), Vec3::new(0.0, tb, ze + re)], wire: 2.0 * BAR },
                    });
                    out.push(post(&t, tb, zt));
                    across = across.max(trx);
                    high = zt + trz;
                    back = -(tb - w.post_length);
                    top = Some((t, zt));
                }
            }
        }
        _ => {}
    }
    Layout { findings: out, top, across, low: -rz, high, back }
}

fn bail(w: &Worn, c: Vec3) -> Finding {
    let shape = match w.bail {
        Bail::Loop => Shape::Loop { c, axis: X, mean: (w.bail_opening + w.bail_wire) / 2.0, wire: w.bail_wire },
        Bail::Tube => Shape::Tube { c, axis: X, ri: w.bail_opening / 2.0, ro: w.bail_opening / 2.0 + w.bail_wire, len: w.bail_width },
    };
    Finding { what: "bail", cast: true, shape }
}

fn post(p: &PieceParams, base: f64, z: f64) -> Finding {
    let w = &p.worn;
    Finding {
        what: "post",
        cast: true,
        shape: Shape::Wire { pts: vec![Vec3::new(0.0, base, z), Vec3::new(0.0, base - w.post_length, z)], wire: w.post_diameter },
    }
}

// ---------------------------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------------------------

/// One head's metal, mm³: the collar exactly, or the prongs, the gallery rail and the base as
/// wires along their paths; a halo's seat as its plate; the cross to the base's middle.
pub(super) fn head_volume(p: &PieceParams) -> f64 {
    let head = p.head();
    let (l, wd) = (p.stone_length, p.stone_width);
    let mut v = 0.0;
    match head.bezel {
        Some(b) => {
            v += p.bezel_volume();
            // The cross under the collar: four bars from its wall to the middle.
            v += PI * BAR * BAR * (wd + l + 2.0 * b.wall);
        }
        None => {
            let r = head.prong / 2.0;
            let sites = p.prong_sites().unwrap_or_default();
            let (girdle, _, pavilion) = super::piece_params::proportions(head.depth);
            let rail_h = -(girdle / 2.0 + 0.5 * pavilion);
            let tip_h = head.prong_height() - head.girdle_height() - r;
            let (_, foot_h) = foot(p, Vec2::ZERO);
            let mut prongs = 0.0;
            for s in sites.iter().filter(|s| s.is_finite()) {
                let f = Vec3::new(s.x * PRONG_FOOT, s.y * PRONG_FOOT, foot_h);
                let rail = Vec3::new(s.x * 0.5, s.y * 0.5, rail_h);
                let g = Vec3::new(s.x, s.y, 0.0);
                let tip = Vec3::new(s.x, s.y, tip_h);
                prongs += (rail - f).len() + (g - rail).len() + (tip - g).len() + r;
            }
            let rail_r = 0.7 * r;
            let rail_len = PI * (l + wd) / 2.0 * 0.5 + TAU * 1.2 * rail_r;
            let feet_loop = PI * (l + wd) / 2.0 * PRONG_FOOT;
            let cross = PRONG_FOOT * (l + wd) / 2.0 * sites.len().min(16) as f64 / 2.0;
            v += PI * r * r * (prongs + feet_loop + cross) + PI * rail_r * rail_r * rail_len;
        }
    }
    if let (Some(seat), Some(_)) = (head.halo, p.halo_sites()) {
        let near = seat.offset - seat.melee / 2.0;
        let (inner, outer) = ((near - 0.1).max(0.02), near + seat.melee + 0.2);
        let mid = PI * (l + wd) / 2.0 + PI * (inner + outer);
        v += mid * (outer - inner) * (seat.under - 0.04 * seat.melee);
    }
    if v.is_finite() { v.max(0.0) } else { 0.0 }
}

/// One piece's metal, mm³: what is cast and what is bought in.
pub(super) fn one_volume(p: &PieceParams) -> (f64, f64) {
    let lay = layout(p);
    let mut cast = head_volume(p) + lay.top.as_ref().map_or(0.0, |(t, _)| head_volume(t));
    let mut bought = 0.0;
    for f in &lay.findings {
        if f.cast { cast += f.shape.volume() } else { bought += f.shape.volume() }
    }
    (cast, bought)
}

/// Every metal part of the piece (both of a pair), mm³: `band_volume` for a worn piece.
pub(super) fn worn_volume(p: &PieceParams) -> f64 {
    let (cast, bought) = one_volume(p);
    f64::from(pieces(p)) * (cast + bought)
}

/// What `metal` adds for a worn piece: the cast and bought-in grams, and the pair.
pub(super) fn metal_extra(p: &PieceParams, into: &mut Map<String, Value>) {
    let (cast, bought) = one_volume(p);
    let n = f64::from(pieces(p));
    let g = |v: f64| (v * n / 1000.0 * p.density * 1000.0).round() / 1000.0;
    into.insert("castGrams".into(), json!(g(cast)));
    into.insert("boughtGrams".into(), json!(g(bought)));
    into.insert("pieces".into(), json!(pieces(p)));
    into.insert("eachGrams".into(), json!(((cast + bought) / 1000.0 * p.density * 1000.0).round() / 1000.0));
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

fn check(id: &str, ok: bool, message: String) -> Value {
    json!({ "id": id, "ok": ok, "message": message })
}

/// The findings' checks, in a jeweler's words.
pub(super) fn checks(p: &PieceParams) -> Vec<Value> {
    let w = &p.worn;
    let mut out = Vec::new();
    let jump = |out: &mut Vec<Value>, holds: f64, what: &str| {
        let ok = w.jump_wire + 1e-9 >= MIN_JUMP_WIRE;
        out.push(check(
            "jump-ring-wire",
            ok,
            if ok {
                format!("The jump ring is {} mm wire, at or over the {MIN_JUMP_WIRE} mm that holds a drop", fmt_mm(w.jump_wire))
            } else {
                format!("The jump ring is {} mm wire, under the {MIN_JUMP_WIRE} mm that holds a drop without pulling open", fmt_mm(w.jump_wire))
            },
        ));
        let need = holds + JUMP_CLEARANCE;
        let ok = w.jump_opening + 1e-9 >= need;
        out.push(check(
            "jump-ring",
            ok,
            if ok {
                format!("The jump ring's {} mm opening holds {what} ({} mm with {JUMP_CLEARANCE} mm to spare)", fmt_mm(w.jump_opening), fmt_mm(need))
            } else {
                format!("The jump ring's {} mm opening is too small for {what}: it needs {} mm", fmt_mm(w.jump_opening), fmt_mm(need))
            },
        ));
    };
    match p.kind {
        PieceKind::Pendant => {
            let need = w.chain + CHAIN_CLEARANCE;
            let ok = w.bail_opening + 1e-9 >= need;
            out.push(check(
                "bail-opening",
                ok,
                if ok {
                    format!(
                        "The bail's {} mm opening passes a {} mm chain with {} mm to spare (at least {CHAIN_CLEARANCE} mm)",
                        fmt_mm(w.bail_opening),
                        fmt_mm(w.chain),
                        fmt_mm(w.bail_opening - w.chain)
                    )
                } else {
                    format!(
                        "The bail's {} mm opening is too small for a {} mm chain: give it at least {} mm (the chain and {CHAIN_CLEARANCE} mm)",
                        fmt_mm(w.bail_opening),
                        fmt_mm(w.chain),
                        fmt_mm(need)
                    )
                },
            ));
            let ok = w.bail_wire + 1e-9 >= MIN_BAIL_WIRE;
            let what = if w.bail == Bail::Tube { "tube's wall" } else { "wire" };
            out.push(check(
                "bail-wire",
                ok,
                if ok {
                    format!("The bail's {what} is {} mm, at or over the {MIN_BAIL_WIRE} mm that casts and wears", fmt_mm(w.bail_wire))
                } else {
                    format!(
                        "The bail's {what} is {} mm, under the {MIN_BAIL_WIRE} mm that casts and wears without the chain cutting through it",
                        fmt_mm(w.bail_wire)
                    )
                },
            ));
            if w.drop {
                let other = if w.bail == Bail::Tube { EYE_WIRE } else { w.bail_wire };
                jump(&mut out, EYE_WIRE + other, "the head's eye and the bail");
            }
        }
        PieceKind::Stud => out.push(post_check(w)),
        PieceKind::Drop => {
            let (other, what) = match w.top {
                Top::Hook => (w.hook_wire, "the head's eye and the ear wire"),
                Top::Stud => (EYE_WIRE, "the head's eye and the top's eye"),
            };
            jump(&mut out, EYE_WIRE + other, what);
            match w.top {
                Top::Stud => out.push(post_check(w)),
                Top::Hook => {
                    let ok = w.hook_wire + 1e-9 >= MIN_HOOK_WIRE;
                    out.push(check(
                        "ear-wire",
                        ok,
                        if ok {
                            format!("The French wire is {} mm, at or over the {MIN_HOOK_WIRE} mm an ear piercing takes", fmt_mm(w.hook_wire))
                        } else {
                            format!("The French wire is {} mm, under the {MIN_HOOK_WIRE} mm that keeps its shape in wear", fmt_mm(w.hook_wire))
                        },
                    ));
                }
            }
        }
        _ => {}
    }
    out
}

fn post_check(w: &Worn) -> Value {
    let (d0, d1) = POST_DIAMETERS;
    let (l0, l1) = POST_LENGTHS;
    let ok = (d0 - 1e-9..=d1 + 1e-9).contains(&w.post_diameter) && (l0 - 1e-9..=l1 + 1e-9).contains(&w.post_length);
    check(
        "post",
        ok,
        if ok {
            format!(
                "The post is {} × {} mm, a size a {} back fits ({d0}–{d1} mm by {l0}–{l1} mm)",
                fmt_mm(w.post_diameter),
                fmt_mm(w.post_length),
                if w.back == Back::None { "bought" } else { w.back.name() }
            )
        } else {
            format!("The post is {} × {} mm; a bought back fits {d0}–{d1} mm posts {l0}–{l1} mm long", fmt_mm(w.post_diameter), fmt_mm(w.post_length))
        },
    )
}

/// The keys of a request that a worn piece does not use, said as notes.
pub(super) fn ignored(p: &PieceParams, given: &Map<String, Value>) -> Vec<String> {
    if !p.kind.worn() {
        return Vec::new();
    }
    let what = name(p);
    let mut out = Vec::new();
    let unused: Vec<&str> = RING_ONLY.iter().copied().filter(|k| given.get(*k).is_some_and(|v| !v.is_null())).collect();
    if unused.contains(&"size") || unused.contains(&"system") {
        out.push(format!("{what} has no ring size: `size` and `system` are kept for a ring but not used."));
    }
    let rest: Vec<String> = unused.iter().filter(|k| !matches!(**k, "size" | "system")).map(|k| format!("`{k}`")).collect();
    if !rest.is_empty() {
        out.push(format!("{what} has no band: {} {} not used.", rest.join(", "), if rest.len() == 1 { "is" } else { "are" }));
    }
    let unused_findings: &[&str] = match p.kind {
        PieceKind::Pendant => &["postDiameter", "postLength", "back", "top", "topStone", "hookWire"],
        PieceKind::Stud => {
            &["bail", "bailWire", "bailOpening", "bailWidth", "chain", "drop", "jumpRing", "jumpRingWire", "top", "topStone", "hookWire"]
        }
        _ => &["bail", "bailWire", "bailOpening", "bailWidth", "chain", "drop"],
    };
    let more: Vec<String> = unused_findings.iter().filter(|k| given.get(**k).is_some_and(|v| !v.is_null())).map(|k| format!("`{k}`")).collect();
    if !more.is_empty() {
        out.push(format!("{what} does not use {}.", more.join(", ")));
    }
    out
}

/// The piece's name in a sentence.
pub(super) fn name(p: &PieceParams) -> &'static str {
    match p.kind {
        PieceKind::Pendant => "A pendant",
        PieceKind::Stud => "A pair of studs",
        PieceKind::Drop => "A pair of drop earrings",
        _ => "A ring",
    }
}
