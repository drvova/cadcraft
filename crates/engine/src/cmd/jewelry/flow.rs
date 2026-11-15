//! A drawing flowed onto the band: `PIECE {flow: {...}}` and the `FLOW` command.
//!
//! A Rhino jeweller flows flat decoration along a band's surface. Here the 2D objects of the
//! drawing — lines, arcs, circles, ellipses, polylines, splines, text and hatches — are read from
//! the selection, from given handles or from a layer, flattened to centrelines in millimetres and
//! kept in the piece by value (so the motif survives its source objects being moved or erased).
//! They are laid on the developed band, `u` along it and `v` across, the motif's own +X along the
//! band and +Y across it, and wrapped onto the band's inside or outside exactly as an engraving's
//! strokes are ([`super::engrave`]): cut as round-bottomed grooves (`style: cut`, `depth`) or
//! raised as round-topped wires (`style: raised`, `depth` is then the height), in the cast solid
//! through the implicit CSG, in the 3D view and on the sheet's developed band.
//!
//! - **Scale**: `scale` (drawing millimetres to band millimetres), or by default the scale that
//!   fits the motif's height across the band with [`super::engrave::EDGE`] to each edge.
//! - **Fit**: `rigid` keeps the motif's proportions (refused when it would run round into itself);
//!   `stretch` stretches it along the band so it runs the whole way round, less a stroke's width.
//! - **Place**: `at` inside or outside, `side` bottom or top (as an engraving's), `turn` degrees
//!   more round the band, `across` millimetres off the middle of the width.
//! - **Hatches** are filled: their boundary loops are cut, and the area inside them is cleared by
//!   parallel strokes a stroke's width apart (an area recessed, or raised, to the depth).
//!
//! The same rules as an engraving: no flow on a cable's strands, on a surface a pierced pattern
//! takes, outside on an eternity band (all stones) or on a tapered shank, nor at the top of a
//! piece that carries stones there; and one surface carries one of an engraving or a flowed
//! motif. A hallmark inside goes past the motif as it goes past an inside engraving.

use std::sync::Arc;

use cadcraft_doc::{Entity, EntityKind, Handle};
use cadcraft_geom::{Arc as GArc, Circle as GCircle, Ellipse as GEllipse, Polyline, TAU, Vec2};
use serde_json::{Map, Value, json};

use super::engrave::{EDGE, Feature, MAX_DEPTH_SHARE, MIN_FEATURE, MIN_RAISED, Mark, Place, Side, Style};
use super::piece_params::{PieceKind, PieceParams};
use super::*;

/// The keys `flow` takes (the first four only to read the drawing; they are not kept).
const KEYS: [&str; 15] =
    ["handles", "handle", "layer", "selection", "strokes", "source", "at", "style", "side", "turn", "fit", "scale", "depth", "stroke", "across"];
/// The most strokes a motif keeps, the most points one stroke keeps and the most points in all.
pub(super) const MAX_STROKES: usize = 2_000;
pub(super) const MAX_POINTS_EACH: usize = 2_000;
pub(super) const MAX_POINTS: usize = 20_000;
/// The most objects one flow reads.
pub(super) const MAX_OBJECTS: usize = 2_000;
/// The most fill strokes one hatch is cleared with.
const MAX_FILL: usize = 400;

/// How the motif is fitted along the band.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Fit {
    Rigid,
    Stretch,
}

impl Fit {
    pub(super) fn name(self) -> &'static str {
        match self {
            Fit::Rigid => "rigid",
            Fit::Stretch => "stretch",
        }
    }
}

