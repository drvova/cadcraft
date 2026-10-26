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

use cadcraft_doc::{Drawing, Entity, EntityKind, Handle, Space};
use cadcraft_geom::{Bounds2, Vec3};
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
/// Degenerate objects named in the report; the count in `notes` is complete either way.
const MAX_DEGENERATE_LISTED: usize = 20;
/// Endpoint pairs the optional chain analysis (`loops: true`) may compare.
const DEFAULT_PAIR_LIMIT: usize = 200_000;
/// A length at or below this is nothing: no geometry to snap to, nothing to draw.
const ZERO_LENGTH: f64 = 1e-9;
/// Tessellation tolerance for measuring a spline's drawn length (fine enough that the
/// measurement is within a hair of the curve).
const LENGTH_TOL: f64 = 0.05;
/// Names the narrative lists before it says "and N more".
const NARRATIVE_KINDS: usize = 6;
const NARRATIVE_LAYERS: usize = 6;
const NARRATIVE_TEXTS: usize = 4;
/// Characters of a text sample shown in the narrative.
const NARRATIVE_SAMPLE_CHARS: usize = 40;

pub const PARAMS: &str = "{handles? | handle? (default: the whole active space), space?: current (default)|model|all|<layout>, \
    window?: [[x0,y0],[x1,y1]], crossing?: bool (default true; false = entirely inside), detail?: bool (default false; \
    true lists each object), limit?: n (default 200; the per-object list), loops?: bool (default false; chain loose LINEs \
    and ARCs to find gaps and junctions), maxPairs?: n (default 200000), tolerance?: number} → \
    {schema: 1, scope, total, counts, extents, size, center, units, layers, geometry: {totalLength, lengths, closed, open}, \
    texts, blocks, images, dimensions, hatches, degenerate, gaps?, objects?, notes, message}";

/// What one object contributed, for the per-object detail list.
struct ObjectFacts {
    bounds: Bounds2,
    length: Option<f64>,
    area: Option<f64>,
    closed: Option<bool>,
    vertices: Option<usize>,
}

/// The facts a scan accumulates; `describe` renders them as JSON and as prose.
#[derive(Default)]
struct Facts {
    counts: BTreeMap<&'static str, usize>,
    /// Layer name → (objects, the first object's colour name).
    layers: BTreeMap<String, (usize, String)>,
    lengths: BTreeMap<&'static str, f64>,
    total_length: f64,
    closed: usize,
    closed_area: f64,
    open_contours: usize,
    open_length: f64,
    vertices: usize,
    extents: Bounds2,
    texts: Vec<Value>,
    text_count: usize,
    blocks: BTreeMap<String, usize>,
    images: Vec<Value>,
    image_count: usize,
    dimensions: usize,
    hatches: usize,
    degenerate: Vec<Value>,
}

impl Facts {
    /// Fold one object into the report, returning what the per-object detail needs.
    fn add(&mut self, d: &Drawing, e: &Entity) -> ObjectFacts {
        let ty = e.kind.type_name();
        *self.counts.entry(ty).or_default() += 1;
        // `or_insert_with`: the colour is only looked up for a layer not seen before.
        let layer = self.layers.entry(e.common.layer.clone()).or_insert_with(|| (0, e.common.color.name().to_string()));
        layer.0 += 1;
        let bounds = cadcraft_doc::entity_bounds(d, e, 0);
        if !bounds.is_empty() {
            self.extents = self.extents.union(&bounds);
        }
        let length = entity_length(&e.kind);
        if let Some(l) = length {
            *self.lengths.entry(ty).or_default() += l;
            self.total_length += l;
        }
        let area = closed_shape(&e.kind).map(|(a, _per)| a);
        let closed = match area {
            Some(a) => {
                self.closed += 1;
                self.closed_area += a;
                Some(true)
            }
            None if is_open_contour(&e.kind) => {
                self.open_contours += 1;
                self.open_length += length.unwrap_or(0.0);
                Some(false)
            }
            None => None,
        };
        let vertices = poly_vertices(&e.kind);
        if let Some(v) = vertices {
            self.vertices += v;
        }
        match &e.kind {
            EntityKind::Text(t) => self.text(e, "Text", t.value.trim(), t.insert, t.height),
            EntityKind::MText(t) => self.text(e, "MText", cadcraft_fonts::plain_mtext(&t.contents).trim(), t.insert, t.height),
            EntityKind::MLeader(m) => {
                if let Some(t) = &m.text {
                    self.text(e, "MLeader", cadcraft_fonts::plain_mtext(&t.contents).trim(), t.insert, t.height);
                }
            }
            EntityKind::Insert(i) => {
                *self.blocks.entry(i.block.clone()).or_default() += 1;
                for a in i.attribs.iter().filter(|a| !a.invisible) {
                    self.text(e, "Attribute", a.text.value.trim(), a.text.insert, a.text.height);
                }
            }
            EntityKind::Dimension(_) => self.dimensions += 1,
            EntityKind::Hatch(_) => self.hatches += 1,
            EntityKind::Image(i) => {
                self.image_count += 1;
                if self.images.len() < MAX_IMAGE_DETAIL {
                    self.images.push(image_json(e, i));
                }
            }
            _ => {}
        }
        // Degenerate objects: nothing to snap to, nothing to draw.
        if let Some(l) = length
            && l <= ZERO_LENGTH
            && !matches!(e.kind, EntityKind::Point(_) | EntityKind::Text(_) | EntityKind::MText(_) | EntityKind::AttDef(_))
            && self.degenerate.len() < MAX_DEGENERATE_LISTED
        {
            self.degenerate.push(json!({ "handle": e.handle.hex(), "type": ty, "reason": "zero length" }));
        }
        ObjectFacts { bounds, length, area, closed, vertices }
    }

