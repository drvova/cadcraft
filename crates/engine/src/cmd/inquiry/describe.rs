//! DESCRIBE: an in-depth, read-only report of a drawing or a selection — the answer to "what is
//! actually in this drawing, and what is worth knowing about it?".
//!
//! Where `drawing.inspect` gives a summary and `entities` gives raw geometry, DESCRIBE measures:
//! counts by type, extents and size, per-layer usage, drawn length per type, closed contours and
//! the area they enclose, open contours (outlines that were never closed), texts with their
//! contents, block references, raster references with their pixel sizes and placement, degenerate
//! objects, and (on request) the gaps in loose LINE/ARC chains through `loops`. It ends with a
//! plain-language narrative, so an agent can report what it built or what it found without
//! inventing the numbers.
//!
//! Nothing here changes the drawing, and every scan is bounded: `limit` caps the per-object list
//! and the text/image detail, `maxPairs` caps the optional chain analysis.

use std::collections::BTreeMap;

use cadcraft_doc::{Entity, EntityKind, Handle, Space};
use cadcraft_geom::{Bounds2, Vec2};
use serde_json::{Value, json};

use super::super::*;
use super::fmt_d;
use crate::{Result, Session};

const CMD: &str = "describe";
/// Objects listed in `objects` by default.
const DEFAULT_OBJECT_LIMIT: usize = 200;
/// Texts and images detailed by default.
const MAX_TEXT_DETAIL: usize = 20;
const MAX_IMAGE_DETAIL: usize = 50;
/// Endpoint pairs the optional chain analysis (`loops: true`) may compare.
const DEFAULT_PAIR_LIMIT: usize = 200_000;

pub const PARAMS: &str = "{handles? | handle? (default: the whole active space), space?: current (default)|model|all|<layout>, \
    window?: [[x0,y0],[x1,y1]], crossing?: bool (default true; false = entirely inside), detail?: bool (default false; \
    true lists each object), limit?: n (default 200; the per-object list), loops?: bool (default false; chain loose LINEs \
    and ARCs to find gaps and junctions), maxPairs?: n (default 200000), tolerance?: number} → \
    {schema: 1, scope, total, counts, extents, size, center, units, layers, geometry: {totalLength, lengths, closed, open}, \
    texts, blocks, images, dimensions, hatches, degenerate, gaps?, objects?, notes, message}";