/// A motif flowed onto the band.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct FlowSpec {
    /// The motif's centrelines in millimetres, as drawn.
    pub strokes: Arc<Vec<Vec<Vec2>>>,
    /// Where it came from, in words (`3 objects`, `layer Motif`).
    pub source: String,
    pub place: Place,
    pub style: Style,
    pub side: Option<Side>,
    /// Degrees more round the band from `side` (clockwise seen from the front).
    pub turn: f64,
    pub fit: Fit,
    /// Drawing mm to band mm, or `None` to fit the band's width.
    pub scale: Option<f64>,
    pub depth: Option<f64>,
    pub stroke: Option<f64>,
    /// Millimetres off the middle of the width.
    pub across: f64,
}

fn word<T: Copy>(cmd: &str, o: &Map<String, Value>, key: &str, choices: &[(&str, T)]) -> Result<Option<T>> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => {
            let s = v.as_str().map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
            choices
                .iter()
                .find(|(n, _)| *n == s)
                .map(|(_, t)| Some(*t))
                .ok_or_else(|| bad(cmd, format!("`flow.{key}` must be {}", choices.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(" or "))))
        }
    }
}

fn number(cmd: &str, o: &Map<String, Value>, key: &str, min: f64, max: f64) -> Result<Option<f64>> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= min && *x <= max)
            .map(Some)
            .ok_or_else(|| bad(cmd, format!("`flow.{key}` must be a number from {min} to {max}"))),
    }
}

/// Read stored strokes: `[[[x, y], …], …]`, capped and finite.
fn read_strokes(cmd: &str, v: Option<&Value>) -> Result<Vec<Vec<Vec2>>> {
    let arr = v.and_then(Value::as_array).ok_or_else(|| {
        bad(cmd, "`flow` needs objects of the drawing: give `handles`, a `layer` or `selection: true` (or a stored motif's `strokes`)")
    })?;
    if arr.len() > MAX_STROKES {
        return Err(bad(cmd, format!("a flowed motif has at most {MAX_STROKES} strokes; this one has {}", arr.len())));
    }
    let mut out = Vec::with_capacity(arr.len());
    let mut total = 0usize;
    for s in arr {
        let pts = s.as_array().ok_or_else(|| bad(cmd, "`flow.strokes` must be a list of strokes, each a list of [x, y]"))?;
        if pts.len() > MAX_POINTS_EACH {
            return Err(bad(cmd, format!("a flowed stroke has at most {MAX_POINTS_EACH} points")));
        }
        total += pts.len();
        if total > MAX_POINTS {
            return Err(bad(cmd, format!("a flowed motif has at most {MAX_POINTS} points in all")));
        }
        let stroke: Vec<Vec2> = pts
            .iter()
            .map(|q| super::super::point_value(q).filter(|q| q.x.abs() <= 1e6 && q.y.abs() <= 1e6))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| bad(cmd, "every point of `flow.strokes` must be [x, y]: two finite numbers within a kilometre"))?;
        out.push(stroke);
    }
    if out.iter().all(Vec::is_empty) {
        return Err(bad(cmd, "the flowed motif has no strokes"));
    }
    Ok(out)
}

