// Caption: A yes-or-no row of the properties palette, named by `ariaLabel`.
import { Checkbox } from "../../../../src/ui/Checkbox";

export default function InPropertiesPanel() {
  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label">Closed</span>
      <span class="prop-value">
        <Checkbox ariaLabel="Closed" checked onChange={() => undefined} />
      </span>
    </div>
  );
}
