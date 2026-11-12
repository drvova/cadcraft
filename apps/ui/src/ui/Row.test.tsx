/**
 * Row's contract: a full-width native button, `selected` announced as `aria-current`, a click
 * that runs, and a disabled row that takes none.
 */

import { describe, expect, test } from "bun:test";
import { Row } from "./Row";
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
});
