/**
 * IconButton's contract: a native button whose accessible name is the `title`, the same string
 * as the layer's hint and no native `title` beside it, the code-drawn glyph inside, the
 * size/variant classes, `aria-pressed` when selected, `aria-expanded` and `aria-controls` on a
 * fold key, `aria-haspopup` on a key that opens a popup, a shortcut as a key cap and
 * `aria-keyshortcuts`, a `description` as the hint's second line, and a disabled key that stays
 * focusable and takes no click by any means.
 */

import { describe, expect, test } from "bun:test";
import { IconButton } from "./IconButton";
import { hintContent } from "./Tooltip";
import { buttonIn, mount } from "../test-utils";

describe("IconButton", () => {
  test("renders a native button named by its title, with the drawn glyph", () => {
    const button = buttonIn(mount(() => <IconButton icon="close" title="Close the panel" />));
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Close the panel");
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

  test("a disabled icon button says so, stays focusable, and keeps its hint", () => {
    const button = buttonIn(mount(() => <IconButton icon="send" title="Send" disabled description="Type a message first" />));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(hintContent(button)).toEqual({ text: "Send", keys: "", note: "Type a message first" });
    const enabled = buttonIn(mount(() => <IconButton icon="send" title="Send" />));
    expect(enabled.hasAttribute("aria-disabled")).toBe(false);
  });

  test("a disabled icon button never runs its click: by pointer, by Enter or by Space", () => {
    let clicks = 0;
    let heardAbove = 0;
    const container = mount(() => <IconButton icon="close" title="Close" disabled onClick={() => clicks++} />);
    container.addEventListener("click", () => heardAbove++);
    const button = buttonIn(container);
    button.click();
    // A pointer's click, then the click the platform fires for Enter and for Space (detail 0).
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(clicks).toBe(0);
    expect(heardAbove).toBe(0);
  });

  test("the description is the hint's second line and the key's accessible description, never its name", () => {
    const button = buttonIn(mount(() => <IconButton icon="send" title="Send" description="Type a message first" />));
    expect(button.getAttribute("aria-label")).toBe("Send");
    expect(button.getAttribute("data-hint-note")).toBe("Type a message first");
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Type a message first");
    const plain = buttonIn(mount(() => <IconButton icon="send" title="Send" />));
    expect(plain.hasAttribute("data-hint-note")).toBe(false);
    expect(plain.hasAttribute("aria-describedby")).toBe(false);
  });

  test("a shortcut is a key cap in the hint and aria-keyshortcuts on the key", () => {
    const button = buttonIn(mount(() => <IconButton icon="undo" title="Undo" shortcut="Ctrl+Z" />));
    expect(button.getAttribute("aria-label")).toBe("Undo");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Z");
    expect(hintContent(button)).toEqual({ text: "Undo", keys: "Ctrl+Z", note: "" });
  });

  test("a title ending in its shortcut in brackets keeps its name and draws the cap", () => {
    const button = buttonIn(mount(() => <IconButton icon="undo" title="Undo (Ctrl+Z)" />));
    expect(button.getAttribute("aria-label")).toBe("Undo (Ctrl+Z)");
    expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(hintContent(button)).toEqual({ text: "Undo", keys: "Ctrl+Z", note: "" });
    const bracket = buttonIn(mount(() => <IconButton icon="attach" title="Attach a picture (or paste, or drop one)" />));
    expect(hintContent(bracket)).toEqual({ text: "Attach a picture (or paste, or drop one)", keys: "", note: "" });
  });

  test("selected is announced as a pressed toggle", () => {
    const on = buttonIn(mount(() => <IconButton icon="list" title="List" selected />));
    expect(on.getAttribute("aria-pressed")).toBe("true");
    const off = buttonIn(mount(() => <IconButton icon="list" title="List" selected={false} />));
    expect(off.getAttribute("aria-pressed")).toBe("false");
    const plain = buttonIn(mount(() => <IconButton icon="list" title="List" />));
    expect(plain.hasAttribute("aria-pressed")).toBe(false);
  });

  test("a fold key announces whether its region is showing, and which region it is", () => {
    const open = buttonIn(mount(() => <IconButton icon="chevron-down" title="Fold the layers" expanded controls="layers-body" />));
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.getAttribute("aria-controls")).toBe("layers-body");
    expect(open.hasAttribute("aria-pressed")).toBe(false);
    const folded = buttonIn(mount(() => <IconButton icon="chevron-down" title="Unfold the layers" expanded={false} controls="layers-body" />));
    expect(folded.getAttribute("aria-expanded")).toBe("false");
    expect(folded.getAttribute("aria-controls")).toBe("layers-body");
  });

  test("a key that folds nothing carries neither disclosure attribute", () => {
    const plain = buttonIn(mount(() => <IconButton icon="close" title="Close" />));
    expect(plain.hasAttribute("aria-expanded")).toBe(false);
    expect(plain.hasAttribute("aria-controls")).toBe(false);
  });

  test("the title is the layer's hint, and no native title doubles it", () => {
    const button = buttonIn(mount(() => <IconButton icon="close" title="Close the panel" />));
    expect(button.getAttribute("data-hint")).toBe("Close the panel");
    expect(button.hasAttribute("title")).toBe(false);
  });

  test("a key that opens a popup says which kind, and whether it is open", () => {
    const menu = buttonIn(mount(() => <IconButton icon="list" title="Main menu" popup="menu" expanded={false} />));
    expect(menu.getAttribute("aria-haspopup")).toBe("menu");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(menu.hasAttribute("aria-pressed")).toBe(false);
    const open = buttonIn(mount(() => <IconButton icon="list" title="Main menu" popup="menu" expanded controls="main-menu" />));
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.getAttribute("aria-controls")).toBe("main-menu");
    const dialog = buttonIn(mount(() => <IconButton icon="plus" title="Provider settings" popup="dialog" expanded={false} />));
    expect(dialog.getAttribute("aria-haspopup")).toBe("dialog");
    const listbox = buttonIn(mount(() => <IconButton icon="chevron-down" title="Pick a model" popup="listbox" expanded={false} />));
    expect(listbox.getAttribute("aria-haspopup")).toBe("listbox");
  });

  test("a key that opens nothing carries no popup attribute", () => {
    const plain = buttonIn(mount(() => <IconButton icon="close" title="Close" />));
    expect(plain.hasAttribute("aria-haspopup")).toBe(false);
  });
});
