/**
 * Tab's contract: a native button with the tab role, `selected` announced as `aria-selected`,
 * the size classes, a click that runs, and a close key that exists only with `onClose`, is named
 * by `closeLabel`, and never runs the tab's own click.
 */

import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { Tab, TabPanels } from "./Tab";
import { hintContent } from "./Tooltip";
import { buttonIn, mount } from "../test-utils";

/** The text assistive tech reads as the control's description: what its `aria-describedby` points at. */
const descriptionOf = (el: Element): string | null => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

describe("Tab", () => {
  test("renders a native button with the tab role and its label", () => {
    const container = mount(() => <Tab title="Switch to model space">Model</Tab>);
    const button = buttonIn(container);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("role")).toBe("tab");
    expect(button.textContent).toBe("Model");
    expect(button.classList.contains("ui-tab")).toBe(true);
    expect(container.querySelectorAll("button").length).toBe(1);
  });

  test("the title is the layer's hint and the tab's description, never a native title or its name", () => {
    const button = buttonIn(mount(() => <Tab title="Switch to model space">Model</Tab>));
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.getAttribute("data-hint")).toBe("Switch to model space");
    expect(descriptionOf(button)).toBe("Switch to model space");
  });

  test("a title that repeats the label is no description and no hint, until the label is clipped", async () => {
    const button = buttonIn(mount(() => <Tab title="Summarise the layers">Summarise the layers</Tab>));
    await Promise.resolve();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(hintContent(button)).toBeNull();
    Object.defineProperty(button, "scrollWidth", { value: 300 });
    Object.defineProperty(button, "clientWidth", { value: 120 });
    expect(hintContent(button)).toEqual({ text: "Summarise the layers", keys: "", note: "" });
  });

  test("a clipped tab with no title still shows its full label, and one with a title keeps it as the second line", () => {
    const bare = buttonIn(mount(() => <Tab>Ground floor plan, revision C</Tab>));
    expect(bare.getAttribute("data-hint")).toBe("");
    expect(hintContent(bare)).toBeNull();
    Object.defineProperty(bare, "scrollWidth", { value: 300 });
    Object.defineProperty(bare, "clientWidth", { value: 120 });
    expect(hintContent(bare)?.text).toBe("Ground floor plan, revision C");
    const titled = buttonIn(mount(() => <Tab title="Switch to this layout">Ground floor plan, revision C</Tab>));
    Object.defineProperty(titled, "scrollWidth", { value: 300 });
    Object.defineProperty(titled, "clientWidth", { value: 120 });
    expect(hintContent(titled)).toEqual({ text: "Ground floor plan, revision C", keys: "", note: "Switch to this layout" });
  });

  test("selected is announced as aria-selected, true or false", () => {
    const front = buttonIn(mount(() => <Tab selected>Model</Tab>));
    expect(front.getAttribute("aria-selected")).toBe("true");
    const behind = buttonIn(mount(() => <Tab>Layout1</Tab>));
    expect(behind.getAttribute("aria-selected")).toBe("false");
  });

  test("renders each size, md by default", () => {
    const medium = buttonIn(mount(() => <Tab>Model</Tab>));
    expect(medium.classList.contains("ui-tab--md")).toBe(true);
    const small = buttonIn(mount(() => <Tab size="sm">Chat</Tab>));
    expect(small.classList.contains("ui-tab--sm")).toBe(true);
    expect(small.classList.contains("ui-tab--md")).toBe(false);
  });

  test("runs the click", () => {
    let clicks = 0;
    const button = buttonIn(mount(() => <Tab onClick={() => clicks++}>Layout1</Tab>));
    button.click();
    expect(clicks).toBe(1);
  });

  test("the close key is a sibling button named by closeLabel", () => {
    const container = mount(() => (
      <Tab size="sm" onClose={() => undefined} closeLabel="Close Sketch">
        Sketch
      </Tab>
    ));
    expect(container.querySelectorAll("button").length).toBe(2);
    const tab = buttonIn(container);
    const close = container.querySelector<HTMLButtonElement>("button:not([role='tab'])");
    if (close === null) throw new Error("no close key was rendered");
    expect(tab.getAttribute("role")).toBe("tab");
    expect(tab.querySelector("button")).toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close Sketch");
    expect(close.hasAttribute("role")).toBe(false);
    expect(close.parentElement).toBe(tab.parentElement);
    expect(tab.parentElement?.classList.contains("ui-tab-closable--sm")).toBe(true);
  });

  test("the close key runs onClose and not the tab's click", () => {
    let clicks = 0;
    let closes = 0;
    const container = mount(() => (
      <Tab onClick={() => clicks++} onClose={() => closes++}>
        Sketch
      </Tab>
    ));
    const close = container.querySelector<HTMLButtonElement>("button[aria-label='Close']");
    expect(close).not.toBeNull();
    close?.click();
    expect(closes).toBe(1);
    expect(clicks).toBe(0);
    buttonIn(container).click();
    expect(clicks).toBe(1);
    expect(closes).toBe(1);
  });

  test("id, controls and tabIndex are written only when the caller passes them", () => {
    const plain = buttonIn(mount(() => <Tab>Model</Tab>));
    expect(plain.hasAttribute("id")).toBe(false);
    expect(plain.hasAttribute("aria-controls")).toBe(false);
    const wired = buttonIn(
      mount(() => (
        <Tab id="tab-model" controls="panel-model" tabIndex={-1}>
          Model
        </Tab>
      )),
    );
    expect(wired.id).toBe("tab-model");
    expect(wired.getAttribute("aria-controls")).toBe("panel-model");
    expect(wired.tabIndex).toBe(-1);
  });
});

