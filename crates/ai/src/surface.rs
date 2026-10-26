//! The surface: what a model can do to a running CADCraft.
//!
//! **One tool, and only one.** [`crate::code`] holds it: `run`, which runs AutoLISP in the open
//! drawing and returns what it printed, what it was worth and the pictures it drew. The model
//! builds its own tooling from inside that namespace — `(cmd "circle" …)`, `(commands)`,
//! `(describe "id")`, `(defun …)` kept across sessions — so no verb is advertised per capability
//! and no glue is needed when a command lands.
//!
//! The MCP server and the in-app assistant both publish exactly this list and dispatch through
//! [`Harness`], so a capability reachable from one is reachable from the other, with the same
//! result. There is deliberately nothing to branch on: no per-model tool set, no enable/disable
//! flag, no second structured interface.

use serde_json::Value;

/// What a tool call reaches: the application's own control harness (`engine.execute`,
/// `cmdline.input`, `drawing.inspect`, …). The application implements it; a test implements it
/// with a recording double.
pub trait Harness {
    /// Invoke one control method and return its result.
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String>;
}

/// The tool catalog: one entry, `run`.
pub fn tools() -> Vec<Value> {
    vec![crate::code::definition()]
}

/// The same catalog as a chat API wants it.
pub fn chat_tools() -> Vec<Value> {
    vec![crate::code::chat_definition()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The advertised tool set is exactly `{run}` — one tool, unconditionally.
    #[test]
    fn the_advertised_tool_set_is_exactly_run() {
        let names: Vec<String> = tools().iter().filter_map(|t| t["name"].as_str().map(str::to_string)).collect();
        assert_eq!(names, vec![crate::code::TOOL.to_string()], "one tool, and it is `run`");
        assert_eq!(tools().len(), 1);
        // No verb-per-capability catalog, in either envelope.
        let chat: Vec<String> = chat_tools().iter().filter_map(|t| t["function"]["name"].as_str().map(str::to_string)).collect();
        assert_eq!(chat, names);
        for forbidden in ["execute", "command_line", "query_entities", "describe_drawing", "render", "screenshot", "inspect_drawing"] {
            assert!(!names.iter().any(|n| n == forbidden), "`{forbidden}` is not advertised as a tool");
        }
    }

    #[test]
    fn the_surface_has_no_per_capability_dispatch() {
        // There is nothing to dispatch to: a tool call is a code call. The only entry point is
        // `crate::code::call`, which names the `run` command.
        assert_eq!(crate::code::COMMAND, "run");
        assert_eq!(crate::code::TOOL, "run");
        // And the schema is `code` + `values`, not an `action`/verb selector.
        let s = crate::code::schema();
        assert!(!s["properties"].as_object().unwrap().contains_key("action"), "{s}");
        assert!(!s["properties"].as_object().unwrap().contains_key("method"), "{s}");
    }

    #[test]
    fn a_harness_receives_the_run_command() {
        #[derive(Default)]
        struct H {
            seen: Vec<(String, Value)>,
        }
        impl Harness for H {
            fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
                self.seen.push((method.to_string(), params));
                Ok(json!({"value": "T"}))
            }
        }
        let mut h = H::default();
        let r = crate::code::call(&mut h, &json!({"code": "(cmd \"zoom\" '((MODE . \"extents\")))"})).unwrap();
        assert_eq!(h.seen[0].0, "engine.execute");
        assert_eq!(h.seen[0].1["command"], "run");
        assert!(h.seen[0].1["params"]["code"].as_str().unwrap().contains("zoom"));
        assert_eq!(r.value.as_deref(), Some("T"));
    }
}
