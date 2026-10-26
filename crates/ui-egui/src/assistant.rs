//! The assistant: a conversation with a model that drives this very drawing.
//!
//! The pane is the face of `cadcraft-ai`. What the model can do is not a private API: every tool
//! call goes back through [`crate::control`] — the same door the JSON control channel and the MCP
//! server use — so the assistant, an external MCP client and a script all reach the same commands
//! with the same behaviour, and the pane can never do something the rest of the application
//! cannot.
//!
//! The work happens on a worker thread so the interface keeps painting while a model streams its
//! answer. The worker sends the interface two kinds of message: the transcript as the model sees
//! it, and the tool calls it wants run. The interface runs them between frames and replies; the
//! worker never touches the drawing itself.
//!
//! The conversation lives in memory for the session. The provider (URL, model, key) is saved with
//! the profile — see [`Assistant::provider_json`] and [`Assistant::load`].

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;

use cadcraft_ai::chat::{Message, Role};
use cadcraft_ai::client::{self, Provider};
use cadcraft_ai::code;
use cadcraft_ai::{Event, ToolExecutor};
use egui::{Align, Color32, RichText, vec2};
use serde_json::Value;

use crate::control::{ControlRequest, Outcome};
use crate::theme::Tokens;
use crate::tl;

/// How long one tool call may take before the model is told it did not finish. Generous: a
/// drawing-wide operation on a large drawing is slow, and the worker is not blocking the
/// interface while it waits.
const TOOL_TIMEOUT: Duration = Duration::from_secs(300);

/// What the worker sends the pane.
enum Progress {
    /// A fragment of the answer arriving now.
    Text(String),
    /// The conversation as the model sees it, at a structural step.
    Step(Vec<Message>),
    /// The turn is over; `note` is what the pane says about it.
    Done { transcript: Vec<Message>, note: Option<String> },
}

/// The pane's state.
pub struct Assistant {
    /// Where the conversation is sent (saved with the profile).
    pub provider: Provider,
    /// Which preset the settings show; `custom` once the URL has been typed by hand.
    pub preset: String,
    /// The transcript: what the model has read and written.
    pub messages: Vec<Message>,
    /// The composer's text.
    pub input: String,
    /// The answer streaming in right now.
    live: String,
    /// True while a turn runs.
    running: bool,
    /// A one-line note under the composer (the last error, or that the turn was stopped).
    pub note: Option<String>,
    /// The settings fold is open.
    pub settings_open: bool,
    /// The key field is revealed.
    key_visible: bool,
    /// The transcript scrolled itself to the end after the last change.
    follow: bool,
    events: Option<Receiver<Progress>>,
    /// Tool calls the worker wants the interface to run.
    jobs: Option<Receiver<ControlRequest>>,
    jobs_tx: Sender<ControlRequest>,
    /// Set to stop the running turn.
    cancel: Arc<AtomicBool>,
    /// Tool calls made so far this turn, for the status line.
    steps: usize,
}

impl Default for Assistant {
    fn default() -> Self {
        let (jobs_tx, jobs) = channel();
        Assistant {
            provider: Provider::default(),
            preset: "openai".into(),
            messages: Vec::new(),
            input: String::new(),
            live: String::new(),
            running: false,
            note: None,
            settings_open: false,
            key_visible: false,
            follow: true,
            events: None,
            jobs: Some(jobs),
            jobs_tx,
            cancel: Arc::new(AtomicBool::new(false)),
            steps: 0,
        }
    }
}

