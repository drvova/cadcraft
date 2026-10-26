//! The transport: one OpenAI-compatible `/chat/completions` endpoint, streamed.
//!
//! A provider is a base URL, a model name and a key — that is the whole configuration, because
//! OpenAI's chat protocol is what OpenAI, OpenRouter, Groq, DeepSeek, Together, Mistral, xAI,
//! Ollama, LM Studio, vLLM and llama.cpp all speak. The request is sent with `stream: true` and
//! the server-sent events are read as they arrive, so an answer appears in the pane word by word
//! and a tool call is seen as soon as the model finishes asking for it.
//!
//! Nothing here decides what to do with an answer: [`chat`] streams the text to a callback and
//! returns the tool calls; the loop in [`crate::agent`] runs them.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{Value, json};

use crate::chat::{self, Message, ToolCall};

/// A place to send a conversation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Provider {
    /// The API root, e.g. `https://api.openai.com/v1`; `/chat/completions` is added.
    pub base_url: String,
    pub model: String,
    /// Sent as `Authorization: Bearer …`; left out when empty (a local server usually wants none).
    pub api_key: String,
    /// The answer's token ceiling; omitted when `None`.
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

impl Provider {
    /// The URL one request goes to.
    pub fn endpoint(&self) -> String {
        let base = self.base_url.trim().trim_end_matches('/');
        if base.ends_with("/chat/completions") { base.to_string() } else { format!("{base}/chat/completions") }
    }

    /// Whether the provider is configured enough to send. The message names what is missing, in
    /// the pane's own words.
    pub fn ready(&self) -> Result<(), String> {
        if self.base_url.trim().is_empty() {
            return Err("Set the assistant's base URL (Options ▸ Assistant, or the pane's settings).".into());
        }
        if !(self.base_url.starts_with("http://") || self.base_url.starts_with("https://")) {
            return Err(format!("The assistant's base URL must start with http:// or https://, not `{}`.", self.base_url.trim()));
        }
        if self.model.trim().is_empty() {
            return Err("Set the assistant's model name.".into());
        }
        Ok(())
    }
}

/// A provider the pane offers in its list: name, where it is, and a model that usually exists.
pub struct Preset {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    pub model: &'static str,
    /// The service needs an API key (a local server usually does not).
    pub key: bool,
}