impl FlowSpec {
    /// `flow` from a piece's JSON: absent, `null` or `false` for none, or an object with the
    /// motif's `strokes` (put there from the drawing by [`resolve`]).
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Option<FlowSpec>> {
        let o = match p.get("flow") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::Object(o)) => o,
            Some(_) => {
                return Err(bad(
                    cmd,
                    "`flow` must be false or {handles | layer | selection: true, at?, style?, side?, turn?, fit?, scale?, depth?, stroke?, across?}",
                ));
            }
        };
        if let Some(k) = o.keys().find(|k| !KEYS.contains(&k.as_str())) {
            return Err(bad(cmd, format!("`flow` takes {}, not `{}`", KEYS.join(", "), k.chars().take(24).collect::<String>())));
        }
        let strokes = read_strokes(cmd, o.get("strokes"))?;
        let source = o.get("source").and_then(Value::as_str).map(|s| s.chars().take(64).collect()).unwrap_or_else(|| "the drawing".to_string());
        let place = word(cmd, o, "at", &[("inside", Place::Inside), ("outside", Place::Outside)])?.unwrap_or(Place::Outside);
        let style = word(cmd, o, "style", &[("cut", Style::Cut), ("engrave", Style::Cut), ("raised", Style::Raised), ("emboss", Style::Raised)])?
            .unwrap_or(Style::Cut);
        if style == Style::Raised && place == Place::Inside {
            return Err(bad(cmd, "a raised motif goes outside: inside, it would stand against the finger"));
        }
        let side = word(cmd, o, "side", &[("bottom", Side::Bottom), ("top", Side::Top)])?;
        let fit = word(cmd, o, "fit", &[("rigid", Fit::Rigid), ("stretch", Fit::Stretch)])?.unwrap_or(Fit::Rigid);
        Ok(Some(FlowSpec {
            strokes: Arc::new(strokes),
            source,
            place,
            style,
            side,
            turn: number(cmd, o, "turn", -360.0, 360.0)?.unwrap_or(0.0),
            fit,
            scale: number(cmd, o, "scale", 0.001, 1000.0)?,
            depth: number(cmd, o, "depth", 0.05, 2.0)?,
            stroke: number(cmd, o, "stroke", 0.05, 2.0)?,
            across: number(cmd, o, "across", -15.0, 15.0)?.unwrap_or(0.0),
        }))
    }

    /// The spec as JSON: `parse` reads it back to the same spec.
    pub(super) fn json(&self) -> Value {
        let round = |x: f64| (x * 1e6).round() / 1e6;
        let strokes: Vec<Value> = self.strokes.iter().map(|s| Value::Array(s.iter().map(|q| json!([round(q.x), round(q.y)])).collect())).collect();
        json!({
            "strokes": strokes,
            "source": self.source,
            "at": self.place.name(),
            "style": self.style.name(),
            "side": self.side.map(|s| match s { Side::Bottom => "bottom", Side::Top => "top" }),
            "turn": self.turn,
            "fit": self.fit.name(),
            "scale": self.scale,
            "depth": self.depth,
            "stroke": self.stroke,
            "across": self.across,
        })
    }

    /// The stroke's width on this band: given, or 0.3 mm cut and 0.35 mm raised.
    pub(super) fn stroke_on(&self) -> f64 {
        self.stroke.unwrap_or(match self.style {
            Style::Cut => 0.3,
            Style::Raised => 0.35,
        })
    }
    /// Cut: a fifth of the wall, 0.1–0.3 mm; raised: 0.4 mm off the band.
    pub(super) fn depth_on(&self, p: &PieceParams) -> f64 {
        self.depth.unwrap_or(match self.style {
            Style::Cut => (p.wall / 5.0).clamp(0.1, 0.3),
            Style::Raised => 0.4,
        })
    }
    /// Inside: the bottom; outside: the top of a plain band, else the bottom.
    pub(super) fn side_on(&self, p: &PieceParams) -> Side {
        self.side.unwrap_or(match self.place {
            Place::Outside if p.kind == PieceKind::Band && p.pave.is_none() => Side::Top,
            _ => Side::Bottom,
        })
    }
}

/// Merge a `flow` change over the stored one, key by key: a new `depth` keeps the motif; new
/// objects (`handles`, `layer`, `selection`) replace its strokes ([`resolve`] reads them).
pub(super) fn merge(stored: Option<&Value>, given: &Value) -> Value {
    match (stored.and_then(Value::as_object), given) {
        (Some(old), Value::Object(new)) => {
            let mut out = old.clone();
            for (k, v) in new {
                out.insert(k.clone(), v.clone());
            }
            Value::Object(out)
        }
        _ => given.clone(),
    }
}

// ---------------------------------------------------------------------------------------------
// Reading the drawing
// ---------------------------------------------------------------------------------------------

