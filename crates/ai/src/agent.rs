//! The turn loop: ask the model, run what it asks for, feed the results back, repeat.
//!
//! One turn is a small conversation with the model: send the transcript and the tool catalog,
//! stream the answer, run every tool call it makes against the application, send those results
//! back, and go again until the model answers in words instead of asking for tools. The caller
//! sees each step as an [`Event`], which is what the pane draws: text as it streams, a chip per
//! tool call, and how each one ended.
//!
//! Tool calls run through [`ToolExecutor`], which the interface implements by handing the call to
//! the application's own control harness on the interface thread and waiting for the answer. That
//! is the whole trick of the design: the model can only do what an external MCP client could do,
//! through the same door, on the same live drawing.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use crate::chat::{self, MAX_REQUEST_CHARS, Message};
use crate::client::{self, Provider};
use crate::surface::{self, Tool};

/// What the pane shows as a turn runs.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A fragment of the model's answer.
    Text(String),
    /// A tool call is about to run.
    Call { name: String, summary: String },
    /// A tool call finished; `note` is a short line for the chip.
    Result { name: String, ok: bool, note: String },
    /// The turn ended normally.
    Done { reason: String },
    /// The turn could not finish.
    Failed(String),
}

/// Where a tool call goes. Called on the worker thread, so it must be `Send + Sync`; the
/// interface's implementation posts the call to the interface thread and blocks for the reply.
pub trait ToolExecutor: Send + Sync {
    fn call(&self, name: &str, args: &Value) -> Result<Value, String>;
}

/// How many tool rounds one turn may take before the model is told it must answer. A model that
/// keeps calling tools without ever answering is looping, not working.
pub const MAX_ROUNDS: usize = 12;

/// The state of the application the assistant is told about, fresh at the start of every turn.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Briefing {
    /// The application and its version, e.g. `CADCraft 0.13.0`.
    pub app: String,
    /// The drawing's name, or what to call an unsaved one.
    pub drawing: String,
    /// The drawing's units, in words.
    pub units: String,
    /// How many objects the active space holds.
    pub objects: usize,
    /// How many objects are selected right now.
    pub selection: usize,
    /// The drawing's extents as `[min_x, min_y, max_x, max_y]`.
    pub extents: Option<[f64; 4]>,
}

/// The system prompt: who the model is, what the drawing holds right now, and how this
/// application is driven.
pub fn system_prompt(b: &Briefing) -> String {
    let mut s = String::with_capacity(2048);
    s.push_str(
        "You are the assistant inside CADCraft, a CAD application. The user works in the same window: \
         everything you do lands in the drawing in front of them. You are not writing instructions for \
         someone else to follow — you make the changes yourself, with the tools you have.\n\n",
    );
    s.push_str("The drawing right now:\n");
    s.push_str(&format!("- Application: {}\n", if b.app.is_empty() { "CADCraft" } else { &b.app }));
    s.push_str(&format!("- Drawing: {}\n", if b.drawing.is_empty() { "an unsaved drawing" } else { &b.drawing }));
    s.push_str(&format!("- Units: {} (every coordinate you give is in these units)\n", if b.units.is_empty() { "unknown" } else { &b.units }));
    s.push_str(&format!("- Objects in the active space: {}", b.objects));
    if b.selection > 0 {
        s.push_str(&format!("; {} selected", b.selection));
    }
    s.push('\n');
    if let Some([x0, y0, x1, y1]) = b.extents {
        s.push_str(&format!("- Extents: ({x0:.3}, {y0:.3}) to ({x1:.3}, {y1:.3})\n"));
    }
    s.push_str(
        "\nHow to work:\n\
         1. Look before you act. `inspect_drawing`, `query_entities`, `describe_drawing` and `find_text` \
         tell you what is really there; `list_commands` gives the exact command ids and their parameters. \
         Never guess a command id, a parameter name or an object handle.\n\
         2. Act with `execute` (a command id plus JSON parameters — precise, no prompts). Use `command_line` \
         when a command is interactive (it takes the same input a person would type) or when you are following \
         a sequence of prompts.\n\
         3. Verify. After changing the drawing, check what you produced (`describe_drawing`, `query_entities`) \
         rather than assuming it worked. Tool results are the truth; if one reports an error, read it and fix \
         the call instead of repeating it.\n\
         4. Work in the user's terms. If they ask for something a drafting command does (a fillet, a hatch, a \
         dimension), use it rather than approximating with primitives.\n\n",
    );
    s.push_str(
        "How to report what you did:\n\
         - Say what you changed and **the numbers that came out of it**: how many objects, which handles or \
         layers, the size, the measured length, area or weight the tools reported. A report of a drawing is a \
         report of measurements — \"offset 2 mm\" is weaker than \"offset 2 mm; 14 outlines now total 412.6 mm \
         of path and enclose 1,284 mm², on layer Walls\".\n\
         - Name anything that came out different from what was asked, and why (a skipped object, a fit that \
         failed, a size that had to round). Silence about a surprise is the one thing a report must not do.\n\
         - Give what is worth checking in one line, when there is something: a measurement to confirm, a place \
         to look, a choice you made that the user may want the other way.\n\
         - No JSON dumps, no restating the request back, no apologies, no filler. Depth means substance, not \
         length: three measured sentences beat a page of adjectives.\n\
         - If a request is ambiguous in a way that changes the result (which object, which layer, which size), \
         ask one short question instead of guessing — or make the safe choice and say which one you made.\n\
         - You can see only what the tools tell you. If you have not looked at something, look before claiming it.\n",
    );
    s
}

