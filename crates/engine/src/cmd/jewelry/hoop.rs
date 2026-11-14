//! **Hoop earrings** (`PIECE {kind: hoop}`): a pair of wire hoops, each closed by a hinged post
//! or a click-top, optionally set with pavé or a channel along the front of the hoop. The sheet
//! (`PIECE`), the solid (`PIECEMESH`, `STLOUT`), the weight and the checks all read the one hoop
//! worked out here. Every figure is millimetres.
//!
//! # The hoop
//!
//! A hoop is a section swept round a circle: `hoopDiameter` across the outside (default 20),
//! `hoopThickness` from the inside to the outside (default 2), `hoopWidth` along its axis
//! (default the thickness; a round or tube section is always as wide as it is thick). The
//! section (`hoopSection`) is:
//!
//! - `round` (default): a round wire.
//! - `square`: a rectangle, thickness by width.
//! - `knife`: a knife edge, flat inside, two faces meeting at a ridge on the outside [`KNIFE`]
//!   of the thickness high (as a knife band's profile).
//! - `tube`: a round tube, its wall `hoopWall` (default [`TUBE_WALL`]); light, and the post runs
//!   into its bore.
//!
//! The frame is a ring's: the hoop lies in the XY plane about the Z axis, its top (where it
//! closes) at +Y, angles clockwise from the top seen from +Z. The **front** of the hoop as it is
//! worn is the +X side, from the top round to the bottom (180°): the side that faces forward when
//! the post passes through the ear.
//!
//! # The closure (`closure`)
//!
//! - `post` (default): a hinged post. The hoop is open at the top by `hoopGap` (default 1 mm,
//!   measured along the chord between the two ends' middles); a straight post of `postDiameter`
//!   (default 0.8 mm) runs from [`INTO`] inside one end across the gap and into a hole in the
//!   other end [`HOLE_CLEARANCE`] wider than the post and `INTO + 0.3` mm deep.
//! - `click`: a click-top: the hoop is whole, its hinged section runs from a hinge knuckle at the
//!   top (a barrel across the wire, [`KNUCKLE_OVER`] proud of it all round) back to the click's
//!   seam [`SEAM_ANGLE`] behind the top. The seam is cut at the bench, not in the cast solid.
//!
//! # Pavé and channel (`pave`)
//!
//! `pave` is a band's (`pave_band`): its layouts, rows, melee, gap, spans and graduation, laid
//! on the hoop's outside as on a band whose finger is the hoop's inside circle and whose section
//! is the hoop's (a round or tube wire's outside is the half-round of a dome band, a square's is
//! flat, a knife's the knife's). Its angles are the hoop's: 12 o'clock is the top, so
//! `{from: 0, to: 180, symmetric: false}` is the front arc from the closure to the bottom; a
//! symmetric span is mirrored onto the back. Stones stay clear of the closure as a ring's pavé
//! stays clear of the head ([`closure_edge`]): the post's hole or the knuckle, and the gap.
//!
//! # Weight
//!
//! One hoop's metal is the section's exact area swept round the arc at its centroid (Pappus,
//! less the gap), less the post's hole, plus the post's run across the gap (the rest of it is in
//! the ends) and, for a click-top, the knuckle's metal outside the wire (measured on a grid of
//! samples through the barrel). The stones' seats are not taken off, as a band's are not.
//! `metal.grams` is the pair's.
//!
//! # Checks
//!
//! - `hoop-wall`: a solid wire at least [`MIN_WIRE`] (0.8 mm) at its thinnest (the thickness or
//!   the width; a knife's sides), a tube's wall at least [`MIN_TUBE_WALL`] (0.3 mm).
//! - `post`: the post is 0.7–1.0 mm (what an ear piercing takes), and its hole leaves at least
//!   [`HOLE_METAL`] of metal round it in the end it goes into (a tube's bore must take it); a
//!   click-top has no post and passes.
//! - `pave` (with `pave`), `channel-lip` and `channel-wall` (with a channel), `calibrated`, and
//!   with a click-top and pavé, `click-seam`: no stone across the click's seam.
//!
//! The numbers are this project's approximation of usual bench figures, not a cited standard.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::piece_params::{PieceParams, Profile, Section};
use super::*;

