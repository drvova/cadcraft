/**
 * Toggle's contract: a native button that says its state with `aria-pressed` under a name that
 * does not change, the glyph that changes with the state (or the word of a text face), the tone
 * and size classes, a hint for the eye that is never a native `title` and never the name, a
 * shortcut as a key cap and `aria-keyshortcuts`, a value the caller owns, a disabled toggle that
 * stays focusable and takes no press by any means, and a `tabIndex` the component leaves to a
 * container that roves.
 */

import { describe, expect, test } from "bun:test";
import { Toggle } from "./Toggle";
import { hintContent } from "./Tooltip";
import { iconPath } from "../icons";
import { buttonIn, mount } from "../test-utils";

const glyphOf = (button: HTMLButtonElement): string | null => button.querySelector("svg.tool-icon path")?.getAttribute("d") ?? null;

describe("Toggle", () => {
  test("renders a native button with a fixed name and its state in aria-pressed", () => {
    const off = buttonIn(mount(() => <Toggle pressed={false} icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Freeze" />));
    expect(off.tagName).toBe("BUTTON");
    expect(off.getAttribute("type")).toBe("button");
    expect(off.getAttribute("aria-label")).toBe("Outline frozen");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    const on = buttonIn(mount(() => <Toggle pressed icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Thaw" />));
    expect(on.getAttribute("aria-label")).toBe("Outline frozen");
    expect(on.getAttribute("aria-pressed")).toBe("true");
  });

  test("the glyph is the off icon while off and the on icon while on, one at a time, hidden from assistive tech", () => {
    const off = buttonIn(mount(() => <Toggle pressed={false} icon="layer.unlocked" iconOn="layer.locked" ariaLabel="Outline locked" />));
    expect(glyphOf(off)).toBe(iconPath("layer.unlocked"));
    expect(off.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const on = buttonIn(mount(() => <Toggle pressed icon="layer.unlocked" iconOn="layer.locked" ariaLabel="Outline locked" />));
    expect(glyphOf(on)).toBe(iconPath("layer.locked"));
    expect(on.querySelectorAll("svg").length).toBe(1);
  });

  test("a glyph with no second icon keeps the one it has when on", () => {
    const button = buttonIn(mount(() => <Toggle pressed icon="eye" ariaLabel="Preview" />));
    expect(glyphOf(button)).toBe(iconPath("eye"));
  });

  test("defaults to the glyph face at md in the neutral tone, and renders each size and tone", () => {
    const plain = buttonIn(mount(() => <Toggle pressed={false} icon="eye" ariaLabel="Preview" />));
    expect(plain.className).toBe("ui-toggle ui-toggle--glyph ui-toggle--md ui-toggle--neutral");
    for (const tone of ["neutral", "absent", "info", "caution"] as const) {
      const button = buttonIn(mount(() => <Toggle pressed={false} icon="eye" ariaLabel="Preview" size="sm" tone={tone} />));
      expect(button.className).toBe(`ui-toggle ui-toggle--glyph ui-toggle--sm ui-toggle--${tone}`);
    }
  });

  test("a text face shows its word, takes no glyph and no tone, and is named by ariaLabel when the word is short for it", () => {
    const button = buttonIn(
      mount(() => (
        <Toggle variant="text" size="sm" tone="caution" pressed ariaLabel="Snap mode">
          Snap
        </Toggle>
      )),
    );
    expect(button.textContent).toBe("Snap");
    expect(button.querySelector("svg")).toBeNull();
    expect(button.className).toBe("ui-toggle ui-toggle--text ui-toggle--sm ui-toggle--neutral");
    expect(button.getAttribute("aria-label")).toBe("Snap mode");
    const worded = buttonIn(
      mount(() => (
        <Toggle variant="text" pressed={false}>
          Grid
        </Toggle>
      )),
    );
    expect(worded.hasAttribute("aria-label")).toBe(false);
  });

  test("a press reports the state it asks for, after the click, and never flips the toggle itself", () => {
    const heard: string[] = [];
    const off = buttonIn(
      mount(() => <Toggle pressed={false} icon="eye" ariaLabel="Preview" onClick={() => heard.push("click")} onChange={(next) => heard.push(String(next))} />),
    );
    off.click();
    expect(heard).toEqual(["click", "true"]);
    // The caller owns the value: until it passes the new one, the toggle shows the old.
    expect(off.getAttribute("aria-pressed")).toBe("false");
    const on = buttonIn(mount(() => <Toggle pressed icon="eye" ariaLabel="Preview" onChange={(next) => heard.push(String(next))} />));
    on.click();
    expect(heard).toEqual(["click", "true", "false"]);
  });

  test("a change the caller refuses does not stay drawn", () => {
    const button = buttonIn(mount(() => <Toggle pressed icon="layer.off" iconOn="layer.on" ariaLabel="0 on" onChange={() => undefined} />));
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(glyphOf(button)).toBe(iconPath("layer.on"));
  });

  test("the hint is the layer's, with the shortcut as a key cap, and no native title", () => {
    const button = buttonIn(
      mount(() => (
        <Toggle variant="text" pressed={false} ariaLabel="Snap mode" hint="Snap mode" shortcut="F9" placement="top">
          Snap
        </Toggle>
      )),
    );
    expect(button.hasAttribute("title")).toBe(false);
    expect(hintContent(button)).toEqual({ text: "Snap mode", keys: "F9", note: "" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("F9");
    expect(button.getAttribute("data-hint-placement")).toBe("top");
    const bare = buttonIn(mount(() => <Toggle pressed={false} icon="eye" ariaLabel="Preview" />));
    expect(bare.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(bare.hasAttribute("data-hint-placement")).toBe(false);
  });

  test("the hint is for the eye and never the description; a description is tied to the toggle", async () => {
    const hinted = buttonIn(mount(() => <Toggle pressed icon="layer.thawed" iconOn="layer.frozen" ariaLabel="Outline frozen" hint="Thaw" />));
    await Promise.resolve();
    expect(hinted.getAttribute("data-hint")).toBe("Thaw");
    expect(hinted.hasAttribute("aria-describedby")).toBe(false);
    const described = buttonIn(
      mount(() => <Toggle pressed={false} disabled icon="layer.thawed" ariaLabel="Outline frozen" hint="Freeze" description="The current layer cannot be frozen" />),
    );
    await Promise.resolve();
    const id = described.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe("The current layer cannot be frozen");
    expect(hintContent(described)).toEqual({ text: "Freeze", keys: "", note: "The current layer cannot be frozen" });
  });

  test("a disabled toggle says so, stays focusable, and never runs its press: by pointer, by Enter or by Space", () => {
    let presses = 0;
    let heardAbove = 0;
    const container = mount(() => <Toggle pressed={false} disabled icon="eye" ariaLabel="Preview" onClick={() => presses++} onChange={() => presses++} />);
    container.addEventListener("click", () => heardAbove++);
    const button = buttonIn(container);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    button.click();
    // A pointer's click, then the click the platform fires for Enter and for Space (detail 0).
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(presses).toBe(0);
    expect(heardAbove).toBe(0);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const enabled = buttonIn(mount(() => <Toggle pressed={false} icon="eye" ariaLabel="Preview" />));
    expect(enabled.hasAttribute("aria-disabled")).toBe(false);
  });

  test("tabIndex passes through, and unset it writes no attribute, so a container that roves on the element is not undone", () => {
    const stop = buttonIn(mount(() => <Toggle pressed={false} icon="eye" ariaLabel="Preview" tabIndex={-1} />));
    expect(stop.getAttribute("tabindex")).toBe("-1");
    const roved = buttonIn(
      mount(() => (
        <Toggle variant="text" pressed={false}>
          Grid
        </Toggle>
      )),
    );
    expect(roved.hasAttribute("tabindex")).toBe(false);
    // What `rovingBand` does to every key but the group's one Tab stop; a press does not put it back.
    roved.tabIndex = -1;
    roved.click();
    expect(roved.tabIndex).toBe(-1);
  });
});
