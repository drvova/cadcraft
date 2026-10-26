//! MCP tool definitions and dispatch.
//!
//! **One tool.** The catalog lives in `cadcraft_ai::code` — `run`, which executes AutoLISP in the
//! open drawing — and this module adds only the protocol's wrapping: JSON-RPC error codes,
//! `isError` results, and the image content blocks a run's `(render …)` answers with. There is no
//! verb per capability here, and none is added when a command lands: a capability is a command
//! the code calls.
//!
//! **Running code is what the server does.** There is no enable/disable flag and no code-free
//! mode; run the server sandboxed (a container, a VM, a jail) when the model driving it is not
//! trusted with the user's files.

use serde_json::{Value, json};

use crate::backend::Backend;

/// The `tools/list` payload: one definition, `run`. `has_ui` changes nothing — the tool set does
/// not branch on anything.
pub fn tool_definitions(_has_ui: bool) -> Value {
    json!({ "tools": cadcraft_ai::surface::tools() })
}

/// Wrap a message as a failing MCP result.
fn err_text(e: &str) -> Value {
    json!({"content": [{"type": "text", "text": e}], "isError": true})
}

/// Whether `v` fits a schema's declared type (the shallow check the arguments get).
fn fits(v: &Value, schema: &Value) -> bool {
    match schema.get("type").and_then(Value::as_str) {
        Some("string") => v.is_string(),
        Some("number") => v.is_number(),
        Some("integer") => v.as_i64().is_some() || v.as_u64().is_some(),
        Some("boolean") => v.is_boolean(),
        Some("array") => v.is_array(),
        Some("object") => v.is_object(),
        _ => true,
    }
}

