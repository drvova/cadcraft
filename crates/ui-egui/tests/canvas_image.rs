//! A raster image attached to the drawing reaches the canvas: its pixels are painted as a
//! textured mesh (the CPU path), and its quad is selectable and highlighted.

use cadcraft_engine::Session;
use cadcraft_engine::geom::Vec2;
use cadcraft_ui_egui::{CadApp, Services, theme};
use egui::{Context, Pos2, Rect, Shape, pos2, vec2};
use serde_json::json;

/// A PNG on disk: `w`×`h` filled with `rgba`.
fn write_png(path: &std::path::Path, w: u32, h: u32, rgba: [u8; 4]) {
    let mut pm = tiny_skia::Pixmap::new(w, h).unwrap();
    for p in pm.pixels_mut() {
        *p = tiny_skia::ColorU8::from_rgba(rgba[0], rgba[1], rgba[2], rgba[3]).premultiply();
    }
    pm.save_png(path).unwrap();
}

/// The textured meshes among the painted shapes (an image's pixels).
fn meshes(shape: &Shape, out: &mut Vec<egui::epaint::Mesh>) {
    match shape {
        Shape::Mesh(m) => out.push((**m).clone()),
        Shape::Vec(shapes) => shapes.iter().for_each(|s| meshes(s, out)),
        _ => {}
    }
}

struct Canvas {
    app: CadApp,
    ctx: Context,
    previous_theme: egui::Theme,
    /// Texture uploads seen across the paints (an image's pixels are uploaded once).
    uploaded: usize,
}

impl Canvas {
    fn new() -> Self {
        let previous_theme = theme::active();
        let mut session = Session::new();
        session.new_drawing(true);
        session.execute("view.set", &json!({"center": [50, 50], "height": 200})).unwrap();
        session.settings.gridmode = false;
        session.settings.dynmode = false;
        let mut app = CadApp::new(session, Services::default());
        app.canvas.zoom_pending = false;
        app.ui.show_command_line = false;
        app.ui.show_ucs_icon = false;
        app.ui.show_viewcube = false;
        app.run("options", json!({"theme": "dark"})).unwrap();
        let mut canvas = Self { app, ctx: Context::default(), previous_theme, uploaded: 0 };
        canvas.paint();
        canvas
    }

    fn paint(&mut self) -> Vec<egui::epaint::ClippedShape> {
        let mut shapes = Vec::new();
        for _ in 0..3 {
            let input = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(1280.0, 800.0))),
                events: vec![egui::Event::PointerMoved(pos2(640.0, 400.0))],
                ..Default::default()
            };
            let mut output = self.ctx.run_ui(input, |ui| {
                self.app.logic(ui.ctx());
                self.app.ui(ui);
            });
            shapes = std::mem::take(&mut output.shapes);
            self.uploaded += output.textures_delta.set.len();
            output.textures_delta.clear();
        }
        shapes
    }
}

impl Drop for Canvas {
    fn drop(&mut self) {
        theme::set_active(self.previous_theme);
    }
}

#[test]
fn an_attached_image_is_painted_and_its_quad_is_selectable() {
    let path = std::env::temp_dir().join("cadcraft-canvas-image.png");
    write_png(&path, 8, 8, [200, 40, 40, 255]);
    let ps = path.to_string_lossy().to_string();

    let mut c = Canvas::new();
    // A 40×40 image at (30, 30), so its quad covers (30, 30)..(70, 70) in the drawing.
    let r = c.app.run("imageattach", json!({"path": ps, "at": [30, 30], "width": 40.0})).unwrap();
    let h = r["handle"].as_str().unwrap().to_string();

    // Its pixels are painted as a textured mesh, with the image's own aspect.
    let shapes = c.paint();
    let mut painted = Vec::new();
    for s in &shapes {
        meshes(&s.shape, &mut painted);
    }
    assert!(!painted.is_empty(), "the image's pixels must be painted");
    assert!(c.uploaded >= 1, "the image's pixels are uploaded as a texture ({} uploads)", c.uploaded);
    // The image's own mesh among the painted ones (the UI's glyph meshes are also meshes).
    let uv_has = |m: &egui::epaint::Mesh, u: f32, v: f32| m.vertices.iter().any(|q| (q.uv.x - u).abs() < 1e-3 && (q.uv.y - v).abs() < 1e-3);
    let m = painted.iter().find(|m| uv_has(m, 0.0, 0.0) && uv_has(m, 1.0, 0.0) && uv_has(m, 1.0, 1.0) && uv_has(m, 0.0, 1.0));
    let Some(m) = m else { panic!("no mesh is textured corner to corner: {:?}", painted.iter().map(|m| m.vertices.len()).collect::<Vec<_>>()) };
    // The quad covers the image's own placement: its vertices are the four corners on screen.
    let xf = c.app.canvas.xf.unwrap();
    let want = [Vec2::new(30.0, 30.0), Vec2::new(70.0, 30.0), Vec2::new(70.0, 70.0), Vec2::new(30.0, 70.0)].map(|p| xf.to_screen(p));
    for corner in want {
        assert!(
            m.vertices.iter().any(|v| v.pos.distance(corner) < 1.0),
            "the mesh reaches the image's corner {corner:?}: {:?}",
            m.vertices.iter().map(|v| v.pos).collect::<Vec<_>>()
        );
    }

    // The quad is selectable: picking its middle selects the image.
    let r = c.app.run("select", json!({"at": [50.0, 50.0]})).unwrap();
    assert_eq!(r["selected"], json!(1), "the image is picked at its middle: {r}");
    assert_eq!(c.app.session.selection().first().map(|h| h.hex()), Some(h.clone()), "{r}");

    let _ = std::fs::remove_file(&path);
}
