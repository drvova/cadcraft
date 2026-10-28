//! The CADCraft facade a JavaScript interface drives: JSON in, JSON out.
//!
//! [`Facade`] wraps one [`cadcraft_engine::Session`] and the world rectangle the canvas shows.
//! Every method takes and returns `String`s holding JSON, so the wasm-bindgen shim
//! ([`CadFacade`], compiled only for `wasm32`) is a thin pass-through and the tests here run
//! natively with no wasm tooling. No `serde_json::Value` crosses the boundary and no egui is
//! involved: this is the seam between the engine and the SolidJS interface
//! (`plan/solid-ui-migration.md`).
//!
//! # Replies
//!
//! | call | reply |
//! |---|---|
//! | [`Facade::execute`] | `{"ok":true,"result":…}` or `{"ok":false,"error":"…"}` |
//! | [`Facade::cmdline`] / [`Facade::prompt`] | the command-line state: `prompt`, `running`, `keywords`, `accept`, `default`, `output`; `cmdline` adds `error` when the line was refused |
//! | [`Facade::start`] | the command-line state plus `output` (and `error` for an unknown id): a command started **by id**, as a menu click does |
//! | [`Facade::state`] | `{"title","dirty","revision","extents","layerCount","entityCount","currentLayer","space"}` (`extents` is `[minx,miny,maxx,maxy]` or `null`) |
//! | [`Facade::selection`] | `{"count":n,"handles":["1A",…]}` |
//! | [`Facade::settings`] | the drafting-toggle states the status bar shows (`grid`, `snap`, `ortho`, …, `osmode`, `pickbox`) |
//! | [`Facade::format_point`] | `{"text":"6.0000, 4.0000, 0.0000"}` in the drawing's own units |
//! | [`Facade::commands`] | every command as `{id,label,menu,shortcut,aliases,params,interactive,enabled[,disabledReason]}` (camelCase, as `engine.commands`) |
//! | [`Facade::source`] | `{"ok":true,"text":"…"}` — the drawing as CadScript |
//! | [`Facade::run_script`] | `{"ok","ran","output"[,error]}` |
//! | [`Facade::display`] | the display list below, or `{"error":"…"}` |
//! | [`Facade::set_view`] | `{"ok":true,"view":{"min":[x,y],"max":[x,y]}}` or `{"ok":false,"error":"…"}`; the engine's session view follows quietly (no view-history entries) |
//! | [`Facade::view`] | `{"min":[x,y],"max":[x,y]}` — what the canvas shows; it follows a command that moves the view (ZOOM, PAN, a view restore) |
//! | [`Facade::open_bytes`] | `{"ok":true,"title","entityCount","warnings"}` or `{"ok":false,"error":"…"}` |
//! | [`Facade::save_bytes`] | DXF bytes (empty when no drawing is open) |
//! | [`Facade::digest`] | `{"hash","entities","bounds"}` |
//!
//! # The display list
//!
//! [`Facade::display`] serializes `cadcraft_render::build` of the active space:
//!
//! ```json
//! {"revision":7,"bounds":[minx,miny,maxx,maxy],
//!  "verts":[[x,y],…],
//!  "prims":[{"kind":"polyline"|"tris"|"point"|"image","start":0,"len":2,
//!            "color":[r,g,b],"lw":0.25,"alpha":255,"handle":18},…]}
//! ```
//!
//! * `verts` holds world coordinates shared by every primitive; `prims[i].start/len` index into
//!   it. `polyline` points are connected, `tris` are three vertices per triangle, `point` is
//!   `verts[start]`, and `image` is the quad's four vertices — the pixels are **not** in the
//!   JSON (v1 draws the frame only).
//! * an infinite line or ray emits two points covering the view (a line: base ± direction·t, a
//!   ray: base forward only), so the canvas clips the segment at its own edge.
//! * colour is already resolved for the canvas (`display_rgb` on the dark drawing area; a wipeout
//!   mask fills with that background), `lw` is millimetres and `alpha` is 0..=255.
//! * primitives entirely outside the view set by [`Facade::set_view`] are skipped; `bounds` is the
//!   whole list's bounds (what the canvas can fit to), `[0,0,0,0]` for an empty space.
//! * past [`MAX_DISPLAY_BYTES`] the reply is `{"error":"the drawing is too large for the display
//!   list"}` rather than an unbounded allocation.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#![forbid(unsafe_code)]

use cadcraft_color::Rgb;
use cadcraft_doc::Space;
use cadcraft_engine::Session;
use cadcraft_geom::{Bounds2, Vec2};
use cadcraft_render::{DPrim, Kind, Options};
use serde_json::{Value, json};

/// The dark drawing-area colour the interface paints (`ui-egui`'s `Tokens::DARK.canvas`, copied
/// by the interface's token file). Colour 7 resolves against it — white on the dark canvas — and
/// a wipeout mask fills with it.
const CANVAS_BACKGROUND: Rgb = Rgb(0x18, 0x18, 0x18);

/// The largest display-list JSON [`Facade::display`] will build. Past it the reply is
/// `{"error":"the drawing is too large for the display list"}`.
pub const MAX_DISPLAY_BYTES: usize = 8 << 20;

/// The largest drawing [`Facade::open_bytes`] accepts, matching the engine's own per-file limit.
const MAX_OPEN_BYTES: usize = 512 << 20;

/// The longest command id [`Facade::execute`] accepts (command ids are short constants; a longer
/// string is hostile input and is refused before it reaches the engine).
const MAX_COMMAND_BYTES: usize = 512;

/// The longest line [`Facade::cmdline`] accepts. A command line is one line; scripts go through
/// [`Facade::run_script`], which the engine caps at 8 MB.
const MAX_CMDLINE_BYTES: usize = 1 << 20;

/// A canvas view wider or taller than this (world units) is refused, so a hostile `set_view`
/// cannot ask the build for an unbounded area.
const MAX_VIEW_SIZE: f64 = 1e12;

/// A canvas view narrower or shorter than this is refused (the canvas would be unusable).
const MIN_VIEW_SIZE: f64 = 1e-9;

/// The canvas is assumed about this many pixels tall: chord tolerance is half a pixel and the
/// minimum dash two pixels at that scale.
const NOMINAL_CANVAS_PX: f64 = 1000.0;

/// Bytes a vertex is estimated to take in the display-list JSON, for the size cap.
const VERTEX_BYTES: usize = 56;

/// Bytes a primitive is estimated to take in the display-list JSON, for the size cap.
const PRIM_BYTES: usize = 160;

/// Command-line output lines a [`Facade::cmdline`] reply carries.
const MAX_OUTPUT: usize = 200;

