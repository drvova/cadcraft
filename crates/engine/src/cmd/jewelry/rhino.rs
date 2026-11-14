//! IMPORT3DM: a Rhino `.3dm` file's meshes measured (triangles, volume, weight in every metal,
//! bounds) and its curves brought in as the drawing's lines, arcs, circles, polylines and splines,
//! on the file's layers; so a jeweller who modelled in Rhino can weigh a piece here and use a
//! profile or rail with `PIECE {profile: {curve}}`.
//!
//! The reader is `cadcraft_io::rhino3dm` (`docs/formats/3dm.md`). The drawing is 2D: a curve
//! that does not lie in a plane parallel to XY is projected onto XY (and said so); meshes are
//! reported, and added as 3DFACE objects only when asked (`faces: true`), because the drawing
//! has no mesh object of its own yet.

use cadcraft_color::{Color, Rgb};
use cadcraft_doc::{Arc as DArc, Circle as DCircle, EntityKind, Face3d, Line as DLine, LwPolyline};
use cadcraft_geom::{PolyVertex, Spline as GSpline, TAU, Vec2, Vec3};
use cadcraft_io::rhino3dm::{self, Curve, Geometry, Mesh, Model};
use serde_json::{Value, json};

use super::sizes::density_of;
use super::*;

/// The metals a mesh is weighed in, in the order the report lists them.
pub(super) const METALS: [&str; 14] =
    ["gold24", "gold22", "gold18", "gold14", "gold10", "gold9", "platinum", "palladium", "silver", "steel", "titanium", "brass", "copper", "wax"];
/// The most 3DFACE objects one import adds.
const MAX_FACES: usize = 20_000;
/// The most curves one import adds.
const MAX_CURVES: usize = 20_000;
/// The most points a curve is flattened to when it has to be (a tilted arc, a joined curve
/// with NURBS segments).
const MAX_FLAT_POINTS: usize = 20_000;
/// Out of the XY plane by more than this fraction of a curve's size is "not planar in XY".
const PLANAR: f64 = 1e-6;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("import3dm", "Import Rhino 3DM...", run_import3dm)
            .params(
                "{path | data: base64, name?: \"x.3dm\", curves?: bool (default true: add the file's lines, arcs, circles, polylines, NURBS curves and joined curves as the drawing's lines, arcs, circles, polylines and splines on the file's layers; a curve off the XY plane is projected onto it), faces?: bool (default false: add each mesh as 3DFACE objects, at most 20000 faces), query?: bool (report only, add nothing)} → {version, units, mmPerUnit, layers: [{name, color}], meshes: [{name, layer, vertices, faces, triangles, closed, volumeMm3 (closed meshes only), grams: {gold24 … wax} (closed only), bounds: {min, max} (mm)}], curves: [{name, layer, kind: line|arc|circle|polyline|nurbs|joined, added: entity type, handle, projected, closed}], skipped: [{kind, count}], added: [handles], notes}. Sizes are reported in millimetres from the file's model units (a file without units is read as millimetres)",
            ),
    ]
}

fn run_import3dm(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "import3dm";
    let (bytes, _name) = file_bytes(cmd, p)?;
    let model = rhino3dm::read(&bytes).map_err(|e| bad(cmd, e.to_string()))?;
    import_model(s, &model, p)
}

/// The bytes of `path` or of base64 `data`, and the file's name.
pub(super) fn file_bytes(cmd: &str, p: &Value) -> Result<(Vec<u8>, String)> {
    if let Some(path) = str_param(p, "path") {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let bytes = std::fs::read(path).map_err(|e| bad(cmd, format!("{path}: {e}")))?;
            return Ok((bytes, path.to_string()));
        }
        #[cfg(target_arch = "wasm32")]
        return Err(bad(cmd, format!("paths are not available on the web ({path}); pass `data`")));
    }
    let data = str_param(p, "data").ok_or_else(|| bad(cmd, "`path` or `data` (base64) is required"))?;
    let bytes = super::super::file::base64_decode(data).ok_or_else(|| bad(cmd, "invalid base64"))?;
    Ok((bytes, str_param(p, "name").unwrap_or("import.3dm").to_string()))
}

/// Whether `bytes` start like a Rhino file.
pub(crate) fn is_3dm(bytes: &[u8]) -> bool {
    bytes.starts_with(b"3D Geometry File Format ")
}

