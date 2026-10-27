//! Design tokens. The dark palette follows Cursor's system, measured from the values in its own
//! theme file ("Cursor Dark Anysphere"): a few opaque near-black surfaces — chrome #141414,
//! content #181818, and the chrome is **darker** than the content — with everything else (text,
//! borders, hovers, selection) being one base colour, #E4E4E4, painted at a low alpha over them.
//! There is no ladder of opaque greys to keep in step, and colour is a signal, never decoration:
//! the muted Anysphere blue for action and selection, cyan for counts, green for on/ready, amber
//! for warnings, pink-red for errors. Every widget reads its colours from here.
//!
//! Two palettes: [`Tokens::DARK`] (the original look) and [`Tokens::LIGHT`]. The interface theme
//! changes the chrome (title and tool bar, menus, palettes, tabs, command line, status bar,
//! dialogs); the drawing area keeps its model-space colours in both, as drawing colours are not
//! part of the interface theme. [`Tokens::get`] returns the palette of the theme in use, which
//! [`CadApp::logic`](crate::CadApp::logic) resolves once per frame from the user's [`ThemePref`].

use std::cell::Cell;

use egui::{Color32, FontFamily, FontId, Theme, Visuals};
use serde::{Deserialize, Serialize};

/// The interface theme the user chose.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePref {
    /// Follow the operating system's light/dark appearance, live.
    System,
    Light,
    /// The default: CADCraft's original look.
    #[default]
    Dark,
}

/// The theme `System` uses when the OS (or browser) reports no appearance.
pub const SYSTEM_FALLBACK: Theme = Theme::Dark;

impl ThemePref {
    pub const ALL: [ThemePref; 3] = [ThemePref::System, ThemePref::Light, ThemePref::Dark];

    pub fn as_str(self) -> &'static str {
        match self {
            ThemePref::System => "system",
            ThemePref::Light => "light",
            ThemePref::Dark => "dark",
        }
    }

    pub fn parse(s: &str) -> Option<ThemePref> {
        ThemePref::ALL.into_iter().find(|t| t.as_str().eq_ignore_ascii_case(s.trim()))
    }

    /// The theme to show, given what the OS reports (`ctx.system_theme()`).
    pub fn resolve(self, system: Option<Theme>) -> Theme {
        match self {
            ThemePref::System => system.unwrap_or(SYSTEM_FALLBACK),
            ThemePref::Light => Theme::Light,
            ThemePref::Dark => Theme::Dark,
        }
    }
}

thread_local! {
    /// The theme in use on the UI thread (set by [`set_active`] each frame).
    static ACTIVE: Cell<Theme> = const { Cell::new(Theme::Dark) };
}

/// The theme [`Tokens::get`] returns colours for.
pub fn active() -> Theme {
    ACTIVE.with(Cell::get)
}

pub fn set_active(theme: Theme) {
    ACTIVE.with(|a| a.set(theme));
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    pub chrome: Color32,
    pub chrome_dark: Color32,
    pub panel: Color32,
    pub tab_active: Color32,
    pub control: Color32,
    pub control_hover: Color32,
    pub border: Color32,
    pub canvas: Color32,
    pub grid_minor: Color32,
    pub grid_major: Color32,
    pub axis_x: Color32,
    pub axis_y: Color32,
    pub text: Color32,
    pub text_dim: Color32,
    pub text_faint: Color32,
    pub icon: Color32,
    pub icon_accent: Color32,
    pub icon_point: Color32,
    pub accent: Color32,
    pub selection: Color32,
    pub hover: Color32,
    pub grip: Color32,
    pub grip_hot: Color32,
    /// Grips of dynamic block references (AutoCAD's GRIPDYNCOLOR).
    pub grip_dyn: Color32,
    pub snap: Color32,
    /// COMPARE: objects only in this drawing, only in the other one, and the areas of change.
    pub compare_this: Color32,
    pub compare_other: Color32,
    pub compare_area: Color32,
    pub window_stroke: Color32,
    pub crossing_stroke: Color32,
    pub cmd_bg: Color32,
    pub toggle_on: Color32,
    /// Text fields and other inset (extreme) backgrounds.
    pub field: Color32,
    /// Selected text and selected list rows.
    pub select_bg: Color32,
    /// Lines and labels drawn straight onto the drawing area (UCS icon, viewport label, rubber
    /// bands): they follow the model-space background, not the interface theme.
    pub canvas_ink: Color32,
    /// The command-line history lines behind the input bar.
    pub cmd_history: Color32,
    pub cmd_border: Color32,
    /// Command-line keywords (`[Undo/Close]`) and their hover background.
    pub cmd_keyword: Color32,
    pub cmd_keyword_hover: Color32,
    /// The command-line AutoComplete list: background and the highlighted first row.
    pub list_bg: Color32,
    pub list_row: Color32,
    /// Transient warnings (status bar messages).
    pub warn: Color32,
    /// Errors and destructive actions (Cursor's `errorForeground`); the palette's pink-red.
    pub error: Color32,
    /// Text and icons that read on an [`Tokens::accent`] or [`Tokens::error`] fill (Cursor's
    /// `button.foreground`).
    pub on_accent: Color32,
    /// The drawing-area crosshair cursor and its pick box.
    pub crosshair: Color32,
    /// The sheet of paper on a layout tab.
    pub paper: Color32,
}

