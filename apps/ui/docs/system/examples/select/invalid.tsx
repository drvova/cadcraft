// Caption: A refused choice at the error stroke, with the line that says why.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function Invalid() {
  return (
    <div>
      <Select value="furniture" options={LAYERS} ariaLabel="Layer" invalid describedBy="layer-error" onChange={() => undefined} />
      <span id="layer-error">Furniture is locked. Pick a layer that takes new objects.</span>
    </div>
  );
}
