/**
 * Field's contract: a native input with its accessible name, the value the caller owns, the
 * keystroke event, and the type/placeholder passthrough a real form needs.
 */

import { describe, expect, test } from "bun:test";
import { Field } from "./Field";
import { inputIn, mount, type } from "./test-utils";

describe("Field", () => {
  test("renders a named input with the caller's value", () => {
    const input = inputIn(mount(() => <Field value="0,0" ariaLabel="Base point" />));
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("aria-label")).toBe("Base point");
    expect(input.value).toBe("0,0");
  });

  test("reports every keystroke", () => {
    const typed: string[] = [];
    const input = inputIn(mount(() => <Field onInput={(value) => typed.push(value)} />));
    type(input, "1");
    type(input, "12");
    expect(typed).toEqual(["1", "12"]);
  });

  test("passes the placeholder and the input type through", () => {
    const input = inputIn(mount(() => <Field type="email" placeholder="you@example.com" ariaLabel="Email" />));
    expect(input.getAttribute("type")).toBe("email");
    expect(input.getAttribute("placeholder")).toBe("you@example.com");
  });

  test("disabled blocks typing", () => {
    const input = inputIn(mount(() => <Field disabled ariaLabel="Locked" />));
    expect(input.disabled).toBe(true);
  });
});
