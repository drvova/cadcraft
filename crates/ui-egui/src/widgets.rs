//! The canonical widget recipes: one function per control, each reading [`Tokens::get`] and the
//! measured recipe constants in [`crate::theme`]. Doc comments quote the Cursor selector each
//! number was measured from (`.design-system/cursor/recipes.md`); the surfaces call these rather
//! than painting their own fills and radii, which is how the estate grew four icon-button
//! treatments and five tab implementations (`.design-system/boss/triage/inventory.md` §4).

use egui::{Color32, FontId, Response, Sense, Stroke, StrokeKind, Ui};

use crate::icons::Icon;
use crate::motion;
use crate::theme::{self, Tokens};

/// A button kind: Cursor's `.cursor-button-primary`, the ghost `.cursor-button-tertiary` /
/// `.cursor-button-true-secondary`, and `.cursor-button-danger`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A transparent fill with a hairline border that fills on hover (`.cursor-button-tertiary`).
    Ghost,
    /// The action fill (`.cursor-button-primary`).
    Primary,
    /// The error fill (`.cursor-button-danger`).
    Danger,
}

/// A chip kind, from `.cursor-badge`'s variants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChipKind {
    /// The quiet fill (`.cursor-badge-subtle`).
    Neutral,
    /// The action fill (`.cursor-badge` default).
    Accent,
    /// The error fill (`.cursor-badge` danger).
    Danger,
}

/// A button: `.cursor-button { border-radius:2px; font-size:14px; gap:4px; padding:4px 8px }`,
/// hover `opacity:.8` (`.cursor-button-primary-clickable:not(.disabled):hover`), disabled
/// `opacity:.5`, and the focus ring `outline:1px solid; outline-offset:-1px`
/// (`.cursor-button.tab-focusable:focus`). [`Kind::Primary`] fills with `button.background`
/// ([`Tokens::accent`]), [`Kind::Danger`] with `errorForeground` ([`Tokens::error`]), and
/// [`Kind::Ghost`] keeps a hairline border and fills on hover.
pub fn button(ui: &mut Ui, label: &str, kind: Kind) -> Response {
    let t = Tokens::get();
    let label = crate::i18n::t(label);
    let galley = ui.painter().layout_no_wrap(label.to_owned(), FontId::proportional(theme::FONT_BUTTON), t.text);
    let size = egui::vec2(galley.size().x + 2.0 * theme::BUTTON_PAD_X, theme::CONTROL_H_BUTTON);
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    if ui.is_rect_visible(rect) {
        let lit = response.enabled() && (response.hovered() || response.is_pointer_button_down_on());
        // The lit state glides in over DUR_FAST, and a disabled button fades to its
        // `opacity:.5`; with animations off both land on their target at once.
        let hover = motion::hover(ui, response.id.with("hover"), lit);
        let on = motion::hover(ui, response.id.with("enabled"), response.enabled());
        let (fill, border, text) = button_colors(&t, kind, hover);
        let shade = |c: Color32| c.gamma_multiply(motion::mix(theme::DISABLED_OPACITY, 1.0, on));
        if let Some(fill) = fill {
            ui.painter().rect_filled(rect, theme::RADIUS_CONTROL, shade(fill));
        }
        if let Some(border) = border {
            ui.painter().rect_stroke(rect, theme::RADIUS_CONTROL, Stroke::new(theme::HAIRLINE, shade(border)), StrokeKind::Inside);
        }
        let at = egui::pos2(rect.center().x - galley.size().x / 2.0, rect.center().y - galley.size().y / 2.0);
        ui.painter().galley(at, galley, shade(text));
    }
    response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, response.enabled(), label));
    crate::control::record_widget(ui, &response, label, "button", None);
    focus_ring(ui, &response, theme::RADIUS_CONTROL);
    response
}

/// The colours of one button state, blended by `lit` (0: at rest, 1: lit): fill, border, label.
/// A lit button (hover or press) takes the hover fill; `Ghost` fills and brightens its border,
/// the filled kinds drop to `opacity:.8`.
fn button_colors(t: &Tokens, kind: Kind, lit: f32) -> (Option<Color32>, Option<Color32>, Color32) {
    match kind {
        Kind::Ghost => {
            let fill = (lit > 0.0).then(|| motion::mix_color(Color32::TRANSPARENT, t.control_hover, lit));
            (fill, Some(motion::mix_color(t.border, t.cmd_border, lit)), t.text)
        }
        Kind::Primary => (Some(t.accent.gamma_multiply(motion::mix(1.0, theme::HOVER_OPACITY, lit))), None, t.on_accent),
        Kind::Danger => (Some(t.error.gamma_multiply(motion::mix(1.0, theme::HOVER_OPACITY, lit))), None, t.on_accent),
    }
}

