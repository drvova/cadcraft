//! FLOWALONGSRF and FLOW: bend drawing objects onto a target surface or along a target curve
//! (`cadcraft_geom::flow`). Lines, arcs, circles, ellipses, polylines, splines and hatch
//! boundaries flow as curves (refined to the tolerance, written as 3D polylines), 3DFACEs as a
//! mesh (subdivided, written as 3DFACEs) and points as points. A `points` list flows too and
//! comes back with the target frame at each point — stone positions and normals for pavé.

use cadcraft_doc::{Common, Entity, EntityKind, Face3d, Handle, Point, Polyline3d, Prim};
use cadcraft_geom::flow::{MAX_FLOW_POINTS, surface_from_net};
use cadcraft_geom::{CurveFlow, Flow, FlowBase, FlowOptions, FlowPoint, NurbsCurve3, NurbsSurface, SurfaceError, SurfaceFlow, Vec2, Vec3};
use serde_json::{Value, json};

use super::{CommandSpec, bad, bool_or, f64_or, str_param, targets};
use crate::{Result, Session};

/// Most objects one flow takes.
const MAX_OBJECTS: usize = 10_000;
/// Most raw points (`points`) one flow takes.
const MAX_POINTS: usize = 100_000;
/// Most objects one flow adds.
const MAX_ADDED: usize = 200_000;
/// Most control points a JSON target or base net may list.
const MAX_NET: usize = 65_536;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("flowalongsrf", "Flow Along Surface", run_flowalongsrf)
            .menu(&["Modify", "3D Operations", "Flow Along Surface"])
            .params(
                "{handles?: [hex] (default: selection), points?: [[x,y,z?]] (also flowed, returned as stones with normals), \
                 target: {degreeU?: 3, degreeV?: 3, countU, countV, points: [[x,y,z]] row-major (u-index · countV + v-index), knotsU?, knotsV?, weights?} \
                 | {handle: hex} (a surface entity, when the drawing has them), \
                 base?: {origin: [x,y,z?], xAxis?: [x,y,z], yAxis?: [x,y,z], width, height} | {surface: <net as target>} (default: the objects' bounding rectangle in XY), \
                 mode?: \"deforming\"|\"rigid\", stretch?: true, flip?: false, offset?: 0, tolerance?: (base/1000), deleteInput?: false, query?: false}",
            ),
        CommandSpec::new("flow", "Flow Along Curve", run_flow).menu(&["Modify", "3D Operations", "Flow Along Curve"]).params(
            "{handles?: [hex] (default: selection), points?: [[x,y,z?]], target: {handle: hex} (a line, arc, circle, polyline or spline) \
             | {points: [[x,y,z]], degree?: 3} (control points), base?: {from: [x,y,z?], to: [x,y,z?]} (default: the objects' bounding box \
             across x at its middle y), mode?, stretch?: true, flip?, offset?, tolerance?, deleteInput?, query?}",
        ),
    ]
}

fn cmd_err(cmd: &str, e: SurfaceError) -> crate::EngineError {
    bad(cmd, e.to_string())
}

fn p3(v: &Value) -> Option<Vec3> {
    let p = match v {
        Value::Array(a) if (2..=3).contains(&a.len()) => {
            Vec3::new(a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2).map(Value::as_f64).unwrap_or(Some(0.0))?)
        }
        Value::Object(_) => Vec3::new(v.get("x")?.as_f64()?, v.get("y")?.as_f64()?, v.get("z").map(Value::as_f64).unwrap_or(Some(0.0))?),
        _ => return None,
    };
    p.is_finite().then_some(p)
}

fn p3_req(cmd: &str, v: &Value, key: &str) -> Result<Vec3> {
    v.get(key).and_then(p3).ok_or_else(|| bad(cmd, format!("`{key}` must be a point [x, y, z]")))
}

fn points_list(cmd: &str, v: Option<&Value>, key: &str, cap: usize) -> Result<Vec<Vec3>> {
    let Some(v) = v else { return Ok(Vec::new()) };
    let a = v.as_array().ok_or_else(|| bad(cmd, format!("`{key}` must be an array of points")))?;
    if a.len() > cap {
        return Err(bad(cmd, format!("`{key}` lists {} points; at most {cap}", a.len())));
    }
    a.iter().map(|p| p3(p).ok_or_else(|| bad(cmd, format!("`{key}`: {p} is not a finite point")))).collect()
}

