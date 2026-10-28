/**
 * The canvas's screen-space constants: the lineweight display rule (mm → px) the desktop canvas
 * uses, and the grid step ladder. Pure functions, so they are pinned here.
 */

import { describe, expect, test } from "bun:test";
import { gridStep, lineWidthPx } from "./canvas";

describe("lineWidthPx", () => {
  test("matches the desktop canvas: lw(mm) * 3.78, clamped to [1, 12]", () => {
    expect(lineWidthPx(0.18)).toBe(1); // 0.68 raw → clamped up
    expect(lineWidthPx(0.25)).toBe(1); // 0.945 raw → clamped up
    expect(lineWidthPx(0.35)).toBeCloseTo(1.323, 4);
    expect(lineWidthPx(0.5)).toBeCloseTo(1.89, 4);
    expect(lineWidthPx(3.17)).toBeCloseTo(11.9826, 3);
    expect(lineWidthPx(5)).toBe(12); // above 12 → clamped
  });

  test("never below 1px, and lw 0 is a hairline", () => {
    expect(lineWidthPx(0)).toBe(1);
    expect(lineWidthPx(0.01)).toBe(1);
    expect(lineWidthPx(-2)).toBe(1);
  });
});

describe("gridStep", () => {
  test("stays on the 1-2-5 ladder and inside the on-screen band", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 50 };
    for (const width of [200, 800, 1600, 4000]) {
      const step = gridStep(view, width);
      expect(Number.isFinite(step)).toBe(true);
      expect(step).toBeGreaterThan(0);
      const px = (step / (view.x1 - view.x0)) * width;
      expect(px).toBeGreaterThanOrEqual(8);
      expect(px).toBeLessThanOrEqual(160);
      const decade = Math.pow(10, Math.floor(Math.log10(step / 1)));
      const n = step / decade;
      expect([1, 2, 5, 10]).toContain(Math.round(n));
    }
  });

  test("survives a degenerate view and a zero-width canvas", () => {
    expect(Number.isFinite(gridStep({ x0: 0, y0: 0, x1: 0, y1: 1 }, 800))).toBe(true);
    expect(Number.isFinite(gridStep({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0))).toBe(true);
  });
});
