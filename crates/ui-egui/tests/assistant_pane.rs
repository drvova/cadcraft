//! The assistant pane: its toggle, and the bridge that runs the model's tool calls as ordinary
//! control requests on the interface thread.

use std::time::Duration;

use cadcraft_ai::surface;
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
fn a_tool_call_from_the_worker_runs_on_the_interface_thread() {
    // This is the bridge the worker uses: a control request goes to the pane's queue, the next
    // frame runs it through the same dispatcher the control channel and MCP use, and the reply
    // comes back to whoever asked.
    let mut h = harness();
    let (method, params) = match surface::dispatch_spec("execute", &json!({"command": "circle", "params": {"center": [3, 4], "radius": 2}})) {
        Some(p) => p,
        None => panic!("the surface maps `execute` to a control call"),
    };
    assert_eq!(method, "engine.execute");

    let pending = h.state().assistant.tool_call(&method, params);
    // Nothing has run yet: the request waits for a frame.
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    assert_eq!(reply["ok"], true, "{reply}");
    let result = reply.get("result").cloned().unwrap_or(Value::Null);
    assert!(result.get("handle").is_some(), "the command's result came back: {result}");

    // And the drawing really changed.
    let entities = h.state_mut().run("entities", json!({"type": "Circle"})).unwrap();
    assert_eq!(entities["count"], 1, "{entities}");
    let circle = &entities["entities"][0];
    assert_eq!(circle["type"], "Circle");
    assert_eq!(circle["geometry"]["center"]["x"], 3.0, "{circle}");
    assert_eq!(circle["geometry"]["center"]["y"], 4.0, "{circle}");
    assert_eq!(circle["geometry"]["radius"], 2.0);
}

#[test]
fn a_tool_call_that_fails_comes_back_as_an_error_not_a_panic() {
    let mut h = harness();
    let (method, params) = surface::dispatch_spec("execute", &json!({"command": "no_such_command", "params": {}})).unwrap();
    let pending = h.state().assistant.tool_call(&method, params);
    h.run_steps(3);
    let reply = pending.wait(Duration::from_secs(5));
    assert_eq!(reply["ok"], false, "{reply}");
    assert!(reply["error"].as_str().is_some_and(|e| !e.is_empty()), "{reply}");
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
