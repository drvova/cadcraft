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
//! | [`Facade::cmdline`] / [`Facade::prompt`] | the command-line state: `prompt`, `running`, `keywords`, `accept`, `default`, `base`, `corner`, `distance`, `deferred`, `output`; `cmdline` adds `error` when the line was refused |
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
//! | [`Facade::set_viewport`] | `{"ok":true,"viewport":[w,h]}` (the canvas's CSS pixel size the engine sizes its pick box by) or `{"ok":false,"error":"…"}` |
//! | [`Facade::set_cursor`] | `{"ok":true}` or `{"ok":false,"error":"…"}` — where the pointer is, the direction of direct distance entry |
//! | [`Facade::preview`] | the running command's rubber band: `{"verts","prims","drag"}` (the display list's `verts`/`prims`; `drag` is `null` or `{"handles":[18,…],"matrix":[a,b,c,d,e,f],"clipboard":false}`), plus `error` when refused |
//! | [`Facade::pick`] | `{"handles":["1A",…],"hover":"1A"}` — what is under the pointer, nearest first, and the one of them a hover highlights (`null` when a click there selects nothing, or SELECTIONPREVIEW / PREVIEWFILTER keep it dark); the selection is untouched; plus `error` when refused |
//! | [`Facade::snap`] | `{"snap":null}` or `{"snap":{"point":[x,y],"mode":1,"name":"Endpoint","deferred":false}}`; plus `error` when refused |
//! | [`Facade::click`] | the command-line state plus `output`, `snap` (the object snap the point took, or `null`), `point` (the point the command was given, or `null`) and `error` when refused: a pointer click given to the running command, resolved as [`Facade::pointer`] resolves it |
//! | [`Facade::pointer`] | the pointer resolved for the running command (below), plus `error` when refused |
//!
//! # The resolved pointer
//!
//! [`Facade::pointer`] is the one call a canvas makes per frame while a command wants a point. It
//! runs the engine's own cursor resolution ([`Session::snap_cursor`]: running object snaps, grid
//! snap, polar and object-snap tracking, ortho) and replies
//!
//! ```json
//! {"point":[x,y],"constraint":"none"|"osnap"|"ortho"|"polar"|"grid"|"track",
//!  "snap":null|{"point":[x,y],"mode":1,"name":"Endpoint","deferred":false},
//!  "from":null|[x,y],"distance":null|4.25,"angle":null|45.0,"label":"Polar: 4.2500 < 45°",
//!  "paths":{"verts":[[x,y],…],"prims":[{"kind":"polyline","start":0,"len":2,…}]},
//!  "acquired":[[x,y],…],"wait":false,
//!  "preview":{"verts":[…],"prims":[…],"drag":null}}
//! ```
//!
//! * `point` is what the next [`Facade::click`] at the same place gives the command; `preview` is
//!   the rubber band drawn to it (the reply of [`Facade::preview`] at `point`).
//! * `from`, `distance` and `angle` say what an ortho, polar or tracking constraint is measured
//!   from and by (`angle` in degrees, in the drawing's own sense: from ANGBASE, by ANGDIR), and
//!   `label` is that sentence in the drawing's units, empty when there is nothing to say.
//! * `paths` are the constraint's rays (the ortho or polar ray from the base point, the alignment
//!   paths from acquired points) in the display list's `verts`/`prims` form, cut to the view.
//! * `acquired` are the points object-snap tracking holds, and `wait` asks for another call after
//!   the dwell even if the pointer rests (a point is being acquired).
//!
//! # Points and apertures
//!
//! [`Facade::preview`], [`Facade::pick`], [`Facade::snap`], [`Facade::click`], [`Facade::pointer`]
//! and [`Facade::set_cursor`] take a world point, refused unless both ordinates are finite and within
//! [`MAX_COORD`]. An aperture is a world distance: `0` means the engine's own box (PICKBOX or
//! APERTURE pixels at the current view and [`Facade::set_viewport`] size), a negative or
//! non-finite one is refused, and a larger one than a view may span is clamped.
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
use cadcraft_engine::snap::SnapHit;
use cadcraft_engine::snap::tracking::{CursorQuery, PathKind, PathShape, Track};
use cadcraft_engine::{Input, Session};
use cadcraft_geom::{Bounds2, Ellipse, TAU, Vec2};
use cadcraft_render::{DPrim, DisplayList, Kind, Options};
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

/// The largest ordinate a pointer call accepts. Past it a double no longer holds whole units, so
/// no pick, snap or rubber band there means anything; such a point is refused.
pub const MAX_COORD: f64 = 1e15;

/// The smallest canvas edge [`Facade::set_viewport`] keeps, in CSS pixels (a smaller positive
/// size is raised to it, so the engine's world-per-pixel never divides by nothing).
const MIN_VIEWPORT_PX: f64 = 1.0;

/// The largest canvas edge [`Facade::set_viewport`] keeps, in CSS pixels (past any real display;
/// a larger size is lowered to it).
const MAX_VIEWPORT_PX: f64 = 32_768.0;

/// Handles a [`Facade::pick`] reply carries: what is under a pointer is a handful of objects, and
/// a hostile aperture that covers the whole drawing must not serialize all of it every frame.
const MAX_PICK_HANDLES: usize = 64;

/// The latest time [`Facade::pointer`] accepts, in milliseconds: far past any page's lifetime, and
/// still a whole number of milliseconds in a double.
pub const MAX_TIME_MS: f64 = 1e15;

/// [`Facade::pointer`]'s `modifiers` bit for Shift held: it flips ortho while held, and acquires
/// tracking points when POLARMODE says Shift does.
pub const MODIFIER_SHIFT: u32 = 1;

/// [`Facade::pointer`]'s `modifiers` bit for Ctrl held: ARC's direction switch.
pub const MODIFIER_CTRL: u32 = 2;

/// Segments a tracking path along a circle (an arc's extension) is drawn with.
const TRACK_CIRCLE_SEGMENTS: u32 = 96;

/// Points a tracking path along an ellipse is drawn with, at most.
const MAX_TRACK_POINTS: usize = 2048;

/// Clipboard objects [`Facade::preview`] draws under the pointer while pasting. A larger
/// clipboard shows no objects (cloning and transforming it every frame would stall the pointer).
const MAX_PREVIEW_CLIPBOARD: usize = 512;

/// Bytes a dragged handle is estimated to take in a [`Facade::preview`] reply, for the size cap.
const HANDLE_BYTES: usize = 24;

/// How far a drawn curve may stand from the true one, in canvas pixels: a quarter of a pixel is
/// under what the eye resolves, so a circle reads round at any zoom the display list was built for.
const CURVE_TOLERANCE_PX: f64 = 0.25;

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

/// The command-line state, as the desktop control channel reports it, with what the pointer needs
/// of the prompt: `base` (the rubber band's origin, `[x,y]` or `null`), `corner` (the base is a
/// window's first corner, so ortho does not bend the other), `distance` (a point answers with its
/// distance from the base) and `deferred` (the prompt resolves deferred tangent and
/// perpendicular snaps).
fn cmdline_state(s: &Session) -> Value {
    let p = s.current_prompt();
    let base = p.as_ref().and_then(|p| p.base).filter(|b| b.is_finite());
    json!({
        "prompt": s.prompt_text(),
        "running": s.running.as_ref().map(|r| r.id.clone()),
        "keywords": p.as_ref().map(|p| p.keywords.clone()).unwrap_or_default(),
        "accept": p.as_ref().map(|p| p.accept),
        "default": p.as_ref().and_then(|p| p.default.clone()),
        "base": base.map(|b| [b.x, b.y]),
        "corner": p.as_ref().is_some_and(|p| p.corner),
        "distance": p.as_ref().is_some_and(|p| p.distance),
        "deferred": p.as_ref().is_some_and(|p| p.deferred),
    })
}

/// A world point a pointer call may use: both ordinates finite and within [`MAX_COORD`].
fn world_point(x: f64, y: f64) -> Result<Vec2, String> {
    if x.is_finite() && y.is_finite() && x.abs() <= MAX_COORD && y.abs() <= MAX_COORD {
        Ok(Vec2::new(x, y))
    } else {
        Err("the point is not a usable world coordinate".into())
    }
}

/// An aperture in world units: `0` takes `engine_default` (the engine's own box at the current
/// view), a negative or non-finite one is refused, and one larger than a view may span is clamped
/// to [`MAX_VIEW_SIZE`].
fn usable_aperture(aperture: f64, engine_default: f64) -> Result<f64, String> {
    if !aperture.is_finite() || aperture < 0.0 {
        return Err("the aperture must be a finite world distance, 0 or more".into());
    }
    let a = if aperture == 0.0 { engine_default } else { aperture };
    if a.is_finite() && a > 0.0 { Ok(a.min(MAX_VIEW_SIZE)) } else { Err("the view gives no usable aperture".into()) }
}

/// One object snap as a reply carries it: the snapped point, the OSMODE bit and its name
/// (`"Endpoint"`, `"Midpoint"`, `"Center"`…), and whether it is a deferred tangent or
/// perpendicular (its point is provisional until the line's other end is known).
fn snap_json(hit: &SnapHit) -> Value {
    json!({"point": [finite(hit.point.x), finite(hit.point.y)], "mode": hit.mode, "name": hit.name, "deferred": hit.deferred.is_some()})
}

/// The keys held during a pointer call.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Modifiers {
    shift: bool,
    ctrl: bool,
}

/// [`Facade::pointer`]'s `modifiers` argument: a whole number made only of [`MODIFIER_SHIFT`] and
/// [`MODIFIER_CTRL`]. Anything else (a fraction, a negative, an unknown bit, not a number) is
/// refused rather than guessed at.
fn usable_modifiers(bits: f64) -> Result<Modifiers, String> {
    let (shift, ctrl) = (f64::from(MODIFIER_SHIFT), f64::from(MODIFIER_CTRL));
    let both = shift + ctrl;
    if !(bits.is_finite() && (0.0..=both).contains(&bits) && bits.fract() == 0.0) {
        return Err("the modifiers must be 0 to 3: 1 for Shift, 2 for Ctrl".into());
    }
    Ok(Modifiers { shift: bits == shift || bits == both, ctrl: bits == ctrl || bits == both })
}

/// [`Facade::pointer`]'s clock, in seconds: the caller's milliseconds, refused unless finite, not
/// negative and within [`MAX_TIME_MS`].
fn usable_time(now_ms: f64) -> Result<f64, String> {
    if now_ms.is_finite() && (0.0..=MAX_TIME_MS).contains(&now_ms) {
        Ok(now_ms / 1000.0)
    } else {
        Err("the time must be finite milliseconds, 0 or more".into())
    }
}

/// What bent the pointer on its way to the point a click takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Constraint {
    /// Nothing: the point is where the pointer is.
    None,
    /// A running object snap.
    Osnap,
    /// Ortho: along the snap axes from the base point.
    Ortho,
    /// Polar tracking from the base point.
    Polar,
    /// Grid snap.
    Grid,
    /// Object-snap tracking: an alignment path, an extension, a parallel or a crossing of paths.
    Track,
}

impl Constraint {
    fn name(self) -> &'static str {
        match self {
            Constraint::None => "none",
            Constraint::Osnap => "osnap",
            Constraint::Ortho => "ortho",
            Constraint::Polar => "polar",
            Constraint::Grid => "grid",
            Constraint::Track => "track",
        }
    }
}

