//! Gemstones: each cut's real girdle as CAD geometry, its carat weight from measured dimensions,
//! and the GEM command that places a stone as one block per cut and size.
//!
//! A stone's outline is its girdle — a round brilliant is a circle, a marquise is two arcs meeting
//! at the tips, an emerald is a rectangle with cut corners, a pear is a circle with tangents to a
//! point. Drawing them all as circles (or as a scaled square) is the mistake that makes a halo not
//! follow its trillion and a bezel not hold its marquise. Here each cut is built from its own
//! construction, with bulges where the girdle is an arc, so the geometry is exact and editable.
//!
//! The weight comes from the trade's own formula, `L × W × depth × SG × factor`, with the factor
//! per cut (a round brilliant's published constant is 0.0061 at SG 3.52, an emerald's 0.0092), and
//! the depth defaults to the cut's usual proportion of its width. Everything a bench needs is
//! reported back, and the stone's block carries the same numbers in its description so the bench
//! sheet reads the drawing instead of re-deriving anything.

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::{Vec2, Vec3};
use serde_json::{Value, json};

use super::super::*;
use super::*;
use crate::{Accept, Input, Interactive, Prompt, Step};

/// How a cut's face-up dimensions enter the weight formula.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Measure {
    /// One diameter: the mean of the face-up dimensions (a round brilliant).
    Diameter,
    /// The full length and width.
    LengthWidth,
}

/// One cut: how it draws, how heavy it is, how deep it usually is.
pub struct Cut {
    pub name: &'static str,
    /// The trade's weight factor: carats per mm³ per unit of specific gravity.
    pub factor: f64,
    /// Usual depth as a fraction of the width.
    pub depth_ratio: f64,
    measure: Measure,
    style: Style,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Style {
    Round,
    Oval,
    Marquise,
    Pear,
    Heart,
    Triangle,
    Square,
    Cushion,
    Emerald,
    Baguette,
    Radiant,
}

/// Every cut, with the trade's published weight factors and usual depth proportions. A factor is
/// the published carat constant divided by diamond's specific gravity, so the formula reads
/// `length × width × depth × SG × factor` for any material.
pub const CUTS: &[Cut] = &[
    Cut { name: "round", factor: 0.0061 / 3.52, depth_ratio: 0.615, measure: Measure::Diameter, style: Style::Round },
    Cut { name: "oval", factor: 0.0062 / 3.52, depth_ratio: 0.60, measure: Measure::LengthWidth, style: Style::Oval },
    Cut { name: "cushion", factor: 0.00815 / 3.52, depth_ratio: 0.65, measure: Measure::LengthWidth, style: Style::Cushion },
    Cut { name: "princess", factor: 0.0080 / 3.52, depth_ratio: 0.70, measure: Measure::LengthWidth, style: Style::Square },
    Cut { name: "square", factor: 0.0080 / 3.52, depth_ratio: 0.70, measure: Measure::LengthWidth, style: Style::Square },
    Cut { name: "radiant", factor: 0.0081 / 3.52, depth_ratio: 0.68, measure: Measure::LengthWidth, style: Style::Radiant },
    Cut { name: "emerald", factor: 0.0092 / 3.52, depth_ratio: 0.65, measure: Measure::LengthWidth, style: Style::Emerald },
    Cut { name: "baguette", factor: 0.00915 / 3.52, depth_ratio: 0.55, measure: Measure::LengthWidth, style: Style::Baguette },
    Cut { name: "rect", factor: 0.00915 / 3.52, depth_ratio: 0.55, measure: Measure::LengthWidth, style: Style::Baguette },
    Cut { name: "marquise", factor: 0.00565 / 3.52, depth_ratio: 0.58, measure: Measure::LengthWidth, style: Style::Marquise },
    Cut { name: "pear", factor: 0.00615 / 3.52, depth_ratio: 0.60, measure: Measure::LengthWidth, style: Style::Pear },
    Cut { name: "heart", factor: 0.0059 / 3.52, depth_ratio: 0.60, measure: Measure::LengthWidth, style: Style::Heart },
    Cut { name: "trillion", factor: 0.0057 / 3.52, depth_ratio: 0.55, measure: Measure::LengthWidth, style: Style::Triangle },
    Cut { name: "triangle", factor: 0.0057 / 3.52, depth_ratio: 0.55, measure: Measure::LengthWidth, style: Style::Triangle },
    Cut { name: "cabochon", factor: 0.0013, depth_ratio: 0.45, measure: Measure::LengthWidth, style: Style::Oval },
];

/// A named stone's specific gravity (the usual trade values).
pub const STONES: &[(&str, f64)] = &[
    ("diamond", 3.52),
    ("cz", 5.70),
    ("moissanite", 3.22),
    ("sapphire", 4.00),
    ("ruby", 4.00),
    ("emerald", 2.72),
    ("morganite", 2.80),
    ("aquamarine", 2.70),
    ("amethyst", 2.65),
    ("citrine", 2.65),
    ("quartz", 2.65),
    ("topaz", 3.55),
    ("spinel", 3.60),
    ("tanzanite", 3.35),
    ("tourmaline", 3.06),
    ("garnet", 3.80),
    ("peridot", 3.34),
    ("alexandrite", 3.70),
    ("zircon", 4.60),
    ("opal", 2.10),
    ("pearl", 2.70),
    ("onyx", 2.65),
    ("turquoise", 2.80),
    ("lapis", 2.80),
    ("jade", 3.30),
    ("moonstone", 2.57),
    ("coral", 2.70),
];

/// The cut a name refers to.
pub fn cut_of(name: &str) -> Option<&'static Cut> {
    let n = name.trim().to_ascii_lowercase();
    let n = match n.as_str() {
        "brilliant" | "rb" | "roundbrilliant" => "round",
        "sq" => "square",
        "princesscut" => "princess",
        "emeraldcut" => "emerald",
        "marquis" | "navette" => "marquise",
        "teardrop" => "pear",
        "tri" | "trilliant" => "trillion",
        "cab" => "cabochon",
        "rectangular" => "rect",
        other => other,
    };
    CUTS.iter().find(|c| c.name == n)
}

