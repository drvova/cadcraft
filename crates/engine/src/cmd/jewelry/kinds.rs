//! The ring types past the band, the solitaire, the three-stone and the eternity: their numbers,
//! shared by the sheet (`PIECE`) and the solid (`PIECEMESH`).
//!
//! # Half eternity (`kind: "halfeternity"`)
//!
//! An eternity band's row ([`super::piece_params::Row`]: the stones' depth, the circle their
//! girdles lie on, the seat) across the top half only, the bottom of the shank left plain so the
//! ring can be sized. The stones are packed at the least angular pitch that keeps `gap` of metal
//! between neighbours' girdles, `α = 2·(atan(m/2R) + asin(gap/2ρ))` (`m` the stone, `R` the girdle
//! circle, `ρ = √(R² + m²/4)`), centred on 12 o'clock; as many as keep every centre within 90° of
//! it fit, `⌊π/α⌋ + 1`, and that many are set unless `count` asks for fewer.
//!
//! # Tapered shanks: the dome ring and the signet
//!
//! A dome ring (`kind: "dome"`) is a band much wider and thicker at the top than at the bottom.
//! `width` and `wall` are the shank at the bottom (6 o'clock) and `topWidth`, `topWall` the band
//! at 12 o'clock; between them the band's section is the bottom section scaled across by
//! `sx(θ) = 1 + (topWidth/width − 1)·f(θ)` and up by `sy(θ) = 1 + (topWall/wall − 1)·f(θ)`, with
//! `f(θ) = ((1 + cos θ)/2)²` (θ from 12 o'clock): flat-ish at the bottom, swelling over the top
//! third. The finger side is unchanged, so the size is the band's. The volume is exact:
//! `V = ∫ A·sx·sy·(r + c·sy) dθ` over the turn (`A` the bottom section's area, `c` its centroid's
//! height, `r` the finger's radius), integrated by the trapezoid rule on 720 steps, which is exact
//! for the trigonometric polynomial the integrand is.
//!
//! A signet (`kind: "signet"`) is a tapered shank under a flat **face**: a plate whose top is the
//! plane `topWall` over the finger at 12 o'clock and whose underside is [`FACE_SEAT`] over the
//! finger, its outline `faceLength` along the finger by `faceWidth` around it, `face` round (a
//! circle of `faceWidth`), oval (an ellipse), cushion (a rectangle with corners of 30 % of the
//! lesser side) or rectangle (corners of 5 %). The shank under it tapers to `topWidth` (default
//! 60 % of the face's length) and `topWall − FACE_SKIN`. Its weight is the shank's exact volume and
//! the plate's, less where they overlap (found column by column across the face, numerically).

use cadcraft_geom::{PI, TAU, Vec2, Vec3};

use super::heads::{polygon_distance, rect_distance};
use super::piece_params::{PieceKind, PieceParams, Row, Section};
use super::*;

// ---------------------------------------------------------------------------------------------
// Half eternity
// ---------------------------------------------------------------------------------------------

/// A half eternity's row: the eternity row's seat, packed across the top.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct HalfRow {
    pub row: Row,
    /// The angle between neighbouring stones' centres (radians).
    pub pitch: f64,
    /// The most stones that keep every centre within 90° of 12 o'clock; none when no stone fits.
    pub most: u32,
}

/// The least plain shank a half eternity leaves at the bottom for sizing (mm, along the inside).
pub(super) const RESIZE_PLAIN: f64 = 10.0;
/// How much the inside's circumference changes for one US size (mm): 0.8128 mm of diameter.
pub(super) const US_STEP_CIRCUMFERENCE: f64 = 0.8128 * PI;

