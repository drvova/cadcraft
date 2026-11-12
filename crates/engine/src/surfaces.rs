//! Designed surfaces: pictures of the drawing's *data* — a piece card — as opposed to pictures
//! of the drawing itself.
//!
//! The engine does not lay them out: that is `cadcraft-surface`'s work, one layer up, and the
//! engine may not depend on it. A host that links that crate hands the engine a renderer once
//! ([`install`]), and the assistant's `(card …)` reaches it through [`render`]. In a build
//! without one (the browser, the desktop window, and the command-line tool built without its
//! `surfaces` feature, which is the default) `(card …)` says it is not available; it never
//! panics and nothing else changes.

use std::sync::OnceLock;

use serde_json::Value;

use crate::Session;

/// A surface, drawn.
#[derive(Debug, Clone, PartialEq)]
pub struct Picture {
    /// A PNG file.
    pub png: Vec<u8>,
    /// Its width in pixels.
    pub width: u32,
    /// Its height in pixels.
    pub height: u32,
    /// The data it shows, as the engine's commands replied it.
    pub data: Value,
}

/// Draws the surface called `name` for the session's open drawing. `params` are the surface's
/// own options (`width`, `theme`); an unknown name or a bad option is an `Err`.
pub type Renderer = fn(&mut Session, &str, &Value) -> std::result::Result<Picture, String>;

static RENDERER: OnceLock<Renderer> = OnceLock::new();

/// Give the engine its surface renderer. The first one stays; a second call changes nothing.
pub fn install(renderer: Renderer) {
    let _ = RENDERER.set(renderer);
}

/// Whether a renderer is installed.
pub fn available() -> bool {
    RENDERER.get().is_some()
}

/// Draw a surface. `Err` when this build has no renderer, or the renderer refuses.
pub fn render(session: &mut Session, name: &str, params: &Value) -> std::result::Result<Picture, String> {
    match RENDERER.get() {
        Some(renderer) => renderer(session, name, params),
        None => Err("designed surfaces are not available in this build (the command-line tool and its MCP server have them when built with their `surfaces` feature)".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_without_a_renderer_says_so() {
        // The engine's own tests link no renderer: the door answers with a sentence, not a panic.
        if available() {
            return;
        }
        let mut s = Session::new();
        let e = render(&mut s, "piece-card", &serde_json::json!({})).unwrap_err();
        assert!(e.contains("not available"), "{e}");
    }
}
