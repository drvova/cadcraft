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
use crate::theme::{self, Tokens};
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
    /// The reader's steer joined the conversation at a tool call.
    Steered(Vec<Message>),
    /// The turn is over; `note` is what the pane says about it.
    Done { transcript: Vec<Message>, note: Option<String> },
}

/// A picture the reader attached: the file, its name, and its thumbnail once it has been loaded.
#[derive(Clone)]
pub struct Attachment {
    pub path: String,
    pub name: String,
    thumb: Option<egui::TextureHandle>,
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
    /// Activity rows the reader opened (the full code and result); the rest stay one dim line.
    expanded: std::collections::HashSet<String>,
    /// Renders the transcript has loaded, by path, so a redraw never re-reads a file.
    textures: std::collections::HashMap<String, (egui::TextureHandle, [usize; 2])>,
    /// Pictures the reader attached to the next message.
    pub attachments: Vec<Attachment>,
    /// What the reader typed while a turn ran, waiting for it to finish (Enter).
    queued: Vec<String>,
    /// The running turn's steering handle: Ctrl+Enter writes into it and the model reads it at its
    /// next tool call.
    steer: cadcraft_ai::agent::Steer,
    /// The drawing's undo depth before each request, by the index of the user message that asked
    /// for it. Restoring a row reverts the drawing to that point; the conversation stays.
    checkpoints: std::collections::HashMap<usize, usize>,
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
            expanded: std::collections::HashSet::new(),
            textures: std::collections::HashMap::new(),
            attachments: Vec::new(),
            queued: Vec::new(),
            steer: cadcraft_ai::agent::Steer::default(),
            checkpoints: std::collections::HashMap::new(),
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
        self.send_text(briefing, ctx, None, None);
    }

    /// Send what the composer holds (or `text`, for a queued message). `checkpoint` is the
    /// drawing's undo depth before this request, recorded so the row can be restored to.
    pub fn send_text(&mut self, briefing: cadcraft_ai::agent::Briefing, ctx: &egui::Context, text: Option<String>, checkpoint: Option<usize>) {
        let text = text.unwrap_or_else(|| self.input.trim().to_string());
        let attachments: Vec<String> = self.attachments.iter().map(|a| a.path.clone()).collect();
        if (text.is_empty() && attachments.is_empty()) || self.running {
            return;
        }
        if let Err(e) = self.provider.ready() {
            self.note = Some(e);
            self.settings_open = true;
            return;
        }
        // A picture on its own is a message: the model is told what to do with it.
        let text = if text.is_empty() { tl!("Look at the attached picture.").to_string() } else { text };
        self.input.clear();
        self.note = None;
        self.steps = 0;
        if let Some(depth) = checkpoint {
            self.checkpoints.insert(self.messages.len(), depth);
        }
        if attachments.is_empty() {
            self.messages.push(Message::user(text));
        } else {
            self.messages.push(Message::user_with_images(text, attachments.clone()));
        }
        self.attachments.clear();
        let (tx, rx) = channel();
        self.events = Some(rx);
        self.running = true;
        self.follow = true;
        self.cancel = Arc::new(AtomicBool::new(false));
        self.steer = cadcraft_ai::agent::Steer::default();
        let cancel = Arc::clone(&self.cancel);
        let steer = self.steer.clone();
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
                    Event::Steered(_) => Progress::Steered(transcript.to_vec()),
                    Event::Done { reason } => Progress::Done {
                        transcript: transcript.to_vec(),
                        note: if reason == "stopped" { Some(tl!("Stopped.").to_string()) } else { None },
                    },
                    Event::Failed(e) => Progress::Done { transcript: transcript.to_vec(), note: Some(e) },
                };
                let _ = tx.send(progress);
            };
            cadcraft_ai::agent::run_turn(&provider, &briefing, &mut conversation, &cancel, &steer, &executor, &mut on);
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
                Progress::Steered(transcript) => {
                    self.messages = transcript;
                }
                Progress::Done { transcript, note } => {
                    self.live.clear();
                    self.messages = transcript;
                    self.running = false;
                    self.note = note;
                    // A steer the turn ended before reading waits its turn, in order, ahead of
                    // anything queued after it.
                    for text in self.steer.take().into_iter().rev() {
                        self.queued.insert(0, text);
                    }
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
        self.expanded.clear();
        self.textures.clear();
        self.checkpoints.clear();
    }

    /// Attach a picture to the next message (the paperclip, a paste, or a drop).
    pub fn attach(&mut self, path: String) {
        if path.trim().is_empty() || self.attachments.iter().any(|a| a.path == path) {
            return;
        }
        let name = std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
        self.attachments.push(Attachment { path, name, thumb: None });
    }

    /// Say something while the turn runs: `now` steers the model at its next tool call, otherwise
    /// it waits for the turn to finish and goes next. False when there was nothing to take.
    pub fn interject(&mut self, text: String, now: bool) -> bool {
        if text.trim().is_empty() {
            return false;
        }
        if now {
            self.steer.push(text);
        } else {
            self.queued.push(text);
        }
        true
    }

    /// What is waiting for the current turn to end.
    pub fn queued(&self) -> &[String] {
        &self.queued
    }

    /// Take the composer's message (text and attachment paths) the way `send_text` would, for a
    /// test that wants to check the hand-over without a provider.
    pub fn take_message_for_test(&mut self) -> (String, Vec<String>) {
        let text = self.input.trim().to_string();
        let images: Vec<String> = self.attachments.iter().map(|a| a.path.clone()).collect();
        self.input.clear();
        self.attachments.clear();
        (text, images)
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

    // A picture pasted into the pane (Ctrl+V) attaches to the next message, the way a drop does.
    #[cfg(not(target_arch = "wasm32"))]
    for image in paste_images(ui.ctx()) {
        match save_pasted_image(&image) {
            Ok(path) => app.assistant.attach(path),
            Err(e) => app.assistant.note = Some(e),
        }
    }
    let mut actions = Actions::default();
    let mut example = None;
    ui.vertical(|ui| {
        header(app, ui, &t, &mut actions);
        if app.assistant.settings_open {
            ui.add_space(4.0);
            settings(app, ui, &t);
        }
        ui.add_space(4.0);
        ui.separator();
        let list = (ui.available_height() - COMPOSER_HEIGHT).max(80.0);
        example = egui::ScrollArea::vertical()
            .id_salt("assistant-transcript")
            .auto_shrink([false, false])
            .max_height(list)
            .show(ui, |ui| transcript(app, ui, &t, &mut actions))
            .inner;
        ui.separator();
        composer(app, ui, &t, &mut actions);
    });
    if let Some(example) = example {
        app.assistant.input = example;
    }
    let ctx = ui.ctx().clone();
    apply(app, &ctx, actions);
}

