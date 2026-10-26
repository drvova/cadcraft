//! The one tool: `run`.
//!
//! A fixed catalog of typed tools is the wrong interface for a CAD application: every install and
//! every command set differs, models differ in what they handle well, and each new capability
//! would need hand-wired glue. So there is exactly one tool here, and it runs code —
//! **AutoLISP, inside the open drawing** — where the model builds its own tooling on top of the
//! live API: discover what is there (`commands`), write helpers (`defun`), and keep them
//! (`defun` and `setq` are saved and reloaded next session).
//!
//! Everything the model can do is reached from *inside* that namespace as functions — `(cmd "line"
//! …)`, `(cmdline "zoom" "e")`, `(inspect)`, `(describe "circle")`, `(render)`, the whole
//! AutoLISP language — so no verb is advertised per capability and none needs to be added when a
//! command lands. `crates/engine/src/lisp/agent.rs` is the namespace; `docs/assistant.md` is the
//! manual a person reads.
//!
//! **Security is a deployment fact, not a toggle.** Running code *is* what this tool does: it
//! executes with the authority of the process it runs in, on the user's own drawings. There is no
//! enable/disable knob and no code-free mode, because either would reframe the interface as an
//! optional feature. CADCraft is meant to be run as the user's own tool; run it sandboxed (a
//! container, a VM, a jail) if the model driving it is not trusted with the user's files.

use serde_json::{Value, json};

pub use crate::surface::Harness;

/// The tool's name: one tool, and this is it.
pub const TOOL: &str = "run";

/// The command the tool calls. It is an ordinary engine command, so the command line, a script,
/// the CLI, the control channel and MCP all reach the same code path — and a person can type it.
pub const COMMAND: &str = "run";

/// The control method a call goes through: `engine.execute` of [`COMMAND`], exactly as a script
/// or an external client would call it.
pub const METHOD: &str = "engine.execute";

/// The tool's description: what it is, how to start, and the deployment fact.
pub const DESCRIPTION: &str = "\
Run code in the open drawing and return what it printed, what it was worth, and the pictures it \
drew. The language is AutoLISP and the drawing is the object: `(cmd \"circle\" '((CENTER . (0 0)) \
(RADIUS . 5)))` draws, `(cmd \"entities\" '((TYPE . \"Circle\")))` reads back, `(cmdline \"zoom\" \
\"e\")` types at the command line like a person. Call with empty `code` for the manual, which lists \
the namespace and how to reach every command — then `(commands)`, then `(describe \"id\")` for the \
parameters of one. Everything defined with `(defun NAME …)` or `(setq NAME literal)` is KEPT and \
reloaded next session, so build helpers and reuse them: `(kept)`, `(forget \"NAME\")`. \
`(render)` returns a PNG of the drawing, shown to you. THIS TOOL RUNS CODE WITH THE AUTHORITY OF \
THE PROCESS: there is no code-free mode and no disable switch — the server is meant to be run \
sandboxed (a container, a VM, a jail) when the model driving it is not trusted with the user's \
files.";

/// The one tool's JSON Schema: `code`, the named values, and nothing else.
pub fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "AutoLISP to run in the open drawing. Empty or omitted: the manual."
            },
            "values": {
                "type": "object",
                "description": "Long or literal texts to hand the code without escaping them inside `code`; read them with (value \"name\").",
                "additionalProperties": {"type": "string"}
            }
        }
    })
}

/// The tool definition as MCP's `tools/list` wants it.
pub fn definition() -> Value {
    json!({"name": TOOL, "description": DESCRIPTION, "inputSchema": schema()})
}

/// The same tool as a chat API wants it: `{type: "function", function: {name, description,
/// parameters}}`. One envelope difference, one place to get it wrong.
pub fn chat_definition() -> Value {
    json!({"type": "function", "function": {"name": TOOL, "description": DESCRIPTION, "parameters": schema()}})
}

/// What a call's arguments look like once checked.
pub struct Args {
    pub code: String,
    pub values: Value,
}

