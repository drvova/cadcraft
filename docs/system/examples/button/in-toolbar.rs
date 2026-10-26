// Caption: A ghost button beside an icon button on the tool bar.
if widgets::button(ui, "Publish", widgets::Kind::Ghost).clicked() {
    publish();
}
if widgets::icon_button(ui, icons::Icon::Share, 26.0, "Share", false).clicked() {
    share();
}
