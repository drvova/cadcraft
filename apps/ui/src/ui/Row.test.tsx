/**
 * Row's contract: a full-width native button, `selected` announced as `aria-current`, a click
 * that runs, and a disabled row that takes none; the option form inside a listbox; and the
 * `title` as the layer's hint and the row's description in both forms.
 */

import { describe, expect, test } from "bun:test";
import { Row } from "./Row";
import { hintContent } from "./Tooltip";
import { buttonIn, mount } from "../test-utils";

describe("Row", () => {
  test("renders a full-width native button with its content", () => {
    const button = buttonIn(mount(() => <Row>Layer 1</Row>));
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Layer 1");
    expect(button.classList.contains("ui-row")).toBe(true);
    expect(button.getAttribute("type")).toBe("button");
  });

  test("runs the click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Row onClick={() => clicks++}>Menu item</Row>));
    button.click();
    expect(clicks).toBe(1);
  });

  test("selected is announced as the current row", () => {
    const selected = buttonIn(mount(() => <Row selected>Current</Row>));
    expect(selected.getAttribute("aria-current")).toBe("true");
    const plain = buttonIn(mount(() => <Row>Other</Row>));
    expect(plain.hasAttribute("aria-current")).toBe(false);
  });

  test("a disabled row takes no click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Row disabled onClick={() => clicks++}>Locked</Row>));
    expect(button.disabled).toBe(true);
    button.click();
    expect(clicks).toBe(0);
  });

  test("an option is the listbox's own item: no button, no Tab stop, the active one selected", () => {
    const container = mount(() => (
      <div role="listbox" aria-label="Commands">
        <Row option id="option-0">
          Line
        </Row>
        <Row option id="option-1" selected>
          Circle
        </Row>
      </div>
    ));
    expect(container.querySelector("button")).toBeNull();
    const [line, circle] = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    if (line === undefined || circle === undefined) throw new Error("no options were rendered");
    expect(line.className).toBe("ui-row ui-row--option");
    expect(line.id).toBe("option-0");
    expect(line.hasAttribute("tabindex")).toBe(false);
    expect(line.getAttribute("aria-selected")).toBe("false");
    expect(circle.getAttribute("aria-selected")).toBe("true");
    expect(circle.hasAttribute("aria-current")).toBe(false);
  });

  test("an option runs the click and tells its listbox where the pointer is", () => {
    let clicks = 0;
    let moves = 0;
    const option = mount(() => (
      <Row option onClick={() => clicks++} onPointerMove={() => moves++}>
        Line
      </Row>
    )).querySelector<HTMLElement>('[role="option"]');
    option?.click();
    option?.dispatchEvent(new Event("pointermove", { bubbles: true }));
    expect(clicks).toBe(1);
    expect(moves).toBe(1);
  });

  test("a disabled option says so and takes no click", () => {
    let clicks = 0;
    const option = mount(() => (
      <Row option disabled selected onClick={() => clicks++}>
        Hatch
      </Row>
    )).querySelector<HTMLElement>('[role="option"]');
    expect(option?.getAttribute("aria-disabled")).toBe("true");
    expect(option?.getAttribute("aria-selected")).toBe("true");
    option?.click();
    expect(clicks).toBe(0);
  });

  test("the title is the layer's hint and the row's description, never a native title or its name, in both forms", () => {
    const button = buttonIn(mount(() => <Row title="Makes this the current layer">Walls</Row>));
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.textContent).toBe("Walls");
    expect(button.getAttribute("data-hint")).toBe("Makes this the current layer");
    expect(describedBy(button)).toBe("Makes this the current layer");
    const option = optionIn(
      mount(() => (
        <Row option title="Draws a line between two points">
          Line
        </Row>
      )),
    );
    expect(option.hasAttribute("title")).toBe(false);
    expect(option.hasAttribute("aria-label")).toBe(false);
    expect(option.getAttribute("data-hint")).toBe("Draws a line between two points");
    expect(describedBy(option)).toBe("Draws a line between two points");
  });

  test("a row with no title, or one that repeats its text, has no description and no hint", async () => {
    const bare = buttonIn(mount(() => <Row>Walls</Row>));
    const repeat = buttonIn(mount(() => <Row title="Walls">Walls</Row>));
    await Promise.resolve();
    expect(bare.getAttribute("data-hint")).toBe("");
    expect(bare.hasAttribute("aria-describedby")).toBe(false);
    expect(hintContent(bare)).toBeNull();
    expect(repeat.hasAttribute("aria-describedby")).toBe(false);
    expect(hintContent(repeat)).toBeNull();
  });

  test("a label the row cuts short shows in full, without the trailing text beside it, and the title drops under it", () => {
    const clippedRow = (title?: string): HTMLElement =>
      optionIn(
        mount(() => (
          <Row option title={title}>
            <span class="label">Ground floor plan, revision C</span>
            <span class="trail">Ctrl+G</span>
          </Row>
        )),
      );
    const cut = (row: HTMLElement): void => {
      const label = row.querySelector(".label") as HTMLElement;
      Object.defineProperty(label, "scrollWidth", { value: 300 });
      Object.defineProperty(label, "clientWidth", { value: 120 });
    };
    const bare = clippedRow();
    expect(hintContent(bare)).toBeNull();
    cut(bare);
    expect(hintContent(bare)).toEqual({ text: "Ground floor plan, revision C", keys: "", note: "" });
    const titled = clippedRow("Switch to this layout");
    cut(titled);
    expect(hintContent(titled)).toEqual({ text: "Ground floor plan, revision C", keys: "", note: "Switch to this layout" });
    const whole = buttonIn(mount(() => <Row>Ground floor plan, revision C</Row>));
    Object.defineProperty(whole, "scrollWidth", { value: 300 });
    Object.defineProperty(whole, "clientWidth", { value: 120 });
    expect(hintContent(whole)?.text).toBe("Ground floor plan, revision C");
  });

  test("a disabled row that is selected stays marked for assistive tech in both forms", () => {
    const button = buttonIn(mount(() => <Row disabled selected>Frozen layer</Row>));
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-current")).toBe("true");
  });
});

function optionIn(container: HTMLElement): HTMLElement {
  const option = container.querySelector<HTMLElement>('[role="option"]');
  if (option === null) throw new Error("no option was rendered");
  return option;
}

/** The words the element's `aria-describedby` points at. */
function describedBy(el: Element): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}
