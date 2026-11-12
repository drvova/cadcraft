/**
 * The hint's contract: where the box goes (the preferred side, the flip, the hold inside the
 * window's edges), and when it shows: after the delay under a mouse, at once after another hint,
 * at once and unfaded for the next key along, at once when a key moves focus, never under a
 * finger, never as a repeat of the visible label, never behind a popup, and away again on Escape,
 * on a press and on typing. A shortcut is a key cap, from the attribute or the old bracket. The
 * box is one element on `<body>`, hidden from assistive tech, and the wrapper only marks its host.
 */

import { describe, expect, test } from "bun:test";
import { ariaKeyShortcuts, HINT_DELAY_MS, placeHint, splitHint, Tooltip } from "./Tooltip";
import { Field } from "./Field";
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
const key = (name: string): boolean => document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
const afterDelay =(): Promise<void> => new Promise((resolve) => setTimeout(resolve, HINT_DELAY_MS + 50));

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

  test("the next key along arrives without the fade, and a rested-on key with it", async () => {
    const first = buttonIn(mount(() => <IconButton icon="plus" title="New chat" />));
    const second = buttonIn(mount(() => <IconButton icon="copy" title="Copy the code" />));
    over(first, "mouse");
    await afterDelay();
    expect(box()?.classList.contains("ui-tooltip--instant")).toBe(false);
    over(document.body, "mouse");
    expect(shown()).toBe(false);
    over(second, "mouse");
    expect(shown()).toBe(true);
    expect(box()?.classList.contains("ui-tooltip--instant")).toBe(true);
    leave(second);
  });

  test("keyboard focus raises it at once, and focus a key did not move raises nothing", () => {
    const button = buttonIn(mount(() => <IconButton icon="close" title="Close the panel" />));
    key("Tab");
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shown()).toBe(true);
    expect(box()?.textContent).toBe("Close the panel");
    button.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(shown()).toBe(false);
    // A dialog closing on Escape hands focus back; a click focuses what it pressed.
    key("Escape");
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shown()).toBe(false);
    button.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    key("Tab");
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shown()).toBe(false);
    button.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

  test("focus moved by the keyboard wins over a key the pointer was left on", async () => {
    const rested = buttonIn(mount(() => <IconButton icon="plus" title="New chat" />));
    const focused = buttonIn(mount(() => <IconButton icon="copy" title="Copy the code" />));
    over(rested, "mouse");
    await afterDelay();
    key("Tab");
    focused.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(box()?.textContent).toBe("Copy the code");
    focused.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    leave(rested);
  });

  test("a hint that only repeats the visible label does not show", async () => {
    const container = mount(() => (
      <Tooltip text="  Check connection ">
        <button type="button">Check connection</button>
      </Tooltip>
    ));
    over(buttonIn(container), "mouse");
    await afterDelay();
    expect(shown()).toBe(false);
    leave(buttonIn(container));
    const adds = mount(() => (
      <Tooltip text="Check the address and the key">
        <button type="button">Check connection</button>
      </Tooltip>
    ));
    over(buttonIn(adds), "mouse");
    await afterDelay();
    expect(shown()).toBe(true);
    leave(buttonIn(adds));
  });

  test("a shortcut is drawn as a key cap after the text, from the attribute or from the old bracket", async () => {
    const explicit = buttonIn(mount(() => <IconButton icon="plus" title="Undo" shortcut="Ctrl+Z" />));
    over(explicit, "mouse");
    await afterDelay();
    const cap = box()?.querySelector("kbd.ui-kbd");
    expect(cap?.textContent).toBe("Ctrl+Z");
    expect(box()?.firstChild?.textContent).toBe("Undo");
    leave(explicit);
    const parsed = buttonIn(mount(() => <IconButton icon="plus" title="Snap Mode (F9)" />));
    over(parsed, "mouse");
    expect(box()?.querySelector("kbd.ui-kbd")?.textContent).toBe("F9");
    expect(box()?.firstChild?.textContent).toBe("Snap Mode");
    leave(parsed);
  });

  test("an element outside the layer gets the hint, the cap and the second line from the attributes alone", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<button type="button" class="status-toggle" aria-label="Snap Mode" data-hint="Snap Mode" data-hint-keys="F9" data-hint-note="Off in paper space">SNAP</button>';
    document.body.appendChild(container);
    const toggle = buttonIn(container);
    over(toggle, "mouse");
    await afterDelay();
    expect(shown()).toBe(true);
    expect(box()?.firstChild?.textContent).toBe("Snap Mode");
    expect(box()?.querySelector("kbd.ui-kbd")?.textContent).toBe("F9");
    expect(box()?.querySelector(".ui-tooltip-note")?.textContent).toBe("Off in paper space");
    leave(toggle);
  });

  test("a control with its own menu or dialog open shows no hint, nor does one behind a popup that holds focus", async () => {
    const opener = buttonIn(mount(() => <IconButton icon="list" title="Main menu" popup="menu" expanded />));
    over(opener, "mouse");
    await afterDelay();
    expect(shown()).toBe(false);
    leave(opener);
    // A fold key over a region in the page's flow is expanded too, and keeps its hint.
    const fold = buttonIn(mount(() => <IconButton icon="chevron-down" title="Hide the layers" expanded controls="layers-body" />));
    over(fold, "mouse");
    await afterDelay();
    expect(shown()).toBe(true);
    leave(fold);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const behind =buttonIn(mount(() => <IconButton icon="plus" title="New chat" />));
    const menu = mount(() => (
      <div role="menu">
        <IconButton icon="copy" title="Copy the code" />
      </div>
    ));
    const inside = buttonIn(menu);
    inside.focus();
    over(behind, "mouse");
    await afterDelay();
    expect(shown()).toBe(false);
    over(inside, "mouse");
    await afterDelay();
    expect(shown()).toBe(true);
    leave(inside);
    inside.blur();
  });

  test("typing puts it away", () => {
    const container = mount(() => <Field ariaLabel="Base URL" title="Ends in /v1 for most servers" />);
    const input = container.querySelector("input") as HTMLInputElement;
    key("Tab");
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shown()).toBe(true);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "h" }));
    expect(shown()).toBe(false);
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

  test("a disabled key still shows its hint, with the reason on the second line", async () => {
    const button = buttonIn(mount(() => <IconButton icon="send" title="Send" disabled description="Type a message first" />));
    over(button, "mouse");
    await afterDelay();
    expect(shown()).toBe(true);
    expect(box()?.querySelector(".ui-tooltip-note")?.textContent).toBe("Type a message first");
    leave(button);
  });
});

