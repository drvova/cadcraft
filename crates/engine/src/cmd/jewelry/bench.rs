//! The bench sheet: what the drawing is worth in stones and metal.
//!
//! A jeweller's tech sheet counts the stones by cut and size, totals the carats, and weighs the
//! metal. `TECHSHEET` reads all three out of the drawing: every insert of a `GEM-…` block is a
//! stone (its cut and millimetres from the block name, its depth and specific gravity from the
//! block's `gem:` description, so a stone that was placed with a custom depth or in sapphire is
//! counted as itself), and the metal comes from the band's cross-section — a closed polyline
//! where x is the distance from the finger's surface and y runs along the finger — swept around
//! the finger by Pappus's theorem, `V = 2π·(R + x̄)·A`, at the alloy's density.
//!
//! Nothing here is estimated silently: a stone whose block carries no description is counted at
//! the cut's usual depth for diamond and the sheet says so.

use cadcraft_doc::EntityKind;
use cadcraft_geom::Vec2;
use serde_json::{Value, json};

use super::super::*;
use super::gem;
use super::*;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("techsheet", "Tech Sheet", run_techsheet)
            .menu(&["Inquiry", "Tech Sheet"])
            .alias(&["bom", "stonesheet"])
            .params("{handles?: [objects to count; default: the whole drawing], metal?: gold24|22|18|14|10|9|platinum|palladium|silver|steel|titanium|brass|copper|wax (default gold18), section?: a closed polyline cross-section (x = distance from the finger's surface, outward; y = along the finger), size?: ring size (with `system`), radius?: mm (inner radius instead of a size), system?: us|uk|eu|jp|cn, table?: bool (default false; draws the sheet as a table at `at`), at?: [x,y] (the table's position, default 0,0), layer?} → {stones: {groups, count, carat}, metal?, message, table?}")
            .noundo(),
    ]
}

/// One line of the stone count: a cut and size, how many, and what they weigh.
struct Group {
    cut: String,
    width: f64,
    length: f64,
    depth: f64,
    sg: f64,
    carat_each: f64,
    count: usize,
    /// How the depth and gravity were read: `name`, `block` or `default`.
    source: &'static str,
}

/// What a set of objects holds in stones, and what the drawing's bands weigh.
pub(crate) struct JewelryFacts {
    pub groups: Vec<Value>,
    pub stones: usize,
    pub carat: f64,
    /// Bands whose block carries its own size, metal and weight (`RING-…`).
    pub bands: Vec<Value>,
    /// Stones whose block description disagrees with its name, or that are not calibrated.
    pub warnings: Vec<String>,
}

impl JewelryFacts {
    /// A line for a report, or `None` when there is nothing to say.
    pub(crate) fn line(&self) -> Option<String> {
        if self.stones == 0 && self.bands.is_empty() {
            return None;
        }
        let mut out = String::new();
        if self.stones > 0 {
            let kinds: Vec<String> = self
                .groups
                .iter()
                .take(6)
                .map(|g| {
                    let cut = g["cut"].as_str().unwrap_or("stone");
                    let w = g["width"].as_f64().unwrap_or(0.0);
                    let l = g["length"].as_f64().unwrap_or(w);
                    let size = if (l - w).abs() < 1e-6 { format!("{} mm", size_json(w)) } else { format!("{}×{} mm", size_json(l), size_json(w)) };
                    format!("{} × {cut} {size}", g["count"].as_u64().unwrap_or(0))
                })
                .collect();
            out.push_str(&format!("{} stone(s), {:.3} ct: {}", self.stones, self.carat, kinds.join(", ")));
        }
        for b in &self.bands {
            if !out.is_empty() {
                out.push_str("; ");
            }
            out.push_str(&format!(
                "a size {} band in {} weighing about {:.2} g",
                b["size"].as_str().unwrap_or("?"),
                b["metal"].as_str().unwrap_or("metal"),
                b["grams"].as_f64().unwrap_or(0.0)
            ));
        }
        Some(out)
    }
}

