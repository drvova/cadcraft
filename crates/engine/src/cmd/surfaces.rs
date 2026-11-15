//! Free-form modelling: NURBS surfaces and SubD objects as drawing objects (Rhino-class
//! surfacing for the jewelry layer).
//!
//! Surface construction — LOFT, REVOLVE, EXTRUDE, SWEEP (one rail), PLANESRF — builds a
//! [`Surface`] from the curves picked (lines, arcs, circles, ellipses, polylines, 3D polylines,
//! splines), with the kernel in `cadcraft_geom`. SUBDBOX, SUBDCYLINDER and SUBDFROMCAGE make
//! [`SubD`] objects, SUBDCREASE creases their edges, TOSUBD and TONURBS convert between the two,
//! SURFTRIM and SPLIT trim a surface by a closed curve projected onto it, MESH hands back a
//! surface's triangles and SURFMESH every free-form object's triangles for the 3D view.
//!
//! The drawing is drawn in the XY plane, so a section's height can be given (`heights`), a
//! sweep's profile drawn in plan is stood up across the rail (`orient`), and a revolution's axis
//! is a line in the plane. Every number from outside is checked and every count capped: a bad
//! value is an error, never a panic.

use cadcraft_doc::{Entity, EntityKind, Handle, SHARP_STORED, SubD, Surface};
use cadcraft_geom::subd_edit::{box_cage, crease_all, cylinder_cage, set_crease};
use cadcraft_geom::surface_trim::{loop_area, planar_trimmed, project_along, validate_trims};
use cadcraft_geom::{
    FrameMode, MAX_CAGE_FACES, MAX_CAGE_VERTICES, MAX_LOFT_SECTIONS, NurbsCurve3, NurbsSurface, SHARP, SubdCage, TessOptions, Vec2, Vec3,
    regular_patches, subdivide_levels,
};
use serde_json::{Value, json};

use super::machines::SelectRun;
use super::*;
use crate::{EngineError, Result, Session};

/// Samples per knot span when a curve becomes a trim polygon (degree 1 spans use their ends).
const CURVE_SAMPLES_PER_SPAN: usize = 24;
/// Most samples of one cutting curve.
const MAX_CURVE_SAMPLES: usize = 20_000;
/// Largest coordinate or size a command accepts.
const MAX_COORD: f64 = 1e9;
/// Most objects one command acts on.
const MAX_OBJECTS: usize = 10_000;
/// Default sweep stations.
const SWEEP_STATIONS: usize = 33;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("loft", "Loft", run_loft)
            .menu(&["Draw", "3D Modeling", "Loft"])
            .params("{handles: sections in order (2–1024 curves), heights?: [z per section], degree?: 1–5 (3), message}")
            .interactive(|_| Ok(Box::new(SelectRun::new("loft", "LOFT")))),
        CommandSpec::new("revolve", "Revolve", run_revolve)
            .menu(&["Draw", "3D Modeling", "Revolve"])
            .alias(&["rev", "revsrf"])
            .params("{handles: profile curves, axisStart?: [x,y] ([0,0]), axisEnd?: [x,y] ([0,1]), angle?: degrees (360)}")
            .interactive(|_| Ok(Box::new(SelectRun::new("revolve", "REVOLVE")))),
        CommandSpec::new("extrude", "Extrude", run_extrude)
            .menu(&["Draw", "3D Modeling", "Extrude"])
            .alias(&["ext", "extrudecrv"])
            .params("{handles: curves, height?: (10, along +Z), direction?: [dx,dy,dz] (replaces height)}")
            .interactive(|_| Ok(Box::new(SelectRun::new("extrude", "EXTRUDE")))),
        CommandSpec::new("sweep", "Sweep", run_sweep)
            .menu(&["Draw", "3D Modeling", "Sweep"])
            .alias(&["sweep1"])
            .params("{handles: [rail, profile] | rail, profile, stations?: 2–2048 (33), upright?: bool (frame keeps +Z up), orient?: bool (true: the profile, drawn in plan, is stood up across the rail's start)}")
            .interactive(|_| Ok(Box::new(SelectRun::new("sweep", "SWEEP")))),
        CommandSpec::new("planesrf", "Planar Surface", run_planesrf)
            .menu(&["Draw", "3D Modeling", "Surfaces", "Planar"])
            .alias(&["planarsrf"])
            .params("{handles: closed planar curves (the first the boundary, the rest holes)}")
            .interactive(|_| Ok(Box::new(SelectRun::new("planesrf", "PLANESRF")))),
        CommandSpec::new("subdbox", "SubD Box", run_subdbox)
            .menu(&["Draw", "3D Modeling", "SubD", "Box"])
            .params("{center?: [x,y,z], width?, depth?, height? (10), level?: 1–4 (2), creased?: bool}"),
        CommandSpec::new("subdcylinder", "SubD Cylinder", run_subdcylinder)
            .menu(&["Draw", "3D Modeling", "SubD", "Cylinder"])
            .params("{center?: [x,y,z] (base), radius? (5), height? (10), segments?: 3–256 (8), level?}"),
        CommandSpec::new("subdfromcage", "SubD from Cage", run_subdfromcage)
            .menu(&["Draw", "3D Modeling", "SubD", "From Cage"])
            .params("{positions: [[x,y,z]…], faces: [[i,j,k,…]…], creases?: [[a,b,sharpness]…], corners?: [i…], level?} | {handles: 3D faces}"),
        CommandSpec::new("subdcrease", "SubD Crease", run_subdcrease)
            .menu(&["Modify", "SubD", "Crease"])
            .params("{handles: SubD objects, edges?: [[a,b]…] (all edges), sharpness?: number | \"sharp\" (sharp; 0 removes)}")
            .interactive(|_| Ok(Box::new(SelectRun::new("subdcrease", "SUBDCREASE")))),
        CommandSpec::new("tosubd", "Convert to SubD", run_tosubd)
            .menu(&["Modify", "SubD", "Convert to SubD"])
            .params("{handles: surfaces, delete?: bool (false), level?}")
            .interactive(|_| Ok(Box::new(SelectRun::new("tosubd", "TOSUBD")))),
        CommandSpec::new("tonurbs", "Convert to NURBS", run_tonurbs)
            .menu(&["Modify", "SubD", "Convert to NURBS"])
            .alias(&["convtonurbs"])
            .params("{handles: SubD objects, levels?: 0–3 (1), delete?: bool (false)}")
            .interactive(|_| Ok(Box::new(SelectRun::new("tonurbs", "TONURBS")))),
        CommandSpec::new("mesh", "Mesh from Surface", run_mesh)
            .menu(&["Modify", "3D Operations", "Mesh from Surface"])
            .params("{handles: surfaces or SubD objects, tolerance?: chord (0.01 mm), angle?: degrees (15)} → {meshes:[{handle, positions, indices}], triangles}")
            .noundo(),
        CommandSpec::new("surfmesh", "Free-form Objects as Meshes", run_surfmesh)
            .params("{quality?: draft|fine, metal?: name (gold18; a layer named after a metal wins)} → the 3D view's {meshes, bounds, triangles, notes}")
            .noundo(),
        CommandSpec::new("surftrim", "Trim Surface", run_surftrim)
            .menu(&["Modify", "Surface Editing", "Trim"])
            .params("{handles: [surface, closed curve] | surface, curve, keep?: outside|inside (outside: the curve cuts a hole), direction?: view|closest}")
            .interactive(|_| Ok(Box::new(SelectRun::new("surftrim", "SURFTRIM")))),
        CommandSpec::new("split", "Split Surface", run_split)
            .menu(&["Modify", "Surface Editing", "Split"])
            .params("{handles: [surface, closed curve] | surface, curve, direction?: view|closest} → two surfaces")
            .interactive(|_| Ok(Box::new(SelectRun::new("split", "SPLIT")))),
    ]
}

