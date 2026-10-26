//! `run`: the assistant's one tool — it runs code in the live drawing's namespace.
//!
//! This is the only command the tool surface advertises, and it is an ordinary command like the
//! rest: the command line, scripts, the CLI, the control channel and MCP all reach it the same
//! way. What it does is small on purpose — take code, run it in the drawing's LISP namespace
//! ([`crate::lisp::agent`] holds the vocabulary), keep the definitions it wrote, and report what
//! happened. Everything else is reached *from* the code, which is why there is no verb per
//! capability anywhere in the tool surface.
//!
//! Empty code returns the manual: the namespace, and what the application offers.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::bad;
use crate::lisp::agent;
use crate::lisp::value::{Value as Lv, to_text};
use crate::{CommandSpec, Result, Session};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("run", "Run Code", run_code)
            .alias(&["code", "assistant-run"])
            .params(
                "{code?: LISP source (empty: the manual), values?: {name: text}} → {manual? | value, output, kept?, forgotten?, broken?, images?, error?}",
            )
            // A run makes its own undo step (the LISP machine snapshots the drawing), like `lisp`.
            .noundo(),
    ]
}

/// The report of one run: what it printed, what it was worth, what it kept, what it drew.
fn report(s: &Session, from_log: usize, r: Option<std::result::Result<Lv, String>>) -> Value {
    let output: Vec<String> = s.log.get(from_log..).map(|l| l.to_vec()).unwrap_or_default();
    match r {
        Some(Ok(v)) => json!({ "value": to_text(&v, true), "output": output }),
        Some(Err(e)) => json!({ "error": e, "output": output }),
        None => json!({ "output": output }),
    }
}

