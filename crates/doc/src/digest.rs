//! A canonical content digest of a drawing: two files can be proven identical or different.
//!
//! [`drawing_digest`] hashes [`entity_lines`] — one canonical line per entity, sorted
//! lexicographically, so the order entities happen to sit in the file does not matter. A line
//! covers:
//!
//! * the entity's DXF type name (`LINE`, `LWPOLYLINE`, `CIRCLE`, `ARC`, `TEXT`, `INSERT`, …),
//! * its space: `Model`, the layout's name, or `block:NAME` for a block definition,
//! * its layer name and common properties (colour, linetype, plot style, … — names, never
//!   handles),
//! * its geometry, every float at nine decimal places with trailing zeros trimmed: a vertex
//!   moved by 1e-9 is a different drawing, 1e-12 noise is not.
//!
//! What a line deliberately leaves out: the entity's handle and every handle-valued field (they
//! change between saves of the same content), entity order (the lines are sorted), the header,
//! the tables and their order, and anonymous `*D`/`*U` block definitions (generated geometry
//! named after the file, like handles — the object that generated it is covered by its own
//! geometry).
//!
//! The hash is 128-bit FNV-1a, lower-case hex. No hashing crate is a workspace dependency, so
//! the algorithm is implemented here, documented, and pinned by the RFC 9923 test vectors.

use serde_json::Value;

use crate::{Drawing, Entity, Space};

/// How deep [`write_canonical`] descends into nested values before it stops (`Dimension`'s
/// `overrides` is the only user-shaped one): hostile nesting is cut off, never a stack overflow.
const MAX_DEPTH: usize = 64;

/// The digest of a drawing: the content hash, how many entities produced it, and the drawing's
/// visible model-space extents.
#[derive(Clone, Debug, PartialEq)]
pub struct Digest {
    /// The content hash: 32 lower-case hex digits.
    pub hash: String,
    /// Entities the hash covers: model space, every layout and every named block definition.
    pub entities: usize,
    /// `[minx, miny, maxx, maxy]` of the visible model-space geometry, `None` when there is none.
    /// Paper space is measured in paper units and is not mixed in.
    pub bounds: Option<[f64; 4]>,
}

/// The canonical line of every entity of `doc`, sorted lexicographically.
///
/// Model space, every layout's paper space and every named block definition are covered (a
/// block's objects are content too); anonymous blocks are generated geometry and are skipped.
/// See the module documentation for what a line holds.
pub fn entity_lines(doc: &Drawing) -> Vec<String> {
    let mut lines = Vec::new();
    for e in doc.model.iter() {
        lines.push(entity_line(e, "Model"));
    }
    for layout in &doc.layouts {
        for e in layout.entities.iter() {
            lines.push(entity_line(e, &layout.name));
        }
    }
    for (name, block) in &doc.blocks {
        if block.anonymous {
            continue;
        }
        for e in block.entities.iter() {
            lines.push(entity_line(e, &format!("block:{name}")));
        }
    }
    lines.sort();
    lines
}

/// The digest of `doc`: [`entity_lines`] joined with newlines, hashed with 128-bit FNV-1a
/// (lower-case hex), with the entity count and the model-space extents alongside.
pub fn drawing_digest(doc: &Drawing) -> Digest {
    let lines = entity_lines(doc);
    let mut hasher = Fnv128::new();
    for line in &lines {
        hasher.write(line.as_bytes());
        hasher.write(b"\n");
    }
    Digest { hash: hasher.hex(), entities: lines.len(), bounds: model_bounds(doc) }
}

/// The visible model-space extents as `[minx, miny, maxx, maxy]`; `None` when there is no visible
/// geometry or when hostile coordinates make the result non-finite (never a NaN in the JSON).
fn model_bounds(doc: &Drawing) -> Option<[f64; 4]> {
    let b = doc.extents(&Space::Model);
    if b.is_empty() || ![b.min.x, b.min.y, b.max.x, b.max.y].iter().all(|v| v.is_finite()) {
        return None;
    }
    Some([b.min.x, b.min.y, b.max.x, b.max.y])
}

/// One canonical line: `TYPE|"space"|"layer"|<common>|<kind>`.
fn entity_line(e: &Entity, space: &str) -> String {
    let mut out = String::with_capacity(192);
    out.push_str(e.kind.dxf_name());
    out.push('|');
    push_quoted(&mut out, space);
    out.push('|');
    push_quoted(&mut out, &e.common.layer);
    out.push('|');
    match serde_json::to_value(&e.common) {
        Ok(v) => write_canonical(&v, 0, &mut out),
        // Unreachable for this crate's types; keeping the line total is what matters.
        Err(_) => out.push('?'),
    }
    out.push('|');
    match serde_json::to_value(&e.kind) {
        Ok(v) => write_canonical(&v, 0, &mut out),
        // Unreachable for this crate's types; keeping the line total is what matters.
        Err(_) => out.push('?'),
    }
    out
}

