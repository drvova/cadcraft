// Caption: The form control, stroked and filled at rest.
import { Field } from "../../../../src/ui/Field";

export default function VariantField() {
  return <Field variant="field" value="llama3.2" ariaLabel="Model" onInput={() => undefined} />;
}