/// Check a call's arguments. `Err` is a protocol error the caller answers as such (a malformed
/// call, not a failing one).
pub fn check_args(args: &Value) -> Result<Args, String> {
    let object = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        other => return Err(format!("`run` takes an object of arguments, got {other}")),
    };
    let code = match object.get("code") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(_) => return Err("`code` must be a string".into()),
    };
    let values = match object.get("values") {
        None | Some(Value::Null) => json!({}),
        Some(Value::Object(map)) => {
            if let Some(bad) = map.iter().find(|(_, v)| !v.is_string()) {
                return Err(format!("`values.{}` must be a string", bad.0));
            }
            Value::Object(map.clone())
        }
        Some(_) => return Err("`values` must be an object of strings".into()),
    };
    Ok(Args { code, values })
}

/// Run the tool: check the arguments, then run them. The two failures are kept apart on purpose —
/// malformed arguments are the caller's mistake (a protocol error), while a harness that cannot
/// reach the application is a *failed run* the model reads and acts on.
pub fn call(h: &mut dyn Harness, args: &Value) -> Result<Report, String> {
    let a = check_args(args)?;
    call_checked(h, &a)
}

/// Run already-checked arguments.
pub fn call_checked(h: &mut dyn Harness, a: &Args) -> Result<Report, String> {
    let result = h.call(METHOD, json!({"command": COMMAND, "params": {"code": a.code, "values": a.values}}))?;
    Ok(Report::of(&result))
}

/// What a run produced, read out of the command's result.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Report {
    /// The manual, when the call had no code.
    pub manual: Option<String>,
    /// The last value of the code, as the language printed it.
    pub value: Option<String>,
    /// Lines the code printed.
    pub output: Vec<String>,
    /// Definitions kept for the next session.
    pub kept: Vec<String>,
    /// Definitions refused because they would replace a built-in.
    pub refused: Vec<String>,
    /// Kept definitions that failed to load, with why.
    pub broken: Vec<(String, String)>,
    /// PNGs the code drew with `(render …)`.
    pub images: Vec<String>,
    /// The error, when the code failed.
    pub error: Option<String>,
}

