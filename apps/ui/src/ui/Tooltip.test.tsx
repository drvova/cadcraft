/**
 * The hint's contract: where the box goes (the preferred side, the flip, the hold inside the
 * window's edges), and when it shows: after the delay under a mouse, at once after another hint,
 * never under a finger, and away again on Escape and on a press. The box is one element on
 * `<body>`, hidden from assistive tech, and the wrapper only marks its host.
 */

import { describe, expect, test } from "bun:test";
import { HINT_DELAY_MS, placeHint, Tooltip } from "./Tooltip";
import { IconButton } from "./IconButton";
import { buttonIn, mount } from "../test-utils";

const VIEW = { width: 1280, height: 800 };
const BOX = { width: 100, height: 24 };
const GAP = 6;

describe("placeHint", () => {
  test("centres the box over the control on the preferred side", () => {
    const at = placeHint({ left: 600, top: 400, width: 24, height: 24 }, BOX, VIEW, "top", GAP);
    expect(at).toEqual({ left: 562, top: 370, placement: "top" });
    const under = placeHint({ left: 600, top: 400, width: 24, height: 24 }, BOX, VIEW, "bottom", GAP);
    expect(under).toEqual({ left: 562, top: 430, placement: "bottom" });
  });

  test("flips below a control at the window's top edge, and above one at its foot", () => {
    const titleBarKey = placeHint({ left: 600, top: 4, width: 24, height: 24 }, BOX, VIEW, "top", GAP);
    expect(titleBarKey.placement).toBe("bottom");
    expect(titleBarKey.top).toBe(34);
    const statusBarKey = placeHint({ left: 600, top: 776, width: 24, height: 20 }, BOX, VIEW, "bottom", GAP);
    expect(statusBarKey.placement).toBe("top");
    expect(statusBarKey.top).toBe(746);
  });

  test("holds the box inside the left and the right edge", () => {
    const first = placeHint({ left: 4, top: 400, width: 24, height: 24 }, BOX, VIEW, "top", GAP);
    expect(first.left).toBe(GAP);
    const last = placeHint({ left: 1252, top: 400, width: 24, height: 24 }, BOX, VIEW, "top", GAP);
    expect(last.left + BOX.width).toBe(VIEW.width - GAP);
  });

  test("a key in the top right corner asking for the top gets both: below the key, and inside the right edge", () => {
    const at = placeHint({ left: 1250, top: 5, width: 24, height: 24 }, BOX, VIEW, "top", GAP);
    expect(at).toEqual({ left: 1174, top: 35, placement: "bottom" });
  });

  test("a window with room on neither side keeps the preferred side, inside the window", () => {
    const at = placeHint({ left: 10, top: 4, width: 24, height: 24 }, BOX, { width: 200, height: 40 }, "top", GAP);
    expect(at.placement).toBe("top");
    expect(at.top).toBe(GAP);
  });

  test("a box wider than the window starts at the left gap", () => {
    const at = placeHint({ left: 100, top: 400, width: 24, height: 24 }, { width: 400, height: 24 }, { width: 320, height: 800 }, "top", GAP);
    expect(at.left).toBe(GAP);
  });
});

const box = (): HTMLElement | null => document.body.querySelector<HTMLElement>(":scope > .ui-tooltip");
const shown = (): boolean => box()?.classList.contains("ui-tooltip--shown") === true;
const over = (el: Element, pointerType: string): boolean => el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
const leave = (el: Element): boolean => el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }));
const afterDelay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, HINT_DELAY_MS + 50));

describe("the hint", () => {
  test("shows a key's name after the delay under a mouse, in one box hidden from assistive tech", async () => {
    const button = buttonIn(mount(() => <IconButton icon="close" title="Close the panel" />));
    over(button, "mouse");
    expect(shown()).toBe(false);
    await afterDelay();
    expect(shown()).toBe(true);
    expect(box()?.textContent).toBe("Close the panel");
    expect(box()?.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.querySelectorAll(".ui-tooltip").length).toBe(1);
    leave(button);
    expect(shown()).toBe(false);
  });

  test("the next key under the pointer shows at once, and Escape puts the hint away", async () => {
    const first = buttonIn(mount(() => <IconButton icon="plus" title="New chat" />));
    const second = buttonIn(mount(() => <IconButton icon="copy" title="Copy the code" />));
    over(first, "mouse");
    await afterDelay();
    expect(box()?.textContent).toBe("New chat");
    over(second, "mouse");
    expect(shown()).toBe(true);
    expect(box()?.textContent).toBe("Copy the code");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shown()).toBe(false);
    leave(second);
  });

  test("a press puts the hint away, and it stays away while the pointer rests on the key", async () => {
    const button = buttonIn(mount(() => <IconButton icon="send" title="Send" />));
    over(button, "mouse");
    await afterDelay();
    expect(shown()).toBe(true);
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    expect(shown()).toBe(false);
    over(button, "mouse");
    await afterDelay();
    expect(shown()).toBe(false);
    leave(button);
  });

  test("a press before the delay runs out cancels the hint", async () => {
    const button = buttonIn(mount(() => <IconButton icon="stop" title="Stop" />));
    await new Promise((resolve) => setTimeout(resolve, 350));
    over(button, "mouse");
    button.click();
    await afterDelay();
    expect(shown()).toBe(false);
    leave(button);
  });

  test("a finger never raises it", async () => {
    const button = buttonIn(mount(() => <IconButton icon="retry" title="Try again" />));
    over(button, "touch");
    await afterDelay();
    expect(shown()).toBe(false);
  });
});

describe("Tooltip", () => {
  test("marks a host around its child with the hint and the preferred side, and leaves the child alone", () => {
    const container = mount(() => (
      <Tooltip text="Full layer name" placement="top">
        <button type="button" aria-label="Layer">
          Layer
        </button>
      </Tooltip>
    ));
    const host = container.querySelector(".ui-tooltip-host");
    expect(host?.getAttribute("data-hint")).toBe("Full layer name");
    expect(host?.getAttribute("data-hint-placement")).toBe("top");
    const child = buttonIn(container);
    expect(child.parentElement).toBe(host as HTMLElement);
    expect(child.getAttribute("aria-label")).toBe("Layer");
    expect(child.hasAttribute("title")).toBe(false);
  });
});
