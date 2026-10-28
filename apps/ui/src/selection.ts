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
