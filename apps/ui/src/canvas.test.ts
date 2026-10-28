/**
 * The canvas's screen-space constants: the lineweight display rule (mm → px) the desktop canvas
 * uses, and the grid step ladder. Pure functions, so they are pinned here.
 *
 * The selection highlight is pinned too: a recording context stands in for the 2D canvas (no DOM),
 * so the drawing path can be checked — the selected primitives are stroked a second time, in the
 * palette's selection colour, at the highlight width.
 */

import { describe, expect, test } from "bun:test";
import { drawDisplay, gridStep, handleHex, isHighlighted, lineWidthPx, SELECTION_WIDTH, type Palette } from "./canvas";
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
