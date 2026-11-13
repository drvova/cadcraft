//! The surface documents: their sources, their compiled form, and Slab's check of them.
//!
//! The sources in `slab/` are embedded in the crate. `build.rs` compiles each into a typed module
//! ([`crate::generated`]) holding the compiled document (SLIR); at run time that form is decoded
//! once per process and kept, so drawing a surface never runs the compiler. The compiler is still
//! linked: [`check`] is `slab check` as a library call, and [`compile`] is what a test uses to
//! prove the embedded form is what the source compiles to.

use std::collections::HashMap;
use std::sync::OnceLock;

use slab_slir::Slir;

use crate::error::{Result, SurfaceError, guard};
use crate::generated;

/// The Slab commit this crate is written against: the base `third_party/slab/SLAB.lock` pins,
/// under the patch series beside it (the root `Cargo.toml` names the same commit).
pub const SLAB_COMMIT: &str = "65747371a18da9a54a94955473d0ec7f7fd07d5f";

/// A surface document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Document {
    /// `slab/piece-card.slab`: the piece card.
    PieceCard,
    /// `slab/tech-sheet.slab`: the bench sheet as a page.
    TechSheet,
    /// `slab/dashboard.slab`: the terminal dashboard.
    Dashboard,
}

/// The palette every document imports.
const TOKENS: (&str, &str) = ("tokens.slab", include_str!("../slab/tokens.slab"));

impl Document {
    /// Every document.
    pub const ALL: [Document; 3] = [Document::PieceCard, Document::TechSheet, Document::Dashboard];

    /// The document's file name in `slab/`.
    pub fn file(self) -> &'static str {
        match self {
            Document::PieceCard => "piece-card.slab",
            Document::TechSheet => "tech-sheet.slab",
            Document::Dashboard => "dashboard.slab",
        }
    }

    /// The document's source text.
    pub fn source(self) -> &'static str {
        match self {
            Document::PieceCard => include_str!("../slab/piece-card.slab"),
            Document::TechSheet => include_str!("../slab/tech-sheet.slab"),
            Document::Dashboard => include_str!("../slab/dashboard.slab"),
        }
    }

    /// The compiled document (SLIR bytes) the build embedded.
    pub fn slir_bytes(self) -> &'static [u8] {
        match self {
            Document::PieceCard => generated::piece_card::SLIR,
            Document::TechSheet => generated::tech_sheet::SLIR,
            Document::Dashboard => generated::dashboard::SLIR,
        }
    }

    /// The compiled document, decoded once per process and kept. The exporters read it beside the
    /// live instance (gradients, animations, images), so it outlives every render.
    pub(crate) fn slir(self) -> Result<&'static Slir> {
        static CACHE: [OnceLock<std::result::Result<Slir, String>>; 3] = [OnceLock::new(), OnceLock::new(), OnceLock::new()];
        let slot = match self {
            Document::PieceCard => 0,
            Document::TechSheet => 1,
            Document::Dashboard => 2,
        };
        let cell = CACHE.get(slot).ok_or_else(|| self.broken("no cache slot"))?;
        let decoded = cell.get_or_init(|| {
            guard("a document", || {
                // Both readers must accept the bytes: the exporters' (`read`) and the kernel's
                // (`decode_doc`, which the generated `Doc::new` unwraps).
                slab_slir::decode_doc(self.slir_bytes()).map_err(|e| self.broken(&e))?;
                slab_slir::read(self.slir_bytes()).map_err(|e| self.broken(&e))
            })
            .map_err(|e| e.to_string())
        });
        decoded.as_ref().map_err(|message| SurfaceError::Document { document: self.file().into(), message: message.clone() })
    }

    fn broken(self, message: &str) -> SurfaceError {
        SurfaceError::Document { document: self.file().into(), message: message.to_string() }
    }
}

/// The compiler's options for an embedded source: imports come from the embedded sources and
/// nothing is read from the file system.
fn options() -> slab_compile::Options {
    let mut sources: HashMap<String, String> = Document::ALL.iter().map(|d| (d.file().to_string(), d.source().to_string())).collect();
    sources.insert(TOKENS.0.to_string(), TOKENS.1.to_string());
    slab_compile::Options {
        embed_assets: true,
        base_dir: std::path::PathBuf::from("."),
        assets: Some(HashMap::new()),
        sources: Some(sources),
        fonts: HashMap::new(),
    }
}

/// What Slab's compiler says about a source: `slab check`, as a library call. The document and
/// every exported definition in it are compiled; the diagnostics come back formatted
/// (`file:line: level[code]: message`), errors and warnings alike.
#[derive(Debug, Clone, Default)]
pub struct Checked {
    /// Errors: the document does not compile.
    pub errors: Vec<String>,
    /// Warnings and notes: it compiles, and something in it is probably a mistake.
    pub warnings: Vec<String>,
}

impl Checked {
    /// No error and no warning.
    pub fn clean(&self) -> bool {
        self.errors.is_empty() && self.warnings.is_empty()
    }
}

/// Check a Slab source that may import the embedded documents (`tokens.slab`).
pub fn check_source(name: &str, source: &str) -> Result<Checked> {
    guard("a check", || {
        let (_, diagnostics) = slab_compile::compile_with_exports(source, &options());
        let mut out = Checked::default();
        for d in &diagnostics.0 {
            let line = d.format(name);
            match d.level {
                slab_syntax::diag::Level::Error => out.errors.push(line),
                _ => out.warnings.push(line),
            }
        }
        Ok(out)
    })
}

/// Check one of the embedded documents.
pub fn check(document: Document) -> Result<Checked> {
    check_source(document.file(), document.source())
}

/// Compile a Slab source to SLIR bytes. An error carries the compiler's diagnostics.
pub fn compile(name: &str, source: &str) -> Result<Vec<u8>> {
    guard("a compile", || {
        let (slir, diagnostics) = slab_compile::compile(source, &options());
        match slir {
            Some(slir) => Ok(slab_slir::write(&slir)),
            None => Err(SurfaceError::Document {
                document: name.to_string(),
                message: diagnostics.0.iter().map(|d| d.format(name)).collect::<Vec<_>>().join("\n"),
            }),
        }
    })
}
