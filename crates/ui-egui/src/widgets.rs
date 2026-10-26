//! The canonical widget recipes: one function per control, each reading [`Tokens::get`] and the
//! measured recipe constants in [`crate::theme`]. Doc comments quote the Cursor selector each
//! number was measured from (`.design-system/cursor/recipes.md`); the surfaces call these rather
//! than painting their own fills and radii, which is how the estate grew four icon-button
//! treatments and five tab implementations (`.design-system/boss/triage/inventory.md` §4).

use egui::{Color32, FontId, Response, Sense, Stroke, StrokeKind, Ui};

use crate::icons::Icon;
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
        let (fill, border, text) = button_colors(&t, kind, lit);
        let shade = |c: Color32| if response.enabled() { c } else { c.gamma_multiply(theme::DISABLED_OPACITY) };
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

/// The colours of one button state: fill, border, label. A lit button (hover or press) takes the
/// hover fill; `Ghost` fills and brightens its border, the filled kinds drop to `opacity:.8`.
fn button_colors(t: &Tokens, kind: Kind, lit: bool) -> (Option<Color32>, Option<Color32>, Color32) {
    match kind {
        Kind::Ghost => (lit.then_some(t.control_hover), Some(if lit { t.cmd_border } else { t.border }), t.text),
        Kind::Primary => {
            let fill = if lit { t.accent.gamma_multiply(theme::HOVER_OPACITY) } else { t.accent };
            (Some(fill), None, t.on_accent)
        }
        Kind::Danger => {
            let fill = if lit { t.error.gamma_multiply(theme::HOVER_OPACITY) } else { t.error };
            (Some(fill), None, t.on_accent)
        }
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
        let fill = if selected {
            Some(t.select_bg)
        } else if response.enabled() && response.hovered() {
            Some(t.control_hover)
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
        let fill = if selected {
            Some(t.select_bg)
        } else if response.enabled() && response.hovered() {
            Some(t.control_hover)
        } else {
            None
        };
        if let Some(fill) = fill {
            ui.painter().rect_filled(rect, theme::RADIUS_CARD, fill);
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
/// control's edge and following its radius (§8).
fn focus_ring(ui: &Ui, response: &Response, radius: f32) {
    if !response.has_focus() || !response.rect.is_positive() {
        return;
    }
    let ring = response.rect.shrink(-theme::FOCUS_OUTLINE_OFFSET);
    ui.painter().rect_stroke(ring, radius, Stroke::new(theme::FOCUS_OUTLINE_W, Tokens::get().accent), StrokeKind::Outside);
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
}
