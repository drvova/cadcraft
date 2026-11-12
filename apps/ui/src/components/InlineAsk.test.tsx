/**
 * The inline ask's contract: one named line over the drawing that shares the chat's draft, sends
 * on Enter only when there is something to send, and keeps its Escape to itself.
 */

import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { InlineAsk, inlineAskExample, offerLabel, selectedLabel } from "./InlineAsk";
import { inputIn, mount, type } from "../test-utils";

function harness(initial: { open?: boolean; selected?: number; ready?: boolean; draft?: string; offer?: boolean } = {}) {
  const [draft, setDraft] = createSignal(initial.draft ?? "");
  const log: string[] = [];
  const container = mount(() => (
    <InlineAsk
      open={initial.open ?? true}
      // The harness's hyperscript reads an accessor passed as a prop, so the value stays live.
      draft={draft as unknown as string}
      onDraft={setDraft}
      selected={initial.selected ?? 0}
      ready={initial.ready ?? true}
      onSend={() => log.push(`send:${draft()}`)}
      onClose={() => log.push("close")}
      offer={initial.offer ?? true}
      onOpen={() => log.push("open")}
      shortcut="Ctrl+K"
    />
  ));
  return { container, draft, log };
}

const key = (el: Element, name: string): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
};

describe("InlineAsk", () => {
  test("closed with nothing selected, it renders nothing", () => {
    const { container } = harness({ open: false });
    expect(container.querySelector(".inline-ask")).toBeNull();
  });

  test("closed over a selection, it offers itself: one button that opens the line", () => {
    const { container, log } = harness({ open: false, selected: 3 });
    const offer = container.querySelector("button");
    expect(offer?.textContent).toContain("Ask about 3 selected objects");
    expect(container.querySelector("input")).toBeNull();
    offer?.click();
    expect(log).toEqual(["open"]);
    expect(offerLabel(1)).toBe("Ask about 1 selected object");
  });

  test("the offer stands down while a command runs", () => {
    const { container } = harness({ open: false, selected: 3, offer: false });
    expect(container.querySelector("button")).toBeNull();
  });

  test("open, it is a named group holding one named field", () => {
    const { container } = harness();
    const group = container.querySelector("[role='group']");
    expect(group?.getAttribute("aria-label")).toBe("Ask the assistant");
    expect(inputIn(container).getAttribute("aria-label")).toBe("Ask the assistant about this drawing");
  });

  test("typing writes the chat's draft, and Enter sends it", () => {
    const { container, draft, log } = harness();
    const input = inputIn(container);
    type(input, "Make the band 3 mm wide");
    expect(draft()).toBe("Make the band 3 mm wide");
    const enter = key(input, "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(log).toEqual(["send:Make the band 3 mm wide"]);
  });

  test("an empty or blank line sends nothing, and its send key is off", () => {
    const { container, log } = harness({ draft: "   " });
    key(inputIn(container), "Enter");
    expect(log).toEqual([]);
    const send = container.querySelector<HTMLButtonElement>("button[aria-label='Send to the assistant']");
    // Off, and still focusable so its hint can say why.
    expect(send?.getAttribute("aria-disabled")).toBe("true");
    send?.click();
    expect(log).toEqual([]);
  });

  test("Escape closes the line and does not reach the shell", () => {
    const { container, log } = harness({ draft: "half a thought" });
    let reached = false;
    const listener = (): void => {
      reached = true;
    };
    window.addEventListener("keydown", listener);
    const escape = key(inputIn(container), "Escape");
    window.removeEventListener("keydown", listener);
    expect(log).toEqual(["close"]);
    expect(escape.defaultPrevented).toBe(true);
    expect(reached).toBe(false);
  });

  test("the selection rides along and says how much it is", () => {
    expect(harness({ selected: 0 }).container.textContent).not.toContain("selected");
    expect(harness({ selected: 3 }).container.textContent).toContain("3 selected");
    expect(selectedLabel(1284)).toBe("1,284 selected");
  });

  test("the example is about the selection when there is one", () => {
    expect(inputIn(harness({ selected: 2 }).container).placeholder).toBe(inlineAskExample(2));
    expect(inlineAskExample(0)).not.toBe(inlineAskExample(2));
  });
});