/// The well-known providers, most-used first. Any other OpenAI-compatible server works by typing
/// its URL, so this list is convenience, not a limit.
pub const PRESETS: &[Preset] = &[
    Preset { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", model: "gpt-5.1", key: true },
    Preset { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5", key: true },
    Preset {
        id: "anthropic",
        label: "Anthropic (OpenAI-compatible)",
        base_url: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-5",
        key: true,
    },
    Preset { id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", key: true },
    Preset { id: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", key: true },
    Preset { id: "mistral", label: "Mistral", base_url: "https://api.mistral.ai/v1", model: "mistral-large-latest", key: true },
    Preset { id: "xai", label: "xAI", base_url: "https://api.x.ai/v1", model: "grok-4", key: true },
    Preset {
        id: "together",
        label: "Together",
        base_url: "https://api.together.xyz/v1",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        key: true,
    },
    Preset { id: "ollama", label: "Ollama (local)", base_url: "http://127.0.0.1:11434/v1", model: "llama3.2", key: false },
    Preset { id: "lmstudio", label: "LM Studio (local)", base_url: "http://127.0.0.1:1234/v1", model: "local-model", key: false },
    Preset { id: "custom", label: "Other (OpenAI-compatible)", base_url: "", model: "", key: false },
];

/// The preset with this id.
pub fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

/// What one model reply said.
#[derive(Clone, Debug, Default)]
pub struct Reply {
    /// The answer's text (empty when the model only asked for tools).
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    /// Why the model stopped, as the provider reported it (`stop`, `tool_calls`, `length`, …).
    pub finish: String,
}

/// Send a conversation and stream the answer. `on_text` is called with each fragment as it
/// arrives. `cancel` is checked between fragments: a cancelled request returns an error and the
/// caller treats the turn as stopped.
pub fn chat(provider: &Provider, messages: &[Message], tools: &[Value], cancel: &AtomicBool, on_text: &mut dyn FnMut(&str)) -> Result<Reply, String> {
    provider.ready()?;
    let mut body = json!({
        "model": provider.model.trim(),
        "messages": chat::wire(messages),
        "stream": true,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = json!("auto");
    }
    if let Some(n) = provider.max_tokens {
        body["max_tokens"] = json!(n);
    }
    if let Some(t) = provider.temperature {
        body["temperature"] = json!(t);
    }

    let mut req = ureq::post(&provider.endpoint())
        .config()
        .timeout_connect(Some(Duration::from_secs(15)))
        // A reasoning model may think for a long time before its first token; the budget is per
        // read, not for the whole stream, so a long answer is never cut off.
        .timeout_per_read(Some(Duration::from_secs(600)))
        .http_status_as_error(false)
        .build();
    if !provider.api_key.trim().is_empty() {
        req = req.header("authorization", &format!("Bearer {}", provider.api_key.trim()));
    }
    let resp = req.send_json(&body).map_err(|e| format!("{} ({})", friendly_error(&e), provider.endpoint()))?;

    let status = resp.status().as_u16();
    let streamed = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("event-stream"));
    if !(200..300).contains(&status) {
        let mut resp = resp;
        let body = resp.body_mut().read_to_string().unwrap_or_default();
        return Err(api_error(status, &body));
    }
    if !streamed {
        // A provider that ignored `stream: true` (or a proxy that buffered it) still answers
        // with one JSON object; read it as one.
        let mut resp = resp;
        let body = resp.body_mut().read_to_string().map_err(|e| format!("reading the reply: {e}"))?;
        return one_shot(&body, on_text);
    }

    let mut state = Stream::default();
    let reader = BufReader::new(resp.into_body().into_reader());
    for line in reader.lines() {
        if cancel.load(Ordering::Relaxed) {
            return Err("stopped".into());
        }
        let line = line.map_err(|e| format!("reading the reply: {e}"))?;
        let line = line.trim();
        // Comments and blank lines are keep-alives.
        let Some(payload) = line.strip_prefix("data:") else { continue };
        let payload = payload.trim();
        if payload.is_empty() {
            continue;
        }
        if payload == "[DONE]" {
            break;
        }
        state.feed(payload, on_text)?;
    }
    state.finish()
}

/// The OpenAI SSE stream, accumulated: text deltas pass through, tool-call fragments are joined
/// by index, and the finish reason is remembered.
#[derive(Default)]
struct Stream {
    text: String,
    calls: BTreeMap<u64, PartialCall>,
    finish: String,
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    args: String,
}

impl Stream {
    /// Read one `data:` payload.
    fn feed(&mut self, payload: &str, on_text: &mut dyn FnMut(&str)) -> Result<(), String> {
        let v: Value = serde_json::from_str(payload).map_err(|e| format!("the provider sent a line that is not JSON: {e}"))?;
        if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
            return Err(api_error(200, &err.to_string()));
        }
        let Some(choice) = v.get("choices").and_then(|c| c.as_array()).and_then(|c| c.first()) else { return Ok(()) };
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish = reason.to_string();
        }
        // `delta` while streaming; `message` when a server ignores `stream`.
        let part = choice.get("delta").or_else(|| choice.get("message"));
        let Some(part) = part else { return Ok(()) };
        if let Some(text) = part.get("content").and_then(Value::as_str).filter(|t| !t.is_empty()) {
            self.text.push_str(text);
            on_text(text);
        }
        for call in part.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0);
            let entry = self.calls.entry(index).or_default();
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                entry.id = id.to_string();
            }
            let f = call.get("function");
            if let Some(name) = f.and_then(|f| f.get("name")).and_then(Value::as_str) {
                entry.name.push_str(name);
            }
            if let Some(args) = f.and_then(|f| f.get("arguments")).and_then(Value::as_str) {
                entry.args.push_str(args);
            }
        }
        Ok(())
    }

    /// The assembled reply.
    fn finish(self) -> Result<Reply, String> {
        let mut tool_calls = Vec::with_capacity(self.calls.len());
        for (index, p) in self.calls {
            if p.name.is_empty() {
                return Err(format!("the model asked for a tool (call {index}) without naming it"));
            }
            let arguments = if p.args.trim().is_empty() { json!({}) } else { parse_args(&p.args) };
            tool_calls.push(ToolCall { id: if p.id.is_empty() { format!("call_{index}") } else { p.id }, name: p.name, arguments });
        }
        Ok(Reply { text: self.text, tool_calls, finish: if self.finish.is_empty() { "stop".into() } else { self.finish } })
    }
}

