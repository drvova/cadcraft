/**
 * Row's contract: a full-width native button, `selected` announced as `aria-current`, a click
 * that runs, and a disabled row that takes none.
 */

import { describe, expect, test } from "bun:test";
import { Row } from "./Row";
import { buttonIn, mount } from "./test-utils";

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
});