pub fn run(s: &mut Session, p: &Value) -> Result<Value> {
    let scope = Scope::parse(s, p)?;
    let window = match p.get("window") {
        None | Some(Value::Null) => None,
        Some(_) => {
            let corners = points_param(p, "window").ok_or_else(|| bad(CMD, "`window` must be two corner points [[x0, y0], [x1, y1]]"))?;
            match corners.as_slice() {
                [a, b] => Some(Bounds2::new(*a, *b)),
                _ => return Err(bad(CMD, "`window` must be two corner points [[x0, y0], [x1, y1]]")),
            }
        }
    };
    let crossing = bool_or(p, "crossing", true);
    let tol = window.as_ref().map(crate::select::window_tol).unwrap_or(0.0);
    let detail = bool_or(p, "detail", false) || matches!(scope, Scope::Selection(_));
    let limit = match p.get("limit") {
        None | Some(Value::Null) => DEFAULT_OBJECT_LIMIT,
        Some(v) => match v.as_u64() {
            Some(n) => usize::try_from(n).unwrap_or(usize::MAX),
            None => return Err(bad(CMD, "`limit` must be a whole number, 0 or more")),
        },
    };

    // Optional: chain loose LINEs and ARCs (the `loops` command) to report gaps and junctions.
    let want_loops = bool_or(p, "loops", false);
    let gaps = if want_loops {
        let max_pairs = match p.get("maxPairs") {
            None | Some(Value::Null) => DEFAULT_PAIR_LIMIT,
            Some(v) => match v.as_u64() {
                Some(n) => usize::try_from(n).unwrap_or(usize::MAX),
                None => return Err(bad(CMD, "`maxPairs` must be a whole number")),
            },
        };
        match &scope {
            Scope::Selection(_) | Scope::All => json!({ "skipped": "chain analysis covers one space; describe the active space with loops: true" }),
            Scope::Space(_) if window.is_some() => json!({ "skipped": "chain analysis covers the whole space, not a window" }),
            Scope::Space(_) => {
                let params = json!({ "limit": 100, "maxPairs": max_pairs, "tolerance": p.get("tolerance").cloned().unwrap_or(Value::Null) });
                let report = super::loops::run(s, &params)?;
                let open = report.get("openChains").cloned().unwrap_or(Value::Null);
                let closed = report.get("count").and_then(Value::as_u64).unwrap_or(0);
                let junctions = report.get("junctions").and_then(|j| j.get("count")).and_then(Value::as_u64).unwrap_or(0);
                let capped = report.get("capped").and_then(Value::as_bool).unwrap_or(false);
                let largest = open.get("chains").and_then(Value::as_array).and_then(|c| {
                    c.iter().filter_map(|x| x.get("gap").and_then(Value::as_f64)).fold(None, |a: Option<f64>, g| Some(a.map_or(g, |a| a.max(g))))
                });
                json!({
                    "closedChains": closed,
                    "openChains": open.get("count").and_then(Value::as_u64).unwrap_or(0),
                    "largestGap": largest,
                    "junctions": junctions,
                    "capped": capped,
                    "tolerance": report.get("tolerance").cloned().unwrap_or(Value::Null),
                })
            }
        }
    } else {
        Value::Null
    };

    let st = s.state()?;
    let d = &st.doc;
    // Gather the objects in scope.
    let mut objects: Vec<&std::sync::Arc<Entity>> = Vec::new();
    let mut spaces: Vec<String> = Vec::new();
    match &scope {
        Scope::Selection(hs) => {
            for h in hs {
                let e = d.entity(*h).ok_or_else(|| bad(CMD, format!("no object {}", h.hex())))?;
                objects.push(e);
            }
            spaces.push("the selection".to_string());
        }
        Scope::Space(space) => {
            if let Some(store) = d.space(space) {
                objects.extend(store.iter());
            }
            spaces.push(space_label(space));
        }
        Scope::All => {
            objects.extend(d.model.iter());
            for l in &d.layouts {
                objects.extend(l.entities.iter());
            }
            spaces.push("all spaces".to_string());
        }
    }
    if let Some(w) = &window {
        objects.retain(|e| crate::select::in_window(d, e, None, w, crossing, tol));
    }

    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut layers: BTreeMap<String, (usize, String)> = BTreeMap::new();
    let mut lengths: BTreeMap<&'static str, f64> = BTreeMap::new();
    let mut total_length = 0.0f64;
    let mut closed_count = 0usize;
    let mut closed_area = 0.0f64;
    let mut open_contours = 0usize;
    let mut open_length = 0.0f64;
    let mut vertices = 0usize;
    let mut extents = Bounds2::EMPTY;
    let mut texts: Vec<Value> = Vec::new();
    let mut text_count = 0usize;
    let mut blocks: BTreeMap<String, usize> = BTreeMap::new();
    let mut images: Vec<Value> = Vec::new();
    let mut image_count = 0usize;
    let mut dimensions = 0usize;
    let mut hatches = 0usize;
    let mut degenerate: Vec<Value> = Vec::new();
    let mut per_object: Vec<Value> = Vec::new();
    let mut truncated = false;

    for e in &objects {
        let ty = e.kind.type_name();
        *counts.entry(ty).or_default() += 1;
        let (n, color) = layers.entry(e.common.layer.clone()).or_insert((0, e.common.color.name().to_string()));
        *n += 1;
        let _ = color;
        let b = cadcraft_doc::entity_bounds(d, e, 0);
        if !b.is_empty() {
            extents = extents.union(&b);
        }
        let len = entity_length(&e.kind);
        if let Some(l) = len {
            *lengths.entry(ty).or_default() += l;
            total_length += l;
        }
        let mut closed = None;
        let mut object_area = None;
        if let Some((a, per)) = closed_shape(&e.kind) {
            closed_count += 1;
            closed_area += a;
            closed = Some(true);
            object_area = Some(a);
            let _ = per;
        } else if is_open_contour(&e.kind) {
            open_contours += 1;
            if let Some(l) = len {
                open_length += l;
            }
            closed = Some(false);
        }
        if let Some(v) = poly_vertices(&e.kind) {
            vertices += v;
        }
        match &e.kind {
            EntityKind::Text(t) => {
                text_count += 1;
                if texts.len() < MAX_TEXT_DETAIL {
                    texts.push(json!({ "handle": e.handle.hex(), "type": "Text", "text": t.value.trim(), "at": [t.insert.x, t.insert.y], "height": t.height }));
                }
            }
            EntityKind::MText(t) => {
                text_count += 1;
                if texts.len() < MAX_TEXT_DETAIL {
                    texts.push(json!({ "handle": e.handle.hex(), "type": "MText", "text": cadcraft_fonts::plain_mtext(&t.contents).trim(), "at": [t.insert.x, t.insert.y], "height": t.height }));
                }
            }
            EntityKind::MLeader(m) => {
                if let Some(t) = &m.text {
                    text_count += 1;
                    if texts.len() < MAX_TEXT_DETAIL {
                        texts.push(json!({ "handle": e.handle.hex(), "type": "MLeader", "text": cadcraft_fonts::plain_mtext(&t.contents).trim(), "at": [t.insert.x, t.insert.y], "height": t.height }));
                    }
                }
            }
            EntityKind::Insert(i) => {
                *blocks.entry(i.block.clone()).or_default() += 1;
                for a in i.attribs.iter().filter(|a| !a.invisible) {
                    text_count += 1;
                    if texts.len() < MAX_TEXT_DETAIL {
                        texts.push(json!({ "handle": e.handle.hex(), "type": "Attribute", "text": a.text.value.trim(), "at": [a.text.insert.x, a.text.insert.y], "height": a.text.height, "tag": a.tag }));
                    }
                }
            }
            EntityKind::Dimension(_) => dimensions += 1,
            EntityKind::Hatch(_) => hatches += 1,
            EntityKind::Image(i) => {
                image_count += 1;
                if images.len() < MAX_IMAGE_DETAIL {
                    let pixels = cadcraft_render::raster_image::load(&i.path).map(|px| [px.width, px.height]);
                    let uw = i.u.xy().len();
                    let vw = i.v.xy().len();
                    let rotation = i.u.xy().y.atan2(i.u.xy().x).to_degrees();
                    images.push(json!({
                        "handle": e.handle.hex(), "name": i.name, "path": i.path,
                        "pixels": pixels,
                        "size": [i.size.x * uw, i.size.y * vw],
                        "at": [i.insert.x, i.insert.y], "rotation": rotation,
                        "unitsPerPixel": [uw, vw],
                        "clipped": i.clipping, "fade": i.fade,
                    }));
                }
            }
            _ => {}
        }
        // Degenerate objects: nothing to snap to, nothing to draw.
        if let Some(l) = len
            && l <= 1e-9
            && !matches!(e.kind, EntityKind::Point(_) | EntityKind::Text(_) | EntityKind::MText(_) | EntityKind::AttDef(_))
            && degenerate.len() < 20
        {
            degenerate.push(json!({ "handle": e.handle.hex(), "type": ty, "reason": "zero length" }));
        }
        if detail {
            if per_object.len() < limit {
                let mut o = json!({
                    "handle": e.handle.hex(), "type": ty, "layer": e.common.layer, "color": e.common.color.name(),
                });
                if let Some(m) = o.as_object_mut() {
                    if let Some(l) = len {
                        m.insert("length".into(), json!(l));
                    }
                    if let Some(a) = object_area {
                        m.insert("area".into(), json!(a));
                    }
                    if let Some(c) = closed {
                        m.insert("closed".into(), json!(c));
                    }
                    if let Some(v) = poly_vertices(&e.kind) {
                        m.insert("vertices".into(), json!(v));
                    }
                    if !b.is_empty() {
                        m.insert("bounds".into(), json!([[b.min.x, b.min.y], [b.max.x, b.max.y]]));
                    }
                }
                per_object.push(o);
            } else {
                truncated = true;
            }
        }
    }

    let extents_json = if extents.is_empty() { Value::Null } else { json!([[extents.min.x, extents.min.y], [extents.max.x, extents.max.y]]) };
    let size = if extents.is_empty() { None } else { Some((extents.width(), extents.height())) };
    let center = if extents.is_empty() { None } else { Some(extents.center()) };
    let insunits = d.header.i64("INSUNITS", 1);
    let unit = unit_name(insunits);

    let layer_list: Vec<Value> = layers
        .iter()
        .map(|(name, (n, color))| {
            let l = d.layer(name);
            json!({
                "name": name, "objects": n, "color": color,
                "on": l.map(|l| l.on).unwrap_or(true),
                "frozen": l.map(|l| l.frozen).unwrap_or(false),
                "locked": l.map(|l| l.locked).unwrap_or(false),
                "linetype": l.map(|l| l.linetype.clone()).unwrap_or_default(),
            })
        })
        .collect();

    let mut notes: Vec<String> = Vec::new();
    if open_contours > 0 {
        notes.push(format!(
            "{open_contours} open contour(s) totalling {} — close them (PEDIT Close / JOIN) if they should bound an area",
            fmt_d(s, open_length)
        ));
    }
    if closed_count > 0 {
        notes.push(format!("{closed_count} closed shape(s) enclosing {}", fmt_d(s, closed_area)));
    } else if !objects.is_empty() {
        notes.push("no closed shape: nothing bounds an area yet (HATCH and AREA will find no region)".to_string());
    }
    if !degenerate.is_empty() {
        notes.push(format!("{} degenerate object(s) with no measurable length", degenerate.len()));
    }
    if image_count > 0 {
        notes.push(format!("{image_count} raster reference(s); IMAGETRACE turns one into geometry"));
    }
    if !blocks.is_empty() {
        let n: usize = blocks.values().sum();
        notes.push(format!("{n} block reference(s) over {} definition(s)", blocks.len()));
    }
    if let Some(g) = gaps.as_object()
        && let Some(open) = g.get("openChains").and_then(Value::as_u64)
        && open > 0
    {
        let largest = g.get("largestGap").and_then(Value::as_f64).unwrap_or(0.0);
        notes.push(format!("{open} loose chain(s) do not meet; the largest gap is {}", fmt_d(s, largest)));
    }
    if truncated {
        notes.push(format!("the object list is cut at {limit}; raise `limit` or narrow the scope"));
    }

    let message = narrative(
        &spaces,
        objects.len(),
        &counts,
        extents_json.as_array().map(|_| (extents.min, extents.max)),
        unit,
        total_length,
        closed_count,
        closed_area,
        open_contours,
        &layer_list,
        text_count,
        &texts,
        image_count,
    );

    let mut out = json!({
        "schema": 1,
        "scope": spaces.join(", "),
        "total": objects.len(),
        "counts": counts,
        "extents": extents_json,
        "size": size.map(|(w, h)| json!([w, h])),
        "center": center.map(|c| json!([c.x, c.y])),
        "units": { "insunits": insunits, "name": unit, "lunits": d.header.i64("LUNITS", 2), "luprec": d.header.i64("LUPREC", 4) },
        "layers": layer_list,
        "geometry": {
            "totalLength": total_length,
            "lengths": lengths,
            "closed": { "count": closed_count, "area": closed_area },
            "open": { "contours": open_contours, "length": open_length },
            "vertices": vertices,
        },
        "texts": { "count": text_count, "returned": texts.len(), "items": texts },
        "blocks": blocks.iter().map(|(k, v)| (k.clone(), json!(v))).collect::<serde_json::Map<String, Value>>(),
        "images": { "count": image_count, "returned": images.len(), "items": images },
        "dimensions": dimensions,
        "hatches": hatches,
        "degenerate": degenerate,
        "gaps": gaps,
        "notes": notes,
        "message": message,
    });
    if detail && let Some(o) = out.as_object_mut() {
        o.insert("objects".into(), Value::Array(per_object));
        o.insert("objectsTruncated".into(), json!(truncated));
    }
    Ok(out)
}

