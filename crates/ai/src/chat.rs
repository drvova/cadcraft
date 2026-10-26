//! The conversation: the messages a model reads and writes.
//!
//! The wire format is the OpenAI chat protocol — a list of `{role, content}` messages, an
//! assistant turn that may carry `tool_calls`, and one `tool` message per result. Every
//! OpenAI-compatible provider speaks exactly this, so the transcript is stored in the same shape
//! it is sent in and there is no conversion layer to drift.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Who wrote a message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

/// One tool the model asked for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    /// The provider's call id, echoed back on the result message.
    pub id: String,
    pub name: String,
    /// The arguments as parsed JSON (an empty object when the model sent none).
    pub arguments: Value,
}

impl ToolCall {
    /// A one-line description of the call, for the pane's chip.
    pub fn summary(&self) -> String {
        match &self.arguments {
            Value::Object(m) if m.is_empty() => self.name.clone(),
            Value::Object(m) => {
                let parts: Vec<String> = m
                    .iter()
                    .take(3)
                    .map(|(k, v)| {
                        let s = match v {
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        let s = if s.chars().count() > 40 { format!("{}…", s.chars().take(39).collect::<String>()) } else { s };
                        format!("{k}: {s}")
                    })
                    .collect();
                let more = if m.len() > 3 { format!(", +{}", m.len() - 3) } else { String::new() };
                format!("{}({}{})", self.name, parts.join(", "), more)
            }
            other => format!("{}({other})", self.name),
        }
    }
}

/// One message in the conversation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    /// Text: the user's prompt, the assistant's answer, a tool's result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// What an assistant turn wants run, when it asked for tools instead of answering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// Which call a `tool` message answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// A tool's name, shown in the pane (the wire format does not need it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// A tool call that failed, or was refused: shown in red in the pane.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub error: bool,
}

impl Message {
    pub fn system(text: impl Into<String>) -> Message {
        Message { role: Role::System, content: Some(text.into()), ..Message::empty() }
    }
    pub fn user(text: impl Into<String>) -> Message {
        Message { role: Role::User, content: Some(text.into()), ..Message::empty() }
    }
    pub fn assistant(text: impl Into<String>) -> Message {
        Message { role: Role::Assistant, content: Some(text.into()), ..Message::empty() }
    }
    /// An assistant turn that asks for tools.
    pub fn assistant_calls(calls: Vec<ToolCall>, text: Option<String>) -> Message {
        Message { role: Role::Assistant, content: text, tool_calls: calls, ..Message::empty() }
    }
    /// The result of one tool call, as the model reads it.
    pub fn tool_result(call: &ToolCall, value: &Value) -> Message {
        Message {
            role: Role::Tool,
            content: Some(tool_text(value)),
            tool_call_id: Some(call.id.clone()),
            tool_name: Some(call.name.clone()),
            ..Message::empty()
        }
    }
    /// A tool call that could not run.
    pub fn tool_error(call: &ToolCall, error: &str) -> Message {
        Message {
            role: Role::Tool,
            content: Some(format!("error: {error}")),
            tool_call_id: Some(call.id.clone()),
            tool_name: Some(call.name.clone()),
            error: true,
            ..Message::empty()
        }
    }
    fn empty() -> Message {
        Message { role: Role::User, content: None, tool_calls: Vec::new(), tool_call_id: None, tool_name: None, error: false }
    }
    /// The text a tool result carries, or `""`.
    pub fn text(&self) -> &str {
        self.content.as_deref().unwrap_or("")
    }
}

/// The most characters of a tool result the model reads. A `describe_drawing` of a big drawing
/// runs to megabytes of JSON; the head of it is what the model can act on, and the tail is what
/// would push the real conversation out of the window.
pub const MAX_TOOL_RESULT_CHARS: usize = 8_000;
/// The most characters of the conversation sent in one request (older turns are dropped).
pub const MAX_REQUEST_CHARS: usize = 60_000;

/// A tool result as text: compact JSON, capped, with the cap stated so the model knows.
fn tool_text(value: &Value) -> String {
    let s = match value {
        Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_else(|_| "null".to_string()),
    };
    if s.chars().count() <= MAX_TOOL_RESULT_CHARS {
        return s;
    }
    let head: String = s.chars().take(MAX_TOOL_RESULT_CHARS).collect();
    format!("{head}\n… truncated: {} characters total. Narrow the request (a filter, a window, a limit) to see the rest.", s.chars().count())
}

/// The messages in the wire shape: `{role, content, tool_calls?, tool_call_id?}`.
pub fn wire(messages: &[Message]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let mut o = serde_json::Map::new();
            o.insert(
                "role".into(),
                json!(match m.role {
                    Role::System => "system",
                    Role::User => "user",
                    Role::Assistant => "assistant",
                    Role::Tool => "tool",
                }),
            );
            if let Some(c) = &m.content {
                o.insert("content".into(), json!(c));
            } else if m.role == Role::Assistant && !m.tool_calls.is_empty() {
                // OpenAI requires content to be null (not missing) on a tool-call turn.
                o.insert("content".into(), Value::Null);
            }
            if !m.tool_calls.is_empty() {
                o.insert(
                    "tool_calls".into(),
                    Value::Array(
                        m.tool_calls
                            .iter()
                            .map(|c| {
                                json!({
                                    "id": c.id,
                                    "type": "function",
                                    "function": {
                                        "name": c.name,
                                        "arguments": serde_json::to_string(&c.arguments).unwrap_or_else(|_| "{}".into()),
                                    }
                                })
                            })
                            .collect(),
                    ),
                );
            }
            if let Some(id) = &m.tool_call_id {
                o.insert("tool_call_id".into(), json!(id));
            }
            Value::Object(o)
        })
        .collect()
}

