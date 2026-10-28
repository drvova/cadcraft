// Caption: The composer's toolbar row: attach, stop, send.
import { IconButton } from "../../../../src/ui/IconButton";

export default function InAssistantPane() {
  return (
    <div class="assistant-actions">
      <IconButton icon="attach" title="Attach files" />
      <IconButton icon="stop" title="Stop" />
      <IconButton icon="send" title="Send" variant="inverted" />
    </div>
  );
}
