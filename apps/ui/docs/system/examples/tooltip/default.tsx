// Caption: The hint over an icon button.
import { Tooltip } from "../../../../src/ui/Tooltip";
import { IconButton } from "../../../../src/ui/IconButton";

/** The hover hint over an icon-only control (the tooltip host keeps the button a button). */
export default function Example() {
  return (
    <Tooltip text="Close the panel">
      <IconButton icon="close" title="Close the panel" />
    </Tooltip>
  );
}
