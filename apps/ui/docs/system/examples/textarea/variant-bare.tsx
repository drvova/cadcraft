// Caption: The editor inside a card that draws the box and the focus.
import { TextArea } from "../../../../src/ui/TextArea";

export default function VariantBare() {
  return (
    <div class="assistant-composer">
      <TextArea variant="bare" value="" placeholder="Ask, or / for commands" ariaLabel="Ask the assistant" onInput={() => undefined} />
    </div>
  );
}