fn usize_field(cmd: &str, v: &Value, key: &str, default: Option<usize>) -> Result<usize> {
    match v.get(key) {
        None | Some(Value::Null) => default.ok_or_else(|| bad(cmd, format!("`{key}` is required"))),
        Some(x) => x.as_u64().and_then(|n| usize::try_from(n).ok()).ok_or_else(|| bad(cmd, format!("`{key}` must be a whole number"))),
    }
}

fn floats(cmd: &str, v: &Value, key: &str) -> Result<Vec<f64>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(a)) if a.len() <= MAX_NET * 2 => {
            a.iter().map(|x| x.as_f64().filter(|f| f.is_finite()).ok_or_else(|| bad(cmd, format!("`{key}` must hold finite numbers")))).collect()
        }
        Some(_) => Err(bad(cmd, format!("`{key}` must be an array of numbers"))),
    }
}

/// A NURBS surface from a JSON control net.
fn net_surface(cmd: &str, v: &Value) -> Result<NurbsSurface> {
    let du = usize_field(cmd, v, "degreeU", Some(3))?;
    let dv = usize_field(cmd, v, "degreeV", Some(3))?;
    let cu = usize_field(cmd, v, "countU", None)?;
    let cv = usize_field(cmd, v, "countV", None)?;
    if cu.checked_mul(cv).is_none_or(|n| n > MAX_NET) {
        return Err(bad(cmd, format!("a control net of {cu} × {cv} is too large (at most {MAX_NET} points)")));
    }
    let pts = points_list(cmd, v.get("points"), "points", MAX_NET)?;
    if pts.len() != cu * cv {
        return Err(bad(cmd, format!("the net needs countU × countV = {} points, got {}", cu * cv, pts.len())));
    }
    // Degrees above the count fall back to the highest the net allows.
    let (du, dv) = (du.clamp(1, cu.saturating_sub(1).max(1)), dv.clamp(1, cv.saturating_sub(1).max(1)));
    let weights = floats(cmd, v, "weights")?;
    let (ku, kv) = (floats(cmd, v, "knotsU")?, floats(cmd, v, "knotsV")?);
    let s = if ku.is_empty() && kv.is_empty() {
        surface_from_net(du, dv, cu, cv, pts, weights)
    } else {
        NurbsSurface::new(du, dv, ku, kv, cu, cv, pts, weights)
    };
    s.map_err(|e| bad(cmd, format!("the control net is not a valid surface: {e}")))
}

/// HOOK: a surface entity of the drawing as a NURBS surface. Surface entities are being added
/// separately; once `EntityKind` has one, convert it here and FLOWALONGSRF takes it by handle.
fn surface_entity(cmd: &str, s: &Session, h: Handle) -> Result<NurbsSurface> {
    let d = s.doc()?;
    let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object with handle {}", h.hex())))?;
    Err(bad(
        cmd,
        format!("{} is a {}, not a surface; surface objects are not available yet — give `target` as a control net", h.hex(), e.kind.type_name()),
    ))
}

fn surface_spec(cmd: &str, s: &Session, v: &Value) -> Result<NurbsSurface> {
    if !v.is_object() {
        return Err(bad(cmd, "`target` must be an object: a control net or {handle}"));
    }
    if let Some(h) = v.get("handle") {
        let h = super::curves::handle_value(h).ok_or_else(|| bad(cmd, format!("`handle`: {h} is not an object handle")))?;
        return surface_entity(cmd, s, h);
    }
    net_surface(cmd, v)
}

/// One piece of an object to flow.
enum Shape {
    Points(Vec<Vec3>),
    Line(Vec<Vec3>, bool),
    Mesh(Vec<[Vec3; 3]>),
}

fn shape_points(sh: &Shape) -> Vec<Vec3> {
    match sh {
        Shape::Points(p) | Shape::Line(p, _) => p.clone(),
        Shape::Mesh(t) => t.iter().flatten().copied().collect(),
    }
}