/// Log lines [`Facade::prompt`] carries as the output tail.
const OUTPUT_TAIL: usize = 20;

/// Drawings a browser session keeps open. The desktop user closes drawings; a page that opens
/// one after another must not grow the session without bound, so opening past this drops the
/// oldest (never the one just opened).
const MAX_OPEN_DOCS: usize = 8;

/// The view a drawing-less canvas starts on (world units around the origin).
fn default_view() -> Bounds2 {
    Bounds2 { min: Vec2::new(-10.0, -10.0), max: Vec2::new(10.0, 10.0) }
}

/// A view around a drawing's extents, with a margin: what opening a drawing or entering a space
/// fits to. A degenerate extent still gets a usable rectangle.
fn fit_view(ext: Bounds2) -> Bounds2 {
    if ext.is_empty() {
        return default_view();
    }
    let size = ext.width().max(0.0).max(ext.height().max(0.0)).max(1.0);
    let pad = size * 0.05;
    Bounds2 { min: Vec2::new(ext.min.x - pad, ext.min.y - pad), max: Vec2::new(ext.max.x + pad, ext.max.y + pad) }
}

/// A finite coordinate: hostile drawings must not put `NaN`/`Infinity` (which JSON cannot carry)
/// into a reply.
fn finite(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

fn error_reply(message: impl Into<String>) -> String {
    json!({"ok": false, "error": message.into()}).to_string()
}

fn error_only(message: impl Into<String>) -> String {
    json!({"error": message.into()}).to_string()
}

/// Install the engine's file-format hooks (the same ones the desktop host installs): reading and
/// writing drawings through `cadcraft_io`, save-as options, and the AutoLISP entity codec. The
/// engine stays I/O-agnostic; this is the web host's half of it. Idempotent (`OnceLock`).
fn install_host_hooks() {
    cadcraft_engine::cmd::file::set_io(cadcraft_engine::cmd::file::IoHooks {
        read: |b, name| cadcraft_io::read(b, name).map_err(|e| e.to_string()),
        write: |d, name| cadcraft_io::write(d, name).map_err(|e| e.to_string()),
        plot: Some(|d, space, opts| cadcraft_io::plotter::plot(d, space, opts).map_err(|e| e.to_string())),
    });
    cadcraft_engine::cmd::file::set_write_as(|d, name, o| {
        cadcraft_io::write_with(d, name, &cadcraft_io::SaveOptions { version: o.version, binary: o.binary }).map_err(|e| e.to_string())
    });
    cadcraft_engine::cmd::file::set_entity_codec(cadcraft_engine::cmd::file::EntityCodec {
        groups: cadcraft_io::entity_groups,
        entity: cadcraft_io::entity_from_groups,
    });
}

/// The JSON parameters of an [`Facade::execute`] call: empty (or `null`) means `{}`.
fn parse_params(params: &str) -> Result<Value, String> {
    if params.trim().is_empty() {
        return Ok(json!({}));
    }
    let v: Value = serde_json::from_str(params).map_err(|e| format!("bad params JSON: {e}"))?;
    Ok(if v.is_null() { json!({}) } else { v })
}

/// The two points an `Infinite` primitive emits: `base ± direction·t` (a ray: base forward
/// only), with `t` reaching past the farthest view corner, so the canvas clips the segment at
/// its edge. The primitive's own two vertices are the base and a unit direction.
fn infinite_points(pts: &[Vec2], view: Bounds2, ray: bool) -> [Vec2; 2] {
    let base = pts.first().copied().unwrap_or(Vec2::ZERO);
    let dir = pts.get(1).copied().unwrap_or(Vec2::ZERO);
    let len = dir.len();
    if !len.is_finite() || len <= 1e-12 || view.is_empty() {
        return [base, dir];
    }
    let dx = (view.min.x - base.x).max(base.x - view.max.x).max(0.0);
    let dy = (view.min.y - base.y).max(base.y - view.max.y).max(0.0);
    let reach = dx.hypot(dy) + view.width().max(0.0) + view.height().max(0.0);
    let t = reach / len;
    if !t.is_finite() {
        return [base, dir];
    }
    if ray { [base, base + dir * t] } else { [base - dir * t, base + dir * t] }
}

/// The view expanded by `margin` — a fraction of the view's span on each side (0.0 is the view
/// itself). The display list is built for this window so a client can pan inside it without
/// asking the engine again; the margin is clamped so a hostile value cannot build a list the
/// byte guard would refuse.
fn expand_view(view: Bounds2, margin: f64) -> Bounds2 {
    let m = if margin.is_finite() { margin.clamp(0.0, 8.0) } else { 0.0 };
    if m <= 0.0 || view.is_empty() {
        return view;
    }
    let dx = view.width() * m;
    let dy = view.height() * m;
    Bounds2 { min: Vec2::new(view.min.x - dx, view.min.y - dy), max: Vec2::new(view.max.x + dx, view.max.y + dy) }
}

/// The `kind` string of a primitive (see the module documentation).
fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Polyline | Kind::Infinite { .. } => "polyline",
        Kind::Tris | Kind::Mask => "tris",
        Kind::Point => "point",
        Kind::Image => "image",
    }
}

/// The colour the canvas draws a primitive with: the resolved colour, or the background for a
/// wipeout mask.
fn prim_color(p: &DPrim) -> (u8, u8, u8) {
    let c = if p.kind == Kind::Mask { CANVAS_BACKGROUND } else { p.display_rgb(CANVAS_BACKGROUND) };
    (c.0, c.1, c.2)
}

/// The command-line state, as the desktop control channel reports it.
fn cmdline_state(s: &Session) -> Value {
    let p = s.current_prompt();
    json!({
        "prompt": s.prompt_text(),
        "running": s.running.as_ref().map(|r| r.id.clone()),
        "keywords": p.as_ref().map(|p| p.keywords.clone()).unwrap_or_default(),
        "accept": p.as_ref().map(|p| p.accept),
        "default": p.as_ref().and_then(|p| p.default.clone()),
    })
}

/// The facade a JavaScript interface calls: one session, one view, JSON replies.
pub struct Facade {
    session: Session,
    /// The world rectangle the canvas shows. `display` culls to it; `view`/`set_view` read and
    /// write it, and a command that moves the engine's session view (ZOOM, PAN, a view restore)
    /// is mirrored into it (see [`Facade::refresh`]).
    view: Bounds2,
    /// The space `view` belongs to. When a command switches spaces (a layout tab, MSPACE) the
    /// view re-fits to the new space's extents.
    space: Space,
    /// The engine's session view when the facade last looked. A command that moves it (ZOOM,
    /// PAN, a view restore) is mirrored into `view`, so `view()` always reports what the canvas
    /// should be showing; the canvas's own `set_view` writes the session view in step.
    engine_view: cadcraft_engine::View,
}

