/**
 * The drawing's layers as the Slab Layers panel takes them (`slab/layers.slab`): typed scalar and
 * list params, nothing else. Every value is the engine's, already read with checked narrowing by
 * `../facade` (`parseLayers`); this file only shapes it, caps it (a Slab list is laid out whole)
 * and reads a signal back to the layer it is about. The behaviour stays where it was: the words
 * are `../components/LayersPanel`'s (`splitName`, `layerHint`) and the acting is the shell's
 * handlers.
 */

import { layerHint, splitName } from "../components/LayersPanel";
import type { LayerInfo } from "../facade";
import { paramText } from "./bench-params";

/** The most rows handed to the kernel; the rest are counted in one line under them. */
export const MAX_LAYER_ROWS = 500;

/** A layer's three flags, as `onToggle` names them. */
export type LayerFlag = "on" | "frozen" | "locked";

/** The document's signal for each flag's key. */
export const TOGGLE_SIGNALS: Readonly<Record<string, LayerFlag>> = { toggle_on: "on", toggle_frozen: "frozen", toggle_locked: "locked" };

/** The inks of the three keys in the state to notice (off, frozen, locked), as the page paints them. */
export interface LayerInks {
  off: string;
  frozen: string;
  locked: string;
}

/** No ink: what a key takes until the page's inks are read (`#RRGGBBAA`, clear). */
export const CLEAR = `#${"0".repeat(8)}`;

export const NO_INKS: LayerInks = { off: CLEAR, frozen: CLEAR, locked: CLEAR };

/** What the host knows that the document cannot ask for itself. */
export interface LayersView {
  /** The section is open (folded, it is its heading alone). */
  open: boolean;
  /** The rows under the pointer or holding the keyboard: their keys are all drawn. */
  shown: readonly number[];
  /** There is no pointer to hover with (a finger): every key of every row is drawn. */
  allKeys: boolean;
  /** Whether a name fits its track whole; one that does not is drawn as a head and a tail. */
  fits: (name: string) => boolean;
  inks: LayerInks;
  /** The list's tallest height before it scrolls, in px. */
  cap: number;
}

/** One item of the panel's `rows` list: a `LayerRow` of the document. */
export interface LayerRowParam {
  /** The item's identity in the kernel: its place in the list, as the SolidJS rows are kept. */
  key: string;
  name: string;
  head: string;
  tail: string;
  split: boolean;
  /** The name's hint, which is also what a screen reader is told beyond the name. */
  said: string;
  /** What the row is, beyond its parts: the current layer, and the layer's description. */
  about: string;
  tone: string;
  tone_name: string;
  current: boolean;
  used: boolean;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  on_name: string;
  frozen_name: string;
  locked_name: string;
  on_quiet: boolean;
  frozen_quiet: boolean;
  locked_quiet: boolean;
  off_ink: string;
  frozen_ink: string;
  locked_ink: string;
}

export interface LayersPanelParams {
  open: boolean;
  count: string;
  count_said: string;
  more: string;
  capped: boolean;
  cap: number;
  rows: LayerRowParam[];
}

const rowKey = (index: number): string => `layer-${index}`;

/** An sRGB triple as Slab writes a colour. A channel that is not a number in range is 0. */
export function slabRgb(c: readonly [number, number, number]): string {
  const hex = (n: number): string => (Number.isFinite(n) ? Math.round(Math.min(255, Math.max(0, n))) : 0).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
}

/** "1 layer", "3 layers": the count as the heading's hint says it. */
export function layerCount(n: number): string {
  return n === 1 ? "1 layer" : `${n} layers`;
}

/** A name as the row draws it: whole when it fits, else `splitName`'s head and tail. */
function nameParts(name: string, fits: boolean): { head: string; tail: string; split: boolean } {
  const whole = paramText(name);
  if (fits) return { head: whole, tail: "", split: false };
  const parts = splitName(whole);
  return parts.tail === "" ? { head: whole, tail: "", split: false } : { head: parts.head, tail: parts.tail, split: true };
}

