/**
 * View math: the world rectangle the canvas shows, the screen it maps onto, and the pure
 * transforms between them. No drawing geometry lives here — the canvas maps and draws, the
 * engine owns the geometry.
 *
 * Every entry point tolerates hostile input: a degenerate view (x0 == x1) or a non-finite
 * number must never divide by zero or produce NaN on screen.
 */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ScreenSize {
  w: number;
  h: number;
}

/** Smallest span a normalized rectangle keeps; below it the rect is expanded around its centre. */
export const MIN_SPAN = 1e-9;

export const UNIT_RECT: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** A finite number, or the fallback. */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Order the corners and give a zero-width or zero-height rectangle a visible span, so no
 * mapping can divide by zero. Non-finite corners read as 0.
 */
export function normalizeRect(r: Rect): Rect {
  const ax = finiteOr(r.x0, 0);
  const bx = finiteOr(r.x1, 0);
  const ay = finiteOr(r.y0, 0);
  const by = finiteOr(r.y1, 0);
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return {
    x0: x1 - x0 > MIN_SPAN ? x0 : x0 - 0.5,
    x1: x1 - x0 > MIN_SPAN ? x1 : x1 + 0.5,
    y0: y1 - y0 > MIN_SPAN ? y0 : y0 - 0.5,
    y1: y1 - y0 > MIN_SPAN ? y1 : y1 + 0.5,
  };
}

/** True when the rectangle is unusable as a view (empty, inverted, or non-finite). */
export function rectIsDegenerate(r: Rect): boolean {
  if (!Number.isFinite(r.x0) || !Number.isFinite(r.x1) || !Number.isFinite(r.y0) || !Number.isFinite(r.y1)) return true;
  return !(r.x1 - r.x0 > MIN_SPAN) || !(r.y1 - r.y0 > MIN_SPAN);
}

export interface Projection {
  /** Screen x (CSS px) for a world x. */
  projectX(x: number): number;
  /** Screen y (CSS px) for a world y — screen y grows down, world y grows up. */
  projectY(y: number): number;
  /** Screen pixels per world unit along x (the same along y for a square aspect). */
  readonly scaleX: number;
}

/**
 * Build the world→screen projection for a view. Allocation-free per point, so the draw loop
 * can project a large display list without churn. The view is normalized once here.
 */
export function makeProjection(view: Rect, screen: ScreenSize): Projection {
  const v = normalizeRect(view);
  const w = screen.w > 0 ? screen.w : 1;
  const h = screen.h > 0 ? screen.h : 1;
  const sx = w / (v.x1 - v.x0);
  const sy = h / (v.y1 - v.y0);
  return {
    projectX: (x: number): number => (x - v.x0) * sx,
    projectY: (y: number): number => h - (y - v.y0) * sy,
    scaleX: sx,
  };
}

/** The screen point (CSS px) a world point maps to. */
export function worldToScreen(view: Rect, screen: ScreenSize, p: Point): Point {
  const proj = makeProjection(view, screen);
  return { x: proj.projectX(p.x), y: proj.projectY(p.y) };
}

/** The world point under a screen point (CSS px). */
export function screenToWorld(view: Rect, screen: ScreenSize, p: Point): Point {
  const v = normalizeRect(view);
  const w = screen.w > 0 ? screen.w : 1;
  const h = screen.h > 0 ? screen.h : 1;
  return {
    x: v.x0 + (p.x / w) * (v.x1 - v.x0),
    y: v.y0 + (1 - p.y / h) * (v.y1 - v.y0),
  };
}

/** Zoom by `factor` (>1 zooms out) keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(view: Rect, screen: ScreenSize, anchor: Point, factor: number): Rect {
  const v = normalizeRect(view);
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const a = screenToWorld(v, screen, anchor);
  return normalizeRect({
    x0: a.x + (v.x0 - a.x) * f,
    y0: a.y + (v.y0 - a.y) * f,
    x1: a.x + (v.x1 - a.x) * f,
    y1: a.y + (v.y1 - a.y) * f,
  });
}

/** Drag the view by a screen delta: dragging right moves the drawing right. */
export function panBy(view: Rect, screen: ScreenSize, dxPx: number, dyPx: number): Rect {
  const v = normalizeRect(view);
  const w = screen.w > 0 ? screen.w : 1;
  const h = screen.h > 0 ? screen.h : 1;
  const dx = (finiteOr(dxPx, 0) / w) * (v.x1 - v.x0);
  const dy = (finiteOr(dyPx, 0) / h) * (v.y1 - v.y0);
  return normalizeRect({ x0: v.x0 - dx, y0: v.y0 + dy, x1: v.x1 - dx, y1: v.y1 + dy });
}

/** Grow a rectangle by a fraction of its own span (the initial fit's breathing room). */
export function padRect(r: Rect, fraction: number): Rect {
  const v = normalizeRect(r);
  const f = Number.isFinite(fraction) && fraction > 0 ? fraction : 0;
  const dx = (v.x1 - v.x0) * f;
  const dy = (v.y1 - v.y0) * f;
  return { x0: v.x0 - dx, y0: v.y0 - dy, x1: v.x1 + dx, y1: v.y1 + dy };
}

/** The bounding rectangle of finite points, or null when there are none. */
export function boundsOfPoints(points: readonly Point[]): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}

/** Do two rectangles touch? (Touching edges count, so a cull never drops a visible sliver.) */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/**
 * Read a rectangle from JSON-ish shapes: `[x0,y0,x1,y1]`, `{x0,y0,x1,y1}`, or `{min:[x,y],max:[x,y]}`
 * (the shape `Facade::view` replies with). Returns null when the shape is unknown.
 */
export function parseRect(value: unknown): Rect | null {
  if (Array.isArray(value)) {
    const [a, b, c, d] = value;
    if (typeof a === "number" && typeof b === "number" && typeof c === "number" && typeof d === "number") {
      return { x0: a, y0: b, x1: c, y1: d };
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o["x0"] === "number" && typeof o["y0"] === "number" && typeof o["x1"] === "number" && typeof o["y1"] === "number") {
    return { x0: o["x0"], y0: o["y0"], x1: o["x1"], y1: o["y1"] };
  }
  const min = o["min"];
  const max = o["max"];
  if (Array.isArray(min) && Array.isArray(max)) {
    const [ax, ay] = min;
    const [bx, by] = max;
    if (typeof ax === "number" && typeof ay === "number" && typeof bx === "number" && typeof by === "number") {
      return { x0: ax, y0: ay, x1: bx, y1: by };
    }
  }
  return null;
}
