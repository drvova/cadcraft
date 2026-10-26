// Caption: A status chip beside a section label in a card.
widgets::card(ui, |ui| {
    ui.horizontal(|ui| {
        widgets::section_label(ui, "Model");
        widgets::chip(ui, "ON", widgets::ChipKind::Accent);
    });
});
