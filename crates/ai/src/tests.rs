//! The whole loop against a scripted provider: a real HTTP server on localhost that answers like
//! an OpenAI-compatible endpoint. The request shape, the streamed answer, the tool round-trip and
//! the transcript are all exercised for real — nothing is mocked away except the model itself.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::agent::{self, Event, ToolExecutor};
use crate::chat::Message;
use crate::client::Provider;
use crate::surface;

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

#[test]
fn a_turn_runs_the_model_s_tool_call_and_answers_with_its_text() {
    let server = Fake::start(vec![
        // First reply: the model asks to run a command.
        sse(&[
            r#"{"choices":[{"delta":{"content":"Drawing it."},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"execute","arguments":"{\"command\":\"circle\",\"params\":{\"center\":[0,0],\"radius\":5}}"}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ]),
        // Second reply: it has the result and answers in words.
        sse(&[
            r#"{"choices":[{"delta":{"content":"Drew a "},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{"content":"5 mm circle at the origin."},"finish_reason":"stop"}]}"#,
        ]),
    ]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({"handle": "10", "message": "Drew a circle."})) };
    let cancel = AtomicBool::new(false);
    let mut conversation = vec![Message::user("draw a 5mm circle at 0,0")];
    let mut events = Vec::new();
    agent::run_turn(
        &server.provider(),
        &agent::Briefing {
            app: "CADCraft test".into(),
            drawing: "untitled".into(),
            units: "millimetres".into(),
            objects: 0,
            selection: 0,
            extents: None,
        },
        &mut conversation,
        &surface::core_tools(),
        &cancel,
        &executor,
        &mut |e, _| events.push(e),
    );

    // The pane saw the streamed text, the call, its result, and the end.
    assert_eq!(
        events,
        vec![
            Event::Text("Drawing it.".into()),
            Event::Call { name: "execute".into(), summary: "execute(command: circle, params: {\"center\":[0,0],\"radius\":5})".into() },
            Event::Result { name: "execute".into(), ok: true, note: "Drew a circle.".into() },
            Event::Text("Drew a ".into()),
            Event::Text("5 mm circle at the origin.".into()),
            Event::Done { reason: "stop".into() },
        ]
    );

    // The tool ran with the model's arguments, once.
    let calls = executor.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "execute");
    assert_eq!(calls[0].1, json!({"command": "circle", "params": {"center": [0, 0], "radius": 5}}));

    // The transcript is what the next turn would send: user, the call, its result, the answer.
    assert_eq!(conversation.len(), 4, "{conversation:#?}");
    assert_eq!(conversation[0].role, crate::Role::User);
    assert_eq!(conversation[1].tool_calls.len(), 1);
    assert_eq!(conversation[2].role, crate::Role::Tool);
    assert_eq!(conversation[2].tool_call_id.as_deref(), Some("call_1"));
    assert!(conversation[2].text().contains("Drew a circle."));
    assert_eq!(conversation[3].text(), "Drew a 5 mm circle at the origin.");

    // Two requests, each carrying the system prompt, the tool catalog and the growing transcript.
    let reqs = server.requests();
    assert_eq!(reqs.len(), 2);
    let first = &reqs[0];
    assert_eq!(first["model"], "test-model");
    assert_eq!(first["stream"], true);
    assert!(first["messages"][0]["content"].as_str().unwrap().contains("CADCraft test"), "the briefing is in the system prompt");
    assert!(first["messages"][0]["content"].as_str().unwrap().contains("millimetres"));
    let names: Vec<&str> = first["tools"].as_array().unwrap().iter().filter_map(|t| t["function"]["name"].as_str()).collect();
    assert!(names.contains(&"execute"), "{names:?}");
    assert!(names.contains(&"describe_drawing"), "{names:?}");
    assert!(!names.contains(&"screenshot"), "the composer's catalog has no window tools: {names:?}");
    assert_eq!(first["tools"][0]["type"], "function", "the catalog is in the function-calling shape");
    assert!(first["tools"][0]["function"]["parameters"]["properties"].is_object(), "{:?}", first["tools"][0]);
    assert!(first["tools"][0]["function"]["description"].is_string());

    let second = &reqs[1];
    let msgs = second["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 4, "system + user + assistant call + tool result");
    assert_eq!(msgs[2]["role"], "assistant");
    assert_eq!(msgs[2]["tool_calls"][0]["id"], "call_1");
    assert_eq!(msgs[3]["role"], "tool");
    assert_eq!(msgs[3]["tool_call_id"], "call_1");
    assert!(msgs[3]["content"].as_str().unwrap().contains("Drew a circle."));
}

#[test]
fn a_failing_tool_is_reported_to_the_model_as_a_tool_error_and_the_turn_continues() {
    let server = Fake::start(vec![
        sse(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"execute","arguments":"{\"command\":\"nope\"}"}}]},"finish_reason":"tool_calls"}]}"#,
        ]),
        sse(&[r#"{"choices":[{"delta":{"content":"That command does not exist."},"finish_reason":"stop"}]}"#]),
    ]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Err("no command `nope`".into()) };
    let cancel = AtomicBool::new(false);
    let mut conversation = vec![Message::user("run nope")];
    let mut events = Vec::new();
    agent::run_turn(&server.provider(), &agent::Briefing::default(), &mut conversation, &surface::core_tools(), &cancel, &executor, &mut |e, _| {
        events.push(e)
    });

    assert!(matches!(&events[1], Event::Result { ok: false, note, .. } if note.contains("no command `nope`")), "{events:?}");
    assert_eq!(conversation[2].role, crate::Role::Tool);
    assert!(conversation[2].error, "the pane shows it as an error");
    assert!(conversation[2].text().contains("no command `nope`"));
    // The model still got the error and answered.
    let msgs = server.requests()[1]["messages"].as_array().unwrap().clone();
    assert!(msgs[3]["content"].as_str().unwrap().contains("no command `nope`"));
    assert_eq!(events.last(), Some(&Event::Done { reason: "stop".into() }));
}

