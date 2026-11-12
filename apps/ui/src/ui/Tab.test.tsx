/**
 * Tab's contract: a native button with the tab role, `selected` announced as `aria-selected`,
 * the size classes, a click that runs, and a close key that exists only with `onClose`, is named
 * by `closeLabel`, and never runs the tab's own click.
 */

import { describe, expect, test } from "bun:test";
import { Tab } from "./Tab";
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
});
