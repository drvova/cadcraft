/**
 * Field's contract: a native input with its accessible name, the value the caller owns, the
 * keystroke event, the type/placeholder passthrough a real form needs, the autofill and spelling
 * switches, and the refused state with the line that explains it; then what a dense value row
 * needs (the inline look, the small box, the far side, the key, focus and element hand-offs, the
 * selection on focus) and what a combobox says.
 */

import { describe, expect, test } from "bun:test";
import { Field } from "./Field";
import { hintContent } from "./Tooltip";
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
  });

  test("a value the box cuts short is the hint in full, with the title under it; a password's never is", () => {
    const cut = (input: HTMLInputElement): void => {
      Object.defineProperty(input, "scrollWidth", { value: 300 });
      Object.defineProperty(input, "clientWidth", { value: 120 });
    };
    const bare = inputIn(mount(() => <Field ariaLabel="Base URL" value="http://127.0.0.1:11434/v1" />));
    expect(bare.getAttribute("data-hint")).toBe("");
    expect(hintContent(bare)).toBeNull();
    cut(bare);
    expect(hintContent(bare)).toEqual({ text: "http://127.0.0.1:11434/v1", keys: "", note: "" });
    const titled = inputIn(mount(() => <Field ariaLabel="Base URL" value="http://127.0.0.1:11434/v1" title="Ends in /v1 for most servers" />));
    cut(titled);
    expect(hintContent(titled)).toEqual({ text: "http://127.0.0.1:11434/v1", keys: "", note: "Ends in /v1 for most servers" });
    const secret = inputIn(mount(() => <Field type="password" ariaLabel="API key" value="sk-0123456789abcdef0123456789abcdef" />));
    cut(secret);
    expect(hintContent(secret)).toBeNull();
  });

  test("a title that repeats the field's name is not described twice", async () => {
    const input = inputIn(mount(() => <Field ariaLabel="Model" title="Model" />));
    await Promise.resolve();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  test("the look, the size and the side are classes, and a plain field is the form control at 24px from the start", () => {
    const plain = inputIn(mount(() => <Field ariaLabel="Model" />));
    expect(plain.className).toBe("ui-field ui-field--field ui-field--md ui-field--start");
    const value = inputIn(mount(() => <Field ariaLabel="Radius" variant="inline" size="sm" align="end" />));
    expect(value.className).toBe("ui-field ui-field--inline ui-field--sm ui-field--end");
  });

  test("mixed draws the stand-in quieter, and only then", () => {
    const varies = inputIn(mount(() => <Field ariaLabel="Radius" value="*VARIES*" mixed />));
    expect(varies.classList.contains("ui-field--mixed")).toBe(true);
    const one = inputIn(mount(() => <Field ariaLabel="Radius" value="5" mixed={false} />));
    expect(one.classList.contains("ui-field--mixed")).toBe(false);
  });

  test("passes readOnly, maxLength and inputMode through, and sets none of them unasked", () => {
    const input = inputIn(mount(() => <Field ariaLabel="Radius" readOnly maxLength={12} inputMode="decimal" />));
    expect(input.readOnly).toBe(true);
    expect(input.maxLength).toBe(12);
    expect(input.getAttribute("inputmode")).toBe("decimal");
    const plain = inputIn(mount(() => <Field ariaLabel="Model" />));
    expect(plain.readOnly).toBe(false);
    expect(plain.hasAttribute("maxlength")).toBe(false);
    expect(plain.hasAttribute("inputmode")).toBe(false);
  });

  test("hands the element to the caller", () => {
    let handed: HTMLInputElement | undefined;
    const input = inputIn(mount(() => <Field ariaLabel="Radius" ref={(el) => (handed = el)} />));
    expect(handed).toBe(input);
  });

  test("reports a key, the caller may refuse it, and a key the input method holds is never heard", () => {
    const keys: string[] = [];
    const input = inputIn(
      mount(() => (
        <Field
          ariaLabel="Radius"
          onKeyDown={(event) => {
            keys.push(event.key);
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      )),
    );
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", bubbles: true, cancelable: true, keyCode: 229 }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(keys).toEqual(["Enter", "Escape"]);
  });

  test("reports focus arriving and leaving", () => {
    const seen: string[] = [];
    const input = inputIn(mount(() => <Field ariaLabel="Radius" onFocus={(event) => seen.push(event.type)} onBlur={(event) => seen.push(event.type)} />));
    input.focus();
    input.blur();
    expect(seen).toEqual(["focus", "blur"]);
  });

  test("selectOnFocus selects the whole value as focus arrives, and keeps it through the click that brought it", () => {
    const input = inputIn(mount(() => <Field ariaLabel="Radius" value="12.5" selectOnFocus />));
    input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    input.focus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    const up = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    input.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    // The next mouseup is an ordinary one: a click inside the focused field places the caret.
    input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const again = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    input.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
    input.blur();
    const plain = inputIn(mount(() => <Field ariaLabel="Model" value="gpt-5.1" />));
    plain.setSelectionRange(7, 7);
    plain.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    plain.focus();
    const left = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    plain.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(false);
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([7, 7]);
    plain.blur();
  });

  test("a field that drives a list says it is a combobox, and a plain field says none of it", () => {
    const input = inputIn(
      mount(() => <Field ariaLabel="Search commands" role="combobox" expanded controls="palette-list" activeDescendant="palette-option-2" autocompleteKind="list" />),
    );
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe("palette-list");
    expect(input.getAttribute("aria-activedescendant")).toBe("palette-option-2");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    const shut = inputIn(mount(() => <Field ariaLabel="Search commands" role="combobox" expanded={false} />));
    expect(shut.getAttribute("aria-expanded")).toBe("false");
    expect(shut.hasAttribute("aria-activedescendant")).toBe(false);
    const plain = inputIn(mount(() => <Field ariaLabel="Model" />));
    for (const attr of ["role", "aria-expanded", "aria-controls", "aria-activedescendant", "aria-autocomplete"]) expect(plain.hasAttribute(attr)).toBe(false);
  });
});
