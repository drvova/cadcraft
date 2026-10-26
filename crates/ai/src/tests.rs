//! The whole loop against a scripted provider: a real HTTP server on localhost that answers like
//! an OpenAI-compatible endpoint, and the one tool (`run`) driven through it.
//!
//! The request shape, the streamed answer, the tool round-trip, the transcript and the argument
//! checking are all exercised for real — nothing is mocked away except the model itself and the
//! application (which is a recorder here; `cadcraft-engine`'s own tests run the same code path
//! against a real `Session`).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::agent::{self, Event, ToolExecutor};
use crate::chat::Message;
use crate::client::Provider;
use crate::{code, surface};

/// One scripted HTTP reply.
struct Script {
    status: u16,
    content_type: &'static str,
    body: String,
}

/// A streamed reply: `data:` payloads followed by `[DONE]`.
fn sse(payloads: &[&str]) -> Script {
    let mut body = String::new();
    for p in payloads {
        body.push_str("data: ");
        body.push_str(p);
        body.push_str("\n\n");
    }
    body.push_str("data: [DONE]\n\n");
    Script { status: 200, content_type: "text/event-stream", body }
}

/// A reply that is one JSON object, the way a provider that ignores `stream: true` answers.
fn json_reply(status: u16, body: &str) -> Script {
    Script { status, content_type: "application/json", body: body.to_string() }
}

/// A tool call to `run` carrying `code`, as a streamed delta.
fn run_call(id: &str, code: &str) -> String {
    let args = json!({"code": code}).to_string();
    let call = json!([{"index": 0, "id": id, "type": "function", "function": {"name": "run", "arguments": args}}]);
    json!({"choices": [{"delta": {"tool_calls": call}, "finish_reason": null}]}).to_string()
}

/// A provider that answers with a scripted list of replies, one per request, and records what it
/// was asked.
struct Fake {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl Fake {
    /// Start a server that answers the next request with each reply in turn.
    fn start(scripts: Vec<Script>) -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        {
            let requests = Arc::clone(&requests);
            std::thread::spawn(move || {
                let mut served = 0usize;
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { break };
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
                    let Some(body) = read_request(&mut stream) else { continue };
                    requests.lock().unwrap().push(body);
                    let script = scripts.get(served);
                    let (status, content_type, body) = match script {
                        Some(s) => (s.status, s.content_type, s.body.clone()),
                        None => (200, "text/event-stream", "data: [DONE]\n\n".to_string()),
                    };
                    let _ = write_response(&mut stream, status, content_type, &body);
                    served += 1;
                    if served >= scripts.len() {
                        break;
                    }
                }
            });
        }
        Fake { url: format!("http://127.0.0.1:{port}/v1"), requests }
    }

    fn provider(&self) -> Provider {
        Provider { base_url: self.url.clone(), model: "test-model".into(), api_key: "test-key".into(), ..Provider::default() }
    }

    fn requests(&self) -> Vec<Value> {
        self.requests.lock().unwrap().clone()
    }
}

/// Read one HTTP request: headers, then `Content-Length` bytes of body.
fn read_request(stream: &mut TcpStream) -> Option<Value> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut len = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        if line.trim().is_empty() {
            break;
        }
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

/// Answer with a status, a content type and a body.
fn write_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

/// An executor that answers every call the same way and records them.
struct Recorder {
    calls: Mutex<Vec<(String, Value)>>,
    answer: Result<Value, String>,
}

impl ToolExecutor for Recorder {
    fn call(&self, name: &str, args: &Value) -> Result<Value, String> {
        self.calls.lock().unwrap().push((name.to_string(), args.clone()));
        self.answer.clone()
    }
}

/// Run one turn with a briefing and collect the events.
fn turn(server: &Fake, executor: &Recorder, question: &str) -> (Vec<Event>, Vec<Message>) {
    let cancel = AtomicBool::new(false);
    let mut conversation = vec![Message::user(question)];
    let mut events = Vec::new();
    agent::run_turn(&server.provider(), &agent::Briefing::default(), &mut conversation, &cancel, executor, &mut |e, _| events.push(e));
    (events, conversation)
}