impl Tokens {
    pub const DARK: Tokens = Tokens {
        // Surfaces. Chrome is darker than the content, as in Cursor: the drawing area is the
        // brightest near-black in the window, and everything around it recedes.
        chrome: Color32::from_rgb(0x14, 0x14, 0x14),
        chrome_dark: Color32::from_rgb(0x0f, 0x0f, 0x0f),
        panel: Color32::from_rgb(0x14, 0x14, 0x14),
        tab_active: Color32::from_rgb(0x2d, 0x2d, 0x2d),
        control: Color32::from_rgb(0x1c, 0x1c, 0x1c),
        control_hover: Color32::from_rgb(0x23, 0x23, 0x23),
        border: Color32::from_rgb(0x23, 0x23, 0x23),
        // The drawing area: the content surface (#181818), with the grid a 4% and 9% step of the
        // base colour above it.
        canvas: Color32::from_rgb(0x18, 0x18, 0x18),
        grid_minor: Color32::from_rgb(0x20, 0x20, 0x20),
        grid_major: Color32::from_rgb(0x2a, 0x2a, 0x2a),
        axis_x: Color32::from_rgb(0x55, 0x26, 0x33),
        axis_y: Color32::from_rgb(0x23, 0x41, 0x2f),
        // Text: the base colour at 92%, 55% and 40% over the content surface.
        text: Color32::from_rgb(0xd4, 0xd4, 0xd4),
        text_dim: Color32::from_rgb(0x88, 0x88, 0x88),
        text_faint: Color32::from_rgb(0x6b, 0x6b, 0x6b),
        icon: Color32::from_rgb(0xb0, 0xb0, 0xb0),
        icon_accent: Color32::from_rgb(0x81, 0xa1, 0xc1),
        icon_point: Color32::from_rgb(0xf1, 0xb4, 0x67),
        accent: Color32::from_rgb(0x81, 0xa1, 0xc1),
        selection: Color32::from_rgb(0x81, 0xa1, 0xc1),
        hover: Color32::from_rgb(0xb8, 0xce, 0xe6),
        grip: Color32::from_rgb(0x81, 0xa1, 0xc1),
        grip_hot: Color32::from_rgb(0xe3, 0x46, 0x71),
        grip_dyn: Color32::from_rgb(0x88, 0xc0, 0xd0),
        snap: Color32::from_rgb(0x3f, 0xa2, 0x66),
        compare_this: Color32::from_rgb(0x3f, 0xa2, 0x66),
        compare_other: Color32::from_rgb(0xe3, 0x46, 0x71),
        compare_area: Color32::from_rgb(0xf1, 0xb4, 0x67),
        window_stroke: Color32::from_rgb(0x81, 0xa1, 0xc1),
        crossing_stroke: Color32::from_rgb(0x3f, 0xa2, 0x66),
        // The command line is a composer surface: the wash, almost opaque over the drawing.
        cmd_bg: Color32::from_rgba_premultiplied(0x1c, 0x1c, 0x1c, 0xf0),
        toggle_on: Color32::from_rgb(0x3f, 0xa2, 0x66),
        field: Color32::from_rgb(0x1c, 0x1c, 0x1c),
        select_bg: Color32::from_rgb(0x2d, 0x2d, 0x2d),
        canvas_ink: Color32::from_rgb(0x88, 0x88, 0x88),
        cmd_history: Color32::from_rgba_unmultiplied_const(0x1a, 0x1a, 0x1a, 170),
        cmd_border: Color32::from_rgb(0x33, 0x33, 0x33),
        cmd_keyword: Color32::from_rgb(0x81, 0xa1, 0xc1),
        cmd_keyword_hover: Color32::from_rgb(0x2a, 0x30, 0x37),
        list_bg: Color32::from_rgb(0x1c, 0x1c, 0x1c),
        list_row: Color32::from_rgb(0x2d, 0x2d, 0x2d),
        warn: Color32::from_rgb(0xf1, 0xb4, 0x67),
        error: Color32::from_rgb(0xe3, 0x46, 0x71),
        on_accent: Color32::from_rgb(0x14, 0x14, 0x14),
        crosshair: Color32::from_rgb(0xe4, 0xe4, 0xe4),
        paper: Color32::from_rgb(0xfc, 0xfc, 0xfc),
    };

    /// Light grey chrome with dark text. The drawing-area colours (canvas, grid, axes, selection,
    /// grips, snap markers, selection windows) are the same as [`Tokens::DARK`]'s.
    pub const LIGHT: Tokens = Tokens {
        // The same system in light: neutral surfaces, one base colour layered at low alpha, and
        // the drawing-area colours inherited from the dark palette (the model space keeps its own
        // background whatever the interface does).
        chrome: Color32::from_rgb(0xf1, 0xf1, 0xf1),
        chrome_dark: Color32::from_rgb(0xe8, 0xe8, 0xe8),
        panel: Color32::from_rgb(0xf6, 0xf6, 0xf6),
        tab_active: Color32::from_rgb(0xff, 0xff, 0xff),
        control: Color32::from_rgb(0xe8, 0xe8, 0xe8),
        control_hover: Color32::from_rgb(0xde, 0xde, 0xde),
        border: Color32::from_rgb(0xd6, 0xd6, 0xd6),
        text: Color32::from_rgb(0x1f, 0x1f, 0x1f),
        text_dim: Color32::from_rgb(0x5c, 0x5c, 0x5c),
        text_faint: Color32::from_rgb(0x7a, 0x7a, 0x7a),
        icon: Color32::from_rgb(0x3a, 0x3a, 0x3a),
        icon_accent: Color32::from_rgb(0x4a, 0x6e, 0x96),
        icon_point: Color32::from_rgb(0xb8, 0x79, 0x1f),
        accent: Color32::from_rgb(0x4a, 0x6e, 0x96),
        cmd_bg: Color32::from_rgba_premultiplied(0xeb, 0xeb, 0xeb, 0xf0),
        toggle_on: Color32::from_rgb(0x3f, 0xa2, 0x66),
        field: Color32::from_rgb(0xff, 0xff, 0xff),
        select_bg: Color32::from_rgb(0xc9, 0xd4, 0xdf),
        cmd_history: Color32::from_rgba_unmultiplied_const(0xf2, 0xf2, 0xf2, 0xdc),
        cmd_border: Color32::from_rgb(0xc9, 0xc9, 0xc9),
        cmd_keyword: Color32::from_rgb(0x3a, 0x5f, 0x86),
        cmd_keyword_hover: Color32::from_rgb(0xdd, 0xe6, 0xef),
        list_bg: Color32::from_rgb(0xff, 0xff, 0xff),
        list_row: Color32::from_rgb(0xe8, 0xe8, 0xe8),
        warn: Color32::from_rgb(0x8a, 0x53, 0x00),
        on_accent: Color32::from_rgb(0xf1, 0xf1, 0xf1),
        ..Tokens::DARK
    };