/// The pointer resolved for the running command: the point a click takes and why.
#[derive(Clone, Debug)]
struct Resolved {
    point: Vec2,
    constraint: Constraint,
    snap: Option<SnapHit>,
    track: Option<Track>,
    /// The prompt's base point, when it has one.
    base: Option<Vec2>,
    wait: bool,
}

impl Resolved {
    /// The pointer where it is: no command wants a point there.
    fn free(point: Vec2) -> Self {
        Resolved { point, constraint: Constraint::None, snap: None, track: None, base: None, wait: false }
    }

    /// The point a constraint is measured from, and the shapes to draw for it: the ortho ray from
    /// the base point, or each tracking path the point lies on.
    fn feedback(&self) -> Option<(Vec2, Vec<PathShape>)> {
        match self.constraint {
            Constraint::Ortho => {
                let base = self.base?;
                let dir = (self.point - base).normalized();
                let ray = (dir != Vec2::ZERO && dir.is_finite()).then_some(PathShape::Ray { origin: base, dir });
                Some((base, ray.into_iter().collect()))
            }
            Constraint::Polar | Constraint::Track => {
                let track = self.track.as_ref()?;
                let from = track.paths.first()?.from;
                Some((from, track.paths.iter().map(|p| p.shape).collect()))
            }
            Constraint::None | Constraint::Osnap | Constraint::Grid => None,
        }
    }
}

/// The points a tracking path is drawn through, cut to `view`: a ray or a line as the two points
/// of [`infinite_points`], a circle or an ellipse as a closed run. Empty when it cannot be drawn.
fn path_points(shape: &PathShape, view: Bounds2) -> Vec<Vec2> {
    if view.is_empty() {
        return Vec::new();
    }
    let pts: Vec<Vec2> = match *shape {
        PathShape::Ray { origin, dir } => infinite_points(&[origin, dir], view, true).to_vec(),
        PathShape::Line { origin, dir } => infinite_points(&[origin, dir], view, false).to_vec(),
        PathShape::Circle { center, radius, .. } => {
            (0..=TRACK_CIRCLE_SEGMENTS).map(|i| center + Vec2::from_angle(TAU * f64::from(i) / f64::from(TRACK_CIRCLE_SEGMENTS)) * radius).collect()
        }
        PathShape::Ellipse { center, major, ratio, .. } => {
            let mut pts = Vec::new();
            let tolerance = major.len() * 1e-3;
            if tolerance.is_finite() && tolerance > 0.0 {
                Ellipse::full(center, major, ratio).tessellate(tolerance, &mut pts);
                pts.truncate(MAX_TRACK_POINTS);
            }
            pts
        }
    };
    if pts.len() >= 2 && pts.iter().all(|p| p.is_finite()) { pts } else { Vec::new() }
}

