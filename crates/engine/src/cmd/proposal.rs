//! Proposals: a change to the drawing shown before it is made.
//!
//! `propose` runs a list of commands on the drawing, reads what they came to (the piece's
//! parameters, its metal and stones, its checks, its cost, the objects added, removed and changed),
//! and then puts the drawing back exactly as it was. What it returns is the difference, and the
//! proposal waits: `accept` makes the change as one undo step, `reject` forgets it, `proposals`
//! lists what is waiting and can read either side of one (its bench sheet before and after, say).
//!
//! It is how an assistant's change is reviewed instead of merely undone: nothing touches the
//! drawing until it is accepted, and what is accepted is exactly the drawing that was read (the
//! result is kept, not recomputed). A proposal is for the drawing it was made on: once that
//! drawing changes, the proposal is stale and `accept` says so.
//!
//! Only commands that record undo may be steps: what a step does must be something the drawing
//! holds, so that putting the drawing back undoes all of it.

use std::sync::Arc;

use cadcraft_doc::{Drawing, Entity, Handle};
use serde_json::{Map, Value, json};

use super::CommandSpec;
use super::{bad, find_command};
use crate::{EngineError, Result, Session, Snapshot};

/// A proposal has at most this many steps, a `propose` this many variants, and a session this
/// many proposals waiting (the oldest give way).
pub const MAX_STEPS: usize = 64;
pub const MAX_VARIANTS: usize = 8;
pub const MAX_PENDING: usize = 16;
const MAX_TITLE: usize = 120;

/// Commands that may not be a step though they record undo: the proposal commands themselves, and
/// the undo stack's own.
const NOT_A_STEP: &[&str] = &["propose", "accept", "reject", "proposals", "undo", "redo", "u", "mredo", "undoto"];

/// What `proposals {run}` may run on one side of a proposal: commands that only read.
const READS: &[&str] = &["piece", "techsheet", "gemlist", "objects", "ringsizes"];

/// One command of a proposal.
#[derive(Clone, Debug, PartialEq)]
pub struct Step {
    pub command: String,
    pub params: Value,
}

/// A change that waits to be accepted.
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    /// The `propose` it came from: accepting one variant drops its siblings.
    pub group: u64,
    pub title: String,
    pub steps: Vec<Step>,
    /// The drawing it is for.
    uid: u64,
    base: Arc<Drawing>,
    after: Arc<Drawing>,
    selection_after: Vec<Handle>,
    /// What `propose` returned for it.
    pub report: Value,
}

/// The proposals of a session.
#[derive(Clone, Debug, Default)]
pub struct Pending {
    next: u64,
    list: Vec<Proposal>,
}

impl Pending {
    pub fn len(&self) -> usize {
        self.list.len()
    }
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }
    fn take_id(&mut self) -> u64 {
        self.next = self.next.saturating_add(1);
        self.next
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("propose", "Propose a Change", run_propose)
            .params(concat!(
                "{steps: [{command, params?}], title?} | {variants: [{title?, steps}]} → {proposals: [{id, group, title, steps, ",
                "before, after, changes: [{key, label, before, after, delta?, unit?}], checks: {fixed, broken, failing}, ",
                "objects: {before, after, added, removed, modified}, message}], message}. Runs the steps, reads what they come to and ",
                "puts the drawing back: nothing changes until `accept`. A step must be a command that records undo. ",
                "At most 64 steps, 8 variants; a step that fails fails the proposal and names the step"
            ))
            .noundo(),
        CommandSpec::new("accept", "Accept Proposal", run_accept)
            .params(concat!(
                "{id} → {accepted: id, title, message}. Makes the proposed change as one undo step; the other variants of the same ",
                "`propose` are dropped. Refused when the drawing changed since it was proposed"
            ))
            .noundo(),
        CommandSpec::new("reject", "Reject Proposal", run_reject)
            .params("{id?} → {rejected: [id], message}. Forgets one proposal, or every one waiting when no id is given. The drawing is not touched")
            .noundo(),
        CommandSpec::new("proposals", "Proposals", run_proposals)
            .params(concat!(
                "{} → {proposals: [report + {stale}]} | {id, of: \"before\"|\"after\", run: {command, params?}} → {result}. ",
                "`run` reads one side of a proposal with piece (as a query), techsheet, gemlist, objects or ringsizes. The solid of either side ",
                "is PIECEMESH of that side's `piece.params`, which reads no drawing"
            ))
            .noundo(),
    ]
}

