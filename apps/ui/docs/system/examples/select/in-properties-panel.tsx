// Caption: The layer row of the properties palette.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function InPropertiesPanel() {
  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label">Layer</span>
      <span class="prop-value">
        <Select variant="inline" size="sm" align="end" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />
      </span>
    </div>
  );
}
