/**
 * The popup of a choice on a Slab surface (`./popup`): where it stands by its anchor (under it,
 * above it when there is no room, never off the page, whatever the numbers), what its keys do,
 * where it opens, and the press that closes it not opening it again.
 *
 * The list itself (the focus, the roles, the dismissals) needs Solid's compiled JSX and a
 * browser, and is checked there.
 */

import { describe, expect, test } from "bun:test";
import { heldIndex, isReopen, popupKey, popupPlace, REOPEN_GRACE_MS, sceneBoxInWindow, type PopupOption } from "./popup";

const BOUNDS = { left: 4, top: 4, right: 1276, bottom: 770 };
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("popupPlace", () => {
  const anchor = { left: 136, top: 485, right: 240, bottom: 505 };

  test("stands under its anchor, its end on the anchor's end", () => {
    expect(popupPlace(anchor, { width: 117, height: 186 }, BOUNDS, 2)).toEqual({ left: 123, top: 507, maxHeight: 263, above: false });
  });

  test("opens above when it does not fit below and there is more room above", () => {
    const at = popupPlace(anchor, { width: 104, height: 545 }, BOUNDS, 2);
    expect(at.above).toBe(true);
    // The room above is 479; the list is capped at it and scrolls.
    expect(at.maxHeight).toBe(479);
    expect(at.top).toBe(4);
  });

  test("above, a list that fits ends on the anchor's top", () => {
    const low = { left: 136, top: 700, right: 240, bottom: 720 };
    expect(popupPlace(low, { width: 104, height: 200 }, BOUNDS, 2)).toEqual({ left: 136, top: 498, maxHeight: 694, above: true });
  });

  test("stays below when the room above is no better", () => {
    const high = { left: 136, top: 20, right: 240, bottom: 40 };
    const at = popupPlace(high, { width: 104, height: 900 }, BOUNDS, 2);
    expect(at.above).toBe(false);
    expect(at.top).toBe(42);
    expect(at.maxHeight).toBe(728);
  });

  test("is pulled back inside the window on the other axis", () => {
    expect(popupPlace({ left: 0, top: 100, right: 60, bottom: 120 }, { width: 200, height: 50 }, BOUNDS, 2).left).toBe(4);
    expect(popupPlace({ left: 1200, top: 100, right: 1400, bottom: 120 }, { width: 200, height: 50 }, BOUNDS, 2).left).toBe(1076);
  });

  test("hostile numbers never place it off the page", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e300, 1e300]) {
      const at = popupPlace({ left: bad, top: bad, right: bad, bottom: bad }, { width: bad, height: bad }, BOUNDS, bad);
      for (const value of [at.left, at.top, at.maxHeight]) expect(Number.isFinite(value)).toBe(true);
      expect(at.left).toBeGreaterThanOrEqual(BOUNDS.left);
      expect(at.top).toBeGreaterThanOrEqual(BOUNDS.top);
      expect(at.maxHeight).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("popupKey", () => {
  const labels = ["0", "Defpoints", "Metal", "Stones", "Settings"];

  test("the arrows step and wrap, Home and End jump", () => {
    expect(popupKey(key("ArrowDown"), labels, 0)).toEqual({ kind: "move", index: 1 });
    expect(popupKey(key("ArrowDown"), labels, 4)).toEqual({ kind: "move", index: 0 });
    expect(popupKey(key("ArrowUp"), labels, 0)).toEqual({ kind: "move", index: 4 });
    expect(popupKey(key("Home"), labels, 3)).toEqual({ kind: "move", index: 0 });
    expect(popupKey(key("End"), labels, 1)).toEqual({ kind: "move", index: 4 });
  });

  test("with no option lit, Down enters at the first and Up at the last", () => {
    expect(popupKey(key("ArrowDown"), labels, -1)).toEqual({ kind: "move", index: 0 });
    expect(popupKey(key("ArrowUp"), labels, -1)).toEqual({ kind: "move", index: 4 });
  });

  test("a letter goes to the next value that starts with it, and again to the one after", () => {
    expect(popupKey(key("s"), labels, 0)).toEqual({ kind: "move", index: 3 });
    expect(popupKey(key("S"), labels, 3)).toEqual({ kind: "move", index: 4 });
    expect(popupKey(key("s"), labels, 4)).toEqual({ kind: "move", index: 3 });
  });

  test("Enter and Space pick the lit option, and nothing when none is", () => {
    expect(popupKey(key("Enter"), labels, 2)).toEqual({ kind: "pick", index: 2 });
    expect(popupKey(key(" "), labels, 2)).toEqual({ kind: "pick", index: 2 });
    expect(popupKey(key("Enter"), labels, -1)).toEqual({ kind: "none" });
    expect(popupKey(key("Enter"), labels, 99)).toEqual({ kind: "none" });
  });

  test("Escape and Tab dismiss", () => {
    expect(popupKey(key("Escape"), labels, 1)).toEqual({ kind: "dismiss", reason: "escape" });
    expect(popupKey(key("Tab"), labels, 1)).toEqual({ kind: "dismiss", reason: "tab" });
  });

  test("a letter no value starts with is still the list's, so it never starts a command", () => {
    expect(popupKey(key("q"), labels, 1)).toEqual({ kind: "none" });
    expect(popupKey(key("ArrowLeft"), labels, 1)).toEqual({ kind: "none" });
  });

  test("the shell's chords and the function keys are left alone", () => {
    expect(popupKey(key("s", { ctrlKey: true }), labels, 1)).toBeNull();
    expect(popupKey(key("p", { metaKey: true }), labels, 1)).toBeNull();
    expect(popupKey(key("F6"), labels, 1)).toBeNull();
    expect(popupKey(key("Shift"), labels, 1)).toBeNull();
  });

  test("an empty list moves nowhere", () => {
    expect(popupKey(key("ArrowDown"), [], -1)).toBeNull();
    expect(popupKey(key("Enter"), [], 0)).toEqual({ kind: "none" });
  });
});

describe("heldIndex", () => {
  const options: PopupOption[] = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ];

  test("the option holding the value; none for a value the list lacks or for none", () => {
    expect(heldIndex(options, "b")).toBe(1);
    expect(heldIndex(options, "c")).toBe(-1);
    expect(heldIndex(options, null)).toBe(-1);
    expect(heldIndex([], "a")).toBe(-1);
  });
});

describe("isReopen", () => {
  test("the press that closed the popup is not a new opening; a later one is", () => {
    expect(isReopen(1000, 1005)).toBe(true);
    expect(isReopen(1000, 1000 + REOPEN_GRACE_MS)).toBe(false);
    expect(isReopen(1000, 5000)).toBe(false);
  });

  test("nothing closed, or a clock that makes no sense, is never a reopening", () => {
    expect(isReopen(null, 1000)).toBe(false);
    expect(isReopen(Number.NaN, 1000)).toBe(false);
    expect(isReopen(2000, 1000)).toBe(false);
  });
});

describe("sceneBoxInWindow", () => {
  test("a part's box of the scene, moved to where its surface stands", () => {
    const host = document.createElement("div");
    host.getBoundingClientRect = () => new DOMRect(10, 400, 248, 200);
    expect(sceneBoxInWindow(host, { x: 126, y: 30, w: 104, h: 20 })).toEqual({ left: 136, top: 430, right: 240, bottom: 450 });
  });
});
