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
//!
//! The pane has two faces, chosen by the tab strip under the header ([`Mode`]). **Chat** is the
//! conversation: the model's turns as full-width prose with a quiet role dot, the reader's as
//! bubbles on the right, markdown-lite for the model's text, and one rounded composer with the
//! action inside it. **Source** is the CAD face: the drawing as CadScript over the control
//! channel (`cadscript.source` / `cadscript.run`), cached against the drawing's revision,
//! editable, and rebuildable.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, TryRecvError, channel};
use std::time::Duration;

use cadcraft_ai::chat::{Message, Role};
use cadcraft_ai::client::{self, Provider};
use cadcraft_ai::code;
use cadcraft_ai::{Event, ToolExecutor};
use egui::epaint::text::VariationCoords;
use egui::{Align, Align2, Color32, FontId, RichText, pos2, vec2};
use serde_json::Value;

use crate::control::{ControlRequest, Outcome};
use crate::theme::{self, Tokens};
use crate::tl;

/// How long one tool call may take before the model is told it did not finish. Generous: a
/// drawing-wide operation on a large drawing is slow, and the worker is not blocking the
/// interface while it waits.
const TOOL_TIMEOUT: Duration = Duration::from_secs(300);

/// How long a `cadscript` control call may take before the Source tab gives up on it. The call is
/// answered on the interface thread, so this only bounds a stalled or absent control channel.
const SOURCE_TIMEOUT: Duration = Duration::from_secs(30);

/// Lines past which the Source gutter stops measuring every line's wrapped height (a script that
/// long is not a script a reader scrolls; the numbers still count lines, one row each).
const SOURCE_GUTTER_LINES: usize = 4_000;

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
    /// Which face of the pane shows: the conversation, or the drawing as a script.
    pub mode: Mode,
    /// The Source tab's state: the script, how it was fetched, and the last rebuild's answer.
    source: Source,
}

/// Which face of the pane shows: the conversation, or the drawing as CadScript.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    /// The chat: the transcript, the composer, the model.
    #[default]
    Chat,
    /// The drawing as a readable script, editable and rebuildable.
    Source,
}

/// What the Source tab is waiting for on the control channel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Waiting {
    /// The drawing's script, for the editor.
    Source,
    /// The answer to a rebuild: the script run back into the drawing.
    Rebuild,
}

/// The Source tab: the drawing's CadScript, cached until the tab is opened, `Rebuild` is pressed,
/// or the drawing revision changes.
#[derive(Default)]
struct Source {
    /// The text the editor holds (editable, so not always what the drawing last said).
    text: String,
    /// Whether the drawing's script has ever arrived.
    loaded: bool,
    /// A control call is in flight.
    fetching: bool,
    /// The reader asked for a fresh copy (opening the tab, pressing `Rebuild`, a new revision).
    needs: bool,
    /// The drawing `(uid, revision)` the text was fetched for.
    key: Option<(u64, u64)>,
    /// The drawing `(uid, revision)` the in-flight fetch was issued for.
    issued: Option<(u64, u64)>,
    /// What the in-flight call is.
    waiting: Option<Waiting>,
    /// The last failure, shown quietly in the toolbar area — never a dialog.
    error: Option<String>,
    /// What a rebuild printed, one line each.
    output: Vec<String>,
    /// The reply of the in-flight call, sent by its own thread so the interface never blocks.
    rx: Option<Receiver<Value>>,
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
            mode: Mode::default(),
            source: Source::default(),
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

    /// Show a face of the pane. Opening `Source` asks the control channel for the drawing's
    /// script, the same way pressing `Rebuild` does.
    pub fn open_tab(&mut self, mode: Mode) {
        self.mode = mode;
        if mode == Mode::Source {
            self.source.needs = true;
        }
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

/// Draw the pane: the conversation or the drawing's script, the composer, and the settings.
pub fn show(app: &mut crate::CadApp, ui: &mut egui::Ui) {
    let t = Tokens::get();
    app.assistant.drain();
    // The command line's ASSISTANT command can ask the pane to do something this frame.
    apply_pending(app, ui.ctx());
    if app.assistant.running() {
        // Streamed text arrives on another thread; keep painting until the turn is over.
        ui.ctx().request_repaint();
    }
    // The Source tab's control calls: what came back, and what the drawing's revision asks for.
    drain_source(app);
    if app.assistant.mode == Mode::Source {
        // The request is answered between frames, so the pane keeps painting while one is in
        // flight — otherwise a quiet window would never drain it and the call would time out.
        if app.assistant.source.fetching {
            ui.ctx().request_repaint();
        }
        maybe_fetch_source(app, ui.ctx());
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
        ui.add_space(theme::GAP_4);
        tabs(app, ui, &t, &mut actions);
        ui.separator();
        match app.assistant.mode {
            Mode::Chat => {
                let list = (ui.available_height() - COMPOSER_HEIGHT).max(80.0);
                example = chat(app, ui, &t, &mut actions, list);
                composer(app, ui, &t, &mut actions);
            }
            Mode::Source => source_tab(app, ui, &t, &mut actions),
        }
    });
    if let Some(example) = example {
        app.assistant.input = example;
    }
    let ctx = ui.ctx().clone();
    apply(app, &ctx, actions);
}

/// The pane's two faces as a quiet tab strip under the header: the active label sits on an accent
/// hairline, the other stays dim.
fn tabs(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, actions: &mut Actions) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_12;
        for (mode, label) in [(Mode::Chat, tl!("Chat")), (Mode::Source, tl!("Source"))] {
            let active = app.assistant.mode == mode;
            let colour = if active { t.text } else { t.text_dim };
            let galley = ui.painter().layout_no_wrap(label.to_owned(), theme::body(), colour);
            let (rect, response) = ui.allocate_exact_size(vec2(galley.size().x, theme::CONTROL_H_TAB_COMPACT), egui::Sense::click());
            let at = pos2(rect.left(), rect.center().y - galley.size().y / 2.0);
            ui.painter().galley(at, galley, colour);
            if active {
                ui.painter().hline(rect.x_range(), rect.bottom(), egui::Stroke::new(theme::HAIRLINE, t.accent));
            }
            response.widget_info(|| egui::WidgetInfo::selected(egui::Role::Tab, true, active, label));
            crate::control::record_widget(ui, &response, label, "tab", Some(active));
            if response.clicked() {
                actions.mode = Some(mode);
            }
        }
    });
}