/// Append a 2D chain to the open polylines, joining it to the last one when it continues it.
fn push_chain(out: &mut Vec<Shape>, pts: Vec<Vec2>, closed: bool) {
    let pts: Vec<Vec3> = pts.into_iter().map(|p| p.to3(0.0)).collect();
    if !closed
        && let (Some(Shape::Line(last, false)), Some(&first)) = (out.last_mut(), pts.first())
        && last.last().is_some_and(|&q| (q - first).len() < 1e-9)
    {
        last.extend(pts.into_iter().skip(1));
        return;
    }
    if pts.len() >= 2 {
        out.push(Shape::Line(pts, closed));
    } else if let Some(&p) = pts.first() {
        out.push(Shape::Points(vec![p]));
    }
}

/// The shapes an object flows as; `None` for objects that cannot flow.
fn shapes_of(e: &Entity, tol: f64) -> Option<Vec<Shape>> {
    let mut out = Vec::new();
    match &e.kind {
        EntityKind::Point(p) => out.push(Shape::Points(vec![p.p])),
        EntityKind::Line(l) => out.push(Shape::Line(vec![l.a, l.b], false)),
        EntityKind::Polyline3d(p) => out.push(Shape::Line(p.points.clone(), p.closed)),
        EntityKind::Face3d(f) => {
            let c = f.corners;
            let mut tris = vec![[c[0], c[1], c[2]]];
            if (c[3] - c[2]).len() > 1e-12 {
                tris.push([c[0], c[2], c[3]]);
            }
            out.push(Shape::Mesh(tris));
        }
        EntityKind::Text(_) | EntityKind::MText(_) | EntityKind::Insert(_) | EntityKind::Dimension(_) | EntityKind::Unknown(_) => return None,
        k => {
            for prim in k.prims() {
                let mut pts = Vec::new();
                match prim {
                    Prim::Seg(seg) => {
                        seg.tessellate(tol, &mut pts);
                        push_chain(&mut out, pts, false);
                    }
                    Prim::Circle(c) => {
                        c.tessellate(tol, &mut pts);
                        push_chain(&mut out, pts, true);
                    }
                    Prim::Ellipse(el) => {
                        el.tessellate(tol, &mut pts);
                        let sw = (el.end - el.start).abs();
                        push_chain(&mut out, pts, sw < 1e-12 || (sw - cadcraft_geom::TAU).abs() < 1e-9);
                    }
                    Prim::Spline(sp) => push_chain(&mut out, sp.tessellate(tol), false),
                    Prim::Fill(f) => push_chain(&mut out, f, true),
                    Prim::Point(p) => out.push(Shape::Points(vec![p.to3(0.0)])),
                    _ => {}
                }
            }
        }
    }
    (!out.is_empty()).then_some(out)
}

struct Opts {
    rigid: bool,
    flow: FlowOptions,
    delete: bool,
    query: bool,
}

fn read_opts(cmd: &str, p: &Value) -> Result<Opts> {
    let rigid = match str_param(p, "mode").map(str::to_ascii_lowercase).as_deref() {
        None | Some("deforming") | Some("deform") => false,
        Some("rigid") => true,
        Some(m) => return Err(bad(cmd, format!("`mode` must be \"deforming\" or \"rigid\", not \"{m}\""))),
    };
    let offset = f64_or(p, "offset", 0.0);
    let tol = f64_or(p, "tolerance", 0.0);
    if !offset.is_finite() || offset.abs() > 1e12 {
        return Err(bad(cmd, "`offset` must be a finite distance"));
    }
    let flow =
        FlowOptions { stretch: bool_or(p, "stretch", true), flip: bool_or(p, "flip", false), offset, tol: if tol.is_finite() { tol } else { 0.0 } };
    Ok(Opts { rigid, flow, delete: bool_or(p, "deleteInput", false), query: bool_or(p, "query", false) })
}

/// The objects to flow with their shapes, plus notes for those skipped.
fn gather(cmd: &str, s: &Session, p: &Value, tess_tol: f64) -> Result<(Vec<(Handle, Common, Vec<Shape>)>, Vec<String>)> {
    let hs = if p.get("handles").is_none() && p.get("handle").is_none() && p.get("points").is_some() { Vec::new() } else { targets(s, p)? };
    if hs.len() > MAX_OBJECTS {
        return Err(bad(cmd, format!("{} objects selected; at most {MAX_OBJECTS} flow at once", hs.len())));
    }
    let d = s.doc()?;
    let mut objs = Vec::new();
    let mut notes = Vec::new();
    for h in hs {
        let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object with handle {}", h.hex())))?;
        match shapes_of(e, tess_tol) {
            Some(sh) => objs.push((h, e.common.clone(), sh)),
            None => notes.push(format!("{} ({}) cannot flow; skipped.", h.hex(), e.kind.type_name())),
        }
    }
    Ok((objs, notes))
}

