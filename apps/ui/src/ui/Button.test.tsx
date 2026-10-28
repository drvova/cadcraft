/**
 * Button's contract, as a user observes it: a native button with an accessible name, the variant
 * and size classes the recipe defines, `type="button"` by default, and a disabled button that
 * takes no click.
 */

import { describe, expect, test } from "bun:test";
import { Button } from "./Button";
import { buttonIn, mount } from "./test-utils";

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
    const danger = buttonIn(mount(() => <Button variant="danger">Delete</Button>));
    expect(danger.classList.contains("ui-button--danger")).toBe(true);
  });

  test("runs the click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Button onClick={() => clicks++}>Run</Button>));
    button.click();
    expect(clicks).toBe(1);
  });

  test("a disabled button takes no click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Button disabled onClick={() => clicks++}>Run</Button>));
    expect(button.disabled).toBe(true);
    button.click();
    expect(clicks).toBe(0);
  });

  test("a caller can pass a submit type into a form", () => {
    const button = buttonIn(mount(() => <Button type="submit">Send</Button>));
    expect(button.getAttribute("type")).toBe("submit");
  });
});
