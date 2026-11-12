// Caption: The form control: stroked and filled at rest.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function VariantField() {
  return <Select variant="field" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