/// Pictures pasted into the window since the last frame (`Event::PasteImage`), taken out of the
/// event queue so nothing else has to deal with them. Native only: the browser build has no pane.
#[cfg(not(target_arch = "wasm32"))]
fn paste_images(ctx: &egui::Context) -> Vec<egui::ColorImage> {
    let mut out = Vec::new();
    ctx.input_mut(|i| {
        i.raw.events.retain(|e| match e {
            egui::Event::PasteImage(img) => {
                out.push((**img).clone());
                false
            }
            _ => true,
        });
    });
    out
}

/// Write a pasted picture to a PNG in the temporary directory and return its path, so it is a file
/// like any other attachment (the model sees it, and the code can trace it).
#[cfg(not(target_arch = "wasm32"))]
fn save_pasted_image(image: &egui::ColorImage) -> Result<String, String> {
    let (w, h) = (image.size[0], image.size[1]);
    let mut buf = image::RgbaImage::new(w as u32, h as u32);
    for (i, px) in image.pixels.iter().enumerate() {
        let [r, g, b, a] = px.to_srgba_unmultiplied();
        let x = (i % w) as u32;
        let y = (i / w) as u32;
        buf.put_pixel(x, y, image::Rgba([r, g, b, a]));
    }
    let dir = std::env::temp_dir();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("cadcraft-paste-{stamp}.png"));
    buf.save(&path).map_err(|e| format!("{} {e}", tl!("The picture could not be saved:")))?;
    Ok(path.to_string_lossy().to_string())
}

/// Room the composer and its margins need at the bottom of the pane.
const COMPOSER_HEIGHT: f32 = 96.0;

/// The provider settings, shown under the header when the gear is on.
fn settings(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens) {
    let running = app.assistant.running();
    egui::Frame::new()
        .fill(t.field)
        .stroke(egui::Stroke::new(theme::HAIRLINE, t.border))
        .corner_radius(6.0)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
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

// ---------------------------------------------------------------------------------------------
// Drawing. The grammar is Cursor's agent panel: quiet chrome, no chat bubbles, the conversation
// as plain text on the surface, tool activity collapsed to one dim line that opens on a click,
// and a bordered composer at the bottom with the model on the left and the action on the right.
// ---------------------------------------------------------------------------------------------

/// What the pane asked for this frame; applied after the layout closures end, so nothing is
/// borrowed twice.
#[derive(Default)]
struct Actions {
    send: bool,
    /// Send now while the turn runs: the model reads it at its next tool call.
    steer_now: bool,
    stop: bool,
    clear: bool,
    settings: bool,
    preset: Option<&'static str>,
    /// A picture to attach (the paperclip), or one to drop from the message.
    attach: Option<String>,
    detach: Option<usize>,
    /// A queued message the reader dropped.
    unqueue: Option<usize>,
    /// Restore the drawing to a checkpoint: the undo depth recorded before that request.
    restore: Option<usize>,
}

/// The pane's header: which conversation this is (the dock tab already says "Assistant"), and the
/// two quiet buttons — a new conversation and the provider settings.
fn header(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, actions: &mut Actions) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(conversation_title(&app.assistant.messages)).color(t.text).strong());
        if app.assistant.running() {
            ui.add_space(4.0);
            ui.spinner();
            ui.label(RichText::new(crate::tf!("{n} step(s)", n = app.assistant.steps)).color(t.text_faint).small());
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if crate::icons::button(ui, crate::icons::Icon::Gear, 14.0, tl!("Provider settings"), app.assistant.settings_open).clicked() {
                actions.settings = true;
            }
            if crate::icons::button(ui, crate::icons::Icon::Plus, 14.0, tl!("New conversation"), false).clicked() {
                actions.clear = true;
            }
        });
    });
}