// ---------------- helpers ----------------

fn fail(cmd: &str, e: impl std::fmt::Display) -> EngineError {
    bad(cmd, e.to_string())
}

fn handle_of(v: &Value) -> Option<Handle> {
    v.as_str().and_then(Handle::parse_hex).or_else(|| v.as_u64().map(Handle))
}

/// The objects a command acts on (at most [`MAX_OBJECTS`]).
fn objects(cmd: &str, s: &Session, p: &Value) -> Result<Vec<Handle>> {
    let hs = targets(s, p)?;
    if hs.is_empty() {
        return Err(bad(cmd, "select objects (`handles`)"));
    }
    if hs.len() > MAX_OBJECTS {
        return Err(bad(cmd, format!("at most {MAX_OBJECTS} objects")));
    }
    Ok(hs)
}

fn entity(cmd: &str, s: &Session, h: Handle) -> Result<Entity> {
    s.doc()?.entity(h).map(|e| (**e).clone()).ok_or_else(|| bad(cmd, format!("no object {}", h.hex())))
}

fn coord(cmd: &str, v: f64, what: &str) -> Result<f64> {
    if v.is_finite() && v.abs() <= MAX_COORD { Ok(v) } else { Err(bad(cmd, format!("`{what}` is out of range"))) }
}

fn point3_value(v: &Value) -> Option<Vec3> {
    let a = v.as_array()?;
    let x = a.first()?.as_f64()?;
    let y = a.get(1)?.as_f64()?;
    let z = a.get(2).and_then(Value::as_f64).unwrap_or(0.0);
    let p = Vec3::new(x, y, z);
    (p.is_finite() && x.abs().max(y.abs()).max(z.abs()) <= MAX_COORD).then_some(p)
}

fn point3_or(cmd: &str, p: &Value, key: &str, default: Vec3) -> Result<Vec3> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => point3_value(v).ok_or_else(|| bad(cmd, format!("`{key}` must be [x, y] or [x, y, z] in range"))),
    }
}

fn size_or(cmd: &str, p: &Value, key: &str, default: f64) -> Result<f64> {
    let v = size_param(cmd, p, key, false)?.unwrap_or(default);
    if v > MAX_COORD { Err(bad(cmd, format!("`{key}` is too large"))) } else { Ok(v) }
}

fn level_or(cmd: &str, p: &Value) -> Result<u32> {
    match p.get("level") {
        None | Some(Value::Null) => Ok(2),
        Some(v) => match v.as_u64() {
            Some(l @ 1..=4) => Ok(l as u32),
            _ => Err(bad(cmd, "`level` must be 1 to 4")),
        },
    }
}

/// A drawing curve as a 3D NURBS curve (in the plane it is drawn in, at its elevation).
pub(crate) fn curve3(cmd: &str, e: &Entity) -> Result<NurbsCurve3> {
    use cadcraft_geom::{Ellipse as GEllipse, Polyline};
    let lift = |pts: Vec<Vec2>, z: f64| -> Vec<Vec3> { pts.into_iter().map(|p| p.to3(z)).collect() };
    let poly = |pts: Vec<Vec3>, closed: bool| -> Result<NurbsCurve3> {
        let mut pts: Vec<Vec3> = pts.into_iter().filter(|p| p.is_finite()).collect();
        pts.dedup_by(|a, b| (*a - *b).len() <= 1e-12);
        if closed
            && let Some(f) = pts.first().copied()
            && pts.last().is_some_and(|l| (*l - f).len() > 1e-12)
        {
            pts.push(f);
        }
        if pts.len() > MAX_CURVE_SAMPLES {
            return Err(bad(cmd, "the curve has too many vertices"));
        }
        NurbsCurve3::from_control(pts, 1).map_err(|e| fail(cmd, e))
    };
    let tol = |size: f64| (size * 1e-3).max(1e-9);
    let c = match &e.kind {
        EntityKind::Line(l) => NurbsCurve3::line(l.a, l.b).map_err(|e| fail(cmd, e))?,
        EntityKind::Circle(c) => NurbsCurve3::circle(c.center, Vec3::new(0.0, 0.0, 1.0), c.radius).map_err(|e| fail(cmd, e))?,
        EntityKind::Arc(a) => {
            let mut sweep = a.end - a.start;
            if sweep <= 0.0 {
                sweep += cadcraft_geom::TAU;
            }
            NurbsCurve3::arc(a.center, Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), a.radius, a.start, sweep).map_err(|e| fail(cmd, e))?
        }
        EntityKind::Ellipse(el) => {
            let g = GEllipse { center: el.center.xy(), major: el.major.xy(), ratio: el.ratio, start: el.start, end: el.end };
            let mut pts = Vec::new();
            g.tessellate(tol(el.major.len()), &mut pts);
            let closed = (el.end - el.start - cadcraft_geom::TAU).abs() < 1e-9 || (el.end - el.start).abs() < 1e-12;
            poly(lift(pts, el.center.z), closed)?
        }
        EntityKind::LwPolyline(pl) => {
            let g = Polyline { vertices: pl.vertices.clone(), closed: pl.closed };
            let size = {
                let b = cadcraft_geom::Bounds2::from_points(pl.vertices.iter().map(|v| v.p));
                b.width().hypot(b.height())
            };
            let pts = if pl.vertices.iter().all(|v| v.bulge == 0.0) { pl.vertices.iter().map(|v| v.p).collect() } else { g.tessellate(tol(size)) };
            poly(lift(pts, pl.elevation), pl.closed)?
        }
        EntityKind::Polyline3d(pl) => poly(pl.points.clone(), pl.closed)?,
        EntityKind::Spline(sp) => NurbsCurve3::from_spline(sp).map_err(|e| fail(cmd, e))?,
        k => return Err(bad(cmd, format!("a {} is not a curve this command can use", k.type_name()))),
    };
    Ok(c)
}

