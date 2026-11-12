/**
 * The world→screen mapping: zoomed, panned, and degenerate views, and the rectangle shapes the
 * facade replies with. These are the pure parts the canvas leans on, so they get the sharp
 * assertions; the drawing itself is proved by the screenshot.
 */

import { describe, expect, test } from "bun:test";
import {
  boundsOfPoints,
  clampZoomFactor,
  fitAspect,
  makeProjection,
  MAX_UNITS_PER_PX,
  MIN_PINCH_SPREAD,
  MIN_UNITS_PER_PX,
  normalizeRect,
  padRect,
  panBy,
  parseRect,
  PINCH_MAX_PX,
  PINCH_ZOOM_PX,
  pinchOf,
  pinchView,
  rectIsDegenerate,
  rectsOverlap,
  resizeView,
  FIT_HOLD,
  FIT_SLACK,
  holdsFit,
  screenToWorld,
  WHEEL_LINE_PX,
  WHEEL_MAX_PX,
  WHEEL_PAGE_PX,
  WHEEL_ZOOM_PX,
  wheelZoomFactor,
  worldToScreen,
  ZOOM_PRECISION,
  zoomAt,
  type Rect,
  type ScreenBox,
  keepHeldView,
  sameRect,
  unionRects,
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

describe("zoomAt at its limits", () => {
  const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
  const anchor = { x: 300, y: 100 };
  const finite = (r: Rect): boolean => [r.x0, r.y0, r.x1, r.y1].every((n) => Number.isFinite(n));

  test("a thousand steps in and a thousand out drift by nothing a pixel could show", () => {
    const before = screenToWorld(view, SCREEN, anchor);
    let v: Rect = view;
    for (let i = 0; i < 1000; i++) v = zoomAt(v, SCREEN, anchor, 0.99);
    const deep = screenToWorld(v, SCREEN, anchor);
    expect(Math.abs(deep.x - before.x) / ((v.x1 - v.x0) / SCREEN.w)).toBeLessThan(0.01);
    for (let i = 0; i < 1000; i++) v = zoomAt(v, SCREEN, anchor, 1 / 0.99);
    const back = screenToWorld(v, SCREEN, anchor);
    expect(Math.abs(back.x - before.x) / ((v.x1 - v.x0) / SCREEN.w)).toBeLessThan(0.01);
    expect(Math.abs(back.y - before.y) / ((v.y1 - v.y0) / SCREEN.h)).toBeLessThan(0.01);
    expect(v.x1 - v.x0).toBeCloseTo(100, 6);
  });

  test("zooming in stops at the floor with the anchor still under the pointer", () => {
    const before = screenToWorld(view, SCREEN, anchor);
    let v: Rect = view;
    for (let i = 0; i < 400; i++) v = zoomAt(v, SCREEN, anchor, 1e-3);
    const floor = Math.max(MIN_UNITS_PER_PX, Math.max(Math.abs(before.x), Math.abs(before.y)) * ZOOM_PRECISION);
    expect((v.x1 - v.x0) / SCREEN.w).toBeGreaterThanOrEqual(floor * 0.999);
    expect((v.x1 - v.x0) / SCREEN.w).toBeLessThanOrEqual(floor * 1.001);
    const after = screenToWorld(v, SCREEN, anchor);
    expect(Math.abs(after.x - before.x)).toBeLessThan(floor);
    expect(Math.abs(after.y - before.y)).toBeLessThan(floor);
  });

  test("zooming out stops at the ceiling instead of overflowing, and comes back", () => {
    const before = screenToWorld(view, SCREEN, anchor);
    let v: Rect = view;
    for (let i = 0; i < 400; i++) v = zoomAt(v, SCREEN, anchor, 1e30);
    expect(finite(v)).toBe(true);
    expect((v.x1 - v.x0) / SCREEN.w).toBeLessThanOrEqual(MAX_UNITS_PER_PX * 1.001);
    expect((v.x1 - v.x0) / SCREEN.w).toBeGreaterThanOrEqual(MAX_UNITS_PER_PX * 0.999);
    const after = screenToWorld(v, SCREEN, anchor);
    expect(Math.abs(after.x - before.x)).toBeLessThan(MAX_UNITS_PER_PX);
    // The limit is a stop, not a trap.
    const back = zoomAt(v, SCREEN, anchor, 0.5);
    expect((back.x1 - back.x0) / (v.x1 - v.x0)).toBeCloseTo(0.5, 9);
  });

  test("far from the origin the floor rises so a pixel stays wider than the number grid", () => {
    const far = { x0: 1e9, y0: 1e9, x1: 1e9 + 100, y1: 1e9 + 50 };
    let v: Rect = far;
    for (let i = 0; i < 200; i++) v = zoomAt(v, SCREEN, anchor, 1e-3);
    expect((v.x1 - v.x0) / SCREEN.w).toBeGreaterThanOrEqual(1e9 * ZOOM_PRECISION * 0.999);
  });

  test("a view that arrives outside the band is never pushed further and never snapped back", () => {
    const tiny = { x0: 0, y0: 0, x1: 1e-6, y1: 5e-7 };
    expect(zoomAt(tiny, SCREEN, anchor, 0.5)).toEqual(tiny);
    const out = zoomAt(tiny, SCREEN, anchor, 2);
    expect((out.x1 - out.x0) / 1e-6).toBeCloseTo(2, 9);
  });

  test("hostile factors, anchors and canvases leave a finite view", () => {
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e308, 5e-324]) {
      expect(finite(zoomAt(view, SCREEN, anchor, factor))).toBe(true);
    }
    expect(zoomAt(view, SCREEN, { x: Number.NaN, y: 0 }, 0.5)).toEqual(zoomAt(view, SCREEN, { x: 400, y: 200 }, 0.5));
    expect(finite(zoomAt(view, { w: 0, h: 0 }, anchor, 0.5))).toBe(true);
    expect(finite(zoomAt({ x0: 3, y0: 3, x1: 3, y1: 3 }, { w: 0, h: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 }, 2))).toBe(true);
    expect(clampZoomFactor(view, SCREEN, { x: 0, y: 0 }, Number.NaN)).toBe(1);
    expect(clampZoomFactor(view, SCREEN, { x: 0, y: 0 }, 0)).toBe(1);
  });
});

