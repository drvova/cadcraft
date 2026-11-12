/**
 * What a Slab surface with several controls is given by its host beyond `./surface`, because the
 * web driver at the pinned commit paints one element and tells the page nothing of what is under
 * the pointer or holding the keyboard inside it:
 *
 * - **Hints.** The interface's one tooltip (`../ui/Tooltip`) answers a `pointerover` or a
 *   `focusin` on an element carrying `data-hint`. A surface's parts are not elements of the page,
 *   so the host keeps one invisible element (the anchor) over the part under the pointer, or the
 *   part the keyboard moved to, carrying that part's hint, and tells the tooltip of it with the
 *   same two events. The surface's own `pointerover` is kept from the tooltip, which would read
 *   it as "on nothing".
 * - **The part under the pointer and the part with the focus**, for what a document cannot
 *   condition on (a row's keys showing while the pointer is anywhere on the row).
 * - **A place on the page for a part**: the anchor again, for a menu that opens beside a row.
 *
 * The parts are found in the kernel's solved scene (`sceneSnapshot`), read with checked narrowing.
 */

import { HINT_ATTR, installHints } from "../ui/Tooltip";
import type { SlabHost } from "./types";

/** One node of the solved scene, as this file reads it. */
export interface SceneBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The index of the node's parent in the scene; -1 at the root. */
  parent: number;
}

/** The most scene nodes read (a panel of 500 rows is under twenty thousand). */
export const MAX_SCENE_NODES = 50_000;

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** The scene as boxes, index for index; a scene holding anything that is not a node is no scene. */
export function sceneBoxes(scene: readonly unknown[]): SceneBox[] {
  const out: SceneBox[] = [];
  for (const node of scene.slice(0, MAX_SCENE_NODES)) {
    if (typeof node !== "object" || node === null) return [];
    const get = (name: string): unknown => (name in node ? Reflect.get(node, name) : undefined);
    const key = get("key");
    const parent = get("parent");
    out.push({ key: typeof key === "string" ? key : "", x: finite(get("x")), y: finite(get("y")), w: finite(get("w")), h: finite(get("h")), parent: typeof parent === "number" && Number.isInteger(parent) ? parent : -1 });
  }
  return out;
}

const inside = (box: SceneBox, x: number, y: number): boolean => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

/**
 * The nodes under a point, the topmost first and then its ancestors. A node counts only when the
 * point is inside every ancestor too (a row scrolled out of its list is not under the pointer).
 * The scene is in paint order, so the last node that holds the point is the one on top.
 */
export function pathAt(scene: readonly SceneBox[], x: number, y: number): SceneBox[] {
  for (let i = scene.length - 1; i >= 0; i -= 1) {
    const path: SceneBox[] = [];
    let at = i;
    for (;;) {
      const box = scene[at];
      if (box === undefined || !inside(box, x, y)) {
        path.length = 0;
        break;
      }
      path.push(box);
      // A parent comes before its child in the scene, so the walk ends at the root.
      if (box.parent < 0 || box.parent >= at) break;
      at = box.parent;
    }
    if (path.length > 0) return path;
  }
  return [];
}

/** The scene key of the node the kernel's focus is on; null when it is on none. */
export function focusedKey(host: SlabHost): string | null {
  const read: unknown = "focusedKey" in host ? Reflect.get(host, "focusedKey") : undefined;
  if (typeof read !== "function") return null;
  const key: unknown = Reflect.apply(read, host, []);
  return typeof key === "string" ? key : null;
}

export interface SurfaceParts {
  /** The hint of the part with this scene key; null when it has none. */
  hint: (key: string) => string | null;
  /** The pointer moved onto another part: the nodes under it, topmost first; none when it left. */
  over?: (path: readonly SceneBox[]) => void;
  /** The keyboard's place in the surface changed: the focused node's key, or null when the focus is elsewhere. */
  focus?: (key: string | null) => void;
}

export interface SurfaceTracking {
  /** The current scene. */
  scene: () => SceneBox[];
  /** The nodes under a point of the window. */
  pathAtClient: (clientX: number, clientY: number) => SceneBox[];
  /** An invisible element of the page standing exactly over a node, for what is placed beside it. */
  anchor: (box: SceneBox) => HTMLElement;
  detach: () => void;
}

/**
 * Follow the pointer and the focus over a surface. `frame` is an element around the surface
 * (positioned, holding nothing else that takes room) the anchors are put in.
 */