/// Points along a curve: every knot span sampled (degree 1: its ends), closed polygon without
/// the repeated last point.
fn curve_polygon(c: &NurbsCurve3) -> Vec<Vec3> {
    let mut ks: Vec<f64> = c.knots().to_vec();
    ks.dedup_by(|a, b| (*a - *b).abs() <= 1e-14);
    let (a, b) = c.domain();
    ks.retain(|k| *k >= a && *k <= b);
    let per = if c.degree() == 1 && !c.is_rational() { 1 } else { CURVE_SAMPLES_PER_SPAN };
    let per = per.min((MAX_CURVE_SAMPLES / ks.len().max(1)).max(1));
    let mut out = Vec::new();
    for w in ks.windows(2) {
        let (Some(&k0), Some(&k1)) = (w.first(), w.get(1)) else { continue };
        for i in 0..per {
            out.push(c.point(k0 + (k1 - k0) * i as f64 / per as f64));
        }
    }
    out.push(c.point(b));
    if out.len() > 1 && out.first().zip(out.last()).is_some_and(|(f, l)| (*f - *l).len() <= 1e-9 * (1.0 + f.len())) {
        out.pop();
    }
    out
}

fn add_surface(s: &mut Session, srf: &NurbsSurface, trims: Vec<Vec<Vec2>>) -> Result<Handle> {
    let mut f = Surface::from_nurbs(srf);
    f.trims = trims;
    s.add_entity(EntityKind::Surface(f))
}

fn added(cmd: &str, hs: &[Handle], what: &str) -> Result<Value> {
    Ok(json!({
        "handles": hs.iter().map(|h| h.hex()).collect::<Vec<_>>(),
        "handle": hs.first().map(|h| h.hex()),
        "message": format!("{}: {} {what}{}", cmd.to_uppercase(), hs.len(), if hs.len() == 1 { "" } else { "s" }),
    }))
}

// ---------------- surfaces from curves ----------------

fn run_loft(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "loft";
    let hs = objects(cmd, s, p)?;
    if hs.len() < 2 || hs.len() > MAX_LOFT_SECTIONS {
        return Err(bad(cmd, format!("a loft needs 2 to {MAX_LOFT_SECTIONS} sections")));
    }
    let heights: Option<Vec<f64>> = match p.get("heights") {
        None | Some(Value::Null) => None,
        Some(Value::Array(a)) if a.len() == hs.len() => Some(
            a.iter()
                .map(|v| v.as_f64().ok_or_else(|| bad(cmd, "`heights` must be numbers")).and_then(|z| coord(cmd, z, "heights")))
                .collect::<Result<_>>()?,
        ),
        Some(_) => return Err(bad(cmd, "`heights` must give one z per section")),
    };
    let degree = match p.get("degree") {
        None | Some(Value::Null) => 3,
        Some(v) => match v.as_u64() {
            Some(d @ 1..=5) => d as usize,
            _ => return Err(bad(cmd, "`degree` must be 1 to 5")),
        },
    };
    let mut sections = Vec::with_capacity(hs.len());
    for (i, h) in hs.iter().enumerate() {
        let c = curve3(cmd, &entity(cmd, s, *h)?)?;
        let c = match heights.as_ref().and_then(|z| z.get(i)) {
            Some(&z) => c.map(|q| Vec3::new(q.x, q.y, z)).map_err(|e| fail(cmd, e))?,
            None => c,
        };
        sections.push(c);
    }
    let srf = NurbsSurface::loft(&sections, degree).map_err(|e| fail(cmd, e))?;
    let h = add_surface(s, &srf, Vec::new())?;
    added(cmd, &[h], "lofted surface")
}

fn run_revolve(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "revolve";
    let hs = objects(cmd, s, p)?;
    let a = point3_or(cmd, p, "axisStart", Vec3::ZERO)?;
    let b = point3_or(cmd, p, "axisEnd", Vec3::new(0.0, 1.0, 0.0))?;
    let angle = f64_or(p, "angle", 360.0);
    if !(angle.abs() > 1e-9 && angle.abs() <= 360.0) {
        return Err(bad(cmd, "`angle` must be in (0, 360] degrees (either sign)"));
    }
    let axis = b - a;
    if axis.len() <= 1e-12 {
        return Err(bad(cmd, "the axis has no length"));
    }
    let mut out = Vec::new();
    for h in hs {
        let c = curve3(cmd, &entity(cmd, s, h)?)?;
        let srf = NurbsSurface::revolve(&c, a, axis, angle.to_radians()).map_err(|e| fail(cmd, e))?;
        out.push(add_surface(s, &srf, Vec::new())?);
    }
    added(cmd, &out, "revolved surface")
}

fn run_extrude(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "extrude";
    let hs = objects(cmd, s, p)?;
    let dir = match p.get("direction") {
        None | Some(Value::Null) => {
            let h = f64_or(p, "height", 10.0);
            Vec3::new(0.0, 0.0, coord(cmd, h, "height")?)
        }
        Some(v) => point3_value(v).ok_or_else(|| bad(cmd, "`direction` must be [dx, dy, dz] in range"))?,
    };
    if dir.len() <= 1e-12 {
        return Err(bad(cmd, "the extrusion has no length"));
    }
    let mut out = Vec::new();
    for h in hs {
        let c = curve3(cmd, &entity(cmd, s, h)?)?;
        let srf = NurbsSurface::extrude(&c, dir).map_err(|e| fail(cmd, e))?;
        out.push(add_surface(s, &srf, Vec::new())?);
    }
    added(cmd, &out, "extruded surface")
}

