/**
 * Reading a surface's solved scene and its keys, for a host that has to know where a control is
 * (to stand a hint or a menu beside it) or which one a key names. Like `./types`, nothing here is
 * typed against the vendored driver: the methods are listed, and an element is checked for them.
 */

import { isSlabHost, type SlabHost, type SlabSceneNode } from "./types";

/** A surface with the focus and scroll calls of the driver, beyond what `./types` lists. */
export interface SlabControlHost extends SlabHost {
  /** The full key of the node the kernel's focus is on. */
  focusedKey(): string | null;
  /** Move the kernel's focus; `visible` shows the keyboard's ring. Takes no focus from the page. */
  setFocus(key: string, visible?: boolean): boolean;
  /** A scroll container's offset along its main (0) or cross (1) axis. */
  getScroll(key: string, axis: number): number;
  setScroll(key: string, axis: number, offset: number): boolean;
  /** Scroll every scroll ancestor the least that brings the node into view, `margin` clear of the edge. */
  reveal(key: string, margin: number): boolean;
}

const CONTROL_METHODS = ["focusedKey", "setFocus", "getScroll", "setScroll", "reveal"] as const;

export function isSlabControlHost(element: Element): element is SlabControlHost {
  return isSlabHost(element) && CONTROL_METHODS.every((name) => name in element && typeof Reflect.get(element, name) === "function");
}

/** The longest key read (a key is a path of a few short segments). */
const MAX_KEY = 512;

/**
 * The list item a key is inside: the item's own key, from `…~<item>/…` (SPEC §15.1; the innermost
 * list when lists nest). "" when the key is of no list item.
 */
export function itemOfKey(key: string): string {
  if (key.length > MAX_KEY) return "";
  const at = key.lastIndexOf("~");
  if (at < 0) return "";
  const rest = key.slice(at + 1);
  const end = rest.indexOf("/");
  return end < 0 ? rest : rest.slice(0, end);
}

/** The innermost authored id a key is at or inside (`#bar/#line/#layer/text@0` → "layer"); "" when it has none. */
export function idOfKey(key: string): string {
  if (key.length > MAX_KEY) return "";
  const segments = key.split("/");
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i] ?? "";
    if (segment.startsWith("#")) return segment.slice(1);
  }
  return "";
}

/** The solved node with this key. */
export function sceneNode(host: SlabHost, key: string): SlabSceneNode | undefined {
  return host.sceneSnapshot().find((node) => node.key === key);
}

/** The first solved node (the outermost, in the scene's order) whose key `accept` takes. */
export function findNode(host: SlabHost, accept: (key: string) => boolean): SlabSceneNode | undefined {
  return host.sceneSnapshot().find((node) => accept(node.key));
}

/** The outermost solved node under a point of the surface (in its own px) whose key `accept` takes. */
export function nodeAt(host: SlabHost, x: number, y: number, accept: (key: string) => boolean): SlabSceneNode | undefined {
  return host.sceneSnapshot().find((node) => x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h && accept(node.key));
}

/** The keys of the solved nodes with this role, in the scene's order (the order the arrows walk them in). */
export function keysWithRole(host: SlabHost, role: string): string[] {
  return host
    .sceneSnapshot()
    .filter((node) => Reflect.get(node, "role") === role)
    .map((node) => node.key);
}

/**
 * Home and End in a band of controls: the key of the first or the last control with `role`, for
 * a keydown that asks for it with no modifier. Null for any other key, and in an empty band. (The
 * kernel walks its focus ring with the arrows and wraps; it has no key for the ends.)
 */
export function bandEnd(host: SlabHost, role: string, event: KeyboardEvent): string | null {
  if ((event.key !== "Home" && event.key !== "End") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const keys = keysWithRole(host, role);
  return (event.key === "Home" ? keys[0] : keys[keys.length - 1]) ?? null;
}

/** Where a signal's pointer was, in the surface's own px; null for a signal a key made, or a detail that carries none. */
export function signalPoint(event: Event): { x: number; y: number } | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  const meta: unknown = typeof detail === "object" && detail !== null && "meta" in detail ? detail.meta : null;
  if (typeof meta !== "object" || meta === null || !("x" in meta) || !("y" in meta)) return null;
  const { x, y } = meta;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 ? { x, y } : null;
}

/**
 * Keep the keyboard's ring to the keyboard. The kernel at the pinned commit draws its focus ring
 * on a control the pointer pressed, and keeps drawing it after the page's focus has left the
 * surface. After a press, and when the focus leaves, the kernel's focus is set again on the same
 * control with the ring off: the control stays where the arrows start from, as a roving tab stop
 * does. A key that moves the focus shows the ring again. Returns the undoing.
 */
export function ringForKeysOnly(host: SlabControlHost): () => void {
  const quiet = (): void => {
    const key = host.focusedKey();
    if (key !== null) host.setFocus(key, false);
  };
  const onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    if (to instanceof Node && (to === host || host.contains(to))) return;
    quiet();
  };
  host.addEventListener("pointerup", quiet);
  host.addEventListener("focusout", onFocusOut);
  return () => {
    host.removeEventListener("pointerup", quiet);
    host.removeEventListener("focusout", onFocusOut);
  };
}
