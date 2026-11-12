/**
 * The canvas renderer: display list in, pixels out. It maps world → screen through the view
 * rectangle and strokes/fills the four primitive kinds; it owns no drawing geometry — the engine
 * does. Everything here is allocation-light so a pan/zoom can redraw on every pointer move.
 */

import { boundsOfPrim, type DisplayList, type DisplayPrim } from "./display";
import { makeProjection, normalizeRect, rectsOverlap, type Point, type Rect } from "./view";

export interface Palette {
  canvas: string;
  gridMinor: string;
  gridMajor: string;
  axisX: string;
  axisY: string;
  /** The selection highlight stroke (the `--selection` token, Cursor's accent). */
  selection: string;
}

/** Point markers are drawn this many CSS px across (the engine's marker, not world geometry). */
export const POINT_SIZE = 4;

/** The selection highlight's stroke width, in CSS px. */
export const SELECTION_WIDTH = 1.5;

/**
 * Lineweight display: the desktop canvas draws `lw` (mm) as `lw * 3.78` CSS px, clamped to
 * [1, 12] (`crates/ui-egui/src/canvas.rs`, "display lineweights"). It is screen-space, not
 * zoomed — matching it keeps the two canvases looking alike.
 */
export function lineWidthPx(lwMm: number): number {
  return lwMm > 0 ? Math.min(12, Math.max(1, lwMm * 3.78)) : 1;
}

/** Whether two palettes hold the same inks (a theme change that did not touch the canvas's). */
export function samePalette(a: Palette, b: Palette): boolean {
  return a.canvas === b.canvas && a.gridMinor === b.gridMinor && a.gridMajor === b.gridMajor && a.axisX === b.axisX && a.axisY === b.axisY && a.selection === b.selection;
}

/** Read the model-space colours from the CSS custom properties (tokens.css is their source). */
export function paletteFrom(element: Element): Palette {
  const cs = getComputedStyle(element);
  const get = (name: string, fallback: string): string => {
    const v = cs.getPropertyValue(name).trim();
    return v === "" ? fallback : v;
  };
  return {
    canvas: get("--canvas", "#181818"),
    gridMinor: get("--grid-minor", "#202020"),
    gridMajor: get("--grid-major", "#2a2a2a"),
    axisX: get("--axis-x", "#552633"),
    axisY: get("--axis-y", "#23412f"),
    selection: get("--selection", "#81a1c1"),
  };
}

export interface DrawOptions {
  /** View size in CSS pixels (the canvas's client box). */
  width: number;
  height: number;
  dpr: number;
  palette: Palette;
  /** Draw the unit grid behind the primitives (helps read pan/zoom before the drawing is big). */
  grid: boolean;
  /**
   * Handles to highlight. A primitive whose `handle` is in the set is stroked again on top with
   * the palette's selection colour at [`SELECTION_WIDTH`]; absent or empty draws nothing extra.
   */
  selection?: ReadonlySet<string>;
}

/**
 * Whether a primitive takes the selection highlight. The engine's handles are hex strings
 * (`Handle::hex`), and the shell builds the set from `selection()`; an absent handle never
 * highlights.
 */
export function isHighlighted(handle: string, selection: ReadonlySet<string>): boolean {
  return handle !== "" && selection.has(handle);
}

/**
 * A display primitive's handle (the wire's raw `u64`) as the engine's own hex spelling
 * (`Handle::hex`: upper case, no padding), which is what `selection()` replies with.
 */
