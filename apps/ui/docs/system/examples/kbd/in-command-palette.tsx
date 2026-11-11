// Caption: A shortcut cap at the end of a palette row.
import { Kbd } from "../../../../src/ui/Kbd";
import { Row } from "../../../../src/ui/Row";

export default function InCommandPalette() {
  return (
    <div class="palette-list" role="listbox" aria-label="Commands">
      <Row onClick={() => undefined}>
        <span class="palette-label">Save</span>
        <span class="palette-trail">
          <Kbd>Ctrl+S</Kbd>
        </span>
      </Row>
    </div>
  );
}