/// The rail and the second object of a two-object command: `handles: [a, b]`, or `key_a`/`key_b`.
fn pair(cmd: &str, s: &Session, p: &Value, key_a: &str, key_b: &str) -> Result<(Handle, Handle)> {
    if let (Some(a), Some(b)) = (p.get(key_a).and_then(handle_of), p.get(key_b).and_then(handle_of)) {
        return Ok((a, b));
    }
    let hs = objects(cmd, s, p)?;
    match hs.as_slice() {
        [a, b] => Ok((*a, *b)),
        _ => Err(bad(cmd, format!("give two objects: `{key_a}` then `{key_b}` (or `handles: [{key_a}, {key_b}]`)"))),
    }
}

fn run_sweep(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "sweep";
    let (rh, ph) = pair(cmd, s, p, "rail", "profile")?;
    let rail = curve3(cmd, &entity(cmd, s, rh)?)?;
    let mut profile = curve3(cmd, &entity(cmd, s, ph)?)?;
    let stations = match p.get("stations") {
        None | Some(Value::Null) => SWEEP_STATIONS,
        Some(v) => match v.as_u64() {
            Some(n @ 2..=2048) => n as usize,
            _ => return Err(bad(cmd, "`stations` must be 2 to 2048")),
        },
    };
    let up = Vec3::new(0.0, 0.0, 1.0);
    if bool_or(p, "orient", true) {
        // The profile as drawn in plan (about its box centre) stood up across the rail's start:
        // its x along the rail's sideways direction, its y up.
        let (a, _) = rail.domain();
        let o = rail.point(a);
        let t = rail.tangent(a).normalized();
        let side = t.cross(up).normalized();
        let side = if side.len() < 0.5 { Vec3::new(1.0, 0.0, 0.0) } else { side };
        let pts = profile.points();
        let (mut lo, mut hi) = (Vec2::new(f64::MAX, f64::MAX), Vec2::new(f64::MIN, f64::MIN));
        for q in pts {
            lo = Vec2::new(lo.x.min(q.x), lo.y.min(q.y));
            hi = Vec2::new(hi.x.max(q.x), hi.y.max(q.y));
        }
        let c = (lo + hi) * 0.5;
        let lift = t.cross(side).normalized();
        let lift = if lift.dot(up) < 0.0 { lift * -1.0 } else { lift };
        profile = profile.map(|q| o + side * (q.x - c.x) + lift * (q.y - c.y)).map_err(|e| fail(cmd, e))?;
    }
    let mode = if bool_or(p, "upright", false) { FrameMode::Upright { axis: up } } else { FrameMode::RotationMinimizing };
    let srf = NurbsSurface::sweep1(&rail, &profile, mode, stations).map_err(|e| fail(cmd, e))?;
    let h = add_surface(s, &srf, Vec::new())?;
    added(cmd, &[h], "swept surface")
}

fn run_planesrf(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "planesrf";
    let hs = objects(cmd, s, p)?;
    let mut loops = Vec::new();
    for h in &hs {
        let c = curve3(cmd, &entity(cmd, s, *h)?)?;
        if !c.is_closed(1e-9 * (1.0 + c.points().iter().fold(0.0f64, |m, q| m.max(q.len())))) {
            return Err(bad(cmd, format!("object {} is not a closed curve", h.hex())));
        }
        loops.push(curve_polygon(&c));
    }
    let (srf, trims) = planar_trimmed(&loops).map_err(|e| fail(cmd, e))?;
    let h = add_surface(s, &srf, trims)?;
    added(cmd, &[h], "planar surface")
}

// ---------------- SubD ----------------

fn add_subd(s: &mut Session, cage: &SubdCage, level: u32) -> Result<Handle> {
    s.add_entity(EntityKind::SubD(SubD::from_cage(cage, level)))
}

fn moved(cmd: &str, cage: SubdCage, by: Vec3) -> Result<SubdCage> {
    let pts: Vec<Vec3> = cage.positions().iter().map(|q| *q + by).collect();
    SubdCage::with_tags(pts, &cage.faces(), cage.creases().clone(), cage.corners().clone()).map_err(|e| fail(cmd, e))
}

fn run_subdbox(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "subdbox";
    let c = point3_or(cmd, p, "center", Vec3::ZERO)?;
    let (w, d, h) = (size_or(cmd, p, "width", 10.0)?, size_or(cmd, p, "depth", 10.0)?, size_or(cmd, p, "height", 10.0)?);
    let level = level_or(cmd, p)?;
    let mut cage = box_cage(w, d, h).map_err(|e| fail(cmd, e))?;
    if bool_or(p, "creased", false) {
        cage = crease_all(&cage, SHARP).map_err(|e| fail(cmd, e))?;
    }
    let cage = moved(cmd, cage, c)?;
    let hd = add_subd(s, &cage, level)?;
    added(cmd, &[hd], "SubD box")
}

fn run_subdcylinder(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "subdcylinder";
    let c = point3_or(cmd, p, "center", Vec3::ZERO)?;
    let (r, h) = (size_or(cmd, p, "radius", 5.0)?, size_or(cmd, p, "height", 10.0)?);
    let n = match p.get("segments") {
        None | Some(Value::Null) => 8,
        Some(v) => match v.as_u64() {
            Some(n @ 3..=256) => n as u32,
            _ => return Err(bad(cmd, "`segments` must be 3 to 256")),
        },
    };
    let level = level_or(cmd, p)?;
    let cage = moved(cmd, cylinder_cage(r, h, n).map_err(|e| fail(cmd, e))?, c)?;
    let hd = add_subd(s, &cage, level)?;
    added(cmd, &[hd], "SubD cylinder")
}

