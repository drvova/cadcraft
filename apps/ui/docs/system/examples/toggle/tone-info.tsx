// Caption: Info: on is a fact to notice, in the frozen ink.
import { Toggle } from "../../../../src/ui/Toggle";

export default function ToneInfo() {
  return <Toggle tone="info" size="sm" pressed icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Thaw" />;
}
