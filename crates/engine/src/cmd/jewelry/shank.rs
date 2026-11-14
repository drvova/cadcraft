//! Shank shapes past the round band: a drawn rail ([`super::sweep`]), a split shank, cathedral
//! shoulders, and a twisted cable ([`super::cable`]). The parameters, the refusals, the weight and
//! the cast solid's bound; `PIECE` draws them (`piece_shank.rs`) and `PIECEMESH` builds them
//! (`mesh_shank.rs`).
//!
//! # Syntax
//!
//! - `rail: {curve: handle}` (kind band): the band's path, kept by value as `{curve, points}`.
//! - `shank: {split?: 1|2|3, gap?: mm, from?: degrees, cathedral?: bool, height?: mm}` (kind
//!   solitaire): `split` arms (1 = none, the default), `gap` the metal-free space between
//!   neighbouring arms under the head (0.3–5 mm, default 1.2), `from` how far from 12 o'clock the
//!   shank starts to split and to rise (20–90°, default 50), `cathedral` arches rising to the head,
//!   `height` how far they lift it (0.3–6 mm, default 2). An object merges over the stored one key
//!   by key; `shank: null` is the plain shank.
//! - `pattern: {twist: {strands?: 2|3, turns?: whole, wire?: mm}}` (kind band): see [`super::cable`].
//!
//! # Split shank
//!
//! The band's section is cut across its width into `split` equal strips (the arms); within
//! `from` of 12 o'clock strip `i` moves along the finger by `(i − (n−1)/2)·gap·s(θ)`, where
//! `s(θ) = t²(3 − 2t)`, `t = 1 − |θ|/from`, so the arms part smoothly and stand `gap` apart under
//! the head, and touch again (the band whole) beyond `from`. Each half-plane through the finger's
//! axis cuts the same strips, only moved, so the volume is the round band's exactly:
//! `2π(r·A + M)`.
//!
//! # Cathedral
//!
//! Within `from` of 12 o'clock the band's section is lifted off the finger by `height·s(θ)`: the
//! shoulders rise in arches to the head, which stands `height` higher, and an arch opens between
//! the band and the finger under it. The volume is exact: `2π(r·A + M) + A·height·from` (the
//! integral of `s` over the arch is half its span).

use std::sync::Arc;

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::cable::{Cable, Twist};
use super::piece_params::{PieceKind, PieceParams, Profile};
use super::sweep::Rail;
use super::*;

/// The split's and the arch's defaults and limits.
pub(super) const GAP: (f64, f64, f64) = (1.2, 0.3, 5.0);
pub(super) const FROM: (f64, f64, f64) = (50.0, 20.0, 90.0);
pub(super) const HEIGHT: (f64, f64, f64) = (2.0, 0.3, 6.0);
/// The narrowest arm a bench files and casts without it bending (mm): a check, not a refusal.
pub(super) const MIN_ARM: f64 = 0.9;
/// The narrowest arm that is refused outright (mm).
const LEAST_ARM: f64 = 0.4;

/// The shank's shape: plain unless one of these is set.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct ShankShape {
    pub rail: Option<Arc<Rail>>,
    /// Arms under the head: 1 (none), 2 or 3.
    pub split: u32,
    pub gap: f64,
    /// Degrees from 12 o'clock the split and the arches start.
    pub from: f64,
    /// The arches' lift under the head, when the shoulders are cathedral.
    pub cathedral: Option<f64>,
    pub twist: Option<Twist>,
}

impl ShankShape {
    pub(super) fn plain() -> ShankShape {
        ShankShape { rail: None, split: 1, gap: GAP.0, from: FROM.0, cathedral: None, twist: None }
    }

    /// The `shank` key's part: whether it is anything but the plain shank.
    pub(super) fn shaped(&self) -> bool {
        self.split > 1 || self.cathedral.is_some()
    }

    /// Whether the band is built by this module rather than revolved.
    pub(super) fn any(&self) -> bool {
        self.rail.is_some() || self.shaped() || self.twist.is_some()
    }

    /// `from` in radians.
    pub(super) fn span(&self) -> f64 {
        self.from.to_radians()
    }

