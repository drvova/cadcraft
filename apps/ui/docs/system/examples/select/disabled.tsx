// Caption: A locked choice at the disabled ink.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function Disabled() {
  return <Select value="walls" options={LAYERS} ariaLabel="Layer" disabled />;
}