/// The strokes of one object, in drawing units: a list of centrelines.
fn object_strokes(e: &Entity) -> Vec<Vec<Vec2>> {
    let tol_of = |size: f64| (size * 2e-3).max(1e-6);
    match &e.kind {
        EntityKind::Line(l) => vec![vec![l.a.xy(), l.b.xy()]],
        EntityKind::Arc(a) => {
            let mut out = Vec::new();
            GArc::new(a.center.xy(), a.radius, a.start, a.end).tessellate(tol_of(a.radius), &mut out);
            vec![out]
        }
        EntityKind::Circle(c) => {
            let mut out = Vec::new();
            GCircle { center: c.center.xy(), radius: c.radius }.tessellate(tol_of(c.radius), &mut out);
            if let Some(f) = out.first().copied() {
                out.push(f);
            }
            vec![out]
        }
        EntityKind::Ellipse(el) => {
            let g = GEllipse { center: el.center.xy(), major: el.major.xy(), ratio: el.ratio, start: el.start, end: el.end };
            let mut out = Vec::new();
            g.tessellate(tol_of(el.major.xy().len()), &mut out);
            if g.is_full()
                && let Some(f) = out.first().copied()
            {
                out.push(f);
            }
            vec![out]
        }
        EntityKind::LwPolyline(lw) => {
            if lw.vertices.len() > MAX_POINTS_EACH {
                return Vec::new();
            }
            let size = extent_of(&lw.vertices.iter().map(|v| v.p).collect::<Vec<_>>());
            let mut out = Polyline { vertices: lw.vertices.clone(), closed: lw.closed }.tessellate(tol_of(size));
            if lw.closed
                && let Some(f) = out.first().copied()
            {
                out.push(f);
            }
            vec![out]
        }
        EntityKind::Spline(sp) => {
            if sp.control.len() > MAX_POINTS_EACH {
                return Vec::new();
            }
            vec![sp.tessellate(tol_of(extent_of(&sp.control)))]
        }
        EntityKind::Text(t) => text_strokes(&t.value, t.height, t.width_factor, t.oblique, t.insert.xy(), t.rotation),
        EntityKind::MText(t) => {
            let plain: String =
                t.contents.replace("\\P", " ").chars().filter(|c| !matches!(c, '{' | '}')).take(super::engrave::MAX_TEXT * 4).collect();
            // MText hangs from its top-left by default: the first line's baseline is a height down.
            let down = Vec2::new(t.rotation.sin(), -t.rotation.cos()) * t.height;
            text_strokes(&plain, t.height, 1.0, 0.0, t.insert.xy() + down, t.rotation)
        }
        EntityKind::Hatch(h) => hatch_strokes(h),
        _ => Vec::new(),
    }
}

fn extent_of(pts: &[Vec2]) -> f64 {
    let (mut lo, mut hi) = (Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY));
    for q in pts {
        lo = lo.min(*q);
        hi = hi.max(*q);
    }
    let d = (hi - lo).len();
    if d.is_finite() { d } else { 0.0 }
}

/// Text set in CADCraft's stroke font, its baseline's start at `at`, turned by `rotation`.
fn text_strokes(text: &str, height: f64, wf: f64, oblique: f64, at: Vec2, rotation: f64) -> Vec<Vec<Vec2>> {
    let text: String = text.chars().take(super::engrave::MAX_TEXT * 4).collect();
    let sh = cadcraft_fonts::shape_stroke(&text.replace('%', "%%%"), height, wf, oblique);
    let (c, s) = (rotation.cos(), rotation.sin());
    let mut all = sh.strokes;
    all.extend(sh.glyphs.into_iter().flatten());
    all.into_iter().map(|st| st.into_iter().map(|q| at + Vec2::new(q.x * c - q.y * s, q.x * s + q.y * c)).collect()).collect()
}