    /// How far the arches lift the head.
    pub(super) fn lift(&self) -> f64 {
        self.cathedral.unwrap_or(0.0)
    }

    /// The part of the way into the split and arch at `theta` from 12 o'clock (1 at the top).
    pub(super) fn s(&self, theta: f64) -> f64 {
        blend(theta, self.span())
    }

    /// Arm `i`'s move along the finger at `theta`.
    pub(super) fn shift(&self, i: u32, theta: f64) -> f64 {
        if self.split < 2 {
            return 0.0;
        }
        (f64::from(i) - f64::from(self.split - 1) / 2.0) * self.gap * self.s(theta)
    }

    /// The stored form of the `rail`, `shank` and `pattern` keys.
    pub(super) fn json_into(&self, o: &mut Map<String, Value>) {
        o.insert("rail".into(), self.rail.as_ref().map_or(Value::Null, |r| r.json()));
        let shank = if self.shaped() {
            json!({ "split": self.split, "gap": self.gap, "from": self.from, "cathedral": self.cathedral.is_some(), "height": self.cathedral.unwrap_or(HEIGHT.0) })
        } else {
            Value::Null
        };
        o.insert("shank".into(), shank);
        // `pattern` is shared with the generative patterns ([`super::pattern`]), which write it
        // first (false for none): a cable's twist takes its place, and only then.
        if let Some(t) = &self.twist {
            o.insert("pattern".into(), t.json());
        }
    }
}

/// `t²(3 − 2t)` with `t = 1 − |θ|/from`, θ wrapped to a half turn either side of 12 o'clock.
pub(super) fn blend(theta: f64, from: f64) -> f64 {
    if !(theta.is_finite() && from > 1e-9) {
        return 0.0;
    }
    let th = (theta + PI).rem_euclid(TAU) - PI;
    let t = 1.0 - th.abs() / from;
    if t <= 0.0 { 0.0 } else { t * t * (3.0 - 2.0 * t.min(1.0)) }
}

fn mm(cmd: &str, o: &Map<String, Value>, key: &str, (default, lo, hi): (f64, f64, f64), what: &str) -> Result<f64> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => v.as_f64().filter(|x| x.is_finite() && *x >= lo && *x <= hi).ok_or_else(|| bad(cmd, format!("`{key}` is {what}, {lo} to {hi}"))),
    }
}

/// Read the `rail`, `shank` and `pattern` keys of a piece's JSON.
pub(super) fn parse(cmd: &str, p: &Value) -> Result<ShankShape> {
    let mut out = ShankShape::plain();
    out.rail = match p.get("rail") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => None,
        Some(v @ Value::Object(_)) => Some(Arc::new(Rail::from_json(cmd, v)?)),
        Some(_) => return Err(bad(cmd, "`rail` is {curve: handle}: a closed curve of the drawing the band follows, or null")),
    };
    match p.get("shank") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => {}
        Some(Value::Object(o)) => {
            if let Some(k) = o.keys().find(|k| !matches!(k.as_str(), "split" | "gap" | "from" | "cathedral" | "height")) {
                return Err(bad(
                    cmd,
                    format!("`shank` takes split, gap, from, cathedral and height, not `{}`", k.chars().take(24).collect::<String>()),
                ));
            }
            out.split = match o.get("split").filter(|v| !v.is_null()) {
                None | Some(Value::Bool(false)) => 1,
                Some(v) => match v.as_u64().filter(|n| (1..=3).contains(n)) {
                    Some(n) => n as u32,
                    None => return Err(bad(cmd, "`split` is how many arms the shank parts into under the head: 1 (none), 2 or 3")),
                },
            };
            out.gap = mm(cmd, o, "gap", GAP, "the millimetres between neighbouring arms under the head")?;
            out.from = mm(cmd, o, "from", FROM, "the degrees from 12 o'clock where the shank starts to split or rise")?;
            let cathedral = match o.get("cathedral") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(bad(cmd, "`cathedral` is true or false")),
            };
            let height = mm(cmd, o, "height", HEIGHT, "how many millimetres the cathedral arches lift the head")?;
            out.cathedral = cathedral.then_some(height);
        }
        Some(_) => return Err(bad(cmd, "`shank` is {split, gap, from, cathedral, height}, or null for the plain shank")),
    }
    out.twist = Twist::parse(cmd, p.get("pattern"))?;
    Ok(out)
}

