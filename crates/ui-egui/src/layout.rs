//! The layout kit: the Cursor-shaped layout primitives egui lacks. A row and a column with a
//! real gap, space-between, equal columns, the inspector's label/field row, a draggable split,
//! surfaces on an elevation ladder, a divider, a panel section, a sticky header and a scroll
//! area's edge fade — so a surface writes a few lines instead of hand-mathing rectangles and
//! scattering `add_space` calls (122 `ui.horizontal`, 105 `add_space`, 29 `Grid::new` and 89
//! `rect_filled` at the triage, `.design-system/boss/triage/inventory.md` §4).
//!
//! Rules every helper keeps:
//!
//! - Gaps, radii and hairlines come from [`crate::theme`] constants, never literals.
//! - A helper works inside any [`egui::Ui`] and does not leak what it sets: the spacing it
//!   changes is saved and restored before it returns.
//! - Sizes that must be exact are measured from the available width, not from egui's
//!   auto-sizing: equal columns stay equal whatever their contents do.
//! - Hostile input clamps instead of panicking: a `NaN` or out-of-range fraction, a zero column
//!   count, a `NaN` height and a view too small for anything all fall back to a sane layout.

use egui::{
    Align, Color32, CornerRadius, CursorIcon, FontId, Id, LayerId, Layout, Order, Rect, RichText, Sense, Stroke, Ui, UiBuilder, Vec2, pos2, vec2,
};

use crate::theme::{self, Tokens};

/// The elevation of a surface: [`Elev::Flat`] and [`Elev::Panel`] sit on the panel, [`Elev::Float`]
/// takes the composer's measured shadow and [`Elev::Popover`] the popup's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Elev {
    Flat,
    Panel,
    Float,
    Popover,
}

impl Elev {
    /// The rung's surface fill: the panel base, the raised content surface, and the menu surface
    /// the floating rungs share.
    fn fill(self) -> Color32 {
        let t = Tokens::get();
        match self {
            Self::Flat => t.panel,
            Self::Panel => t.field,
            Self::Float | Self::Popover => t.list_bg,
        }
    }

    /// The rung's shadow: none for the flat rungs; the composer's measured `0 0 4px 1px`
    /// (`.cursor-composer`'s `box-shadow`, [`theme::BAR_SHADOW`]) for a float; and the popup's
    /// `0 4px 12px` (`theme::visuals`' `popup_shadow`) for a popover. Blur and spread are the
    /// theme's spacing ladder rungs the two recipes measure.
    fn shadow(self) -> Option<egui::epaint::Shadow> {
        match self {
            Self::Flat | Self::Panel => None,
            Self::Float => {
                Some(egui::epaint::Shadow { offset: [0, 0], blur: theme::GAP_4 as u8, spread: theme::HAIRLINE as u8, color: theme::BAR_SHADOW })
            }
            Self::Popover => {
                Some(egui::epaint::Shadow { offset: [0, theme::GAP_4 as i8], blur: theme::GAP_12 as u8, spread: 0, color: theme::BAR_SHADOW })
            }
        }
    }
}

/// A finite, non-negative gap: `NaN` and infinite values become zero, negatives clamp to zero,
/// so a hostile number can never poison a layout.
fn clamped_gap(value: f32) -> f32 {
    if value.is_finite() { value.max(0.0) } else { 0.0 }
}

/// A row whose children are `gap` apart: `ui.horizontal` with the item spacing set locally, so
/// the caller writes no `add_space` calls. The previous spacing is restored before returning.
pub fn row(ui: &mut Ui, gap: f32, add: impl FnOnce(&mut Ui)) {
    let gap = clamped_gap(gap);
    let previous = ui.spacing().item_spacing.x;
    ui.spacing_mut().item_spacing.x = gap;
    let _ = ui.horizontal(add);
    ui.spacing_mut().item_spacing.x = previous;
}

