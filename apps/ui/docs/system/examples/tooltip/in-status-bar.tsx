// Caption: A status-bar fact whose hint opens above it, with a key as a cap.
import { Tooltip } from "../../../../src/ui/Tooltip";

/**
 * At the window's foot the box has no room below and opens above by itself; `placement="top"`
 * only says so up front. The shortcut is passed by itself and drawn as a key cap, never written
 * into the text in brackets.
 */
export default function InStatusBar() {
  return (
    <Tooltip text="Snap Mode" shortcut="F9" placement="top">
      <span class="status-item">Snap on</span>
    </Tooltip>
  );
}
