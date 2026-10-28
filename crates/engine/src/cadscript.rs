//! CadScript: the drawing as a readable text document, and the runner that rebuilds it.
//!
//! [`to_script`] writes a drawing as lines a reader (or a model) can edit: a header naming the
//! unit, a `LAYER` directive whenever the layer changes, and one line per entity. [`run`] reads
//! that text back: it evaluates the variables first (whole file), then runs every other line
//! through the app's own script runner ([`Session::script`]) one line at a time, so an error names
//! its line and everything before it stays.
//!
//! The language (v1)
//! -----------------
//! ```text
//! ; a comment (a line whose first character is `;`)
//! $w = 40                  ; a number
//! $name = "Walls"          ; a string
//! $h = $w / 2              ; + - * / and parentheses over variables defined above
//! LAYER "Walls"            ; the current layer for the entity lines after it (a bare name works too)
//! UNIT mm                  ; documents the unit (INSUNITS, set when it can be)
//! LINE 0,0 10,0
//! PLINE 0,0 10,0 10,5 close
//! CIRCLE 5,5 2.5
//! ARC 0,0 5 0 90           ; centre, radius, start and end in degrees
//! POINT 3,4
//! TEXT 2,2 "Hello" 2.5     ; position, quoted string, height
//! ```
//! `${name}` inside any argument (inside a quoted string too) is replaced by the variable's value;
//! numbers are written with up to nine decimals, trailing zeros trimmed. A line that is none of the
//! above runs through the app's command language unchanged (`ZOOM E`, `ERASE ALL`, `cmd {json}`,
//! `(lisp)`), so scripts, prompts and keywords keep working.
//!
//! What the text does not carry is written into the script's own header (a constant, so a rebuilt
//! drawing's script reads back the same): MTEXT formatting, TEXT rotation/justification/style/width
//! factor, polyline bulges and widths, colour, linetype, lineweight, ltscale, thickness, visibility,
//! extrusion and z coordinates. Block references and every kind the language has no line for are
//! written as comment lines and are not rebuilt - nothing is dropped from the reader's view
//! silently.

use cadcraft_doc::{Drawing, Entity, EntityKind, EntityStore};
use serde_json::{Value, json};

use crate::Session;

/// Longest script `run` accepts (bytes).
pub const MAX_SCRIPT_BYTES: usize = 8 << 20;
/// Most lines `run` accepts.
pub const MAX_LINES: usize = 100_000;
/// Most variables a script may define.
pub const MAX_VARIABLES: usize = 10_000;
/// Most output lines a [`Report`] carries (the rest is counted in one trailing note).
pub const MAX_OUTPUT: usize = 200;
/// Most characters of a line kept in an error message.
const MAX_ERROR_LINE: usize = 120;
/// Deepest parentheses/unary nesting an expression may use.
const MAX_EXPR_DEPTH: usize = 32;

/// What a script's run reports: `ok`, how many lines ran, the command line's messages, and the
/// error (with its line number) when one stopped it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Report {
    pub ok: bool,
    pub ran: usize,
    pub output: Vec<String>,
    pub error: Option<String>,
}

/// The header's constant notes: what the language cannot carry. Constant, so a drawing rebuilt
/// from a script serializes to the same text again.
const LANGUAGE_NOTES: &[&str] = &[
    "CadScript v1 rebuilds LINE, PLINE, CIRCLE, ARC, POINT, TEXT and LAYER; anything else is a comment.",
    "Dropped on rebuild: MTEXT formatting, width, attach and rotation (it becomes a TEXT of its plain",
    "string, paragraphs joined); TEXT rotation, justification, style and width factor; point rotation;",
    "polyline bulges and widths; colour, linetype, lineweight, ltscale, thickness, visibility, extrusion",
    "and z coordinates; paper space (a layout's entities rebuild into model space).",
];

// ---------------------------------------------------------------------------------------------
// document -> text
// ---------------------------------------------------------------------------------------------

/// The drawing as a CadScript document: a header, a `LAYER` directive per layer change and one
/// line per entity, model space first, then each layout in order. Deterministic: the same drawing
/// always yields the same text.
pub fn to_script(doc: &Drawing) -> String {
    let mut out = String::new();
    out.push_str("; CADCraft drawing script\n");
    out.push_str("; unit: ");
    out.push_str(crate::units::name(doc.header.i64("INSUNITS", 1)));
    out.push('\n');
    // The unit as a directive too, when it is one INSUNITS names: a drawing rebuilt into a fresh
    // document keeps its unit, so it serializes to the same text again.
    let insunits = doc.header.i64("INSUNITS", 1);
    if (0..=20).contains(&insunits) {
        out.push_str("UNIT ");
        out.push_str(crate::units::name(insunits));
        out.push('\n');
    }
    for note in LANGUAGE_NOTES {
        out.push_str("; ");
        out.push_str(note);
        out.push('\n');
    }
    let mut layer: Option<String> = None;
    for (space, store) in spaces(doc) {
        if let Some(name) = space
            && !store.is_empty()
        {
            out.push_str("; paper space \"");
            out.push_str(&comment_text(name));
            out.push_str("\": these entities rebuild into model space\n");
        }
        for e in store.iter() {
            // Only lines the language can rebuild take a `LAYER` directive: a comment entity does
            // not change the current layer, so a rebuilt drawing serializes to the same text.
            if rebuildable(e) && layer.as_deref() != Some(e.common.layer.as_str()) {
                out.push_str("LAYER \"");
                out.push_str(&escape_string(&e.common.layer));
                out.push_str("\"\n");
                layer = Some(e.common.layer.clone());
            }
            entity_line(&mut out, e);
        }
    }
    out
}

/// Whether the language has an entity line for this kind (see [`entity_line`]).
fn rebuildable(e: &Entity) -> bool {
    matches!(
        e.kind,
        EntityKind::Line(_)
            | EntityKind::LwPolyline(_)
            | EntityKind::Circle(_)
            | EntityKind::Arc(_)
            | EntityKind::Point(_)
            | EntityKind::Text(_)
            | EntityKind::MText(_)
    )
}

/// Model space, then each layout in the drawing's own order.
fn spaces(doc: &Drawing) -> Vec<(Option<&str>, &EntityStore)> {
    let mut v: Vec<(Option<&str>, &EntityStore)> = vec![(None, &doc.model)];
    v.extend(doc.layouts.iter().map(|l| (Some(l.name.as_str()), &l.entities)));
    v
}

