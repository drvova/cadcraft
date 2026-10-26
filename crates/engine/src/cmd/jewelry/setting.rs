//! Settings: the metal that holds a stone, built on that stone's own girdle.
//!
//! A prong setting is a set of prongs at the stone's tips and shoulders — a marquise's two tips and
//! its two shoulders, a trillion's three corners, a round's six evenly spaced claws — placed where
//! the stone actually needs holding, which is why the sites come from the outline's own geometry
//! (its sharp corners first, then farthest-point sampling along the girdle) instead of a fixed
//! count of dots on a circle. A bezel is the girdle offset outward by the wall. A halo is melee
//! laid around the girdle at the trade's gap. A channel is two rails, one either side of the
//! stones.
//!
//! `setting` reads its target two ways: an insert of a `GEM-…` block (a stone placed by `GEM` or
//! `PAVE`, in which case the metal is built in the stone's own block space and inserted with the
//! same placement, so it follows the stone if the stone moves), or any closed outline in the
//! drawing (a ring, a hand-drawn shape) for a bezel or channel in place.

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::{Vec2, Vec3};
use serde_json::{Value, json};

use super::super::*;
use super::gem;
use super::*;
use crate::{Accept, Input, Interactive, Prompt, Step};

/// How the stone is held.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Style {
    Prong,
    Bezel,
    Halo,
    Channel,
}

impl Style {
    fn parse(cmd: &str, p: &Value) -> Result<Style> {
        let Some(name) = str_param(p, "style") else { return Ok(Style::Prong) };
        match name.trim().to_ascii_lowercase().as_str() {
            "prong" | "claw" => Ok(Style::Prong),
            "bezel" | "collet" | "rubover" | "rub-over" => Ok(Style::Bezel),
            "halo" => Ok(Style::Halo),
            "channel" => Ok(Style::Channel),
            _ => Err(bad(cmd, "`style` must be prong, bezel, halo or channel")),
        }
    }
}

/// A setting target: the stone's girdle (in millimetres, centred), where it sits in the drawing,
/// and the block-space scale that maps millimetres to drawing units.
pub(super) struct Target {
    /// The girdle's outline, sampled, in millimetres centred on the stone.
    pub outline: Vec<Vec2>,
    /// The drawing-units position of the stone's centre.
    pub at: Vec2,
    /// The stone's rotation in the drawing (radians).
    pub rotation: f64,
    /// Drawing units per millimetre at the stone.
    pub scale: f64,
    /// The stone's cut name, when the target is a `GEM-…` insert.
    pub cut: Option<String>,
}

impl Target {
    /// A millimetre point of the stone's space, in the drawing's units.
    pub(super) fn to_drawing(&self, p: Vec2) -> Vec2 {
        self.at + p.rotate(self.rotation) * self.scale
    }
    /// A millimetre length in the drawing's units.
    pub(super) fn len(&self, mm: f64) -> f64 {
        mm * self.scale
    }
}

/// Read the setting's target: a `GEM-…` insert, or a closed outline in the drawing.
pub(super) fn target_of(s: &Session, cmd: &str, p: &Value) -> Result<Target> {
    let hs = targets(s, p)?;
    let h = *hs.first().ok_or_else(|| bad(cmd, "select a stone (an insert of a GEM block) or a closed outline"))?;
    if hs.len() > 1 {
        return Err(bad(cmd, "one stone or outline at a time"));
    }
    let d = s.doc()?;
    let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object {}", h.hex())))?;
    let k = mm_per_unit(s);
    if let EntityKind::Insert(ins) = &e.kind
        && let Some(blk) = d.block(&ins.block)
        && parse_gem_block(&ins.block).is_some()
    {
        // A stone: its girdle is the block's first entity, in millimetres.
        let outline = blk
            .entities
            .iter()
            .find_map(|be| entity_loop(be, 1.0).map(|(pts, _)| pts))
            .ok_or_else(|| bad(cmd, format!("the block {} has no outline", ins.block)))?;
        let scale = ins.scale.x.abs().max(1e-12) * k;
        return Ok(Target { outline, at: ins.insert.xy(), rotation: ins.rotation, scale, cut: parse_gem_block(&ins.block).map(|g| g.cut) });
    }
    // A plain outline in the drawing: it is already where the setting goes.
    let (pts, closed) = entity_loop(e, k).ok_or_else(|| bad(cmd, format!("{} is not a stone or a closed outline", h.hex())))?;
    if !closed {
        return Err(bad(cmd, format!("{} is not closed; a setting needs a closed girdle or outline", h.hex())));
    }
    Ok(Target { outline: pts, at: Vec2::ZERO, rotation: 0.0, scale: 1.0 / k, cut: None })
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("setting", "Setting", run_setting)
            .menu(&["Draw", "Setting"])
            .alias(&["head"])
            .params("{handle?: a GEM-… insert (a stone) or a closed outline; handles?: [one], style?: prong|bezel|halo|channel (default prong), prongs?: count (default from the cut), diameter?: prong mm (default 0.8), offset?: mm outward from the girdle (default 0), wall?: bezel mm (default 0.8), gap?: halo/channel mm (default 0.15), stoneWidth?: halo melee mm (default 1.0), cut?: halo melee cut, layer?, metal?: alloy name (recorded in the report)} → {handles, style, sites?, prongs?, diameter?, wall?, stones?, carat?, rail?, metal, message}")
            .interactive(|_| Ok(Box::new(SettingM::default()))),
    ]
}

