// Caption: The 20px box of a 22px list row.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function SizeSm() {
  return <Select size="sm" value="walls" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />;
}
