//! CADCraft's designed surfaces outside the web interface.
//!
//! A *surface* is a picture of the drawing's data, as opposed to a picture of the drawing: the
//! piece card an agent is shown, the bench sheet as a page, the terminal dashboard. Each is laid
//! out by a [Slab](https://github.com/stencil-hq/slab) document in `slab/` — a small declarative
//! language whose one kernel does the layout for every medium — and filled from the engine's own
//! replies. Nothing is measured or priced here: the figures are `piece {query: true}`'s and
//! `techsheet {}`'s, printed.
//!
//! | surface | document | made by | as |
//! |---|---|---|---|
//! | piece card | `slab/piece-card.slab` | [`piece_card`], [`card_png`], [`card_svg`] | PNG, SVG |
//! | bench sheet | `slab/tech-sheet.slab` | [`tech_sheet_svg`], [`tech_sheet_png`] | SVG, PNG |
//! | dashboard | `slab/dashboard.slab` | [`Dashboard`], [`dashboard_text`] | terminal cells |
//!
//! `build.rs` compiles the documents into typed modules ([`generated`]), so a param or a list
//! field that a document renames stops this crate compiling. [`check`] is `slab check` as a
//! library call. [`install`] hands the engine the renderer its `(card …)` reaches.
//!
//! **Never crash.** Slab is pre-alpha, and its kernel indexes and unwraps freely. Every call into
//! it runs under a guard that turns a panic into a [`SurfaceError`]; every string from a drawing
//! is cleaned and cut, every list capped, every size clamped before anything is allocated.
//!
//! **Layering.** L5, beside `mcp`, `ai` and `wasm`: it depends on the engine and on Slab's
//! compiler, kernel and static exporters, and on no windowing, GPU or terminal library. The
//! browser build does not link it (the web interface loads Slab its own way).
//!
//! **Optional.** Everything here is behind the `slab` feature, off by default: Slab is fetched
//! and patched by `cargo xtask slab` (`third_party/slab/README.md`), and a build without it has
//! an empty crate here. `cargo xtask surfaces test` builds and tests the real thing.
//!
//! **No fonts.** Slab is linked without its bundled faces and none is in this repository. An SVG
//! and the dashboard need none; a PNG is drawn with a face found on the machine ([`png_font`])
//! and refused in a sentence when there is none ([`SurfaceError::NoFont`]).
#![cfg(feature = "slab")]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#![forbid(unsafe_code)]

mod card;
mod dash;
pub mod data;
mod document;
mod error;
mod fonts;
pub mod generated;
mod render;
mod sheet;

pub use card::{Card, CardOptions, card_png, card_svg, piece_card};
pub use dash::{CellGrid, Dashboard, Event, dashboard_text};
pub use data::PieceData;
pub use document::{Checked, Document, SLAB_COMMIT, check, check_source, compile};
pub use error::{Result, SurfaceError};
pub use fonts::{SANS, png_font};
pub use render::{MAX_COLS, MAX_PIXELS, MAX_PNG_BYTES, MAX_ROWS, MAX_SVG_BYTES, MAX_WIDTH, MIN_COLS, MIN_ROWS, MIN_WIDTH, Picture, Theme, svg_text};
pub use sheet::{SheetOptions, Views, sheet_png, sheet_svg, tech_sheet_png, tech_sheet_svg};

use cadcraft_engine::Session;
use serde_json::Value;

/// The surfaces the engine can ask for by name.
pub const SURFACES: &[&str] = &["piece-card", "tech-sheet"];

/// Give the engine this crate as its surface renderer, so the assistant's `(card …)` draws. Call
/// it once, at the start of a process that links this crate; calling it again changes nothing.
pub fn install() {
    cadcraft_engine::surfaces::install(render_for_engine);
}

/// A width option: a finite number, or the default. A hostile value (a string, NaN, 1e300) is
/// the default or the nearest limit, never a panic.
fn width_option(params: &Value, default: u32) -> u32 {
    params.get("width").and_then(Value::as_f64).filter(|w| w.is_finite()).map_or(default, |w| w.clamp(1.0, 100_000.0) as u32)
}

fn theme_option(params: &Value, default: Theme) -> Result<Theme> {
    match params.get("theme") {
        None | Some(Value::Null) => Ok(default),
        Some(Value::String(name)) => Theme::parse(name),
        Some(_) => Err(SurfaceError::Request("`theme` must be \"dark\" or \"light\"".into())),
    }
}

/// The engine's door ([`cadcraft_engine::surfaces::Renderer`]): draw the surface called `name`
/// as a PNG. Options: `width` (layout units), `theme` (`dark` | `light`).
fn render_for_engine(session: &mut Session, name: &str, params: &Value) -> std::result::Result<cadcraft_engine::surfaces::Picture, String> {
    let drawn = match name {
        "piece-card" => {
            let defaults = CardOptions::default();
            (|| {
                let options = CardOptions { width: width_option(params, defaults.width), theme: theme_option(params, defaults.theme)?, ..defaults };
                let card = piece_card(session, &options)?;
                Ok((card.picture, card.data.json))
            })()
        }
        "tech-sheet" => {
            let defaults = SheetOptions::default();
            (|| {
                let options = SheetOptions { width: width_option(params, defaults.width), theme: theme_option(params, defaults.theme)?, ..defaults };
                let data = PieceData::gather(session);
                let views = Views::of(session);
                Ok((sheet_png(&data, views.as_ref(), &options)?, data.json))
            })()
        }
        other => Err(SurfaceError::Request(format!("unknown surface `{}` ({})", other.chars().take(40).collect::<String>(), SURFACES.join(", ")))),
    };
    drawn
        .map(|(picture, data)| cadcraft_engine::surfaces::Picture { png: picture.png, width: picture.width, height: picture.height, data })
        .map_err(|e: SurfaceError| e.to_string())
}

#[cfg(test)]
mod tests;