/// The conversation face: the transcript, with the way back to the newest message floating over
/// its bottom corner once the reader has scrolled up.
fn chat(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, actions: &mut Actions, height: f32) -> Option<String> {
    let out = egui::ScrollArea::vertical()
        .id_salt("assistant-transcript")
        .auto_shrink([false, false])
        .max_height(height)
        .show(ui, |ui| transcript(app, ui, t, actions));
    let max = (out.content_size.y - out.inner_rect.height()).max(0.0);
    if max > 0.0 && out.state.clamped_offset().y < max - theme::GAP_8 {
        let side = theme::CONTROL_H_BUTTON;
        let rect = egui::Rect::from_min_size(
            pos2(out.inner_rect.right() - side - theme::GAP_8, out.inner_rect.bottom() - side - theme::GAP_8),
            vec2(side, side),
        );
        let response = ui.interact(rect, ui.scope_id().with("assistant-scroll-down"), egui::Sense::click());
        let fill = if response.hovered() { t.control_hover } else { t.control };
        ui.painter().circle_filled(rect.center(), side / 2.0, fill);
        ui.painter().circle_stroke(rect.center(), side / 2.0, egui::Stroke::new(theme::HAIRLINE, t.border));
        crate::icons::paint(ui.painter(), rect.shrink(theme::GAP_6), crate::icons::Icon::ChevronDown, false);
        let label = tl!("Scroll to the newest message");
        response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, label));
        crate::control::record_widget(ui, &response, label, "button", None);
        if response.clicked() {
            actions.scroll_to_bottom = true;
        }
    }
    out.inner
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

/// Room the composer and its margins need at the bottom of the pane: the field (two rows), the
/// footer line, and the attachment chips when there are any.
const COMPOSER_HEIGHT: f32 = 104.0;

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
    /// A tab the reader chose.
    mode: Option<Mode>,
    /// The Source toolbar's two actions.
    source_copy: bool,
    source_rebuild: bool,
    /// The reader asked for the newest message (the floating button).
    scroll_to_bottom: bool,
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
    let running = app.assistant.running;
    for row in &rows {
        match row {
            Row::Said { text, mine: true, at } => {
                // The checkpoint of this row: the drawing's undo depth before it was asked for.
                let checkpoint = app.assistant.checkpoints.get(at).copied();
                if user_turn(ui, t, text, checkpoint.is_some()) {
                    actions.restore = checkpoint;
                }
            }
            Row::Said { text, mine: false, .. } => assistant_turn(ui, t, text, false),
            Row::Ran(call, result) => activity(app, ui, t, call, result.as_ref()),
        }
    }
    if !live.is_empty() {
        assistant_turn(ui, t, &live, running);
    }
    if running && app.assistant.live.is_empty() {
        // Before the first token: a spinner and the word, never an empty pane.
        ui.add_space(theme::GAP_6);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = theme::GAP_6;
            ui.spinner();
            ui.label(RichText::new(tl!("Thinking")).color(t.text_dim));
        });
        ui.add_space(theme::GAP_4);
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

/// One reader turn: a soft bubble hugging the right of the pane, the way a chat shows the reader.
/// When the row has a checkpoint, a restore control appears while the pointer is over it: clicking
/// reverts the drawing to the state before that request (the conversation stays). Returns whether
/// it was clicked.
fn user_turn(ui: &mut egui::Ui, t: &Tokens, text: &str, restorable: bool) -> bool {
    ui.add_space(theme::GAP_6);
    let mut slot = None;
    ui.with_layout(egui::Layout::right_to_left(egui::Align::TOP), |ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_4;
        ui.add_space(theme::GAP_2);
        // The bubble keeps a margin from the pane's left edge, so a long prompt still reads as the
        // reader's own turn rather than a full-width block.
        let max_w = ui.available_width() * 0.82;
        let inner = egui::Frame::new()
            .fill(t.control)
            .corner_radius(theme::RADIUS_PILL)
            .inner_margin(egui::Margin::symmetric(theme::GAP_10 as i8, theme::GAP_6 as i8))
            .show(ui, |ui| {
                ui.set_max_width(max_w);
                prose(ui, t.text, text);
            });
        if restorable {
            // The space is reserved either way, so the bubble does not move when the control
            // appears.
            let (rect, _) = ui.allocate_exact_size(vec2(18.0, 18.0), egui::Sense::hover());
            slot = Some((rect, inner.response.hovered()));
        }
    });
    let mut clicked = false;
    if let Some((rect, hovered)) = slot
        && hovered
    {
        let resp = ui.interact(rect, ui.scope_id().with(("assistant-restore", rect.top() as i32)), egui::Sense::click());
        crate::icons::paint(ui.painter(), rect, crate::icons::Icon::Undo, !resp.hovered());
        if resp.on_hover_text(tl!("Restore the drawing to before this request")).clicked() {
            clicked = true;
        }
    }
    ui.add_space(theme::GAP_4);
    clicked
}

