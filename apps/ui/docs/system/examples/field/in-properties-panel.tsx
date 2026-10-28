// Caption: The name row of the properties palette.
import { Field } from "../../../../src/ui/Field";

export default function InPropertiesPanel() {
  return (
    <div class="prop-row">
      <span class="prop-label">Name</span>
      <Field value="Bracket" ariaLabel="Name" onInput={() => undefined} />
    </div>
  );
}
