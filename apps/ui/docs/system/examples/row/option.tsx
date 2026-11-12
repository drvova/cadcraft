// Caption: Options of a listbox a search field drives: one lit, none a Tab stop.
import { Row } from "../../../../src/ui/Row";

export default function Option() {
  return (
    <div role="listbox" aria-label="Commands">
      <Row option id="command-0" onClick={() => undefined}>Line</Row>
      <Row option id="command-1" selected onClick={() => undefined}>Circle</Row>
      <Row option id="command-2" disabled>Hatch</Row>
    </div>
  );
}
