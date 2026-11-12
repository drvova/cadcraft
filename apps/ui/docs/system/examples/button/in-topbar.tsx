// Caption: A small button in the top bar's action row.
import { Button } from "../../../../src/ui/Button";

export default function InTopBar() {
  return (
    <div class="topbar-row">
      <Button size="sm" title="Fit the whole drawing in the window">Zoom extents</Button>
    </div>
  );
}