impl Assistant {
    /// Start a turn: hand the model's brief and the conversation to a worker thread and return at
    /// once, so the interface keeps painting while the answer streams in.
    pub fn send(&mut self, briefing: cadcraft_ai::agent::Briefing, ctx: &egui::Context) {
        let text = self.input.trim().to_string();
        if text.is_empty() || self.running {
            return;
        }
        if let Err(e) = self.provider.ready() {
            self.note = Some(e);
            self.settings_open = true;
            return;
        }
        self.input.clear();
        self.note = None;
        self.steps = 0;
        self.messages.push(Message::user(text));
        let (tx, rx) = channel();
        self.events = Some(rx);
        self.running = true;
        self.follow = true;
        self.cancel = Arc::new(AtomicBool::new(false));
        let cancel = Arc::clone(&self.cancel);
        let provider = self.provider.clone();
        let mut conversation = self.messages.clone();
        let jobs = self.jobs_tx.clone();
        let ctx = ctx.clone();
        let spawned = std::thread::Builder::new().name("cadcraft-assistant".into()).spawn(move || {
            let executor = Bridge { jobs, ctx };
            let mut on = |event: Event, transcript: &[Message]| {
                let progress = match event {
                    Event::Text(t) => Progress::Text(t),
                    Event::Call { .. } | Event::Result { .. } => Progress::Step(transcript.to_vec()),
                    Event::Done { reason } => Progress::Done {
                        transcript: transcript.to_vec(),
                        note: if reason == "stopped" { Some(tl!("Stopped.").to_string()) } else { None },
                    },
                    Event::Failed(e) => Progress::Done { transcript: transcript.to_vec(), note: Some(e) },
                };
                let _ = tx.send(progress);
            };
            cadcraft_ai::agent::run_turn(&provider, &briefing, &mut conversation, &cancel, &executor, &mut on);
        });
        if let Err(e) = spawned {
            self.running = false;
            self.events = None;
            self.note = Some(format!("{} {e}", tl!("The assistant could not start:")));
        }
    }

    /// Stop the running turn. The model stops being asked for more; a tool already running
    /// finishes, because the drawing must not be left half-changed.
    pub fn stop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    /// Take what the worker has sent since the last frame.
    fn drain(&mut self) {
        let Some(rx) = self.events.take() else { return };
        let mut done = false;
        for progress in rx.try_iter() {
            match progress {
                Progress::Text(t) => self.live.push_str(&t),
                Progress::Step(transcript) => {
                    // The round's text is in the transcript now; the streamed copy would double it.
                    self.live.clear();
                    self.messages = transcript;
                    self.steps += 1;
                }
                Progress::Done { transcript, note } => {
                    self.live.clear();
                    self.messages = transcript;
                    self.running = false;
                    self.note = note;
                    done = true;
                }
            }
        }
        if !done {
            self.events = Some(rx);
        }
    }

    /// Whether a turn is running (the pane keeps repainting while it is).
    pub fn running(&self) -> bool {
        self.running
    }

    /// The provider settings, for the profile.    /// Ask the interface thread to run one control call, exactly as the worker's bridge does, and
    /// return the handle to wait on. The pane's side of the bridge, and how a test drives it
    /// without a model.
    pub fn control_call(&self, method: &str, params: Value) -> crate::control::PendingReply {
        let (req, pending) = ControlRequest::new(method, params);
        let _ = self.jobs_tx.send(req);
        pending
    }

    /// The provider settings, for the profile.
    pub fn provider_json(&self) -> Value {
        serde_json::json!({
            "preset": self.preset,
            "baseUrl": self.provider.base_url,
            "model": self.provider.model,
            "apiKey": self.provider.api_key,
            "maxTokens": self.provider.max_tokens,
            "temperature": self.provider.temperature,
        })
    }

    /// Restore the provider settings saved with the profile.
    pub fn load(&mut self, v: &Value) {
        if let Some(p) = v.get("preset").and_then(Value::as_str) {
            self.preset = p.to_string();
        }
        if let Some(s) = v.get("baseUrl").and_then(Value::as_str) {
            self.provider.base_url = s.to_string();
        }
        if let Some(s) = v.get("model").and_then(Value::as_str) {
            self.provider.model = s.to_string();
        }
        if let Some(s) = v.get("apiKey").and_then(Value::as_str) {
            self.provider.api_key = s.to_string();
        }
        self.provider.max_tokens = v.get("maxTokens").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok());
        self.provider.temperature = v.get("temperature").and_then(Value::as_f64).map(|t| t as f32);
    }

    /// Forget the conversation.
    pub fn clear(&mut self) {
        self.messages.clear();
        self.live.clear();
        self.note = None;
        self.steps = 0;
    }

    /// The conversation as text, for Copy and for the command line.
    pub fn transcript_text(&self) -> String {
        let mut s = String::new();
        for m in &self.messages {
            let who = match m.role {
                Role::User => "you",
                Role::Assistant => "assistant",
                Role::Tool => "tool",
                Role::System => continue,
            };
            if !m.text().trim().is_empty() {
                s.push_str(&format!("{who}: {}\n", m.text().trim()));
            }
            for call in &m.tool_calls {
                s.push_str(&format!("{who}: {}({})\n", call.name, call.arguments));
            }
        }
        s
    }
}