/// A drawing layer name from a Rhino one: the characters a drawing layer may not hold replaced.
fn layer_name(name: &str) -> String {
    let n: String = name.chars().map(|c| if "<>/\\\":;?*|=`,".contains(c) || c.is_control() { '_' } else { c }).take(255).collect();
    let n = n.trim().to_string();
    if n.is_empty() { "0".to_string() } else { n }
}

fn r3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

pub(super) fn import_model(s: &mut Session, model: &Model, p: &Value) -> Result<Value> {
    let query = bool_or(p, "query", false);
    let add_curves = !query && bool_or(p, "curves", true);
    let add_faces = !query && bool_or(p, "faces", false);
    let mut notes = model.notes.clone();
    let (units, mm) = match model.units {
        Some((code, mm)) => (rhino3dm::unit(code).map(|u| u.1.to_string()).unwrap_or_else(|| "custom".to_string()), mm),
        None => {
            notes.push("The file names no model unit; it was read as millimetres.".to_string());
            ("millimeters".to_string(), 1.0)
        }
    };
    // File units → drawing units.
    let k = mm / mm_per_unit(s);
    let layer_of = |index: i32| -> String {
        let l = model.layers.iter().find(|l| l.index == index).or_else(|| usize::try_from(index).ok().and_then(|i| model.layers.get(i)));
        l.map(|l| layer_name(&l.name)).unwrap_or_else(|| "0".to_string())
    };
    let mut meshes = Vec::new();
    let mut curves = Vec::new();
    let mut added = Vec::new();
    let mut new_entities: Vec<(String, EntityKind)> = Vec::new();
    let mut faces_added = 0usize;
    let mut faces_over = false;
    let mut curves_over = false;
    for o in &model.objects {
        let layer = layer_of(o.layer);
        match &o.geometry {
            Geometry::Mesh(m) => {
                let report = measure(m, mm);
                meshes.push(json!({ "name": o.name, "layer": layer, "vertices": m.vertices.len(), "faces": m.faces.len() }));
                if let Some(last) = meshes.last_mut()
                    && let (Some(obj), Value::Object(rep)) = (last.as_object_mut(), report)
                {
                    obj.extend(rep);
                }
                if add_faces {
                    for t in m.triangles() {
                        if faces_added >= MAX_FACES {
                            faces_over = true;
                            break;
                        }
                        let c = t.map(|i| m.vertices.get(i as usize).map(|v| Vec3::new(v[0] * k, v[1] * k, v[2] * k)).unwrap_or(Vec3::ZERO));
                        new_entities.push((layer.clone(), EntityKind::Face3d(Face3d { corners: [c[0], c[1], c[2], c[2]], hidden_edges: 0 })));
                        faces_added += 1;
                    }
                }
            }
            Geometry::Curve(c) => {
                let (kind, closed) = (curve_kind(c), curve_closed(c));
                let mut row = json!({ "name": o.name, "layer": layer, "kind": kind, "closed": closed });
                if add_curves {
                    if curves.len() >= MAX_CURVES {
                        curves_over = true;
                        continue;
                    }
                    match to_entity(c, k) {
                        Ok((e, projected)) => {
                            row["added"] = json!(e.type_name().to_ascii_lowercase());
                            row["projected"] = json!(projected);
                            new_entities.push((layer.clone(), e));
                        }
                        Err(why) => {
                            row["added"] = Value::Null;
                            row["why"] = json!(why);
                        }
                    }
                }
                curves.push(row);
            }
        }
    }
    if faces_over {
        notes.push(format!("Only the first {MAX_FACES} mesh triangles were added as 3DFACE objects."));
    }
    if curves_over {
        notes.push(format!("Only the first {MAX_CURVES} curves were added."));
    }
    if curves.iter().any(|c| c["projected"] == json!(true)) {
        notes.push("Curves off the XY plane were projected onto it (the drawing is 2D).".to_string());
    }
    if !model.skipped.is_empty() {
        notes.push("Surfaces, polysurfaces (breps), extrusions and SubD objects are not read yet; mesh them in Rhino (Mesh command) and export again to weigh them here.".to_string());
    }
    if !new_entities.is_empty() {
        let space = s.space();
        let base = s.current_common();
        let d = s.doc_mut()?;
        for l in &model.layers {
            let name = layer_name(&l.name);
            if d.ensure_layer(&name)
                && let Some(dl) = d.layers.iter_mut().find(|x| x.name == name)
            {
                dl.color = Color::True(Rgb(l.color[0], l.color[1], l.color[2]));
            }
        }
        let mut curve_rows = curves.iter_mut().filter(|c| c.get("added").is_some_and(|a| !a.is_null()));
        for (layer, kind) in new_entities {
            d.ensure_layer(&layer);
            let is_face = matches!(kind, EntityKind::Face3d(_));
            let mut common = base.clone();
            common.layer = layer;
            common.color = Color::ByLayer;
            let h = d.add(&space, common, kind)?;
            if !is_face && let Some(row) = curve_rows.next() {
                row["handle"] = json!(h.hex());
            }
            added.push(h);
        }
        s.set_selection(added.clone());
    }
    let layers: Vec<Value> =
        model.layers.iter().map(|l| json!({ "name": layer_name(&l.name), "color": Rgb(l.color[0], l.color[1], l.color[2]).hex() })).collect();
    let skipped: Vec<Value> = model.skipped.iter().map(|k| json!({ "kind": k.kind, "count": k.count })).collect();
    let message = format!(
        "{} meshes, {} curves read from a Rhino {} file{}",
        meshes.len(),
        curves.len(),
        model.version,
        if added.is_empty() { String::new() } else { format!("; {} objects added", added.len()) }
    );
    Ok(json!({
        "version": model.version,
        "units": units,
        "mmPerUnit": mm,
        "layers": layers,
        "meshes": meshes,
        "curves": curves,
        "skipped": skipped,
        "added": added.iter().map(|h| h.hex()).collect::<Vec<_>>(),
        "notes": notes,
        "message": message,
    }))
}

