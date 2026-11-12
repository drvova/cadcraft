// Caption: Refused text at the error stroke, with the line that says why.
import { TextArea } from "../../../../src/ui/TextArea";

export default function Invalid() {
  return (
    <div>
      <TextArea value="LINE 0,0 10" ariaLabel="Script" invalid describedBy="script-error" spellcheck={false} onInput={() => undefined} />
      <span id="script-error">Line 1 ends before its second point.</span>
    </div>
  );
}