export function handleHex(handle: number): string {
  if (!Number.isFinite(handle) || handle <= 0) return "";
  return Math.trunc(handle).toString(16).toUpperCase();
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The world span, in world units, that one CSS pixel covers along x. */
function pxPerUnit(view: Rect, width: number): number {
  const w = width > 0 ? width : 1;
  return (view.x1 - view.x0) / w;
}

/** Minor grid lines closer together than this (CSS px) are not drawn: the next decade takes over. */
export const GRID_MIN_PX = 10;

/** The spacing (CSS px) at which a minor line has faded fully in. */
export const GRID_FULL_PX = 30;

/** The spacing (CSS px) from which a minor line starts to take the major line's ink. */
export const GRID_PROMOTE_PX = 60;

/** How the grid is drawn at a zoom: the minor step (world units) and the two inks' strengths. */
export interface GridLevels {
  /** The minor step, a power of ten; every tenth line is a major line. */
  step: number;
  /** The minor ink's opacity, 0..1: it fades in as the lines part. */
  minorAlpha: number;
  /** How much of the major ink lies over the minor lines, 0..1: it rises as they near promotion. */
  majorBlend: number;
}

/**
 * The grid for a view: minor lines a power of ten apart, between [`GRID_MIN_PX`] and ten times
 * that on screen. Their look is a continuous function of the zoom: zooming out, the lines fade as
 * they crowd and are gone before the step changes; zooming in, they take the major ink as they
 * part, and are the major lines when the next decade appears, faint, between them. Nothing pops
 * and the grid never turns to noise. A degenerate view or canvas draws the unit grid.
 */
export function gridLevels(view: Rect, width: number): GridLevels {
  const per = pxPerUnit(view, width);
  const raw = per * GRID_MIN_PX;
  if (!Number.isFinite(raw) || raw <= 0) return { step: 1, minorAlpha: 1, majorBlend: 0 };
  const step = Math.pow(10, Math.ceil(Math.log10(raw)));
  const spacing = step / per;
  if (!Number.isFinite(step) || !(step > 0) || !Number.isFinite(spacing)) return { step: 1, minorAlpha: 1, majorBlend: 0 };
  const ramp = (from: number, to: number): number => Math.max(0, Math.min(1, (spacing - from) / (to - from)));
  return { step, minorAlpha: ramp(GRID_MIN_PX, GRID_FULL_PX), majorBlend: ramp(GRID_PROMOTE_PX, GRID_MIN_PX * 10) };
}

/**
 * Where to stroke a one-pixel rule so it lands on whole device pixels: its centre and its width,
 * in CSS px. The rule is a whole number of device pixels wide (one at ratios below 2, two at 2,
 * three at 3) and its edges sit on device pixel boundaries, so it is as sharp at a ratio of 1.5 as
 * at 1 or 2 instead of smearing across two rows of pixels.
 */
export function crispRule(css: number, dpr: number): { at: number; width: number } {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const device = Math.max(1, Math.floor(scale + 1e-6));
  const edge = Math.round(css * scale - device / 2);
  return { at: (edge + device / 2) / scale, width: device / scale };
}

export function drawDisplay(ctx: CanvasRenderingContext2D, list: DisplayList, view: Rect, options: DrawOptions): void {
  const { width, height, dpr, palette } = options;
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const scale = Math.max(0.25, Math.min(8, dpr));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, w, h);

  const proj = makeProjection(view, { w, h });
  if (options.grid) drawGrid(ctx, normalizeRect(view), w, h, scale, palette);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const prim of list.prims) {
    const b = boundsOfPrim(prim, list.verts);
    if (b === null || !rectsOverlap(b, view)) continue;
    drawPrim(ctx, prim, list, proj.projectX, proj.projectY);
  }

  // The selection highlight: the selected primitives are stroked again on top, in the accent,
  // so the pick reads without changing the drawing's own colours.
  const selection = options.selection;
  if (selection !== undefined && selection.size > 0) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = SELECTION_WIDTH;
    ctx.setLineDash([]);
    for (const prim of list.prims) {
      if (!isHighlighted(handleHex(prim.handle), selection)) continue;
      const b = boundsOfPrim(prim, list.verts);
      if (b === null || !rectsOverlap(b, view)) continue;
      highlightPrim(ctx, prim, list.verts, { projectX: proj.projectX, projectY: proj.projectY, m: null });
    }
  }
  ctx.globalAlpha = 1;
}

/** A drag's transform: world `(x, y)` goes to `(a·x + c·y + e, b·x + d·y + f)` (`PreviewDrag.matrix`). */
export type Matrix = readonly [number, number, number, number, number, number];

/** World to screen, through a drag's matrix first when there is one. */
interface Mapping {
  projectX: (x: number) => number;
  projectY: (y: number) => number;
  m: Matrix | null;
}

