//! CADCraft's assistant: an agent that drives the application through its own command harness.
//!
//! The composer pane in the interface is the face of this crate. It gives a model three things:
//! the **surface** ([`surface`]) — the same tools an external MCP client gets, each one a call
//! into the control harness (`execute`, `query_entities`, `describe_drawing`, …) — the
//! **conversation** ([`chat`]) it answers with, and a **loop** ([`agent`]) that runs the model's
//! tool calls against the live application and feeds the results back, turn after turn.
//!
//! Nothing here knows what a drawing is: the crate speaks to the harness through
//! [`surface::Harness`], so the same code drives a real `CadApp`, a test double, or a future
//! headless host. The transport ([`client`]) is one OpenAI-compatible `/chat/completions`
//! endpoint, which is what OpenAI, OpenRouter, Groq, DeepSeek, Together, Ollama, LM Studio and
//! every other self-hosted server speak; a provider is a base URL, a model name and a key.
//!
//! See `docs/assistant.md`.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#[cfg(not(target_arch = "wasm32"))]
pub mod agent;
pub mod chat;
#[cfg(not(target_arch = "wasm32"))]
pub mod client;
pub mod surface;
#[cfg(test)]
mod tests;

#[cfg(not(target_arch = "wasm32"))]
pub use agent::{Event, ToolExecutor};
pub use chat::{Message, Role, ToolCall};
