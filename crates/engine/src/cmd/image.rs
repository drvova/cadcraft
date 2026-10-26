//! Raster images: IMAGEATTACH (place a picture in the drawing) and IMAGETRACE (turn a picture's
//! shapes into polylines — the fast way to vectorize a reference).
//!
//! Both work on a file path or on base64 `data` (the web build, and MCP calls that upload). The
//! pixels are never stored in the drawing: an IMAGE entity keeps the path, the placement and the
//! display settings, and the renderer reads the file through its own decode cache.
//!
//! IMAGETRACE is the vectorizer: it thresholds the picture (Otsu, or a level given), traces the
//! boundary of every dark (or light, or opaque) region with marching squares at sub-pixel
//! accuracy, simplifies the outlines (Douglas–Peucker) and draws them as polylines scaled to the
//! drawing. A photo of a wing becomes editable geometry in one call, and the same call can size
//! the result (`width`/`height`), so a traced part comes out at the measurement wanted.

use cadcraft_doc::{EntityKind, Image};
use cadcraft_geom::{Bounds2, PolyVertex, Vec2, Vec3};
use serde_json::{Value, json};

use super::file::base64_decode;
use super::*;

/// Largest image side IMAGETRACE accepts (a bigger picture is refused with a clear message).
pub const MAX_TRACE_SIDE: u32 = 8192;
/// Largest number of pixels IMAGETRACE walks (one marching-squares cell each).
pub const MAX_TRACE_PIXELS: u64 = 16 * 1024 * 1024;
/// Most points IMAGETRACE writes into the drawing across every contour.
pub const MAX_TRACE_POINTS: usize = 400_000;
/// Most contours IMAGETRACE keeps.
pub const MAX_TRACE_CONTOURS: usize = 4_096;
/// Half a level step: a sample exactly at the threshold counts as inside, so a pure
/// black-and-white picture (whose Otsu threshold is 0) still traces its black pixels.
const LEVEL_BIAS: f64 = 0.5;
/// Crossings are joined at 1/4096 pixel — finer than any sub-pixel interpolation produces, so
/// two segments that meet do meet at the same key.
const CHAIN_QUANT: f64 = 4096.0;
/// Most bytes read for one image (the renderer's own cap).
const MAX_IMAGE_BYTES: u64 = cadcraft_render::raster_image::MAX_IMAGE_BYTES;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("imageattach", "Attach Image...", run_attach)
            .menu(&["Insert", "Raster Image Reference..."])
            .alias(&["iattach"])
            .params("{path | data: base64, name?, at?: [x,y] (default 0,0), width?: drawing units (default: pixels × the image's own unit), height?: units (keeps the shape), rotation?: degrees, layer?, clip?: [[x,y]…] in pixels (two = opposite corners), brightness?, contrast?, fade?: 0..100} → {handle, pixels: [w,h], width, height, unitsPerPixel, path}"),
        CommandSpec::new("imagetrace", "Trace Image", run_trace)
            .menu(&["Insert", "Trace Image to Lines"])
            .alias(&["vectorize", "autotrace"])
            .params("{path | data: base64 | handle (a placed image), at?: [x,y], scale?: drawing units per pixel, width? | height?: size the result to a measurement, mode?: dark|light|alpha (default dark), threshold?: 0..255 (default Otsu), blur?: pixels (default 1), simplify?: pixels (default 0.5; 0 keeps every pixel crossing), downsample?: 1..16 (default 1), minArea?: square pixels (default 9), holes?: bool (default true), closed?: bool (default true), layer?, maxContours?, maxPoints?} → {contours, points, polylines, bounds, pixels, unitsPerPixel, threshold, scaledBy, skipped}"),
        CommandSpec::new("imageframe", "Image Frame", run_frame)
            .menu(&["Modify", "Object", "Image", "Frame"])
            .params("{value: 0|1|2 | \"on\"|\"off\"|\"display\"} → {IMAGEFRAME}"),
        CommandSpec::new("imageadjust", "Image Adjust", run_adjust)
            .menu(&["Modify", "Object", "Image", "Adjust..."])
            .params("{handles?, brightness?: 0..100, contrast?: 0..100, fade?: 0..100} → {adjusted}"),
    ]
}

/// An image source: its pixels, the drawing units one pixel measures when it comes from a placed
/// entity, and that entity's placement.
struct Source {
    pixels: std::sync::Arc<cadcraft_render::ImageData>,
    unit: Option<Vec2>,
    insert: Vec2,
    rotation: f64,
    name: String,
    path: String,
    /// False when the pixels came as `data`: the drawing then names a file that may not exist.
    on_disk: bool,
}