/// A hatch: its boundary loops, and its area cleared by strokes across it ([`fill`]).
fn hatch_strokes(h: &cadcraft_doc::Hatch) -> Vec<Vec<Vec2>> {
    let mut loops: Vec<Vec<Vec2>> = Vec::new();
    for l in h.loops.iter().take(64) {
        if l.vertices.len() > MAX_POINTS_EACH {
            continue;
        }
        let size = extent_of(&l.vertices.iter().map(|v| v.p).collect::<Vec<_>>());
        let mut pts = Polyline { vertices: l.vertices.clone(), closed: true }.tessellate((size * 2e-3).max(1e-6));
        if let Some(f) = pts.first().copied() {
            pts.push(f);
        }
        if pts.len() >= 4 {
            loops.push(pts);
        }
    }
    let mut out = loops.clone();
    // The fill is laid in band millimetres later ([`fill`]); here the loops are marked by a
    // leading empty stroke so `motif` knows which strokes bound an area.
    if !loops.is_empty() {
        out.insert(0, Vec::new());
        out.push(Vec::new());
    }
    out
}

/// Horizontal strokes `step` apart clearing the area inside `loops` (even-odd), at most
/// [`MAX_FILL`].
pub(super) fn fill(loops: &[Vec<Vec2>], step: f64) -> Vec<Vec<Vec2>> {
    let mut out = Vec::new();
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for q in loops.iter().flatten() {
        lo = lo.min(q.y);
        hi = hi.max(q.y);
    }
    if !(lo.is_finite() && hi.is_finite() && step.is_finite() && step > 1e-6) || hi <= lo {
        return out;
    }
    let lines = (((hi - lo) / step).floor() as usize).min(MAX_FILL);
    for k in 0..lines {
        let y = lo + step * (k as f64 + 0.5);
        let mut xs: Vec<f64> = Vec::new();
        for l in loops {
            for w in l.windows(2) {
                let (Some(a), Some(b)) = (w.first(), w.get(1)) else { continue };
                if (a.y <= y) != (b.y <= y) {
                    let t = (y - a.y) / (b.y - a.y);
                    xs.push(a.x + (b.x - a.x) * t);
                }
            }
        }
        xs.retain(|x| x.is_finite());
        xs.sort_by(f64::total_cmp);
        for pair in xs.chunks_exact(2) {
            if let [a, b] = pair
                && b - a > 1e-6
            {
                out.push(vec![Vec2::new(*a, y), Vec2::new(*b, y)]);
            }
        }
    }
    out
}