/// Run one turn to completion. Every step is reported through `on`, which is called on this
/// thread with the conversation as the model sees it at that moment (so a pane can show exactly
/// what the model was told, tool results included); the turn always ends with exactly one
/// [`Event::Done`] or [`Event::Failed`].
pub fn run_turn(
    provider: &Provider,
    briefing: &Briefing,
    conversation: &mut Vec<Message>,
    tools: &[Tool],
    cancel: &AtomicBool,
    executor: &dyn ToolExecutor,
    on: &mut dyn FnMut(Event, &[Message]),
) {
    let system = system_prompt(briefing);
    let definitions = surface::chat_definitions(tools);
    for _round in 0..MAX_ROUNDS {
        if cancel.load(Ordering::Relaxed) {
            on(Event::Done { reason: "stopped".into() }, conversation);
            return;
        }
        let mut sent = Vec::with_capacity(conversation.len() + 1);
        sent.push(Message::system(system.clone()));
        sent.extend(chat::for_request(conversation, MAX_REQUEST_CHARS));
        let reply = match client::chat(provider, &sent, &definitions, cancel, &mut |t| on(Event::Text(t.to_string()), conversation)) {
            Ok(r) => r,
            Err(_stopped) if cancel.load(Ordering::Relaxed) => {
                on(Event::Done { reason: "stopped".into() }, conversation);
                return;
            }
            Err(e) => {
                on(Event::Failed(e), conversation);
                return;
            }
        };
        if reply.tool_calls.is_empty() {
            conversation.push(Message::assistant(reply.text));
            on(Event::Done { reason: reply.finish }, conversation);
            return;
        }
        let text = if reply.text.trim().is_empty() { None } else { Some(reply.text) };
        conversation.push(Message::assistant_calls(reply.tool_calls.clone(), text));
        for call in &reply.tool_calls {
            if cancel.load(Ordering::Relaxed) {
                on(Event::Done { reason: "stopped".into() }, conversation);
                return;
            }
            on(Event::Call { name: call.name.clone(), summary: call.summary() }, conversation);
            let outcome = run_one(executor, tools, call);
            match outcome {
                Ok(value) => {
                    let note = note_of(&value);
                    conversation.push(Message::tool_result(call, &value));
                    on(Event::Result { name: call.name.clone(), ok: true, note }, conversation);
                }
                Err(error) => {
                    conversation.push(Message::tool_error(call, &error));
                    on(Event::Result { name: call.name.clone(), ok: false, note: error }, conversation);
                }
            }
        }
    }
    on(
        Event::Failed(format!(
            "The assistant asked to run tools {MAX_ROUNDS} times without answering. Ask it to continue, or say what to do differently."
        )),
        conversation,
    );
}

/// Run one tool call, refusing what this host cannot do and what the model malformed.
fn run_one(executor: &dyn ToolExecutor, tools: &[Tool], call: &crate::chat::ToolCall) -> Result<Value, String> {
    if !matches!(call.arguments, Value::Object(_)) {
        let raw = call.arguments.as_str().unwrap_or_default();
        return Err(format!("the arguments were not a JSON object: {raw}"));
    }
    if !tools.iter().any(|t| t.name == call.name) {
        let names: Vec<&str> = tools.iter().map(|t| t.name).collect();
        return Err(format!("`{}` is not a tool here. Available: {}", call.name, names.join(", ")));
    }
    executor.call(&call.name, &call.arguments)
}

