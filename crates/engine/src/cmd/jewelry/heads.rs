//! The heads a centre stone stands in: prongs (the default, in [`super::piece_params`]) and a
//! **bezel** — a metal collar around the girdle.
//!
//! # The bezel, as this engine builds it
//!
//! Seen in section across the collar (outward from the girdle, `d`, against the height over the
//! girdle's middle plane, `h`), a bezel is two rectangles:
//!
//! - **The wall**: from the girdle (`d = 0`) out to the wall thickness `W` (`bezelWall`, default
//!   [`BEZEL_WALL`] = 0.6 mm), and from under the band's outside up to the **lip** `t`
//!   (`bezelHeight`, the collar's height over the top of the girdle) — the metal a setter burnishes
//!   over the crown.
//! - **The seat ledge**: a step [`ledge`] wide inside the girdle, from the same bottom up to the
//!   girdle's underside, that the stone rests on. Inside the ledge the collar is open below: the
//!   pavilion shows through and light reaches it.
//!
//! The collar follows the girdle outline of the cut (any cut `GEM` draws), offset outward by `d`.
//! The default lip is 12 % of the stone's lesser dimension, between 0.4 and 1.0 mm, and never more
//! than 70 % of the crown (so the table stays clear) — our approximation of bench practice, where
//! 0.5–1 mm of collar is burnished over the crown and a gold collar is 0.5–0.8 mm thick. The
//! ledge is 6 % of the lesser dimension, between 0.2 and 0.5 mm.
//!
//! Two checks: the wall is at least [`MIN_BEZEL_WALL`] (0.4 mm; thinner tears when it is pushed
//! over), and the lip covers the girdle by at least [`MIN_BEZEL_LIP`] (0.3 mm; less does not hold
//! the stone) without reaching the table (the crown height).
//!
//! # The weight
//!
//! The collar's volume is its section swept along the girdle: `V = P·A + 2π·M`, where `P` is the
//! girdle's perimeter, `A` the section's area and `M` its first moment about the girdle (`d`) —
//! exact for any convex girdle (a round, an oval, a cushion), where an outward offset by `d`
//! lengthens the outline by `2π·d`; about right for a heart's cleft. It is reported apart from the
//! band (`metal.bezelGrams`), as the prongs are not weighed.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};

use super::piece_params::{CROWN, CULET_CLEAR, GIRDLE, Head, PieceKind, PieceParams, girdle_outline, girdle_rise, head_polygon, table_ratio};
use super::*;

/// How a stone is held.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum HeadStyle {
    /// Prongs on the girdle (the default).
    Prong,
    /// A metal collar around the girdle.
    Bezel,
}

impl HeadStyle {
    pub(super) fn name(self) -> &'static str {
        match self {
            HeadStyle::Prong => "prong",
            HeadStyle::Bezel => "bezel",
        }
    }
    pub(super) fn parse(cmd: &str, v: Option<&serde_json::Value>) -> Result<HeadStyle> {
        match v.filter(|v| !v.is_null()) {
            None => Ok(HeadStyle::Prong),
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("prong" | "prongs") => Ok(HeadStyle::Prong),
                Some("bezel") => Ok(HeadStyle::Bezel),
                _ => Err(bad(cmd, "`head` must be prong or bezel")),
            },
        }
    }
}

/// A bezel's wall when none is given (mm).
pub(super) const BEZEL_WALL: f64 = 0.6;
/// The thinnest bezel wall a setter can push over without tearing it (mm): the `bezel-wall` check.
pub(super) const MIN_BEZEL_WALL: f64 = 0.4;
/// The least collar over the girdle that holds a stone (mm): the `bezel-lip` check.
pub(super) const MIN_BEZEL_LIP: f64 = 0.3;
/// How far the collar reaches into the band under its lowest point (mm), so the two join.
pub(super) const BEZEL_SINK: f64 = 0.2;

/// The lip when none is given, for a stone of this lesser dimension and crown height.
pub(super) fn usual_lip(lesser: f64, crown: f64) -> f64 {
    let lip = (0.12 * lesser).clamp(0.4, 1.0);
    if crown.is_finite() && crown > 0.0 { lip.min(0.7 * crown) } else { lip }
}

/// The seat ledge's width inside the girdle.
pub(super) fn ledge(lesser: f64) -> f64 {
    if lesser.is_finite() { (0.06 * lesser).clamp(0.2, 0.5) } else { 0.2 }
}

