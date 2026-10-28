/**
 * The world→screen mapping: zoomed, panned, and degenerate views, and the rectangle shapes the
 * facade replies with. These are the pure parts the canvas leans on, so they get the sharp
 * assertions; the drawing itself is proved by the screenshot.
 */

import { describe, expect, test } from "bun:test";
import {
  boundsOfPoints,
  fitAspect,
  makeProjection,
  normalizeRect,
  padRect,
  panBy,
  parseRect,
  rectIsDegenerate,
  rectsOverlap,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "./view";

const SCREEN = { w: 800, h: 400 };

describe("worldToScreen", () => {
  test("maps the view rectangle onto the canvas, y up", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
    expect(worldToScreen(view, SCREEN, { x: 0, y: 0 })).toEqual({ x: 0, y: 400 });
    expect(worldToScreen(view, SCREEN, { x: 100, y: 50 })).toEqual({ x: 800, y: 0 });
    expect(worldToScreen(view, SCREEN, { x: 50, y: 25 })).toEqual({ x: 400, y: 200 });
  });

  test("a zoomed view scales both axes", () => {
    const view = { x0: 40, y0: 20, x1: 60, y1: 30 };
    expect(worldToScreen(view, SCREEN, { x: 50, y: 25 })).toEqual({ x: 400, y: 200 });
    expect(worldToScreen(view, SCREEN, { x: 41, y: 21 })).toEqual({ x: 40, y: 360 });
  });

  test("a panned view translates", () => {
    const view = { x0: 1000, y0: -500, x1: 1100, y1: -450 };
    expect(worldToScreen(view, SCREEN, { x: 1000, y: -500 })).toEqual({ x: 0, y: 400 });
    expect(worldToScreen(view, SCREEN, { x: 1050, y: -475 })).toEqual({ x: 400, y: 200 });
  });

  test("a degenerate view (x0 == x1) is expanded, never a division by zero", () => {
    const degenerate = { x0: 5, y0: 5, x1: 5, y1: 5 };
    const p = worldToScreen(degenerate, SCREEN, { x: 5, y: 5 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    const proj = makeProjection(degenerate, SCREEN);
    expect(Number.isFinite(proj.scaleX)).toBe(true);
    expect(proj.scaleX).toBeGreaterThan(0);
    // A zero-width view has a positive span after normalization.
    expect(normalizeRect(degenerate).x1).toBeGreaterThan(normalizeRect(degenerate).x0);
    expect(rectIsDegenerate(degenerate)).toBe(true);
    expect(rectIsDegenerate({ x0: 0, y0: 0, x1: 1, y1: 1 })).toBe(false);
    expect(rectIsDegenerate({ x0: 0, y0: 0, x1: NaN, y1: 1 })).toBe(true);
  });

  test("a zero-sized canvas does not divide by zero", () => {
    const p = worldToScreen({ x0: 0, y0: 0, x1: 1, y1: 1 }, { w: 0, h: 0 }, { x: 0.5, y: 0.5 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("screenToWorld", () => {
  test("round-trips worldToScreen", () => {
    const view = { x0: -12.5, y0: 3.25, x1: 87.5, y1: 53.25 };
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 800, y: 400 },
      { x: 321, y: 123 },
    ]) {
      const w = screenToWorld(view, SCREEN, p);
      const back = worldToScreen(view, SCREEN, w);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe("zoomAt", () => {
  test("keeps the world point under the pointer fixed", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
    const anchor = { x: 300, y: 100 };
    const before = screenToWorld(view, SCREEN, anchor);
    const zoomed = zoomAt(view, SCREEN, anchor, 0.5);
    const after = screenToWorld(zoomed, SCREEN, anchor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    // Zooming in by 0.5 halves the span.
    expect(zoomed.x1 - zoomed.x0).toBeCloseTo(50, 9);
  });

  test("refuses a bad factor instead of producing NaN", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
    const same = zoomAt(view, SCREEN, { x: 1, y: 1 }, 0);
    expect(same).toEqual(view);
    const nan = zoomAt(view, SCREEN, { x: 1, y: 1 }, Number.NaN);
    expect(Number.isFinite(nan.x0)).toBe(true);
  });
});

describe("panBy", () => {
  test("dragging right moves the drawing right by the same pixels", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
    const point = { x: 50, y: 25 };
    const before = worldToScreen(view, SCREEN, point);
    const panned = panBy(view, SCREEN, 100, 0);
    const after = worldToScreen(panned, SCREEN, point);
    expect(after.x - before.x).toBeCloseTo(100, 9);
    expect(after.y - before.y).toBeCloseTo(0, 9);
  });

  test("dragging down moves the drawing down", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
    const panned = panBy(view, SCREEN, 0, 40);
    const p = worldToScreen(panned, SCREEN, { x: 50, y: 25 });
    expect(p.y).toBeCloseTo(240, 9);
  });
});

describe("rect helpers", () => {
  test("parseRect reads the facade's view shapes", () => {
    expect(parseRect([0, 1, 2, 3])).toEqual({ x0: 0, y0: 1, x1: 2, y1: 3 });
    expect(parseRect({ min: [0, 1], max: [2, 3] })).toEqual({ x0: 0, y0: 1, x1: 2, y1: 3 });
    expect(parseRect({ x0: 0, y0: 1, x1: 2, y1: 3 })).toEqual({ x0: 0, y0: 1, x1: 2, y1: 3 });
    expect(parseRect("nope")).toBeNull();
    expect(parseRect({ min: [0, 1] })).toBeNull();
  });

  test("boundsOfPoints and padRect", () => {
    expect(boundsOfPoints([{ x: 1, y: 2 }, { x: -3, y: 9 }])).toEqual({ x0: -3, y0: 2, x1: 1, y1: 9 });
    expect(boundsOfPoints([{ x: NaN, y: 0 }])).toBeNull();
    expect(padRect({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0.1)).toEqual({ x0: -1, y0: -1, x1: 11, y1: 11 });
  });

  test("rectsOverlap counts touching edges", () => {
    expect(rectsOverlap({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 1, y0: 0, x1: 2, y1: 1 })).toBe(true);
    expect(rectsOverlap({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 2, y0: 0, x1: 3, y1: 1 })).toBe(false);
  });
});

describe("fitAspect", () => {
  test("a wider screen widens the world around its centre", () => {
    const out = fitAspect({ x0: 0, y0: 0, x1: 100, y1: 50 }, { w: 400, h: 100 });
    expect(out.y0).toBeCloseTo(0);
    expect(out.y1).toBeCloseTo(50);
    expect(out.x0).toBeCloseTo(50 - 100);
    expect(out.x1).toBeCloseTo(50 + 100);
  });

  test("a taller screen heightens the world", () => {
    const out = fitAspect({ x0: 0, y0: 0, x1: 100, y1: 100 }, { w: 100, h: 400 });
    expect(out.x0).toBeCloseTo(0);
    expect(out.x1).toBeCloseTo(100);
    expect(out.y0).toBeCloseTo(50 - 200);
    expect(out.y1).toBeCloseTo(50 + 200);
  });

  test("a matching aspect is left alone", () => {
    const out = fitAspect({ x0: 0, y0: 0, x1: 200, y1: 100 }, { w: 800, h: 400 });
    expect(out.x0).toBeCloseTo(0);
    expect(out.x1).toBeCloseTo(200);
    expect(out.y0).toBeCloseTo(0);
    expect(out.y1).toBeCloseTo(100);
  });

  test("a degenerate screen is returned unchanged (a degenerate rect is normalized, as everywhere)", () => {
    const r = { x0: 1, y0: 2, x1: 3, y1: 4 };
    expect(fitAspect(r, { w: 0, h: 100 })).toEqual(r);
    expect(fitAspect(r, { w: 100, h: 0 })).toEqual(r);
    expect(fitAspect({ x0: 5, y0: 5, x1: 5, y1: 5 }, { w: 100, h: 100 })).toEqual(normalizeRect({ x0: 5, y0: 5, x1: 5, y1: 5 }));
  });
});
