//! The typed modules `build.rs` generates from `slab/*.slab` (Slab's `gen rust`).
//!
//! Each holds the compiled document as `SLIR`, a `Doc` over a kernel instance with one setter per
//! param (`set_title`, `set_all_ok`, …), an item struct and a setter per list (`ChecksItem`,
//! `set_checks`), and the scene keys of the nodes that carry an `#id`. A param renamed or retyped
//! in a `.slab` file therefore stops this crate compiling, instead of rendering a blank field.
//!
//! The generated code is Slab's, not ours: it is written for Slab's own lint set, and its
//! `Doc::new` unwraps the decode of its own bytes. The allowances below are for that code alone.
//! Nothing here calls `Doc::new` before [`crate::document`] has decoded the same bytes without
//! panicking, so the unwrap cannot fire.

macro_rules! generated {
    ($(#[$doc:meta])* $name:ident, $file:literal) => {
        $(#[$doc])*
        #[allow(
            clippy::all,
            clippy::expect_used,
            clippy::unwrap_used,
            clippy::panic,
            clippy::unreachable,
            dead_code,
            unused_imports,
            unused_mut,
            unused_variables,
            unused_qualifications,
            missing_docs,
            unreachable_pub
        )]
        pub mod $name {
            include!(concat!(env!("OUT_DIR"), "/", $file));
        }
    };
}

generated!(
    /// `slab/piece-card.slab`.
    piece_card,
    "piece_card.rs"
);
generated!(
    /// `slab/tech-sheet.slab`.
    tech_sheet,
    "tech_sheet.rs"
);
generated!(
    /// `slab/dashboard.slab`.
    dashboard,
    "dashboard.rs"
);