/// One model turn: a quiet role dot at the left, then the answer as full-width prose on the pane
/// background — no bubble, the way a modern chat shows the model. `streaming` puts the caret at
/// the end of the words arriving now.
fn assistant_turn(ui: &mut egui::Ui, t: &Tokens, text: &str, streaming: bool) {
    ui.add_space(theme::GAP_6);
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_6;
        let (dot, _) = ui.allocate_exact_size(vec2(theme::GAP_6, theme::GAP_6), egui::Sense::hover());
        ui.painter().circle_filled(dot.center(), theme::GAP_6 / 2.0, t.accent);
        ui.vertical(|ui| markdown(ui, t, text, streaming));
    });
    ui.add_space(theme::GAP_8);
}

/// Text with the pane's own measure and wrapping.
fn prose(ui: &mut egui::Ui, colour: Color32, text: &str) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = ui.available_width() - theme::GAP_4;
    job.append(text, 0.0, egui::TextFormat { font_id: crate::theme::body(), color: colour, ..Default::default() });
    ui.label(job);
}

// ---------------------------------------------------------------------------------------------
// Markdown-lite. The model writes prose, and the pane reads the small subset that makes it
// legible: paragraphs, `-`/`*` bullets, `1.` lists, `#`/`##` headings, `**bold**`, `` `code` ``
// and fenced blocks as their own cards. Nothing else is interpreted — no tables, no images, no
// syntax highlighting — so a text that uses none of it reads exactly as written.
// ---------------------------------------------------------------------------------------------

/// One run of inline text, with the two emphases the subset knows.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Span {
    /// Plain words.
    Text(String),
    /// `**bold**`.
    Bold(String),
    /// `` `code` ``.
    Code(String),
}

/// One block of the model's answer.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Block {
    /// A paragraph, as its inline runs.
    Paragraph(Vec<Span>),
    /// A `#`/`##` heading: the level, and its inline runs.
    Heading { level: u8, spans: Vec<Span> },
    /// A `-`/`*` bullet list.
    Bullets(Vec<Vec<Span>>),
    /// A `1.` ordered list, renumbered from one.
    Ordered(Vec<Vec<Span>>),
    /// A fenced block: the language on the fence, and the code.
    Code { language: String, text: String },
}

/// Parse the markdown-lite subset into blocks. Total, never panics: anything it does not
/// recognise is a paragraph line, and an unterminated fence still yields its code.
fn parse_markdown_lite(text: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut paragraph: Vec<String> = Vec::new();
    let mut list: Vec<Vec<Span>> = Vec::new();
    let mut ordered = false;
    let mut fence: Option<(String, Vec<String>)> = None;
    let flush_paragraph = |blocks: &mut Vec<Block>, paragraph: &mut Vec<String>| {
        if !paragraph.is_empty() {
            blocks.push(Block::Paragraph(parse_inline(&paragraph.join(" "))));
            paragraph.clear();
        }
    };
    let flush_list = |blocks: &mut Vec<Block>, list: &mut Vec<Vec<Span>>, ordered: &mut bool| {
        if !list.is_empty() {
            blocks.push(if *ordered { Block::Ordered(std::mem::take(list)) } else { Block::Bullets(std::mem::take(list)) });
            *ordered = false;
        }
    };
    for line in text.lines() {
        if let Some((language, code)) = &mut fence {
            if line.trim_start().starts_with("```") {
                blocks.push(Block::Code { language: language.clone(), text: code.join("\n") });
                fence = None;
            } else {
                code.push(line.to_string());
            }
            continue;
        }
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list, &mut ordered);
            fence = Some((trimmed.trim_start_matches('`').trim().to_string(), Vec::new()));
            continue;
        }
        if trimmed.is_empty() {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list, &mut ordered);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('#') {
            let level = 1 + rest.chars().take_while(|c| *c == '#').count();
            let heading = rest.trim_start_matches('#').trim();
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list, &mut ordered);
            blocks.push(Block::Heading { level: level.min(6) as u8, spans: parse_inline(heading) });
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
            flush_paragraph(&mut blocks, &mut paragraph);
            if ordered {
                flush_list(&mut blocks, &mut list, &mut ordered);
            }
            list.push(parse_inline(rest.trim()));
            continue;
        }
        if let Some((_number, rest)) = ordered_item(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph);
            if !list.is_empty() && !ordered {
                flush_list(&mut blocks, &mut list, &mut ordered);
            }
            ordered = true;
            list.push(parse_inline(rest));
            continue;
        }
        flush_list(&mut blocks, &mut list, &mut ordered);
        paragraph.push(trimmed.to_string());
    }
    if let Some((language, code)) = fence {
        blocks.push(Block::Code { language, text: code.join("\n") });
    }
    flush_paragraph(&mut blocks, &mut paragraph);
    flush_list(&mut blocks, &mut list, &mut ordered);
    blocks
}

/// `1. text` (or `12. text`) as its number and the rest, when the line is an ordered item.
fn ordered_item(line: &str) -> Option<(u64, &str)> {
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || digits > 3 {
        return None;
    }
    let rest = line.get(digits..)?.strip_prefix(". ")?;
    Some((line.get(..digits)?.parse().ok()?, rest.trim()))
}

/// Split a line into plain, `**bold**` and `` `code` `` runs. Unclosed markers stay as written.
fn parse_inline(text: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let code = rest.find('`');
        let bold = rest.find("**");
        let at = match (code, bold) {
            (Some(c), Some(b)) => Some(c.min(b)),
            (Some(c), None) => Some(c),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let Some(at) = at else {
            spans.push(Span::Text(rest.to_string()));
            break;
        };
        if at > 0 {
            spans.push(Span::Text(rest[..at].to_string()));
        }
        let tail = &rest[at..];
        if let Some(inner) = tail.strip_prefix('`') {
            match inner.find('`') {
                Some(end) => {
                    spans.push(Span::Code(inner[..end].to_string()));
                    rest = &inner[end + 1..];
                }
                None => {
                    spans.push(Span::Text(tail.to_string()));
                    break;
                }
            }
        } else {
            let inner = tail.strip_prefix("**").unwrap_or(tail);
            match inner.find("**") {
                Some(end) => {
                    spans.push(Span::Bold(inner[..end].to_string()));
                    rest = &inner[end + 2..];
                }
                None => {
                    spans.push(Span::Text(tail.to_string()));
                    break;
                }
            }
        }
    }
    spans
}

