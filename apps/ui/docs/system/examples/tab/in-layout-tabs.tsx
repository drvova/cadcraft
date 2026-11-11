// Caption: The layout strip over the drawing: Model in front, two layouts behind.
import { Tab } from "../../../../src/ui/Tab";

export default function InLayoutTabs() {
  return (
    <div class="editor-tabs" role="tablist" aria-label="Layouts">
      <Tab selected title="Switch to model space">Model</Tab>
      <Tab title="Switch to Layout1">Layout1</Tab>
      <Tab title="Switch to Layout2">Layout2</Tab>
    </div>
  );
}