#[test]
fn an_http_error_ends_the_turn_with_a_readable_message() {
    let server = Fake::start(vec![json_reply(401, r#"{"error":{"message":"Incorrect API key provided"}}"#)]);
    // A body that is not SSE is read as one object, which is how the error surfaces.
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
    let cancel = AtomicBool::new(false);
    let mut conversation = vec![Message::user("hello")];
    let mut events = Vec::new();
    agent::run_turn(&server.provider(), &agent::Briefing::default(), &mut conversation, &surface::core_tools(), &cancel, &executor, &mut |e, _| {
        events.push(e)
    });
    assert!(matches!(events.last(), Some(Event::Failed(e)) if e.contains("Incorrect API key")), "{events:?}");
    assert!(conversation.len() == 1, "a failed turn adds nothing to the transcript");
}

#[test]
fn the_surface_dispatch_reaches_the_harness_through_the_same_door_as_mcp() {
    /// A harness that records control calls, standing in for the application.
    #[derive(Default)]
    struct Harness {
        calls: Vec<(String, Value)>,
    }
    impl surface::Harness for Harness {
        fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.push((method.to_string(), params.clone()));
            Ok(json!({"ok": true}))
        }
    }
    let mut h = Harness::default();
    surface::dispatch(&mut h, "query_entities", &json!({"type": "Circle"})).unwrap().unwrap();
    surface::dispatch(&mut h, "command_line", &json!({"text": "zoom e"})).unwrap().unwrap();
    surface::dispatch(&mut h, "describe_drawing", &json!({})).unwrap().unwrap();
    assert_eq!(
        h.calls,
        vec![
            ("engine.execute".to_string(), json!({"command": "entities", "params": {"type": "Circle"}})),
            ("cmdline.input".to_string(), json!({"text": "zoom e"})),
            ("engine.execute".to_string(), json!({"command": "describe", "params": {}})),
        ]
    );
}

#[test]
fn a_provider_that_ignores_stream_true_still_answers() {
    // Some servers and proxies buffer the whole answer and reply with one JSON object; the
    // content type is what decides, not the request.
    let server = Fake::start(vec![json_reply(200, r#"{"choices":[{"message":{"content":"One object, no stream."},"finish_reason":"stop"}]}"#)]);
    let executor = Recorder { calls: Mutex::new(Vec::new()), answer: Ok(json!({})) };
    let cancel = AtomicBool::new(false);
    let mut conversation = vec![Message::user("hi")];
    let mut events = Vec::new();
    agent::run_turn(&server.provider(), &agent::Briefing::default(), &mut conversation, &surface::core_tools(), &cancel, &executor, &mut |e, _| {
        events.push(e)
    });
    assert_eq!(events, vec![Event::Text("One object, no stream.".into()), Event::Done { reason: "stop".into() }]);
    assert_eq!(conversation[1].text(), "One object, no stream.");
}
