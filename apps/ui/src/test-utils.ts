/**
 * The component tests' shared harness: mount a component into a detached container and query it
 * the way a person would (by role, by name, by what the element is). The DOM comes from the
 * preload (`test-preload.ts`, wired through `bunfig.toml`); this module only renders and queries.
 */

import type { JSX } from "solid-js";
import { render } from "solid-js/web";

/**
 * Renders `content` into a fresh container and returns the container. The container is attached
 * to the document because Solid delegates `click` at the document level, so a fully detached tree
 * would never receive one; queries still run inside the container.
 */
export function mount(content: () => JSX.Element): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(content, container);
  return container;
}

/** The single button in the container; throws when the component rendered none. */
export function buttonIn(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector("button");
  if (button === null) throw new Error("no <button> was rendered");
  return button;
}

/** The single input in the container; throws when the component rendered none. */
export function inputIn(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector("input");
  if (input === null) throw new Error("no <input> was rendered");
  return input;
}

/** Types `value` into the input and fires the event a real keystroke fires. */
export function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}