/// A column whose children are `gap` apart: `ui.vertical` with the item spacing set locally, and
/// restored before returning.
pub fn col(ui: &mut Ui, gap: f32, add: impl FnOnce(&mut Ui)) {
    let gap = clamped_gap(gap);
    let previous = ui.spacing().item_spacing.y;
    ui.spacing_mut().item_spacing.y = gap;
    let _ = ui.vertical(add);
    ui.spacing_mut().item_spacing.y = previous;
}

/// Space-between: the left group hugs the left edge of the row, the right group the right edge.
/// The row is a normal `ui.horizontal` (so it takes the standard row height and advances the
/// caller's cursor), and the right group lives in a right-to-left child that sees the row's full
/// width — both groups stay on the row's one line.
pub fn spread(ui: &mut Ui, add: impl FnOnce(&mut Ui, &mut Ui)) {
    let _ = ui.horizontal(|ui| {
        let mut right = ui.new_child(UiBuilder::new().max_rect(ui.max_rect()).layout(Layout::right_to_left(Align::Center)));
        add(ui, &mut right);
        ui.advance_cursor_after_rect(right.min_rect());
    });
}

/// `n` equal columns, `gap` apart, each with the same width whatever its contents: the width is
/// measured from the available width (not from `ui.horizontal`'s auto-sizing), every column is
/// clipped to its own rect, and the last column ends at the right edge. `n == 0` draws nothing.
pub fn columns(ui: &mut Ui, n: usize, gap: f32, mut add: impl FnMut(usize, &mut Ui)) {
    if n == 0 {
        return;
    }
    let gap = clamped_gap(gap);
    let total = ui.available_width().max(0.0);
    let width = ((total - gap * (n as f32 - 1.0)) / n as f32).max(0.0);
    let top_left = ui.cursor().min;
    let bottom = ui.max_rect().bottom().max(top_left.y);
    let mut columns: Vec<Ui> = (0..n)
        .map(|i| {
            let left = top_left.x + i as f32 * (width + gap);
            let rect = Rect::from_min_max(pos2(left, top_left.y), pos2(left + width, bottom));
            let mut column = ui.new_child(UiBuilder::new().max_rect(rect).layout(Layout::top_down(Align::LEFT)));
            column.set_width(width);
            column.set_clip_rect(rect.intersect(column.clip_rect()));
            column
        })
        .collect();
    for (i, column) in columns.iter_mut().enumerate() {
        add(i, column);
    }
    let height = columns.iter().fold(0.0_f32, |height, column| height.max(column.min_rect().height()));
    ui.advance_cursor_after_rect(Rect::from_min_size(top_left, vec2(total, height)));
}

/// The inspector form row everyone hand-rolls (`palettes.rs`'s `prop_row`): a right-aligned
/// label in a cell exactly `label_w` wide, [`theme::GAP_6`] later the field, which gets the rest
/// of the width. The label is a layout box with a Label node, and it names the inputs `add`
/// creates. A `label_w` wider than the row leaves the field a zero-width cell rather than
/// overlapping it.
pub fn field(ui: &mut Ui, label: &str, label_w: f32, add: impl FnOnce(&mut Ui)) {
    let t = Tokens::get();
    let total = ui.available_width().max(0.0);
    let label_w = clamped_gap(label_w).min((total - theme::GAP_6).max(0.0));
    let _ = ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = theme::GAP_6;
        let wrap = if label_w > 0.0 { label_w } else { f32::INFINITY };
        let job = egui::text::LayoutJob::simple(crate::i18n::t(label).to_string(), theme::body(), t.text_dim, wrap);
        let galley = ui.painter().layout_job(job);
        let height = galley.size().y.max(theme::CONTROL_H_ROW);
        let (label_rect, label_response) = ui.allocate_exact_size(vec2(label_w, height), Sense::hover());
        label_response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Label, ui.is_enabled(), crate::i18n::t(label)));
        ui.painter().galley(pos2(label_rect.right() - galley.size().x, label_rect.center().y - galley.size().y * 0.5), galley, t.text_dim);
        let rest = ui.available_width().max(0.0);
        ui.label_inputs_by(label_response.id, |ui| {
            let _ = ui.allocate_ui_with_layout(vec2(rest, height), Layout::top_down(Align::LEFT), |ui| {
                ui.set_width(rest);
                add(ui);
            });
        });
    });
}

