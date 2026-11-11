// Caption: The full text of a clipped chat title.
import { Tooltip } from "../../../../src/ui/Tooltip";

/** The pane's header: a title that clips keeps its full text in the hint, on hover and on focus. */
export default function InAssistantHead() {
  const title = "Summarise the layers and count the objects on each";
  return (
    <Tooltip text={title} placement="bottom">
      <span class="assistant-title">{title}</span>
    </Tooltip>
  );
}