/// A named stone's specific gravity.
pub fn sg_of(name: &str) -> Option<f64> {
    let n = name.trim().to_ascii_lowercase();
    STONES.iter().find(|(s, _)| *s == n).map(|(_, sg)| *sg)
}

/// The carat weight of a stone from its measured dimensions.
pub fn carat(cut: &Cut, length: f64, width: f64, depth: f64, sg: f64) -> f64 {
    match cut.measure {
        Measure::Diameter => {
            let d = (length + width) / 2.0;
            d * d * depth * sg * cut.factor
        }
        Measure::LengthWidth => length * width * depth * sg * cut.factor,
    }
}

/// The depth a cut of this width usually has.
pub fn default_depth(cut: &Cut, width: f64) -> f64 {
    (cut.depth_ratio * width * 100.0).round() / 100.0
}

/// A stone's outline in millimetres, centred on the origin.
pub fn outline(cut: &Cut, length: f64, width: f64) -> EntityKind {
    match cut.style {
        Style::Round => EntityKind::Circle(cadcraft_doc::Circle { center: Vec3::ZERO, radius: width / 2.0 }),
        Style::Oval => {
            // The length runs along +y, as on every other cut; a width longer than the length is
            // the same stone turned a quarter turn.
            let (major, ratio) = if length >= width {
                (Vec3::new(0.0, length / 2.0, 0.0), width / length)
            } else {
                (Vec3::new(length / 2.0, 0.0, 0.0), length / width)
            };
            EntityKind::Ellipse(cadcraft_doc::Ellipse { center: Vec3::ZERO, major, ratio, start: 0.0, end: cadcraft_geom::TAU })
        }
        Style::Marquise => marquise(length, width),
        Style::Pear => pear(length, width),
        Style::Heart => heart(length, width),
        Style::Triangle => polyline(triangle_vertices(length, width), &[]),
        Style::Square => rect_polyline(length, width, 0.0),
        Style::Cushion => rounded_polygon(&rect_vertices(length, width), 0.18 * width.min(length)),
        Style::Emerald => rect_polyline(length, width, 0.20 * width),
        Style::Baguette => rect_polyline(length, width, 0.0),
        Style::Radiant => rect_polyline(length, width, 0.12 * width),
    }
}

