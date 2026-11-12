// Caption: `TabPanels`: a strip of compact tabs over the panels they show, one Tab stop, walked with the arrow keys.
import { createSignal } from "solid-js";
import { TabPanels } from "../../../../src/ui/Tab";

export default function InTabPanels() {
  const [page, setPage] = createSignal("snap-grid");
  return (
    <TabPanels
      ariaLabel="Drafting settings"
      selected={page()}
      onChange={setPage}
      panels={[
        { id: "snap-grid", label: "Snap and Grid", content: () => <p>The snap and grid spacing.</p> },
        { id: "polar", label: "Polar Tracking", content: () => <p>The increment angle.</p> },
        { id: "osnap", label: "Object Snap", content: () => <p>The running object snaps.</p> },
      ]}
    />
  );
}
