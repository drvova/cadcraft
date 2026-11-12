/**
 * The canvas's screen-space constants: the lineweight display rule (mm → px) the desktop canvas
 * uses, the grid's levels and the device-pixel snap of its rules. Pure functions, so they are
 * pinned here.
 *
 * The selection's mark is pinned too: a recording context stands in for the 2D canvas (no DOM),
 * so the drawing path can be checked: a selected primitive keeps its own colour, over a halo of
 * the selection ink and under a dash of it. So are the grips (their boxes on device pixels, their
 * three heats) and where the label beside the point a click will take stands.
 */

import { describe, expect, test } from "bun:test";
import {
  ACQUIRED_HALF,
  crispRule,
  DRAG_ALPHA,
  drawDisplay,
  drawOverlay,
  DYNAMIC_GRIP_REACH,
  dynamicGripShape,
  GRID_DOT_RADIUS,
  GRID_FULL_PX,
  GRID_MIN_PX,
  gridLevels,
  GRIP_WARM_GROW,
  gripBox,
  gripHeat,
  GUIDE_ALPHA,
  GUIDE_DASH,
  guideIsEmpty,
  HALO_ALPHA,
  HALO_HOVER_EXTRA,
  HALO_SPREAD,
  handleHex,
  HOVER_ALPHA,
  HOVER_SPREAD,
  LABEL_GAP,
  isHighlighted,
  lineWidthPx,
  overlayIsEmpty,
  placeLabel,
  RUBBER_WIDTH,
  samePalette,
  SELECTION_DASH,
  SNAP_MARKER_HALF,
  SNAP_MARKER_WIDTH,
  snapGlyph,
  type GripMark,
  type OverlayGuide,
  type OverlayOptions,
  type Palette,
} from "./canvas";
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
  /** The dash each stroke was made with (`[]` is solid), in the order of `strokes`. */
  readonly dashes: number[][] = [];
  private dash: number[] = [];
  setLineDash(segments?: number[]): void {
    this.dash = [...(segments ?? [])];
  }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
    this.dashes.push(this.dash);
  }
  fill(): void {
    this.fills.push(this.fillStyle);
  }
  fillRect(): void {
    this.fillRects.push(this.fillStyle);
  }
  strokeRect(): void {
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha });
    this.dashes.push(this.dash);
  }
}

const INKS = {
  canvas: "#181818",
  gridMinor: "#202020",
  gridMajor: "#2a2a2a",
  axisX: "#552633",
  axisY: "#23412f",
  selection: "#81a1c1",
};

/** The grips' two warm inks stand in as two of the other inks: all that matters here is that the three differ. */
const PALETTE: Palette = { ...INKS, gripHover: INKS.axisX, gripHot: INKS.axisY };

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
    // The grips' two warm inks are part of it: a theme that changes only them redraws the grips.
    expect(samePalette(PALETTE, { ...PALETTE, gripHover: PALETTE.gripHot })).toBe(false);
    expect(samePalette(PALETTE, { ...PALETTE, gripHot: PALETTE.gripHover })).toBe(false);
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

