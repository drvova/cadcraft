/**
 * Checkbox's contract: a native checkbox inside its label, named by the label or by `ariaLabel`,
 * the value the caller owns (a press it refuses does not stay drawn), the mixed state on the
 * element's own property and in ARIA, and a disabled box that takes no press.
 */

import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { Checkbox } from "./Checkbox";
import { inputIn, mount } from "../test-utils";

describe("Checkbox", () => {
  test("renders a native checkbox inside its label, named by the label's words", () => {
    const container = mount(() => <Checkbox checked>Show the grid</Checkbox>);
    const input = inputIn(container);
    expect(input.getAttribute("type")).toBe("checkbox");
    expect(input.checked).toBe(true);
    const label = input.closest("label");
    expect(label?.classList.contains("ui-checkbox")).toBe(true);
    expect(label?.textContent).toBe("Show the grid");
    expect(input.hasAttribute("aria-label")).toBe(false);
  });

  test("a box with no words beside it is named by ariaLabel and draws no empty label", () => {
    const container = mount(() => <Checkbox ariaLabel="Closed" />);
    expect(inputIn(container).getAttribute("aria-label")).toBe("Closed");
    expect(container.querySelector(".ui-checkbox-label")).toBeNull();
    expect(inputIn(container).closest("label")).not.toBeNull();
  });

  test("a press reports the state it asks for and the box follows the caller", () => {
    const asked: boolean[] = [];
    const [checked, setChecked] = createSignal(false);
    // Called as a function with getters, the way Solid's own compiler passes reactive props.
    const input = inputIn(
      mount(() =>
        Checkbox({
          get checked() {
            return checked();
          },
          onChange: (next) => {
            asked.push(next);
            setChecked(next);
          },
          children: "Snap",
        }),
      ),
    );
    input.click();
    expect(asked).toEqual([true]);
    expect(input.checked).toBe(true);
    input.click();
    expect(asked).toEqual([true, false]);
    expect(input.checked).toBe(false);
  });

  test("a press on the label's words is a press on the box", () => {
    const asked: boolean[] = [];
    const container = mount(() => <Checkbox onChange={(next) => asked.push(next)}>Snap</Checkbox>);
    container.querySelector<HTMLElement>(".ui-checkbox-label")?.click();
    expect(asked).toEqual([true]);
  });

  test("a change the caller refuses does not stay drawn", () => {
    const input = inputIn(mount(() => <Checkbox checked onChange={() => undefined}>Locked on</Checkbox>));
    input.click();
    expect(input.checked).toBe(true);
  });

  test("mixed is the element's indeterminate state and aria-checked mixed, and only then", () => {
    const mixed = inputIn(mount(() => <Checkbox mixed ariaLabel="Annotative" />));
    expect(mixed.indeterminate).toBe(true);
    expect(mixed.checked).toBe(false);
    expect(mixed.getAttribute("aria-checked")).toBe("mixed");
    const plain = inputIn(mount(() => <Checkbox checked ariaLabel="Annotative" />));
    expect(plain.indeterminate).toBe(false);
    expect(plain.hasAttribute("aria-checked")).toBe(false);
  });

  test("a press on a mixed box asks for ticked, and the box leaves the mixed state when the caller does", () => {
    const asked: boolean[] = [];
    const [checked, setChecked] = createSignal(false);
    const [mixed, setMixed] = createSignal(true);
    const input = inputIn(
      mount(() =>
        Checkbox({
          get checked() {
            return checked();
          },
          get mixed() {
            return mixed();
          },
          ariaLabel: "Plot",
          onChange: (next) => {
            asked.push(next);
            setMixed(false);
            setChecked(next);
          },
        }),
      ),
    );
    input.click();
    expect(asked).toEqual([true]);
    expect(input.indeterminate).toBe(false);
    expect(input.checked).toBe(true);
    expect(input.hasAttribute("aria-checked")).toBe(false);
  });

  test("a mixed box the caller keeps mixed stays mixed after a press", () => {
    const input = inputIn(mount(() => <Checkbox mixed ariaLabel="Plot" onChange={() => undefined} />));
    input.click();
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);
  });

  test("disabled blocks the press", () => {
    const asked: boolean[] = [];
    const container = mount(() => (
      <Checkbox disabled onChange={(next) => asked.push(next)}>
        Locked
      </Checkbox>
    ));
    const input = inputIn(container);
    expect(input.disabled).toBe(true);
    input.click();
    expect(asked).toEqual([]);
    expect(container.querySelector(".ui-checkbox")?.classList.contains("ui-checkbox--disabled")).toBe(true);
  });

  test("ties a line of help to the box", () => {
    const input = inputIn(mount(() => <Checkbox describedBy="grid-help">Show the grid</Checkbox>));
    expect(input.getAttribute("aria-describedby")).toBe("grid-help");
  });

  test("the mark is drawn by the layer and hidden from assistive tech", () => {
    const mark = mount(() => <Checkbox checked>Snap</Checkbox>).querySelector(".ui-checkbox-mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.previousElementSibling?.tagName).toBe("INPUT");
  });
});