/// A tool call's arguments as JSON. A model that emits malformed JSON keeps its text, so the
/// loop can hand the model a message it can act on instead of failing the turn.
fn parse_args(raw: &str) -> Value {
    match serde_json::from_str::<Value>(raw) {
        Ok(v) => v,
        Err(_) => Value::String(raw.to_string()),
    }
}

/// A whole answer that arrived as one JSON object instead of a stream.
fn one_shot(body: &str, on_text: &mut dyn FnMut(&str)) -> Result<Reply, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("the provider's reply is not JSON: {e}"))?;
    if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
        return Err(api_error(200, &err.to_string()));
    }
    let Some(choice) = v.get("choices").and_then(|c| c.as_array()).and_then(|c| c.first()) else {
        return Err(format!("the provider's reply has no choices: {}", truncate(body)));
    };
    let text = choice.get("message").and_then(|m| m.get("content")).and_then(Value::as_str).unwrap_or_default().to_string();
    if !text.is_empty() {
        on_text(&text);
    }
    let tool_calls = choice
        .get("message")
        .and_then(|m| m.get("tool_calls"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let name = c.get("function")?.get("name")?.as_str()?.to_string();
            let raw = c.get("function").and_then(|f| f.get("arguments")).and_then(Value::as_str).unwrap_or("{}");
            let id = c.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            Some(ToolCall { id, name, arguments: parse_args(raw) })
        })
        .collect();
    let finish = choice.get("finish_reason").and_then(Value::as_str).unwrap_or("stop").to_string();
    Ok(Reply { text, tool_calls, finish })
}

/// A provider's error body as a sentence a user can act on.
fn api_error(status: u16, body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    // Providers spell it `{"error":{"message":…}}`, `{"error":{"type":…}}`, `{"error":"…"}` or
    // `{"message":…}`; take whichever is there.
    let message = ["message", "type", "detail"]
        .iter()
        .find_map(|k| v.get("error").and_then(|e| e.get(k)).and_then(Value::as_str))
        .or_else(|| v.get("error").and_then(Value::as_str))
        .or_else(|| v.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| truncate(body));
    let hint = match status {
        401 | 403 => " — check the API key",
        404 => " — check the base URL and the model name",
        429 => " — rate limited; wait a moment or use another model",
        _ => "",
    };
    format!("HTTP {status}: {message}{hint}")
}

/// A transport error as a sentence.
fn friendly_error(e: &ureq::Error) -> String {
    match e {
        ureq::Error::StatusCode(code) => format!("HTTP {code}"),
        ureq::Error::Timeout(_) => "the provider did not answer in time".to_string(),
        other => other.to_string(),
    }
}