impl HalfRow {
    pub(super) fn of(row: Row, gap: f64) -> HalfRow {
        let mut out = HalfRow { row, pitch: PI, most: 0 };
        let (m, r) = (row.melee, row.radius);
        if !(m.is_finite() && r.is_finite() && gap.is_finite() && m > 0.0 && r > m / 2.0 && gap >= 0.0) {
            return out;
        }
        let reach = r.hypot(m / 2.0);
        let pitch = 2.0 * ((m / (2.0 * r)).atan() + (gap / (2.0 * reach)).clamp(0.0, 1.0).asin());
        if !(pitch.is_finite() && pitch > 1e-6) {
            return out;
        }
        out.pitch = pitch;
        let most = (PI / pitch + 1e-9).floor() + 1.0;
        out.most = if most.is_finite() && most >= 1.0 { most.min(f64::from(super::piece_params::MAX_PIECE_STONES)) as u32 } else { 0 };
        out
    }
    /// How many stones are set: the count asked for, else the most that fit.
    pub(super) fn count(&self, asked: Option<u32>) -> u32 {
        asked.unwrap_or(self.most).clamp(1, super::piece_params::MAX_PIECE_STONES)
    }
    /// The angle of stone `i` of `n` from 12 o'clock, clockwise.
    pub(super) fn angle(&self, i: u32, n: u32) -> f64 {
        (f64::from(i) - (f64::from(n.max(1)) - 1.0) / 2.0) * self.pitch
    }
    /// Its outward direction in the ring's plane (+x right, +y to 12 o'clock).
    pub(super) fn out(&self, i: u32, n: u32) -> Vec2 {
        let a = self.angle(i, n);
        Vec2::new(a.sin(), a.cos())
    }
    /// The metal between two neighbours' girdles (mm).
    pub(super) fn between(&self) -> f64 {
        let reach = self.row.radius.hypot(self.row.melee / 2.0);
        2.0 * reach * (self.pitch / 2.0 - (self.row.melee / (2.0 * self.row.radius)).atan()).sin()
    }
    /// The plain shank between the end stones' outer girdle edges around the bottom, along the
    /// finger of radius `ri` (mm).
    pub(super) fn plain(&self, n: u32, ri: f64) -> f64 {
        let last = self.angle(n.saturating_sub(1), n).abs();
        let lean = (self.row.melee / (2.0 * self.row.radius)).atan();
        ((TAU - 2.0 * (last + lean)) * ri).max(0.0)
    }
}

// ---------------------------------------------------------------------------------------------
// Tapered shanks
// ---------------------------------------------------------------------------------------------

/// How a shank tapers: the bottom (`width`, `wall`) to the top (`top_width`, `top_wall`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Taper {
    pub width: f64,
    pub wall: f64,
    pub top_width: f64,
    pub top_wall: f64,
}

/// Steps the shank's volume is integrated in.
const TAPER_STEPS: usize = 720;

impl Taper {
    /// How much of the way to the top the shank is at `theta` from 12 o'clock (1 at the top, 0 at
    /// the bottom).
    pub(super) fn f(theta: f64) -> f64 {
        let half = (1.0 + theta.cos()) / 2.0;
        half * half
    }
    /// The scale across and up of the bottom section at `theta`.
    pub(super) fn scale(&self, theta: f64) -> (f64, f64) {
        let f = Taper::f(theta);
        let ratio = |top: f64, bottom: f64| if bottom > 1e-9 && top.is_finite() { top / bottom } else { 1.0 };
        (1.0 + (ratio(self.top_width, self.width) - 1.0) * f, 1.0 + (ratio(self.top_wall, self.wall) - 1.0) * f)
    }
    /// The least scale up: where the shank is thinnest.
    pub(super) fn least_up(&self) -> f64 {
        let (_, top) = self.scale(0.0);
        top.min(1.0)
    }
    /// The volume of the bottom `section` swept round a finger of radius `ri`, scaled as it goes.
    pub(super) fn volume(&self, section: &Section, ri: f64) -> f64 {
        let (a, c) = (section.area(), section.centroid());
        let step = TAU / TAPER_STEPS as f64;
        let sum: f64 = (0..TAPER_STEPS)
            .map(|k| {
                let (sx, sy) = self.scale(step * k as f64);
                a * sx * sy * (ri + c * sy)
            })
            .sum();
        let v = sum * step;
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }
    /// The radius of the outside in the middle of the width at `theta`.
    pub(super) fn crown_at(&self, section: &Section, ri: f64, theta: f64) -> f64 {
        ri + section.height_at(0.0) * self.scale(theta).1
    }
    /// The outside's height over the finger at `theta`, `z` along the finger.
    pub(super) fn height_at(&self, section: &Section, theta: f64, z: f64) -> Option<f64> {
        let (sx, sy) = self.scale(theta);
        let x = z / sx;
        (x.abs() <= section.width / 2.0 + 1e-12).then(|| section.height_at(x) * sy)
    }
    /// A signed-distance bound for the shank (negative inside): the section's distance at the
    /// point's angle, divided by how fast the section moves as the angle turns, so it is
    /// 1-Lipschitz. `polygon` is the bottom section as [`Section::polygon`] gives it (`(x, height)`).
    #[allow(dead_code, reason = "the solid builder's signed-distance bound for a tapered shank")]
    pub(super) fn distance(&self, polygon: &[Vec2], ri: f64, p: Vec3) -> f64 {
        let rho = p.x.hypot(p.y);
        let theta = p.x.atan2(p.y);
        let (sx, sy) = self.scale(theta);
        if !(sx > 1e-9 && sy > 1e-9) {
            return f64::INFINITY;
        }
        // In the scaled section's own coordinates, then back to millimetres: dividing by the
        // larger scale keeps the bound under the true distance.
        let q = Vec2::new(p.z / sx, (rho - ri) / sy);
        let d = polygon_distance(q, polygon) * sx.min(sy);
        // How far the section's boundary moves per millimetre round the ring.
        let speed = (self.top_width - self.width).abs().max((self.top_wall - self.wall).abs()) / ri.max(1.0);
        d / (1.0 + speed * speed).sqrt()
    }
}