impl Default for Facade {
    fn default() -> Self {
        Self::new()
    }
}

impl Facade {
    /// A new, empty drawing (`Drawing1`, the default imperial drawing).
    pub fn new() -> Self {
        install_host_hooks();
        let session = Session::new();
        let engine_view = session.state().map(|st| st.view()).unwrap_or_default();
        Facade { session, view: default_view(), space: Space::Model, engine_view }
    }

    /// The sample drawing `--sample` opens: the mechanical bracket, in model space, fitted.
    pub fn sample() -> Self {
        install_host_hooks();
        let mut session = Session::empty();
        session.open_drawing(cadcraft_engine::sample::default_sample(), "Bracket", None);
        let engine_view = session.state().map(|st| st.view()).unwrap_or_default();
        let mut facade = Facade { session, view: default_view(), space: Space::Model, engine_view };
        facade.fit_view();
        facade
    }

    /// Run any command with JSON parameters, exactly like `engine.execute` on the desktop.
    /// Replies `{"ok":true,"result":…}` or `{"ok":false,"error":"…"}`; a failed command is also
    /// echoed to the command line, as the desktop does.
    pub fn execute(&mut self, command: &str, params: &str) -> String {
        if command.len() > MAX_COMMAND_BYTES {
            return error_reply(format!("the command name is too long: {} bytes (the limit is {MAX_COMMAND_BYTES})", command.len()));
        }
        let params = match parse_params(params) {
            Ok(v) => v,
            Err(e) => return error_reply(e),
        };
        let r = self.session.execute(command, &params);
        self.refresh();
        match r {
            Ok(v) => json!({"ok": true, "result": v}).to_string(),
            Err(e) => {
                let m = e.to_string();
                self.session.echo(m.clone());
                error_reply(m)
            }
        }
    }

    /// Type one line at the command line, exactly like a user (commands, keywords, points,
    /// `cmd {json}` calls). Replies the command-line state with the `output` lines the line
    /// produced and `error` when it was refused.
    pub fn cmdline(&mut self, text: &str) -> String {
        let before = self.session.log.len();
        let mut error = None;
        if text.len() > MAX_CMDLINE_BYTES {
            error = Some(format!("the input is too long: {} bytes (the limit is {MAX_CMDLINE_BYTES})", text.len()));
        } else if let Err(e) = self.session.cmdline(text) {
            let m = e.to_string();
            self.session.echo(m.clone());
            error = Some(m);
        }
        self.refresh();
        let mut v = cmdline_state(&self.session);
        let out: Vec<String> = self.session.log.iter().skip(before).take(MAX_OUTPUT).cloned().collect();
        if let Some(o) = v.as_object_mut() {
            o.insert("output".into(), json!(out));
            if let Some(e) = error {
                o.insert("error".into(), json!(e));
            }
        }
        v.to_string()
    }

    /// Start a command **by its id**, exactly as a menu click does ([`Session::start`]): the
    /// interactive commands (`line`, `circle`…) ask their questions through this reply and are
    /// answered with [`Facade::cmdline`]. Like `cmdline`, the reply is the command-line state
    /// plus the `output` lines the start produced; an unknown id replies the same `error` shape
    /// `cmdline` does.
    pub fn start(&mut self, id: &str) -> String {
        let before = self.session.log.len();
        let mut error = None;
        if id.len() > MAX_COMMAND_BYTES {
            error = Some(format!("the command name is too long: {} bytes (the limit is {MAX_COMMAND_BYTES})", id.len()));
        } else if let Err(e) = self.session.start(id) {
            let m = e.to_string();
            self.session.echo(m.clone());
            error = Some(m);
        }
        self.refresh();
        let mut v = cmdline_state(&self.session);
        let out: Vec<String> = self.session.log.iter().skip(before).take(MAX_OUTPUT).cloned().collect();
        if let Some(o) = v.as_object_mut() {
            o.insert("output".into(), json!(out));
            if let Some(e) = error {
                o.insert("error".into(), json!(e));
            }
        }
        v.to_string()
    }

    /// The command-line state: the prompt as shown, the running command, its keywords and
    /// accepted input kinds, and the output tail.
    pub fn prompt(&self) -> String {
        let mut v = cmdline_state(&self.session);
        let out: Vec<String> = self.session.log.iter().rev().take(OUTPUT_TAIL).rev().cloned().collect();
        if let Some(o) = v.as_object_mut() {
            o.insert("output".into(), json!(out));
        }
        v.to_string()
    }

    /// The drawing summary: title, dirty, revision, extents, layer and entity counts, current
    /// layer and active space.
    pub fn state(&self) -> String {
        let Ok(st) = self.session.state() else { return error_reply("no drawing open") };
        let ext = st.doc.extents(&st.space);
        let extents = if ext.is_empty() { Value::Null } else { json!([finite(ext.min.x), finite(ext.min.y), finite(ext.max.x), finite(ext.max.y)]) };
        json!({
            "title": st.title,
            "dirty": st.is_dirty(),
            "revision": st.revision,
            "extents": extents,
            "layerCount": st.doc.layers.len(),
            "entityCount": st.doc.entity_count(),
            "currentLayer": st.doc.header.str("CLAYER", "0"),
            "space": st.space.tab_name(),
        })
        .to_string()
    }

    /// The active drawing's selection: `{"count":n,"handles":["1A",…]}` (`Handle::hex`). No
    /// drawing open → `{"count":0,"handles":[]}`.
    pub fn selection(&self) -> String {
        let handles: Vec<String> = self.session.state().map(|st| st.selection.iter().map(|h| h.hex()).collect()).unwrap_or_default();
        json!({"count": handles.len(), "handles": handles}).to_string()
    }

    /// The drafting-toggle states the status bar shows, straight from [`Session::settings`]:
    /// `{"grid","snap","ortho","polar","isodraft","otrack","osnap","dynmode","lwdisplay",
    /// "transparency","qpmode","osmode","pickbox"}`. `osnap` is on while `osmode` is set and not
    /// [`snap::mode::OFF`]; `transparency` is `transparency_display`.
    pub fn settings(&self) -> String {
        let s = &self.session.settings;
        json!({
            "grid": s.gridmode,
            "snap": s.snapmode,
            "ortho": s.orthomode,
            "polar": s.polarmode,
            "isodraft": s.isodraft,
            "otrack": s.otrack,
            "osnap": s.osmode & cadcraft_engine::snap::mode::OFF == 0 && s.osmode != 0,
            "dynmode": s.dynmode,
            "lwdisplay": s.lwdisplay,
            "transparency": s.transparency_display,
            "qpmode": s.qpmode,
            "osmode": s.osmode,
            "pickbox": s.pickbox,
        })
        .to_string()
    }