/// The messages to send: the system prompt always, then as many whole turns as fit the budget,
/// the newest first. A turn runs from one user message to the next, so an assistant's tool call
/// and the results it produced are never separated — a result without its call is rejected by
/// every provider. The newest turn is always sent, however large: it is the work in progress.
pub fn for_request(messages: &[Message], budget: usize) -> Vec<Message> {
    let used = |m: &Message| m.text().chars().count() + m.tool_calls.iter().map(|c| c.name.len() + c.arguments.to_string().len()).sum::<usize>();
    let (head, rest) = match messages.split_first() {
        Some((first, rest)) if first.role == Role::System => (Some(first.clone()), rest),
        _ => (None, messages),
    };
    // Where each turn starts: a user message, plus whatever precedes the first one.
    let mut starts: Vec<usize> = rest.iter().enumerate().filter(|(_, m)| m.role == Role::User).map(|(i, _)| i).collect();
    if starts.first() != Some(&0) {
        starts.insert(0, 0);
    }
    let mut total = 0usize;
    let mut from = starts.last().copied().unwrap_or(0);
    for (k, &s) in starts.iter().enumerate().rev() {
        let end = starts.get(k + 1).copied().unwrap_or(rest.len());
        let cost: usize = rest[s..end].iter().map(used).sum();
        let newest = k + 1 == starts.len();
        if !newest && total + cost > budget {
            break;
        }
        total += cost;
        from = s;
    }
    let mut out = Vec::with_capacity(rest.len() - from + 1);
    if let Some(h) = head {
        out.push(h);
    }
    out.extend_from_slice(&rest[from..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_call_wire_message_carries_null_content_and_json_arguments() {
        let call = ToolCall { id: "call_1".into(), name: "execute".into(), arguments: json!({"command": "circle"}) };
        let m = Message::assistant_calls(vec![call], None);
        let w = wire(&[m]);
        assert_eq!(w[0]["role"], "assistant");
        assert!(w[0]["content"].is_null(), "content must be present and null: {}", w[0]);
        assert_eq!(w[0]["tool_calls"][0]["function"]["name"], "execute");
        assert_eq!(w[0]["tool_calls"][0]["function"]["arguments"], "{\"command\":\"circle\"}");
        assert_eq!(w[0]["tool_calls"][0]["type"], "function");
    }

    #[test]
    fn a_tool_result_answers_its_call() {
        let call = ToolCall { id: "call_9".into(), name: "query_entities".into(), arguments: json!({}) };
        let m = Message::tool_result(&call, &json!({"count": 3}));
        let w = wire(&[m]);
        assert_eq!(w[0]["role"], "tool");
        assert_eq!(w[0]["tool_call_id"], "call_9");
        assert_eq!(w[0]["content"], "{\"count\":3}");
    }

    #[test]
    fn a_huge_tool_result_is_capped_and_says_so() {
        let big = json!({ "text": "x".repeat(MAX_TOOL_RESULT_CHARS * 2) });
        let s = tool_text(&big);
        assert!(s.len() < MAX_TOOL_RESULT_CHARS + 200, "capped: {}", s.len());
        assert!(s.contains("truncated"), "{s}");
        assert!(s.contains("Narrow the request"));
    }

    #[test]
    fn the_request_keeps_the_system_prompt_and_the_newest_turns() {
        let mut msgs = vec![Message::system("S")];
        for i in 0..20 {
            msgs.push(Message::user(format!("u{i}")));
            msgs.push(Message::assistant(format!("a{i}")));
        }
        let kept = for_request(&msgs, 40);
        assert_eq!(kept[0].role, Role::System, "the system prompt is always sent");
        assert!(kept.len() < msgs.len(), "old turns are dropped");
        assert_eq!(kept.last().unwrap().text(), "a19", "the newest turn is kept");
    }

    #[test]
    fn the_cut_never_orphans_a_tool_result() {
        let call = ToolCall { id: "c1".into(), name: "execute".into(), arguments: json!({}) };
        let msgs = vec![
            Message::system("S"),
            Message::user("draw a circle"),
            Message::assistant_calls(vec![call.clone()], None),
            Message::tool_result(&call, &json!({"handle": "10"})),
            Message::assistant("done"),
            Message::user("now move it"),
            Message::assistant("moved"),
        ];
        // A budget that only fits the last two turns must not leave the tool result without its call.
        for budget in [1, 5, 10, 20, 40, 100] {
            let kept = for_request(&msgs, budget);
            assert_eq!(kept[0].role, Role::System);
            for (i, m) in kept.iter().enumerate() {
                if m.role == Role::Tool {
                    let prev = kept[..i].iter().rev().find(|p| p.role == Role::Assistant && !p.tool_calls.is_empty());
                    assert!(prev.is_some(), "budget {budget} orphaned a tool result: {kept:?}");
                }
            }
        }
    }
}