describe("drawDisplay, the selection's mark", () => {
  const OWN = "rgb(212,212,212)";
  /** Another colour as the renderer writes it: the test primitives' own, with its three numbers changed. */
  const ink = (color: readonly [number, number, number]): string => OWN.replace(prim("point", 0, 1, 0).color.join(","), color.join(","));
  const RED = [255, 0, 0] as const;
  const YELLOW = [255, 255, 0] as const;

  test("without a selection, each primitive is drawn once", () => {
    const ctx = draw();
    expect(ctx.strokes).toHaveLength(1);
    expect(ctx.strokes[0]?.style).toBe(OWN);
    expect(ctx.strokes[0]?.width).toBeCloseTo(lineWidthPx(0.25), 6);
    expect(ctx.fills).toHaveLength(0);
    // The background fill plus the point marker.
    expect(ctx.fillRects).toHaveLength(2);
  });

  test("a selected polyline keeps its own colour, over a halo of the selection ink and under a dash of it", () => {
    const ctx = draw(new Set(["2F"]));
    const own = lineWidthPx(0.25);
    expect(ctx.strokes).toEqual([
      { style: PALETTE.selection, width: own + HALO_SPREAD, alpha: HALO_ALPHA },
      { style: OWN, width: own, alpha: 1 },
      { style: PALETTE.selection, width: own, alpha: 1 },
    ]);
    // The halo and the object are solid; only the mark over the object is dashed.
    expect(ctx.dashes).toEqual([[], [], [...SELECTION_DASH]]);
    expect(ctx.fills).toHaveLength(0);
  });

  test("the halo is wider than the object and the dash leaves most of the object's colour showing", () => {
    expect(HALO_SPREAD).toBeGreaterThanOrEqual(2);
    expect(HALO_ALPHA).toBeLessThan(1);
    expect(SELECTION_DASH[1]).toBeGreaterThan(SELECTION_DASH[0]);
  });

  test("a selected point has a larger box of the selection ink under its marker, and its marker outlined whole", () => {
    const ctx = draw(new Set(["30"]));
    // The ground, the halo's box, then the point's own marker.
    expect(ctx.fillRects).toEqual([PALETTE.canvas, PALETTE.selection, OWN]);
    expect(ctx.strokes).toEqual([
      { style: OWN, width: lineWidthPx(0.25), alpha: 1 },
      { style: PALETTE.selection, width: 1, alpha: 1 },
    ]);
    expect(ctx.dashes[1]).toEqual([]);
  });

  test("a handle the display list does not carry marks nothing", () => {
    const ctx = draw(new Set(["99"]));
    expect(ctx.strokes).toHaveLength(1);
  });

  test("an empty selection draws exactly what no selection draws", () => {
    const withEmpty = draw(new Set());
    const without = draw();
    expect(withEmpty.strokes.length).toBe(without.strokes.length);
    expect(withEmpty.fills.length).toBe(without.fills.length);
  });

  test("a selected tris primitive is filled once in its own colour, between a band along its edges and a dash on them", () => {
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
    expect(ctx.fills).toEqual([OWN]);
    expect(ctx.strokes).toEqual([
      { style: PALETTE.selection, width: HALO_SPREAD, alpha: HALO_ALPHA },
      { style: PALETTE.selection, width: 1, alpha: 1 },
    ]);
  });

  test("the mark never touches the primitives' own colour or lineweight: a mixed selection keeps every colour", () => {
    const colours: DisplayList = {
      ...LIST,
      verts: [...LIST.verts, { x: 2, y: 2 }, { x: 7, y: 3 }],
      prims: [
        { ...prim("polyline", 0, 2, 0x2f), color: [...RED] },
        { ...prim("polyline", 3, 2, 0x32), color: [...YELLOW], lw: 0.5 },
      ],
    };
    const ctx = new RecordingContext();
    drawDisplay(ctx as unknown as CanvasRenderingContext2D, colours, VIEW, { width: 800, height: 600, dpr: 1, palette: PALETTE, grid: false, selection: new Set(["2F", "32"]) });
    // Both halos first, under everything; then the objects; then both dashes.
    expect(ctx.strokes.map((stroke) => stroke.style)).toEqual([PALETTE.selection, PALETTE.selection, ink(RED), ink(YELLOW), PALETTE.selection, PALETTE.selection]);
    expect(ctx.strokes[2]?.width).toBeCloseTo(lineWidthPx(0.25), 6);
    expect(ctx.strokes[3]?.width).toBeCloseTo(lineWidthPx(0.5), 6);
    // Each halo and each dash follows its own object's lineweight.
    expect(ctx.strokes[1]?.width).toBeCloseTo(lineWidthPx(0.5) + HALO_SPREAD, 6);
    expect(ctx.strokes[5]?.width).toBeCloseTo(lineWidthPx(0.5), 6);
  });
});

/** A recorder that also keeps where each path went, and what was cleared. */
class PathContext extends RecordingContext {
  readonly points: { x: number; y: number }[] = [];
  readonly arcs: { x: number; y: number; r: number }[] = [];
  cleared = 0;
  override clearRect(): void {
    this.cleared++;
  }
  override moveTo(x?: number, y?: number): void {
    this.points.push({ x: x ?? NaN, y: y ?? NaN });
  }
  override lineTo(x?: number, y?: number): void {
    this.points.push({ x: x ?? NaN, y: y ?? NaN });
  }
  arc(x: number, y: number, r: number): void {
    this.arcs.push({ x, y, r });
  }
}

