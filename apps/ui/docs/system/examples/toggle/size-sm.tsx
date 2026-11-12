// Caption: The 20 by 22 cell of a list row, with the 12px glyph.
import { Toggle } from "../../../../src/ui/Toggle";

export default function SizeSm() {
  return <Toggle size="sm" pressed={false} icon="layer.thawed" iconOn="layer.frozen" tone="info" ariaLabel="Outline frozen" hint="Freeze" />;
}