/// A closed polyline of straight edges, with a bulge after each vertex that is an arc.
fn polyline(verts: Vec<Vec2>, bulges: &[f64]) -> EntityKind {
    let vertices =
        verts.into_iter().enumerate().map(|(i, p)| cadcraft_geom::PolyVertex::with_bulge(p, bulges.get(i).copied().unwrap_or(0.0))).collect();
    EntityKind::LwPolyline(cadcraft_doc::LwPolyline { vertices, closed: true, const_width: 0.0, elevation: 0.0, plinegen: false })
}

/// A rectangle (or square) of `length` × `width` with its corners cut by `cut`.
fn rect_polyline(length: f64, width: f64, cut: f64) -> EntityKind {
    // The width is across x and the length along y, as on every other cut.
    let (a, b) = (width / 2.0, length / 2.0);
    let c = cut.min(a * 0.45).min(b * 0.45);
    let verts = if c <= 1e-9 {
        vec![Vec2::new(-a, -b), Vec2::new(a, -b), Vec2::new(a, b), Vec2::new(-a, b)]
    } else {
        vec![
            Vec2::new(-a, -b + c),
            Vec2::new(-a + c, -b),
            Vec2::new(a - c, -b),
            Vec2::new(a, -b + c),
            Vec2::new(a, b - c),
            Vec2::new(a - c, b),
            Vec2::new(-a + c, b),
            Vec2::new(-a, b - c),
        ]
    };
    polyline(verts, &[])
}

/// The corners of a rectangle.
fn rect_vertices(length: f64, width: f64) -> Vec<Vec2> {
    let (a, b) = (width / 2.0, length / 2.0);
    vec![Vec2::new(-a, -b), Vec2::new(a, -b), Vec2::new(a, b), Vec2::new(-a, b)]
}

/// A trillion's corners: a triangle `length` tall and `width` across its base, point up.
fn triangle_vertices(length: f64, width: f64) -> Vec<Vec2> {
    vec![Vec2::new(0.0, length / 2.0), Vec2::new(width / 2.0, -length / 2.0), Vec2::new(-width / 2.0, -length / 2.0)]
}

/// A polygon with rounded corners: each corner is an arc of `radius` between its two tangent
/// points, so a cushion's corners are real arcs and not a chopped square.
fn rounded_polygon(verts: &[Vec2], radius: f64) -> EntityKind {
    let n = verts.len();
    if n < 3 || radius <= 1e-9 {
        return polyline(verts.to_vec(), &[]);
    }
    let mut out: Vec<Vec2> = Vec::with_capacity(n * 3);
    let mut bulges: Vec<f64> = Vec::with_capacity(n * 3);
    for i in 0..n {
        let prev = verts[(i + n - 1) % n];
        let cur = verts[i];
        let next = verts[(i + 1) % n];
        let to_prev = (prev - cur).normalized();
        let to_next = (next - cur).normalized();
        // Half the shorter edge bounds the radius, so two corners never overlap.
        let r = radius.min(cur.dist(prev) / 2.0).min(cur.dist(next) / 2.0);
        let turn = (to_prev.x * to_next.y - to_prev.y * to_next.x).atan2(to_prev.dot(to_next));
        out.push(cur + to_prev * r);
        bulges.push(cadcraft_geom::arc_to_bulge(turn.abs() * turn.signum()));
        out.push(cur + to_next * r);
        bulges.push(0.0);
    }
    polyline(out, &bulges)
}