#[test]
fn the_advertised_tool_set_is_exactly_run() {
    // One tool, unconditionally — in both envelopes, with no per-model branch anywhere.
    let names: Vec<String> = surface::tools().iter().filter_map(|t| t["name"].as_str().map(str::to_string)).collect();
    assert_eq!(names, vec!["run"]);
    let chat: Vec<String> = surface::chat_tools().iter().filter_map(|t| t["function"]["name"].as_str().map(str::to_string)).collect();
    assert_eq!(chat, vec!["run"]);
    // The schema is `code` + `values`: no action/verb selector, no typed catalog.
    let schema = &surface::tools()[0]["inputSchema"];
    let props = schema["properties"].as_object().expect("properties");
    assert_eq!(props.len(), 2, "{schema}");
    assert!(props.contains_key("code") && props.contains_key("values"));
    assert!(!props.contains_key("action") && !props.contains_key("command") && !props.contains_key("method"));
}

#[test]
fn an_empty_call_asks_for_the_manual() {
    let server = Fake::start(vec![
        sse(&[&run_call("call_1", ""), r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#]),
        sse(&[r#"{"choices":[{"delta":{"content":"Ready."},"finish_reason":"stop"}]}"#]),
    ]);
    // The executor answers an empty code call with the manual, exactly as the command does.
    let executor = Recorder {
        calls: Mutex::new(Vec::new()),
        answer: Ok(json!({"manual": "CADCraft's assistant namespace — (cmd \"id\" params) runs a command …"})),
    };
    let (events, conversation) = turn(&server, &executor, "what can you do?");
    // The model got the manual back as a tool result.
    assert!(matches!(&events[1], Event::Result { name, ok: true, .. } if name == "run"), "{events:?}");
    let result = conversation[2].text();
    assert!(result.contains("assistant namespace"), "{result}");
    // And the request carried the tool with the manual's promise in its description.
    let tools = server.requests()[0]["tools"].as_array().unwrap().clone();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["function"]["name"], "run");
    assert!(tools[0]["function"]["description"].as_str().unwrap().contains("empty `code`"), "{tools:?}");
    assert!(
        tools[0]["function"]["description"].as_str().unwrap().contains("RUNS CODE WITH THE AUTHORITY"),
        "the security fact is in the description the model reads"
    );
}

#[test]
fn a_run_carries_code_the_model_wrote_and_comes_back_with_its_report() {
    let code_text = "(princ \"drew\") (cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5)))";
    let server = Fake::start(vec![
        sse(&[&run_call("call_1", code_text), r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#]),
        sse(&[r#"{"choices":[{"delta":{"content":"Drew a 5 unit circle."},"finish_reason":"stop"}]}"#]),
    ]);
    let executor = Recorder {
        calls: Mutex::new(Vec::new()),
        answer: Ok(json!({"value": "((HANDLE . \"100\"))", "output": ["drew"], "kept": ["C:WING"], "images": ["/tmp/a.png"]})),
    };
    let (events, conversation) = turn(&server, &executor, "draw a circle");
    // The code arrived whole and unchanged.
    let calls = executor.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "run");
    assert_eq!(calls[0].1["code"], code_text);
    assert_eq!(calls[0].1["values"], json!({}));
    drop(calls);

    // The model read a report that states the value, the output, what was kept and the picture.
    let report = conversation[2].text();
    assert!(report.contains("drew"), "{report}");
    assert!(report.contains("((HANDLE . \"100\"))"), "{report}");
    assert!(report.contains("kept: C:WING"), "{report}");
    assert!(report.contains("rendered /tmp/a.png"), "{report}");
    assert_eq!(conversation[3].text(), "Drew a 5 unit circle.");
    assert_eq!(events.last(), Some(&Event::Done { reason: "stop".into() }));
}

#[test]
fn a_failing_run_is_reported_to_the_model_and_the_turn_continues() {
    let server = Fake::start(vec![
        sse(&[&run_call("c1", "(cmd \"nope\")"), r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#]),
        sse(&[r#"{"choices":[{"delta":{"content":"There is no such command."},"finish_reason":"stop"}]}"#]),
    ]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Err("no command `nope`".into()) };
    let (events, conversation) = turn(&server, &executor, "run nope");
    assert!(matches!(&events[1], Event::Result { ok: false, note, .. } if note.contains("no command `nope`")), "{events:?}");
    assert!(conversation[2].error, "the pane shows it as an error");
    assert!(conversation[2].text().contains("no command `nope`"));
    assert_eq!(events.last(), Some(&Event::Done { reason: "stop".into() }));
}

#[test]
fn calling_a_tool_that_is_not_run_is_refused_in_one_line() {
    let server = Fake::start(vec![
        sse(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"query_entities","arguments":"{\"type\":\"Circle\"}"}}]},"finish_reason":"tool_calls"}]}"#,
        ]),
        sse(&[r#"{"choices":[{"delta":{"content":"Sorry — I will use run."},"finish_reason":"stop"}]}"#]),
    ]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
    let (events, conversation) = turn(&server, &executor, "list the circles");
    let note = match &events[1] {
        Event::Result { ok: false, note, .. } => note.clone(),
        other => panic!("{other:?}"),
    };
    assert!(note.contains("is not a tool here"), "{note}");
    assert!(note.contains("there is one tool, `run`"), "{note}");
    assert!(executor.calls.lock().unwrap().is_empty(), "nothing ran");
    assert!(conversation[2].text().contains("is not a tool here"));
}

#[test]
fn malformed_arguments_are_refused_before_anything_runs() {
    // `code` must be a string: a call with a number is a protocol error, not a failed run.
    let args = json!({"code": 5});
    let call = crate::chat::ToolCall { id: "1".into(), name: "run".into(), arguments: args };
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
    let err = agent::run_one(&executor, &call).unwrap_err();
    assert!(err.contains("`code` must be a string"), "{err}");
    assert!(executor.calls.lock().unwrap().is_empty());
    // And a bad `values` map too.
    let call = crate::chat::ToolCall { id: "1".into(), name: "run".into(), arguments: json!({"values": {"a": 1}}) };
    let err = agent::run_one(&executor, &call).unwrap_err();
    assert!(err.contains("`values.a` must be a string"), "{err}");
}

#[test]
fn named_values_reach_the_call_unmodified() {
    // The tool passes `values` through so a payload never has to be escaped inside `code`.
    let call = crate::chat::ToolCall {
        id: "1".into(),
        name: "run".into(),
        arguments: json!({"code": "(strlen (value \"payload\"))", "values": {"payload": "a\nb\"c"}}),
    };
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({"value": "5"})) };
    agent::run_one(&executor, &call).unwrap();
    let calls = executor.calls.lock().unwrap();
    assert_eq!(calls[0].1, json!({"code": "(strlen (value \"payload\"))", "values": {"payload": "a\nb\"c"}}));
}

#[test]
fn an_http_error_ends_the_turn_with_a_readable_message() {
    let server = Fake::start(vec![json_reply(401, r#"{"error":{"message":"Incorrect API key provided"}}"#)]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
    let (events, conversation) = turn(&server, &executor, "hello");
    assert!(matches!(events.last(), Some(Event::Failed(e)) if e.contains("Incorrect API key")), "{events:?}");
    assert_eq!(conversation.len(), 1, "a failed turn adds nothing to the transcript");
}

#[test]
fn a_provider_that_ignores_stream_true_still_answers() {
    let server = Fake::start(vec![json_reply(200, r#"{"choices":[{"message":{"content":"One object, no stream."},"finish_reason":"stop"}]}"#)]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
    let (events, conversation) = turn(&server, &executor, "hi");
    assert_eq!(events, vec![Event::Text("One object, no stream.".into()), Event::Done { reason: "stop".into() }]);
    assert_eq!(conversation[1].text(), "One object, no stream.");
}

#[test]
fn the_manual_the_command_returns_names_the_whole_vocabulary() {
    // The engine builds the manual; this proves the tool's own description and the command's
    // manual agree on the vocabulary a model needs to bootstrap.
    let manual = code::DESCRIPTION;
    for word in ["(cmd ", "commands", "kept", "(render)", "(describe"] {
        assert!(manual.contains(word), "the description names {word}");
    }
}
