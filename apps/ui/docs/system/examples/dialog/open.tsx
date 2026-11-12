// Caption: An open dialog: the page behind is dimmed and inert, and the first field has the focus.
import { Button } from "../../../../src/ui/Button";
import { Dialog } from "../../../../src/ui/Dialog";
import { Field } from "../../../../src/ui/Field";

export default function Open() {
  return (
    <Dialog
      open
      title="Rename Layout"
      size="sm"
      onClose={() => undefined}
      footer={
        <>
          <Button>Cancel</Button>
          <Button variant="primary" type="submit">
            Rename
          </Button>
        </>
      }
    >
      <Field ariaLabel="Layout name" value="Layout1" onInput={() => undefined} />
    </Dialog>
  );
}