/// Resolve `{handle | path | data}` into pixels.
fn source(s: &Session, p: &Value, cmd: &str) -> Result<Source> {
    if let Some(h) = curves::handle_param(p, "handle") {
        let e = curves::entity(s, h)?;
        let EntityKind::Image(i) = &e.kind else { return Err(bad(cmd, "the object is not an image")) };
        let pixels = cadcraft_render::raster_image::load(&i.path).ok_or_else(|| {
            bad(cmd, format!("{}: the image file could not be read (a PNG or JPEG up to {} MB)", i.path, MAX_IMAGE_BYTES / 1024 / 1024))
        })?;
        let unit = Some(Vec2::new(i.u.xy().len(), i.v.xy().len()));
        let rotation = i.u.xy().y.atan2(i.u.xy().x);
        return Ok(Source { pixels, unit, insert: i.insert.xy(), rotation, name: i.name.clone(), path: i.path.clone(), on_disk: true });
    }
    let (bytes, name, path, on_disk) = match (str_param(p, "path"), str_param(p, "data")) {
        (Some(path), _) => {
            // The web build has no file system to read a path from: an image there arrives as
            // base64 `data` (a dropped file, or an MCP upload).
            #[cfg(target_arch = "wasm32")]
            {
                let _ = path;
                return Err(bad(cmd, "the web build has no file system; pass the image as base64 `data`"));
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                let bytes = crate::capped_read::read_capped(std::path::Path::new(path), MAX_IMAGE_BYTES as usize)
                    .map_err(|e| bad(cmd, format!("{path}: {e}")))?;
                (bytes, file_name(path), path.to_string(), true)
            }
        }
        (None, Some(data)) => {
            let bytes = base64_decode(data).ok_or_else(|| bad(cmd, "`data` is not valid base64"))?;
            if bytes.len() as u64 > MAX_IMAGE_BYTES {
                return Err(bad(cmd, format!("`data` is larger than {} MB", MAX_IMAGE_BYTES / 1024 / 1024)));
            }
            let name = str_param(p, "name").map(str::to_string).unwrap_or_else(|| "image.png".to_string());
            (bytes, name.clone(), name, false)
        }
        (None, None) => return Err(bad(cmd, "`handle`, `path` or `data` is required")),
    };
    let pixels = cadcraft_render::raster_image::decode_bytes(&bytes).ok_or_else(|| bad(cmd, format!("{name}: not a readable PNG or JPEG")))?;
    Ok(Source { pixels: pixels.into(), unit: None, insert: Vec2::ZERO, rotation: 0.0, name, path, on_disk })
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string())
}

/// A 0..=100 percentage parameter (out of range is an error, never clamped silently).
fn percent(cmd: &str, p: &Value, key: &str, default: u8) -> Result<u8> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => match v.as_f64().filter(|x| x.is_finite()) {
            Some(x) if (0.0..=100.0).contains(&x) => Ok(x.round() as u8),
            _ => Err(bad(cmd, format!("`{key}` must be 0 to 100"))),
        },
    }
}

/// Refuse a layer that does not exist (attaching and tracing may name one).
fn check_layer(s: &Session, cmd: &str, name: &str) -> Result<()> {
    if s.doc()?.layer(name).is_none() {
        return Err(bad(cmd, format!("no layer named `{name}`")));
    }
    Ok(())
}

/// A positive size parameter, or `None` when it is absent.
fn size_or_none(cmd: &str, p: &Value, key: &str) -> Result<Option<f64>> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x > 0.0) {
            Some(x) => Ok(Some(x)),
            None => Err(bad(cmd, format!("`{key}` must be a positive number"))),
        },
    }
}

