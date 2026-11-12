//! A filled document to a picture: PNG, SVG, or a grid of terminal cells.
//!
//! The kernel lays the document out for the client it is told it is drawing for (`when png`,
//! `when tui` patches in a document follow it), and Slab's exporters paint the frame. Sizes are
//! clamped and capped before anything is allocated, and all of it runs under
//! [`crate::error::guard`].

use slab_compile::render::RuntimeImage;
use slab_kernel::flatten::{Frame, FrameOp};
use slab_kernel::frame::{self as kframe, Instance};

use crate::document::Document;
use crate::error::{Result, SurfaceError, guard};
use crate::fonts;

/// Kernel client codes (Slab SPEC §11.2): which renderer class a document is laid out for.
pub(crate) const CLIENT_TUI: u32 = 2;
const CLIENT_SVG: u32 = 3;
const CLIENT_PNG: u32 = 4;

/// A terminal cell in layout units (Slab SPEC §3).
pub(crate) const CELL_W: f64 = 8.0;
pub(crate) const CELL_H: f64 = 16.0;

/// The narrowest and widest a surface is laid out, in layout units (1 unit = 1 px at scale 1).
pub const MIN_WIDTH: u32 = 240;
/// See [`MIN_WIDTH`].
pub const MAX_WIDTH: u32 = 2400;
/// The most pixels a PNG may have: refused before the raster is allocated.
pub const MAX_PIXELS: u64 = 16_000_000;
/// The most bytes a PNG may be. An MCP reply carries it base64-encoded (4/3 of this), which stays
/// under what clients accept for one tool result.
pub const MAX_PNG_BYTES: u64 = 3 * 1024 * 1024;
/// The most bytes an SVG may be.
pub const MAX_SVG_BYTES: u64 = 12 * 1024 * 1024;
/// The terminal sizes the dashboard is laid out for.
pub const MIN_COLS: u16 = 40;
/// See [`MIN_COLS`].
pub const MAX_COLS: u16 = 400;
/// See [`MIN_COLS`].
pub const MIN_ROWS: u16 = 16;
/// See [`MIN_COLS`].
pub const MAX_ROWS: u16 = 200;

/// The two palettes the documents declare (`slab/tokens.slab`), after the interface's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Theme {
    /// The dark palette: the interface's default.
    #[default]
    Dark,
    /// The light palette.
    Light,
}

impl Theme {
    /// The theme's name in the documents.
    pub fn name(self) -> &'static str {
        match self {
            Theme::Dark => "dark",
            Theme::Light => "light",
        }
    }

    /// A theme by name (`dark`, `light`; case does not matter).
    pub fn parse(name: &str) -> Result<Theme> {
        match name.trim().to_ascii_lowercase().as_str() {
            "dark" => Ok(Theme::Dark),
            "light" => Ok(Theme::Light),
            _ => Err(SurfaceError::Theme(name.chars().take(40).collect())),
        }
    }
}

/// A raster picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    /// The PNG file.
    pub png: Vec<u8>,
    /// Its width in pixels.
    pub width: u32,
    /// Its height in pixels.
    pub height: u32,
}

fn theme_and_env(inst: &mut Instance, theme: Theme, width: f64, height: f64, client: u32) -> Result<()> {
    if !kframe::inst_set_theme(inst, theme.name()) {
        return Err(SurfaceError::Theme(theme.name().into()));
    }
    kframe::inst_set_env(inst, width, height, client, theme == Theme::Dark, false);
    Ok(())
}

/// The images a host registered at run time that this frame paints (Slab SPEC §13.7).
fn runtime_images<'a>(inst: &'a Instance, frame: &Frame) -> Vec<RuntimeImage<'a>> {
    let compiled = i32::try_from(inst.doc().img_src.len()).unwrap_or(i32::MAX);
    let mut images: Vec<RuntimeImage<'a>> = Vec::new();
    for op in &frame.ops {
        let FrameOp::Image(image) = op else { continue };
        if image.img < compiled || images.iter().any(|known| known.image == image.img) {
            continue;
        }
        let Some((width, height, format, generation)) = kframe::inst_img_info(inst, image.img) else { continue };
        images.push(RuntimeImage { image: image.img, width, height, format, generation, bytes: kframe::inst_img_bytes(inst, image.img) });
    }
    images
}

/// The size a PNG's own header gives (`IHDR`), which is what a reader will see.
fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    let field = |at: usize| -> Option<u32> { Some(u32::from_be_bytes(png.get(at..at + 4)?.try_into().ok()?)) };
    (png.get(..8)? == b"\x89PNG\r\n\x1a\n" && png.get(12..16)? == b"IHDR").then_some(())?;
    Some((field(16)?, field(20)?))
}

/// Draw a filled document as a PNG, `width` layout units wide at `scale` pixels per unit; the
/// height is the document's own.
///
/// A PNG is glyph outlines, so it needs a face: [`crate::fonts`] finds one on the machine and it
/// is registered with the kernel for this render. With none the picture is refused
/// ([`SurfaceError::NoFont`]) rather than drawn without its text.
pub(crate) fn png(document: Document, inst: &mut Instance, images: &[Vec<u8>], width: u32, scale: f64, theme: Theme) -> Result<Picture> {
    png_with(document, inst, images, width, scale, theme, fonts::faces())
}