export function trackSurface(host: SlabHost, frame: HTMLElement, parts: SurfaceParts): SurfaceTracking {
  const doc = host.ownerDocument;
  installHints(doc);
  let hintAnchor: HTMLElement | null = null;
  let placeAnchor: HTMLElement | null = null;
  /** The key the pointer was last on; undefined before the first move, null on no part. */
  let overKey: string | null | undefined;
  /** The part the tooltip was last told of; undefined before it was told anything. */
  let hintedKey: string | null | undefined;
  let focusKey: string | null = null;

  const scene = (): SceneBox[] => sceneBoxes(host.sceneSnapshot());
  const pathAtClient = (clientX: number, clientY: number): SceneBox[] => {
    const rect = host.getBoundingClientRect();
    return pathAt(scene(), clientX - rect.left, clientY - rect.top);
  };

  const place = (el: HTMLElement, box: SceneBox): void => {
    el.style.left = `${host.offsetLeft + box.x}px`;
    el.style.top = `${host.offsetTop + box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  };
  const make = (box: SceneBox): HTMLElement => {
    const el = doc.createElement("span");
    el.className = "slab-anchor";
    el.setAttribute("aria-hidden", "true");
    place(el, box);
    frame.appendChild(el);
    return el;
  };

  /** The topmost node of a path that has a hint, with the hint. */
  const hinted = (path: readonly SceneBox[]): { box: SceneBox; text: string } | null => {
    for (const box of path) {
      const text = parts.hint(box.key);
      if (text !== null && text !== "") return { box, text };
    }
    return null;
  };

  /** Put the hint's anchor over a part and tell the tooltip, with the event a real control would have raised. */
  const point = (target: { box: SceneBox; text: string } | null, event: Event): void => {
    hintAnchor?.remove();
    hintAnchor = null;
    if (target === null) {
      frame.dispatchEvent(event);
      return;
    }
    hintAnchor = make(target.box);
    hintAnchor.setAttribute(HINT_ATTR, target.text);
    hintAnchor.dispatchEvent(event);
  };

  const onMove = (e: PointerEvent): void => {
    const path = pathAtClient(e.clientX, e.clientY);
    const top = path[0]?.key ?? null;
    if (top !== overKey) {
      overKey = top;
      parts.over?.(path);
    }
    const target = hinted(path);
    const key = target?.box.key ?? null;
    if (key === hintedKey) {
      // The same part: its words may have changed with its state (a key that was pressed).
      if (target !== null && hintAnchor !== null) {
        hintAnchor.setAttribute(HINT_ATTR, target.text);
        place(hintAnchor, target.box);
      }
      return;
    }
    hintedKey = key;
    point(target, new PointerEvent("pointerover", { bubbles: true, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY }));
  };
  const onLeave = (): void => {
    overKey = undefined;
    hintedKey = undefined;
    hintAnchor?.remove();
    hintAnchor = null;
    parts.over?.([]);
  };
  /** The surface's own `pointerover` says "the surface", never the part: the tooltip is told by `onMove`. */
  const onOver = (e: PointerEvent): void => {
    if (e.isTrusted && e.target === host) e.stopPropagation();
  };

  const syncFocus = (): void => {
    const key = doc.activeElement === host ? focusedKey(host) : null;
    if (key === focusKey) return;
    focusKey = key;
    parts.focus?.(key);
    if (key === null) return;
    const box = scene().find((node) => node.key === key);
    const text = parts.hint(key);
    if (box === undefined || text === null || text === "") return;
    hintedKey = undefined;
    // The tooltip shows it only when a key moved the focus here, as for any control.
    point({ box, text }, new FocusEvent("focusin", { bubbles: true }));
  };
  let pending = 0;
  const later = (): void => {
    if (pending !== 0) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      syncFocus();
    });
  };

  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("pointerover", onOver);
  host.addEventListener("slab-frame", syncFocus);
  host.addEventListener("focusin", later);
  host.addEventListener("focusout", later);

  return {
    scene,
    pathAtClient,
    anchor: (box) => {
      placeAnchor?.remove();
      placeAnchor = make(box);
      return placeAnchor;
    },
    detach: () => {
      if (pending !== 0) cancelAnimationFrame(pending);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerover", onOver);
      host.removeEventListener("slab-frame", syncFocus);
      host.removeEventListener("focusin", later);
      host.removeEventListener("focusout", later);
      hintAnchor?.remove();
      placeAnchor?.remove();
    },
  };
}