/// `s` JSON-quoted, so a quote or separator inside a name cannot run two fields together.
fn push_quoted(out: &mut String, s: &str) {
    use std::fmt::Write as _;
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => {
                // Writing to a String cannot fail; the result is discarded.
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// The canonical form of a serialized value: every string quoted, every number through
/// [`format_float`], and handle references left out.
fn write_canonical(v: &Value, depth: usize, out: &mut String) {
    if depth >= MAX_DEPTH {
        out.push('~');
        return;
    }
    match v {
        Value::Null => out.push('n'),
        Value::Bool(true) => out.push('t'),
        Value::Bool(false) => out.push('f'),
        Value::Number(n) => {
            out.push('#');
            match n.as_f64() {
                Some(f) => out.push_str(&format_float(f)),
                None => out.push_str(&n.to_string()),
            }
        }
        Value::String(s) => push_quoted(out, s),
        Value::Array(a) => {
            out.push('[');
            for (i, item) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, depth + 1, out);
            }
            out.push(']');
        }
        Value::Object(o) => {
            out.push('{');
            let mut first = true;
            for (key, item) in o {
                if skip_handle_field(key, item) {
                    continue;
                }
                if !first {
                    out.push(',');
                }
                first = false;
                push_quoted(out, key);
                out.push(':');
                if matches!(key.as_str(), "tags" | "xdata")
                    && let Value::Array(items) = item
                {
                    write_raw_tags(items, depth + 1, out);
                } else {
                    write_canonical(item, depth + 1, out);
                }
            }
            out.push('}');
        }
    }
}

/// The `RawTag` list of an unknown entity's groups or an object's xdata, with handle-valued
/// groups (a 1005 xdata handle, an owner) left out like every other handle.
fn write_raw_tags(items: &[Value], depth: usize, out: &mut String) {
    out.push('[');
    let mut first = true;
    for item in items {
        if item.get("code").and_then(Value::as_i64).is_some_and(is_handle_code) {
            continue;
        }
        if !first {
            out.push(',');
        }
        first = false;
        write_canonical(item, depth, out);
    }
    out.push(']');
}

/// Fields of a serialized entity whose value is a database handle, not content: a dimension's
/// associativity (`handle`, and the `other` of an intersection snap), a hatch loop's source
/// objects (`sources`), and a viewport's clipping entity (`clip` — an `IMAGE`'s `clip` is its
/// clip boundary, geometry, and stays).
fn skip_handle_field(key: &str, value: &Value) -> bool {
    match key {
        "handle" | "sources" => true,
        "other" | "clip" => matches!(value, Value::Number(_)),
        _ => false,
    }
}

/// DXF group codes whose value is a database handle (an object reference), not content: 5 (the
/// object's own handle), 105 (a dimension style's), 320-369 and 390-399 (pointer handles),
/// 480-481 (hard and soft pointers) and 1005 (a handle in xdata).
fn is_handle_code(code: i64) -> bool {
    code == 5 || code == 105 || (320..=369).contains(&code) || (390..=399).contains(&code) || (480..=481).contains(&code) || code == 1005
}

/// `v` as the digest sees it: nine decimal places with trailing zeros (and a bare trailing
/// point) trimmed, so 1e-9 is visible and 1e-12 noise is not. `-0` reads as `0`, and a
/// non-finite value (which `serde_json` has already turned into `null` before it gets here)
/// reads as `nan` — deterministically, never a panic.
fn format_float(v: f64) -> String {
    if !v.is_finite() {
        return "nan".into();
    }
    let mut s = format!("{v:.9}");
    if s.contains('.') {
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
    }
    if s == "-0" {
        s.clear();
        s.push('0');
    }
    s
}

/// 128-bit FNV-1a (RFC 9923): `hash = (hash XOR byte) * prime mod 2^128`, from the standard
/// offset basis. Small, fast and dependency-free; the digest is a content fingerprint for
/// humans and refactor gates, not a security boundary.
struct Fnv128 {
    hash: u128,
}

impl Fnv128 {
    /// The standard 128-bit FNV offset basis (RFC 9923).
    const OFFSET_BASIS: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
    /// The standard 128-bit FNV prime, 2^88 + 2^8 + 0x3B (RFC 9923).
    const PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;

