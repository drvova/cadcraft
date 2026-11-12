// Caption: Objects that disagree: the placeholder in the quiet ink.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function Mixed() {
  return <Select mixed placeholder="*VARIES*" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