/** Where a vertex lands on screen, or null when it (or its image under the matrix) is not finite. */
function place(p: Point | undefined, map: Mapping): Point | null {
  if (p === undefined || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const m = map.m;
  const x = m === null ? p.x : m[0] * p.x + m[2] * p.y + m[4];
  const y = m === null ? p.y : m[1] * p.x + m[3] * p.y + m[5];
  return Number.isFinite(x) && Number.isFinite(y) ? { x: map.projectX(x), y: map.projectY(y) } : null;
}

/**
 * Put a primitive's outline on the current path: a polyline's run, an image's closed frame, each
 * whole triangle closed. False for a point primitive and for one with nothing finite to trace.
 */
function tracePrim(ctx: CanvasRenderingContext2D, prim: DisplayPrim, verts: readonly Point[], map: Mapping): boolean {
  if (prim.kind === "point") return false;
  const end = Math.min(prim.start + prim.len, verts.length);
  let started = false;
  if (prim.kind === "tris") {
    for (let i = prim.start; i + 2 < end; i += 3) {
      const a = place(verts[i], map);
      const b = place(verts[i + 1], map);
      const c = place(verts[i + 2], map);
      if (a === null || b === null || c === null) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      started = true;
    }
    return started;
  }
  for (let i = prim.start; i < end; i++) {
    const s = place(verts[i], map);
    if (s === null) continue;
    if (started) ctx.lineTo(s.x, s.y);
    else {
      ctx.moveTo(s.x, s.y);
      started = true;
    }
  }
  if (started && prim.kind === "image") ctx.closePath();
  return started;
}

/** Stroke a primitive's own outline again in the ink in hand (the selection, a hover, a rubber band). */
function highlightPrim(ctx: CanvasRenderingContext2D, prim: DisplayPrim, verts: readonly Point[], map: Mapping): void {
  if (prim.kind === "point") {
    const s = place(verts[prim.start], map);
    if (s !== null) ctx.strokeRect(s.x - POINT_SIZE / 2, s.y - POINT_SIZE / 2, POINT_SIZE, POINT_SIZE);
    return;
  }
  ctx.beginPath();
  if (tracePrim(ctx, prim, verts, map)) ctx.stroke();
}

/** Draw a primitive in its own colour at [`DRAG_ALPHA`] of its opacity: an object following the pointer. */
function ghostPrim(ctx: CanvasRenderingContext2D, prim: DisplayPrim, verts: readonly Point[], map: Mapping): void {
  ctx.globalAlpha = prim.alpha * DRAG_ALPHA;
  ctx.strokeStyle = rgb(prim.color);
  ctx.fillStyle = rgb(prim.color);
  if (prim.kind === "point") {
    const s = place(verts[prim.start], map);
    if (s !== null) ctx.fillRect(s.x - POINT_SIZE / 2, s.y - POINT_SIZE / 2, POINT_SIZE, POINT_SIZE);
    return;
  }
  ctx.lineWidth = prim.kind === "polyline" ? lineWidthPx(prim.lw) : 1;
  ctx.beginPath();
  if (!tracePrim(ctx, prim, verts, map)) return;
  if (prim.kind === "tris") ctx.fill();
  else ctx.stroke();
}

/** How strong the hover ink is against the selection's: the same hue, quieter. */
export const HOVER_ALPHA = 0.5;

/** How strong the dragged objects' own colours are while they follow the pointer. */
export const DRAG_ALPHA = 0.55;

/** A rubber band's fill (a preview's solid area) against its outline. */
export const RUBBER_FILL_ALPHA = 0.18;

/** The rubber band's stroke width, in CSS px: a construction line, finer than the selection's. */
export const RUBBER_WIDTH = 1;

/** Half the object-snap marker's box, in CSS px: the same size at any zoom. */
export const SNAP_MARKER_HALF = 6;

/** The object-snap marker's stroke width, in CSS px. */
export const SNAP_MARKER_WIDTH = 1.5;

/** One stroke of a snap marker, in a box from -1 to 1 with y down (the screen's). */
export type SnapShape = { kind: "path"; points: readonly (readonly [number, number])[]; closed: boolean } | { kind: "circle"; cx: number; cy: number; r: number };

const stroke = (...points: (readonly [number, number])[]): SnapShape => ({ kind: "path", points, closed: false });
const outline = (...points: (readonly [number, number])[]): SnapShape => ({ kind: "path", points, closed: true });
const SQUARE = outline([-1, -1], [1, -1], [1, 1], [-1, 1]);
const SALTIRE = [stroke([-1, -1], [1, 1]), stroke([-1, 1], [1, -1])];

/** The marker of each object snap, by the engine's OSMODE bit (`SnapPoint.mode`). */
const SNAP_GLYPHS: Readonly<Record<number, readonly SnapShape[]>> = {
  1: [SQUARE],
  2: [outline([0, -1], [1, 0.8], [-1, 0.8])],
  4: [{ kind: "circle", cx: 0, cy: 0, r: 1 }],
  8: [{ kind: "circle", cx: 0, cy: 0, r: 1 }, stroke([-0.7, -0.7], [0.7, 0.7]), stroke([-0.7, 0.7], [0.7, -0.7])],
  16: [outline([0, -1], [1, 0], [0, 1], [-1, 0])],
  32: SALTIRE,
  64: [outline([-1, -1], [0.3, -1], [0.3, 0.3], [-1, 0.3]), outline([-0.3, -0.3], [1, -0.3], [1, 1], [-0.3, 1])],
  128: [stroke([-1, -1], [-1, 1], [1, 1]), stroke([-1, 0], [0, 0], [0, 1])],
  256: [{ kind: "circle", cx: 0, cy: 0.25, r: 0.75 }, stroke([-1, -0.5], [1, -0.5])],
  512: [outline([-1, -1], [1, -1], [-1, 1], [1, 1])],
  1024: [stroke([0, -1], [0, 1]), stroke([-0.87, -0.5], [0.87, 0.5]), stroke([-0.87, 0.5], [0.87, -0.5])],
  2048: [SQUARE, ...SALTIRE],
  4096: [stroke([-1, 0], [-0.5, 0]), stroke([-0.25, 0], [0.25, 0]), stroke([0.5, 0], [1, 0]), stroke([1, -0.5], [1, 0.5])],
  8192: [stroke([-1, 0.2], [0.4, -1]), stroke([-0.4, 1], [1, -0.2])],
};

/** A snap of a kind this build does not know: an upright cross, so the point is still marked. */
const SNAP_FALLBACK: readonly SnapShape[] = [stroke([-1, 0], [1, 0]), stroke([0, -1], [0, 1])];

/**
 * The marker for an object snap, keyed on the engine's OSMODE bit: a square for an endpoint, a
 * triangle for a midpoint, a circle for a centre, a saltire for an intersection, and so on, each
 * its own simple figure so the kind reads before the label does. An unknown bit is a cross.
 */
export function snapGlyph(mode: number): readonly SnapShape[] {
  return SNAP_GLYPHS[mode] ?? SNAP_FALLBACK;
}

/** Put a snap marker's strokes on the current path, centred on a screen point. */
function traceSnap(ctx: CanvasRenderingContext2D, glyph: readonly SnapShape[], x: number, y: number, half: number): void {
  for (const shape of glyph) {
    if (shape.kind === "circle") {
      ctx.moveTo(x + (shape.cx + shape.r) * half, y + shape.cy * half);
      ctx.arc(x + shape.cx * half, y + shape.cy * half, shape.r * half, 0, Math.PI * 2);
      continue;
    }
    shape.points.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(x + px * half, y + py * half);
      else ctx.lineTo(x + px * half, y + py * half);
    });
    if (shape.closed) ctx.closePath();
  }
}

