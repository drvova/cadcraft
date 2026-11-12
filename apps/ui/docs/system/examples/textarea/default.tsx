// Caption: A notes field, two lines tall when empty.
import { TextArea } from "../../../../src/ui/TextArea";

export default function Default() {
  return <TextArea value="" placeholder="Notes on this layer" ariaLabel="Notes" onInput={() => undefined} />;
}
