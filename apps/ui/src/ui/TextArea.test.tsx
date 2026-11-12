/**
 * TextArea's contract: a native textarea with its accessible name and the caller's text, every
 * edit reported, the `rows` floor and the `maxRows` cap of its measured height, the key handler
 * that never hears an input method's keys, the paste and element hand-offs the composer needs,
 * and Field's refused, disabled, autofill and spelling switches.
 */

import { describe, expect, test } from "bun:test";
import { TextArea, textAreaHeight } from "./TextArea";
import { mount } from "../test-utils";

function areaIn(container: HTMLElement): HTMLTextAreaElement {
  const area = container.querySelector("textarea");
  if (area === null) throw new Error("no <textarea> was rendered");
  return area;
}

function key(area: HTMLTextAreaElement, init: KeyboardEventInit): void {
  area.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("textAreaHeight", () => {
  const box = { line: 16, padding: 6, border: 2 };

  test("is the content with its borders while it is under the cap", () => {
    expect(textAreaHeight({ ...box, content: 38 }, 8)).toEqual({ height: 40, scrolls: false });
    expect(textAreaHeight({ ...box, content: 134 }, 8)).toEqual({ height: 136, scrolls: false });
  });

  test("stops at maxRows lines with the padding and the borders, and scrolls from there", () => {
    expect(textAreaHeight({ ...box, content: 150 }, 8)).toEqual({ height: 136, scrolls: true });
    expect(textAreaHeight({ ...box, content: 230 }, 4)).toEqual({ height: 72, scrolls: true });
  });

  test("a bare area has no padding and no border to add", () => {
    expect(textAreaHeight({ line: 24, padding: 0, border: 0, content: 96 }, 9)).toEqual({ height: 96, scrolls: false });
    expect(textAreaHeight({ line: 24, padding: 0, border: 0, content: 240 }, 9)).toEqual({ height: 216, scrolls: true });
  });

  test("a cap under one line is one line", () => {
    expect(textAreaHeight({ ...box, content: 100 }, 0)).toEqual({ height: 24, scrolls: true });
  });
});

describe("TextArea", () => {
  test("renders a named textarea with the caller's text and the field recipe", () => {
    const area = areaIn(mount(() => <TextArea value={"Line 1\nLine 2"} ariaLabel="Notes" placeholder="Notes on this layer" />));
    expect(area.tagName).toBe("TEXTAREA");
    expect(area.getAttribute("aria-label")).toBe("Notes");
    expect(area.getAttribute("placeholder")).toBe("Notes on this layer");
    expect(area.value).toBe("Line 1\nLine 2");
    expect(area.className).toBe("ui-textarea ui-textarea--field");
  });

  test("shows 2 rows unless the caller asks for another floor", () => {
    expect(areaIn(mount(() => <TextArea ariaLabel="Notes" />)).getAttribute("rows")).toBe("2");
    expect(areaIn(mount(() => <TextArea ariaLabel="Notes" rows={1} />)).getAttribute("rows")).toBe("1");
  });

  test("the bare variant names its recipe", () => {
    expect(areaIn(mount(() => <TextArea ariaLabel="Ask the assistant" variant="bare" />)).className).toBe("ui-textarea ui-textarea--bare");
  });

  test("reports every edit", () => {
    const typed: string[] = [];
    const area = areaIn(mount(() => <TextArea ariaLabel="Notes" onInput={(value) => typed.push(value)} />));
    area.value = "a";
    area.dispatchEvent(new InputEvent("input", { bubbles: true }));
    area.value = "a\nb";
    area.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(typed).toEqual(["a", "a\nb"]);
  });

  test("hands a key to the caller, who may stop it", () => {
    const keys: string[] = [];
    const area = areaIn(
      mount(() => (
        <TextArea
          ariaLabel="Ask"
          onKeyDown={(event) => {
            keys.push(event.key);
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      )),
    );
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    area.dispatchEvent(enter);
    expect(keys).toEqual(["Enter"]);
    expect(enter.defaultPrevented).toBe(true);
  });

  test("a key the input method is using never reaches the caller", () => {
    const keys: string[] = [];
    const area = areaIn(mount(() => <TextArea ariaLabel="Ask" onKeyDown={(event) => keys.push(event.key)} />));
    key(area, { key: "Enter", isComposing: true });
    key(area, { key: "Process", keyCode: 229 });
    expect(keys).toEqual([]);
    key(area, { key: "Enter" });
    expect(keys).toEqual(["Enter"]);
  });

  test("hands a paste and the element to the caller", () => {
    let pasted = 0;
    let handed: HTMLTextAreaElement | undefined;
    const area = areaIn(mount(() => <TextArea ariaLabel="Ask" onPaste={() => pasted++} ref={(el) => (handed = el)} />));
    area.dispatchEvent(new Event("paste", { bubbles: true }));
    expect(pasted).toBe(1);
    expect(handed).toBe(area);
  });

  test("disabled blocks typing", () => {
    expect(areaIn(mount(() => <TextArea ariaLabel="Notes" disabled />)).disabled).toBe(true);
  });

  test("a refused text is announced invalid, and only then", () => {
    expect(areaIn(mount(() => <TextArea ariaLabel="Ask" invalid />)).getAttribute("aria-invalid")).toBe("true");
    expect(areaIn(mount(() => <TextArea ariaLabel="Ask" invalid={false} />)).hasAttribute("aria-invalid")).toBe(false);
  });

  test("ties the help line to the textarea, then the title's words, and renders no native title", () => {
    const area = areaIn(mount(() => <TextArea ariaLabel="Ask" describedBy="ask-over" title="Enter sends, Shift+Enter breaks the line" />));
    expect(area.hasAttribute("title")).toBe(false);
    expect(area.getAttribute("data-hint")).toBe("Enter sends, Shift+Enter breaks the line");
    const [own, hint] = (area.getAttribute("aria-describedby") ?? "").split(" ");
    expect(own).toBe("ask-over");
    expect(document.getElementById(hint ?? "")?.textContent).toBe("Enter sends, Shift+Enter breaks the line");
    expect(areaIn(mount(() => <TextArea ariaLabel="Notes" />)).hasAttribute("aria-describedby")).toBe(false);
  });

  test("passes the autofill hint and the spelling switch through, and leaves both to the platform when unset", () => {
    const off = areaIn(mount(() => <TextArea ariaLabel="Script" autocomplete="off" spellcheck={false} />));
    expect(off.getAttribute("autocomplete")).toBe("off");
    expect(off.getAttribute("spellcheck")).toBe("false");
    const plain = areaIn(mount(() => <TextArea ariaLabel="Notes" />));
    expect(plain.hasAttribute("autocomplete")).toBe(false);
    expect(plain.hasAttribute("spellcheck")).toBe(false);
  });
});