fn run_attach(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "imageattach";
    let src = source(s, p, cmd)?;
    let (w, h) = (f64::from(src.pixels.width), f64::from(src.pixels.height));
    if w < 1.0 || h < 1.0 {
        return Err(bad(cmd, "the image has no pixels"));
    }
    // One pixel's drawing units: the image's own resolution when it has one, else 1 unit.
    let unit = src.unit.unwrap_or(Vec2::new(1.0, 1.0));
    let width = size_or_none(cmd, p, "width")?;
    let height = size_or_none(cmd, p, "height")?;
    let k = match (width, height) {
        (Some(wd), _) => wd / (w * unit.x),
        (None, Some(ht)) => ht / (h * unit.y),
        (None, None) => 1.0,
    };
    if !(k.is_finite() && k > 0.0) {
        return Err(bad(cmd, "`width`/`height` must be positive"));
    }
    let at = point_param(p, "at").unwrap_or(src.insert);
    let rotation = match p.get("rotation") {
        None | Some(Value::Null) => src.rotation,
        Some(v) => match v.as_f64().filter(|x| x.is_finite()) {
            Some(a) => a.to_radians(),
            None => return Err(bad(cmd, "`rotation` must be an angle in degrees")),
        },
    };
    let (sin, cos) = rotation.sin_cos();
    // U runs along the image's bottom (its lower-left corner is the insertion point), V up its
    // left side, as the DXF IMAGE entity defines them.
    let u = Vec2::new(unit.x * k * cos, unit.x * k * sin);
    let v = Vec2::new(-unit.y * k * sin, unit.y * k * cos);
    let clip = match p.get("clip") {
        None | Some(Value::Null) => Vec::new(),
        Some(_) => points_param(p, "clip").ok_or_else(|| bad(cmd, "`clip` must be a list of [x, y] pixel points"))?,
    };
    if !clip.is_empty() && clip.len() < 2 {
        return Err(bad(cmd, "`clip` needs two corners or three or more boundary points"));
    }
    if let Some(layer) = str_param(p, "layer") {
        check_layer(s, cmd, layer)?;
    }
    let name = if src.name.is_empty() { file_name(&src.path) } else { src.name.clone() };
    let image = Image {
        insert: Vec3::new(at.x, at.y, 0.0),
        u: Vec3::new(u.x, u.y, 0.0),
        v: Vec3::new(v.x, v.y, 0.0),
        size: Vec2::new(w, h),
        path: src.path.clone(),
        name,
        clip: clip.clone(),
        clipping: !clip.is_empty(),
        brightness: percent(cmd, p, "brightness", 50)?,
        contrast: percent(cmd, p, "contrast", 50)?,
        fade: percent(cmd, p, "fade", 0)?,
        ..Image::default()
    };
    let handle = s.add_entity(EntityKind::Image(image))?;
    if let Some(layer) = str_param(p, "layer") {
        s.doc_mut()?.modify_entity(handle, |e| e.common.layer = layer.to_string())?;
    }
    Ok(json!({
        "handle": handle.hex(),
        "pixels": [src.pixels.width, src.pixels.height],
        "width": w * unit.x * k,
        "height": h * unit.y * k,
        "unitsPerPixel": unit.x * k,
        "path": src.path,
        "clipped": !clip.is_empty(),
        "onDisk": src.on_disk,
        "message": if src.on_disk {
            format!("Attached {} ({}×{} pixels)", src.path, src.pixels.width, src.pixels.height)
        } else {
            format!("Attached {} ({}×{} pixels); the drawing names it but the pixels came as data", src.path, src.pixels.width, src.pixels.height)
        },
    }))
}

fn run_frame(s: &mut Session, p: &Value) -> Result<Value> {
    let v = match p.get("value") {
        None | Some(Value::Null) => {
            let now = s.doc()?.header.i64("IMAGEFRAME", 1);
            return Ok(json!({ "IMAGEFRAME": now }));
        }
        Some(Value::String(t)) => match t.trim().to_ascii_lowercase().as_str() {
            "on" | "1" => 1,
            "off" | "0" => 0,
            "display" | "d" | "2" => 2,
            _ => return Err(bad("imageframe", "`value` must be 0, 1, 2, \"on\", \"off\" or \"display\"")),
        },
        Some(v) => match v.as_i64() {
            Some(n @ 0..=2) => n,
            _ => return Err(bad("imageframe", "`value` must be 0, 1 or 2")),
        },
    };
    s.doc_mut()?.header.set_i64("IMAGEFRAME", v);
    Ok(json!({ "IMAGEFRAME": v }))
}

fn run_adjust(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "imageadjust";
    let given: Vec<&str> = ["brightness", "contrast", "fade"].into_iter().filter(|k| p.get(*k).is_some_and(|v| !v.is_null())).collect();
    if given.is_empty() {
        return Err(bad(cmd, "give `brightness`, `contrast` or `fade`"));
    }
    let mut set = [0u8; 3];
    for (i, key) in ["brightness", "contrast", "fade"].iter().enumerate() {
        let default = if *key == "fade" { 0 } else { 50 };
        if let Some(v) = set.get_mut(i) {
            *v = percent(cmd, p, key, default)?;
        }
    }
    let hs = targets(s, p)?;
    let mut n = 0usize;
    for h in hs {
        let is_image = s.doc()?.entity(h).is_some_and(|e| matches!(e.kind, EntityKind::Image(_)));
        if !is_image {
            continue;
        }
        s.doc_mut()?.modify_entity(h, |e| {
            if let EntityKind::Image(i) = &mut e.kind {
                if p.get("brightness").is_some_and(|v| !v.is_null()) {
                    i.brightness = set[0];
                }
                if p.get("contrast").is_some_and(|v| !v.is_null()) {
                    i.contrast = set[1];
                }
                if p.get("fade").is_some_and(|v| !v.is_null()) {
                    i.fade = set[2];
                }
            }
        })?;
        n += 1;
    }
    if n == 0 {
        return Err(bad(cmd, "no image in the selection"));
    }
    Ok(json!({ "adjusted": n, "brightness": set[0], "contrast": set[1], "fade": set[2] }))
}