/// What DESCRIBE reads.
enum Scope {
    Selection(Vec<Handle>),
    Space(Space),
    All,
}

impl Scope {
    fn parse(s: &Session, p: &Value) -> Result<Scope> {
        if p.get("handles").is_some_and(|v| !v.is_null()) || p.get("handle").is_some_and(|v| !v.is_null()) {
            return Ok(Scope::Selection(targets(s, p)?));
        }
        let given = match p.get("space") {
            None | Some(Value::Null) => None,
            Some(Value::String(t)) => Some(t.trim().to_string()),
            Some(v) => return Err(bad(CMD, format!("`space` must be current, model, all or a layout name, got {v}"))),
        };
        match given.as_deref().map(str::to_ascii_lowercase).as_deref() {
            None | Some("current") => Ok(Scope::Space(s.space())),
            Some("all") => Ok(Scope::All),
            Some("model") => Ok(Scope::Space(Space::Model)),
            Some(_) => {
                let name = given.unwrap_or_default();
                let d = s.doc()?;
                let l =
                    d.layouts.iter().find(|l| l.name.eq_ignore_ascii_case(&name)).ok_or_else(|| bad(CMD, format!("no layout named \"{name}\"")))?;
                Ok(Scope::Space(Space::Paper(l.name.clone())))
            }
        }
    }
}

