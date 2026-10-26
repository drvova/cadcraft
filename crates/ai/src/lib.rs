//! CADCraft's assistant: one tool, and the model builds its own tooling with it.
//!
//! [`code`] is that tool: `run`, which runs AutoLISP **inside the open drawing**. Everything the
//! model can do is reached from that namespace as a function — `(cmd "line" …)`,
//! `(commands)`, `(describe "id")`, `(render)`, the whole language — and definitions it writes
//! (`defun`, `setq` of a literal) are kept and reloaded next session, so a helper written once is
//! there tomorrow. There is no catalog of typed verbs: a capability is a command the code can
//! call, and a new command needs no glue here.
//!
//! The **conversation** ([`chat`]) and the **loop** ([`agent`]) are what the composer pane runs:
//! the model streams an answer, calls `run` with code, and reads back what it printed, what it
//! was worth, and any picture it drew. Nothing here knows what a drawing is — the crate speaks to
//! the harness through [`surface::Harness`], so the same code drives a real `CadApp`, a test
//! double, or a headless host.
//!
//! **Security is a deployment fact, not a toggle.** Running code *is* what the tool does; there is
//! no code-free mode and no disable switch. Run CADCraft sandboxed when the model driving it is
//! not trusted with the user's files. See [`code`].
//!
//! The transport ([`client`]) is one OpenAI-compatible `/chat/completions` endpoint, which is what
//! OpenAI, OpenRouter, Groq, DeepSeek, Together, Ollama, LM Studio and every other self-hosted
//! server speak; a provider is a base URL, a model name and a key. See `docs/assistant.md`.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#[cfg(not(target_arch = "wasm32"))]
pub mod agent;
pub mod chat;
#[cfg(not(target_arch = "wasm32"))]
pub mod client;
pub mod code;
pub mod surface;
#[cfg(test)]
mod tests;

#[cfg(not(target_arch = "wasm32"))]
pub use agent::{Event, ToolExecutor};
pub use chat::{Message, Role, ToolCall};
