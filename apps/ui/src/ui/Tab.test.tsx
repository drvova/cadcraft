/**
 * Tab's contract: a native button with the tab role, `selected` announced as `aria-selected`,
 * the size classes, a click that runs, and a close key that exists only with `onClose`, is named
 * by `closeLabel`, and never runs the tab's own click.
 */

import { describe, expect, test } from "bun:test";
import { Tab } from "./Tab";
import { buttonIn, mount } from "../test-utils";

describe("Tab", () => {
  test("renders a native button with the tab role and its label", () => {
    const container = mount(() => <Tab title="Switch to model space">Model</Tab>);
    const button = buttonIn(container);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("role")).toBe("tab");
    expect(button.getAttribute("title")).toBe("Switch to model space");
    expect(button.textContent).toBe("Model");
    expect(button.classList.contains("ui-tab")).toBe(true);
    expect(container.querySelectorAll("button").length).toBe(1);
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