/// Render the blocks. `streaming` draws the caret at the end of the last paragraph.
fn markdown(ui: &mut egui::Ui, t: &Tokens, text: &str, streaming: bool) {
    let blocks = parse_markdown_lite(text);
    let last = blocks.len().saturating_sub(1);
    let caret = streaming && caret_visible(ui.ctx());
    for (i, block) in blocks.into_iter().enumerate() {
        match block {
            Block::Heading { level, spans } => {
                ui.add_space(theme::GAP_6);
                let (font, colour) = match level {
                    1 => (FontId::new(theme::FONT_BUTTON, egui::FontFamily::Proportional), t.text),
                    2 => (theme::body(), t.text),
                    _ => (theme::body(), t.text_dim),
                };
                spans_label(ui, t, &spans, font, colour, false);
                ui.add_space(theme::GAP_2);
            }
            Block::Paragraph(spans) => spans_label(ui, t, &spans, theme::body(), t.text, caret && i == last),
            Block::Bullets(items) => {
                for item in &items {
                    marker_row(ui, t, item, "\u{2022}");
                }
            }
            Block::Ordered(items) => {
                for (n, item) in items.iter().enumerate() {
                    marker_row(ui, t, item, &format!("{}.", n + 1));
                }
            }
            Block::Code { language, text } => code_card(ui, t, &language, &text, i),
        }
    }
}

/// One inline run set as a wrapping label, with the caret appended when this is the live text.
fn spans_label(ui: &mut egui::Ui, t: &Tokens, spans: &[Span], font: FontId, colour: Color32, caret: bool) {
    let mut job = egui::text::LayoutJob::default();
    job.wrap.max_width = (ui.available_width() - theme::GAP_4).max(theme::CONTROL_H_INPUT);
    for span in spans {
        match span {
            Span::Text(s) => job.append(s, 0.0, egui::TextFormat { font_id: font.clone(), color: colour, ..Default::default() }),
            // No bold face ships with the interface; a variable font's weight axis is asked for,
            // and the run keeps the body colour where the axis is missing.
            Span::Bold(s) => job.append(
                s,
                0.0,
                egui::TextFormat { font_id: font.clone(), color: colour, coords: VariationCoords::new([(b"wght", 700.0)]), ..Default::default() },
            ),
            Span::Code(s) => {
                job.append(s, 0.0, egui::TextFormat { font_id: theme::mono(), color: t.text, background: t.field, ..Default::default() })
            }
        }
    }
    if caret {
        // The caret is a space painted in the text colour: a thin block at the end of the words
        // arriving now.
        job.append(" ", 0.0, egui::TextFormat { font_id: font, color: colour, background: colour, ..Default::default() });
    }
    ui.label(job);
}

/// Whether the streaming caret shows this half-second.
fn caret_visible(ctx: &egui::Context) -> bool {
    (ctx.input(|i| i.time) * 2.0).rem_euclid(2.0) < 1.0
}

/// One list item: the marker in the faint colour, the item's runs beside it.
fn marker_row(ui: &mut egui::Ui, t: &Tokens, spans: &[Span], marker: &str) {
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_6;
        ui.label(RichText::new(marker).color(t.text_faint));
        ui.vertical(|ui| spans_label(ui, t, spans, theme::body(), t.text, false));
    });
    ui.add_space(theme::GAP_2);
}

/// A fenced block as its own card: the language and a Copy button in a header row, then the code
/// in mono on the field colour, scrolling sideways rather than wrapping.
fn code_card(ui: &mut egui::Ui, t: &Tokens, language: &str, code: &str, at: usize) {
    ui.add_space(theme::GAP_4);
    egui::Frame::new()
        .fill(t.field)
        .stroke(egui::Stroke::new(theme::HAIRLINE, t.border))
        .corner_radius(theme::RADIUS_CARD)
        .inner_margin(egui::Margin::symmetric(theme::GAP_8 as i8, theme::GAP_6 as i8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = theme::GAP_6;
                let name = if language.is_empty() { tl!("code") } else { language };
                ui.label(RichText::new(name).color(t.text_faint).small());
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if crate::widgets::button(ui, "Copy", crate::widgets::Kind::Ghost).clicked() {
                        ui.ctx().copy_text(code.to_string());
                    }
                });
            });
            ui.add_space(theme::GAP_4);
            egui::ScrollArea::horizontal().id_salt(("assistant-code", at)).auto_shrink([false, true]).show(ui, |ui| {
                let mut job = egui::text::LayoutJob::default();
                job.wrap.max_width = f32::INFINITY;
                job.append(code, 0.0, egui::TextFormat { font_id: theme::mono(), color: t.text, ..Default::default() });
                ui.label(job);
            });
        });
    ui.add_space(theme::GAP_4);
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

