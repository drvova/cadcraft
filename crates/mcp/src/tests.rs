//! An agent completes realistic drafting tasks through MCP only, and verifies through MCP only —
//! and it does all of it through the **one** tool, `run`, by writing AutoLISP.
//!
//! These are the capability flows the server had before the surface became one tool: drawing a
//! plate with holes, querying entities by window, reading texts, tracing a picture, scoping a
//! report. Every one of them is driven here through `run` and nothing else, so this file is also
//! the proof that a capability is not lost by not being a tool.

use serde_json::{Value, json};

use crate::{Headless, Server};

/// Send one JSON-RPC request to the server and return the parsed reply; fails the test if the
/// server does not answer or answers with invalid JSON.
fn call(s: &mut Server, id: u64, method: &str, params: Value) -> Value {
    let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
    let r = s.handle_line(&line).expect("reply");
    serde_json::from_str(&r).unwrap()
}

/// The whole reply of one `run`, with the image blocks left in place.
fn run_raw(s: &mut Server, code: &str) -> Value {
    call(s, 99, "tools/call", json!({"name": "run", "arguments": {"code": code}}))
}

/// Run code and return the report text. A failing run fails the test with what it said.
fn run(s: &mut Server, code: &str) -> String {
    let r = run_raw(s, code);
    let c = &r["result"]["content"][0];
    assert_ne!(r["result"]["isError"], json!(true), "{code} failed: {c}");
    c["text"].as_str().unwrap_or_default().to_string()
}

/// Run code whose value is the answer, and return that value as text (`=> …` in the report).
fn value(s: &mut Server, code: &str) -> String {
    let text = run(s, code);
    text.lines().find_map(|l| l.strip_prefix("=> ")).unwrap_or_else(|| panic!("no value in the report of {code}:\n{text}")).to_string()
}

/// Run code that draws: the report's own text, with a failed run failing the test.
fn draw(s: &mut Server, code: &str) {
    run(s, code);
}