/// Run the tool calls the worker queued, on the interface thread between frames. Every call goes
/// through [`crate::control::handle`] — the same door the control channel and the MCP server use.
pub fn serve(app: &mut crate::CadApp, ctx: &egui::Context) {
    let Some(rx) = app.assistant.jobs.take() else { return };
    while let Ok(req) = rx.try_recv() {
        if !req.begin() {
            continue;
        }
        let reply = req.reply.clone();
        match crate::control::handle(app, ctx, &req) {
            Outcome::Done(v) => {
                let _ = reply.send(v);
            }
            // The assistant's tools never ask for a screenshot; a window is what they would need.
            Outcome::Screenshot { .. } => {
                let _ = reply.send(serde_json::json!({"ok": false, "error": "screenshots are not available to the assistant"}));
            }
        }
        ctx.request_repaint();
    }
    app.assistant.jobs = Some(rx);
}

/// The bridge from the worker thread to the interface: a tool call becomes a control request, and
/// the worker waits for the interface to answer it.
struct Bridge {
    jobs: Sender<ControlRequest>,
    ctx: egui::Context,
}

impl ToolExecutor for Bridge {
    /// One call of the one tool: `engine.execute` of the `run` command, queued to the interface
    /// thread. The **raw** result comes back — the loop renders the report the model reads, so a
    /// picture, a kept definition or a failure is never flattened into a string on the way.
    fn call(&self, name: &str, args: &Value) -> Result<Value, String> {
        if name != code::TOOL {
            return Err(format!("`{name}` is not a tool here; there is one tool, `{}`", code::TOOL));
        }
        let args = code::check_args(args)?;
        let mut harness = Harness { jobs: &self.jobs, ctx: &self.ctx };
        // The same control call the surface makes: `engine.execute` of the `run` command.
        code::Harness::call(
            &mut harness,
            code::METHOD,
            serde_json::json!({"command": code::COMMAND, "params": {"code": args.code, "values": args.values}}),
        )
    }
}

/// The shared surface's view of this application: every tool is a control method.
struct Harness<'a> {
    jobs: &'a Sender<ControlRequest>,
    ctx: &'a egui::Context,
}

impl code::Harness for Harness<'_> {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let (req, pending) = ControlRequest::new(method, params);
        self.jobs.send(req).map_err(|_| tl!("The assistant is no longer connected to CADCraft.").to_string())?;
        // The interface drains queued requests between frames; if it is not painting, nothing
        // would ever run, so ask for a frame.
        self.ctx.request_repaint();
        let reply = pending.wait(TOOL_TIMEOUT);
        match reply.get("ok").and_then(Value::as_bool) {
            Some(true) => Ok(reply.get("result").cloned().unwrap_or(Value::Null)),
            _ => Err(reply.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| reply.to_string())),
        }
    }
}

/// What the model is told about the application at the start of a turn.
pub fn briefing(app: &crate::CadApp) -> cadcraft_ai::agent::Briefing {
    let mut b = cadcraft_ai::agent::Briefing { app: format!("CADCraft {}", env!("CARGO_PKG_VERSION")), ..Default::default() };
    if let Ok(state) = app.session.state() {
        b.drawing = if state.title.is_empty() { state.path.as_deref().unwrap_or_default().to_string() } else { state.title.clone() };
        b.selection = state.selection.len();
        b.units = cadcraft_engine::units::name(state.doc.header.i64("INSUNITS", 1)).to_string();
        let extents = state.doc.extents(&state.space);
        if !extents.is_empty() {
            b.extents = Some([extents.min.x, extents.min.y, extents.max.x, extents.max.y]);
        }
        b.objects = state.doc.space(&state.space).map_or(0, |s| s.len());
    }
    b
}