// ---------------------------------------------------------------------------------------------
// IMAGETRACE
// ---------------------------------------------------------------------------------------------

/// What the trace looks for.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Dark,
    Light,
    Alpha,
}

/// A picture to trace: one byte per pixel (its luma, or its alpha in `alpha` mode).
struct Gray {
    w: u32,
    h: u32,
    level: Vec<u8>,
    alpha: Option<Vec<u8>>,
}

fn run_trace(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "imagetrace";
    let src = source(s, p, cmd)?;
    let mode = match str_param(p, "mode").map(|m| m.trim().to_ascii_lowercase()) {
        None => Mode::Dark,
        Some(m) => match m.as_str() {
            "dark" => Mode::Dark,
            "light" => Mode::Light,
            "alpha" => Mode::Alpha,
            _ => return Err(bad(cmd, "`mode` must be dark, light or alpha")),
        },
    };
    let (w, h) = (src.pixels.width, src.pixels.height);
    let down = match p.get("downsample") {
        None | Some(Value::Null) => 1u32,
        Some(v) => match v.as_u64() {
            Some(n @ 1..=16) => n as u32,
            _ => return Err(bad(cmd, "`downsample` must be 1 to 16")),
        },
    };
    let (tw, th) = (w.div_ceil(down), h.div_ceil(down));
    if tw > MAX_TRACE_SIDE || th > MAX_TRACE_SIDE || u64::from(tw) * u64::from(th) > MAX_TRACE_PIXELS {
        return Err(bad(
            cmd,
            format!(
                "the image is {w}×{h} pixels; tracing works up to {MAX_TRACE_SIDE} a side and {MAX_TRACE_PIXELS} pixels (use `downsample`, or a smaller picture)"
            ),
        ));
    }
    let gray = grayscale(&src.pixels, down);
    if mode == Mode::Alpha && gray.alpha.is_none() {
        return Err(bad(cmd, "`mode: alpha` needs an image with transparent pixels (a PNG with alpha)"));
    }
    // Placement: a placed image keeps its own pixels-per-unit and rotation; a path or `data`
    // source is `scale` drawing units per pixel (default 1) at `at` (default 0,0).
    let scale = match p.get("scale") {
        None | Some(Value::Null) => None,
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x > 0.0) {
            Some(k) => Some(k),
            None => return Err(bad(cmd, "`scale` must be a positive number of drawing units per pixel")),
        },
    };
    let unit = match (src.unit, scale) {
        (Some(u), None) => u * f64::from(down),
        (_, Some(k)) => Vec2::new(k, k) * f64::from(down),
        (None, None) => Vec2::new(1.0, 1.0) * f64::from(down),
    };
    let at = point_param(p, "at").unwrap_or(src.insert);
    let (sin, cos) = src.rotation.sin_cos();
    let threshold = match p.get("threshold") {
        // In alpha mode the split is over opacity, so the automatic level must come from the
        // alpha channel, not from the colours.
        None | Some(Value::Null) => match (mode, &gray.alpha) {
            (Mode::Alpha, Some(a)) => otsu(a),
            _ => otsu(&gray.level),
        },
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && (0.0..=255.0).contains(x)) {
            Some(t) => t.round() as u8,
            None => return Err(bad(cmd, "`threshold` must be 0 to 255")),
        },
    };
    let blur = match p.get("blur") {
        None | Some(Value::Null) => 1u32,
        Some(v) => match v.as_u64() {
            Some(n @ 0..=8) => n as u32,
            _ => return Err(bad(cmd, "`blur` must be 0 to 8 pixels")),
        },
    };
    let simplify = match p.get("simplify") {
        // Half a pixel keeps a traced shape's corners; 0 keeps every crossing marching squares
        // found (the exact pixel boundary); higher values smooth a noisy photo more.
        None | Some(Value::Null) => 0.5,
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && (0.0..=64.0).contains(x)) {
            Some(t) => t,
            None => return Err(bad(cmd, "`simplify` must be 0 to 64 pixels")),
        },
    };
    let min_area = match p.get("minArea") {
        None | Some(Value::Null) => 9.0,
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= 0.0) {
            Some(a) => a,
            None => return Err(bad(cmd, "`minArea` must be zero or more square pixels")),
        },
    };
    let holes = bool_or(p, "holes", true);
    let closed = bool_or(p, "closed", true);
    let max_contours = match p.get("maxContours") {
        None | Some(Value::Null) => MAX_TRACE_CONTOURS,
        Some(v) => match v.as_u64() {
            Some(n @ 1..=100_000) => n as usize,
            _ => return Err(bad(cmd, "`maxContours` must be 1 to 100000")),
        },
    };
    let max_points = match p.get("maxPoints") {
        None | Some(Value::Null) => MAX_TRACE_POINTS,
        Some(v) => match v.as_u64() {
            Some(n @ 3..=4_000_000) => n as usize,
            _ => return Err(bad(cmd, "`maxPoints` must be 3 to 4000000")),
        },
    };
    // A little blur removes sensor noise before the threshold; afterwards the levels are read
    // only, so the picture is frozen here.
    let gray = if blur > 0 { Gray { level: box_blur(&gray.level, gray.w, gray.h, blur), ..gray } } else { gray };
    let (contours, mut capped) = trace_contours(&gray, f64::from(threshold), mode, closed, simplify);
    let mut sorted = contours;
    sorted.sort_by(|a, b| b.area.total_cmp(&a.area));
    let (mut small, mut dropped_holes) = (0usize, 0usize);
    let mut kept: Vec<Traced> = Vec::new();
    let mut points = 0usize;
    for c in sorted {
        if c.area < min_area {
            small += 1;
            continue;
        }
        if !holes && c.hole {
            dropped_holes += 1;
            continue;
        }
        if kept.len() >= max_contours || points + c.pts.len() > max_points {
            capped = true;
            break;
        }
        points += c.pts.len();
        kept.push(c);
    }
    // Pixel coordinates → the drawing, through the image's own frame: the insertion point is the
    // picture's lower-left corner, U runs along its bottom and V up its left side, and pixel row
    // 0 is the top — the same mapping the renderer uses, so a trace lands exactly on the picture.
    let map = |q: Vec2| -> Vec2 {
        let u = Vec2::new(unit.x * cos, unit.x * sin);
        let v = Vec2::new(-unit.y * sin, unit.y * cos);
        at + u * q.x + v * (f64::from(th) - q.y)
    };
    let mut bounds = Bounds2::EMPTY;
    let layer = str_param(p, "layer").map(str::to_string);
    if let Some(name) = &layer {
        check_layer(s, cmd, name)?;
    }
    let mut handles: Vec<Handle> = Vec::new();
    for c in &kept {
        let pts: Vec<PolyVertex> = c.pts.iter().map(|q| PolyVertex::new(map(*q))).collect();
        if pts.len() < 2 {
            continue;
        }
        for v in &pts {
            bounds.add(v.p);
        }
        let h = s.add_entity(helpers::lwpoly(pts, closed))?;
        if let Some(name) = &layer {
            s.doc_mut()?.modify_entity(h, |e| e.common.layer = name.clone())?;
        }
        handles.push(h);
    }
    // A traced part can be sized in the same call: scale the fresh polylines about the traced
    // bounds' own corner, so the result lands exactly at the measurement asked for.
    let width = size_or_none(cmd, p, "width")?;
    let height = size_or_none(cmd, p, "height")?;
    let mut scaled_by = None;
    if (width.is_some() || height.is_some()) && !handles.is_empty() && !bounds.is_empty() {
        let fx = width.map(|w| w / bounds.width().max(1e-12));
        let fy = height.map(|h| h / bounds.height().max(1e-12));
        let (fx, fy) = (fx.unwrap_or(fy.unwrap_or(1.0)), fy.unwrap_or(fx.unwrap_or(1.0)));
        if !(fx.is_finite() && fy.is_finite() && fx > 0.0 && fy > 0.0) {
            return Err(bad(cmd, "`width`/`height` must be positive"));
        }
        let m = cadcraft_geom::Mat3::translate(bounds.min)
            .then_before(cadcraft_geom::Mat3::scale(fx, fy))
            .then_before(cadcraft_geom::Mat3::translate(-bounds.min));
        super::modify::transform_entities(s, &handles, &m, false)?;
        scaled_by = Some([fx, fy]);
        // The report follows the geometry that was just written.
        let d = s.doc()?;
        bounds = handles.iter().filter_map(|h| d.entity(*h)).fold(Bounds2::EMPTY, |a, e| a.union(&cadcraft_doc::entity_bounds(d, e, 0)));
    }
    Ok(json!({
        "contours": kept.len(),
        "points": points,
        "polylines": handles.iter().map(|h| h.hex()).collect::<Vec<_>>(),
        "bounds": [[bounds.min.x, bounds.min.y], [bounds.max.x, bounds.max.y]],
        "pixels": [w, h],
        "tracedAt": [tw, th],
        "unitsPerPixel": [unit.x, unit.y],
        "threshold": threshold,
        "scaledBy": scaled_by,
        "skipped": { "small": small, "holes": dropped_holes, "capped": capped },
    }))
}