/// A bezel's section, in the stone's frame: `d` outward from the girdle, `h` over the girdle's
/// middle plane.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Bezel {
    /// The wall's thickness.
    pub wall: f64,
    /// How far the collar stands over the top of the girdle.
    pub lip: f64,
    /// The seat ledge's width inside the girdle.
    pub ledge: f64,
    /// Half the girdle's thickness: the ledge is at `-girdle_half`, the lip's top at `girdle_half + lip`.
    pub girdle_half: f64,
    /// The crown's height over the top of the girdle (where the table is).
    pub crown: f64,
    /// The collar's bottom, under the girdle's middle plane (negative: into the band).
    pub bottom: f64,
}

impl Bezel {
    /// The top of the collar over the girdle's middle plane.
    pub(super) fn top(&self) -> f64 {
        self.girdle_half + self.lip
    }
    /// The seat's height (the girdle's underside).
    pub(super) fn seat(&self) -> f64 {
        -self.girdle_half
    }
    /// The section as a closed polygon `(d, h)`: up the inside, over the top, down the outside —
    /// the order the solid sweeps it in.
    pub(super) fn profile(&self) -> [Vec2; 6] {
        let (b, s, t) = (self.bottom, self.seat(), self.top());
        [Vec2::new(-self.ledge, b), Vec2::new(-self.ledge, s), Vec2::new(0.0, s), Vec2::new(0.0, t), Vec2::new(self.wall, t), Vec2::new(self.wall, b)]
    }
    /// The section's area and its first moment about the girdle (`d = 0`).
    pub(super) fn area_and_moment(&self) -> (f64, f64) {
        let wall_h = (self.top() - self.bottom).max(0.0);
        let ledge_h = (self.seat() - self.bottom).max(0.0);
        let area = self.wall * wall_h + self.ledge * ledge_h;
        let moment = self.wall * self.wall / 2.0 * wall_h - self.ledge * self.ledge / 2.0 * ledge_h;
        (area, moment)
    }
    /// The collar's volume around a convex girdle of this perimeter (mm³).
    pub(super) fn volume(&self, perimeter: f64) -> f64 {
        let (a, m) = self.area_and_moment();
        let v = perimeter * a + TAU * m;
        if v.is_finite() { v.max(0.0) } else { 0.0 }
    }
    /// The signed distance from `(d, h)` to the section: negative inside, 1-Lipschitz (the least
    /// of two rectangles' distances).
    pub(super) fn section_distance(&self, d: f64, h: f64) -> f64 {
        let wall = rect_distance(d, h, 0.0, self.wall, self.bottom, self.top());
        let ledge = rect_distance(d, h, -self.ledge, 0.0, self.bottom, self.seat());
        wall.min(ledge)
    }
    /// Whether the wall is thick enough, and the words.
    pub(super) fn wall_check(&self) -> (bool, String) {
        let ok = self.wall + 1e-9 >= MIN_BEZEL_WALL;
        let words = if ok {
            format!("The bezel wall is {} mm, at or over the {MIN_BEZEL_WALL} mm a setter can push over", fmt_mm(self.wall))
        } else {
            format!("The bezel wall is {} mm, under the {MIN_BEZEL_WALL} mm a setter can push over without tearing it", fmt_mm(self.wall))
        };
        (ok, words)
    }
    /// Whether the collar holds the stone without hiding its table, and the words.
    pub(super) fn lip_check(&self) -> (bool, String) {
        if self.lip + 1e-9 < MIN_BEZEL_LIP {
            return (
                false,
                format!(
                    "The bezel stands {} mm over the girdle, under the {MIN_BEZEL_LIP} mm of collar it takes to hold the stone",
                    fmt_mm(self.lip)
                ),
            );
        }
        if self.lip >= self.crown - 1e-9 {
            return (
                false,
                format!(
                    "The bezel stands {} mm over the girdle and the crown is {} mm high: the collar reaches the table",
                    fmt_mm(self.lip),
                    fmt_mm(self.crown)
                ),
            );
        }
        (
            true,
            format!(
                "The bezel covers the girdle by {} mm (at least {MIN_BEZEL_LIP} mm) and stops {} mm under the table",
                fmt_mm(self.lip),
                fmt_mm(self.crown - self.lip)
            ),
        )
    }
}

