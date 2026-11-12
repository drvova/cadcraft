// Caption: Drafting Settings: pages on `TabPanels`, a refused value said beside its field, OK as the form's submit.
import { createSignal } from "solid-js";
import { Button } from "../../../../src/ui/Button";
import { Checkbox } from "../../../../src/ui/Checkbox";
import { Dialog } from "../../../../src/ui/Dialog";
import { Field } from "../../../../src/ui/Field";
import { TabPanels } from "../../../../src/ui/Tab";

export default function InDraftingSettings() {
  const [tab, setTab] = createSignal("snap-grid");
  const [spacing, setSpacing] = createSignal("0");
  const refused = (): boolean => !(Number(spacing()) > 0);
  return (
    <Dialog
      open
      title="Drafting Settings"
      dismissOnBackdrop={spacing() === "0.5"}
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
      <TabPanels
        ariaLabel="Drafting settings"
        selected={tab()}
        onChange={setTab}
        panels={[
          {
            id: "snap-grid",
            label: "Snap and Grid",
            content: () => (
              <div>
                <Checkbox checked onChange={() => undefined}>
                  Snap on
                </Checkbox>
                <p>
                  <label for="example-snap-x">Snap X spacing</label>{" "}
                  <Field id="example-snap-x" align="end" inputMode="decimal" value={spacing()} invalid={refused()} describedBy={refused() ? "example-snap-x-error" : undefined} onInput={setSpacing} />
                </p>
                {refused() ? <p id="example-snap-x-error">Snap spacing must be more than 0.</p> : null}
              </div>
            ),
          },
          { id: "polar", label: "Polar Tracking", content: () => <Checkbox checked onChange={() => undefined}>Polar tracking on</Checkbox> },
          { id: "osnap", label: "Object Snap", content: () => <Checkbox checked onChange={() => undefined}>Object snap on</Checkbox> },
        ]}
      />
    </Dialog>
  );
}
