//! The surface: what an agent can do to a running CADCraft, as tools.
//!
//! One catalog, two faces. Every entry names a call into the **control harness** — the same
//! methods the MCP server and the JSON control channel use (`engine.execute`, `cmdline.input`,
//! `drawing.inspect`, …) — so the composer pane, an external MCP client and a script all drive
//! the application through exactly the same doors, and a command added to the engine is
//! reachable from all of them. The MCP server builds its `tools/list` and its dispatch from
//! here; the composer hands the same list to the model.
//!
//! Descriptions are written for a model: what the tool does, what it returns, and when to reach
//! for it instead of another one.

use serde_json::{Value, json};

/// What the tools call. The application implements this over its own control dispatch; a test
/// implements it with a recording double.
pub trait Harness {
    /// Invoke one control method and return its result.
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String>;
}

/// How a tool reaches the harness.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// One control method, the arguments passed through.
    Method(&'static str),
    /// `engine.execute` with this command id and the arguments as its parameters.
    Command(&'static str),
    /// `engine.execute` with `{command, params}` taken from the arguments.
    Execute,
    /// `engine.commands`, filtered by the arguments' `filter`.
    ListCommands,
    /// `cmdline.key` with a fixed key.
    Key(&'static str),
}

/// One tool: its name, the description a model reads, its JSON Schema, and how it reaches the
/// harness.
pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: Value,
    pub kind: Kind,
    /// The tool needs a window (a screenshot, a pointer click); a headless host has none.
    pub ui: bool,
}

impl Tool {
    /// The definition the chat API and MCP's `tools/list` both use.
    pub fn definition(&self) -> Value {
        json!({"name": self.name, "description": self.description, "inputSchema": self.schema})
    }
}

/// Every tool, including the ones that need a window.
pub fn tools() -> Vec<Tool> {
    let mut t = core_tools();
    t.extend(ui_tools());
    t
}

/// The tools that work in any host: the drawing, the command harness, files.
pub fn core_tools() -> Vec<Tool> {
    let t = |name, description, schema, kind| Tool { name, description, schema, kind, ui: false };
    vec![
        t(
            "command_line",
            "Type one line at the CADCraft command line, exactly as a user would at an AutoCAD-style prompt. Starts commands by name or alias (LINE, L, CIRCLE, C, PLINE, RECTANG, MOVE, TRIM, OFFSET, ZOOM…) and answers the active prompt: points `x,y`, relative `@dx,dy`, polar `@dist<angle`, distances, keywords (e.g. `c` for Close), empty text = Enter. Spaces act as Enter, so `circle 0,0 5` works in one call. Returns the new prompt and command-line output, and `error` when the line was refused.",
            json!({"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}),
            Kind::Method("cmdline.input"),
        ),
        t(
            "script",
            "Run a multi-line script (like an AutoCAD .scr file): one or more inputs per line, blank line = Enter.",
            json!({"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}),
            Kind::Method("cmdline.script"),
        ),
        t(
            "execute",
            "Run any command with JSON parameters (no prompts or dialogs). Use list_commands to find ids and parameter docs. Examples: line {points:[[0,0],[10,0]]}, circle {center:[0,0], radius:5}, layer.new {name:\"Walls\", color:\"red\", current:true}, move {handles:[\"10A\"], delta:[5,0]}, zoom {mode:\"extents\"}.",
            json!({"type": "object", "properties": {"command": {"type": "string"}, "params": {"type": "object"}}, "required": ["command"]}),
            Kind::Execute,
        ),
        t(
            "list_commands",
            "List commands with ids, labels, menu paths, aliases and parameter docs. Optional filter: a substring of the command id, label or an alias.",
            json!({"type": "object", "properties": {"filter": {"type": "string"}}}),
            Kind::ListCommands,
        ),
        t(
            "inspect_drawing",
            "Summary of the active drawing: entity counts, extents, layers, styles, blocks, layouts, selection, undo history and (optionally) entities with handles and geometry.",
            json!({"type": "object", "properties": {"entities": {"type": "boolean"}, "limit": {"type": "integer"}}}),
            Kind::Method("drawing.inspect"),
        ),
        t(
            "query_entities",
            "Entities filtered by type (Line, Circle, Polyline…), layer, current selection (selected:true; active space only) and/or a window [[x0,y0],[x1,y1]] (objects whose geometry is inside or crosses it; crossing:false = entirely inside). Returns count (all matches), returned (this page) and entities; page with offset and limit (default 500).",
            json!({"type": "object", "properties": {"type": {"type": "string"}, "layer": {"type": "string"}, "selected": {"type": "boolean"},
                "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "crossing": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0}}}),
            Kind::Command("entities"),
        ),
        t(
            "find_text",
            "Read the drawing's texts: TEXT, MTEXT (formatting removed), block attributes and multileaders, each with its text, insertion point `at`, height, rotation, style, layer and handle. Filter by `contains` (any case), `layer` and/or `window` [[x0,y0],[x1,y1]] around the insertion points; page with offset and limit (default 200). Use it to find room names, sheet titles and notes without reading all the geometry.",
            json!({"type": "object", "properties": {"contains": {"type": "string"}, "layer": {"type": "string"},
                "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "limit": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0}}}),
            Kind::Command("texts"),
        ),
        t(
            "describe_drawing",
            "An in-depth, measured report of a drawing or a selection: the answer to \"what is actually in here?\". Returns counts by object type; extents, size and centre with the drawing's units; per-layer usage (objects, colour, linetype, on/frozen/locked); total drawn length and length per type; closed shapes with the area they enclose; open contours (outlines never closed) with their length; texts with their contents; block references by name; raster references with pixel sizes and units-per-pixel; degenerate (zero-length) objects; optional chain analysis (`loops: true`) of loose LINEs and ARCs, reporting gaps and junctions; per-object detail (`detail: true`, or whenever a selection is given) with handle, layer, length, area, closed flag, vertices and bounds; `notes` for what stands out; and a plain-language `message` narrating all of it. Scope: the active space by default, or `space: model|all|<layout>`, or explicit `handles`, optionally restricted to a `window`. Use it before editing an unfamiliar drawing, and after building or tracing geometry to verify what was produced. When the drawing holds jewelry, the report also reads it as such: stones by cut and size with their carats, and each band with the size and metal its block carries (see `bench_sheet`).",
            json!({"type": "object", "properties": {"handles": {"type": "array", "items": {"type": "string"}}, "handle": {"type": "string"},
                "space": {"type": "string"}, "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "crossing": {"type": "boolean"}, "detail": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 0},
                "loops": {"type": "boolean"}, "maxPairs": {"type": "integer", "minimum": 0}, "tolerance": {"type": "number"}}}),
            Kind::Command("describe"),
        ),
        t(
            "bench_sheet",
            "Read the drawing as a jeweler's bench sheet: every stone, by cut and size, with its count and carat weight, and the metal of the band, in grams. Stones are the inserts of GEM-… blocks, so it counts what is really in the drawing; each stone's material and depth come from its own block, and the carat from the trade's per-cut formula (a 6.5 mm round brilliant is 1.03 ct). Give `section` (a closed polyline cross-section: x = the distance from the finger's surface, outward, y = along the finger) with `size` (a ring size, e.g. 6 with `system`: us|uk|eu|jp|cn) or `radius` (mm) to weigh metal by Pappus's theorem at the alloy's density (`metal`: gold24|22|18|14|10|9, platinum, palladium, silver, steel, titanium, wax). Set `table: true` to also draw the sheet as a table at `at`. Returns the stone groups (cut, width, length, depth, sg, count, caratEach, carat, depthFrom), the totals, the metal weight (sectionArea, centroidFromAxis, volumeMm3, grams) and a plain-language summary. The jewelry commands behind it — GEM, GEMLIST, PAVE, GEMFIT, SETTING, RING, RINGSIZES, TECHSHEET — all run through `execute` too.",
            json!({"type": "object", "properties": {"handles": {"type": "array", "items": {"type": "string"}}, "metal": {"type": "string"},
                "section": {"type": "string"}, "size": {}, "radius": {"type": "number"}, "system": {"type": "string"},
                "table": {"type": "boolean"}, "at": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "layer": {"type": "string"}}}),
            Kind::Command("techsheet"),
        ),
        t(
            "attach_image",
            "Place a raster image (PNG or JPEG) in the drawing as an IMAGE reference: a photo, scan or reference picture to trace over or ship with the drawing. Give `path` (a file the CADCraft process can read) or `data` (base64 of the file, for uploads). The insertion point is the image's lower-left corner (`at`, default 0,0). Size it with `width` and/or `height` in drawing units (one of them keeps the picture's shape; default: 1 unit per pixel), rotate with `rotation` (degrees), and optionally crop with `clip` (two opposite corners or a boundary polygon, in pixels from the top-left) and dim it with `brightness`/`contrast`/`fade` (0-100). Returns the new handle, the pixel size, the placed size in drawing units and the path.",
            json!({"type": "object", "properties": {"path": {"type": "string"}, "data": {"type": "string"}, "name": {"type": "string"},
                "at": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                "width": {"type": "number"}, "height": {"type": "number"}, "rotation": {"type": "number"}, "layer": {"type": "string"},
                "clip": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2}, "minItems": 2},
                "brightness": {"type": "number"}, "contrast": {"type": "number"}, "fade": {"type": "number"}}}),
            Kind::Command("imageattach"),
        ),
        t(
            "trace_image",
            "Vectorize a raster image into editable polylines: the fast way to turn a photo or scan of a part (a wing, a bracket, a logo) into CAD geometry. Thresholds the picture (`mode: dark` traces dark shapes, `light` traces light ones, `alpha` traces opaque pixels of a PNG), finds each region's outline with marching squares at sub-pixel accuracy, simplifies it (Douglas-Peucker, `simplify` in pixels) and adds one closed polyline per contour. Source: `path`, base64 `data`, or `handle` of a placed image (which keeps that image's placement and scale). `scale` sets drawing units per pixel (default 1 for a path/data, the image's own for a handle). Size the result directly with `width` and/or `height` in drawing units. Returns contours, points, the polyline handles, bounds, the threshold and what was skipped.",
            json!({"type": "object", "properties": {"path": {"type": "string"}, "data": {"type": "string"}, "handle": {"type": "string"},
                "at": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "scale": {"type": "number"},
                "width": {"type": "number"}, "height": {"type": "number"},
                "mode": {"type": "string", "enum": ["dark", "light", "alpha"]}, "threshold": {"type": "number", "minimum": 0, "maximum": 255},
                "blur": {"type": "integer", "minimum": 0, "maximum": 8}, "simplify": {"type": "number", "minimum": 0, "maximum": 64},
                "downsample": {"type": "integer", "minimum": 1, "maximum": 16}, "minArea": {"type": "number", "minimum": 0},
                "holes": {"type": "boolean"}, "closed": {"type": "boolean"}, "layer": {"type": "string"},
                "maxContours": {"type": "integer", "minimum": 1}, "maxPoints": {"type": "integer", "minimum": 3}}}),
            Kind::Command("imagetrace"),
        ),
        t(
            "new_drawing",
            "Create a new drawing (imperial by default, or metric).",
            json!({"type": "object", "properties": {"metric": {"type": "boolean"}}}),
            Kind::Command("new"),
        ),
        t(
            "open",
            "Open a DXF or DWG file.",
            json!({"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}),
            Kind::Method("app.open"),
        ),
        t(
            "save",
            "Save the drawing (DXF or DWG by extension). A .svg, .png or .pdf path exports instead: the drawing keeps its name and unsaved changes.",
            json!({"type": "object", "properties": {"path": {"type": "string"}}}),
            Kind::Method("app.save"),
        ),
        t(
            "cancel",
            "Press Escape: cancel the running command (or clear the selection).",
            json!({"type": "object", "properties": {}}),
            Kind::Key("escape"),
        ),
    ]
}

/// The tools that need a window: a picture of it, its state, a click in it.
pub fn ui_tools() -> Vec<Tool> {
    let t = |name, description, schema, kind| Tool { name, description, schema, kind, ui: true };
    vec![
        t(
            "render",
            "Render the active drawing to a PNG and return it as an image: fitted to the extents by default, or just the area `window` [[x0,y0],[x1,y1]] (drawing units), e.g. one sheet or one room of a large drawing. With a window and no size the image is 1600 px wide with the window's shape.",
            json!({"type": "object", "properties": {"width": {"type": "integer", "minimum": 16}, "height": {"type": "integer", "minimum": 16}, "fit": {"type": "boolean"},
                "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "path": {"type": "string"}}}),
            Kind::Method("ui.render"),
        ),
        t(
            "screenshot",
            "Screenshot the CADCraft window (PNG).",
            json!({"type": "object", "properties": {"path": {"type": "string"}}}),
            Kind::Method("ui.screenshot"),
        ),
        t(
            "ui_inspect",
            "UI state: panels, canvas rect, view, cursor and snap, performance.",
            json!({"type": "object", "properties": {}}),
            Kind::Method("ui.inspect"),
        ),
        t(
            "ui_click",
            "Click in the drawing area at world coordinates (or screen with space:\"screen\"). Right button = Enter.",
            json!({"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "space": {"type": "string"}, "button": {"type": "string"}}, "required": ["x", "y"]}),
            Kind::Method("ui.pointer"),
        ),
    ]
}

/// The catalog as MCP's `tools/list` wants it: `{name, description, inputSchema}`.
pub fn definitions(tools: &[Tool]) -> Vec<Value> {
    tools.iter().map(Tool::definition).collect()
}

/// The same catalog as a chat API wants it: `{type: "function", function: {name, description,
/// parameters}}`. The two envelopes differ in exactly this, and sending one where the other
/// belongs makes every tool invisible to the model.
pub fn chat_definitions(tools: &[Tool]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {"name": t.name, "description": t.description, "parameters": t.schema}
            })
        })
        .collect()
}

/// Whether a command-catalog entry's id, label or one of its aliases contains `f` (lower case).
fn command_matches(c: &Value, f: &str) -> bool {
    let has = |s: &str| s.to_ascii_lowercase().contains(f);
    ["id", "label"].iter().any(|k| c[*k].as_str().is_some_and(has))
        || c["aliases"].as_array().is_some_and(|a| a.iter().filter_map(Value::as_str).any(has))
}

/// The control call a tool maps to, as `(method, params)` — the same pair [`dispatch`] makes. A
/// host that wants to run a call itself (queue it, log it, forward it) uses this to know what it
/// is asking for. `None` for an unknown tool.
pub fn dispatch_spec(name: &str, args: &Value) -> Option<(String, Value)> {
    let tools = tools();
    let tool = tools.iter().find(|t| t.name == name)?;
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return None,
    };
    Some(match tool.kind {
        Kind::Method(method) => (method.to_string(), args),
        Kind::Command(id) => ("engine.execute".to_string(), json!({"command": id, "params": args})),
        Kind::Execute => {
            let command = args.get("command")?.as_str()?.to_string();
            let params = args.get("params").cloned().unwrap_or_else(|| json!({}));
            ("engine.execute".to_string(), json!({"command": command, "params": params}))
        }
        Kind::ListCommands => ("engine.commands".to_string(), json!({})),
        Kind::Key(key) => ("cmdline.key".to_string(), json!({"key": key})),
    })
}

/// Run a tool against the harness. `None` is an unknown tool (a protocol error to the caller);
/// `Some(Err)` is a tool that ran and failed, which the model reads and may retry differently.
///
/// [`Kind::Host`] tools are the caller's: this returns `None` for them so the host can answer
/// with whatever its own result looks like (an image, a screenshot).
pub fn dispatch(h: &mut dyn Harness, name: &str, args: &Value) -> Option<Result<Value, String>> {
    let tools = tools();
    let tool = tools.iter().find(|t| t.name == name)?;
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        other => return Some(Err(format!("`{name}` takes an object of arguments, got {other}"))),
    };
    Some(match tool.kind {
        Kind::Method(method) => h.call(method, args),
        Kind::Command(id) => h.call("engine.execute", json!({"command": id, "params": args})),
        Kind::Execute => {
            let Some(command) = args.get("command").and_then(Value::as_str) else {
                return Some(Err("`execute` needs `command`".into()));
            };
            let params = args.get("params").cloned().unwrap_or_else(|| json!({}));
            h.call("engine.execute", json!({"command": command, "params": params}))
        }
        Kind::ListCommands => h.call("engine.commands", json!({})).map(|v| {
            let f = args.get("filter").and_then(Value::as_str).map(str::to_ascii_lowercase);
            match (v, f) {
                (Value::Array(items), Some(f)) => Value::Array(items.into_iter().filter(|c| command_matches(c, &f)).collect()),
                (v, _) => v,
            }
        }),
        Kind::Key(key) => h.call("cmdline.key", json!({"key": key})),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A harness that records the calls and answers with a canned value.
    #[derive(Default)]
    struct Recorder {
        calls: Vec<(String, Value)>,
    }

    impl Harness for Recorder {
        fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.push((method.to_string(), params.clone()));
            if method == "engine.commands" {
                return Ok(json!([
                    {"id": "line", "label": "Line", "aliases": ["l", "zz"]},
                    {"id": "circle", "label": "Circle", "aliases": ["c"]}
                ]));
            }
            if params.get("fail").and_then(Value::as_bool).unwrap_or(false) {
                return Err("nope".into());
            }
            Ok(json!({"ok": method}))
        }
    }

    #[test]
    fn every_tool_has_a_usable_definition() {
        let tools = tools();
        assert!(tools.len() >= 18, "the catalog: {}", tools.len());
        for t in &tools {
            assert!(!t.name.is_empty() && !t.description.is_empty(), "{} has no description", t.name);
            assert_eq!(t.schema["type"], "object", "{} is not an object schema", t.name);
            assert!(t.schema["properties"].is_object(), "{} has no properties", t.name);
            // The name is what the model writes back: keep it callable.
            assert!(t.name.chars().all(|c| c.is_ascii_lowercase() || c == '_'), "{} is not a tool name", t.name);
        }
        let names: Vec<&str> = tools.iter().map(|t| t.name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "duplicate tool names: {names:?}");
        assert_eq!(definitions(&tools).len(), tools.len());
    }

    #[test]
    fn the_spec_and_the_dispatch_agree_on_every_tool() {
        for t in tools() {
            let args = json!({"command": "x", "params": {}, "text": "y", "filter": "z"});
            let spec = dispatch_spec(t.name, &args).unwrap_or_else(|| panic!("{} has no spec", t.name));
            let mut h = Recorder::default();
            dispatch(&mut h, t.name, &args).unwrap().unwrap();
            assert_eq!(h.calls.len(), 1, "{} made {} calls", t.name, h.calls.len());
            assert_eq!(h.calls[0].0, spec.0, "{}: method", t.name);
            if spec.0 != "engine.commands" {
                assert_eq!(h.calls[0].1, spec.1, "{}: params", t.name);
            }
        }
        assert!(dispatch_spec("no_such_tool", &json!({})).is_none());
    }

    #[test]
    fn a_command_tool_runs_through_engine_execute() {
        let mut h = Recorder::default();
        let r = dispatch(&mut h, "query_entities", &json!({"type": "Circle", "limit": 5})).unwrap().unwrap();
        assert_eq!(r["ok"], "engine.execute");
        assert_eq!(h.calls[0].0, "engine.execute");
        assert_eq!(h.calls[0].1["command"], "entities");
        assert_eq!(h.calls[0].1["params"]["type"], "Circle");
        assert_eq!(h.calls[0].1["params"]["limit"], 5);
    }

    #[test]
    fn execute_passes_the_command_and_params_through() {
        let mut h = Recorder::default();
        dispatch(&mut h, "execute", &json!({"command": "circle", "params": {"radius": 5}})).unwrap().unwrap();
        assert_eq!(h.calls[0].1, json!({"command": "circle", "params": {"radius": 5}}));
        let mut h = Recorder::default();
        let err = dispatch(&mut h, "execute", &json!({})).unwrap().unwrap_err();
        assert!(err.contains("needs `command`"), "{err}");
        assert!(h.calls.is_empty(), "nothing ran");
    }

    #[test]
    fn a_method_tool_calls_its_method_and_a_key_tool_presses_its_key() {
        let mut h = Recorder::default();
        dispatch(&mut h, "command_line", &json!({"text": "line 0,0 @10,0"})).unwrap().unwrap();
        assert_eq!(h.calls[0], ("cmdline.input".into(), json!({"text": "line 0,0 @10,0"})));
        dispatch(&mut h, "cancel", &json!({})).unwrap().unwrap();
        assert_eq!(h.calls[1], ("cmdline.key".into(), json!({"key": "escape"})));
    }

    #[test]
    fn list_commands_filters_by_id_label_or_alias() {
        let mut h = Recorder::default();
        let all = dispatch(&mut h, "list_commands", &json!({})).unwrap().unwrap();
        assert_eq!(all.as_array().unwrap().len(), 2);
        let some = dispatch(&mut h, "list_commands", &json!({"filter": "circ"})).unwrap().unwrap();
        assert_eq!(some.as_array().unwrap().len(), 1);
        assert_eq!(some[0]["id"], "circle");
        let alias = dispatch(&mut h, "list_commands", &json!({"filter": "zz"})).unwrap().unwrap();
        assert_eq!(alias.as_array().unwrap().len(), 1, "an alias matches: {alias}");
        assert_eq!(alias[0]["id"], "line");
    }

    #[test]
    fn a_failing_tool_reports_its_error_and_an_unknown_tool_is_none() {
        let mut h = Recorder::default();
        let r = dispatch(&mut h, "inspect_drawing", &json!({"fail": true})).unwrap();
        assert_eq!(r.unwrap_err(), "nope");
        assert!(dispatch(&mut h, "no_such_tool", &json!({})).is_none());
    }

    #[test]
    fn the_ui_tools_are_a_separate_group() {
        let core = core_tools();
        let ui = ui_tools();
        assert!(core.iter().all(|t| !t.ui));
        assert!(ui.iter().all(|t| t.ui));
        assert!(core.iter().all(|t| t.name != "screenshot"));
        assert!(ui.iter().any(|t| t.name == "render"));
        // The two envelopes, for the two protocols.
        let mcp = definitions(&core);
        let chat = chat_definitions(&core);
        assert!(mcp[0]["inputSchema"].is_object(), "{mcp:?}");
        assert_eq!(chat[0]["type"], "function");
        assert!(chat[0]["function"]["parameters"].is_object(), "{chat:?}");
        assert!(chat[0]["function"]["name"].is_string());
    }
}