/// Count the stones and bands among `entities`, the way a bench sheet does: the cut and size
/// from each stone's block name, its material and depth from that name, and the drawing's bands
/// from their own block descriptions.
pub(crate) fn jewelry_facts(d: &cadcraft_doc::Drawing, entities: &[&std::sync::Arc<cadcraft_doc::Entity>]) -> JewelryFacts {
    let mut groups: Vec<Group> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut bands: Vec<Value> = Vec::new();
    for e in entities {
        let EntityKind::Insert(ins) = &e.kind else { continue };
        if let Some(band) = parse_band(&ins.block, d.block(&ins.block).map(|b| b.description.as_str()).unwrap_or("")) {
            bands.push(band);
            continue;
        }
        let Some(name) = parse_gem_block(&ins.block) else { continue };
        let Some(cut) = gem::cut_of(&name.cut) else { continue };
        let desc = d.block(&ins.block).map(|b| b.description.clone()).unwrap_or_default();
        let meta = parse_gem_description(&desc);
        // The name is the stone's library key: it carries the material and any unusual depth.
        if let Some(m) = &meta
            && (m.cut != name.cut || (m.width - name.width).abs() > 1e-6 || (m.length - name.length).abs() > 1e-6)
        {
            warnings.push(format!(
                "{}: its description says {} {}×{} but its name says {} {}×{}; counted by the name",
                ins.block,
                m.cut,
                size_json(m.length),
                size_json(m.width),
                name.cut,
                size_json(name.length),
                size_json(name.width)
            ));
        }
        let sg = match (&name.material, name.sg) {
            (Some(m), _) => gem::sg_of(m),
            (None, sg) => sg,
        }
        .or_else(|| meta.as_ref().map(|m| m.sg))
        .filter(|s| *s > 0.0)
        .unwrap_or(3.52);
        let (depth, source) = match (name.depth, meta.as_ref().filter(|m| m.depth > 0.0)) {
            (Some(d), _) => (d, "name"),
            (None, Some(m)) => (m.depth, "block"),
            (None, None) => (gem::default_depth(cut, name.width), "default"),
        };
        let carat_each = match &meta {
            Some(m) if m.carat > 0.0 => m.carat,
            _ => gem::carat(cut, name.length, name.width, depth, sg),
        };
        match groups
            .iter_mut()
            .find(|g| g.cut == cut.name && (g.width - name.width).abs() < 1e-6 && (g.length - name.length).abs() < 1e-6 && (g.sg - sg).abs() < 1e-6)
        {
            Some(g) => g.count += 1,
            None => groups.push(Group { cut: cut.name.to_string(), width: name.width, length: name.length, depth, sg, carat_each, count: 1, source }),
        }
    }
    groups.sort_by(|a, b| b.carat_each.total_cmp(&a.carat_each).then_with(|| a.cut.cmp(&b.cut)));
    let carat: f64 = groups.iter().map(|g| g.carat_each * g.count as f64).sum();
    let stones: usize = groups.iter().map(|g| g.count).sum();
    let group_json: Vec<Value> = groups
        .iter()
        .map(|g| {
            json!({
                "cut": g.cut,
                "width": size_json(g.width),
                "length": size_json(g.length),
                "depth": size_json(g.depth),
                "sg": g.sg,
                "count": g.count,
                "caratEach": (g.carat_each * 1000.0).round() / 1000.0,
                "carat": ((g.carat_each * g.count as f64) * 1000.0).round() / 1000.0,
                "depthFrom": g.source,
                "calibrated": calibrated(g.width).is_some(),
            })
        })
        .collect();
    JewelryFacts { groups: group_json, stones, carat: (carat * 1000.0).round() / 1000.0, bands, warnings }
}

/// A band's own record, as `RING` wrote it into its block description:
/// `ring: us=6 uk=L eu=52 jp=12 cn=12, mm=16.51, wall=1.8, width=2, metal=gold18, grams=3.21`.
fn parse_band(block: &str, desc: &str) -> Option<Value> {
    if !block.starts_with("RING-") {
        return None;
    }
    let line = desc.lines().find(|l| l.trim_start().starts_with("ring:"))?;
    // The line is `key=value` pairs separated by commas and spaces.
    let field = |key: &str| -> Option<String> {
        line.split(|c: char| c == ',' || c.is_whitespace())
            .filter_map(|tok| tok.trim_start_matches("ring:").split_once('='))
            .find(|(k, _)| k.trim() == key)
            .map(|(_, v)| v.trim().to_string())
    };
    let number = |key: &str| field(key).and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite());
    Some(json!({
        "block": block,
        "size": field("us").map(|us| format!("US {us}")).unwrap_or_else(|| "?".to_string()),
        "mm": number("mm").map(size_json),
        "metal": field("metal").unwrap_or_else(|| "?".to_string()),
        "grams": number("grams").unwrap_or(0.0),
        "width": number("width").map(size_json),
        "wall": number("wall").map(size_json),
    }))
}