/// What this conversation is about: the reader's first words, one line, clipped. A conversation
/// that has not started is a new one.
fn conversation_title(messages: &[Message]) -> String {
    let first = messages.iter().find(|m| m.role == Role::User).map(|m| m.text().trim().to_string()).unwrap_or_default();
    let line = first.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if line.is_empty() {
        return tl!("New conversation").to_string();
    }
    let mut title: String = line.chars().take(48).collect();
    if line.chars().count() > 48 {
        title.push('…');
    }
    title
}

/// The conversation: the transcript as the model sees it, plus the answer arriving now.
fn transcript(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, actions: &mut Actions) -> Option<String> {
    if app.assistant.messages.is_empty() && app.assistant.live.is_empty() {
        return empty_state(ui, t);
    }
    // The rows the pane draws, as owned pairs: drawing updates `app` (opened rows, loaded
    // textures), so the transcript is read out first and nothing is borrowed across the loop.
    enum Row {
        /// A turn's words, whose they are (the reader's prompt, or the model's answer), and which
        /// message they came from — a checkpoint is keyed by that index.
        Said {
            text: String,
            mine: bool,
            at: usize,
        },
        Ran(cadcraft_ai::ToolCall, Option<Message>),
    }
    let results = results_by_call(&app.assistant.messages);
    let mut rows: Vec<Row> = Vec::new();
    for (at, message) in app.assistant.messages.iter().enumerate() {
        match message.role {
            Role::User => {
                let mut text = message.text().to_string();
                // The reader sees what they attached, on their own row.
                for path in &message.images {
                    let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
                    text.push_str(&format!("\n[{} {name}]", tl!("picture")));
                }
                rows.push(Row::Said { text, mine: true, at });
            }
            Role::Assistant => {
                if !message.text().trim().is_empty() {
                    rows.push(Row::Said { text: message.text().to_string(), mine: false, at });
                }
                for call in &message.tool_calls {
                    rows.push(Row::Ran(call.clone(), results.get(call.id.as_str()).map(|m| (*m).clone())));
                }
            }
            Role::Tool | Role::System => {}
        }
    }
    let live = app.assistant.live.clone();
    for row in &rows {
        match row {
            Row::Said { text, mine: true, at } => {
                // The checkpoint of this row: the drawing's undo depth before it was asked for.
                let checkpoint = app.assistant.checkpoints.get(at).copied();
                if user_turn(ui, t, text, checkpoint.is_some()) {
                    actions.restore = checkpoint;
                }
            }
            Row::Said { text, mine: false, .. } => assistant_text(ui, t, text),
            Row::Ran(call, result) => activity(app, ui, t, call, result.as_ref()),
        }
    }
    if !live.is_empty() {
        assistant_text(ui, t, &live);
    }
    if app.assistant.running && app.assistant.live.is_empty() {
        ui.horizontal(|ui| {
            ui.add_space(2.0);
            ui.label(RichText::new(tl!("Thinking…")).color(t.text_faint).small());
        });
    }
    if app.assistant.follow {
        ui.scroll_to_cursor(Some(Align::BOTTOM));
        app.assistant.follow = false;
    }
    None
}

/// Nothing said yet: what this is, and three things to try (clicking one fills the composer).
fn empty_state(ui: &mut egui::Ui, t: &Tokens) -> Option<String> {
    ui.add_space(8.0);
    ui.label(RichText::new(tl!("Ask for a change to this drawing — the assistant works in it directly.")).color(t.text_dim));
    ui.add_space(2.0);
    ui.label(
        RichText::new(tl!("It writes AutoLISP in the open drawing: (cmd \"circle\" '((CENTER . (0 0)) (RADIUS . 5))) draws, (commands) lists what the application offers, (render) shows it a picture. Helpers it writes are kept for the next session."))
            .color(t.text_faint)
            .small(),
    );
    ui.add_space(8.0);
    let mut clicked = None;
    for example in [
        tl!("Measure this drawing and tell me what is wrong with it"),
        tl!("Offset every closed outline 2 mm outward and fillet the corners"),
        tl!("Trace the picture I attached and scale it to 30 mm"),
    ] {
        let response = ui.add(egui::Label::new(RichText::new(example).color(t.text_dim).small()).sense(egui::Sense::click()));
        if response.clicked() {
            clicked = Some(example.to_string());
        }
        ui.add_space(2.0);
    }
    clicked
}