fn all_points(objs: &[(Handle, Common, Vec<Shape>)], extra: &[Vec3]) -> Vec<Vec3> {
    let mut v: Vec<Vec3> = objs.iter().flat_map(|(_, _, sh)| sh.iter().flat_map(shape_points)).collect();
    v.extend_from_slice(extra);
    v
}

fn bbox(pts: &[Vec3]) -> Option<(Vec3, Vec3)> {
    let f = *pts.first()?;
    Some(
        pts.iter().fold((f, f), |(lo, hi), p| {
            (Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z)), Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z)))
        }),
    )
}

/// A rough size of the input, for the tessellation tolerance before the base is known.
fn rough_size(cmd: &str, s: &Session, p: &Value) -> Result<f64> {
    let (objs, _) = gather(cmd, s, p, 1e-3)?;
    let extra = points_list(cmd, p.get("points"), "points", MAX_POINTS)?;
    Ok(bbox(&all_points(&objs, &extra)).map(|(lo, hi)| (hi - lo).len()).unwrap_or(1.0).max(1e-9))
}

fn fp_json(f: &FlowPoint) -> Value {
    let r = |x: f64| (x * 1e9).round() / 1e9;
    let v3 = |v: Vec3| json!([r(v.x), r(v.y), r(v.z)]);
    json!({ "point": v3(f.point), "normal": v3(f.normal()), "tangent": v3(f.axes[0]), "u": r(f.u), "v": r(f.v), "inside": f.inside })
}

/// Flow everything with `flow` and add the results.
fn apply<F: Flow>(
    cmd: &str,
    s: &mut Session,
    flow: &F,
    objs: Vec<(Handle, Common, Vec<Shape>)>,
    extra: &[Vec3],
    o: &Opts,
    mut notes: Vec<String>,
) -> Result<Value> {
    let e = |err| cmd_err(cmd, err);
    let mut new: Vec<(Common, EntityKind)> = Vec::new();
    let mut outside = 0usize;
    let push = |new: &mut Vec<(Common, EntityKind)>, c: &Common, k: EntityKind| -> Result<()> {
        if new.len() >= MAX_ADDED {
            return Err(bad(cmd, format!("the flow would add more than {MAX_ADDED} objects; raise the tolerance or flow fewer objects")));
        }
        new.push((c.clone(), k));
        Ok(())
    };
    let mut inputs = Vec::new();
    for (h, common, shapes) in objs {
        inputs.push(h);
        let anchor = if o.rigid { cadcraft_geom::flow::bbox_centre(&shapes.iter().flat_map(shape_points).collect::<Vec<_>>()) } else { None };
        if let Some(a) = anchor
            && !flow.map_point(a).map_err(e)?.inside
        {
            outside += 1;
        }
        for sh in shapes {
            match sh {
                Shape::Points(pts) => {
                    let mapped: Vec<Vec3> = if o.rigid {
                        flow.map_rigid(&pts, anchor).map_err(e)?.0
                    } else {
                        flow.map_points(&pts).map_err(e)?.iter().map(|f| f.point).collect()
                    };
                    for q in mapped {
                        push(&mut new, &common, EntityKind::Point(Point { p: q, angle: 0.0 }))?;
                    }
                }
                Shape::Line(pts, closed) => {
                    let mut mapped = if o.rigid { flow.map_rigid(&pts, anchor).map_err(e)?.0 } else { flow.map_polyline(&pts, closed).map_err(e)? };
                    if closed && !o.rigid && mapped.len() > 2 {
                        mapped.pop();
                    }
                    push(&mut new, &common, EntityKind::Polyline3d(Polyline3d { points: mapped, closed }))?;
                }
                Shape::Mesh(tris) => {
                    let mapped = if o.rigid {
                        let flat: Vec<Vec3> = tris.iter().flatten().copied().collect();
                        let m = flow.map_rigid(&flat, anchor).map_err(e)?.0;
                        m.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect()
                    } else {
                        flow.map_mesh(&tris).map_err(e)?
                    };
                    for t in mapped {
                        push(&mut new, &common, EntityKind::Face3d(Face3d { corners: [t[0], t[1], t[2], t[2]], hidden_edges: 0 }))?;
                    }
                }
            }
        }
    }
    let stones: Vec<FlowPoint> = flow.map_points(extra).map_err(e)?;
    outside += stones.iter().filter(|f| !f.inside).count();
    if outside > 0 {
        notes.push(format!("{outside} objects or points lie beyond the target's extent and were placed at its edge."));
    }
    let mut added = Vec::new();
    if !o.query {
        let space = s.space();
        let d = s.doc_mut()?;
        for (common, kind) in new {
            added.push(d.add(&space, common, kind)?);
        }
        if o.delete {
            for h in &inputs {
                d.remove_entity(*h);
            }
        }
        if !added.is_empty() {
            s.set_selection(added.clone());
        }
    }
    let message = format!(
        "{} objects{} flowed{}{}",
        inputs.len(),
        if o.rigid { " (rigid)" } else { "" },
        if added.is_empty() { String::new() } else { format!("; {} added", added.len()) },
        if stones.is_empty() { String::new() } else { format!("; {} points placed", stones.len()) }
    );
    Ok(json!({
        "added": added.iter().map(|h| h.hex()).collect::<Vec<_>>(),
        "stones": stones.iter().map(fp_json).collect::<Vec<_>>(),
        "tolerance": flow.tolerance(),
        "notes": notes,
        "message": message,
    }))
}

