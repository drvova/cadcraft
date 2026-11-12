/**
 * The canvas selection's pure rules: the aperture mirrors `run_select`, the add and remove rule
 * mirrors the engine's `idle_click` (PICKADD and Shift), and the equality is an order-insensitive set comparison. Pinned
 * here so the shell's `select` calls cannot drift from the engine's own picking.
 */

import { describe, expect, test } from "bun:test";
import {
  APERTURE_SCALE,
  CLICK_SLOP,
  clickSlop,
  DEFAULT_APERTURE,
  dragKind,
  pickReach,
  DEFAULT_PICKBOX,
  MAX_APERTURE,
  MIN_APERTURE,
  pickAperture,
  sameSelection,
  applyPick,
} from "./selection";

describe("pickAperture", () => {
  test("mirrors run_select: worldPerPixel * pickbox * 1.5", () => {
    expect(APERTURE_SCALE).toBe(1.5);
    expect(pickAperture(0.5, 3)).toBeCloseTo(0.5 * 3 * 1.5, 12);
    expect(pickAperture(0.01, 3)).toBeCloseTo(0.045, 12);
    expect(pickAperture(2, 5)).toBeCloseTo(15, 12);
  });

  test("a degenerate worldPerPixel falls back to a small positive default, never NaN", () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      const aperture = pickAperture(bad, 3);
      expect(Number.isFinite(aperture)).toBe(true);
      expect(aperture).toBeGreaterThan(0);
      expect(aperture).toBe(DEFAULT_APERTURE);
    }
  });

  test("a degenerate pickbox falls back to the engine's default of 3", () => {
    expect(DEFAULT_PICKBOX).toBe(3);
    for (const bad of [0, -4, NaN, Infinity]) {
      expect(pickAperture(0.5, bad)).toBeCloseTo(0.5 * 3 * 1.5, 12);
    }
  });

  test("stays inside the sane positive range", () => {
    expect(pickAperture(1e-12, 3)).toBe(MIN_APERTURE);
    expect(pickAperture(1e30, 3)).toBe(MAX_APERTURE);
    expect(Number.isFinite(pickAperture(Number.MAX_VALUE, 3))).toBe(true);
  });
});

describe("applyPick", () => {
  const click = (shift: boolean, pickadd = true) => ({ gesture: "click" as const, shift, pickadd });
  const rect = (shift: boolean, pickadd = true) => ({ gesture: "rect" as const, shift, pickadd });

  test("PICKADD on: a plain click adds, and clicking a selected object again keeps it", () => {
    expect(applyPick([], ["a"], click(false))).toEqual(["a"]);
    expect(applyPick(["a"], ["b"], click(false))).toEqual(["a", "b"]);
    expect(applyPick(["a", "b"], ["a"], click(false))).toEqual(["a", "b"]);
  });

  test("PICKADD on: Shift removes, and Shift on an unselected object changes nothing", () => {
    expect(applyPick(["a", "b"], ["a"], click(true))).toEqual(["b"]);
    expect(applyPick(["a"], ["a"], click(true))).toEqual([]);
    expect(applyPick(["a"], ["b"], click(true))).toEqual(["a"]);
  });

  test("PICKADD on: a rectangle adds what it holds and a Shift rectangle removes it", () => {
    expect(applyPick(["a"], ["b", "c"], rect(false))).toEqual(["a", "b", "c"]);
    expect(applyPick(["a", "b", "c"], ["b", "c", "d"], rect(true))).toEqual(["a"]);
    expect(applyPick(["a"], [], rect(false))).toEqual(["a"]);
    expect(applyPick(["a"], [], rect(true))).toEqual(["a"]);
  });

  test("a click on nothing never changes the selection (Escape is what clears it)", () => {
    for (const pickadd of [true, false]) {
      for (const shift of [true, false]) {
        expect(applyPick(["a", "b"], [], click(shift, pickadd))).toEqual(["a", "b"]);
      }
    }
  });

  test("PICKADD off: a pick replaces, Shift adds, Shift on a selected object removes it", () => {
    expect(applyPick(["a", "b"], ["c"], click(false, false))).toEqual(["c"]);
    expect(applyPick(["a"], ["b"], click(true, false))).toEqual(["a", "b"]);
    expect(applyPick(["a", "b"], ["a"], click(true, false))).toEqual(["b"]);
    expect(applyPick(["a"], ["b", "c"], rect(false, false))).toEqual(["b", "c"]);
    expect(applyPick(["a"], [], rect(false, false))).toEqual([]);
    expect(applyPick(["a"], ["a", "b"], rect(true, false))).toEqual(["a", "b"]);
  });

  test("keeps the order, lists no handle twice, and never changes its inputs", () => {
    const current = ["a", "b"];
    const picked = ["b", "b", "c"];
    expect(applyPick(current, picked, rect(false))).toEqual(["a", "b", "c"]);
    expect(applyPick([], picked, rect(false, false))).toEqual(["b", "c"]);
    expect(current).toEqual(["a", "b"]);
    expect(picked).toEqual(["b", "b", "c"]);
  });
});