fn run_subdfromcage(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "subdfromcage";
    let level = level_or(cmd, p)?;
    let (positions, faces) = if let Some(pos) = p.get("positions") {
        let pos = pos.as_array().ok_or_else(|| bad(cmd, "`positions` must be an array of [x, y, z]"))?;
        if pos.len() > MAX_CAGE_VERTICES {
            return Err(bad(cmd, format!("at most {MAX_CAGE_VERTICES} positions")));
        }
        let positions: Vec<Vec3> =
            pos.iter().map(|v| point3_value(v).ok_or_else(|| bad(cmd, "a position is not [x, y, z] in range"))).collect::<Result<_>>()?;
        let fs = p.get("faces").and_then(Value::as_array).ok_or_else(|| bad(cmd, "`faces` (arrays of vertex indices) is required"))?;
        if fs.len() > MAX_CAGE_FACES {
            return Err(bad(cmd, format!("at most {MAX_CAGE_FACES} faces")));
        }
        let mut faces = Vec::with_capacity(fs.len());
        for f in fs {
            let ids = f.as_array().ok_or_else(|| bad(cmd, "a face is not an array of indices"))?;
            if ids.len() > cadcraft_geom::MAX_FACE_SIDES {
                return Err(bad(cmd, "a face has too many sides"));
            }
            faces.push(
                ids.iter()
                    .map(|i| i.as_u64().and_then(|i| u32::try_from(i).ok()).ok_or_else(|| bad(cmd, "a face index is not a whole number")))
                    .collect::<Result<Vec<u32>>>()?,
            );
        }
        (positions, faces)
    } else {
        // 3D faces, welded where their corners meet.
        let hs = objects(cmd, s, p)?;
        let mut positions: Vec<Vec3> = Vec::new();
        let mut faces = Vec::new();
        let find = |q: Vec3, positions: &mut Vec<Vec3>| -> u32 {
            let tol = 1e-9 * (1.0 + q.len());
            if let Some(i) = positions.iter().position(|o| (*o - q).len() <= tol) {
                return i as u32;
            }
            positions.push(q);
            (positions.len() - 1) as u32
        };
        for h in hs {
            let EntityKind::Face3d(f) = entity(cmd, s, h)?.kind else { return Err(bad(cmd, format!("object {} is not a 3D face", h.hex()))) };
            let mut ids: Vec<u32> = f.corners.iter().map(|&q| find(q, &mut positions)).collect();
            ids.dedup();
            if ids.len() > 1 && ids.first() == ids.last() {
                ids.pop();
            }
            faces.push(ids);
        }
        (positions, faces)
    };
    let mut creases = std::collections::BTreeMap::new();
    if let Some(cs) = p.get("creases").and_then(Value::as_array) {
        for c in cs.iter().take(MAX_CAGE_FACES) {
            let a = c.get(0).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok());
            let b = c.get(1).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok());
            let sh = c.get(2).and_then(Value::as_f64).unwrap_or(SHARP_STORED);
            let (Some(a), Some(b)) = (a, b) else { return Err(bad(cmd, "a crease is [a, b, sharpness]")) };
            if sh.is_nan() || sh < 0.0 {
                return Err(bad(cmd, "crease sharpness must be 0 or more"));
            }
            creases.insert(cadcraft_geom::edge_key(a, b), if sh >= SHARP_STORED { SHARP } else { sh });
        }
    }
    let corners: std::collections::BTreeSet<u32> = p
        .get("corners")
        .and_then(Value::as_array)
        .map(|a| a.iter().take(MAX_CAGE_VERTICES).filter_map(|v| v.as_u64().and_then(|v| u32::try_from(v).ok())).collect())
        .unwrap_or_default();
    let cage = SubdCage::with_tags(positions, &faces, creases, corners).map_err(|e| fail(cmd, e))?;
    let h = add_subd(s, &cage, level)?;
    added(cmd, &[h], "SubD object")
}

fn run_subdcrease(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "subdcrease";
    let hs = objects(cmd, s, p)?;
    let sharp = match p.get("sharpness") {
        None | Some(Value::Null) => SHARP,
        Some(Value::String(t)) if t.eq_ignore_ascii_case("sharp") => SHARP,
        Some(v) => match v.as_f64() {
            Some(x) if x >= 0.0 && x.is_finite() => {
                if x >= SHARP_STORED {
                    SHARP
                } else {
                    x
                }
            }
            _ => return Err(bad(cmd, "`sharpness` must be 0 or more, or \"sharp\"")),
        },
    };
    let edges: Option<Vec<(u32, u32)>> = match p.get("edges") {
        None | Some(Value::Null) => None,
        Some(Value::Array(a)) => Some(
            a.iter()
                .take(MAX_CAGE_FACES)
                .map(|e| {
                    let g = |k: usize| e.get(k).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok());
                    g(0).zip(g(1)).ok_or_else(|| bad(cmd, "an edge is [a, b]"))
                })
                .collect::<Result<_>>()?,
        ),
        Some(_) => return Err(bad(cmd, "`edges` must be [[a, b], …]")),
    };
    let mut n = 0;
    for h in hs {
        let e = entity(cmd, s, h)?;
        let EntityKind::SubD(d) = &e.kind else { continue };
        let mut cage = d.cage().map_err(|e| fail(cmd, e))?;
        match &edges {
            None => cage = crease_all(&cage, sharp).map_err(|e| fail(cmd, e))?,
            Some(list) => {
                for &(a, b) in list {
                    cage = set_crease(&cage, a, b, sharp).map_err(|e| fail(cmd, e))?;
                }
            }
        }
        let next = SubD::from_cage(&cage, d.display_level());
        s.doc_mut()?.modify_entity(h, |e| e.kind = EntityKind::SubD(next)).map_err(|e| fail(cmd, e))?;
        n += 1;
    }
    if n == 0 {
        return Err(bad(cmd, "select SubD objects"));
    }
    Ok(json!({ "creased": n, "message": format!("SUBDCREASE: {n} object{} creased", if n == 1 { "" } else { "s" }) }))
}

/// A surface's control net as a SubD cage: one quad per pair of control rows and columns, with
/// coincident control points (closed seams, poles) welded and the resulting triangles kept.
fn net_cage(f: &Surface) -> std::result::Result<SubdCage, String> {
    let (nu, nv) = (f.count_u, f.count_v);
    if nu < 2 || nv < 2 || f.points.len() != nu.saturating_mul(nv) {
        return Err("the surface's control net is not a grid".into());
    }
    let size = f.bounds3().map(|(a, b)| (b - a).len()).unwrap_or(1.0);
    let tol = 1e-9 * (1.0 + size);
    let mut positions: Vec<Vec3> = Vec::new();
    let mut ids = Vec::with_capacity(f.points.len());
    for q in &f.points {
        let i = positions.iter().position(|o| (*o - *q).len() <= tol).unwrap_or_else(|| {
            positions.push(*q);
            positions.len() - 1
        });
        ids.push(i as u32);
    }
    let id = |i: usize, j: usize| ids.get(i * nv + j).copied().unwrap_or(0);
    let mut faces = Vec::new();
    for i in 0..nu - 1 {
        for j in 0..nv - 1 {
            let mut q = vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
            q.dedup();
            if q.len() > 1 && q.first() == q.last() {
                q.pop();
            }
            if q.len() >= 3 {
                faces.push(q);
            }
        }
    }
    // Drop positions no face uses (welding can leave none, but a pole row can).
    SubdCage::new(positions, &faces).map_err(|e| e.to_string())
}

