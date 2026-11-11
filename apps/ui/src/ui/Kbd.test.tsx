/**
 * Kbd's contract: a native `<kbd>` carrying the key's text, and nothing a person can focus or
 * click.
 */

import { describe, expect, test } from "bun:test";
import { Kbd } from "./Kbd";
import { mount } from "../test-utils";

describe("Kbd", () => {
  test("renders a native kbd with the key's text", () => {
    const container = mount(() => <Kbd>esc</Kbd>);
    const cap = container.querySelector("kbd");
    expect(cap).not.toBeNull();
    expect(cap?.tagName).toBe("KBD");
    expect(cap?.textContent).toBe("esc");
    expect(cap?.classList.contains("ui-kbd")).toBe(true);
  });

  test("is a fact, not a control: no role, no tab stop, no button", () => {
    const container = mount(() => <Kbd>Ctrl+Shift+P</Kbd>);
    const cap = container.querySelector("kbd");
    expect(cap?.hasAttribute("role")).toBe(false);
    expect(cap?.hasAttribute("tabindex")).toBe(false);
    expect(container.querySelector("button")).toBeNull();
  });
});