// ---------------------------------------------------------------------------------------------
// Running steps and putting the drawing back
// ---------------------------------------------------------------------------------------------

/// Everything a step can change, as it was.
struct Held {
    uid: u64,
    active: usize,
    doc: Arc<Drawing>,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    undo_ctl: crate::undoctl::UndoCtl,
    selection: Vec<Handle>,
    previous_selection: Vec<Handle>,
    revision: u64,
    space: crate::Space,
    mspace: Option<Handle>,
    log: usize,
    last_command: Option<String>,
    last_point: cadcraft_geom::Vec2,
}

fn hold(s: &Session) -> Result<Held> {
    let st = s.state()?;
    Ok(Held {
        uid: st.uid,
        active: s.active,
        doc: st.doc.clone(),
        undo: st.undo.clone(),
        redo: st.redo.clone(),
        undo_ctl: st.undo_ctl.clone(),
        selection: st.selection.clone(),
        previous_selection: st.previous_selection.clone(),
        revision: st.revision,
        space: st.space.clone(),
        mspace: st.mspace,
        log: s.log.len(),
        last_command: s.last_command.clone(),
        last_point: s.last_point,
    })
}

/// Put back what [`hold`] took. The drawing is found by its id, so a step that opened or switched
/// drawings does not leave the wrong one changed.
fn put_back(s: &mut Session, held: &Held) {
    if let Some(at) = s.docs.iter().position(|d| d.uid == held.uid) {
        s.active = at;
    } else if held.active < s.docs.len() {
        s.active = held.active;
    }
    if let Some(st) = s.docs.iter_mut().find(|d| d.uid == held.uid) {
        st.doc = held.doc.clone();
        st.undo = held.undo.clone();
        st.redo = held.redo.clone();
        st.undo_ctl = held.undo_ctl.clone();
        st.selection = held.selection.clone();
        st.previous_selection = held.previous_selection.clone();
        st.revision = held.revision;
        st.space = held.space.clone();
        st.mspace = held.mspace;
    }
    s.log.truncate(held.log);
    s.last_command = held.last_command.clone();
    s.last_point = held.last_point;
}

/// The steps of one variant, checked: each a known command that records undo.
fn parse_steps(v: Option<&Value>) -> Result<Vec<Step>> {
    let Some(list) = v.and_then(Value::as_array) else {
        return Err(bad("propose", "`steps` must be a list of {command, params}"));
    };
    if list.is_empty() {
        return Err(bad("propose", "a proposal needs at least one step"));
    }
    if list.len() > MAX_STEPS {
        return Err(bad("propose", format!("{} steps: a proposal has at most {MAX_STEPS}", list.len())));
    }
    let mut steps = Vec::with_capacity(list.len());
    for (at, item) in list.iter().enumerate() {
        let n = at + 1;
        let Some(command) = item.get("command").and_then(Value::as_str) else {
            return Err(bad("propose", format!("step {n}: `command` must be a command's name")));
        };
        let id = super::resolve_alias(&command.trim().to_ascii_lowercase());
        let Some(spec) = find_command(&id) else {
            return Err(bad("propose", format!("step {n}: unknown command `{command}`")));
        };
        if NOT_A_STEP.contains(&spec.id) {
            return Err(bad("propose", format!("step {n}: `{}` cannot be proposed", spec.id)));
        }
        if !spec.undoable {
            return Err(bad(
                "propose",
                format!("step {n}: `{}` records no undo, so it cannot be put back; a proposal is made of commands that change the drawing", spec.id),
            ));
        }
        let params = match item.get("params") {
            None | Some(Value::Null) => json!({}),
            Some(p @ Value::Object(_)) => p.clone(),
            Some(_) => return Err(bad("propose", format!("step {n}: `params` must be an object"))),
        };
        steps.push(Step { command: spec.id.to_string(), params });
    }
    Ok(steps)
}