fn run_tosubd(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "tosubd";
    let hs = objects(cmd, s, p)?;
    let level = level_or(cmd, p)?;
    let delete = bool_or(p, "delete", false);
    let mut out = Vec::new();
    let mut notes = Vec::new();
    for h in hs {
        let e = entity(cmd, s, h)?;
        let EntityKind::Surface(f) = &e.kind else { continue };
        match net_cage(f) {
            Ok(cage) => {
                let nh = s.add_entity(EntityKind::SubD(SubD::from_cage(&cage, level)))?;
                s.doc_mut()?.modify_entity(nh, |n| n.common = e.common.clone()).map_err(|e| fail(cmd, e))?;
                out.push(nh);
                if delete {
                    s.doc_mut()?.remove_entity(h);
                }
            }
            Err(m) => notes.push(format!("{}: {m}", h.hex())),
        }
    }
    if out.is_empty() {
        return Err(bad(cmd, if notes.is_empty() { "select surfaces".to_string() } else { notes.join("; ") }));
    }
    let mut r = added(cmd, &out, "SubD object")?;
    r["notes"] = json!(notes);
    Ok(r)
}

/// The Bézier control points of a uniform cubic B-spline segment (rows of four).
fn bspline_to_bezier(p: [Vec3; 4]) -> [Vec3; 4] {
    let [a, b, c, d] = p;
    [(a + b * 4.0 + c) * (1.0 / 6.0), (b * 4.0 + c * 2.0) * (1.0 / 6.0), (b * 2.0 + c * 4.0) * (1.0 / 6.0), (b + c * 4.0 + d) * (1.0 / 6.0)]
}

/// One regular SubD patch as an exact bicubic Bézier surface.
fn patch_surface(patch: &cadcraft_geom::BicubicPatch) -> std::result::Result<NurbsSurface, cadcraft_geom::SurfaceError> {
    // Rows (v) converted along u, then columns along v.
    let rows: Vec<[Vec3; 4]> = patch.control.iter().map(|r| bspline_to_bezier(*r)).collect();
    let mut grid = [[Vec3::ZERO; 4]; 4]; // grid[j][i]
    for i in 0..4 {
        let col = [
            rows.first().map_or(Vec3::ZERO, |r| r[i]),
            rows.get(1).map_or(Vec3::ZERO, |r| r[i]),
            rows.get(2).map_or(Vec3::ZERO, |r| r[i]),
            rows.get(3).map_or(Vec3::ZERO, |r| r[i]),
        ];
        let b = bspline_to_bezier(col);
        for (j, q) in b.into_iter().enumerate() {
            if let Some(row) = grid.get_mut(j) {
                row[i] = q;
            }
        }
    }
    let mut pts = Vec::with_capacity(16);
    for i in 0..4 {
        for row in &grid {
            pts.push(row[i]);
        }
    }
    let k = vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
    NurbsSurface::new(3, 3, k.clone(), k, 4, 4, pts, Vec::new())
}

fn run_tonurbs(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "tonurbs";
    let hs = objects(cmd, s, p)?;
    let levels = match p.get("levels") {
        None | Some(Value::Null) => 1,
        Some(v) => match v.as_u64() {
            Some(l @ 0..=3) => l as u32,
            _ => return Err(bad(cmd, "`levels` must be 0 to 3")),
        },
    };
    let delete = bool_or(p, "delete", false);
    let mut out = Vec::new();
    let mut gaps = 0usize;
    for h in hs {
        let e = entity(cmd, s, h)?;
        let EntityKind::SubD(d) = &e.kind else { continue };
        let cage = d.cage().map_err(|e| fail(cmd, e))?;
        if cage.max_finite_sharpness() > 0.0 || !cage.creases().is_empty() {
            return Err(bad(cmd, "creased SubD objects cannot be converted yet (remove the creases with SUBDCREASE sharpness 0)"));
        }
        let fine = subdivide_levels(&cage, levels).map_err(|e| fail(cmd, e))?;
        let patches = regular_patches(&fine);
        gaps += fine.face_count().saturating_sub(patches.len());
        if out.len() + patches.len() > MAX_OBJECTS {
            return Err(bad(cmd, "the conversion would make too many surfaces"));
        }
        for (_, patch) in &patches {
            let srf = patch_surface(patch).map_err(|e| fail(cmd, e))?;
            let nh = add_surface(s, &srf, Vec::new())?;
            s.doc_mut()?.modify_entity(nh, |n| n.common = e.common.clone()).map_err(|e| fail(cmd, e))?;
            out.push(nh);
        }
        if delete {
            s.doc_mut()?.remove_entity(h);
        }
    }
    if out.is_empty() && gaps == 0 {
        return Err(bad(cmd, "select SubD objects"));
    }
    let mut r = added(cmd, &out, "surface")?;
    r["gaps"] = json!(gaps);
    if gaps > 0 {
        r["notes"] = json!([format!(
            "{gaps} faces next to extraordinary vertices (not valence 4) are not exact bicubic patches and were left open; more `levels` make them smaller"
        )]);
    }
    Ok(r)
}

// ---------------- meshes ----------------

fn tess_options(cmd: &str, p: &Value, default_tol: f64) -> Result<TessOptions> {
    let chord = f64_or(p, "tolerance", default_tol);
    let angle = f64_or(p, "angle", 15.0);
    if !(chord > 0.0 && chord <= MAX_COORD) || !(angle > 0.0 && angle <= 90.0) {
        return Err(bad(cmd, "`tolerance` must be positive and `angle` in (0, 90] degrees"));
    }
    Ok(TessOptions { chord_tol: chord, angle_tol: angle.to_radians(), max_triangles: 1_000_000 })
}

/// One object's triangles: positions, normals and indices.
struct ObjMesh {
    positions: Vec<Vec3>,
    indices: Vec<u32>,
    closed: bool,
}