    /// A point in the drawing's own units (`LUNITS`/`LUPREC` header vars, the same formatting
    /// the desktop status bar shows): `{"text":"6.0000, 4.0000, 0.0000"}`. No drawing → the
    /// same formatting with the defaults (2, 4); a non-finite ordinate formats as 0.0, never
    /// `NaN`.
    pub fn format_point(&self, x: f64, y: f64) -> String {
        let (lu, lp) = self.session.doc().map(|d| (d.header.i64("LUNITS", 2), d.header.i64("LUPREC", 4))).unwrap_or((2, 4));
        let text = format!(
            "{}, {}, {}",
            cadcraft_engine::units::format_distance(finite(x), lu, lp),
            cadcraft_engine::units::format_distance(finite(y), lu, lp),
            cadcraft_engine::units::format_distance(0.0, lu, lp)
        );
        json!({"text": text}).to_string()
    }

    /// Every command: id, label, menu path, shortcut, aliases, params doc and enablement (the
    /// engine's `engine.commands`, as an array).
    pub fn commands(&self) -> String {
        let v: Vec<Value> =
            cadcraft_engine::command_specs().iter().map(|c| serde_json::to_value(c.info(&self.session)).unwrap_or(Value::Null)).collect();
        Value::Array(v).to_string()
    }

    /// The drawing as CadScript text (`cadcraft_engine::cadscript::to_script`), in
    /// `{"ok":true,"text":"…"}`.
    pub fn source(&self) -> String {
        match self.session.state() {
            Ok(st) => json!({"ok": true, "text": cadcraft_engine::cadscript::to_script(&st.doc)}).to_string(),
            Err(_) => error_reply("no drawing open"),
        }
    }

    /// Rebuild the drawing from CadScript text (`cadscript::run_replace`): the script's own
    /// drawing replaces what it can rebuild, a failed run restores the drawing. Replies
    /// `{"ok","ran","output"[,error]}`.
    pub fn run_script(&mut self, text: &str) -> String {
        let report = cadcraft_engine::cadscript::run_replace(&mut self.session, text);
        self.refresh();
        let mut v = json!({"ok": report.ok, "ran": report.ran, "output": report.output});
        if let (Some(e), Some(o)) = (report.error, v.as_object_mut()) {
            o.insert("error".into(), json!(e));
        }
        v.to_string()
    }

    /// The active space's display list as JSON (see the module documentation), culled to the
    /// current view expanded by `margin` (a fraction of the view's span per side; 0.0 is the
    /// view itself). A client that pans inside the returned window needs no further call. Replies
    /// `{"error":…}` when there is no drawing or the list would exceed [`MAX_DISPLAY_BYTES`].
    pub fn display(&mut self, margin: f64) -> String {
        let Ok(st) = self.session.state() else { return error_only("no drawing open") };
        let revision = st.revision;
        let window = expand_view(self.view, margin);
        let list = cadcraft_render::build(&st.doc, &st.space, &self.build_options_for(window));
        let mut verts: Vec<Value> = Vec::new();
        let mut prims: Vec<Value> = Vec::new();
        let mut estimate: usize = 0;
        for p in &list.prims {
            let pts = list.points(p);
            if pts.is_empty() || !self.prim_visible(p, pts, window) {
                continue;
            }
            let points: Vec<Vec2> = match p.kind {
                Kind::Infinite { ray } => infinite_points(pts, window, ray).to_vec(),
                _ => pts.to_vec(),
            };
            estimate = estimate.saturating_add(points.len().saturating_mul(VERTEX_BYTES)).saturating_add(PRIM_BYTES);
            if estimate > MAX_DISPLAY_BYTES {
                return error_only("the drawing is too large for the display list");
            }
            let start = verts.len();
            for q in &points {
                verts.push(json!([finite(q.x), finite(q.y)]));
            }
            let (r, g, b) = prim_color(p);
            prims.push(json!({
                "kind": kind_name(p.kind),
                "start": start,
                "len": points.len(),
                "color": [r, g, b],
                "lw": p.lw,
                "alpha": p.alpha(),
                "handle": p.handle.0,
            }));
        }
        let bounds = if list.bounds.is_empty() {
            json!([0.0, 0.0, 0.0, 0.0])
        } else {
            json!([finite(list.bounds.min.x), finite(list.bounds.min.y), finite(list.bounds.max.x), finite(list.bounds.max.y)])
        };
        let text = json!({"revision": revision, "bounds": bounds, "verts": verts, "prims": prims}).to_string();
        if text.len() > MAX_DISPLAY_BYTES {
            return error_only("the drawing is too large for the display list");
        }
        text
    }

    /// Pan/zoom the canvas: set the world rectangle the canvas shows, as `[x0,y0]..[x1,y1]`.
    /// The engine's session view follows quietly (a drag emits many frames; none of them belongs
    /// in the view history), so ZOOM, PAN and a view restore start from what the canvas shows.
    /// Replies `{"ok":true,"view":{…}}`, or an error for a rectangle that is not finite, is
    /// empty (`x1 <= x0` or `y1 <= y0`), or is absurdly large or small.
    pub fn set_view(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) -> String {
        match usable_view(x0, y0, x1, y1) {
            Ok(view) => {
                self.view = view;
                // Keep the engine's session view in step (quietly: a drag emits many frames, and
                // none of them belongs in the view history), so ZOOM, PAN and a view restore start
                // from what the canvas shows.
                if let Ok(st) = self.session.state_mut() {
                    st.set_view_quiet(cadcraft_engine::View { center: view.center(), height: view.height() });
                }
                self.note_engine_view();
                json!({"ok": true, "view": view_json(view)}).to_string()
            }
            Err(e) => error_reply(e),
        }
    }

    /// The view the canvas is showing: `{"min":[x,y],"max":[x,y]}`.
    pub fn view(&self) -> String {
        view_json(self.view).to_string()
    }

    /// Load the sample drawing into the running session (the browser's File ▸ Open Sample
    /// Drawing): the same drawing [`Facade::sample`] starts with, replacing what is open, fitted
    /// to the view. Replies `{"ok":true,"title","entityCount"}`.
    pub fn load_sample(&mut self) -> String {
        self.session.open_drawing(cadcraft_engine::sample::default_sample(), "Bracket", None);
        self.refresh();
        self.fit_view();
        let (title, entity_count) = match self.session.state() {
            Ok(st) => (st.title.clone(), st.doc.entity_count()),
            Err(_) => (String::new(), 0),
        };
        json!({"ok": true, "title": title, "entityCount": entity_count}).to_string()
    }

