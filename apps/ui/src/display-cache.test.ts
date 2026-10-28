import { describe, expect, test } from "bun:test";
import { padView, regionCovers, regionOf, VIEW_PAD } from "./display-cache";
import type { Rect } from "./view";

const VIEW: Rect = { x0: 0, y0: 0, x1: 100, y1: 50 };

describe("padView", () => {
  test("expands by the pad on each side", () => {
    expect(padView(VIEW, 0.5)).toEqual({ x0: -50, y0: -25, x1: 150, y1: 75 });
  });

  test("zero pad is the view itself", () => {
    expect(padView(VIEW, 0)).toEqual(VIEW);
  });

  test("the default pad is VIEW_PAD", () => {
    expect(padView(VIEW)).toEqual(padView(VIEW, VIEW_PAD));
  });

  test("a hostile pad is clamped, never NaN", () => {
    expect(padView(VIEW, Number.NaN)).toEqual(VIEW);
    expect(padView(VIEW, -5)).toEqual(VIEW);
    const huge = padView(VIEW, 1e9);
    expect(Number.isFinite(huge.x0)).toBe(true);
    expect(huge.x0).toBe(VIEW.x0 - 100 * 8);
  });
});

describe("regionCovers", () => {
  const region = regionOf(padView(VIEW, 0.5), 7);

  test("a view inside the window is covered", () => {
    expect(regionCovers(region, { x0: 10, y0: 5, x1: 90, y1: 45 }, 7)).toBe(true);
  });

  test("the window's own edges are covered", () => {
    expect(regionCovers(region, { x0: -50, y0: -25, x1: 150, y1: 75 }, 7)).toBe(true);
  });

  test("panning half a screen stays inside", () => {
    expect(regionCovers(region, { x0: 50, y0: 0, x1: 150, y1: 50 }, 7)).toBe(true);
  });

  test("leaving the window is not covered", () => {
    expect(regionCovers(region, { x0: 51, y0: 0, x1: 151, y1: 50 }, 7)).toBe(false);
  });

  test("a revision change is not covered", () => {
    expect(regionCovers(region, VIEW, 8)).toBe(false);
  });

  test("no region is not covered", () => {
    expect(regionCovers(null, VIEW, 7)).toBe(false);
  });

  test("a degenerate or hostile rect is not covered", () => {
    expect(regionCovers(region, { x0: 10, y0: 5, x1: 10, y1: 45 }, 7)).toBe(false);
    expect(regionCovers(region, { x0: Number.NaN, y0: 0, x1: 10, y1: 10 }, 7)).toBe(false);
  });
});