/// Check a call's arguments against the tool's schema. `Err` is a JSON-RPC invalid-params error.
fn check_args(args: &Value) -> Result<Value, String> {
    let schema = cadcraft_ai::code::schema();
    let a = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return Err("`arguments` must be an object".into()),
    };
    for key in schema["required"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        if a.get(key).is_none_or(Value::is_null) {
            return Err(format!("`run` needs `{key}`"));
        }
    }
    for (key, prop) in schema["properties"].as_object().into_iter().flatten() {
        if let Some(v) = a.get(key).filter(|v| !v.is_null())
            && !fits(v, prop)
        {
            return Err(format!("`{key}` of `run` must match {prop}"));
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
/// schema), answered with JSON-RPC invalid params; a failing run is an `isError` result the model
/// reads and can retry differently.
pub fn call_tool(b: &mut dyn Backend, name: &str, args: &Value) -> Result<Value, String> {
    if name != cadcraft_ai::code::TOOL {
        return Err(format!("unknown tool `{name}`; the server has one tool, `{}`", cadcraft_ai::code::TOOL));
    }
    // `check_args` is the schema check (a protocol error); `code::check_args` is the same check
    // the tool makes before it runs anything.
    let a = check_args(args)?;
    let checked = cadcraft_ai::code::check_args(&a)?;
    // The arguments are sound: from here a failure is the run's, not the caller's. A server whose
    // application is not answering says so as a tool error the model can act on.
    let report = match cadcraft_ai::code::call_checked(&mut Adapter(b), &checked) {
        Ok(r) => r,
        Err(e) => return Ok(err_text(&e)),
    };
    // A run that drew pictures returns them as image content blocks beside its text, so a client
    // sees what the code produced, not just a file path.
    let mut content: Vec<Value> = vec![json!({"type": "text", "text": report.text()})];
    for path in &report.images {
        match std::fs::read(path) {
            Ok(bytes) => content.push(json!({"type": "image", "data": cadcraft_engine::cmd::file::base64_encode(&bytes), "mimeType": "image/png"})),
            Err(e) => content.push(json!({"type": "text", "text": format!("(could not read the render at {path}: {e})")})),
        }
    }
    Ok(json!({"content": content, "isError": report.error.is_some()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A backend that records control calls and answers with a canned run result.
    #[derive(Default)]
    struct Recorder {
        calls: Vec<(String, Value)>,
        answer: Value,
    }

    impl Backend for Recorder {
        fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.push((method.to_string(), params));
            Ok(self.answer.clone())
        }
        fn has_ui(&self) -> bool {
            false
        }
        fn describe(&self) -> String {
            "test".into()
        }
    }

    #[test]
    fn the_tool_list_is_exactly_run() {
        let defs = tool_definitions(false);
        let names: Vec<&str> = defs["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
        assert_eq!(names, vec!["run"]);
        // A window changes nothing: the tool set does not branch.
        assert_eq!(tool_definitions(true), defs);
        assert_eq!(defs["tools"][0]["inputSchema"]["properties"].as_object().unwrap().len(), 2);
    }

    #[test]
    fn a_call_runs_the_code_and_returns_the_report_as_text() {
        let mut b = Recorder { answer: json!({"value": "((COUNT . 1))", "output": ["drew one"]}), ..Recorder::default() };
        let r = call_tool(&mut b, "run", &json!({"code": r#"(cmd "entities")"#})).unwrap();
        assert_eq!(b.calls[0].0, "engine.execute");
        assert_eq!(b.calls[0].1, json!({"command": "run", "params": {"code": r#"(cmd "entities")"#, "values": {}}}));
        assert_eq!(r["isError"], false);
        let text = r["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("drew one"), "{text}");
        assert!(text.contains("=> ((COUNT . 1))"), "{text}");
    }

    #[test]
    fn a_failing_run_is_an_is_error_result_the_model_reads() {
        let mut b = Recorder { answer: json!({"error": "divide by zero", "output": ["halfway"]}), ..Recorder::default() };
        let r = call_tool(&mut b, "run", &json!({"code": "(/ 1 0)"})).unwrap();
        assert_eq!(r["isError"], true);
        let text = r["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("divide by zero"), "{text}");
        assert!(text.contains("halfway"), "what it printed before failing is kept: {text}");
    }

    #[test]
    fn an_empty_call_returns_the_manual_as_text() {
        let mut b = Recorder { answer: json!({"manual": "the namespace: (cmd …) (commands) (kept)"}), ..Recorder::default() };
        let r = call_tool(&mut b, "run", &json!({})).unwrap();
        assert_eq!(b.calls[0].1["params"], json!({"code": "", "values": {}}));
        assert_eq!(r["content"][0]["text"], "the namespace: (cmd …) (commands) (kept)");
    }

    #[test]
    fn a_capability_that_is_not_run_is_an_invalid_params_error() {
        let mut b = Recorder::default();
        let e = call_tool(&mut b, "query_entities", &json!({"type": "Circle"})).unwrap_err();
        assert!(e.contains("unknown tool"), "{e}");
        assert!(e.contains("one tool, `run`"), "{e}");
        assert!(b.calls.is_empty(), "nothing ran");
    }

    #[test]
    fn malformed_arguments_are_refused_before_the_run() {
        let mut b = Recorder::default();
        let e = call_tool(&mut b, "run", &json!({"code": 5})).unwrap_err();
        assert!(e.contains("`code` of `run` must match"), "{e}");
        let e = call_tool(&mut b, "run", &json!("not an object")).unwrap_err();
        assert!(e.contains("must be an object"), "{e}");
        assert!(b.calls.is_empty());
    }

    #[test]
    fn a_render_comes_back_as_an_image_content_block() {
        // A real PNG on disk: the result carries the picture itself, not only its path.
        let path = std::env::temp_dir().join(format!("cadcraft-mcp-test-{}.png", std::process::id()));
        let png = [0x89u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        std::fs::write(&path, png).expect("write");
        let mut b = Recorder { answer: json!({"value": "((PATH . \"r.png\"))", "images": [path.to_string_lossy()]}), ..Recorder::default() };
        let r = call_tool(&mut b, "run", &json!({"code": "(render)"})).unwrap();
        let content = r["content"].as_array().unwrap();
        assert_eq!(content.len(), 2, "text and the picture: {r}");
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["mimeType"], "image/png");
        assert!(!content[1]["data"].as_str().unwrap().is_empty(), "the bytes are inlined");
        let _ = std::fs::remove_file(&path);
    }
}
