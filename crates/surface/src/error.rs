//! What can go wrong on the way from a drawing to a picture of its data.

/// A surface could not be made. Every failure inside Slab ends up here: a document that does not
/// compile, a value the kernel refuses, an exporter error, and a panic in Slab's code.
#[derive(Debug, thiserror::Error)]
pub enum SurfaceError {
    /// A `.slab` document does not compile, or its compiled form does not decode.
    #[error("{document}: {message}")]
    Document {
        /// The document's file name.
        document: String,
        /// Slab's diagnostics, one per line.
        message: String,
    },
    /// The kernel refused a value for a param or a list the document declares.
    #[error("{document}: Slab refused a value for `{param}`")]
    Refused {
        /// The document's file name.
        document: &'static str,
        /// The param or list.
        param: &'static str,
    },
    /// A theme the documents do not declare.
    #[error("unknown theme `{0}` (dark, light)")]
    Theme(String),
    /// A PNG was asked for and there is no font to draw its text with: none is shipped, and none
    /// was found on this machine. The message says what was looked for, and that an SVG needs none.
    #[error("a PNG surface needs a font: {0}")]
    NoFont(String),
    /// Slab's exporter reported an error.
    #[error("could not render {what}: {message}")]
    Render {
        /// What was being drawn.
        what: &'static str,
        /// The exporter's message.
        message: String,
    },
    /// Slab's code panicked. Nothing of ours was left half done: the instance is dropped.
    #[error("Slab failed while drawing {what}: {message}")]
    Panicked {
        /// What was being drawn.
        what: &'static str,
        /// The panic's message.
        message: String,
    },
    /// The picture is larger than a reply may carry.
    #[error("{what} would be {size} bytes, over the limit of {limit}")]
    TooLarge {
        /// What was being drawn.
        what: &'static str,
        /// Its size in bytes (or the estimate that refused it).
        size: u64,
        /// The limit.
        limit: u64,
    },
    /// A request this crate does not understand (an unknown surface name, a bad option).
    #[error("{0}")]
    Request(String),
}

/// This crate's result.
pub type Result<T> = std::result::Result<T, SurfaceError>;

/// Run Slab code, turning a panic into an error. Slab is pre-alpha and its kernel indexes and
/// unwraps freely; a surface is a picture of data that is already safe in the drawing, so a
/// failure to draw it must never take the process (and the drawing) with it.
pub(crate) fn guard<T>(what: &'static str, f: impl FnOnce() -> Result<T>) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => {
            let message =
                p.downcast_ref::<&str>().map(ToString::to_string).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into());
            Err(SurfaceError::Panicked { what, message })
        }
    }
}
