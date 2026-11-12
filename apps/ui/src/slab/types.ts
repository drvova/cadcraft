/**
 * The part of Slab's web driver this interface calls, written out here so that nothing is typed
 * against the vendored artifacts: the type check is the same whether `src/slab-vendor/` exists or
 * not, and this list is the whole surface an upstream change can break.
 */

import type { FontRegistry } from "./fonts";

/** One node of the kernel's solved scene (the fields read here). */
export interface SlabSceneNode {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A mounted Slab surface: the custom element a compiled document defines. */
export interface SlabHost extends HTMLElement {
  setParam(name: string, value: unknown): boolean;
  setList(name: string, path: string, value: unknown): boolean;
  setTheme(name: string): boolean;
  setSplit(paneKey: string, size: number): boolean;
  getSplit(paneKey: string): number;
  getToken(path: string): string | number | undefined;
  sceneSnapshot(): readonly SlabSceneNode[];
  clearFocus(): boolean;
}

const HOST_METHODS = ["setParam", "setList", "setTheme", "setSplit", "getSplit", "getToken", "sceneSnapshot", "clearFocus"] as const;

/** Whether an element is a mounted document of the vendored driver (its element is defined). */
export function isSlabHost(element: Element): element is SlabHost {
  return HOST_METHODS.every((name) => name in element && typeof Reflect.get(element, name) === "function");
}

/** The runtime module (`slab-vendor/slab-runtime.js`): the element class every surface extends. */
export interface SlabRuntime {
  SlabElement: FontRegistry;
}

/** What a signal's event carries. */
export interface SlabSignalDetail {
  /** The key of the list item the signal came from; "" outside a list. */
  item: string;
  /** The text of a text-bearing signal (a divider's final extent). */
  text?: string;
  meta: { key: string };
}

/** The detail of a signal event, read with checked narrowing; null when it is not one. */
export function signalDetail(event: Event): SlabSignalDetail | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const item: unknown = "item" in detail ? detail.item : "";
  const text: unknown = "text" in detail ? detail.text : undefined;
  const meta: unknown = "meta" in detail ? detail.meta : null;
  const key: unknown = typeof meta === "object" && meta !== null && "key" in meta ? meta.key : "";
  return { item: typeof item === "string" ? item : "", ...(typeof text === "string" ? { text } : {}), meta: { key: typeof key === "string" ? key : "" } };
}
