//! CADCraft MCP server.
//!
//! JSON-RPC 2.0 over stdio (newline-delimited), implementing the MCP lifecycle and **one tool**:
//! `run`, which executes AutoLISP inside the open drawing. A capability is reached from that code
//! — `(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))` draws, `(cmd "entities" …)` reads back,
//! `(cmdline "zoom" "e")` types at the command line, `(render)` returns a picture — and a model's
//! own definitions are kept and reloaded next session, so it builds its tooling instead of
//! choosing from a menu. There is no verb per capability and no resources: a second interface to
//! the same capabilities is what this design replaces.
//!
//! The session behind the tool is a headless [`Headless`] one in-process, or a running app through
//! its loopback control port ([`Remote`]) — the same one tool either way.
//!
//! **Running code is what the server does**, with the authority of the process it runs in: there
//! is no enable/disable flag and no code-free mode. Run it sandboxed (a container, a VM, a jail)
//! when the model driving it is not trusted with the user's files.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#![forbid(unsafe_code)]

mod backend;
pub mod control_token;
mod server;
mod tools;

pub use backend::{Backend, Headless, Remote};
pub use server::{PROTOCOL_VERSION, Server};

#[cfg(test)]
mod tests;
