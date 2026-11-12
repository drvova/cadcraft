//! Where a PNG surface gets its glyph outlines.
//!
//! No font is in this repository or in what it builds: Slab is linked without its bundled faces
//! (`third_party/slab`), so its kernel lays text out with a built-in default advance table and
//! has nothing to draw glyphs with. That is all an SVG or the terminal dashboard needs — they are
//! laid out with that table on every machine, and the same drawing gives the same bytes
//! everywhere. A PNG needs outlines, so it needs a face, found when the picture is drawn:
//!
//! 1. the file `CADCRAFT_SURFACE_FONT` names (and `CADCRAFT_SURFACE_FONT_BOLD` for the heavy
//!    weights), if set;
//! 2. the first installed family of [`SANS`], through [`cadcraft_fonts::ttf::find`] (system fonts
//!    found at run time, never bundled);
//! 3. a Latin face of the optional craft-fonts build input (`CRAFT_FONTS_DIR`), when the build
//!    had one.
//!
//! With none, a PNG is refused with [`SurfaceError::NoFont`], which says so and that the SVG
//! works. The face is registered with the kernel for the one render (Slab's
//! `inst_font_register`, with its bytes), so the text is shaped and measured with the face that
//! paints it. A PNG therefore depends on the machine's fonts; an SVG never does.

use std::sync::{Arc, OnceLock};

use slab_fonts::RegisteredMetrics;
use slab_kernel::frame::{self as kframe, Instance};

use crate::error::SurfaceError;

/// The most bytes of a face that is registered. A text face is well under this; a CJK collection
/// is not what a card is set in.
const MAX_FACE_BYTES: usize = 8 * 1024 * 1024;
/// The most codepoints of a face's character map (Slab's tables hold 16-bit glyph ids).
const MAX_CODEPOINTS: usize = 65_535;
/// The most font tables of a document that get a face (families times weights; ours have four).
const MAX_TABLES: usize = 16;
/// The weight from which the heavy face is used, when there is one.
const BOLD_FROM: u32 = 600;

/// Sans-serif families looked for, in order, each with the name of its bold face: the faces the
/// web interface's own stack resolves to on the systems CADCraft runs on. Names only — none of
/// these is shipped.
pub const SANS: &[(&str, &str)] = &[
    ("Inter", "Inter Bold"),
    ("Segoe UI", "Segoe UI Bold"),
    ("Helvetica Neue", "Helvetica Neue Bold"),
    ("Arial", "Arial Bold"),
    ("Liberation Sans", "Liberation Sans Bold"),
    ("DejaVu Sans", "DejaVu Sans Bold"),
    ("Noto Sans", "Noto Sans Bold"),
    ("Carlito", "Carlito Bold"),
    ("FreeSans", "FreeSans Bold"),
];

/// One face a PNG is drawn with.
pub(crate) struct Face {
    name: String,
    bytes: Arc<Vec<u8>>,
    metrics: RegisteredMetrics,
}

/// The faces a PNG is drawn with: one for text, and a heavier one when the family has it.
pub(crate) struct Faces {
    regular: Face,
    bold: Option<Face>,
}

/// A face Slab can shape and draw with: a plain font file (not a face inside a collection) of a
/// sane size that parses, has the Latin letters and figures, and fits Slab's 16-bit tables.
/// Reading a font file is the one place a file this crate did not write is parsed, so it runs
/// under a guard like every other call into Slab.
fn usable(name: &str, bytes: Arc<Vec<u8>>) -> Option<Face> {
    if bytes.is_empty() || bytes.len() > MAX_FACE_BYTES {
        return None;
    }
    let parsed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| slab_fonts::parse_metrics(&bytes))).ok()??;
    let covers = |c: char| parsed.cps.binary_search(&u32::from(c)).is_ok();
    let fits = parsed.upem > 0
        && parsed.cps.len() <= MAX_CODEPOINTS
        && parsed.cps.len() == parsed.gids.len()
        && parsed.cps.len() == parsed.advances.len()
        && parsed.gids.iter().all(|g| u16::try_from(*g).is_ok())
        && parsed.advances.iter().all(|a| u16::try_from(*a).is_ok());
    (fits && ['A', 'a', '0', ' '].into_iter().all(covers)).then(|| Face { name: name.chars().take(80).collect(), bytes, metrics: parsed })
}

/// An installed face by family or file name.
fn installed(name: &str) -> Option<Face> {
    let face = cadcraft_fonts::ttf::find(name)?;
    // Slab reads the first face of a file; a later face of a collection is another font.
    (face.index == 0).then(|| usable(name, face.bytes.clone())).flatten()
}

