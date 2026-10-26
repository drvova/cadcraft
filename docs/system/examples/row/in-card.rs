// Caption: A selected row inside a card.
widgets::card(ui, |ui| {
    let r = widgets::row(ui, selected);
    ui.painter().text(r.rect.left_center() + vec2(6.0, 0.0), egui::Align2::LEFT_CENTER, name, theme::body(), t.text);
});