fn run_flowalongsrf(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "flowalongsrf";
    let o = read_opts(CMD, p)?;
    let target = surface_spec(CMD, s, p.get("target").ok_or_else(|| bad(CMD, "`target` (a control net or {handle}) is required"))?)?;
    let size = rough_size(CMD, s, p)?;
    let tess = if o.flow.tol > 0.0 { (o.flow.tol / 4.0).max(size * 1e-7) } else { size * 2.5e-4 };
    let (objs, notes) = gather(CMD, s, p, tess)?;
    let extra = points_list(CMD, p.get("points"), "points", MAX_POINTS)?;
    if objs.is_empty() && extra.is_empty() {
        return Err(bad(CMD, "nothing to flow: select objects or give `points`"));
    }
    let base = match p.get("base") {
        None | Some(Value::Null) => {
            let (lo, hi) = bbox(&all_points(&objs, &extra)).ok_or_else(|| bad(CMD, "nothing to flow"))?;
            let (mut w, mut h) = (hi.x - lo.x, hi.y - lo.y);
            let mut origin = Vec3::new(lo.x, lo.y, 0.0);
            // A row (or a single point) gets a square base centred on it.
            let side = w.max(h).max(1e-6);
            if w < side * 1e-6 {
                origin.x -= side / 2.0;
                w = side;
            }
            if h < side * 1e-6 {
                origin.y -= side / 2.0;
                h = side;
            }
            FlowBase::Rect { origin, x_axis: Vec3::new(1.0, 0.0, 0.0), y_axis: Vec3::new(0.0, 1.0, 0.0), width: w, height: h }
        }
        Some(b) if b.get("surface").is_some() => FlowBase::Surface(net_surface(CMD, b.get("surface").unwrap_or(&Value::Null))?),
        Some(b) => {
            let origin = p3_req(CMD, b, "origin")?;
            let x_axis =
                b.get("xAxis").map(|v| p3(v).ok_or_else(|| bad(CMD, "`xAxis` must be a vector"))).transpose()?.unwrap_or(Vec3::new(1.0, 0.0, 0.0));
            let y_axis =
                b.get("yAxis").map(|v| p3(v).ok_or_else(|| bad(CMD, "`yAxis` must be a vector"))).transpose()?.unwrap_or(Vec3::new(0.0, 1.0, 0.0));
            FlowBase::Rect { origin, x_axis, y_axis, width: f64_or(b, "width", f64::NAN), height: f64_or(b, "height", f64::NAN) }
        }
    };
    let flow = SurfaceFlow::new(base, target, o.flow).map_err(|e| cmd_err(CMD, e))?;
    apply(CMD, s, &flow, objs, &extra, &o, notes)
}