fn run_setting(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "setting";
    let style = Style::parse(cmd, p)?;
    let target = target_of(s, cmd, p)?;
    let layer = str_param(p, "layer").map(str::to_string);
    if let Some(name) = &layer {
        check_layer(s, cmd, name)?;
    }
    let metal = sizes::metal_name(p);
    match style {
        Style::Prong => {
            let diameter = mm_default(cmd, p, "diameter", 0.8)?;
            let offset = mm_zero_or(cmd, p, "offset", 0.0)?;
            let sites = prong_sites(&target, p.get("prongs").and_then(Value::as_u64).map(|n| n as usize))?;
            let mut handles = Vec::new();
            for site in &sites {
                let at = target.to_drawing(*site + site.normalized() * offset);
                let h = s.add_entity(EntityKind::Circle(cadcraft_doc::Circle {
                    center: Vec3::new(at.x, at.y, 0.0),
                    radius: target.len(diameter / 2.0),
                }))?;
                on_layer(s, h, layer.as_deref())?;
                handles.push(h.hex());
            }
            Ok(json!({
                "handles": handles,
                "style": "prong",
                "sites": sites.iter().map(|p| [size_json(p.x), size_json(p.y)]).collect::<Vec<_>>(),
                "prongs": sites.len(),
                "diameter": size_json(diameter),
                "metal": metal,
                "message": format!("Prong setting: {} prongs of {} mm on the girdle", sites.len(), size_json(diameter)),
            }))
        }
        Style::Bezel => {
            let wall = mm_default(cmd, p, "wall", 0.8)?;
            let offset = mm_zero_or(cmd, p, "offset", 0.0)?;
            let ring = offset_loop(&target.outline, wall + offset)?;
            let poly = loop_entity(&ring, &target);
            let h = s.add_entity(poly)?;
            on_layer(s, h, layer.as_deref())?;
            // The seat line: the girdle itself, so the bench sees where the stone sits.
            let seat = loop_entity(&target.outline, &target);
            let hs = s.add_entity(seat)?;
            on_layer(s, hs, layer.as_deref())?;
            Ok(json!({
                "handles": [h.hex(), hs.hex()],
                "style": "bezel",
                "wall": size_json(wall),
                "message": format!("Bezel setting: a {} mm wall around a {} outline, with the seat line", size_json(wall), target.cut.clone().unwrap_or_else(|| "drawn".into())),
            }))
        }
        Style::Halo => {
            let gap = mm_zero_or(cmd, p, "gap", DEFAULT_CLEARANCE)?;
            let width = mm_default(cmd, p, "stoneWidth", 1.0)?;
            let clearance = mm_zero_or(cmd, p, "clearance", DEFAULT_CLEARANCE)?;
            let stone = gem::stone_params(cmd, &json!({"cut": str_param(p, "cut").unwrap_or("round"), "width": width}))?;
            // The melee runs around the girdle, offset so its bodies clear the stone.
            let ring = offset_loop(&target.outline, gap + width / 2.0)?;
            let path = super::pave::Path { pts: ring, closed: true };
            let handles = super::pave::lay_along(s, &path, &stone, width + clearance, layer.as_deref())?;
            let carat = gem::carat(stone.cut, stone.length, stone.width, stone.depth, stone.sg) * handles.len() as f64;
            Ok(json!({
                "handles": handles.iter().map(|h| h.hex()).collect::<Vec<_>>(),
                "style": "halo",
                "stones": handles.len(),
                "stoneWidth": size_json(width),
                "gap": size_json(gap),
                "carat": (carat * 1000.0).round() / 1000.0,
                "message": format!(
                    "Halo: {} melee of {} mm around the stone, {:.3} ct total",
                    handles.len(), size_json(width), carat
                ),
            }))
        }
        Style::Channel => {
            let gap = mm_zero_or(cmd, p, "gap", DEFAULT_CLEARANCE)?;
            let width = mm_default(cmd, p, "stoneWidth", 1.5)?;
            let rail = gap + width / 2.0;
            let outer = offset_loop(&target.outline, rail + 0.4)?;
            let inner = offset_loop(&target.outline, rail - 0.4)?;
            let h1 = s.add_entity(loop_entity(&outer, &target))?;
            let h2 = s.add_entity(loop_entity(&inner, &target))?;
            on_layer(s, h1, layer.as_deref())?;
            on_layer(s, h2, layer.as_deref())?;
            Ok(json!({
                "handles": [h1.hex(), h2.hex()],
                "style": "channel",
                "rail": size_json(rail),
                "message": format!("Channel: two rails at {} mm from the outline, for {} mm stones", size_json(rail), size_json(width)),
            }))
        }
    }
}