/// A mesh's measures in millimetres: triangles, whether it is closed, its volume and weight in
/// every metal when it is, and its bounds.
pub(super) fn measure(m: &Mesh, mm: f64) -> Value {
    let tris = m.triangles();
    let v = |i: u32| m.vertices.get(i as usize).map(|p| Vec3::new(p[0] * mm, p[1] * mm, p[2] * mm)).unwrap_or(Vec3::ZERO);
    let closed = is_closed(&tris);
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in &m.vertices {
        for (j, x) in p.iter().enumerate() {
            if let (Some(l), Some(h)) = (lo.get_mut(j), hi.get_mut(j)) {
                *l = l.min(x * mm);
                *h = h.max(x * mm);
            }
        }
    }
    let bounds = if m.vertices.is_empty() { Value::Null } else { json!({ "min": lo.map(r3), "max": hi.map(r3) }) };
    let mut out = json!({ "triangles": tris.len(), "closed": closed, "bounds": bounds });
    if closed {
        // The divergence theorem over the closed surface; the sign only says which way it faces.
        let six: f64 = tris.iter().map(|t| v(t[0]).dot(v(t[1]).cross(v(t[2])))).sum();
        let volume = (six / 6.0).abs();
        let grams: serde_json::Map<String, Value> =
            METALS.iter().filter_map(|n| Some(((*n).to_string(), json!(r3(volume / 1000.0 * density_of(n)?))))).collect();
        out["volumeMm3"] = json!(r3(volume));
        out["grams"] = Value::Object(grams);
        if six < 0.0 {
            out["inward"] = json!(true);
        }
    }
    out
}

/// Whether every edge is shared by exactly two triangles that run it in opposite directions.
fn is_closed(tris: &[[u32; 3]]) -> bool {
    use std::collections::HashMap;
    if tris.is_empty() {
        return false;
    }
    let mut edges: HashMap<(u32, u32), i32> = HashMap::with_capacity(tris.len() * 3);
    for t in tris {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            if a == b {
                return false;
            }
            let (key, dir) = if a < b { ((a, b), 1) } else { ((b, a), -1) };
            let e = edges.entry(key).or_insert(0);
            // Count each direction: +1 forward, +100 backward; a closed oriented edge sums to 101.
            *e += if dir > 0 { 1 } else { 100 };
        }
    }
    edges.values().all(|&n| n == 101)
}

fn curve_kind(c: &Curve) -> &'static str {
    match c {
        Curve::Line { .. } => "line",
        Curve::Arc { start, end, .. } if end - start >= TAU - 1e-9 => "circle",
        Curve::Arc { .. } => "arc",
        Curve::Polyline(_) => "polyline",
        Curve::Nurbs(_) => "nurbs",
        Curve::Joined(_) => "joined",
    }
}