/// Draw the pane: the conversation, the composer, and the provider settings.
pub fn show(app: &mut crate::CadApp, ui: &mut egui::Ui) {
    let t = Tokens::get();
    app.assistant.drain();
    // The command line's ASSISTANT command can ask the pane to do something this frame.
    apply_pending(app, ui.ctx());
    if app.assistant.running() {
        // Streamed text arrives on another thread; keep painting until the turn is over.
        ui.ctx().request_repaint();
    }

    let height = ui.available_height();
    ui.vertical(|ui| {
        settings(app, ui, &t);
        ui.separator();
        let composer = 74.0;
        let list = (height - composer - 12.0).max(80.0);
        egui::ScrollArea::vertical()
            .id_salt("assistant-transcript")
            .auto_shrink([false, false])
            .max_height(list)
            .show(ui, |ui| transcript(app, ui, &t));
        ui.separator();
        composer_row(app, ui, &t);
    });
}

/// The settings fold: where the conversation is sent.
fn settings(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens) {
    let running = app.assistant.running();
    let header = match client::preset(&app.assistant.preset) {
        Some(p) if app.assistant.preset != "custom" => format!("{} · {}", p.label, app.assistant.provider.model),
        _ => app.assistant.provider.model.clone(),
    };
    egui::CollapsingHeader::new(RichText::new(crate::tf!("Assistant: {what}", what = header)).color(t.text))
        .id_salt("assistant-settings")
        .default_open(app.assistant.settings_open || app.assistant.provider.ready().is_err())
        .show(ui, |ui| {
            ui.add_enabled_ui(!running, |ui| {
                egui::Grid::new("assistant-settings-grid").num_columns(2).spacing([8.0, 6.0]).show(ui, |ui| {
                    ui.label(RichText::new(tl!("Provider")).color(t.text_dim));
                    let current = client::preset(&app.assistant.preset).map_or("Other (OpenAI-compatible)", |p| p.label);
                    egui::ComboBox::from_id_salt("assistant-preset").selected_text(current).show_ui(ui, |ui| {
                        for p in client::PRESETS {
                            if ui.selectable_label(app.assistant.preset == p.id, p.label).clicked() {
                                app.assistant.preset = p.id.to_string();
                                if !p.base_url.is_empty() {
                                    app.assistant.provider.base_url = p.base_url.to_string();
                                }
                                if !p.model.is_empty() {
                                    app.assistant.provider.model = p.model.to_string();
                                }
                            }
                        }
                    });
                    ui.end_row();

                    ui.label(RichText::new(tl!("Base URL")).color(t.text_dim));
                    if ui.add(egui::TextEdit::singleline(&mut app.assistant.provider.base_url).desired_width(f32::INFINITY)).changed() {
                        app.assistant.preset = "custom".into();
                    }
                    ui.end_row();

                    ui.label(RichText::new(tl!("Model")).color(t.text_dim));
                    if ui.add(egui::TextEdit::singleline(&mut app.assistant.provider.model).desired_width(f32::INFINITY)).changed() {
                        app.assistant.preset = "custom".into();
                    }
                    ui.end_row();

                    ui.label(RichText::new(tl!("API key")).color(t.text_dim));
                    ui.horizontal(|ui| {
                        let key = &mut app.assistant.provider.api_key;
                        if app.assistant.key_visible {
                            ui.add(egui::TextEdit::singleline(key).desired_width(f32::INFINITY).hint_text(tl!("not needed for a local server")));
                        } else {
                            ui.add(
                                egui::TextEdit::singleline(key)
                                    .password(true)
                                    .desired_width(f32::INFINITY)
                                    .hint_text(tl!("not needed for a local server")),
                            );
                        }
                        let label = if app.assistant.key_visible { tl!("Hide") } else { tl!("Show") };
                        if ui.button(label).clicked() {
                            app.assistant.key_visible = !app.assistant.key_visible;
                        }
                    });
                    ui.end_row();

                    ui.label(RichText::new(tl!("Answer limit")).color(t.text_dim));
                    ui.horizontal(|ui| {
                        let mut tokens = app.assistant.provider.max_tokens.unwrap_or(0);
                        if ui.add(egui::DragValue::new(&mut tokens).range(0..=1_000_000).speed(64.0)).changed() {
                            app.assistant.provider.max_tokens = if tokens == 0 { None } else { Some(tokens) };
                        }
                        ui.label(RichText::new(tl!("tokens (0: the model's own)")).color(t.text_dim));
                    });
                    ui.end_row();
                });
                ui.label(RichText::new(tl!("The key is saved in this machine's CADCraft profile.")).color(t.text_faint).small());
            });
        });
}

