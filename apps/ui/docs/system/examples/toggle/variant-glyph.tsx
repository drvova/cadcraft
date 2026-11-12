// Caption: The glyph face: an icon for each state, the state in the glyph and its ink.
import { Toggle } from "../../../../src/ui/Toggle";

export default function VariantGlyph() {
  return <Toggle variant="glyph" pressed icon="layer.unlocked" iconOn="layer.locked" tone="caution" ariaLabel="Outline locked" hint="Unlock" />;
}
