/**
 * Button's contract, as a user observes it: a native button with an accessible name, the variant
 * and size classes the recipe defines, `type="button"` by default, a disabled button that
 * stays focusable and takes no click by any means, an `ariaLabel` that names the action over a
 * label that is a value, and a `title` that is the layer's hint and the button's description.
 */

import { describe, expect, test } from "bun:test";
import { Button } from "./Button";
import { hintContent } from "./Tooltip";
import { buttonIn, mount } from "../test-utils";

/** The text assistive tech reads as the control's description: what its `aria-describedby` points at. */
const descriptionOf = (el: Element): string | null => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

describe("Button", () => {
  test("renders a native button with its label and the secondary default", () => {
    const button = buttonIn(mount(() => <Button>Save</Button>));
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Save");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.classList.contains("ui-button--secondary")).toBe(true);
    expect(button.classList.contains("ui-button--md")).toBe(true);
  });

  test("renders each variant and size", () => {
    const primary = buttonIn(mount(() => <Button variant="primary">OK</Button>));
    expect(primary.classList.contains("ui-button--primary")).toBe(true);
    const ghost = buttonIn(mount(() => <Button variant="ghost" size="sm">Cancel</Button>));
    expect(ghost.classList.contains("ui-button--ghost")).toBe(true);
    expect(ghost.classList.contains("ui-button--sm")).toBe(true);
    // The quiet one is a variant like the rest: one class, and a button in every other respect.
    const quiet = buttonIn(mount(() => <Button variant="quiet" size="sm" title="Choose another provider">Change</Button>));
    expect(quiet.className).toBe("ui-button ui-button--quiet ui-button--sm");
    expect(quiet.getAttribute("type")).toBe("button");
    expect(quiet.textContent).toBe("Change");
    expect(descriptionOf(quiet)).toBe("Choose another provider");
    const danger = buttonIn(mount(() => <Button variant="danger">Delete</Button>));
    expect(danger.classList.contains("ui-button--danger")).toBe(true);
  });

  test("runs the click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Button onClick={() => clicks++}>Run</Button>));
    button.click();
    expect(clicks).toBe(1);
  });

  test("a disabled button says so and stays focusable, so its hint can say why", () => {
    const button = buttonIn(mount(() => <Button disabled title="Pick a model first">Save</Button>));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("data-hint")).toBe("Pick a model first");
    expect(descriptionOf(button)).toBe("Pick a model first");
    const enabled = buttonIn(mount(() => <Button>Save</Button>));
    expect(enabled.hasAttribute("aria-disabled")).toBe(false);
  });

  test("a disabled button never runs its click: by pointer, by Enter or by Space", () => {
    let clicks = 0;
    let heardAbove = 0;
    const container = mount(() => <Button disabled onClick={() => clicks++}>Run</Button>);
    container.addEventListener("click", () => heardAbove++);
    const button = buttonIn(container);
    button.click();
    // A pointer's click, then the click the platform fires for Enter and for Space (detail 0).
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    const fromKey = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
    button.dispatchEvent(fromKey);
    expect(clicks).toBe(0);
    expect(heardAbove).toBe(0);
    expect(fromKey.defaultPrevented).toBe(true);
  });

  test("a disabled submit button does not submit its form", () => {
    let submits = 0;
    const container = mount(() => (
      <form onSubmit={(event: Event) => (event.preventDefault(), submits++)}>
        <Button type="submit" disabled>
          Send
        </Button>
      </form>
    ));
    buttonIn(container).click();
    expect(submits).toBe(0);
  });

  test("the title is the layer's hint and the button's description, never a native title or its name", () => {
    const button = buttonIn(mount(() => <Button title="Check the address and the key">Check connection</Button>));
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.getAttribute("data-hint")).toBe("Check the address and the key");
    expect(descriptionOf(button)).toBe("Check the address and the key");
  });

  test("a title that only repeats the label is no hint and no description", async () => {
    const button = buttonIn(mount(() => <Button title=" Save ">Save</Button>));
    await Promise.resolve();
    expect(hintContent(button)).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    const plain = buttonIn(mount(() => <Button>Save</Button>));
    expect(hintContent(plain)).toBeNull();
    expect(plain.hasAttribute("aria-describedby")).toBe(false);
  });

  test("a shortcut is a key cap in the hint and aria-keyshortcuts on the button", () => {
    const button = buttonIn(mount(() => <Button title="Search commands" shortcut="Ctrl+Shift+P">plan.dxf</Button>));
    expect(button.getAttribute("data-hint")).toBe("Search commands");
    expect(button.getAttribute("data-hint-keys")).toBe("Ctrl+Shift+P");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+P");
  });

  test("a title ending in its shortcut in brackets still draws the cap, and the description keeps the words", () => {
    const button = buttonIn(mount(() => <Button ariaLabel="Search commands, plan.dxf" title="Search commands (Ctrl+Shift+P)">plan.dxf</Button>));
    expect(button.getAttribute("data-hint")).toBe("Search commands");
    expect(button.getAttribute("data-hint-keys")).toBe("Ctrl+Shift+P");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(descriptionOf(button)).toBe("Search commands (Ctrl+Shift+P)");
    expect(button.getAttribute("aria-label")).toBe("Search commands, plan.dxf");
  });

  test("a caller can pass a submit type into a form", () => {
    const button = buttonIn(mount(() => <Button type="submit">Send</Button>));
    expect(button.getAttribute("type")).toBe("submit");
  });

  test("ariaLabel names the action when the visible label is a value", () => {
    const button = buttonIn(mount(() => <Button ariaLabel="Search commands, plan.dxf">plan.dxf</Button>));
    expect(button.getAttribute("aria-label")).toBe("Search commands, plan.dxf");
    expect(button.textContent).toBe("plan.dxf");
  });

  test("a button whose label is the action carries no aria-label", () => {
    const button = buttonIn(mount(() => <Button>Save</Button>));
    expect(button.hasAttribute("aria-label")).toBe(false);
  });
});
