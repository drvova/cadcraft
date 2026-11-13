/**
 * The modal layer for dialog bodies drawn by Slab (`./modal.tsx`): the order of the stops, where
 * Tab goes, and the surface wired into a frame, with a stand-in for the driver (the vendored
 * runtime is not loaded under `bun test`). The stand-in keeps the driver's own traits that the
 * layer exists for: a ring that would wrap, a `tabindex` on the focused node only, holes after
 * the kernel's nodes in the page's order.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { SlabFieldHost } from "./fields";
import { acceptsFocus, applyParams, attachModalSurface, isItemKey, itemOfKey, leaveTarget, orderStops, tabMove, type ModalSurface } from "./modal";

describe("the order of a body's stops", () => {
  const stop = (id: string, top: number, left: number, height = 24) => ({ id, top, left, height });

  test("down the body, whatever order the page holds them in", () => {
    const order = orderStops([stop("metal", 200, 400), stop("size", 60, 400), stop("system", 28, 400), stop("wall", 140, 400)]).map((s) => s.id);
    expect(order).toEqual(["system", "size", "wall", "metal"]);
  });

  test("along a line, left to right; a pixel or two of height does not break the line", () => {
    const order = orderStops([stop("b", 101, 300), stop("a", 100, 20), stop("c", 98, 500, 28)]).map((s) => s.id);
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("stops in one place keep their order, and hostile figures do not throw", () => {
    expect(orderStops([stop("a", 0, 0), stop("b", 0, 0)]).map((s) => s.id)).toEqual(["a", "b"]);
    expect(orderStops([stop("a", Number.NaN, Number.POSITIVE_INFINITY), stop("b", 10, 0)]).length).toBe(2);
    expect(orderStops([])).toEqual([]);
  });
});

describe("where Tab goes", () => {
  test("to the next stop, and the one before with Shift", () => {
    expect(tabMove(5, 1, false)).toEqual({ kind: "stop", index: 2 });
    expect(tabMove(5, 1, true)).toEqual({ kind: "stop", index: 0 });
  });

  test("out of the surface at either end: the ring never wraps", () => {
    expect(tabMove(5, 4, false)).toEqual({ kind: "leave", forward: true });
    expect(tabMove(5, 0, true)).toEqual({ kind: "leave", forward: false });
  });

  test("from the surface but no stop, the key enters at the end it came from", () => {
    expect(tabMove(5, -1, false)).toEqual({ kind: "stop", index: 0 });
    expect(tabMove(5, -1, true)).toEqual({ kind: "stop", index: 4 });
    expect(tabMove(5, 99, false)).toEqual({ kind: "stop", index: 0 });
    expect(tabMove(5, Number.NaN, true)).toEqual({ kind: "stop", index: 4 });
  });

  test("a body with no stop is left at once", () => {
    expect(tabMove(0, -1, false)).toEqual({ kind: "leave", forward: true });
    expect(tabMove(-3, 0, true)).toEqual({ kind: "leave", forward: false });
    expect(tabMove(Number.NaN, 0, false)).toEqual({ kind: "leave", forward: true });
  });

  test("the frame's control the focus is handed to", () => {
    expect(leaveTarget(["close"], ["cancel", "ok"], true)).toBe("cancel");
    expect(leaveTarget(["close"], ["cancel", "ok"], false)).toBe("close");
    // A frame with nothing on that side: the trap goes round.
    expect(leaveTarget(["close"], [], true)).toBe("close");
    expect(leaveTarget([], ["cancel", "ok"], false)).toBe("ok");
    expect(leaveTarget([], [], true)).toBeNull();
  });
});

describe("a scene key's list item", () => {
  test("the innermost item of a node's key", () => {
    expect(itemOfKey("#body/#mid/each@0~wall/col@0/row@0/text@1")).toBe("wall");
    expect(itemOfKey("#body/#metals/each@1~m-12/col@0/row@0/text@1")).toBe("m-12");
    expect(itemOfKey("#a/each@0~outer/x/each@2~inner/#field")).toBe("inner");
  });

  test("nothing outside a list, or for a key that is not ours", () => {
    expect(itemOfKey("#body/col@0/#readout")).toBeNull();
    expect(itemOfKey("#body/each@0~Has Space/x")).toBeNull();
    expect(itemOfKey(null)).toBeNull();
    expect(itemOfKey(undefined)).toBeNull();
    expect(itemOfKey("each@0~a/".repeat(1000))).toBeNull();
  });

  test("a signal's item key is ours in shape or it is nothing", () => {
    expect(isItemKey("wall")).toBe(true);
    expect(isItemKey("m-3")).toBe(true);
    expect(isItemKey("")).toBe(false);
    expect(isItemKey("../x")).toBe(false);
    expect(isItemKey("a".repeat(41))).toBe(false);
  });
});

describe("a node that takes the kernel's focus", () => {
  test("focusable, not inert, not disabled", () => {
    expect(acceptsFocus({ key: "k", flags: 73, disabled: false })).toBe(true);
    expect(acceptsFocus({ key: "k", flags: 64 | 32 })).toBe(false);
    expect(acceptsFocus({ key: "k", flags: 64, disabled: true })).toBe(false);
    expect(acceptsFocus({ key: "k", flags: 8 })).toBe(false);
    expect(acceptsFocus({ key: "k" })).toBe(false);
    expect(acceptsFocus({ flags: 64 })).toBe(false);
    expect(acceptsFocus(null)).toBe(false);
    expect(acceptsFocus("k")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The surface in a frame
// ---------------------------------------------------------------------------------------------

interface Fake {
  host: SlabFieldHost;
  /** What the driver's own key listener heard (Tab there would walk the kernel's ring). */
  kernelKeys: string[];
  focused: () => string | null;
  buffers: Map<string, string>;
  carets: string[];
  params: Map<string, unknown>;
  lists: Map<string, unknown>;
  frame: () => void;
  settle: () => void;
}