/// A draggable split: `fraction` (0..1) is the first pane's share, persisted by the caller, and
/// `min` is the smallest share either pane may take. The panes fill the available width — a
/// hairline handle straddles their boundary, taking the accent while it is dragged — and a
/// hostile `fraction` (`NaN`, below `min`, above `1 - min`) is clamped into `min ..= 1 - min`.
/// The panes are clipped to their own rects, so neither paints over the other.
pub fn split(ui: &mut Ui, id: Id, fraction: &mut f32, min: f32, add: impl FnOnce(&mut Ui, &mut Ui)) {
    let t = Tokens::get();
    let total = ui.available_width().max(0.0);
    let top = ui.cursor().min;
    let bottom = ui.max_rect().bottom().max(top.y);
    let low = clamped_gap(min).min(0.5);
    let high = 1.0 - low;
    let share = if fraction.is_finite() { (*fraction).clamp(low, high) } else { low };
    *fraction = share;
    let first_width = total * share;
    let second_width = total - first_width;
    let mut first =
        ui.new_child(UiBuilder::new().max_rect(Rect::from_min_max(top, pos2(top.x + first_width, bottom))).layout(Layout::top_down(Align::LEFT)));
    first.set_width(first_width);
    first.set_clip_rect(first.max_rect().intersect(first.clip_rect()));
    let mut second = ui.new_child(
        UiBuilder::new()
            .max_rect(Rect::from_min_max(pos2(top.x + first_width, top.y), pos2(top.x + total, bottom)))
            .layout(Layout::top_down(Align::LEFT)),
    );
    second.set_width(second_width);
    second.set_clip_rect(second.max_rect().intersect(second.clip_rect()));
    add(&mut first, &mut second);
    let height = first.min_rect().height().max(second.min_rect().height());
    let handle_x = top.x + first_width;
    let grab = theme::GAP_8 * 0.5;
    let handle = Rect::from_min_max(pos2(handle_x - grab, top.y), pos2(handle_x + grab, top.y + height));
    let response = ui.interact(handle, id, Sense::click_and_drag());
    if response.hovered() || response.dragged() {
        ui.ctx().set_cursor_icon(CursorIcon::ResizeHorizontal);
    }
    if response.dragged()
        && total > 0.0
        && let Some(pointer) = response.interact_pointer_pos()
    {
        *fraction = ((pointer.x - top.x) / total).clamp(low, high);
    }
    let line = if response.dragged() { t.accent } else { t.border };
    ui.painter().line_segment([pos2(handle_x, top.y), pos2(handle_x, top.y + height)], Stroke::new(theme::HAIRLINE, line));
    ui.advance_cursor_after_rect(Rect::from_min_size(top, vec2(total, height)));
}

/// A surface: the elevation's fill, a [`theme::HAIRLINE`] border, [`theme::RADIUS_CARD`] corners
/// and [`theme::CARD_PADDING`] of inner padding, with the rung's shadow. Returns the surface's
/// outer rect; the content is inset from it by the padding plus the hairline.
pub fn card(ui: &mut Ui, elev: Elev, add: impl FnOnce(&mut Ui)) -> Rect {
    let t = Tokens::get();
    let mut frame = egui::Frame::NONE
        .fill(elev.fill())
        .stroke(Stroke::new(theme::HAIRLINE, t.border))
        .corner_radius(theme::RADIUS_CARD)
        .inner_margin(theme::CARD_PADDING);
    if let Some(shadow) = elev.shadow() {
        frame = frame.shadow(shadow);
    }
    frame.show(ui, add).response.rect
}