/// A marquise (navette): two arcs meeting at the tips, each passing through a widest point. The
/// outline runs tip → tip through the +x arc, then back through the −x arc, which is clockwise,
/// so both bulges are negative.
fn marquise(length: f64, width: f64) -> EntityKind {
    let (half_len, half_wid) = (length / 2.0, width / 2.0);
    // The arc through both tips and the widest point: its centre lies on the width axis, `c` from
    // the centre, with half_len² + c² = (half_wid − c)².
    let c = (half_wid * half_wid - half_len * half_len) / (2.0 * half_wid);
    let r = (half_len * half_len + c * c).sqrt();
    let theta = 2.0 * (half_len / r).clamp(-1.0, 1.0).asin();
    let bulge = cadcraft_geom::arc_to_bulge(-theta);
    polyline(vec![Vec2::new(0.0, half_len), Vec2::new(0.0, -half_len)], &[bulge, bulge])
}

/// A pear: a circle at the bottom with two tangents to the point at the top.
fn pear(length: f64, width: f64) -> EntityKind {
    let r = width / 2.0;
    let tip = Vec2::new(0.0, length / 2.0);
    let centre = Vec2::new(0.0, -(length / 2.0) + r);
    let Some((t1, t2)) = tangent_points(centre, r, tip) else {
        return marquise(length, width);
    };
    // The arc runs around the belly, through the point of the circle furthest from the tip.
    let a1 = (t1 - centre).y.atan2((t1 - centre).x);
    let a2 = (t2 - centre).y.atan2((t2 - centre).x);
    let belly = (centre - tip).y.atan2((centre - tip).x);
    polyline(vec![tip, t1, t2], &[0.0, cadcraft_geom::arc_to_bulge(sweep_through(a1, a2, belly)), 0.0])
}

/// The signed sweep from `a1` to `a2` that passes through the angle `through`.
fn sweep_through(a1: f64, a2: f64, through: f64) -> f64 {
    let ccw = cadcraft_geom::ccw_sweep(a1, a2);
    let cw = ccw - cadcraft_geom::TAU;
    let gap = |a: f64, b: f64| {
        let d = (a - b).rem_euclid(cadcraft_geom::TAU);
        d.min(cadcraft_geom::TAU - d)
    };
    if gap(a1 + ccw / 2.0, through) <= gap(a1 + cw / 2.0, through) { ccw } else { cw }
}

/// A heart: two tangent circles for the lobes and two lines to the point below.
fn heart(length: f64, width: f64) -> EntityKind {
    let r = width / 4.0;
    let yc = length / 2.0 - r;
    let right = Vec2::new(r, yc);
    let left = Vec2::new(-r, yc);
    let tip = Vec2::new(0.0, -length / 2.0);
    let notch = Vec2::new(0.0, yc);
    let (Some((rt1, rt2)), Some((lt1, lt2))) = (tangent_points(right, r, tip), tangent_points(left, r, tip)) else {
        return pear(length, width);
    };
    // Each lobe's arc runs over the top of its lobe: through the point of its circle furthest
    // from the heart's tip.
    let arc = |c: Vec2, from: Vec2, to: Vec2| {
        let a1 = (from - c).y.atan2((from - c).x);
        let a2 = (to - c).y.atan2((to - c).x);
        let top = (c - tip).y.atan2((c - tip).x);
        cadcraft_geom::arc_to_bulge(sweep_through(a1, a2, top))
    };
    let right_outer = if rt1.x > rt2.x { rt1 } else { rt2 };
    let left_outer = if lt1.x < lt2.x { lt1 } else { lt2 };
    polyline(vec![notch, right_outer, tip, left_outer], &[arc(right, notch, right_outer), 0.0, 0.0, arc(left, left_outer, notch)])
}

