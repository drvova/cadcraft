/**
 * The pure rules of a composite widget's keyboard walk (a menu bar, a menu, a tool bar, a tab
 * strip): which item an arrow, Home or End moves to, and which item a typed letter jumps to. The
 * widget is one Tab stop; these keys move inside it. No DOM here: the components own the focus.
 */

/** The axis the items run along: a bar is horizontal (Left/Right), a menu vertical (Up/Down). */
export type RovingAxis = "horizontal" | "vertical";

/**
 * The index a key moves to from `current` among `count` items, or `null` when the key is not one
 * of the walk's (the arrows of the axis, Home, End) or there is nothing to walk. The arrows wrap.
 * A `current` outside the items (nothing focused yet) enters at the first item going forward and
 * at the last going back.
 */
export function rovingIndex(key: string, current: number, count: number, axis: RovingAxis): number | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  const inside = Number.isInteger(current) && current >= 0 && current < count;
  const forward = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
  const back = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === forward) return inside ? (current + 1) % count : 0;
  if (key === back) return inside ? (current - 1 + count) % count : count - 1;
  return null;
}

/** The parts of a key press the typeahead rule reads. */
export interface TypedKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Whether a key press types one visible character (not Space, not a shortcut's chord). */
export function isTypeaheadKey(event: TypedKey): boolean {
  return [...event.key].length === 1 && event.key.trim() !== "" && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * The index of the next label after `current` that starts with `char`, case-insensitively and
 * wrapping past the end, so pressing a letter again steps through the labels that share it.
 * `null` when no label starts with it. `current` itself is the last one tried.
 */
export function typeaheadIndex(labels: readonly string[], current: number, char: string): number | null {
  const wanted = char.trim().toLocaleLowerCase();
  if (wanted === "" || labels.length === 0) return null;
  const from = Number.isInteger(current) && current >= 0 && current < labels.length ? current : -1;
  for (let step = 1; step <= labels.length; step++) {
    const index = (from + step) % labels.length;
    if ((labels[index] ?? "").trim().toLocaleLowerCase().startsWith(wanted)) return index;
  }
  return null;
}