/// A closed polyline entity for a millimetre-space loop, placed at the target.
fn loop_entity(loop_mm: &[Vec2], target: &Target) -> EntityKind {
    let vertices = loop_mm.iter().map(|p| cadcraft_geom::PolyVertex::new(target.to_drawing(*p))).collect();
    EntityKind::LwPolyline(cadcraft_doc::LwPolyline { vertices, closed: true, const_width: 0.0, elevation: 0.0, plinegen: false })
}

/// A loop offset outward by `d` millimetres (positive is outward for a CCW loop; the sign is
/// taken from the loop's own area so a clockwise outline offsets the same way).
pub(super) fn offset_loop(loop_mm: &[Vec2], d: f64) -> Result<Vec<Vec2>> {
    let area = cadcraft_geom::shoelace(loop_mm);
    let sign = if area >= 0.0 { -1.0 } else { 1.0 };
    let poly = cadcraft_geom::Polyline::from_points(loop_mm, true);
    let offset =
        super::super::modify::offset_polyline(&poly, sign * d).ok_or_else(|| bad("setting", "the outline is too small to offset; check its size"))?;
    let out: Vec<Vec2> = cadcraft_geom::Polyline { vertices: offset, closed: true }.tessellate(0.01);
    if out.len() < 3 {
        return Err(bad("setting", "the outline is too small to offset"));
    }
    Ok(out)
}

/// Where a stone's prongs go: its sharp corners first (the tips of a marquise, the corners of an
/// emerald), then — when the cut has fewer corners than prongs — the points furthest from those
/// along the girdle. A girdle with no corners at all (a round, an oval) is divided evenly by arc
/// length, so a round's six claws come out 60° apart.
pub(super) fn prong_sites(target: &Target, wanted: Option<usize>) -> Result<Vec<Vec2>> {
    let pts = &target.outline;
    let n = pts.len();
    if n < 3 {
        return Err(bad("setting", "the outline has too few points"));
    }
    let count = wanted.unwrap_or_else(|| default_prongs(target.cut.as_deref())).clamp(2, 12);
    let centre = cadcraft_geom::polygon_centroid(pts).unwrap_or(Vec2::ZERO);
    // The point furthest from the girdle's centroid: the end of an oval, the tip of a pear.
    let seed = pts.iter().max_by(|a, b| a.dist(centre).total_cmp(&b.dist(centre))).copied().unwrap_or(Vec2::ZERO);
    // Sharp corners: the vertices where the direction turns by more than 40°.
    let mut corners: Vec<Vec2> = Vec::new();
    for i in 0..n {
        let prev = pts[(i + n - 1) % n];
        let cur = pts[i];
        let next = pts[(i + 1) % n];
        let a = (cur - prev).normalized();
        let b = (next - cur).normalized();
        let turn = (a.x * b.y - a.y * b.x).atan2(a.dot(b)).abs().to_degrees();
        if turn > 40.0 {
            corners.push(cur);
        }
    }
    let mut sites = if corners.is_empty() {
        even_by_arc_length(pts, count, seed)
    } else if corners.len() >= count {
        // More corners than prongs (an emerald's eight): keep the count that spreads best.
        spread(corners.clone(), count, seed)
    } else {
        // The corners, then the points furthest from what is already placed.
        let mut sites = corners;
        while sites.len() < count {
            let mut best = seed;
            let mut best_d = -1.0f64;
            for p in pts {
                let d = sites.iter().map(|q| q.dist(*p)).fold(f64::INFINITY, f64::min);
                if d > best_d {
                    best_d = d;
                    best = *p;
                }
            }
            if best_d <= 1e-9 {
                break;
            }
            sites.push(best);
        }
        sites
    };
    // Place them in order around the girdle, so the report reads as a ring of prongs.
    sites.sort_by(|a, b| {
        let aa = (a.y - centre.y).atan2(a.x - centre.x);
        let ab = (b.y - centre.y).atan2(b.x - centre.x);
        aa.total_cmp(&ab)
    });
    sites.truncate(count);
    Ok(sites)
}