/// The usual hoop.
pub(super) const DIAMETER: f64 = 20.0;
pub(super) const THICKNESS: f64 = 2.0;
pub(super) const GAP: f64 = 1.0;
/// A tube's usual wall, and the least that casts and keeps its shape.
pub(super) const TUBE_WALL: f64 = 0.35;
pub(super) const MIN_TUBE_WALL: f64 = 0.3;
/// The thinnest solid wire a hoop is cast in.
pub(super) const MIN_WIRE: f64 = 0.8;
/// A knife section's ridge, as a fraction of the thickness.
pub(super) const KNIFE: f64 = 0.6;
/// How far a tube's bore stops short of each end: the end is closed with solid metal, which
/// holds the post and takes its hole.
pub(super) const TUBE_CAP: f64 = 1.0;
/// How far the post reaches into each end.
pub(super) const INTO: f64 = 1.5;
/// How much wider than the post its hole is, and how much deeper than the post reaches.
pub(super) const HOLE_CLEARANCE: f64 = 0.1;
pub(super) const HOLE_DEEPER: f64 = 0.3;
/// The least metal round the post's hole in the end it goes into.
pub(super) const HOLE_METAL: f64 = 0.25;
/// A click-top's knuckle: how far it stands proud of the wire, and how far behind the top the
/// click's seam is (degrees).
pub(super) const KNUCKLE_OVER: f64 = 0.2;
pub(super) const SEAM_ANGLE: f64 = 50.0;
/// Points round a round section.
const ROUND_POINTS: usize = 32;

/// A hoop's wire section.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(super) enum HoopSection {
    #[default]
    Round,
    Square,
    Knife,
    Tube,
}

impl HoopSection {
    pub(super) fn name(self) -> &'static str {
        match self {
            HoopSection::Round => "round",
            HoopSection::Square => "square",
            HoopSection::Knife => "knife",
            HoopSection::Tube => "tube",
        }
    }
}

/// How a hoop closes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(super) enum Closure {
    #[default]
    Post,
    Click,
}

impl Closure {
    pub(super) fn name(self) -> &'static str {
        match self {
            Closure::Post => "post",
            Closure::Click => "click",
        }
    }
}

/// A hoop's parameters as given, read whatever the kind (so changing the kind keeps them).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct HoopSpec {
    pub diameter: f64,
    pub thickness: f64,
    /// Along the axis; `None` for the thickness.
    pub width: Option<f64>,
    pub section: HoopSection,
    /// A tube's wall; `None` for [`TUBE_WALL`].
    pub wall: Option<f64>,
    pub gap: f64,
    pub closure: Closure,
}

impl Default for HoopSpec {
    fn default() -> Self {
        HoopSpec { diameter: DIAMETER, thickness: THICKNESS, width: None, section: HoopSection::Round, wall: None, gap: GAP, closure: Closure::Post }
    }
}

fn mm(cmd: &str, p: &Value, key: &str, min: f64, max: f64) -> Result<Option<f64>> {
    match p.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= min && *x <= max)
            .map(Some)
            .ok_or_else(|| bad(cmd, format!("`{key}` must be a number of millimetres from {min} to {max}"))),
    }
}

impl HoopSpec {
    /// Read `hoopDiameter`, `hoopThickness`, `hoopWidth`, `hoopSection`, `hoopWall`, `hoopGap`
    /// and `closure`.
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<HoopSpec> {
        let d = HoopSpec::default();
        let section = match p.get("hoopSection").filter(|v| !v.is_null()) {
            None => HoopSection::Round,
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("round") => HoopSection::Round,
                Some("square") => HoopSection::Square,
                Some("knife" | "knife-edge") => HoopSection::Knife,
                Some("tube" | "hollow") => HoopSection::Tube,
                _ => return Err(bad(cmd, "`hoopSection` must be round, square, knife or tube")),
            },
        };
        let closure = match p.get("closure").filter(|v| !v.is_null()) {
            None => Closure::Post,
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("post" | "hinge" | "hinged" | "hinged-post") => Closure::Post,
                Some("click" | "click-top" | "latch" | "clicker") => Closure::Click,
                _ => return Err(bad(cmd, "`closure` must be post (a hinged post) or click (a click-top)")),
            },
        };
        Ok(HoopSpec {
            diameter: mm(cmd, p, "hoopDiameter", 6.0, 80.0)?.unwrap_or(d.diameter),
            thickness: mm(cmd, p, "hoopThickness", 0.5, 8.0)?.unwrap_or(d.thickness),
            width: mm(cmd, p, "hoopWidth", 0.5, 12.0)?,
            section,
            wall: mm(cmd, p, "hoopWall", 0.1, 3.0)?,
            gap: mm(cmd, p, "hoopGap", 0.3, 10.0)?.unwrap_or(d.gap),
            closure,
        })
    }

    /// The keys as `PIECE` reports them.
    pub(super) fn json_into(&self, o: &mut Map<String, Value>) {
        o.insert("hoopDiameter".into(), json!(self.diameter));
        o.insert("hoopThickness".into(), json!(self.thickness));
        o.insert("hoopWidth".into(), json!(self.width));
        o.insert("hoopSection".into(), json!(self.section.name()));
        o.insert("hoopWall".into(), json!(self.wall));
        o.insert("hoopGap".into(), json!(self.gap));
        o.insert("closure".into(), json!(self.closure.name()));
    }
}

