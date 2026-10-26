// Caption: A card at the top of a side panel.
egui::SidePanel::right("properties").show(ctx, |ui| {
    widgets::card(ui, |ui| {
        widgets::section_label(ui, "Model");
    });
});