    /// The palette of `theme`.
    pub fn of(theme: Theme) -> Tokens {
        match theme {
            Theme::Dark => Tokens::DARK,
            Theme::Light => Tokens::LIGHT,
        }
    }

    /// The palette of the theme in use, with the user's drawing-area colours ([`set_canvas`]).
    pub fn get() -> Tokens {
        CANVAS.with(Cell::get).over(Tokens::of(active()))
    }

    /// These tokens with `bg` as the model-space background: the grid, axes, crosshair and the
    /// lines drawn on the drawing area are recomputed to stay visible on it.
    pub fn with_model_background(self, bg: Color32) -> Tokens {
        let light = luminance(bg) > 0.5;
        let ink = if light { Color32::BLACK } else { Color32::WHITE };
        Tokens {
            canvas: bg,
            grid_minor: mix(bg, ink, 0.04),
            grid_major: mix(bg, ink, 0.09),
            axis_x: mix(bg, Color32::from_rgb(0xd0, 0x30, 0x30), 0.3),
            axis_y: mix(bg, Color32::from_rgb(0x30, 0xb0, 0x40), 0.3),
            canvas_ink: if light { Color32::from_rgb(0x47, 0x50, 0x5c) } else { Tokens::DARK.canvas_ink },
            crosshair: crosshair_color(bg),
            ..self
        }
    }
}

// ---------------------------------------------------------------------------
// Recipe constants: the measured values behind the canonical widgets
// ([`crate::widgets`]). Every number quotes the Cursor rule it was measured from in
// `.design-system/cursor/recipes.md`; the widget functions read these, never literals.
// ---------------------------------------------------------------------------

/// Control and input radius: `.cursor-button { border-radius:2px }` and
/// `.monaco-inputbox { border-radius:2px }` (§3, §4). 2px is the second rung of the measured
/// radius histogram (×65).
pub const RADIUS_CONTROL: f32 = 2.0;

/// Small-control radius: `.composer-button-secondary { border-radius:3px }` (§1.9) and
/// `.picker-menu-search-input { border-radius:3px }` (§4).
pub const RADIUS_SMALL: f32 = 3.0;

/// Card, input-box and menu-item radius: `.composer-history-pane { border-radius:4px }`,
/// `.monaco-menu .action-menu-item { border-radius:4px }` and `.composer-bar-button
/// { border-radius:4px }` (§1.5, §1.17, §6). The modal radius of the histogram (×76).
pub const RADIUS_CARD: f32 = 4.0;

/// Composer chrome and menu radius: the bar's `border-top-left/right-radius:5px` (§1.1) and
/// `.monaco-menu { border-radius:5px }` (§6).
pub const RADIUS_COMPOSER: f32 = 5.0;

/// Pill radius: `.monaco-count-badge { border-radius:11px }` (§7).
pub const RADIUS_PILL: f32 = 11.0;

/// Wide pill radius: the activity-bar badge's `border-radius:20px` (§2).
pub const RADIUS_PILL_WIDE: f32 = 20.0;

/// The measured spacing ladder (recipes.md §10): the padding and gap histograms share the rungs
/// 2, 3, 4, 5, 6, 8, 10 and 12 (16 is the next rung up). `GAP_4` is the default gap.
pub const GAP_2: f32 = 2.0;
pub const GAP_3: f32 = 3.0;
pub const GAP_4: f32 = 4.0;
pub const GAP_5: f32 = 5.0;
pub const GAP_6: f32 = 6.0;
pub const GAP_8: f32 = 8.0;
pub const GAP_10: f32 = 10.0;
pub const GAP_12: f32 = 12.0;
pub const GAP_16: f32 = 16.0;

/// The default gap: `gap:4px` is the histogram's modal value (×53).
pub const GAP_DEFAULT: f32 = GAP_4;

/// `.cursor-button`'s height: 18px line-height + 4px + 4px padding + 1px + 1px hairline border =
/// 28px (§3).
pub const CONTROL_H_BUTTON: f32 = 28.0;

/// The input height: the view-pane filter input measures `height:24px` with the
/// `.monaco-inputbox` inner `padding:4px 6px` (§4).
pub const CONTROL_H_INPUT: f32 = 24.0;

/// List row height: `.explorer-item { height:22px; line-height:22px }` (§2).
pub const CONTROL_H_ROW: f32 = 22.0;

/// Tab height: 35px normal (§5).
pub const CONTROL_H_TAB: f32 = 35.0;

/// Tab height, compact: 22px (§5).
pub const CONTROL_H_TAB_COMPACT: f32 = 22.0;

/// `.cursor-button { padding:4px 8px }` (§3).
pub const BUTTON_PAD_X: f32 = 8.0;
pub const BUTTON_PAD_Y: f32 = 4.0;

/// `.monaco-inputbox>.ibwrapper>.input { padding:4px 6px }` (§4).
pub const FIELD_PAD_X: f32 = 6.0;
pub const FIELD_PAD_Y: f32 = 4.0;