const KEYS = { size: "#body/#first/each@0~size/col@0/row@0/text@1", wall: "#body/#mid/each@0~wall/col@0/row@0/text@1", x: "#body/#place/each@0~x/col@0/row@0/text@1" };

/** Give an element a place on the page (happy-dom lays nothing out). */
function place(el: HTMLElement, top: number): void {
  el.getBoundingClientRect = () => ({ top, left: 400, width: 164, height: 24, right: 564, bottom: top + 24, x: 400, y: top, toJSON: () => ({}) });
}

/** A stand-in for a mounted document: three fields, with the driver's traits the layer answers. */
function fakeSurface(parent: HTMLElement): Fake {
  const el = document.createElement("div");
  parent.append(el);
  const root = el.attachShadow({ mode: "open" });
  const ime = document.createElement("textarea");
  ime.className = "slab-ime";
  ime.tabIndex = -1;
  root.append(ime);
  const nodes = new Map<string, HTMLElement>();
  let top = 60;
  for (const key of Object.values(KEYS)) {
    const node = document.createElement("div");
    node.className = "slab-a11y-node";
    node.dataset["slabKey"] = key;
    node.setAttribute("role", "textbox");
    place(node, top);
    top += 80;
    root.append(node);
    nodes.set(key, node);
  }
  let focused: string | null = null;
  const buffers = new Map<string, string>();
  const carets: string[] = [];
  const params = new Map<string, unknown>();
  const lists = new Map<string, unknown>();
  const kernelKeys: string[] = [];
  let waiters: (() => void)[] = [];
  // The driver's listener, on the element itself, as its constructor adds it.
  el.addEventListener("keydown", (e) => kernelKeys.push((e as KeyboardEvent).key));
  // The driver drops the kernel's focus when the page's leaves the element.
  el.addEventListener("focusout", (e) => {
    const to = (e as FocusEvent).relatedTarget;
    if (to instanceof Node && (el.contains(to) || root.contains(to))) return;
    focused = null;
  });
  const host = Object.assign(el, {
    setParam: (name: string, value: unknown) => (params.set(name, value), true),
    setList: (name: string, _path: string, value: unknown) => (lists.set(name, value), true),
    setTheme: () => true,
    setSplit: () => true,
    getSplit: () => 0,
    getToken: () => undefined,
    sceneSnapshot: () => [...nodes.keys()].map((key) => ({ key, x: 0, y: 0, w: 164, h: 24, flags: 73, disabled: false })),
    clearFocus: () => ((focused = null), true),
    setFieldText: (key: string, text: string) => (buffers.set(key, text), true),
    fieldText: (key: string) => buffers.get(key),
    setCaret: (key: string, caret: number, anchor?: number) => (carets.push(`${itemOfKey(key)}:${anchor ?? caret}-${caret}`), true),
    focusedKey: () => focused,
    setFocus: (key: string) => {
      if (!nodes.has(key)) return false;
      focused = key;
      return true;
    },
    whenSettled: () => new Promise<void>((resolve) => waiters.push(resolve)),
  }) as unknown as SlabFieldHost;
  return {
    host,
    kernelKeys,
    focused: () => focused,
    buffers,
    carets,
    params,
    lists,
    frame: () => el.dispatchEvent(new Event("slab-frame")),
    settle: () => {
      const now = waiters;
      waiters = [];
      for (const resolve of now) resolve();
    },
  };
}

