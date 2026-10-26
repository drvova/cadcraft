//! The assistant's namespace: what a model drives CADCraft with, in AutoLISP.
//!
//! One tool runs code, and this is the vocabulary that code speaks. It is seeded into every
//! drawing's LISP environment alongside the ordinary AutoLISP builtins, so a model writes
//! `(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))` the way a drafter types `CIRCLE`, and
//! composes helpers out of the same functions a person would use at the command line.
//!
//! | function | does |
//! |---|---|
//! | `(commands [filter])` | every command: id, label, aliases, parameters, enabled |
//! | `(cmd "id" params?)` | run any command with JSON parameters — the same door a script uses |
//! | `(cmdline "line" …)` | type lines at the command line exactly like a person |
//! | `(inspect)` | the drawing's summary (counts, extents, layers, blocks, selection) |
//! | `(describe [x])` | what the application, a command, a function or a value is |
//! | `(render [path] [w h [x0 y0 x1 y1]])` | draw the drawing to a PNG and show it to the model |
//! | `(value "name")`, `(values)` | the named strings passed beside the code |
//! | `(kept)`, `(forget "name")` | the definitions kept across restarts |
//! | `(man)` | this manual |
//!
//! Definitions the model writes (`defun`, `defun-q`, and `setq` of a literal) are saved to
//! [`crate::paths::definitions_dir`] after a run and loaded back at the start of a drawing's
//! session, so a helper written once is there tomorrow — in this process and in the next.

use std::path::PathBuf;

use serde_json::{Map, Value as Json};

use super::builtins::{self, args_err};
use super::eval::{Ctx, Flow};
use super::value::{Builtin, BuiltinKind, Sym, Value};
use super::{Env, LispError};
use crate::Session;