/// A traced outline in pixel coordinates (image space, y down).
struct Traced {
    pts: Vec<Vec2>,
    /// The enclosed area in square pixels (positive).
    area: f64,
    /// The outline encloses a hole in another one (its winding is opposite).
    hole: bool,
}

/// The picture as one byte per pixel: its luma (Rec. 601), sampled every `down` pixels, plus its
/// alpha when any pixel is not opaque.
fn grayscale(img: &cadcraft_render::ImageData, down: u32) -> Gray {
    let (w, h) = (img.width.div_ceil(down), img.height.div_ceil(down));
    let mut level = vec![0u8; (w as usize) * (h as usize)];
    let mut alpha = vec![0u8; (w as usize) * (h as usize)];
    let mut any_alpha = false;
    for y in 0..h {
        for x in 0..w {
            let sx = (x * down).min(img.width.saturating_sub(1));
            let sy = (y * down).min(img.height.saturating_sub(1));
            let px = img.pixel(sx, sy).unwrap_or([0, 0, 0, 255]);
            let luma = 0.299 * f64::from(px[0]) + 0.587 * f64::from(px[1]) + 0.114 * f64::from(px[2]);
            let i = (y as usize) * (w as usize) + (x as usize);
            level[i] = luma.clamp(0.0, 255.0) as u8;
            alpha[i] = px[3];
            any_alpha |= px[3] != 255;
        }
    }
    Gray { w, h, level, alpha: any_alpha.then_some(alpha) }
}

