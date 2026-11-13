/**
 * The status bar as the Slab document takes it (`slab/statusbar.slab`): typed scalar params and
 * one list, nothing else. This file shapes the words (`../components/StatusBar` has the toggles'
 * table and the counts' form, and the facade formats the position), decides what a bar too short
 * for everything gives up, and reads a pressed toggle back to the command it runs.
 *
 * **What gives way** is the order `../chrome.css` keeps for the SolidJS bar, decided here because
 * a Slab row gives room in document order and has no other: the layer's name narrows to its first
 * letters, then the layer count goes, the object count, the engine's badge, the position; the
 * selection count and the toggles never go, and the toggles take a second line (and a third) when
 * the bar is shorter than they are. An item is whole or gone, never cut, except the layer's name.
 *
 * **The toggles' lines** are broken here too: an `each` under a Slab `wrap` is one box to the
 * wrap, and a wrap has no way to set its lines from the end.
 */

import { count, LAYER_FLOOR, type StatusToggle } from "../components/StatusBar";
import type { SettingsState } from "../facade";
import { paramText } from "./bench-params";
import type { TextMeasure } from "./measure";

/** The document's measures the fold is worked out with, read from its tokens (`statusMetrics`). */
export interface StatusMetrics {
  /** The bar's inset at each end. */
  pad: number;
  /** The room after the layer's name, and after each fact that is whole or gone. */
  layerAfter: number;
  after: number;
  /** The engine badge's dot and the gap after it. */
  dot: number;
  dotGap: number;
  /** A toggle's inset at each side of its word, the room before each toggle, a word's tracking. */
  togglePad: number;
  toggleGap: number;
  /** The least a toggle is wide: none, or the target's width under a finger. */
  toggleMin: number;
  track: number;
  /** The room before the position's rule, the rule, and the room from it to the figures. */
  coordPad: number;
  rule: number;
  ruleGap: number;
}

/** The measures as `../tokens.css` and the document have them today: what is used until the tokens are read. */
export const STATUS_METRICS: StatusMetrics = { pad: 8, layerAfter: 12, after: 13, dot: 6, dotGap: 6, togglePad: 3, toggleGap: 4, toggleMin: 0, track: 0.44, coordPad: 8, rule: 1, ruleGap: 7 };

/** The token each measure is, in the document. */
const METRIC_TOKENS: Record<Exclude<keyof StatusMetrics, "toggleMin">, string> = {
  pad: "space.g8",
  layerAfter: "space.g12",
  after: "status.after",
  dot: "status.dot",
  dotGap: "space.g6",
  togglePad: "space.g3",
  toggleGap: "space.g4",
  track: "status.track",
  rule: "size.hairline",
  coordPad: "space.g8",
  ruleGap: "status.rule-gap",
};

/** The measures from a mounted surface's tokens; one that is missing or not a length keeps its default. */
export function statusMetrics(token: (path: string) => unknown, coarse = false): StatusMetrics {
  const out = { ...STATUS_METRICS };
  const length = (path: string): number | null => {
    const value = token(path);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 64 ? value : null;
  };
  for (const name of Object.keys(METRIC_TOKENS) as (keyof typeof METRIC_TOKENS)[]) out[name] = length(METRIC_TOKENS[name]) ?? out[name];
  // Under a finger a toggle's word has more room around it and its chip is never narrower than
  // the target (the document's `when coarse`; ui.css: `.ui-toggle--text`).
  if (coarse) {
    out.togglePad = length("space.g8") ?? 8;
    out.toggleMin = length("size.control-h-input") ?? 24;
  }
  return out;
}

/** One item of the bar's `toggles` list: a `StatusToggle` of the document. */
export interface StatusToggleParam {
  /** The item's identity in the kernel: the command the toggle runs. */
  key: string;
  /** What the toggle is called: its accessible name. */
  name: string;
  /** The word drawn, in capitals (the document has no way to set a case). */
  face: string;
  /** The function key, read out after the name. */
  shortcut: string;
  on: boolean;
  /** There is a toggle before it on its line: it keeps the gap between two toggles before it. */
  lead: boolean;
}

/** The toggles as the document's list, each with its setting's state. */
export function toggleParams(toggles: readonly StatusToggle[], settings: SettingsState): StatusToggleParam[] {
  return toggles.map((toggle) => ({ key: toggle.id, name: toggle.label, face: toggle.short.toUpperCase(), shortcut: toggle.shortcut ?? "", on: settings[toggle.key] === true, lead: true }));
}

