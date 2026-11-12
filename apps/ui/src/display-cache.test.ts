import { describe, expect, test } from "bun:test";
import { LOD_REFETCH, padView, regionCovers, regionOf, VIEW_PAD, viewScale } from "./display-cache";
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

describe("the scale a list was built for", () => {
  const inside: Rect = { x0: 10, y0: 5, x1: 90, y1: 45 };
  /** A list built with the view 100 units high on a canvas 500px high: 5px per unit. */
  const built = regionOf(padView(VIEW), 7, 5);

  test("viewScale is CSS pixels per world unit, and 0 when it cannot be said", () => {
    expect(viewScale(VIEW, { w: 1000, h: 500 })).toBe(10);
    expect(viewScale({ x0: 0, y0: 0, x1: 100, y1: 0 }, { w: 1000, h: 500 })).toBe(0);
    expect(viewScale(VIEW, { w: 0, h: 0 })).toBe(0);
    expect(viewScale({ x0: 0, y0: Number.NaN, x1: 1, y1: 1 }, { w: 10, h: 10 })).toBe(0);
  });

  test("zooming in up to LOD_REFETCH past the built scale is still answered; past it is not", () => {
    expect(regionCovers(built, inside, 7, 5)).toBe(true);
    expect(regionCovers(built, inside, 7, 5 * LOD_REFETCH)).toBe(true);
    expect(regionCovers(built, inside, 7, 5 * LOD_REFETCH + 0.01)).toBe(false);
    expect(regionCovers(built, inside, 7, 50)).toBe(false);
  });

  test("zooming out never asks again on account of the detail", () => {
    expect(regionCovers(built, inside, 7, 0.01)).toBe(true);
  });

  test("a wider canvas at the same view is a larger scale: the list is fetched again", () => {
    const narrow = viewScale(inside, { w: 390, h: 195 });
    const wide = viewScale(inside, { w: 1440, h: 720 });
    const region = regionOf(padView(inside), 7, narrow);
    expect(regionCovers(region, inside, 7, narrow)).toBe(true);
    expect(regionCovers(region, inside, 7, wide)).toBe(false);
  });

  test("a list built at an unknown scale does not answer once the scale is known", () => {
    expect(regionOf(padView(VIEW), 7).scale).toBe(0);
    expect(regionOf(padView(VIEW), 7, Number.NaN).scale).toBe(0);
    expect(regionCovers(regionOf(padView(VIEW), 7), inside, 7, 5)).toBe(false);
  });

  test("an unknown scale now (an unmeasured canvas) judges the window and the revision alone", () => {
    expect(regionCovers(built, inside, 7)).toBe(true);
    expect(regionCovers(built, inside, 7, Number.NaN)).toBe(true);
    expect(regionCovers(built, inside, 8, 0)).toBe(false);
  });
});

describe("the space a list is of", () => {
  const WINDOW = padView(VIEW, 0.5);
  const inside: Rect = { x0: 10, y0: 5, x1: 90, y1: 45 };

  test("a list of another space answers for nothing, whatever its window and revision", () => {
    const model = regionOf(WINDOW, 7, 0, "Model");
    expect(regionCovers(model, inside, 7, 0, "Model")).toBe(true);
    // The layout's view lies inside the model list's window, at the same revision: still not its list.
    expect(regionCovers(model, inside, 7, 0, "Layout1")).toBe(false);
    expect(regionCovers(regionOf(WINDOW, 7, 0, "Layout1"), inside, 7, 0, "Layout2")).toBe(false);
    expect(regionCovers(regionOf(WINDOW, 7, 0, "Layout1"), inside, 7, 0, "Layout1")).toBe(true);
  });

  test("a space's name is compared as it is written", () => {
    expect(regionCovers(regionOf(WINDOW, 7, 0, "A"), inside, 7, 0, "a")).toBe(false);
    expect(regionCovers(regionOf(WINDOW, 7, 0, ""), inside, 7, 0, "")).toBe(true);
  });

  test("a list or a caller that does not know its space is judged by window, revision and scale alone", () => {
    expect(regionOf(WINDOW, 7).space).toBeNull();
    expect(regionCovers(regionOf(WINDOW, 7), inside, 7, 0, "Layout1")).toBe(true);
    expect(regionCovers(regionOf(WINDOW, 7, 0, "Layout1"), inside, 7)).toBe(true);
    expect(regionCovers(regionOf(WINDOW, 7, 0, "Layout1"), inside, 8, 0, "Layout1")).toBe(false);
  });
});