/// One entity as its script line (or a comment when the language has no line for it).
fn entity_line(out: &mut String, e: &Entity) {
    match &e.kind {
        EntityKind::Line(l) => {
            out.push_str("LINE ");
            xy(out, l.a.x, l.a.y);
            out.push(' ');
            xy(out, l.b.x, l.b.y);
            out.push('\n');
        }
        EntityKind::LwPolyline(p) => {
            out.push_str("PLINE");
            for v in &p.vertices {
                out.push(' ');
                xy(out, v.p.x, v.p.y);
            }
            if p.closed {
                out.push_str(" close");
            }
            out.push('\n');
        }
        EntityKind::Circle(c) => {
            out.push_str("CIRCLE ");
            xy(out, c.center.x, c.center.y);
            out.push(' ');
            out.push_str(&format_number(c.radius));
            out.push('\n');
        }
        EntityKind::Arc(a) => {
            out.push_str("ARC ");
            xy(out, a.center.x, a.center.y);
            out.push(' ');
            out.push_str(&format_number(a.radius));
            out.push(' ');
            // Degrees, the value whose text reads back as this same angle again (see
            // [`arc_angle_degrees`]).
            out.push_str(&format_number(arc_angle_degrees(a.start)));
            out.push(' ');
            out.push_str(&format_number(arc_angle_degrees(a.end)));
            out.push('\n');
        }
        EntityKind::Point(p) => {
            out.push_str("POINT ");
            xy(out, p.p.x, p.p.y);
            out.push('\n');
        }
        EntityKind::Text(t) => {
            out.push_str("TEXT ");
            xy(out, t.insert.x, t.insert.y);
            out.push_str(" \"");
            out.push_str(&escape_string(&t.value));
            out.push_str("\" ");
            out.push_str(&format_number(t.height));
            out.push('\n');
        }
        EntityKind::MText(t) => {
            out.push_str("TEXT ");
            xy(out, t.insert.x, t.insert.y);
            out.push_str(" \"");
            out.push_str(&escape_string(&mtext_plain(&t.contents)));
            out.push_str("\" ");
            out.push_str(&format_number(t.height));
            out.push('\n');
        }
        EntityKind::Insert(i) => {
            // A block reference is not reconstructible from text yet: a comment, not a pretence.
            out.push_str("; INSERT block \"");
            out.push_str(&comment_text(&i.block));
            out.push_str("\" at ");
            xy(out, i.insert.x, i.insert.y);
            out.push('\n');
        }
        other => {
            out.push_str("; ");
            out.push_str(&comment_text(other.dxf_name()));
            out.push_str(" (not in the script language yet)\n");
        }
    }
}

/// `x,y`, the script's point.
fn xy(out: &mut String, x: f64, y: f64) {
    out.push_str(&format_number(x));
    out.push(',');
    out.push_str(&format_number(y));
}

/// A number as CadScript writes it: up to nine decimals with trailing zeros trimmed (`5`, `2.5`,
/// `0.3125`); `-0` is `0`. A value nine decimals cannot write back exactly is written in full
/// (`0.30000000000000004`, `1e-300`), so every number in a script reads back as the number it was
/// written from, and writing it again yields the same text.
pub fn format_number(v: f64) -> String {
    if !v.is_finite() || v == 0.0 {
        return "0".into();
    }
    let mut s = format!("{v:.9}");
    if s.contains('.') {
        let t = s.trim_end_matches('0');
        let t = t.strip_suffix('.').unwrap_or(t);
        s = t.to_string();
    }
    if s.parse::<f64>().is_ok_and(|p| p == v) { s } else { format!("{v}") }
}

/// The degrees to write for an arc angle (radians): the runner reads degrees back through
/// `to_radians` and `norm_angle`, which can move a value by one unit in the last place. This picks
/// the value among `d` and its two neighbours whose round trip is bit-exact, so a rebuilt drawing
/// serializes to the same text; `d` itself when none of them works.
fn arc_angle_degrees(radians: f64) -> f64 {
    let norm = cadcraft_geom::norm_angle(radians);
    let d = norm.to_degrees();
    for step in 0..=3u64 {
        let candidates =
            if step == 0 { [d, d] } else { [f64::from_bits(d.to_bits().wrapping_add(step)), f64::from_bits(d.to_bits().wrapping_sub(step))] };
        for candidate in candidates {
            if candidate.is_finite() && candidate >= 0.0 && cadcraft_geom::norm_angle(candidate.to_radians()) == norm {
                return candidate;
            }
        }
    }
    d
}

/// `s` inside double quotes: backslash, quote, newline, tab and carriage return escaped, so the
/// line stays one line and [`run`] reads the same string back.
fn escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

/// Text for a comment (a type name, a block name, a layout name): control characters become
/// spaces, so a hostile name cannot break the line the comment is on.
fn comment_text(s: &str) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect()
}

