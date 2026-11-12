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

/**
 * The zoom's floor and ceiling, in world units per CSS pixel. Past the floor a pixel is finer than
 * anything a drawing holds; past the ceiling the spans head for overflow, where a view stops being
 * a view. A view may arrive outside the band (a file, a command): zooming never pushes it further
 * out, and never snaps it back in either.
 */
export const MIN_UNITS_PER_PX = 1e-7;
export const MAX_UNITS_PER_PX = 1e7;

/**
 * The floor far from the origin: a pixel must stay many times wider than the gap between adjacent
 * doubles at the anchor's coordinates, or the drawing shakes as it zooms and pans.
 */
export const ZOOM_PRECISION = 1e-12;

/**
 * The factor `zoomAt` really applies: `factor` held so the view's scale stays inside the band.
 * A factor that is not a positive finite number does nothing (1). Zooming in is held by the floor
 * and zooming out by the ceiling; neither ever reverses the direction asked for. `anchor` is the
 * world point the zoom holds still.
 */
export function clampZoomFactor(view: Rect, screen: ScreenSize, anchor: Point, factor: number): number {
  if (!Number.isFinite(factor) || !(factor > 0)) return 1;
  const v = normalizeRect(view);
  const w = screen.w > 0 ? screen.w : 1;
  const h = screen.h > 0 ? screen.h : 1;
  const perX = (v.x1 - v.x0) / w;
  const perY = (v.y1 - v.y0) / h;
  if (factor < 1) {
    const floor = Math.max(MIN_UNITS_PER_PX, Math.max(Math.abs(anchor.x), Math.abs(anchor.y)) * ZOOM_PRECISION);
    const held = Math.min(1, floor / Math.min(perX, perY));
    return Number.isFinite(held) && held > 0 ? Math.max(factor, held) : 1;
  }
  const held = Math.max(1, MAX_UNITS_PER_PX / Math.max(perX, perY));
  return Number.isFinite(held) ? Math.min(factor, held) : 1;
}

/**
 * Zoom by `factor` (>1 zooms out) keeping the world point under `anchor` (screen px) fixed. The
 * scale stays inside [`MIN_UNITS_PER_PX`, `MAX_UNITS_PER_PX`]: at either end the factor is held,
 * not the rectangle, so the anchor stays under the pointer there too. An anchor that is not finite
 * (an unmeasured canvas) is read as the centre.
 */
export function zoomAt(view: Rect, screen: ScreenSize, anchor: Point, factor: number): Rect {
  const v = normalizeRect(view);
  const centre = { x: (screen.w > 0 ? screen.w : 1) / 2, y: (screen.h > 0 ? screen.h : 1) / 2 };
  const a = screenToWorld(v, screen, Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : centre);
  const f = clampZoomFactor(v, screen, a, factor);
  if (f === 1) return v;
  return normalizeRect({
    x0: a.x + (v.x0 - a.x) * f,
    y0: a.y + (v.y0 - a.y) * f,
    x1: a.x + (v.x1 - a.x) * f,
    y1: a.y + (v.y1 - a.y) * f,
  });
}

/** What one line and one page of wheel travel count as, in pixels (`WheelEvent.deltaMode` 1 and 2). */
export const WHEEL_LINE_PX = 40;
export const WHEEL_PAGE_PX = 800;

/** The most one wheel event may zoom, in pixels of travel: a free-spinning wheel stays steerable. */
export const WHEEL_MAX_PX = 300;

/** Wheel travel that zooms by e: one 100px notch is a step of about 1.28. */
export const WHEEL_ZOOM_PX = 400;

/**
 * A pinch arrives as a wheel event with `ctrlKey` and a small delta per frame, so it takes a
 * steeper rate to follow the fingers, and a lower cap so that Ctrl with a notched wheel (the same
 * event) steps gently instead of leaping.
 */
export const PINCH_ZOOM_PX = 100;
export const PINCH_MAX_PX = 24;

/**
 * The zoom factor for one wheel event (>1 zooms out, as `zoomAt` reads it). The delta is brought
 * to pixels whatever unit the device reports (`deltaMode`: 0 pixels, 1 lines, 2 pages), capped per
 * event, and turned into a factor exponentially, so equal travel is an equal step at any zoom and
 * a step out undoes a step in. A delta that is not a number, or zero, is no zoom (1).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const unit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const cap = pinch ? PINCH_MAX_PX : WHEEL_MAX_PX;
  const px = Math.max(-cap, Math.min(cap, deltaY * unit));
  return Math.exp(px / (pinch ? PINCH_ZOOM_PX : WHEEL_ZOOM_PX));
}

/** Where the canvas sits in the window (CSS px): its size and its top-left corner. */
export interface ScreenBox extends ScreenSize {
  left: number;
  top: number;
}

/**
 * The view after the canvas's box changed from `from` to `to`: the same world size per pixel, and
 * every world point that is still visible stays where it was in the window. A panel that opens
 * covers part of the drawing and one that closes uncovers it; nothing slides and nothing rescales.
 * When only the right or bottom edge moves (the assistant, the command line, the window's own
 * corner) that is the top-left corner held; when the left or top edge moves (the sidebar, the tool
 * strip) the view shifts by exactly that much. An unusable box or result returns the view as it is.
 */
