// Caption: A row in a list, with its content painted into the rect.
let r = widgets::row(ui, false);
ui.painter().text(r.rect.left_center() + vec2(6.0, 0.0), egui::Align2::LEFT_CENTER, name, theme::body(), t.text);