// ---------------------------------------------------------------------------------------------
// The signet's face
// ---------------------------------------------------------------------------------------------

/// The shape of a signet's face.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FaceShape {
    Round,
    Oval,
    Cushion,
    Rectangle,
}

/// The face's shapes, as a refusal lists them.
pub(super) const FACES: &str = "round, oval, cushion or rectangle";
/// The face plate's underside over the finger (mm): it keeps the finger hole round.
pub(super) const FACE_SEAT: f64 = 0.3;
/// How far under the face's plane the shank's crown stops (mm).
pub(super) const FACE_SKIN: f64 = 0.4;
/// How deep an engraving is cut (mm); the face keeps a cast wall under it.
pub(super) const ENGRAVE_DEPTH: f64 = 0.4;

impl FaceShape {
    pub(super) fn name(self) -> &'static str {
        match self {
            FaceShape::Round => "round",
            FaceShape::Oval => "oval",
            FaceShape::Cushion => "cushion",
            FaceShape::Rectangle => "rectangle",
        }
    }
    pub(super) fn parse(cmd: &str, v: Option<&serde_json::Value>) -> Result<FaceShape> {
        match v.filter(|v| !v.is_null()) {
            None => Ok(FaceShape::Oval),
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("round" | "circle") => Ok(FaceShape::Round),
                Some("oval") => Ok(FaceShape::Oval),
                Some("cushion") => Ok(FaceShape::Cushion),
                Some("rectangle" | "rect" | "square") => Ok(FaceShape::Rectangle),
                _ => Err(bad(cmd, format!("`face` must be {FACES}"))),
            },
        }
    }
    /// A rounded rectangle's corner radius as a fraction of the lesser side.
    fn corner(self) -> f64 {
        match self {
            FaceShape::Cushion => 0.3,
            FaceShape::Rectangle => 0.05,
            _ => 0.5,
        }
    }
}

/// A signet's face: `length` along the finger (z), `width` around (x), between `bottom` and `top`
/// over the ring's centre (heights along +y).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Face {
    pub shape: FaceShape,
    pub length: f64,
    pub width: f64,
    pub bottom: f64,
    pub top: f64,
}