/// A short line for a tool chip: what the result says in its own words when it says anything.
fn note_of(v: &Value) -> String {
    if let Some(m) = v.get("message").and_then(Value::as_str) {
        let line = m.lines().next().unwrap_or(m).trim();
        if !line.is_empty() {
            return clip(line, 160);
        }
    }
    for key in ["count", "placed", "handle", "handles", "objects", "total"] {
        if let Some(x) = v.get(key) {
            match x {
                Value::Array(a) => return format!("{key}: {}", a.len()),
                other => return clip(&format!("{key}: {other}"), 160),
            }
        }
    }
    clip(&v.to_string(), 160)
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!("{}…", s.chars().take(max).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicBool;

    /// An executor that answers from a table and records what it was asked.
    struct Fake {
        calls: Mutex<Vec<(String, Value)>>,
        answer: Result<Value, String>,
    }

    impl ToolExecutor for Fake {
        fn call(&self, name: &str, args: &Value) -> Result<Value, String> {
            self.calls.lock().unwrap().push((name.to_string(), args.clone()));
            self.answer.clone()
        }
    }

    #[test]
    fn the_briefing_reaches_the_prompt() {
        let b = Briefing {
            app: "CADCraft 0.13.0".into(),
            drawing: "ring.dxf".into(),
            units: "millimetres".into(),
            objects: 42,
            selection: 2,
            extents: Some([0.0, 0.0, 10.0, 5.0]),
        };
        let p = system_prompt(&b);
        assert!(p.contains("CADCraft 0.13.0"));
        assert!(p.contains("ring.dxf"));
        assert!(p.contains("millimetres"));
        assert!(p.contains("42"));
        assert!(p.contains("2 selected"));
        assert!(p.contains("(0.000, 0.000) to (10.000, 5.000)"));
        // The method is the point of the prompt: look, act, verify, and report measurements.
        assert!(p.contains("Look before you act"));
        assert!(p.contains("Never guess a command id"));
        assert!(p.contains("Verify"));
        assert!(p.contains("the numbers that came out of it"), "a report of a drawing is measurements");
        assert!(p.contains("Silence about a surprise"));
    }

    #[test]
    fn a_tool_chip_note_prefers_the_result_s_own_message() {
        assert_eq!(note_of(&json!({"message": "Drew a circle.\nMore detail."})), "Drew a circle.");
        assert_eq!(note_of(&json!({"count": 7})), "count: 7");
        assert_eq!(note_of(&json!({"handles": ["1", "2", "3"]})), "handles: 3");
        let long = note_of(&json!({"x": "y".repeat(500)}));
        assert!(long.chars().count() <= 161, "{}", long.chars().count());
    }

    #[test]
    fn a_call_whose_arguments_are_not_an_object_is_refused_before_it_runs() {
        let fake = Fake { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
        let call = crate::chat::ToolCall { id: "1".into(), name: "execute".into(), arguments: Value::String("{oops".into()) };
        let err = run_one(&fake, &surface::core_tools(), &call).unwrap_err();
        assert!(err.contains("not a JSON object"), "{err}");
        assert!(err.contains("{oops"));
        assert!(fake.calls.lock().unwrap().is_empty(), "nothing ran");
    }

    #[test]
    fn a_call_to_a_tool_this_host_does_not_have_is_refused_and_lists_the_rest() {
        let fake = Fake { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
        let call = crate::chat::ToolCall { id: "1".into(), name: "screenshot".into(), arguments: json!({}) };
        let err = run_one(&fake, &surface::core_tools(), &call).unwrap_err();
        assert!(err.contains("is not a tool here"), "{err}");
        assert!(err.contains("execute"), "the list is offered: {err}");
        assert!(fake.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn a_cancelled_turn_stops_before_asking_the_model() {
        let fake = Fake { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
        let cancel = AtomicBool::new(true);
        let mut seen = Vec::new();
        let mut conversation = vec![Message::user("draw a circle")];
        let provider = Provider { base_url: "http://127.0.0.1:9/v1".into(), model: "m".into(), ..Provider::default() };
        run_turn(&provider, &Briefing::default(), &mut conversation, &surface::core_tools(), &cancel, &fake, &mut |e, _| seen.push(e));
        assert_eq!(seen, vec![Event::Done { reason: "stopped".into() }]);
        assert!(fake.calls.lock().unwrap().is_empty());
    }
}
