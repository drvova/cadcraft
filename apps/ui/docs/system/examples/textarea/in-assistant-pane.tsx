// Caption: The composer's editor, sending on Enter.
import { TextArea } from "../../../../src/ui/TextArea";

export default function InAssistantPane() {
  return (
    <div class="assistant-composer">
      <TextArea
        variant="bare"
        rows={2}
        maxRows={9}
        value="Draw a circle at 20,20"
        placeholder="Ask, or / for commands"
        ariaLabel="Ask the assistant"
        onInput={() => undefined}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) event.preventDefault();
        }}
      />
    </div>
  );
}