fn space_label(space: &Space) -> String {
    match space {
        Space::Model => "model space".to_string(),
        Space::Paper(n) => format!("layout {n}"),
    }
}

/// The drawn length of one object, where it has one.
fn entity_length(kind: &EntityKind) -> Option<f64> {
    match kind {
        EntityKind::Line(l) => Some(l.a.xy().dist(l.b.xy())),
        EntityKind::Arc(a) => Some(a.radius * cadcraft_geom::ccw_sweep(a.start, a.end)),
        EntityKind::Circle(c) => Some(c.radius * cadcraft_geom::TAU),
        EntityKind::LwPolyline(p) => Some(cadcraft_geom::Polyline { vertices: p.vertices.clone(), closed: p.closed }.len()),
        EntityKind::Polyline3d(p) => {
            let mut t = 0.0;
            for w in p.points.windows(2) {
                t += w.first().zip(w.get(1)).map(|(a, b)| (*a - *b).len()).unwrap_or(0.0);
            }
            if p.closed && p.points.len() > 2 {
                t += p.points.first().zip(p.points.last()).map(|(a, b)| (*a - *b).len()).unwrap_or(0.0);
            }
            Some(t)
        }
        EntityKind::Spline(s) => {
            let pts = s.tessellate(0.05);
            Some(pts.windows(2).filter_map(|w| w.first().zip(w.get(1)).map(|(a, b)| a.dist(*b))).sum())
        }
        EntityKind::Ellipse(e) => {
            let el = cadcraft_geom::Ellipse { center: e.center.xy(), major: e.major.xy(), ratio: e.ratio, start: e.start, end: e.end };
            Some(el.arc_length_from(e.start, e.end))
        }
        _ => None,
    }
}

