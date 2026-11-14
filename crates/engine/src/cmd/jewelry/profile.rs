//! A band profile drawn by the jeweller: a closed curve of the drawing read as the band's
//! cross-section, kept by value with the piece.
//!
//! # The frame
//!
//! The profile is drawn in the drawing's XY plane, **X across the band's width** (along the
//! finger) and **Y outward from the finger**. Where it is drawn does not matter: its bounding box
//! places it. The box's lowest edge is the finger line (`y = 0`, the inside of the band where it
//! rests on the finger) and the box is centred across (`x = 0` is the middle of the width, where
//! a stone stands). The width is the box's width and the wall the box's height. Drawing units go
//! to millimetres through `INSUNITS`, like every jewelry command (a unitless drawing is mm).
//!
//! # What is kept
//!
//! The curve is flattened to a polygon (arcs and splines within a twenty-thousandth of the
//! profile's size), thinned to at most [`MAX_PROFILE_POINTS`] points by dropping the least
//! significant corner first, made counter-clockwise, placed in the frame and rounded to the
//! micrometre. The piece stores those points and the curve's handle: the piece survives the
//! curve being moved, changed or erased, travels through DXF with the piece's other parameters,
//! and `PIECE {profile: {curve: handle}}` with the same handle reads the curve again.
//!
//! # What is measured
//!
//! Area and centroid are the polygon's (exact for it; the flattening is the only
//! approximation). The thinnest wall is the least radial metal (the sum of the metal a radial
//! line crosses) at least [`EDGE_INSET`] in from either edge, because every edge tapers to
//! nothing and a bench judges the body. [`CustomProfile::sdf`] is the exact signed distance to
//! the polygon, for a solid builder.
//!
//! # What is refused
//!
//! An open, self-intersecting or degenerate curve; one under 0.5 × 0.3 mm or over 30 × 10 mm
//! (the band's own limits); a region with holes or several pieces; and a profile with no metal
//! across its middle or one that stands off the finger in its middle by more than half its wall.

use cadcraft_doc::{Entity, EntityKind};
use cadcraft_geom::{Circle as GCircle, Ellipse as GEllipse, Polyline, Vec2};
use serde_json::{Value, json};

use super::*;

/// The most points a stored profile keeps.
pub(super) const MAX_PROFILE_POINTS: usize = 400;
/// The most points a curve may flatten to before it is thinned.
const MAX_RAW_POINTS: usize = 4_000;
/// The most vertices a drawn polyline may have.
const MAX_CURVE_VERTICES: usize = 20_000;
/// The band's own limits, the same as `width` and `wall` take (mm).
pub(super) const WIDTH_RANGE: (f64, f64) = (0.5, 30.0);
pub(super) const WALL_RANGE: (f64, f64) = (0.3, 10.0);
/// The least area a profile may enclose (mm²).
const MIN_AREA: f64 = 0.05;
/// How far in from either edge the thinnest wall is looked for (mm), at most a quarter of the width.
pub(super) const EDGE_INSET: f64 = 0.4;
/// Points are kept to the micrometre.
const ROUND: f64 = 1e6;

/// A drawn band profile in millimetres, in the frame the module describes: counter-clockwise,
/// at least three points, simple.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct CustomProfile {
    points: Vec<Vec2>,
    /// The handle of the curve it was read from, as hex.
    curve: Option<String>,
}

fn bounds(pts: &[Vec2]) -> (Vec2, Vec2) {
    let mut lo = Vec2::new(f64::INFINITY, f64::INFINITY);
    let mut hi = Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in pts {
        lo = Vec2::new(lo.x.min(p.x), lo.y.min(p.y));
        hi = Vec2::new(hi.x.max(p.x), hi.y.max(p.y));
    }
    (lo, hi)
}

/// Twice the signed area (counter-clockwise positive).
fn twice_area(pts: &[Vec2]) -> f64 {
    let n = pts.len();
    (0..n).filter_map(|i| Some(pts.get(i)?.cross(*pts.get((i + 1) % n)?))).sum()
}