describe("snapGlyph", () => {
  const MODES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];

  test("every OSMODE bit the engine reports has a marker of its own", () => {
    const seen = new Set(MODES.map((mode) => JSON.stringify(snapGlyph(mode))));
    expect(seen.size).toBe(MODES.length);
  });

  test("an endpoint is a square, a midpoint a triangle, a centre a circle, an intersection a saltire", () => {
    const end = snapGlyph(1);
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ kind: "path", closed: true });
    expect(end[0]?.kind === "path" ? end[0].points.length : 0).toBe(4);
    const mid = snapGlyph(2)[0];
    expect(mid?.kind === "path" ? mid.points.length : 0).toBe(3);
    expect(snapGlyph(4)).toEqual([{ kind: "circle", cx: 0, cy: 0, r: 1 }]);
    expect(snapGlyph(32)).toHaveLength(2);
    expect(snapGlyph(32).every((s) => s.kind === "path" && !s.closed && s.points.length === 2)).toBe(true);
  });

  test("every marker stays inside its box, and an unknown bit is still marked", () => {
    for (const mode of [...MODES, 0, 3, 16384, Number.NaN]) {
      const glyph = snapGlyph(mode);
      expect(glyph.length).toBeGreaterThan(0);
      for (const shape of glyph) {
        const extent = shape.kind === "circle" ? [shape.cx - shape.r, shape.cx + shape.r, shape.cy - shape.r, shape.cy + shape.r] : shape.points.flat();
        expect(extent.every((n) => n >= -1 && n <= 1)).toBe(true);
      }
    }
  });
});

