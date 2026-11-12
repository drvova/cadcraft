// Caption: The small box, 52ch wide: a question with its two answers and no field.
import { Button } from "../../../../src/ui/Button";
import { Dialog } from "../../../../src/ui/Dialog";

export default function SizeSm() {
  return (
    <Dialog
      open
      title="Delete Layout"
      size="sm"
      describedBy="delete-layout-what"
      dismissOnBackdrop={false}
      onClose={() => undefined}
      footer={
        <>
          <Button>Cancel</Button>
          <Button variant="danger" type="submit">
            Delete
          </Button>
        </>
      }
    >
      <p id="delete-layout-what">Layout2 and its 3 viewports are removed from the drawing. Undo brings them back.</p>
    </Dialog>
  );
}