/// What makes a hoop impossible, refused before anything is drawn.
pub(super) fn refuse(cmd: &str, p: &PieceParams) -> Result<()> {
    let h = &p.hoop;
    if h.thickness > h.diameter / 2.0 - 2.0 + 1e-9 {
        return Err(bad(
            cmd,
            format!(
                "a {} mm hoop leaves no opening for a {} mm wire: give `hoopThickness` at most {} mm (half the diameter less 2 mm)",
                fmt_mm(h.diameter),
                fmt_mm(h.thickness),
                fmt_mm(h.diameter / 2.0 - 2.0)
            ),
        ));
    }
    if h.section == HoopSection::Tube && h.wall.unwrap_or(TUBE_WALL) >= h.thickness / 2.0 - 0.05 {
        return Err(bad(
            cmd,
            format!(
                "a tube's wall must leave a bore: give `hoopWall` under {} mm for a {} mm tube",
                fmt_mm(h.thickness / 2.0 - 0.05),
                fmt_mm(h.thickness)
            ),
        ));
    }
    if h.closure == Closure::Post && h.gap >= 0.9 * (h.diameter - h.thickness) {
        return Err(bad(cmd, format!("`hoopGap` must be under {} mm on a {} mm hoop", fmt_mm(0.9 * (h.diameter - h.thickness)), fmt_mm(h.diameter))));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// The hoop worked out
// ---------------------------------------------------------------------------------------------

/// One hoop, every number safe to build from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Hoop {
    pub ri: f64,
    pub ro: f64,
    /// The section's middle's radius.
    pub rc: f64,
    pub t: f64,
    pub w: f64,
    /// Half the gap's angle at the top (0 for a click-top).
    pub alpha: f64,
    pub section: HoopSection,
    /// A tube's bore diameter (0 otherwise).
    pub bore: f64,
    /// A knife section's ridge height.
    pub ridge: f64,
    pub closure: Closure,
    pub post: f64,
    pub gap: f64,
}

fn fin(x: f64, lo: f64, hi: f64, default: f64) -> f64 {
    if x.is_finite() { x.clamp(lo, hi) } else { default }
}

impl Hoop {
    pub(super) fn of(p: &PieceParams) -> Hoop {
        let h = &p.hoop;
        let d = fin(h.diameter, 6.0, 80.0, DIAMETER);
        let t = fin(h.thickness, 0.5, (d / 2.0 - 2.0).max(0.5), THICKNESS);
        let round = matches!(h.section, HoopSection::Round | HoopSection::Tube);
        let w = if round { t } else { fin(h.width.unwrap_or(t), 0.5, 12.0, t) };
        let ro = d / 2.0;
        let ri = ro - t;
        let rc = ri + t / 2.0;
        let gap = fin(h.gap, 0.3, 0.9 * (d - t), GAP);
        let alpha = if h.closure == Closure::Post { (gap / (2.0 * rc)).clamp(0.0, 0.9).asin() } else { 0.0 };
        let wall = fin(h.wall.unwrap_or(TUBE_WALL), 0.1, (t / 2.0 - 0.05).max(0.1), TUBE_WALL);
        Hoop {
            ri,
            ro,
            rc,
            t,
            w,
            alpha,
            section: h.section,
            bore: if h.section == HoopSection::Tube { (t - 2.0 * wall).max(0.0) } else { 0.0 },
            ridge: if h.section == HoopSection::Knife { KNIFE * t } else { 0.0 },
            closure: h.closure,
            post: fin(p.worn.post_diameter, 0.3, 3.0, 0.8),
            gap,
        }
    }

    /// How far the bore stops short of each end: an open tube's capped ends (nothing for a solid
    /// wire or a closed hoop).
    pub(super) fn capped(&self) -> f64 {
        if self.bore > 0.0 && self.alpha > 0.0 { TUBE_CAP.min(0.25 * self.rc * self.arc()) } else { 0.0 }
    }

    /// The tube's wall (0 for a solid wire).
    pub(super) fn tube_wall(&self) -> f64 {
        if self.section == HoopSection::Tube { (self.t - self.bore) / 2.0 } else { 0.0 }
    }

    /// The section's outline in `(r, z)`, counter-clockwise: its outside for a tube.
    pub(super) fn outline(&self) -> Vec<Vec2> {
        let (ri, ro, hw) = (self.ri, self.ro, self.w / 2.0);
        match self.section {
            HoopSection::Round | HoopSection::Tube => circle(Vec2::new(self.rc, 0.0), self.t / 2.0, ROUND_POINTS),
            HoopSection::Square => vec![Vec2::new(ri, -hw), Vec2::new(ro, -hw), Vec2::new(ro, hw), Vec2::new(ri, hw)],
            HoopSection::Knife => {
                vec![Vec2::new(ri, -hw), Vec2::new(ro - self.ridge, -hw), Vec2::new(ro, 0.0), Vec2::new(ro - self.ridge, hw), Vec2::new(ri, hw)]
            }
        }
    }

    /// A tube's bore in `(r, z)`, counter-clockwise; nothing for a solid wire.
    pub(super) fn bore_outline(&self) -> Option<Vec<Vec2>> {
        (self.section == HoopSection::Tube && self.bore > 0.0).then(|| circle(Vec2::new(self.rc, 0.0), self.bore / 2.0, ROUND_POINTS))
    }

    /// The section's area.
    pub(super) fn area(&self) -> f64 {
        let a = match self.section {
            HoopSection::Round => PI * self.t * self.t / 4.0,
            HoopSection::Tube => PI * (self.t * self.t - self.bore * self.bore) / 4.0,
            HoopSection::Square => self.t * self.w,
            HoopSection::Knife => self.w * (self.t - self.ridge) + self.w / 2.0 * self.ridge,
        };
        if a.is_finite() { a.max(0.0) } else { 0.0 }
    }

    /// The radius of the section's centroid.
    pub(super) fn centroid(&self) -> f64 {
        match self.section {
            HoopSection::Knife => {
                let (base, peak) = (self.t - self.ridge, self.ridge);
                let (a1, a2) = (self.w * base, self.w / 2.0 * peak);
                let m = a1 * base / 2.0 + a2 * (base + peak / 3.0);
                if a1 + a2 > 0.0 { self.ri + m / (a1 + a2) } else { self.rc }
            }
            _ => self.rc,
        }
    }

    /// The section's signed distance at `(r, z)` (exact for a round wire and a tube, a polygon's
    /// for a square or a knife).
    pub(super) fn section_distance(&self, q: Vec2, poly: &super::solid::Section) -> f64 {
        match self.section {
            HoopSection::Round => (q - Vec2::new(self.rc, 0.0)).len() - self.t / 2.0,
            HoopSection::Tube => {
                let d = (q - Vec2::new(self.rc, 0.0)).len();
                (d - self.t / 2.0).max(self.bore / 2.0 - d)
            }
            _ => poly.dist(q),
        }
    }

    /// Where each end's middle is (`α` either side of the top), as points of the ring's plane.
    pub(super) fn ends(&self) -> (Vec3, Vec3) {
        let at = |a: f64| Vec3::new(self.rc * a.sin(), self.rc * a.cos(), 0.0);
        (at(self.alpha), at(-self.alpha))
    }

    /// The hinged post as a straight wire: from `INTO` inside the end at `+α` (where it is hinged)
    /// across the gap and `INTO` into the other; `None` for a click-top.
    pub(super) fn post_wire(&self) -> Option<(Vec3, Vec3)> {
        if self.closure != Closure::Post || self.alpha <= 0.0 {
            return None;
        }
        let (a, b) = self.ends();
        let dir = (b - a).normalized();
        Some((a - dir * INTO, b + dir * INTO))
    }

    /// The post's hole in the end at `−α`: its mouth (the end's middle), its direction into the
    /// end, its radius and its depth.
    pub(super) fn hole(&self) -> Option<(Vec3, Vec3, f64, f64)> {
        if self.closure != Closure::Post || self.alpha <= 0.0 {
            return None;
        }
        let (a, b) = self.ends();
        let dir = (b - a).normalized();
        Some((b, dir, (self.post + HOLE_CLEARANCE) / 2.0, INTO + HOLE_DEEPER))
    }

    /// A click-top's knuckle: its centre (on the wire's middle at the top), its radius and half
    /// its length along the axis.
    pub(super) fn knuckle(&self) -> Option<(Vec3, f64, f64)> {
        (self.closure == Closure::Click).then(|| (Vec3::new(0.0, self.rc, 0.0), self.t / 2.0 + KNUCKLE_OVER, self.w / 2.0 + KNUCKLE_OVER))
    }

    /// The angle (radians, clockwise from the top) of a click-top's seam.
    pub(super) fn seam(&self) -> f64 {
        -SEAM_ANGLE.to_radians()
    }

    /// The hoop's arc, radians.
    pub(super) fn arc(&self) -> f64 {
        TAU - 2.0 * self.alpha
    }
}

fn circle(c: Vec2, r: f64, n: usize) -> Vec<Vec2> {
    (0..n).map(|k| TAU * k as f64 / n as f64).map(|a| c + Vec2::new(r * a.cos(), r * a.sin())).collect()
}

/// The hoop's own section as a polygon the solid measures.
pub(super) fn section_poly(h: &Hoop) -> super::solid::Section {
    super::solid::Section::new(h.outline())
}

/// Whether a point (in the hoop's frame) is metal of the hoop's wire, gap and all.
fn in_wire(h: &Hoop, poly: &super::solid::Section, q: Vec3) -> bool {
    let r = q.x.hypot(q.y);
    if h.section_distance(Vec2::new(r, q.z), poly) > 0.0 {
        return false;
    }
    let theta = q.x.atan2(q.y);
    theta.abs() >= h.alpha
}

/// A click-top knuckle's metal outside the wire, mm³ (sampled on a grid through the barrel).
fn knuckle_extra(h: &Hoop) -> f64 {
    let Some((c, r, half)) = h.knuckle() else { return 0.0 };
    let poly = section_poly(h);
    let n = 16usize;
    let (mut inside, mut outside) = (0usize, 0usize);
    for i in 0..n {
        for j in 0..n {
            let (x, y) = ((i as f64 + 0.5) / n as f64 * 2.0 - 1.0, (j as f64 + 0.5) / n as f64 * 2.0 - 1.0);
            if x * x + y * y > 1.0 {
                continue;
            }
            for k in 0..n {
                let z = ((k as f64 + 0.5) / n as f64 * 2.0 - 1.0) * half;
                let q = c + Vec3::new(x * r, y * r, z);
                if in_wire(h, &poly, q) { inside += 1 } else { outside += 1 }
            }
        }
    }
    let total = inside + outside;
    if total == 0 {
        return 0.0;
    }
    PI * r * r * 2.0 * half * outside as f64 / total as f64
}

/// One hoop's metal, mm³ (the module's note).
pub(super) fn volume(p: &PieceParams) -> f64 {
    let h = Hoop::of(p);
    let mut v = h.area() * h.centroid() * h.arc();
    let capped = h.capped();
    // An open tube's ends are closed with solid metal for `TUBE_CAP`.
    v += 2.0 * PI * (h.bore / 2.0).powi(2) * capped;
    if let Some((_, _, rh, depth)) = h.hole() {
        // In a tube, the hole goes through the end's cap and on into the bore.
        let through = if capped > 0.0 { depth.min(capped) } else { depth };
        v -= PI * rh * rh * through;
    }
    if h.post_wire().is_some() {
        let exposed = 2.0 * h.rc * h.alpha.sin();
        v += PI * (h.post / 2.0).powi(2) * exposed;
        if capped > 0.0 {
            // In the fixed end, the post runs on past the cap into the bore.
            v += PI * (h.post / 2.0).min(h.bore / 2.0).powi(2) * (INTO - capped).max(0.0);
        }
    }
    v += knuckle_extra(&h);
    if v.is_finite() { v.max(0.0) } else { 0.0 }
}

/// The band `pave_band` lays a hoop's stones on: the hoop's section as a band's, and its inside
/// radius as the finger's.
pub(super) fn pave_surface(p: &PieceParams) -> (Section, f64) {
    let h = Hoop::of(p);
    let section = match h.section {
        HoopSection::Round | HoopSection::Tube => Section::dome(h.w, h.t),
        HoopSection::Square => Section::flat(h.w, h.t),
        HoopSection::Knife => Section { width: h.w, wall: h.t, profile: Profile::Knife, by: h.ridge, custom: None },
    };
    (section, h.ri)
}

/// Where a hoop's pavé must start beside the closure: the angle from the top of the first
/// stone's girdle edge, clear of the gap and the post's hole (or the knuckle) by `gap` and the
/// pavé's head clearance.
pub(super) fn closure_edge(p: &PieceParams, surf: &super::pave_band::Surface, gap: f64) -> f64 {
    let h = Hoop::of(p);
    let clear = gap.max(super::pave_band::PAVE_HEAD_CLEAR);
    let top = surf.ri + surf.section.height_at(0.0);
    let reach = match h.closure {
        // The hole's far end, round the hoop from the top.
        Closure::Post => h.rc * h.alpha + INTO + HOLE_DEEPER + h.post / 2.0,
        Closure::Click => h.t / 2.0 + KNUCKLE_OVER,
    };
    let a = reach / h.rc.max(1e-6) + clear / top.max(1e-6);
    if a.is_finite() { a.clamp(1e-6, PI / 2.0) } else { 1e-6 }
}

/// Where the pair stands: each hoop's centre along X.
pub(super) fn pair_offsets(p: &PieceParams) -> [f64; 2] {
    let h = Hoop::of(p);
    let dx = h.ro + super::findings::PAIR_GAP / 2.0;
    [-dx, dx]
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

fn check(id: &str, ok: bool, message: String) -> Value {
    json!({ "id": id, "ok": ok, "message": message })
}

/// The hoop's own checks: its wall and its post (the pavé's are the band's).
pub(super) fn checks(p: &PieceParams) -> Vec<Value> {
    let h = Hoop::of(p);
    let mut out = Vec::new();
    let wall = match h.section {
        HoopSection::Tube => {
            let wall = h.tube_wall();
            let ok = wall + 1e-9 >= MIN_TUBE_WALL;
            check(
                "hoop-wall",
                ok,
                if ok {
                    format!("The tube's wall is {} mm, at or over the {MIN_TUBE_WALL} mm a tube hoop keeps its shape with", fmt_mm(wall))
                } else {
                    format!("The tube's wall is {} mm, under the {MIN_TUBE_WALL} mm that keeps a tube hoop from denting", fmt_mm(wall))
                },
            )
        }
        _ => {
            let thin = match h.section {
                HoopSection::Knife => h.w.min(h.t - h.ridge).min(h.t),
                HoopSection::Square => h.w.min(h.t),
                _ => h.t,
            };
            let ok = thin + 1e-9 >= MIN_WIRE;
            check(
                "hoop-wall",
                ok,
                if ok {
                    format!("The {} wire is {} mm at its thinnest, at or over the {MIN_WIRE} mm a hoop is cast in", h.section.name(), fmt_mm(thin))
                } else {
                    format!("The {} wire is {} mm at its thinnest, under the {MIN_WIRE} mm a hoop casts and wears at", h.section.name(), fmt_mm(thin))
                },
            )
        }
    };
    out.push(wall);
    let (d0, d1) = super::findings::POST_DIAMETERS;
    out.push(match h.closure {
        Closure::Click => check("post", true, "A click-top has no post: its hinged section passes through the ear and clicks shut".to_string()),
        Closure::Post => {
            let room = match h.section {
                HoopSection::Tube => h.bore,
                HoopSection::Knife => h.w.min(h.t - h.ridge),
                HoopSection::Square => h.w.min(h.t),
                HoopSection::Round => h.t,
            };
            let hole = h.post + HOLE_CLEARANCE;
            let sized = (d0 - 1e-9..=d1 + 1e-9).contains(&h.post);
            let fits = if h.section == HoopSection::Tube { hole <= room + 1e-9 } else { hole + 2.0 * HOLE_METAL <= room + 1e-9 };
            let ok = sized && fits;
            let words = if !sized {
                format!("The hinged post is {} mm; an ear piercing takes a post of {d0}–{d1} mm", fmt_mm(h.post))
            } else if !fits && h.section == HoopSection::Tube {
                format!("The post's {} mm hole does not fit the tube's {} mm bore: a thinner post or a thicker tube", fmt_mm(hole), fmt_mm(room))
            } else if !fits {
                format!(
                    "The post's {} mm hole leaves under {HOLE_METAL} mm of metal in the {} mm wire: give the wire at least {} mm",
                    fmt_mm(hole),
                    fmt_mm(room),
                    fmt_mm(hole + 2.0 * HOLE_METAL)
                )
            } else {
                format!(
                    "The hinged post is {} mm ({d0}–{d1} mm takes an ear piercing) across a {} mm gap, into a hole the wire holds with metal to spare",
                    fmt_mm(h.post),
                    fmt_mm(h.gap)
                )
            };
            check("post", ok, words)
        }
    });
    out
}

/// A click-top's seam against the pavé: no stone across it.
pub(super) fn seam_check(p: &PieceParams, stones: &[super::pave_band::PaveStone]) -> Option<Value> {
    let h = Hoop::of(p);
    if h.closure != Closure::Click || stones.is_empty() {
        return None;
    }
    let seam = h.seam().rem_euclid(TAU);
    let over = stones.iter().filter(|s| {
        let rho = s.girdle.xy().len().max(1e-6);
        let half = (s.diameter / 2.0 + 0.2) / rho;
        let d = (s.angle.rem_euclid(TAU) - seam).rem_euclid(TAU);
        d.min(TAU - d) <= half
    });
    let n = over.count();
    Some(check(
        "click-seam",
        n == 0,
        if n == 0 {
            format!("No stone crosses the click's seam {SEAM_ANGLE}° behind the top")
        } else {
            format!("{n} stone(s) cross the click's seam {SEAM_ANGLE}° behind the top: keep the pavé to the front, or off the hinged section")
        },
    ))
}

/// The cast solid's part: one hoop's wire, its gap cut out, centred on `c` ([`Hoop`]'s frame
/// moved there).
#[derive(Clone, Debug)]
pub(super) struct HoopBound {
    pub c: Vec3,
    pub hoop: Hoop,
    pub poly: super::solid::Section,
}

impl HoopBound {
    pub(super) fn new(hoop: Hoop, c: Vec3) -> HoopBound {
        HoopBound { c, hoop, poly: section_poly(&hoop) }
    }
    /// Negative inside, 1-Lipschitz: the swept section, less the wedge of the gap at the top.
    pub(super) fn distance(&self, p: Vec3) -> f64 {
        let q = p - self.c;
        let d = self.hoop.section_distance(Vec2::new(q.x.hypot(q.y), q.z), &self.poly);
        let a = self.hoop.alpha;
        if a <= 0.0 {
            return d;
        }
        let wedge = |a: f64| q.dot(Vec3::new(a.cos(), -a.sin(), 0.0)).max(q.dot(Vec3::new(-a.cos(), -a.sin(), 0.0)));
        let capped = self.hoop.capped();
        if capped > 0.0 {
            // The outside, less the bore outside the capped ends, less the gap.
            let r = q.x.hypot(q.y);
            let outer = (Vec2::new(r, q.z) - Vec2::new(self.hoop.rc, 0.0)).len() - self.hoop.t / 2.0;
            let bore = ((Vec2::new(r, q.z) - Vec2::new(self.hoop.rc, 0.0)).len() - self.hoop.bore / 2.0).max(-wedge(a + capped / self.hoop.rc));
            return outer.max(-bore).max(-wedge(a));
        }
        d.max(-wedge(a))
    }
    pub(super) fn bounds(&self) -> (Vec3, Vec3) {
        let (r, z) = (self.hoop.ro + 0.01, self.hoop.w.max(self.hoop.t) / 2.0 + 0.01);
        (self.c - Vec3::new(r, r, z), self.c + Vec3::new(r, r, z))
    }
}
