/**
 * IconButton's contract: a native button whose accessible name is the `title`, the code-drawn
 * glyph inside, the size/variant classes, `aria-pressed` when selected, and no click when
 * disabled.
 */

import { describe, expect, test } from "bun:test";
import { IconButton } from "./IconButton";
import { buttonIn, mount } from "./test-utils";

describe("IconButton", () => {
  test("renders a native button named by its title, with the drawn glyph", () => {
    const button = buttonIn(mount(() => <IconButton icon="close" title="Close the panel" />));
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Close the panel");
    expect(button.getAttribute("title")).toBe("Close the panel");
    expect(button.querySelector("svg.tool-icon")).not.toBeNull();
    expect(button.classList.contains("ui-icon-button--ghost")).toBe(true);
    expect(button.classList.contains("ui-icon-button--md")).toBe(true);
  });

  test("renders each variant and size", () => {
    const soft = buttonIn(mount(() => <IconButton icon="attach" title="Attach" variant="soft" />));
    expect(soft.classList.contains("ui-icon-button--soft")).toBe(true);
    const inverted = buttonIn(mount(() => <IconButton icon="send" title="Send" variant="inverted" />));
    expect(inverted.classList.contains("ui-icon-button--inverted")).toBe(true);
    const small = buttonIn(mount(() => <IconButton icon="close" title="Close" size="sm" />));
    expect(small.classList.contains("ui-icon-button--sm")).toBe(true);
  });

  test("runs the click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <IconButton icon="plus" title="New chat" onClick={() => clicks++} />));
    button.click();
    expect(clicks).toBe(1);
  });

  test("a disabled icon button takes no click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <IconButton icon="close" title="Close" disabled onClick={() => clicks++} />));
    expect(button.disabled).toBe(true);
    button.click();
    expect(clicks).toBe(0);
  });

  test("selected is announced as a pressed toggle", () => {
    const on = buttonIn(mount(() => <IconButton icon="list" title="List" selected />));
    expect(on.getAttribute("aria-pressed")).toBe("true");
    const off = buttonIn(mount(() => <IconButton icon="list" title="List" selected={false} />));
    expect(off.getAttribute("aria-pressed")).toBe("false");
    const plain = buttonIn(mount(() => <IconButton icon="list" title="List" />));
    expect(plain.hasAttribute("aria-pressed")).toBe(false);
  });
});