fn title_of(v: Option<&Value>, steps: &[Step]) -> String {
    let given = v.and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty());
    let text = match given {
        Some(t) => t.to_string(),
        None => {
            let mut names: Vec<&str> = Vec::new();
            for step in steps {
                if !names.contains(&step.command.as_str()) {
                    names.push(&step.command);
                }
            }
            names.join(", ")
        }
    };
    text.chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect()
}

// ---------------------------------------------------------------------------------------------
// What a drawing comes to
// ---------------------------------------------------------------------------------------------

/// The figures of the drawing as it stands: the parametric piece (when there is one) and the
/// bench sheet. Each is the engine's own reply; a drawing without one has `null` there.
fn facts(s: &mut Session) -> Value {
    let piece = s.execute("piece", &json!({"query": true})).ok().and_then(|r| r.get("piece").cloned()).filter(|p| !p.is_null());
    let sheet = s.execute("techsheet", &json!({"cost": true})).ok();
    let stones = sheet.as_ref().and_then(|r| r.get("stones")).map(|st| json!({"count": st.get("count"), "carat": st.get("carat")}));
    let grams: Option<f64> = sheet
        .as_ref()
        .and_then(|r| r.get("bands"))
        .and_then(Value::as_array)
        .map(|bands| bands.iter().filter_map(|b| b.get("grams").and_then(Value::as_f64)).filter(|g| g.is_finite()).sum());
    let cost = sheet.as_ref().and_then(|r| r.get("cost")).filter(|c| c.is_object()).map(|c| {
        json!({"total": c.get("total"), "metal": c.get("metal"), "stones": c.get("stones"), "currency": c.get("currency"), "unpriced": c.get("unpriced")})
    });
    json!({
        "piece": piece,
        "stones": stones,
        "grams": grams.filter(|g| g.is_finite() && *g > 0.0).map(round2),
        "cost": cost,
    })
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// One line of the difference.
fn change(key: &str, label: &str, before: &Value, after: &Value, unit: Option<&str>) -> Option<Value> {
    if before == after {
        return None;
    }
    let mut row = Map::new();
    row.insert("key".into(), json!(key));
    row.insert("label".into(), json!(label));
    row.insert("before".into(), before.clone());
    row.insert("after".into(), after.clone());
    if let (Some(a), Some(b)) = (before.as_f64(), after.as_f64())
        && a.is_finite()
        && b.is_finite()
    {
        // Shown to the hundredth, like the figures it is the difference of.
        row.insert("delta".into(), json!(((b - a) * 1000.0).round() / 1000.0));
    }
    if let Some(unit) = unit {
        row.insert("unit".into(), json!(unit));
    }
    Some(Value::Object(row))
}

/// The piece's parameters a card names, with the words it uses for them.
const PARAMS: &[(&str, &str, Option<&str>)] = &[
    ("kind", "Kind", None),
    ("sizeText", "Size", None),
    ("sizeSystem", "Size system", None),
    ("width", "Width", Some("mm")),
    ("wall", "Wall", Some("mm")),
    ("profile", "Profile", None),
    ("metal", "Metal", None),
    ("cut", "Cut", None),
    ("stone", "Stone", None),
    ("stoneLength", "Stone length", Some("mm")),
    ("stoneWidth", "Stone width", Some("mm")),
    ("prongs", "Prongs", None),
    ("halo", "Halo", None),
    ("melee", "Melee", Some("mm")),
    ("gap", "Gap", Some("mm")),
    ("count", "Stones in the row", None),
    ("sideCut", "Side cut", None),
    ("sideLength", "Side stone length", Some("mm")),
    ("sideWidth", "Side stone width", Some("mm")),
    ("sideProngs", "Side prongs", None),
    ("head", "Head", None),
    ("bezelWall", "Bezel wall", Some("mm")),
    ("bezelHeight", "Bezel height", Some("mm")),
    ("prongStyle", "Prong style", None),
    ("prongHeight", "Prong height", Some("mm")),
    ("prongTip", "Prong tip", Some("mm")),
    ("prongWire", "Prong wire", Some("mm")),
    ("channelWall", "Channel wall", Some("mm")),
    ("channelLip", "Channel lip", Some("mm")),
    ("topWidth", "Top width", Some("mm")),
    ("topWall", "Top wall", Some("mm")),
    ("face", "Face", None),
    ("faceLength", "Face length", Some("mm")),
    ("faceWidth", "Face width", Some("mm")),
];

/// Pavé's parameters a card names.
const PAVE_PARAMS: &[(&str, &str, Option<&str>)] = &[
    ("layout", "Pavé layout", None),
    ("rows", "Pavé rows", None),
    ("melee", "Pavé stone size", Some("mm")),
    ("gap", "Pavé gap", Some("mm")),
    ("span", "Pavé span", None),
    ("from", "Pavé from", Some("°")),
    ("to", "Pavé to", Some("°")),
];

fn at<'a>(v: &'a Value, path: &[&str]) -> &'a Value {
    let mut cur = v;
    for key in path {
        match cur.get(key) {
            Some(next) => cur = next,
            None => return &Value::Null,
        }
    }
    cur
}