/// An icon-only button, the recipe-level entry the surfaces call. The glyph is drawn by
/// [`crate::icons::paint`] (icons.rs stays the drawing layer); this owns the measured chrome: a
/// square `size` target at `.composer-bar-button`'s `border-radius:4px`, hover filling from
/// `toolbar.hoverBackground` and selection from `list.activeSelectionBackground` (§1.5, §2), and
/// the 1px focus ring at offset -1. `tooltip` names the control and is shown on hover.
pub fn icon_button(ui: &mut Ui, icon: Icon, size: f32, tooltip: &str, selected: bool) -> Response {
    let t = Tokens::get();
    let (rect, response) = ui.allocate_exact_size(egui::vec2(size, size), Sense::click());
    if ui.is_rect_visible(rect) {
        // The hover tint fades in and out; selection stays the discrete fill that outranks it.
        let hover = motion::hover(ui, response.id.with("hover"), !selected && response.enabled() && response.hovered());
        let fill = if selected {
            Some(t.select_bg)
        } else if hover > 0.0 {
            Some(motion::mix_color(Color32::TRANSPARENT, t.control_hover, hover))
        } else {
            None
        };
        if let Some(fill) = fill {
            ui.painter().rect_filled(rect, theme::RADIUS_CARD, fill);
        }
        // The same 8 % inset `icons::button` uses, so the glyph's ink keeps its optical size.
        crate::icons::paint(ui.painter(), rect.shrink(size * 0.08), icon, !ui.is_enabled());
    }
    let label = crate::i18n::t(tooltip);
    response.widget_info(|| egui::WidgetInfo::selected(egui::Role::Button, response.enabled(), selected, label));
    crate::control::record_widget(ui, &response, label, "button", Some(selected));
    focus_ring(ui, &response, theme::RADIUS_CARD);
    response.on_hover_text(label)
}

/// A single-line field: `.monaco-inputbox { border-radius:2px }` with inner
/// `padding:4px 6px` (§4), the measured 24px input height, the focus ring
/// `outline:1px solid; outline-offset:-1px`, and the placeholder colour
/// `input.placeholderForeground` ([`Tokens::text_faint`]). `hint` shows while `text` is empty.
pub fn field(ui: &mut Ui, text: &mut String, hint: &str) -> Response {
    let t = Tokens::get();
    let frame = egui::Frame::new().fill(t.field).stroke(Stroke::new(theme::HAIRLINE, t.border)).corner_radius(theme::RADIUS_CONTROL);
    let response = ui
        .scope(|ui| {
            ui.visuals_mut().weak_text_color = Some(t.text_faint);
            ui.add(
                egui::TextEdit::singleline(text)
                    .font(theme::body())
                    .text_color(t.text)
                    .hint_text(crate::i18n::t(hint))
                    .frame(frame)
                    .margin(egui::Margin::symmetric(theme::FIELD_PAD_X as i8, theme::FIELD_PAD_Y as i8))
                    .desired_width(f32::INFINITY)
                    .min_size(egui::vec2(0.0, theme::CONTROL_H_INPUT)),
            )
        })
        .inner;
    focus_ring(ui, &response, theme::RADIUS_CONTROL);
    response
}

