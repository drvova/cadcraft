// Caption: A text field with a placeholder and a name.
import { Field } from "../../../../src/ui/Field";

export default function Default() {
  return <Field value="" placeholder="0,0" ariaLabel="Base point" onInput={() => undefined} />;
}