/// The MCP handshake works: `initialize` names the server, the `initialized` notification is
/// accepted, and `tools/list` offers exactly one tool — `run`.
#[test]
fn lifecycle_and_one_tool() {
    let mut s = Server::new(Box::new(Headless::default()));
    let init = call(&mut s, 1, "initialize", json!({"protocolVersion": "2025-06-18"}));
    assert_eq!(init["result"]["serverInfo"]["name"], "cadcraft");
    assert!(s.handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
    assert!(s.is_initialized());
    let tools = call(&mut s, 2, "tools/list", json!({}));
    let names: Vec<&str> = tools["result"]["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
    assert_eq!(names, vec!["run"], "one tool, unconditionally");
    // Its description says how to start and states the deployment fact.
    let desc = tools["result"]["tools"][0]["description"].as_str().unwrap();
    assert!(desc.contains("empty `code`"), "{desc}");
    assert!(desc.contains("RUNS CODE WITH THE AUTHORITY"), "{desc}");
    assert!(desc.contains("no code-free mode and no disable switch"), "{desc}");
    let bad = call(&mut s, 3, "nope", json!({}));
    assert_eq!(bad["error"]["code"], -32601);
}

/// An empty call returns the manual: the namespace's vocabulary, and how to reach the
/// application. This is where a model bootstraps.
#[test]
fn an_empty_call_returns_the_manual() {
    let mut s = Server::new(Box::new(Headless::default()));
    let manual = run(&mut s, "");
    for word in ["(commands", "(cmd ", "(cmdline", "(inspect)", "(describe", "(render", "(value", "(kept)", "(forget", "(man)"] {
        assert!(manual.contains(word), "the manual names {word}:\n{manual}");
    }
    assert!(manual.contains("AutoLISP"), "{manual}");
    assert!(manual.contains("commands are available"), "{manual}");
    // And nothing was drawn by asking for it.
    assert_eq!(value(&mut s, "(cdr (assoc 'OBJECTS (describe)))"), "0");
}

/// Guards that an agent can complete a drawing (plate, holes, layer, text) with only `run`, and
/// verify it only with `run`: counts, queries, undo and a PNG render.
#[test]
fn agent_draws_a_plate_with_holes() {
    let mut s = Server::new(Box::new(Headless::default()));
    // Task 1: an outline, typed at the command line like a person.
    draw(&mut s, r#"(cmdline "rectang" "0,0" "100,60")"#);
    // Task 2: four holes.
    for (x, y) in [(10, 10), (90, 10), (10, 50), (90, 50)] {
        draw(&mut s, &format!(r#"(cmd "circle" '((CENTER . ({x} {y})) (RADIUS . 4)))"#));
    }
    // Task 3: a layer, and a centre line on it.
    draw(&mut s, r#"(cmd "layer.new" '((NAME . "Center") (COLOR . "red") (CURRENT . T)))"#);
    draw(&mut s, r#"(cmdline "line" "-5,30" "105,30" "")"#);
    // Task 4: text, typed the way AutoCAD asks for it.
    draw(&mut s, r#"(cmdline "text" "0,-10" "5" "0" "PLATE 100x60" "")"#);
    // Verify.
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Circle")))))"#), "4");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Line")))))"#), "1");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Text")))))"#), "1");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Line") (LAYER . "Center")))))"#), "1");
    // Task 5: undo the text, check, then render the drawing. A run is one undo step, so this
    // takes back the run that drew the text — everything it did.
    draw(&mut s, r#"(cmd "undo")"#);
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Text")))))"#), "0");
    assert_eq!(
        value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Line") (LAYER . "Center")))))"#),
        "1",
        "the centre line survives undoing the text"
    );
    let r = run_raw(&mut s, r#"(render "plate.png" 320 200)"#);
    let content = r["result"]["content"].as_array().unwrap();
    assert_eq!(content.len(), 2, "the report text and the picture: {r}");
    assert_eq!(content[1]["type"], "image");
    assert!(content[1]["data"].as_str().unwrap().len() > 100, "a real PNG came back");
    let _ = std::fs::remove_file("plate.png");
}

/// A helper written in one call is usable in the next, and one kept in a session is there in the
/// next session — the model builds its own tooling and keeps it.
#[test]
fn a_helper_written_once_is_reused_and_kept() {
    let mut s = Server::new(Box::new(Headless::default()));
    let r = run(
        &mut s,
        r#"(defun CADCRAFT-MCP-HOLE (x y r) (cmd "circle" (list (cons 'CENTER (list x y)) (cons 'RADIUS r))))
           (CADCRAFT-MCP-HOLE 0 0 2)"#,
    );
    assert!(r.contains("kept: CADCRAFT-MCP-HOLE"), "{r}");
    // The next call uses it without redefining anything.
    draw(&mut s, "(CADCRAFT-MCP-HOLE 10 0 3)");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Circle")))))"#), "2");
    let radii = value(
        &mut s,
        r#"(mapcar '(lambda (e) (cdr (assoc 'RADIUS (cdr (assoc 'GEOMETRY e))))) (cdr (assoc 'ENTITIES (cmd "entities" '((TYPE . "Circle"))))))"#,
    );
    assert_eq!(radii, "(2.0 3.0)", "the helper drew the second circle at r=3: {radii}");
    // A fresh session (a new server, as after a restart) loads the kept definition.
    let mut fresh = Server::new(Box::new(Headless::default()));
    assert!(run(&mut fresh, "(kept)").contains("CADCRAFT-MCP-HOLE"), "kept() lists it");
    draw(&mut fresh, "(CADCRAFT-MCP-HOLE 5 5 1)");
    assert_eq!(value(&mut fresh, r#"(cdr (assoc 'COUNT (cmd "entities" '((TYPE . "Circle")))))"#), "1", "the definition was there");
    // `(forget …)` removes it, and the next session does not have it.
    run(&mut s, r#"(forget "CADCRAFT-MCP-HOLE")"#);
    let mut after = Server::new(Box::new(Headless::default()));
    let r = run_raw(&mut after, "(CADCRAFT-MCP-HOLE 1 1 1)");
    assert_eq!(r["result"]["isError"], json!(true), "the definition is gone: {r}");
}

/// The command catalog and one command's parameters are readable from code, so a model never has
/// to guess an id or a parameter name.
#[test]
fn commands_and_their_parameters_are_readable_from_code() {
    let mut s = Server::new(Box::new(Headless::default()));
    let all = value(&mut s, "(length (commands))");
    let n: f64 = all.parse().unwrap();
    assert!(n > 100.0, "the catalog is listed: {all}");
    // A filter matches ids, labels and aliases — not parameter docs.
    let ids = value(&mut s, r#"(mapcar '(lambda (c) (cdr (assoc 'ID c))) (commands "circle"))"#);
    assert!(ids.contains("\"circle\""), "{ids}");
    let q = value(&mut s, r#"(mapcar '(lambda (c) (cdr (assoc 'ID c))) (commands "qselect"))"#);
    assert!(!q.contains("circle"), "QSELECT only mentions circles in its docs: {q}");
    // One command's parameters, by id.
    let params = value(&mut s, r#"(cdr (assoc 'PARAMS (describe "circle")))"#);
    assert!(params.contains("center") && params.contains("radius"), "{params}");
    // A command that is not there is an error a model can read and correct.
    let r = run_raw(&mut s, r#"(describe "not-a-command")"#);
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("no command `not-a-command`"), "{text}");
}

/// Entities are queried from code: by type, layer, selection and window, with paging, and a window
/// matches geometry rather than bounding boxes.
#[test]
fn entities_are_queried_from_code() {
    let mut s = Server::new(Box::new(Headless::default()));
    for c in ["circle 0,0 1", "circle 100,100 1", "circle 200,0 1"] {
        draw(&mut s, &format!(r#"(cmdline "{c}")"#));
    }
    // An arc whose bounding box covers the window but whose curve stays outside it.
    draw(&mut s, r#"(cmd "arc" '((P1 . (40 0)) (P2 . (50 10)) (P3 . (60 0))))"#);
    let r = run(&mut s, r#"(cmd "entities" '((TYPE . "Circle") (LIMIT . 1) (OFFSET . 1)))"#);
    assert!(r.contains("COUNT . 3"), "count is every match: {r}");
    assert!(r.contains("RETURNED . 1"), "returned is the page: {r}");
    assert!(r.contains("X . 100.0"), "the second circle is on the page: {r}");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((WINDOW . ((45 1) (55 5)))))))"#), "0", "the arc passes above this window");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((WINDOW . ((-5 -5) (55 5)))))))"#), "2");
    assert_eq!(
        value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((WINDOW . ((-5 -5) (55 5))) (CROSSING . nil)))))"#),
        "1",
        "nil is false, so only the circle entirely inside is found"
    );
    // The selection filter: nothing selected, then the circle at the origin only.
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((SELECTED . T)))))"#), "0");
    draw(&mut s, r#"(cmd "select" '((WINDOW . ((-3 -3) (3 3)))))"#);
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((SELECTED . T) (TYPE . "Circle")))))"#), "1");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "entities" '((SELECTED . nil)))))"#), "4");
}

/// Texts are read from code: TEXT and MTEXT with their placement, formatting stripped, filtered by
/// content, layer and window.
#[test]
fn texts_are_read_from_code() {
    let mut s = Server::new(Box::new(Headless::default()));
    draw(&mut s, r#"(cmd "layer.new" '((NAME . "Texto")))"#);
    draw(&mut s, r#"(cmd "text" '((AT . (1 1)) (HEIGHT . 0.15) (TEXT . "RECAMARA 1")))"#);
    draw(&mut s, r#"(cmd "text" '((AT . (50 1)) (HEIGHT . 0.15) (TEXT . "COCINA")))"#);
    draw(&mut s, r#"(cmd "mtext" '((AT . (1 5)) (HEIGHT . 0.2) (WIDTH . 5) (TEXT . "{\\fArial|b1;PLANTA} BAJA\\PNIVEL 0.00")))"#);
    draw(&mut s, r#"(cmd "rectang" '((P1 . (0 0)) (P2 . (10 5))))"#);
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "texts")))"#), "3");
    let r = run(&mut s, r#"(cmd "texts" '((CONTAINS . "recamara")))"#);
    assert!(r.contains("RECAMARA 1"), "{r}");
    assert!(r.contains("HEIGHT . 0.15"), "{r}");
    // Multiline text comes back readable, without its formatting codes.
    let r = run(&mut s, r#"(cmd "texts" '((CONTAINS . "planta")))"#);
    assert!(r.contains("PLANTA BAJA"), "{r}");
    assert!(r.contains("NIVEL 0.00"), "{r}");
    assert!(!r.contains("{\\\\f"), "the formatting codes are stripped: {r}");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "texts" '((WINDOW . ((-1 -1) (20 20)))))))"#), "2");
    assert_eq!(value(&mut s, r#"(cdr (assoc 'COUNT (cmd "texts" '((LAYER . "nope")))))"#), "0");
}

/// The measured report is reachable from code and scopes: the whole space, a window in drawing
/// units; a hostile argument is a run error the model reads, not a crash.
#[test]
fn the_report_is_reachable_from_code() {
    let mut s = Server::new(Box::new(Headless::default()));
    draw(&mut s, r#"(cmdline "rectang" "0,0" "10,5")"#);
    draw(&mut s, r#"(cmdline "line" "100,0" "110,0")"#);
    let r = run(&mut s, r#"(cmd "describe")"#);
    assert!(r.contains("2 object"), "the report narrates: {r}");
    assert!(r.contains("=>"), "{r}");
    let r = run(&mut s, r#"(cmd "describe" '((WINDOW . ((-1 -1) (20 20)))))"#);
    assert!(r.contains("1 object"), "only the rectangle is in the window: {r}");
    let r = run_raw(&mut s, r#"(cmd "describe" '((LIMIT . "many")))"#);
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("error:"), "a bad parameter is a readable error: {text}");
    let r = run_raw(&mut s, r#"(cmd "imagetrace" '((PATH . "Z:/not/here.png")))"#);
    assert_eq!(r["result"]["isError"], json!(true), "{r}");
}

/// The image pipeline end to end through `run`: attach a picture, trace it into geometry sized to
/// a measurement, and have the report describe both.
///
/// The path goes in as a named value, not inside the code: a Windows path is full of backslashes
/// and a LISP string would eat them.
#[test]
fn a_picture_is_attached_traced_and_reported_from_code() {
    let path = std::env::temp_dir().join("cadcraft-mcp-trace.png");
    let mut pm = tiny_skia::Pixmap::new(32, 32).unwrap();
    for y in 0..32u32 {
        for x in 0..32u32 {
            let c = if (8..24).contains(&x) && (8..24).contains(&y) { [0, 0, 0, 255] } else { [255, 255, 255, 255] };
            pm.pixels_mut()[(y * 32 + x) as usize] = tiny_skia::ColorU8::from_rgba(c[0], c[1], c[2], c[3]).premultiply();
        }
    }
    pm.save_png(&path).unwrap();
    let ps = path.to_string_lossy().to_string();

    let mut s = Server::new(Box::new(Headless::default()));
    // Attach the picture, 64 units wide at 100,100; the path arrives as a named value.
    let attach = r#"(cdr (assoc 'HANDLE (cmd "imageattach" (list (cons 'PATH (value "path")) (cons 'WIDTH 64.0) (cons 'AT (list 100 100))))))"#;
    let r = call(&mut s, 1, "tools/call", json!({"name": "run", "arguments": {"code": attach, "values": {"path": ps}}}));
    let text = r["result"]["content"][0]["text"].as_str().unwrap().to_string();
    assert_ne!(r["result"]["isError"], json!(true), "{text}");
    let handle = text.lines().find_map(|l| l.strip_prefix("=> ")).expect("a handle").trim_matches('"').to_string();
    assert!(!handle.is_empty(), "{text}");

    // Trace the placed image and size the traced outline to 20 units wide in the same call.
    let trace = format!(r#"(cmd "imagetrace" '((HANDLE . "{handle}") (WIDTH . 20.0)))"#);
    let r = run(&mut s, &trace);
    assert!(r.contains("CONTOURS . 1"), "{r}");

    // The report sees the picture and the traced polylines.
    let r = run(&mut s, r#"(cmd "describe")"#);
    assert!(r.contains("IMAGES (COUNT . 1)"), "the report sees the picture: {r}");
    assert!(r.contains("PIXELS 32 32"), "with its real pixel size: {r}");
    assert!(r.contains("POLYLINE . 1"), "and the traced outline: {r}");
    assert!(r.contains("CLOSED (AREA ."), "and what it encloses: {r}");
    let _ = std::fs::remove_file(&path);
}

/// A lazy Remote bridge: it serves the one tool without the app, reports how to start it
/// (`--control`), and reaches the app once that app starts listening on the port.
#[test]
fn a_lazy_bridge_starts_without_the_app_and_says_how_to_open_it() {
    // Nothing listens on a port that was just freed.
    let addr = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().to_string()
    };
    let mut s = Server::new(Box::new(crate::Remote::lazy(&addr, false)));
    let init = call(&mut s, 1, "initialize", json!({"protocolVersion": "2025-06-18"}));
    assert_eq!(init["result"]["serverInfo"]["name"], "cadcraft");
    let tools = call(&mut s, 2, "tools/list", json!({}));
    let names: Vec<&str> = tools["result"]["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
    assert_eq!(names, vec!["run"], "a bridge to the app has the same one tool");
    let r = call(&mut s, 3, "tools/call", json!({"name": "run", "arguments": {"code": "(cmd \"zoom\" '((MODE . \"extents\")))"}}));
    assert_eq!(r["result"]["isError"], json!(true));
    let msg = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(msg.contains("not answering") && msg.contains("--control"), "{msg}");

    // Once the app listens, the next call reaches it.
    let listener = std::net::TcpListener::bind(&addr).unwrap();
    let app = std::thread::spawn(move || {
        use std::io::{BufRead, Write};
        let (sock, _) = listener.accept().unwrap();
        let mut line = String::new();
        std::io::BufReader::new(sock.try_clone().unwrap()).read_line(&mut line).unwrap();
        let id = serde_json::from_str::<Value>(&line).unwrap()["id"].clone();
        writeln!(&sock, "{}", json!({"id": id, "ok": true, "result": {"value": "nil", "output": []}})).unwrap();
    });
    let r = call(&mut s, 4, "tools/call", json!({"name": "run", "arguments": {"code": "42"}}));
    assert_ne!(r["result"]["isError"], json!(true), "{r}");
    app.join().unwrap();
}

/// Bad input is reported, not fatal: a run that fails is an `isError` result with the reason, an
/// unknown tool is invalid params, and malformed JSON is a parse error (-32700).
#[test]
fn errors_are_tool_errors_not_crashes() {
    let mut s = Server::new(Box::new(Headless::default()));
    // A command that does not exist, and a hostile parameter.
    let r = run_raw(&mut s, r#"(cmd "no-such-command")"#);
    assert_eq!(r["result"]["isError"], json!(true));
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("error:"), "{text}");
    let r = run_raw(&mut s, r#"(cmd "circle" '((CENTER . ("x" "y")) (RADIUS . 5)))"#);
    assert_eq!(r["result"]["isError"], json!(true), "{r}");
    // LISP's own errors read the way AutoLISP writes them.
    let r = run_raw(&mut s, "(/ 1 0)");
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("divide by zero"), "{text}");
    // A run that printed before failing keeps what it printed.
    let r = run_raw(&mut s, r#"(princ "halfway") (car 7)"#);
    let text = r["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("halfway"), "{text}");
    assert!(text.contains("bad argument type"), "{text}");
    assert!(s.handle_line("{not json").unwrap().contains("-32700"));
}

/// Unknown tools and arguments that don't fit the tool's schema are invalid params (-32602),
/// never guessed at; an empty batch is one Invalid Request.
#[test]
fn bad_tool_calls_are_invalid_params() {
    let mut s = Server::new(Box::new(Headless::default()));
    draw(&mut s, r#"(cmdline "circle" "0,0" "1")"#);
    let bad = [
        json!({"name": "nope", "arguments": {}}),
        json!({"name": "command_line", "arguments": {"text": "circle 1,1 1"}}),
        json!({"name": "execute", "arguments": {"command": "circle"}}),
        json!({"name": "query_entities", "arguments": {"type": "Circle"}}),
        json!({"name": "run", "arguments": {"code": 5}}),
        json!({"name": "run", "arguments": "circle 1,1 1"}),
        json!({"name": "run", "arguments": {"values": "text"}}),
    ];
    for (i, params) in bad.into_iter().enumerate() {
        let r = call(&mut s, i as u64, "tools/call", params.clone());
        assert_eq!(r["error"]["code"], -32602, "{params} -> {r}");
    }
    // Nothing was typed: the circle is still the only object and no command is running.
    assert_eq!(value(&mut s, r#"(cdr (assoc 'ENTITYCOUNT (cmd "drawing.inspect")))"#), "1");
    assert_eq!(s.handle_line("[]").map(|r| serde_json::from_str::<Value>(&r).unwrap()["error"]["code"].clone()), Some(json!(-32600)));
}

/// A definition that would replace a built-in is refused, and the language is left intact: the
/// next call finds the built-in working.
#[test]
fn a_definition_cannot_replace_a_builtin() {
    let mut s = Server::new(Box::new(Headless::default()));
    let r = run(&mut s, "(defun CAR (x) 99)");
    assert!(r.contains("refused: CAR"), "{r}");
    assert_eq!(value(&mut s, r#"(car '(7 8))"#), "7", "the built-in still works");
}

/// `run` is an ordinary command, not a private path: it is in the command catalog, a script can
/// call it, and the tool is a thin call of it.
#[test]
fn run_is_an_ordinary_command() {
    let mut s = Server::new(Box::new(Headless::default()));
    // It is in the catalog, with its parameters documented.
    let ids = value(&mut s, r#"(mapcar '(lambda (c) (cdr (assoc 'ID c))) (commands "run"))"#);
    assert!(ids.contains("\"run\""), "{ids}");
    let params = value(&mut s, r#"(cdr (assoc 'PARAMS (describe "run")))"#);
    assert!(params.contains("code"), "{params}");
    // Calling it from code reaches the same command the tool calls (here: the manual, because
    // the code is empty).
    let nested = value(&mut s, r#"(cmd "run" '((CODE . "")))"#);
    assert!(nested.contains("assistant namespace"), "run reaches run: {nested}");
    // And the tool's own call is `engine.execute` of the command.
    assert_eq!(cadcraft_ai::code::METHOD, "engine.execute");
    assert_eq!(cadcraft_ai::code::COMMAND, "run");
}