describe("wheelZoomFactor", () => {
  test("a notch in is the inverse of a notch out, and equal travel is an equal step", () => {
    const out = wheelZoomFactor(100, 0, false);
    const inward = wheelZoomFactor(-100, 0, false);
    expect(out).toBeCloseTo(Math.exp(100 / WHEEL_ZOOM_PX), 12);
    expect(out * inward).toBeCloseTo(1, 12);
    // Ten small trackpad events travel as far as one notch.
    expect(Math.pow(wheelZoomFactor(10, 0, false), 10)).toBeCloseTo(out, 12);
  });

  test("lines and pages are brought to pixels: a three-line notch is a 120px notch", () => {
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(wheelZoomFactor(3 * WHEEL_LINE_PX, 0, false), 12);
    expect(wheelZoomFactor(1, 2, false)).toBeCloseTo(wheelZoomFactor(WHEEL_MAX_PX, 0, false), 12);
    expect(WHEEL_PAGE_PX).toBeGreaterThan(WHEEL_MAX_PX);
  });

  test("one event is capped, so a free-spinning wheel or a hostile delta cannot leap", () => {
    const cap = Math.exp(WHEEL_MAX_PX / WHEEL_ZOOM_PX);
    expect(wheelZoomFactor(1e9, 0, false)).toBeCloseTo(cap, 12);
    expect(wheelZoomFactor(-1e9, 0, false)).toBeCloseTo(1 / cap, 12);
    expect(wheelZoomFactor(Number.MAX_VALUE, 2, false)).toBeCloseTo(cap, 12);
  });

  test("a pinch follows the fingers more steeply and is capped lower", () => {
    expect(wheelZoomFactor(4, 0, true)).toBeCloseTo(Math.exp(4 / PINCH_ZOOM_PX), 12);
    expect(wheelZoomFactor(4, 0, true)).toBeGreaterThan(wheelZoomFactor(4, 0, false));
    // Ctrl with a notched wheel is the same event: it steps no further than a plain notch.
    expect(wheelZoomFactor(100, 0, true)).toBeCloseTo(Math.exp(PINCH_MAX_PX / PINCH_ZOOM_PX), 12);
    expect(wheelZoomFactor(100, 0, true)).toBeLessThanOrEqual(wheelZoomFactor(100, 0, false));
  });

  test("zero and non-numbers are no zoom", () => {
    for (const d of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(wheelZoomFactor(d, 0, false)).toBe(1);
      expect(wheelZoomFactor(d, 1, true)).toBe(1);
    }
    expect(Number.isFinite(wheelZoomFactor(50, Number.NaN, false))).toBe(true);
  });
});