impl Report {
    /// Read a `run` command's result.
    pub fn of(result: &Value) -> Report {
        let strings = |key: &str| -> Vec<String> {
            result.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
        };
        Report {
            manual: result.get("manual").and_then(Value::as_str).map(str::to_string),
            value: result.get("value").and_then(Value::as_str).map(str::to_string),
            output: strings("output"),
            kept: strings("kept"),
            refused: strings("refused"),
            broken: result
                .get("broken")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|b| {
                            (
                                b.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                                b.get("error").and_then(Value::as_str).unwrap_or_default().to_string(),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default(),
            images: strings("images"),
            error: result.get("error").and_then(Value::as_str).map(str::to_string),
        }
    }

    /// The report as the text a model reads. Measurements and failures are stated; nothing is
    /// summarized away.
    pub fn text(&self) -> String {
        if let Some(manual) = &self.manual {
            return manual.clone();
        }
        let mut out = String::new();
        if let Some(e) = &self.error {
            out.push_str(&format!("error: {e}\n"));
        }
        if !self.output.is_empty() {
            out.push_str(&self.output.join("\n"));
            out.push('\n');
        }
        if let Some(v) = &self.value
            && v != "nil"
        {
            out.push_str(&format!("=> {v}\n"));
        }
        if !self.kept.is_empty() {
            out.push_str(&format!("kept: {}\n", self.kept.join(", ")));
        }
        if !self.refused.is_empty() {
            out.push_str(&format!(
                "refused: {} would replace a built-in function; pick another name (the language is intact)\n",
                self.refused.join(", ")
            ));
        }
        for (name, why) in &self.broken {
            out.push_str(&format!("kept definition `{name}` did not load: {why}\n"));
        }
        for image in &self.images {
            out.push_str(&format!("rendered {image}\n"));
        }
        if out.is_empty() {
            out.push_str("(the code ran and returned nil)\n");
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A harness that records the call and answers with a canned result.
    #[derive(Default)]
    struct Recorder {
        calls: Vec<(String, Value)>,
        answer: Value,
    }

    impl Harness for Recorder {
        fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.push((method.to_string(), params.clone()));
            Ok(self.answer.clone())
        }
    }

    #[test]
    fn the_call_goes_through_the_run_command_with_the_code_and_values() {
        let mut h = Recorder { answer: json!({"value": "3", "output": ["hello"]}), ..Recorder::default() };
        let r = call(&mut h, &json!({"code": "(+ 1 2)", "values": {"payload": "text"}})).unwrap();
        assert_eq!(h.calls[0].0, METHOD);
        assert_eq!(h.calls[0].1, json!({"command": COMMAND, "params": {"code": "(+ 1 2)", "values": {"payload": "text"}}}));
        assert_eq!(r.value.as_deref(), Some("3"));
        assert_eq!(r.output, vec!["hello"]);
    }

    #[test]
    fn an_empty_call_asks_for_the_manual() {
        let mut h = Recorder { answer: json!({"manual": "the manual"}), ..Recorder::default() };
        let r = call(&mut h, &json!({})).unwrap();
        assert_eq!(h.calls[0].1["params"], json!({"code": "", "values": {}}));
        assert_eq!(r.text(), "the manual");
    }

    #[test]
    fn malformed_arguments_are_refused_before_anything_runs() {
        let mut h = Recorder::default();
        let e = call(&mut h, &json!({"code": 5})).unwrap_err();
        assert!(e.contains("`code` must be a string"), "{e}");
        let e = call(&mut h, &json!({"values": {"a": 5}})).unwrap_err();
        assert!(e.contains("`values.a` must be a string"), "{e}");
        let e = call(&mut h, &json!("not an object")).unwrap_err();
        assert!(e.contains("takes an object"), "{e}");
        assert!(h.calls.is_empty(), "nothing ran");
    }

    #[test]
    fn the_report_states_measurements_and_failures() {
        let r = Report::of(&json!({
            "value": "((COUNT . 3))",
            "output": ["drew 3"],
            "kept": ["C:WING"],
            "refused": ["CAR"],
            "broken": [{"name": "OLD", "error": "no function FOO"}],
            "images": ["/tmp/a.png"],
            "error": "divide by zero"
        }));
        let text = r.text();
        assert!(text.starts_with("error: divide by zero"), "{text}");
        assert!(text.contains("drew 3"));
        assert!(text.contains("=> ((COUNT . 3))"));
        assert!(text.contains("kept: C:WING"));
        assert!(text.contains("refused: CAR would replace a built-in"));
        assert!(text.contains("`OLD` did not load: no function FOO"));
        assert!(text.contains("rendered /tmp/a.png"));
    }

    #[test]
    fn a_run_that_says_nothing_still_says_that() {
        assert_eq!(Report::of(&json!({})).text(), "(the code ran and returned nil)\n");
    }

    #[test]
    fn the_description_states_the_deployment_fact_and_the_persistence() {
        let d = DESCRIPTION;
        assert!(d.contains("AutoLISP"));
        assert!(d.contains("(cmd "), "the shape of a command call is shown");
        assert!(d.contains("empty `code`"), "the manual is where discovery starts");
        assert!(d.contains("KEPT"), "persistence is stated");
        assert!(d.contains("RUNS CODE WITH THE AUTHORITY"), "the security fact is stated plainly");
        assert!(d.contains("no code-free mode and no disable switch"));
        assert!(d.contains("sandboxed"));
    }

    #[test]
    fn the_two_envelopes_are_the_same_tool() {
        let mcp = definition();
        let chat = chat_definition();
        assert_eq!(mcp["name"], TOOL);
        assert!(mcp["inputSchema"].is_object());
        assert_eq!(chat["type"], "function");
        assert_eq!(chat["function"]["name"], TOOL);
        assert_eq!(chat["function"]["parameters"], mcp["inputSchema"]);
    }

    #[test]
    fn the_schema_takes_code_and_values_and_nothing_else() {
        let s = schema();
        let props = s["properties"].as_object().unwrap();
        assert_eq!(props.len(), 2, "{s}");
        assert!(props.contains_key("code") && props.contains_key("values"));
        assert_eq!(s["type"], "object");
    }
}
