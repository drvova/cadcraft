// Caption: Locked text at the disabled ink.
import { TextArea } from "../../../../src/ui/TextArea";

export default function Disabled() {
  return <TextArea value="This layer is locked." ariaLabel="Notes" disabled />;
}