/// A closed shape's (area, perimeter), when the object bounds one.
fn closed_shape(kind: &EntityKind) -> Option<(f64, f64)> {
    match kind {
        EntityKind::Circle(c) => Some((c.radius * c.radius * cadcraft_geom::PI, c.radius * cadcraft_geom::TAU)),
        EntityKind::LwPolyline(p) if p.closed => {
            let pl = cadcraft_geom::Polyline { vertices: p.vertices.clone(), closed: true };
            Some((pl.area().abs(), pl.len()))
        }
        EntityKind::Ellipse(e) => {
            let el = cadcraft_geom::Ellipse { center: e.center.xy(), major: e.major.xy(), ratio: e.ratio, start: e.start, end: e.end };
            if !el.is_full() {
                return None;
            }
            let a = e.major.xy().len();
            Some((cadcraft_geom::PI * a * a * e.ratio, el.arc_length_from(0.0, cadcraft_geom::TAU)))
        }
        EntityKind::Region(r) => Some((r.area(), r.perimeter())),
        EntityKind::Hatch(h) => {
            let mut area = 0.0;
            let mut per = 0.0;
            for l in &h.loops {
                let pl = cadcraft_geom::Polyline { vertices: l.vertices.clone(), closed: true };
                area += pl.area().abs();
                per += pl.len();
            }
            Some((area, per))
        }
        EntityKind::Solid(s) | EntityKind::Trace(s) => {
            // The corners are stored in DXF order 1, 2, 4, 3; the quad runs 1, 2, 3, 4.
            let c = &s.corners;
            let pts = [c.first()?.xy(), c.get(1)?.xy(), c.get(3)?.xy(), c.get(2)?.xy()];
            let per: f64 = (0..pts.len()).filter_map(|i| Some(pts.get(i)?.dist(*pts.get((i + 1) % pts.len())?))).sum();
            Some((cadcraft_geom::shoelace(&pts).abs(), per))
        }
        _ => None,
    }
}

/// Whether the object is an open contour (a curve with two ends that could be closed).
fn is_open_contour(kind: &EntityKind) -> bool {
    match kind {
        EntityKind::LwPolyline(p) => !p.closed,
        EntityKind::Polyline3d(p) => !p.closed,
        EntityKind::Spline(s) => !s.closed,
        EntityKind::Arc(_) => true,
        _ => false,
    }
}

