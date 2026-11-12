// Caption: The large box, 104ch wide: a body tall enough to scroll under a title bar and a footer that stay.
import { For } from "solid-js";
import { Button } from "../../../../src/ui/Button";
import { Checkbox } from "../../../../src/ui/Checkbox";
import { Dialog } from "../../../../src/ui/Dialog";

const LAYERS = ["0", "Defpoints", "Outline", "Center", "Hidden", "Dimensions", "Hatch", "Notes", "Title", "Walls", "Doors", "Furniture", "Electrical", "Plumbing", "Site", "Grid lines"];

export default function SizeLg() {
  return (
    <Dialog
      open
      title="Layers to Plot"
      size="lg"
      onClose={() => undefined}
      footer={
        <>
          <Button>Cancel</Button>
          <Button variant="primary" type="submit">
            OK
          </Button>
        </>
      }
    >
      <div role="group" aria-label="Layers">
        <For each={LAYERS}>
          {(layer) => (
            <p>
              <Checkbox checked onChange={() => undefined}>
                {layer}
              </Checkbox>
            </p>
          )}
        </For>
      </div>
    </Dialog>
  );
}
