// Caption: The 24px control, with the 14px glyph.
import { Toggle } from "../../../../src/ui/Toggle";

export default function SizeMd() {
  return <Toggle size="md" pressed={false} icon="eye-off" iconOn="eye" ariaLabel="Preview" hint="Show the preview" />;
}
