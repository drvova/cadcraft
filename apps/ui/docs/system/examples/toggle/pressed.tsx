// Caption: The same toggle on: the on glyph in the full ink, no fill, announced pressed.
import { Toggle } from "../../../../src/ui/Toggle";

export default function Pressed() {
  return <Toggle pressed icon="eye-off" iconOn="eye" ariaLabel="Preview" hint="Hide the preview" />;
}
