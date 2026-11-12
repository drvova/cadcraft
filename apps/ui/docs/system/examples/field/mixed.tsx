// Caption: A value several objects disagree on, in the quiet ink.
import { Field } from "../../../../src/ui/Field";

export default function Mixed() {
  return <Field mixed variant="inline" size="sm" align="end" value="*VARIES*" ariaLabel="Radius" onInput={() => undefined} />;
}
