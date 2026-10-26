// Caption: A primary button in a dialog footer.
// The dialog owns the layout; the widget owns the chrome.
if widgets::button(ui, "Save", widgets::Kind::Primary).clicked() {
    save();
}