    /// Open a drawing from bytes (the browser has no file paths), through the engine's own open
    /// path (title, read warnings, external-reference fixups), and fit the view to it. Replies
    /// `{"ok":true,"title","entityCount","warnings"}` or `{"ok":false,"error":"…"}`.
    pub fn open_bytes(&mut self, name: &str, bytes: &[u8]) -> String {
        if bytes.len() > MAX_OPEN_BYTES {
            return error_reply(format!("the file is too large: {} bytes (the limit is {MAX_OPEN_BYTES})", bytes.len()));
        }
        let params = json!({"data": cadcraft_engine::cmd::file::base64_encode(bytes), "name": name});
        let r = self.session.execute("open", &params);
        if r.is_ok() {
            self.trim_documents();
        }
        self.refresh();
        match r {
            Ok(v) => {
                self.fit_view();
                let (title, entity_count) = match self.session.state() {
                    Ok(st) => (st.title.clone(), st.doc.entity_count()),
                    Err(_) => (String::new(), 0),
                };
                json!({"ok": true, "title": title, "entityCount": entity_count, "warnings": v.get("warnings").cloned().unwrap_or_else(|| json!([]))})
                    .to_string()
            }
            Err(e) => {
                let m = e.to_string();
                self.session.echo(m.clone());
                error_reply(m)
            }
        }
    }

