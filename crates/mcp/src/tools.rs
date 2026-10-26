//! MCP tool definitions and dispatch.
//!
//! The catalog itself lives in `cadcraft_ai::surface` — the same tools the in-app assistant gets,
//! so a command reachable from one is reachable from the other — and this module adds the
//! protocol's own wrapping: JSON-RPC error codes, `isError` results, and the image content block
//! `render` answers with.

use serde_json::{Value, json};

use crate::backend::Backend;

/// The `tools/list` payload: one definition (name, description, input schema) per MCP tool,
/// including the UI-only tools when `has_ui` says a window is available.
pub fn tool_definitions(has_ui: bool) -> Value {
    let mut tools = cadcraft_ai::surface::definitions(&cadcraft_ai::surface::core_tools());
    if has_ui {
        tools.extend(cadcraft_ai::surface::definitions(&cadcraft_ai::surface::ui_tools()));
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

/// The application's control harness, as the shared surface calls it.
struct Adapter<'a>(&'a mut dyn Backend);

impl cadcraft_ai::surface::Harness for Adapter<'_> {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.0.call(method, params)
    }
}

/// Run a tool. `Err` is a protocol error (unknown tool, or arguments that don't fit its input
/// schema), answered with JSON-RPC invalid params; a failing tool is an `isError` result.
pub fn call_tool(b: &mut dyn Backend, name: &str, args: &Value) -> Result<Value, String> {
    let a = check_args(name, args)?;
    // `render` is the one tool whose result is not text: the PNG becomes an image content block.
    if name == "render" {
        return Ok(match b.call("ui.render", a) {
            Ok(v) => match v.get("pngBase64").and_then(Value::as_str) {
                Some(data) => json!({"content": [{"type": "image", "data": data, "mimeType": "image/png"}]}),
                None => text(&v),
            },
            Err(e) => err_text(&e),
        });
    }
    match cadcraft_ai::surface::dispatch(&mut Adapter(b), name, &a) {
        None => Err(format!("unknown tool `{name}`")),
        Some(Ok(v)) => Ok(text(&v)),
        Some(Err(e)) => Ok(err_text(&e)),
    }
}