/// [`png`] with the faces given: `None` is a machine with no font.
pub(crate) fn png_with(
    document: Document,
    inst: &mut Instance,
    images: &[Vec<u8>],
    width: u32,
    scale: f64,
    theme: Theme,
    faces: Option<&fonts::Faces>,
) -> Result<Picture> {
    let faces = faces.ok_or_else(fonts::no_font)?;
    guard("a PNG", || {
        let slir = document.slir()?;
        fonts::register(inst, faces);
        let width = width.clamp(MIN_WIDTH, MAX_WIDTH);
        let scale = if scale.is_finite() { scale.clamp(0.5, 4.0) } else { 1.0 };
        theme_and_env(inst, theme, f64::from(width), 0.0, CLIENT_PNG)?;
        let frame = kframe::inst_frame(inst, 0.0);
        // Refuse a raster that is too large before it is allocated: a hostile drawing can make
        // a document as tall as its capped lists allow, and no taller.
        let pixels = (frame.width * scale).ceil() * (frame.height * scale).ceil();
        if !pixels.is_finite() || pixels < 1.0 {
            return Err(SurfaceError::Render { what: "a PNG", message: "the document has no size".into() });
        }
        if pixels > MAX_PIXELS as f64 {
            return Err(SurfaceError::TooLarge { what: "the PNG's pixels", size: pixels as u64, limit: MAX_PIXELS });
        }
        let runtime = runtime_images(inst, &frame);
        let bytes = slab_compile::raster::render_png(slir, inst.doc(), images, &runtime, &[], &frame, scale)
            .map_err(|message| SurfaceError::Render { what: "a PNG", message })?;
        if bytes.len() as u64 > MAX_PNG_BYTES {
            return Err(SurfaceError::TooLarge { what: "the PNG", size: bytes.len() as u64, limit: MAX_PNG_BYTES });
        }
        let (w, h) = png_size(&bytes).ok_or_else(|| SurfaceError::Render { what: "a PNG", message: "the exporter did not write a PNG".into() })?;
        Ok(Picture { png: bytes, width: w, height: h })
    })
}

/// Draw a filled document as a standalone SVG, `width` layout units (CSS pixels) wide.
///
/// An SVG needs no font: the text is laid out with Slab's built-in default advances (the same on
/// every machine), each run is written with the width it was given (`textLength`), and the page
/// names a generic family for the viewer to supply. No face is embedded; there is none to embed.
pub(crate) fn svg(document: Document, inst: &mut Instance, images: &[Vec<u8>], width: u32, theme: Theme) -> Result<String> {
    guard("an SVG", || {
        let slir = document.slir()?;
        let width = width.clamp(MIN_WIDTH, MAX_WIDTH);
        theme_and_env(inst, theme, f64::from(width), 0.0, CLIENT_SVG)?;
        let frame = kframe::inst_frame_static(inst);
        let runtime = runtime_images(inst, &frame);
        let svg = slab_compile::svg::render_svg(slir, inst.doc(), images, &runtime, &[], &frame, std::path::Path::new("."));
        let svg = tidy_svg(svg);
        if svg.len() as u64 > MAX_SVG_BYTES {
            return Err(SurfaceError::TooLarge { what: "the SVG", size: svg.len() as u64, limit: MAX_SVG_BYTES });
        }
        Ok(svg)
    })
}

/// The font stack Slab's exporter writes for text.
const SLAB_FALLBACK: &str = "Helvetica, Arial, sans-serif";

/// Make the exporter's SVG a page that can be handed over: a monospaced run gets a monospaced
/// fallback instead of Helvetica. (Text with no authored family is written with the fallback
/// stack alone; the patch series in `third_party/slab` fixed the exporter's empty first name.)
fn tidy_svg(svg: String) -> String {
    svg.replace(&format!("font-family=\"mono, {SLAB_FALLBACK}\""), "font-family=\"ui-monospace, Menlo, Consolas, monospace\"")
}

/// The words an SVG surface shows: the content of each text run, in paint order, with XML
/// entities undone. What a test reads a surface by, and what a caller without a renderer can
/// search.
pub fn svg_text(svg: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = svg;
    while let Some(open) = rest.find("<text") {
        let Some(after) = rest.get(open..) else { break };
        let Some(start) = after.find('>') else { break };
        let Some(body) = after.get(start + 1..) else { break };
        let Some(end) = body.find("</text>") else { break };
        let raw = body.get(..end).unwrap_or_default();
        let text = raw
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&#39;", "'")
            .replace("&amp;", "&")
            .replace('\u{00A0}', " ");
        out.push(text);
        rest = body.get(end..).unwrap_or_default();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn themes_parse_by_name_and_refuse_the_rest() {
        assert_eq!(Theme::parse("dark").unwrap(), Theme::Dark);
        assert_eq!(Theme::parse(" Light ").unwrap(), Theme::Light);
        let e = Theme::parse(&"x".repeat(5000)).unwrap_err().to_string();
        assert!(e.len() < 120, "a hostile name is not echoed whole: {e}");
    }

    #[test]
    fn a_png_header_gives_its_size() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&640u32.to_be_bytes());
        png.extend_from_slice(&480u32.to_be_bytes());
        assert_eq!(png_size(&png), Some((640, 480)));
        assert_eq!(png_size(b"not a png"), None);
        assert_eq!(png_size(&png[..18]), None);
    }

    #[test]
    fn the_svg_is_tidied() {
        let raw = format!("<svg><text font-family=\"{SLAB_FALLBACK}\">a &amp; b</text><text font-family=\"mono, {SLAB_FALLBACK}\">c</text></svg>");
        let tidy = tidy_svg(raw);
        assert!(tidy.contains("monospace") && !tidy.contains("mono, Helvetica"), "{tidy}");
        assert_eq!(svg_text(&tidy), vec!["a & b".to_string(), "c".to_string()]);
    }
}
