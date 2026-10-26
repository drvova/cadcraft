//! MCP tool definitions and dispatch.

use serde_json::{Value, json};

use crate::backend::Backend;

/// The `tools/list` payload: one definition (name, description, input schema) per MCP tool,
/// including the UI-only tools when `has_ui` says a window is available.
pub fn tool_definitions(has_ui: bool) -> Value {
    let mut tools = vec![
        json!({"name": "command_line", "description": "Type one line at the CADCraft command line, exactly as a user would at an AutoCAD-style prompt. Starts commands by name or alias (LINE, L, CIRCLE, C, PLINE, RECTANG, MOVE, TRIM, OFFSET, ZOOM…) and answers the active prompt: points `x,y`, relative `@dx,dy`, polar `@dist<angle`, distances, keywords (e.g. `c` for Close), empty text = Enter. Spaces act as Enter, so `circle 0,0 5` works in one call. Returns the new prompt and command-line output, and `error` when the line was refused.",
            "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}),
        json!({"name": "script", "description": "Run a multi-line script (like an AutoCAD .scr file): one or more inputs per line, blank line = Enter.",
            "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}),
        json!({"name": "execute", "description": "Run any command with JSON parameters (no prompts or dialogs). Use list_commands to find ids and parameter docs. Examples: line {points:[[0,0],[10,0]]}, circle {center:[0,0], radius:5}, layer.new {name:\"Walls\", color:\"red\", current:true}, move {handles:[\"10A\"], delta:[5,0]}, zoom {mode:\"extents\"}.",
            "inputSchema": {"type": "object", "properties": {"command": {"type": "string"}, "params": {"type": "object"}}, "required": ["command"]}}),
        json!({"name": "list_commands", "description": "List commands with ids, labels, menu paths, aliases and parameter docs. Optional filter: a substring of the command id, label or an alias.",
            "inputSchema": {"type": "object", "properties": {"filter": {"type": "string"}}}}),
        json!({"name": "inspect_drawing", "description": "Summary of the active drawing: entity counts, extents, layers, styles, blocks, layouts, selection, undo history and (optionally) entities with handles and geometry.",
            "inputSchema": {"type": "object", "properties": {"entities": {"type": "boolean"}, "limit": {"type": "integer"}}}}),
        json!({"name": "query_entities", "description": "Entities filtered by type (Line, Circle, Polyline…), layer, current selection (selected:true; active space only) and/or a window [[x0,y0],[x1,y1]] (objects whose geometry is inside or crosses it; crossing:false = entirely inside). Returns count (all matches), returned (this page) and entities; page with offset and limit (default 500).",
            "inputSchema": {"type": "object", "properties": {"type": {"type": "string"}, "layer": {"type": "string"}, "selected": {"type": "boolean"},
                "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "crossing": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0}}}}),
        json!({"name": "render", "description": "Render the active drawing to a PNG and return it as an image: fitted to the extents by default, or just the area `window` [[x0,y0],[x1,y1]] (drawing units), e.g. one sheet or one room of a large drawing. With a window and no size the image is 1600 px wide with the window's shape.",
            "inputSchema": {"type": "object", "properties": {"width": {"type": "integer", "minimum": 16}, "height": {"type": "integer", "minimum": 16}, "fit": {"type": "boolean"},
                "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "path": {"type": "string"}}}}),
        json!({"name": "find_text", "description": "Read the drawing's texts: TEXT, MTEXT (formatting removed), block attributes and multileaders, each with its text, insertion point `at`, height, rotation, style, layer and handle. Filter by `contains` (any case), `layer` and/or `window` [[x0,y0],[x1,y1]] around the insertion points; page with offset and limit (default 200). Use it to find room names, sheet titles and notes without reading all the geometry.",
            "inputSchema": {"type": "object", "properties": {"contains": {"type": "string"}, "layer": {"type": "string"},
                "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "limit": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0}}}}),
        json!({"name": "attach_image", "description": "Place a raster image (PNG or JPEG) in the drawing as an IMAGE reference: a photo, scan or reference picture to trace over or ship with the drawing. Give `path` (a file the CADCraft process can read) or `data` (base64 of the file, for uploads). The insertion point is the image's lower-left corner (`at`, default 0,0). Size it with `width` and/or `height` in drawing units (one of them keeps the picture's shape; default: 1 unit per pixel), rotate with `rotation` (degrees), and optionally crop with `clip` (two opposite corners or a boundary polygon, in pixels from the top-left) and dim it with `brightness`/`contrast`/`fade` (0-100). Returns the new handle, the pixel size, the placed size in drawing units and unitsPerPixel. Pair with trace_image to turn the picture's shapes into editable geometry, and with render to see the result.",
            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "data": {"type": "string"}, "name": {"type": "string"},
                "at": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                "width": {"type": "number"}, "height": {"type": "number"}, "rotation": {"type": "number"}, "layer": {"type": "string"},
                "clip": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2},
                "brightness": {"type": "number"}, "contrast": {"type": "number"}, "fade": {"type": "number"}}}}),
        json!({"name": "trace_image", "description": "Vectorize a raster image into editable polylines: the fast way to turn a photo or scan of a part (a wing, a bracket, a logo) into CAD geometry. Thresholds the picture (`mode: dark` traces dark shapes, `light` traces light ones, `alpha` traces opaque pixels of a PNG), finds each region's outline with marching squares at sub-pixel accuracy, simplifies it (Douglas-Peucker, `simplify` in pixels) and adds one closed polyline per contour. Source: `path`, base64 `data`, or `handle` of a placed image (which keeps that image's placement and scale). `scale` sets drawing units per pixel (default 1 for a path/data, the image's own for a handle). Size the result directly with `width` and/or `height` in drawing units: the whole traced outline is scaled about its own corner, so a traced part comes out at the measurement wanted. `threshold` defaults to Otsu (the level that best separates the picture); `blur` (pixels, default 1) smooths noise before tracing; `minArea` (square pixels, default 9) drops specks; `holes: false` keeps only the outermost outlines; `downsample` (1-16) traces a reduced copy for big pictures. Returns the contour and point counts, the polylines' handles, the traced bounds, the threshold used, any `scaledBy` factors and what was `skipped` (small, holes, capped).",
            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "data": {"type": "string"}, "handle": {"type": "string"},
                "at": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "scale": {"type": "number"},
                "width": {"type": "number"}, "height": {"type": "number"},
                "mode": {"type": "string", "enum": ["dark", "light", "alpha"]}, "threshold": {"type": "number", "minimum": 0, "maximum": 255},
                "blur": {"type": "integer", "minimum": 0, "maximum": 8}, "simplify": {"type": "number", "minimum": 0, "maximum": 64},
                "downsample": {"type": "integer", "minimum": 1, "maximum": 16}, "minArea": {"type": "number", "minimum": 0},
                "holes": {"type": "boolean"}, "closed": {"type": "boolean"}, "layer": {"type": "string"},
                "maxContours": {"type": "integer", "minimum": 1}, "maxPoints": {"type": "integer", "minimum": 3}}}}),
        json!({"name": "describe_drawing", "description": "An in-depth, measured report of a drawing or a selection: the answer to \"what is actually in here?\". Returns counts by object type; extents, size and centre with the drawing's units; per-layer usage (objects, colour, linetype, on/frozen/locked); total drawn length and length per type; closed shapes with the area they enclose; open contours (outlines never closed) with their length; texts with their contents; block references by name; raster references with pixel sizes and units-per-pixel; degenerate (zero-length) objects; optional chain analysis (`loops: true`) of loose LINEs and ARCs, reporting gaps and junctions; per-object detail (`detail: true`, or whenever a selection is given) with handle, layer, length, area, closed flag, vertices and bounds; `notes` for what stands out; and a plain-language `message` narrating all of it. Scope: the active space by default, or `space: model|all|<layout>`, or explicit `handles`, optionally restricted to a `window`. Use it before editing an unfamiliar drawing, and after building or tracing geometry to verify what was produced. When the drawing holds jewelry, the report also reads it as such: stones by cut and size with their carats, and each band with the size and metal its block carries (see `bench_sheet`).",
            "inputSchema": {"type": "object", "properties": {"handles": {"type": "array", "items": {"type": "string"}}, "handle": {"type": "string"},
                "space": {"type": "string"}, "window": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 2, "maxItems": 2},
                "crossing": {"type": "boolean"}, "detail": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 0},
                "loops": {"type": "boolean"}, "maxPairs": {"type": "integer", "minimum": 0}, "tolerance": {"type": "number"}}}}),
        json!({"name": "bench_sheet", "description": "Read the drawing as a jeweler's bench sheet: every stone, by cut and size, with its count and carat weight, and the metal of the band, in grams. Stones are the inserts of GEM-… blocks, so it counts what is really in the drawing; each stone's material and depth come from its own block, and the carat from the trade's per-cut formula (a 6.5 mm round brilliant is 1.03 ct). Give `section` (a closed polyline cross-section: x = the distance from the finger's surface, outward, y = along the finger) with `size` (a ring size, e.g. 6 with `system`: us|uk|eu|jp|cn) or `radius` (mm) to weigh metal by Pappus's theorem at the alloy's density (`metal`: gold24|22|18|14|10|9, platinum, palladium, silver, steel, titanium, wax). Set `table: true` to also draw the sheet as a table at `at`. Returns the stone groups (cut, width, length, depth, sg, count, caratEach, carat, depthFrom), the totals, the metal weight (sectionArea, centroidFromAxis, volumeMm3, grams) and a plain-language summary. The jewelry commands behind it — GEM, GEMLIST, PAVE, GEMFIT, SETTING, RING, RINGSIZES, TECHSHEET — all run through `execute` too.",
            "inputSchema": {"type": "object", "properties": {"handles": {"type": "array", "items": {"type": "string"}}, "metal": {"type": "string"},
                "section": {"type": "string"}, "size": {}, "radius": {"type": "number"}, "system": {"type": "string"},
                "table": {"type": "boolean"}, "at": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "layer": {"type": "string"}}}}),
        json!({"name": "new_drawing", "description": "Create a new drawing (imperial by default, or metric).",
            "inputSchema": {"type": "object", "properties": {"metric": {"type": "boolean"}}}}),
        json!({"name": "open", "description": "Open a DXF or DWG file.", "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}),
        json!({"name": "save", "description": "Save the drawing (DXF or DWG by extension). A .svg, .png or .pdf path exports instead: the drawing keeps its name and unsaved changes.", "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}}),
        json!({"name": "cancel", "description": "Press Escape: cancel the running command (or clear the selection).", "inputSchema": {"type": "object", "properties": {}}}),
    ];
    if has_ui {
        tools.push(json!({"name": "screenshot", "description": "Screenshot the CADCraft window (PNG).", "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}}));
        tools.push(json!({"name": "ui_inspect", "description": "UI state: panels, canvas rect, view, cursor and snap, performance.", "inputSchema": {"type": "object", "properties": {}}}));
        tools.push(json!({"name": "ui_click", "description": "Click in the drawing area at world coordinates (or screen with space:\"screen\"). Right button = Enter.", "inputSchema": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "space": {"type": "string"}, "button": {"type": "string"}}, "required": ["x", "y"]}}));
    }
    json!({ "tools": tools })
}

/// Wrap a JSON value as a successful MCP result containing pretty-printed text.
fn text(v: &Value) -> Value {
    json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(v).unwrap_or_default()}]})
}

/// Wrap an error message as an MCP tool error result (`isError`), not a protocol error.
fn err_text(e: &str) -> Value {
    json!({"content": [{"type": "text", "text": e}], "isError": true})
}

/// Whether `v` fits the subset of JSON Schema the tool definitions use: `type`, `items`,
/// `minItems`, `maxItems` and `minimum`.
fn fits(v: &Value, schema: &Value) -> bool {
    let typed = match schema["type"].as_str() {
        Some("string") => v.is_string(),
        // JSON Schema integers include numbers such as 2.0.
        Some("integer") => v.as_f64().is_some_and(|f| f.fract() == 0.0),
        Some("number") => v.is_number(),
        Some("boolean") => v.is_boolean(),
        Some("array") => v.is_array(),
        Some("object") => v.is_object(),
        _ => true,
    };
    let len = v.as_array().map(Vec::len);
    typed
        && schema["minimum"].as_f64().is_none_or(|m| v.as_f64().is_none_or(|f| f >= m))
        && schema["minItems"].as_u64().is_none_or(|m| len.is_none_or(|n| n as u64 >= m))
        && schema["maxItems"].as_u64().is_none_or(|m| len.is_none_or(|n| n as u64 <= m))
        && (schema["items"].is_null() || v.as_array().is_none_or(|a| a.iter().all(|i| fits(i, &schema["items"]))))
}

/// Arguments checked against the tool's input schema: an object, required properties present and
/// each given property fitting its schema (`null` counts as not given). `Err` is the
/// invalid-params message.
fn check_args(name: &str, args: &Value) -> Result<Value, String> {
    let defs = tool_definitions(true);
    let schema = defs["tools"].as_array().and_then(|t| t.iter().find(|t| t["name"] == name)).map(|t| t["inputSchema"].clone());
    let Some(schema) = schema else { return Err(format!("unknown tool `{name}`")) };
    let a = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return Err(format!("`arguments` of `{name}` must be an object")),
    };
    for key in schema["required"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        if a.get(key).is_none_or(Value::is_null) {
            return Err(format!("`{name}` needs `{key}`"));
        }
    }
    for (key, prop) in schema["properties"].as_object().into_iter().flatten() {
        if let Some(v) = a.get(key).filter(|v| !v.is_null())
            && !fits(v, prop)
        {
            return Err(format!("`{key}` of `{name}` must match {prop}"));
        }
    }
    Ok(a)
}

/// Whether a command-catalog entry's id, label or one of its aliases contains `f` (lower case).
fn command_matches(c: &Value, f: &str) -> bool {
    let has = |s: &str| s.to_ascii_lowercase().contains(f);
    ["id", "label"].iter().any(|k| c[*k].as_str().is_some_and(has))
        || c["aliases"].as_array().is_some_and(|a| a.iter().filter_map(Value::as_str).any(has))
}

/// Run a tool. `Err` is a protocol error (unknown tool, or arguments that don't fit its input
/// schema), answered with JSON-RPC invalid params; a failing tool is an `isError` result.
pub fn call_tool(b: &mut dyn Backend, name: &str, args: &Value) -> Result<Value, String> {
    let a = check_args(name, args)?;
    let r = match name {
        "command_line" => b.call("cmdline.input", a),
        "script" => b.call("cmdline.script", a),
        "execute" => b.call(
            "engine.execute",
            json!({"command": a.get("command").cloned().unwrap_or(Value::Null), "params": a.get("params").cloned().unwrap_or(json!({}))}),
        ),
        "list_commands" => b.call("engine.commands", json!({})).map(|v| {
            let f = a.get("filter").and_then(Value::as_str).map(str::to_ascii_lowercase);
            match (v, f) {
                (Value::Array(items), Some(f)) => Value::Array(items.into_iter().filter(|c| command_matches(c, &f)).collect()),
                (v, _) => v,
            }
        }),
        "inspect_drawing" => b.call("drawing.inspect", a),
        "query_entities" => b.call("engine.execute", json!({"command": "entities", "params": a})),
        "find_text" => b.call("engine.execute", json!({"command": "texts", "params": a})),
        "attach_image" => b.call("engine.execute", json!({"command": "imageattach", "params": a})),
        "trace_image" => b.call("engine.execute", json!({"command": "imagetrace", "params": a})),
        "describe_drawing" => b.call("engine.execute", json!({"command": "describe", "params": a})),
        "bench_sheet" => b.call("engine.execute", json!({"command": "techsheet", "params": a})),
        "new_drawing" => b.call("engine.execute", json!({"command": "new", "params": a})),
        "open" => b.call("app.open", a),
        "save" => b.call("app.save", a),
        "cancel" => b.call("cmdline.key", json!({"key": "escape"})),
        "screenshot" => b.call("ui.screenshot", a),
        "ui_inspect" => b.call("ui.inspect", json!({})),
        "ui_click" => b.call("ui.pointer", a),
        "render" => {
            return Ok(match b.call("ui.render", a) {
                Ok(v) => match v.get("pngBase64").and_then(Value::as_str) {
                    Some(data) => json!({"content": [{"type": "image", "data": data, "mimeType": "image/png"}]}),
                    None => text(&v),
                },
                Err(e) => err_text(&e),
            });
        }
        other => return Err(format!("unknown tool `{other}`")),
    };
    Ok(match r {
        Ok(v) => text(&v),
        Err(e) => err_text(&e),
    })
}
