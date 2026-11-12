/**
 * The canvas selection's pure logic: the pick aperture `run_select` uses, the click add/replace
 * rule, and selection equality. No DOM, no facade calls — the shell wires these to
 * `execute("select", …)` and to the canvas's `selection` prop.
 */

/** The engine's SYSVAR default (`Session::default`: `pickbox: 3.0`), used when the caller's is degenerate. */
export const DEFAULT_PICKBOX = 3;

/** `run_select`'s aperture factor: `s.pixel_size() * s.settings.pickbox * 1.5`. */
export const APERTURE_SCALE = 1.5;

/** The world-space aperture floor and ceiling, so a degenerate view never asks for 0 or infinity. */
export const MIN_APERTURE = 1e-6;
export const MAX_APERTURE = 1e12;

/** What a degenerate view falls back to: a hairline aperture, never NaN. */
export const DEFAULT_APERTURE = MIN_APERTURE;

/** The active drawing's selection (`Facade::selection`); handles are the engine's hex strings. */
export interface SelectionState {
  handles: readonly string[];
  count: number;
}

/**
 * The world-space pick aperture for a click: `worldPerPixel * pickbox * 1.5`, the same rule
 * `run_select` applies (`crates/engine/src/cmd/edit.rs`). A non-finite, zero or negative
 * `worldPerPixel` — an unmeasured canvas or a collapsed view — yields a small positive default
 * instead of NaN; a degenerate `pickbox` falls back to the engine's own default of 3.
 */
export function pickAperture(worldPerPixel: number, pickbox: number): number {
  const box = Number.isFinite(pickbox) && pickbox > 0 ? pickbox : DEFAULT_PICKBOX;
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return DEFAULT_APERTURE;
  const aperture = worldPerPixel * box * APERTURE_SCALE;
  if (!Number.isFinite(aperture) || aperture <= 0) return DEFAULT_APERTURE;
  return Math.min(Math.max(aperture, MIN_APERTURE), MAX_APERTURE);
}

/**
 * The click semantics of the canvas pick, matching AutoCAD: without `add` the clicked handle
 * replaces the selection, and clicking the only selected handle again is a no-op (a second pick
 * never deselects); with `add` (Shift) the handle's membership is toggled.
 */
export function toggleHandle(current: readonly string[], handle: string, add: boolean): string[] {
  if (add) {
    if (current.includes(handle)) return current.filter((h) => h !== handle);
    return [...current, handle];
  }
  if (current.length === 1 && current[0] === handle) return [...current];
  return [handle];
}

/** How far (CSS px) a mouse may travel between press and release and still have clicked. */
export const CLICK_SLOP = 3;

/**
 * The click slop for a pointer: a pen tip skates a little on glass and a fingertip rolls as it
 * lifts, so each gets more room than a mouse before its press counts as a drag. CSS pixels are
 * already the same physical size at any device pixel ratio, so the ratio does not enter.
 */
export function clickSlop(pointerType: string): number {
  if (pointerType === "touch") return CLICK_SLOP * 4;
  if (pointerType === "pen") return CLICK_SLOP * 2;
  return CLICK_SLOP;
}

/**
 * How much wider than a mouse's the pick aperture is for a pointer: a fingertip covers the target
 * it aims at, so its pick reaches further. The canvas multiplies the world size of a pixel by this
 * before handing it to `pickAperture`, which keeps the engine's own rule (pickbox * 1.5) intact.
 */
export function pickReach(pointerType: string): number {
  if (pointerType === "touch") return 3;
  if (pointerType === "pen") return 1.5;
  return 1;
}

/** What a press-drag-release was: a click, or a selection rectangle of one of the two kinds. */
export type DragKind = "click" | "window" | "crossing";

/**
 * Classify a drag from its travel (CSS px, release minus press). Inside the slop it is a click.
 * Beyond it, dragging to the right is a window (objects wholly inside) and to the left a crossing
 * (objects inside or touched), as CAD programs read it; a purely vertical drag is a window. Travel
 * that is not a number is a click, never a rectangle.
 */
export function dragKind(dx: number, dy: number, slop: number): DragKind {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "click";
  if (Math.hypot(dx, dy) <= (Number.isFinite(slop) && slop >= 0 ? slop : CLICK_SLOP)) return "click";
  return dx < 0 ? "crossing" : "window";
}

/** True when both lists hold the same handles, regardless of order (order-sensitive sets). */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}
