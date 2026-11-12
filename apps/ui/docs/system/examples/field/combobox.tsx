// Caption: A search field driving a list of options.
import { Field } from "../../../../src/ui/Field";
import { Row } from "../../../../src/ui/Row";

export default function Combobox() {
  return (
    <div>
      <Field
        type="search"
        value="ci"
        ariaLabel="Search commands"
        role="combobox"
        expanded
        controls="command-list"
        activeDescendant="command-1"
        autocompleteKind="list"
        autocomplete="off"
        spellcheck={false}
        onInput={() => undefined}
        onKeyDown={() => undefined}
      />
      <div id="command-list" role="listbox" aria-label="Commands">
        <Row option id="command-0">Arc</Row>
        <Row option id="command-1" selected>Circle</Row>
      </div>
    </div>
  );
}