/// `.monaco-count-badge { padding:3px 6px; min-height:18px; min-width:18px }` (§7).
pub const CHIP_PAD_X: f32 = 6.0;
pub const CHIP_PAD_Y: f32 = 3.0;
pub const CHIP_MIN_H: f32 = 18.0;
pub const CHIP_MIN_W: f32 = 18.0;

/// The card's padding: 16px, the rung above the composer's inner blocks
/// (`.composer-parallel-apply-block { padding:8px }`, §1.17) and the histogram's 16px rung (§10).
pub const CARD_PADDING: f32 = 16.0;

/// `.cursor-button { font-size:14px }` (§3).
pub const FONT_BUTTON: f32 = 14.0;

/// `.monaco-count-badge { font-size:11px; line-height:11px }` (§7).
pub const FONT_CHIP: f32 = 11.0;

/// The row and section-label size: `.context-list-item` and `.picker-menu-item` measure
/// `font-size:12px` (§2, §6).
pub const FONT_LABEL: f32 = 12.0;

/// Cursor's hairline: every measured border is `1px solid` (`.cursor-button`'s focus ring,
/// `.monaco-inputbox`, `.composer-history-pane`).
pub const HAIRLINE: f32 = 1.0;

/// Hover opacity: `.cursor-button-primary-clickable:not(.disabled):hover { opacity:.8 }` (§3).
pub const HOVER_OPACITY: f32 = 0.8;

/// Disabled opacity: `.cursor-button-primary.disabled { opacity:.5 }` (§3; `.monaco-button.disabled`
/// uses `.4`).
pub const DISABLED_OPACITY: f32 = 0.5;

/// The focus ring: `outline:1px solid var(--vscode-focusBorder)` (§3, §4) …
pub const FOCUS_OUTLINE_W: f32 = 1.0;

/// … at `outline-offset:-1px`, so the ring sits just inside the control's edge and follows its
/// radius (§3, §4, §8). The `:focus-visible` variant uses 2px at -2px.
pub const FOCUS_OUTLINE_OFFSET: f32 = -1.0;

/// The composer bar's shadow: Cursor's `box-shadow: 0 0 4px 1px widget-shadow` (§1.1), painted
/// as `egui::epaint::Shadow { offset: [0, 0], blur: 4, spread: 1 }`. G-05 moved it here from
/// `cmdline.rs`, so the bar and anything else following the composer chrome reads one value;
/// `cmdline.rs` still declares its own copy until its writer switches over.
pub const BAR_SHADOW: Color32 = Color32::from_rgba_unmultiplied_const(0x11, 0x11, 0x11, 0xeb);

/// The thin crosshair and pickbox contrast with the surface under their centre.
pub(crate) fn crosshair_color(background: Color32) -> Color32 {
    if luminance(background) > 0.5 { Color32::from_rgb(0x20, 0x20, 0x20) } else { Tokens::DARK.crosshair }
}

/// The user's drawing-area preferences (Options ▸ Display and Drafting); `None` keeps the theme's
/// colour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Canvas {
    pub model: Option<Color32>,
    pub paper: Option<Color32>,
    /// The side of an object snap marker, in points.
    pub snap_marker: f32,
    /// The colour selected objects are highlighted in.
    pub selection: Option<Color32>,
}

/// The default object snap marker size.
pub const SNAP_MARKER: f32 = 11.0;

impl Default for Canvas {
    fn default() -> Self {
        Canvas { model: None, paper: None, snap_marker: SNAP_MARKER, selection: None }
    }
}

impl Canvas {
    fn over(self, t: Tokens) -> Tokens {
        let t = match self.model {
            Some(bg) => t.with_model_background(bg),
            None => t,
        };
        Tokens { paper: self.paper.unwrap_or(t.paper), selection: self.selection.unwrap_or(t.selection), ..t }
    }
}

thread_local! {
    /// The drawing-area preferences in use on the UI thread (set by [`set_canvas`] each frame).
    static CANVAS: Cell<Canvas> = Cell::new(Canvas::default());
}

pub fn set_canvas(c: Canvas) {
    CANVAS.with(|v| v.set(c));
}

/// Half the side of an object snap marker, in points.
pub fn snap_marker_half() -> f32 {
    CANVAS.with(Cell::get).snap_marker / 2.0
}

/// Relative luminance of `c` (0 black … 1 white).
pub fn luminance(c: Color32) -> f32 {
    (0.299 * f32::from(c.r()) + 0.587 * f32::from(c.g()) + 0.114 * f32::from(c.b())) / 255.0
}

/// `a` moved the fraction `f` towards `b`.
fn mix(a: Color32, b: Color32, f: f32) -> Color32 {
    let m = |x: u8, y: u8| (f32::from(x) + (f32::from(y) - f32::from(x)) * f).round().clamp(0.0, 255.0) as u8;
    Color32::from_rgb(m(a.r(), b.r()), m(a.g(), b.g()), m(a.b(), b.b()))
}

pub fn small() -> FontId {
    FontId::new(11.5, FontFamily::Proportional)
}
pub fn body() -> FontId {
    FontId::new(13.0, FontFamily::Proportional)
}
pub fn mono() -> FontId {
    FontId::new(12.0, FontFamily::Monospace)
}