describe("dragKind", () => {
  test("travel inside the slop is a click, in every direction", () => {
    expect(dragKind(0, 0, CLICK_SLOP)).toBe("click");
    expect(dragKind(CLICK_SLOP, 0, CLICK_SLOP)).toBe("click");
    expect(dragKind(-2, 2, CLICK_SLOP)).toBe("click");
    expect(dragKind(0, -CLICK_SLOP, CLICK_SLOP)).toBe("click");
  });

  test("dragging to the right is a window and to the left a crossing, whatever the vertical travel", () => {
    expect(dragKind(40, 10, CLICK_SLOP)).toBe("window");
    expect(dragKind(40, -90, CLICK_SLOP)).toBe("window");
    expect(dragKind(-40, 10, CLICK_SLOP)).toBe("crossing");
    expect(dragKind(-1, -90, CLICK_SLOP)).toBe("crossing");
    // Straight up or down has no side: it reads as a window.
    expect(dragKind(0, 50, CLICK_SLOP)).toBe("window");
  });

  test("the rectangle starts just past the slop, not at it", () => {
    expect(dragKind(CLICK_SLOP + 0.5, 0, CLICK_SLOP)).toBe("window");
    expect(dragKind(-(CLICK_SLOP + 0.5), 0, CLICK_SLOP)).toBe("crossing");
  });

  test("travel that is not a number is a click, and a bad slop falls back to the mouse's", () => {
    expect(dragKind(Number.NaN, 5, CLICK_SLOP)).toBe("click");
    expect(dragKind(5, Number.POSITIVE_INFINITY, CLICK_SLOP)).toBe("click");
    expect(dragKind(2, 0, Number.NaN)).toBe("click");
    expect(dragKind(20, 0, -1)).toBe("window");
  });
});

describe("clickSlop and pickReach", () => {
  test("a mouse is exact, a pen has more room, a finger the most", () => {
    expect(clickSlop("mouse")).toBe(CLICK_SLOP);
    expect(clickSlop("pen")).toBeGreaterThan(clickSlop("mouse"));
    expect(clickSlop("touch")).toBeGreaterThan(clickSlop("pen"));
    expect(pickReach("mouse")).toBe(1);
    expect(pickReach("pen")).toBeGreaterThan(1);
    expect(pickReach("touch")).toBeGreaterThan(pickReach("pen"));
  });

  test("an unknown pointer is treated as a mouse", () => {
    expect(clickSlop("")).toBe(CLICK_SLOP);
    expect(pickReach("stylus")).toBe(1);
  });

  test("a finger's pick is the engine's own rule on a wider pixel: 13.5 CSS px for a pickbox of 3", () => {
    const worldPerPixel = 0.02;
    expect(pickAperture(worldPerPixel * pickReach("touch"), DEFAULT_PICKBOX) / worldPerPixel).toBeCloseTo(13.5, 9);
    expect(pickAperture(worldPerPixel * pickReach("mouse"), DEFAULT_PICKBOX) / worldPerPixel).toBeCloseTo(4.5, 9);
  });
});

describe("sameSelection", () => {
  test("is an order-insensitive set comparison", () => {
    expect(sameSelection([], [])).toBe(true);
    expect(sameSelection(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSelection(["a"], ["a"])).toBe(true);
  });

  test("different membership or length is not the same selection", () => {
    expect(sameSelection(["a"], ["b"])).toBe(false);
    expect(sameSelection(["a"], ["a", "b"])).toBe(false);
    expect(sameSelection(["a", "a"], ["a", "b"])).toBe(false);
    expect(sameSelection([], ["a"])).toBe(false);
  });
});