/// The facade a JavaScript interface calls: one session, one view, JSON replies.
pub struct Facade {
    session: Session,
    /// The latest time [`Facade::pointer`] was given, in seconds. It only moves forward, so a
    /// caller whose clock steps back cannot un-rest a pointer that is acquiring a tracking point.
    clock: f64,
    /// The keys held at the last [`Facade::pointer`] call: a [`Facade::click`] resolves with them.
    modifiers: Modifiers,
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
        Facade { session, clock: 0.0, modifiers: Modifiers::default(), view: default_view(), space: Space::Model, engine_view }
    }

    /// The sample drawing `--sample` opens: the mechanical bracket, in model space, fitted.
    pub fn sample() -> Self {
        install_host_hooks();
        let mut session = Session::empty();
        session.open_drawing(cadcraft_engine::sample::default_sample(), "Bracket", None);
        let engine_view = session.state().map(|st| st.view()).unwrap_or_default();
        let mut facade = Facade { session, clock: 0.0, modifiers: Modifiers::default(), view: default_view(), space: Space::Model, engine_view };
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
        self.cmdline_reply(before, error)
    }

    /// The reply `cmdline`, `start` and `cancel` share: the command-line state after the call,
    /// the `output` lines the log gained since it held `before` lines, and `error` when the call
    /// was refused.
    fn cmdline_reply(&mut self, before: usize, error: Option<String>) -> String {
        self.cmdline_value(before, error).to_string()
    }

    /// [`Facade::cmdline_reply`] before it is written out, for a reply that adds a field.
    fn cmdline_value(&mut self, before: usize, error: Option<String>) -> Value {
        self.refresh();
        // The prompt may have changed under the pointer: the deferred snap it hovered belongs to
        // the old one, and tracking points are a command's, forgotten when none runs.
        self.session.cursor_deferred = None;
        if self.session.running.is_none() {
            self.session.tracking.clear();
            self.session.ctrl_down = false;
        }
        let mut v = cmdline_state(&self.session);
        let out: Vec<String> = self.session.log.iter().skip(before).take(MAX_OUTPUT).cloned().collect();
        if let Some(o) = v.as_object_mut() {
            o.insert("output".into(), json!(out));
            if let Some(e) = error {
                o.insert("error".into(), json!(e));
            }
        }
        v
    }

    /// Cancel the running command, exactly as Escape does ([`Session::cancel`]): the command
    /// ends with `*Cancel*` in the output and what it had already drawn stays as one undo step;
    /// inside a transparent command, both it and the command it interrupted end. With no command
    /// running it clears the selection. The reply has the shape `cmdline` and `start` reply; a
    /// cancel is never refused, so it carries no `error`.
    pub fn cancel(&mut self) -> String {
        let before = self.session.log.len();
        self.session.cancel();
        self.cmdline_reply(before, None)
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
        self.cmdline_reply(before, error)
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
            // What the assistant's briefing names: the drawing's units in words (`INSUNITS`).
            "units": cadcraft_engine::units::name(st.doc.header.i64("INSUNITS", 1)),
            // The undo stack's depth: the checkpoint the assistant records before a request
            // and hands back to `undoto`.
            "undoDepth": st.undo.len(),
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
        let (verts, prims) = match self.list_json(&list, window, 0) {
            Ok(parts) => parts,
            Err(e) => return error_only(e),
        };
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

    /// The `verts` and `prims` of a display list as the module documentation describes them,
    /// culled to `window` (an infinite line is cut to it). `reserved` is what the reply already
    /// holds, in bytes; past [`MAX_DISPLAY_BYTES`] the list is refused rather than built.
    fn list_json(&self, list: &DisplayList, window: Bounds2, reserved: usize) -> Result<(Vec<Value>, Vec<Value>), String> {
        let mut verts: Vec<Value> = Vec::new();
        let mut prims: Vec<Value> = Vec::new();
        let mut estimate = reserved;
        for p in &list.prims {
            let pts = list.points(p);
            if pts.is_empty() || !self.prim_visible(p, pts, window) {
                continue;
            }
            let cut: [Vec2; 2];
            let points: &[Vec2] = match p.kind {
                Kind::Infinite { ray } => {
                    cut = infinite_points(pts, window, ray);
                    &cut
                }
                _ => pts,
            };
            estimate = estimate.saturating_add(points.len().saturating_mul(VERTEX_BYTES)).saturating_add(PRIM_BYTES);
            if estimate > MAX_DISPLAY_BYTES {
                return Err("the drawing is too large for the display list".into());
            }
            let start = verts.len();
            verts.extend(points.iter().map(|q| json!([finite(q.x), finite(q.y)])));
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
        Ok((verts, prims))
    }

    /// Tell the engine the canvas's size in CSS pixels, which is what turns PICKBOX and APERTURE
    /// (pixels) into world distances and gives ZOOM its aspect. Call it when the canvas is laid
    /// out or resized. Replies `{"ok":true,"viewport":[w,h]}` with the size kept (each edge
    /// brought into `1..=32768`), or an error for a size that is not finite or not positive (a
    /// hidden canvas measures 0: the last real size stays).
    pub fn set_viewport(&mut self, width: f64, height: f64) -> String {
        if !(width.is_finite() && height.is_finite()) {
            return error_reply("the canvas size is not finite");
        }
        if width <= 0.0 || height <= 0.0 {
            return error_reply("the canvas size must be positive");
        }
        let size = (width.clamp(MIN_VIEWPORT_PX, MAX_VIEWPORT_PX), height.clamp(MIN_VIEWPORT_PX, MAX_VIEWPORT_PX));
        self.session.viewport_px = size;
        json!({"ok": true, "viewport": [size.0, size.1]}).to_string()
    }

    /// Tell the engine where the pointer is, in world coordinates. A distance typed alone at a
    /// point prompt (`5`) goes that far from the last point towards it (direct distance entry).
    /// Replies `{"ok":true}`, or an error for a point that is not usable (the cursor stays).
    pub fn set_cursor(&mut self, x: f64, y: f64) -> String {
        match world_point(x, y) {
            Ok(p) => {
                self.session.cursor = p;
                json!({"ok": true}).to_string()
            }
            Err(e) => error_reply(e),
        }
    }

    /// The running command's rubber band with the pointer at a world point, as the display
    /// list's `verts` and `prims` (the module documentation; the handle of rubber-band geometry
    /// is 0), built for the current view from the preview's own few objects, never the drawing.
    ///
    /// `drag` is `null`, or says the preview is also existing objects under one transform (MOVE,
    /// COPY, ROTATE, SCALE, MIRROR): `{"handles":[18,…],"matrix":[a,b,c,d,e,f],"clipboard":false}`.
    /// `handles` are the display list's `prims[].handle` numbers and `matrix` maps a world point
    /// `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)` (a canvas `transform(a,b,c,d,e,f)`), so the
    /// canvas redraws primitives it already holds instead of receiving their copies each frame.
    /// While pasting (`clipboard` true) the objects are not in the drawing yet, so they arrive in
    /// `prims`, already placed.
    ///
    /// With no command running, or one that draws nothing, `verts` and `prims` are empty. A
    /// point that is not usable, or a preview past [`MAX_DISPLAY_BYTES`], replies the empty
    /// preview with `error`. Nothing changes in the session.
    ///
    /// A deferred tangent or perpendicular under the pointer, and Ctrl held, are what the last
    /// [`Facade::pointer`] call saw: that call replies this preview at the point it resolved.
    pub fn preview(&self, x: f64, y: f64) -> String {
        match world_point(x, y).and_then(|cursor| self.preview_at(cursor)) {
            Ok(v) => v.to_string(),
            Err(e) => json!({"verts": [], "prims": [], "drag": null, "error": e}).to_string(),
        }
    }

    fn preview_at(&self, cursor: Vec2) -> Result<Value, String> {
        let empty = || json!({"verts": [], "prims": [], "drag": null});
        let Ok(st) = self.session.state() else { return Ok(empty()) };
        let (entities, drag) = match self.session.drag(cursor) {
            Some((drag, mut extra)) => {
                if drag.clipboard && self.session.clipboard.len() <= MAX_PREVIEW_CLIPBOARD {
                    extra.extend(self.session.clipboard.iter().map(|e| {
                        let mut placed = e.clone();
                        placed.kind.transform(&drag.matrix);
                        placed
                    }));
                }
                (extra, Some(drag))
            }
            None => (self.session.preview(cursor), None),
        };
        // A transform that is not finite (a degenerate reference length) cannot be drawn or
        // carried by JSON: the rubber band shows without the dragged objects.
        let drag = drag.filter(|d| {
            let m = d.matrix;
            [m.a, m.b, m.c, m.d, m.e, m.f].iter().all(|v| v.is_finite())
        });
        if entities.is_empty() && drag.is_none() {
            return Ok(empty());
        }
        let reserved = drag.as_ref().map_or(0, |d| d.handles.len().saturating_mul(HANDLE_BYTES));
        let list = cadcraft_render::build_entities(&st.doc, &entities, &self.build_options_for(self.view));
        let (verts, prims) = self.list_json(&list, self.view, reserved)?;
        let drag = drag.map(|d| {
            let m = d.matrix;
            json!({
                "handles": d.handles.iter().map(|h| h.0).collect::<Vec<u64>>(),
                "matrix": [m.a, m.b, m.c, m.d, m.e, m.f],
                "clipboard": d.clipboard,
            })
        });
        Ok(json!({"verts": verts, "prims": prims, "drag": drag}))
    }

    /// What is under the pointer at a world point, nearest first (the first is what a click
    /// there selects): `{"handles":["1A",…]}`, the handles as [`Facade::selection`] writes them
    /// (a hostile aperture's list is cut short). It only looks: the selection, the undo stack and the drawing are untouched,
    /// whatever command is running. `aperture` is the reach in world units (`0`: the engine's own
    /// pick box, PICKBOX pixels at the current view and canvas size). No drawing, or nothing
    /// there, replies no handles; a point or aperture that is not usable replies none with
    /// `error`.
    ///
    /// `hover` is the one of them to highlight under the pointer, or `null`: the first handle
    /// (what a click selects) while a click there selects at all (at rest with PICKFIRST on, or
    /// at a prompt that picks objects: [`Session::previews_selection`], which also reads
    /// SELECTIONPREVIEW), unless PREVIEWFILTER keeps that object dark (by default one on a locked
    /// layer, or an external reference). Objects on frozen or off layers are never in `handles`.
    pub fn pick(&self, x: f64, y: f64, aperture: f64) -> String {
        match self.pick_handles(x, y, aperture) {
            Ok((handles, hover)) => json!({"handles": handles, "hover": hover}).to_string(),
            Err(e) => json!({"handles": [], "hover": null, "error": e}).to_string(),
        }
    }

    /// The handles under a point, nearest first, and the one a hover highlights.
    fn pick_handles(&self, x: f64, y: f64, aperture: f64) -> Result<(Vec<String>, Option<String>), String> {
        let p = world_point(x, y)?;
        let s = &self.session;
        let reach = usable_aperture(aperture, s.pixel_size() * s.settings.pickbox.max(1.0) * 1.5)?;
        let Ok(st) = s.state() else { return Ok((Vec::new(), None)) };
        let hits = cadcraft_engine::select::pick_all(&st.doc, &st.edit_space(), p, reach);
        let hover = hits
            .first()
            .filter(|_| s.previews_selection())
            .filter(|h| st.doc.entity(**h).is_some_and(|e| !cadcraft_engine::select::preview_filtered(&st.doc, e, s.settings.previewfilter)))
            .map(|h| h.hex());
        Ok((hits.into_iter().take(MAX_PICK_HANDLES).map(|h| h.hex()).collect(), hover))
    }

    /// The object snap the pointer takes at a world point, by the engine's own `osnap` with its
    /// running snap modes (OSMODE, OSNAPHATCH) and the prompt's base point (which tangent and
    /// perpendicular need): `{"snap":{"point":[x,y],"mode":1,"name":"Endpoint","deferred":false}}`,
    /// or `{"snap":null}` when nothing snaps, object snap is off, there is no drawing, or the
    /// running command's prompt is not asking for a point. `mode` is the OSMODE bit. `aperture`
    /// is the reach in world units (`0`: the engine's own, APERTURE pixels at the current view and
    /// canvas size). A point or aperture that is not usable replies `null` with `error`. Nothing
    /// changes in the session. It is the object-snap part alone of what [`Facade::pointer`]
    /// resolves (no grid snap, tracking or ortho), kept for a caller that only marks snaps.
    pub fn snap(&self, x: f64, y: f64, aperture: f64) -> String {
        match self.snap_hit(x, y, aperture) {
            Ok(hit) => json!({"snap": hit.as_ref().map(snap_json)}).to_string(),
            Err(e) => json!({"snap": null, "error": e}).to_string(),
        }
    }

    /// The snap query [`Facade::snap`] reports.
    fn snap_hit(&self, x: f64, y: f64, aperture: f64) -> Result<Option<SnapHit>, String> {
        let p = world_point(x, y)?;
        let s = &self.session;
        let reach = self.snap_reach(aperture)?;
        let Ok(st) = s.state() else { return Ok(None) };
        let prompt = s.current_prompt();
        // A prompt that selects objects, or takes only typed input, does not snap its clicks.
        if prompt.as_ref().is_some_and(|p| !p.accept.point || p.picks_objects()) {
            return Ok(None);
        }
        let hatch = if s.settings.osnaphatch { cadcraft_engine::snap::mode::HATCH } else { 0 };
        let base = prompt.as_ref().and_then(|p| p.base);
        let deferred = prompt.as_ref().is_some_and(|p| p.deferred);
        Ok(cadcraft_engine::snap::osnap(&st.doc, &st.edit_space(), p, reach, s.settings.osmode | hatch, base, deferred))
    }

    /// Resolve the pointer for the running command, as the engine's own canvas does each frame
    /// ([`Session::snap_cursor`]): running object snaps first, then grid snap, then polar and
    /// object-snap tracking paths, then ortho. The reply (the module documentation, "The resolved
    /// pointer") carries the point the next [`Facade::click`] there takes, what bent it, the
    /// constraint's rays to draw, and the rubber band at that point.
    ///
    /// `aperture` is the reach in world units, of the object snap and of a tracking path alike
    /// (`0`: the engine's own, APERTURE pixels at the current view and canvas size). `now_ms` is
    /// any steady clock in milliseconds (`performance.now()`): resting on a snap point for the
    /// engine's dwell acquires it for tracking. `modifiers` is [`MODIFIER_SHIFT`] and
    /// [`MODIFIER_CTRL`] added together: Shift flips ortho while held, Ctrl switches ARC's
    /// direction.
    ///
    /// It moves the engine's cursor to the resolved point (the direction of direct distance
    /// entry) and keeps the tracking points; the drawing, the selection and the prompt are
    /// untouched. With no command running, or one whose prompt does not take a point, the pointer
    /// is free: `point` is the pointer itself. A point, aperture, time or modifiers that is not
    /// usable is refused with `error` and a `null` point, and nothing changes.
    pub fn pointer(&mut self, x: f64, y: f64, aperture: f64, now_ms: f64, modifiers: f64) -> String {
        match self.pointer_value(x, y, aperture, now_ms, modifiers) {
            Ok(v) => v.to_string(),
            Err(e) => json!({
                "point": null, "constraint": Constraint::None.name(), "snap": null, "from": null, "distance": null, "angle": null,
                "label": "", "paths": {"verts": [], "prims": []}, "acquired": [], "wait": false,
                "preview": {"verts": [], "prims": [], "drag": null}, "error": e,
            })
            .to_string(),
        }
    }

    fn pointer_value(&mut self, x: f64, y: f64, aperture: f64, now_ms: f64, modifiers: f64) -> Result<Value, String> {
        let raw = world_point(x, y)?;
        let reach = self.snap_reach(aperture)?;
        let now = usable_time(now_ms)?;
        let held = usable_modifiers(modifiers)?;
        self.clock = self.clock.max(now);
        self.modifiers = held;
        let r = self.resolve(raw, reach);
        let feedback = r.feedback();
        let (mut verts, mut prims): (Vec<Value>, Vec<Value>) = (Vec::new(), Vec::new());
        for shape in feedback.iter().flat_map(|(_, shapes)| shapes) {
            let pts = path_points(shape, self.view);
            if pts.is_empty() {
                continue;
            }
            prims.push(
                json!({"kind": "polyline", "start": verts.len(), "len": pts.len(), "color": [255, 255, 255], "lw": 0.0, "alpha": 255, "handle": 0}),
            );
            verts.extend(pts.iter().map(|q| json!([q.x, q.y])));
        }
        let from = feedback.as_ref().map(|(from, _)| *from).filter(|f| f.is_finite());
        let measure = from.map(|f| (f.dist(r.point), self.user_angle(f.angle_to(r.point)))).filter(|(d, a)| d.is_finite() && a.is_finite());
        let acquired: Vec<Value> =
            self.session.tracking.acquired.iter().map(|a| a.at()).filter(|p| p.is_finite()).map(|p| json!([p.x, p.y])).collect();
        // A rubber band too large to send is not drawn; the point is still the point.
        let preview = self.preview_at(r.point).unwrap_or_else(|_| json!({"verts": [], "prims": [], "drag": null}));
        Ok(json!({
            "point": [r.point.x, r.point.y],
            "constraint": r.constraint.name(),
            "snap": r.snap.as_ref().map(snap_json),
            "from": from.map(|f| [f.x, f.y]),
            "distance": measure.map(|(d, _)| d),
            "angle": measure.map(|(_, a)| a.to_degrees()),
            "label": self.constraint_label(&r),
            "paths": {"verts": verts, "prims": prims},
            "acquired": acquired,
            "wait": r.wait,
            "preview": preview,
        }))
    }

    /// The reach of an object snap or a tracking path, in world units ([`usable_aperture`] over
    /// the engine's APERTURE pixels at the current view).
    fn snap_reach(&self, aperture: f64) -> Result<f64, String> {
        let s = &self.session;
        usable_aperture(aperture, s.pixel_size() * s.settings.aperture.max(1.0))
    }

    /// A world direction (radians) as the drawing counts angles: from ANGBASE, clockwise when
    /// ANGDIR says so, in `0..2π`.
    fn user_angle(&self, world: f64) -> f64 {
        let a = self.session.angle_settings();
        let turned = world - if a.angbase.is_finite() { a.angbase } else { 0.0 };
        cadcraft_geom::norm_angle(if a.clockwise { -turned } else { turned })
    }

    /// What a constraint says beside the pointer, in the drawing's own units: `Polar: 4.2500 <
    /// 45°` for one path (ortho, polar, an alignment path), the paths' names and angles where two
    /// cross, the crossing's name where a path meets an object. Empty for a free pointer, an
    /// object snap (its own name is the label) and grid snap.
    fn constraint_label(&self, r: &Resolved) -> String {
        let header = self.session.doc().ok().map(|d| &d.header);
        let (lunits, luprec) = header.map_or((2, 4), |h| (h.i64("LUNITS", 2), h.i64("LUPREC", 4)));
        let (aunits, auprec) = header.map_or((0, 0), |h| (h.i64("AUNITS", 0), h.i64("AUPREC", 0)));
        let angle = |from: Vec2| {
            let text = cadcraft_engine::units::format_angle(self.user_angle(from.angle_to(r.point)), aunits, auprec);
            if aunits == 0 { format!("{text}°") } else { text }
        };
        let one = |name: &str, from: Vec2| {
            let distance = cadcraft_engine::units::format_distance(finite(from.dist(r.point)), lunits, luprec);
            format!("{name}: {distance} < {}", angle(from))
        };
        match (r.constraint, &r.track, r.base) {
            (Constraint::Ortho, _, Some(base)) => one("Ortho", base),
            (Constraint::Polar | Constraint::Track, Some(track), _) => match (track.object, track.paths.as_slice()) {
                (Some(object), [path, ..]) => format!("{}: {object}", path.name),
                (None, [path]) => one(path.name, path.from),
                (_, paths) => paths.iter().map(|p| format!("{}: < {}", p.name, angle(p.from))).collect::<Vec<_>>().join(", "),
            },
            _ => String::new(),
        }
    }

    /// The one resolution [`Facade::pointer`] reports and [`Facade::click`] feeds, so the point a
    /// person is shown is the point the command gets: the engine's [`Session::snap_cursor`] at the
    /// prompt's base point, with the last clock and modifiers [`Facade::pointer`] was given. It
    /// moves the engine's cursor to the point, and tells it the deferred snap under the pointer
    /// and whether Ctrl is held (what a rubber band reads). A prompt that selects objects or takes
    /// only typed input, and no prompt at all, leave the pointer free and forget tracking points.
    fn resolve(&mut self, raw: Vec2, reach: f64) -> Resolved {
        let prompt = self.session.current_prompt().filter(|p| p.accept.point && !p.picks_objects());
        self.session.ctrl_down = self.modifiers.ctrl;
        let Some(prompt) = prompt.filter(|_| self.session.state().is_ok()) else {
            self.session.tracking.clear();
            self.session.cursor_deferred = None;
            self.session.cursor = raw;
            return Resolved::free(raw);
        };
        let base = prompt.base.filter(|b| b.is_finite());
        let shift = self.modifiers.shift;
        let query = CursorQuery { base, deferred: prompt.deferred, corner: prompt.corner, aperture: reach, tol: reach, now: self.clock, shift };
        let cursor = self.session.snap_cursor(raw, &query);
        // A resolved point no pointer call would take (a hostile drawing's geometry) is not used.
        if world_point(cursor.point.x, cursor.point.y).is_err() {
            self.session.cursor_deferred = None;
            self.session.cursor = raw;
            return Resolved { base, wait: cursor.wait, ..Resolved::free(raw) };
        }
        let settings = &self.session.settings;
        let constraint = match (&cursor.snap, &cursor.track) {
            (Some(_), _) => Constraint::Osnap,
            (None, Some(track)) if track.paths.iter().all(|p| p.kind == PathKind::Polar) => Constraint::Polar,
            (None, Some(_)) => Constraint::Track,
            // What `snap_cursor` does past its tracking paths: ortho from a base point that is not
            // a window's corner (Shift flips it), over grid snap.
            (None, None) if (settings.orthomode ^ shift) && base.is_some() && !prompt.corner => Constraint::Ortho,
            (None, None) if settings.snapmode && !settings.polarsnap => Constraint::Grid,
            (None, None) => Constraint::None,
        };
        self.session.cursor = cursor.point;
        self.session.cursor_deferred = cursor.snap.and_then(|h| h.deferred);
        Resolved { point: cursor.point, constraint, snap: cursor.snap, track: cursor.track, base, wait: cursor.wait }
    }

    /// A pointer click at a world point, given to the running command as the desktop gives it:
    /// resolved as [`Facade::pointer`] reports it (object snap, grid snap, tracking, ortho, with
    /// the clock and modifiers of the last such call), then fed through
    /// [`Session::input_snapped`] when an object snap took it (which is what carries a deferred
    /// tangent or perpendicular and a layout viewport's own coordinates: typed coordinates
    /// cannot), else as the point. At "Select objects" the point picks or opens a window, as a
    /// click does. The engine's cursor moves there too. With no command running the click does
    /// nothing (selecting at rest is the `select` command).
    ///
    /// The reply has the shape `cmdline` replies, plus `snap` (the object snap the point took, or
    /// `null`) and `point` (the point given, or `null`). A point or aperture that is not usable is
    /// refused with `error` and nothing is fed.
    pub fn click(&mut self, x: f64, y: f64, aperture: f64) -> String {
        let before = self.session.log.len();
        let mut error = None;
        let (mut snapped, mut taken) = (Value::Null, Value::Null);
        match (world_point(x, y), self.snap_reach(aperture)) {
            (Ok(p), Ok(reach)) => {
                let r = self.resolve(p, reach);
                taken = json!([r.point.x, r.point.y]);
                let fed = match r.snap {
                    Some(h) => {
                        snapped = snap_json(&h);
                        self.session.input_snapped(h)
                    }
                    None => self.session.input(Input::Point(r.point)),
                };
                if let Err(e) = fed {
                    let m = e.to_string();
                    self.session.echo(m.clone());
                    error = Some(m);
                }
            }
            (Err(e), _) | (_, Err(e)) => error = Some(e),
        }
        let mut v = self.cmdline_value(before, error);
        if let Some(o) = v.as_object_mut() {
            o.insert("snap".into(), snapped);
            o.insert("point".into(), taken);
        }
        v.to_string()
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

    /// The build options for the current view: level of detail from the size of a canvas pixel in
    /// the view (the canvas's real height, from `setViewport`), the view as the pattern-generation window, and
    /// transparency on so `alpha` is meaningful.
    /// The build options for a window: level of detail from the size of a canvas pixel in the
    /// view on screen (the canvas's real height, from `setViewport`), the window as the pattern-generation window, and
    /// transparency on so `alpha` is meaningful.
    fn build_options_for(&self, window: Bounds2) -> Options {
        let height = window.height().max(MIN_VIEW_SIZE);
        // One canvas pixel in drawing units: the view on screen over the canvas's real height (the
        // window built for may be the view padded by a margin, which is not what a pixel spans).
        let canvas_px = finite(self.session.viewport_px.1).max(1.0);
        let px = (self.view.height().max(MIN_VIEW_SIZE) / canvas_px).clamp(1e-9, 1e9);
        Options {
            tolerance: px * CURVE_TOLERANCE_PX,
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

        #[wasm_bindgen(js_name = cancel)]
        pub fn cancel(&mut self) -> String {
            self.0.cancel()
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

        #[wasm_bindgen(js_name = setViewport)]
        pub fn set_viewport(&mut self, width: f64, height: f64) -> String {
            self.0.set_viewport(width, height)
        }

        #[wasm_bindgen(js_name = setCursor)]
        pub fn set_cursor(&mut self, x: f64, y: f64) -> String {
            self.0.set_cursor(x, y)
        }

        #[wasm_bindgen(js_name = preview)]
        pub fn preview(&self, x: f64, y: f64) -> String {
            self.0.preview(x, y)
        }

        #[wasm_bindgen(js_name = pick)]
        pub fn pick(&self, x: f64, y: f64, aperture: f64) -> String {
            self.0.pick(x, y, aperture)
        }

        #[wasm_bindgen(js_name = snap)]
        pub fn snap(&self, x: f64, y: f64, aperture: f64) -> String {
            self.0.snap(x, y, aperture)
        }

        #[wasm_bindgen(js_name = pointer)]
        pub fn pointer(&mut self, x: f64, y: f64, aperture: f64, now_ms: f64, modifiers: f64) -> String {
            self.0.pointer(x, y, aperture, now_ms, modifiers)
        }

        #[wasm_bindgen(js_name = click)]
        pub fn click(&mut self, x: f64, y: f64, aperture: f64) -> String {
            self.0.click(x, y, aperture)
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
    fn state_names_the_undo_depth_and_undoto_returns_to_it() {
        let mut f = Facade::new();
        assert_eq!(parse(&f.state())["undoDepth"].as_u64(), Some(0), "a new drawing has no history");
        let drawn = parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#));
        assert_eq!(drawn["ok"].as_bool(), Some(true), "circle: {drawn}");
        let after = parse(&f.state())["undoDepth"].as_u64();
        assert!(after.is_some_and(|n| n > 0), "drawing adds history: {after:?}");
        let back = parse(&f.execute("undoto", r#"{"depth":0}"#));
        assert_eq!(back["ok"].as_bool(), Some(true), "undoto: {back}");
        assert_eq!(parse(&f.state())["undoDepth"].as_u64(), Some(0));
        assert_eq!(parse(&f.state())["entityCount"].as_u64(), Some(0));
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
    fn cancel_ends_the_running_command_and_enter_repeats_it() {
        let mut f = Facade::new();
        let started = parse(&f.start("circle"));
        assert_eq!(started["running"].as_str(), Some("circle"), "{started}");
        let centre = parse(&f.cmdline("0,0"));
        assert_eq!(centre["running"].as_str(), Some("circle"), "{centre}");
        let cancelled = parse(&f.cancel());
        assert!(cancelled["running"].is_null(), "nothing runs after a cancel: {cancelled}");
        assert!(cancelled.get("error").is_none(), "a cancel is never refused: {cancelled}");
        let output: Vec<&str> = cancelled["output"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert_eq!(output, ["*Cancel*"], "the cancel adds one line, and no other command's echo: {cancelled}");
        assert_eq!(entity_count(&f), 0, "the cancelled circle was not drawn");
        // The engine's own empty Enter repeats the command the user ran, not a stand-in.
        let repeated = parse(&f.cmdline(""));
        assert_eq!(repeated["running"].as_str(), Some("circle"), "{repeated}");
        // A command typed at the command line is cancelled the same way.
        assert!(parse(&f.cancel())["running"].is_null());
        assert_eq!(parse(&f.cmdline("line 0,0 1,0 2,0"))["running"].as_str(), Some("line"));
        let kept = parse(&f.cancel());
        assert!(kept["running"].is_null(), "{kept}");
        assert_eq!(entity_count(&f), 2, "what LINE had drawn stays: {kept}");
    }

    #[test]
    fn cancel_with_nothing_running_clears_the_selection_and_never_fails() {
        let mut f = Facade::new();
        let drawn = parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#));
        let handle = drawn["result"]["handle"].as_str().unwrap();
        assert_eq!(parse(&f.execute("select", &json!({ "handles": [handle] }).to_string()))["ok"], json!(true));
        assert_eq!(parse(&f.selection())["count"].as_u64(), Some(1));
        let idle = parse(&f.cancel());
        assert!(idle["running"].is_null(), "{idle}");
        assert!(idle.get("error").is_none(), "{idle}");
        assert_eq!(parse(&f.selection())["count"].as_u64(), Some(0), "Escape with no command clears the selection");
        assert_eq!(entity_count(&f), 1, "and leaves the drawing alone");
        // Repeated cancels on an idle, empty session are harmless.
        let mut empty = Facade::new();
        for _ in 0..3 {
            assert!(parse(&empty.cancel())["running"].is_null());
        }
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

    /// The assistant's one tool, end to end in wasm: `run` evaluates code in the drawing's
    /// namespace, and code can draw through `(cmd …)`. The browser's assistant loop depends on
    /// exactly this: the same command the desktop pane and MCP call.
    #[test]
    fn the_run_command_works_in_the_wasm_facade() {
        let mut f = Facade::sample();
        let before = parse(&f.state())["entityCount"].as_u64().unwrap();
        // Arithmetic: the interpreter answers.
        let r = parse(&f.execute("run", r#"{"code":"(+ 1 2)"}"#));
        assert_eq!(r["ok"], json!(true), "{r}");
        assert_eq!(r["result"]["value"], json!("3"), "{r}");
        // Drawing: `(cmd …)` reaches the engine, and the state reflects it.
        let r = parse(&f.execute("run", r#"{"code":"(cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5)))"}"#));
        assert_eq!(r["ok"], json!(true), "{r}");
        assert_eq!(parse(&f.state())["entityCount"].as_u64().unwrap(), before + 1);
        // Empty code returns the manual (the namespace's own words).
        let r = parse(&f.execute("run", "{}"));
        assert!(r["result"]["manual"].as_str().is_some_and(|m| m.contains("cmd")), "the manual names the namespace");
        // A failure is reported, not a panic.
        let r = parse(&f.execute("run", r#"{"code":"(no-such-fn 1)"}"#));
        assert_eq!(r["ok"], json!(true), "a LISP error is a report: {r}");
        assert!(r["result"]["error"].as_str().is_some(), "{r}");
    }

    /// A facade with no drawing at all (the tolerant replies of `selection`/`format_point`).
    fn empty_facade() -> Facade {
        Facade {
            session: Session::empty(),
            clock: 0.0,
            modifiers: Modifiers::default(),
            view: default_view(),
            space: Space::Model,
            engine_view: cadcraft_engine::View::default(),
        }
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

    /// A facade on an empty drawing holding one line from (0,0) to (10,0), viewed 20 units tall
    /// on a 1000 px canvas: 0.02 world units per pixel.
    fn line_facade() -> Facade {
        let mut f = Facade::new();
        assert_eq!(parse(&f.execute("line", r#"{"points":[[0,0],[10,0]]}"#))["ok"], json!(true));
        assert_eq!(parse(&f.set_view(-5.0, -10.0, 15.0, 10.0))["ok"], json!(true));
        assert_eq!(parse(&f.set_viewport(1000.0, 1000.0))["ok"], json!(true));
        f
    }

    /// Everything a read-only call must leave alone.
    fn fingerprint(f: &Facade) -> (String, String, String, String) {
        (f.digest(), f.state(), f.selection(), f.prompt())
    }

    fn point_of(v: &Value) -> (f64, f64) {
        (v[0].as_f64().unwrap(), v[1].as_f64().unwrap())
    }

    /// Numbers no pointer produces: every pointer call must refuse or tame them.
    const HOSTILE: [f64; 8] = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e308, -1e308, f64::MAX, f64::MIN, 1e300];

    #[test]
    fn the_prompt_state_carries_the_base_corner_and_distance() {
        let mut f = Facade::new();
        let idle = parse(&f.prompt());
        assert!(idle["base"].is_null(), "{idle}");
        assert_eq!((&idle["corner"], &idle["distance"], &idle["deferred"]), (&json!(false), &json!(false), &json!(false)), "{idle}");
        let first = parse(&f.start("line"));
        assert!(first["base"].is_null(), "the first point has no base: {first}");
        let next = parse(&f.cmdline("2,3"));
        assert_eq!(next["base"], json!([2.0, 3.0]), "the rubber band starts at the last point: {next}");
        assert_eq!(next["corner"], json!(false), "{next}");
        f.cancel();
        f.start("circle");
        let radius = parse(&f.cmdline("1,1"));
        assert_eq!(radius["base"], json!([1.0, 1.0]), "{radius}");
        assert_eq!(radius["distance"], json!(true), "a radius is a distance from the centre: {radius}");
        f.cancel();
        f.start("rectang");
        let other = parse(&f.cmdline("4,5"));
        assert_eq!(other["base"], json!([4.0, 5.0]), "{other}");
        assert_eq!(other["corner"], json!(true), "the base is a rectangle's first corner: {other}");
        // `prompt()` reports the same fields as the `cmdline` reply.
        assert_eq!(parse(&f.prompt())["corner"], json!(true));
    }

    #[test]
    fn preview_is_the_rubber_band_and_changes_nothing() {
        let mut f = line_facade();
        let idle = parse(&f.preview(1.0, 1.0));
        assert_eq!(idle, json!({"verts": [], "prims": [], "drag": null}), "no command, no preview");
        f.start("line");
        assert_eq!(parse(&f.preview(1.0, 1.0))["prims"], json!([]), "no first point yet, no band");
        f.cmdline("0,5");
        let before = fingerprint(&f);
        let band = parse(&f.preview(4.0, 7.0));
        assert_eq!(fingerprint(&f), before, "a preview only looks");
        let verts: Vec<(f64, f64)> = band["verts"].as_array().unwrap().iter().map(point_of).collect();
        assert!(verts.contains(&(0.0, 5.0)) && verts.contains(&(4.0, 7.0)), "the band runs from the base to the pointer: {band}");
        let prims = band["prims"].as_array().unwrap();
        assert!(!prims.is_empty(), "{band}");
        for p in prims {
            assert!(matches!(p["kind"].as_str(), Some("polyline" | "tris" | "point" | "image")), "the display list's own shape: {p}");
            let (start, len) = (p["start"].as_u64().unwrap(), p["len"].as_u64().unwrap());
            assert!(start + len <= verts.len() as u64, "the range is inside verts: {p}");
            assert_eq!(p["handle"], json!(0), "rubber-band geometry has no handle: {p}");
        }
        assert!(band["drag"].is_null(), "{band}");
        // The band follows the pointer.
        assert_ne!(parse(&f.preview(-3.0, 2.0)), band);
        // A point far outside the view still answers a well-formed preview.
        assert!(parse(&f.preview(1.0e9, 1.0e9))["prims"].is_array());
        assert_eq!(entity_count(&f), 1, "nothing was drawn");
    }

    #[test]
    fn preview_of_a_move_is_a_transform_of_the_objects() {
        let mut f = line_facade();
        let handle = parse(&f.execute("select", r#"{"at":[5,0],"aperture":0.5}"#))["result"]["handles"][0].as_str().unwrap().to_string();
        f.start("move");
        let asked = parse(&f.cmdline("0,0"));
        assert_eq!(asked["running"], json!("move"), "{asked}");
        let before = fingerprint(&f);
        let p = parse(&f.preview(3.0, 4.0));
        assert_eq!(fingerprint(&f), before, "a preview only looks");
        let drag = &p["drag"];
        assert_eq!(drag["matrix"], json!([1.0, 0.0, 0.0, 1.0, 3.0, 4.0]), "a translation by the pointer's offset: {p}");
        assert_eq!(drag["clipboard"], json!(false), "{p}");
        let dragged: Vec<String> = drag["handles"].as_array().unwrap().iter().map(|h| format!("{:X}", h.as_u64().unwrap())).collect();
        assert_eq!(dragged, [handle], "the moved object, by its display-list handle: {p}");
        // The handles are the ones the display list's primitives carry.
        let shown = parse(&f.display(0.0));
        let number = drag["handles"][0].as_u64().unwrap();
        assert!(shown["prims"].as_array().unwrap().iter().any(|q| q["handle"].as_u64() == Some(number)), "{shown}");
        // The base-to-pointer line comes as ordinary geometry.
        assert!(!p["prims"].as_array().unwrap().is_empty(), "{p}");
    }

    #[test]
    fn pick_finds_what_is_under_the_pointer_and_leaves_the_selection_alone() {
        let mut f = line_facade();
        assert_eq!(parse(&f.execute("circle", r#"{"center":[5,0],"radius":0.01}"#))["ok"], json!(true));
        let undo_depth = parse(&f.state())["undoDepth"].clone();
        let before = fingerprint(&f);
        let hit = parse(&f.pick(5.0, 0.1, 0.5));
        let handles = hit["handles"].as_array().unwrap();
        assert_eq!(handles.len(), 2, "the line and the small circle on it: {hit}");
        assert!(hit.get("error").is_none(), "{hit}");
        assert!(parse(&f.pick(5.0, 5.0, 0.5))["handles"].as_array().unwrap().is_empty(), "nothing there");
        // Aperture 0 is the engine's own pick box: 3 px * 1.5 at 0.02 units per pixel = 0.09.
        assert_eq!(parse(&f.pick(2.0, 0.05, 0.0))["handles"].as_array().unwrap().len(), 1);
        assert!(parse(&f.pick(2.0, 0.2, 0.0))["handles"].as_array().unwrap().is_empty(), "outside the pick box");
        assert_eq!(fingerprint(&f), before, "a pick only looks");
        assert_eq!(parse(&f.selection())["count"], json!(0), "the selection is untouched");
        assert_eq!(parse(&f.state())["undoDepth"], undo_depth, "and so is the undo stack");
        // The first handle is what a click there selects, in the selection's own spelling.
        let selected = parse(&f.execute("select", r#"{"at":[5,0.1],"aperture":0.5}"#));
        assert_eq!(selected["result"]["handles"][0], handles[0], "{selected}");
        // With a selection made, and with a command asking for objects, a pick still only looks.
        let chosen = f.selection();
        f.pick(2.0, 0.0, 0.5);
        assert_eq!(f.selection(), chosen);
        f.cancel();
        f.start("erase");
        let asking = fingerprint(&f);
        assert_eq!(parse(&f.pick(2.0, 0.0, 0.5))["handles"].as_array().unwrap().len(), 1);
        assert_eq!(fingerprint(&f), asking, "nothing was picked into the command");
        // No drawing: nothing, quietly.
        assert_eq!(parse(&empty_facade().pick(0.0, 0.0, 1.0)), json!({"handles": [], "hover": null}));
    }

    #[test]
    fn snap_reports_the_object_snap_and_its_mode() {
        let mut f = line_facade();
        let before = fingerprint(&f);
        let end = parse(&f.snap(0.1, 0.1, 0.5));
        assert_eq!(end["snap"]["point"], json!([0.0, 0.0]), "{end}");
        assert_eq!(end["snap"]["name"], json!("Endpoint"), "{end}");
        assert_eq!(end["snap"]["mode"], json!(cadcraft_engine::snap::mode::END), "{end}");
        assert_eq!(end["snap"]["deferred"], json!(false), "{end}");
        assert_eq!(parse(&f.snap(5.0, 5.0, 0.5)), json!({"snap": null}), "nothing to snap to");
        // Aperture 0 is the engine's own: 10 px at 0.02 units per pixel = 0.2.
        assert_eq!(parse(&f.snap(10.1, 0.1, 0.0))["snap"]["point"], json!([10.0, 0.0]));
        assert!(parse(&f.snap(10.5, 0.0, 0.0))["snap"].is_null(), "outside the aperture");
        assert_eq!(fingerprint(&f), before, "a snap query only looks");
        // The running modes decide: with Midpoint alone the end does not snap and the middle does.
        f.session.settings.osmode = cadcraft_engine::snap::mode::MID;
        assert!(parse(&f.snap(0.1, 0.1, 0.5))["snap"].is_null());
        let mid = parse(&f.snap(5.1, 0.1, 0.5));
        assert_eq!((&mid["snap"]["point"], &mid["snap"]["name"]), (&json!([5.0, 0.0]), &json!("Midpoint")), "{mid}");
        // Object snap off (F3, or no modes at all): null.
        f.session.settings.osmode |= cadcraft_engine::snap::mode::OFF;
        assert_eq!(parse(&f.snap(5.1, 0.1, 0.5)), json!({"snap": null}));
        f.session.settings.osmode = 0;
        assert_eq!(parse(&f.snap(5.1, 0.1, 0.5)), json!({"snap": null}));
        // A prompt that selects objects does not snap its clicks.
        f.session.settings.osmode = cadcraft_engine::snap::mode::END;
        f.start("erase");
        assert_eq!(parse(&f.snap(0.1, 0.1, 0.5)), json!({"snap": null}));
        assert_eq!(parse(&empty_facade().snap(0.0, 0.0, 1.0)), json!({"snap": null}));
    }

    #[test]
    fn click_feeds_the_snapped_point_to_the_command() {
        let mut f = line_facade();
        f.start("line");
        let first = parse(&f.click(9.9, 0.1, 0.5));
        assert_eq!(first["snap"]["name"], json!("Endpoint"), "{first}");
        assert_eq!(first["base"], json!([10.0, 0.0]), "the command took the snapped point, not the raw one: {first}");
        assert_eq!(first["running"], json!("line"), "{first}");
        let second = parse(&f.click(10.0, 6.0, 0.5));
        assert!(second["snap"].is_null(), "nothing to snap to there: {second}");
        assert_eq!(second["base"], json!([10.0, 6.0]), "{second}");
        assert!(second.get("error").is_none(), "{second}");
        f.cmdline("");
        assert_eq!(entity_count(&f), 2, "the two clicks drew a line");
        let [_, _, x1, y1] = bounds(&mut f);
        assert_eq!((x1, y1), (10.0, 6.0), "from the snapped end to the clicked point");
        // At "Select objects" a click picks, with the engine's own pick box.
        f.start("erase");
        let picked = parse(&f.click(10.0, 3.0, 0.0));
        assert!(picked["snap"].is_null(), "{picked}");
        f.cmdline("");
        assert_eq!(entity_count(&f), 1, "the clicked line was erased");
        // With no command running a click does nothing at all.
        let before = fingerprint(&f);
        let idle = parse(&f.click(5.0, 0.0, 0.5));
        assert!(idle["running"].is_null() && idle.get("error").is_none(), "{idle}");
        assert_eq!(fingerprint(&f), before);
    }

    #[test]
    fn click_carries_a_deferred_tangent_typed_coordinates_cannot() {
        let mut f = Facade::new();
        assert_eq!(parse(&f.execute("circle", r#"{"center":[0,0],"radius":5}"#))["ok"], json!(true));
        assert_eq!(parse(&f.set_view(-10.0, -10.0, 10.0, 10.0))["ok"], json!(true));
        f.session.settings.osmode = cadcraft_engine::snap::mode::TAN;
        let asked = parse(&f.start("line"));
        assert_eq!(asked["deferred"], json!(true), "LINE's first point resolves deferred snaps: {asked}");
        let hover = parse(&f.snap(5.1, 0.0, 0.5));
        assert_eq!((&hover["snap"]["name"], &hover["snap"]["deferred"]), (&json!("Deferred Tangent"), &json!(true)), "{hover}");
        assert_eq!(hover["snap"]["mode"], json!(cadcraft_engine::snap::mode::TAN), "{hover}");
        let first = parse(&f.click(5.1, 0.0, 0.5));
        assert_eq!(first["snap"]["deferred"], json!(true), "{first}");
        f.session.settings.osmode = 0;
        f.click(0.0, 10.0, 0.5);
        f.cmdline("");
        assert_eq!(entity_count(&f), 2, "the line was drawn");
        // Tangent from (0,10) to the circle of radius 5 touches it at y = 2.5, x = 5·√3/2; the
        // picked point (5,0) is only where the circle was touched.
        let [_, y0, x1, _] = bounds(&mut f);
        assert!(y0 >= -5.01, "the line does not start at the picked point's far side: {y0}");
        let shown = parse(&f.display(0.0));
        let verts: Vec<(f64, f64)> = shown["verts"].as_array().unwrap().iter().map(point_of).collect();
        let tangent = (5.0 * 3.0_f64.sqrt() / 2.0, 2.5);
        assert!(
            verts.iter().any(|v| (v.0 - tangent.0).abs() < 1e-6 && (v.1 - tangent.1).abs() < 1e-6),
            "the tangent point is an end: {x1} {verts:?}"
        );
    }

    /// [`line_facade`] with object snap off and LINE started from `first`.
    fn drawing_line_from(first: &str) -> Facade {
        let mut f = line_facade();
        f.session.settings.osmode = 0;
        f.start("line");
        assert_eq!(parse(&f.cmdline(first))["running"], json!("line"));
        f
    }

    fn setvar(f: &mut Facade, name: &str, value: Value) {
        let r = parse(&f.execute("setvar", &json!({"name": name, "value": value}).to_string()));
        assert_eq!(r["ok"], json!(true), "setvar {name}: {r}");
    }

    fn verts_of(v: &Value) -> Vec<(f64, f64)> {
        v["verts"].as_array().unwrap().iter().map(point_of).collect()
    }

    #[test]
    fn pointer_is_free_without_a_point_prompt_and_reports_every_field() {
        let mut f = line_facade();
        let before = fingerprint(&f);
        let idle = parse(&f.pointer(0.1, 0.1, 0.0, 0.0, 0.0));
        assert_eq!(idle["point"], json!([0.1, 0.1]), "at rest the pointer is free, even on an endpoint: {idle}");
        assert_eq!(
            idle,
            json!({
                "point": [0.1, 0.1], "constraint": "none", "snap": null, "from": null, "distance": null, "angle": null, "label": "",
                "paths": {"verts": [], "prims": []}, "acquired": [], "wait": false, "preview": {"verts": [], "prims": [], "drag": null},
            })
        );
        assert_eq!(fingerprint(&f), before, "resolving the pointer changes nothing a person sees");
        // A prompt that picks objects leaves the pointer free too.
        f.start("erase");
        assert_eq!(parse(&f.pointer(0.1, 0.1, 0.0, 0.0, 0.0))["constraint"], json!("none"));
        // No drawing at all: free, quietly.
        let none = parse(&empty_facade().pointer(1.0, 2.0, 1.0, 0.0, 0.0));
        assert_eq!((&none["point"], none.get("error")), (&json!([1.0, 2.0]), None), "{none}");
    }

    #[test]
    fn pointer_takes_the_object_snap_first_as_snap_does() {
        let mut f = line_facade();
        f.start("line");
        let hover = parse(&f.pointer(9.9, 0.1, 0.5, 0.0, 0.0));
        assert_eq!(hover["constraint"], json!("osnap"), "{hover}");
        assert_eq!(hover["point"], json!([10.0, 0.0]), "{hover}");
        assert_eq!(hover["snap"], parse(&f.snap(9.9, 0.1, 0.5))["snap"], "the same hit `snap` reports");
        assert_eq!(hover["label"], json!(""), "the snap's own name is its label: {hover}");
        assert_eq!(f.session.cursor, Vec2::new(10.0, 0.0), "the engine's cursor is the resolved point");
    }

    #[test]
    fn ortho_bends_the_pointer_and_click_takes_the_same_point() {
        let mut f = drawing_line_from("2,2");
        setvar(&mut f, "ORTHOMODE", json!(1));
        let across = parse(&f.pointer(6.0, 3.0, 0.0, 0.0, 0.0));
        assert_eq!(across["point"], json!([6.0, 2.0]), "the larger travel wins: horizontal: {across}");
        assert_eq!((&across["constraint"], &across["label"]), (&json!("ortho"), &json!("Ortho: 4.0000 < 0°")), "{across}");
        assert_eq!((&across["from"], &across["distance"], &across["angle"]), (&json!([2.0, 2.0]), &json!(4.0), &json!(0.0)), "{across}");
        // The ray is the display list's own shape, from the base point through the point.
        let ray = &across["paths"];
        let verts = verts_of(ray);
        assert_eq!(
            ray["prims"],
            json!([{"kind": "polyline", "start": 0, "len": 2, "color": [255, 255, 255], "lw": 0.0, "alpha": 255, "handle": 0}]),
            "{across}"
        );
        assert_eq!(verts[0], (2.0, 2.0), "{across}");
        assert!(verts[1].0 > 15.0 && verts[1].1 == 2.0, "the ray runs past the view's edge: {across}");
        // The rubber band is drawn to the resolved point, not to the pointer.
        let band = verts_of(&across["preview"]);
        assert!(band.contains(&(6.0, 2.0)) && !band.contains(&(6.0, 3.0)), "{across}");
        let up = parse(&f.pointer(2.3, 9.0, 0.0, 0.0, 0.0));
        assert_eq!((&up["point"], &up["angle"], &up["label"]), (&json!([2.0, 9.0]), &json!(90.0), &json!("Ortho: 7.0000 < 90°")), "{up}");
        // Shift flips ortho while it is held, for the resolution and for the click after it.
        let held = parse(&f.pointer(6.0, 3.0, 0.0, 0.0, f64::from(MODIFIER_SHIFT)));
        assert_eq!((&held["point"], &held["constraint"]), (&json!([6.0, 3.0]), &json!("none")), "{held}");
        f.pointer(6.0, 3.0, 0.0, 0.0, 0.0);
        let taken = parse(&f.click(6.0, 3.0, 0.0));
        assert_eq!((&taken["point"], &taken["base"]), (&json!([6.0, 2.0]), &json!([6.0, 2.0])), "what was shown is what was taken: {taken}");
        // Toggled off mid-command, the next resolution is free: no click in between.
        setvar(&mut f, "ORTHOMODE", json!(0));
        assert_eq!(parse(&f.pointer(8.0, 3.0, 0.0, 0.0, 0.0))["point"], json!([8.0, 3.0]));
        // A window's second corner ignores ortho.
        f.cancel();
        setvar(&mut f, "ORTHOMODE", json!(1));
        f.start("rectang");
        f.cmdline("0,0");
        let corner = parse(&f.pointer(4.0, 3.0, 0.0, 0.0, 0.0));
        assert_eq!((&corner["point"], &corner["constraint"]), (&json!([4.0, 3.0]), &json!("none")), "{corner}");
    }

    #[test]
    fn polar_snaps_near_its_increments_and_is_free_elsewhere() {
        let mut f = drawing_line_from("1,1");
        setvar(&mut f, "POLARANG", json!(45));
        assert!(f.session.settings.polarmode, "polar tracking is on by default");
        // 0.05 off the 45° ray (the reach is 10 px at 0.02 units per pixel: 0.2).
        let near = parse(&f.pointer(4.05, 4.0, 0.0, 0.0, 0.0));
        assert_eq!(near["constraint"], json!("polar"), "{near}");
        let (x, y) = point_of(&near["point"]);
        assert!((x - 4.025).abs() < 1e-9 && (y - 4.025).abs() < 1e-9, "the foot on the 45° ray: {near}");
        assert!((near["angle"].as_f64().unwrap() - 45.0).abs() < 1e-9, "{near}");
        let label = near["label"].as_str().unwrap();
        assert!(label.starts_with("Polar: 4.27") && label.ends_with(" < 45°"), "{label}");
        assert_eq!(verts_of(&near["paths"])[0], (1.0, 1.0), "the polar ray starts at the base point: {near}");
        // Between two increments the pointer is where it is.
        let free = parse(&f.pointer(5.0, 2.5, 0.0, 0.0, 0.0));
        assert_eq!((&free["point"], &free["constraint"], &free["label"]), (&json!([5.0, 2.5]), &json!("none"), &json!("")), "{free}");
        assert_eq!(free["paths"], json!({"verts": [], "prims": []}), "{free}");
        // The click takes the snapped point.
        f.pointer(4.05, 4.0, 0.0, 0.0, 0.0);
        let (bx, by) = point_of(&parse(&f.click(4.05, 4.0, 0.0))["base"]);
        assert!((bx - 4.025).abs() < 1e-9 && (by - 4.025).abs() < 1e-9, "{bx},{by}");
        // Polar off (F10): free on the ray too.
        f.session.settings.polarmode = false;
        assert_eq!(parse(&f.pointer(7.05, 7.0, 0.0, 0.0, 0.0))["constraint"], json!("none"));
    }

    #[test]
    fn grid_snap_lands_clicks_on_the_spacing() {
        let mut f = line_facade();
        f.session.settings.osmode = 0;
        f.session.settings.polarmode = false;
        setvar(&mut f, "SNAPUNIT", json!([1, 1]));
        setvar(&mut f, "SNAPMODE", json!(1));
        f.start("line");
        let first = parse(&f.pointer(2.3, 3.6, 0.0, 0.0, 0.0));
        assert_eq!((&first["point"], &first["constraint"], &first["label"]), (&json!([2.0, 4.0]), &json!("grid"), &json!("")), "{first}");
        assert_eq!(parse(&f.click(2.3, 3.6, 0.0))["base"], json!([2.0, 4.0]));
        let next = parse(&f.click(5.4, 6.6, 0.0));
        assert_eq!((&next["point"], &next["base"]), (&json!([5.0, 7.0]), &json!([5.0, 7.0])), "{next}");
        // Snap off mid-command (F9): the next pointer is free.
        setvar(&mut f, "SNAPMODE", json!(0));
        assert_eq!(parse(&f.pointer(5.4, 6.6, 0.0, 0.0, 0.0))["point"], json!([5.4, 6.6]));
    }

    #[test]
    fn resting_on_a_snap_point_acquires_it_and_its_paths_bend_the_pointer() {
        let mut f = line_facade();
        f.session.settings.osmode = cadcraft_engine::snap::mode::END;
        assert!(f.session.settings.otrack, "object snap tracking is on by default");
        f.start("line");
        f.cmdline("5,5");
        let arriving = parse(&f.pointer(10.05, 0.05, 0.0, 1_000.0, 0.0));
        assert_eq!((&arriving["constraint"], &arriving["wait"], &arriving["acquired"]), (&json!("osnap"), &json!(true), &json!([])), "{arriving}");
        // A clock that steps back does not restart the dwell; half a second on, the point is held.
        f.pointer(10.05, 0.05, 0.0, 10.0, 0.0);
        let rested = parse(&f.pointer(10.05, 0.05, 0.0, 1_500.0, 0.0));
        assert_eq!((&rested["acquired"], &rested["wait"]), (&json!([[10.0, 0.0]]), &json!(false)), "{rested}");
        // Straight above the acquired end: its vertical alignment path.
        let above = parse(&f.pointer(10.03, 4.0, 0.0, 1_600.0, 0.0));
        assert_eq!(
            (&above["point"], &above["constraint"], &above["label"]),
            (&json!([10.0, 4.0]), &json!("track"), &json!("Endpoint: 4.0000 < 90°")),
            "{above}"
        );
        assert_eq!(above["from"], json!([10.0, 0.0]), "{above}");
        assert_eq!(verts_of(&above["paths"])[0], (10.0, 0.0), "the ray starts at the acquired point: {above}");
        // Where that path crosses the polar ray from the base point: both rays, one point.
        let crossing = parse(&f.pointer(10.05, 5.05, 0.0, 1_700.0, 0.0));
        assert_eq!((&crossing["point"], &crossing["constraint"]), (&json!([10.0, 5.0]), &json!("track")), "{crossing}");
        assert_eq!(crossing["paths"]["prims"].as_array().map(Vec::len), Some(2), "{crossing}");
        assert_eq!(parse(&f.click(10.05, 5.05, 0.0))["base"], json!([10.0, 5.0]));
        // A command's tracking points are forgotten with it.
        f.cancel();
        assert!(f.session.tracking.acquired.is_empty());
        assert_eq!(parse(&f.pointer(10.03, 4.0, 0.0, 1_800.0, 0.0))["acquired"], json!([]));
    }

    #[test]
    fn pointer_shows_a_deferred_tangents_resolved_line_and_tells_ctrl() {
        let mut f = Facade::new();
        for circle in [r#"{"center":[0,0],"radius":10}"#, r#"{"center":[30,0],"radius":4}"#] {
            assert_eq!(parse(&f.execute("circle", circle))["ok"], json!(true));
        }
        assert_eq!(parse(&f.set_view(-20.0, -20.0, 40.0, 20.0))["ok"], json!(true));
        f.session.settings.osmode = cadcraft_engine::snap::mode::TAN;
        f.start("line");
        assert_eq!(parse(&f.click(-1.0, 10.1, 0.5))["snap"]["deferred"], json!(true));
        // Hovering the other circle: the band is the belt tangent the click will draw, not a
        // line to the point under the pointer.
        let hover = parse(&f.pointer(31.0, 4.1, 0.5, 0.0, 0.0));
        assert_eq!(hover["snap"]["deferred"], json!(true), "{hover}");
        assert!(f.session.cursor_deferred.is_some(), "the engine is told the deferred snap under the pointer");
        let band = verts_of(&hover["preview"]);
        assert_eq!(band.len(), 2, "{hover}");
        let hovered = point_of(&hover["point"]);
        assert!(!band.contains(&hovered), "the band ends at the tangent point, not the hovered one: {hover}");
        f.click(31.0, 4.1, 0.5);
        assert!(f.session.cursor_deferred.is_none(), "a click settles the deferred snap");
        f.cmdline("");
        let drawn = verts_of(&parse(&f.display(0.0)));
        for end in &band {
            assert!(drawn.iter().any(|v| (v.0 - end.0).abs() < 1e-9 && (v.1 - end.1).abs() < 1e-9), "the previewed end {end:?} was drawn");
        }
        // Ctrl reaches the engine while it is held, and ARC's rubber band turns with it.
        f.session.settings.osmode = 0;
        f.cmdline("arc c 0,0 5,0");
        let plain = parse(&f.pointer(0.0, 5.0, 0.5, 0.0, 0.0));
        assert!(!f.session.ctrl_down);
        let turned = parse(&f.pointer(0.0, 5.0, 0.5, 0.0, f64::from(MODIFIER_CTRL)));
        assert!(f.session.ctrl_down);
        assert_ne!(plain["preview"], turned["preview"], "Ctrl switches the arc's direction");
        f.pointer(0.0, 5.0, 0.5, 0.0, f64::from(MODIFIER_SHIFT | MODIFIER_CTRL));
        assert!(f.session.ctrl_down, "both keys at once");
        f.cancel();
        assert!(!f.session.ctrl_down, "no command, no modifier left behind");
    }

    #[test]
    fn hover_is_what_a_click_selects_and_obeys_the_preview_filter() {
        let mut f = line_facade();
        let at_rest = parse(&f.pick(5.0, 0.05, 0.0));
        let handle = at_rest["handles"][0].clone();
        assert!(handle.is_string(), "{at_rest}");
        assert_eq!(at_rest["hover"], handle, "at rest a click selects it, so it lights: {at_rest}");
        // A locked layer: a click still takes the object, but PREVIEWFILTER bit 1 keeps it dark.
        f.session.doc_mut().unwrap().layer_mut("0").unwrap().locked = true;
        let locked = parse(&f.pick(5.0, 0.05, 0.0));
        assert_eq!((&locked["handles"][0], &locked["hover"]), (&handle, &Value::Null), "{locked}");
        f.session.settings.previewfilter = 0;
        assert_eq!(parse(&f.pick(5.0, 0.05, 0.0))["hover"], handle, "with the filter off it lights again");
        f.session.doc_mut().unwrap().layer_mut("0").unwrap().locked = false;
        // SELECTIONPREVIEW off for "no command": nothing lights at rest.
        f.session.settings.selectionpreview = 2;
        assert!(parse(&f.pick(5.0, 0.05, 0.0))["hover"].is_null());
        // A prompt that picks objects lights what its click picks; one that wants a point lights nothing.
        f.start("erase");
        assert_eq!(parse(&f.pick(5.0, 0.05, 0.0))["hover"], handle);
        f.cancel();
        f.session.settings.selectionpreview = 3;
        f.start("line");
        let pointing = parse(&f.pick(5.0, 0.05, 0.0));
        assert_eq!((&pointing["handles"][0], &pointing["hover"]), (&handle, &Value::Null), "{pointing}");
        f.cancel();
        // A frozen layer's objects are not under the pointer at all: a click cannot select them.
        f.session.doc_mut().unwrap().layer_mut("0").unwrap().frozen = true;
        assert_eq!(parse(&f.pick(5.0, 0.05, 0.0)), json!({"handles": [], "hover": null}));
        let selected = parse(&f.execute("select", r#"{"at":[5,0.05],"aperture":0.5}"#));
        assert_eq!(selected["result"]["handles"], json!([]), "and a click there selects nothing: {selected}");
    }

    #[test]
    fn set_viewport_sizes_the_engine_pick_box() {
        let mut f = Facade::new();
        assert_eq!(parse(&f.set_view(0.0, 0.0, 20.0, 20.0))["ok"], json!(true));
        assert_eq!(f.session.viewport_px, (1200.0, 800.0), "the engine's own default until the canvas says");
        let r = parse(&f.set_viewport(1600.0, 400.0));
        assert_eq!(r, json!({"ok": true, "viewport": [1600.0, 400.0]}));
        assert_eq!(f.session.viewport_px, (1600.0, 400.0));
        assert_eq!(f.session.pixel_size(), 20.0 / 400.0, "world units per pixel follow the canvas height");
        // Clamped into a sane range, never zero.
        assert_eq!(parse(&f.set_viewport(0.25, 1.0e9))["viewport"], json!([MIN_VIEWPORT_PX, MAX_VIEWPORT_PX]));
        // A hidden canvas (0 x 0), a negative or a non-finite size is refused and changes nothing.
        f.set_viewport(800.0, 600.0);
        for (w, h) in [(0.0, 0.0), (0.0, 600.0), (800.0, -1.0), (f64::NAN, 600.0), (800.0, f64::INFINITY), (f64::NEG_INFINITY, f64::NAN)] {
            let r = parse(&f.set_viewport(w, h));
            assert_eq!(r["ok"], json!(false), "{w} x {h}: {r}");
            assert!(r["error"].is_string(), "{r}");
            assert_eq!(f.session.viewport_px, (800.0, 600.0), "{w} x {h}");
        }
        assert!(f.session.pixel_size().is_finite() && f.session.pixel_size() > 0.0);
    }

    #[test]
    fn set_cursor_gives_direct_distance_entry_its_direction() {
        let mut f = Facade::new();
        f.start("line");
        f.cmdline("1,1");
        assert_eq!(parse(&f.set_cursor(1.0, 9.0)), json!({"ok": true}));
        let r = parse(&f.cmdline("5"));
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(r["base"], json!([1.0, 6.0]), "5 units from (1,1) towards the pointer: {r}");
        // A hostile cursor is refused and the last good one stays.
        for (x, y) in [(f64::NAN, 0.0), (0.0, f64::INFINITY), (1.0e308, 0.0), (0.0, -1.0e300)] {
            let r = parse(&f.set_cursor(x, y));
            assert_eq!(r["ok"], json!(false), "{x},{y}: {r}");
            assert_eq!(f.session.cursor, Vec2::new(1.0, 9.0), "{x},{y}");
        }
    }

    #[test]
    fn hostile_pointer_numbers_never_panic() {
        // In every state a pointer can meet: no drawing, at rest, a point prompt, a selection
        // prompt, a drag.
        let mut at_point = Facade::sample();
        at_point.start("line");
        at_point.cmdline("0,0");
        let mut at_select = Facade::sample();
        at_select.start("erase");
        let mut dragging = line_facade();
        dragging.execute("select", r#"{"at":[5,0],"aperture":0.5}"#);
        dragging.start("scale");
        dragging.cmdline("0,0");
        for mut f in [empty_facade(), Facade::sample(), at_point, at_select, dragging] {
            let before = fingerprint(&f);
            for &a in &HOSTILE {
                for &b in &[0.0, 1.0, a] {
                    for (x, y) in [(a, b), (b, a)] {
                        let p = parse(&f.preview(x, y));
                        assert!(p["prims"].as_array().is_some_and(Vec::is_empty) && p["error"].is_string(), "preview {x},{y}: {p}");
                        let k = parse(&f.pick(x, y, 1.0));
                        assert!(k["handles"].as_array().is_some_and(Vec::is_empty) && k["error"].is_string(), "pick {x},{y}: {k}");
                        let s = parse(&f.snap(x, y, 1.0));
                        assert!(s["snap"].is_null() && s["error"].is_string(), "snap {x},{y}: {s}");
                        assert_eq!(parse(&f.set_cursor(x, y))["ok"], json!(false), "set_cursor {x},{y}");
                        let r = parse(&f.pointer(x, y, 1.0, 0.0, 0.0));
                        assert!(
                            r["point"].is_null() && r["error"].is_string() && r["preview"]["prims"].as_array().is_some_and(Vec::is_empty),
                            "pointer {x},{y}: {r}"
                        );
                        assert_eq!(fingerprint(&f), before, "a refused read changed something: {x},{y}");
                        let c = parse(&f.click(x, y, 1.0));
                        assert!(c["error"].is_string() && c["snap"].is_null(), "click {x},{y}: {c}");
                        assert_eq!(f.digest(), before.0, "a refused click changed the drawing: {x},{y}");
                    }
                }
                // A hostile aperture on a good point: refused (not finite, negative) or clamped
                // (huge), and a clamped pick stays a short list.
                for aperture in [a, -1.0, -0.0, -f64::MIN_POSITIVE] {
                    let k = parse(&f.pick(1.0, 1.0, aperture));
                    assert!(k["handles"].as_array().is_some_and(|h| h.len() <= MAX_PICK_HANDLES), "pick aperture {aperture}: {k}");
                    let s = parse(&f.snap(1.0, 1.0, aperture));
                    assert!(s.get("snap").is_some(), "snap aperture {aperture}: {s}");
                    let r = parse(&f.pointer(1.0, 1.0, aperture, 0.0, 0.0));
                    assert!(r["paths"]["prims"].is_array() && r["preview"]["prims"].is_array(), "pointer aperture {aperture}: {r}");
                    if !aperture.is_finite() || aperture < 0.0 {
                        assert!(r["point"].is_null() && r["error"].is_string(), "pointer aperture {aperture}: {r}");
                        assert!(k["error"].is_string() && s["error"].is_string(), "aperture {aperture}: {k} {s}");
                        let c = parse(&f.click(1.0, 1.0, aperture));
                        assert!(c["error"].is_string(), "click aperture {aperture}: {c}");
                    }
                }
                // A hostile clock or modifiers on a good point: refused, and the session's own
                // clock and keys stay what they were.
                let (clock, keys) = (f.clock, f.modifiers);
                for (now, held) in [(a, 0.0), (-a.abs(), 0.0), (0.0, a), (0.0, -a.abs())] {
                    let r = parse(&f.pointer(1.0, 1.0, 0.0, now, held));
                    assert!(r["point"].is_null() && r["error"].is_string(), "pointer at {now} ms with keys {held}: {r}");
                }
                for (now, held) in
                    [(-1.0, 0.0), (-f64::MIN_POSITIVE, 0.0), (MAX_TIME_MS * 2.0, 0.0), (0.0, -1.0), (0.0, 4.0), (0.0, 1.5), (0.0, 0.25)]
                {
                    let r = parse(&f.pointer(1.0, 1.0, 0.0, now, held));
                    assert!(r["point"].is_null() && r["error"].is_string(), "pointer at {now} ms with keys {held}: {r}");
                }
                assert_eq!((f.clock, f.modifiers), (clock, keys), "a refused pointer call moved the clock or the keys");
                assert_eq!(parse(&f.set_viewport(a, a))["ok"].as_bool(), Some(a.is_finite() && a > 0.0), "set_viewport {a}");
                let size = f.session.viewport_px;
                assert!(size.0 >= MIN_VIEWPORT_PX && size.0 <= MAX_VIEWPORT_PX && size.1 >= MIN_VIEWPORT_PX && size.1 <= MAX_VIEWPORT_PX, "{size:?}");
            }
            // The facade still answers after all of it.
            assert!(parse(&f.preview(1.0, 1.0))["prims"].is_array());
            assert!(parse(&f.pick(1.0, 1.0, 0.0)).get("error").is_none());
            assert!(parse(&f.snap(1.0, 1.0, 0.0)).get("error").is_none());
            // The latest time and every key at once are still good input.
            let last = parse(&f.pointer(1.0, 1.0, 0.0, MAX_TIME_MS, 3.0));
            assert!(last.get("error").is_none() && last["point"].is_array(), "{last}");
        }
    }

    /// Hostile drafting settings under a pointer: spacings and angles no dialog would set.
    #[test]
    fn pointer_survives_hostile_drafting_settings() {
        for hostile in HOSTILE {
            let mut f = drawing_line_from("1,1");
            let st = &mut f.session.settings;
            (st.snapmode, st.orthomode, st.polarmode, st.otrack) = (true, false, true, true);
            (st.polarang, st.polardist, st.aperture) = (hostile, hostile, hostile);
            st.polaraddang = vec![hostile, 1e-300];
            st.osmode = cadcraft_engine::snap::mode::END | cadcraft_engine::snap::mode::EXT | cadcraft_engine::snap::mode::PAR;
            for (x, y) in [(4.0, 4.0), (9.95, 0.05), (1.0, 1.0)] {
                for held in [0.0, 1.0, 2.0, 3.0] {
                    let r = parse(&f.pointer(x, y, 0.0, 5_000.0, held));
                    // A point, or a refusal (an aperture setting that gives no usable reach): never a panic or a `NaN`.
                    assert!(r["point"].is_array() || r["error"].is_string(), "{hostile} at {x},{y}: {r}");
                }
            }
            f.session.settings.orthomode = true;
            assert!(parse(&f.pointer(4.0, 3.0, 0.5, 6_000.0, 0.0))["point"].is_array());
            assert!(parse(&f.click(4.0, 3.0, 0.5)).get("point").is_some());
        }
    }

    /// What one pointer move costs on the sample drawing, printed in microseconds:
    /// `cargo test -p cadcraft-wasm --release pointer_calls_are_cheap -- --nocapture`.
    /// `preview`, `pick` and `snap` run once per animation frame, so each must stay a small part
    /// of a 16 ms frame; the bound asserted here is loose enough for a debug build on a busy
    /// machine and still catches a preview that rebuilds the whole drawing.
    #[test]
    fn pointer_calls_are_cheap() {
        const ROUNDS: u32 = 200;
        let mut f = Facade::sample();
        assert_eq!(parse(&f.set_viewport(1280.0, 800.0))["ok"], json!(true));
        let view = parse(&f.view());
        let ((x0, y0), (x1, y1)) = (point_of(&view["min"]), point_of(&view["max"]));
        // Pointer positions sweeping the view's diagonal, so the calls meet real geometry.
        let at = |i: u32| {
            let t = f64::from(i % ROUNDS) / f64::from(ROUNDS);
            (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
        };
        let time = |label: &str, call: &mut dyn FnMut(f64, f64) -> usize| {
            let started = std::time::Instant::now();
            let mut bytes = 0;
            for i in 0..ROUNDS {
                let (x, y) = at(i);
                bytes += call(x, y);
            }
            let micros = started.elapsed().as_secs_f64() * 1e6 / f64::from(ROUNDS);
            println!("{label}: {micros:.1} us per call, {} reply bytes on average", bytes / ROUNDS as usize);
            micros
        };
        let whole = {
            let started = std::time::Instant::now();
            let bytes = f.display(0.0).len();
            let micros = started.elapsed().as_secs_f64() * 1e6;
            println!("display (the whole list, for scale): {micros:.1} us, {bytes} bytes");
            micros
        };
        // The engine's own boxes (a few pixels: most positions hit nothing), then a reach of a
        // twentieth of the view, where nearly every position hits several objects.
        let wide = (y1 - y0) / 20.0;
        let pick = time("pick (the engine's pick box)", &mut |x, y| f.pick(x, y, 0.0).len());
        let pick_wide = time("pick (a reach of 1/20 of the view)", &mut |x, y| f.pick(x, y, wide).len());
        let snap_idle = time("snap (at rest, the engine's aperture)", &mut |x, y| f.snap(x, y, 0.0).len());
        let snap_wide = time("snap (a reach of 1/20 of the view)", &mut |x, y| f.snap(x, y, wide).len());
        let preview_idle = time("preview (no command)", &mut |x, y| f.preview(x, y).len());
        f.start("line");
        f.cmdline("0,0");
        let preview_line = time("preview (LINE rubber band)", &mut |x, y| f.preview(x, y).len());
        let snap_line = time("snap (LINE, with a base point)", &mut |x, y| f.snap(x, y, 0.0).len());
        // The one call a canvas makes per frame at a point prompt: the engine's whole cursor
        // resolution and the rubber band at the resolved point. Polar and object snap are on by
        // default; then with ortho, then with grid snap and a rested-on tracking point as well.
        let mut tick = 0.0;
        let mut resolve = |f: &mut Facade, x: f64, y: f64| {
            tick += 16.0;
            f.pointer(x, y, 0.0, tick, 0.0).len()
        };
        let pointer_polar = time("pointer (LINE: object snap, polar, tracking)", &mut |x, y| resolve(&mut f, x, y));
        f.session.settings.orthomode = true;
        let pointer_ortho = time("pointer (LINE: object snap, ortho)", &mut |x, y| resolve(&mut f, x, y));
        f.session.settings.orthomode = false;
        f.session.settings.snapmode = true;
        let pointer_grid = time("pointer (LINE: object snap, polar, tracking, grid snap)", &mut |x, y| resolve(&mut f, x, y));
        f.session.settings.snapmode = false;
        println!("tracking points acquired along the sweep: {}", f.session.tracking.acquired.len());
        f.cancel();
        f.start("circle");
        f.cmdline("0,0");
        let preview_circle = time("preview (CIRCLE rubber band)", &mut |x, y| f.preview(x, y).len());
        f.cancel();
        // `ALL` selects everything, the empty input between the two spaces ends the selection.
        f.cmdline("move all  0,0");
        let dragged = parse(&f.preview(1.0, 1.0))["drag"]["handles"].as_array().map_or(0, Vec::len);
        assert!(dragged > 10, "MOVE ALL drags the sample's objects: {dragged}");
        let preview_move = time("preview (MOVE of everything, as a transform)", &mut |x, y| f.preview(x, y).len());
        println!("MOVE drags {dragged} objects");
        for (label, micros) in [
            ("pick", pick.max(pick_wide)),
            ("snap", snap_idle.max(snap_wide).max(snap_line)),
            ("preview", preview_idle.max(preview_line).max(preview_circle).max(preview_move)),
            ("pointer", pointer_polar.max(pointer_ortho).max(pointer_grid)),
        ] {
            assert!(micros < 8_000.0, "{label} takes {micros:.0} us: half a frame");
        }
        assert!(preview_line < whole.max(1.0), "a rubber band ({preview_line:.0} us) must cost less than the whole display list ({whole:.0} us)");
    }
}