/// The two tangent points from a point outside a circle.
fn tangent_points(centre: Vec2, r: f64, from: Vec2) -> Option<(Vec2, Vec2)> {
    let d = from - centre;
    let len = d.len();
    if len <= r + 1e-9 {
        return None;
    }
    // The right triangle centre–tangent point–`from`: the angle at the centre between the
    // direction to `from` and the tangent point is acos(r/d).
    let alpha = (r / len).clamp(-1.0, 1.0).acos();
    let base = d.y.atan2(d.x);
    let mut out = [Vec2::ZERO; 2];
    for (i, sign) in [-1.0f64, 1.0].into_iter().enumerate() {
        let a = base + sign * alpha;
        out[i] = centre + Vec2::new(a.cos(), a.sin()) * r;
    }
    Some((out[0], out[1]))
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("gem", "Gem", run_gem)
            .menu(&["Draw", "Gem"])
            .alias(&["stone"])
            .params("{at: [x,y], cut?: round|oval|cushion|princess|square|radiant|emerald|baguette|rect|marquise|pear|heart|trillion|cabochon (default round), length?, width?, diameter?: mm (sets both), depth?: mm (default: the cut's usual proportion), stone?: diamond|cz|sapphire|ruby|emerald|… (default diamond), sg?: specific gravity (instead of `stone`), rotate?: degrees, table?: bool (default true; also draws the table facet), layer?} → {handle, block, cut, length, width, depth, carat, sg, calibrated}")
            .interactive(|_| Ok(Box::new(GemM::default()))),
        CommandSpec::new("gemlist", "Gem Cuts", run_list)
            .params("{cut?: filter} → {cuts: [{name, factor, depthRatio, measure, example, exampleDepth, exampleCarat}], stones: [[name, sg]]}: the cut table with the trade's weight factor, the depth it is usually cut to, and a worked example in diamond")
            .noundo(),
    ]
}

/// The stone a JSON object describes: cut, dimensions, depth and specific gravity.
pub(super) struct Stone {
    pub cut: &'static Cut,
    pub length: f64,
    pub width: f64,
    pub depth: f64,
    pub sg: f64,
    /// The stone's trade name (`sapphire`) when one was given.
    pub material: Option<String>,
    /// The depth was given rather than taken from the cut's usual proportion.
    pub depth_given: bool,
}

impl Stone {
    /// The block this stone is inserted as.
    pub(super) fn block(&self) -> String {
        gem_block_name(
            self.cut.name,
            self.length,
            self.width,
            self.material.as_deref(),
            if (self.sg - 3.52).abs() > 1e-9 { Some(self.sg) } else { None },
            if self.depth_given { Some(self.depth) } else { None },
        )
    }
}

/// Read `{cut, length, width, diameter, depth, stone, sg}` into a stone.
pub(super) fn stone_params(cmd: &str, p: &Value) -> Result<Stone> {
    let cut_name = str_param(p, "cut").unwrap_or("round");
    let cut = cut_of(cut_name).ok_or_else(|| {
        bad(cmd, format!("`{cut_name}` is not a cut (round, oval, cushion, princess, square, radiant, emerald, baguette, rect, marquise, pear, heart, trillion, cabochon)"))
    })?;
    let diameter = mm_or(cmd, p, "diameter")?;
    // `diameter` sets both dimensions; `width` alone is a stone that size square, and `length`
    // alone likewise. Any pair is taken as given.
    let (length, width) = match (mm_or(cmd, p, "length")?, mm_or(cmd, p, "width")?, diameter) {
        (Some(l), Some(w), _) => (l, w),
        (Some(l), None, _) => (l, l),
        (None, Some(w), _) => (w, w),
        (None, None, Some(d)) => (d, d),
        (None, None, None) => return Err(bad(cmd, "give `width` (with `length` for an elongated cut), or `diameter`")),
    };
    if width > length + 1e-9 && cut.style != Style::Oval {
        return Err(bad(cmd, format!("`width` ({width}) is larger than `length` ({length}) for a {} cut", cut.name)));
    }
    let depth_given = mm_or(cmd, p, "depth")?.is_some();
    let depth = mm_or(cmd, p, "depth")?.unwrap_or_else(|| default_depth(cut, width));
    if depth <= 0.0 {
        return Err(bad(cmd, "`depth` must be positive"));
    }
    let (material, sg) = match (str_param(p, "stone"), p.get("sg").and_then(Value::as_f64)) {
        (Some(name), None) => {
            let name = name.trim().to_ascii_lowercase();
            let sg = sg_of(&name).ok_or_else(|| bad(cmd, format!("`{name}` is not a stone (GEMLIST lists them); give `sg` instead")))?;
            (Some(name), sg)
        }
        (_, Some(sg)) if sg.is_finite() && sg > 0.0 => (None, sg),
        (_, Some(_)) => return Err(bad(cmd, "`sg` must be a positive specific gravity")),
        (None, None) => (None, 3.52),
    };
    Ok(Stone { cut, length, width, depth, sg, material, depth_given })
}

