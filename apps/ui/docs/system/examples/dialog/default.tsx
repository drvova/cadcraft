// Caption: A dialog with one field and its two actions; the caller holds `open`.
import { createSignal } from "solid-js";
import { Button } from "../../../../src/ui/Button";
import { Dialog } from "../../../../src/ui/Dialog";
import { Field } from "../../../../src/ui/Field";

export default function Default() {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("Layout1");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Rename layout</Button>
      <Dialog
        open={open()}
        title="Rename Layout"
        size="sm"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" onClick={() => setOpen(false)}>
              Rename
            </Button>
          </>
        }
      >
        <Field ariaLabel="Layout name" value={name()} onInput={setName} selectOnFocus />
      </Dialog>
    </>
  );
}
