// Caption: A key field with its show and hide key inside the end.
import { createSignal } from "solid-js";
import { Field } from "../../../../src/ui/Field";
import { IconButton } from "../../../../src/ui/IconButton";

export default function AdornmentEnd() {
  const [key, setKey] = createSignal("sk-0000");
  const [shown, setShown] = createSignal(false);
  return (
    <div>
      <Field
        type={shown() ? "text" : "password"}
        value={key()}
        ariaLabel="API key"
        autocomplete="off"
        spellcheck={false}
        describedBy="key-help"
        onInput={setKey}
        end={<IconButton icon={shown() ? "eye" : "eye-off"} size="sm" title={shown() ? "Hide the key" : "Show the key"} onClick={() => setShown(!shown())} />}
      />
      <span id="key-help">Stored in this browser, not encrypted.</span>
    </div>
  );
}