fn run_gem(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "gem";
    let at = point_req(cmd, p, "at")?;
    let stone = stone_params(cmd, p)?;
    let rotate = angle_or(cmd, p, "rotate", 0.0)?;
    let table = bool_or(p, "table", true);
    let layer = str_param(p, "layer").map(str::to_string);
    if let Some(name) = &layer {
        check_layer(s, cmd, name)?;
    }
    let mut kinds = vec![outline(stone.cut, stone.length, stone.width)];
    if table {
        kinds.push(table_outline(&stone));
    }
    let name = stone.block();
    let carat = carat(stone.cut, stone.length, stone.width, stone.depth, stone.sg);
    let desc = gem_description(stone.cut.name, stone.length, stone.width, stone.depth, stone.sg, carat);
    let scale = 1.0 / mm_per_unit(s);
    let h = sizes::define_block_and_insert(s, &name, kinds, &desc, at, scale)?;
    if rotate.abs() > 1e-12 {
        s.doc_mut()?.modify_entity(h, |e| {
            if let EntityKind::Insert(i) = &mut e.kind {
                i.rotation = rotate;
            }
        })?;
    }
    on_layer(s, h, layer.as_deref())?;
    Ok(json!({
        "handle": h.hex(),
        "block": name,
        "cut": stone.cut.name,
        "material": stone.material.clone(),
        "length": size_json(stone.length),
        "width": size_json(stone.width),
        "depth": size_json(stone.depth),
        "carat": (carat * 1000.0).round() / 1000.0,
        "sg": stone.sg,
        "table": table,
        "calibrated": calibrated(stone.width).is_some(),
        "message": format!(
            "{} {}×{} mm, depth {} mm: {:.3} ct (SG {})",
            stone.cut.name, size_json(stone.length), size_json(stone.width), size_json(stone.depth), carat, stone.sg
        ),
    }))
}

/// A stone's table facet: the girdle scaled by the cut's usual table.
fn table_outline(stone: &Stone) -> EntityKind {
    let pct = match stone.cut.style {
        Style::Round => 0.57,
        Style::Emerald | Style::Baguette | Style::Radiant => 0.65,
        Style::Oval => 0.60,
        _ => 0.62,
    };
    if stone.cut.style == Style::Round {
        return EntityKind::Circle(cadcraft_doc::Circle { center: Vec3::ZERO, radius: stone.width / 2.0 * pct });
    }
    outline(stone.cut, stone.length * pct, stone.width * pct)
}