/// A hairline rule across the available width, with [`theme::GAP_DEFAULT`] above and below, in
/// [`Tokens::border`].
pub fn divider(ui: &mut Ui) {
    let t = Tokens::get();
    ui.add_space(theme::GAP_DEFAULT);
    let width = ui.available_width().max(0.0);
    let (rect, _) = ui.allocate_exact_size(vec2(width, theme::HAIRLINE), Sense::hover());
    ui.painter().line_segment([rect.left_center(), rect.right_center()], Stroke::new(theme::HAIRLINE, t.border));
    ui.add_space(theme::GAP_DEFAULT);
}

/// A panel section: a rule across the top, then the title in `widgets::section_label`'s recipe
/// (12-point, [`Tokens::text_faint`], sentence case), then the content.
pub fn section(ui: &mut Ui, title: &str, add: impl FnOnce(&mut Ui)) {
    let t = Tokens::get();
    divider(ui);
    ui.label(RichText::new(crate::i18n::t(title)).font(FontId::proportional(theme::FONT_LABEL)).color(t.text_faint));
    ui.add_space(theme::GAP_DEFAULT);
    add(ui);
}

/// A sticky header inside a `ScrollArea`: the slot is reserved where the header belongs in the
/// flow, and the header itself is painted pinned to the top of the visible area (the `Ui`'s clip
/// rect) whenever that slot has scrolled above it, on [`Tokens::panel`] so the content scrolling
/// under it never shows through. It is painted in a non-area `Order::Middle` layer, so it covers
/// the content under it while the scroll area keeps its hover — and its wheel — over the header.
pub fn sticky(ui: &mut Ui, h: f32, add: impl FnOnce(&mut Ui)) {
    let t = Tokens::get();
    let h = clamped_gap(h);
    let width = ui.available_width().max(0.0);
    let (slot, _) = ui.allocate_exact_size(vec2(width, h), Sense::hover());
    let clip = ui.clip_rect();
    let top = slot.top().max(clip.top());
    let rect = Rect::from_min_size(pos2(slot.left(), top), vec2(width, h));
    let layer = LayerId::new(Order::Middle, ui.scope_id().with("sticky"));
    let mut header = ui.new_child(UiBuilder::new().max_rect(rect).layer_id(layer).layout(Layout::left_to_right(Align::Center)));
    header.set_clip_rect(rect.intersect(header.clip_rect()));
    header.painter().rect_filled(rect, CornerRadius::ZERO, t.panel);
    let _ = header.interact(rect, header.scope_id().with("band"), Sense::hover());
    add(&mut header);
}

/// The fade at a scroll area's edges (Cursor has one): an opaque band at the edge that fades to
/// nothing over [`theme::GAP_12`], drawn on [`Tokens::panel`]. Call it inside the scroll area,
/// after its content — the viewport is the `Ui`'s clip rect and the content extent is its
/// `min_rect` — with the id the `ScrollArea` derived: compute it on the `Ui` that hosts the
/// scroll area (`let id = ui.make_persistent_id(egui::IdSalt::new("list"));`) and give the
/// scroll area the same salt (`.id_salt(egui::IdSalt::new("list"))`). It draws nothing when the
/// content has no overflow, and nothing beyond a hairline of it.
pub fn edge_fade(ui: &mut Ui, scroll_id: Id) {
    let viewport = ui.clip_rect();
    if !viewport.is_positive() {
        return;
    }
    let content = ui.min_rect();
    let offset = egui::scroll_area::State::load(ui.ctx(), scroll_id).map_or(Vec2::ZERO, |state| state.clamped_offset());
    let hidden_above = offset.y;
    let hidden_below = content.height() - viewport.height() - offset.y;
    if hidden_above <= theme::HAIRLINE && hidden_below <= theme::HAIRLINE {
        return;
    }
    let band = theme::GAP_12.min(viewport.height() * 0.5);
    if band <= 0.0 {
        return;
    }
    let fill = Tokens::get().panel;
    if hidden_above > theme::HAIRLINE {
        fade(ui, Rect::from_min_max(pos2(viewport.left(), viewport.top()), pos2(viewport.right(), viewport.top() + band)), true, fill);
    }
    if hidden_below > theme::HAIRLINE {
        fade(ui, Rect::from_min_max(pos2(viewport.left(), viewport.bottom() - band), pos2(viewport.right(), viewport.bottom())), false, fill);
    }
}