describe("drawOverlay", () => {
  /** The test primitives' own colour, as the drawing itself strokes it. */
  const OWN = draw().strokes[0]?.style ?? "";
  const overlay = (parts: Partial<Pick<OverlayOptions, "hover" | "hoverSelected" | "preview" | "snap" | "guide" | "grips">>, view = VIEW, dpr = 1): PathContext => {
    const ctx = new PathContext();
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, LIST, view, { width: 800, height: 600, dpr, palette: PALETTE, hover: null, preview: null, snap: null, ...parts });
    return ctx;
  };

  test("with nothing under the pointer it only clears", () => {
    const ctx = overlay({});
    expect(ctx.cleared).toBe(1);
    expect(ctx.strokes).toHaveLength(0);
    expect(ctx.fills).toHaveLength(0);
    expect(overlayIsEmpty({ hover: null, preview: null, snap: null })).toBe(true);
    expect(overlayIsEmpty({ hover: null, preview: { verts: [], prims: [], drag: null }, snap: null })).toBe(true);
    expect(overlayIsEmpty({ hover: "2F", preview: null, snap: null })).toBe(false);
  });

  test("the hover is a halo of the selection ink under the object, which is drawn again over it in its own colour", () => {
    const own = lineWidthPx(0.25);
    const ctx = overlay({ hover: "2F" });
    expect(ctx.strokes).toEqual([
      { style: PALETTE.selection, width: own + HOVER_SPREAD, alpha: HOVER_ALPHA },
      { style: OWN, width: own, alpha: 1 },
    ]);
    // A halo only: nothing of the hover is dashed, which is what tells it from a selected object.
    expect(ctx.dashes).toEqual([[], []]);
    expect(HOVER_SPREAD).toBeGreaterThanOrEqual(2);
    expect(overlay({ hover: "99" }).strokes).toHaveLength(0);
  });

  test("a hovered object that is selected has a wider halo and keeps its dash", () => {
    const own = lineWidthPx(0.25);
    const ctx = overlay({ hover: "2F", hoverSelected: true });
    expect(ctx.strokes).toEqual([
      { style: PALETTE.selection, width: own + HOVER_SPREAD + HALO_HOVER_EXTRA, alpha: HOVER_ALPHA },
      { style: OWN, width: own, alpha: 1 },
      { style: PALETTE.selection, width: own, alpha: 1 },
    ]);
    expect(ctx.dashes[2]).toEqual([...SELECTION_DASH]);
    expect(own + HOVER_SPREAD + HALO_HOVER_EXTRA).toBeGreaterThan(own + HALO_SPREAD);
  });

  const grip = (id: string, x: number, y: number, more: Partial<GripMark> = {}): GripMark => ({ id, point: { x, y }, kind: "standard", locked: false, hot: false, dynamic: null, ...more });
  const marks = (list: readonly GripMark[], hover: string | null = null, collected: readonly string[] = []): OverlayOptions["grips"] => ({ size: 5, list, hover, collected: new Set(collected) });

  test("each grip is a square of the engine's size over a hairline of the ground, in the ink of its heat", () => {
    const ctx = overlay({ grips: marks([grip("A:0", 1, 1), grip("A:1", 5, 5), grip("A:2", 9, 9, { hot: true })], "A:1") });
    // Cold first, then the warm ones over them: each a ground box under its ink.
    expect(ctx.fillRects).toEqual([PALETTE.canvas, PALETTE.selection, PALETTE.canvas, PALETTE.gripHover, PALETTE.canvas, PALETTE.gripHot]);
    expect(ctx.strokes).toHaveLength(0);
    expect(new Set([PALETTE.selection, PALETTE.gripHover, PALETTE.gripHot]).size).toBe(3);
    expect(overlayIsEmpty({ hover: null, preview: null, snap: null, grips: marks([grip("A:0", 1, 1)]) })).toBe(false);
    expect(overlayIsEmpty({ hover: null, preview: null, snap: null, grips: marks([]) })).toBe(true);
  });

  test("a locked grip is hollow, a grip off the canvas is not drawn, and a hostile point is skipped", () => {
    const locked = overlay({ grips: marks([grip("A:0", 5, 5, { locked: true })]) });
    expect(locked.fillRects).toEqual([PALETTE.canvas, PALETTE.selection, PALETTE.canvas]);
    expect(overlay({ grips: marks([grip("A:0", 50, 50), grip("A:1", Number.NaN, 1), grip("A:2", -40, 5)]) }).fillRects).toHaveLength(0);
  });

  test("a dynamic block grip is a figure of its kind, filled with the ink of its heat", () => {
    const linear = overlay({ grips: marks([grip("B:d1:end", 5, 5, { kind: "linear", dynamic: { dir: { x: 1, y: 0 } } })]) });
    expect(linear.fills).toEqual([PALETTE.selection]);
    expect(linear.fillRects).toHaveLength(0);
    expect(linear.points).toHaveLength(3);
    // The arrowhead points along the parameter, and reaches further than a square grip's half.
    expect(linear.points[0]).toEqual({ x: 400 + (5 * DYNAMIC_GRIP_REACH) / 2, y: 300 });
    const list = overlay({ grips: marks([grip("B:d2:at", 5, 5, { kind: "list", dynamic: { dir: { x: 0, y: 0 } } })], "B:d2:at") });
    expect(list.fills).toEqual([PALETTE.gripHover]);
  });

  test("a rubber band is stroked in the selection ink, a hairline", () => {
    const preview = { verts: [{ x: 0, y: 0 }, { x: 5, y: 5 }], prims: [prim("polyline", 0, 2, 0)], drag: null };
    const ctx = overlay({ preview });
    expect(ctx.strokes).toEqual([{ style: PALETTE.selection, width: RUBBER_WIDTH, alpha: 1 }]);
    expect(ctx.points).toEqual([
      { x: 0, y: 600 },
      { x: 400, y: 300 },
    ]);
  });

  test("dragged objects are the list's own primitives under the matrix, in their own colour, fainter", () => {
    // Move by (2, 1): the polyline (1,1)-(4,4) is drawn from (3,2) to (6,5); the point follows.
    const preview = { verts: [], prims: [], drag: { handles: [0x2f, 0x30], matrix: [1, 0, 0, 1, 2, 1] as const, clipboard: false } };
    const ctx = overlay({ preview });
    expect(ctx.strokes).toEqual([{ style: OWN, width: lineWidthPx(0.25), alpha: DRAG_ALPHA }]);
    expect(ctx.points[0]?.x).toBeCloseTo(240, 9);
    expect(ctx.points[0]?.y).toBeCloseTo(480, 9);
    expect(ctx.points[1]?.x).toBeCloseTo(480, 9);
    expect(ctx.points[1]?.y).toBeCloseTo(300, 9);
    expect(ctx.fillRects).toEqual([OWN]);
  });

  test("a rotation turns the dragged vertices: the matrix is a canvas transform's", () => {
    // A quarter turn about the origin: (x, y) goes to (-y, x).
    const preview = { verts: [], prims: [], drag: { handles: [0x2f], matrix: [0, 1, -1, 0, 0, 0] as const, clipboard: false } };
    const ctx = overlay({ preview }, { x0: -10, y0: 0, x1: 0, y1: 10 });
    expect(ctx.points[0]?.x).toBeCloseTo(720, 9);
    expect(ctx.points[0]?.y).toBeCloseTo(540, 9);
  });

  test("pasted objects come in the preview and keep their own colour; a matrix that is not finite draws nothing", () => {
    const pasted = { verts: [{ x: 0, y: 0 }, { x: 5, y: 5 }], prims: [prim("polyline", 0, 2, 7)], drag: { handles: [], matrix: [1, 0, 0, 1, 0, 0] as const, clipboard: true } };
    expect(overlay({ preview: pasted }).strokes).toEqual([{ style: OWN, width: lineWidthPx(0.25), alpha: DRAG_ALPHA }]);
    const hostile = { verts: [], prims: [], drag: { handles: [0x2f, 0x30], matrix: [Number.NaN, 0, 0, 1, Number.POSITIVE_INFINITY, 0] as const, clipboard: false } };
    const ctx = overlay({ preview: hostile });
    expect(ctx.strokes).toHaveLength(0);
    expect(ctx.fillRects).toHaveLength(0);
  });

  test("the snap marker is the same size at any zoom, on whole pixels, over a rule of the ground", () => {
    for (const view of [VIEW, { x0: 4.9, y0: 4.9, x1: 5.1, y1: 5.1 }, { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }]) {
      const ctx = overlay({ snap: { point: { x: 5, y: 5 }, mode: 1 } }, view);
      expect(ctx.strokes).toEqual([
        { style: PALETTE.canvas, width: SNAP_MARKER_WIDTH + 2, alpha: 1 },
        { style: PALETTE.selection, width: SNAP_MARKER_WIDTH, alpha: 1 },
      ]);
      const xs = ctx.points.map((p) => p.x);
      const ys = ctx.points.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(SNAP_MARKER_HALF * 2);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(SNAP_MARKER_HALF * 2);
      expect(xs.every((x) => Number.isInteger(x))).toBe(true);
    }
    const centre = overlay({ snap: { point: { x: 5, y: 5 }, mode: 4 } });
    expect(centre.arcs).toEqual([{ x: 400, y: 300, r: SNAP_MARKER_HALF }]);
    expect(overlay({ snap: { point: { x: Number.NaN, y: 5 }, mode: 1 } }).strokes).toHaveLength(0);
  });

  /** A guide with one ray from (1,1) to (9,9), as the engine's `pointer` reply carries it. */
  const ray = (): OverlayGuide => ({ paths: { verts: [{ x: 1, y: 1 }, { x: 9, y: 9 }], prims: [prim("polyline", 0, 2, 0)] }, dot: null, acquired: [] });

  test("an ortho or polar ray is dashed, in the selection ink, quieter than the rubber band over it", () => {
    const preview = { verts: [{ x: 1, y: 1 }, { x: 5, y: 5 }], prims: [prim("polyline", 0, 2, 0)], drag: null };
    const ctx = overlay({ guide: ray(), preview });
    expect(ctx.strokes).toEqual([
      { style: PALETTE.selection, width: RUBBER_WIDTH, alpha: GUIDE_ALPHA },
      { style: PALETTE.selection, width: RUBBER_WIDTH, alpha: 1 },
    ]);
    // The ray is the dashed one and is drawn first, under the band; the band is solid.
    expect(ctx.dashes).toEqual([[...GUIDE_DASH], []]);
    expect(ctx.points.slice(0, 2)).toEqual([
      { x: 80, y: 540 },
      { x: 720, y: 60 },
    ]);
    expect(GUIDE_ALPHA).toBeLessThan(1);
    expect(ctx.fills).toHaveLength(0);
  });

  test("grid snap is a dot at the point, over a ring of the ground, and nothing else", () => {
    const ctx = overlay({ guide: { paths: { verts: [], prims: [] }, dot: { x: 5, y: 5 }, acquired: [] } });
    expect(ctx.strokes).toHaveLength(0);
    expect(ctx.fills).toEqual([PALETTE.canvas, PALETTE.selection]);
    expect(ctx.arcs).toEqual([
      { x: 400, y: 300, r: GRID_DOT_RADIUS + 1 },
      { x: 400, y: 300, r: GRID_DOT_RADIUS },
    ]);
  });

  test("each acquired tracking point is a small upright cross, the same size at any zoom", () => {
    for (const view of [VIEW, { x0: 4.9, y0: 4.9, x1: 5.1, y1: 5.1 }]) {
      const ctx = overlay({ guide: { paths: { verts: [], prims: [] }, dot: null, acquired: [{ x: 5, y: 5 }] } }, view);
      expect(ctx.strokes).toEqual([
        { style: PALETTE.canvas, width: RUBBER_WIDTH + 2, alpha: 1 },
        { style: PALETTE.selection, width: RUBBER_WIDTH, alpha: 1 },
      ]);
      expect(ctx.dashes).toEqual([[], []]);
      const xs = ctx.points.map((p) => p.x);
      const ys = ctx.points.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(ACQUIRED_HALF * 2);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(ACQUIRED_HALF * 2);
    }
  });

  test("a guide with nothing in it draws nothing, and hostile points are skipped", () => {
    const nothing: OverlayGuide = { paths: { verts: [], prims: [] }, dot: null, acquired: [] };
    expect(guideIsEmpty(nothing)).toBe(true);
    expect(guideIsEmpty(null)).toBe(true);
    expect(guideIsEmpty(undefined)).toBe(true);
    expect(guideIsEmpty(ray())).toBe(false);
    expect(overlayIsEmpty({ hover: null, preview: null, snap: null, guide: nothing })).toBe(true);
    expect(overlayIsEmpty({ hover: null, preview: null, snap: null, guide: { ...nothing, dot: { x: 1, y: 1 } } })).toBe(false);
    expect(overlayIsEmpty({ hover: null, preview: null, snap: null, guide: { ...nothing, acquired: [{ x: 1, y: 1 }] } })).toBe(false);
    expect(overlay({ guide: nothing }).strokes).toHaveLength(0);
    const hostile = overlay({ guide: { paths: { verts: [{ x: Number.NaN, y: 1 }, { x: Number.POSITIVE_INFINITY, y: 2 }], prims: [prim("polyline", 0, 2, 0)] }, dot: { x: Number.NaN, y: 0 }, acquired: [{ x: 0, y: Number.NEGATIVE_INFINITY }] } });
    expect(hostile.strokes).toHaveLength(0);
    expect(hostile.fills).toHaveLength(0);
    expect(hostile.points).toHaveLength(0);
  });

  test("the ink is solid again after a guide: the snap marker over it is not dashed", () => {
    const ctx = overlay({ guide: ray(), snap: { point: { x: 5, y: 5 }, mode: 1 } });
    expect(ctx.dashes).toEqual([[...GUIDE_DASH], [], []]);
  });
});