interface Frame extends Fake {
  dialog: HTMLDialogElement;
  close: HTMLButtonElement;
  cancel: HTMLButtonElement;
  ok: HTMLButtonElement;
  /** The control in a hole, standing between the first field and the second. */
  select: HTMLSelectElement;
  surface: ModalSurface;
  values: Map<string, string>;
  signals: string[];
}

let mounted: Frame | null = null;

/** The frame as `../ui/Dialog` builds it: a close key, the body, the footer's keys. */
function frame(): Frame {
  const dialog = document.createElement("dialog");
  const close = document.createElement("button");
  close.textContent = "Close";
  const body = document.createElement("div");
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.textContent = "OK";
  dialog.append(close, body, cancel, ok);
  document.body.append(dialog);
  dialog.setAttribute("open", "");
  const fake = fakeSurface(body);
  // A hole's control is a child of the element, after every node of the kernel's in the page's order.
  const select = document.createElement("select");
  place(select, 100);
  fake.host.append(select);
  const values = new Map<string, string>([
    ["size", ""],
    ["wall", "1.8"],
    ["x", "0"],
  ]);
  const signals: string[] = [];
  const surface = attachModalSurface(fake.host, { signals: ["field_edit", "field_submit"], values: () => values, on: (name) => signals.push(name) });
  mounted = { ...fake, dialog, close, cancel, ok, select, surface, values, signals };
  return mounted;
}

afterEach(() => {
  mounted?.surface.dispose();
  mounted?.dialog.remove();
  mounted = null;
});

/** Press a key where the keyboard is: on the surface (the driver's tree retargets to the element) or on a control. */
function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Where the keyboard is: a field's name, or the control. */
function at(f: Frame): string {
  const active = document.activeElement;
  if (active === f.host) return `field:${itemOfKey(f.focused()) ?? "none"}`;
  if (active === f.select) return "select";
  return active instanceof HTMLElement ? (active.textContent ?? "") : "nothing";
}

