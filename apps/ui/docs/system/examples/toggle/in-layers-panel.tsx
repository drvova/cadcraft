// Caption: A layer row's three state keys: on, frozen, locked, each named for the layer and its flag.
import { Toggle } from "../../../../src/ui/Toggle";

export default function InLayersPanel() {
  return (
    <span class="layer-toggles">
      <Toggle size="sm" tone="absent" icon="layer.off" iconOn="layer.on" ariaLabel="Outline on" hint="Turn off" pressed />
      <Toggle size="sm" tone="info" icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Freeze" pressed={false} />
      <Toggle size="sm" tone="caution" icon="layer.unlocked" iconOn="layer.locked" ariaLabel="Outline locked" hint="Unlock" pressed />
    </span>
  );
}