/// MTEXT contents as one plain line: `\P` (and a real line break) becomes a space, `\\`, `\{` and
/// `\}` their characters, `\S1#2;`/`\S1/2;`/`\S+0.1^-0.2;` a readable fraction, and every other
/// inline code (font, height, colour, underline, paragraph settings) is dropped. `%%` control
/// codes are kept: TEXT reads them too.
fn mtext_plain(contents: &str) -> String {
    let chars: Vec<char> = contents.chars().collect();
    let mut out = String::with_capacity(contents.len());
    let mut i = 0;
    while let Some(&c) = chars.get(i) {
        match c {
            '\n' | '\r' => {
                out.push(' ');
                i += 1;
            }
            // Grouping braces carry formatting, not text.
            '{' | '}' => i += 1,
            '\\' => {
                match chars.get(i + 1).copied() {
                    None => i += 1,
                    Some('P') | Some('p') => {
                        out.push(' ');
                        i += 2;
                    }
                    Some(c @ ('\\' | '{' | '}')) => {
                        out.push(c);
                        i += 2;
                    }
                    // Toggles and spacing codes with no argument (the same set the MTEXT editor
                    // parses: \L \l \O \o \~ \K \k \N).
                    Some(k @ ('L' | 'l' | 'O' | 'o' | 'K' | 'k' | 'N')) => {
                        if k == '~' {
                            out.push(' ');
                        }
                        i += 2;
                    }
                    Some('~') => {
                        out.push(' ');
                        i += 2;
                    }
                    Some('S') => {
                        // A stacked fraction: `\S1#2;`, `\S1/2;`, `\S+0.1^-0.2;`.
                        let mut j = i + 2;
                        let mut arg = String::new();
                        while let Some(&d) = chars.get(j) {
                            if d == ';' {
                                break;
                            }
                            arg.push(d);
                            j += 1;
                        }
                        out.extend(arg.chars().filter(|c| *c != '#').map(|c| if c == '^' { '/' } else { c }));
                        i = j.saturating_add(1);
                    }
                    Some(_) => {
                        // Any other code: its argument runs to the `;`.
                        let mut j = i + 2;
                        while let Some(&d) = chars.get(j) {
                            j += 1;
                            if d == ';' {
                                break;
                            }
                        }
                        i = j;
                    }
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// text -> commands
// ---------------------------------------------------------------------------------------------

/// A variable's value.
#[derive(Clone, Debug, PartialEq)]
enum Var {
    Num(f64),
    Str(String),
}

/// A line's argument.
#[derive(Clone, Debug, PartialEq)]
enum Token {
    Word(String),
    Str(String),
}

/// Rebuild the drawing from `text`: variables first (whole file), then every other line in order
/// through the app's script runner, one line at a time. Stops at the first error, reporting its
/// line number and the line's text; everything that ran before it stays in the drawing.
///
/// `ran` counts the lines that ran (blank lines, comments and variable definitions do not run).
/// `output` carries the command line's messages, capped at [`MAX_OUTPUT`] entries.
pub fn run(session: &mut Session, text: &str) -> Report {
    let mut report = Report::default();
    if text.len() > MAX_SCRIPT_BYTES {
        report.error = Some(format!("the script is too long: {} bytes (the limit is {MAX_SCRIPT_BYTES})", text.len()));
        return report;
    }
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > MAX_LINES {
        report.error = Some(format!("the script has too many lines: {} (the limit is {MAX_LINES})", lines.len()));
        return report;
    }
    // Trailing spaces are inputs (Enter) in the app's scripts, so only other trailing whitespace
    // (a `\r` from a Windows file) is dropped.
    let lines: Vec<&str> = lines.into_iter().map(|l| l.trim_end_matches(|c: char| c.is_whitespace() && c != ' ')).collect();
    // A command left waiting at the command line would eat the script's tokens as its own input;
    // a rebuild starts from a clean prompt (Esc, as the reader would press).
    if session.running.is_some() {
        session.cancel();
        report.output.push("a command was waiting for input and was cancelled".into());
    }

    // Variables first, over the whole file, in order (an expression reads variables defined above
    // it; a later line may use a variable defined below it).
    let mut vars: Vec<(String, Var)> = Vec::new();
    let mut is_variable = vec![false; lines.len()];
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if t.is_empty() || t.starts_with(';') || !t.starts_with('$') {
            continue;
        }
        if vars.len() >= MAX_VARIABLES {
            report.error = Some(line_error(i + 1, line, &format!("too many variables (the limit is {MAX_VARIABLES})")));
            return report;
        }
        match define_variable(t, &vars) {
            Ok((name, value)) => {
                vars.push((name, value));
                if let Some(slot) = is_variable.get_mut(i) {
                    *slot = true;
                }
            }
            Err(e) => {
                report.error = Some(line_error(i + 1, line, &e));
                return report;
            }
        }
    }

    let mut dropped = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if is_variable.get(i).copied().unwrap_or(false) {
            continue;
        }
        let t = line.trim_start();
        if t.is_empty() || t.starts_with(';') {
            continue;
        }
        let prepared = match substitute(t, &vars) {
            Ok(p) => p,
            Err(e) => {
                report.error = Some(line_error(i + 1, line, &e));
                break;
            }
        };
        let before = session.log.len();
        match execute_line(session, &prepared) {
            Ok(()) => {
                collect_output(&mut report, session, before, &mut dropped);
                report.ran += 1;
            }
            Err(e) => {
                collect_output(&mut report, session, before, &mut dropped);
                report.error = Some(line_error(i + 1, line, &e));
                break;
            }
        }
    }
    if dropped > 0 {
        report.output.push(format!("… {dropped} more output lines"));
    }
    report.ok = report.error.is_none();
    report
}

/// Rebuild the drawing **from** `text`: the entities the language can carry are cleared first, so
/// running a drawing's own script replaces them instead of adding a second copy. This is what the
/// assistant pane's Source tab's Rebuild does; [`run`] stays additive for scripting.
///
/// Only the kinds the language rebuilds ([`EntityKind::Line`], `LwPolyline`, `Circle`, `Arc`,
/// `Point`, `Text`) are cleared. Everything else — block references, dimensions, hatches, meshes —
/// is **kept**, because a script cannot put it back; the script carries those as comments. A
/// drawing with nothing the language can rebuild is therefore left whole.
///
/// A script that fails changes nothing: the drawing is put back as it was (the error names its
/// line, as [`run`] does). A script that succeeds leaves one undo step, "CadScript rebuild", so
/// Ctrl+Z restores the drawing that was there before.
pub fn run_replace(session: &mut Session, text: &str) -> Report {
    let before = match session.state() {
        Ok(st) => (st.doc.clone(), st.selection.clone(), st.revision),
        Err(e) => {
            return Report { ok: false, ran: 0, output: Vec::new(), error: Some(e.to_string()) };
        }
    };
    // Model space only, and only the rebuildable kinds: layers, blocks, styles and layouts are the
    // drawing's furniture and a script's `LAYER` directives build on them.
    let mut kept = 0usize;
    if let Ok(st) = session.state_mut() {
        let mut doc = (*st.doc).clone();
        // Clear exactly what the script carries (the same kinds and spaces `to_script` walks), so
        // the rebuild replaces them rather than duplicating them. Entities the language has no
        // line for — block references, dimensions, hatches, meshes — are kept whole: a script
        // cannot put them back, and the script shows them as comments.
        let mut store = EntityStore::new();
        for e in doc.model.iter() {
            if rebuildable(e) {
                continue;
            }
            store.push((**e).clone());
            kept += 1;
        }
        doc.model = store;
        for layout in &mut doc.layouts {
            let mut lstore = EntityStore::new();
            for e in layout.entities.iter() {
                if rebuildable(e) {
                    continue;
                }
                lstore.push((**e).clone());
                kept += 1;
            }
            layout.entities = lstore;
        }
        st.doc = std::sync::Arc::new(doc);
        st.selection.clear();
    }
    let mut report = run(session, text);
    if report.ok {
        if kept > 0 {
            report.output.push(format!("{kept} object(s) the script cannot rebuild were kept"));
        }
        if let Ok(st) = session.state_mut() {
            st.push_undo(crate::Snapshot { label: "CadScript rebuild".into(), doc: before.0, selection: before.1 });
            st.revision = before.2 + 1;
        }
        return report;
    }
    // The run stopped part-way: put the drawing back whole, so a typo cannot eat a drawing.
    if let Ok(st) = session.state_mut() {
        st.doc = before.0;
        st.selection = before.1;
        st.revision = before.2 + 1;
    }
    report.output.push("the drawing was restored (a rebuild that fails changes nothing)".into());
    report
}

/// One line of CadScript: a directive, one of the language's entity lines, or the app's own
/// command language.
fn execute_line(session: &mut Session, line: &str) -> Result<(), String> {
    let toks = tokenize(line)?;
    let Some(Token::Word(head)) = toks.first() else {
        return Err("a line must start with a command".into());
    };
    let args = toks.get(1..).unwrap_or_default();
    match head.to_ascii_uppercase().as_str() {
        "LAYER" => directive_layer(session, args),
        "UNIT" => directive_unit(session, args),
        "LINE" => {
            if args.len() < 2 {
                return Err("LINE needs at least two points: LINE x,y x,y".into());
            }
            let pts = points_of(args)?;
            call(session, "line", json!({ "points": pts }))
        }
        "PLINE" => {
            let (closed, args) = match args.split_last() {
                Some((Token::Word(w), rest)) if w.eq_ignore_ascii_case("close") => (true, rest),
                _ => (false, args),
            };
            if args.len() < 2 {
                return Err("PLINE needs at least two points: PLINE x,y x,y [close]".into());
            }
            let pts = points_of(args)?;
            call(session, "pline", json!({ "vertices": pts, "closed": closed }))
        }
        "CIRCLE" => match args {
            [c, r] => {
                let (x, y) = point(c)?;
                let r = number(r)?;
                call(session, "circle", json!({ "center": [x, y], "radius": r }))
            }
            _ => Err("CIRCLE takes a centre and a radius: CIRCLE 5,5 2.5".into()),
        },
        "ARC" => match args {
            [c, r, s, e] => {
                let (x, y) = point(c)?;
                let r = number(r)?;
                let s = number(s)?;
                let e = number(e)?;
                call(session, "arc", json!({ "center": [x, y], "radius": r, "start": s, "end": e }))
            }
            _ => Err("ARC takes a centre, a radius and two angles in degrees: ARC 0,0 5 0 90".into()),
        },
        "POINT" => match args {
            [p] => {
                let (x, y) = point(p)?;
                call(session, "point", json!({ "at": [x, y] }))
            }
            _ => Err("POINT takes one point: POINT 3,4".into()),
        },
        "TEXT" => match args {
            [p, t, h] => {
                let (x, y) = point(p)?;
                let Token::Str(text) = t else {
                    return Err("the text must be quoted: TEXT 2,2 \"Hello\" 2.5".into());
                };
                let h = number(h)?;
                call(session, "text", json!({ "at": [x, y], "text": text, "height": h }))
            }
            _ => Err("TEXT takes a position, a quoted string and a height: TEXT 2,2 \"Hello\" 2.5".into()),
        },
        // Everything else is the app's command language: prompts, keywords, `cmd {json}`, LISP.
        // The line goes through verbatim, so a trailing space is Enter, exactly as in a `.scr` file.
        _ => {
            session.script(line).map_err(|e| e.to_string())?;
            finish_line(session)
        }
    }
}

/// A programmatic call through the app's own script runner (`cmd {json}` inside a script).
fn call(session: &mut Session, id: &str, params: Value) -> Result<(), String> {
    session.script(&format!("{id} {params}")).map_err(|e| e.to_string())?;
    finish_line(session)
}

/// A CadScript line is one statement: a command still waiting for input when the line ends is an
/// error, not something the next line continues into (add a trailing space to give the app's
/// scripts an Enter, as a `.scr` file would).
fn finish_line(session: &mut Session) -> Result<(), String> {
    if session.running.is_some() {
        session.cancel();
        return Err("the command did not finish on this line (it is still waiting for input; a trailing space is Enter)".into());
    }
    Ok(())
}

/// `LAYER "name"` (or a bare `LAYER Walls`): the current layer for the lines after it.
fn directive_layer(session: &mut Session, args: &[Token]) -> Result<(), String> {
    let name = match args {
        [Token::Str(n)] | [Token::Word(n)] => n.clone(),
        _ => return Err("LAYER takes one layer name: LAYER \"Walls\"".into()),
    };
    let doc = session.doc_mut().map_err(|e| e.to_string())?;
    doc.ensure_layer(&name);
    doc.header.set_str("CLAYER", &name);
    Ok(())
}

/// `UNIT name`: documents the unit. INSUNITS is set (it is a drawing property, never geometry);
/// an unknown name is accepted and ignored with a note.
fn directive_unit(session: &mut Session, args: &[Token]) -> Result<(), String> {
    let word = match args {
        [Token::Word(w)] => w.clone(),
        _ => return Err("UNIT takes one name: UNIT mm".into()),
    };
    match insunits_of(&word) {
        Some(code) => {
            session.doc_mut().map_err(|e| e.to_string())?.header.set_i64("INSUNITS", code);
            Ok(())
        }
        None => {
            session.echo(format!("UNIT {word}: unknown unit, ignored (INSUNITS is unchanged)"));
            Ok(())
        }
    }
}

/// The INSUNITS code of a unit's name or of one of the usual abbreviations (`mm`, `in`, `ft`, …),
/// or of the code itself.
fn insunits_of(word: &str) -> Option<i64> {
    let w = word.trim().to_ascii_lowercase();
    if let Ok(n) = w.parse::<i64>() {
        return (0..=20).contains(&n).then_some(n);
    }
    let name = match w.as_str() {
        "mm" | "millimeter" | "millimeters" | "millimetre" | "millimetres" => "millimeters",
        "cm" | "centimeter" | "centimeters" | "centimetre" | "centimetres" => "centimeters",
        "m" | "meter" | "meters" | "metre" | "metres" => "meters",
        "km" | "kilometer" | "kilometers" | "kilometre" | "kilometres" => "kilometers",
        "dm" | "decimeter" | "decimeters" => "decimeters",
        "in" | "inch" | "inches" => "inches",
        "ft" | "foot" | "feet" => "feet",
        "mi" | "mile" | "miles" => "miles",
        "yd" | "yard" | "yards" => "yards",
        "mil" | "mils" => "mils",
        "um" | "micron" | "microns" | "micrometer" | "micrometers" => "microns",
        "nm" | "nanometer" | "nanometers" => "nanometers",
        other => other,
    };
    (0..=20).find(|c| crate::units::name(*c) == name)
}

/// The points of a line's arguments (`x,y` each).
fn points_of(args: &[Token]) -> Result<Vec<Value>, String> {
    let mut pts = Vec::with_capacity(args.len());
    for t in args {
        let (x, y) = point(t)?;
        pts.push(json!([x, y]));
    }
    Ok(pts)
}

/// One argument as a point.
fn point(t: &Token) -> Result<(f64, f64), String> {
    let Token::Word(w) = t else {
        return Err("expected a point `x,y`".into());
    };
    let (x, y) = w.split_once(',').ok_or_else(|| format!("`{w}` is not a point: points are written `x,y`"))?;
    Ok((finite(x)?, finite(y)?))
}

/// One argument as a number.
fn number(t: &Token) -> Result<f64, String> {
    let Token::Word(w) = t else {
        return Err("expected a number".into());
    };
    finite(w)
}

/// A typed number: finite, or a clean error (never a NaN or an infinity in the drawing).
fn finite(text: &str) -> Result<f64, String> {
    text.trim().parse::<f64>().ok().filter(|v| v.is_finite()).ok_or_else(|| format!("`{}` is not a finite number", text.trim()))
}

/// A line's arguments: words, and quoted strings with `\\ \" \n \r \t` escapes.
fn tokenize(line: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out: Vec<Token> = Vec::new();
    let mut i = 0;
    while let Some(&c) = chars.get(i) {
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c == '"' {
            let mut s = String::new();
            i += 1;
            loop {
                match chars.get(i).copied() {
                    None => return Err("unterminated string (a `\"` was opened and never closed)".into()),
                    Some('"') => {
                        i += 1;
                        break;
                    }
                    Some('\\') => match chars.get(i + 1).copied() {
                        Some('\\') => {
                            s.push('\\');
                            i += 2;
                        }
                        Some('"') => {
                            s.push('"');
                            i += 2;
                        }
                        Some('n') => {
                            s.push('\n');
                            i += 2;
                        }
                        Some('t') => {
                            s.push('\t');
                            i += 2;
                        }
                        Some('r') => {
                            s.push('\r');
                            i += 2;
                        }
                        Some(other) => return Err(format!("unknown escape `\\{other}` in a string")),
                        None => return Err("unterminated string".into()),
                    },
                    Some(d) => {
                        s.push(d);
                        i += 1;
                    }
                }
            }
            out.push(Token::Str(s));
            continue;
        }
        let mut w = String::new();
        while let Some(&d) = chars.get(i) {
            if d.is_whitespace() {
                break;
            }
            w.push(d);
            i += 1;
        }
        out.push(Token::Word(w));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// variables
// ---------------------------------------------------------------------------------------------

/// `$name = value`: a quoted string, or an expression over the variables defined above.
fn define_variable(line: &str, vars: &[(String, Var)]) -> Result<(String, Var), String> {
    let rest = line.strip_prefix('$').unwrap_or(line);
    let (name, rhs) = rest.split_once('=').ok_or_else(|| "a variable line needs `=`: $name = value".to_string())?;
    let name = name.trim();
    if !valid_name(name) {
        return Err(format!("`{name}` is not a variable name (a letter or `_`, then letters, digits or `_`)"));
    }
    let rhs = rhs.trim();
    if rhs.is_empty() {
        return Err(format!("`${name} =` needs a value"));
    }
    if rhs.starts_with('"') {
        let toks = tokenize(rhs)?;
        return match toks.as_slice() {
            [Token::Str(s)] => Ok((name.to_string(), Var::Str(s.clone()))),
            _ => Err(format!("`${name}` takes one quoted string")),
        };
    }
    let n = expression(rhs, vars)?;
    Ok((name.to_string(), Var::Num(n)))
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `${name}` inside any argument (inside a quoted string too) is the variable's value. A bare
/// `$name` is left alone: variables are written bare in expressions and braced in arguments.
fn substitute(line: &str, vars: &[(String, Var)]) -> Result<String, String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    let mut in_string = false;
    while let Some(&c) = chars.get(i) {
        match c {
            '\\' if in_string => {
                // An escape: the character after it cannot end the string.
                out.push(c);
                if let Some(&d) = chars.get(i + 1) {
                    out.push(d);
                    i += 1;
                }
                i += 1;
            }
            '"' => {
                in_string = !in_string;
                out.push(c);
                i += 1;
            }
            '$' if chars.get(i + 1) == Some(&'{') => {
                let mut j = i + 2;
                let mut name = String::new();
                while let Some(&d) = chars.get(j) {
                    if d == '}' {
                        break;
                    }
                    name.push(d);
                    j += 1;
                }
                if chars.get(j) != Some(&'}') {
                    return Err("unterminated `${` (no `}` follows)".into());
                }
                let value = vars.iter().find(|(n, _)| *n == name).map(|(_, v)| v);
                let Some(value) = value else {
                    return Err(format!("`${{{name}}}` is not defined"));
                };
                match value {
                    Var::Num(n) => out.push_str(&format_number(*n)),
                    Var::Str(s) => {
                        // Inside a string, the value is escaped so it stays one argument.
                        if in_string {
                            out.push_str(&escape_string(s));
                        } else {
                            out.push_str(s);
                        }
                    }
                }
                i = j + 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    Ok(out)
}

/// An expression: `+ - * /`, parentheses and `$variable` over the variables defined above.
fn expression(text: &str, vars: &[(String, Var)]) -> Result<f64, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut p = Expr { chars: &chars, i: 0, vars, depth: 0 };
    let v = p.sum()?;
    p.skip_space();
    match p.peek() {
        None => Ok(v),
        Some(c) => Err(format!("unexpected `{c}` after the expression")),
    }
}

/// A recursive-descent parser over the characters of one expression.
struct Expr<'a> {
    chars: &'a [char],
    i: usize,
    vars: &'a [(String, Var)],
    depth: usize,
}

impl Expr<'_> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.i).copied()
    }

    fn skip_space(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.i += 1;
        }
    }

    fn sum(&mut self) -> Result<f64, String> {
        let mut v = self.term()?;
        loop {
            self.skip_space();
            match self.peek() {
                Some('+') => {
                    self.i += 1;
                    v = finite_result(v + self.term()?)?;
                }
                Some('-') => {
                    self.i += 1;
                    v = finite_result(v - self.term()?)?;
                }
                _ => return Ok(v),
            }
        }
    }

    fn term(&mut self) -> Result<f64, String> {
        let mut v = self.unary()?;
        loop {
            self.skip_space();
            match self.peek() {
                Some('*') => {
                    self.i += 1;
                    v = finite_result(v * self.unary()?)?;
                }
                Some('/') => {
                    self.i += 1;
                    let d = self.unary()?;
                    if d == 0.0 {
                        return Err("division by zero".into());
                    }
                    v = finite_result(v / d)?;
                }
                _ => return Ok(v),
            }
        }
    }

    fn unary(&mut self) -> Result<f64, String> {
        self.depth += 1;
        if self.depth > MAX_EXPR_DEPTH {
            return Err(format!("the expression nests deeper than {MAX_EXPR_DEPTH}"));
        }
        self.skip_space();
        let v = if self.peek() == Some('-') {
            self.i += 1;
            let v = self.unary()?;
            finite_result(-v)
        } else {
            self.primary()
        };
        self.depth -= 1;
        v
    }

    fn primary(&mut self) -> Result<f64, String> {
        self.skip_space();
        match self.peek() {
            Some('(') => {
                self.i += 1;
                let v = self.sum()?;
                self.skip_space();
                if self.peek() != Some(')') {
                    return Err("expected `)`".into());
                }
                self.i += 1;
                Ok(v)
            }
            Some('$') => {
                self.i += 1;
                let mut name = String::new();
                while let Some(c) = self.peek() {
                    if c.is_ascii_alphanumeric() || c == '_' {
                        name.push(c);
                        self.i += 1;
                    } else {
                        break;
                    }
                }
                match self.vars.iter().find(|(n, _)| *n == name).map(|(_, v)| v) {
                    Some(Var::Num(n)) => Ok(*n),
                    Some(Var::Str(_)) => Err(format!("`${name}` holds a string, not a number")),
                    None => Err(format!("`${name}` is not defined yet (variables are read in order)")),
                }
            }
            Some(c) if c.is_ascii_digit() || c == '.' => {
                let start = self.i;
                while self.peek().is_some_and(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) {
                    // A sign only continues a number right after an exponent (`1e-3`).
                    let sign_ok = matches!(self.chars.get(self.i.wrapping_sub(1)), Some('e' | 'E'));
                    if matches!(self.peek(), Some('+' | '-')) && !sign_ok {
                        break;
                    }
                    self.i += 1;
                }
                let text: String = self.chars.get(start..self.i).unwrap_or_default().iter().collect();
                finite(&text)
            }
            Some(c) => Err(format!("unexpected `{c}` in the expression")),
            None => Err("the expression ends early".into()),
        }
    }
}

/// A result too large to be a number is an error, not an infinity in the drawing.
fn finite_result(v: f64) -> Result<f64, String> {
    if v.is_finite() { Ok(v) } else { Err("the expression is too large to be a number".into()) }
}

// ---------------------------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------------------------

/// `line N: the line's text: what went wrong`.
fn line_error(n: usize, line: &str, msg: &str) -> String {
    let text: String = line.trim().chars().take(MAX_ERROR_LINE).collect();
    let cut = if line.trim().chars().count() > MAX_ERROR_LINE { "…" } else { "" };
    format!("line {n}: {text}{cut}: {msg}")
}

/// The command line's messages from the line that just ran, capped at [`MAX_OUTPUT`].
fn collect_output(report: &mut Report, session: &Session, before: usize, dropped: &mut usize) {
    let start = before.min(session.log.len());
    for m in session.log.iter().skip(start) {
        if report.output.len() < MAX_OUTPUT {
            report.output.push(m.clone());
        } else {
            *dropped += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample;
    use cadcraft_doc::EntityKind;

    fn script_of(s: &Session) -> String {
        to_script(s.doc().expect("a drawing"))
    }

    fn run_ok(s: &mut Session, text: &str) -> Report {
        let r = run(s, text);
        assert!(r.ok, "the script failed: {:?}", r.error);
        r
    }

    /// The comment lines of a text (what the language cannot rebuild, and the header notes).
    fn comments_stripped(text: &str) -> String {
        text.lines().filter(|l| !l.trim_start().starts_with(';')).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn the_round_trip_is_byte_identical() {
        // A drawing whose entities are all in the language: to_script -> run -> to_script is
        // byte-identical, assertions and all.
        let text = "\
LAYER \"A\"
LINE 0,0 10,0
LINE 10,0 10,5
PLINE 0,0 1,0 1,1 close
PLINE 2,2 3,2 3,3
CIRCLE 5,5 2.5
ARC 0,0 5 0 90
POINT 3,4
TEXT 2,2 \"Hello\" 2.5
LAYER \"B\"
LINE 0,0 0,10
";
        let mut s = Session::new();
        run_ok(&mut s, text);
        let first = script_of(&s);
        let mut rebuilt = Session::new();
        run_ok(&mut rebuilt, &first);
        let second = script_of(&rebuilt);
        assert_eq!(first, second, "to_script -> run -> to_script must be byte-identical");
    }

    #[test]
    fn the_sample_drawing_round_trips_byte_identical() {
        // The sample carries entities the language has no line for (dimensions, hatches, block
        // references): they are comment lines, and a comment is not rebuilt, so the first rebuild
        // drops exactly those lines and nothing else. From there the text is a fixpoint: the
        // rebuilt drawing's script runs back to the same text, byte for byte.
        let first = to_script(&sample::default_sample());
        let mut s = Session::new();
        run_ok(&mut s, &first);
        let second = script_of(&s);
        assert_eq!(
            comments_stripped(&first),
            comments_stripped(&second),
            "everything but the comment lines the language cannot rebuild is byte-identical"
        );
        // The only comments left are the header's: every unsupported-entity line was dropped, and
        // no entity line was lost (the stripped texts above are equal line for line).
        let mut allowed: Vec<String> = vec!["; CADCraft drawing script".to_string()];
        allowed.push(format!("; unit: {}", crate::units::name(s.doc().expect("a drawing").header.i64("INSUNITS", 1))));
        allowed.extend(LANGUAGE_NOTES.iter().map(|n| format!("; {n}")));
        for c in second.lines().filter(|l| l.trim_start().starts_with(';')) {
            assert!(allowed.iter().any(|a| a == c), "the rebuilt script kept a comment that is not header: {c:?}");
        }
        assert!(second.lines().count() < first.lines().count(), "the unsupported-entity comments are gone");
        let mut again = Session::new();
        run_ok(&mut again, &second);
        let third = script_of(&again);
        assert_eq!(second, third, "the rebuilt drawing's script is a fixpoint, byte for byte");
        // Deterministic: the same document always yields the same text.
        assert_eq!(first, to_script(&sample::default_sample()));
    }

    #[test]
    fn the_floor_plan_round_trips_byte_identical() {
        // The floor plan carries an ARC (0 to 90 degrees), the angle conversion the text must
        // survive, and a dimension, which is a comment.
        let first = to_script(&sample::floor_plan());
        let mut s = Session::new();
        run_ok(&mut s, &first);
        let second = script_of(&s);
        assert_eq!(comments_stripped(&first), comments_stripped(&second));
        let mut again = Session::new();
        run_ok(&mut again, &second);
        assert_eq!(second, script_of(&again));
    }

    #[test]
    fn variables_substitute_and_expressions_land_in_the_drawing() {
        let text = "\
$w = 4
$name = \"Walls\"
$h = $w * 2 + 1
LAYER \"${name}\"
LINE 0,0 ${w},${h}
CIRCLE ${w},${h} 1
";
        let mut s = Session::new();
        let r = run_ok(&mut s, text);
        assert_eq!(r.ran, 3, "the two entity lines and the directive ran");
        let doc = s.doc().expect("a drawing");
        assert_eq!(doc.model.len(), 2, "one line and one circle");
        let mut seen_line = false;
        let mut seen_circle = false;
        for e in doc.model.iter() {
            assert_eq!(e.common.layer, "Walls", "the substituted string set the layer");
            match &e.kind {
                EntityKind::Line(l) => {
                    seen_line = true;
                    assert!(l.a.x == 0.0 && l.a.y == 0.0, "from the origin: {:?}", l.a);
                    assert!((l.b.x - 4.0).abs() < 1e-12 && (l.b.y - 9.0).abs() < 1e-12, "$w and $h * 2 + 1: {:?}", l.b);
                }
                EntityKind::Circle(c) => {
                    seen_circle = true;
                    assert!((c.center.x - 4.0).abs() < 1e-12 && (c.center.y - 9.0).abs() < 1e-12, "{:?}", c.center);
                    assert!((c.radius - 1.0).abs() < 1e-12);
                }
                other => panic!("unexpected entity {other:?}"),
            }
        }
        assert!(seen_line && seen_circle);
    }

    #[test]
    fn an_error_names_its_line_and_keeps_what_ran() {
        // A missing argument: the language's own error, on line 3.
        let mut s = Session::new();
        let r = run(&mut s, "LINE 0,0 1,0\nLINE 1,0 2,0\nCIRCLE 5,5\nLINE 2,0 3,0\n");
        assert!(!r.ok);
        let e = r.error.clone().unwrap_or_default();
        assert!(e.starts_with("line 3: CIRCLE 5,5:"), "{e}");
        assert_eq!(r.ran, 2, "the two lines before it ran");
        assert_eq!(s.doc().expect("a drawing").model.len(), 2);
        // An error from the engine itself (a command that refuses its parameters), on line 4.
        let mut s = Session::new();
        let r = run(&mut s, "LINE 0,0 1,0\nLINE 1,0 2,0\nLINE 2,0 3,0\nCIRCLE 5,5 -1\nLINE 3,0 4,0\n");
        assert!(!r.ok);
        let e = r.error.clone().unwrap_or_default();
        assert!(e.starts_with("line 4: CIRCLE 5,5 -1:"), "{e}");
        assert_eq!(r.ran, 3);
        assert_eq!(s.doc().expect("a drawing").model.len(), 3);
    }

    #[test]
    fn hostile_scripts_error_cleanly_instead_of_panicking() {
        // 10k lines of huge coordinates: no panic, and either they run or the first one reports.
        let mut text = String::new();
        for _ in 0..10_000 {
            text.push_str("LINE 0,0 1e308,1e308\n");
        }
        let mut s = Session::new();
        let r = run(&mut s, &text);
        assert!(r.ok || r.error.as_deref().is_some_and(|e| e.starts_with("line ")), "{:?}", r.error);
        assert!(r.ran <= 10_000);
        // An unterminated `${`.
        let mut s = Session::new();
        let r = run(&mut s, "LINE 0,0 ${oops,0\n");
        assert!(!r.ok);
        assert!(r.error.clone().unwrap_or_default().starts_with("line 1: LINE 0,0 ${oops,0:"), "{:?}", r.error);
        assert_eq!(r.ran, 0);
        // A variable used before it is defined, in an expression and in an argument.
        let mut s = Session::new();
        let r = run(&mut s, "$a = $b + 1\n$b = 2\n");
        assert!(!r.ok && r.error.clone().unwrap_or_default().contains("`$b` is not defined yet"), "{:?}", r.error);
        let mut s = Session::new();
        let r = run(&mut s, "LINE 0,0 ${x},0\n");
        assert!(!r.ok && r.error.clone().unwrap_or_default().contains("`${x}` is not defined"), "{:?}", r.error);
        // A hostile drawing: a string that would break a line, and a division by zero.
        let mut s = Session::new();
        let r = run(&mut s, "TEXT 0,0 \"a\\\"b\\nc\" 1\n");
        assert!(r.ok, "{:?}", r.error);
        let mut s = Session::new();
        let r = run(&mut s, "$z = 1 / 0\n");
        assert!(!r.ok && r.error.clone().unwrap_or_default().contains("division by zero"), "{:?}", r.error);
        // A nested script is refused by the engine, not by a crash: `script {json}` runs SCRIPT
        // with the script's own text, which the engine refuses while a script is running.
        let mut s = Session::new();
        let r = run(&mut s, "script {\"data\":\"TElORSAwLDAgMSwwCg==\"}\n");
        assert!(!r.ok, "a nested script must be refused: {r:?}");
        assert!(r.error.clone().unwrap_or_default().contains("nested scripts are not supported"), "{:?}", r.error);
        assert_eq!(s.doc().expect("a drawing").model.len(), 0, "nothing of the nested script ran");
    }

    #[test]
    fn two_runs_of_the_same_script_are_identical_drawings() {
        let text = "\
LAYER \"A\"
LINE 0,0 5,5
PLINE 0,0 1,0 1,1 close
CIRCLE 1,2 3
ARC 0,0 2 0 90
POINT 3,4
TEXT 0,0 \"Hi\" 1
";
        let mut a = Session::new();
        let mut b = Session::new();
        run_ok(&mut a, text);
        run_ok(&mut b, text);
        assert_eq!(a.doc().expect("a drawing").model.len(), b.doc().expect("a drawing").model.len());
        assert_eq!(a.doc().expect("a drawing").model.len(), 6, "line, pline, circle, arc, point, text");
        assert_eq!(script_of(&a), script_of(&b));
        let coords = |s: &Session| -> Vec<(f64, f64, f64)> {
            s.doc()
                .expect("a drawing")
                .model
                .iter()
                .filter_map(|e| match &e.kind {
                    EntityKind::Line(l) => Some((l.b.x, l.b.y, 0.0)),
                    EntityKind::Circle(c) => Some((c.center.x, c.center.y, c.radius)),
                    EntityKind::Arc(a) => Some((a.center.x, a.center.y, a.radius)),
                    _ => None,
                })
                .collect()
        };
        assert_eq!(coords(&a), coords(&b));
        assert_eq!(coords(&a), vec![(5.0, 5.0, 0.0), (1.0, 2.0, 3.0), (0.0, 0.0, 2.0)]);
    }

    #[test]
    fn the_language_lines_write_what_the_drawing_holds() {
        let mut s = Session::new();
        run_ok(
            &mut s,
            "\
LAYER \"Walls\"
LINE 0,0 10,0
PLINE 0,0 10,0 10,5 close
CIRCLE 5,5 2.5
ARC 0,0 5 0 90
POINT 3,4
TEXT 2,2 \"Hello\" 2.5
",
        );
        let text = script_of(&s);
        assert!(text.contains("\nLAYER \"Walls\"\n"), "{text}");
        assert!(text.contains("\nLINE 0,0 10,0\n"), "{text}");
        assert!(text.contains("\nPLINE 0,0 10,0 10,5 close\n"), "{text}");
        assert!(text.contains("\nCIRCLE 5,5 2.5\n"), "{text}");
        assert!(text.contains("\nARC 0,0 5 0 90\n"), "{text}");
        assert!(text.contains("\nPOINT 3,4\n"), "{text}");
        assert!(text.contains("\nTEXT 2,2 \"Hello\" 2.5\n"), "{text}");
        // A drawing the language has no line for: a comment, never a silent loss.
        let mut d = cadcraft_doc::Drawing::new_imperial();
        let m = cadcraft_doc::Space::Model;
        let _ = d.add(
            &m,
            cadcraft_doc::Common::default(),
            EntityKind::Ray(cadcraft_doc::RayLine { base: cadcraft_geom::Vec3::ZERO, dir: cadcraft_geom::Vec3::new(1.0, 0.0, 0.0) }),
        );
        let text = to_script(&d);
        assert!(text.contains("; RAY (not in the script language yet)"), "{text}");
    }

    /// The defect a reader found by pressing Rebuild: running a drawing's own script must replace
    /// it, not add a second copy of everything.
    #[test]
    fn a_replace_rebuild_does_not_duplicate_the_drawing() {
        let mut s = Session::new();
        run_ok(&mut s, "LAYER \"A\"\nLINE 0,0 10,0\nCIRCLE 5,5 2\n");
        let first = script_of(&s);
        assert_eq!(s.doc().expect("a drawing").model.len(), 2);
        let r = run_replace(&mut s, &first);
        assert!(r.ok, "{:?}", r.error);
        assert_eq!(s.doc().expect("a drawing").model.len(), 2, "a rebuild of the drawing's own script replaces it");
        assert_eq!(script_of(&s), first, "and the drawing is unchanged");
        // Twice more: still two entities (the fixpoint holds through the button's path too).
        let _ = run_replace(&mut s, &first);
        assert_eq!(s.doc().expect("a drawing").model.len(), 2);
        // One undo step restores what was there before the rebuild.
        let label = s.undo().expect("an undo step").unwrap_or_default();
        assert_eq!(label, "CadScript rebuild");
    }

    /// A rebuild that fails changes nothing: a typo cannot eat a drawing.
    #[test]
    fn a_failed_replace_rebuild_restores_the_drawing() {
        let mut s = Session::new();
        run_ok(&mut s, "LAYER \"A\"\nLINE 0,0 10,0\nLINE 10,0 10,10\n");
        let before = script_of(&s);
        let r = run_replace(&mut s, "LAYER \"A\"\nLINE 0,0 1,1\nCIRCLE 1,1\n");
        assert!(!r.ok, "the bad line must fail the run");
        assert!(r.error.clone().unwrap_or_default().contains("line 3"), "{:?}", r.error);
        assert_eq!(script_of(&s), before, "the drawing is exactly as it was");
        assert!(r.output.iter().any(|l| l.contains("restored")), "{:?}", r.output);
    }

    /// Objects the language cannot write back are kept, not eaten: a rebuild of a drawing with a
    /// block reference and a dimension keeps both, and only the rebuildable kinds are replaced.
    #[test]
    fn a_replace_rebuild_keeps_what_the_language_cannot_write() {
        let mut s = Session::new();
        run_ok(&mut s, "LAYER \"A\"\nLINE 0,0 10,0\n");
        // A block reference and a dimension, put on the document directly: no CadScript line for
        // either, so a rebuild must leave them alone.
        {
            let st = s.state_mut().expect("a drawing");
            let doc = std::sync::Arc::make_mut(&mut st.doc);
            let mut block = cadcraft_doc::Block::new("B");
            block.entities.push(cadcraft_doc::Entity {
                handle: cadcraft_doc::Handle(0x900),
                common: cadcraft_doc::Common::default(),
                kind: EntityKind::Line(cadcraft_doc::Line { a: cadcraft_geom::Vec3::ZERO, b: cadcraft_geom::Vec3::new(1.0, 0.0, 0.0) }),
            });
            doc.blocks.insert("B".into(), std::sync::Arc::new(block));
            doc.add(
                &cadcraft_doc::Space::Model,
                cadcraft_doc::Common::default(),
                EntityKind::Insert(cadcraft_doc::Insert {
                    block: "B".into(),
                    insert: cadcraft_geom::Vec3::new(20.0, 20.0, 0.0),
                    scale: cadcraft_geom::Vec3::new(1.0, 1.0, 1.0),
                    rotation: 0.0,
                    attribs: Vec::new(),
                    cols: 1,
                    rows: 1,
                    col_spacing: 0.0,
                    row_spacing: 0.0,
                }),
            )
            .expect("an insert");
            let dim = cadcraft_doc::Dimension {
                kind: cadcraft_doc::DimKind::Linear { rotation: 0.0 },
                defpt: cadcraft_geom::Vec3::new(5.0, -3.0, 0.0),
                text_mid: cadcraft_geom::Vec3::new(5.0, -3.0, 0.0),
                text: String::new(),
                style: String::new(),
                measurement: 10.0,
                text_rotation: 0.0,
                user_text_pos: false,
                p13: cadcraft_geom::Vec3::ZERO,
                p14: cadcraft_geom::Vec3::ZERO,
                p15: cadcraft_geom::Vec3::ZERO,
                p16: cadcraft_geom::Vec3::ZERO,
                block: None,
                overrides: serde_json::Map::new(),
                assoc: Vec::new(),
                marks: cadcraft_doc::DimMarks::default(),
            };
            doc.add(&cadcraft_doc::Space::Model, cadcraft_doc::Common::default(), EntityKind::Dimension(dim)).expect("a dimension");
        }
        let kinds = |s: &Session| -> Vec<&'static str> {
            s.doc()
                .expect("a drawing")
                .model
                .iter()
                .map(|e| match e.kind {
                    EntityKind::Line(_) => "line",
                    EntityKind::Insert(_) => "insert",
                    EntityKind::Dimension(_) => "dimension",
                    _ => "other",
                })
                .collect()
        };
        let was = kinds(&s);
        assert!(was.contains(&"insert") && was.contains(&"dimension"), "{was:?}");
        let before = s.doc().expect("a drawing").model.len();
        let text = script_of(&s);
        let r = run_replace(&mut s, &text);
        assert!(r.ok, "{:?}", r.error);
        let now = kinds(&s);
        assert_eq!(now.iter().filter(|k| **k == "insert").count(), 1, "the block reference is kept: {now:?}");
        assert_eq!(now.iter().filter(|k| **k == "dimension").count(), 1, "the dimension is kept: {now:?}");
        assert_eq!(now.iter().filter(|k| **k == "line").count(), 1, "the line is replaced, not doubled: {now:?}");
        assert_eq!(s.doc().expect("a drawing").model.len(), before, "nothing was added or lost");
        assert!(r.output.iter().any(|l| l.contains("kept")), "{:?}", r.output);
    }
}