/// One fade band: opaque at the scroll area's edge, transparent at the inner end.
fn fade(ui: &Ui, rect: Rect, at_top: bool, color: Color32) {
    let clear = color.linear_multiply(0.0);
    let (outer, inner) = if at_top { (color, clear) } else { (clear, color) };
    let mut mesh = egui::epaint::Mesh::default();
    mesh.colored_vertex(rect.left_top(), outer);
    mesh.colored_vertex(rect.right_top(), outer);
    mesh.colored_vertex(rect.left_bottom(), inner);
    mesh.colored_vertex(rect.right_bottom(), inner);
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(1, 3, 2);
    ui.painter().add(egui::Shape::mesh(mesh));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One headless frame over `size`, the crate's `run_ui` pattern.
    fn frame(size: Vec2, f: impl FnMut(&mut Ui)) -> egui::FullOutput {
        let ctx = egui::Context::default();
        let input = egui::RawInput { screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), size)), ..Default::default() };
        let mut output = ctx.run_ui(input, f);
        output.textures_delta.clear();
        output
    }

    /// 1. Three equal columns: 300 wide, gap 6, each column exactly 96; the last ends at 300.
    #[test]
    fn columns_are_equal_and_reach_the_right_edge() {
        let mut widths = Vec::new();
        let mut row_left = 0.0;
        let mut last_right = 0.0;
        frame(vec2(300.0, 200.0), |ui| {
            row_left = ui.cursor().min.x;
            columns(ui, 3, 6.0, |i, column| {
                widths.push(column.max_rect().width());
                if i == 2 {
                    last_right = column.max_rect().right();
                }
            });
        });
        assert_eq!(widths, vec![96.0, 96.0, 96.0], "each column is (300 - 2*6) / 3");
        assert_eq!(last_right - row_left, 300.0, "the last column ends at the edge");
    }

    /// 2. The field row: the label column is exactly `label_w`, and the field gets the rest.
    #[test]
    fn field_gives_the_label_exactly_label_w() {
        let label_w = 100.0;
        let mut row_left = 0.0;
        let mut field_rect = None;
        frame(vec2(300.0, 200.0), |ui| {
            row_left = ui.cursor().min.x;
            field(ui, "Width", label_w, |ui| field_rect = Some(ui.max_rect()));
        });
        let field_rect = field_rect.expect("the field cell runs");
        assert_eq!(field_rect.left() - row_left, label_w + theme::GAP_6, "the label column is exactly label_w, then the gap");
        assert_eq!(field_rect.width(), 300.0 - label_w - theme::GAP_6, "the field gets the rest of the row");
    }

    /// 3. A hostile fraction clamps into `min ..= 1 - min`; the panes sum to the available width.
    #[test]
    fn split_clamps_a_hostile_fraction() {
        let total = 300.0;
        for (input, expected) in [(f32::NAN, 0.25), (-1.0, 0.25), (2.0, 0.75), (0.5, 0.5)] {
            let mut fraction = input;
            let mut panes = Vec::new();
            frame(vec2(total, 200.0), |ui| {
                split(ui, Id::unique("split-test"), &mut fraction, 0.25, |first, second| {
                    panes.push(first.max_rect().width());
                    panes.push(second.max_rect().width());
                });
            });
            assert_eq!(fraction, expected, "{input} clamps into min ..= 1 - min");
            assert_eq!(panes.iter().sum::<f32>(), total, "the panes fill the available width");
            assert_eq!(panes[0], total * expected, "the first pane is the clamped share");
        }
    }

    /// 4. The card: the content is inset by the padding, and the surface is the content plus it.
    #[test]
    fn card_insets_its_content_by_the_padding() {
        let mut outer = None;
        let mut content = None;
        frame(vec2(400.0, 300.0), |ui| {
            outer = Some(card(ui, Elev::Panel, |ui| {
                let (rect, _) = ui.allocate_exact_size(vec2(120.0, 40.0), Sense::hover());
                content = Some(rect);
            }));
        });
        let outer = outer.expect("the card paints");
        let content = content.expect("the card's content runs");
        let inset = theme::CARD_PADDING + theme::HAIRLINE;
        assert_eq!(content.left() - outer.left(), inset, "the content is inset by the padding plus the surface hairline");
        assert_eq!(outer.height(), content.height() + 2.0 * inset, "the surface is the content plus the padding");
    }

    /// 5. Every helper runs on an empty `Ui` — and on a view too small for anything, with hostile
    ///    values — without panicking.
    #[test]
    fn every_helper_runs_on_an_empty_ui() {
        let mut fraction = 0.5;
        frame(vec2(320.0, 240.0), |ui| {
            row(ui, theme::GAP_4, |_| {});
            col(ui, theme::GAP_4, |_| {});
            spread(ui, |_, _| {});
            columns(ui, 0, theme::GAP_4, |_, _| {});
            columns(ui, 3, theme::GAP_4, |_, _| {});
            field(ui, "Width", 80.0, |_| {});
            split(ui, Id::unique("empty-split"), &mut fraction, 0.2, |_, _| {});
            card(ui, Elev::Flat, |_| {});
            divider(ui);
            section(ui, "Section", |_| {});
            sticky(ui, 24.0, |_| {});
            edge_fade(ui, Id::unique("no-scroll-area"));
        });
        frame(vec2(4.0, 4.0), |ui| {
            columns(ui, 3, theme::GAP_12, |_, _| {});
            field(ui, "Width", 400.0, |_| {});
            let mut hostile = f32::NAN;
            split(ui, Id::unique("tiny-split"), &mut hostile, 0.3, |_, _| {});
            sticky(ui, f32::NAN, |_| {});
            edge_fade(ui, Id::unique("no-scroll-area"));
        });
    }

    /// The sticky header covers the content under it without becoming an area: the pointer goes
    /// through to the scroll area, whose hover — and so its wheel — still works over the header.
    #[test]
    fn sticky_keeps_the_scroll_area_hover() {
        let mut center = None;
        let mut under = None;
        frame(vec2(320.0, 240.0), |ui| {
            sticky(ui, 24.0, |ui| {
                ui.label("Header");
                center = Some(ui.max_rect().center());
            });
            under = ui.ctx().layer_id_at(center.expect("the header rect is known"));
        });
        assert_eq!(under, Some(egui::LayerId::background()), "the sticky layer is not hit-testable as an area");
    }

    /// The edge fade draws a band only when the scroll area really overflows.
    #[test]
    fn edge_fade_draws_only_when_the_scroll_area_overflows() {
        assert!(fade_meshes(40) >= 1, "content taller than the viewport gets a fade");
        assert_eq!(fade_meshes(2), 0, "content that fits draws nothing");
    }

    /// The meshes one frame paints with `rows` labels in a 200×100 scroll area.
    fn fade_meshes(rows: usize) -> usize {
        let ctx = egui::Context::default();
        let input = egui::RawInput { screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(200.0, 100.0))), ..Default::default() };
        let mut output = ctx.run_ui(input, |ui| {
            let id = ui.make_persistent_id(egui::IdSalt::new("fade"));
            egui::ScrollArea::vertical().id_salt(egui::IdSalt::new("fade")).show(ui, |ui| {
                for i in 0..rows {
                    ui.label(format!("row {i}"));
                }
                edge_fade(ui, id);
            });
        });
        let meshes = output.shapes.iter().map(|clipped| mesh_count(&clipped.shape)).sum();
        output.textures_delta.clear();
        meshes
    }

    /// The meshes in one shape, including the ones nested in a `Shape::Vec`.
    fn mesh_count(shape: &egui::Shape) -> usize {
        match shape {
            egui::Shape::Mesh(_) => 1,
            egui::Shape::Vec(shapes) => shapes.iter().map(mesh_count).sum(),
            _ => 0,
        }
    }
}