export function resizeView(rect: Rect, from: ScreenBox, to: ScreenBox): Rect {
  const sizes = [from.w, from.h, to.w, to.h];
  const corners = [from.left, from.top, to.left, to.top];
  if (!sizes.every((n) => Number.isFinite(n) && n > 0) || !corners.every((n) => Number.isFinite(n))) return rect;
  if (rectIsDegenerate(rect)) return rect;
  const perX = (rect.x1 - rect.x0) / from.w;
  const perY = (rect.y1 - rect.y0) / from.h;
  const x0 = rect.x0 + (to.left - from.left) * perX;
  const y1 = rect.y1 - (to.top - from.top) * perY;
  const next = { x0, y0: y1 - to.h * perY, x1: x0 + to.w * perX, y1 };
  return rectIsDegenerate(next) ? rect : next;
}

/**
 * How much of a fitted view's own height may slip under a bottom edge that moved up when the
 * drawing's extents are not known: the breathing room a fit leaves around the drawing, so what
 * slips out of sight is margin and never geometry.
 */
export const FIT_SLACK = 0.04;

/** The most the canvas may grow taller, as a fraction of the height the view was fitted at, and
 *  still leave a fitted view where it is: past it the drawing would sit visibly high. */
export const FIT_HOLD = 0.25;

/**
 * Whether a view fitted to the box `fit` stays where it is when the canvas becomes `to`, instead
 * of being fitted again. It does when only the bottom edge moved (the command line grew or shrank
 * by a row: same left, top and width) and nothing of the drawing goes out of sight for it: the
 * bottom of `content` (the drawing's extents) still shows, or, where the extents are unknown or
 * already reach below the fitted view, the fitted rectangle does but for [`FIT_SLACK`] of its
 * height. Then the top-left corner and the scale are kept (`resizeView` from the fit), so the
 * point about to be picked does not move under the pointer when a command starts and its prompt
 * takes a row. Any other change fits the view again: a width change, the top edge, a bottom edge
 * that would cover geometry, a canvas grown taller by more than [`FIT_HOLD`].
 */
export function holdsFit(fitted: Rect, fit: ScreenBox, to: ScreenBox, content: Rect | null = null): boolean {
  const numbers = [fit.w, fit.h, to.w, to.h, fit.left, fit.top, to.left, to.top];
  if (!numbers.every((n) => Number.isFinite(n)) || !(fit.w > 0) || !(fit.h > 0) || !(to.w > 0) || !(to.h > 0)) return false;
  if (rectIsDegenerate(fitted)) return false;
  const moved = (a: number, b: number): boolean => Math.abs(a - b) > 0.5;
  if (moved(to.left, fit.left) || moved(to.top, fit.top) || moved(to.w, fit.w)) return false;
  if (to.h - fit.h > FIT_HOLD * fit.h) return false;
  const shown = fitAspect(fitted, fit);
  const bottom = shown.y1 - (to.h * (shown.y1 - shown.y0)) / fit.h;
  const margin = fitted.y0 + FIT_SLACK * (fitted.y1 - fitted.y0);
  const floor = content !== null && Number.isFinite(content.y0) ? Math.max(content.y0, margin) : margin;
  return bottom <= floor;
}

/** The centre of two screen points and the distance between them (a two-finger gesture's state). */
export function pinchOf(a: Point, b: Point): { centre: Point; spread: number } {
  return { centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, spread: Math.hypot(b.x - a.x, b.y - a.y) };
}

/** The spread (px) below which two touches are one point and their ratio is not a zoom. */
export const MIN_PINCH_SPREAD = 8;

/**
 * The view after a two-finger gesture moved from `from` to `to`: panned by the centre's travel and
 * zoomed by the spread's ratio about the new centre, so the two world points under the fingers
 * stay under them. Fingers too close together to give a ratio only pan.
 */
export function pinchView(view: Rect, screen: ScreenSize, from: { centre: Point; spread: number }, to: { centre: Point; spread: number }): Rect {
  const panned = panBy(view, screen, to.centre.x - from.centre.x, to.centre.y - from.centre.y);
  if (!(from.spread >= MIN_PINCH_SPREAD) || !(to.spread >= MIN_PINCH_SPREAD)) return panned;
  return zoomAt(panned, screen, to.centre, from.spread / to.spread);
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

/**
 * Adjust a view rectangle to a screen's aspect, around its centre: the world stays centred and
 * nothing is cropped when the canvas changes shape (the assistant panel opening, a window
 * resize). The dimension that has to grow is the one the screen has proportionally more of.
 * A degenerate rectangle or screen is returned unchanged.
 */
export function fitAspect(rect: Rect, screen: ScreenSize): Rect {
  const v = normalizeRect(rect);
  const w = screen.w > 0 ? screen.w : 0;
  const h = screen.h > 0 ? screen.h : 0;
  if (w <= 0 || h <= 0) return v;
  const wantAspect = w / h;
  const haveAspect = (v.x1 - v.x0) / Math.max(v.y1 - v.y0, 1e-12);
  if (!Number.isFinite(wantAspect) || !Number.isFinite(haveAspect) || haveAspect <= 0) return v;
  const cx = (v.x0 + v.x1) / 2;
  const cy = (v.y0 + v.y1) / 2;
  let halfW = (v.x1 - v.x0) / 2;
  let halfH = (v.y1 - v.y0) / 2;
  if (haveAspect < wantAspect) halfW = halfH * wantAspect;
  else halfH = halfW / wantAspect;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
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
