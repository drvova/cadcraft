// Caption: The 24px box, a Field's height.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function SizeMd() {
  return <Select size="md" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