/// The vertex count of a polyline or spline, where it has one.
fn poly_vertices(kind: &EntityKind) -> Option<usize> {
    match kind {
        EntityKind::LwPolyline(p) => Some(p.vertices.len()),
        EntityKind::Polyline3d(p) => Some(p.points.len()),
        EntityKind::Spline(s) => Some(s.control.len()),
        _ => None,
    }
}

/// AutoCAD's INSUNITS name.
fn unit_name(insunits: i64) -> &'static str {
    match insunits {
        0 => "unitless",
        1 => "inches",
        2 => "feet",
        3 => "miles",
        4 => "millimeters",
        5 => "centimeters",
        6 => "meters",
        7 => "kilometers",
        8 => "microinches",
        9 => "mils",
        10 => "yards",
        11 => "angstroms",
        12 => "nanometers",
        13 => "microns",
        14 => "decimeters",
        15 => "decameters",
        16 => "hectometers",
        17 => "gigameters",
        18 => "astronomical units",
        19 => "light years",
        20 => "parsecs",
        _ => "unknown units",
    }
}

/// The plain-language report: what is here, how big it is, how it measures, and what stands out.
#[allow(clippy::too_many_arguments)]
fn narrative(
    spaces: &[String],
    total: usize,
    counts: &BTreeMap<&'static str, usize>,
    extents: Option<(Vec2, Vec2)>,
    unit: &str,
    total_length: f64,
    closed_count: usize,
    closed_area: f64,
    open_contours: usize,
    layers: &[Value],
    text_count: usize,
    texts: &[Value],
    image_count: usize,
) -> String {
    let mut out = String::new();
    let scope = spaces.join(", ");
    if total == 0 {
        return format!("{scope} is empty: nothing to describe.");
    }
    out.push_str(&format!("{scope} holds {total} object(s)"));
    let mut top: Vec<(&&str, &usize)> = counts.iter().collect();
    top.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    let kinds: Vec<String> = top.iter().take(6).map(|(k, n)| format!("{n} {}", plural(k, **n))).collect();
    if !kinds.is_empty() {
        out.push_str(&format!(": {}", kinds.join(", ")));
        if top.len() > 6 {
            out.push_str(&format!(", and {} more type(s)", top.len() - 6));
        }
    }
    out.push('.');
    if let Some((min, max)) = extents {
        out.push_str(&format!(
            " Extents {} × {} {unit}, from ({}, {}) to ({}, {}).",
            fmt_num(max.x - min.x),
            fmt_num(max.y - min.y),
            fmt_num(min.x),
            fmt_num(min.y),
            fmt_num(max.x),
            fmt_num(max.y),
        ));
    }
    if total_length > 0.0 {
        out.push_str(&format!(" Drawn length totals {}.", fmt_num(total_length)));
    }
    if closed_count > 0 {
        out.push_str(&format!(" {closed_count} closed shape(s) enclose {}.", fmt_num(closed_area)));
    }
    if open_contours > 0 {
        out.push_str(&format!(" {open_contours} open contour(s) are not closed.",));
    }
    let used: Vec<String> =
        layers.iter().filter_map(|l| Some(format!("{} ({})", l.get("name")?.as_str()?, l.get("objects")?.as_u64()?))).take(6).collect();
    if !used.is_empty() {
        out.push_str(&format!(" Layers in use: {}.", used.join(", ")));
    }
    if text_count > 0 {
        let sample: Vec<String> =
            texts.iter().filter_map(|t| t.get("text").and_then(Value::as_str)).take(4).map(|t| format!("\"{}\"", truncate(t, 40))).collect();
        out.push_str(&format!(" {text_count} text(s)"));
        if !sample.is_empty() {
            out.push_str(&format!(", including {}", sample.join(", ")));
        }
        out.push('.');
    }
    if image_count > 0 {
        out.push_str(&format!(" {image_count} raster reference(s)."));
    }
    out
}

/// A type name in a count list: "12 lines", "1 line".
fn plural(name: &str, n: usize) -> String {
    let lower = name.to_ascii_lowercase();
    if n == 1 {
        lower
    } else if lower.ends_with('x') || lower.ends_with('s') || lower.ends_with("ch") {
        format!("{lower}es")
    } else {
        format!("{lower}s")
    }
}

/// A number for the narrative: up to two decimals, trailing zeros trimmed.
fn fmt_num(v: f64) -> String {
    if !v.is_finite() {
        return "—".to_string();
    }
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() { "0".to_string() } else { s.to_string() }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}