describe("gripHeat", () => {
  test("hot while the engine edits it or Shift collected it, else warm under the pointer, else cold", () => {
    const none = new Set<string>();
    expect(gripHeat({ id: "A:0", hot: false }, null, none)).toBe("cold");
    expect(gripHeat({ id: "A:0", hot: false }, "A:0", none)).toBe("hover");
    expect(gripHeat({ id: "A:0", hot: false }, "A:1", none)).toBe("cold");
    expect(gripHeat({ id: "A:0", hot: true }, null, none)).toBe("hot");
    expect(gripHeat({ id: "A:0", hot: false }, null, new Set(["A:0"]))).toBe("hot");
    // Hot outranks the pointer: a collected grip under the pointer stays hot.
    expect(gripHeat({ id: "A:0", hot: false }, "A:0", new Set(["A:0"]))).toBe("hot");
  });
});

describe("gripBox", () => {
  test("at a ratio of 1 a 5px grip is five whole pixels, centred on the pixel its point is in", () => {
    expect(gripBox(100.5, 50.5, 5, 1)).toEqual({ x: 98, y: 48, side: 5 });
    // A point on a pixel boundary cannot centre an odd box: it goes to the nearer whole pixel.
    const box = gripBox(100, 50, 5, 1);
    expect(Number.isInteger(box.x) && Number.isInteger(box.y)).toBe(true);
    expect(Math.abs(box.x + box.side / 2 - 100)).toBeLessThanOrEqual(0.5);
  });

  test("its edges sit on whole device pixels at every ratio, and it is a whole number of them across", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      for (const [x, y] of [[100, 50], [100.3, 50.7], [0.2, 0.2], [641.49, 333.51]] as const) {
        const box = gripBox(x, y, 5, dpr);
        expect(box.x * dpr).toBeCloseTo(Math.round(box.x * dpr), 9);
        expect(box.y * dpr).toBeCloseTo(Math.round(box.y * dpr), 9);
        expect(box.side * dpr).toBeCloseTo(Math.round(5 * dpr), 9);
        // Never more than half a device pixel from where the engine put the grip.
        expect(Math.abs(box.x + box.side / 2 - x) * dpr).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(box.y + box.side / 2 - y) * dpr).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
    expect(gripBox(10, 10, 5, 1.5).side).toBeCloseTo(8 / 1.5, 9);
    expect(gripBox(10, 10, 5, 2).side).toBe(5);
  });

  test("a size or a ratio that is not a positive number still gives a box, never NaN", () => {
    for (const [size, dpr] of [[0, 1], [-3, 1], [Number.NaN, 2], [5, 0], [5, Number.NaN], [Number.POSITIVE_INFINITY, 1]] as const) {
      const box = gripBox(10, 10, size, dpr);
      expect(Number.isFinite(box.x) && Number.isFinite(box.y) && box.side > 0).toBe(true);
    }
    expect(gripBox(10, 10, 0.2, 1).side).toBe(1);
  });

  test("a warm grip is drawn larger than a cold one, by a whole number of pixels each side", () => {
    expect(GRIP_WARM_GROW % 2).toBe(0);
    expect(gripBox(100.5, 50.5, 5 + GRIP_WARM_GROW, 1)).toEqual({ x: 97, y: 47, side: 7 });
  });
});

