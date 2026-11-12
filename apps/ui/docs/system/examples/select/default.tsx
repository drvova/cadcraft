// Caption: A layer picked from four, in the field recipe.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function Default() {
  return <Select value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
