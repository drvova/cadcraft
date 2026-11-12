// Caption: The hint over a control of a surface's own.
import { Tooltip } from "../../../../src/ui/Tooltip";

/** A fact of the status bar: the hint says what the number counts. Layer components need no wrapper. */
export default function Example() {
  return (
    <Tooltip text="Objects in the drawing" placement="top">
      <span class="status-item status-count">46 objects</span>
    </Tooltip>
  );
}