/// The conversation: the transcript as the model sees it, plus the answer arriving now.
fn transcript(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens) {
    if app.assistant.messages.is_empty() && app.assistant.live.is_empty() {
        ui.add_space(6.0);
        ui.label(RichText::new(tl!("Ask for a change to this drawing — the assistant works in it directly.")).color(t.text_dim));
        ui.add_space(4.0);
        ui.label(
            RichText::new(tl!("The assistant writes AutoLISP in the open drawing: (cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5))) draws, \
                 (commands) lists what the application offers, (render) shows it a picture. Helpers it writes are kept for \
                 the next session. Ask in your own words, or paste the code you want run."))
            .color(t.text_faint)
            .small(),
        );
        return;
    }
    let chips = chips(&app.assistant.messages);
    for (i, message) in app.assistant.messages.iter().enumerate() {
        match message.role {
            Role::User => bubble(ui, t, tl!("You"), message.text(), t.accent, true),
            Role::Assistant => {
                if !message.text().trim().is_empty() {
                    bubble(ui, t, tl!("Assistant"), message.text(), t.text, false);
                }
                for call in &message.tool_calls {
                    chip(ui, t, chips.get(call.id.as_str()).copied(), call);
                }
            }
            Role::Tool => {}
            Role::System => {}
        }
        let _ = i;
    }
    if !app.assistant.live.is_empty() {
        bubble(ui, t, tl!("Assistant"), &app.assistant.live, t.text, false);
    }
    if app.assistant.running && app.assistant.live.is_empty() {
        ui.horizontal(|ui| {
            ui.spinner();
            ui.label(RichText::new(tl!("Working…")).color(t.text_dim));
        });
    }
    if app.assistant.follow {
        ui.scroll_to_cursor(Some(Align::BOTTOM));
        app.assistant.follow = false;
    }
}

/// Each tool call with its result, looked up in the transcript by call id — the transcript is the
/// only state, so a chip can never disagree with what the model actually received.
fn chips(messages: &[Message]) -> std::collections::HashMap<&str, &Message> {
    messages.iter().filter(|m| m.role == Role::Tool).filter_map(|m| m.tool_call_id.as_deref().map(|id| (id, m))).collect()
}

/// One tool call: what it was asked to do and how it ended.
fn chip(ui: &mut egui::Ui, t: &Tokens, result: Option<&Message>, call: &cadcraft_ai::ToolCall) {
    let (mark, colour) = match result {
        None => (tl!("…"), t.text_dim),
        Some(m) if m.error => (tl!("!"), t.compare_other),
        Some(_) => (tl!("✓"), t.toggle_on),
    };
    let summary = call.summary();
    let line = format!("{mark} {summary}");
    let text = RichText::new(line).color(colour).small();
    match result {
        Some(m) => {
            ui.horizontal_wrapped(|ui| {
                ui.add_space(6.0);
                ui.label(text).on_hover_text(m.text());
            });
        }
        None => {
            ui.horizontal(|ui| {
                ui.add_space(6.0);
                ui.label(text);
            });
        }
    }
}

/// A message: who said it, and what.
fn bubble(ui: &mut egui::Ui, t: &Tokens, who: &str, text: &str, colour: Color32, accent: bool) {
    ui.add_space(2.0);
    ui.label(RichText::new(who).color(if accent { t.accent } else { t.text_dim }).small().strong());
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width();
    job.append(text, 0.0, egui::TextFormat { font_id: crate::theme::body(), color: colour, ..Default::default() });
    ui.label(job);
    ui.add_space(2.0);
}

