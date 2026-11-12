// Caption: The status bar's drafting settings: words in a toolbar that is one Tab stop.
import { Toggle } from "../../../../src/ui/Toggle";

export default function InStatusBar() {
  return (
    <div class="status-toggles" role="toolbar" aria-label="Drafting settings">
      <Toggle variant="text" size="sm" ariaLabel="Grid" hint="Grid" shortcut="F7" placement="top" pressed>
        Grid
      </Toggle>
      <Toggle variant="text" size="sm" ariaLabel="Snap mode" hint="Snap mode" shortcut="F9" placement="top" pressed={false}>
        Snap
      </Toggle>
      <Toggle variant="text" size="sm" ariaLabel="Lineweight display" hint="Lineweight display" placement="top" pressed={false}>
        LW
      </Toggle>
    </div>
  );
}
