//! OBJECTS: what one space of the drawing holds, as a short list an interface can show as a tree
//! — each object's handle, kind and layer, and the one fact that tells it from its neighbours (a
//! block reference's block, a text's first words, a circle's diameter, a line's length), plus the
//! groups it belongs to.
//!
//! Read-only: nothing here changes the drawing, the selection or the undo list. The reply is
//! bounded whatever the drawing holds: at most `MAX_LIMIT` objects, every string clipped, no
//! geometry. `total` is how many objects the space holds, so a caller that got fewer can say so.

use std::collections::{HashMap, HashSet};

use cadcraft_doc::{Entity, EntityKind, Handle, Space};
use serde_json::{Map, Value, json};

use super::super::*;
use super::fmt_d;
use crate::{Result, Session};

const CMD: &str = "objects";
/// Objects listed when `limit` is not given.
const DEFAULT_LIMIT: usize = 2_000;
/// The most objects one reply lists, whatever `limit` asks for.
const MAX_LIMIT: usize = 5_000;
/// Characters of a kind, a layer, a block or a group name that are reported.
const MAX_KIND_CHARS: usize = 32;
const MAX_LAYER_CHARS: usize = 128;
const MAX_NAME_CHARS: usize = 64;
/// Characters of a text's content that are reported.
const MAX_TEXT_CHARS: usize = 80;
/// Characters of a text read before its formatting is removed: a preview never needs more, and a
/// megabyte of MTEXT is not worth unpicking for eighty characters.
const MAX_TEXT_READ: usize = 1_024;
/// Groups named per object.
const MAX_GROUPS_PER_OBJECT: usize = 8;

pub(super) const PARAMS: &str = "{limit?: n (default 2000, at most 5000), space?: current (default)|model|<layout>} → \
    {objects: [{handle, kind (the DXF type in lower case: line, lwpolyline, circle, insert, text, dimension…), layer, \
    name? (an insert's block, at most 64 characters), text? (the first 80 characters of a TEXT or MTEXT, formatting and \
    control characters removed), size? (in the drawing's units as LUNITS/LUPREC write them: a line's length, a circle's \
    diameter, an arc's radius), group?: [the groups it belongs to, at most 8]}], total (objects in the space), \
    truncated: bool, space}. Read-only: the drawing and the selection are not changed";

/// The space asked for: the one on screen unless `space` names another.
fn space_param(s: &Session, p: &Value) -> Result<Space> {
    let given = match p.get("space") {
        None | Some(Value::Null) => return Ok(s.space()),
        Some(Value::String(t)) => t.trim().to_string(),
        Some(v) => return Err(bad(CMD, format!("`space` must be current, model or a layout name, got {}", clip(&v.to_string(), MAX_NAME_CHARS)))),
    };
    match given.to_ascii_lowercase().as_str() {
        "" | "current" => Ok(s.space()),
        "model" => Ok(Space::Model),
        _ => {
            let d = s.doc()?;
            let layout = d
                .layouts
                .iter()
                .find(|l| l.name.eq_ignore_ascii_case(&given))
                .ok_or_else(|| bad(CMD, format!("no layout named \"{}\"", clip(&given, MAX_NAME_CHARS))))?;
            Ok(Space::Paper(layout.name.clone()))
        }
    }
}

/// How many objects to list: a whole number, 0 or more, held to `MAX_LIMIT`.
fn limit_param(p: &Value) -> Result<usize> {
    match p.get("limit") {
        None | Some(Value::Null) => Ok(DEFAULT_LIMIT),
        Some(v) => match v.as_u64() {
            Some(n) => Ok(usize::try_from(n).unwrap_or(MAX_LIMIT).min(MAX_LIMIT)),
            None => Err(bad(CMD, format!("`limit` must be a whole number from 0 to {MAX_LIMIT}"))),
        },
    }
}

