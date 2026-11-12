// Caption: A value in a list row: text until it is touched.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function VariantInline() {
  return <Select variant="inline" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