/**
 * The toggle a signal's item key names; null when it names none, so a stale or forged signal
 * runs nothing.
 */
export function pressedToggle(toggles: readonly StatusToggle[], itemKey: string): StatusToggle | null {
  return toggles.find((toggle) => toggle.id === itemKey) ?? null;
}

/** One line of the toggles' run: a `ToggleLine` of the document. */
export interface StatusLineParam {
  key: string;
  toggles: StatusToggleParam[];
}

/** The most lines the run is broken into: one toggle to a line. */
const MAX_LINES = 64;

/**
 * The toggles' run in lines no longer than `room` px: each line takes the toggles that fit, in
 * order, and a toggle wider than the room has a line to itself. `widths` are the toggles' own,
 * and `gap` the room between two on a line. With no room known, one line.
 */
export function toggleLines(toggles: readonly StatusToggleParam[], widths: readonly number[], room: number, gap = 0): StatusLineParam[] {
  const lines: StatusToggleParam[][] = [];
  let line: StatusToggleParam[] = [];
  let used = 0;
  toggles.forEach((toggle, index) => {
    const width = widths[index] ?? 0;
    const next = used + (line.length > 0 ? gap : 0) + width;
    if (line.length > 0 && Number.isFinite(room) && room > 0 && next > room && lines.length < MAX_LINES - 1) {
      lines.push(line);
      line = [toggle];
      used = width;
    } else {
      line.push(toggle);
      used = next;
    }
  });
  if (line.length > 0) lines.push(line);
  // A line's key says how the whole run is broken. The driver at the pinned commit appends the
  // accessible node of an item that is new to a line after the line's others, wherever it stands:
  // a toggle that moved to the start of the next line would be read last. With the break in the
  // key every line is new when the break changes, and is built in order.
  const breaks = lines.map((items) => items.length).join(".");
  return lines.map((items, index) => ({ key: `line-${index}-of-${breaks}`, toggles: items.map((toggle, at) => ({ ...toggle, lead: at > 0 })) }));
}

/** What the bar says, before any of it is measured. */
export interface StatusInput {
  mode: "wasm" | "mock";
  currentLayer: string;
  entityCount: number;
  layerCount: number;
  selectionCount: number;
  /** The position's box in characters: the widest text it has held (`../components/StatusBar`). */
  coordChars: number;
}

/** A count that is one: the engine never sends less than none, but a number is not trusted to be one. */
const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The bar's widths in px, each item with the room after it. */
export interface StatusWidths {
  mode: number;
  /** The layer's name at its natural width (capped), and at the fewest letters it keeps. */
  layer: number;
  layerFloor: number;
  /** The room after the layer's name. */
  layerAfter: number;
  objects: number;
  layers: number;
  selection: number;
  /** The toggles on one line. */
  toggles: number;
  coord: number;
}

/** What a bar of some width shows. */
export interface StatusFold {
  /** The width of the layer's name. */
  layer_w: number;
  show_mode: boolean;
  show_objects: boolean;
  show_layers: boolean;
  show_coord: boolean;
  /** The room left for the toggles' run, in px; `Infinity` in a bar not yet measured. */
  toggleRoom: number;
}

/**
 * How far over its room a bar may be and still count as fitting: the widths are sums of advances
 * kept to 1/1024 px, and a rounding must not send an item away from a bar it fits to the pixel.
 */
const SLACK = 0.5;

/**
 * What gives way in a bar with `room` px between its insets. Each step takes the whole shortfall
 * before the next gives anything; an item that would have to be cut is gone instead. A bar not
 * yet measured (no room at all) shows everything.
 */
export function statusFold(room: number, w: StatusWidths): StatusFold {
  const all: StatusFold = { layer_w: w.layer, show_mode: true, show_objects: true, show_layers: true, show_coord: true, toggleRoom: Infinity };
  if (!(room > 0)) return all;
  let short = w.mode + w.layer + w.layerAfter + w.objects + w.layers + w.selection + w.toggles + w.coord - SLACK - room;
  if (short <= 0) return all;
  const fold = { ...all };
  const give = Math.min(short, Math.max(0, w.layer - w.layerFloor));
  fold.layer_w = Math.max(0, Math.floor(w.layer - give));
  short -= give;
  const steps: readonly (readonly ["show_mode" | "show_objects" | "show_layers" | "show_coord", number])[] = [
    ["show_layers", w.layers],
    ["show_objects", w.objects],
    ["show_mode", w.mode],
    ["show_coord", w.coord],
  ];
  for (const [name, width] of steps) {
    if (short <= 0) break;
    fold[name] = false;
    short -= width;
  }
  // Still short: the run is broken into lines no longer than what the bar has left.
  if (short > 0) fold.toggleRoom = Math.max(0, w.toggles - short);
  return fold;
}