/// One user turn: a quiet inset block, the way a prompt reads in Cursor's composer. When the row
/// has a checkpoint, a restore control appears while the pointer is over it: clicking reverts the
/// drawing to the state before that request (the conversation stays). Returns whether it was
/// clicked.
fn user_turn(ui: &mut egui::Ui, t: &Tokens, text: &str, restorable: bool) -> bool {
    ui.add_space(6.0);
    let mut slot = None;
    let inner = egui::Frame::new().fill(t.control).corner_radius(6.0).inner_margin(egui::Margin::symmetric(10, 7)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        if restorable {
            ui.horizontal(|ui| {
                prose(ui, t.text, text);
                // The space is reserved either way, so the text does not move when the control
                // appears.
                let (rect, _) = ui.allocate_exact_size(vec2(18.0, 18.0), egui::Sense::hover());
                slot = Some(rect);
            });
        } else {
            prose(ui, t.text, text);
        }
    });
    let mut clicked = false;
    if let Some(rect) = slot
        && inner.response.hovered()
    {
        let resp = ui.interact(rect, ui.scope_id().with(("assistant-restore", rect.top() as i32)), egui::Sense::click());
        crate::icons::paint(ui.painter(), rect, crate::icons::Icon::Undo, !resp.hovered());
        if resp.on_hover_text(tl!("Restore the drawing to before this request")).clicked() {
            clicked = true;
        }
    }
    ui.add_space(4.0);
    clicked
}

/// The model's words: plain on the surface, no bubble, comfortable measure.
fn assistant_text(ui: &mut egui::Ui, t: &Tokens, text: &str) {
    ui.add_space(4.0);
    ui.horizontal_wrapped(|ui| {
        ui.add_space(2.0);
        prose(ui, t.text, text);
    });
    ui.add_space(4.0);
}

/// Text with the pane's own measure and wrapping.
fn prose(ui: &mut egui::Ui, colour: Color32, text: &str) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width() - 4.0;
    job.append(text, 0.0, egui::TextFormat { font_id: crate::theme::body(), color: colour, ..Default::default() });
    ui.label(job);
}

/// One tool call as Cursor shows work: a single dim line that opens on a click, with anything it
/// produced — a rendered picture — standing inline as an artifact card.
fn activity(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, call: &cadcraft_ai::ToolCall, result: Option<&Message>) {
    let open = app.assistant.expanded.contains(&call.id);
    let failed = result.is_some_and(|m| m.error);
    let mark = match result {
        None => tl!("…"),
        Some(m) if m.error => tl!("!"),
        Some(_) => tl!("✓"),
    };
    let (headline, rest) = activity_lines(call, result);
    let mut toggle = false;
    ui.horizontal(|ui| {
        ui.add_space(2.0);
        let (rect, arrow) = ui.allocate_exact_size(vec2(12.0, 12.0), egui::Sense::click());
        let icon = if open { crate::icons::Icon::ChevronDown } else { crate::icons::Icon::ChevronRight };
        crate::icons::paint(ui.painter(), rect, icon, false);
        toggle |= arrow.clicked();
        let colour = if failed { t.compare_other } else { t.text_dim };
        let label =
            ui.add(egui::Label::new(RichText::new(format!("{mark} {headline}")).color(colour).small()).truncate().sense(egui::Sense::click()));
        toggle |= label.clicked();
        if let Some(rest) = &rest {
            let label = ui.add(egui::Label::new(RichText::new(rest).color(t.text_faint).small()).truncate().sense(egui::Sense::click()));
            toggle |= label.clicked();
        }
    });
    if toggle && open {
        app.assistant.expanded.remove(&call.id);
    } else if toggle {
        app.assistant.expanded.insert(call.id.clone());
    }
    if open {
        egui::Frame::new().fill(t.field).corner_radius(6.0).inner_margin(egui::Margin::symmetric(8, 6)).show(ui, |ui| {
            ui.set_width(ui.available_width());
            mono(ui, t.text, &call.code());
            if let Some(m) = result {
                ui.add_space(4.0);
                mono(ui, if failed { t.compare_other } else { t.text_dim }, m.text().trim());
            }
        });
    }
    if let Some(m) = result {
        for path in render_paths(m) {
            render_card(app, ui, t, &path);
        }
    }
    ui.add_space(2.0);
}

/// Monospaced text on the pane's surface, for code and the answers it printed.
fn mono(ui: &mut egui::Ui, colour: Color32, text: &str) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width();
    job.append(
        text,
        0.0,
        egui::TextFormat { font_id: egui::FontId::new(theme::FONT_CHIP, egui::FontFamily::Monospace), color: colour, ..Default::default() },
    );
    ui.label(job);
}

/// The one-line form of a call and its result: the first line of the code, how many more lines,
/// and the first line of what came back.
fn activity_lines(call: &cadcraft_ai::ToolCall, result: Option<&Message>) -> (String, Option<String>) {
    let code = call.code();
    let mut lines = code.lines().filter(|l| !l.trim().is_empty());
    let first = lines.next().unwrap_or_default().trim().to_string();
    let more = lines.count();
    let head = if more > 0 { format!("{first}  +{more}") } else { first };
    let rest = result.and_then(|m| {
        m.text().lines().find(|l| !l.trim().is_empty()).map(|l| {
            let l = l.trim();
            if l.chars().count() > 90 { format!("→ {}…", l.chars().take(89).collect::<String>()) } else { format!("→ {l}") }
        })
    });
    (head, rest)
}