/// Load a system UI font at run time when one is installed (not bundled), else keep egui's
/// bundled bounded Latin/icon faces (`default_fonts` + `monochrome_emoji_fonts`, enabled in the
/// workspace manifest for native and web); then CJK fonts after the Latin ones, so Latin text
/// keeps its look, in every interface
/// language: file, layout and layer names can be Japanese or Chinese whatever the interface
/// shows (#513). In a Chinese interface (`language` "zh…") the Chinese font comes first, else a
/// Japanese one, so names take their own glyph forms; in an Arabic interface an installed
/// Arabic font follows. A font embedded from craft-fonts comes
/// last, for systems without any (and the web build, which has no system fonts). A Korean
/// interface adds a Hangul font only when the CJK font found doesn't cover Hangul
/// ([`korean_font`]).
pub fn install_fonts(ctx: &egui::Context, language: &str) {
    crate::mtext_editor::install_diameter_glyph(ctx);
    let mut fonts = egui::FontDefinitions::default();
    let mut added: Vec<(String, std::sync::Arc<egui::FontData>)> = Vec::new();
    #[cfg(not(target_arch = "wasm32"))]
    let chinese = language.starts_with("zh");
    #[cfg(not(target_arch = "wasm32"))]
    {
        let candidates: &[&str] = if cfg!(target_os = "macos") {
            &["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]
        } else if cfg!(windows) {
            &["C:\\Windows\\Fonts\\segoeui.ttf", "C:\\Windows\\Fonts\\arial.ttf"]
        } else {
            &[
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/TTF/DejaVuSans.ttf",
                "/usr/share/fonts/noto/NotoSans-Regular.ttf",
                "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
            ]
        };
        for path in candidates {
            if let Ok(bytes) = std::fs::read(path) {
                fonts.font_data.insert("system-ui".into(), std::sync::Arc::new(egui::FontData::from_owned(bytes)));
                if let Some(f) = fonts.families.get_mut(&FontFamily::Proportional) {
                    f.insert(0, "system-ui".into());
                }
                // Keep Hack first in Monospace, then use the system face for glyphs Hack lacks.
                if let Some(f) = fonts.families.get_mut(&FontFamily::Monospace) {
                    let at = f.iter().position(|name| name == "Hack").map_or(0, |i| i + 1);
                    f.insert(at, "system-ui".into());
                }
                break;
            }
        }
        let mut paths: Vec<&std::path::Path> = Vec::new();
        if !chinese {
            paths.extend(japanese_font());
        }
        paths.extend(cjk_font());
        paths.dedup();
        added.extend(
            paths
                .into_iter()
                .filter_map(|p| read_capped(p, MAX_UI_FONT_BYTES))
                .enumerate()
                .map(|(i, bytes)| (format!("system-cjk-{i}"), std::sync::Arc::new(egui::FontData::from_owned(bytes)))),
        );
        // العربية: an installed Arabic face after the Latin ones (egui's bundled faces carry no
        // Arabic glyphs), for the Arabic interface.
        if language == "ar"
            && let Some(bytes) = arabic_font().and_then(|p| read_capped(p, MAX_UI_FONT_BYTES))
        {
            added.push(("system-arabic".into(), std::sync::Arc::new(egui::FontData::from_owned(bytes))));
        }
    }
    let embedded: Vec<_> = cadcraft_fonts::CRAFT_FONTS.iter().collect();
    added.extend(
        embedded_ui_faces(&embedded, language)
            .into_iter()
            .map(|f| (format!("craft-{}", f.stem()), std::sync::Arc::new(egui::FontData::from_static(f.bytes)))),
    );
    // Korean: Noto Sans CJK and most CJK fonts above already cover Hangul; else a Hangul font.
    if language == "ko"
        && !cjk_covers_hangul()
        && let Some(face) = korean_font()
    {
        let mut data = egui::FontData::from_owned(face.bytes.as_ref().clone());
        data.index = face.index;
        added.push(("korean-ui".into(), std::sync::Arc::new(data)));
    }
    for (name, data) in added {
        fonts.font_data.insert(name.clone(), data);
        for family in [FontFamily::Proportional, FontFamily::Monospace] {
            if let Some(f) = fonts.families.get_mut(&family) {
                f.push(name.clone());
            }
        }
    }
    // `default_fonts` supplies Ubuntu-Light (Proportional) and Hack (Monospace). Hack also
    // carries the modifier symbols (⇧) that proportional shortcut labels use; keep it as a
    // bounded late fallback when Ubuntu-Light lacks one. The monochrome emoji face (enabled by
    // `monochrome_emoji_fonts`) supplies ⌘ in both families.
    if fonts.font_data.contains_key("Hack")
        && let Some(f) = fonts.families.get_mut(&FontFamily::Proportional)
        && !f.iter().any(|name| name == "Hack")
    {
        f.push("Hack".into());
    }
    ctx.set_fonts(fonts);
}

/// The faces `build.rs` embedded from craft-fonts that the interface loads, in order: every CJK
/// face, because file, layout and layer names can be Japanese or Chinese whatever the interface
/// shows (#513), with the interface's own face leading. A sans-serif face reads best, and a
/// Chinese interface takes the face with its own glyphs ahead of a Japanese one — a Japanese face
/// shares most ideographs but lacks the simplified-only ones (图 园 测), which would be tofu.
/// العربية adds its Arabic face after those, egui's bundled faces carrying no Arabic glyphs.
fn embedded_ui_faces<'a>(faces: &[&'a cadcraft_fonts::CraftFont], language: &str) -> Vec<&'a cadcraft_fonts::CraftFont> {
    let cjk = |f: &&cadcraft_fonts::CraftFont| f.style == "Regular" && f.scripts.iter().any(|s| matches!(*s, "Jpan" | "Hans" | "Hant"));
    let mut out: Vec<_> = faces.iter().copied().filter(cjk).collect();
    out.sort_by_key(|f| !f.family.contains("Gothic") && !f.family.contains("Sans"));
    if language.starts_with("zh") {
        out.sort_by_key(|f| !f.scripts.contains(&"Hans"));
    }
    if language == "ar" {
        out.extend(faces.iter().copied().filter(|f| f.style == "Regular" && f.scripts.contains(&"Arab")));
    }
    out
}

/// Largest interface font file read or embedded face copied (CJK collections are 15–60 MB).
const MAX_UI_FONT_BYTES: u64 = 96 * 1024 * 1024;