fn run_code(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "run";
    let code = p.get("code").and_then(Value::as_str).unwrap_or("");
    if code.trim().is_empty() {
        return Ok(json!({ "manual": agent::manual() }));
    }
    let values: HashMap<String, String> = match p.get("values") {
        None | Some(Value::Null) => HashMap::new(),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(k, v)| {
                let text = match v {
                    Value::String(t) => Ok(t.clone()),
                    // Anything else is passed as its JSON, so a number or a nested object can be
                    // handed over without the caller quoting it.
                    other => serde_json::to_string(other).map_err(|e| bad(cmd, format!("`values.{k}`: {e}"))),
                };
                text.map(|t| (k.clone(), t))
            })
            .collect::<Result<_>>()?,
        Some(_) => return Err(bad(cmd, "`values` must be an object of texts")),
    };

    // The kept definitions are loaded before the first run in a drawing (a headless session may
    // never tick), so a helper from a previous session is there when the code needs it.
    s.lisp_load_definitions();
    s.lisp_begin_run(values);

    let from_log = s.log.len();
    let run = s.lisp_eval(code, false, true, Vec::new()).map_err(|e| bad(cmd, e.to_string()))?;
    let mut out = report(s, from_log, run);
    let failed = out.get("error").is_some();

    // Keep what the code defined — but only what is live in the namespace now, so a definition
    // that failed to take (or a `setq` that did work) is never written as if it were a helper.
    let mut kept = Vec::new();
    let mut refused = Vec::new();
    for (name, source) in agent::definitions_in(code) {
        if agent::shadows_builtin(&name) {
            // The run may have written over a built-in (AutoLISP allows it); put the language
            // back and report it, so the next call is not quietly broken.
            s.lisp_restore_builtin(&name);
            refused.push(name);
            continue;
        }
        if s.lisp_var(&name).is_nil() {
            continue;
        }
        match agent::save(&name, &source) {
            Ok(()) => kept.push(name),
            Err(e) => return Err(bad(cmd, format!("could not keep `{name}`: {e}"))),
        }
    }
    if !kept.is_empty() {
        out["kept"] = json!(kept);
    }
    if !refused.is_empty() {
        out["refused"] = json!(refused);
    }
    let broken: Vec<Value> = s.lisp_take_broken_definitions().into_iter().map(|(n, why)| json!({"name": n, "error": why})).collect();
    if !broken.is_empty() {
        out["broken"] = Value::Array(broken);
    }
    let images = s.lisp_take_images();
    if !images.is_empty() {
        out["images"] = json!(images);
    }
    if failed {
        // A run that errored still printed what it printed; the caller decides what to say.
        out["failed"] = json!(true);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Session;

    fn run(s: &mut Session, code: &str) -> Value {
        run_code(s, &json!({ "code": code })).expect("the command ran")
    }

    #[test]
    fn empty_code_returns_the_manual() {
        let mut s = Session::new();
        let r = run_code(&mut s, &json!({})).unwrap();
        assert!(r["manual"].as_str().unwrap().contains("(commands)"), "{r}");
        assert!(r["manual"].as_str().unwrap().contains("(cmd "));
    }

    #[test]
    fn code_runs_in_the_drawing_and_reports_its_value_and_output() {
        let mut s = Session::new();
        let r = run(&mut s, r#"(princ "hello") (+ 1 2)"#);
        assert_eq!(r["value"], "3", "{r}");
        assert!(r["output"].as_array().unwrap().iter().any(|l| l.as_str() == Some("hello")), "{r}");
    }

    #[test]
    fn a_helper_defined_in_one_call_is_usable_in_the_next() {
        let mut s = Session::new();
        let r = run(&mut s, "(defun CADCRAFT-TEST-DOUBLE (x) (* x 2))");
        assert_eq!(r["kept"], json!(["CADCRAFT-TEST-DOUBLE"]), "{r}");
        let r = run(&mut s, "(CADCRAFT-TEST-DOUBLE 21)");
        assert_eq!(r["value"], "42", "{r}");
        // And it is on disk, so a fresh session has it too.
        assert!(agent::list().contains(&"CADCRAFT-TEST-DOUBLE".to_string()));
        let mut fresh = Session::new();
        let r = run(&mut fresh, "(CADCRAFT-TEST-DOUBLE 4)");
        assert_eq!(r["value"], "8", "a new session loaded the kept definition: {r}");
        // `(forget …)` removes it.
        let r = run(&mut s, r#"(forget "CADCRAFT-TEST-DOUBLE")"#);
        assert_eq!(r["value"], "T", "{r}");
        assert!(!agent::list().contains(&"CADCRAFT-TEST-DOUBLE".to_string()));
        let mut after = Session::new();
        let r = run(&mut after, "(CADCRAFT-TEST-DOUBLE 4)");
        assert!(r.get("error").is_some(), "the definition is gone: {r}");
    }

    #[test]
    fn a_command_runs_from_code_and_changes_the_drawing() {
        let mut s = Session::new();
        let r = run(&mut s, r#"(cmd "circle" '((CENTER . (0 0)) (RADIUS . 5)))"#);
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(r["value"], "((HANDLE . \"100\"))", "{r}");
        let r = run(&mut s, r#"(cmd "entities" '((TYPE . "Circle")))"#);
        let text = r["value"].as_str().unwrap();
        assert!(text.contains("COUNT . 1"), "{text}");
        assert!(text.contains("RADIUS . 5"), "{text}");
    }

    #[test]
    fn the_manual_s_vocabulary_works() {
        let mut s = Session::new();
        let r = run(&mut s, "(length (commands))");
        let n: f64 = r["value"].as_str().unwrap().parse().unwrap();
        assert!(n > 100.0, "the command catalog is listed: {r}");
        let r = run(&mut s, r#"(commands "circ")"#);
        assert!(r["value"].as_str().unwrap().contains("\"circle\""), "{r}");
        let r = run(&mut s, r#"(cdr (assoc 'PARAMS (describe "circle")))"#);
        assert!(r["value"].as_str().unwrap().contains("center"), "the real parameter names: {r}");
        let r = run(&mut s, "(cdr (assoc 'OBJECTS (describe)))");
        assert_eq!(r["value"], "0", "{r}");
    }

    #[test]
    fn named_values_arrive_without_escaping() {
        let mut s = Session::new();
        let code = r#"(strlen (value "payload"))"#;
        let payload = "a\"quoted\" line\nand another";
        let r = run_code(&mut s, &json!({"code": code, "values": {"payload": payload}})).unwrap();
        assert_eq!(r["value"], payload.chars().count().to_string(), "{r}");
        let r = run_code(&mut s, &json!({"code": r#"(values)"#, "values": {"b": "2", "a": "1"}})).unwrap();
        assert_eq!(r["value"], "(\"a\" \"b\")", "{r}");
    }

    #[test]
    fn a_broken_definition_does_not_stop_the_next_session() {
        let mut s = Session::new();
        let r = run(&mut s, "(defun CADCRAFT-TEST-BROKEN (x) (no-such-function x))");
        assert_eq!(r["kept"], json!(["CADCRAFT-TEST-BROKEN"]), "the definition itself parsed: {r}");
        // A file that cannot be read as LISP at all is reported and skipped.
        agent::save("CADCRAFT-TEST-GARBAGE", "(defun CADCRAFT-TEST-GARBAGE (").expect("save");
        let mut fresh = Session::new();
        let r = run(&mut fresh, "42");
        assert_eq!(r["value"], "42", "the session still works: {r}");
        let broken = r["broken"].as_array().cloned().unwrap_or_default();
        assert!(broken.iter().any(|b| b["name"] == "CADCRAFT-TEST-GARBAGE"), "{r}");
        agent::delete("CADCRAFT-TEST-BROKEN");
        agent::delete("CADCRAFT-TEST-GARBAGE");
    }

    #[test]
    fn a_definition_cannot_shadow_a_builtin() {
        let mut s = Session::new();
        let r = run(&mut s, "(defun CAR (x) 1)");
        assert_eq!(r["refused"], json!(["CAR"]), "{r}");
        assert!(r.get("kept").is_none(), "{r}");
        let r = run(&mut s, "(car '(7 8))");
        assert_eq!(r["value"], "7", "the builtin still works: {r}");
    }

    #[test]
    fn the_manual_s_call_shapes_all_work() {
        // Every shape the manual prints, so the manual cannot drift from the code.
        let mut s = Session::new();
        for (code, expect) in [
            (r#"(render)"#, "PATH"),
            (r#"(render 400 300)"#, "WIDTH . 400"),
            (r#"(render "D:/cadcraft/.scratch/manual-shape.png" 200 100)"#, "BYTES"),
            (r#"(render 400 300 0 0 10 5)"#, "WIDTH . 400"),
        ] {
            let r = run(&mut s, code);
            assert!(r.get("error").is_none(), "{code}: {r}");
            assert!(r["value"].as_str().unwrap().contains(expect), "{code}: {r}");
        }
        let _ = std::fs::remove_file("D:/cadcraft/.scratch/manual-shape.png");
        // `(cmdline …)` takes the same lines a person types, including `@dx,dy` and Enter.
        run(&mut s, r#"(cmdline "line" "0,0" "@10,0" "@0,5" "")"#);
        let r = run(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Line")))))"#);
        assert_eq!(r["value"], "2", "relative coordinates are understood: {r}");
        // And `(commands)` / `(describe)` / `(value)` / `(kept)` / `(man)`.
        for code in [r#"(length (commands))"#, r#"(cdr (assoc 'PARAMS (describe "line")))"#, r#"(values)"#, r#"(kept)"#, r#"(man)"#] {
            let r = run(&mut s, code);
            assert!(r.get("error").is_none(), "{code}: {r}");
        }
        let r = run_code(&mut s, &json!({"code": r#"(value "x")"#, "values": {"x": "payload"}})).unwrap();
        assert_eq!(r["value"], "\"payload\"", "{r}");
    }

    #[test]
    fn a_render_hands_back_a_png_the_caller_can_show() {
        let mut s = Session::new();
        run(&mut s, r#"(cmd "line" '((POINTS . ((0 0) (10 0)))))"#);
        let r = run(&mut s, "(render)");
        let text = r["value"].as_str().unwrap().to_string();
        assert!(text.contains("PATH"), "{text}");
        assert!(text.contains("BYTES"), "{text}");
        // The report lists the file so the caller can show the picture.
        let images = r["images"].as_array().expect("the report lists the picture");
        assert_eq!(images.len(), 1);
        let path = images[0].as_str().unwrap().to_string();
        let bytes = std::fs::read(&path).expect("the PNG exists");
        assert!(bytes.starts_with(b"\x89PNG"), "a real PNG: {path}");
        assert!(!r["value"].as_str().unwrap().contains(&path), "the value text escapes the path; the images list is raw");
        let _ = std::fs::remove_file(&path);
    }
}