/// The composer: attachment chips above one rounded field, the input and the action button inside
/// it, and a footer line with the model chip, how full the context is, the note and the shortcut.
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
    // What the reader queued while the turn runs, in order, each droppable.
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
    // The attachments ride above the field as chips: the picture, its name, and the way off.
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
        ui.add_space(theme::GAP_4);
    }
    // The one field: the input on the left, the action inside at the right. Its id is explicit so
    // the focus read and the widget agree across passes.
    let field_id = ui.make_persistent_id("assistant-composer-field");
    let field_focused = ui.memory(|m| m.has_focus(field_id));
    let side = theme::CONTROL_H_BUTTON;
    let frame = egui::Frame::new()
        .fill(t.field)
        .corner_radius(theme::RADIUS_PILL)
        .inner_margin(egui::Margin::symmetric(theme::GAP_8 as i8, theme::GAP_6 as i8))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(theme::GAP_6, theme::GAP_6);
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                let hint = if running { tl!("Ask for a change while it works — Enter queues it") } else { tl!("Ask for a change...") };
                let width = (ui.available_width() - side - theme::GAP_6).max(theme::CONTROL_H_INPUT);
                let edit = egui::TextEdit::multiline(&mut app.assistant.input)
                    .id(field_id)
                    .desired_rows(2)
                    .desired_width(width)
                    // The keys are the pane's: Enter sends, Shift+Enter is a newline, and the
                    // field inserts nothing on its own.
                    .return_key(None)
                    .frame(egui::Frame::NONE)
                    .hint_text(hint);
                let response = ui.add(edit);
                if response.has_focus() {
                    let (enter, modifiers) = ui.input(|i| (i.key_pressed(egui::Key::Enter), i.modifiers));
                    match composer_key(enter, modifiers) {
                        KeyAction::Send => actions.send = true,
                        KeyAction::Steer => {
                            actions.send = true;
                            actions.steer_now = true;
                        }
                        KeyAction::Newline => insert_newline(ui.ctx(), field_id, &mut app.assistant.input),
                        KeyAction::None => {}
                    }
                }
                action_button(app, ui, t, running, actions);
            });
        });
    // Painted over the content so the hairline reads on top; the field takes the accent while it
    // holds keyboard focus.
    let border = if field_focused { t.accent } else { t.border };
    ui.painter().rect_stroke(frame.response.rect, theme::RADIUS_PILL, egui::Stroke::new(theme::HAIRLINE, border), egui::StrokeKind::Inside);
    // The footer: what the model is, how full the context is, what just happened, and the keys.
    ui.add_space(theme::GAP_6);
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_6;
        // The paperclip: a picture joins the next message.
        if crate::widgets::icon_button(ui, crate::icons::Icon::Attach, 16.0, tl!("Attach a picture"), false).clicked()
            && let Some(pick) = app.services.pick_image.as_ref()
        {
            actions.attach = pick();
        }
        // The model chip: the preset in use; clicking it opens the preset menu.
        let label = preset_label(app);
        let chip = crate::widgets::chip(ui, &label, crate::widgets::ChipKind::Neutral);
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
        if running {
            // The mouse's way to steer: the keys do the same.
            let now = crate::widgets::button(ui, "Send now", crate::widgets::Kind::Ghost);
            if now.on_hover_text(tl!("The model reads it at its next tool call")).clicked() {
                actions.send = true;
                actions.steer_now = true;
            }
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = theme::GAP_6;
            // The pane is a dock tab and often narrow: the hint is the first thing to give way,
            // and it never clips at the edge (the full sentence needs ~260 pt).
            let room = ui.available_width();
            if room > 260.0 {
                ui.label(RichText::new(tl!("Enter to send, Shift+Enter for a new line")).color(t.text_faint).small());
            } else if room > 120.0 {
                ui.label(RichText::new(tl!("Enter sends")).color(t.text_faint).small());
            }
            if let Some(note) = app.assistant.note.clone() {
                ui.add(egui::Label::new(RichText::new(note.clone()).color(t.compare_other).small()).truncate()).on_hover_text(note);
            }
            context_meter(ui, t, &app.assistant.messages);
        });
    });
}

/// What the composer's chip says: the provider preset in use, or the model once the URL has been
/// typed by hand.
fn preset_label(app: &crate::CadApp) -> String {
    match client::preset(&app.assistant.preset) {
        Some(p) => p.label.to_string(),
        None if !app.assistant.provider.model.trim().is_empty() => app.assistant.provider.model.clone(),
        None => tl!("No model").to_string(),
    }
}

/// What the Enter key means in the composer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum KeyAction {
    /// No Enter was pressed.
    None,
    /// Send the message (queued while a turn runs).
    Send,
    /// Send now: the running model reads it at its next tool call.
    Steer,
    /// Shift+Enter: a newline at the caret.
    Newline,
}

/// Enter sends, Shift+Enter inserts a newline, Ctrl/Cmd+Enter steers the running turn. The field's
/// own return key is off (`.return_key(None)`), so each key means exactly this and nothing else.
fn composer_key(enter: bool, modifiers: egui::Modifiers) -> KeyAction {
    if !enter {
        return KeyAction::None;
    }
    if modifiers.shift {
        return KeyAction::Newline;
    }
    if modifiers.command || modifiers.ctrl { KeyAction::Steer } else { KeyAction::Send }
}

/// Insert a newline at the field's caret (at the end when the caret is unknown). The caret moves
/// past it, so typing continues on the new line.
fn insert_newline(ctx: &egui::Context, id: egui::Id, input: &mut String) {
    let at = egui::text_edit::TextEditState::load(ctx, id).and_then(|s| s.cursor.char_range()).map(|r| r.primary.index);
    let byte = at.and_then(|i| input.char_indices().nth(i.0).map(|(b, _)| b)).unwrap_or(input.len());
    input.insert(byte, '\n');
    if let Some(mut state) = egui::text_edit::TextEditState::load(ctx, id) {
        let next = input[..byte].chars().count() + 1;
        state.cursor.set_char_range(Some(egui::text::CCursorRange::one(egui::text::CCursor::new(next))));
        state.store(ctx, id);
    }
}

