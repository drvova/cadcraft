/**
 * The canvas selection's pure logic: the pick aperture `run_select` uses, the rule by which a
 * pick adds to or removes from the selection, and selection equality. No DOM, no facade calls:
 * the shell wires these to `execute("select", …)` and to the canvas's `selection` prop.
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

/** How a pick changes the selection: the gesture, Shift, and the engine's `PICKADD`. */
export interface PickRule {
  /** A click picks one object (or none); a rectangle picks however many it holds. */
  gesture: "click" | "rect";
  shift: boolean;
  /** The engine's `PICKADD` setting (on by default). */
  pickadd: boolean;
}

/**
 * The selection after a pick at rest, by the engine's own rules (`Session::idle_click`). With
 * `PICKADD` on, a pick adds to the selection and Shift removes from it, so the selection grows
 * until Escape. With it off, a pick replaces the selection and Shift adds (Shift on what is
 * already selected removes it). A click on nothing changes nothing in either setting. The order
 * of the handles is kept and none is listed twice.
 */
export function applyPick(current: readonly string[], picked: readonly string[], rule: PickRule): string[] {
  const without = (): string[] => current.filter((h) => !picked.includes(h));
  const union = (): string[] => [...new Set([...current, ...picked])];
  if (rule.pickadd) return rule.shift ? without() : union();
  if (rule.gesture === "click" && picked.length === 0) return [...current];
  if (!rule.shift) return [...new Set(picked)];
  const allSelected = picked.length > 0 && picked.every((h) => current.includes(h));
  return rule.gesture === "click" && allSelected ? without() : union();
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

/** What a press reads of the grip under it (the facade's `Grip` has all of it). */
export interface PressedGrip {
  id: string;
  kind: "standard" | "linear" | "point" | "list";
  /** Its object is on a locked layer: the engine refuses an edit of it. */
  locked: boolean;
}

/** What a left press at rest does when grips are shown. */
export type GripPress =
  /** No grip is under the press: it picks, or starts a selection rectangle, as it always has. */
  | { kind: "none" }
  /** Shift on a grip: the grips collected for the next edit are now these; nothing starts. */
  | { kind: "collect"; collected: ReadonlySet<string> }
  /** The press starts the edit of these grips; the first is the one pressed, the base grip. */
  | { kind: "start"; ids: readonly string[] }
  /** A list grip has nothing to drag: the press opens its choices. */
  | { kind: "menu"; id: string };

/**
 * What a left press at rest does, from the grip under it (`grip`, or null), Shift, and the grips
 * Shift+click has collected so far. A plain press on a grip starts its edit: with every collected
 * grip when it is one of them (the pressed one first, as the base), alone when it is not (the
 * collection is for the grips it names, and a press elsewhere lets it go). Shift on a grip adds
 * it to the collection, or takes it out again, and starts nothing. A grip on a locked layer is
 * never collected (its edit would be refused), and a plain press on one still asks the engine, so
 * the refusal is the engine's own words. A list grip opens its menu. Neither input is changed.
 */
export function gripPress(grip: PressedGrip | null, shift: boolean, collected: ReadonlySet<string>): GripPress {
  if (grip === null) return { kind: "none" };
  if (grip.kind === "list") return { kind: "menu", id: grip.id };
  if (shift) {
    const next = new Set(collected);
    if (next.has(grip.id)) next.delete(grip.id);
    else if (!grip.locked) next.add(grip.id);
    return { kind: "collect", collected: next };
  }
  return { kind: "start", ids: collected.has(grip.id) ? [grip.id, ...[...collected].filter((id) => id !== grip.id)] : [grip.id] };
}

/** The collected grips that are still grips of the selection: an edit or a new selection drops the rest. */
export function keptGrips(collected: ReadonlySet<string>, shown: readonly { id: string }[]): ReadonlySet<string> {
  if (collected.size === 0) return collected;
  const ids = new Set(shown.map((grip) => grip.id));
  const kept = [...collected].filter((id) => ids.has(id));
  return kept.length === collected.size ? collected : new Set(kept);
}

/**
 * How the press that started a grip edit goes on, from its travel (CSS px, now minus the press):
 * past the click slop it is a drag, and its release commits the edit there; inside it the press
 * was a click, the edit follows the pointer with no button held, and the next click commits it.
 * The same slop that tells a pick from a selection rectangle decides it, so a hand that clicks
 * objects clicks grips the same way.
 */
export function gripGesture(dx: number, dy: number, pointerType: string): "click" | "drag" {
  return dragKind(dx, dy, clickSlop(pointerType)) === "click" ? "click" : "drag";
}