describe("dynamicGripShape", () => {
  test("a distance is an arrowhead along its direction, with y turned for the screen", () => {
    const right = dynamicGripShape("linear", { x: 1, y: 0 });
    expect(right[0]).toEqual([1, 0]);
    const up = dynamicGripShape("linear", { x: 0, y: 2 });
    expect(up[0]?.[0]).toBeCloseTo(0, 9);
    expect(up[0]?.[1]).toBeCloseTo(-1, 9);
    // A direction of no length, or one that is not a number, still points somewhere.
    expect(dynamicGripShape("linear", { x: 0, y: 0 })[0]).toEqual([1, 0]);
    expect(dynamicGripShape("linear", { x: Number.NaN, y: 1 })[0]).toEqual([1, 0]);
  });

  test("a position is a diamond and a list a triangle pointing down: each its own figure, inside its box", () => {
    expect(dynamicGripShape("point", { x: 0, y: 0 })).toHaveLength(4);
    const list = dynamicGripShape("list", { x: 0, y: 0 });
    expect(list).toHaveLength(3);
    expect(list[2]).toEqual([0, 1]);
    for (const kind of ["linear", "point", "list"] as const) {
      expect(dynamicGripShape(kind, { x: 0.6, y: 0.8 }).flat().every((n) => Math.abs(n) <= 1.1)).toBe(true);
    }
  });
});