fn changes(before: &Value, after: &Value) -> Vec<Value> {
    let mut rows = Vec::new();
    for (key, label, unit) in PARAMS {
        rows.extend(change(&format!("piece.{key}"), label, at(before, &["piece", "params", key]), at(after, &["piece", "params", key]), *unit));
    }
    // Pavé is an object: each of its numbers is a line of its own (nothing before or after reads
    // as no pavé).
    for (key, label, unit) in PAVE_PARAMS {
        let path = |v: &'static str| ["piece", "params", "pave", v];
        rows.extend(change(&format!("piece.pave.{key}"), label, at(before, &path(key)), at(after, &path(key)), *unit));
    }
    rows.extend(change(
        "piece.stones.pave.count",
        "Pavé stones",
        at(before, &["piece", "stones", "pave", "count"]),
        at(after, &["piece", "stones", "pave", "count"]),
        Some("pc"),
    ));
    rows.extend(change("grams", "Metal weight", at(before, &["grams"]), at(after, &["grams"]), Some("g")));
    rows.extend(change("stones.count", "Stones", at(before, &["stones", "count"]), at(after, &["stones", "count"]), Some("pc")));
    rows.extend(change("stones.carat", "Stone weight", at(before, &["stones", "carat"]), at(after, &["stones", "carat"]), Some("ct")));
    let currency = at(after, &["cost", "currency"]).as_str().or_else(|| at(before, &["cost", "currency"]).as_str());
    rows.extend(change("cost.total", "Estimate", at(before, &["cost", "total"]), at(after, &["cost", "total"]), currency));
    rows
}