fn object_mesh(e: &Entity, opts: &TessOptions, subd_levels: u32) -> std::result::Result<Option<ObjMesh>, String> {
    match &e.kind {
        EntityKind::Surface(f) => {
            let s = f.nurbs().map_err(|e| e.to_string())?;
            // Tolerances far below the object's size only hit the triangle cap.
            let opts = TessOptions { chord_tol: opts.chord_tol.max(s.size() * 1e-5), ..*opts };
            let m = f.mesh(&opts).map_err(|e| e.to_string())?;
            let closed = !f.is_trimmed() && m.open_edges() == 0;
            Ok(Some(ObjMesh { positions: m.positions, indices: m.indices, closed }))
        }
        EntityKind::SubD(d) => {
            let m = d.mesh(subd_levels).map_err(|e| e.to_string())?;
            Ok(Some(ObjMesh { positions: m.positions, indices: m.indices, closed: m.closed }))
        }
        _ => Ok(None),
    }
}

fn r4(v: f64) -> f64 {
    (v * 1e4).round() / 1e4
}

fn run_mesh(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "mesh";
    let hs = objects(cmd, s, p)?;
    let opts = tess_options(cmd, p, 0.01)?;
    let mut meshes = Vec::new();
    let mut triangles = 0usize;
    for h in hs {
        let e = entity(cmd, s, h)?;
        let Some(m) = object_mesh(&e, &opts, 3).map_err(|m| bad(cmd, format!("{}: {m}", h.hex())))? else { continue };
        triangles += m.indices.len() / 3;
        if triangles > cadcraft_geom::MAX_TESS_TRIANGLES {
            return Err(bad(cmd, "too many triangles"));
        }
        let positions: Vec<f64> = m.positions.iter().flat_map(|v| [r4(v.x), r4(v.y), r4(v.z)]).collect();
        meshes.push(json!({ "handle": h.hex(), "positions": positions, "indices": m.indices, "closed": m.closed }));
    }
    if meshes.is_empty() {
        return Err(bad(cmd, "select surfaces or SubD objects"));
    }
    Ok(json!({ "meshes": meshes, "triangles": triangles, "message": format!("MESH: {triangles} triangles") }))
}

fn run_surfmesh(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "surfmesh";
    let fine = match str_param(p, "quality") {
        None | Some("draft") => false,
        Some("fine") => true,
        Some(_) => return Err(bad(cmd, "`quality` is draft or fine")),
    };
    let default_metal = str_param(p, "metal").unwrap_or("gold18");
    if super::jewelry::metal_density(default_metal).is_none() {
        return Err(bad(cmd, format!("unknown metal `{default_metal}`")));
    }
    let d = s.doc()?;
    let mut meshes = Vec::new();
    let mut notes = Vec::new();
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut triangles = 0usize;
    for e in d.model.iter() {
        if !matches!(e.kind, EntityKind::Surface(_) | EntityKind::SubD(_)) || !d.is_visible(e) {
            continue;
        }
        let size = match &e.kind {
            EntityKind::Surface(f) => f.bounds3(),
            EntityKind::SubD(f) => f.bounds3(),
            _ => None,
        }
        .map(|(a, b)| (b - a).len())
        .unwrap_or(1.0);
        let opts = if fine {
            TessOptions { chord_tol: size * 3e-4, angle_tol: 10f64.to_radians(), max_triangles: 300_000 }
        } else {
            TessOptions { chord_tol: size * 3e-3, angle_tol: 20f64.to_radians(), max_triangles: 60_000 }
        };
        let m = match object_mesh(e, &opts, if fine { 3 } else { 2 }) {
            Ok(Some(m)) => m,
            Ok(None) => continue,
            Err(m) => {
                notes.push(format!("{} {}: {m}", e.kind.type_name(), e.handle.hex()));
                continue;
            }
        };
        triangles += m.indices.len() / 3;
        if triangles > 4_000_000 {
            notes.push("more free-form objects than the view shows at once".to_string());
            break;
        }
        let layer_metal = e.common.layer.to_ascii_lowercase();
        let metal = if super::jewelry::metal_density(&layer_metal).is_some() { layer_metal.as_str() } else { default_metal };
        let mut positions = Vec::with_capacity(m.positions.len() * 3);
        for v in &m.positions {
            for (k, x) in [v.x, v.y, v.z].into_iter().enumerate() {
                if let (Some(l), Some(h)) = (lo.get_mut(k), hi.get_mut(k)) {
                    *l = l.min(x);
                    *h = h.max(x);
                }
                positions.push(r4(x));
            }
        }
        let name = format!("{} {}", e.kind.type_name(), e.handle.hex());
        meshes.push(json!({ "part": "metal", "name": name, "handle": e.handle.hex(), "color": super::jewelry::metal_rgb(metal), "metal": metal, "positions": positions, "indices": m.indices, "closed": m.closed }));
    }
    if meshes.is_empty() {
        return Err(bad(cmd, "the drawing has no surfaces or SubD objects"));
    }
    Ok(json!({
        "meshes": meshes,
        "bounds": { "min": lo, "max": hi },
        "triangles": triangles,
        "quality": if fine { "fine" } else { "draft" },
        "notes": notes,
    }))
}

// ---------------- trimming ----------------

/// The closed curve `c` projected onto surface `srf` as a parameter-space loop.
fn project_loop(cmd: &str, srf: &NurbsSurface, c: &NurbsCurve3, closest: bool) -> Result<Vec<Vec2>> {
    if !c.is_closed(1e-9 * (1.0 + c.points().iter().fold(0.0f64, |m, q| m.max(q.len())))) {
        return Err(bad(cmd, "the cutting curve must be closed (open cutting curves are not available yet)"));
    }
    let pts = curve_polygon(c);
    let mut out = Vec::with_capacity(pts.len());
    for q in pts {
        let uv = if closest {
            srf.closest_point(q).ok().map(|cp| Vec2::new(cp.u, cp.v))
        } else {
            project_along(srf, q, Vec3::new(0.0, 0.0, 1.0)).or_else(|| srf.closest_point(q).ok().map(|cp| Vec2::new(cp.u, cp.v)))
        };
        out.push(uv.ok_or_else(|| bad(cmd, "the curve could not be projected onto the surface"))?);
    }
    if loop_area(&out).abs() < 1e-14 {
        return Err(bad(cmd, "the curve does not enclose any of the surface"));
    }
    Ok(out)
}