fn seg_dist(p: Vec2, a: Vec2, b: Vec2) -> f64 {
    let ab = b - a;
    let l2 = ab.dot(ab);
    let t = if l2 > 1e-300 { ((p - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
    p.dist(a + ab * t)
}

/// Whether two closed segments touch or cross.
fn segments_meet(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool {
    let o = |p: Vec2, q: Vec2, r: Vec2| (q - p).cross(r - p);
    let (d1, d2, d3, d4) = (o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0)) {
        return true;
    }
    let scale = (b - a).len().max((d - c).len()).max(1e-12);
    let eps = 1e-9 * scale;
    seg_dist(a, c, d) <= eps || seg_dist(b, c, d) <= eps || seg_dist(c, a, b) <= eps || seg_dist(d, a, b) <= eps
}

/// Whether a closed polygon crosses or touches itself anywhere but at neighbouring edges' shared corner.
pub(super) fn self_intersects(pts: &[Vec2]) -> bool {
    let n = pts.len();
    if n < 4 {
        return false;
    }
    let edge = |i: usize| Some((*pts.get(i % n)?, *pts.get((i + 1) % n)?));
    for i in 0..n {
        let Some((a, b)) = edge(i) else { return true };
        for j in (i + 2)..n {
            if i == 0 && j == n - 1 {
                continue;
            }
            let Some((c, d)) = edge(j) else { return true };
            if segments_meet(a, b, c, d) {
                return true;
            }
        }
    }
    false
}

/// Drop the corner that matters least (the smallest triangle with its neighbours) until at most
/// `most` are left.
fn thinned(mut pts: Vec<Vec2>, most: usize) -> Vec<Vec2> {
    let most = most.max(3);
    let corner = |pts: &[Vec2], i: usize| -> f64 {
        let n = pts.len();
        match (pts.get((i + n - 1) % n), pts.get(i), pts.get((i + 1) % n)) {
            (Some(a), Some(b), Some(c)) => ((*b - *a).cross(*c - *a)).abs(),
            _ => f64::INFINITY,
        }
    };
    while pts.len() > most {
        let mut least = (0usize, f64::INFINITY);
        for i in 0..pts.len() {
            let a = corner(&pts, i);
            if a < least.1 {
                least = (i, a);
            }
        }
        if least.0 < pts.len() {
            pts.remove(least.0);
        } else {
            break;
        }
    }
    pts
}

/// Consecutive repeats and the closing repeat taken out.
fn deduped(pts: Vec<Vec2>, tol: f64) -> Vec<Vec2> {
    let mut out: Vec<Vec2> = Vec::with_capacity(pts.len());
    for p in pts {
        if out.last().is_none_or(|l| l.dist(p) > tol) {
            out.push(p);
        }
    }
    while out.len() > 3 && out.first().zip(out.last()).is_some_and(|(f, l)| f.dist(*l) <= tol) {
        out.pop();
    }
    out
}

/// A curve of the drawing as one closed loop of points in drawing units, or why it is not one.
fn entity_loop(cmd: &str, e: &Entity, name: &str) -> Result<Vec<Vec2>> {
    let size = |pts: &[Vec2]| {
        let (lo, hi) = bounds(pts);
        (hi - lo).len()
    };
    // Flatten within a twenty-thousandth of the curve's size, coarser while it is too many points.
    let flatten = |f: &dyn Fn(f64) -> Vec<Vec2>, extent: f64| -> Result<Vec<Vec2>> {
        if !(extent.is_finite() && extent > 0.0) {
            return Err(bad(cmd, format!("{name} has no size")));
        }
        let mut tol = extent * 5e-5;
        for _ in 0..12 {
            let pts = f(tol);
            if pts.len() <= MAX_RAW_POINTS {
                return Ok(pts);
            }
            tol *= 2.0;
        }
        Err(bad(cmd, format!("{name} has too many points to be a profile")))
    };
    let open = || bad(cmd, format!("{name} is open; a profile is a closed curve (close it with PEDIT or draw it with Close)"));
    match &e.kind {
        EntityKind::LwPolyline(lw) => {
            if lw.vertices.len() > MAX_CURVE_VERTICES {
                return Err(bad(cmd, format!("{name} has too many vertices to be a profile")));
            }
            let first_last = lw.vertices.first().zip(lw.vertices.last()).map(|(f, l)| (f.p, l.p));
            let ends_meet = first_last.is_some_and(|(f, l)| f.dist(l) <= 1e-9 * (1.0 + f.len()));
            if !lw.closed && !ends_meet {
                return Err(open());
            }
            let mut vertices = lw.vertices.clone();
            if !lw.closed && ends_meet && vertices.len() > 1 {
                vertices.pop();
            }
            let poly = Polyline { vertices, closed: true };
            let extent = size(&poly.vertices.iter().map(|v| v.p).collect::<Vec<_>>());
            // Bulges reach beyond the vertices by at most half a chord, so the vertices' extent is a fair scale.
            flatten(&|tol| poly.tessellate(tol), extent)
        }
        EntityKind::Circle(c) => {
            let circle = GCircle { center: c.center.xy(), radius: c.radius };
            flatten(
                &|tol| {
                    let mut out = Vec::new();
                    circle.tessellate(tol, &mut out);
                    out
                },
                2.0 * c.radius,
            )
        }
        EntityKind::Ellipse(el) => {
            let ellipse = GEllipse { center: el.center.xy(), major: el.major.xy(), ratio: el.ratio, start: el.start, end: el.end };
            if !ellipse.is_full() {
                return Err(open());
            }
            flatten(
                &|tol| {
                    let mut out = Vec::new();
                    ellipse.tessellate(tol, &mut out);
                    out
                },
                2.0 * el.major.xy().len(),
            )
        }
        EntityKind::Spline(sp) => {
            let pts = flatten(&|tol| sp.tessellate(tol), size(&sp.control))?;
            let extent = size(&pts);
            if !pts.first().zip(pts.last()).is_some_and(|(f, l)| f.dist(*l) <= 1e-6 * extent.max(1e-12)) {
                return Err(open());
            }
            Ok(pts)
        }
        EntityKind::Region(r) => {
            let loops = r.tessellate(size(&r.polylines().iter().flat_map(|p| p.vertices.iter().map(|v| v.p)).collect::<Vec<_>>()) * 5e-5);
            match loops.as_slice() {
                [one] if one.len() <= MAX_RAW_POINTS => Ok(one.clone()),
                [_] => Err(bad(cmd, format!("{name} has too many points to be a profile"))),
                _ => Err(bad(cmd, format!("{name} has holes or several pieces; a profile is one closed outline"))),
            }
        }
        other => Err(bad(
            cmd,
            format!("{name} is a {}; a profile is a closed polyline, spline, circle, ellipse or region", other.type_name().to_ascii_lowercase()),
        )),
    }
}

impl CustomProfile {
    /// Read a curve of the drawing (drawing units; `mm` millimetres to one unit).
    pub(super) fn from_entity(cmd: &str, e: &Entity, mm: f64) -> Result<CustomProfile> {
        let name = format!("the curve {}", e.handle.hex());
        if !(mm.is_finite() && mm > 0.0) {
            return Err(bad(cmd, "the drawing's units cannot be read"));
        }
        let raw = entity_loop(cmd, e, &name)?;
        if raw.iter().any(|p| !p.is_finite()) {
            return Err(bad(cmd, format!("{name} has a point that is not a number")));
        }
        let pts: Vec<Vec2> = raw.into_iter().map(|p| p * mm).collect();
        CustomProfile::from_points(cmd, pts, Some(e.handle.hex()), &name)
    }

    /// A profile from points in millimetres, wherever they are: checked, thinned, framed.
    pub(super) fn from_points(cmd: &str, pts: Vec<Vec2>, curve: Option<String>, name: &str) -> Result<CustomProfile> {
        if pts.len() > MAX_RAW_POINTS {
            return Err(bad(cmd, format!("{name} has too many points to be a profile")));
        }
        if pts.iter().any(|p| !(p.is_finite() && p.x.abs() <= 1e9 && p.y.abs() <= 1e9)) {
            return Err(bad(cmd, format!("{name} has a point that is not a number or is out of reach")));
        }
        let (lo, hi) = bounds(&pts);
        let extent = (hi - lo).len();
        let mut pts = deduped(pts, (extent * 1e-9).max(1e-9));
        if pts.len() < 3 || !(extent.is_finite() && extent > 0.0) {
            return Err(bad(cmd, format!("{name} is degenerate: it has no inside")));
        }
        let (w, h) = (hi.x - lo.x, hi.y - lo.y);
        let sized = |what: &str| {
            format!(
                "{name} is {} × {} mm {what}; a band profile is {}–{} mm wide and {}–{} mm high (X across the band, Y outward; drawing units become millimetres through INSUNITS)",
                fmt_mm(w),
                fmt_mm(h),
                WIDTH_RANGE.0,
                WIDTH_RANGE.1,
                WALL_RANGE.0,
                WALL_RANGE.1
            )
        };
        if w < WIDTH_RANGE.0 - 1e-9 || h < WALL_RANGE.0 - 1e-9 {
            return Err(bad(cmd, sized("— too small")));
        }
        if w > WIDTH_RANGE.1 + 1e-9 || h > WALL_RANGE.1 + 1e-9 {
            return Err(bad(cmd, sized("— too large")));
        }
        if self_intersects(&pts) {
            return Err(bad(cmd, format!("{name} crosses itself; a profile is one simple closed outline")));
        }
        let area2 = twice_area(&pts);
        if area2.is_nan() || area2.abs() / 2.0 < MIN_AREA {
            return Err(bad(cmd, format!("{name} is degenerate: it encloses {:.3} mm², under {MIN_AREA} mm²", area2.abs() / 2.0)));
        }
        if area2 < 0.0 {
            pts.reverse();
        }
        // Into the frame: the finger line at the bottom, centred across.
        let shift = Vec2::new(-(lo.x + hi.x) / 2.0, -lo.y);
        let shift = Vec2::new(if shift.x.abs() < 5e-7 { 0.0 } else { shift.x }, if shift.y.abs() < 5e-7 { 0.0 } else { shift.y });
        let round = |v: f64| (v * ROUND).round() / ROUND;
        let pts: Vec<Vec2> = thinned(pts, MAX_PROFILE_POINTS).into_iter().map(|p| p + shift).map(|p| Vec2::new(round(p.x), round(p.y))).collect();
        let pts = deduped(pts, 1.5 / ROUND);
        if pts.len() < 3 || twice_area(&pts) <= 0.0 || self_intersects(&pts) {
            return Err(bad(cmd, format!("{name} has features too fine to keep; draw it simpler")));
        }
        let profile = CustomProfile { points: pts, curve: curve.map(|c| c.chars().take(16).collect()) };
        // Metal where the band rests on the finger.
        let wall = profile.wall();
        let middle = profile.thickness_at(0.0);
        if middle <= 1e-6 {
            return Err(bad(cmd, format!("{name} has no metal across the middle of its width, where the band's top and the finger meet")));
        }
        let off = profile.bottom_at(0.0);
        if off > wall / 2.0 {
            return Err(bad(
                cmd,
                format!(
                    "{name} stands {} mm off the finger in its middle; a band rests on the finger there (its lowest point should be near the middle)",
                    fmt_mm(off)
                ),
            ));
        }
        Ok(profile)
    }

    /// The stored form: `{curve, points: [[x, y], …]}` in millimetres.
    pub(super) fn json(&self) -> Value {
        json!({ "curve": self.curve, "points": self.points.iter().map(|p| [p.x, p.y]).collect::<Vec<_>>() })
    }

    /// Read the stored form back (hostile: bounded and checked like a drawn curve).
    pub(super) fn from_json(cmd: &str, v: Option<&Value>) -> Result<CustomProfile> {
        let missing = || bad(cmd, "a custom profile needs its curve: give `profile: {curve: handle}` with a closed curve of the drawing");
        let v = v.filter(|v| v.is_object()).ok_or_else(missing)?;
        let list = v.get("points").and_then(Value::as_array).ok_or_else(missing)?;
        if list.len() > MAX_RAW_POINTS {
            return Err(bad(cmd, "the stored profile has too many points"));
        }
        let mut pts = Vec::with_capacity(list.len());
        for p in list {
            let xy = p.as_array().filter(|a| a.len() == 2);
            let x = xy.and_then(|a| a.first()).and_then(Value::as_f64);
            let y = xy.and_then(|a| a.get(1)).and_then(Value::as_f64);
            match (x, y) {
                (Some(x), Some(y)) => pts.push(Vec2::new(x, y)),
                _ => return Err(bad(cmd, "the stored profile's points must be [x, y] pairs of numbers")),
            }
        }
        let curve = v.get("curve").and_then(Value::as_str).map(str::to_string);
        CustomProfile::from_points(cmd, pts, curve, "the stored profile")
    }

    /// The source curve's handle (hex), when it is known.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) fn curve(&self) -> Option<&str> {
        self.curve.as_deref()
    }

    /// The polygon, counter-clockwise, in the frame (mm).
    pub(super) fn points(&self) -> &[Vec2] {
        &self.points
    }

    /// The width across the band.
    pub(super) fn width(&self) -> f64 {
        let (lo, hi) = bounds(&self.points);
        hi.x - lo.x
    }

    /// The wall: the height above the finger line of the profile's highest point.
    pub(super) fn wall(&self) -> f64 {
        bounds(&self.points).1.y
    }

    /// The enclosed area (mm²).
    pub(super) fn area(&self) -> f64 {
        twice_area(&self.points) / 2.0
    }

    /// The centroid's height above the finger line.
    pub(super) fn centroid(&self) -> f64 {
        let n = self.points.len();
        let (mut a2, mut m) = (0.0, 0.0);
        for i in 0..n {
            let (Some(p), Some(q)) = (self.points.get(i), self.points.get((i + 1) % n)) else { continue };
            let c = p.cross(*q);
            a2 += c;
            m += (p.y + q.y) * c;
        }
        if a2.abs() > 1e-300 { m / (3.0 * a2) } else { self.wall() / 2.0 }
    }

    /// Where a radial line `x` across the width crosses the outline, low to high.
    fn crossings(&self, x: f64) -> Vec<f64> {
        let (lo, hi) = bounds(&self.points);
        let span = (hi.x - lo.x).max(1e-12);
        let x = x.clamp(lo.x + span * 1e-9, hi.x - span * 1e-9);
        let n = self.points.len();
        let mut ys: Vec<f64> = (0..n)
            .filter_map(|i| {
                let (a, b) = (self.points.get(i)?, self.points.get((i + 1) % n)?);
                if (a.x <= x) == (b.x <= x) {
                    return None;
                }
                let t = (x - a.x) / (b.x - a.x);
                Some(a.y + (b.y - a.y) * t)
            })
            .filter(|y| y.is_finite())
            .collect();
        ys.sort_by(f64::total_cmp);
        ys
    }

    /// The outside's height above the finger at `x`.
    pub(super) fn top_at(&self, x: f64) -> f64 {
        self.crossings(x).last().copied().unwrap_or(0.0)
    }

    /// The inside's height above the finger at `x`.
    pub(super) fn bottom_at(&self, x: f64) -> f64 {
        self.crossings(x).first().copied().unwrap_or(0.0)
    }

    /// The metal a radial line at `x` passes through.
    pub(super) fn thickness_at(&self, x: f64) -> f64 {
        self.crossings(x).chunks_exact(2).map(|c| c.get(1).copied().unwrap_or(0.0) - c.first().copied().unwrap_or(0.0)).sum()
    }

    /// The thinnest wall a bench judges the band by, and where across the width it is: the least
    /// radial metal at least [`EDGE_INSET`] (and at most a quarter of the width) in from the edges.
    pub(super) fn thinnest(&self) -> (f64, f64) {
        let (lo, hi) = bounds(&self.points);
        let inset = EDGE_INSET.min((hi.x - lo.x) / 4.0);
        let (a, b) = (lo.x + inset, hi.x - inset);
        let mut xs: Vec<f64> = (0..=200).map(|k| a + (b - a) * k as f64 / 200.0).collect();
        xs.extend(self.points.iter().map(|p| p.x).filter(|x| *x >= a && *x <= b));
        xs.into_iter().map(|x| (self.thickness_at(x), x)).fold((f64::INFINITY, 0.0), |m, t| if t.0 < m.0 { t } else { m })
    }

    /// The polygon thinned to at most `most` points, for a mesh.
    pub(super) fn polygon(&self, most: usize) -> Vec<Vec2> {
        thinned(self.points.clone(), most.clamp(8, MAX_PROFILE_POINTS))
    }

    /// For the solid builder (`solid.rs`); used by tests until it adopts custom profiles.
    #[cfg_attr(not(test), allow(dead_code))]
    /// The signed distance from `p` (in the section plane, the frame above: x across the width,
    /// y up from the finger line, mm) to the profile: negative inside, exact, so 1-Lipschitz.
    pub(super) fn sdf(&self, p: Vec2) -> f64 {
        let n = self.points.len();
        let mut d = f64::INFINITY;
        let mut inside = false;
        for i in 0..n {
            let (Some(a), Some(b)) = (self.points.get(i), self.points.get((i + 1) % n)) else { continue };
            d = d.min(seg_dist(p, *a, *b));
            if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y) {
                inside = !inside;
            }
        }
        if inside { -d } else { d }
    }
}

/// The signed distance to a piece's band profile at a point of its section plane (x across the
/// width from the middle, y outward from the finger line, mm): negative inside, 1-Lipschitz. A
/// piece with a named profile is measured against its exact polygon too.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn profile_sdf(p: &super::piece_params::PieceParams, at: Vec2) -> f64 {
    match &p.custom {
        Some(c) => c.sdf(at),
        None => {
            let polygon = p.section().polygon(64);
            CustomProfile { points: polygon, curve: None }.sdf(at)
        }
    }
}

