// Caption: The one line inside a box its surface draws.
import { createSignal } from "solid-js";
import { Field } from "../../../../src/ui/Field";

export default function VariantBare() {
  const [focused, setFocused] = createSignal(false);
  // The surface draws the edge and the fill, and shows the focus the bare field does not.
  return (
    <div class="cmd-field" classList={{ "is-focused": focused() }}>
      <Field variant="bare" ariaLabel="Command line" placeholder="Command:" spellcheck={false} autocomplete="off" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    </div>
  );
}