    fn new() -> Self {
        Fnv128 { hash: Self::OFFSET_BASIS }
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.hash ^= u128::from(b);
            self.hash = self.hash.wrapping_mul(Self::PRIME);
        }
    }

    /// The hash as 32 lower-case hex digits.
    fn hex(&self) -> String {
        format!("{:032x}", self.hash)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use cadcraft_geom::Vec3;

    use super::*;
    use crate::{Block, Circle, Common, EntityKind, Handle, Insert, Line};

    fn line_kind(a: (f64, f64), b: (f64, f64)) -> EntityKind {
        EntityKind::Line(Line { a: Vec3::new(a.0, a.1, 0.0), b: Vec3::new(b.0, b.1, 0.0) })
    }

    fn sample() -> Drawing {
        let mut d = Drawing::new_imperial();
        d.add(&Space::Model, Common::default(), line_kind((0.0, 0.0), (10.0, 5.0))).unwrap();
        d.add(&Space::Model, Common::default(), EntityKind::Circle(Circle { center: Vec3::new(20.0, 0.0, 0.0), radius: 2.0 })).unwrap();
        d
    }

    fn line_handle(d: &Drawing) -> Handle {
        d.model.iter().find(|e| matches!(e.kind, EntityKind::Line(_))).map(|e| e.handle).unwrap()
    }

    #[test]
    fn the_same_drawing_hashes_the_same() {
        let a = sample();
        let b = a.clone();
        assert_eq!(drawing_digest(&a), drawing_digest(&b));
        let g = drawing_digest(&a);
        assert_eq!(g.hash.len(), 32);
        assert!(g.hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{}", g.hash);
        assert_eq!(g.entities, 2);
    }

    #[test]
    fn a_nanometre_vertex_move_changes_the_hash() {
        let a = sample();
        let mut b = sample();
        let h = line_handle(&b);
        b.modify_entity(h, |e| {
            if let EntityKind::Line(l) = &mut e.kind {
                l.b.x += 1e-9;
            }
        })
        .unwrap();
        assert_ne!(drawing_digest(&a).hash, drawing_digest(&b).hash);

        // Below the digest's resolution: 1e-12 of noise is the same drawing.
        let mut c = sample();
        c.modify_entity(h, |e| {
            if let EntityKind::Line(l) = &mut e.kind {
                l.b.x += 1e-12;
            }
        })
        .unwrap();
        assert_eq!(drawing_digest(&a).hash, drawing_digest(&c).hash);
    }

    #[test]
    fn entity_order_does_not_matter() {
        let mut a = Drawing::new_imperial();
        a.add(&Space::Model, Common::default(), line_kind((0.0, 0.0), (1.0, 1.0))).unwrap();
        a.add(&Space::Model, Common::default(), line_kind((2.0, 2.0), (3.0, 3.0))).unwrap();

        let mut b = Drawing::new_imperial();
        b.add(&Space::Model, Common::default(), line_kind((2.0, 2.0), (3.0, 3.0))).unwrap();
        b.add(&Space::Model, Common::default(), line_kind((0.0, 0.0), (1.0, 1.0))).unwrap();

        assert_eq!(drawing_digest(&a).hash, drawing_digest(&b).hash);
        let lines = entity_lines(&a);
        assert!(lines.windows(2).all(|w| w[0] <= w[1]), "lines must be sorted");
    }

    #[test]
    fn handles_are_not_part_of_the_digest() {
        let mut a = Drawing::new_imperial();
        a.model.push(crate::Entity { handle: Handle(1), common: Common::default(), kind: line_kind((0.0, 0.0), (1.0, 1.0)) });
        let mut b = Drawing::new_imperial();
        b.model.push(crate::Entity { handle: Handle(0xFFFF), common: Common::default(), kind: line_kind((0.0, 0.0), (1.0, 1.0)) });
        assert_eq!(drawing_digest(&a).hash, drawing_digest(&b).hash);
    }

    #[test]
    fn the_header_and_the_table_order_are_not_part_of_the_digest() {
        let base = sample();
        let mut d = sample();
        d.header.set_str("PROJECTNAME", "renamed");
        d.layers.reverse();
        d.linetypes.reverse();
        d.text_styles.reverse();
        d.layouts.reverse();
        assert_eq!(drawing_digest(&base).hash, drawing_digest(&d).hash);
    }

    #[test]
    fn renaming_a_layer_changes_the_hash() {
        let a = sample();
        let mut b = sample();
        let h = line_handle(&b);
        b.modify_entity(h, |e| e.common.layer = "Walls".into()).unwrap();
        assert_ne!(drawing_digest(&a).hash, drawing_digest(&b).hash);
    }

    #[test]
    fn an_empty_drawing_is_stable() {
        let d = Drawing::default();
        let g = drawing_digest(&d);
        assert!(entity_lines(&d).is_empty());
        assert_eq!(g.entities, 0);
        assert_eq!(g.bounds, None);
        // FNV-1a 128 of no input: the standard offset basis.
        assert_eq!(g.hash, "6c62272e07bb014262b821756295c58d");
        assert_eq!(g, drawing_digest(&d));
        // The header and the tables are not covered, so an empty metric drawing hashes the same.
        assert_eq!(g.hash, drawing_digest(&Drawing::new_metric()).hash);
    }

    #[test]
    fn a_block_reference_and_a_layout_are_covered() {
        let mut d = sample();
        let mut block = Block::new("DOOR");
        block.entities.push(crate::Entity { handle: Handle(0x900), common: Common::default(), kind: line_kind((0.0, 0.0), (0.9, 0.0)) });
        d.blocks.insert("DOOR".into(), Arc::new(block));
        d.add(
            &Space::Model,
            Common::default(),
            EntityKind::Insert(Insert {
                block: "DOOR".into(),
                insert: Vec3::ZERO,
                scale: Vec3::new(1.0, 1.0, 1.0),
                rotation: 0.0,
                attribs: Vec::new(),
                cols: 1,
                rows: 1,
                col_spacing: 0.0,
                row_spacing: 0.0,
            }),
        )
        .unwrap();
        d.layouts[0].entities.push(crate::Entity { handle: Handle(0x901), common: Common::default(), kind: line_kind((0.0, 0.0), (1.0, 0.0)) });

        let lines = entity_lines(&d);
        assert!(lines.iter().any(|l| l.starts_with("INSERT|")), "{lines:?}");
        assert!(lines.iter().any(|l| l.contains("\"Layout1\"")), "{lines:?}");
        assert!(lines.iter().any(|l| l.contains("\"block:DOOR\"")), "{lines:?}");
        assert_eq!(drawing_digest(&d).entities, 5, "2 model + insert + layout + block definition");

        // A change inside the block definition is a different drawing.
        let mut moved = d.clone();
        {
            let arc = moved.blocks.get_mut("DOOR").unwrap();
            let block = Arc::make_mut(arc);
            assert!(block.entities.modify(Handle(0x900), |e| {
                if let EntityKind::Line(l) = &mut e.kind {
                    l.b.x += 1.0;
                }
            }));
        }
        assert_ne!(drawing_digest(&d).hash, drawing_digest(&moved).hash);

        // An anonymous block is generated geometry named after the file: not covered.
        let mut with_anon = d.clone();
        let mut anon = Block::new("*D1");
        anon.entities.push(crate::Entity { handle: Handle(0x910), common: Common::default(), kind: line_kind((0.0, 0.0), (5.0, 5.0)) });
        with_anon.blocks.insert("*D1".into(), Arc::new(anon));
        assert_eq!(drawing_digest(&with_anon).hash, drawing_digest(&d).hash);
    }

    #[test]
    fn hostile_coordinates_do_not_panic() {
        // `serde_json` serializes a non-finite float as null, so NaN and INF coordinates become
        // one deterministic token ("n") instead of panicking or poisoning the hash; the bounds
        // report is `None` whenever the result would not be finite.
        let mut d = Drawing::new_imperial();
        d.add(&Space::Model, Common::default(), line_kind((0.0, 0.0), (f64::NAN, 0.0))).unwrap();
        d.add(
            &Space::Model,
            Common::default(),
            EntityKind::Circle(Circle { center: Vec3::new(f64::INFINITY, f64::NEG_INFINITY, 0.0), radius: f64::NAN }),
        )
        .unwrap();
        let a = drawing_digest(&d);
        assert_eq!(a, drawing_digest(&d));
        assert_eq!(a.entities, 2);
        assert_eq!(a.hash.len(), 32);
        assert!(a.bounds.is_none_or(|b| b.iter().all(|v| v.is_finite())));
    }

    #[test]
    fn float_format_vectors() {
        assert_eq!(format_float(1.0), "1");
        assert_eq!(format_float(-0.0), "0");
        assert_eq!(format_float(0.5), "0.5");
        assert_eq!(format_float(-3.125), "-3.125");
        assert_eq!(format_float(0.1), "0.1");
        assert_eq!(format_float(1e20), "100000000000000000000");
        assert_eq!(format_float(1e-9), "0.000000001");
        assert_eq!(format_float(1e-12), "0");
        assert_eq!(format_float(f64::NAN), "nan");
        assert_eq!(format_float(f64::INFINITY), "nan");
    }

    #[test]
    fn fnv128_matches_the_rfc_vectors() {
        let mut h = Fnv128::new();
        assert_eq!(h.hex(), "6c62272e07bb014262b821756295c58d");
        h.write(b"a");
        assert_eq!(h.hex(), "d228cb696f1a8caf78912b704e4a8964");
        let mut h = Fnv128::new();
        h.write(b"foobar");
        assert_eq!(h.hex(), "343e1662793c64bf6f0d3597ba446f18");
    }
}