/// A `shank` or `pattern` change merged over the stored one, key by key (a `null` clears it).
pub(super) fn merge(old: Option<&Value>, new: &Value) -> Value {
    fn go(old: Option<&Value>, new: &Value, depth: u32) -> Value {
        match (old, new) {
            (Some(Value::Object(a)), Value::Object(b)) if depth < 3 => {
                let mut out = a.clone();
                for (k, v) in b {
                    let next = go(a.get(k), v, depth + 1);
                    out.insert(k.clone(), next);
                }
                Value::Object(out)
            }
            _ => new.clone(),
        }
    }
    go(old, new, 0)
}

/// `PIECE {rail: {curve: handle}}`: the curve read from the drawing and put in the given keys by
/// value. A rail that already carries its points is left alone.
pub(super) fn resolve(s: &Session, cmd: &str, given: &mut Map<String, Value>) -> Result<()> {
    let Some(asked) = given.get("rail").filter(|v| v.is_object()) else { return Ok(()) };
    if asked.get("points").is_some() {
        return Ok(());
    }
    let handle = asked
        .get("curve")
        .and_then(super::super::curves::handle_value)
        .ok_or_else(|| bad(cmd, "`rail` is {curve: handle}: the handle of a closed curve of the drawing"))?;
    let d = s.doc()?;
    let e = d.entity(handle).ok_or_else(|| {
        bad(cmd, format!("there is no object {} in the drawing; a piece that already has a rail keeps the one it stored", handle.hex()))
    })?;
    let rail = Rail::from_entity(cmd, e, mm_per_unit(s))?;
    given.insert("rail".into(), rail.json());
    Ok(())
}

/// A cable band's width and wall are its bundle's: a different one given with it is refused.
pub(super) fn box_given(cmd: &str, given: &Map<String, Value>, p: &PieceParams) -> Result<()> {
    if p.shape.twist.is_none() {
        return Ok(());
    }
    for (key, have) in [("width", p.width), ("wall", p.wall)] {
        if let Some(x) = given.get(key).and_then(Value::as_f64)
            && (x - have).abs() > 1e-6
        {
            return Err(bad(
                cmd,
                format!("a cable band's {key} comes from its strands ({} mm); change the wire or the strands, or take the twist off", fmt_mm(have)),
            ));
        }
    }
    Ok(())
}

