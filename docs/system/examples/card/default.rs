// Caption: A card holding a field.
widgets::card(ui, |ui| {
    widgets::section_label(ui, "Provider");
    widgets::field(ui, &mut provider, "Other (OpenAI-compatible)");
});