/// The checks that turned: those the change makes pass, those it makes fail, and those failing after.
fn checks(before: &Value, after: &Value) -> Value {
    let list = |v: &Value| -> Vec<(String, bool, String)> {
        at(v, &["piece", "checks"])
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(|c| {
                        Some((
                            c.get("id")?.as_str()?.to_string(),
                            c.get("ok")?.as_bool()?,
                            c.get("message").and_then(Value::as_str).unwrap_or_default().to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let (was, now) = (list(before), list(after));
    let ok_before = |id: &str| was.iter().find(|c| c.0 == id).map(|c| c.1);
    let row = |c: &(String, bool, String)| json!({"id": c.0, "message": c.2});
    let fixed: Vec<Value> = now.iter().filter(|c| c.1 && ok_before(&c.0) == Some(false)).map(row).collect();
    let broken: Vec<Value> = now.iter().filter(|c| !c.1 && ok_before(&c.0) != Some(false)).map(row).collect();
    let failing: Vec<Value> = now.iter().filter(|c| !c.1).map(row).collect();
    json!({"fixed": fixed, "broken": broken, "failing": failing})
}

/// Every object of a drawing: model space and each layout.
fn objects(doc: &Drawing) -> impl Iterator<Item = &Arc<Entity>> + '_ {
    doc.model.iter().chain(doc.layouts.iter().flat_map(|l| l.entities.iter()))
}

fn object_changes(before: &Drawing, after: &Drawing) -> Value {
    let was: std::collections::HashMap<Handle, &Arc<Entity>> = objects(before).map(|e| (e.handle, e)).collect();
    let (mut added, mut modified, mut seen) = (0usize, 0usize, 0usize);
    let mut count = 0usize;
    for e in objects(after) {
        count += 1;
        match was.get(&e.handle) {
            None => added += 1,
            Some(old) => {
                seen += 1;
                if !Arc::ptr_eq(old, e) && ***old != **e {
                    modified += 1;
                }
            }
        }
    }
    json!({"before": was.len(), "after": count, "added": added, "removed": was.len().saturating_sub(seen), "modified": modified})
}

fn sentence(title: &str, rows: &[Value], checks: &Value, objects: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    for row in rows.iter().take(4) {
        let label = row.get("label").and_then(Value::as_str).unwrap_or_default();
        let show = |v: &Value| match v {
            Value::Null => "none".to_string(),
            Value::String(t) => t.clone(),
            other => other.to_string(),
        };
        let unit = row.get("unit").and_then(Value::as_str).map(|u| format!(" {u}")).unwrap_or_default();
        parts.push(format!("{label} {} → {}{unit}", show(row.get("before").unwrap_or(&Value::Null)), show(row.get("after").unwrap_or(&Value::Null))));
    }
    if rows.len() > 4 {
        parts.push(format!("{} more", rows.len() - 4));
    }
    if parts.is_empty() {
        let n = |k: &str| objects.get(k).and_then(Value::as_u64).unwrap_or(0);
        parts.push(format!("{} added, {} removed, {} changed", n("added"), n("removed"), n("modified")));
    }
    let count = |k: &str| checks.get(k).and_then(Value::as_array).map_or(0, Vec::len);
    if count("broken") > 0 {
        parts.push(format!("{} check(s) would fail", count("broken")));
    }
    if count("fixed") > 0 {
        parts.push(format!("{} check(s) would pass", count("fixed")));
    }
    format!("{title}: {}", parts.join("; "))
}

/// Run one variant's steps, read what they come to, and put the drawing back whatever happened.
fn try_variant(s: &mut Session, steps: &[Step], title: &str) -> Result<(Arc<Drawing>, Vec<Handle>, Value)> {
    let held = hold(s)?;
    let outcome = (|| -> Result<(Arc<Drawing>, Vec<Handle>, Value)> {
        let before = facts(s);
        // Reading the figures must leave the drawing alone; put it back to be sure of the base.
        put_back(s, &held);
        for (at, step) in steps.iter().enumerate() {
            s.execute(&step.command, &step.params).map_err(|e| EngineError::Other(format!("step {} (`{}`) failed: {e}", at + 1, step.command)))?;
            if s.state().ok().map(|st| st.uid) != Some(held.uid) {
                return Err(EngineError::Other(format!("step {} (`{}`) left the drawing: a proposal is for one drawing", at + 1, step.command)));
            }
        }
        let (after_doc, selection) = {
            let st = s.state()?;
            (st.doc.clone(), st.selection.clone())
        };
        let after = facts(s);
        let rows = changes(&before, &after);
        let turned = checks(&before, &after);
        let objs = object_changes(&held.doc, &after_doc);
        let message = sentence(title, &rows, &turned, &objs);
        let report = json!({
            "title": title,
            "steps": steps.iter().map(|st| json!({"command": st.command, "params": st.params})).collect::<Vec<_>>(),
            "before": before,
            "after": after,
            "changes": rows,
            "checks": turned,
            "objects": objs,
            "unchanged": Arc::ptr_eq(&held.doc, &after_doc) || *held.doc == *after_doc,
            "message": message,
        });
        Ok((after_doc, selection, report))
    })();
    put_back(s, &held);
    outcome
}

// ---------------------------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------------------------

fn run_propose(s: &mut Session, p: &Value) -> Result<Value> {
    if s.state()?.block_edit.is_some() {
        return Err(EngineError::Other("a proposal cannot be made in the Block Editor".into()));
    }
    let variants: Vec<(String, Vec<Step>)> = match p.get("variants") {
        Some(Value::Array(list)) => {
            if list.is_empty() {
                return Err(bad("propose", "`variants` is empty"));
            }
            if list.len() > MAX_VARIANTS {
                return Err(bad("propose", format!("{} variants: at most {MAX_VARIANTS}", list.len())));
            }
            let mut out = Vec::with_capacity(list.len());
            for (at, v) in list.iter().enumerate() {
                let steps = parse_steps(v.get("steps")).map_err(|e| EngineError::Other(format!("variant {}: {e}", at + 1)))?;
                let title = match v.get("title").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()) {
                    Some(_) => title_of(v.get("title"), &steps),
                    None => format!("Option {}", at + 1),
                };
                out.push((title, steps));
            }
            out
        }
        Some(_) => return Err(bad("propose", "`variants` must be a list of {title?, steps}")),
        None => {
            let steps = parse_steps(p.get("steps"))?;
            vec![(title_of(p.get("title"), &steps), steps)]
        }
    };
    let uid = s.state()?.uid;
    let base = s.state()?.doc.clone();
    // Every variant is read before any is kept: one that fails fails the whole proposal.
    let mut read = Vec::with_capacity(variants.len());
    for (title, steps) in variants {
        let (after, selection_after, report) = try_variant(s, &steps, &title)?;
        read.push((title, steps, after, selection_after, report));
    }
    let group = s.proposals.take_id();
    let mut reports = Vec::with_capacity(read.len());
    for (title, steps, after, selection_after, mut report) in read {
        let id = s.proposals.take_id();
        if let Some(map) = report.as_object_mut() {
            map.insert("id".into(), json!(id));
            map.insert("group".into(), json!(group));
        }
        reports.push(report.clone());
        s.proposals.list.push(Proposal { id, group, title, steps, uid, base: base.clone(), after, selection_after, report });
    }
    let extra = s.proposals.list.len().saturating_sub(MAX_PENDING);
    if extra > 0 {
        s.proposals.list.drain(..extra);
    }
    let message = match reports.as_slice() {
        [one] => one.get("message").and_then(Value::as_str).unwrap_or_default().to_string(),
        many => format!("{} options proposed; accept one by its id", many.len()),
    };
    Ok(json!({"proposals": reports, "message": message}))
}

fn id_of(cmd: &str, p: &Value) -> Result<u64> {
    p.get("id").and_then(Value::as_u64).ok_or_else(|| bad(cmd, "`id` must be a proposal's number"))
}

fn run_accept(s: &mut Session, p: &Value) -> Result<Value> {
    let id = id_of("accept", p)?;
    let Some(found) = s.proposals.list.iter().find(|x| x.id == id).cloned() else {
        return Err(EngineError::Other(format!("there is no proposal {id} waiting")));
    };
    let st = s.state_mut()?;
    if st.block_edit.is_some() {
        return Err(EngineError::Other("a proposal cannot be accepted in the Block Editor".into()));
    }
    if st.uid != found.uid {
        return Err(EngineError::Other(format!("proposal {id} is for another drawing")));
    }
    if !Arc::ptr_eq(&st.doc, &found.base) && *st.doc != *found.base {
        return Err(EngineError::Other(format!("the drawing changed since proposal {id} was made; propose it again")));
    }
    if !Arc::ptr_eq(&st.doc, &found.after) {
        let selection = std::mem::replace(&mut st.selection, found.selection_after.clone());
        let before = std::mem::replace(&mut st.doc, found.after.clone());
        st.push_undo(Snapshot { label: format!("Proposal: {}", found.title), doc: before, selection });
        st.revision += 1;
    }
    // The change is made: the other options of the same `propose` no longer apply.
    s.proposals.list.retain(|x| x.group != found.group);
    Ok(json!({"accepted": id, "title": found.title, "message": format!("Accepted: {}", found.title)}))
}

fn run_reject(s: &mut Session, p: &Value) -> Result<Value> {
    let rejected: Vec<u64> = match p.get("id") {
        None | Some(Value::Null) => s.proposals.list.drain(..).map(|x| x.id).collect(),
        Some(_) => {
            let id = id_of("reject", p)?;
            let Some(at) = s.proposals.list.iter().position(|x| x.id == id) else {
                return Err(EngineError::Other(format!("there is no proposal {id} waiting")));
            };
            s.proposals.list.remove(at);
            vec![id]
        }
    };
    let message = match rejected.len() {
        0 => "No proposal was waiting".to_string(),
        1 => "Rejected the proposal; the drawing is as it was".to_string(),
        n => format!("Rejected {n} proposals; the drawing is as it was"),
    };
    Ok(json!({"rejected": rejected, "message": message}))
}

fn run_proposals(s: &mut Session, p: &Value) -> Result<Value> {
    if let Some(run) = p.get("run") {
        return read_side(s, p, run);
    }
    let current = s.state().ok().map(|st| (st.uid, st.doc.clone()));
    let list: Vec<Value> = s
        .proposals
        .list
        .iter()
        .map(|x| {
            let mut report = x.report.clone();
            let stale = !current.as_ref().is_some_and(|(uid, doc)| *uid == x.uid && (Arc::ptr_eq(doc, &x.base) || **doc == *x.base));
            if let Some(map) = report.as_object_mut() {
                map.insert("stale".into(), json!(stale));
            }
            report
        })
        .collect();
    let message = match list.len() {
        0 => "No proposal is waiting".to_string(),
        1 => "1 proposal is waiting".to_string(),
        n => format!("{n} proposals are waiting"),
    };
    Ok(json!({"proposals": list, "message": message}))
}

/// Run a reading command on the drawing as a proposal found it, or as it would leave it.
fn read_side(s: &mut Session, p: &Value, run: &Value) -> Result<Value> {
    let id = id_of("proposals", p)?;
    let Some(found) = s.proposals.list.iter().find(|x| x.id == id).cloned() else {
        return Err(EngineError::Other(format!("there is no proposal {id} waiting")));
    };
    let side = match p.get("of").and_then(Value::as_str) {
        Some("before") => found.base.clone(),
        Some("after") | None => found.after.clone(),
        Some(other) => return Err(bad("proposals", format!("`of` is \"before\" or \"after\", not \"{other}\""))),
    };
    let Some(command) = run.get("command").and_then(Value::as_str) else {
        return Err(bad("proposals", "`run` must be {command, params?}"));
    };
    let command = command.trim().to_ascii_lowercase();
    if !READS.contains(&command.as_str()) {
        return Err(bad("proposals", format!("`{command}` cannot be run on a proposal; one of {}", READS.join(", "))));
    }
    let mut params = match run.get("params") {
        None | Some(Value::Null) => json!({}),
        Some(v @ Value::Object(_)) => v.clone(),
        Some(_) => return Err(bad("proposals", "`run.params` must be an object")),
    };
    if command == "piece" {
        // Only ever a question here: with other parameters PIECE would build.
        params = json!({"query": true});
    }
    if s.state()?.uid != found.uid {
        return Err(EngineError::Other(format!("proposal {id} is for another drawing")));
    }
    let held = hold(s)?;
    if let Some(st) = s.docs.iter_mut().find(|d| d.uid == held.uid) {
        st.doc = side;
        st.selection.clear();
    }
    let result = s.execute(&command, &params);
    put_back(s, &held);
    Ok(json!({"id": id, "of": if p.get("of").and_then(Value::as_str) == Some("before") { "before" } else { "after" }, "result": result?}))
}