/// A render the code drew, as an artifact card: the picture itself, with its path underneath.
fn render_card(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, path: &str) {
    let Some((texture, size)) = texture_for(app, ui.ctx(), path) else { return };
    ui.add_space(2.0);
    egui::Frame::new()
        .fill(t.field)
        .stroke(egui::Stroke::new(theme::HAIRLINE, t.border))
        .corner_radius(6.0)
        .inner_margin(egui::Margin::symmetric(8, 6))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(RichText::new(format!("{} · {}×{}", tl!("render"), size[0], size[1])).color(t.text_faint).small());
            ui.add_space(4.0);
            let max_w = ui.available_width() - 4.0;
            let max_h = 320.0_f32;
            let (w, h) = (size[0] as f32, size[1] as f32);
            let scale = (max_w / w).min(max_h / h).min(1.0);
            ui.add(egui::Image::new(&texture).fit_to_exact_size(vec2((w * scale).max(1.0), (h * scale).max(1.0))));
            ui.add_space(2.0);
            ui.label(RichText::new(path).color(t.text_faint).small());
        });
    ui.add_space(2.0);
}

/// Load a PNG the code rendered, once, and keep the texture for the rest of the session.
fn texture_for(app: &mut crate::CadApp, ctx: &egui::Context, path: &str) -> Option<(egui::TextureHandle, [usize; 2])> {
    if let Some(hit) = app.assistant.textures.get(path) {
        return Some(hit.clone());
    }
    let img = image::open(path).ok()?.to_rgba8();
    let size = [img.width() as usize, img.height() as usize];
    let texture = ctx.load_texture(path, egui::ColorImage::from_rgba_unmultiplied(size, img.as_raw()), egui::TextureOptions::LINEAR);
    app.assistant.textures.insert(path.to_string(), (texture.clone(), size));
    Some((texture, size))
}

