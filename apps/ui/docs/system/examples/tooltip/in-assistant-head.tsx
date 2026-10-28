// Caption: The hint in the pane's header.
import { Tooltip } from "../../../../src/ui/Tooltip";
import { IconButton } from "../../../../src/ui/IconButton";

/** The pane's header: the icon button with its own name, wrapped for the hover hint. */
export default function InAssistantHead() {
  return (
    <Tooltip text="New chat">
      <IconButton icon="plus" aria-label="New chat" />
    </Tooltip>
  );
}