/// `PIECE {profile: {curve: handle}}`: read the curve from the drawing and put the profile into
/// the given keys by value (`profile: "custom"`, `profileCurve: {curve, points}`), so the rest of
/// the command sees a piece's own JSON. Anything else is left alone.
pub(super) fn resolve(s: &Session, cmd: &str, given: &mut serde_json::Map<String, Value>) -> Result<()> {
    let Some(asked) = given.get("profile").filter(|v| v.is_object()) else { return Ok(()) };
    let handle = asked
        .get("curve")
        .and_then(super::super::curves::handle_value)
        .ok_or_else(|| bad(cmd, "`profile` as an object is {curve: handle}: the handle of a closed curve of the drawing"))?;
    let d = s.doc()?;
    let e = d.entity(handle).ok_or_else(|| {
        bad(cmd, format!("there is no object {} in the drawing; a piece that already has a custom profile keeps the one it stored", handle.hex()))
    })?;
    let profile = CustomProfile::from_entity(cmd, e, mm_per_unit(s))?;
    given.insert("profile".into(), json!("custom"));
    given.insert("profileCurve".into(), profile.json());
    Ok(())
}

/// A custom profile's width and wall are its curve's: a different `width` or `wall` given with
/// it is refused rather than silently ignored.
pub(super) fn box_given(cmd: &str, given: &serde_json::Map<String, Value>, p: &super::piece_params::PieceParams) -> Result<()> {
    let Some(c) = &p.custom else { return Ok(()) };
    for (key, have) in [("width", c.width()), ("wall", c.wall())] {
        if let Some(x) = given.get(key).and_then(Value::as_f64)
            && (x - have).abs() > 1e-6
        {
            return Err(bad(
                cmd,
                format!(
                    "a custom profile's {key} comes from its curve ({} mm); scale the curve and update the piece from it, or choose a named profile",
                    fmt_mm(have)
                ),
            ));
        }
    }
    Ok(())
}