/// The PNG paths a tool result reports. The result the pane holds is the report **text** the model
/// read, so its `rendered <path>` lines are the pictures to show.
fn render_paths(message: &Message) -> Vec<String> {
    message
        .text()
        .lines()
        .filter_map(|line| line.trim().strip_prefix("rendered "))
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

/// Each tool call with its result, looked up in the transcript by call id — the transcript is the
/// only state, so a row can never disagree with what the model actually received.
fn results_by_call(messages: &[Message]) -> std::collections::HashMap<&str, &Message> {
    messages.iter().filter(|m| m.role == Role::Tool).filter_map(|m| m.tool_call_id.as_deref().map(|id| (id, m))).collect()
}

/// The composer: a bordered box holding the attachments, the field, and a bottom row with the
/// model, how full the context is, and the action — the shape Cursor's input has.
fn composer(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, actions: &mut Actions) {
    let running = app.assistant.running();
    let queued = app.assistant.queued.clone();
    let names: Vec<String> = app.assistant.attachments.iter().map(|a| a.name.clone()).collect();
    let mut attachments: Vec<(usize, String, Option<egui::TextureHandle>)> = Vec::with_capacity(names.len());
    for (i, name) in names.into_iter().enumerate() {
        let thumb = app.assistant.attachments.get(i).cloned();
        let thumb = match thumb {
            Some(a) => thumb_for(app, ui.ctx(), &a),
            None => None,
        };
        attachments.push((i, name, thumb));
    }
    // What the reader queued while the turn runs, in order, each droppable. The rows keep their
    // shape and take the composer recipe's 6px inset and gap (§1.2).
    for (i, text) in queued.iter().enumerate() {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = theme::GAP_6;
            ui.add_space(theme::GAP_6);
            ui.label(RichText::new(tl!("queued")).color(t.text_faint).small());
            let line = text.lines().next().unwrap_or("").trim();
            let line = if line.chars().count() > 64 { format!("{}…", line.chars().take(63).collect::<String>()) } else { line.to_string() };
            ui.label(RichText::new(line).color(t.text_dim).small());
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.add(egui::Button::new(RichText::new("×").color(t.text_faint).small()).frame(false)).clicked() {
                    actions.unqueue = Some(i);
                }
            });
        });
    }
    // `.full-input-box`'s `solid 1px` border, `border` at rest and the focus colour while the
    // field holds keyboard focus (§1.2). The field's id is explicit so the focus read and the
    // widget agree across passes.
    let field_id = ui.make_persistent_id("assistant-composer-field");
    let field_focused = ui.memory(|m| m.has_focus(field_id));
    let frame =
        egui::Frame::new().fill(t.field).corner_radius(theme::RADIUS_CARD).inner_margin(egui::Margin::same(theme::GAP_6 as i8)).show(ui, |ui| {
            // `.full-input-box { border-radius:0.25rem; padding:6px; gap:6px }` (§1.2): the box's
            // children sit 6px apart.
            ui.spacing_mut().item_spacing = egui::vec2(theme::GAP_6, theme::GAP_6);
            ui.set_width(ui.available_width());
            if !attachments.is_empty() {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(theme::GAP_6, theme::GAP_4);
                    for (i, name, thumb) in &attachments {
                        egui::Frame::new()
                            .fill(t.control)
                            .corner_radius(theme::RADIUS_CARD)
                            .inner_margin(egui::Margin::symmetric(theme::GAP_6 as i8, theme::GAP_4 as i8))
                            .show(ui, |ui| {
                                ui.spacing_mut().item_spacing.x = theme::GAP_4;
                                ui.horizontal(|ui| {
                                    match thumb {
                                        Some(tex) => {
                                            let side = 34.0;
                                            let size = tex.size_vec2();
                                            let scale = (side / size.x).min(side / size.y).min(1.0);
                                            ui.add(egui::Image::new(tex).fit_to_exact_size(size * scale));
                                        }
                                        None => {
                                            ui.label(RichText::new(tl!("picture")).color(t.text_faint).small());
                                        }
                                    }
                                    ui.label(RichText::new(name).color(t.text_dim).small());
                                    if ui.add(egui::Button::new(RichText::new("×").color(t.text_faint).small()).frame(false)).clicked() {
                                        actions.detach = Some(*i);
                                    }
                                });
                            });
                    }
                });
            }
            let hint = if running { tl!("Ask for a change while it works — Enter queues it") } else { tl!("Ask for a change to this drawing…") };
            let edit = egui::TextEdit::multiline(&mut app.assistant.input)
                .id(field_id)
                .desired_rows(2)
                .desired_width(f32::INFINITY)
                .frame(egui::Frame::NONE)
                .hint_text(hint);
            let response = ui.add(edit);
            let (enter, enter_now) = ui.input(|i| {
                let pressed = i.key_pressed(egui::Key::Enter);
                (pressed && !i.modifiers.command && !i.modifiers.ctrl, pressed && (i.modifiers.command || i.modifiers.ctrl))
            });
            if response.has_focus() {
                if enter_now {
                    actions.send = true;
                    actions.steer_now = running;
                } else if enter {
                    actions.send = true;
                }
            }
            ui.horizontal(|ui| {
                // `.composer-bar-input-buttons { align-items:center; display:flex; gap:4px }` (§1.3).
                ui.spacing_mut().item_spacing.x = theme::GAP_4;
                // The paperclip: a picture joins the next message.
                if crate::widgets::icon_button(ui, crate::icons::Icon::Attach, 16.0, tl!("Attach a picture"), false).clicked()
                    && let Some(pick) = app.services.pick_image.as_ref()
                {
                    actions.attach = pick();
                }
                // The model chip: `.composer-unified-dropdown` (§1.17) as `widgets::chip`; clicking
                // it opens the preset menu.
                let label = if app.assistant.provider.model.trim().is_empty() { tl!("No model") } else { app.assistant.provider.model.as_str() };
                let chip = crate::widgets::chip(ui, label, crate::widgets::ChipKind::Neutral);
                egui::Popup::menu(&chip).show(|ui| {
                    for p in client::PRESETS {
                        let hit = app.assistant.preset == p.id;
                        let text = if p.model.is_empty() { p.label.to_string() } else { format!("{} · {}", p.label, p.model) };
                        if ui.selectable_label(hit, RichText::new(text).small()).clicked() {
                            actions.preset = Some(p.id);
                        }
                    }
                });
                if app.assistant.provider.ready().is_err() {
                    ui.label(RichText::new(tl!("needs a provider")).color(t.compare_other).small());
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if running {
                        let now = crate::widgets::button(ui, "Send now", crate::widgets::Kind::Primary);
                        if now.on_hover_text(tl!("The model reads it at its next tool call")).clicked() {
                            actions.send = true;
                            actions.steer_now = true;
                        }
                        let queue = ui
                            .add_enabled_ui(!app.assistant.input.trim().is_empty(), |ui| {
                                crate::widgets::button(ui, "Queue", crate::widgets::Kind::Ghost)
                            })
                            .inner;
                        if queue.clicked() {
                            actions.send = true;
                        }
                        if crate::widgets::button(ui, "Stop", crate::widgets::Kind::Ghost).clicked() {
                            actions.stop = true;
                        }
                    } else {
                        let ready = !app.assistant.input.trim().is_empty() || !app.assistant.attachments.is_empty();
                        let send = ui.add_enabled_ui(ready, |ui| crate::widgets::button(ui, "Send", crate::widgets::Kind::Primary)).inner;
                        if send.clicked() {
                            actions.send = true;
                        }
                    }
                    context_meter(ui, t, &app.assistant.messages);
                });
            });
        });
    // Painted over the content so the hairline reads on top.
    let border = if field_focused { t.accent } else { t.border };
    ui.painter().rect_stroke(frame.response.rect, theme::RADIUS_CARD, egui::Stroke::new(theme::HAIRLINE, border), egui::StrokeKind::Inside);
    if let Some(note) = app.assistant.note.clone() {
        ui.add_space(2.0);
        ui.label(RichText::new(note).color(t.compare_other).small());
    }
}