describe("resizeView", () => {
  const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
  const box = { left: 250, top: 100, w: 1000, h: 500 };
  /** The world point under a point of the window (client px), for a canvas at `b`. */
  const under = (v: Rect, b: ScreenBox, clientX: number, clientY: number): { x: number; y: number } =>
    screenToWorld(v, b, { x: clientX - b.left, y: clientY - b.top });

  test("a panel opening on the right or the bottom leaves the drawing where it is", () => {
    for (const to of [
      { ...box, w: 660 },
      { ...box, h: 320 },
      { ...box, w: 1400, h: 900 },
    ]) {
      const out = resizeView(view, box, to);
      expect(out.x0).toBeCloseTo(0, 12);
      expect(out.y1).toBeCloseTo(50, 12);
      // The same zoom: world units per pixel are unchanged on both axes.
      expect((out.x1 - out.x0) / to.w).toBeCloseTo(0.1, 12);
      expect((out.y1 - out.y0) / to.h).toBeCloseTo(0.1, 12);
      const a = under(out, to, 500, 300);
      const b = under(view, box, 500, 300);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
    }
  });

  test("a panel closing on the left or the top uncovers the drawing without sliding it", () => {
    const to = { left: 0, top: 60, w: 1250, h: 540 };
    const out = resizeView(view, box, to);
    expect(out.x0).toBeCloseTo(-25, 12);
    expect(out.y1).toBeCloseTo(54, 12);
    const a = under(out, to, 700, 400);
    const b = under(view, box, 700, 400);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  });

  test("opening then closing returns the view", () => {
    const narrow = { ...box, w: 660 };
    const back = resizeView(resizeView(view, box, narrow), narrow, box);
    expect(back.x0).toBeCloseTo(view.x0, 9);
    expect(back.x1).toBeCloseTo(view.x1, 9);
    expect(back.y0).toBeCloseTo(view.y0, 9);
    expect(back.y1).toBeCloseTo(view.y1, 9);
  });

  test("an unusable box or view returns the view untouched", () => {
    expect(resizeView(view, { ...box, w: 0 }, box)).toBe(view);
    expect(resizeView(view, box, { ...box, h: 0 })).toBe(view);
    expect(resizeView(view, box, { ...box, left: Number.NaN })).toBe(view);
    expect(resizeView(view, box, { ...box, w: Number.POSITIVE_INFINITY })).toBe(view);
    const flat = { x0: 1, y0: 1, x1: 1, y1: 1 };
    expect(resizeView(flat, box, { ...box, w: 500 })).toBe(flat);
  });
});