/// The signed distance from `(x, y)` to the rectangle `[x0, x1] × [y0, y1]`: exact, negative inside.
pub(super) fn rect_distance(x: f64, y: f64, x0: f64, x1: f64, y0: f64, y1: f64) -> f64 {
    let (cx, cy, hx, hy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (x1 - x0).abs() / 2.0, (y1 - y0).abs() / 2.0);
    let (qx, qy) = ((x - cx).abs() - hx, (y - cy).abs() - hy);
    let outside = qx.max(0.0).hypot(qy.max(0.0));
    outside + qx.max(qy).min(0.0)
}

/// The signed distance from `q` to a closed polygon: exact, negative inside, whichever way it runs.
pub(super) fn polygon_distance(q: Vec2, poly: &[Vec2]) -> f64 {
    let n = poly.len();
    if n < 3 || !q.is_finite() {
        return f64::INFINITY;
    }
    let mut least = f64::INFINITY;
    let mut inside = false;
    for i in 0..n {
        let (Some(a), Some(b)) = (poly.get(i).copied(), poly.get((i + 1) % n).copied()) else { continue };
        let ab = b - a;
        let len2 = ab.len2();
        let t = if len2 > 1e-24 { ((q - a).dot(ab) / len2).clamp(0.0, 1.0) } else { 0.0 };
        least = least.min(q.dist(a + ab * t));
        if (a.y > q.y) != (b.y > q.y) && q.x < a.x + (q.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            inside = !inside;
        }
    }
    if inside { -least } else { least }
}

/// The length of a closed polygon.
pub(super) fn perimeter(poly: &[Vec2]) -> f64 {
    poly.iter().zip(poly.iter().cycle().skip(1)).take(poly.len()).map(|(a, b)| a.dist(*b)).sum()
}

/// A bezel as the solid builder places it: the stone's girdle plane (origin `o`, `u` across the
/// stone, `v` along it, `w` out through the table), the girdle outline in that plane and the
/// collar's section.
#[derive(Clone, Debug)]
pub(crate) struct BezelBound {
    pub o: Vec3,
    pub u: Vec3,
    pub v: Vec3,
    pub w: Vec3,
    pub girdle: Vec<Vec2>,
    pub bezel: Bezel,
}

impl BezelBound {
    /// `bezel_sdf`: a signed-distance bound for the collar — negative inside, positive outside,
    /// never more than the true distance (1-Lipschitz): the section's distance at (the point's
    /// signed distance to the girdle outline, its height over the girdle plane).
    pub(crate) fn distance(&self, p: Vec3) -> f64 {
        let r = p - self.o;
        let (x, y, h) = (r.dot(self.u), r.dot(self.v), r.dot(self.w));
        let d = polygon_distance(Vec2::new(x, y), &self.girdle);
        if !d.is_finite() {
            return f64::INFINITY;
        }
        self.bezel.section_distance(d, h)
    }
}

impl PieceParams {
    /// Whether the piece's stones stand in bezels: a solitaire or three-stone ring asked for them.
    pub(super) fn bezeled(&self) -> bool {
        self.head == HeadStyle::Bezel && matches!(self.kind, PieceKind::Solitaire | PieceKind::ThreeStone)
    }

    /// The bezel a stone of this cut, size and depth stands in, or `None` for prongs. Its bottom
    /// reaches [`BEZEL_SINK`] into the band under the collar's outer edge (the band's outside
    /// falls away from 12 o'clock under a wide stone), and never nearer the finger than 0.2 mm.
    pub(super) fn bezel_of(&self, cut: Option<&gem::Cut>, length: f64, width: f64, depth: f64) -> Option<Bezel> {
        if !self.bezeled() {
            return None;
        }
        let cab = cut.is_some_and(|c| c.name == "cabochon");
        let lesser = length.min(width);
        let (girdle, crown, below) = if cab { (0.0, depth, 0.0) } else { (GIRDLE * depth, CROWN * depth, girdle_rise(depth)) };
        let wall = self.bezel_wall.filter(|w| w.is_finite()).unwrap_or(BEZEL_WALL);
        let lip = self.bezel_height.filter(|h| h.is_finite()).unwrap_or_else(|| usual_lip(lesser, crown));
        let top = self.crown();
        let reach = (width / 2.0 + wall).min(0.95 * top).max(0.0);
        let fall = top - (top * top - reach * reach).max(0.0).sqrt();
        let sink = (fall + BEZEL_SINK).clamp(0.0, (top - self.inner() / 2.0 - 0.2).max(0.0));
        Some(Bezel { wall, lip, ledge: ledge(lesser), girdle_half: girdle / 2.0, crown, bottom: -(CULET_CLEAR + below) - sink })
    }

