// Caption: The default secondary button beside a primary one.
import { Button } from "../../../../src/ui/Button";

export default function Default() {
  return (
    <div>
      <Button>Cancel</Button>
      <Button variant="primary">Save</Button>
    </div>
  );
}