/// The first characters of a long body, for an error message.
fn truncate(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= 300 {
        return s.to_string();
    }
    format!("{}…", s.chars().take(300).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(payloads: &[&str]) -> (Reply, String) {
        let mut state = Stream::default();
        let mut seen = String::new();
        for p in payloads {
            state.feed(p, &mut |t| seen.push_str(t)).unwrap();
        }
        (state.finish().unwrap(), seen)
    }

    #[test]
    fn a_streamed_answer_arrives_fragment_by_fragment() {
        let (reply, seen) = collect(&[
            r#"{"choices":[{"delta":{"content":"Draw"},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{"content":"ing a"},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{"content":" circle."},"finish_reason":"stop"}]}"#,
        ]);
        assert_eq!(reply.text, "Drawing a circle.");
        assert_eq!(seen, "Drawing a circle.", "each fragment reached the pane");
        assert_eq!(reply.finish, "stop");
        assert!(reply.tool_calls.is_empty());
    }

    #[test]
    fn tool_call_fragments_are_joined_by_index() {
        // The shape OpenAI sends: the name first, then the arguments in pieces, and two calls
        // interleaved.
        let (reply, _) = collect(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"execute","arguments":"{\"comm"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"inspect_drawing","arguments":"{}"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"and\":\"circle\",\"params\":{\"radius\":5}}"}}]}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ]);
        assert_eq!(reply.tool_calls.len(), 2);
        assert_eq!(reply.tool_calls[0].name, "execute");
        assert_eq!(reply.tool_calls[0].id, "call_a");
        assert_eq!(reply.tool_calls[0].arguments, json!({"command": "circle", "params": {"radius": 5}}));
        assert_eq!(reply.tool_calls[1].name, "inspect_drawing");
        assert_eq!(reply.tool_calls[1].arguments, json!({}));
        assert_eq!(reply.finish, "tool_calls");
    }

    #[test]
    fn malformed_arguments_keep_their_text_for_the_model_to_fix() {
        let (reply, _) = collect(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"execute","arguments":"{oops"}}]},"finish_reason":"tool_calls"}]}"#,
        ]);
        assert_eq!(reply.tool_calls[0].arguments, json!("{oops"), "kept verbatim, not silently dropped");
    }

    #[test]
    fn an_error_object_inside_the_stream_is_reported() {
        let mut state = Stream::default();
        let err = state.feed(r#"{"error":{"message":"context length exceeded","type":"invalid_request_error"}}"#, &mut |_| {}).unwrap_err();
        assert!(err.contains("context length exceeded"), "{err}");
    }

    #[test]
    fn a_server_that_ignores_stream_true_is_read_as_one_object() {
        let body = r#"{"choices":[{"message":{"content":"one shot","tool_calls":[{"id":"c1","type":"function","function":{"name":"execute","arguments":"{\"command\":\"line\"}"}}]},"finish_reason":"tool_calls"}]}"#;
        let mut seen = String::new();
        let reply = one_shot(body, &mut |t| seen.push_str(t)).unwrap();
        assert_eq!(reply.text, "one shot");
        assert_eq!(seen, "one shot");
        assert_eq!(reply.tool_calls[0].arguments, json!({"command": "line"}));
        assert_eq!(reply.finish, "tool_calls");
    }

    #[test]
    fn an_http_error_body_becomes_a_sentence_with_a_hint() {
        let e = api_error(401, r#"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}"#);
        assert!(e.contains("Incorrect API key"), "{e}");
        assert!(e.contains("check the API key"), "{e}");
        let e = api_error(500, "<html>oops</html>");
        assert!(e.contains("HTTP 500"), "{e}");
        assert!(e.contains("oops"), "{e}");
    }

    #[test]
    fn the_endpoint_is_built_from_the_base_url_either_way() {
        let mut p = Provider { base_url: "https://api.example.com/v1/".into(), model: "m".into(), ..Provider::default() };
        assert_eq!(p.endpoint(), "https://api.example.com/v1/chat/completions");
        p.base_url = "https://api.example.com/v1/chat/completions".into();
        assert_eq!(p.endpoint(), "https://api.example.com/v1/chat/completions");
    }

    #[test]
    fn an_unconfigured_provider_says_what_is_missing() {
        let p = Provider::default();
        assert!(p.ready().unwrap_err().contains("base URL"));
        let p = Provider { base_url: "ftp://x".into(), model: "m".into(), ..Provider::default() };
        assert!(p.ready().unwrap_err().contains("http://"));
        let p = Provider { base_url: "http://127.0.0.1:1/v1".into(), model: "".into(), ..Provider::default() };
        assert!(p.ready().unwrap_err().contains("model"));
    }

    #[test]
    fn the_presets_are_complete_and_unique() {
        let mut ids: Vec<&str> = PRESETS.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), PRESETS.len(), "duplicate preset ids");
        for p in PRESETS {
            assert!(!p.label.is_empty(), "{} has no label", p.id);
            if p.id != "custom" {
                assert!(p.base_url.starts_with("http"), "{} has no URL", p.id);
                assert!(!p.model.is_empty(), "{} has no model", p.id);
            }
        }
        assert!(!preset("ollama").unwrap().key, "a local server wants no key");
        assert!(preset("nope").is_none());
    }
}
