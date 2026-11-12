// Caption: Absent: on is the ordinary state and stays quiet; off takes the ink.
import { Toggle } from "../../../../src/ui/Toggle";

export default function ToneAbsent() {
  return <Toggle tone="absent" size="sm" pressed={false} icon="layer.off" iconOn="layer.on" ariaLabel="Outline on" hint="Turn on" />;
}