/// How full the context is: the characters the conversation will send, of the budget the request
/// keeps. Hovering breaks it down. The transcript is what costs; the drawing itself is read
/// through code, so it never sits in the window.
fn context_meter(ui: &mut egui::Ui, t: &Tokens, messages: &[Message]) {
    let (total, tool) = context_usage(messages);
    let budget = cadcraft_ai::chat::MAX_REQUEST_CHARS;
    let share = total as f64 / budget as f64;
    let colour = if share > 0.8 {
        t.compare_other
    } else if share > 0.5 {
        t.text_dim
    } else {
        t.text_faint
    };
    let label = format!("{:.1}k/{}k", total as f64 / 1000.0, budget / 1000);
    ui.label(RichText::new(label).color(colour).small()).on_hover_text(crate::tf!(
        "context: {used} of {budget} characters — tool results {tool}. Older turns are dropped when it is full.",
        used = total,
        budget = budget,
        tool = tool
    ));
}

/// The context the conversation will send: all of it, and how much of that is tool results.
fn context_usage(messages: &[Message]) -> (usize, usize) {
    let total: usize = messages.iter().map(|m| m.text().chars().count()).sum();
    let tool: usize = messages.iter().filter(|m| m.role == Role::Tool).map(|m| m.text().chars().count()).sum();
    (total, tool)
}

/// A thumbnail for one attachment, loaded once and kept.
fn thumb_for(app: &mut crate::CadApp, ctx: &egui::Context, a: &Attachment) -> Option<egui::TextureHandle> {
    if a.thumb.is_some() {
        return app.assistant.attachments.iter().find(|x| x.path == a.path).and_then(|x| x.thumb.clone());
    }
    let img = image::open(&a.path).ok()?.to_rgba8();
    let size = [img.width() as usize, img.height() as usize];
    let tex = ctx.load_texture(&a.path, egui::ColorImage::from_rgba_unmultiplied(size, img.as_raw()), egui::TextureOptions::LINEAR);
    if let Some(slot) = app.assistant.attachments.iter_mut().find(|x| x.path == a.path) {
        slot.thumb = Some(tex.clone());
    }
    Some(tex)
}