/** The scalar params of the bar, but for the position's text (which changes with every move of the pointer). */
export interface StatusScalars extends Omit<StatusFold, "toggleRoom"> {
  mode: string;
  live: boolean;
  layer: string;
  objects: string;
  layers: string;
  selection: string;
  selected: boolean;
  coord_w: number;
}

/** The most characters of a layer's name the bar shows before it clips (chrome.css: `max-width: 24ch`). */
const LAYER_CAP = 24;

/** The bar as the document takes it: its scalars, and the toggles' run in lines. */
export interface StatusParams {
  scalars: StatusScalars;
  lines: StatusLineParam[];
}

/**
 * The bar's params for what it says, in a bar `width` px wide (0 before it is measured), with the
 * page's measure of text. `toggles` are the faces drawn.
 */
export function statusParams(input: StatusInput, toggles: readonly StatusToggleParam[], width: number, measured: TextMeasure, metrics: StatusMetrics = STATUS_METRICS): StatusParams {
  // A width that is no length is none: nothing that is not a finite number reaches the kernel.
  const measure: TextMeasure = (style, text, tracking) => {
    const w = measured(style, text, tracking);
    return Number.isFinite(w) && w > 0 ? w : 0;
  };
  const coordChars = Number.isFinite(input.coordChars) ? Math.max(0, Math.min(input.coordChars, 256)) : 0;
  const layer = paramText(input.currentLayer);
  const objectsN = whole(input.entityCount);
  const layersN = whole(input.layerCount);
  const selectionN = whole(input.selectionCount);
  const objects = objectsN === 1 ? "1 object" : `${count(objectsN)} objects`;
  const layers = layersN === 1 ? "1 layer" : `${count(layersN)} layers`;
  const selection = selectionN > 0 ? `${count(selectionN)} selected` : "";

  const ch = measure("label", "0");
  const fact = (text: string): number => (text === "" ? 0 : measure("label", text) + metrics.after);
  // chrome.css, `.status-layer`: as wide as the name, at least its first letters' width (in
  // digits' widths, so a short name of narrow letters has a box wider than itself), at most 24.
  const layerFloor = Math.min([...layer].length, LAYER_FLOOR) * ch;
  const layerNatural = Math.min(Math.max(measure("label", layer), layerFloor), LAYER_CAP * ch);
  // The box after the rule: the room to the figures, and the figures.
  const coord_w = Math.ceil(metrics.ruleGap + coordChars * measure("mono", "0"));
  // Each toggle's own width; between two on a line there is the gap (the document keeps it before
  // every toggle but a line's first).
  const faces = toggles.map((toggle) => Math.max(metrics.toggleMin, measure("chip", toggle.face, metrics.track) + 2 * metrics.togglePad));
  const run = faces.reduce((sum, face) => sum + face, 0) + metrics.toggleGap * Math.max(0, faces.length - 1);
  const { toggleRoom, ...fold } = statusFold(width - 2 * metrics.pad, {
    mode: metrics.dot + metrics.dotGap + fact(input.mode),
    layer: layerNatural,
    layerFloor,
    layerAfter: metrics.layerAfter,
    objects: fact(objects),
    layers: fact(layers),
    selection: fact(selection),
    toggles: run,
    coord: metrics.coordPad + metrics.rule + coord_w,
  });
  return {
    scalars: { mode: input.mode, live: input.mode === "wasm", layer, objects, layers, selection, selected: selection !== "", coord_w, ...fold },
    lines: toggleLines(toggles, faces, toggleRoom, metrics.toggleGap),
  };
}

/** Whether a bar's layer name is cut: its hint then says the whole name. */
export function layerClipped(layer: string, layerWidth: number, measure: TextMeasure): boolean {
  return measure("label", paramText(layer)) > layerWidth + 0.01;
}