    /// Record one readable text (a block attribute carries its tag in `at`-independent detail).
    fn text(&mut self, e: &Entity, ty: &str, value: &str, at: Vec3, height: f64) {
        self.text_count += 1;
        if self.texts.len() < MAX_TEXT_DETAIL {
            self.texts.push(json!({ "handle": e.handle.hex(), "type": ty, "text": value, "at": [at.x, at.y], "height": height }));
        }
    }
}

/// One object's row in the detailed list.
fn object_json(e: &Entity, f: &ObjectFacts) -> Value {
    let mut o = json!({
        "handle": e.handle.hex(), "type": e.kind.type_name(), "layer": e.common.layer, "color": e.common.color.name(),
    });
    if let Some(m) = o.as_object_mut() {
        if let Some(l) = f.length {
            m.insert("length".into(), json!(l));
        }
        if let Some(a) = f.area {
            m.insert("area".into(), json!(a));
        }
        if let Some(c) = f.closed {
            m.insert("closed".into(), json!(c));
        }
        if let Some(v) = f.vertices {
            m.insert("vertices".into(), json!(v));
        }
        if !f.bounds.is_empty() {
            m.insert("bounds".into(), json!([[f.bounds.min.x, f.bounds.min.y], [f.bounds.max.x, f.bounds.max.y]]));
        }
    }
    o
}