describe("a surface in a dialog's frame", () => {
  test("Tab walks every control in reading order, kernel's and hole's alike, and reaches the footer", () => {
    const f = frame();
    f.surface.focus("size");
    expect(at(f)).toBe("field:size");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const target = document.activeElement === f.select ? f.select : f.host;
      const event = press(target, "Tab");
      expect(event.defaultPrevented).toBe(true);
      seen.push(at(f));
    }
    // The hole stands between the first field and the second, though the page holds it last.
    expect(seen).toEqual(["select", "field:wall", "field:x", "Cancel"]);
  });

  test("Shift+Tab walks back and leaves by the close key", () => {
    const f = frame();
    f.surface.focus("x");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      press(document.activeElement === f.select ? f.select : f.host, "Tab", { shiftKey: true });
      seen.push(at(f));
    }
    expect(seen).toEqual(["field:wall", "select", "field:size", "Close"]);
  });

  test("the kernel never hears Tab or Escape, so its ring cannot wrap and Escape is the frame's", () => {
    const f = frame();
    f.surface.focus("wall");
    press(f.host, "Tab");
    f.surface.focus("wall");
    const escape = press(f.host, "Escape");
    press(f.host, "a");
    expect(f.kernelKeys).toEqual(["a"]);
    // Unused: the dialog's `cancel` closes it.
    expect(escape.defaultPrevented).toBe(false);
  });

  test("a field's own keys go no further than the surface; the shell's chords and function keys do", () => {
    const f = frame();
    f.surface.focus("wall");
    const heard: string[] = [];
    const listen = (e: Event): void => {
      heard.push((e as KeyboardEvent).key);
    };
    f.dialog.addEventListener("keydown", listen);
    press(f.host, "l");
    press(f.host, "z", { ctrlKey: true });
    press(f.host, "s", { ctrlKey: true });
    press(f.host, "F8");
    f.dialog.removeEventListener("keydown", listen);
    expect(heard).toEqual(["s", "F8"]);
  });

  test("coming in by Tab lands on the first stop, and on the last with Shift", () => {
    const f = frame();
    f.close.focus();
    press(f.close, "Tab");
    // The browser's own move: onto whatever the driver left a tab stop.
    f.host.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true, relatedTarget: f.close }));
    expect(at(f)).toBe("field:size");
    f.cancel.focus();
    press(f.cancel, "Tab", { shiftKey: true });
    f.host.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true, relatedTarget: f.cancel }));
    expect(at(f)).toBe("field:x");
  });

  test("a press that brings the focus in is left where it landed", () => {
    const f = frame();
    f.close.focus();
    press(f.close, "Tab");
    f.dialog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    f.host.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true, relatedTarget: f.close }));
    expect(f.focused()).toBeNull();
  });

  test("a hole's control taking the keyboard clears the kernel's ring", () => {
    const f = frame();
    f.surface.focus("size");
    expect(f.focused()).toBe(KEYS.size);
    f.surface.focus(f.select);
    expect(document.activeElement).toBe(f.select);
    expect(f.focused()).toBeNull();
  });

  test("a field is typed into through the driver's text area, and arriving selects its value whole", () => {
    const f = frame();
    f.buffers.set(KEYS.wall, "1.8");
    f.surface.focus("wall");
    expect(f.host.shadowRoot?.activeElement?.className).toBe("slab-ime");
    expect(f.carets).toEqual(["wall:0-3"]);
  });

  test("the form's values are written into the buffers that differ, but never under the caret", () => {
    const f = frame();
    f.surface.sync();
    expect(f.buffers.get(KEYS.wall)).toBe("1.8");
    expect(f.buffers.get(KEYS.x)).toBe("0");
    f.surface.focus("wall");
    f.buffers.set(KEYS.wall, "1.85");
    f.values.set("x", "4");
    f.frame();
    // The field being typed into is ahead of the form; the others follow it.
    expect(f.buffers.get(KEYS.wall)).toBe("1.85");
    expect(f.buffers.get(KEYS.x)).toBe("4");
  });

  test("the focus waits for a stop the scene does not have yet, and gives up quietly", async () => {
    const f = frame();
    f.surface.focus("labor");
    for (let i = 0; i < 20; i++) {
      f.settle();
      await Promise.resolve();
    }
    expect(f.focused()).toBeNull();
  });

  test("leaving for the frame and coming back to the same field selects it again", () => {
    const f = frame();
    f.buffers.set(KEYS.wall, "-3");
    f.surface.focus("wall");
    f.ok.focus();
    f.host.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: f.ok }));
    f.surface.focus("wall");
    expect(f.carets).toEqual(["wall:0-2", "wall:0-2"]);
  });

  test("the document's signals reach the host and go no further", () => {
    const f = frame();
    let outside = 0;
    const count = (): void => {
      outside += 1;
    };
    f.dialog.addEventListener("field_edit", count);
    f.host.dispatchEvent(new CustomEvent("field_edit", { bubbles: true, composed: true, detail: { item: "wall", text: "2" } }));
    f.dialog.removeEventListener("field_edit", count);
    expect(f.signals).toEqual(["field_edit"]);
    expect(outside).toBe(0);
  });

  test("disposed, the surface is the driver's again", () => {
    const f = frame();
    f.surface.focus("size");
    f.surface.dispose();
    const event = press(f.host, "Tab");
    expect(event.defaultPrevented).toBe(false);
    expect(f.kernelKeys).toEqual(["Tab"]);
  });
});

describe("handing a document its params", () => {
  test("scalars every time, a list only when it changed", () => {
    const f = frame();
    const sent = new Map<string, string>();
    let writes = 0;
    const host = Object.assign(f.host, {
      setList: (name: string, _path: string, value: unknown) => {
        writes += 1;
        f.lists.set(name, value);
        return true;
      },
    });
    applyParams(host, { gem: false, top: [{ key: "size" }] }, ["gem"], ["top"], sent);
    applyParams(host, { gem: true, top: [{ key: "size" }] }, ["gem"], ["top"], sent);
    expect(f.params.get("gem")).toBe(true);
    expect(writes).toBe(1);
    applyParams(host, { gem: true, top: [] }, ["gem"], ["top"], sent);
    expect(writes).toBe(2);
  });
});