fn run_list(_s: &mut Session, p: &Value) -> Result<Value> {
    let filter = str_param(p, "cut").map(|c| c.trim().to_ascii_lowercase());
    let cuts: Vec<Value> = CUTS
        .iter()
        .filter(|c| filter.as_ref().is_none_or(|f| c.name.contains(f.as_str())))
        .map(|c| {
            // An example stone of the size this cut is usually bought in: a round's diameter, an
            // elongated cut's length and width.
            let (l, w): (f64, f64) = if c.measure == Measure::Diameter { (6.5, 6.5) } else { (8.0, 6.0) };
            json!({
                "name": c.name,
                "factor": (c.factor * 1e6).round() / 1e6,
                "depthRatio": c.depth_ratio,
                "measure": if c.measure == Measure::Diameter { "diameter" } else { "length×width" },
                "example": if (l - w).abs() < 1e-6 { format!("{} mm", fmt_mm(w)) } else { format!("{}×{} mm", fmt_mm(l), fmt_mm(w)) },
                "exampleDepth": fmt_mm(default_depth(c, w)),
                "exampleCarat": (carat(c, l, w, default_depth(c, w), 3.52) * 1000.0).round() / 1000.0,
            })
        })
        .collect();
    Ok(json!({
        "cuts": cuts,
        "stones": STONES.iter().map(|(n, sg)| json!([n, sg])).collect::<Vec<_>>(),
    }))
}

/// Interactive GEM: a width, then a centre point.
#[derive(Default)]
pub(super) struct GemM {
    width: Option<f64>,
}

impl Interactive for GemM {
    fn name(&self) -> &'static str {
        "GEM"
    }
    fn prompt(&self, _s: &Session) -> Prompt {
        if self.width.is_none() {
            Prompt::new("Gem width in mm", Accept::NUMBER).default("2")
        } else {
            Prompt::new("Specify centre point", Accept::POINT)
        }
    }
    fn input(&mut self, s: &mut Session, i: Input) -> Result<Step> {
        match i {
            Input::Cancel => Ok(Step::Cancel),
            Input::Enter if self.width.is_none() => {
                self.width = Some(2.0);
                Ok(Step::Continue)
            }
            Input::Text(t) if self.width.is_none() => match crate::cmd::machines::number(&t).filter(|w| *w > 0.0) {
                Some(w) => {
                    self.width = Some(w);
                    Ok(Step::Continue)
                }
                None => {
                    s.echo("The gem width must be a positive number of mm.");
                    Ok(Step::Continue)
                }
            },
            Input::Point(p) if self.width.is_some() => {
                let width = self.width.unwrap_or(2.0);
                let r = run_gem(s, &json!({"at": [p.x, p.y], "width": width}))?;
                if let Some(m) = r.get("message").and_then(Value::as_str) {
                    s.echo(m.to_string());
                }
                Ok(Step::Done)
            }
            _ => Ok(Step::Continue),
        }
    }
    fn preview(&self, s: &Session, c: Vec2) -> Vec<EntityKind> {
        let Some(w) = self.width else { return Vec::new() };
        let scale = 1.0 / mm_per_unit(s);
        let mut k = outline(&CUTS[0], w, w);
        k.transform(&cadcraft_geom::Mat3::translate(c).then(cadcraft_geom::Mat3::scale(scale, scale)));
        vec![k]
    }
}

/// A `Handle` for a stone placed by another command (the pavé builder, a halo).
pub(super) fn place_stone(s: &mut Session, stone: &Stone, at: Vec2, rotate: f64, layer: Option<&str>) -> Result<Handle> {
    let kinds = vec![outline(stone.cut, stone.length, stone.width)];
    let name = stone.block();
    let carat = carat(stone.cut, stone.length, stone.width, stone.depth, stone.sg);
    let desc = gem_description(stone.cut.name, stone.length, stone.width, stone.depth, stone.sg, carat);
    let scale = 1.0 / mm_per_unit(s);
    let h = sizes::define_block_and_insert(s, &name, kinds, &desc, at, scale)?;
    if rotate.abs() > 1e-12 {
        s.doc_mut()?.modify_entity(h, |e| {
            if let EntityKind::Insert(i) = &mut e.kind {
                i.rotation = rotate;
            }
        })?;
    }
    on_layer(s, h, layer)?;
    Ok(h)
}