/// The refusals for shapes that cannot go together, and a cable's width and wall from its strands.
pub(super) fn settle(cmd: &str, p: &mut PieceParams) -> Result<()> {
    let sh = p.shape.clone();
    let kind = p.kind.name();
    if let Some(rail) = &sh.rail {
        if p.kind != PieceKind::Band {
            return Err(bad(
                cmd,
                format!("a rail shapes a plain band (kind band); a {kind}'s head stands on a round shank — take the rail off or make it a band"),
            ));
        }
        if sh.twist.is_some() {
            return Err(bad(cmd, "a cable band follows the finger round; it does not take a rail — take one of them off"));
        }
        if p.pave.is_some() {
            return Err(bad(cmd, "pavé on a band that follows a rail is not available yet; take the pavé or the rail off"));
        }
        rail.validate(cmd, p.inner(), p.wall)?;
    }
    if sh.shaped() {
        let what = match (sh.split > 1, sh.cathedral.is_some()) {
            (true, true) => "a split cathedral shank",
            (true, false) => "a split shank",
            _ => "cathedral shoulders",
        };
        if p.kind != PieceKind::Solitaire {
            return Err(bad(cmd, format!("{what} carries a centre stone's head: it is for kind solitaire, not {kind}")));
        }
        if p.pave.is_some() {
            return Err(bad(cmd, format!("pavé on {what} is not available yet; take the pavé off or make the shank plain")));
        }
        if sh.split > 1 {
            let arm = p.width / f64::from(sh.split);
            if arm < LEAST_ARM {
                return Err(bad(
                    cmd,
                    format!(
                        "a {} mm band cannot part into {} arms: each would be {} mm wide, under {LEAST_ARM} mm; widen the band or split it in fewer",
                        fmt_mm(p.width),
                        sh.split,
                        fmt_mm(arm)
                    ),
                ));
            }
            if p.profile == Profile::Custom && !monotone(&p.section().polygon(64)) {
                return Err(bad(
                    cmd,
                    "a split shank cuts the profile across its width, and this drawn profile folds back on itself across the width; draw it so a line across the finger crosses it once on each side",
                ));
            }
        }
    }
    if let Some(t) = sh.twist {
        if p.kind != PieceKind::Band {
            return Err(bad(cmd, format!("a twisted cable is a band of its own (kind band), not a {kind}")));
        }
        if p.profile == Profile::Custom {
            return Err(bad(cmd, "a cable band is its round strands; it takes no drawn profile — take the profile or the twist off"));
        }
        if p.pave.is_some() {
            return Err(bad(cmd, "pavé on a twisted cable is not available yet; take the pavé or the twist off"));
        }
        let cable = t.lay(p.inner() / 2.0);
        if !cable.clear {
            let most = (TAU * (cable.radius - cable.e) / (f64::from(cable.strands) * cable.wire) * 0.9).floor().max(0.0);
            return Err(bad(
                cmd,
                format!(
                    "{} twists round the finger are too many for {} strands of {} mm wire: each strand would cross the next; about {most} at most fit",
                    cable.turns,
                    cable.strands,
                    fmt_mm(cable.wire)
                ),
            ));
        }
        if cable.tightest() <= cable.wire / 2.0 * 1.0001 {
            return Err(bad(
                cmd,
                format!(
                    "{} twists round the finger bend the {} mm strands more tightly than they are thick; twist fewer turns or use finer wire",
                    cable.turns,
                    fmt_mm(cable.wire)
                ),
            ));
        }
        let bundle = cable.bundle();
        if !(0.3..=10.0).contains(&bundle) {
            return Err(bad(cmd, format!("the strands make a {} mm bundle, past a band's 10 mm wall", fmt_mm(bundle))));
        }
        p.wall = bundle;
        p.width = bundle;
        p.profile = Profile::Flat;
    }
    Ok(())
}

/// Whether every line across the width crosses the outline at most twice.
fn monotone(poly: &[Vec2]) -> bool {
    let n = poly.len();
    let (lo, hi) = poly.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), q| (lo.min(q.x), hi.max(q.x)));
    (1..64).all(|k| {
        let x = lo + (hi - lo) * f64::from(k) / 64.0 + 1e-7;
        (0..n).filter(|i| matches!((poly.get(*i), poly.get((i + 1) % n)), (Some(a), Some(b)) if (a.x <= x) != (b.x <= x))).count() <= 2
    })
}

/// The cable a piece's twist lays, if it has one.
pub(super) fn cable(p: &PieceParams) -> Option<Cable> {
    p.shape.twist.map(|t| t.lay(p.inner() / 2.0))
}

/// The band's volume (mm³) when this module shapes it.
pub(super) fn volume(p: &PieceParams) -> Option<f64> {
    let sh = &p.shape;
    if let Some(c) = cable(p) {
        return Some(c.volume());
    }
    let section = p.section();
    let (a, m) = (section.area(), section.area() * section.centroid());
    if let Some(rail) = &sh.rail {
        return Some(rail.volume(p.inner(), a, m));
    }
    if sh.shaped() {
        let v = TAU * (p.inner() / 2.0 * a + m) + a * sh.lift() * sh.span();
        return Some(if v.is_finite() { v.max(0.0) } else { 0.0 });
    }
    None
}

/// The section cut across its width into `arms` equal strips (Sutherland–Hodgman against each
/// slab), each its own closed polygon in the section's frame.
pub(super) fn strips(poly: &[Vec2], width: f64, arms: u32) -> Vec<Vec<Vec2>> {
    let arms = arms.clamp(1, 3);
    (0..arms)
        .map(|i| {
            let lo = width * (f64::from(i) / f64::from(arms) - 0.5);
            let hi = width * (f64::from(i + 1) / f64::from(arms) - 0.5);
            let lo = if i == 0 { f64::NEG_INFINITY } else { lo };
            let hi = if i + 1 == arms { f64::INFINITY } else { hi };
            let keep = clip(poly, |q| q.x >= lo, lo);
            clip(&keep, |q| q.x <= hi, hi)
        })
        .collect()
}

