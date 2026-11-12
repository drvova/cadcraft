/**
 * Select's contract: a native select with its accessible name and the caller's choices, the value
 * the caller owns (a pick it refuses is put back), a value the list lacks kept as one more
 * option, the mixed state as a placeholder that is no choice, the refused and disabled states,
 * and the drawn value a clipped hint reads in full.
 */

import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { Select, type SelectOption } from "./Select";
import { HINT_WARM_MS, hintContent } from "./Tooltip";
import { mount } from "../test-utils";

const LAYERS: readonly SelectOption[] = [
  { value: "0", label: "0" },
  { value: "walls", label: "Walls" },
  { value: "frozen", label: "Frozen layer", disabled: true },
];

function selectIn(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector("select");
  if (select === null) throw new Error("no <select> was rendered");
  return select;
}

/** Picks `value` the way the platform does: the element's value changes, then `change` fires. */
function pick(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

const shown = (container: HTMLElement): string => container.querySelector(".ui-select-value")?.textContent ?? "";

describe("Select", () => {
  test("renders a named native select with the caller's choices and value", () => {
    const container = mount(() => <Select value="walls" options={LAYERS} ariaLabel="Layer" />);
    const select = selectIn(container);
    expect(select.getAttribute("aria-label")).toBe("Layer");
    expect([...select.options].map((option) => option.value)).toEqual(["0", "walls", "frozen"]);
    expect(select.value).toBe("walls");
    expect(select.options[2]?.disabled).toBe(true);
    expect(shown(container)).toBe("Walls");
  });

  test("reports a pick with its value and follows the caller's new value", () => {
    const picked: string[] = [];
    const [value, setValue] = createSignal("0");
    // Called as a function with a getter, the way Solid's own compiler passes a reactive prop.
    const container = mount(() =>
      Select({
        get value() {
          return value();
        },
        options: LAYERS,
        ariaLabel: "Layer",
        onChange: (next) => {
          picked.push(next);
          setValue(next);
        },
      }),
    );
    pick(selectIn(container), "walls");
    expect(picked).toEqual(["walls"]);
    expect(selectIn(container).value).toBe("walls");
  });

  test("a pick the caller does not take is put back", () => {
    const container = mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" onChange={() => undefined} />);
    pick(selectIn(container), "walls");
    expect(selectIn(container).value).toBe("0");
  });

  test("a value the list lacks is kept as one more option at the top", () => {
    const container = mount(() => <Select value="deleted" options={LAYERS} ariaLabel="Layer" />);
    const select = selectIn(container);
    expect([...select.options].map((option) => option.value)).toEqual(["deleted", "0", "walls", "frozen"]);
    expect(select.value).toBe("deleted");
    expect(shown(container)).toBe("deleted");
  });

  test("mixed shows the placeholder, which is not a choice", () => {
    const container = mount(() => <Select value="walls" mixed placeholder="*VARIES*" options={LAYERS} ariaLabel="Layer" />);
    const select = selectIn(container);
    const first = select.options[0];
    expect(first?.textContent?.trim()).toBe("*VARIES*");
    expect(first?.disabled).toBe(true);
    expect(first?.hidden).toBe(true);
    expect(first?.selected).toBe(true);
    expect(select.value).toBe("");
    expect(select.options.length).toBe(LAYERS.length + 1);
    expect(shown(container)).toBe("*VARIES*");
    expect(container.querySelector(".ui-select")?.classList.contains("ui-select--mixed")).toBe(true);
  });

  test("the first pick out of a mixed state is reported", () => {
    const picked: string[] = [];
    const container = mount(() => <Select mixed placeholder="*VARIES*" options={LAYERS} ariaLabel="Layer" onChange={(next) => picked.push(next)} />);
    pick(selectIn(container), "walls");
    expect(picked).toEqual(["walls"]);
  });

  test("variant, size and align name the recipe, with field, md and start the defaults", () => {
    const plain = mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" />).querySelector(".ui-select");
    expect(plain?.className).toBe("ui-select ui-select--field ui-select--md ui-select--start");
    const row = mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" variant="inline" size="sm" align="end" />).querySelector(".ui-select");
    expect(row?.className).toBe("ui-select ui-select--inline ui-select--sm ui-select--end");
  });

  test("disabled blocks the list", () => {
    const container = mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" disabled />);
    expect(selectIn(container).disabled).toBe(true);
    expect(container.querySelector(".ui-select")?.classList.contains("ui-select--disabled")).toBe(true);
  });

  test("a refused value is announced invalid, and only then", () => {
    const refused = selectIn(mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" invalid />));
    expect(refused.getAttribute("aria-invalid")).toBe("true");
    const fine = selectIn(mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" />));
    expect(fine.hasAttribute("aria-invalid")).toBe(false);
  });

  test("ties the help line to the select, then the title's words, and renders no native title", () => {
    const select = selectIn(mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" describedBy="layer-help" title="New objects go on this layer" />));
    expect(select.hasAttribute("title")).toBe(false);
    const [own, hint] = (select.getAttribute("aria-describedby") ?? "").split(" ");
    expect(own).toBe("layer-help");
    expect(document.getElementById(hint ?? "")?.textContent).toBe("New objects go on this layer");
    const plain = selectIn(mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" />));
    expect(plain.hasAttribute("aria-describedby")).toBe(false);
  });

  test("id is the native select's own, for a visible label's for; without it no attribute is written", () => {
    expect(selectIn(mount(() => <Select id="polar-angle" value="0" options={LAYERS} />)).id).toBe("polar-angle");
    expect(selectIn(mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" />)).hasAttribute("id")).toBe(false);
  });

  test("the face is hidden from assistive tech, which reads the select itself", () => {
    const container = mount(() => <Select value="0" options={LAYERS} ariaLabel="Layer" />);
    expect(container.querySelector(".ui-select-value")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".ui-select-arrow")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".ui-select-arrow svg")).not.toBeNull();
  });

  test("the hint is nothing while the value fits, and the full value once it is clipped", () => {
    const container = mount(() => <Select value="walls" options={LAYERS} ariaLabel="Layer" title="New objects go on this layer" />);
    const host = container.querySelector(".ui-select");
    const value = container.querySelector(".ui-select-value");
    if (host === null || value === null) throw new Error("no select was rendered");
    expect(hintContent(host)).toEqual({ text: "New objects go on this layer", keys: "", note: "" });
    const untitled = mount(() => <Select value="walls" options={LAYERS} ariaLabel="Layer" />).querySelector(".ui-select");
    if (untitled === null) throw new Error("no select was rendered");
    expect(hintContent(untitled)).toBeNull();
    Object.defineProperty(value, "scrollWidth", { value: 300 });
    Object.defineProperty(value, "clientWidth", { value: 80 });
    // The label is the value shown, not every choice the select holds.
    expect(hintContent(host)).toEqual({ text: "Walls", keys: "", note: "New objects go on this layer" });
  });

  test("the hint a key brought goes away at the key that opens the list, and stays for Tab and a bare modifier", async () => {
    const select = selectIn(mount(() => <Select value="walls" options={LAYERS} ariaLabel="Layer" title="New objects go on this layer" />));
    const shown = (): boolean => document.body.querySelector(":scope > .ui-tooltip")?.classList.contains("ui-tooltip--shown") === true;
    const key = (name: string): boolean => select.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    select.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shown()).toBe(true);
    key("Shift");
    expect(shown()).toBe(true);
    key(" ");
    expect(shown()).toBe(false);
    select.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    select.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shown()).toBe(true);
    key("ArrowDown");
    expect(shown()).toBe(false);
    select.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    // The next hint in the document arrives without its delay for a moment after one went away.
    await new Promise((resolve) => setTimeout(resolve, HINT_WARM_MS + 20));
  });
});