/// Apply what the pane asked for this frame.
fn apply(app: &mut crate::CadApp, ctx: &egui::Context, actions: Actions) {
    if actions.settings {
        app.assistant.settings_open = !app.assistant.settings_open;
    }
    if actions.clear {
        app.assistant.clear();
    }
    if let Some(id) = actions.preset
        && let Some(p) = client::preset(id)
    {
        app.assistant.preset = p.id.to_string();
        if !p.base_url.is_empty() {
            app.assistant.provider.base_url = p.base_url.to_string();
        }
        if !p.model.is_empty() {
            app.assistant.provider.model = p.model.to_string();
        }
    }
    if let Some(path) = actions.attach {
        app.assistant.attach(path);
    }
    if let Some(i) = actions.detach
        && i < app.assistant.attachments.len()
    {
        app.assistant.attachments.remove(i);
    }
    if let Some(i) = actions.unqueue
        && i < app.assistant.queued.len()
    {
        app.assistant.queued.remove(i);
    }
    if let Some(depth) = actions.restore {
        // The drawing goes back; the conversation stays (Cursor's rule for its own checkpoints).
        match app.session.undo_to(depth) {
            Ok(0) => app.assistant.note = Some(tl!("The drawing is already at that point.").to_string()),
            Ok(n) => app.assistant.note = Some(crate::tf!("Drawing restored to before that request ({n} step(s) undone).", n = n)),
            Err(e) => app.assistant.note = Some(format!("{e}")),
        }
    }
    if actions.stop {
        app.assistant.stop();
    }
    if actions.send {
        let text = app.assistant.input.trim().to_string();
        let briefing = briefing(app);
        if app.assistant.running() {
            // While a turn runs: Enter (or Queue) waits for it, Send now steers it.
            if app.assistant.interject(text, actions.steer_now) {
                app.assistant.input.clear();
            }
        } else {
            let depth = app.session.state().ok().map(|s| s.undo.len());
            app.assistant.send_text(briefing, ctx, None, depth);
        }
    }
    // A queued message goes as soon as the turn before it is over.
    if !app.assistant.running()
        && let Some(next) = app.assistant.queued.first().cloned()
    {
        app.assistant.queued.remove(0);
        let briefing = briefing(app);
        let depth = app.session.state().ok().map(|s| s.undo.len());
        app.assistant.send_text(briefing, ctx, Some(next), depth);
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
    // Pictures for that ask: `attach` takes one path or a list, and implies asking.
    let attach: Vec<String> = match params.get("attach") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        _ => Vec::new(),
    };
    if !attach.is_empty() {
        app.assistant_pending.attach = attach;
        if app.assistant_pending.ask.is_none() {
            app.assistant_pending.ask = Some(String::new());
        }
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
    /// Pictures to attach to the ask, from the command's `attach` parameter (a path or a list).
    pub attach: Vec<String>,
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
    for path in pending.attach {
        app.assistant.attach(path);
    }
    if let Some(ask) = pending.ask {
        app.assistant.input = ask;
        let briefing = briefing(app);
        let depth = app.session.state().ok().map(|s| s.undo.len());
        app.assistant.send_text(briefing, ctx, None, depth);
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
    fn a_picture_attaches_once_and_carries_its_name() {
        let mut a = Assistant::default();
        a.attach("D:/ref/wing.png".into());
        a.attach("D:/ref/wing.png".into());
        assert_eq!(a.attachments.len(), 1, "the same file is not attached twice");
        assert_eq!(a.attachments[0].name, "wing.png");
        a.attach("  ".into());
        assert_eq!(a.attachments.len(), 1, "an empty path attaches nothing");
    }

    #[test]
    fn a_message_said_while_the_turn_runs_waits_or_steers() {
        let mut a = Assistant::default();
        assert!(a.interject("also fillet the corners".into(), false));
        assert_eq!(a.queued(), &["also fillet the corners".to_string()]);
        assert!(a.steer.is_empty(), "queueing does not steer");
        assert!(a.interject("wait, use layer Walls".into(), true));
        assert_eq!(a.steer.take(), vec!["wait, use layer Walls".to_string()]);
        assert!(a.steer.is_empty(), "steering takes the message out");
        assert_eq!(a.queued().len(), 1, "the queued one is untouched");
        assert!(!a.interject("   ".into(), false), "nothing to take");
    }

    #[test]
    fn the_context_meter_counts_the_conversation_and_the_tool_results() {
        let messages = vec![
            Message::user("draw a wing"),
            Message::assistant_calls(vec![call("c1", "run", json!({"code": "(cmd \"describe\")"}))], None),
            Message::tool_result(&call("c1", "run", json!({})), &json!({"value": "((COUNTS (POLYLINE . 3)))"})),
        ];
        let (total, tool) = context_usage(&messages);
        assert!(total > tool && tool > 0, "total {total}, tool {tool}");
        assert_eq!(tool, messages[2].text().chars().count());
    }

    #[test]
    fn clearing_forgets_the_checkpoints_too() {
        let mut a = Assistant::default();
        a.checkpoints.insert(0, 4);
        a.clear();
        assert!(a.checkpoints.is_empty(), "a new conversation has no restore points");
    }

    #[test]
    fn the_header_names_the_conversation() {
        assert_eq!(conversation_title(&[]), "New conversation");
        let messages = vec![Message::user("draw a wing outline 60 wide\nand measure it"), Message::assistant("Done.")];
        assert_eq!(conversation_title(&messages), "draw a wing outline 60 wide");
        let long = vec![Message::user("x".repeat(80))];
        let title = conversation_title(&long);
        assert_eq!(title.chars().count(), 49, "clipped with an ellipsis: {title}");
        assert!(title.ends_with('…'));
    }

    #[test]
    fn an_activity_row_finds_its_result_by_call_id() {
        let messages = vec![
            Message::user("draw"),
            Message::assistant_calls(vec![call("c1", "run", json!({"code": "(cmd \"circle\")"}))], None),
            Message::tool_result(&call("c1", "run", json!({})), &json!({"value": "((HANDLE . \"2F\"))"})),
            Message::assistant_calls(vec![call("c2", "run", json!({"code": "(kept)"}))], None),
        ];
        let results = results_by_call(&messages);
        assert_eq!(results.len(), 1);
        assert!(results["c1"].text().contains("HANDLE"));
        assert!(!results.contains_key("c2"), "a call with no result yet shows as running");
    }

    #[test]
    fn an_activity_row_reads_as_the_code_and_its_first_answer() {
        let call = call("c1", "run", json!({"code": "(defun wing (w)\n  (list w 2))\n(wing 60)"}));
        let result = Message::tool_result(&call, &json!({"value": "60", "output": ["done"], "kept": ["WING"]}));
        let (head, rest) = activity_lines(&call, Some(&result));
        assert!(head.starts_with("(defun wing (w)"), "{head}");
        assert!(head.ends_with("+2"), "more lines are counted: {head}");
        assert!(rest.unwrap().starts_with("→ "), "the answer's first line follows the code");
    }

    #[test]
    fn a_render_in_a_report_becomes_an_artifact_card() {
        // The message holds the report text (what the model read), so the card's paths come from
        // its `rendered` lines — exactly what a live run stores.
        let report = cadcraft_ai::code::Report::of(&json!({"value": "nil", "images": ["C:/tmp/a.png", "C:/tmp/b.png"]})).text();
        let message = Message::tool_result(&call("c1", "run", json!({"code": "(render)"})), &json!(report));
        assert!(message.text().contains("rendered C:/tmp/a.png"), "{}", message.text());
        let paths = render_paths(&message);
        assert_eq!(paths.len(), 2, "{paths:?}");
        assert_eq!(paths[0], "C:/tmp/a.png");
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
