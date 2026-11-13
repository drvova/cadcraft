//! The terminal dashboard: the piece, its checks, the bench sheet's lines, a log, and a command
//! line that runs CADCraft commands. Laid out by `slab/dashboard.slab`.
//!
//! This module is the dashboard without a terminal: it fills the document from the engine, turns
//! it into a grid of cells, and takes input as kernel events. A line submitted at its command
//! line is typed at the engine's command line (`Session::cmdline`, the path a script's lines
//! take) and the panels are filled again. The terminal itself — raw mode, keys, painting — is the
//! command-line tool's (`cadcraft-cli tui`), so nothing here depends on a terminal library and a
//! test can drive every part of it.

use cadcraft_engine::Session;
use slab_kernel::frame as kframe;

use crate::data::{MAX_SENTENCE, PieceData};
use crate::document::Document;
use crate::error::{Result, SurfaceError, guard};
use crate::generated::dashboard as doc;
use crate::render::{self, Theme};

/// A grid of terminal cells, as the kernel lays the dashboard out (characters, colours, the
/// caret). A terminal driver paints it.
pub use slab_kernel::cells::CellGrid;
/// An input event for the dashboard (a key, text, a pointer move), in the kernel's own form. A
/// terminal driver translates what the terminal reports into these.
pub use slab_kernel::dispatch::Event;

/// The lines the log keeps. The panel shows the last few; the rest scroll away.
const LOG_KEEP: usize = 200;
/// The lines the log panel has room for.
const LOG_SHOWN: usize = 3;
/// The lines the bench-sheet panel has room for.
const BENCH_SHOWN: usize = 4;
/// The longest command line that is run, in bytes. More is refused, not cut: half a command is
/// a different command.
const MAX_LINE: usize = 4096;

/// Kernel event codes (Slab's FRAME contract): a key going down, and text arriving.
const E_KEY_DOWN: u32 = 4;
const E_TEXT: u32 = 5;

/// The dashboard for one session.
pub struct Dashboard {
    doc: doc::Doc,
    theme: Theme,
    log: Vec<String>,
    focused: bool,
}

fn refused(param: &'static str) -> SurfaceError {
    SurfaceError::Refused { document: "dashboard.slab", param }
}

fn event(etype: u32) -> Event {
    Event { etype, x: 0.0, y: 0.0, dx: 0.0, dy: 0.0, button: 0, clicks: 0, key: String::new(), text: String::new(), clauses: Vec::new(), mods: 0 }
}

impl Dashboard {
    /// A dashboard with nothing in it yet; [`Dashboard::refresh`] fills it.
    pub fn new(theme: Theme) -> Result<Dashboard> {
        Document::Dashboard.slir()?;
        let doc = guard("the dashboard", || Ok(doc::Doc::new()))?;
        Ok(Dashboard { doc, theme, log: Vec::new(), focused: false })
    }

    /// Fill the panels from the open drawing. The drawing is not changed.
    pub fn refresh(&mut self, session: &mut Session) -> Result<()> {
        let data = PieceData::gather(session);
        self.fill(&data)
    }

