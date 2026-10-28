/**
 * The display-list cache: the engine builds and culls a display list for a *window* (the view
 * expanded by [`VIEW_PAD`] on each side), and the canvas may pan and zoom anywhere inside that
 * window without asking the engine again. Only leaving the window — or the drawing changing
 * (a revision bump) — asks for a new list.
 *
 * Why: the engine's reply is JSON, so a fetch costs milliseconds once a drawing has a few
 * thousand entities. Panning used to fetch on every pointer move (the whole list rebuilt and
 * re-parsed per frame); with the cache a pan is a pure client-side redraw.
 *
 * The logic is pure and lives here so it is testable without a canvas or a facade.
 */

import type { Rect } from "./view";

/** The fraction of the view's span the engine is asked to include beyond the view, per side. */
export const VIEW_PAD = 0.5;

/** The world rectangle a fetched display list covers, and the drawing revision it was built at. */
export interface DisplayRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  revision: number;
}

/** The view expanded by `pad` of its span on each side (the window a fetch is made for). */
export function padView(rect: Rect, pad = VIEW_PAD): Rect {
  const p = Number.isFinite(pad) ? Math.max(0, Math.min(8, pad)) : 0;
  const dx = (rect.x1 - rect.x0) * p;
  const dy = (rect.y1 - rect.y0) * p;
  return { x0: rect.x0 - dx, y0: rect.y0 - dy, x1: rect.x1 + dx, y1: rect.y1 + dy };
}

/** The region a fetched list covers: its window plus the revision it was built at. */
export function regionOf(window: Rect, revision: number): DisplayRegion {
  return { x0: window.x0, y0: window.y0, x1: window.x1, y1: window.y1, revision };
}

/** Whether `region` still answers for `rect` at `revision` (so a fetch can be skipped). */
export function regionCovers(region: DisplayRegion | null, rect: Rect, revision: number): boolean {
  if (region === null || region.revision !== revision) return false;
  if (!Number.isFinite(rect.x0) || !Number.isFinite(rect.x1) || !Number.isFinite(rect.y0) || !Number.isFinite(rect.y1)) return false;
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return false;
  return rect.x0 >= region.x0 && rect.y0 >= region.y0 && rect.x1 <= region.x1 && rect.y1 <= region.y1;
}