#[cfg(not(target_arch = "wasm32"))]
fn read_capped(path: &std::path::Path, max: u64) -> Option<Vec<u8>> {
    use std::io::Read as _;
    let file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if len == 0 || len > max {
        return None;
    }
    // Enforce the cap during the read too, even if the file grows after metadata was read.
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1)).read_to_end(&mut bytes).ok()?;
    (!bytes.is_empty() && bytes.len() as u64 <= max).then_some(bytes)
}

/// An installed font with Chinese characters, for the Chinese interface; fonts are never bundled
/// (only looked for where the OS or common packages put them). Checked once.
pub fn cjk_font() -> Option<&'static std::path::Path> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        static FOUND: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
        FOUND
            .get_or_init(|| {
                let candidates: &[&str] = if cfg!(target_os = "macos") {
                    &["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Light.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]
                } else if cfg!(windows) {
                    &["C:\\Windows\\Fonts\\msyh.ttc", "C:\\Windows\\Fonts\\msyh.ttf", "C:\\Windows\\Fonts\\simsun.ttc"]
                } else {
                    &[
                        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
                        "/usr/local/share/fonts/noto/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
                        "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
                        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
                    ]
                };
                candidates.iter().map(std::path::PathBuf::from).find(|p| p.is_file())
            })
            .as_deref()
    }
    #[cfg(target_arch = "wasm32")]
    None
}

/// An installed font with Arabic glyphs, for the العربية interface; fonts are never bundled
/// (only looked for where the OS or common packages put them). Checked once.
pub fn arabic_font() -> Option<&'static std::path::Path> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        static FOUND: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
        FOUND
            .get_or_init(|| {
                let candidates: &[&str] = if cfg!(target_os = "macos") {
                    &[
                        "/System/Library/Fonts/GeezaPro.ttc",
                        "/System/Library/Fonts/Supplemental/Geeza Pro.ttf",
                        "/System/Library/Fonts/Supplemental/Al Nile.ttc",
                        "/System/Library/Fonts/Supplemental/Baghdad.ttf",
                    ]
                } else if cfg!(windows) {
                    &[
                        "C:\\Windows\\Fonts\\segoeui.ttf",
                        "C:\\Windows\\Fonts\\tahoma.ttf",
                        "C:\\Windows\\Fonts\\trado.ttf",
                        "C:\\Windows\\Fonts\\arabtype.ttf",
                        "C:\\Windows\\Fonts\\arial.ttf",
                    ]
                } else {
                    &[
                        "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
                        "/usr/share/fonts/noto/NotoSansArabic-Regular.ttf",
                        "/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf",
                        "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                        "/usr/share/fonts/TTF/DejaVuSans.ttf",
                        "/usr/share/fonts/truetype/amiri/Amiri-Regular.ttf",
                        "/usr/share/fonts/truetype/kacst/KacstOne.ttf",
                    ]
                };
                candidates.iter().map(std::path::PathBuf::from).find(|p| p.is_file())
            })
            .as_deref()
    }
    #[cfg(target_arch = "wasm32")]
    None
}

/// An installed Japanese font, for Japanese names in a non-Chinese interface. Checked once.
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
fn japanese_font() -> Option<&'static std::path::Path> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        static FOUND: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
        FOUND
            .get_or_init(|| {
                let candidates: &[&str] = if cfg!(target_os = "macos") {
                    &["/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]
                } else if cfg!(windows) {
                    &["C:\\Windows\\Fonts\\YuGothR.ttc", "C:\\Windows\\Fonts\\meiryo.ttc", "C:\\Windows\\Fonts\\msgothic.ttc"]
                } else {
                    &[
                        "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
                        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
                        "/usr/share/fonts/ipa-pgothic/ipagp.ttf",
                        "/usr/share/fonts/vl-gothic/VL-PGothic-Regular.ttf",
                    ]
                };
                candidates.iter().map(std::path::PathBuf::from).find(|p| p.is_file())
            })
            .as_deref()
    }
    #[cfg(target_arch = "wasm32")]
    None
}

/// The Hangul letters the Korean interface shows: its catalog and its own name.
fn hangul_letters() -> &'static std::collections::BTreeSet<char> {
    static LETTERS: std::sync::OnceLock<std::collections::BTreeSet<char>> = std::sync::OnceLock::new();
    LETTERS.get_or_init(|| {
        include_str!("i18n/ko.tsv")
            .lines()
            .filter_map(|line| line.split('\t').nth(2))
            .flat_map(str::chars)
            .chain("한국어".chars())
            .filter(|c| matches!(c, '\u{1100}'..='\u{11ff}' | '\u{3130}'..='\u{318f}' | '\u{a960}'..='\u{a97f}' | '\u{ac00}'..='\u{d7ff}'))
            .collect()
    })
}

/// Whether `face` has every Hangul letter the Korean interface shows (rejects malformed fonts
/// and Chinese- or Japanese-only faces).
fn covers_hangul(face: &cadcraft_fonts::ttf::Face) -> bool {
    hangul_letters().iter().all(|c| face.has_glyph(*c))
}

/// The first face of a font file (the one egui uses) when it covers the Korean interface.
fn korean_face(bytes: std::sync::Arc<Vec<u8>>) -> Option<cadcraft_fonts::ttf::Face> {
    cadcraft_fonts::ttf::faces(&bytes).into_iter().find(covers_hangul)
}

