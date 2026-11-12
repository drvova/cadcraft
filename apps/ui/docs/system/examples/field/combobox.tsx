// Caption: A bare search field driving a list of options, its lens in the start.
import { ToolIcon } from "../../../../src/icons";
import { Field } from "../../../../src/ui/Field";
import { Row } from "../../../../src/ui/Row";

export default function Combobox() {
  return (
    <div class="palette-box">
      <div class="palette-field">
        <Field
          variant="bare"
          value="ci"
          ariaLabel="Search commands"
          role="combobox"
          expanded
          controls="command-list"
          activeDescendant="command-1"
          autocompleteKind="list"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          onInput={() => undefined}
          onKeyDown={() => undefined}
          start={
            <span class="palette-field-icon">
              <ToolIcon id="search" />
            </span>
          }
        />
      </div>
      <div id="command-list" role="listbox" aria-label="Commands">
        <Row option id="command-0">Arc</Row>
        <Row option id="command-1" selected>Circle</Row>
      </div>
    </div>
  );
}
