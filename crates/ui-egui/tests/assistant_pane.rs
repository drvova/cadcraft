//! The assistant pane: its toggle, and the bridge that runs the model's tool calls as ordinary
//! control requests on the interface thread.

use std::time::Duration;

use cadcraft_ai::code;
use cadcraft_engine::Session;
use cadcraft_ui_egui::{CadApp, Services, docking::Panel};
use egui::vec2;
use egui_kittest::Harness;
use serde_json::{Value, json};

fn harness() -> Harness<'static, CadApp> {
    let mut app = CadApp::new(Session::default(), Services::default());
    app.ui.start_tab = false;
    app.ui.in_window_menu = false;
    let mut h = Harness::builder().with_size(vec2(1280.0, 800.0)).build_ui_state(
        |ui, app: &mut CadApp| {
            app.logic(&ui.ctx().clone());
            app.ui(ui);
        },
        app,
    );
    h.run_steps(5);
    h
}

#[test]
fn the_assistant_toggle_opens_and_closes_the_pane() {
    let mut h = harness();
    assert!(!h.state().ui.docking.layout.contains(&Panel::Assistant));
    let r = h.state_mut().run("ui.toggle.assistant", json!({})).unwrap();
    assert!(r.get("docking").is_some(), "the toggle reports the workspace: {r}");
    h.run_steps(3);
    assert!(h.state().ui.docking.layout.contains(&Panel::Assistant), "the pane opened");
    assert!(h.state().ui.docking.layout.floating.iter().any(|g| g.contains(&Panel::Assistant)), "it opens beside the drawing");

    let r = h.state_mut().run("ui.toggle.assistant", json!({})).unwrap();
    assert!(r.get("docking").is_some());
    h.run_steps(3);
    assert!(!h.state().ui.docking.layout.contains(&Panel::Assistant), "the pane closed");
}

#[test]
fn the_assistant_command_reports_its_provider_and_takes_an_ask() {
    let mut h = harness();
    let r = h.state_mut().run("assistant", json!({"open": false})).unwrap();
    assert_eq!(r["assistant"], true);
    assert_eq!(r["configured"], false, "no provider is set in a fresh session");
    assert_eq!(r["running"], false);

    // An ask without a provider is refused where it can be seen: the pane's note, not a silent
    // no-op, and it opens the pane so the user can see why.
    let r = h.state_mut().run("assistant", json!({"ask": "draw a circle"})).unwrap();
    assert_eq!(r["assistant"], true);
    h.run_steps(5);
    assert!(h.state().assistant.note.is_some(), "the pane says what is missing");
    assert!(h.state().assistant.messages.is_empty(), "nothing was sent");
}

#[test]
fn the_one_tool_runs_code_on_the_interface_thread() {
    // This is the bridge the worker uses: the tool's call is `engine.execute` of the `run`
    // command, queued to the pane, run on the next frame by the same dispatcher the control
    // channel and MCP use, and the reply comes back to whoever asked.
    let mut h = harness();
    let args = code::check_args(&json!({"code": r#"(cmd "circle" '((CENTER . (3 4)) (RADIUS . 2)))"#})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": args.code, "values": args.values}}));
    // Nothing has run yet: the request waits for a frame.
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    assert_eq!(reply["ok"], true, "{reply}");
    let result = reply.get("result").cloned().unwrap_or(Value::Null);
    assert!(result.get("value").is_some(), "the run's result came back: {result}");

    // And the drawing really changed.
    let entities = h.state_mut().run("entities", json!({"type": "Circle"})).unwrap();
    assert_eq!(entities["count"], 1, "{entities}");
    let circle = &entities["entities"][0];
    assert_eq!(circle["geometry"]["center"]["x"], 3.0, "{circle}");
    assert_eq!(circle["geometry"]["center"]["y"], 4.0, "{circle}");
    assert_eq!(circle["geometry"]["radius"], 2.0);
}

#[test]
fn a_run_that_fails_comes_back_as_a_report_not_a_panic() {
    let mut h = harness();
    let args = code::check_args(&json!({"code": r#"(cmd "no_such_command")"#})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": args.code, "values": args.values}}));
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    assert_eq!(reply["ok"], true, "the call itself ran: {reply}");
    let result = reply.get("result").cloned().unwrap_or(Value::Null);
    let report = code::Report::of(&result);
    assert!(report.error.is_some(), "the run failed and said so: {result}");
    assert!(report.text().contains("error:"), "{}", report.text());
}

#[test]
fn the_report_the_model_reads_keeps_its_fields() {
    // The bridge must not pre-render the report into a string: the model reads the value, what
    // was kept and the pictures. This failed live once (the bridge returned `report.text()`), so
    // it is pinned here.
    let mut h = harness();
    let args = code::check_args(&json!({"code": r#"(princ "drew") (+ 1 2)"#})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": args.code, "values": args.values}}));
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    let result = reply.get("result").cloned().unwrap_or(Value::Null);
    let report = code::Report::of(&result);
    assert_eq!(report.value.as_deref(), Some("3"), "{result}");
    assert!(report.output.iter().any(|l| l == "drew"), "{result}");
    let text = report.text();
    assert!(text.contains("=> 3"), "{text}");
    assert!(text.contains("drew"), "{text}");
}

#[test]
fn a_kept_definition_from_the_pane_is_there_in_the_next_call() {
    let mut h = harness();
    let define = code::check_args(&json!({"code": "(defun PANE-TEST-DOUBLE (x) (* x 2))"})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": define.code, "values": define.values}}));
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    let report = code::Report::of(&reply.get("result").cloned().unwrap_or(Value::Null));
    assert!(report.kept.contains(&"PANE-TEST-DOUBLE".to_string()), "{reply}");
    // The next call uses it without redefining.
    let use_it = code::check_args(&json!({"code": "(PANE-TEST-DOUBLE 21)"})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": use_it.code, "values": use_it.values}}));
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    let report = code::Report::of(&reply.get("result").cloned().unwrap_or(Value::Null));
    assert_eq!(report.value.as_deref(), Some("42"), "{reply}");
    // Clean up so a later run of the suite is not affected.
    let forget = code::check_args(&json!({"code": r#"(forget "PANE-TEST-DOUBLE")"#})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": forget.code, "values": forget.values}}));
    h.run_steps(3);
    let _ = pending.wait(Duration::from_secs(5));
}

#[test]
fn an_empty_call_from_the_pane_returns_the_manual() {
    let mut h = harness();
    let args = code::check_args(&json!({})).unwrap();
    let pending =
        h.state().assistant.control_call(code::METHOD, json!({"command": code::COMMAND, "params": {"code": args.code, "values": args.values}}));
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    let report = code::Report::of(&reply.get("result").cloned().unwrap_or(Value::Null));
    let manual = report.manual.expect("the manual");
    assert!(manual.contains("(cmd "), "{manual}");
    assert!(manual.contains("(commands)"), "{manual}");
}

#[test]
fn the_pane_shows_the_brief_of_the_drawing() {
    let mut h = harness();
    h.state_mut().run("line", json!({"points": [[0, 0], [10, 0]]})).unwrap();
    let brief = cadcraft_ui_egui::assistant::briefing(h.state());
    assert_eq!(brief.objects, 1, "{brief:?}");
    assert_eq!(brief.units, "inches", "the default drawing is imperial");
    assert_eq!(brief.extents, Some([0.0, 0.0, 10.0, 0.0]));
    assert!(brief.app.starts_with("CADCraft"), "{brief:?}");
}