/// Whether the CJK fonts [`install_fonts`] loads in every language already show Hangul (Noto Sans
/// CJK, Microsoft YaHei, PingFang do). Only asked about Korean, so other interfaces never read the
/// font twice. Checked once.
pub fn cjk_covers_hangul() -> bool {
    static COVERS: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *COVERS.get_or_init(|| {
        #[cfg(not(target_arch = "wasm32"))]
        {
            // egui uses a collection's first face, and each letter from the first font with it.
            let first_covers = |p: &std::path::Path| {
                read_capped(p, MAX_UI_FONT_BYTES)
                    .and_then(|bytes| cadcraft_fonts::ttf::faces(&std::sync::Arc::new(bytes)).into_iter().next())
                    .is_some_and(|face| covers_hangul(&face))
            };
            if cjk_font().is_some_and(first_covers) {
                return true;
            }
        }
        cadcraft_fonts::CRAFT_FONTS
            .iter()
            .filter(|f| f.style == "Regular" && f.scripts.iter().any(|s| matches!(*s, "Jpan" | "Hans" | "Hant")))
            .any(|f| cadcraft_fonts::ttf::faces(&std::sync::Arc::new(f.bytes.to_vec())).first().is_some_and(covers_hangul))
    })
}

/// A Hangul font for the Korean interface when the CJK fonts don't cover it: a Korean face from
/// the optional craft-fonts input, else one installed where the OS or common packages put it.
/// Nothing is bundled or downloaded; without one the interface stays English. Only looked for
/// when Korean is asked about. Checked once; collections are scanned with the fonts crate's
/// face-count cap and reads are capped.
pub fn korean_font() -> Option<&'static cadcraft_fonts::ttf::Face> {
    static FOUND: std::sync::OnceLock<Option<cadcraft_fonts::ttf::Face>> = std::sync::OnceLock::new();
    FOUND
        .get_or_init(|| {
            for font in cadcraft_fonts::CRAFT_FONTS.iter().filter(|f| f.scripts.iter().any(|s| matches!(*s, "Hang" | "Kore"))) {
                if font.bytes.len() as u64 > MAX_UI_FONT_BYTES {
                    continue;
                }
                if let Some(face) = korean_face(std::sync::Arc::new(font.bytes.to_vec())) {
                    return Some(face);
                }
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                let candidates: &[&str] = if cfg!(target_os = "macos") {
                    &[
                        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
                        "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
                        "/Library/Fonts/NanumGothic.ttf",
                    ]
                } else if cfg!(windows) {
                    &["C:\\Windows\\Fonts\\malgun.ttf", "C:\\Windows\\Fonts\\gulim.ttc"]
                } else {
                    &[
                        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
                        "/usr/share/fonts/nanum/NanumGothic.ttf",
                        "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
                        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
                        "/usr/local/share/fonts/nanum/NanumGothic.ttf",
                        "/usr/local/share/fonts/noto/NotoSansCJK-Regular.ttc",
                    ]
                };
                for path in candidates {
                    if let Some(face) =
                        read_capped(std::path::Path::new(path), MAX_UI_FONT_BYTES).and_then(|bytes| korean_face(std::sync::Arc::new(bytes)))
                    {
                        return Some(face);
                    }
                }
            }
            None
        })
        .as_ref()
}

/// Whether the interface in `language` shows Hangul (the Korean name in the language picker):
/// in every language when the CJK fonts cover it, in a Korean interface with [`korean_font`].
pub fn shows_hangul(language: &str) -> bool {
    cjk_covers_hangul() || (language == "ko" && korean_font().is_some())
}

/// Whether the interface can show `language` without missing-glyph boxes: Chinese needs a font
/// with its glyphs (installed, or the CJK face this build embedded from craft-fonts), Korean a
/// font with Hangul, العربية an installed Arabic font or the embedded Arabic face.
pub fn can_show(language: &str) -> bool {
    match language {
        "ko" => shows_hangul("ko"),
        "ar" => arabic_font().is_some() || embedded_script("Arab"),
        l if l.starts_with("zh") => cjk_font().is_some() || embedded_script("Hans") || embedded_script("Hant"),
        _ => true,
    }
}

/// Whether a face this build embedded from craft-fonts carries `script` (ISO 15924). The web
/// build has no system fonts, so there the interface rides on the embedded faces alone; the
/// Korean gate already asks this way ([`korean_font`]) and Arabic and Chinese match it. Only a
/// build made with `CRAFT_FONTS_DIR` embeds any (`build.rs`), so the rest is unchanged.
fn embedded_script(script: &str) -> bool {
    any_script(cadcraft_fonts::CRAFT_FONTS, script)
}

/// Whether any face of `faces` carries `script` (ISO 15924), the question [`embedded_script`]
/// asks of the table this build embedded.
fn any_script(faces: &[cadcraft_fonts::CraftFont], script: &str) -> bool {
    faces.iter().any(|f| f.style == "Regular" && f.scripts.contains(&script))
}

/// egui's visuals for `theme`, from its tokens.
fn visuals(theme: Theme) -> Visuals {
    let t = Tokens::of(theme);
    let mut v = match theme {
        Theme::Dark => Visuals::dark(),
        Theme::Light => Visuals::light(),
    };
    v.panel_fill = t.panel;
    v.window_fill = t.chrome;
    v.extreme_bg_color = t.field;
    v.faint_bg_color = t.chrome_dark;
    v.override_text_color = Some(t.text);
    v.widgets.noninteractive.bg_fill = t.panel;
    v.widgets.noninteractive.fg_stroke.color = t.text;
    v.widgets.noninteractive.bg_stroke.color = t.border;
    // Controls are Cursor's ghost buttons: a wash fill, a hairline border, and the border
    // brightening on hover and press — no heavy fills, no glow.
    v.widgets.inactive.bg_fill = t.control;
    v.widgets.inactive.weak_bg_fill = t.control;
    v.widgets.inactive.fg_stroke.color = t.text;
    v.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, t.border);
    v.widgets.hovered.bg_fill = t.control_hover;
    v.widgets.hovered.weak_bg_fill = t.control_hover;
    v.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, t.cmd_border);
    v.widgets.active.bg_fill = t.control_hover;
    v.widgets.active.weak_bg_fill = t.control_hover;
    v.widgets.active.bg_stroke = egui::Stroke::new(1.0, t.cmd_border);
    v.selection.bg_fill = t.select_bg;
    v.hyperlink_color = t.accent;
    v.window_stroke = egui::Stroke::new(1.0, t.border);
    // Depth comes from luminance steps, not from shadow; popups keep a whisper of one.
    let shadow = Color32::from_black_alpha(if theme == Theme::Dark { 90 } else { 40 });
    v.popup_shadow = egui::epaint::Shadow { offset: [0, 4], blur: 12, spread: 0, color: shadow };
    // Cursor's measured radii (recipes.md §10): the chrome surfaces — menus (`.monaco-menu`) and
    // the composer bar — are 5px, cards and menu items 4px. The old 6/8/10/12 scale came from a
    // third-party clone's design doc, not from Cursor.
    v.window_corner_radius = egui::CornerRadius::same(RADIUS_COMPOSER as u8);
    v.menu_corner_radius = egui::CornerRadius::same(RADIUS_COMPOSER as u8);
    v
}

