/**
 * The canvas renderer: display list in, pixels out. It maps world → screen through the view
 * rectangle and strokes/fills the four primitive kinds; it owns no drawing geometry — the engine
 * does. Everything here is allocation-light so a pan/zoom can redraw on every pointer move.
 */

import { boundsOfPrim, type DisplayList, type DisplayPrim } from "./display";
import { makeProjection, rectsOverlap, type Point, type Rect } from "./view";

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

/** A grid step that stays between 8 and 80 px on screen, from the 1-2-5 ladder. */
export function gridStep(view: Rect, width: number): number {
  const target = 48;
  const raw = pxPerUnit(view, width) * target;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const decade = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / decade;
  const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return step * decade;
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
  if (options.grid) drawGrid(ctx, view, w, h, palette);

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
      highlightPrim(ctx, prim, list, proj.projectX, proj.projectY);
    }
  }
  ctx.globalAlpha = 1;
}

/** Stroke a primitive's own outline again for the selection highlight. */
function highlightPrim(
  ctx: CanvasRenderingContext2D,
  prim: DisplayPrim,
  list: DisplayList,
  projectX: (x: number) => number,
  projectY: (y: number) => number,
): void {
  const end = Math.min(prim.start + prim.len, list.verts.length);
  if (prim.kind === "point") {
    const p = list.verts[prim.start] as Point;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const sx = projectX(p.x);
    const sy = projectY(p.y);
    ctx.strokeRect(sx - POINT_SIZE / 2, sy - POINT_SIZE / 2, POINT_SIZE, POINT_SIZE);
    return;
  }
  ctx.beginPath();
  let started = false;
  if (prim.kind === "tris") {
    for (let i = prim.start; i + 2 < end; i += 3) {
      const a = list.verts[i] as Point;
      const b = list.verts[i + 1] as Point;
      const c = list.verts[i + 2] as Point;
      if (![a, b, c].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
      ctx.moveTo(projectX(a.x), projectY(a.y));
      ctx.lineTo(projectX(b.x), projectY(b.y));
      ctx.lineTo(projectX(c.x), projectY(c.y));
      ctx.closePath();
      started = true;
    }
  } else {
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
    if (started && prim.kind === "image") ctx.closePath();
  }
  if (started) ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, view: Rect, w: number, h: number, palette: Palette): void {
  const step = gridStep(view, w);
  const firstX = Math.ceil(view.x0 / step) * step;
  const firstY = Math.ceil(view.y0 / step) * step;
  const toScreenX = (x: number): number => ((x - view.x0) / (view.x1 - view.x0)) * w;
  const toScreenY = (y: number): number => h - ((y - view.y0) / (view.y1 - view.y0)) * h;
  ctx.lineWidth = 1;
  for (let i = 0, x = firstX; x <= view.x1 && i < 4000; i++, x += step) {
    const sx = Math.round(toScreenX(x)) + 0.5;
    const k = Math.round(x / step);
    ctx.strokeStyle = k === 0 ? palette.axisY : k % 10 === 0 ? palette.gridMajor : palette.gridMinor;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let i = 0, y = firstY; y <= view.y1 && i < 4000; i++, y += step) {
    const sy = Math.round(toScreenY(y)) + 0.5;
    const k = Math.round(y / step);
    ctx.strokeStyle = k === 0 ? palette.axisX : k % 10 === 0 ? palette.gridMajor : palette.gridMinor;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }
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