/// The trims of `f` with region `cut` kept (`inside`) or removed.
fn trims_with(f: &Surface, srf: &NurbsSurface, cut: Vec<Vec2>, inside: bool) -> Vec<Vec<Vec2>> {
    let (u0, u1) = srf.domain_u();
    let (v0, v1) = srf.domain_v();
    let domain = vec![Vec2::new(u0, v0), Vec2::new(u1, v0), Vec2::new(u1, v1), Vec2::new(u0, v1)];
    let mut loops = f.trims.clone();
    match (loops.is_empty(), inside) {
        (true, true) => vec![cut],
        (true, false) => vec![domain, cut],
        // Even–odd: a loop inside the kept region cuts a hole; keeping the inside of an
        // already-trimmed surface keeps the cut loop's region alone.
        (false, false) => {
            loops.push(cut);
            loops
        }
        (false, true) => vec![cut],
    }
}

fn surface_and_loop(cmd: &str, s: &Session, p: &Value) -> Result<(Handle, Entity, Surface, NurbsSurface, Vec<Vec2>)> {
    let (sh, ch) = pair(cmd, s, p, "surface", "curve")?;
    let (sh, ch) = match (&entity(cmd, s, sh)?.kind, &entity(cmd, s, ch)?.kind) {
        (_, EntityKind::Surface(_)) => (ch, sh),
        _ => (sh, ch),
    };
    let e = entity(cmd, s, sh)?;
    let EntityKind::Surface(f) = &e.kind else { return Err(bad(cmd, "select a surface and a closed curve")) };
    let f = f.clone();
    let srf = f.nurbs().map_err(|e| fail(cmd, e))?;
    let c = curve3(cmd, &entity(cmd, s, ch)?)?;
    let closest = match str_param(p, "direction") {
        None | Some("view") => false,
        Some("closest") => true,
        Some(_) => return Err(bad(cmd, "`direction` is view or closest")),
    };
    let lp = project_loop(cmd, &srf, &c, closest)?;
    Ok((sh, e, f, srf, lp))
}

fn run_surftrim(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "surftrim";
    let inside = match str_param(p, "keep") {
        None | Some("outside") => false,
        Some("inside") => true,
        Some(_) => return Err(bad(cmd, "`keep` is outside or inside")),
    };
    let (h, _, f, srf, lp) = surface_and_loop(cmd, s, p)?;
    let trims = trims_with(&f, &srf, lp, inside);
    validate_trims(&trims).map_err(|e| fail(cmd, e))?;
    let mut next = f.clone();
    next.trims = trims;
    let area = next.area(&TessOptions { chord_tol: srf.size() * 1e-3, ..TessOptions::default() }).map_err(|e| fail(cmd, e))?;
    s.doc_mut()?.modify_entity(h, |e| e.kind = EntityKind::Surface(next)).map_err(|e| fail(cmd, e))?;
    Ok(json!({ "handle": h.hex(), "area": area, "message": format!("SURFTRIM: trimmed; area {area:.4}") }))
}

fn run_split(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "split";
    let (h, e, f, srf, lp) = surface_and_loop(cmd, s, p)?;
    let mut a = f.clone();
    a.trims = trims_with(&f, &srf, lp.clone(), true);
    let mut b = f.clone();
    b.trims = trims_with(&f, &srf, lp, false);
    validate_trims(&a.trims).map_err(|e| fail(cmd, e))?;
    validate_trims(&b.trims).map_err(|e| fail(cmd, e))?;
    s.doc_mut()?.modify_entity(h, |x| x.kind = EntityKind::Surface(a)).map_err(|e| fail(cmd, e))?;
    let nh = s.add_entity(EntityKind::Surface(b))?;
    s.doc_mut()?.modify_entity(nh, |x| x.common = e.common.clone()).map_err(|e| fail(cmd, e))?;
    added(cmd, &[h, nh], "surface")
}

// ---------------- measuring ----------------

/// Mass properties of the free-form objects among `hs` (for MASSPROP): area, closed, volume and
/// the weight in every metal when closed. `None` when there are none.
pub(crate) fn massprop(s: &Session, hs: &[Handle]) -> Result<Option<Value>> {
    let d = s.doc()?;
    let mut out = Vec::new();
    let mut lines = Vec::new();
    for h in hs {
        let Some(e) = d.entity(*h) else { continue };
        let (area, volume, closed) = match &e.kind {
            EntityKind::Surface(f) => {
                let size = f.bounds3().map(|(a, b)| (b - a).len()).unwrap_or(1.0);
                let area = f.area(&TessOptions { chord_tol: size * 1e-4, ..TessOptions::default() }).map_err(|e| fail("massprop", e))?;
                let closed = !f.is_trimmed() && f.nurbs().is_ok_and(|n| n.is_closed(1e-9 * (1.0 + size)));
                (area, if closed { f.volume().ok() } else { None }, closed)
            }
            EntityKind::SubD(sd) => {
                let m = sd.mesh(4).map_err(|e| fail("massprop", e))?;
                (m.area(), if m.closed { m.volume().map(f64::abs) } else { None }, m.closed)
            }
            _ => continue,
        };
        let mut row = json!({ "handle": h.hex(), "type": e.kind.type_name(), "area": area, "closed": closed });
        let mut text = format!("----------------   {}   ----------------\nArea:                    {area:.4}", e.kind.type_name().to_uppercase());
        if let Some(v) = volume {
            let grams: serde_json::Map<String, Value> = super::jewelry::metal_names()
                .iter()
                .filter_map(|n| Some(((*n).to_string(), json!((v.abs() / 1000.0 * super::jewelry::metal_density(n)? * 1000.0).round() / 1000.0))))
                .collect();
            row["volume"] = json!(v.abs());
            row["grams"] = Value::Object(grams);
            text.push_str(&format!("\nVolume:                  {:.4}", v.abs()));
            if let Some(g) = super::jewelry::metal_density("gold18") {
                text.push_str(&format!("\nWeight (18k gold):       {:.3} g", v.abs() / 1000.0 * g));
            }
        } else {
            text.push_str("\nVolume:                  (open: no volume)");
        }
        out.push(row);
        lines.push(text);
    }
    if out.is_empty() {
        return Ok(None);
    }
    Ok(Some(json!({ "objects": out, "message": lines.join("\n") })))
}
