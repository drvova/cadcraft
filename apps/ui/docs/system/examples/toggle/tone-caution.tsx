// Caption: Caution: on blocks something, in the locked ink.
import { Toggle } from "../../../../src/ui/Toggle";

export default function ToneCaution() {
  return <Toggle tone="caution" size="sm" pressed icon="layer.unlocked" iconOn="layer.locked" ariaLabel="Outline locked" hint="Unlock" />;
}
