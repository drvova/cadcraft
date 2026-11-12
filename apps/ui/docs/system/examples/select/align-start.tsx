// Caption: The value on the leading side, as in a form.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function AlignStart() {
  return <Select align="start" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