/// One raster reference's detail: its pixels (when the file reads), placement and scale.
fn image_json(e: &Entity, i: &cadcraft_doc::Image) -> Value {
    let pixels = cadcraft_render::raster_image::load(&i.path).map(|px| [px.width, px.height]);
    let uw = i.u.xy().len();
    let vw = i.v.xy().len();
    json!({
        "handle": e.handle.hex(), "name": i.name, "path": i.path,
        "pixels": pixels,
        "size": [i.size.x * uw, i.size.y * vw],
        "at": [i.insert.x, i.insert.y],
        "rotation": i.u.xy().y.atan2(i.u.xy().x).to_degrees(),
        "unitsPerPixel": [uw, vw],
        "clipped": i.clipping, "fade": i.fade,
    })
}

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

    let mut facts = Facts::default();
    let mut per_object: Vec<Value> = Vec::new();
    let mut truncated = false;
    for e in &objects {
        let f = facts.add(d, e);
        if detail {
            if per_object.len() < limit {
                per_object.push(object_json(e, &f));
            } else {
                truncated = true;
            }
        }
    }

    let extents_json = if facts.extents.is_empty() {
        Value::Null
    } else {
        json!([[facts.extents.min.x, facts.extents.min.y], [facts.extents.max.x, facts.extents.max.y]])
    };
    let size = if facts.extents.is_empty() { None } else { Some((facts.extents.width(), facts.extents.height())) };
    let center = if facts.extents.is_empty() { None } else { Some(facts.extents.center()) };
    let insunits = d.header.i64("INSUNITS", 1);
    let unit = unit_name(insunits);

    let layer_list: Vec<Value> = facts
        .layers
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
    if facts.open_contours > 0 {
        notes.push(format!(
            "{} open contour(s) totalling {} — close them (PEDIT Close / JOIN) if they should bound an area",
            facts.open_contours,
            fmt_d(s, facts.open_length)
        ));
    }
    if facts.closed > 0 {
        notes.push(format!("{} closed shape(s) enclosing {}", facts.closed, fmt_d(s, facts.closed_area)));
    } else if !objects.is_empty() {
        notes.push("no closed shape: nothing bounds an area yet (HATCH and AREA will find no region)".to_string());
    }
    if !facts.degenerate.is_empty() {
        notes.push(format!("{} degenerate object(s) with no measurable length", facts.degenerate.len()));
    }
    if facts.image_count > 0 {
        notes.push(format!("{} raster reference(s); IMAGETRACE turns one into geometry", facts.image_count));
    }
    if !facts.blocks.is_empty() {
        let n: usize = facts.blocks.values().sum();
        notes.push(format!("{n} block reference(s) over {} definition(s)", facts.blocks.len()));
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

    let message = narrative(&facts, &spaces, unit);

    let mut out = json!({
        "schema": 1,
        "scope": spaces.join(", "),
        "total": objects.len(),
        "counts": facts.counts,
        "extents": extents_json,
        "size": size.map(|(w, h)| json!([w, h])),
        "center": center.map(|c| json!([c.x, c.y])),
        "units": { "insunits": insunits, "name": unit, "lunits": d.header.i64("LUNITS", 2), "luprec": d.header.i64("LUPREC", 4) },
        "layers": layer_list,
        "geometry": {
            "totalLength": facts.total_length,
            "lengths": facts.lengths,
            "closed": { "count": facts.closed, "area": facts.closed_area },
            "open": { "contours": facts.open_contours, "length": facts.open_length },
            "vertices": facts.vertices,
        },
        "texts": { "count": facts.text_count, "returned": facts.texts.len(), "items": facts.texts },
        "blocks": facts.blocks.iter().map(|(k, v)| (k.clone(), json!(v))).collect::<serde_json::Map<String, Value>>(),
        "images": { "count": facts.image_count, "returned": facts.images.len(), "items": facts.images },
        "dimensions": facts.dimensions,
        "hatches": facts.hatches,
        "degenerate": facts.degenerate,
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
            let pts = s.tessellate(LENGTH_TOL);
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

/// The plain-language report: what is here, how big it is, how it measures, what stands out.
fn narrative(facts: &Facts, spaces: &[String], unit: &str) -> String {
    use std::fmt::Write as _;

    let mut out = String::new();
    let scope = spaces.join(", ");
    let total: usize = facts.counts.values().sum();
    if total == 0 {
        return format!("{scope} is empty: nothing to describe.");
    }
    let _ = write!(out, "{scope} holds {total} object(s)");
    let mut top: Vec<(&&str, &usize)> = facts.counts.iter().collect();
    top.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    let kinds: Vec<String> = top.iter().take(NARRATIVE_KINDS).map(|(k, n)| format!("{n} {}", plural(k, **n))).collect();
    if !kinds.is_empty() {
        let _ = write!(out, ": {}", kinds.join(", "));
        if top.len() > NARRATIVE_KINDS {
            let _ = write!(out, ", and {} more type(s)", top.len() - NARRATIVE_KINDS);
        }
    }
    out.push('.');
    if !facts.extents.is_empty() {
        let (min, max) = (facts.extents.min, facts.extents.max);
        let _ = write!(
            out,
            " Extents {} × {} {unit}, from ({}, {}) to ({}, {}).",
            fmt_num(max.x - min.x),
            fmt_num(max.y - min.y),
            fmt_num(min.x),
            fmt_num(min.y),
            fmt_num(max.x),
            fmt_num(max.y),
        );
    }
    if facts.total_length > 0.0 {
        let _ = write!(out, " Drawn length totals {}.", fmt_num(facts.total_length));
    }
    if facts.closed > 0 {
        let _ = write!(out, " {} closed shape(s) enclose {}.", facts.closed, fmt_num(facts.closed_area));
    }
    if facts.open_contours > 0 {
        let _ = write!(out, " {} open contour(s) are not closed.", facts.open_contours);
    }
    let used: Vec<String> = facts.layers.iter().take(NARRATIVE_LAYERS).map(|(name, (n, _))| format!("{name} ({n})")).collect();
    if !used.is_empty() {
        let _ = write!(out, " Layers in use: {}.", used.join(", "));
    }
    if facts.text_count > 0 {
        let sample: Vec<String> = facts
            .texts
            .iter()
            .filter_map(|t| t.get("text").and_then(Value::as_str))
            .take(NARRATIVE_TEXTS)
            .map(|t| format!("\"{}\"", truncate(t, NARRATIVE_SAMPLE_CHARS)))
            .collect();
        let _ = write!(out, " {} text(s)", facts.text_count);
        if !sample.is_empty() {
            let _ = write!(out, ", including {}", sample.join(", "));
        }
        out.push('.');
    }
    if facts.image_count > 0 {
        let _ = write!(out, " {} raster reference(s).", facts.image_count);
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
