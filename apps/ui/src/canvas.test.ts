/**
 * The canvas's screen-space constants: the lineweight display rule (mm → px) the desktop canvas
 * uses, the grid's levels and the device-pixel snap of its rules. Pure functions, so they are
 * pinned here.
 *
 * The selection highlight is pinned too: a recording context stands in for the 2D canvas (no DOM),
 * so the drawing path can be checked — the selected primitives are stroked a second time, in the
 * palette's selection colour, at the highlight width.
 */

import { describe, expect, test } from "bun:test";
import { crispRule, drawDisplay, GRID_FULL_PX, GRID_MIN_PX, gridLevels, handleHex, isHighlighted, lineWidthPx, samePalette, SELECTION_WIDTH, type Palette } from "./canvas";
import type { DisplayList, DisplayPrim } from "./display";
import { UNIT_RECT } from "./view";

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

describe("gridLevels", () => {
  /** The view of an 800px canvas at `per` world units per pixel. */
  const at = (per: number): { x0: number; y0: number; x1: number; y1: number } => ({ x0: 0, y0: 0, x1: 800 * per, y1: 400 * per });

  test("the minor step is a power of ten, between the floor and ten times it on screen", () => {
    for (const per of [1e-6, 0.003, 0.0166, 0.1, 0.99, 1, 7, 12345, 1e6]) {
      const { step } = gridLevels(at(per), 800);
      const px = step / per;
      expect(px).toBeGreaterThanOrEqual(GRID_MIN_PX * 0.999999);
      expect(px).toBeLessThan(GRID_MIN_PX * 10 * 1.000001);
      expect(Math.log10(step)).toBeCloseTo(Math.round(Math.log10(step)), 9);
    }
  });

  test("zooming out, the minor lines fade to nothing before the step changes", () => {
    // 11px apart: almost gone. 20px: half. 30px and wider: fully drawn.
    expect(gridLevels(at(1 / 11), 800).minorAlpha).toBeCloseTo(1 / 20, 6);
    expect(gridLevels(at(1 / 20), 800).minorAlpha).toBeCloseTo(0.5, 6);
    expect(gridLevels(at(1 / GRID_FULL_PX), 800).minorAlpha).toBeCloseTo(1, 6);
    expect(gridLevels(at(1 / 45), 800).minorAlpha).toBe(1);
  });

  test("the look is continuous across the change of step: no line pops in or out", () => {
    // Just before the change the minor lines (99.9px apart) wear the major ink in full; just after,
    // those same lines are the major lines and the new minor lines between them are invisible.
    const before = gridLevels(at(1 / 99.9), 800);
    const after = gridLevels(at(1 / 100.1), 800);
    expect(before.step).toBeCloseTo(1, 12);
    expect(after.step).toBeCloseTo(0.1, 12);
    expect(before.minorAlpha).toBe(1);
    expect(before.majorBlend).toBeGreaterThan(0.99);
    expect(after.minorAlpha).toBeLessThan(0.01);
    expect(after.majorBlend).toBe(0);
  });

  test("survives a degenerate view and a zero-width canvas", () => {
    const hostile = [
      gridLevels({ x0: 0, y0: 0, x1: 0, y1: 1 }, 800),
      gridLevels({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0),
      gridLevels({ x0: Number.NaN, y0: 0, x1: 1, y1: 1 }, 800),
      gridLevels({ x0: 0, y0: 0, x1: Number.POSITIVE_INFINITY, y1: 1 }, 800),
    ];
    for (const levels of hostile) {
      expect(Number.isFinite(levels.step)).toBe(true);
      expect(levels.step).toBeGreaterThan(0);
      expect(levels.minorAlpha).toBeGreaterThanOrEqual(0);
      expect(levels.minorAlpha).toBeLessThanOrEqual(1);
    }
  });
});

describe("crispRule", () => {
  /** The rule's two edges in device pixels. */
  const edges = (css: number, dpr: number): [number, number] => {
    const { at, width } = crispRule(css, dpr);
    return [(at - width / 2) * dpr, (at + width / 2) * dpr];
  };

  test("its edges sit on whole device pixels at every ratio, fractional ones too", () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      for (const css of [0, 0.3, 10.5, 123.456, 999.99]) {
        const [a, b] = edges(css, dpr);
        expect(a).toBeCloseTo(Math.round(a), 9);
        expect(b).toBeCloseTo(Math.round(b), 9);
      }
    }
  });

  test("it is one device pixel wide below a ratio of 2, two at 2 and three at 3", () => {
    expect(crispRule(5, 1).width).toBe(1);
    expect(crispRule(5, 1.5).width * 1.5).toBeCloseTo(1, 12);
    expect(crispRule(5, 2).width * 2).toBeCloseTo(2, 12);
    expect(crispRule(5, 3).width * 3).toBeCloseTo(3, 12);
  });

  test("it never moves a rule more than half a device pixel from where it belongs", () => {
    for (const dpr of [1, 1.5, 2]) {
      for (const css of [0.2, 7.49, 7.5, 7.51, 300.75]) {
        expect(Math.abs(crispRule(css, dpr).at - css) * dpr).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  test("a ratio that is not a positive number is read as 1", () => {
    expect(crispRule(10.2, Number.NaN)).toEqual({ at: 10.5, width: 1 });
    expect(crispRule(10.2, 0)).toEqual({ at: 10.5, width: 1 });
  });
});

/** A `CanvasRenderingContext2D` stand-in that records the strokes and fills it is asked to draw. */
class RecordingContext {
  readonly strokes: { style: string; width: number; alpha: number }[] = [];
  /** `fill()` calls (a filled primitive). */
  readonly fills: string[] = [];
  /** `fillRect()` calls (the canvas background and point markers). */
  readonly fillRects: string[] = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  globalAlpha = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  setTransform(): void {}
  clearRect(): void {}
  setLineDash(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
  }
  fill(): void {
    this.fills.push(this.fillStyle);
  }
  fillRect(): void {
    this.fillRects.push(this.fillStyle);
  }
  strokeRect(): void {
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
  }
}

const PALETTE: Palette = {
  canvas: "#181818",
  gridMinor: "#202020",
  gridMajor: "#2a2a2a",
  axisX: "#552633",
  axisY: "#23412f",
  selection: "#81a1c1",
};

const VIEW = { x0: 0, y0: 0, x1: 10, y1: 10 };

function prim(kind: DisplayPrim["kind"], start: number, len: number, handle: number): DisplayPrim {
  return { kind, start, len, color: [212, 212, 212], lw: 0.25, alpha: 1, handle };
}

/** One polyline (handle 0x2F = 47) and one point (handle 0x30 = 48), inside the view. */
const LIST: DisplayList = {
  revision: 1,
  bounds: { x0: 0, y0: 0, x1: 8, y1: 8 },
  verts: [
    { x: 1, y: 1 },
    { x: 4, y: 4 },
    { x: 6, y: 6 },
  ],
  prims: [prim("polyline", 0, 2, 0x2f), prim("point", 2, 1, 0x30)],
};

function draw(selection?: ReadonlySet<string>): RecordingContext {
  const ctx = new RecordingContext();
  drawDisplay(ctx as unknown as CanvasRenderingContext2D, LIST, VIEW, {
    width: 800,
    height: 600,
    dpr: 1,
    palette: PALETTE,
    grid: false,
    ...(selection === undefined ? {} : { selection }),
  });
  return ctx;
}

describe("samePalette", () => {
  test("compares the inks, not the objects", () => {
    expect(samePalette(PALETTE, { ...PALETTE })).toBe(true);
    // A theme that changes one ink (the selection's) is a different palette.
    expect(samePalette(PALETTE, { ...PALETTE, selection: PALETTE.axisX })).toBe(false);
  });
});

describe("drawDisplay, the grid", () => {
  const grid = (view: { x0: number; y0: number; x1: number; y1: number }): RecordingContext => {
    const ctx = new RecordingContext();
    drawDisplay(ctx as unknown as CanvasRenderingContext2D, { revision: 1, bounds: UNIT_RECT, verts: [], prims: [] }, view, { width: 800, height: 600, dpr: 1, palette: PALETTE, grid: true });
    return ctx;
  };

  test("is a handful of strokes however many lines it holds: one path per ink", () => {
    // 20px between minor lines: 40 by 30 of them, in four strokes (minor, major, the two axes).
    const ctx = grid({ x0: -1, y0: -1, x1: 39, y1: 29 });
    expect(ctx.strokes).toHaveLength(4);
    expect(ctx.strokes.map((s) => s.style)).toEqual([PALETTE.gridMinor, PALETTE.gridMajor, PALETTE.axisY, PALETTE.axisX]);
    expect(ctx.strokes.every((s) => s.width === 1)).toBe(true);
  });

  test("the minor ink carries the fade, and a view that does not hold the axes draws none", () => {
    const ctx = grid({ x0: 100, y0: 100, x1: 140, y1: 130 });
    expect(ctx.strokes.find((s) => s.style === PALETTE.gridMinor)?.alpha).toBeCloseTo(0.5, 6);
    expect(ctx.strokes.find((s) => s.style === PALETTE.gridMajor)?.alpha).toBe(1);
    expect(ctx.strokes.some((s) => s.style === PALETTE.axisX || s.style === PALETTE.axisY)).toBe(false);
  });

  test("a hostile view draws a bounded grid and no NaN stroke width", () => {
    const hostile = [
      { x0: 0, y0: 0, x1: 0, y1: 0 },
      { x0: Number.NaN, y0: 0, x1: 1, y1: 1 },
      { x0: -1e300, y0: -1e300, x1: 1e300, y1: 1e300 },
    ];
    for (const view of hostile) {
      const ctx = grid(view);
      expect(ctx.strokes.length).toBeLessThanOrEqual(5);
      expect(ctx.strokes.every((s) => Number.isFinite(s.width) && Number.isFinite(s.alpha))).toBe(true);
    }
  });
});

describe("isHighlighted", () => {
  test("is membership of the selection set, by the engine's hex handle", () => {
    const selection = new Set(["2F"]);
    expect(isHighlighted("2F", selection)).toBe(true);
    expect(isHighlighted("2f", selection)).toBe(false);
    expect(isHighlighted("30", selection)).toBe(false);
    expect(isHighlighted("", selection)).toBe(false);
    expect(isHighlighted("", new Set([""]))).toBe(false);
  });
});

describe("handleHex", () => {
  test("spells a primitive's handle the way Handle::hex does", () => {
    expect(handleHex(0x2f)).toBe("2F");
    expect(handleHex(18)).toBe("12");
    expect(handleHex(1)).toBe("1");
    expect(handleHex(0)).toBe("");
    expect(handleHex(-4)).toBe("");
    expect(handleHex(NaN)).toBe("");
  });
});

describe("drawDisplay — the selection highlight", () => {
  test("without a selection, each primitive is drawn once", () => {
    const ctx = draw();
    expect(ctx.strokes).toHaveLength(1);
    expect(ctx.strokes[0]?.style).toBe("rgb(212,212,212)");
    expect(ctx.strokes[0]?.width).toBeCloseTo(lineWidthPx(0.25), 6);
    expect(ctx.fills).toHaveLength(0);
    // The background fill plus the point marker.
    expect(ctx.fillRects).toHaveLength(2);
  });

  test("a selected polyline is stroked again on top in the selection colour", () => {
    const ctx = draw(new Set(["2F"]));
    expect(ctx.strokes).toHaveLength(2);
    expect(ctx.strokes[0]?.style).toBe("rgb(212,212,212)");
    const highlight = ctx.strokes[1];
    expect(highlight?.style).toBe(PALETTE.selection);
    expect(highlight?.width).toBe(SELECTION_WIDTH);
    expect(highlight?.alpha).toBe(1);
    expect(ctx.fills).toHaveLength(0);
  });

  test("a selected point is re-stroked as its own marker box", () => {
    const ctx = draw(new Set(["30"]));
    expect(ctx.strokes).toHaveLength(2);
    expect(ctx.strokes[1]?.style).toBe(PALETTE.selection);
    expect(ctx.strokes[1]?.width).toBe(SELECTION_WIDTH);
  });

  test("a handle the display list does not carry highlights nothing", () => {
    const ctx = draw(new Set(["99"]));
    expect(ctx.strokes).toHaveLength(1);
  });

  test("an empty selection draws exactly what no selection draws", () => {
    const withEmpty = draw(new Set());
    const without = draw();
    expect(withEmpty.strokes.length).toBe(without.strokes.length);
    expect(withEmpty.fills.length).toBe(without.fills.length);
  });

  test("a selected tris primitive is filled once and outlined once", () => {
    const tris: DisplayList = {
      revision: 1,
      bounds: UNIT_RECT,
      verts: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 5 },
      ],
      prims: [prim("tris", 0, 3, 0x31)],
    };
    const ctx = new RecordingContext();
    drawDisplay(ctx as unknown as CanvasRenderingContext2D, tris, VIEW, { width: 800, height: 600, dpr: 1, palette: PALETTE, grid: false, selection: new Set(["31"]) });
    expect(ctx.fills).toHaveLength(1);
    expect(ctx.strokes).toHaveLength(1);
    expect(ctx.strokes[0]?.style).toBe(PALETTE.selection);
    expect(ctx.strokes[0]?.width).toBe(SELECTION_WIDTH);
  });

  test("the highlight never touches the primitives' own colour or lineweight", () => {
    const ctx = draw(new Set(["2F", "30"]));
    const own = ctx.strokes.filter((s) => s.style === "rgb(212,212,212)");
    const accent = ctx.strokes.filter((s) => s.style === PALETTE.selection);
    expect(own).toHaveLength(1);
    expect(accent).toHaveLength(2);
    expect(own[0]?.width).toBeCloseTo(lineWidthPx(0.25), 6);
  });
});