/// Put the drawing's objects into `given.flow` as strokes in millimetres: from `flow.layer`, from
/// `flow.handles` / `flow.handle`, or from the selection with `flow.selection: true`. Objects of
/// the piece itself (`exclude`) are never read. Without any of the three the stored motif stays.
pub(super) fn resolve(s: &Session, cmd: &str, given: &mut Map<String, Value>, exclude: &[Handle]) -> Result<()> {
    let Some(Value::Object(f)) = given.get("flow") else { return Ok(()) };
    let mut f = f.clone();
    let layer = f.remove("layer");
    let picked = f.contains_key("handles") || f.contains_key("handle") || f.get("selection").and_then(Value::as_bool) == Some(true);
    if layer.is_none() && !picked {
        f.remove("selection");
        given.insert("flow".into(), Value::Object(f));
        return Ok(());
    }
    let d = s.doc()?;
    let (handles, source) = match layer.as_ref().filter(|v| !v.is_null()) {
        Some(v) => {
            let name = v.as_str().ok_or_else(|| bad(cmd, "`flow.layer` must be a layer's name"))?;
            let hs: Vec<Handle> =
                d.model.iter().filter(|e| e.common.layer.eq_ignore_ascii_case(name)).map(|e| e.handle).take(MAX_OBJECTS + 1).collect();
            (hs, format!("layer {}", name.chars().take(40).collect::<String>()))
        }
        None => {
            let probe = Value::Object(f.clone());
            let hs = super::super::targets(s, &probe)?;
            let n = hs.len();
            (hs, format!("{n} object{}", if n == 1 { "" } else { "s" }))
        }
    };
    if handles.len() > MAX_OBJECTS {
        return Err(bad(cmd, format!("a flow reads at most {MAX_OBJECTS} objects")));
    }
    let mm = mm_per_unit(s);
    let mut strokes: Vec<Vec<Vec2>> = Vec::new();
    for h in handles.iter().filter(|h| !exclude.contains(h)) {
        let Some(e) = d.entity(*h) else { return Err(bad(cmd, format!("there is no object {} in the drawing", h.hex()))) };
        for st in object_strokes(e) {
            strokes.push(st.into_iter().filter(|q| q.is_finite()).map(|q| q * mm).take(MAX_POINTS_EACH).collect());
        }
        if strokes.len() > MAX_STROKES + 2 {
            return Err(bad(cmd, format!("a flowed motif has at most {MAX_STROKES} strokes")));
        }
    }
    if strokes.iter().all(Vec::is_empty) {
        return Err(bad(cmd, "none of those objects can be flowed: give lines, arcs, circles, ellipses, polylines, splines, text or hatches"));
    }
    let total: usize = strokes.iter().map(Vec::len).sum();
    if total > MAX_POINTS {
        return Err(bad(cmd, format!("the motif has {total} points; a flow keeps at most {MAX_POINTS} (simplify the curves)")));
    }
    for k in ["handles", "handle", "selection"] {
        f.remove(k);
    }
    let round = |x: f64| (x * 1e6).round() / 1e6;
    f.insert(
        "strokes".into(),
        Value::Array(strokes.into_iter().map(|s| Value::Array(s.into_iter().map(|q| json!([round(q.x), round(q.y)])).collect())).collect()),
    );
    f.insert("source".into(), json!(source));
    given.insert("flow".into(), Value::Object(f));
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// On the band
// ---------------------------------------------------------------------------------------------

/// The motif's strokes split into plain strokes and hatch areas: an empty stroke opens a hatch's
/// loops and the next empty stroke closes them.
fn split(strokes: &[Vec<Vec2>]) -> (Vec<Vec<Vec2>>, Vec<Vec<Vec<Vec2>>>) {
    let (mut plain, mut areas) = (Vec::new(), Vec::new());
    let mut open: Option<Vec<Vec<Vec2>>> = None;
    for s in strokes {
        if s.is_empty() {
            match open.take() {
                Some(loops) => areas.push(loops),
                None => open = Some(Vec::new()),
            }
            continue;
        }
        match open.as_mut() {
            Some(loops) => loops.push(s.clone()),
            None => plain.push(s.clone()),
        }
    }
    if let Some(loops) = open {
        plain.extend(loops);
    }
    (plain, areas)
}

/// The motif as a mark on the band, refusing one that cannot go on (`Err`, a sentence).
pub(super) fn mark(p: &PieceParams, f: &FlowSpec) -> std::result::Result<Mark, String> {
    if p.shape.twist.is_some() {
        return Err("a cable band's twisted strands leave no surface to flow a motif onto".into());
    }
    let inside = f.place == Place::Inside;
    if let Some(why) = super::pattern::engraving_conflict(p, inside) {
        return Err(why.replace("engraving", "flowed motif"));
    }
    if p.engrave.as_ref().is_some_and(|e| e.place == f.place) {
        return Err(format!(
            "the engraving is already on the band's {}: flow the motif onto the other surface or take the engraving off",
            f.place.name()
        ));
    }
    let side = f.side_on(p);
    if f.place == Place::Outside {
        match p.kind {
            PieceKind::Eternity => return Err("an eternity band's outside is all stones: flow the motif inside".into()),
            PieceKind::Dome | PieceKind::Signet => {
                return Err("a motif on the outside of a tapered shank is not available yet: flow it inside".into());
            }
            _ => {}
        }
        if side == Side::Top && p.kind != PieceKind::Band {
            return Err("the top of this piece carries its stones: flow the motif at the bottom (`side: bottom`)".into());
        }
        if side == Side::Top && p.pave.is_some() {
            return Err("the pavé is on the band's outside at the top: flow the motif at the bottom (`side: bottom`) or inside".into());
        }
    }
    let stroke = f.stroke_on();
    let (plain, areas) = split(&f.strokes);
    let all: Vec<Vec2> = plain.iter().chain(areas.iter().flatten()).flatten().copied().collect();
    let (mut lo, mut hi) = (Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY));
    for q in &all {
        lo = lo.min(*q);
        hi = hi.max(*q);
    }
    if !(lo.is_finite() && hi.is_finite()) {
        return Err("the flowed motif has no points".into());
    }
    let (w, h) = (hi.x - lo.x, hi.y - lo.y);
    if w.max(h) < 1e-6 {
        return Err("the flowed motif has no size".into());
    }
    let r_ref = match f.place {
        Place::Inside => p.inner() / 2.0,
        Place::Outside => p.crown(),
    };
    let round = TAU * r_ref;
    let room = p.width - 2.0 * EDGE - stroke;
    let sv = f.scale.unwrap_or(if h > 1e-6 { room.max(0.1) / h } else { 1.0 });
    let su = match f.fit {
        Fit::Rigid => sv,
        Fit::Stretch if w > 1e-6 => (round - 2.0 * stroke).max(0.1) / w,
        Fit::Stretch => sv,
    };
    if !(su.is_finite() && sv.is_finite() && su > 0.0 && sv > 0.0) {
        return Err("the flowed motif cannot be scaled onto this band".into());
    }
    let centre = Vec2::new((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0);
    let to_band = |q: Vec2| Vec2::new((q.x - centre.x) * su, (q.y - centre.y) * sv + f.across);
    let mut strokes: Vec<Vec<Vec2>> = plain.iter().map(|s| s.iter().map(|q| to_band(*q)).collect()).collect();
    for loops in &areas {
        let band: Vec<Vec<Vec2>> = loops.iter().map(|l| l.iter().map(|q| to_band(*q)).collect()).collect();
        strokes.extend(fill(&band, stroke * 0.9));
        strokes.extend(band);
    }
    let length = w * su + stroke;
    let height = h * sv + stroke;
    if length > round + 1e-9 {
        return Err(format!(
            "the motif runs {} mm along the band but the band's {} is {} mm round: lower `flow.scale` or use `fit: stretch`",
            fmt_mm(length),
            f.place.name(),
            fmt_mm(round)
        ));
    }
    let features = vec![Feature { strokes, r: stroke / 2.0, depth: f.depth_on(p), flat: false, outline: false }];
    Ok(Mark { place: f.place, raised: f.style == Style::Raised, centre: side_angle(side) - f.turn.to_radians(), r_ref, length, height, features })
}

fn side_angle(s: Side) -> f64 {
    match s {
        Side::Bottom => -std::f64::consts::FRAC_PI_2,
        Side::Top => std::f64::consts::FRAC_PI_2,
    }
}

/// The flowed motif's checks: `flow-fit` (inside the band's width with [`EDGE`] to each edge),
/// `flow-depth` (a cut at most a third of the wall) and `flow-stroke` (a casting keeps it).
pub(super) fn checks(p: &PieceParams, f: &FlowSpec, m: &Mark) -> Vec<(&'static str, bool, String)> {
    let mut v = Vec::new();
    let top = m.height / 2.0 + f.across.abs();
    let room = p.width / 2.0 - EDGE;
    v.push((
        "flow-fit",
        top <= room + 1e-9,
        if top <= room + 1e-9 {
            format!(
                "The motif from {} is {} × {} mm on the band's {}, {} mm from each edge at the least",
                f.source,
                fmt_mm(m.length),
                fmt_mm(m.height),
                f.place.name(),
                fmt_mm(p.width / 2.0 - top)
            )
        } else {
            format!(
                "The motif is {} mm across{} but the band is {} mm wide: keep it {EDGE} mm from each edge (lower `flow.scale`, or widen the band)",
                fmt_mm(m.height),
                if f.across.abs() > 1e-9 { format!(" and {} mm off the middle", fmt_mm(f.across.abs())) } else { String::new() },
                fmt_mm(p.width)
            )
        },
    ));
    let d = f.depth_on(p);
    match f.style {
        Style::Cut => {
            let most = MAX_DEPTH_SHARE * p.wall;
            v.push((
                "flow-depth",
                d <= most + 1e-9,
                if d <= most + 1e-9 {
                    format!("The motif is cut {} mm deep, within a third of the {} mm wall", fmt_mm(d), fmt_mm(p.wall))
                } else {
                    format!(
                        "The motif is cut {} mm deep, more than a third of the {} mm wall: cut it shallower or thicken the wall",
                        fmt_mm(d),
                        fmt_mm(p.wall)
                    )
                },
            ));
        }
        Style::Raised => v.push(("flow-depth", true, format!("The motif stands {} mm off the band, adding metal", fmt_mm(d)))),
    }
    let s = f.stroke_on();
    let least = if f.style == Style::Cut { MIN_FEATURE } else { MIN_RAISED };
    v.push((
        "flow-stroke",
        s + 1e-9 >= least,
        if s + 1e-9 >= least {
            format!("The motif's {} mm stroke is at or over the {least} mm a casting keeps", fmt_mm(s))
        } else {
            format!("The motif's {} mm stroke is finer than the {least} mm a casting keeps: make `flow.stroke` wider", fmt_mm(s))
        },
    ));
    v
}

/// The `FLOW` command: the selection (or `handles`, or a `layer`) flowed onto the piece's band.
pub(super) fn run_flow(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "flow";
    let mut o = match p {
        Value::Object(o) => o.clone(),
        Value::Null => Map::new(),
        _ => return Err(bad(CMD, "the parameters must be an object")),
    };
    if o.get("remove").and_then(Value::as_bool) == Some(true) {
        return super::piece::run_piece(s, &json!({ "flow": false }));
    }
    if !o.contains_key("layer") && !o.contains_key("handles") && !o.contains_key("handle") && !o.contains_key("strokes") {
        o.insert("selection".into(), json!(true));
    }
    super::piece::run_piece(s, &json!({ "flow": Value::Object(o) }))
}

/// `FLOW`'s command spec.
pub(super) fn spec() -> CommandSpec {
    CommandSpec::new("flow", "Flow onto Band", run_flow)
        .menu(&["Draw", "Flow onto Band"])
        .params("Flow 2D objects of the drawing onto the piece's band: {handles?: [handle] | handle? | layer?: name (default: the selection), at?: inside|outside (default outside), style?: cut|raised (default cut; raised only outside), side?: bottom|top (default: outside the top of a plain band, else the bottom), turn?: degrees −360–360 more round the band, fit?: rigid|stretch (default rigid; stretch runs the motif the whole way round), scale?: 0.001–1000 drawing mm to band mm (default: the motif's height fits the band's width, 0.3 mm to each edge), depth?: mm 0.05–2 (cut: a fifth of the wall 0.1–0.3; raised: its height, 0.4), stroke?: mm 0.05–2 (the groove's or wire's width; 0.3 cut, 0.35 raised), across?: mm −15–15 off the middle of the width} or {remove: true}. Lines, arcs, circles, ellipses, polylines, splines, text (CADCraft's stroke font) and hatches (outlined and cleared) are read, kept in the piece by value as `flow.strokes`, and cut into (or raised on) the cast solid through the implicit CSG, shown in the 3D view and drawn on the sheet's developed band; checks flow-fit, flow-depth and flow-stroke. The same as PIECE {flow: {...}}; refused without a piece, on a cable, on a surface a pierced pattern or an engraving already takes, outside an eternity band or a tapered shank, or at the top of a piece with stones there; nothing changes when it is refused.")
}
