// Caption: The value ending on the arrow's side, as in a column of values.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function AlignEnd() {
  return <Select align="end" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