/** The panel's params for the engine's layers and the host's view of the panel. */
export function layersPanelParams(layers: readonly LayerInfo[], view: LayersView): LayersPanelParams {
  const total = layers.length;
  const head = { count: String(total), count_said: layerCount(total), cap: Number.isFinite(view.cap) && view.cap > 0 ? Math.floor(view.cap) : 0 };
  // A folded section is its heading alone: nothing under it is laid out, focusable or read out.
  if (!view.open) return { ...head, open: false, more: "", capped: false, rows: [] };
  const rest = Math.max(0, total - MAX_LAYER_ROWS);
  return {
    ...head,
    open: true,
    more: rest === 0 ? "" : `${layerCount(rest).replace(/^(\d+)/, "$1 more")}: see the Layer Properties Manager`,
    capped: rest > 0,
    rows: layers.slice(0, MAX_LAYER_ROWS).map((layer, index): LayerRowParam => {
      const name = paramText(layer.name);
      const quiet = !view.allKeys && !view.shown.includes(index);
      return {
        key: rowKey(index),
        name,
        ...nameParts(layer.name, view.fits(layer.name)),
        said: paramText(layerHint(layer)),
        about: paramText([layer.current ? "Current layer" : "", layer.description].filter((part) => part !== "").join(". ")),
        tone: slabRgb(layer.colorRgb),
        tone_name: paramText(`Color: ${layer.colorName}`),
        current: layer.current,
        used: layer.used,
        on: layer.on,
        frozen: layer.frozen,
        locked: layer.locked,
        on_name: paramText(`${layer.name} on`),
        frozen_name: paramText(`${layer.name} frozen`),
        locked_name: paramText(`${layer.name} locked`),
        on_quiet: quiet && layer.on,
        frozen_quiet: quiet && !layer.frozen,
        locked_quiet: quiet && !layer.locked,
        off_ink: view.inks.off,
        frozen_ink: view.inks.frozen,
        locked_ink: view.inks.locked,
      };
    }),
  };
}

/** The place in the list a row's item key names; -1 for anything that is not one. */
export function rowIndex(itemKey: string): number {
  const m = /^layer-(\d{1,4})$/.exec(itemKey);
  if (m === null) return -1;
  const index = Number(m[1]);
  return index < MAX_LAYER_ROWS ? index : -1;
}

/** The layer a signal's item key is about; null for a stale or forged key, so it does nothing. */
export function layerAt(layers: readonly LayerInfo[], itemKey: string): LayerInfo | null {
  return layers[rowIndex(itemKey)] ?? null;
}

/**
 * A node of the solved scene, as the panel's parts are told apart: the row it is in (-1 outside
 * the list) and which part it is. A scene key ends in the node's own segment; a row's parts sit
 * under `…~layer-N/`.
 */
export interface ScenePart {
  row: number;
  part: "name" | "swatch" | "used" | "on" | "frozen" | "locked" | "count" | "fold" | "row" | "";
}

const PARTS: readonly ScenePart["part"][] = ["name", "swatch", "used", "on", "frozen", "locked", "count", "fold", "row"];

export function scenePart(key: string): ScenePart {
  const item = /~(layer-\d{1,4})\/(?!.*~)/.exec(key);
  const row = item?.[1] === undefined ? -1 : rowIndex(item[1]);
  const last = /#([a-z]+)$/.exec(key)?.[1] ?? "";
  const part = PARTS.find((p) => p === last) ?? "";
  // The heading's parts are not a row's, and a row's are not the heading's.
  if (part === "count" || part === "fold") return { row: -1, part: row === -1 ? part : "" };
  return { row, part: row === -1 ? "" : part };
}

/** The hint for a part of the panel: the same words the SolidJS panel's `data-hint`s say. */
export function partHint(layers: readonly LayerInfo[], open: boolean, at: ScenePart): string | null {
  if (at.part === "count") return layerCount(layers.length);
  if (at.part === "fold") return open ? "Hide the layers" : "Show the layers";
  const layer = layers[at.row];
  if (layer === undefined) return null;
  switch (at.part) {
    case "name":
      return layerHint(layer);
    case "swatch":
      return `${layer.colorName}, RGB ${layer.colorRgb.join(", ")}`;
    case "used":
      return layer.used ? "Has objects" : "No objects";
    case "on":
      return layer.on ? "Turn off" : "Turn on";
    case "frozen":
      return layer.frozen ? "Thaw" : "Freeze";
    case "locked":
      return layer.locked ? "Unlock" : "Lock";
    default:
      return null;
  }
}

/** A colour the browser computed (`rgb()`, `rgba()`, `color(srgb …)`) as Slab writes one; null for anything else. */
export function computedColor(value: string): string | null {
  const v = value.trim();
  const hex = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(v);
  const srgb = rgb === null ? /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/i.exec(v) : null;
  const m = rgb ?? srgb;
  if (m === null) return null;
  const scale = srgb === null ? 1 : 255;
  const [r, g, b] = [Number(m[1]) * scale, Number(m[2]) * scale, Number(m[3]) * scale];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (![r, g, b, a].every((n) => Number.isFinite(n)) || a < 0 || a > 1) return null;
  return `#${hex(r)}${hex(g)}${hex(b)}${a >= 1 ? "" : hex(a * 255)}`;
}
