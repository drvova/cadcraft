/**
 * The canvas selection's pure rules: the aperture mirrors `run_select`, the click add/replace
 * rule mirrors AutoCAD's pick, and the equality is an order-insensitive set comparison. Pinned
 * here so the shell's `select` calls cannot drift from the engine's own picking.
 */

import { describe, expect, test } from "bun:test";
import {
  APERTURE_SCALE,
  DEFAULT_APERTURE,
  DEFAULT_PICKBOX,
  MAX_APERTURE,
  MIN_APERTURE,
  pickAperture,
  sameSelection,
  toggleHandle,
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

describe("toggleHandle", () => {
  test("without add, the clicked handle replaces the selection", () => {
    expect(toggleHandle(["a", "b"], "c", false)).toEqual(["c"]);
    expect(toggleHandle([], "a", false)).toEqual(["a"]);
  });

  test("clicking the only selected handle again is a no-op, not a deselect", () => {
    expect(toggleHandle(["a"], "a", false)).toEqual(["a"]);
  });

  test("with add, membership toggles", () => {
    expect(toggleHandle(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleHandle(["a", "b"], "a", true)).toEqual(["b"]);
    expect(toggleHandle([], "a", true)).toEqual(["a"]);
    expect(toggleHandle(["a"], "a", true)).toEqual([]);
  });

  test("an empty click clears through the caller passing [] (and [] + add keeps [])", () => {
    expect(toggleHandle([], "a", false)).toEqual(["a"]);
    expect(toggleHandle(["a"], "a", true)).toEqual([]);
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