/// A chip: `.monaco-count-badge { border-radius:11px; font-size:11px; line-height:11px;
/// min-height:18px; min-width:18px; padding:3px 6px; text-align:center }` (§7), filled by kind
/// from `.cursor-badge`'s variants (`badge.background`, `button.background`, `errorForeground`).
pub fn chip(ui: &mut Ui, text: &str, kind: ChipKind) -> Response {
    let t = Tokens::get();
    let text = crate::i18n::t(text);
    let galley = ui.painter().layout_no_wrap(text.to_owned(), FontId::proportional(theme::FONT_CHIP), t.text);
    let size = egui::vec2(
        (galley.size().x + 2.0 * theme::CHIP_PAD_X).max(theme::CHIP_MIN_W),
        // The recipe's line-height equals its font size, so the pill's height is 11 + 3 + 3.
        (theme::FONT_CHIP + 2.0 * theme::CHIP_PAD_Y).max(theme::CHIP_MIN_H),
    );
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    if ui.is_rect_visible(rect) {
        let (fill, fg) = match kind {
            ChipKind::Neutral => (t.control, t.text_dim),
            ChipKind::Accent => (t.accent, t.on_accent),
            ChipKind::Danger => (t.error, t.on_accent),
        };
        ui.painter().rect_filled(rect, theme::RADIUS_PILL, fill);
        let at = egui::pos2(rect.center().x - galley.size().x / 2.0, rect.center().y - galley.size().y / 2.0);
        ui.painter().galley(at, galley, fg);
    }
    response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, response.enabled(), text));
    crate::control::record_widget(ui, &response, text, "button", None);
    focus_ring(ui, &response, theme::RADIUS_PILL);
    response
}

/// A list row: `.explorer-item { height:22px; line-height:22px }` (§2) at
/// `.action-menu-item`'s `border-radius:4px` (§6), hovering `list.hoverBackground` and selecting
/// `list.inactiveSelectionBackground` (`.sidebar-list-item`, §2). The caller paints the row's
/// content into the returned response's rect and names it.
pub fn row(ui: &mut Ui, selected: bool) -> Response {
    let t = Tokens::get();
    let (rect, response) = ui.allocate_exact_size(egui::vec2(ui.available_width(), theme::CONTROL_H_ROW), Sense::click());
    if ui.is_rect_visible(rect) {
        // The hover fill and the selection fill each glide in and out; selection paints first,
        // as the recipe's state precedence has it outrank hover.
        let hover = motion::hover(ui, response.id.with("hover"), !selected && response.enabled() && response.hovered());
        let select = motion::hover(ui, response.id.with("select"), selected);
        if select > 0.0 {
            ui.painter().rect_filled(rect, theme::RADIUS_CARD, motion::mix_color(Color32::TRANSPARENT, t.select_bg, select));
        }
        if hover > 0.0 {
            ui.painter().rect_filled(rect, theme::RADIUS_CARD, motion::mix_color(Color32::TRANSPARENT, t.control_hover, hover));
        }
    }
    crate::control::record_widget(ui, &response, "", "row", Some(selected));
    focus_ring(ui, &response, theme::RADIUS_CARD);
    response
}

/// A card: Cursor's `.composer-history-pane { background:editor.background; border:1px solid
/// editorWidget-border; border-radius:4px }` (§1.17), padded 16px, on the app's inset surface
/// ([`Tokens::field`]) with [`Tokens::border`]. `add` builds the card's content.
pub fn card<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> egui::InnerResponse<R> {
    let t = Tokens::get();
    egui::Frame::new()
        .fill(t.field)
        .stroke(Stroke::new(theme::HAIRLINE, t.border))
        .corner_radius(theme::RADIUS_CARD)
        .inner_margin(theme::CARD_PADDING)
        .show(ui, add)
}

/// A section label: `.context-list-item { font-size:12px }` (§2) and `.picker-menu-item
/// { font-size:12px }` (§6) in the muted placeholder colour (`input.placeholderForeground`,
/// [`Tokens::text_faint`]). The callers write sentence case (`Model`, `Attach files`).
pub fn section_label(ui: &mut Ui, text: &str) -> Response {
    let t = Tokens::get();
    ui.label(egui::RichText::new(crate::i18n::t(text)).font(FontId::proportional(theme::FONT_LABEL)).color(t.text_faint))
}