/// The composer's action: an accent circle with an arrow while the reader can send, a square
/// while a turn runs (pressing it stops the turn).
fn action_button(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, running: bool, actions: &mut Actions) {
    let side = theme::CONTROL_H_BUTTON;
    let (rect, response) = ui.allocate_exact_size(vec2(side, side), egui::Sense::click());
    let ready = running || !app.assistant.input.trim().is_empty() || !app.assistant.attachments.is_empty();
    let fill = if !ready {
        t.control
    } else if response.hovered() {
        t.accent.gamma_multiply(theme::HOVER_OPACITY)
    } else {
        t.accent
    };
    let ink = if ready { t.on_accent } else { t.text_faint };
    ui.painter().circle_filled(rect.center(), side / 2.0, fill);
    if running {
        let s = side * 0.32;
        ui.painter().rect_filled(egui::Rect::from_center_size(rect.center(), vec2(s, s)), theme::RADIUS_CONTROL, ink);
    } else {
        send_glyph(ui.painter(), rect, ink);
    }
    let label = if running { tl!("Stop") } else { tl!("Send") };
    response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, ready, label));
    crate::control::record_widget(ui, &response, label, "button", None);
    if response.clicked() && ready {
        if running {
            actions.stop = true;
        } else {
            actions.send = true;
        }
    }
}

/// The send arrow: a filled triangle pointing up, drawn here because the icon set has no arrow.
fn send_glyph(painter: &egui::Painter, rect: egui::Rect, colour: Color32) {
    let c = rect.center();
    let h = rect.width() * 0.22;
    painter.add(egui::Shape::convex_polygon(
        vec![pos2(c.x, c.y - h), pos2(c.x - h, c.y + h * 0.75), pos2(c.x + h, c.y + h * 0.75)],
        colour,
        egui::Stroke::NONE,
    ));
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

// ---------------------------------------------------------------------------------------------
// Source. The drawing as CadScript: fetched over the control channel, cached against the drawing
// revision, editable, and rebuildable. The call is answered on the interface thread like every
// other control request, so a reply is waited for on its own thread and polled here — the
// interface never blocks, and a call the channel does not know yet is a quiet row, not a panic.
// ---------------------------------------------------------------------------------------------

/// The drawing the Source tab caches against: which document, and how many changes it has seen.
fn source_key(app: &crate::CadApp) -> Option<(u64, u64)> {
    app.session.state().ok().map(|st| (st.uid, st.revision))
}

/// Take what the in-flight `cadscript` call answered, if anything.
fn drain_source(app: &mut crate::CadApp) {
    let Some(rx) = app.assistant.source.rx.take() else { return };
    match rx.try_recv() {
        Ok(reply) => {
            let waiting = app.assistant.source.waiting.take();
            handle_source_reply(app, waiting, &reply);
        }
        Err(TryRecvError::Empty) => app.assistant.source.rx = Some(rx),
        Err(TryRecvError::Disconnected) => {
            app.assistant.source.fetching = false;
            app.assistant.source.waiting = None;
            app.assistant.source.error = Some(tl!("The drawing's script could not be read.").to_string());
        }
    }
}

/// Ask for a fresh copy when the reader opened the tab, pressed `Rebuild`, or the drawing changed.
fn maybe_fetch_source(app: &mut crate::CadApp, ctx: &egui::Context) {
    let key = source_key(app);
    if key != app.assistant.source.key {
        app.assistant.source.needs = true;
    }
    if app.assistant.source.needs && !app.assistant.source.fetching {
        app.assistant.source.needs = false;
        app.assistant.source.issued = key;
        request_source(app, ctx, Waiting::Source, "cadscript.source", serde_json::json!({}));
    }
}

/// Send one `cadscript` call and wait for its reply on a thread of its own. The pane keeps
/// repainting while `fetching` is set, so the interface thread drains the request as usual.
fn request_source(app: &mut crate::CadApp, ctx: &egui::Context, kind: Waiting, method: &str, params: Value) {
    let pending = app.assistant.control_call(method, params);
    let (tx, rx) = channel();
    let ctx = ctx.clone();
    app.assistant.source.rx = Some(rx);
    app.assistant.source.fetching = true;
    app.assistant.source.waiting = Some(kind);
    app.assistant.source.error = None;
    if kind == Waiting::Rebuild {
        app.assistant.source.output.clear();
    }
    let spawned = std::thread::Builder::new().name("cadcraft-cadscript".into()).spawn(move || {
        let reply = pending.wait(SOURCE_TIMEOUT);
        let _ = tx.send(reply);
        ctx.request_repaint();
    });
    if let Err(e) = spawned {
        app.assistant.source.fetching = false;
        app.assistant.source.waiting = None;
        app.assistant.source.rx = None;
        app.assistant.source.error = Some(format!("{} {e}", tl!("The drawing's script could not be read:")));
    }
}

/// Take a `cadscript` answer: the script into the editor, or a rebuild's output and error.
fn handle_source_reply(app: &mut crate::CadApp, waiting: Option<Waiting>, reply: &Value) {
    match waiting {
        Some(Waiting::Source) => {
            app.assistant.source.fetching = false;
            // The key of the fetch, not of the moment the reply arrived: a change made while it
            // was in flight asks for another copy on the next frame.
            app.assistant.source.key = app.assistant.source.issued;
            match reply_payload(reply) {
                Ok(payload) => match payload.get("text").and_then(Value::as_str).or_else(|| payload.as_str()) {
                    Some(text) => {
                        app.assistant.source.text = text.to_string();
                        app.assistant.source.loaded = true;
                        app.assistant.source.error = None;
                    }
                    None => app.assistant.source.error = Some(tl!("The drawing's script came back without text.").to_string()),
                },
                Err(e) => app.assistant.source.error = Some(e),
            }
        }
        Some(Waiting::Rebuild) => {
            app.assistant.source.fetching = false;
            match reply_payload(reply) {
                Ok(payload) => {
                    app.assistant.source.output = payload
                        .get("output")
                        .and_then(Value::as_array)
                        .map(|lines| lines.iter().filter_map(|l| l.as_str().map(str::to_string)).collect())
                        .unwrap_or_default();
                    app.assistant.source.error = payload.get("error").and_then(Value::as_str).map(str::to_string);
                    if payload.get("ok").and_then(Value::as_bool) == Some(false) && app.assistant.source.error.is_none() {
                        app.assistant.source.error = Some(tl!("The rebuild was refused.").to_string());
                    }
                }
                Err(e) => app.assistant.source.error = Some(e),
            }
        }
        None => app.assistant.source.fetching = false,
    }
}

/// The payload of a control reply: `{"ok":true,"result":…}` unwrapped, a bare payload as it came,
/// and the error text when the call failed.
fn reply_payload(reply: &Value) -> Result<&Value, String> {
    match reply.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(reply.get("result").unwrap_or(reply)),
        Some(false) => Err(reply.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| reply.to_string())),
        None => Ok(reply),
    }
}