/// The manual: the namespace, how to work, and what the application offers. Returned by
/// `(man)`, by the `run` command with empty code, and printed by the tool's own description.
pub fn manual() -> String {
    let commands = crate::cmd::command_specs().len();
    format!(
        "\
CADCraft's assistant namespace — AutoLISP, running inside the open drawing.

THE DRAWING IS THE OBJECT. There is one open at a time and you are already inside it; every
command acts on it and every change is one undo step you can be asked to undo.

RUN COMMANDS
  (commands)                  every command: ((ID . \"line\") (LABEL . \"Line\") (ALIASES . (\"l\")) (PARAMS . \"…\") (ENABLED . 1) …)
  (commands \"circ\")           only commands whose id, label or alias contains \"circ\"
  (cmd \"id\" params)           run a command with parameters — the same call a script makes.
                              Parameters are an alist with symbol keys; points are (x y), lengths plain.
                                (cmd \"line\" '((POINTS . ((0 0) (10 0)))))
                                (cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5)))
                                (cmd \"entities\" '((TYPE . \"Circle\")))
                                (cmd \"describe\")                 the measured report of the drawing
                                (cmd \"techsheet\")                stones, carats and metal weight
                                (cmd \"saveas\" '((PATH . \"out.dxf\")))
                                (cmd \"scale\" '((HANDLES . (\"10A\")) (WIDTH . 30)))
                              A command's own parameters are in (commands) and (describe \"id\").
                              T is true and nil is false; leave a parameter out to keep the
                              command's own default.
  (cmdline \"line\" \"0,0\" \"10,0\")  type lines at the command line exactly like a person, in order —
                              for commands that ask questions (keywords, points, distances)
  (inspect)                   counts, extents, layers, styles, blocks, layouts, selection, undo
  (describe)                  this application and the open drawing, in one call
  (describe \"circle\")         one command: label, aliases, parameters, whether it can run
  (describe 'FOO)             a function: its parameters; a list: its keys; a value: its type
  (render)                    draw the drawing to a PNG and return ((PATH . \"…\") (WIDTH . 1600) …)
  (render \"out.png\" 1200 800)   …at a size; add x0 y0 x1 y1 to show just that window

VALUES AND HELPERS
  (value \"name\")              a long text passed beside the code as {{values: {{name: \"…\"}}}} —
                              the way to hand over a payload, or a Windows path whose
                              backslashes a LISP string would otherwise eat
  (values)                    the names that were passed
  (kept)                      the definitions kept across restarts
  (forget \"name\")             delete one
  (man)                       this manual

WHAT YOU CAN WRITE
  Ordinary AutoLISP: (defun c:MYTOOL (…)), (setq …), (if …), (foreach …), (mapcar …), strings,
  numbers, lists, (getvar \"CLAYER\"), (ssget), (entget), (polar), (distance) — the whole language,
  on the live drawing. Everything you define with (defun NAME …) or (setq NAME literal) is KEPT
  and reloaded in your next session, so build your own tooling: measure it once, reuse it always.

PRINTING
  (princ \"…\") prints a line; the last value of the code is reported back to you as well.

{commands} commands are available. Start with (commands), then (describe \"id\") for one you mean
to use. Never guess a parameter name: (commands) and (describe) have the real ones.
"
    )
}

/// Install the namespace's functions into a drawing's environment.
pub fn install(env: &mut Env) {
    for b in BUILTINS {
        env.globals.insert(Sym::new(b.name), Value::Subr(b));
    }
}

static BUILTINS: &[Builtin] = &[
    Builtin { name: "COMMANDS", kind: BuiltinKind::Ctx(commands) },
    Builtin { name: "CMD", kind: BuiltinKind::Ctx(cmd) },
    Builtin { name: "CMDLINE", kind: BuiltinKind::Ctx(cmdline) },
    Builtin { name: "INSPECT", kind: BuiltinKind::Ctx(inspect) },
    Builtin { name: "DESCRIBE", kind: BuiltinKind::Ctx(describe) },
    Builtin { name: "RENDER", kind: BuiltinKind::Ctx(render) },
    Builtin { name: "VALUE", kind: BuiltinKind::Ctx(value) },
    Builtin { name: "VALUES", kind: BuiltinKind::Ctx(values) },
    Builtin { name: "KEPT", kind: BuiltinKind::Pure(kept) },
    Builtin { name: "FORGET", kind: BuiltinKind::Ctx(forget) },
    Builtin { name: "MAN", kind: BuiltinKind::Pure(man) },
];

// ---------------- JSON in the namespace ----------------

/// A JSON value as LISP: objects become alists with symbol keys, so `(cdr (assoc 'COUNT r))` works
/// the way a drafter would write it. Arrays become lists, numbers stay numbers, `true` is `T`,
/// `false` and `null` are nil.
pub fn json_to_lisp(v: &Json) -> Value {
    let mut budget = JSON_TO_LISP_BUDGET;
    json_to_lisp_bounded(v, 0, &mut budget)
}

/// The largest number of JSON elements one conversion expands, and how deep it follows.
const JSON_TO_LISP_BUDGET: u64 = 2_000_000;
const JSON_TO_LISP_MAX_DEPTH: usize = 256;

fn json_to_lisp_bounded(v: &Json, depth: usize, budget: &mut u64) -> Value {
    if depth > JSON_TO_LISP_MAX_DEPTH || *budget == 0 {
        return Value::Nil;
    }
    *budget -= 1;
    match v {
        Json::Null => Value::Nil,
        Json::Bool(b) => Value::bool(*b),
        Json::Number(n) => match n.as_i64().and_then(|i| i32::try_from(i).ok()) {
            Some(i) => Value::Int(i),
            None => Value::Real(n.as_f64().unwrap_or(0.0)),
        },
        Json::String(s) => Value::str(s),
        Json::Array(items) => Value::list(items.iter().map(|x| json_to_lisp_bounded(x, depth + 1, budget)).collect::<Vec<_>>()),
        Json::Object(map) => {
            Value::list(map.iter().map(|(k, x)| Value::cons(Value::sym(k), json_to_lisp_bounded(x, depth + 1, budget))).collect::<Vec<_>>())
        }
    }
}

/// A LISP value as JSON, the other way: an alist (a list of `(key . value)` pairs with symbol
/// keys) becomes an object, any other list an array.
///
/// **`T` is true and `nil` is false**, which is what they mean in LISP — a command parameter that
/// takes a boolean is written `(CROSSING . nil)`. A parameter the code does not want to pass at
/// all is left out of the alist, not set to nil: an absent key is absence, which is what a
/// command's own defaults are for. (An empty list is nil too, so write "no handles" by omitting
/// the key rather than by passing a list that came out empty.)
pub fn lisp_to_json(v: &Value) -> Json {
    let mut budget = JSON_TO_LISP_BUDGET;
    lisp_to_json_bounded(v, 0, &mut budget)
}

fn lisp_to_json_bounded(v: &Value, depth: usize, budget: &mut u64) -> Json {
    if depth > JSON_TO_LISP_MAX_DEPTH || *budget == 0 {
        return Json::Null;
    }
    *budget -= 1;
    match v {
        Value::Nil => Json::Bool(false),
        Value::Int(i) => Json::from(*i),
        Value::Real(r) => serde_json::Number::from_f64(*r).map_or(Json::Null, Json::Number),
        Value::Str(s) => Json::from(&**s),
        Value::Sym(s) if s.name() == "T" => Json::Bool(true),
        Value::Sym(s) => Json::from(s.name()),
        Value::Cons(_) => {
            // An alist: every element is a pair whose head is a symbol.
            let items = v.to_vec();
            let alist = !items.is_empty() && items.iter().all(|e| matches!(e, Value::Cons(c) if matches!(c.car, Value::Sym(_))));
            if alist {
                let mut map = Map::new();
                for e in &items {
                    let key = e.car().as_sym().map(|s| s.name().to_ascii_lowercase()).unwrap_or_default();
                    map.insert(key, lisp_to_json_bounded(&e.cdr(), depth + 1, budget));
                }
                Json::Object(map)
            } else {
                Json::Array(items.iter().map(|x| lisp_to_json_bounded(x, depth + 1, budget)).collect())
            }
        }
        other => Json::from(super::value::to_text(other, false)),
    }
}

// ---------------- the drawing's own commands ----------------

/// `(commands [filter])`.
fn commands(_ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.len() > 1 {
        return Err(args_err(false));
    }
    let filter = match a.first() {
        None | Some(Value::Nil) => None,
        Some(v) => Some(as_text(v)?.to_ascii_lowercase()),
    };
    let out: Vec<Value> = crate::cmd::command_specs()
        .iter()
        .map(|c| c.info(&Session::new()))
        .filter(|info| {
            filter.as_ref().is_none_or(|f| {
                info.id.to_ascii_lowercase().contains(f)
                    || info.label.to_ascii_lowercase().contains(f)
                    || info.aliases.iter().any(|x| x.to_ascii_lowercase().contains(f))
            })
        })
        .map(|info| {
            Value::list(vec![
                Value::cons(Value::sym("ID"), Value::str(info.id)),
                Value::cons(Value::sym("LABEL"), Value::str(info.label)),
                Value::cons(Value::sym("ALIASES"), Value::list(info.aliases.iter().map(|x| Value::str(x)).collect::<Vec<_>>())),
                Value::cons(Value::sym("PARAMS"), Value::str(info.params)),
                Value::cons(Value::sym("ENABLED"), Value::bool(info.enabled)),
                Value::cons(Value::sym("INTERACTIVE"), Value::bool(info.interactive)),
            ])
        })
        .collect();
    Ok(Flow::Value(Value::list(out)))
}

/// `(cmd "id" params?)` — the same call a script, the CLI and MCP make.
fn cmd(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.is_empty() || a.len() > 2 {
        return Err(args_err(a.is_empty()));
    }
    let id = as_text(&a[0])?;
    let params = match a.get(1) {
        None | Some(Value::Nil) => Json::Object(Map::new()),
        Some(v) => lisp_to_json(v),
    };
    match ctx.s.execute(&id, &params) {
        Ok(v) => Ok(Flow::Value(json_to_lisp(&v))),
        Err(e) => Err(LispError::new(e.to_string())),
    }
}

/// `(cmdline "line" …)` — type at the command line like a person, in order. Each line goes
/// through the command line's own parser, so `0,0`, `@10,0`, `@5<45`, a distance, a keyword and
/// an empty line (Enter) all mean what they mean when a person types them.
fn cmdline(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.is_empty() {
        return Err(args_err(true));
    }
    let mut lines = Vec::with_capacity(a.len());
    for v in &a {
        lines.push(as_text(v)?);
    }
    for line in &lines {
        if let Err(e) = ctx.s.cmdline(line) {
            return Err(LispError::new(e.to_string()));
        }
    }
    let prompt = ctx.s.prompt_text();
    Ok(Flow::Value(Value::list(vec![
        Value::cons(Value::sym("PROMPT"), Value::str(&prompt)),
        Value::cons(Value::sym("RUNNING"), ctx.s.running.as_ref().map_or(Value::Nil, |r| Value::str(&r.id))),
        Value::cons(Value::sym("OUTPUT"), Value::list(ctx.s.log.iter().rev().take(12).rev().map(|l| Value::str(l)).collect::<Vec<_>>())),
    ])))
}

/// `(inspect)` — the drawing's summary.
fn inspect(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.len() > 1 {
        return Err(args_err(false));
    }
    let params = match a.first() {
        None | Some(Value::Nil) => Json::Object(Map::new()),
        Some(v) => lisp_to_json(v),
    };
    match ctx.s.execute("drawing.inspect", &params) {
        Ok(v) => Ok(Flow::Value(json_to_lisp(&v))),
        Err(e) => Err(LispError::new(e.to_string())),
    }
}

/// `(describe)` / `(describe x)` — what the application, a command, a function or a value is.
fn describe(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.len() > 1 {
        return Err(args_err(false));
    }
    match a.first() {
        None | Some(Value::Nil) => {
            let mut out = vec![
                Value::cons(Value::sym("APPLICATION"), Value::str("CADCraft")),
                Value::cons(Value::sym("COMMANDS"), Value::Int(crate::cmd::command_specs().len() as i32)),
            ];
            match ctx.s.state() {
                Ok(st) => {
                    let ext = st.doc.extents(&st.space);
                    out.push(Value::cons(Value::sym("DRAWING"), Value::str(&st.title)));
                    out.push(Value::cons(Value::sym("SPACE"), Value::str(st.space.tab_name())));
                    out.push(Value::cons(Value::sym("OBJECTS"), Value::Int(st.doc.space(&st.space).map_or(0, |s| s.len()) as i32)));
                    out.push(Value::cons(Value::sym("SELECTED"), Value::Int(st.selection.len() as i32)));
                    out.push(Value::cons(
                        Value::sym("EXTENTS"),
                        if ext.is_empty() {
                            Value::Nil
                        } else {
                            Value::list(vec![Value::point(&[ext.min.x, ext.min.y]), Value::point(&[ext.max.x, ext.max.y])])
                        },
                    ));
                }
                Err(e) => out.push(Value::cons(Value::sym("ERROR"), Value::str(&e.to_string()))),
            }
            Ok(Flow::Value(Value::list(out)))
        }
        // A string names a command.
        Some(Value::Str(s)) => {
            let want = s.to_ascii_lowercase();
            let spec = crate::cmd::command_specs()
                .iter()
                .find(|c| c.id == want || c.aliases.iter().any(|x| *x == want))
                .ok_or_else(|| LispError::new(format!("no command `{s}`; (commands) lists them")))?;
            let info = spec.info(ctx.s);
            Ok(Flow::Value(Value::list(vec![
                Value::cons(Value::sym("ID"), Value::str(info.id)),
                Value::cons(Value::sym("LABEL"), Value::str(info.label)),
                Value::cons(Value::sym("MENU"), Value::list(info.menu.iter().map(|m| Value::str(m)).collect::<Vec<_>>())),
                Value::cons(Value::sym("ALIASES"), Value::list(info.aliases.iter().map(|x| Value::str(x)).collect::<Vec<_>>())),
                Value::cons(Value::sym("PARAMS"), Value::str(info.params)),
                Value::cons(Value::sym("ENABLED"), Value::bool(info.enabled)),
                Value::cons(Value::sym("WHY_NOT"), info.disabled_reason.as_deref().map_or(Value::Nil, Value::str)),
                Value::cons(Value::sym("INTERACTIVE"), Value::bool(info.interactive)),
                Value::cons(Value::sym("EXAMPLE"), Value::str(example_for(info.id))),
            ])))
        }
        Some(v @ (Value::Sym(_) | Value::Func(_) | Value::Subr(_))) => Ok(Flow::Value(describe_value(v))),
        Some(v) => Ok(Flow::Value(describe_value(v))),
    }
}

/// What a value is: its type, and for functions their parameters; for an alist its keys.
fn describe_value(v: &Value) -> Value {
    let mut out = vec![
        Value::cons(Value::sym("TYPE"), Value::str(v.type_name().unwrap_or("NIL"))),
        Value::cons(Value::sym("VALUE"), Value::str(&super::value::to_text(v, true))),
    ];
    match v {
        Value::Func(f) => {
            out.push(Value::cons(Value::sym("PARAMS"), Value::list(f.params.iter().map(|p| Value::str(p.name())).collect::<Vec<_>>())));
            out.push(Value::cons(Value::sym("LOCALS"), Value::list(f.locals.iter().map(|p| Value::str(p.name())).collect::<Vec<_>>())));
            if let Some(n) = &f.name {
                out.push(Value::cons(Value::sym("NAME"), Value::str(n.name())));
            }
        }
        Value::Subr(b) => {
            let kind = match b.kind {
                BuiltinKind::Pure(_) => "function",
                BuiltinKind::Ctx(_) => "function (drawing access)",
                BuiltinKind::Special(_) => "special form",
            };
            out.push(Value::cons(Value::sym("NAME"), Value::str(b.name)));
            out.push(Value::cons(Value::sym("KIND"), Value::str(kind)));
        }
        Value::Cons(_) => {
            let keys: Vec<Value> = v.to_vec().iter().filter_map(|e| e.car().as_sym().map(|s| Value::str(s.name()))).collect();
            if !keys.is_empty() {
                out.push(Value::cons(Value::sym("KEYS"), Value::list(keys)));
            }
        }
        _ => {}
    }
    Value::list(out)
}

/// A one-line example for a command, when one is worth showing.
fn example_for(id: &str) -> &'static str {
    match id {
        "line" => "(cmd \"line\" '((POINTS . ((0 0) (10 0)))))",
        "circle" => "(cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5)))",
        "entities" => "(cmd \"entities\" '((TYPE . \"Circle\")))",
        "describe" => "(cmd \"describe\")",
        "techsheet" => "(cmd \"techsheet\")",
        _ => "",
    }
}

/// `(render [path] [width height [x0 y0 x1 y1]])` — a PNG of the drawing, shown to the model.
///
/// The path is optional and comes first when it is there: `(render)`, `(render 800 600)`,
/// `(render "out.png" 1200 800)`, `(render 800 600 0 0 10 5)`.
fn render(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.len() > 7 {
        return Err(args_err(false));
    }
    let mut args = a.as_slice();
    let path = match args.first() {
        Some(Value::Str(s)) => {
            args = &args[1..];
            Some(PathBuf::from(&**s))
        }
        _ => None,
    };
    let number = |i: usize| -> Result<Option<f64>, LispError> {
        match args.get(i) {
            None | Some(Value::Nil) => Ok(None),
            Some(v) => v.as_number().map(Some).ok_or_else(|| LispError::bad_arg("numberp", v)),
        }
    };
    let width = number(0)?.unwrap_or(1600.0).clamp(16.0, 8192.0) as u32;
    let height = number(1)?.unwrap_or(1000.0).clamp(16.0, 8192.0) as u32;
    let window = match (number(2)?, number(3)?, number(4)?, number(5)?) {
        (Some(x0), Some(y0), Some(x1), Some(y1)) => {
            Some(cadcraft_geom::Bounds2::new(cadcraft_geom::Vec2::new(x0, y0), cadcraft_geom::Vec2::new(x1, y1)))
        }
        (None, None, None, None) => None,
        _ => return Err(LispError::new("render: a window needs all four of x0 y0 x1 y1")),
    };
    if let Some(w) = &window
        && (w.width() <= 0.0 || w.height() <= 0.0)
    {
        return Err(LispError::new("render: the window's corners must not be equal"));
    }
    let st = ctx.s.state().map_err(|e| LispError::new(e.to_string()))?;
    let png = cadcraft_io::png_framed(&st.doc, &st.space, width, height, window).map_err(|e| LispError::new(e.to_string()))?;
    let path = path.unwrap_or_else(|| {
        let n = ctx.env.images.len();
        std::env::temp_dir().join(format!("cadcraft-render-{}-{n}.png", std::process::id()))
    });
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| LispError::new(format!("render: {}: {e}", dir.display())))?;
    }
    std::fs::write(&path, &png).map_err(|e| LispError::new(format!("render: {}: {e}", path.display())))?;
    let text = path.to_string_lossy().to_string();
    ctx.env.images.push(text.clone());
    Ok(Flow::Value(Value::list(vec![
        Value::cons(Value::sym("PATH"), Value::str(&text)),
        Value::cons(Value::sym("WIDTH"), Value::Int(width as i32)),
        Value::cons(Value::sym("HEIGHT"), Value::Int(height as i32)),
        Value::cons(Value::sym("BYTES"), Value::Int(png.len() as i32)),
    ])))
}

/// A string argument, or the printed form of anything else that reads as text.
fn as_text(v: &Value) -> Result<String, LispError> {
    match v {
        Value::Str(s) => Ok(s.to_string()),
        Value::Sym(s) => Ok(s.name().to_string()),
        other => Err(LispError::bad_arg("stringp", other)),
    }
}

// ---------------- the named values ----------------

/// `(value "name")` — a long text passed beside the code.
fn value(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.len() != 1 {
        return Err(args_err(a.is_empty()));
    }
    let name = as_text(&a[0])?;
    Ok(Flow::Value(ctx.env.values.get(&name).map_or(Value::Nil, |t| Value::str(t))))
}

/// `(values)` — the names that were passed.
fn values(ctx: &mut Ctx<'_>, _a: Vec<Value>) -> Result<Flow, LispError> {
    let mut names: Vec<&String> = ctx.env.values.keys().collect();
    names.sort();
    Ok(Flow::Value(Value::list(names.iter().map(|n| Value::str(n)).collect::<Vec<_>>())))
}

// ---------------- the kept definitions ----------------

/// `(kept)` — the definitions kept across restarts.
fn kept(_a: &[Value]) -> Result<Value, LispError> {
    Ok(Value::list(list().iter().map(|n| Value::str(n)).collect::<Vec<_>>()))
}

/// `(forget "name")` — stop keeping a definition: delete its file **and** unbind it here, so it
/// is gone now and in the next session. A model that says "forget" should not be able to call it
/// five lines later.
fn forget(ctx: &mut Ctx<'_>, a: Vec<Value>) -> Result<Flow, LispError> {
    if a.len() != 1 {
        return Err(args_err(a.is_empty()));
    }
    let name = as_text(&a[0])?;
    let had_file = delete(&name);
    // Unbinding is what `(setq name nil)` does, so nothing else can reach it either.
    ctx.env.set(&Sym::new(&name), Value::Nil);
    Ok(Flow::Value(Value::bool(had_file)))
}

/// `(man)` — the manual.
fn man(_a: &[Value]) -> Result<Value, LispError> {
    Ok(Value::str(&manual()))
}

/// The directory the kept definitions live in.
pub fn dir() -> PathBuf {
    crate::paths::definitions_dir()
}

/// The file a definition is kept in. The name is a LISP symbol; anything a file name cannot hold
/// becomes `_`, and the name itself is recorded inside the file, so a mangled file name never
/// changes what the definition is called.
fn file_for(name: &str) -> PathBuf {
    let stem: String =
        name.chars().map(|c| if c.is_ascii_alphanumeric() || "_-*".contains(c) { c.to_ascii_uppercase() } else { '_' }).take(80).collect();
    let stem = if stem.is_empty() { "DEFINITION".to_string() } else { stem };
    dir().join(format!("{stem}.lsp"))
}

/// The definitions kept on disk, by name.
pub fn list() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir()) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("lsp")))
        .filter_map(|e| e.file_name().to_str().map(|s| s.trim_end_matches(".lsp").to_string()))
        .collect();
    names.sort();
    names
}

/// Keep one definition: its name and the exact source the model wrote.
pub fn save(name: &str, source: &str) -> std::io::Result<()> {
    let d = dir();
    std::fs::create_dir_all(&d)?;
    std::fs::write(file_for(name), source.trim_end())
}

/// Delete one; `false` when there was nothing to delete.
pub fn delete(name: &str) -> bool {
    let path = file_for(name);
    let existed = path.exists();
    if existed {
        let _ = std::fs::remove_file(&path);
    }
    existed
}

/// The names a run's source defines: `(defun name …)`, `(defun-q name …)`, and `(setq name
/// literal)` — the units worth keeping. A `setq` whose value is a call is work, not a definition.
pub fn definitions_in(source: &str) -> Vec<(String, String)> {
    let Ok(forms) = super::read::read_all_with_source(source) else { return Vec::new() };
    let mut out = Vec::new();
    for (form, text) in forms {
        let head = form.car();
        let name = form.cdr().car();
        let is_defun = matches!(&head, Value::Sym(s) if s.name() == "DEFUN" || s.name() == "DEFUN-Q");
        if is_defun && let Value::Sym(n) = &name {
            out.push((n.name().to_string(), text.clone()));
            continue;
        }
        if matches!(&head, Value::Sym(s) if s.name() == "SETQ") {
            // (setq A 1 B "two") — every pair whose value is a literal.
            let items = form.cdr().to_vec();
            for pair in items.chunks(2) {
                let (Some(Value::Sym(n)), Some(v)) = (pair.first(), pair.get(1)) else { continue };
                if is_literal(v) {
                    out.push((n.name().to_string(), format!("(setq {} {})", n.name(), super::value::to_text(v, true))));
                }
            }
        }
    }
    out
}

/// Whether a value can be kept as a constant: a number, a string, `T`/nil, or a quoted list.
fn is_literal(v: &Value) -> bool {
    match v {
        Value::Int(_) | Value::Real(_) | Value::Str(_) | Value::Sym(_) => true,
        // `(quote x)` reads as a list headed by QUOTE.
        Value::Cons(_) => matches!(v.car(), Value::Sym(s) if s.name() == "QUOTE"),
        _ => false,
    }
}

/// Load the kept definitions into the active drawing's namespace. Each file is evaluated on its
/// own: a broken one is reported and the rest still load, so a bad definition can never stop a
/// session from starting. Returns what was loaded and what failed.
pub fn load(s: &mut Session) -> (Vec<String>, Vec<(String, String)>) {
    let mut loaded = Vec::new();
    let mut broken = Vec::new();
    for name in list() {
        let path = dir().join(format!("{name}.lsp"));
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        match s.lisp_eval(&text, false, true, Vec::new()) {
            Ok(Some(Err(e))) => broken.push((name, e)),
            Ok(_) => loaded.push(name),
            Err(e) => broken.push((name, e.to_string())),
        }
    }
    (loaded, broken)
}

/// Which commands a definition may shadow: a helper must not silently replace a built-in.
pub fn shadows_builtin(name: &str) -> bool {
    builtins::is_builtin(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manual_names_the_vocabulary_and_the_commands() {
        let m = manual();
        for word in ["(commands", "(cmd ", "(cmdline", "(inspect)", "(describe", "(render", "(value", "(kept)", "(forget", "(man)"] {
            assert!(m.contains(word), "the manual names {word}: {m}");
        }
        assert!(m.contains("AutoLISP"), "the language is named");
        assert!(m.contains("KEPT"), "persistence is stated");
        assert!(m.contains("commands are available"), "the count is there: {m}");
    }

    #[test]
    fn json_and_lisp_round_trip_through_alists() {
        let j = serde_json::json!({"count": 3, "entities": [{"handle": "10A", "closed": true}], "off": false});
        let l = json_to_lisp(&j);
        // An object is an alist with symbol keys; an array is a list; false is nil. (Keys come
        // out in the JSON's own order.)
        assert_eq!(super::super::value::to_text(&l, true), "((COUNT . 3) (ENTITIES ((CLOSED . T) (HANDLE . \"10A\"))) (OFF))");
        // …and back, with symbol keys in the object.
        let back = lisp_to_json(&l);
        assert_eq!(back["count"], 3);
        assert_eq!(back["entities"][0]["handle"], "10A");
        assert_eq!(back["entities"][0]["closed"], true);
        assert_eq!(back["off"], false, "nil is false, so a boolean parameter round-trips");
        // A plain list is an array, not an object.
        assert_eq!(lisp_to_json(&Value::list(vec![Value::Int(1), Value::Int(2)])), serde_json::json!([1, 2]));
    }

    #[test]
    fn a_run_s_source_yields_its_definitions() {
        let src = r#"
            (defun c:WING (w) (cmd "circle" (list (cons 'CENTER (list 0 0)) (cons 'RADIUS (/ w 2)))))
            (setq SCALE 2.5)
            (setq COUNT (cmd "entities"))     ; work, not a definition
            (defun-q helper (x) (* x SCALE))
        "#;
        let defs = definitions_in(src);
        let names: Vec<&str> = defs.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["C:WING", "SCALE", "HELPER"], "{defs:?}");
        assert!(defs[0].1.starts_with("(defun c:WING"), "{}", defs[0].1);
        assert_eq!(defs[1].1, "(setq SCALE 2.5)", "a literal setq is a definition");
        assert!(defs[2].1.starts_with("(defun-q helper"), "{}", defs[2].1);
    }

    #[test]
    fn keeping_and_forgetting_a_definition_uses_an_isolated_directory() {
        // The test harness points CADCRAFT_DEFINITIONS at a throwaway path (see the engine tests).
        let name = "CADCRAFT-TEST-KEEP";
        assert!(!list().contains(&name.to_string()));
        save(name, "(defun CADCRAFT-TEST-KEEP (x) (+ x 1))").expect("save");
        assert!(list().contains(&name.to_string()));
        let text = std::fs::read_to_string(file_for(name)).expect("read");
        assert!(text.contains("CADCRAFT-TEST-KEEP"));
        assert!(delete(name), "it was there");
        assert!(!list().contains(&name.to_string()));
        assert!(!delete(name), "and now it is not");
    }
}