/// The composer: the text box, Send and Stop, and the last note.
fn composer_row(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens) {
    let running = app.assistant.running();
    let enter = ui.input(|i| i.modifiers.ctrl || i.modifiers.command);
    ui.horizontal(|ui| {
        let hint = if enter { tl!("Ctrl+Enter to send") } else { tl!("Enter to send, Shift+Enter for a new line") };
        let edit = egui::TextEdit::multiline(&mut app.assistant.input).desired_rows(3).desired_width(ui.available_width() - 74.0).hint_text(hint);
        let response = ui.add(edit);
        let send = response.has_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter) && !i.modifiers.shift);
        let clicked = ui
            .add_enabled(
                !running && !app.assistant.input.trim().is_empty(),
                egui::Button::new(RichText::new(tl!("Send")).color(t.text)).min_size(vec2(66.0, 26.0)),
            )
            .clicked();
        if clicked || send {
            let briefing = briefing(app);
            let ctx = ui.ctx().clone();
            app.assistant.send(briefing, &ctx);
        }
        if running && ui.button(RichText::new(tl!("Stop")).color(t.text)).clicked() {
            app.assistant.stop();
        }
        if !running && ui.button(RichText::new(tl!("Clear")).color(t.text_dim)).clicked() {
            app.assistant.clear();
        }
    });
    if let Some(note) = app.assistant.note.clone() {
        ui.label(RichText::new(note).color(t.compare_other).small());
    }
}

/// Route the assistant's own commands. `None` if `id` isn't one of them.
///
/// | command | does |
/// |---|---|
/// | `ui.toggle.assistant`, `ui.panel.assistant` | show or hide the pane |
/// | `assistant {}` | show the pane |
/// | `assistant {"ask": "…"}` | show the pane and ask the model |
/// | `assistant {"stop": true}` | stop the turn running now |
/// | `assistant {"clear": true}` | forget the conversation |
pub fn route(app: &mut crate::CadApp, id: &str, params: &Value) -> Option<Result<Value, String>> {
    match id {
        "ui.toggle.assistant" => Some(toggle(app)),
        "ui.panel.assistant" => Some(open(app)),
        "assistant" | "ai" => Some(command(app, params)),
        _ => None,
    }
}

/// `assistant {…}`: open the pane and queue whatever the parameters ask for. The pane picks the
/// request up on the next frame, because it owns the worker.
fn command(app: &mut crate::CadApp, params: &Value) -> Result<Value, String> {
    if params.is_null() {
        return open(app);
    }
    if params.get("open").and_then(Value::as_bool).unwrap_or(true) {
        open(app)?;
    }
    if params.get("clear").and_then(Value::as_bool) == Some(true) {
        app.assistant_pending.clear = true;
    }
    if params.get("stop").and_then(Value::as_bool) == Some(true) {
        app.assistant_pending.stop = true;
    }
    if let Some(ask) = params.get("ask").and_then(Value::as_str) {
        app.assistant_pending.ask = Some(ask.to_string());
    }
    Ok(serde_json::json!({
        "assistant": true,
        "running": app.assistant.running(),
        "configured": app.assistant.provider.ready().is_ok(),
        "provider": app.assistant.provider.base_url,
        "model": app.assistant.provider.model,
    }))
}

/// Show or hide the pane.
fn toggle(app: &mut crate::CadApp) -> Result<Value, String> {
    let panel = crate::docking::Panel::Assistant;
    if app.ui.docking.layout.contains(&panel) {
        crate::docking::command(app, false, &serde_json::json!({ "operation": "close", "panel": panel.id() }))
    } else {
        open(app)
    }
}

/// Open the pane. The first time it floats by the right edge of the drawing, where a conversation
/// belongs; afterwards it returns where it was closed.
pub fn open(app: &mut crate::CadApp) -> Result<Value, String> {
    let panel = crate::docking::Panel::Assistant;
    let first = !app.ui.docking.layout.contains(&panel) && !app.ui.docking.hidden.iter().any(|(p, _)| *p == panel);
    let r = crate::docking::command(app, false, &serde_json::json!({ "operation": "open", "panel": panel.id() }))?;
    if !first {
        return Ok(r);
    }
    let area = app.canvas.rect.unwrap_or(egui::Rect::from_min_size(egui::pos2(220.0, 80.0), vec2(1000.0, 800.0)));
    let (w, h) = (420.0, (area.height() - 40.0).clamp(240.0, 720.0));
    let rect = [area.right() - w - 16.0, area.top() + 24.0, w, h];
    crate::docking::command(app, false, &serde_json::json!({ "operation": "float", "panel": panel.id(), "rect": rect }))
}

