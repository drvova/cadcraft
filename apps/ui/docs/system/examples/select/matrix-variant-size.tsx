// Caption: Both looks at both sizes.
import { Select } from "../../../../src/ui/Select";

const LAYERS = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "doors", label: "Doors" },
  { value: "furniture", label: "Furniture" },
];

export default function MatrixVariantSize() {
  return (
    <div>
      <Select variant="field" size="md" value="walls" options={LAYERS} ariaLabel="Layer, field, md" onChange={() => undefined} />
      <Select variant="field" size="sm" value="walls" options={LAYERS} ariaLabel="Layer, field, sm" onChange={() => undefined} />
      <Select variant="inline" size="md" value="walls" options={LAYERS} ariaLabel="Layer, inline, md" onChange={() => undefined} />
      <Select variant="inline" size="sm" value="walls" options={LAYERS} ariaLabel="Layer, inline, sm" onChange={() => undefined} />
    </div>
  );
}
