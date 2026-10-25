//! IMAGEATTACH, IMAGETRACE, IMAGEFRAME, IMAGEADJUST, DESCRIBE and SCALE-by-size.

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::Vec2;
use serde_json::{Value, json};

use crate::Session;

/// Write a PNG of `w`×`h` pixels to a temporary file: `f(x, y)` gives the RGBA of each pixel.
/// (A tiny-skia pixmap, so the file is a real PNG the image loader can read.)
fn png(name: &str, w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> String {
    let mut pm = tiny_skia::Pixmap::new(w, h).unwrap();
    for y in 0..h {
        for x in 0..w {
            let p = f(x, y);
            pm.pixels_mut()[(y * w + x) as usize] = tiny_skia::ColorU8::from_rgba(p[0], p[1], p[2], p[3]).premultiply();
        }
    }
    let dir = std::env::temp_dir().join("cadcraft-engine-image-tests");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(name);
    pm.save_png(&path).unwrap();
    path.to_string_lossy().to_string()
}

/// A white picture with a black square from (x0, y0) to (x1, y1) (exclusive).
fn square_png(name: &str, w: u32, h: u32, x0: u32, y0: u32, x1: u32, y1: u32) -> String {
    png(name, w, h, |x, y| if x >= x0 && x < x1 && y >= y0 && y < y1 { [0, 0, 0, 255] } else { [255, 255, 255, 255] })
}

fn kind(s: &Session, h: &str) -> EntityKind {
    s.doc().unwrap().entity(Handle::parse_hex(h).unwrap()).unwrap().kind.clone()
}

fn handle_of(r: &Value) -> String {
    r["handle"].as_str().or_else(|| r["handles"][0].as_str()).or_else(|| r["polylines"][0].as_str()).unwrap().to_string()
}

// ---------------- IMAGEATTACH ----------------

#[test]
fn imageattach_places_a_file_at_its_pixel_size() {
    let path = square_png("attach.png", 20, 10, 5, 2, 15, 8);
    let mut s = Session::new();
    let r = s.execute("imageattach", &json!({"path": path})).unwrap();
    assert_eq!(r["pixels"], json!([20, 10]));
    assert_eq!(r["width"], json!(20.0), "1 unit per pixel by default");
    assert_eq!(r["height"], json!(10.0));
    let EntityKind::Image(i) = kind(&s, &handle_of(&r)) else { panic!("not an image") };
    assert_eq!(i.path, path);
    assert!(i.insert.xy().near(Vec2::ZERO, 1e-9));
    assert!(i.u.xy().near(Vec2::new(1.0, 0.0), 1e-9), "u runs along +x at 1 unit per pixel");
    assert!(i.v.xy().near(Vec2::new(0.0, 1.0), 1e-9));
    assert_eq!(i.brightness, 50);
    assert!(!i.clipping);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imageattach_sizes_and_rotates_the_picture() {
    let path = square_png("sized.png", 40, 20, 0, 0, 40, 20);
    let mut s = Session::new();
    let r = s.execute("imageattach", &json!({"path": path, "at": [5, 7], "width": 100.0, "rotation": 90.0})).unwrap();
    assert_eq!(r["width"], json!(100.0));
    assert_eq!(r["height"], json!(50.0), "the shape is kept when only the width is given");
    assert_eq!(r["unitsPerPixel"], json!(2.5));
    let EntityKind::Image(i) = kind(&s, &handle_of(&r)) else { panic!("not an image") };
    assert!(i.insert.xy().near(Vec2::new(5.0, 7.0), 1e-9));
    // Rotated a quarter turn: u points along +y, v along -x, both at 2.5 units per pixel.
    assert!(i.u.xy().near(Vec2::new(0.0, 2.5), 1e-9), "u = {:?}", i.u);
    assert!(i.v.xy().near(Vec2::new(-2.5, 0.0), 1e-9), "v = {:?}", i.v);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imageattach_takes_base64_data_and_clips() {
    let path = square_png("data.png", 8, 8, 0, 0, 4, 8);
    let bytes = std::fs::read(&path).unwrap();
    let mut s = Session::new();
    let r =
        s.execute("imageattach", &json!({"data": crate::cmd::file::base64_encode(&bytes), "name": "half.png", "clip": [[0, 0], [4, 8]]})).unwrap();
    let EntityKind::Image(i) = kind(&s, &handle_of(&r)) else { panic!("not an image") };
    assert!(i.clipping, "a clip boundary turns clipping on");
    assert_eq!(i.clip.len(), 2);
    assert!(!r["onDisk"].as_bool().unwrap(), "the pixels came as data");
    // A bad clip, a bad image and a bad layer are errors, not silent defaults.
    assert!(s.execute("imageattach", &json!({"path": path, "clip": [[0, 0]]})).is_err());
    assert!(s.execute("imageattach", &json!({"data": "not base64"})).is_err());
    assert!(s.execute("imageattach", &json!({"path": path, "layer": "Nope"})).is_err());
    assert!(s.execute("imageattach", &json!({"path": path, "brightness": 200})).is_err());
    let _ = std::fs::remove_file(&path);
}

// ---------------- IMAGETRACE ----------------

#[test]
fn imagetrace_finds_a_square() {
    let path = square_png("trace-square.png", 32, 32, 8, 8, 24, 24);
    let mut s = Session::new();
    let r = s.execute("imagetrace", &json!({"path": path})).unwrap();
    assert_eq!(r["contours"], json!(1), "{r}");
    let b = r["bounds"].as_array().unwrap();
    let min: Vec<f64> = b[0].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let max: Vec<f64> = b[1].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    // The picture is placed with its lower-left corner at the insertion point, so the square at
    // pixels x 8..24, y 8..24 of 32 comes out at x 8..24, y 8..24 in the drawing.
    assert!((min[0] - 8.0).abs() < 0.75, "left edge {min:?}");
    assert!((max[0] - 24.0).abs() < 0.75, "right edge {max:?}");
    assert!((min[1] - 8.0).abs() < 0.75, "bottom edge {min:?}");
    assert!((max[1] - 24.0).abs() < 0.75, "top edge {max:?}");
    // One closed polyline with four corners (the simplifier removes the collinear points).
    let h = handle_of(&r);
    let EntityKind::LwPolyline(pl) = kind(&s, &h) else { panic!("not a polyline") };
    assert!(pl.closed);
    assert!((4..=8).contains(&pl.vertices.len()), "a square simplifies to its corners: {}", pl.vertices.len());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imagetrace_sizes_the_result_in_the_same_call() {
    let path = square_png("trace-size.png", 32, 32, 8, 8, 24, 24);
    let mut s = Session::new();
    let r = s.execute("imagetrace", &json!({"path": path, "width": 40.0, "at": [100.0, 100.0]})).unwrap();
    let b = r["bounds"].as_array().unwrap();
    let min: Vec<f64> = b[0].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let max: Vec<f64> = b[1].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert!((max[0] - min[0] - 40.0).abs() < 1e-6, "sized to 40 wide: {b:?}");
    assert!((max[1] - min[1] - 40.0).abs() < 1e-6, "and 40 tall (square): {b:?}");
    assert!(
        (min[0] - 107.488).abs() < 0.6,
        "scaled about its own lower-left corner (the placement at 100,100 plus the trace's own 7.488 offset): {b:?}"
    );
    assert!((min[1] - 108.488).abs() < 0.6, "the trace sits above the insertion point, as the image frame puts it: {b:?}");
    // The geometry itself moved with the bounds, not just the report.
    let EntityKind::LwPolyline(pl) = kind(&s, &handle_of(&r)) else { panic!("not a polyline") };
    let xs: Vec<f64> = pl.vertices.iter().map(|v| v.p.x).collect();
    assert!((xs.iter().cloned().fold(f64::INFINITY, f64::min) - min[0]).abs() < 1e-6, "{xs:?}");
    assert!((xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - max[0]).abs() < 1e-6, "{xs:?}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imagetrace_modes_and_filters() {
    // Two black squares on white: a big one and a 2×2 speck.
    let path = png("trace-modes.png", 32, 32, |x, y| {
        let big = (4..20).contains(&x) && (4..20).contains(&y);
        let speck = (26..28).contains(&x) && (26..28).contains(&y);
        if big || speck { [0, 0, 0, 255] } else { [255, 255, 255, 255] }
    });
    let mut s = Session::new();
    let r = s.execute("imagetrace", &json!({"path": path, "minArea": 0.0, "blur": 0})).unwrap();
    assert_eq!(r["contours"], json!(2), "both regions: {r}");
    let r = s.execute("imagetrace", &json!({"path": path, "minArea": 9.0, "blur": 0})).unwrap();
    assert_eq!(r["contours"], json!(1), "the speck is dropped by minArea: {r}");
    assert_eq!(r["skipped"]["small"], json!(1));
    // Light mode traces the light region instead: on a black picture with a white square, that
    // is the square.
    let light =
        png("trace-light.png", 32, 32, |x, y| if (6..26).contains(&x) && (6..26).contains(&y) { [255, 255, 255, 255] } else { [0, 0, 0, 255] });
    let r = s.execute("imagetrace", &json!({"path": light, "mode": "light"})).unwrap();
    assert_eq!(r["contours"], json!(1), "{r}");
    let b = r["bounds"].as_array().unwrap();
    let min: Vec<f64> = b[0].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let max: Vec<f64> = b[1].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert!((min[0] - 6.0).abs() < 0.75 && (max[0] - 26.0).abs() < 0.75, "the white square: {b:?}");
    let _ = std::fs::remove_file(&light);
    // A bad mode is refused.
    assert!(s.execute("imagetrace", &json!({"path": path, "mode": "blue"})).is_err());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imagetrace_alpha_mode_needs_transparency() {
    let opaque = square_png("trace-opaque.png", 16, 16, 4, 4, 12, 12);
    let mut s = Session::new();
    let e = s.execute("imagetrace", &json!({"path": opaque, "mode": "alpha"})).unwrap_err().to_string();
    assert!(e.contains("transparent"), "{e}");
    // A picture with a transparent border and an opaque middle traces the opaque part.
    let path = png("trace-alpha.png", 16, 16, |x, y| if (4..12).contains(&x) && (4..12).contains(&y) { [200, 0, 0, 255] } else { [0, 0, 0, 0] });
    let r = s.execute("imagetrace", &json!({"path": path, "mode": "alpha", "blur": 0})).unwrap();
    assert_eq!(r["contours"], json!(1), "{r}");
    let b = r["bounds"].as_array().unwrap();
    let min: Vec<f64> = b[0].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let max: Vec<f64> = b[1].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert!((min[0] - 4.0).abs() < 0.75 && (max[0] - 12.0).abs() < 0.75, "{b:?}");
    let _ = std::fs::remove_file(&opaque);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imagetrace_from_a_placed_image_keeps_its_scale_and_rotation() {
    let path = square_png("trace-placed.png", 16, 16, 4, 4, 12, 12);
    let mut s = Session::new();
    // Placed at 10 units per pixel, so the 8-pixel square is 80 units across.
    let img = s.execute("imageattach", &json!({"path": path, "at": [100.0, 0.0], "width": 160.0})).unwrap();
    let h = handle_of(&img);
    let r = s.execute("imagetrace", &json!({"handle": h})).unwrap();
    assert_eq!(r["unitsPerPixel"], json!([10.0, 10.0]), "{r}");
    let b = r["bounds"].as_array().unwrap();
    let min: Vec<f64> = b[0].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let max: Vec<f64> = b[1].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert!((max[0] - min[0] - 80.0).abs() < 1.0, "80 units across (8 pixels × 10 units): {b:?}");
    assert!(min[0] > 130.0 && min[0] < 145.0, "the square sits 4 pixels in from the image's left edge: {b:?}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imagetrace_holes_can_be_kept_or_dropped() {
    // A black ring: an outer square with a white hole.
    let path = png("trace-ring.png", 32, 32, |x, y| {
        let outer = (4..28).contains(&x) && (4..28).contains(&y);
        let hole = (12..20).contains(&x) && (12..20).contains(&y);
        if outer && !hole { [0, 0, 0, 255] } else { [255, 255, 255, 255] }
    });
    let mut s = Session::new();
    let r = s.execute("imagetrace", &json!({"path": path})).unwrap();
    assert_eq!(r["contours"], json!(2), "the ring and its hole: {r}");
    let r = s.execute("imagetrace", &json!({"path": path, "holes": false})).unwrap();
    assert_eq!(r["contours"], json!(1), "the hole is dropped: {r}");
    assert_eq!(r["skipped"]["holes"], json!(1));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn imagetrace_downsample_and_bad_params() {
    let path = square_png("trace-down.png", 64, 64, 16, 16, 48, 48);
    let mut s = Session::new();
    let r = s.execute("imagetrace", &json!({"path": path, "downsample": 4})).unwrap();
    assert_eq!(r["tracedAt"], json!([16, 16]), "{r}");
    assert_eq!(r["unitsPerPixel"], json!([4.0, 4.0]), "a downsampled pixel is 4 units: {r}");
    let b = r["bounds"].as_array().unwrap();
    let min: Vec<f64> = b[0].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let max: Vec<f64> = b[1].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    assert!((max[0] - min[0] - 32.0).abs() < 1.0, "8 traced pixels × 4 units: {b:?}");
    for bad in [
        json!({"path": path, "downsample": 0}),
        json!({"path": path, "threshold": 300}),
        json!({"path": path, "blur": 99}),
        json!({"path": path, "minArea": -1}),
        json!({"path": path, "scale": 0}),
        json!({"path": path, "width": -5}),
    ] {
        assert!(s.execute("imagetrace", &bad).is_err(), "{bad} should be refused");
    }
    let _ = std::fs::remove_file(&path);
}

// ---------------- IMAGEFRAME / IMAGEADJUST ----------------

#[test]
fn imageframe_and_imageadjust_change_the_settings() {
    let path = square_png("adjust.png", 8, 8, 2, 2, 6, 6);
    let mut s = Session::new();
    assert_eq!(s.execute("imageframe", &json!({})).unwrap()["IMAGEFRAME"], json!(1));
    assert_eq!(s.execute("imageframe", &json!({"value": "off"})).unwrap()["IMAGEFRAME"], json!(0));
    assert_eq!(s.execute("imageframe", &json!({"value": 2})).unwrap()["IMAGEFRAME"], json!(2));
    assert!(s.execute("imageframe", &json!({"value": 7})).is_err());

    let img = s.execute("imageattach", &json!({"path": path})).unwrap();
    let h = handle_of(&img);
    let r = s.execute("imageadjust", &json!({"handle": h, "fade": 40, "contrast": 80})).unwrap();
    assert_eq!(r["adjusted"], json!(1));
    let EntityKind::Image(i) = kind(&s, &h) else { panic!("not an image") };
    assert_eq!((i.fade, i.contrast, i.brightness), (40, 80, 50), "only what was given changed");
    assert!(s.execute("imageadjust", &json!({"handle": h})).is_err(), "nothing to change is an error");
    let _ = std::fs::remove_file(&path);
}

// ---------------- SCALE by size ----------------

#[test]
fn scale_can_size_a_selection_to_a_measurement() {
    let mut s = Session::new();
    let r = s.execute("rectang", &json!({"p1": [0, 0], "p2": [10, 5]})).unwrap();
    let h = handle_of(&r);
    // One factor per axis: 10 wide → 40, 5 tall → 20.
    let r = s.execute("scale", &json!({"handle": h, "width": 40.0, "height": 20.0})).unwrap();
    assert_eq!(r["width"], json!(40.0), "{r}");
    assert_eq!(r["height"], json!(20.0), "{r}");
    // The corner the base defaults to is the selection's own lower-left: (0,0) stays put.
    assert_eq!(r["bounds"][0], json!([0.0, 0.0]));
    // Width alone keeps the shape.
    let r = s.execute("scale", &json!({"handle": h, "width": 20.0})).unwrap();
    assert_eq!(r["width"], json!(20.0));
    assert_eq!(r["height"], json!(10.0));
    // `factor` and `width` together is a contradiction.
    assert!(s.execute("scale", &json!({"handle": h, "factor": 2.0, "width": 5.0})).is_err());
    // `base` is still required for a plain factor.
    assert!(s.execute("scale", &json!({"handle": h, "factor": 2.0})).is_err());
}

// ---------------- DESCRIBE ----------------

#[test]
fn describe_reports_measures_and_a_narrative() {
    let mut s = Session::new();
    s.execute("line", &json!({"points": [[0, 0], [10, 0]]})).unwrap();
    s.execute("line", &json!({"points": [[10, 0], [10, 10]]})).unwrap();
    s.execute("circle", &json!({"center": [20, 20], "radius": 5.0})).unwrap();
    s.execute("pline", &json!({"vertices": [[0, 0], [5, 0], [5, 5], [0, 5]], "closed": true})).unwrap();
    s.execute("text", &json!({"at": [1, 1], "text": "Wing panel", "height": 1.0})).unwrap();
    let r = s.execute("describe", &json!({})).unwrap();
    assert_eq!(r["total"], json!(5), "{r}");
    assert_eq!(r["counts"]["Line"], json!(2));
    assert_eq!(r["counts"]["Circle"], json!(1));
    assert_eq!(r["counts"]["Polyline"], json!(1));
    assert_eq!(r["counts"]["Text"], json!(1));
    // Lengths: the two lines are 20, the circle's circumference is 10π, the square's 20.
    let len = r["geometry"]["totalLength"].as_f64().unwrap();
    let want = 20.0 + std::f64::consts::TAU * 5.0 + 20.0;
    assert!((len - want).abs() < 1e-6, "total length {len} vs {want}");
    assert_eq!(r["geometry"]["closed"]["count"], json!(2), "the circle and the closed square: {r}");
    let area = r["geometry"]["closed"]["area"].as_f64().unwrap();
    let want_area = 25.0 * std::f64::consts::PI + 25.0;
    assert!((area - want_area).abs() < 1e-6, "closed area {area} vs {want_area}");
    assert_eq!(r["geometry"]["open"]["contours"], json!(0), "no open contours: {r}");
    // Extents span the circle at x 15..25 and y -10..10.
    let ext = r["extents"].as_array().unwrap();
    assert_eq!(ext[0], json!([0.0, 0.0]), "the circle at (20,20) r5 reaches 15..25: {r}");
    assert_eq!(ext[1], json!([25.0, 25.0]), "{r}");
    assert_eq!(r["size"], json!([25.0, 25.0]));
    assert_eq!(r["center"], json!([12.5, 12.5]));
    assert_eq!(r["texts"]["count"], json!(1));
    assert_eq!(r["texts"]["items"][0]["text"], json!("Wing panel"));
    // The narrative names the scope, the size and the measurements.
    let msg = r["message"].as_str().unwrap();
    assert!(msg.contains("5 object(s)"), "{msg}");
    assert!(msg.contains("Wing panel"), "{msg}");
    assert!(msg.contains("closed"), "{msg}");
    // Layers in use are listed with their object counts.
    let layers = r["layers"].as_array().unwrap();
    assert_eq!(layers.len(), 1, "{layers:?}");
    assert_eq!(layers[0]["objects"], json!(5));
}

#[test]
fn describe_notes_open_contours_and_degenerate_objects() {
    let mut s = Session::new();
    s.execute("pline", &json!({"vertices": [[0, 0], [10, 0], [10, 10]], "closed": false})).unwrap();
    // A zero-length line: LINE refuses two equal points, so collapse one that exists.
    let r = s.execute("line", &json!({"points": [[3, 3], [9, 9]]})).unwrap();
    let h = cadcraft_doc::Handle::parse_hex(&handle_of(&r)).unwrap();
    s.doc_mut()
        .unwrap()
        .modify_entity(h, |e| {
            if let EntityKind::Line(l) = &mut e.kind {
                l.b = l.a;
            }
        })
        .unwrap();
    let r = s.execute("describe", &json!({})).unwrap();
    assert_eq!(r["geometry"]["open"]["contours"], json!(1), "{r}");
    assert_eq!(r["geometry"]["open"]["length"], json!(20.0), "{r}");
    assert_eq!(r["degenerate"].as_array().unwrap().len(), 1, "the zero-length line: {r}");
    let notes = r["notes"].as_array().unwrap();
    assert!(notes.iter().any(|n| n.as_str().unwrap().contains("open contour")), "{notes:?}");
    assert!(notes.iter().any(|n| n.as_str().unwrap().contains("degenerate")), "{notes:?}");
    assert!(notes.iter().any(|n| n.as_str().unwrap().contains("no closed shape")), "{notes:?}");
}

#[test]
fn describe_scopes_to_a_selection_and_to_a_window() {
    let mut s = Session::new();
    let a = s.execute("line", &json!({"points": [[0, 0], [10, 0]]})).unwrap();
    s.execute("line", &json!({"points": [[100, 0], [110, 0]]})).unwrap();
    let ha = handle_of(&a);
    let r = s.execute("describe", &json!({"handle": ha})).unwrap();
    assert_eq!(r["total"], json!(1), "{r}");
    assert_eq!(r["scope"], json!("the selection"));
    assert_eq!(r["objects"].as_array().unwrap().len(), 1, "a selection always details its objects");
    assert_eq!(r["objects"][0]["length"], json!(10.0));
    let r = s.execute("describe", &json!({"window": [[-1, -1], [20, 20]]})).unwrap();
    assert_eq!(r["total"], json!(1), "only the first line is in the window: {r}");
    let r = s.execute("describe", &json!({"space": "all"})).unwrap();
    assert_eq!(r["total"], json!(2), "{r}");
    assert!(s.execute("describe", &json!({"space": "Nowhere"})).is_err());
    assert!(s.execute("describe", &json!({"window": [[0, 0]]})).is_err());
}

#[test]
fn describe_finds_gaps_in_loose_lines() {
    let mut s = Session::new();
    // Three sides of a square: the fourth is missing, leaving a 2-unit gap.
    s.execute("line", &json!({"points": [[0, 0], [10, 0]]})).unwrap();
    s.execute("line", &json!({"points": [[10, 0], [10, 10]]})).unwrap();
    s.execute("line", &json!({"points": [[10, 10], [0, 8]]})).unwrap();
    let r = s.execute("describe", &json!({"loops": true})).unwrap();
    let g = &r["gaps"];
    assert_eq!(g["openChains"], json!(1), "{r}");
    assert_eq!(g["closedChains"], json!(0), "{r}");
    assert!((g["largestGap"].as_f64().unwrap() - 8.0).abs() < 0.01, "the gap from (0,8) to (0,0): {r}");
    assert!(r["notes"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("loose chain")), "{r}");
    // A closed loop reports no gaps.
    s.execute("line", &json!({"points": [[0, 8], [0, 0]]})).unwrap();
    let r = s.execute("describe", &json!({"loops": true})).unwrap();
    assert_eq!(r["gaps"]["closedChains"], json!(1), "{r}");
    assert_eq!(r["gaps"]["openChains"], json!(0), "{r}");
}

#[test]
fn describe_reports_images_and_blocks() {
    let path = square_png("described.png", 24, 12, 4, 4, 20, 8);
    let mut s = Session::new();
    s.execute("imageattach", &json!({"path": path, "width": 24.0})).unwrap();
    let r = s.execute("rectang", &json!({"p1": [0, 0], "p2": [4, 4]})).unwrap();
    s.execute("block", &json!({"name": "Wing", "base": [0, 0], "handles": [handle_of(&r)]})).unwrap();
    let r = s.execute("describe", &json!({})).unwrap();
    assert_eq!(r["images"]["count"], json!(1), "{r}");
    let img = &r["images"]["items"][0];
    assert_eq!(img["pixels"], json!([24, 12]), "the file is read for its pixel size: {img}");
    assert_eq!(img["size"], json!([24.0, 12.0]), "{img}");
    assert_eq!(img["unitsPerPixel"], json!([1.0, 1.0]), "{img}");
    assert!(r["notes"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("raster reference")), "{r}");
    assert_eq!(r["blocks"]["Wing"], json!(1), "the block reference is counted by name: {r}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn describe_of_an_empty_drawing_says_so() {
    let mut s = Session::new();
    let r = s.execute("describe", &json!({})).unwrap();
    assert_eq!(r["total"], json!(0));
    assert!(r["message"].as_str().unwrap().contains("empty"), "{r}");
    assert_eq!(r["extents"], Value::Null);
}

#[test]
fn describe_sees_through_to_paper_space() {
    let mut s = Session::new();
    s.execute("line", &json!({"points": [[0, 0], [5, 0]]})).unwrap();
    s.execute("layout.new", &json!({"name": "Sheet1"})).unwrap();
    s.execute("layout.set", &json!({"name": "Sheet1"})).unwrap();
    s.execute("line", &json!({"points": [[0, 0], [2, 0]]})).unwrap();
    let r = s.execute("describe", &json!({})).unwrap();
    assert_eq!(r["scope"], json!("layout Sheet1"));
    assert_eq!(r["counts"]["Line"], json!(1), "the line drawn in the layout: {r}");
    assert_eq!(r["counts"]["Viewport"], json!(1), "a new layout starts with its own viewport: {r}");
    let r = s.execute("describe", &json!({"space": "all"})).unwrap();
    assert_eq!(r["counts"]["Line"], json!(2), "model space and the layout: {r}");
    let r = s.execute("describe", &json!({"space": "model"})).unwrap();
    assert_eq!(r["total"], json!(1), "{r}");
}

#[test]
fn an_image_is_picked_anywhere_inside_its_quad() {
    let path = square_png("pick.png", 8, 8, 0, 0, 8, 8);
    let mut s = Session::new();
    let r = s.execute("imageattach", &json!({"path": path, "at": [10, 10], "width": 20.0})).unwrap();
    let h = handle_of(&r);
    // Inside the quad (10,10)..(30,30): a click in the middle selects it.
    let r = s.execute("select", &json!({"at": [20.0, 20.0]})).unwrap();
    assert_eq!(r["handles"], json!([h.clone()]), "the middle of the picture: {r}");
    // Outside it, nothing is selected.
    let r = s.execute("select", &json!({"at": [50.0, 50.0]})).unwrap();
    assert_eq!(r["selected"], json!(0), "beside the picture: {r}");
    // A rotated picture's quad is turned with it: the corner it vacates no longer selects it.
    s.execute("imageattach", &json!({"path": path, "at": [100, 100], "width": 20.0, "rotation": 45.0})).unwrap();
    let r = s.execute("select", &json!({"at": [100.0, 100.0]})).unwrap();
    assert_eq!(r["selected"], json!(1), "the rotated picture's insertion corner is inside it: {r}");
    let _ = std::fs::remove_file(&path);
}

/// The internal helpers: a box blur must leave a uniform picture alone (edge clamping) and Otsu
/// must split a two-tone picture between its tones.
#[test]
fn blur_and_otsu_behave() {
    use super::{box_blur, otsu};

    let flat = vec![120u8; 7 * 5];
    let blurred = box_blur(&flat, 7, 5, 3);
    assert_eq!(blurred, flat, "a uniform picture blurs to itself");

    // A step edge blurs to a ramp across the window's width, with the far ends untouched.
    let v: Vec<u8> = (0..9).map(|i| if i >= 5 { 200 } else { 0 }).collect();
    let b = box_blur(&v, 9, 1, 1);
    assert_eq!((b[0], b[8]), (0, 200), "the ends keep their own value: {b:?}");
    assert!(b.windows(2).all(|w| w[0] <= w[1]), "the ramp only rises: {b:?}");
    assert!(b[3] == 0 && b[6] == 200, "a pixel a full window away is untouched: {b:?}");

    let two_tone: Vec<u8> = (0..100).map(|i| if i < 40 { 30 } else { 210 }).collect();
    let t = otsu(&two_tone);
    assert!((31..=209).contains(&t), "the threshold sits between the tones: {t}");
    // A pure black-and-white picture keeps a usable threshold off the rails (never 0 or 255).
    let bw: Vec<u8> = (0..100).map(|i| if i % 2 == 0 { 0 } else { 255 }).collect();
    let t = otsu(&bw);
    assert!((1..=254).contains(&t), "clamped into 1..=254: {t}");
}
