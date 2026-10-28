// Caption: A menu item inside an open menu.
import { Row } from "../../../../src/ui/Row";

export default function InMenuBar() {
  return (
    <div class="menu-drop">
      <Row onClick={() => undefined}>Save<span class="row-shortcut">Ctrl+S</span></Row>
      <Row onClick={() => undefined}>Save as…</Row>
    </div>
  );
}
