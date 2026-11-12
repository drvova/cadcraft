// Caption: Menu rows inside an open menu, with the typed name and the shortcut after the label.
import { Row } from "../../../../src/ui/Row";

export default function InMenuBar() {
  return (
    <div class="menu-drop" role="menu" aria-label="File">
      <div class="menu-item" role="none">
        <Row menuitem describedBy="save-name" onClick={() => undefined}>
          <span class="menu-label">Save</span>
          <span class="menu-name" aria-hidden="true"><span>QSAVE</span></span>
          <span id="save-name" hidden>Type QSAVE</span>
          <span class="menu-shortcut">Ctrl+S</span>
        </Row>
      </div>
      <div class="menu-item" role="none">
        <Row menuitem onClick={() => undefined}>
          <span class="menu-label">Save As...</span>
        </Row>
      </div>
    </div>
  );
}
