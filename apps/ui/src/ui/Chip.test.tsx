/**
 * Chip's contract: the interactive form is a real `<button>` and the static form is a `<span>`
 * that takes no click; tone classes come from the prop.
 */

import { describe, expect, test } from "bun:test";
import { Chip } from "./Chip";
import { hintContent } from "./Tooltip";
import { buttonIn, mount } from "../test-utils";

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

  test("the title is the layer's hint and the interactive chip's description, never a native title or its name", () => {
    const button = buttonIn(mount(() => <Chip title="Use gpt-5.1" onClick={() => undefined}>gpt-5.1</Chip>));
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.textContent).toBe("gpt-5.1");
    expect(button.getAttribute("data-hint")).toBe("Use gpt-5.1");
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Use gpt-5.1");
    const fact = mount(() => <Chip title="Counted on every layer">26 objects</Chip>).querySelector("span.ui-chip");
    expect(fact?.hasAttribute("title")).toBe(false);
    expect(fact?.getAttribute("data-hint")).toBe("Counted on every layer");
  });

  test("a chip whose title repeats its text has no hint, and a clipped one shows its full text", () => {
    const button = buttonIn(mount(() => <Chip title="gpt-5.1-codex-max" onClick={() => undefined}>gpt-5.1-codex-max</Chip>));
    expect(hintContent(button)).toBeNull();
    Object.defineProperty(button, "scrollWidth", { value: 200 });
    Object.defineProperty(button, "clientWidth", { value: 80 });
    expect(hintContent(button)?.text).toBe("gpt-5.1-codex-max");
  });

  test("tone picks the fill", () => {
    const accent = mount(() => <Chip tone="accent">keyword</Chip>);
    expect(accent.querySelector(".ui-chip--accent")).not.toBeNull();
    const neutral = mount(() => <Chip>fact</Chip>);
    expect(neutral.querySelector(".ui-chip--neutral")).not.toBeNull();
  });
});
