// Caption: The text face: a word in capitals, on with the full ink over the on-colour rule.
import { Toggle } from "../../../../src/ui/Toggle";

export default function VariantText() {
  return (
    <Toggle variant="text" pressed ariaLabel="Grid" hint="Grid" shortcut="F7">
      Grid
    </Toggle>
  );
}