/** The running command's rubber band, as the overlay draws it (the facade's `CommandPreview`). */
export interface OverlayPreview {
  verts: readonly Point[];
  prims: readonly DisplayPrim[];
  drag: { handles: readonly number[]; matrix: Matrix; clipboard: boolean } | null;
}

/** What lies over the drawing under the pointer; every part may be absent. */
export interface OverlayOptions {
  width: number;
  height: number;
  dpr: number;
  palette: Palette;
  /** The handle a click would select (the engine's hex), outlined in the hover ink. */
  hover: string | null;
  /** The running command's rubber band. */
  preview: OverlayPreview | null;
  /** The object snap in hand: where (world) and which (the OSMODE bit). */
  snap: { point: Point; mode: number } | null;
}

/** Whether an overlay with these parts draws nothing at all. */
export function overlayIsEmpty(options: Pick<OverlayOptions, "hover" | "preview" | "snap">): boolean {
  const preview = options.preview;
  return options.hover === null && options.snap === null && (preview === null || (preview.prims.length === 0 && preview.drag === null));
}

/**
 * Draw what follows the pointer, on a canvas of its own over the drawing (so a pointer move
 * repaints these few strokes and never the display list): the hover outline; the dragged objects
 * of a MOVE, COPY, ROTATE, SCALE or MIRROR, which are the primitives of `list` whose handle the
 * drag names, moved by its matrix, in their own colours at [`DRAG_ALPHA`]; the rubber band's own
 * primitives in the selection ink (pasted objects, which are not in the drawing, in their own
 * colours); and the object-snap marker, the same size at any zoom, over a hairline of the
 * canvas's ground so it reads where it lies on geometry. The canvas is cleared first.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, list: DisplayList, view: Rect, options: OverlayOptions): void {
  const { width, height, dpr, palette, hover, preview, snap } = options;
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const scale = Math.max(0.25, Math.min(8, dpr));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const proj = makeProjection(view, { w, h });
  const still: Mapping = { projectX: proj.projectX, projectY: proj.projectY, m: null };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);

  if (hover !== null && hover !== "") {
    ctx.globalAlpha = HOVER_ALPHA;
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = SELECTION_WIDTH;
    for (const prim of list.prims) {
      if (handleHex(prim.handle) !== hover) continue;
      const b = boundsOfPrim(prim, list.verts);
      if (b === null || !rectsOverlap(b, view)) continue;
      highlightPrim(ctx, prim, list.verts, still);
    }
  }

  if (preview !== null) {
    const drag = preview.drag;
    if (drag !== null && drag.handles.length > 0) {
      const dragged = new Set(drag.handles);
      const moved: Mapping = { projectX: proj.projectX, projectY: proj.projectY, m: drag.matrix };
      for (const prim of list.prims) {
        if (dragged.has(prim.handle)) ghostPrim(ctx, prim, list.verts, moved);
      }
    }
    const pasted = drag !== null && drag.clipboard;
    for (const prim of preview.prims) {
      if (pasted && prim.handle !== 0) {
        ghostPrim(ctx, prim, preview.verts, still);
        continue;
      }
      ctx.strokeStyle = palette.selection;
      ctx.fillStyle = palette.selection;
      ctx.lineWidth = RUBBER_WIDTH;
      if (prim.kind === "tris") {
        ctx.globalAlpha = RUBBER_FILL_ALPHA;
        ctx.beginPath();
        if (tracePrim(ctx, prim, preview.verts, still)) ctx.fill();
        continue;
      }
      ctx.globalAlpha = 1;
      highlightPrim(ctx, prim, preview.verts, still);
    }
  }

  if (snap !== null && Number.isFinite(snap.point.x) && Number.isFinite(snap.point.y)) {
    const x = Math.round(proj.projectX(snap.point.x));
    const y = Math.round(proj.projectY(snap.point.y));
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.beginPath();
    traceSnap(ctx, snapGlyph(snap.mode), x, y, SNAP_MARKER_HALF);
    ctx.strokeStyle = palette.canvas;
    ctx.lineWidth = SNAP_MARKER_WIDTH + 2;
    ctx.stroke();
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = SNAP_MARKER_WIDTH;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The most grid lines drawn along one axis: the spacing floor keeps a real canvas far below it. */
const MAX_GRID_LINES = 2000;

