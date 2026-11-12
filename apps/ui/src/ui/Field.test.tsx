/**
 * Field's contract: a native input with its accessible name, the value the caller owns, the
 * keystroke event, the type/placeholder passthrough a real form needs, the autofill and spelling
 * switches, and the refused state with the line that explains it.
 */

import { describe, expect, test } from "bun:test";
import { Field } from "./Field";
import { inputIn, mount, type } from "../test-utils";

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

  test("masks a password and never spell-checks it", () => {
    const input = inputIn(mount(() => <Field type="password" ariaLabel="API key" />));
    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("spellcheck")).toBe("false");
  });

  test("passes the autofill hint and the spelling switch through, and leaves both to the platform when unset", () => {
    const key = inputIn(mount(() => <Field ariaLabel="API key" autocomplete="off" spellcheck={false} />));
    expect(key.getAttribute("autocomplete")).toBe("off");
    expect(key.getAttribute("spellcheck")).toBe("false");
    const plain = inputIn(mount(() => <Field ariaLabel="Note" />));
    expect(plain.hasAttribute("autocomplete")).toBe(false);
    expect(plain.hasAttribute("spellcheck")).toBe(false);
  });

  test("a refused value is announced invalid, and only then", () => {
    const refused = inputIn(mount(() => <Field ariaLabel="Base URL" invalid />));
    expect(refused.getAttribute("aria-invalid")).toBe("true");
    const fine = inputIn(mount(() => <Field ariaLabel="Base URL" invalid={false} />));
    expect(fine.hasAttribute("aria-invalid")).toBe(false);
    const plain = inputIn(mount(() => <Field ariaLabel="Base URL" />));
    expect(plain.hasAttribute("aria-invalid")).toBe(false);
  });

  test("ties the help line or the error line to the input", () => {
    const input = inputIn(mount(() => <Field ariaLabel="API key" describedBy="key-help key-error" />));
    expect(input.getAttribute("aria-describedby")).toBe("key-help key-error");
    const plain = inputIn(mount(() => <Field ariaLabel="Model" />));
    expect(plain.hasAttribute("aria-describedby")).toBe(false);
  });

  test("the title is the layer's hint and joins the description after the caller's lines, never a native title or the name", () => {
    const input = inputIn(mount(() => <Field ariaLabel="Base URL" title="Ends in /v1 for most servers" describedBy="url-error" />));
    expect(input.hasAttribute("title")).toBe(false);
    expect(input.getAttribute("aria-label")).toBe("Base URL");
    expect(input.getAttribute("data-hint")).toBe("Ends in /v1 for most servers");
    const [own, hint] = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(own).toBe("url-error");
    expect(document.getElementById(hint ?? "")?.textContent).toBe("Ends in /v1 for most servers");
    const bare = inputIn(mount(() => <Field ariaLabel="Model" />));
    expect(bare.hasAttribute("data-hint")).toBe(false);
  });

  test("a title that repeats the field's name is not described twice", async () => {
    const input = inputIn(mount(() => <Field ariaLabel="Model" title="Model" />));
    await Promise.resolve();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});
