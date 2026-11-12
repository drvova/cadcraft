// Caption: A blocked action at the disabled ink and fill.
import { Button } from "../../../../src/ui/Button";

/** Disabled, and still reachable: the `title` says why, in the hint and as the description. */
export default function Disabled() {
  return (
    <Button variant="primary" disabled title="To save, choose a provider or type a base URL.">
      Save
    </Button>
  );
}