describe("pinchView", () => {
  const view = { x0: 0, y0: 0, x1: 100, y1: 50 };

  test("the world points under both fingers stay under them", () => {
    const a0 = { x: 300, y: 200 };
    const b0 = { x: 500, y: 200 };
    const a1 = { x: 220, y: 150 };
    const b1 = { x: 620, y: 150 };
    const wa = screenToWorld(view, SCREEN, a0);
    const wb = screenToWorld(view, SCREEN, b0);
    const out = pinchView(view, SCREEN, pinchOf(a0, b0), pinchOf(a1, b1));
    const sa = worldToScreen(out, SCREEN, wa);
    const sb = worldToScreen(out, SCREEN, wb);
    expect(sa.x).toBeCloseTo(a1.x, 6);
    expect(sa.y).toBeCloseTo(a1.y, 6);
    expect(sb.x).toBeCloseTo(b1.x, 6);
    expect(sb.y).toBeCloseTo(b1.y, 6);
  });

  test("two fingers moving together only pan", () => {
    const from = pinchOf({ x: 300, y: 200 }, { x: 500, y: 200 });
    const to = pinchOf({ x: 340, y: 230 }, { x: 540, y: 230 });
    expect(pinchView(view, SCREEN, from, to)).toEqual(panBy(view, SCREEN, 40, 30));
  });

  test("fingers on one spot give no ratio: a pan, never a division by zero", () => {
    const from = pinchOf({ x: 300, y: 200 }, { x: 300, y: 200 });
    const to = pinchOf({ x: 310, y: 200 }, { x: 400, y: 200 });
    const out = pinchView(view, SCREEN, from, to);
    expect([out.x0, out.y0, out.x1, out.y1].every((n) => Number.isFinite(n))).toBe(true);
    expect(out.x1 - out.x0).toBeCloseTo(100, 9);
    expect(from.spread).toBeLessThan(MIN_PINCH_SPREAD);
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

describe("holdsFit", () => {
  /** A drawing fitted with room to spare below: 100 by 40 on a canvas of 1000 by 600. */
  const wide = { x0: 0, y0: 0, x1: 100, y1: 40 };
  /** One fitted to the canvas's height: any row taken from the bottom covers part of it. */
  const tall = { x0: 0, y0: 0, x1: 100, y1: 60 };
  const box: ScreenBox = { left: 250, top: 100, w: 1000, h: 600 };

  test("the command line taking a row leaves a fitted drawing where it is", () => {
    const to = { ...box, h: 572 };
    expect(holdsFit(wide, box, to)).toBe(true);
    // Held: the point under the pointer is the point that was there, at the same zoom.
    const before = fitAspect(wide, box);
    const after = resizeView(before, box, to);
    const at = { x: 400, y: 300 };
    expect(screenToWorld(after, to, at).x).toBeCloseTo(screenToWorld(before, box, at).x, 9);
    expect(screenToWorld(after, to, at).y).toBeCloseTo(screenToWorld(before, box, at).y, 9);
  });

  test("the row given back restores the fit exactly", () => {
    const to = { ...box, h: 572 };
    expect(holdsFit(wide, box, to)).toBe(true);
    expect(holdsFit(wide, box, box)).toBe(true);
    expect(resizeView(fitAspect(wide, box), box, box)).toEqual(fitAspect(wide, box));
  });

  test("a row that would cover more than the fit's margin fits the view again", () => {
    // 4% of the height is margin: 24px of 600 may go, 28 may not.
    expect(holdsFit(tall, box, { ...box, h: 600 - FIT_SLACK * 600 })).toBe(true);
    expect(holdsFit(tall, box, { ...box, h: 572 })).toBe(false);
  });

  test("a width change, or the top or left edge moving, fits the view again", () => {
    expect(holdsFit(wide, box, { ...box, w: 660 })).toBe(false);
    expect(holdsFit(wide, box, { ...box, top: 60, h: 640 })).toBe(false);
    expect(holdsFit(wide, box, { ...box, left: 0 })).toBe(false);
  });

  test("a canvas grown much taller fits the view again; a little taller holds", () => {
    expect(holdsFit(wide, box, { ...box, h: 600 * (1 + FIT_HOLD) + 1 })).toBe(false);
    expect(holdsFit(wide, box, { ...box, h: 600 * (1 + FIT_HOLD) - 1 })).toBe(true);
  });

  test("with the drawing's extents known, it holds for as long as their bottom still shows", () => {
    // The fit shows y from -10 to 50; the geometry starts at y = 4: 14 units (140px) may go.
    const content = { x0: 5, y0: 4, x1: 95, y1: 36 };
    expect(holdsFit(wide, box, { ...box, h: 461 }, content)).toBe(true);
    expect(holdsFit(wide, box, { ...box, h: 459 }, content)).toBe(false);
    // Without them only the fit's own margin may go: 11.6 units.
    expect(holdsFit(wide, box, { ...box, h: 470 })).toBe(false);
  });

  test("extents that reach below the fitted view fall back to the fit's margin", () => {
    const below = { x0: 0, y0: -500, x1: 100, y1: 40 };
    expect(holdsFit(tall, box, { ...box, h: 600 - FIT_SLACK * 600 }, below)).toBe(true);
    expect(holdsFit(tall, box, { ...box, h: 572 }, below)).toBe(false);
    expect(holdsFit(tall, box, { ...box, h: 572 }, { x0: 0, y0: Number.NaN, x1: 1, y1: 1 })).toBe(false);
  });

  test("hostile boxes and views never hold", () => {
    expect(holdsFit(wide, box, { ...box, h: Number.NaN })).toBe(false);
    expect(holdsFit(wide, { ...box, w: 0 }, box)).toBe(false);
    expect(holdsFit({ x0: 0, y0: 0, x1: 0, y1: 0 }, box, box)).toBe(false);
    expect(holdsFit({ x0: 0, y0: Number.NaN, x1: 1, y1: 1 }, box, box)).toBe(false);
  });
});

describe("sameRect and unionRects", () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 5 };

  test("the same four corners are the same rectangle, whichever object holds them", () => {
    expect(sameRect(a, { ...a })).toBe(true);
    expect(sameRect(a, { ...a, y1: 5.0000001 })).toBe(false);
    expect(sameRect({ ...a, x0: Number.NaN }, { ...a, x0: Number.NaN })).toBe(false);
  });

  test("the union holds both, and an absent or unusable one leaves the other", () => {
    expect(unionRects(a, { x0: -3, y0: 2, x1: 4, y1: 9 })).toEqual({ x0: -3, y0: 0, x1: 10, y1: 9 });
    expect(unionRects(a, null)).toEqual(a);
    expect(unionRects(null, a)).toEqual(a);
    expect(unionRects(null, null)).toBeNull();
    expect(unionRects(a, { x0: 0, y0: 0, x1: Number.NaN, y1: 1 })).toEqual(a);
    expect(unionRects({ x0: 0, y0: 0, x1: 0, y1: 0 }, a)).toEqual(a);
    expect(unionRects({ x0: 0, y0: 0, x1: 0, y1: 0 }, { x0: 1, y0: 1, x1: Number.POSITIVE_INFINITY, y1: 2 })).toBeNull();
  });
});

describe("keepHeldView", () => {
  // ZOOM Window on 100,60 to 200,130, as the engine fitted it to a 1000 x 500 canvas.
  const held = { x0: 80, y0: 60, x1: 220, y1: 130 };

  test("a canvas that got shorter still shows all of what the command framed, about the same centre", () => {
    // The command's echo took two rows of the history: the canvas is 40px shorter.
    const kept = keepHeldView(held, { w: 1000, h: 460 });
    expect(kept.y0).toBe(60);
    expect(kept.y1).toBe(130);
    expect((kept.x0 + kept.x1) / 2).toBeCloseTo(150, 9);
    expect((kept.x1 - kept.x0) / (kept.y1 - kept.y0)).toBeCloseTo(1000 / 460, 9);
    expect(kept.x0).toBeLessThan(held.x0);
  });

  test("a canvas that got narrower grows the view's height instead: nothing the command framed is cropped", () => {
    const kept = keepHeldView(held, { w: 500, h: 500 });
    expect(kept.x0).toBe(80);
    expect(kept.x1).toBe(220);
    expect(kept.y0).toBeLessThan(60);
    expect(kept.y1).toBeGreaterThan(130);
    expect((kept.y0 + kept.y1) / 2).toBeCloseTo(95, 9);
  });

  test("it is the held view that is fitted each time, so a canvas that comes back shows what it showed", () => {
    const back = keepHeldView(held, { w: 1000, h: 500 });
    expect(back.x0).toBeCloseTo(held.x0, 9);
    expect(back.y0).toBeCloseTo(held.y0, 9);
    expect(back.x1).toBeCloseTo(held.x1, 9);
    expect(back.y1).toBeCloseTo(held.y1, 9);
  });

  test("a size or a view that cannot be used leaves the held view as it is", () => {
    for (const size of [{ w: 0, h: 500 }, { w: 1000, h: Number.NaN }, { w: -4, h: 500 }, { w: Number.POSITIVE_INFINITY, h: 500 }]) {
      expect(keepHeldView(held, size)).toBe(held);
    }
    const broken = { x0: 0, y0: 0, x1: Number.NaN, y1: 1 };
    expect(keepHeldView(broken, { w: 1000, h: 500 })).toBe(broken);
    const empty = { x0: 0, y0: 0, x1: 0, y1: 0 };
    expect(keepHeldView(empty, { w: 1000, h: 500 })).toBe(empty);
  });
});