describe("placeLabel", () => {
  const canvas = { w: 1000, h: 600 };
  const label = { w: 80, h: 22 };
  /** Whether the label's box, placed at `to`, holds the point `p`. */
  const holds = (to: { x: number; y: number }, p: { x: number; y: number }): boolean => p.x >= to.x && p.x <= to.x + label.w && p.y >= to.y && p.y <= to.y + label.h;

  test("with no rubber band it stands below and to the right, clear of the marker", () => {
    const to = placeLabel({ x: 500, y: 300 }, label, canvas, null);
    expect(to).toEqual({ x: 500 + LABEL_GAP, y: 300 + LABEL_GAP });
    expect(LABEL_GAP).toBeGreaterThan(SNAP_MARKER_HALF + 8);
  });

  test("it stands on the far side of where the band comes from, on both axes", () => {
    const at = { x: 500, y: 300 };
    // The last point is below and to the left (the screen's y grows downward): above and right.
    expect(placeLabel(at, label, canvas, { x: 280, y: 330 })).toEqual({ x: at.x + LABEL_GAP, y: at.y - LABEL_GAP - label.h });
    // Above and to the right: below and left.
    expect(placeLabel(at, label, canvas, { x: 700, y: 100 })).toEqual({ x: at.x - LABEL_GAP - label.w, y: at.y + LABEL_GAP });
    // Below and to the right: above and left.
    expect(placeLabel(at, label, canvas, { x: 700, y: 500 })).toEqual({ x: at.x - LABEL_GAP - label.w, y: at.y - LABEL_GAP - label.h });
  });

  test("it is never over the marker, the band, or the ray that runs on past the point", () => {
    const at = { x: 500, y: 300 };
    for (let turn = 0; turn < 360; turn += 7) {
      const toward = { x: at.x + 200 * Math.cos((turn * Math.PI) / 180), y: at.y + 200 * Math.sin((turn * Math.PI) / 180) };
      const to = placeLabel(at, label, canvas, toward, true);
      expect(holds(to, at)).toBe(false);
      // No point of the band, or of the ray beyond the point, is inside the label's box.
      for (let t = -1; t <= 1; t += 0.01) expect(holds(to, { x: at.x + (toward.x - at.x) * t, y: at.y + (toward.y - at.y) * t })).toBe(false);
      // And it clears the marker's box by the gap on both axes.
      expect(Math.min(Math.abs(to.x - at.x), Math.abs(to.x + label.w - at.x))).toBeGreaterThanOrEqual(LABEL_GAP - 1e-9);
      expect(Math.min(Math.abs(to.y - at.y), Math.abs(to.y + label.h - at.y))).toBeGreaterThanOrEqual(LABEL_GAP - 1e-9);
    }
  });

  test("a band along an axis does not make the label change sides with the last decimal of the point", () => {
    const at = { x: 500, y: 300 };
    const up = placeLabel(at, label, canvas, { x: 500, y: 500 }, true);
    expect(placeLabel(at, label, canvas, { x: 500 + 1e-9, y: 500 }, true)).toEqual(up);
    expect(placeLabel(at, label, canvas, { x: 500 - 1e-9, y: 500 }, true)).toEqual(up);
    expect(up).toEqual({ x: at.x + LABEL_GAP, y: at.y - LABEL_GAP - label.h });
  });

  test("it stays inside the canvas: a corner that does not fit gives way to one that does", () => {
    // In the bottom right corner there is no room below or to the right.
    const to = placeLabel({ x: 990, y: 590 }, label, canvas, null);
    expect(to).toEqual({ x: 990 - LABEL_GAP - label.w, y: 590 - LABEL_GAP - label.h });
    // Near the right edge the far side of the band is off the canvas: the label goes to the left.
    const edge = placeLabel({ x: 960, y: 300 }, label, canvas, { x: 700, y: 400 });
    expect(edge.x + label.w).toBeLessThanOrEqual(canvas.w);
    expect(edge.x).toBeLessThan(960);
    // A canvas smaller than the label holds it at its own corner, never at a negative place or NaN.
    const tiny = placeLabel({ x: 10, y: 10 }, label, { w: 40, h: 20 }, { x: 0, y: 0 });
    expect(Number.isFinite(tiny.x) && Number.isFinite(tiny.y)).toBe(true);
  });
});
