// Caption: A refused address at the error stroke, with the line that says why.
import { Field } from "../../../../src/ui/Field";

export default function Invalid() {
  return (
    <div>
      <Field value="127.0.0.1:11434" ariaLabel="Base URL" invalid describedBy="base-url-error" autocomplete="off" spellcheck={false} />
      <span id="base-url-error">Start the address with http:// or https://</span>
    </div>
  );
}