/// Otsu's threshold: the level that best separates the picture into two classes.
fn otsu(v: &[u8]) -> u8 {
    let mut hist = [0u64; 256];
    for b in v {
        hist[usize::from(*b)] += 1;
    }
    let total: u64 = v.len() as u64;
    if total == 0 {
        return 128;
    }
    let sum: f64 = hist.iter().enumerate().map(|(i, n)| i as f64 * *n as f64).sum();
    let (mut best_var, mut wb, mut sum_b, mut best) = (-1.0f64, 0u64, 0.0f64, 127u8);
    for (t, n) in hist.iter().enumerate() {
        wb += *n;
        if wb == 0 {
            continue;
        }
        let wf = total - wb;
        if wf == 0 {
            break;
        }
        sum_b += t as f64 * *n as f64;
        let mb = sum_b / wb as f64;
        let mf = (sum - sum_b) / wf as f64;
        let var = wb as f64 * wf as f64 * (mb - mf) * (mb - mf);
        if var > best_var {
            best_var = var;
            // The level between the two classes' means: the middle of the valley Otsu found.
            best = ((mb + mf) / 2.0).round().clamp(1.0, 254.0) as u8;
        }
    }
    best
}

/// A separable box blur (two passes), `radius` pixels each way, edges clamped. Denoises a photo
/// before tracing it.
fn box_blur(v: &[u8], w: u32, h: u32, radius: u32) -> Vec<u8> {
    let (w, h) = (w as usize, h as usize);
    if w == 0 || h == 0 || radius == 0 {
        return v.to_vec();
    }
    let r = radius as usize;
    let norm = (2 * r + 1) as u32;
    let mut tmp = vec![0u8; w * h];
    let mut out = vec![0u8; w * h];
    // The window at the start of a row or column covers `r` clamped copies of the first pixel
    // plus the `r + 1` samples from it onwards (a short row clamps again).
    let head = |get: &dyn Fn(usize) -> u32, n: usize| -> u32 { (r as u32 + 1) * get(0) + (1..=r).map(|i| get(i.min(n - 1))).sum::<u32>() };
    for y in 0..h {
        let row = &v[y * w..(y + 1) * w];
        let get = |x: usize| u32::from(row[x]);
        let mut sum: u32 = head(&get, w);
        for x in 0..w {
            tmp[y * w + x] = (sum / norm).min(255) as u8;
            let drop = get(x.saturating_sub(r));
            let add = get((x + r + 1).min(w - 1));
            sum = sum + add - drop;
        }
    }
    for x in 0..w {
        let get = |y: usize| u32::from(tmp[y * w + x]);
        let mut sum: u32 = head(&get, h);
        for y in 0..h {
            out[y * w + x] = (sum / norm).min(255) as u8;
            let drop = get(y.saturating_sub(r));
            let add = get((y + r + 1).min(h - 1));
            sum = sum + add - drop;
        }
    }
    out
}

