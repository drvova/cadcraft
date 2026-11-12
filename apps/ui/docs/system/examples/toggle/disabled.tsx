// Caption: A blocked toggle at the disabled ink, still focusable, saying why.
import { Toggle } from "../../../../src/ui/Toggle";

/** Disabled, and still reachable: the hint says what a press would do and `description` why it cannot. */
export default function Disabled() {
  return <Toggle pressed={false} disabled size="sm" tone="info" icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Freeze" description="The current layer cannot be frozen" />;
}
