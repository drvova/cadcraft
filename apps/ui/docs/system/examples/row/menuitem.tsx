// Caption: Rows of a menu: one that runs, one that is not available, one that opens a submenu; none a Tab stop.
import { Row } from "../../../../src/ui/Row";

export default function Menuitem() {
  return (
    <div role="menu" aria-label="Edit">
      <Row menuitem onClick={() => undefined} onKeyDown={() => undefined}>Undo</Row>
      <Row menuitem disabled onKeyDown={() => undefined}>Paste</Row>
      <Row menuitem popup="menu" expanded={false} onPointerEnter={() => undefined}>Clipboard</Row>
    </div>
  );
}
