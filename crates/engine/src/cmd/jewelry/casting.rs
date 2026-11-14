//! What `STLOUT` adds for the caster beyond the piece itself: a sprue merged into the metal, and a
//! uniform scale that allows for the metal's shrinkage as it cools.
//!
//! **Sprue.** `sprue: {diameter?, length?, at?}` (or `true` for the defaults) adds a round sprue
//! standing straight out from the shank: `at` degrees clockwise from 12 o'clock seen from +Z
//! (default 180, the bottom of the shank, opposite the head), in the middle of the width. It
//! starts half way into the wall (so it merges with the band and leaves no seam) and stands
//! `length` beyond the band's outside at the bottom. The defaults — [`SPRUE_DIAMETER`] mm across
//! and [`SPRUE_LENGTH`] mm long — are our approximation of a usual feed sprue for a ring cast in
//! a flask, not a foundry's rule: a heavy piece wants a thicker one, a caster's tree a shorter
//! one. A sprue that comes within [`SPRUE_CLEAR`] of a stone or of any seat (a seat, its bore or
//! its hole) is refused: move it with `at`, or make it thinner.
//!
//! **Shrinkage.** `shrink: percent` (0–10, default 0) scales the whole solid, sprue included, up
//! about the finger's centre by `1 + percent / 100`, so the casting comes out the drawn size after
//! the metal shrinks as it cools. The reply's volume and grams stay the piece's own (the size it
//! is drawn, which is what the cast weighs once it has shrunk).

use cadcraft_geom::Vec3;
use serde_json::{Value, json};

use super::super::*;
use super::mesh::PieceMesh;
use super::piece_params::PieceParams;
use super::solid::{Axes, Prim};

/// The default sprue's diameter, mm (our approximation of a usual ring sprue).
pub(super) const SPRUE_DIAMETER: f64 = 2.5;
/// The default sprue's length beyond the band's outside, mm.
pub(super) const SPRUE_LENGTH: f64 = 6.0;
/// The least room between the sprue and a stone or a seat, mm.
pub(super) const SPRUE_CLEAR: f64 = 0.3;
/// The most shrinkage allowance, percent.
pub(super) const MAX_SHRINK: f64 = 10.0;

/// A sprue as asked.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Sprue {
    pub diameter: f64,
    pub length: f64,
    /// Degrees clockwise from 12 o'clock.
    pub at: f64,
}

fn number(cmd: &str, v: &Value, key: &str, lo: f64, hi: f64, default: f64) -> Result<f64> {
    match v.get(key).filter(|x| !x.is_null()) {
        None => Ok(default),
        Some(x) => match x.as_f64() {
            Some(n) if n.is_finite() && (lo..=hi).contains(&n) => Ok(n),
            _ => Err(bad(cmd, format!("`sprue.{key}` is a number from {lo} to {hi}"))),
        },
    }
}

impl Sprue {
    /// `sprue` from the parameters: absent, null or false → none; true → the defaults.
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Option<Sprue>> {
        match p.get("sprue") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => Ok(None),
            Some(Value::Bool(true)) => Ok(Some(Sprue { diameter: SPRUE_DIAMETER, length: SPRUE_LENGTH, at: 180.0 })),
            Some(v @ Value::Object(_)) => Ok(Some(Sprue {
                diameter: number(cmd, v, "diameter", 0.5, 8.0, SPRUE_DIAMETER)?,
                length: number(cmd, v, "length", 0.5, 40.0, SPRUE_LENGTH)?,
                at: number(cmd, v, "at", -360.0, 360.0, 180.0)?,
            })),
            Some(_) => Err(bad(cmd, "`sprue` is true, false or {diameter?: mm 0.5–8, length?: mm 0.5–40, at?: degrees clockwise from 12 o'clock}")),
        }
    }

    /// The way it stands out from the finger's axis (unit, in the ring's plane).
    fn out(&self) -> Vec3 {
        let a = self.at.to_radians();
        Vec3::new(a.sin(), a.cos(), 0.0)
    }

    /// The sprue as a primitive of the merged solid, and how far it stands out of the band.
    pub(super) fn prim(&self, piece: &PieceParams) -> Prim {
        let ri = (piece.inner() / 2.0).max(0.5);
        let wall = piece.section().height_at(0.0).max(0.05);
        let w = self.out();
        let axes = Axes { o: Vec3::ZERO, u: Vec3::Z, v: w.cross(Vec3::Z), w };
        Prim::Cylinder { axes, r: self.diameter / 2.0, lo: ri + 0.5 * wall, hi: ri + wall + self.length }
    }

    /// Why the sprue may not stand where it is asked: it comes within [`SPRUE_CLEAR`] of a stone
    /// or of a seat. Its surface is sampled (sides and end) against every seat cut, and every
    /// stone vertex is measured against it.
    pub(super) fn clash(&self, prim: &Prim, mesh: &PieceMesh) -> Option<String> {
        let Prim::Cylinder { axes, r, lo, hi } = prim else { return None };
        let near_stone =
            mesh.meshes.iter().filter(|m| m.part == "stone").flat_map(|m| m.positions.iter()).map(|q| prim.eval(*q)).fold(f64::INFINITY, f64::min);
        if near_stone < SPRUE_CLEAR {
            return Some(format!("the sprue at {}° comes within {SPRUE_CLEAR} mm of a stone", fmt_deg(self.at)));
        }
        let (around, along) = (24usize, 16usize);
        let mut samples = Vec::with_capacity(around * (along + 4));
        for i in 0..around {
            let t = std::f64::consts::TAU * i as f64 / around as f64;
            let (c, s) = (t.cos(), t.sin());
            for j in 0..=along {
                let h = lo + (hi - lo) * j as f64 / along as f64;
                samples.push(axes.o + axes.u * (r * c) + axes.v * (r * s) + axes.w * h);
            }
            for k in 1..4 {
                let rr = r * k as f64 / 4.0;
                samples.push(axes.o + axes.u * (rr * c) + axes.v * (rr * s) + axes.w * *hi);
            }
        }
        let near_seat = mesh.csg.cut.iter().flat_map(|q| samples.iter().map(move |p| q.eval(*p))).fold(f64::INFINITY, f64::min);
        (near_seat < SPRUE_CLEAR).then(|| format!("the sprue at {}° comes within {SPRUE_CLEAR} mm of a stone's seat", fmt_deg(self.at)))
    }

    pub(super) fn json(&self) -> Value {
        json!({ "diameter": self.diameter, "length": self.length, "at": self.at })
    }

    /// The sprue's volume out of the band, mm³ (a cylinder `length` long): what is cut off.
    pub(super) fn volume(&self) -> f64 {
        std::f64::consts::PI * (self.diameter / 2.0).powi(2) * self.length
    }
}

fn fmt_deg(a: f64) -> String {
    let r = (a * 10.0).round() / 10.0;
    if r.fract() == 0.0 { format!("{r:.0}") } else { format!("{r}") }
}

/// `shrink` from the parameters: a percentage 0–[`MAX_SHRINK`], default 0.
pub(super) fn shrink(cmd: &str, p: &Value) -> Result<f64> {
    match p.get("shrink").filter(|x| !x.is_null()) {
        None => Ok(0.0),
        Some(x) => match x.as_f64() {
            Some(n) if n.is_finite() && (0.0..=MAX_SHRINK).contains(&n) => Ok(n),
            _ => Err(bad(cmd, format!("`shrink` is a percentage from 0 to {MAX_SHRINK}"))),
        },
    }
}