fn run_techsheet(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "techsheet";
    // The scope: the objects given, or the whole drawing.
    let scope: Option<Vec<Handle>> = match p.get("handles") {
        None | Some(Value::Null) => None,
        Some(_) => Some(targets(s, p)?),
    };
    let k = mm_per_unit(s);
    let d = s.doc()?;
    let entities: Vec<&std::sync::Arc<cadcraft_doc::Entity>> = match &scope {
        Some(hs) => {
            let mut v = Vec::new();
            for h in hs {
                v.push(d.entity(*h).ok_or_else(|| bad(cmd, format!("no object {}", h.hex())))?);
            }
            v
        }
        None => d.model.iter().collect(),
    };
    let facts = jewelry_facts(d, &entities);
    let (groups, total_stones, total_carat, warnings) = (&facts.groups, facts.stones, facts.carat, facts.warnings.clone());

    // The metal, from the band's cross-section.
    let mut metal_json = Value::Null;
    let mut metal_line: Option<String> = None;
    if let Some(section) = str_param(p, "section") {
        let h = cadcraft_doc::Handle::parse_hex(section).ok_or_else(|| bad(cmd, "`section` must be an object handle"))?;
        let e = d.entity(h).ok_or_else(|| bad(cmd, format!("no object {}", h.hex())))?;
        let EntityKind::LwPolyline(pl) = &e.kind else {
            return Err(bad(cmd, "`section` must be a closed polyline (the band's cross-section)"));
        };
        if !pl.closed || pl.vertices.len() < 3 {
            return Err(bad(cmd, "`section` must be a closed polyline (the band's cross-section)"));
        }
        let poly = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: true };
        let area_units2 = poly.area().abs();
        let centroid = poly.centroid().ok_or_else(|| bad(cmd, "the cross-section has no area"))?;
        let (metal, density) = sizes::metal_density(cmd, p)?;
        // The inside radius: from a ring size, or given directly in millimetres.
        let inner_radius_mm = match (sizes::size_param(cmd, p)?, p.get("radius").and_then(Value::as_f64)) {
            (Some(r), _) => r.diameter / 2.0,
            (None, Some(r)) if r.is_finite() && r > 0.0 => r,
            _ => return Err(bad(cmd, "give `size` (with `system`) or `radius` in mm for the metal weight")),
        };
        // The section is drawn in the drawing's units; the centroid's distance from the finger's
        // surface is its x, in millimetres.
        let area_mm2 = area_units2 * k * k;
        let offset_mm = centroid.x * k;
        let centre_mm = inner_radius_mm + offset_mm;
        let volume_mm3 = cadcraft_geom::TAU * centre_mm * area_mm2;
        let grams = volume_mm3 / 1000.0 * density;
        metal_json = json!({
            "metal": metal,
            "density": density,
            "sectionArea": (area_mm2 * 1000.0).round() / 1000.0,
            "centroidFromAxis": (centre_mm * 1000.0).round() / 1000.0,
            "innerRadius": size_json(inner_radius_mm),
            "volumeMm3": (volume_mm3 * 1000.0).round() / 1000.0,
            "grams": (grams * 1000.0).round() / 1000.0,
        });
        metal_line = Some(format!("{metal} {:.2} g (cross-section {:.2} mm², swept at {:.2} mm)", grams, area_mm2, centre_mm));
    } else if str_param(p, "metal").is_some() && p.get("size").is_some() {
        return Err(bad(cmd, "give `section` (the band's cross-section) to weigh metal"));
    }

    let mut lines: Vec<String> = Vec::new();
    for g in groups {
        let w = g["width"].as_f64().unwrap_or(0.0);
        let l = g["length"].as_f64().unwrap_or(w);
        let size_text = if (l - w).abs() < 1e-6 { format!("{} mm", size_json(w)) } else { format!("{}×{} mm", size_json(l), size_json(w)) };
        lines.push(format!(
            "{} {size_text} — {} pc, {:.3} ct total ({:.3} ct each)",
            g["cut"].as_str().unwrap_or("stone"),
            g["count"].as_u64().unwrap_or(0),
            g["carat"].as_f64().unwrap_or(0.0),
            g["caratEach"].as_f64().unwrap_or(0.0)
        ));
    }
    lines.push(format!("{total_stones} stones, {total_carat:.3} ct total"));
    if let Some(m) = &metal_line {
        lines.push(m.clone());
    }
    let message = lines.join("\n");

    // The sheet as a table in the drawing, when asked for.
    let mut table_handle: Option<String> = None;
    if bool_or(p, "table", false) {
        let at = point_param(p, "at").unwrap_or(Vec2::ZERO);
        let mut cells: Vec<Vec<String>> = Vec::new();
        for g in groups {
            let w = g["width"].as_f64().unwrap_or(0.0);
            let l = g["length"].as_f64().unwrap_or(w);
            cells.push(vec![
                format!("{} {}×{}", g["cut"].as_str().unwrap_or("stone"), size_json(l), size_json(w)),
                format!("{}", g["count"].as_u64().unwrap_or(0)),
                format!("{:.3}", g["caratEach"].as_f64().unwrap_or(0.0)),
                format!("{:.3}", g["carat"].as_f64().unwrap_or(0.0)),
            ]);
        }
        cells.push(vec!["Total".into(), format!("{total_stones}"), String::new(), format!("{total_carat:.3}")]);
        if let Some(m) = &metal_line {
            cells.push(vec![m.clone(), String::new(), String::new(), String::new()]);
        }
        let style = cadcraft_doc::TableStyle::default();
        let t = table::make_table(
            &style,
            at,
            cells.len(),
            4,
            None,
            None,
            Some("Tech Sheet"),
            Some(vec!["Stone".into(), "Qty".into(), "Ct each".into(), "Ct".into()]),
            &cells,
        );
        let h = s.add_entity(EntityKind::Table(t))?;
        on_layer(s, h, str_param(p, "layer"))?;
        table_handle = Some(h.hex());
    }
    Ok(json!({
        "stones": { "groups": groups, "count": total_stones, "carat": total_carat },
        "warnings": warnings,
        "metal": metal_json,
        "table": table_handle,
        "message": message,
    }))
}