/// `count` points spread evenly along a closed loop, starting at the point nearest `seed`.
fn even_by_arc_length(pts: &[Vec2], count: usize, seed: Vec2) -> Vec<Vec2> {
    let n = pts.len();
    let mut total = 0.0;
    let mut lengths: Vec<f64> = Vec::with_capacity(n);
    for i in 0..n {
        let d = pts[i].dist(pts[(i + 1) % n]);
        lengths.push(d);
        total += d;
    }
    if total <= 1e-9 {
        return vec![seed; count];
    }
    // Start at the vertex nearest the seed.
    let start = pts.iter().enumerate().min_by(|(_, a), (_, b)| a.dist(seed).total_cmp(&b.dist(seed))).map(|(i, _)| i).unwrap_or(0);
    let mut out = Vec::with_capacity(count);
    for k in 0..count {
        let want = total * k as f64 / count as f64;
        let mut walked = 0.0;
        let mut i = start;
        for _ in 0..n {
            let step = lengths[i];
            if walked + step >= want {
                let t = if step > 1e-12 { (want - walked) / step } else { 0.0 };
                let a = pts[i];
                let b = pts[(i + 1) % n];
                out.push(a + (b - a) * t);
                break;
            }
            walked += step;
            i = (i + 1) % n;
        }
    }
    out
}

/// `count` of `candidates`, chosen to be as far apart as possible, starting at the one nearest
/// `seed`.
fn spread(candidates: Vec<Vec2>, count: usize, seed: Vec2) -> Vec<Vec2> {
    let mut left = candidates;
    if left.len() <= count {
        return left;
    }
    let first = left.iter().enumerate().min_by(|(_, a), (_, b)| a.dist(seed).total_cmp(&b.dist(seed))).map(|(i, _)| i).unwrap_or(0);
    let mut out = vec![left.swap_remove(first)];
    while out.len() < count && !left.is_empty() {
        let i = left
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                let da = out.iter().map(|q| q.dist(**a)).fold(f64::INFINITY, f64::min);
                let db = out.iter().map(|q| q.dist(**b)).fold(f64::INFINITY, f64::min);
                da.total_cmp(&db)
            })
            .map(|(i, _)| i)
            .unwrap_or(0);
        out.push(left.swap_remove(i));
    }
    out
}

/// The prong count a cut is usually set with.
fn default_prongs(cut: Option<&str>) -> usize {
    match cut.unwrap_or("round") {
        "marquise" | "pear" | "oval" => 4,
        "trillion" | "triangle" | "heart" => 3,
        "princess" | "square" | "emerald" | "radiant" | "rect" | "baguette" | "cushion" => 4,
        "cabochon" => 4,
        _ => 6,
    }
}

/// Interactive SETTING: pick the stone, pick the style.
#[derive(Default)]
pub(super) struct SettingM {
    picked: Option<Handle>,
    style: Option<Style>,
}

impl Interactive for SettingM {
    fn name(&self) -> &'static str {
        "SETTING"
    }
    fn prompt(&self, _s: &Session) -> Prompt {
        if self.picked.is_none() {
            Prompt::new("Select the stone or closed outline", Accept::SELECT)
        } else {
            Prompt::new("Setting style", Accept::TEXT).kw(&["Prong", "Bezel", "Halo", "Channel"]).default("Prong")
        }
    }
    fn input(&mut self, s: &mut Session, i: Input) -> Result<Step> {
        match i {
            Input::Cancel => Ok(Step::Cancel),
            Input::Pick(hs) => {
                if let Some(h) = hs.first() {
                    self.picked = Some(*h);
                }
                Ok(Step::Continue)
            }
            Input::Enter if self.picked.is_some() => {
                self.style = Some(Style::Prong);
                self.finish(s)
            }
            Input::Text(t) if self.picked.is_some() => {
                let style = match t.trim().to_ascii_lowercase().as_str() {
                    "p" | "prong" | "claw" => Style::Prong,
                    "b" | "bezel" | "collet" => Style::Bezel,
                    "h" | "halo" => Style::Halo,
                    "c" | "channel" => Style::Channel,
                    _ => {
                        s.echo("Style must be Prong, Bezel, Halo or Channel.");
                        return Ok(Step::Continue);
                    }
                };
                self.style = Some(style);
                self.finish(s)
            }
            _ => Ok(Step::Continue),
        }
    }
}

impl SettingM {
    fn finish(&mut self, s: &mut Session) -> Result<Step> {
        let Some(h) = self.picked else { return Ok(Step::Continue) };
        let style = match self.style.unwrap_or(Style::Prong) {
            Style::Prong => "prong",
            Style::Bezel => "bezel",
            Style::Halo => "halo",
            Style::Channel => "channel",
        };
        let r = run_setting(s, &json!({"handle": h.hex(), "style": style}))?;
        if let Some(m) = r.get("message").and_then(Value::as_str) {
            s.echo(m.to_string());
        }
        Ok(Step::Done)
    }
}