impl Face {
    /// The face's size as it is built: a round is `width` both ways.
    pub(super) fn size(&self) -> (f64, f64) {
        if self.shape == FaceShape::Round { (self.width, self.width) } else { (self.length, self.width) }
    }
    /// The plate's thickness.
    pub(super) fn thickness(&self) -> f64 {
        self.top - self.bottom
    }
    /// The outline in its plane as `(x around, z along)`, counter-clockwise, `n` points (at least 16).
    pub(super) fn outline(&self, n: usize) -> Vec<Vec2> {
        let n = n.clamp(16, 1024);
        let (l, w) = self.size();
        let (a, b) = (w / 2.0, l / 2.0);
        match self.shape {
            FaceShape::Round | FaceShape::Oval => (0..n)
                .map(|k| {
                    let t = TAU * k as f64 / n as f64;
                    Vec2::new(a * t.cos(), b * t.sin())
                })
                .collect(),
            FaceShape::Cushion | FaceShape::Rectangle => {
                let r = self.shape.corner() * a.min(b).max(0.0) * 2.0;
                let r = r.min(a.min(b));
                let per = (n / 4).max(4);
                let mut out = Vec::with_capacity(4 * per);
                for (q, (cx, cy)) in [(a - r, b - r), (r - a, b - r), (r - a, r - b), (a - r, r - b)].into_iter().enumerate() {
                    for k in 0..per {
                        let t = PI / 2.0 * (q as f64 + k as f64 / (per - 1).max(1) as f64);
                        out.push(Vec2::new(cx + r * t.cos(), cy + r * t.sin()));
                    }
                }
                out
            }
        }
    }
    /// The outline's area, exactly.
    #[allow(dead_code, reason = "the analytic reference the face is tested against, and the solid builder's")]
    pub(super) fn area(&self) -> f64 {
        let (l, w) = self.size();
        match self.shape {
            FaceShape::Round | FaceShape::Oval => PI * l * w / 4.0,
            FaceShape::Cushion | FaceShape::Rectangle => {
                let (a, b) = (w / 2.0, l / 2.0);
                let r = (self.shape.corner() * a.min(b) * 2.0).min(a.min(b));
                l * w - (4.0 - PI) * r * r
            }
        }
    }
    /// Whether `(x, z)` is on the face's plan.
    pub(super) fn contains(&self, x: f64, z: f64) -> bool {
        let (l, w) = self.size();
        let (a, b) = (w / 2.0, l / 2.0);
        match self.shape {
            FaceShape::Round | FaceShape::Oval => a > 0.0 && b > 0.0 && (x / a).powi(2) + (z / b).powi(2) <= 1.0,
            FaceShape::Cushion | FaceShape::Rectangle => {
                let r = (self.shape.corner() * a.min(b) * 2.0).min(a.min(b));
                rect_distance(x, z, -a + r, a - r, -b + r, b - r) <= r
            }
        }
    }
    /// `signet_face_sdf`: a signed-distance bound for the plate (negative inside, 1-Lipschitz):
    /// the larger of the distance to its outline in plan and to its two faces.
    #[allow(dead_code, reason = "the solid builder's signed-distance bound (`signet_face_sdf`)")]
    pub(crate) fn distance(&self, p: Vec3, outline: &[Vec2]) -> f64 {
        let plan = polygon_distance(Vec2::new(p.x, p.z), outline);
        plan.max(self.bottom - p.y).max(p.y - self.top)
    }
}

/// The plate's volume outside the shank: column by column across the face, the part of
/// `[bottom, top]` the shank does not fill.
pub(super) fn face_volume_outside(face: &Face, taper: &Taper, section: &Section, ri: f64) -> f64 {
    const N: usize = 96;
    const STEPS: usize = 48;
    let (l, w) = face.size();
    let (dx, dz) = (w / N as f64, l / N as f64);
    let dy = face.thickness() / STEPS as f64;
    if !(dx > 0.0 && dz > 0.0 && dy > 0.0 && dx.is_finite() && dz.is_finite() && dy.is_finite()) {
        return 0.0;
    }
    let mut cells = 0usize;
    for i in 0..N {
        let x = -w / 2.0 + (i as f64 + 0.5) * dx;
        for j in 0..N {
            let z = -l / 2.0 + (j as f64 + 0.5) * dz;
            if !face.contains(x, z) {
                continue;
            }
            for k in 0..STEPS {
                let y = face.bottom + (k as f64 + 0.5) * dy;
                let (rho, theta) = (x.hypot(y), x.atan2(y));
                let inside_shank = taper.height_at(section, theta, z).is_some_and(|h| rho >= ri + section.inside_at(z) && rho <= ri + h);
                if !inside_shank {
                    cells += 1;
                }
            }
        }
    }
    cells as f64 * dx * dz * dy
}