/// The CAD face: the drawing as CadScript — the toolbar, the quiet rows that report what the
/// channel said, and the script itself in a gutter-lined editor.
fn source_tab(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens, actions: &mut Actions) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_6;
        if crate::widgets::button(ui, "Copy", crate::widgets::Kind::Ghost).clicked() {
            actions.source_copy = true;
        }
        if crate::widgets::button(ui, "Rebuild", crate::widgets::Kind::Ghost).clicked() {
            actions.source_rebuild = true;
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let lines = app.assistant.source.text.lines().count();
            let chars = app.assistant.source.text.chars().count();
            ui.label(RichText::new(crate::tf!("{lines} lines · {chars} chars", lines = lines, chars = chars)).color(t.text_faint).small());
        });
    });
    if let Some(error) = app.assistant.source.error.clone() {
        ui.add(egui::Label::new(RichText::new(error.clone()).color(t.compare_other).small()).truncate()).on_hover_text(error);
    }
    // The rebuild's messages, capped: a 46-object drawing answers every line with a handle, and
    // an uncapped list would push the editor off the pane. The last few are the ones that matter.
    const OUTPUT_ROWS: usize = 6;
    let output = &app.assistant.source.output;
    let start = output.len().saturating_sub(OUTPUT_ROWS);
    if start > 0 {
        ui.add(egui::Label::new(RichText::new(crate::tf!("… {n} earlier message(s)", n = start)).color(t.text_faint).small()).truncate());
    }
    for line in output.iter().skip(start) {
        ui.add(egui::Label::new(RichText::new(line.clone()).color(t.text_faint).small()).truncate()).on_hover_text(line);
    }
    if !app.assistant.source.loaded && app.assistant.source.error.is_none() {
        ui.add_space(theme::GAP_6);
        ui.label(RichText::new(tl!("Loading...")).color(t.text_faint).small());
    }
    ui.add_space(theme::GAP_6);
    let height = (ui.available_height() - theme::GAP_8).max(theme::CONTROL_H_BUTTON * 3.0);
    egui::Frame::new()
        .fill(t.field)
        .stroke(egui::Stroke::new(theme::HAIRLINE, t.border))
        .corner_radius(theme::RADIUS_CARD)
        .inner_margin(egui::Margin::symmetric(theme::GAP_6 as i8, theme::GAP_4 as i8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.set_height(height);
            egui::ScrollArea::vertical().id_salt("assistant-source").auto_shrink([false, false]).show(ui, |ui| {
                source_editor(app, ui, t);
            });
        });
}

/// The script in a gutter-lined editor: line numbers in mono at the left, a frameless multiline
/// field beside them. The field is the reader's to fix; `Rebuild` runs what it holds.
fn source_editor(app: &mut crate::CadApp, ui: &mut egui::Ui, t: &Tokens) {
    let row_h = ui.fonts_mut(|f| f.row_height(&theme::mono())) + ui.spacing().extra_text_line_spacing;
    let gutter_w = ui.painter().layout_no_wrap("0000".to_owned(), theme::mono(), t.text_faint).size().x;
    let gap = theme::GAP_6;
    let edit_w = (ui.available_width() - gutter_w - gap).max(theme::CONTROL_H_INPUT);
    let heights = line_heights(ui, &app.assistant.source.text, edit_w, row_h);
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = gap;
        let total: f32 = heights.iter().sum::<f32>().max(row_h);
        let (rect, _) = ui.allocate_exact_size(vec2(gutter_w, total), egui::Sense::hover());
        let mut y = rect.top();
        for (i, h) in heights.iter().enumerate() {
            ui.painter().text(pos2(rect.right(), y + row_h / 2.0), Align2::RIGHT_CENTER, (i + 1).to_string(), theme::mono(), t.text_faint);
            y += h;
        }
        let edit = egui::TextEdit::multiline(&mut app.assistant.source.text)
            .desired_rows(1)
            .desired_width(edit_w)
            .font(theme::mono())
            .frame(egui::Frame::NONE);
        ui.add(edit);
    });
}

