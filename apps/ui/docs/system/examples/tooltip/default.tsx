// Caption: The hint over a text button.
import { Tooltip } from "../../../../src/ui/Tooltip";
import { Button } from "../../../../src/ui/Button";

/** The hint over a control that is not an icon button (that one shows the hint by itself). */
export default function Example() {
  return (
    <Tooltip text="Check the address and the key">
      <Button>Check connection</Button>
    </Tooltip>
  );
}
