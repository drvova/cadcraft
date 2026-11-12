// Caption: The form control: stroked and filled.
import { TextArea } from "../../../../src/ui/TextArea";

export default function VariantField() {
  return <TextArea variant="field" value={"Walls are drawn to the finished face.
Doors swing into the room."} ariaLabel="Notes" onInput={() => undefined} />;
}