/// One height per line: how tall the line is once the editor wraps it at `wrap`, so a wrapped line
/// keeps its number on the first of its rows. At most [`SOURCE_GUTTER_LINES`] lines are measured —
/// the loop and its allocation are bounded whatever the text holds, and a script that long simply
/// stops showing numbers.
fn line_heights(ui: &egui::Ui, text: &str, wrap: f32, row_h: f32) -> Vec<f32> {
    let mut heights: Vec<f32> = Vec::new();
    for line in text.lines().take(SOURCE_GUTTER_LINES) {
        let mut job = egui::text::LayoutJob::default();
        job.wrap.max_width = wrap;
        job.append(line, 0.0, egui::TextFormat { font_id: theme::mono(), color: Color32::PLACEHOLDER, ..Default::default() });
        heights.push(ui.fonts_mut(|f| f.layout_job(job)).size().y.max(row_h));
    }
    if heights.is_empty() {
        heights.push(row_h);
    }
    heights
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
    if let Some(mode) = actions.mode {
        app.assistant.open_tab(mode);
    }
    if actions.source_copy {
        ctx.copy_text(app.assistant.source.text.clone());
    }
    if actions.source_rebuild && !app.assistant.source.fetching {
        app.assistant.source.issued = source_key(app);
        let text = app.assistant.source.text.clone();
        request_source(app, ctx, Waiting::Rebuild, "cadscript.run", serde_json::json!({ "text": text, "replace": true }));
    }
    if actions.scroll_to_bottom {
        app.assistant.follow = true;
        ctx.request_repaint();
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

    #[test]
    fn the_tab_strip_switches_the_mode_and_asks_for_the_source() {
        let mut a = Assistant::default();
        assert_eq!(a.mode, Mode::Chat, "the conversation is the face the pane opens with");
        a.open_tab(Mode::Source);
        assert_eq!(a.mode, Mode::Source);
        assert!(a.source.needs, "opening the tab asks for a fresh copy of the drawing's script");
        a.source.needs = false;
        a.open_tab(Mode::Chat);
        assert_eq!(a.mode, Mode::Chat);
        assert!(!a.source.needs, "the conversation does not fetch the script");
        a.open_tab(Mode::Source);
        assert!(a.source.needs, "coming back to the tab asks again");
    }

    #[test]
    fn markdown_lite_reads_the_subset_it_promises() {
        let text = "# Wing\n\nA **bold** word and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n```lisp\n(cmd \"circle\")\n```";
        let blocks = parse_markdown_lite(text);
        assert_eq!(blocks.len(), 5, "{blocks:?}");
        match &blocks[0] {
            Block::Heading { level, spans } => {
                assert_eq!(*level, 1);
                assert_eq!(spans, &vec![Span::Text("Wing".into())]);
            }
            other => panic!("a heading leads: {other:?}"),
        }
        match &blocks[1] {
            Block::Paragraph(spans) => {
                assert!(spans.contains(&Span::Bold("bold".into())), "{spans:?}");
                assert!(spans.contains(&Span::Code("code".into())), "{spans:?}");
            }
            other => panic!("a paragraph follows: {other:?}"),
        }
        match &blocks[2] {
            Block::Bullets(items) => assert_eq!(items.len(), 2, "{items:?}"),
            other => panic!("a bullet list: {other:?}"),
        }
        match &blocks[3] {
            Block::Ordered(items) => assert_eq!(items.len(), 2, "{items:?}"),
            other => panic!("an ordered list: {other:?}"),
        }
        match &blocks[4] {
            Block::Code { language, text } => {
                assert_eq!(language, "lisp");
                assert_eq!(text, "(cmd \"circle\")");
            }
            other => panic!("a fenced block: {other:?}"),
        }
    }

    #[test]
    fn a_fence_without_its_close_still_yields_its_code() {
        let blocks = parse_markdown_lite("```\n(cmd \"line\")\n");
        assert_eq!(blocks, vec![Block::Code { language: String::new(), text: "(cmd \"line\")".into() }]);
    }

    #[test]
    fn an_unclosed_marker_stays_as_written() {
        let spans = parse_inline("a **b and `c");
        assert_eq!(spans, vec![Span::Text("a ".into()), Span::Text("**b and `c".into())]);
    }

    #[test]
    fn the_composer_keys_send_steer_or_leave_the_newline_alone() {
        let plain = egui::Modifiers::default();
        assert_eq!(composer_key(true, plain), KeyAction::Send);
        assert_eq!(composer_key(false, plain), KeyAction::None, "nothing was pressed");
        let shift = egui::Modifiers { shift: true, ..Default::default() };
        assert_eq!(composer_key(true, shift), KeyAction::Newline, "Shift+Enter is a newline");
        let ctrl = egui::Modifiers { ctrl: true, ..Default::default() };
        assert_eq!(composer_key(true, ctrl), KeyAction::Steer, "Ctrl+Enter steers the running turn");
        let cmd = egui::Modifiers { command: true, ..Default::default() };
        assert_eq!(composer_key(true, cmd), KeyAction::Steer);
        // Shift wins over the steering modifiers: a newline is never a send.
        let both = egui::Modifiers { shift: true, ctrl: true, ..Default::default() };
        assert_eq!(composer_key(true, both), KeyAction::Newline);
    }

    #[test]
    fn a_newline_goes_in_at_the_caret() {
        let ctx = egui::Context::default();
        let id = egui::Id::unique("assistant-test-field");
        let mut input = "one\ntwo".to_string();
        // No stored caret: the end of the text is the caret.
        insert_newline(&ctx, id, &mut input);
        assert_eq!(input, "one\ntwo\n");
        let mut state = egui::text_edit::TextEditState::default();
        state.cursor.set_char_range(Some(egui::text::CCursorRange::one(egui::text::CCursor::new(3))));
        state.store(&ctx, id);
        insert_newline(&ctx, id, &mut input);
        assert_eq!(input, "one\n\ntwo\n", "the newline lands where the caret was");
    }

    #[test]
    fn a_control_reply_reads_in_either_shape() {
        // The channel's envelope, as `control::handle` answers it.
        let wrapped = json!({"ok": true, "result": {"text": "(cmd \"line\")"}});
        let payload = reply_payload(&wrapped).expect("a successful call has a payload");
        assert_eq!(payload.get("text").and_then(Value::as_str), Some("(cmd \"line\")"));
        // A failure carries the reason — the other worker's methods may not exist yet.
        let failed = json!({"ok": false, "error": "unknown method `cadscript.source`"});
        assert_eq!(reply_payload(&failed), Err("unknown method `cadscript.source`".to_string()));
        // A bare payload is taken as it came.
        assert!(reply_payload(&json!({"text": "x"})).is_ok());
    }
}