/// The command line's ASSISTANT command, and the pane's own buttons, leave a request here for the
/// pane to pick up on the next frame (the pane owns the worker, the command line does not).
#[derive(Default)]
pub struct Pending {
    pub ask: Option<String>,
    pub stop: bool,
    pub clear: bool,
}

/// Run whatever the command line asked for.
fn apply_pending(app: &mut crate::CadApp, ctx: &egui::Context) {
    let pending = std::mem::take(&mut app.assistant_pending);
    if pending.clear {
        app.assistant.clear();
    }
    if pending.stop {
        app.assistant.stop();
    }
    if let Some(ask) = pending.ask {
        app.assistant.input = ask;
        let briefing = briefing(app);
        app.assistant.send(briefing, ctx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cadcraft_ai::chat::ToolCall;
    use serde_json::json;

    fn call(id: &str, name: &str, args: Value) -> ToolCall {
        ToolCall { id: id.into(), name: name.into(), arguments: args }
    }

    #[test]
    fn the_bridge_hands_back_the_raw_result_so_the_report_is_whole() {
        // The worker's bridge must not pre-render the report: `run_one` builds it from the raw
        // command result, and a string would lose the value, the kept names and the pictures.
        let report = code::Report::of(&serde_json::json!({
            "value": "((COUNT . 3))",
            "output": ["drew 3"],
            "kept": ["C:WING"],
            "images": ["/tmp/a.png"]
        }));
        let text = report.text();
        assert!(text.contains("=> ((COUNT . 3))"), "{text}");
        assert!(text.contains("kept: C:WING"), "{text}");
        assert!(text.contains("rendered /tmp/a.png"), "{text}");
        assert_eq!(report.images, vec!["/tmp/a.png".to_string()]);
    }

    #[test]
    fn a_chip_finds_its_result_by_call_id() {
        let messages = vec![
            Message::user("draw"),
            Message::assistant_calls(vec![call("c1", "execute", json!({"command": "circle"}))], None),
            Message::tool_result(&call("c1", "execute", json!({})), &json!({"message": "Drew a circle."})),
            Message::assistant_calls(vec![call("c2", "inspect_drawing", json!({}))], None),
        ];
        let chips = chips(&messages);
        assert_eq!(chips.len(), 1);
        assert!(chips["c1"].text().contains("Drew a circle."));
        assert!(!chips.contains_key("c2"), "a call with no result yet shows as running");
    }

    #[test]
    fn the_transcript_text_reads_like_a_conversation() {
        let mut a = Assistant::default();
        a.messages.push(Message::user("draw a circle"));
        a.messages.push(Message::assistant_calls(vec![call("c1", "execute", json!({"command": "circle", "params": {"radius": 5}}))], None));
        a.messages.push(Message::tool_result(&call("c1", "execute", json!({})), &json!({"message": "Drew a circle."})));
        a.messages.push(Message::assistant("Done."));
        let text = a.transcript_text();
        assert!(text.contains("you: draw a circle"));
        assert!(text.contains("assistant: execute("), "{text}");
        // A tool result is shown as the model read it: the command's JSON answer.
        assert!(text.contains(r#"tool: {"message":"Drew a circle."}"#), "{text}");
        assert!(text.contains("assistant: Done."));
    }

    #[test]
    fn the_provider_settings_round_trip_through_the_profile() {
        let a = Assistant {
            preset: "ollama".into(),
            provider: Provider {
                base_url: "http://127.0.0.1:11434/v1".into(),
                model: "qwen3".into(),
                api_key: "secret".into(),
                max_tokens: Some(4096),
                temperature: Some(0.2),
            },
            ..Assistant::default()
        };
        let saved = a.provider_json();
        let mut b = Assistant::default();
        b.load(&saved);
        assert_eq!(b.preset, "ollama");
        assert_eq!(b.provider, a.provider);
        // A profile written before the assistant existed leaves the defaults alone.
        let mut c = Assistant::default();
        c.load(&json!({}));
        assert_eq!(c.provider, Provider::default());
        assert_eq!(c.preset, "openai");
    }

    #[test]
    fn stopping_sets_the_flag_the_worker_reads() {
        let mut a = Assistant::default();
        assert!(!a.cancel.load(Ordering::Relaxed));
        a.stop();
        assert!(a.cancel.load(Ordering::Relaxed));
    }
}