    /// A head seen along the finger, as two heads' clearance is measured: the prongs running in
    /// to their feet ([`head_polygon`]), or a bezel's collar standing straight down to the band.
    pub(super) fn head_outline(&self, cut: &gem::Cut, width: f64, head: &Head) -> Vec<Vec2> {
        match head.bezel {
            None => head_polygon(cut, width, head.depth, head.clear),
            Some(b) => {
                let (a, below) = (width / 2.0, head.below);
                // The stone's table and crown, the collar's top, and its sides down to the band.
                let table = a * table_ratio(cut);
                let top = (below + b.top()).min(head.depth);
                vec![
                    Vec2::new(-a, -head.clear),
                    Vec2::new(a, -head.clear),
                    Vec2::new(a, top),
                    Vec2::new(table, head.depth.max(top)),
                    Vec2::new(-table, head.depth.max(top)),
                    Vec2::new(-a, top),
                ]
            }
        }
    }

    /// The collar's volume around a stone's girdle (mm³): `V = P·A + 2π·M` ([`Bezel::volume`]).
    pub(super) fn bezel_volume_of(&self, cut: &gem::Cut, length: f64, width: f64, bezel: &Bezel) -> f64 {
        let perimeter = if cut.is_circle(length, width) {
            PI * width
        } else {
            girdle_outline(cut, length, width).map_or(PI * (length + width) / 2.0, |pts| perimeter(&pts))
        };
        bezel.volume(perimeter)
    }

    /// Every bezel's collar in the piece (the centre's, and a three-stone ring's two sides'), mm³.
    pub(super) fn bezel_volume(&self) -> f64 {
        let Some(cut) = self.cut_data() else { return 0.0 };
        let head = self.head();
        let mut v = head.bezel.map_or(0.0, |b| self.bezel_volume_of(cut, self.stone_length, self.stone_width, &b));
        if self.kind == PieceKind::ThreeStone
            && let Some(side_cut) = self.side_cut_data()
        {
            let sides = self.sides();
            v += 2.0 * sides.head.bezel.map_or(0.0, |b| self.bezel_volume_of(side_cut, sides.length, sides.width, &b));
        }
        v
    }

    /// The collars' weight in grams (none without bezels).
    pub(super) fn bezel_grams(&self) -> f64 {
        self.bezel_volume() / 1000.0 * self.density
    }

    /// The bezels as the solid builder places them ([`BezelBound::distance`] is `bezel_sdf`): the
    /// centre stone's at +Y, and a three-stone ring's side stones' along their radii. A round's
    /// girdle is sampled in 96 points, any other cut is its own outline.
    #[allow(dead_code, reason = "the solid builder's signed-distance bound (`bezel_sdf`)")]
    pub(crate) fn bezel_bounds(&self) -> Vec<BezelBound> {
        let mut out = Vec::new();
        let Some(cut) = self.cut_data() else { return out };
        let top = self.crown();
        let girdle = |cut: &gem::Cut, length: f64, width: f64| -> Vec<Vec2> {
            if cut.is_circle(length, width) {
                (0..96).map(|k| Vec2::from_angle(TAU * k as f64 / 96.0) * (width / 2.0)).collect()
            } else {
                girdle_outline(cut, length, width).unwrap_or_default()
            }
        };
        let place = |out_dir: Vec2, head: &Head| {
            let w = Vec3::new(out_dir.x, out_dir.y, 0.0);
            (w * (top + head.girdle_height()), Vec3::new(out_dir.y, -out_dir.x, 0.0), Vec3::new(0.0, 0.0, -1.0), w)
        };
        let head = self.head();
        if let Some(bezel) = head.bezel {
            let (o, u, v, w) = place(Vec2::new(0.0, 1.0), &head);
            out.push(BezelBound { o, u, v, w, girdle: girdle(cut, self.stone_length, self.stone_width), bezel });
        }
        if self.kind == PieceKind::ThreeStone
            && let Some(side_cut) = self.side_cut_data()
        {
            let sides = self.sides();
            if let Some(bezel) = sides.head.bezel {
                for side in [1.0, -1.0] {
                    let (o, u, v, w) = place(sides.out(side), &sides.head);
                    out.push(BezelBound { o, u, v, w, girdle: girdle(side_cut, sides.length, sides.width), bezel });
                }
            }
        }
        out
    }
}