    /// Save the drawing as DXF bytes, through the io layer's writer (ASCII, in the drawing's own
    /// version — the same bytes QSAVE would write). Empty when no drawing is open, or when the
    /// write fails (a `Vec<u8>` cannot carry an error).
    pub fn save_bytes(&mut self) -> Vec<u8> {
        match self.session.doc() {
            Ok(d) => cadcraft_io::write(d, "drawing.dxf").unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    /// The drawing's content digest (`cadcraft_doc::digest`): `{"hash","entities","bounds"}`, so
    /// a test can prove a view change or a save/load changed nothing.
    pub fn digest(&self) -> String {
        match self.session.doc() {
            Ok(d) => {
                let g = cadcraft_doc::drawing_digest(d);
                let bounds = match g.bounds {
                    Some(b) => json!([finite(b[0]), finite(b[1]), finite(b[2]), finite(b[3])]),
                    None => Value::Null,
                };
                json!({"hash": g.hash, "entities": g.entities, "bounds": bounds}).to_string()
            }
            Err(_) => error_reply("no drawing open"),
        }
    }

    /// The build options for the current view: level of detail from the view's height (the canvas
    /// is assumed [`NOMINAL_CANVAS_PX`] tall), the view as the pattern-generation window, and
    /// transparency on so `alpha` is meaningful.
    /// The build options for a window: level of detail from the window's height (the canvas is
    /// assumed [`NOMINAL_CANVAS_PX`] tall), the window as the pattern-generation window, and
    /// transparency on so `alpha` is meaningful.
    fn build_options_for(&self, window: Bounds2) -> Options {
        let height = window.height().max(MIN_VIEW_SIZE);
        let px = (height / NOMINAL_CANVAS_PX).clamp(1e-9, 1e9);
        Options {
            tolerance: px * 0.5,
            min_dash: px * 2.0,
            text: true,
            fill: true,
            lineweights: true,
            view_height: height,
            view: Some(window),
            transparency: true,
            ..Options::default()
        }
    }

    /// Whether any of a primitive's geometry is inside the view. An infinite line or ray is never
    /// entirely outside (it always crosses the view or could be clipped to nothing by the canvas).
    fn prim_visible(&self, p: &DPrim, pts: &[Vec2], window: Bounds2) -> bool {
        match p.kind {
            Kind::Infinite { .. } => true,
            Kind::Point => pts.first().is_some_and(|q| window.contains(*q)),
            _ => Bounds2::from_points(pts.iter().copied()).intersects(&window),
        }
    }

    /// Follow the session: when a command switched spaces, re-fit the view to the new space (the
    /// old rectangle was in the old space's units); when a command moved the engine's view (ZOOM,
    /// PAN, a view restore), mirror it into the canvas rectangle, keeping the canvas's aspect.
    fn refresh(&mut self) {
        let (space, ext, engine_view) = match self.session.state() {
            Ok(st) => (st.space.clone(), st.doc.extents(&st.space), st.view()),
            Err(_) => return,
        };
        if space != self.space {
            self.space = space;
            self.view = fit_view(ext);
        } else if engine_view != self.engine_view {
            let aspect = (self.view.width() / self.view.height().max(MIN_VIEW_SIZE)).clamp(1e-9, 1e9);
            let h = engine_view.height;
            let w = h * aspect;
            if let Ok(v) = usable_view(
                engine_view.center.x - w / 2.0,
                engine_view.center.y - h / 2.0,
                engine_view.center.x + w / 2.0,
                engine_view.center.y + h / 2.0,
            ) {
                self.view = v;
            }
        }
        self.engine_view = engine_view;
    }

    /// Remember the engine's session view as the facade last saw it (after the canvas wrote it).
    fn note_engine_view(&mut self) {
        if let Ok(st) = self.session.state() {
            self.engine_view = st.view();
        }
    }

    /// Keep at most [`MAX_OPEN_DOCS`] drawings open: the oldest is closed (as the CLOSE command
    /// does, with the same index arithmetic) when opening one more. The just-opened drawing is
    /// active and last, so the drawing that goes is never the active one.
    fn trim_documents(&mut self) {
        while self.session.docs.len() > MAX_OPEN_DOCS && self.session.docs.len() > 1 && self.session.active > 0 {
            self.session.docs.remove(0);
            self.session.active -= 1;
            self.session.bump_doc_epoch();
        }
    }

    /// Fit the view to the active space's extents.
    fn fit_view(&mut self) {
        let ext = match self.session.state() {
            Ok(st) => st.doc.extents(&st.space),
            Err(_) => return,
        };
        self.view = fit_view(ext);
    }
}

/// `{"min":[x,y],"max":[x,y]}` for a view rectangle.
fn view_json(v: Bounds2) -> Value {
    json!({"min": [finite(v.min.x), finite(v.min.y)], "max": [finite(v.max.x), finite(v.max.y)]})
}

/// Validate a requested view rectangle.
fn usable_view(x0: f64, y0: f64, x1: f64, y1: f64) -> Result<Bounds2, String> {
    if !(x0.is_finite() && y0.is_finite() && x1.is_finite() && y1.is_finite()) {
        return Err("the view rectangle is not finite".into());
    }
    let (w, h) = (x1 - x0, y1 - y0);
    if !(w.is_finite() && h.is_finite()) {
        return Err("the view rectangle is not finite".into());
    }
    if w <= 0.0 || h <= 0.0 {
        return Err("the view rectangle is empty: x1 must be > x0 and y1 > y0".into());
    }
    if w < MIN_VIEW_SIZE || h < MIN_VIEW_SIZE {
        return Err("the view rectangle is too small".into());
    }
    if w > MAX_VIEW_SIZE || h > MAX_VIEW_SIZE {
        return Err("the view rectangle is too large".into());
    }
    Ok(Bounds2 { min: Vec2::new(x0, y0), max: Vec2::new(x1, y1) })
}

/// The wasm-bindgen shim the JavaScript interface loads: one thin pass-through per [`Facade`]
/// method, with the names the interface's build script expects. Compiled only for `wasm32`, so
/// the native tests above need no wasm tooling.
#[cfg(target_arch = "wasm32")]
mod bindings {
    use wasm_bindgen::prelude::*;

    use crate::Facade;

    /// The JS-facing facade: `new CadFacade()` or `CadFacade.sample()`.
    #[wasm_bindgen]
    pub struct CadFacade(Facade);

    #[wasm_bindgen]
    impl CadFacade {
        /// `new CadFacade()`: a new, empty drawing.
        #[wasm_bindgen(constructor)]
        pub fn new() -> CadFacade {
            CadFacade(Facade::new())
        }

        /// `CadFacade.sample()`: the sample drawing.
        #[wasm_bindgen(js_name = sample)]
        pub fn sample() -> CadFacade {
            CadFacade(Facade::sample())
        }

        #[wasm_bindgen(js_name = execute)]
        pub fn execute(&mut self, command: &str, params: &str) -> String {
            self.0.execute(command, params)
        }

        #[wasm_bindgen(js_name = cmdline)]
        pub fn cmdline(&mut self, text: &str) -> String {
            self.0.cmdline(text)
        }

        #[wasm_bindgen(js_name = start)]
        pub fn start(&mut self, id: &str) -> String {
            self.0.start(id)
        }

        #[wasm_bindgen(js_name = prompt)]
        pub fn prompt(&self) -> String {
            self.0.prompt()
        }

        #[wasm_bindgen(js_name = state)]
        pub fn state(&self) -> String {
            self.0.state()
        }

        #[wasm_bindgen(js_name = selection)]
        pub fn selection(&self) -> String {
            self.0.selection()
        }

        #[wasm_bindgen(js_name = settings)]
        pub fn settings(&self) -> String {
            self.0.settings()
        }

        #[wasm_bindgen(js_name = formatPoint)]
        pub fn format_point(&self, x: f64, y: f64) -> String {
            self.0.format_point(x, y)
        }

        #[wasm_bindgen(js_name = commands)]
        pub fn commands(&self) -> String {
            self.0.commands()
        }

        #[wasm_bindgen(js_name = source)]
        pub fn source(&self) -> String {
            self.0.source()
        }

        #[wasm_bindgen(js_name = runScript)]
        pub fn run_script(&mut self, text: &str) -> String {
            self.0.run_script(text)
        }

        #[wasm_bindgen(js_name = display)]
        pub fn display(&mut self, margin: f64) -> String {
            self.0.display(margin)
        }

        #[wasm_bindgen(js_name = setView)]
        pub fn set_view(&mut self, x0: f64, y0: f64, x1: f64, y1: f64) -> String {
            self.0.set_view(x0, y0, x1, y1)
        }

        #[wasm_bindgen(js_name = view)]
        pub fn view(&self) -> String {
            self.0.view()
        }

        #[wasm_bindgen(js_name = openBytes)]
        pub fn open_bytes(&mut self, name: &str, bytes: &[u8]) -> String {
            self.0.open_bytes(name, bytes)
        }

        #[wasm_bindgen(js_name = loadSample)]
        pub fn load_sample(&mut self) -> String {
            self.0.load_sample()
        }

        #[wasm_bindgen(js_name = saveBytes)]
        pub fn save_bytes(&mut self) -> Vec<u8> {
            self.0.save_bytes()
        }

        #[wasm_bindgen(js_name = digest)]
        pub fn digest(&self) -> String {
            self.0.digest()
        }
    }

    impl Default for CadFacade {
        fn default() -> Self {
            Self::new()
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub use bindings::CadFacade;

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn entity_count(f: &Facade) -> u64 {
        parse(&f.state())["entityCount"].as_u64().unwrap()
    }

    fn bounds(f: &mut Facade) -> [f64; 4] {
        let d = parse(&f.display(0.0));
        let b = d["bounds"].as_array().unwrap();
        [b[0].as_f64().unwrap(), b[1].as_f64().unwrap(), b[2].as_f64().unwrap(), b[3].as_f64().unwrap()]
    }

    #[test]
    fn load_sample_replaces_the_drawing() {
        let mut f = Facade::new();
        let before = parse(&f.state());
        assert_eq!(before["entityCount"].as_u64(), Some(0), "a new drawing is empty: {before}");
        let r = parse(&f.load_sample());
        assert_eq!(r["ok"].as_bool(), Some(true), "load_sample: {r}");
        assert_eq!(r["title"].as_str(), Some("Bracket"), "load_sample: {r}");
        assert!(r["entityCount"].as_u64().is_some_and(|n| n > 0), "load_sample: {r}");
        // The display list follows the sample, and the view was fitted to it.
        let d = parse(&f.display(0.0));
        assert!(d["prims"].as_array().is_some_and(|p| !p.is_empty()), "display after load_sample: {d}");
        let v = parse(&f.view());
        assert!(v["min"].as_array().is_some_and(|m| m.len() == 2), "view after load_sample: {v}");
    }

    #[test]
    fn sample_display_list_has_geometry() {
        let mut f = Facade::sample();
        let text = f.display(0.0);
        // The sample must always render, and stay far under the cap (about 100 KB today). The
        // size and head are printed so `--nocapture` reports the real artifact:
        // `cargo test -p cadcraft-wasm sample_display_list_has_geometry -- --nocapture`.
        println!("display bytes: {} head: {}", text.len(), text.chars().take(200).collect::<String>());
        assert!(text.len() < MAX_DISPLAY_BYTES, "the sample display list is {} bytes", text.len());
        let d = parse(&text);
        assert!(d["verts"].as_array().is_some_and(|v| !v.is_empty()), "verts: {d}");
        assert!(d["prims"].as_array().is_some_and(|p| !p.is_empty()), "prims: {d}");
        assert!(d["revision"].as_u64().is_some(), "revision: {d}");
        for p in d["prims"].as_array().unwrap() {
            assert!(matches!(p["kind"].as_str(), Some("polyline" | "tris" | "point" | "image")), "kind: {p}");
            assert!(p["color"].as_array().is_some_and(|c| c.len() == 3), "color: {p}");
            assert!(p["alpha"].as_u64().is_some_and(|a| a <= 255), "alpha: {p}");
        }
    }

    #[test]
    fn execute_circle_grows_the_drawing() {
        let mut f = Facade::new();
        let before = entity_count(&f);
        let r = parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#));
        assert_eq!(r["ok"], json!(true), "{r}");
        assert!(entity_count(&f) > before, "{r}");
        let [x0, y0, x1, y1] = bounds(&mut f);
        // The chord approximation inscribes the circle, so the tessellated bounds fall a sagitta
        // (about 0.01 here) short of the exact radius.
        assert!(x0 <= 0.0 && y0 <= 0.0, "the bounds contain the centre: {x0} {y0}");
        assert!(x1 >= 4.95 && y1 >= 4.95, "the bounds reach the circle: {x1} {y1}");
    }

    #[test]
    fn cmdline_circle_runs_like_a_user() {
        let mut f = Facade::new();
        let before = entity_count(&f);
        let r = parse(&f.cmdline("circle 0,0 5"));
        assert!(r.get("error").is_none(), "{r}");
        assert!(entity_count(&f) > before, "{r}");
        let [x0, y0, x1, y1] = bounds(&mut f);
        // The chord approximation inscribes the circle, so the tessellated bounds fall a sagitta
        // (about 0.01 here) short of the exact radius.
        assert!(x0 <= 0.0 && y0 <= 0.0, "the bounds contain the centre: {x0} {y0}");
        assert!(x1 >= 4.95 && y1 >= 4.95, "the bounds reach the circle: {x1} {y1}");
    }

    #[test]
    fn digest_ignores_the_view_and_changes_on_edits() {
        let mut f = Facade::sample();
        let before = f.digest();
        assert_eq!(parse(&f.set_view(0.0, 0.0, 10.0, 10.0))["ok"], json!(true));
        assert_eq!(f.digest(), before, "a view change is not a drawing change");
        assert_eq!(parse(&f.execute("zoom", r#"{"mode":"extents"}"#))["ok"], json!(true));
        assert_eq!(f.digest(), before, "a no-op command is not a drawing change");
        assert_eq!(parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#))["ok"], json!(true));
        assert_ne!(f.digest(), before, "an edit changes the digest");
    }

    #[test]
    fn save_and_open_bytes_round_trip() {
        // A drawing whose entities the DXF reader rebuilds exactly (no dimensions or hatches,
        // which the reader re-derives) so the digest can be compared.
        let mut f = Facade::new();
        for (cmd, params) in [
            ("circle", r#"{"center":[0,0],"radius":5}"#),
            ("line", r#"{"points":[[-1,-1],[1,1]]}"#),
            ("arc", r#"{"center":[0,0],"radius":3,"start":0,"end":90}"#),
            ("text", r#"{"at":[1,2],"text":"round trip","height":0.25}"#),
        ] {
            assert_eq!(parse(&f.execute(cmd, params))["ok"], json!(true), "{cmd}");
        }
        let entities = entity_count(&f);
        let digest = f.digest();
        let bytes = f.save_bytes();
        assert!(!bytes.is_empty(), "no DXF bytes");
        let r = parse(&f.open_bytes("roundtrip.dxf", &bytes));
        assert_eq!(r["ok"], json!(true), "{r}");
        assert_eq!(entity_count(&f), entities, "{r}");
        assert_eq!(f.digest(), digest, "the digest survives the round trip");
        // The sample's entity count survives it too (its dimensions and hatches are re-derived,
        // so only the count is compared).
        let mut s = Facade::sample();
        let sample_entities = entity_count(&s);
        let bytes = s.save_bytes();
        assert_eq!(parse(&s.open_bytes("sample.dxf", &bytes))["ok"], json!(true));
        assert_eq!(entity_count(&s), sample_entities);
        // A long browser session opening one file after another stays bounded.
        for _ in 0..(MAX_OPEN_DOCS + 3) {
            assert_eq!(parse(&s.open_bytes("sample.dxf", &bytes))["ok"], json!(true));
        }
        assert!(s.session.docs.len() <= MAX_OPEN_DOCS, "documents: {}", s.session.docs.len());
    }

    #[test]
    fn hostile_input_never_panics() {
        let mut f = Facade::new();
        let big = "x".repeat(10 * 1024 * 1024);
        let r = parse(&f.execute(&big, "{}"));
        assert_eq!(r["ok"], json!(false), "{r}");
        assert!(r["error"].is_string(), "{r}");
        let r = parse(&f.set_view(f64::NAN, 0.0, 1.0, 1.0));
        assert_eq!(r["ok"], json!(false), "{r}");
        assert!(r["error"].is_string(), "{r}");
        let r = parse(&f.set_view(10.0, 0.0, 0.0, 1.0));
        assert_eq!(r["ok"], json!(false), "{r}");
        assert!(r["error"].is_string(), "{r}");
        let r = parse(&f.execute("circle", "{bad json"));
        assert_eq!(r["ok"], json!(false), "{r}");
        assert!(r["error"].is_string(), "{r}");
        let r = parse(&f.open_bytes("junk.dxf", &[0xff; 64]));
        assert_eq!(r["ok"], json!(false), "{r}");
        assert!(r["error"].is_string(), "{r}");
        // The facade still works after all of it.
        assert_eq!(parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#))["ok"], json!(true));
    }

    #[test]
    fn a_zoom_command_moves_the_view() {
        let mut f = Facade::sample();
        let before = parse(&f.view());
        assert_eq!(parse(&f.execute("zoom", r#"{"mode":"in"}"#))["ok"], json!(true));
        let after = parse(&f.view());
        assert_ne!(before, after, "ZOOM moves the view the canvas shows");
        assert_eq!(parse(&f.execute("zoom", r#"{"mode":"in"}"#))["ok"], json!(true));
        assert_ne!(after, parse(&f.view()), "a second ZOOM keeps moving it");
        // And the canvas's own view survives a command that does not move it.
        assert_eq!(parse(&f.set_view(0.0, 0.0, 10.0, 10.0))["ok"], json!(true));
        assert_eq!(parse(&f.execute("circle", r#"{"center":[5,5],"radius":1}"#))["ok"], json!(true));
        assert_eq!(parse(&f.view()), json!({"min": [0.0, 0.0], "max": [10.0, 10.0]}));
    }

    #[test]
    fn display_is_deterministic() {
        let mut f = Facade::sample();
        assert_eq!(f.display(0.0), f.display(0.0));
        assert_eq!(f.digest(), f.digest());
        assert_eq!(f.state(), f.state());
    }

    #[test]
    fn display_culls_to_the_view() {
        let mut f = Facade::sample();
        assert!(!parse(&f.display(0.0))["prims"].as_array().unwrap().is_empty());
        assert_eq!(parse(&f.set_view(1.0e6, 1.0e6, 1.0e6 + 10.0, 1.0e6 + 10.0))["ok"], json!(true));
        let d = parse(&f.display(0.0));
        assert!(d["prims"].as_array().unwrap().is_empty(), "culled: {d}");
        assert!(d["bounds"].as_array().is_some_and(|b| b.len() == 4), "bounds: {d}");
        assert_eq!(parse(&f.set_view(-100.0, -100.0, 100.0, 100.0))["ok"], json!(true));
        assert!(!parse(&f.display(0.0))["prims"].as_array().unwrap().is_empty());
    }

    #[test]
    fn display_margin_widens_the_culling_window() {
        let mut f = Facade::sample();
        // The sample's extents, read from a view that holds everything.
        assert_eq!(parse(&f.set_view(-100.0, -100.0, 100.0, 100.0))["ok"], json!(true));
        let b: Vec<f64> = parse(&f.display(0.0))["bounds"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
        let (x0, y0, x1, y1) = (b[0], b[1], b[2], b[3]);
        let w = (x1 - x0).max(1.0);
        // A view one drawing-width to the right of the drawing: a tight cull sees nothing…
        assert_eq!(parse(&f.set_view(x1 + w, y0, x1 + 2.0 * w, y1))["ok"], json!(true));
        assert!(parse(&f.display(0.0))["prims"].as_array().unwrap().is_empty(), "the tight window is empty");
        // …but a margin of 1.5 spans the width again, so the window reaches back into it.
        assert!(!parse(&f.display(1.5))["prims"].as_array().unwrap().is_empty(), "the margin widens the window");
        // A hostile margin is clamped, never a panic or an unbuildable list.
        assert!(parse(&f.display(f64::NAN))["prims"].as_array().is_some());
        assert!(parse(&f.display(1.0e9))["prims"].as_array().is_some());
        // And the view itself is untouched by a margin read: the reply's view is what was set.
        let v = parse(&f.view());
        assert_eq!(v["min"][0], json!(x1 + w));
        assert_eq!(v["max"][0], json!(x1 + 2.0 * w));
    }

    /// A facade with no drawing at all (the tolerant replies of `selection`/`format_point`).
    fn empty_facade() -> Facade {
        Facade { session: Session::empty(), view: default_view(), space: Space::Model, engine_view: cadcraft_engine::View::default() }
    }

    #[test]
    fn start_circle_prompts_like_a_menu_click() {
        let mut f = Facade::new();
        let before = entity_count(&f);
        let r = parse(&f.start("circle"));
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(r["running"], json!("circle"), "{r}");
        assert!(r["prompt"].as_str().is_some_and(|p| p.to_lowercase().contains("center")), "{r}");
        let r = parse(&f.cmdline("0,0"));
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(r["running"], json!("circle"), "{r}");
        assert!(r["prompt"].as_str().is_some_and(|p| p.to_lowercase().contains("radius")), "{r}");
        let r = parse(&f.cmdline("5"));
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(entity_count(&f), before + 1, "the two answers drew the circle: {r}");
    }

    #[test]
    fn start_of_an_unknown_id_replies_an_error() {
        let mut f = Facade::new();
        let r = parse(&f.start("zzz-no-such-command"));
        assert!(r["error"].as_str().is_some_and(|m| m.contains("zzz-no-such-command")), "{r}");
        // The facade still works after it.
        assert_eq!(parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#))["ok"], json!(true));
    }

    #[test]
    fn selection_reflects_the_select_command() {
        assert_eq!(parse(&empty_facade().selection()), json!({"count": 0, "handles": []}));
        let mut f = Facade::new();
        assert_eq!(parse(&f.selection()), json!({"count": 0, "handles": []}));
        assert_eq!(parse(&f.execute("line", r#"{"points":[[-10,0],[10,0]]}"#))["ok"], json!(true));
        let r = parse(&f.execute("select", r#"{"at":[0,0],"aperture":0.5}"#));
        assert_eq!(r["ok"], json!(true), "{r}");
        let reported = r["result"]["handles"].as_array().cloned().unwrap_or_default();
        assert_eq!(reported.len(), 1, "the line is picked: {r}");
        let sel = parse(&f.selection());
        assert_eq!(sel["count"], json!(1), "{sel}");
        assert_eq!(sel["handles"], json!(reported), "{sel}");
        // A clear leaves it empty again.
        assert_eq!(parse(&f.execute("select", r#"{"clear":true}"#))["ok"], json!(true));
        assert_eq!(parse(&f.selection()), json!({"count": 0, "handles": []}));
    }

    #[test]
    fn settings_round_trips_a_grid_toggle() {
        let mut f = Facade::new();
        let s = parse(&f.settings());
        for key in ["grid", "snap", "ortho", "polar", "isodraft", "otrack", "osnap", "dynmode", "lwdisplay", "transparency", "qpmode"] {
            assert!(s[key].is_boolean(), "{key}: {s}");
        }
        assert!(s["osmode"].is_number(), "{s}");
        assert!(s["pickbox"].is_number(), "{s}");
        assert_eq!(parse(&f.execute("grid", r#"{"on":true}"#))["ok"], json!(true));
        assert_eq!(parse(&f.settings())["grid"], json!(true));
        assert_eq!(parse(&f.execute("grid", r#"{"on":false}"#))["ok"], json!(true));
        assert_eq!(parse(&f.settings())["grid"], json!(false));
    }

    #[test]
    fn format_point_matches_format_distance_and_survives_nan() {
        let f = Facade::new();
        let expected = format!(
            "{}, {}, {}",
            cadcraft_engine::units::format_distance(6.0, 2, 4),
            cadcraft_engine::units::format_distance(4.0, 2, 4),
            cadcraft_engine::units::format_distance(0.0, 2, 4)
        );
        let r = parse(&f.format_point(6.0, 4.0));
        assert_eq!(r["text"], json!(expected), "{r}");
        assert!(r["text"].as_str().is_some_and(|t| t.contains("6.0000")), "{r}");
        // No drawing: the same formatting with the defaults (2, 4).
        assert_eq!(parse(&empty_facade().format_point(6.0, 4.0))["text"], json!(expected));
        // Hostile ordinates never reach the reply as NaN/inf.
        let r = parse(&f.format_point(f64::NAN, f64::INFINITY));
        let text = r["text"].as_str().unwrap_or_default();
        assert!(!text.contains("NaN") && !text.contains("inf") && !text.contains("Inf"), "{r}");
        assert!(text.starts_with("0.0000"), "{r}");
    }
}