/// The face a file names. The path is the user's own (an environment variable); the file is
/// capped before it is read whole.
fn from_file(variable: &str) -> Option<Face> {
    let path = std::path::PathBuf::from(std::env::var_os(variable).filter(|v| !v.is_empty())?);
    let size = std::fs::metadata(&path).ok()?.len();
    if size == 0 || size > MAX_FACE_BYTES as u64 {
        return None;
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    usable(&name, Arc::new(std::fs::read(&path).ok()?))
}

fn find() -> Option<Faces> {
    if let Some(regular) = from_file("CADCRAFT_SURFACE_FONT") {
        return Some(Faces { regular, bold: from_file("CADCRAFT_SURFACE_FONT_BOLD") });
    }
    for (family, heavy) in SANS {
        if let Some(regular) = installed(family) {
            // The heavy face must be another file than the regular one: a family lookup that
            // finds nothing better answers with the regular face again.
            let bold = installed(heavy).filter(|b| !Arc::ptr_eq(&b.bytes, &regular.bytes));
            return Some(Faces { regular, bold });
        }
    }
    cadcraft_fonts::CRAFT_FONTS
        .iter()
        .filter(|f| f.scripts.contains(&"Latn") && f.style == "Regular")
        .find_map(|f| usable(f.family, Arc::new(f.bytes.to_vec())))
        .map(|regular| Faces { regular, bold: None })
}

/// The faces of this process, looked for once.
pub(crate) fn faces() -> Option<&'static Faces> {
    static FOUND: OnceLock<Option<Faces>> = OnceLock::new();
    FOUND.get_or_init(find).as_ref()
}

/// The face a PNG surface is drawn with on this machine (its family or file name), or `None`
/// when there is none and a PNG is refused. SVG and the terminal dashboard need no face.
pub fn png_font() -> Option<&'static str> {
    faces().map(|f| f.regular.name.as_str())
}

/// What a PNG is refused with when no face was found.
pub(crate) fn no_font() -> SurfaceError {
    let looked: Vec<&str> = SANS.iter().map(|(family, _)| *family).collect();
    SurfaceError::NoFont(format!(
        "no font was found to draw the text with (looked for {}; CADCRAFT_SURFACE_FONT can name a .ttf or .otf file). The SVG form needs no font: ask for a .svg",
        looked.join(", ")
    ))
}

/// Give every font table of a document a face: each family and weight the document was compiled
/// with is registered again with the face's own metrics and bytes, and the kernel prefers the
/// later table, so all of the document's text is shaped, measured and painted with that face.
pub(crate) fn register(inst: &mut Instance, faces: &Faces) {
    let doc = inst.doc();
    let tables: Vec<(String, u32)> = doc
        .font_family
        .iter()
        .zip(&doc.font_weight)
        .take(MAX_TABLES)
        .map(|(family, weight)| (doc.strs.get(*family as usize).cloned().unwrap_or_default(), *weight))
        .collect();
    for (family, weight) in tables {
        let face = faces.bold.as_ref().filter(|_| weight >= BOLD_FROM).unwrap_or(&faces.regular);
        let m = &face.metrics;
        kframe::inst_font_register(
            inst,
            &family,
            weight,
            u32::from(m.upem),
            i32::from(m.ascent),
            i32::from(m.descent),
            i32::from(m.line_gap),
            i32::from(m.underline_position),
            i32::from(m.underline_thickness),
            u32::from(m.default_advance),
            &face.bytes,
            &m.cps,
            &m.gids,
            &m.advances,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_that_are_not_a_font_are_not_a_face() {
        for bytes in [Vec::new(), b"not a font".to_vec(), vec![0u8; 4096], vec![0xff; MAX_FACE_BYTES + 1]] {
            assert!(usable("x", Arc::new(bytes)).is_none());
        }
        // A minimal sfnt header with no tables.
        assert!(usable("x", Arc::new(vec![0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).is_none());
    }

    #[test]
    fn the_refusal_says_what_was_looked_for_and_that_svg_works() {
        let e = no_font().to_string();
        assert!(e.contains("Inter") && e.contains("DejaVu Sans") && e.contains("CADCRAFT_SURFACE_FONT") && e.contains(".svg"), "{e}");
        assert!(e.len() < 400, "{e}");
    }

    #[test]
    fn a_found_face_has_latin_and_fits_slabs_tables() {
        let Some(found) = faces() else { return };
        for face in std::iter::once(&found.regular).chain(found.bold.as_ref()) {
            assert!(!face.name.is_empty() && face.bytes.len() <= MAX_FACE_BYTES);
            assert!(face.metrics.cps.binary_search(&u32::from('A')).is_ok());
        }
        assert_eq!(png_font(), Some(found.regular.name.as_str()));
    }
}
