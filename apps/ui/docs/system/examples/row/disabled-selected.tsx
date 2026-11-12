// Caption: A blocked current row with no fill, beside a blocked active option that keeps it.
import { Row } from "../../../../src/ui/Row";

export default function DisabledSelected() {
  return (
    <div>
      <Row selected disabled>Frozen layer</Row>
      <div role="listbox" aria-label="Commands">
        <Row option id="command-0" selected disabled>Hatch</Row>
        <Row option id="command-1">Line</Row>
      </div>
    </div>
  );
}