fn ends(c: &Curve) -> Option<([f64; 3], [f64; 3])> {
    match c {
        Curve::Line { from, to } => Some((*from, *to)),
        Curve::Arc { plane, radius, start, end } => Some((arc_point(plane, *radius, *start), arc_point(plane, *radius, *end))),
        Curve::Polyline(p) => Some((*p.first()?, *p.last()?)),
        Curve::Nurbs(n) => Some((*n.points.first()?, *n.points.last()?)),
        Curve::Joined(s) => Some((ends(s.first()?)?.0, ends(s.last()?)?.1)),
    }
}

fn curve_closed(c: &Curve) -> bool {
    if let Curve::Arc { start, end, .. } = c {
        return end - start >= TAU - 1e-9;
    }
    // A NURBS curve's end points are its end control points only when its knots are clamped;
    // a periodic one is closed by construction.
    if let Curve::Nurbs(n) = c {
        let pts = nurbs_points(n, 64);
        return match (pts.first(), pts.last()) {
            (Some(a), Some(b)) => dist3(*a, *b) <= 1e-9 * (1.0 + size(&pts)),
            _ => false,
        };
    }
    ends(c).is_some_and(|(a, b)| dist3(a, b) <= 1e-9 * (1.0 + a.iter().map(|x| x.abs()).fold(0.0, f64::max)))
}