function drawGrid(ctx: CanvasRenderingContext2D, view: Rect, w: number, h: number, dpr: number, palette: Palette): void {
  const { step, minorAlpha, majorBlend } = gridLevels(view, w);
  const spanX = view.x1 - view.x0;
  const spanY = view.y1 - view.y0;
  const width = crispRule(0, dpr).width;
  /** Put every rule of one rank (1 major, 2 minor; 0 is the axes, drawn last) on one path. */
  const trace = (rank: 1 | 2): void => {
    ctx.beginPath();
    const rankOf = (k: number): number => (k === 0 ? 0 : k % 10 === 0 ? 1 : 2);
    const firstX = Math.ceil(view.x0 / step);
    for (let i = 0, k = firstX; i < MAX_GRID_LINES && k * step <= view.x1; i++, k++) {
      if (rankOf(k) !== rank) continue;
      const sx = crispRule(((k * step - view.x0) / spanX) * w, dpr).at;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    const firstY = Math.ceil(view.y0 / step);
    for (let i = 0, k = firstY; i < MAX_GRID_LINES && k * step <= view.y1; i++, k++) {
      if (rankOf(k) !== rank) continue;
      const sy = crispRule(h - ((k * step - view.y0) / spanY) * h, dpr).at;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
  };
  const ink = (style: string, alpha: number): void => {
    if (!(alpha > 0)) return;
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  };
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.setLineDash([]);
  if (minorAlpha > 0) {
    trace(2);
    ink(palette.gridMinor, minorAlpha);
    ink(palette.gridMajor, majorBlend);
  }
  trace(1);
  ink(palette.gridMajor, 1);
  // The axes last, each in its own ink: the vertical rule at x = 0 is the Y axis.
  if (view.x0 <= 0 && view.x1 >= 0) {
    const sx = crispRule((-view.x0 / spanX) * w, dpr).at;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ink(palette.axisY, 1);
  }
  if (view.y0 <= 0 && view.y1 >= 0) {
    const sy = crispRule(h + (view.y0 / spanY) * h, dpr).at;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ink(palette.axisX, 1);
  }
  ctx.globalAlpha = 1;
}

function drawPrim(
  ctx: CanvasRenderingContext2D,
  prim: DisplayPrim,
  list: DisplayList,
  projectX: (x: number) => number,
  projectY: (y: number) => number,
): void {
  const end = Math.min(prim.start + prim.len, list.verts.length);
  ctx.globalAlpha = prim.alpha;
  ctx.strokeStyle = rgb(prim.color);
  ctx.fillStyle = rgb(prim.color);
  switch (prim.kind) {
    case "polyline": {
      // Lineweight is mm; drawn as display px like the desktop canvas (see lineWidthPx).
      ctx.lineWidth = lineWidthPx(prim.lw);
      ctx.beginPath();
      let started = false;
      for (let i = prim.start; i < end; i++) {
        const p = list.verts[i] as Point;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const sx = projectX(p.x);
        const sy = projectY(p.y);
        if (started) ctx.lineTo(sx, sy);
        else {
          ctx.moveTo(sx, sy);
          started = true;
        }
      }
      if (started) ctx.stroke();
      break;
    }
    case "tris": {
      ctx.beginPath();
      for (let i = prim.start; i + 2 < end; i += 3) {
        const a = list.verts[i] as Point;
        const b = list.verts[i + 1] as Point;
        const c = list.verts[i + 2] as Point;
        if (![a, b, c].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
        ctx.moveTo(projectX(a.x), projectY(a.y));
        ctx.lineTo(projectX(b.x), projectY(b.y));
        ctx.lineTo(projectX(c.x), projectY(c.y));
        ctx.closePath();
      }
      ctx.fill();
      break;
    }
    case "point": {
      const p = list.verts[prim.start] as Point;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) break;
      const sx = projectX(p.x);
      const sy = projectY(p.y);
      ctx.fillRect(sx - POINT_SIZE / 2, sy - POINT_SIZE / 2, POINT_SIZE, POINT_SIZE);
      break;
    }
    case "image": {
      // v1 draws the quad's frame only; the pixels are not in the display list JSON yet.
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      let started = false;
      for (let i = prim.start; i < end; i++) {
        const p = list.verts[i] as Point;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const sx = projectX(p.x);
        const sy = projectY(p.y);
        if (started) ctx.lineTo(sx, sy);
        else {
          ctx.moveTo(sx, sy);
          started = true;
        }
      }
      if (started) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
  }
}
