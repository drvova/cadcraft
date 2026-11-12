// Caption: A glyph toggle that is off: the off glyph in the quiet ink.
import { Toggle } from "../../../../src/ui/Toggle";

export default function Default() {
  return <Toggle pressed={false} icon="eye-off" iconOn="eye" ariaLabel="Preview" hint="Show the preview" />;
}
