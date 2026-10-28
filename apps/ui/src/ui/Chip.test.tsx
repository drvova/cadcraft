/**
 * Chip's contract: the interactive form is a real `<button>` and the static form is a `<span>`
 * that takes no click; tone classes come from the prop.
 */

import { describe, expect, test } from "bun:test";
import { Chip } from "./Chip";
import { buttonIn, mount } from "./test-utils";

describe("Chip", () => {
  test("without a handler it is a static span", () => {
    const container = mount(() => <Chip>26 objects</Chip>);
    expect(container.querySelector("span.ui-chip")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("26 objects");
  });

  test("with a handler it is a button that runs the click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Chip onClick={() => clicks++}>line</Chip>));
    expect(button.getAttribute("type")).toBe("button");
    expect(button.classList.contains("ui-chip--interactive")).toBe(true);
    button.click();
    expect(clicks).toBe(1);
  });

  test("tone picks the fill", () => {
    const accent = mount(() => <Chip tone="accent">keyword</Chip>);
    expect(accent.querySelector(".ui-chip--accent")).not.toBeNull();
    const neutral = mount(() => <Chip>fact</Chip>);
    expect(neutral.querySelector(".ui-chip--neutral")).not.toBeNull();
  });
});
