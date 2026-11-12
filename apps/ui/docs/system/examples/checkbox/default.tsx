// Caption: An empty box with its label.
import { Checkbox } from "../../../../src/ui/Checkbox";

export default function Default() {
  return <Checkbox checked={false} onChange={() => undefined}>Snap to grid</Checkbox>;
}