/// Install the styles of both themes and show `theme` (egui's own widgets, popups and menus
/// follow it; our own painting follows [`Tokens::get`]). `follow_system` is true for the
/// [`ThemePref::System`] choice, whose `theme` was resolved from the OS report.
pub fn apply(ctx: &egui::Context, theme: Theme, follow_system: bool) {
    set_active(theme);
    ctx.set_visuals_of(Theme::Dark, visuals(Theme::Dark));
    ctx.set_visuals_of(Theme::Light, visuals(Theme::Light));
    // A System choice keeps egui's own System preference: a concrete Light/Dark would pin the native
    // window appearance (winit then stops reporting OS changes) and the app would never follow again.
    ctx.set_theme(if follow_system { egui::ThemePreference::System } else { egui::ThemePreference::from(theme) });
    ctx.all_styles_mut(|s| {
        s.spacing.item_spacing = egui::vec2(GAP_6, GAP_DEFAULT);
        s.spacing.button_padding = egui::vec2(GAP_6, GAP_3);
        s.spacing.interact_size.y = 20.0;
        s.text_styles.insert(egui::TextStyle::Body, body());
        s.text_styles.insert(egui::TextStyle::Button, body());
        s.text_styles.insert(egui::TextStyle::Small, small());
        s.text_styles.insert(egui::TextStyle::Monospace, mono());
    });
}

#[cfg(test)]
mod tests {
    use cadcraft_fonts::CraftFont;

    /// A face shaped like `build.rs` writes them, with no font file (as in `cadcraft-fonts`).
    fn face(family: &'static str, scripts: &'static [&'static str]) -> CraftFont {
        CraftFont { family, style: "Regular", scripts, bytes: &[] }
    }

    fn families<'a>(faces: &[&'a CraftFont]) -> Vec<&'a str> {
        faces.iter().map(|f| f.family).collect()
    }

    #[test]
    fn korean_font_rejects_invalid_or_glyphless_files() {
        for bytes in [vec![], vec![0xff; 32], vec![0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] {
            assert!(super::korean_face(std::sync::Arc::new(bytes)).is_none());
        }
    }

    /// The interface's own script leads the embedded faces it loads, and العربية adds its face.
    #[test]
    fn embedded_faces_lead_with_the_interfaces_own_script() {
        let japanese = face("BIZ UDPGothic", &["Jpan", "Latn"]);
        let chinese = face("Han Test Face", &["Hans", "Latn"]);
        let arabic = face("Noto Sans Arabic", &["Arab"]);
        let faces = [&japanese, &chinese, &arabic];
        // Every interface reads CJK names, so both CJK faces load, the sans-serif face first.
        assert_eq!(families(&super::embedded_ui_faces(&faces, "en")), ["BIZ UDPGothic", "Han Test Face"]);
        // A Chinese interface takes the Han face first: a Japanese face lacks 图 园 测.
        assert_eq!(families(&super::embedded_ui_faces(&faces, "zh")), ["Han Test Face", "BIZ UDPGothic"]);
        // العربية adds the Arabic face, after the CJK ones egui's bundled faces have no glyphs for.
        assert_eq!(families(&super::embedded_ui_faces(&faces, "ar")), ["BIZ UDPGothic", "Han Test Face", "Noto Sans Arabic"]);
        // Another weight is a style of a face, not an interface face of its own.
        let bold = CraftFont { family: "BIZ UDPGothic", style: "Bold", scripts: &["Jpan"], bytes: &[] };
        assert!(super::embedded_ui_faces(&[&bold], "en").is_empty());
    }

    /// What the gate asks of the table: an embedded face of the script stands in for an installed
    /// font, which the web build never has. The default (no `CRAFT_FONTS_DIR`) table answers no,
    /// leaving the installed-font answer the gate had before.
    #[test]
    fn embedded_faces_answer_for_their_scripts() {
        let faces = [face("BIZ UDPGothic", &["Jpan", "Latn"]), face("Noto Sans Arabic", &["Arab"])];
        assert!(super::any_script(&faces, "Jpan") && super::any_script(&faces, "Arab"));
        assert!(!super::any_script(&faces, "Hans") && !super::any_script(&faces, "Hant"));
        // A `Bold`-only face is not the interface's, and a script code is matched whole.
        let bold = CraftFont { family: "Some Han Bold", style: "Bold", scripts: &["Hans"], bytes: &[] };
        assert!(!super::any_script(&[bold], "Hans") && !super::any_script(&faces, "Ara"));
        assert!(!super::embedded_script("Hans") || super::can_show("zh"));
        assert!(super::can_show("en") && super::can_show("uk"));
    }
}