/// The target curve of FLOW from a drawing object.
fn curve_entity(cmd: &str, s: &Session, h: Handle) -> Result<NurbsCurve3> {
    let d = s.doc()?;
    let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object with handle {}", h.hex())))?;
    let err = |x: SurfaceError| bad(cmd, format!("{} cannot be a flow target: {x}", h.hex()));
    match &e.kind {
        EntityKind::Line(l) => NurbsCurve3::line(l.a, l.b).map_err(err),
        EntityKind::Spline(sp) => NurbsCurve3::from_spline(sp).map_err(err),
        EntityKind::Polyline3d(p) => {
            let mut pts = p.points.clone();
            if p.closed
                && let Some(&f) = pts.first()
            {
                pts.push(f);
            }
            if pts.len() > MAX_FLOW_POINTS {
                return Err(bad(cmd, "the target polyline is too long"));
            }
            NurbsCurve3::from_control(pts, 1).map_err(err)
        }
        k => {
            let mut out = Vec::new();
            for prim in k.prims() {
                let mut pts = Vec::new();
                match prim {
                    Prim::Seg(seg) => seg.tessellate(1e-4 * seg.len().max(1e-9), &mut pts),
                    Prim::Circle(c) => c.tessellate(1e-5 * c.radius.max(1e-9), &mut pts),
                    Prim::Ellipse(el) => el.tessellate(1e-5 * el.major.len().max(1e-9), &mut pts),
                    _ => return Err(bad(cmd, format!("{} ({}) cannot be a flow target", h.hex(), k.type_name()))),
                }
                for q in pts {
                    if out.last().is_none_or(|l: &Vec2| (*l - q).len() > 1e-12) {
                        out.push(q);
                    }
                }
                if out.len() > MAX_FLOW_POINTS {
                    return Err(bad(cmd, "the target curve is too long"));
                }
            }
            NurbsCurve3::from_control(out.into_iter().map(|q| q.to3(0.0)).collect(), 1).map_err(err)
        }
    }
}

fn run_flow(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "flow";
    let o = read_opts(CMD, p)?;
    let t = p.get("target").ok_or_else(|| bad(CMD, "`target` ({handle} or {points}) is required"))?;
    let curve = if let Some(h) = t.get("handle") {
        let h = super::curves::handle_value(h).ok_or_else(|| bad(CMD, format!("`handle`: {h} is not an object handle")))?;
        curve_entity(CMD, s, h)?
    } else {
        let pts = points_list(CMD, t.get("points"), "points", MAX_NET)?;
        let deg = usize_field(CMD, t, "degree", Some(3))?.clamp(1, pts.len().saturating_sub(1).max(1));
        NurbsCurve3::from_control(pts, deg).map_err(|e| bad(CMD, format!("the target curve is not valid: {e}")))?
    };
    let size = rough_size(CMD, s, p)?;
    let tess = if o.flow.tol > 0.0 { (o.flow.tol / 4.0).max(size * 1e-7) } else { size * 2.5e-4 };
    let (objs, notes) = gather(CMD, s, p, tess)?;
    let extra = points_list(CMD, p.get("points"), "points", MAX_POINTS)?;
    if objs.is_empty() && extra.is_empty() {
        return Err(bad(CMD, "nothing to flow: select objects or give `points`"));
    }
    let (from, to) = match p.get("base") {
        None | Some(Value::Null) => {
            let (lo, hi) = bbox(&all_points(&objs, &extra)).ok_or_else(|| bad(CMD, "nothing to flow"))?;
            let y = (lo.y + hi.y) / 2.0;
            (Vec3::new(lo.x, y, 0.0), Vec3::new(hi.x.max(lo.x + 1e-6), y, 0.0))
        }
        Some(b) => (p3_req(CMD, b, "from")?, p3_req(CMD, b, "to")?),
    };
    let flow = CurveFlow::new(from, to, curve, o.flow).map_err(|e| cmd_err(CMD, e))?;
    apply(CMD, s, &flow, objs, &extra, &o, notes)
}

#[cfg(test)]
#[path = "flow_surface_tests.rs"]
mod tests;
