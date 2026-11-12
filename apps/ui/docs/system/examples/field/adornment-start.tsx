// Caption: A search field with its lens inside the start.
import { createSignal } from "solid-js";
import { ToolIcon } from "../../../../src/icons";
import { Field } from "../../../../src/ui/Field";

export default function AdornmentStart() {
  const [query, setQuery] = createSignal("");
  // The lens is a glyph, hidden from assistive tech by `ToolIcon`: a press on it lands on the input.
  return <Field type="search" value={query()} ariaLabel="Search layers" placeholder="Walls" spellcheck={false} onInput={setQuery} start={<ToolIcon id="search" />} />;
}
