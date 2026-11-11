// Caption: The compact tab of a pane header, with its close key.
import { Tab } from "../../../../src/ui/Tab";

export default function SizeSm() {
  return (
    <Tab size="sm" title="Summarise the layers" onClose={() => undefined} closeLabel="Close Summarise the layers">
      Summarise the layers
    </Tab>
  );
}
