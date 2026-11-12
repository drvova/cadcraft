/**
 * Dialog's contract: a native dialog named by its title and shown modally while the caller says
 * `open`; the focus on the first field that is showing (never the close key) and back on what had
 * it; each way of asking to close reported with its reason and none of them closing by itself;
 * Escape left to a field that used it; a press outside counted only when it began and ended
 * there; and a body and a footer that are one form which submits nothing.
 */

import { describe, expect, test } from "bun:test";
import { createSignal, type JSX } from "solid-js";
import { Button } from "./Button";
import { Dialog, type DialogCloseReason, type DialogProps } from "./Dialog";
import { Field } from "./Field";
import { mount } from "../test-utils";

function dialogIn(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector("dialog");
  if (dialog === null) throw new Error("no <dialog> was rendered");
  return dialog;
}

/** The dialog opens, and follows the caller's answer, a microtask after it is asked. */
const settled = (): Promise<void> => Promise.resolve();

interface Held {
  dialog: HTMLDialogElement;
  reasons: DialogCloseReason[];
}

/**
 * A dialog whose `open` the test holds, the way a shell does: open from the start unless `closed`,
 * and closed by the test answering `onClose` unless `answer` is false. The test DOM runs Solid's
 * build without effects, so `open` is read when the dialog mounts and after each `onClose`; a
 * caller that opens a mounted dialog later is checked in the browser.
 */
async function held(props: Partial<DialogProps> & { body?: () => JSX.Element; answer?: boolean; closed?: boolean } = {}): Promise<Held> {
  const reasons: DialogCloseReason[] = [];
  const [open, setOpen] = createSignal(props.closed !== true);
  // Called as a function with getters, the way Solid's own compiler passes reactive props.
  const container = mount(() =>
    Dialog({
      title: "Drawing units",
      ...props,
      get open() {
        return open();
      },
      onClose: (reason) => {
        reasons.push(reason);
        if (props.answer !== false) setOpen(false);
      },
      get children() {
        return props.body?.() ?? <Field ariaLabel="Precision" value="4" />;
      },
    }),
  );
  await settled();
  return { dialog: dialogIn(container), reasons };
}

/** A press and its release at a point, on the dialog element itself (where a press on the backdrop lands). */
function pressAt(dialog: HTMLDialogElement, down: [number, number], up: [number, number]): void {
  dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: down[0], clientY: down[1] }));
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: up[0], clientY: up[1] }));
}

/** Gives the dialog a box on the page, which the test DOM does not lay out. */
function boxed(dialog: HTMLDialogElement): void {
  dialog.getBoundingClientRect = () => new DOMRect(100, 100, 400, 300);
}

const twoFields = (): JSX.Element => (
  <div>
    <Field ariaLabel="First" />
    <Field ariaLabel="Second" />
  </div>
);