fn clip(poly: &[Vec2], inside: impl Fn(Vec2) -> bool, x: f64) -> Vec<Vec2> {
    let n = poly.len();
    let mut out = Vec::with_capacity(n + 4);
    for i in 0..n {
        let (Some(a), Some(b)) = (poly.get(i).copied(), poly.get((i + 1) % n).copied()) else { continue };
        let cut = |a: Vec2, b: Vec2| {
            let t = if (b.x - a.x).abs() > 1e-300 { (x - a.x) / (b.x - a.x) } else { 0.0 };
            Vec2::new(x, a.y + (b.y - a.y) * t)
        };
        match (inside(a), inside(b)) {
            (true, true) => out.push(b),
            (true, false) => out.push(cut(a, b)),
            (false, true) => {
                out.push(cut(a, b));
                out.push(b);
            }
            (false, false) => {}
        }
    }
    let mut clean: Vec<Vec2> = Vec::with_capacity(out.len());
    for q in out {
        if clean.last().is_none_or(|l| l.dist(q) > 1e-9) {
            clean.push(q);
        }
    }
    while clean.len() > 3 && clean.first().zip(clean.last()).is_some_and(|(f, l)| f.dist(*l) <= 1e-9) {
        clean.pop();
    }
    clean
}

/// A split or cathedral shank in the cast solid: the point's angle round the finger gives each
/// arm's move along the finger and the arch's lift; in those coordinates the whole section (or,
/// where the arms part, the nearest strip) gives the signed distance, divided by how fast the
/// coordinates move as the angle turns, so it is 1-Lipschitz anywhere at least half the finger's
/// radius from the axis (as [`super::kinds::Taper::distance_by`] promises).
#[derive(Clone, Debug)]
pub(super) struct ShankBound {
    pub whole: super::solid::Section,
    pub strips: Vec<super::solid::Section>,
    pub shape: ShankShape,
    pub ri: f64,
    pub reach: f64,
    pub across: f64,
}

impl ShankBound {
    pub(super) fn new(shape: &ShankShape, whole: Vec<Vec2>, width: f64, ri: f64) -> ShankBound {
        let reach = ri + whole.iter().fold(0.0f64, |m, q| m.max(q.y.abs())) + shape.lift();
        let across = whole.iter().fold(0.0f64, |m, q| m.max(q.x.abs())) + f64::from(shape.split.saturating_sub(1)) / 2.0 * shape.gap;
        let strips =
            if shape.split > 1 { strips(&whole, width, shape.split).into_iter().map(super::solid::Section::new).collect() } else { Vec::new() };
        ShankBound { whole: super::solid::Section::new(whole), strips, shape: shape.clone(), ri, reach, across }
    }
    pub(super) fn distance(&self, p: Vec3) -> f64 {
        let rho = p.x.hypot(p.y);
        let theta = p.x.atan2(p.y);
        let sh = &self.shape;
        let s = sh.s(theta);
        let y = rho - self.ri - sh.lift() * s;
        let d = if sh.split > 1 && s > 0.0 {
            (0..sh.split).zip(&self.strips).map(|(i, strip)| strip.dist(Vec2::new(p.z - sh.shift(i, theta), y))).fold(f64::INFINITY, f64::min)
        } else {
            self.whole.dist(Vec2::new(p.z, y))
        };
        // The fastest the coordinates move per radian: s′ is at most 1.5/from.
        let from = sh.span().max(1e-3);
        let speed = 1.5 / from * (f64::from(sh.split.saturating_sub(1)) / 2.0 * sh.gap).hypot(sh.lift());
        let speed = speed / (self.ri / 2.0).max(0.5);
        d / (1.0 + speed * speed).sqrt()
    }
    pub(super) fn bounds(&self) -> (Vec3, Vec3) {
        (Vec3::new(-self.reach, -self.reach, -self.across), Vec3::new(self.reach, self.reach, self.across))
    }
}