fn dist3(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

fn arc_point(pl: &rhino3dm::Plane, r: f64, t: f64) -> [f64; 3] {
    let (c, s) = (t.cos() * r, t.sin() * r);
    [0, 1, 2].map(|i| pl.origin[i] + c * pl.x[i] + s * pl.y[i])
}

fn size(pts: &[[f64; 3]]) -> f64 {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in pts {
        for i in 0..3 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    if pts.is_empty() { 0.0 } else { dist3(lo, hi) }
}

/// The spline of a NURBS curve in the drawing's convention (degree, full knot vector), in XY.
fn spline_of(n: &rhino3dm::Nurbs, k: f64) -> Option<GSpline> {
    let (first, last) = (*n.knots.first()?, *n.knots.last()?);
    let mut knots = Vec::with_capacity(n.knots.len() + 2);
    knots.push(first);
    knots.extend_from_slice(&n.knots);
    knots.push(last);
    let control: Vec<Vec2> = n.points.iter().map(|p| Vec2::new(p[0] * k, p[1] * k)).collect();
    let mut sp = GSpline::from_control(control, n.order as usize - 1);
    sp.degree = n.order as usize - 1;
    sp.knots = knots;
    sp.weights = if n.weights.iter().all(|w| (w - 1.0).abs() < 1e-12) { Vec::new() } else { n.weights.clone() };
    sp.is_valid().then_some(sp)
}

/// Points along a NURBS curve, in the file's units and frame (z kept).
fn nurbs_points(n: &rhino3dm::Nurbs, count: usize) -> Vec<[f64; 3]> {
    // Evaluate x/y and z as two planar splines over the same knots and weights.
    let xy = spline_of(n, 1.0);
    let zs = {
        let flat = rhino3dm::Nurbs { points: n.points.iter().map(|p| [p[2], 0.0, 0.0]).collect(), ..n.clone() };
        spline_of(&flat, 1.0)
    };
    let (Some(xy), Some(zs)) = (xy, zs) else { return Vec::new() };
    let (t0, t1) = xy.domain();
    (0..=count)
        .map(|i| {
            let t = t0 + (t1 - t0) * i as f64 / count as f64;
            let p = xy.eval(t);
            [p.x, p.y, zs.eval(t).x]
        })
        .collect()
}

/// Whether the curve lies in a plane parallel to XY.
fn planar_xy(c: &Curve) -> bool {
    let pts: Vec<[f64; 3]> = match c {
        Curve::Line { from, to } => vec![*from, *to],
        Curve::Arc { plane, radius, .. } => {
            return plane.z[0].abs() <= PLANAR && plane.z[1].abs() <= PLANAR && plane.z[2].abs() > 0.5 && radius.is_finite();
        }
        Curve::Polyline(p) => p.clone(),
        Curve::Nurbs(n) => n.points.clone(),
        Curve::Joined(s) => return s.iter().all(planar_xy) && joined_z(s),
    };
    let tol = PLANAR * (1.0 + size(&pts));
    pts.first().is_some_and(|f| pts.iter().all(|p| (p[2] - f[2]).abs() <= tol))
}

fn joined_z(s: &[Curve]) -> bool {
    let zs: Vec<f64> = s.iter().filter_map(ends).map(|(a, _)| a[2]).collect();
    zs.first().is_none_or(|z0| zs.iter().all(|z| (z - z0).abs() <= 1e-6 * (1.0 + z0.abs())))
}

/// The curve as a drawing object in drawing units (`k` drawing units per file unit), and
/// whether it had to be projected onto XY.
fn to_entity(c: &Curve, k: f64) -> std::result::Result<(EntityKind, bool), String> {
    let projected = !planar_xy(c);
    let v3 = |p: [f64; 3]| Vec3::new(p[0] * k, p[1] * k, 0.0);
    let v2 = |p: [f64; 3]| Vec2::new(p[0] * k, p[1] * k);
    let e = match c {
        Curve::Line { from, to } => EntityKind::Line(DLine { a: v3(*from), b: v3(*to) }),
        Curve::Arc { plane, radius, start, end } if !projected => {
            let x = Vec2::new(plane.x[0], plane.x[1]);
            let a0 = x.angle();
            let up = plane.z[2] > 0.0;
            let center = v3(plane.origin);
            let r = radius * k;
            if end - start >= TAU - 1e-9 {
                EntityKind::Circle(DCircle { center, radius: r })
            } else if up {
                EntityKind::Arc(DArc { center, radius: r, start: (a0 + start).rem_euclid(TAU), end: (a0 + end).rem_euclid(TAU) })
            } else {
                // Seen from above, a plane facing down runs its angles clockwise.
                EntityKind::Arc(DArc { center, radius: r, start: (a0 - end).rem_euclid(TAU), end: (a0 - start).rem_euclid(TAU) })
            }
        }
        Curve::Polyline(p) => polyline(p.iter().map(|q| v2(*q)).collect()),
        Curve::Nurbs(n) => EntityKind::Spline(spline_of(n, k).ok_or("the NURBS curve's knots are not valid")?),
        Curve::Arc { .. } | Curve::Joined(_) => {
            let mut pts = Vec::new();
            flatten(c, &mut pts, 0)?;
            pts.dedup_by(|a, b| dist3(*a, *b) <= 1e-12);
            polyline(pts.iter().map(|q| v2(*q)).collect())
        }
    };
    Ok((e, projected))
}

/// An open or closed polyline through `pts` (closed when the ends meet).
fn polyline(mut pts: Vec<Vec2>) -> EntityKind {
    let closed = pts.len() > 2 && pts.first().zip(pts.last()).is_some_and(|(a, b)| a.dist(*b) <= 1e-9 * (1.0 + a.len()));
    if closed {
        pts.pop();
    }
    EntityKind::LwPolyline(LwPolyline {
        vertices: pts.into_iter().map(|p| PolyVertex { p, ..PolyVertex::default() }).collect(),
        closed,
        const_width: 0.0,
        elevation: 0.0,
        plinegen: false,
    })
}

/// Points along a curve in the file's frame, appended to `out`.
fn flatten(c: &Curve, out: &mut Vec<[f64; 3]>, depth: usize) -> std::result::Result<(), String> {
    if depth > rhino3dm::MAX_DEPTH || out.len() > MAX_FLAT_POINTS {
        return Err("the curve has too many points".into());
    }
    match c {
        Curve::Line { from, to } => out.extend([*from, *to]),
        Curve::Arc { plane, radius, start, end } => {
            let n = (((end - start) / TAU * 128.0).ceil() as usize).clamp(4, 512);
            out.extend((0..=n).map(|i| arc_point(plane, *radius, start + (end - start) * i as f64 / n as f64)));
        }
        Curve::Polyline(p) => out.extend_from_slice(p),
        Curve::Nurbs(n) => {
            let count = (n.points.len() * 16).clamp(32, 2048);
            let pts = nurbs_points(n, count);
            if pts.is_empty() {
                return Err("the NURBS curve's knots are not valid".into());
            }
            out.extend(pts);
        }
        Curve::Joined(segs) => {
            for s in segs {
                flatten(s, out, depth + 1)?;
            }
        }
    }
    if out.len() > MAX_FLAT_POINTS { Err("the curve has too many points".into()) } else { Ok(()) }
}