describe("Dialog", () => {
  test("renders a native dialog named by its title, with a close key and no native title", async () => {
    const { dialog } = await held();
    expect(dialog.tagName).toBe("DIALOG");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    expect(title?.tagName).toBe("H2");
    expect(title?.textContent).toBe("Drawing units");
    const close = dialog.querySelector(".ui-dialog-head button");
    expect(close?.getAttribute("aria-label")).toBe("Close");
    expect(close?.getAttribute("type")).toBe("button");
    expect(dialog.querySelector("[title]")).toBeNull();
    // No landmark of the page's own inside it.
    expect(dialog.querySelector("header, footer")).toBeNull();
  });

  test("two dialogs never share a title id", async () => {
    const a = await held({ closed: true });
    const b = await held({ closed: true });
    expect(a.dialog.getAttribute("aria-labelledby")).not.toBe(b.dialog.getAttribute("aria-labelledby"));
  });

  test("size names the recipe, with md the default", async () => {
    expect((await held({ closed: true })).dialog.className).toBe("ui-dialog ui-dialog--md");
    expect((await held({ closed: true, size: "sm" })).dialog.className).toBe("ui-dialog ui-dialog--sm");
    expect((await held({ closed: true, size: "lg" })).dialog.className).toBe("ui-dialog ui-dialog--lg");
  });

  test("is showing only while the caller says open", async () => {
    expect((await held({ closed: true })).dialog.open).toBe(false);
    expect((await held()).dialog.open).toBe(true);
  });

  test("opening puts the focus on the first field, never on the close key", async () => {
    const { dialog } = await held();
    expect(document.activeElement).toBe(dialog.querySelector(".ui-dialog-body input"));
  });

  test("a field in a part that is hidden is passed over for the first one showing", async () => {
    await held({
      body: () => (
        <div>
          <div hidden>
            <Field ariaLabel="Behind" />
          </div>
          <Field ariaLabel="In front" />
        </div>
      ),
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("In front");
  });

  test("with no field the dialog itself takes the focus, not a button", async () => {
    const { dialog } = await held({ body: () => <p>Discard the changes to this layout?</p>, footer: <Button type="submit">Discard</Button> });
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("tabindex")).toBe("-1");
  });

  test("initialFocus names the control to start on: a selector, a function or an element", async () => {
    await held({ body: twoFields, initialFocus: "[aria-label='Second']" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Second");

    let own: HTMLDialogElement | undefined;
    const byFunction = held({ body: twoFields, initialFocus: () => own?.querySelector<HTMLElement>("[aria-label='First']") });
    own = dialogIn(document.body.lastElementChild as HTMLElement);
    await byFunction;
    expect(document.activeElement).toBe(own.querySelector("[aria-label='First']"));

    const target = document.createElement("input");
    await held({ body: () => target, initialFocus: target });
    expect(document.activeElement).toBe(target);
  });

  test("closing hands the focus back to what had it", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { dialog } = await held();
    expect(document.activeElement).not.toBe(opener);
    dialog.querySelector<HTMLButtonElement>(".ui-dialog-head button")?.click();
    await settled();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  test("Escape asks to close with its reason and never closes by itself", async () => {
    const kept = await held({ answer: false });
    const cancel = new Event("cancel", { cancelable: true });
    kept.dialog.dispatchEvent(cancel);
    await settled();
    expect(cancel.defaultPrevented).toBe(true);
    expect(kept.reasons).toEqual(["escape"]);
    expect(kept.dialog.open).toBe(true);

    const answered = await held();
    answered.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await settled();
    expect(answered.reasons).toEqual(["escape"]);
    expect(answered.dialog.open).toBe(false);
  });

  test("Escape that a field inside used does not ask to close", async () => {
    const { dialog, reasons } = await held({ answer: false });
    const input = dialog.querySelector("input");
    if (input === null) throw new Error("no field");
    input.addEventListener("keydown", (event) => event.preventDefault());
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(reasons).toEqual([]);
    // The next Escape, used by nothing, asks.
    const other = document.createElement("input");
    dialog.querySelector(".ui-dialog-body")?.appendChild(other);
    other.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(reasons).toEqual(["escape"]);
  });

  test("the close key asks to close with its reason", async () => {
    const { dialog, reasons } = await held();
    dialog.querySelector<HTMLButtonElement>(".ui-dialog-head button")?.click();
    await settled();
    expect(reasons).toEqual(["close"]);
    expect(dialog.open).toBe(false);
  });

  test("a press outside the box asks to close; one that began or ended inside it does not", async () => {
    const { dialog, reasons } = await held({ answer: false });
    boxed(dialog);
    pressAt(dialog, [250, 200], [250, 200]);
    pressAt(dialog, [250, 200], [20, 20]);
    pressAt(dialog, [20, 20], [250, 200]);
    expect(reasons).toEqual([]);
    pressAt(dialog, [20, 20], [30, 40]);
    expect(reasons).toEqual(["backdrop"]);
    // A click on a control inside is never the backdrop, wherever the pointer is said to be.
    const input = dialog.querySelector("input");
    input?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }));
    input?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }));
    expect(reasons).toEqual(["backdrop"]);
  });

  test("dismissOnBackdrop false keeps the dialog under a press outside", async () => {
    const { dialog, reasons } = await held({ dismissOnBackdrop: false });
    boxed(dialog);
    pressAt(dialog, [20, 20], [20, 20]);
    await settled();
    expect(reasons).toEqual([]);
    expect(dialog.open).toBe(true);
  });

  test("the footer is drawn only when there is one, and a function footer is handed done", async () => {
    expect((await held({ closed: true })).dialog.querySelector(".ui-dialog-foot")).toBeNull();
    const { dialog, reasons } = await held({
      footer: (done) => (
        <Button variant="primary" type="submit" onClick={(_event: MouseEvent) => done()}>
          Save
        </Button>
      ),
    });
    const save = dialog.querySelector<HTMLButtonElement>(".ui-dialog-foot button");
    expect(save?.textContent).toBe("Save");
    expect(save?.getAttribute("type")).toBe("submit");
    save?.click();
    await settled();
    expect(reasons).toEqual(["action"]);
    expect(dialog.open).toBe(false);
  });

  test("the body and the footer are one form, and it submits nothing", async () => {
    const { dialog } = await held({ footer: <Button type="submit">Save</Button> });
    const form = dialog.querySelector("form");
    expect(form?.contains(dialog.querySelector(".ui-dialog-body"))).toBe(true);
    expect(form?.contains(dialog.querySelector(".ui-dialog-foot"))).toBe(true);
    // The close key is outside it: Enter in a field can never press it.
    expect(form?.contains(dialog.querySelector(".ui-dialog-head button"))).toBe(false);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form?.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });

  test("a dialog the platform closed without asking tells the caller, and one the caller keeps open comes back", async () => {
    const kept = await held({ answer: false });
    kept.dialog.close();
    await settled();
    expect(kept.reasons).toEqual(["escape"]);
    expect(kept.dialog.open).toBe(true);
    const released = await held();
    released.dialog.close();
    await settled();
    expect(released.reasons).toEqual(["escape"]);
    expect(released.dialog.open).toBe(false);
  });

  test("describedBy ties the line that says what the dialog is for", async () => {
    expect((await held({ closed: true, describedBy: "units-help" })).dialog.getAttribute("aria-describedby")).toBe("units-help");
    expect((await held({ closed: true })).dialog.hasAttribute("aria-describedby")).toBe(false);
  });
});
