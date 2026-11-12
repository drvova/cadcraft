// Caption: A column of numbers ending on one edge.
import { Field } from "../../../../src/ui/Field";

export default function AlignEnd() {
  return <Field align="end" variant="inline" size="sm" value="12.5" ariaLabel="Radius" inputMode="decimal" onInput={() => undefined} />;
}