/** Three pages in a strip whose selection the test holds, as a dialog does. */
function pages(start = "grid"): { container: HTMLElement; asked: string[]; tabs: () => HTMLButtonElement[]; panels: () => HTMLElement[] } {
  const asked: string[] = [];
  const [selected, setSelected] = createSignal(start);
  // Called as a function with a getter, the way Solid's own compiler passes a reactive prop.
  const container = mount(() =>
    TabPanels({
      ariaLabel: "Drafting settings",
      get selected() {
        return selected();
      },
      onChange: (id) => {
        asked.push(id);
        setSelected(id);
      },
      panels: [
        { id: "grid", label: "Snap and Grid", content: () => <p>grid page</p> },
        { id: "polar", label: "Polar Tracking", content: () => <p>polar page</p> },
        { id: "osnap", label: "Object Snap", content: () => <p>osnap page</p> },
      ],
    }),
  );
  return {
    container,
    asked,
    tabs: () => [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")],
    panels: () => [...container.querySelectorAll<HTMLElement>("[role='tabpanel']")],
  };
}

const press = (el: Element, key: string, init: KeyboardEventInit = {}): boolean => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

describe("TabPanels", () => {
  test("renders a named strip of compact tabs, each tied both ways to its own panel", () => {
    const { container, tabs, panels } = pages();
    const strip = container.querySelector("[role='tablist']");
    expect(strip?.getAttribute("aria-label")).toBe("Drafting settings");
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Snap and Grid", "Polar Tracking", "Object Snap"]);
    expect(tabs().every((tab) => tab.parentElement === strip && tab.classList.contains("ui-tab--sm"))).toBe(true);
    expect(panels().length).toBe(3);
    tabs().forEach((tab, index) => {
      const panel = panels()[index];
      expect(tab.id).not.toBe("");
      expect(tab.getAttribute("aria-controls")).toBe(panel?.id ?? null);
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    });
    expect(new Set([...tabs(), ...panels()].map((el) => el.id)).size).toBe(6);
  });

  test("two strips on one page never share an id", () => {
    const a = pages();
    const b = pages();
    const ids = [...a.tabs(), ...a.panels(), ...b.tabs(), ...b.panels()].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the page in front is the only one showing, and its tab the strip's one Tab stop", () => {
    const { tabs, panels } = pages("polar");
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    expect(panels().map((panel) => panel.hidden)).toEqual([true, false, true]);
    // A page behind is kept, not removed: what was typed in it is still there.
    expect(panels().map((panel) => panel.textContent)).toEqual(["grid page", "polar page", "osnap page"]);
  });

  test("a click asks for that page", () => {
    const { tabs, asked } = pages();
    tabs()[2]?.click();
    expect(asked).toEqual(["osnap"]);
  });

  test("the arrows, Home and End ask for a page and move the focus to its tab, wrapping at the ends", () => {
    const { tabs, asked } = pages();
    const [grid, polar, osnap] = tabs();
    if (grid === undefined || polar === undefined || osnap === undefined) throw new Error("no tabs");
    grid.focus();
    const right = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    grid.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(polar);
    press(polar, "End");
    expect(document.activeElement).toBe(osnap);
    press(osnap, "ArrowRight");
    expect(document.activeElement).toBe(grid);
    press(grid, "ArrowLeft");
    expect(document.activeElement).toBe(osnap);
    press(osnap, "Home");
    expect(document.activeElement).toBe(grid);
    expect(asked).toEqual(["polar", "osnap", "grid", "osnap", "grid"]);
  });

  test("a key that is not the strip's, or one held with a modifier, is left alone", () => {
    const { tabs, asked } = pages();
    const grid = tabs()[0];
    if (grid === undefined) throw new Error("no tabs");
    for (const [key, init] of [["ArrowDown", {}], ["a", {}], ["Tab", {}], ["ArrowRight", { ctrlKey: true }], ["ArrowRight", { altKey: true }], ["Home", { shiftKey: true }]] as const) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      grid.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(asked).toEqual([]);
  });
});