describe("splitHint and ariaKeyShortcuts", () => {
  test("a trailing shortcut in brackets is split off, on either platform's spelling", () => {
    expect(splitHint("Undo (Ctrl+Z)")).toEqual({ text: "Undo", keys: "Ctrl+Z" });
    expect(splitHint("Redo (Ctrl+Shift+Z)")).toEqual({ text: "Redo", keys: "Ctrl+Shift+Z" });
    expect(splitHint("Snap Mode (F9)")).toEqual({ text: "Snap Mode", keys: "F9" });
    expect(splitHint("Redo (⇧⌘Z)")).toEqual({ text: "Redo", keys: "⇧⌘Z" });
  });

  test("a bracket that is not a shortcut stays in the text", () => {
    expect(splitHint("Attach a picture (or paste, or drop one)")).toEqual({ text: "Attach a picture (or paste, or drop one)", keys: undefined });
    expect(splitHint("Layout (2 of 3)")).toEqual({ text: "Layout (2 of 3)", keys: undefined });
    expect(splitHint("Close")).toEqual({ text: "Close", keys: undefined });
    expect(splitHint("")).toEqual({ text: "", keys: undefined });
  });

  test("a shortcut is spelled for aria-keyshortcuts", () => {
    expect(ariaKeyShortcuts("Ctrl+Shift+P")).toBe("Control+Shift+P");
    expect(ariaKeyShortcuts("Cmd+B")).toBe("Meta+B");
    expect(ariaKeyShortcuts("F9")).toBe("F9");
    expect(ariaKeyShortcuts("Esc")).toBe("Escape");
    expect(ariaKeyShortcuts("⇧⌘Z")).toBe("Shift+Meta+Z");
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
