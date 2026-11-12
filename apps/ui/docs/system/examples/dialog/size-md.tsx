// Caption: The default box, 76ch wide: one column of labelled fields.
import { Button } from "../../../../src/ui/Button";
import { Dialog } from "../../../../src/ui/Dialog";
import { Field } from "../../../../src/ui/Field";
import { Select } from "../../../../src/ui/Select";

const TYPES = [
  { value: "decimal", label: "Decimal" },
  { value: "architectural", label: "Architectural" },
  { value: "engineering", label: "Engineering" },
];

export default function SizeMd() {
  return (
    <Dialog
      open
      title="Drawing Units"
      size="md"
      onClose={() => undefined}
      footer={
        <>
          <Button>Cancel</Button>
          <Button variant="primary" type="submit">
            OK
          </Button>
        </>
      }
    >
      <p>
        <label for="units-type">Length type</label> <Select id="units-type" value="decimal" options={TYPES} onChange={() => undefined} />
      </p>
      <p>
        <label for="units-precision">Precision</label> <Field id="units-precision" value="4" inputMode="numeric" onInput={() => undefined} />
      </p>
    </Dialog>
  );
}