/// Cursor's focus ring: `outline:1px solid var(--vscode-focusBorder); outline-offset:-1px`
/// (`.cursor-button.tab-focusable:focus` §3, `.monaco-inputbox` focus §4), drawn just inside the
/// control's edge and following its radius (§8), fading in and out over [`motion::DUR_FAST`].
fn focus_ring(ui: &Ui, response: &Response, radius: f32) {
    if !response.rect.is_positive() {
        return;
    }
    let focus = motion::hover(ui, response.id.with("focus"), response.has_focus());
    if focus <= 0.0 {
        return;
    }
    let ring = response.rect.shrink(-theme::FOCUS_OUTLINE_OFFSET);
    ui.painter().rect_stroke(ring, radius, Stroke::new(theme::FOCUS_OUTLINE_W, Tokens::get().accent.gamma_multiply(focus)), StrokeKind::Outside);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every recipe paints headlessly, and the measured control heights hold.
    #[test]
    fn recipes_paint_at_their_measured_heights() {
        let ctx = egui::Context::default();
        let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400.0, 300.0));
        let input = egui::RawInput { screen_rect: Some(rect), ..Default::default() };
        let mut text = String::new();
        let mut heights = Vec::new();
        let mut output = ctx.run_ui(input, |ui| {
            heights.push(button(ui, "Save", Kind::Primary).rect.height());
            heights.push(icon_button(ui, Icon::Save, theme::CHIP_MIN_H, "Save", false).rect.height());
            heights.push(field(ui, &mut text, "Name").rect.height());
            heights.push(chip(ui, "3", ChipKind::Neutral).rect.height());
            heights.push(row(ui, false).rect.height());
            heights.push(card(ui, |ui| ui.label("card")).response.rect.height());
            heights.push(section_label(ui, "Model").rect.height());
        });
        output.textures_delta.clear();
        assert_eq!(heights[0], theme::CONTROL_H_BUTTON, "`.cursor-button` is 28px tall");
        assert_eq!(heights[1], theme::CHIP_MIN_H, "an icon button is the square it is given");
        assert_eq!(heights[2], theme::CONTROL_H_INPUT, "`.monaco-inputbox` is 24px tall");
        assert_eq!(heights[3], theme::CHIP_MIN_H, "`.monaco-count-badge` is at least 18px tall");
        assert_eq!(heights[4], theme::CONTROL_H_ROW, "a list row is 22px tall");
        assert!(heights[5] > 0.0 && heights[6] > 0.0, "a card and a section label take space");
    }

    /// The button's hover fill glides: the frames while the pointer arrives show a blend of the
    /// two states, and the settled states keep today's exact colours.
    #[test]
    fn button_hover_fill_glides_between_its_states() {
        let ctx = egui::Context::default();
        crate::motion::set_animations(true);
        let t = Tokens::get();
        let rest = t.accent;
        let lit = t.accent.gamma_multiply(theme::HOVER_OPACITY);
        let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(200.0, 100.0));
        let mut rect = egui::Rect::NOTHING;
        let mut fills = Vec::new();
        for index in 0..14 {
            let events = if index == 0 { Vec::new() } else { vec![egui::Event::PointerMoved(rect.center())] };
            let input = egui::RawInput { screen_rect: Some(screen), events, time: Some(index as f64 / 60.0), ..Default::default() };
            let mut output = ctx.run_ui(input, |ui| rect = button(ui, "Save", Kind::Primary).rect);
            output.textures_delta.clear();
            fills.push(painted_fill(&output, rect));
        }
        assert_eq!(fills[0], Some(rest), "an unhovered button keeps today's fill");
        assert_eq!(fills[13], Some(lit), "a settled hover keeps today's lit fill");
        assert!(fills.iter().all(|f| f.is_some_and(|c| between(c, rest, lit))), "every frame interpolates between the two states: {fills:?}");
        assert!(fills.iter().flatten().any(|c| *c != rest && *c != lit), "a frame mid-glide shows a blend: {fills:?}");
    }

    /// The fill the painter emitted for `rect` this frame, if any.
    fn painted_fill(output: &egui::FullOutput, rect: egui::Rect) -> Option<Color32> {
        output.shapes.iter().find_map(|clipped| match &clipped.shape {
            egui::Shape::Rect(shape) if shape.rect == rect && shape.fill.a() > 0 => Some(shape.fill),
            _ => None,
        })
    }

    /// Whether `c` sits between `a` and `b` on every channel (inclusive).
    fn between(c: Color32, a: Color32, b: Color32) -> bool {
        let [cr, cg, cb, ca] = c.to_array();
        let [ar, ag, ab, aa] = a.to_array();
        let [br, bg, bb, ba] = b.to_array();
        let inside = |x: u8, p: u8, q: u8| x >= p.min(q) && x <= p.max(q);
        inside(cr, ar, br) && inside(cg, ag, bg) && inside(cb, ab, bb) && inside(ca, aa, ba)
    }
}