/// Marching squares over `gray`, interpolating the threshold crossing inside each cell, chained
/// into closed outlines in pixel coordinates. `simplify` is the Douglas–Peucker tolerance in
/// pixels.
fn trace_contours(gray: &Gray, iso: f64, mode: Mode, closed: bool, simplify: f64) -> (Vec<Traced>, bool) {
    let (w, h) = (gray.w as usize, gray.h as usize);
    if w < 2 || h < 2 {
        return (Vec::new(), false);
    }
    // Positive inside the shape being traced: a dark picture's dark pixels, a light one's light
    // pixels, or (alpha mode) its opaque pixels.
    let inside = |x: usize, y: usize| -> f64 {
        match mode {
            Mode::Alpha => f64::from(gray.alpha.as_ref().map(|a| a[y * w + x]).unwrap_or(255)) - iso,
            Mode::Dark => iso - f64::from(gray.level[y * w + x]) + LEVEL_BIAS,
            Mode::Light => f64::from(gray.level[y * w + x]) - iso + LEVEL_BIAS,
        }
    };
    const MAX_SEGMENTS: usize = 6_000_000;
    let mut segments: Vec<(Vec2, Vec2)> = Vec::new();
    let mut capped = false;
    for y in 0..h - 1 {
        for x in 0..w - 1 {
            let (a, b, c, d) = (inside(x, y), inside(x + 1, y), inside(x + 1, y + 1), inside(x, y + 1));
            let code = u8::from(a > 0.0) | (u8::from(b > 0.0) << 1) | (u8::from(c > 0.0) << 2) | (u8::from(d > 0.0) << 3);
            if code == 0 || code == 15 {
                continue;
            }
            // Where the crossing sits between two samples.
            let t = |p: f64, q: f64| -> f64 {
                let d = p - q;
                if d.abs() < 1e-12 { 0.5 } else { (p / d).clamp(0.0, 1.0) }
            };
            let (fx, fy) = (x as f64, y as f64);
            let top = Vec2::new(fx + t(a, b), fy);
            let right = Vec2::new(fx + 1.0, fy + t(b, c));
            let bottom = Vec2::new(fx + t(d, c), fy + 1.0);
            let left = Vec2::new(fx, fy + t(a, d));
            // Each segment runs so the inside of the shape stays on one side of it; the
            // complementary codes (the same crossings with the corners swapped) run the other
            // way, which is what lets the chain close and its winding mean "hole".
            match code {
                1 => segments.push((left, top)),
                14 => segments.push((top, left)),
                2 => segments.push((top, right)),
                13 => segments.push((right, top)),
                3 => segments.push((left, right)),
                12 => segments.push((right, left)),
                4 => segments.push((right, bottom)),
                11 => segments.push((bottom, right)),
                6 => segments.push((top, bottom)),
                9 => segments.push((bottom, top)),
                7 => segments.push((left, bottom)),
                8 => segments.push((bottom, left)),
                // 5 and 10 are the saddle cases: two crossings each way.
                5 => {
                    segments.push((left, top));
                    segments.push((right, bottom));
                }
                10 => {
                    segments.push((top, right));
                    segments.push((bottom, left));
                }
                _ => {}
            }
            if segments.len() > MAX_SEGMENTS {
                capped = true;
                break;
            }
        }
        if capped {
            break;
        }
    }
    (chain(segments, closed, simplify), capped)
}