/// The first `max` characters of `text` with control characters taken out, runs of white space
/// (a tab and a line break included) closed up to one space and the ends trimmed: one line that
/// is safe to show.
fn clip(text: &str, max: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    let mut gap = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            gap = !out.is_empty();
            continue;
        }
        if ch.is_control() {
            continue;
        }
        // A gap before this character costs one more place.
        let need = if gap { 2 } else { 1 };
        if count.saturating_add(need) > max {
            break;
        }
        if gap {
            out.push(' ');
            gap = false;
        }
        out.push(ch);
        count = count.saturating_add(need);
    }
    out
}

/// A text's content as a preview: at most `MAX_TEXT_READ` characters are read at all.
fn preview(raw: &str, formatted: bool) -> String {
    let head: String = raw.chars().take(MAX_TEXT_READ).collect();
    if formatted { clip(&cadcraft_fonts::plain_mtext(&head), MAX_TEXT_CHARS) } else { clip(&head, MAX_TEXT_CHARS) }
}

/// The one cheap, honest measurement of an object, when it has one.
fn size_of(kind: &EntityKind) -> Option<f64> {
    let v = match kind {
        EntityKind::Line(l) => (l.a - l.b).len(),
        EntityKind::Circle(c) => c.radius * 2.0,
        EntityKind::Arc(a) => a.radius,
        _ => return None,
    };
    (v.is_finite() && v >= 0.0).then_some(v)
}

/// One object's row.
fn row(s: &Session, e: &Entity, groups: Option<&Vec<&str>>) -> Value {
    let mut o = Map::new();
    o.insert("handle".into(), json!(e.handle.hex()));
    o.insert("kind".into(), json!(clip(&e.kind.dxf_name().to_ascii_lowercase(), MAX_KIND_CHARS)));
    o.insert("layer".into(), json!(clip(&e.common.layer, MAX_LAYER_CHARS)));
    match &e.kind {
        EntityKind::Insert(i) => {
            o.insert("name".into(), json!(clip(&i.block, MAX_NAME_CHARS)));
        }
        EntityKind::Text(t) => {
            o.insert("text".into(), json!(preview(&t.value, false)));
        }
        EntityKind::MText(t) => {
            o.insert("text".into(), json!(preview(&t.contents, true)));
        }
        _ => {}
    }
    if let Some(v) = size_of(&e.kind) {
        o.insert("size".into(), json!(fmt_d(s, v)));
    }
    if let Some(names) = groups.filter(|g| !g.is_empty()) {
        o.insert("group".into(), json!(names.iter().map(|n| clip(n, MAX_NAME_CHARS)).collect::<Vec<_>>()));
    }
    Value::Object(o)
}

pub(super) fn run(s: &mut Session, p: &Value) -> Result<Value> {
    let limit = limit_param(p)?;
    let space = space_param(s, p)?;
    let d = s.doc()?;
    let Some(store) = d.space(&space) else {
        return Ok(json!({ "objects": [], "total": 0, "truncated": false, "space": space.tab_name() }));
    };
    let total = store.len();
    let listed: Vec<&Entity> = store.iter().take(limit).map(|e| e.as_ref()).collect();
    // Group membership of the listed objects only: the map never outgrows the reply.
    let wanted: HashSet<Handle> = listed.iter().map(|e| e.handle).collect();
    let mut groups: HashMap<Handle, Vec<&str>> = HashMap::new();
    for g in &d.groups {
        for h in g.members.iter().filter(|h| wanted.contains(h)) {
            let names = groups.entry(*h).or_default();
            if names.len() < MAX_GROUPS_PER_OBJECT && !names.contains(&g.name.as_str()) {
                names.push(g.name.as_str());
            }
        }
    }
    let objects: Vec<Value> = listed.iter().map(|e| row(s, e, groups.get(&e.handle))).collect();
    Ok(json!({ "objects": objects, "total": total, "truncated": total > listed.len(), "space": space.tab_name() }))
}

#[cfg(test)]
#[path = "objects_tests.rs"]
mod tests;