    /// Fill the panels from data already gathered.
    pub fn fill(&mut self, data: &PieceData) -> Result<()> {
        let log = self.log_items();
        let d = &mut self.doc;
        guard("the dashboard", || {
            let set = |ok: bool, param: &'static str| -> Result<()> { if ok { Ok(()) } else { Err(refused(param)) } };
            set(d.set_drawing(&data.drawing), "drawing")?;
            set(d.set_title(&data.title), "title")?;
            set(d.set_verdict(data.verdict()), "verdict")?;
            set(d.set_all_ok(data.all_ok()), "all_ok")?;
            let mut facts: Vec<doc::FactsItem> = Vec::new();
            let mut fact = |name: &str, value: String| {
                if !value.trim().is_empty() {
                    facts.push(doc::FactsItem { key: None, name: name.into(), value });
                }
            };
            fact("Size", [data.size_a.as_str(), data.size_b.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(" · "));
            fact("Metal", format!("{} {}", data.metal, data.metal_note).trim().to_string());
            fact(
                "Stones",
                [data.stone_count.as_str(), data.carat.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(" · "),
            );
            if let Some(cost) = &data.cost {
                fact("Cost", format!("{} {} (estimate)", cost.currency, cost.total));
            }
            for warning in &data.warnings {
                fact("Warning", warning.clone());
            }
            set(d.set_facts(&facts), "facts")?;
            let checks: Vec<doc::ChecksItem> = data
                .checks
                .iter()
                .map(|c| doc::ChecksItem { key: None, name: c.name.clone(), verdict: c.verdict().into(), message: c.message.clone(), ok: c.ok })
                .collect();
            set(d.set_checks(&checks), "checks")?;
            let bench: Vec<doc::BenchItem> = data.bench.iter().take(BENCH_SHOWN).map(|l| doc::BenchItem { key: None, line: l.clone() }).collect();
            set(d.set_bench(&bench), "bench")?;
            set(d.set_log(&log), "log")?;
            Ok(())
        })
    }

    fn log_items(&self) -> Vec<doc::LogItem> {
        let from = self.log.len().saturating_sub(LOG_SHOWN);
        self.log.iter().skip(from).map(|l| doc::LogItem { key: None, line: l.clone() }).collect()
    }

    fn note(&mut self, line: &str) {
        let line: String = line.chars().filter(|c| !c.is_control()).take(MAX_SENTENCE).collect();
        self.log.push(line);
        let extra = self.log.len().saturating_sub(LOG_KEEP);
        self.log.drain(..extra);
    }

    /// What the log holds, oldest first.
    pub fn log(&self) -> &[String] {
        &self.log
    }

    /// Run one line at the engine's command line, exactly as typed there, and fill the panels
    /// again. What the engine printed goes to the log; a line it refuses is logged, not returned
    /// as an error — the dashboard goes on.
    pub fn run_line(&mut self, session: &mut Session, line: &str) -> Result<()> {
        let line = line.trim();
        if line.is_empty() {
            return Ok(());
        }
        if line.len() > MAX_LINE || line.chars().any(char::is_control) {
            self.note("That line is too long, or holds control characters: not run.");
            return self.refresh(session);
        }
        self.note(&format!("> {line}"));
        let before = session.log.len();
        let result = session.cmdline(line);
        let printed: Vec<String> = session.log.iter().skip(before).cloned().collect();
        for l in &printed {
            self.note(l);
        }
        if let Err(e) = result {
            self.note(&e.to_string());
        }
        self.refresh(session)
    }

    /// The dashboard as a grid of cells for a terminal `cols` by `rows` (clamped to a size it can
    /// be read at). The command line takes the keyboard focus the first time.
    pub fn grid(&mut self, cols: u16, rows: u16) -> Result<CellGrid> {
        let (cols, rows) = (cols.clamp(render::MIN_COLS, render::MAX_COLS), rows.clamp(render::MIN_ROWS, render::MAX_ROWS));
        let theme = self.theme;
        let focused = &mut self.focused;
        let d = &mut self.doc;
        guard("the dashboard", || {
            if !kframe::inst_set_theme(&mut d.inst, theme.name()) {
                return Err(SurfaceError::Theme(theme.name().into()));
            }
            kframe::inst_set_env(
                &mut d.inst,
                f64::from(cols) * render::CELL_W,
                f64::from(rows) * render::CELL_H,
                render::CLIENT_TUI,
                theme == Theme::Dark,
                false,
            );
            let mut frame = d.frame(0.0);
            if !*focused {
                // Focus can only go to a node the last solve painted.
                *focused = d.set_focus(doc::keys::CMD, true);
            }
            for _ in 0..3 {
                if !d.inst.dirty {
                    break;
                }
                frame = d.frame(0.0);
            }
            Ok(slab_kernel::cells::cells_with_caret(&d.inst, &frame))
        })
    }

    /// The dashboard as text: one line a row, right-trimmed. `plain` has no colour; otherwise the
    /// text carries truecolour ANSI escapes.
    pub fn text(&mut self, cols: u16, rows: u16, plain: bool) -> Result<String> {
        let grid = self.grid(cols, rows)?;
        guard("the dashboard", || Ok(slab_kernel::cells::cells_to_text(&grid, plain)))
    }

    /// Whether the picture is out of date (something changed since the last grid).
    pub fn stale(&self) -> bool {
        self.doc.inst.dirty || !self.doc.inst.solved
    }

    /// Hand the dashboard an input event. A line submitted at its command line is run (see
    /// [`Dashboard::run_line`]) and the command line cleared.
    pub fn dispatch(&mut self, session: &mut Session, input: &Event) -> Result<()> {
        let d = &mut self.doc;
        let submitted: Vec<String> = guard("the dashboard", || {
            let (_, signals) = d.dispatch(input);
            Ok(signals
                .into_iter()
                .filter_map(|s| match s {
                    doc::Signal::Run { text, .. } => Some(text),
                    doc::Signal::Draft { .. } => None,
                })
                .collect())
        })?;
        for line in submitted {
            let d = &mut self.doc;
            guard("the dashboard", || {
                // Clearing the field reports the change as a signal of its own; nothing to do.
                let _ = d.set_field_text(doc::keys::CMD, "");
                let _ = d.take_signals();
                Ok(())
            })?;
            self.run_line(session, &line)?;
        }
        Ok(())
    }

    /// Type a line at the dashboard's command line and press Enter: the same events a terminal
    /// sends, for a script or a test.
    pub fn type_line(&mut self, session: &mut Session, line: &str) -> Result<()> {
        // The command line must be on screen and focused before it can take text.
        self.grid(100, 30)?;
        let mut text = event(E_TEXT);
        text.text = line.chars().filter(|c| !c.is_control()).collect();
        self.dispatch(session, &text)?;
        let mut enter = event(E_KEY_DOWN);
        enter.key = "Enter".into();
        self.dispatch(session, &enter)
    }
}

/// The open drawing's dashboard as text, once: what `cadcraft-cli tui` prints when its output is
/// not a terminal.
pub fn dashboard_text(session: &mut Session, cols: u16, rows: u16, theme: Theme, plain: bool) -> Result<String> {
    let mut dashboard = Dashboard::new(theme)?;
    dashboard.refresh(session)?;
    dashboard.text(cols, rows, plain)
}