/// Chain segments into outlines: joined at quantized endpoints, so sub-pixel crossings still meet.
fn chain(segments: Vec<(Vec2, Vec2)>, closed: bool, simplify: f64) -> Vec<Traced> {
    let key = |p: Vec2| ((p.x * CHAIN_QUANT).round() as i64, (p.y * CHAIN_QUANT).round() as i64);
    let mut ends: std::collections::HashMap<(i64, i64), Vec<usize>> = std::collections::HashMap::new();
    for (i, (a, b)) in segments.iter().enumerate() {
        ends.entry(key(*a)).or_default().push(i);
        if key(*a) != key(*b) {
            ends.entry(key(*b)).or_default().push(i);
        }
    }
    let mut used = vec![false; segments.len()];
    let mut out = Vec::new();
    for start in 0..segments.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let first = segments[start].0;
        let mut pts = vec![first, segments[start].1];
        while let Some(last) = pts.last().copied() {
            let Some(cands) = ends.get(&key(last)) else { break };
            let mut step = None;
            for i in cands {
                if used[*i] {
                    continue;
                }
                let (a, b) = segments[*i];
                if key(a) == key(last) {
                    step = Some((*i, b));
                } else if key(b) == key(last) {
                    step = Some((*i, a));
                } else {
                    continue;
                }
                break;
            }
            let Some((i, to)) = step else { break };
            used[i] = true;
            if key(to) == key(first) && pts.len() >= 3 {
                break;
            }
            pts.push(to);
        }
        if pts.len() < 4 {
            continue;
        }
        let simplified = simplify_ring(&pts, simplify);
        if simplified.len() < 3 {
            continue;
        }
        let area = cadcraft_geom::shoelace(&simplified).abs();
        // In pixel coordinates (y down) the outline of a region runs clockwise and the outline
        // of a hole in it runs anticlockwise, so a positive shoelace is a hole.
        let hole = cadcraft_geom::shoelace(&simplified) > 0.0;
        let mut pts = simplified;
        if closed
            && let (Some(a), Some(b)) = (pts.first().copied(), pts.last().copied())
            && a.near(b, 1e-9)
        {
            pts.pop();
        }
        out.push(Traced { pts, area, hole });
    }
    out
}

/// Douglas–Peucker on a closed outline, keeping its shape within `tol` pixels.
fn simplify_ring(pts: &[Vec2], tol: f64) -> Vec<Vec2> {
    let n = pts.len();
    if n < 4 || tol <= 0.0 {
        return pts.to_vec();
    }
    // Split the ring at a point far from the first one, so both halves are open polylines.
    let mut far = (0usize, 0.0f64);
    for (i, p) in pts.iter().enumerate().skip(1) {
        let d = p.dist(pts[0]);
        if d > far.1 {
            far = (i, d);
        }
    }
    let (split, _) = far;
    if split == 0 {
        return pts.to_vec();
    }
    // Two open halves: the ring's start to the split point, and the split point back around to
    // the ring's start.
    let mut a: Vec<Vec2> = pts.iter().take(split + 1).copied().collect();
    let mut b: Vec<Vec2> = pts.iter().skip(split).copied().chain(pts.first().copied()).collect();
    simplify_open(&mut a, tol);
    simplify_open(&mut b, tol);
    // Join them: `a` ends at the split point, `b` starts there and ends at the ring's first
    // point (which is also `a`'s first, so the last point of the joined ring repeats it).
    let mut out = a;
    out.extend(b.into_iter().skip(1));
    out.pop();
    out
}

/// Douglas–Peucker over an open polyline, in place.
fn simplify_open(pts: &mut Vec<Vec2>, tol: f64) {
    if pts.len() < 3 {
        return;
    }
    let keep = simplify_marks(pts, tol);
    let mut i = 0usize;
    pts.retain(|_| {
        let k = keep.get(i).copied().unwrap_or(false);
        i += 1;
        k
    });
}

/// Which points a Douglas–Peucker pass keeps (the ends always).
fn simplify_marks(pts: &[Vec2], tol: f64) -> Vec<bool> {
    let mut keep = vec![false; pts.len()];
    if pts.len() < 3 {
        keep.iter_mut().for_each(|k| *k = true);
        return keep;
    }
    if let Some(last) = keep.len().checked_sub(1) {
        if let Some(first) = keep.first_mut() {
            *first = true;
        }
        if let Some(entry) = keep.get_mut(last) {
            *entry = true;
        }
    }
    let mut stack = vec![(0usize, pts.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (p, q) = (pts[a], pts[b]);
        let dir = q - p;
        let len = dir.len();
        let mut worst = (0usize, 0.0f64);
        for (k, pt) in pts.iter().enumerate().take(b).skip(a + 1) {
            let d = if len < 1e-12 { pt.dist(p) } else { ((dir.x * (pt.y - p.y) - dir.y * (pt.x - p.x)) / len).abs() };
            if d > worst.1 {
                worst = (k, d);
            }
        }
        if worst.1 > tol {
            if let Some(k) = keep.get_mut(worst.0) {
                *k = true;
            }
            stack.push((a, worst.0));
            stack.push((worst.0, b));
        }
    }
    keep
}

#[cfg(test)]
#[path = "image_tests.rs"]
mod tests;
