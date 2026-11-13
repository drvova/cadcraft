/**
 * What a Slab surface with text fields needs of the driver and of the page, beyond `./types` and
 * `./surface` (which were written for surfaces of buttons):
 *
 * - **The driver's field calls.** The kernel owns a field's text once it has been focused, so a
 *   value the engine changed has to be written into the buffer (`setFieldText`), and focus is
 *   read and moved by node key (`focusedKey`, `setFocus`).
 * - **The shell's keys.** A key typed in a Slab field reaches the window with the surface's
 *   element as its target, not an `<input>`: the shell would take a letter for the command line
 *   and Ctrl+Z for the drawing's undo. The keys a field owns are kept from the shell
 *   (`fieldKeepsKey`), as an `<input>` keeps them by being one.
 */

import type { SlabHost } from "./types";

/** A mounted surface whose document has fields: the driver calls the host makes for them. */
export interface SlabFieldHost extends SlabHost {
  /** Replace a field's buffer (by full node key) and put the caret at its end. */
  setFieldText(key: string, text: string): boolean;
  /** A field's buffer; undefined when the key is not a field the kernel is editing. */
  fieldText(key: string): string | undefined;
  /** Put a field's caret at a codepoint offset, selecting from `anchor` when it is given. */
  setCaret(key: string, caret: number, anchor?: number): boolean;
  /** The full key of the node that has the kernel's focus; null when none has. */
  focusedKey(): string | null;
  /** Move the kernel's focus to a node by full key. */
  setFocus(key: string, visible?: boolean): boolean;
  /** Resolves when the next solve has painted and the scene describes it. */
  whenSettled(): Promise<void>;
}

const FIELD_METHODS = ["setFieldText", "fieldText", "setCaret", "focusedKey", "setFocus", "whenSettled"] as const;

/** Whether a surface has the driver's field calls. */
export function isSlabFieldHost(host: SlabHost): host is SlabFieldHost {
  return FIELD_METHODS.every((name) => name in host && typeof Reflect.get(host, name) === "function");
}

/** The letters a field's own chords use: undo, redo, select all, the clipboard, and the kernel's word and line kills. */
const FIELD_CHORD_KEYS: ReadonlySet<string> = new Set(["z", "y", "a", "c", "x", "v", "w", "k", "u"]);

/** What of a key event the rule reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Whether a key pressed while a Slab field has the focus is the field's own, and so is kept from
 * the shell's window handler. The function keys, Tab and the shell's chords (Ctrl+S, Ctrl+B,
 * Ctrl+Shift+P…) are not; Escape is decided by the row (it is the shell's when there is no edit
 * to cancel).
 */
export function fieldKeepsKey(e: KeyLike): boolean {
  if (/^F\d{1,2}$/.test(e.key) || e.key === "Tab" || e.key === "Escape") return false;
  if (e.ctrlKey || e.metaKey) return e.key.length > 1 ? !/^(Control|Meta|Shift|Alt)$/.test(e.key) : FIELD_CHORD_KEYS.has(e.key.toLowerCase());
  return true;
}