impl PieceParams {
    /// Whether the band tapers: a dome ring's or a signet's shank.
    pub(super) fn tapered(&self) -> bool {
        matches!(self.kind, PieceKind::Dome | PieceKind::Signet)
    }

    /// The shank's taper: the bottom is `width` × `wall`; the top is `topWidth` × `topWall` on a
    /// dome ring (defaults 3.5 × the width, up to 30 mm, and 1.8 × the wall, up to 10 mm), and on a
    /// signet `topWidth` (default 60 % of the face's length, at least the width) by the face's
    /// height less [`FACE_SKIN`]. A band that does not taper is its own top.
    pub(super) fn taper(&self) -> Taper {
        let mut t = Taper { width: self.width, wall: self.wall, top_width: self.width, top_wall: self.wall };
        match self.kind {
            PieceKind::Dome => {
                t.top_width = self.top_width.unwrap_or((3.5 * self.width).min(30.0));
                t.top_wall = self.top_wall.unwrap_or((1.8 * self.wall).min(10.0));
            }
            PieceKind::Signet => {
                t.top_width = self.top_width.unwrap_or((0.6 * self.face_size().0).max(self.width).min(30.0));
                t.top_wall = (self.face_height() - FACE_SKIN).max(0.3);
            }
            _ => {}
        }
        t
    }

    /// A signet face's length (along the finger) and width (around): a round is `faceWidth` both ways.
    pub(super) fn face_size(&self) -> (f64, f64) {
        if self.face == FaceShape::Round { (self.face_width, self.face_width) } else { (self.face_length, self.face_width) }
    }

    /// A signet face's height over the finger at 12 o'clock: `topWall`, or the wall and 1.2 mm
    /// (at least 2.6 mm), up to 10 mm.
    pub(super) fn face_height(&self) -> f64 {
        self.top_wall.unwrap_or((self.wall + 1.2).max(2.6)).min(10.0)
    }

    /// A signet's face.
    pub(super) fn signet_face(&self) -> Face {
        let ri = self.inner() / 2.0;
        Face { shape: self.face, length: self.face_length, width: self.face_width, bottom: ri + FACE_SEAT, top: ri + self.face_height() }
    }

    /// The tapered band's volume (mm³), and a signet's face where it stands out of the shank.
    pub(super) fn taper_volume(&self) -> f64 {
        let (section, ri) = (self.section(), self.inner() / 2.0);
        let taper = self.taper();
        let mut v = taper.volume(&section, ri);
        if self.kind == PieceKind::Signet {
            v += face_volume_outside(&self.signet_face(), &taper, &section, ri);
        }
        v
    }

    /// A half eternity's row.
    pub(super) fn half_row(&self) -> HalfRow {
        HalfRow::of(self.eternity_row(), self.gap)
    }

    /// `band_sdf` for a tapered shank: a signed-distance bound (negative inside, 1-Lipschitz) in
    /// the solid's frame (finger along Z, 12 o'clock at +Y).
    #[allow(dead_code, reason = "the solid builder's signed-distance bound for a tapered shank")]
    pub(crate) fn taper_distance(&self, p: Vec3) -> f64 {
        let polygon = self.section().polygon(64);
        self.taper().distance(&polygon, self.inner() / 2.0, p)
    }

    /// `signet_face_sdf`: a signed-distance bound for a signet's face plate (negative inside,
    /// 1-Lipschitz), in the solid's frame; `None` for any other kind.
    #[allow(dead_code, reason = "the solid builder's signed-distance bound (`signet_face_sdf`)")]
    pub(crate) fn signet_face_distance(&self, p: Vec3) -> Option<f64> {
        (self.kind == PieceKind::Signet).then(|| {
            let face = self.signet_face();
            face.distance(p, &face.outline(128))
        })
    }
}
