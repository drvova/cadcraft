// Caption: A labelled field inside a card.
widgets::card(ui, |ui| {
    widgets::section_label(ui, "Model");
    widgets::field(ui, &mut model, "claude-opus-4");
});
