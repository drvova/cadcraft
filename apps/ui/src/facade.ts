/**
 * The facade shim: the single module that loads and calls `crates/wasm`'s `Facade` (the
 * contract in .design-system/boss/briefs/s-facade.1.md) and the single place where the
 * mock/real switch lives.
 *
 * Every call crosses as a JSON string; nothing here understands drawing geometry — it parses
 * envelopes and typed summaries, and hands the raw display list to `display.ts`.
 *
 * Modes:
 *  - `?mock=1` in the page URL, or a wasm module that is not there / does not load, serves the
 *    canned facade in `mock.ts` so the UI is developable before `crates/wasm` lands.
 *  - otherwise the generated `src/wasm/cadcraft_wasm.js` is imported lazily (the glob lives in
 *    `wasm-loader.ts`, which only Vite evaluates) and wrapped.
 */

import { displayListOf, EMPTY_DISPLAY, MAX_DISPLAY_REPLY_BYTES, parseDisplayList, type DisplayList, type DisplayPrim } from "./display";
import { anchorOf, emptyPrompt, NO_ANCHOR, reducePrompt, type PromptAnchor, type PromptState } from "./prompt";
import { MockFacade } from "./mock";
import { asBool, asNumber, asString, isRecord } from "./json";
import { parseRect, rectIsDegenerate, type Point, type Rect } from "./view";

/** The raw wasm-bindgen handle: exactly the facade's methods, JSON strings in and out. */
export interface RawFacade {
  execute(command: string, paramsJson: string): string;
  cmdline(text: string): string;
  start(id: string): string;
  /** The engine session's own cancel (Escape); replies the same delta `cmdline` does. */
  cancel(): string;
  prompt(): string;
  state(): string;
  selection(): string;
  settings(): string;
  format_point(x: number, y: number): string;
  commands(): string;
  source(): string;
  run_script(text: string): string;
  /** The display list for the view expanded by `margin` (a fraction of the view's span). */
  display(margin: number): string;
  set_view(x0: number, y0: number, x1: number, y1: number): string;
  view(): string;
  /** The canvas's size in CSS pixels: what turns the engine's pick box (pixels) into world units. */
  set_viewport(width: number, height: number): string;
  /** Where the pointer is, in world coordinates: the direction of direct distance entry. */
  set_cursor(x: number, y: number): string;
  /** The running command's rubber band with the pointer at a world point. */
  preview(x: number, y: number): string;
  /** What is under a world point, nearest first; it never changes the selection. */
  pick(x: number, y: number, aperture: number): string;
  /** The object snap a world point takes, or `{"snap":null}`. */
  snap(x: number, y: number, aperture: number): string;
  /**
   * The pointer resolved for the running command: the point a click takes (object snap, grid
   * snap, polar and object-snap tracking, ortho), what bent it, the rays to draw and the rubber
   * band there. `nowMs` is a steady clock in milliseconds; `modifiers` is 1 for Shift plus 2 for
   * Ctrl.
   */
  pointer(x: number, y: number, aperture: number, nowMs: number, modifiers: number): string;
  /** A pointer click given to the running command, resolved as `pointer` reports. */
  click(x: number, y: number, aperture: number): string;
  open_bytes(name: string, bytes: Uint8Array): string;
  load_sample(): string;
  save_bytes(): Uint8Array;
  digest(): string;
}

export type FacadeMode = { kind: "wasm" | "mock"; detail: string };

/** The `{"ok":true,"result":…}` / `{"ok":false,"error":"…"}` envelope every `execute` replies. */
export type Envelope = { ok: true; result: unknown } | { ok: false; error: string };

export function parseEnvelope(raw: string): Envelope | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64 * 1024 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value["ok"] === true) return { ok: true, result: value["result"] };
  if (value["ok"] === false) return { ok: false, error: asString(value["error"]) ?? "unknown error" };
  return null;
}

/** The drawing summary (`Facade::state`), parsed tolerantly across key spellings. */
export interface DrawingState {
  title: string;
  dirty: boolean;
  revision: number;
  extents: Rect | null;
  layerCount: number;
  entityCount: number;
  currentLayer: string;
  space: string;
  /** The drawing's units in words (`INSUNITS`), as the assistant's briefing names them. */
  units: string;
  /** The undo stack's depth (`Facade::state`'s `undoDepth`); null when the facade does not say
   *  (the mock, or an older wasm build): then there is no checkpoint to keep. */
  undoDepth: number | null;
}

/** A reported undo depth as a whole, non-negative count; anything else is "not said". */
function undoDepthOf(n: number | null): number | null {
  return n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n);
}

export function parseDrawingState(raw: string): DrawingState | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4 * 1024 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const first = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = value[k];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };
  const extents = parseRect(first("extents", "bounds"));
  const layers = first("layers", "layerCount");
  const entities = first("entities", "entityCount", "count");
  return {
    title: asString(first("title", "name", "file")) ?? "Untitled",
    dirty: asBool(first("dirty", "modified")) ?? false,
    revision: Math.max(0, Math.round(asNumber(first("revision", "rev")) ?? 0)),
    extents,
    layerCount: typeof layers === "number" ? Math.round(layers) : Array.isArray(layers) ? layers.length : 0,
    entityCount: typeof entities === "number" ? Math.round(entities) : Array.isArray(entities) ? entities.length : 0,
    currentLayer: asString(first("currentLayer", "current", "clayer")) ?? "0",
    space: asString(first("space", "activeSpace")) ?? "model",
    units: asString(first("units", "insunits")) ?? "",
    undoDepth: undoDepthOf(asNumber(first("undoDepth"))),
  };
}

/** The active drawing's selection (`Facade::selection`); handles are the engine's hex strings. */
export interface SelectionState {
  count: number;
  handles: string[];
}

/** The drafting-toggle states the status bar reads (`Facade::settings`). */
export interface SettingsState {
  grid: boolean;
  snap: boolean;
  ortho: boolean;
  polar: boolean;
  isodraft: boolean;
  otrack: boolean;
  osnap: boolean;
  dynmode: boolean;
  lwdisplay: boolean;
  transparency: boolean;
  qpmode: boolean;
  osmode: number;
  pickbox: number;
}

/**
 * The running command's preview as existing objects under one transform (MOVE, COPY, ROTATE,
 * SCALE, MIRROR), so the canvas redraws primitives it already holds instead of receiving their
 * copies on every pointer move.
 */
export interface PreviewDrag {
  /** The dragged objects, as the display list's `prims[].handle` numbers. */
  handles: readonly number[];
  /** `[a, b, c, d, e, f]`: world `(x, y)` goes to `(a·x + c·y + e, b·x + d·y + f)`, the argument
   *  order of a canvas `transform(a, b, c, d, e, f)`. */
  matrix: readonly [number, number, number, number, number, number];
  /** The dragged objects are being pasted: they are not in the drawing, so they come in the
   *  preview's own `prims`, already placed, and `handles` is empty. */
  clipboard: boolean;
}

/** The running command's rubber band (`Facade::preview`): a display list's `verts` and `prims`
 *  in world coordinates (rubber-band primitives carry handle 0), and the drag, if it is one. */
export interface CommandPreview {
  verts: readonly Point[];
  prims: readonly DisplayPrim[];
  drag: PreviewDrag | null;
}

export const EMPTY_PREVIEW: CommandPreview = { verts: [], prims: [], drag: null };

/** The most dragged handles a preview reply is read for (the engine caps the reply's bytes). */
const MAX_DRAG_HANDLES = 400_000;
/** The most handles a pick reply is read for (the engine sends at most 64). */
const MAX_PICK_HANDLES = 64;

function parsePreviewDrag(value: unknown): PreviewDrag | null {
  if (!isRecord(value)) return null;
  const m = value["matrix"];
  if (!Array.isArray(m) || m.length !== 6) return null;
  const [a, b, c, d, e, f] = [asNumber(m[0]), asNumber(m[1]), asNumber(m[2]), asNumber(m[3]), asNumber(m[4]), asNumber(m[5])];
  if (a === null || b === null || c === null || d === null || e === null || f === null) return null;
  const handles: number[] = [];
  const raw = Array.isArray(value["handles"]) ? value["handles"] : [];
  const n = Math.min(raw.length, MAX_DRAG_HANDLES);
  for (let i = 0; i < n; i++) {
    const h = asNumber(raw[i]);
    if (h !== null && h >= 0) handles.push(Math.round(h));
  }
  return { handles, matrix: [a, b, c, d, e, f], clipboard: asBool(value["clipboard"]) ?? false };
}

/**
 * A preview out of a value that is already parsed (a `preview` reply, or the `preview` of a
 * `pointer` reply): its display list and its drag, read from the one parse.
 */
function previewOf(value: unknown): CommandPreview {
  const list = displayListOf(value);
  if (list === null || !isRecord(value)) return EMPTY_PREVIEW;
  const drag = parsePreviewDrag(value["drag"]);
  return list.prims.length === 0 && drag === null ? EMPTY_PREVIEW : { verts: list.verts, prims: list.prims, drag };
}

/** Parse a `preview` reply, once; anything unreadable, or a refusal, is the empty preview. */
export function parsePreview(raw: string): CommandPreview {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_DISPLAY_REPLY_BYTES) return EMPTY_PREVIEW;
  return previewOf(parseJson(raw));
}

function pickHandles(parsed: unknown): string[] {
  if (!isRecord(parsed) || !Array.isArray(parsed["handles"])) return [];
  const out: string[] = [];
  for (const h of parsed["handles"]) {
    if (out.length >= MAX_PICK_HANDLES) break;
    if (typeof h === "string" && h.length > 0) out.push(h);
  }
  return out;
}

/** Parse a `pick` reply into the engine's hex handles, nearest first; unreadable is none. */
export function parsePick(raw: string): string[] {
  return pickHandles(parseJson(raw));
}

/**
 * The handle a `pick` reply says to highlight under the pointer, or null. The engine names it
 * (`hover`: what a click there selects, unless the selection preview is off or its filter keeps
 * the object dark, as one on a locked layer). A reply without the field (an older engine, a
 * canned facade) falls back to the nearest handle, which is what the hover was before.
 */
export function parseHover(raw: string): string | null {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  const hover = parsed["hover"];
  if (hover === undefined) return pickHandles(parsed)[0] ?? null;
  return typeof hover === "string" && hover.length > 0 ? hover : null;
}

/** An object snap (`Facade::snap`): where the pointer snaps to, and why. */
export interface SnapPoint {
  point: Point;
  /** The engine's OSMODE bit: 1 endpoint, 2 midpoint, 4 centre, 8 node, 16 quadrant,
   *  32 intersection, 64 insertion, 128 perpendicular, 256 tangent, 512 nearest,
   *  1024 geometric centre, 2048 apparent intersection, 4096 extension, 8192 parallel. */
  mode: number;
  /** The engine's own name for it ("Endpoint", "Midpoint", "Center"…), for a tooltip. */
  name: string;
  /** A deferred tangent or perpendicular: `point` is provisional until the line's other end
   *  is known, and only `click` (never typed coordinates) can give it to the command. */
  deferred: boolean;
}

function parseXy(value: unknown): Point | null {
  if (!Array.isArray(value)) return null;
  const x = asNumber(value[0]);
  const y = asNumber(value[1]);
  return x === null || y === null ? null : { x, y };
}

function parseSnapValue(value: unknown): SnapPoint | null {
  if (!isRecord(value)) return null;
  const point = parseXy(value["point"]);
  if (point === null) return null;
  const mode = asNumber(value["mode"]);
  return { point, mode: mode === null ? 0 : Math.max(0, Math.round(mode)), name: asString(value["name"]) ?? "", deferred: asBool(value["deferred"]) ?? false };
}

/** Parse a `snap` reply (or the `snap` field of a `click` reply); null when nothing snapped. */
export function parseSnap(raw: string): SnapPoint | null {
  const parsed = parseJson(raw);
  return isRecord(parsed) ? parseSnapValue(parsed["snap"]) : null;
}

export { NO_ANCHOR, type PromptAnchor } from "./prompt";

/**
 * Read the anchor out of a command-line reply (`prompt`, `cmdline`, `start`, `click`). The shell
 * does not call this: `PromptState.anchor` holds the same thing, read from the reply the state
 * itself was folded from.
 */
export function parsePromptAnchor(raw: string): PromptAnchor {
  const parsed = parseJson(raw);
  return isRecord(parsed) ? anchorOf(parsed) : NO_ANCHOR;
}

/** What bent the pointer on its way to the point a click takes (`Facade::pointer`). */
export type PointerConstraint = "none" | "osnap" | "ortho" | "polar" | "grid" | "track";

const CONSTRAINTS: readonly PointerConstraint[] = ["none", "osnap", "ortho", "polar", "grid", "track"];

/** A constraint's rays, in the display list's own form (world coordinates). */
export interface PointerPaths {
  verts: readonly Point[];
  prims: readonly DisplayPrim[];
}

const NO_PATHS: PointerPaths = { verts: [], prims: [] };

/** The pointer resolved for the running command (`Facade::pointer`). */
export interface ResolvedPointer {
  /** The point the next click takes: what the rubber band is drawn to. */
  point: Point;
  constraint: PointerConstraint;
  /** The object snap that took the point, when one did. */
  snap: SnapPoint | null;
  /** What an ortho, polar or tracking constraint is measured from; null without one. */
  from: Point | null;
  /** The distance from `from` to the point, in world units; null without a constraint. */
  distance: number | null;
  /** The direction from `from`, in degrees as the drawing counts them; null without a constraint. */
  angle: number | null;
  /** The constraint in words, in the drawing's units ("Polar: 4.2500 < 45°"); "" for none. */
  label: string;
  /** The ortho or polar ray and the tracking paths the point lies on. */
  paths: PointerPaths;
  /** The points object-snap tracking holds. */
  acquired: readonly Point[];
  /** A tracking point is being acquired: ask again after the dwell even if the pointer rests. */
  wait: boolean;
  /** The running command's rubber band at `point`. */
  preview: CommandPreview;
}

/** The most acquired tracking points a reply is read for (the engine keeps seven). */
const MAX_ACQUIRED = 16;

/** The longest constraint label shown (the engine's is a few words). */
const MAX_LABEL_CHARS = 120;

/** A pointer nothing bends: the point is the pointer, with the given rubber band. */
export function freePointer(point: Point, preview: CommandPreview = EMPTY_PREVIEW): ResolvedPointer {
  return { point, constraint: "none", snap: null, from: null, distance: null, angle: null, label: "", paths: NO_PATHS, acquired: [], wait: false, preview };
}

/**
 * Parse a `pointer` reply, once. `fallback` is the pointer itself: a refusal (a `null` point), a
 * malformed reply or anything unreadable is the free pointer there, with no rubber band, so the
 * canvas never draws to a point the engine did not give.
 */
export function parsePointer(raw: string, fallback: Point): ResolvedPointer {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_DISPLAY_REPLY_BYTES) return freePointer(fallback);
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return freePointer(fallback);
  const point = parseXy(parsed["point"]);
  if (point === null) return freePointer(fallback);
  const named = parsed["constraint"];
  const constraint = CONSTRAINTS.find((c) => c === named) ?? "none";
  const paths = displayListOf(parsed["paths"]);
  const acquired: Point[] = [];
  for (const a of Array.isArray(parsed["acquired"]) ? parsed["acquired"] : []) {
    if (acquired.length >= MAX_ACQUIRED) break;
    const p = parseXy(a);
    if (p !== null) acquired.push(p);
  }
  return {
    point,
    constraint,
    snap: parseSnapValue(parsed["snap"]),
    from: parseXy(parsed["from"]),
    distance: asNumber(parsed["distance"]),
    angle: asNumber(parsed["angle"]),
    label: (asString(parsed["label"]) ?? "").slice(0, MAX_LABEL_CHARS),
    paths: paths === null || paths.prims.length === 0 ? NO_PATHS : { verts: paths.verts, prims: paths.prims },
    acquired,
    wait: parsed["wait"] === true,
    preview: previewOf(parsed["preview"]),
  };
}

/** The keys held with the pointer, and its clock (`Facade::pointer`). */
export interface PointerInput {
  /** The reach in world units; 0 (the default) is the engine's own aperture at the view. */
  aperture?: number;
  /** A steady clock in milliseconds (`performance.now()`): resting on a snap acquires it. */
  now: number;
  /** Shift flips ortho while it is held. */
  shift?: boolean;
  /** Ctrl switches ARC's direction while it is held. */
  ctrl?: boolean;
}

/** What a `click` did: the command line after it, the object snap the point took, and the point. */
export interface ClickResult {
  state: PromptState;
  snap: SnapPoint | null;
  /** The point the command was given (snapped, on the grid, along a ray); null when refused. */
  point: Point | null;
}

/** One layout tab from `execute("layout.list", {})`. `current` is true when the layout's name
 *  equals the drawing's active space (`state().space`), so callers do not need a second call. */
export interface LayoutInfo {
  name: string;
  current: boolean;
  tabOrder?: number;
}

/** `execute("properties", {})`'s result: the drawing's defaults with no selection, or the
 *  selected objects' property rows. */
export type PropertiesReply =
  | { selection: "No selection"; defaults: Record<string, unknown> }
  | { count: number; objects: Record<string, unknown>[] };

/** One layer row from `execute("layer", {})`. */
export interface LayerInfo {
  name: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  used: boolean;
  current: boolean;
  colorName: string;
  /** sRGB 0..255; the engine's `colorRgb` when it parses, else the ACI name/index, else neutral. */
  colorRgb: readonly [number, number, number];
  linetype: string;
  lineweight: string;
  description: string;
}

const ACI_NAMES: Readonly<Record<string, readonly [number, number, number]>> = {
  red: [255, 0, 0],
  yellow: [255, 255, 0],
  green: [0, 255, 0],
  cyan: [0, 255, 255],
  blue: [0, 0, 255],
  magenta: [255, 0, 255],
  white: [255, 255, 255],
  black: [0, 0, 0],
};
const ACI_INDEX: Readonly<Record<number, readonly [number, number, number]>> = {
  1: ACI_NAMES["red"] ?? [255, 0, 0],
  2: ACI_NAMES["yellow"] ?? [255, 255, 0],
  3: ACI_NAMES["green"] ?? [0, 255, 0],
  4: ACI_NAMES["cyan"] ?? [0, 255, 255],
  5: ACI_NAMES["blue"] ?? [0, 0, 255],
  6: ACI_NAMES["magenta"] ?? [255, 0, 255],
  7: ACI_NAMES["white"] ?? [255, 255, 255],
};
const NEUTRAL: readonly [number, number, number] = [212, 212, 212];

/** `#rrggbb` (the engine's `Color::hex`) into sRGB; null when it is not that shape. */
export function parseHexColor(s: string): readonly [number, number, number] | null {
  const hex = s.startsWith("#") ? s.slice(1) : s;
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function layerColor(raw: unknown): readonly [number, number, number] {
  if (typeof raw === "string") {
    const hex = parseHexColor(raw);
    if (hex) return hex;
    const named = ACI_NAMES[raw.trim().toLowerCase()];
    if (named) return named;
    const index = Number.parseInt(raw, 10);
    if (Number.isFinite(index)) return ACI_INDEX[index] ?? NEUTRAL;
  }
  if (typeof raw === "number") return ACI_INDEX[raw] ?? NEUTRAL;
  return NEUTRAL;
}

export function parseLayers(result: unknown): LayerInfo[] {
  if (!isRecord(result)) return [];
  const rows = result["layers"];
  if (!Array.isArray(rows)) return [];
  const out: LayerInfo[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = asString(row["name"]);
    if (name === null) continue;
    out.push({
      name,
      on: asBool(row["on"]) ?? true,
      frozen: asBool(row["frozen"]) ?? false,
      locked: asBool(row["locked"]) ?? false,
      plot: asBool(row["plot"]) ?? true,
      used: asBool(row["used"]) ?? false,
      current: asBool(row["current"]) ?? false,
      colorName: asString(row["color"]) ?? "7",
      colorRgb: layerColor(row["colorRgb"] ?? row["color"]),
      linetype: asString(row["linetype"]) ?? "ByLayer",
      lineweight: asString(row["lineweight"]) ?? "ByLayer",
      description: asString(row["description"]) ?? "",
    });
  }
  return out;
}

/** One command row from `Facade::commands()` (`engine.commands`). */
export interface CommandInfo {
  id: string;
  label: string;
  menu: string;
  shortcut: string;
  aliases: readonly string[];
  params: string;
  enabled: boolean;
}

export function parseCommands(raw: string): CommandInfo[] {
  if (typeof raw !== "string" || raw.length > 16 * 1024 * 1024) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value["commands"]) ? value["commands"] : [];
  const out: CommandInfo[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = asString(row["id"]);
    if (id === null) continue;
    const menu = row["menu"];
    out.push({
      id,
      label: asString(row["label"]) ?? id,
      menu: Array.isArray(menu) ? menu.filter((m): m is string => typeof m === "string").join(" › ") : (asString(menu) ?? ""),
      shortcut: asString(row["shortcut"]) ?? "",
      aliases: Array.isArray(row["aliases"]) ? row["aliases"].filter((a): a is string => typeof a === "string") : [],
      params: asString(row["params"]) ?? "",
      enabled: asBool(row["enabled"]) ?? true,
    });
  }
  return out;
}

/** The typed face of the facade the UI consumes. Every call is guarded: a trap in wasm must
 *  not take the page down, it becomes an error string the status line can show. */
export class AppFacade {
  constructor(
    private readonly raw: RawFacade,
    readonly mode: FacadeMode,
  ) {}

  private call(fn: () => string): string {
    try {
      return fn();
    } catch (e) {
      return JSON.stringify({ ok: false, error: `the facade call failed: ${message(e)}` });
    }
  }

  /** `execute` with the envelope parsed; never throws. */
  execute(command: string, params: unknown = {}): Envelope {
    const raw = this.call(() => this.raw.execute(command, JSON.stringify(params ?? {})));
    return parseEnvelope(raw) ?? { ok: false, error: `unreadable reply from \`${command}\`` };
  }

  /**
   * Type at the command line. `prev` is the caller's accumulated state (the app holds it as a
   * signal): the facade's `cmdline()` reply carries only the delta, while `prompt()` carries the
   * log tail — folding the delta into the previous state is what makes the log accumulate.
   */
  cmdline(text: string, prev: PromptState = emptyPrompt()): PromptState {
    const raw = this.call(() => this.raw.cmdline(text));
    return reducePrompt(prev, raw, text);
  }

  /**
   * Start a command **by its id**, as a menu click does (interactive commands ask their
   * questions through this reply, answered with `cmdline`). Folded like `cmdline`: the reply is
   * the command-line delta, including the `output` lines the start produced.
   */
  start(id: string, prev: PromptState = emptyPrompt()): PromptState {
    const raw = this.call(() => this.raw.start(id));
    return reducePrompt(prev, raw, id);
  }

  /**
   * Cancel the running command, as Escape does in the engine: it ends with `*Cancel*` in the
   * output, and the engine's empty Enter still repeats it. Folded like `cmdline`, with no echo
   * (nothing was typed).
   */
  cancel(prev: PromptState = emptyPrompt()): PromptState {
    const raw = this.call(() => this.raw.cancel());
    return reducePrompt(prev, raw);
  }

  /** The engine's prompt state without typing anything (seeds the log tail at boot). */
  currentPrompt(): PromptState {
    const raw = this.call(() => this.raw.prompt());
    return reducePrompt(emptyPrompt(), raw);
  }

  drawingState(): DrawingState | null {
    return parseDrawingState(this.call(() => this.raw.state()));
  }

  /** The active selection; tolerant of a malformed reply (an empty selection). */
  selection(): SelectionState {
    const parsed = parseJson(this.call(() => this.raw.selection()));
    if (!isRecord(parsed)) return { count: 0, handles: [] };
    const handles = Array.isArray(parsed["handles"]) ? parsed["handles"].filter((h): h is string => typeof h === "string") : [];
    const count = asNumber(parsed["count"]);
    return { count: count === null ? handles.length : Math.max(0, Math.round(count)), handles };
  }

  /** The status bar's drafting toggles; missing keys default to off, `pickbox` to 3. */
  settings(): SettingsState {
    const parsed = parseJson(this.call(() => this.raw.settings()));
    const o = isRecord(parsed) ? parsed : {};
    const b = (key: string): boolean => asBool(o[key]) ?? false;
    return {
      grid: b("grid"),
      snap: b("snap"),
      ortho: b("ortho"),
      polar: b("polar"),
      isodraft: b("isodraft"),
      otrack: b("otrack"),
      osnap: b("osnap"),
      dynmode: b("dynmode"),
      lwdisplay: b("lwdisplay"),
      transparency: b("transparency"),
      qpmode: b("qpmode"),
      osmode: asNumber(o["osmode"]) ?? 0,
      pickbox: asNumber(o["pickbox"]) ?? 3,
    };
  }

  /** A point in the drawing's own units; falls back to the raw reply when it is not `{text}`. */
  formatPoint(x: number, y: number): string {
    const raw = this.call(() => this.raw.format_point(x, y));
    const parsed = parseJson(raw);
    return isRecord(parsed) && typeof parsed["text"] === "string" ? parsed["text"] : raw;
  }

  /**
   * The drawing's layout tabs in tab order (`execute("layout.list", {})`). `current` is true
   * when the layout's name equals the drawing's active space (`state().space`) — Model space is
   * not one of these rows, so a status bar renders its Model tab itself, as the desktop does.
   */
  layouts(): LayoutInfo[] {
    const env = this.execute("layout.list", {});
    if (!env.ok) return [];
    const rows = Array.isArray(env.result) ? env.result : [];
    const space = this.drawingState()?.space ?? "";
    const out: LayoutInfo[] = [];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const name = asString(row["name"]);
      if (name === null) continue;
      const tabOrder = asNumber(row["tabOrder"]);
      const info: LayoutInfo = { name, current: name === space };
      if (tabOrder !== null) info.tabOrder = Math.round(tabOrder);
      out.push(info);
    }
    return out;
  }

  setLayout(name: string): Envelope {
    return this.execute("layout.set", { name });
  }

  /**
   * The properties palette's data (`execute("properties", {})`): the drawing's defaults with no
   * selection (the engine's flat defaults object, under `defaults`), or the selected objects.
   * Null when the command fails or the reply is unreadable.
   */
  properties(): PropertiesReply | null {
    const env = this.execute("properties", {});
    if (!env.ok || !isRecord(env.result)) return null;
    const result = env.result;
    if (Array.isArray(result["objects"])) {
      const objects = result["objects"].filter((o): o is Record<string, unknown> => isRecord(o));
      const count = asNumber(result["count"]);
      return { count: count === null ? objects.length : Math.max(0, Math.round(count)), objects };
    }
    const defaults: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
      if (key !== "selection") defaults[key] = value;
    }
    return { selection: "No selection", defaults };
  }

  setProperties(patch: Record<string, unknown>): Envelope {
    return this.execute("properties.set", patch);
  }

  commands(): CommandInfo[] {
    return parseCommands(this.call(() => this.raw.commands()));
  }

  /**
   * The display list, culled to the view expanded by `margin` of its span per side (0 fetches
   * exactly the view). The shell asks for a padded window once and pans inside it
   * (`display-cache.ts`), so a drag costs no engine call at all.
   */
  displayList(margin = 0): DisplayList {
    return parseDisplayList(this.call(() => this.raw.display(margin))) ?? EMPTY_DISPLAY;
  }

  /** The view the facade is showing, or null when it does not answer a rectangle. */
  viewRect(): Rect | null {
    const rect = parseRect(parseJson(this.call(() => this.raw.view())));
    return rect && !rectIsDegenerate(rect) ? rect : null;
  }

  setView(rect: Rect): Envelope {
    if (rectIsDegenerate(rect)) return { ok: false, error: "refused a degenerate view rectangle" };
    const raw = this.call(() => this.raw.set_view(rect.x0, rect.y0, rect.x1, rect.y1));
    return parseEnvelope(raw) ?? { ok: false, error: "unreadable reply from set_view" };
  }

  /**
   * Tell the engine the canvas's size in CSS pixels. Call it when the canvas is laid out or
   * resized: until then the engine assumes 1200 x 800, and its own pick box and snap aperture
   * (the `aperture = 0` of `pick`, `snap` and `click`, and every click a command takes at "Select
   * objects") are the wrong size. A size that is not finite or not positive is refused.
   */
  setViewport(width: number, height: number): Envelope {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ok: false, error: "refused a canvas size that is not positive" };
    const raw = this.call(() => this.raw.set_viewport(width, height));
    return parseEnvelope(raw) ?? { ok: false, error: "unreadable reply from set_viewport" };
  }

  /**
   * Tell the engine where the pointer is (world coordinates). A distance typed alone at a point
   * prompt (`5`) then goes that far towards the pointer. Call it on pointer moves while a
   * command runs; a point that is not finite is refused.
   */
  setCursor(point: Point): Envelope {
    if (!usablePoint(point)) return { ok: false, error: "refused a cursor that is not finite" };
    const raw = this.call(() => this.raw.set_cursor(point.x, point.y));
    return parseEnvelope(raw) ?? { ok: false, error: "unreadable reply from set_cursor" };
  }

  /**
   * The running command's rubber band with the pointer at `point` (world coordinates): empty
   * when no command runs or it draws nothing. Cheap enough for every pointer frame; it changes
   * nothing in the engine. Pass the snapped point when `snap` found one.
   */
  preview(point: Point): CommandPreview {
    if (!usablePoint(point)) return EMPTY_PREVIEW;
    return parsePreview(this.call(() => this.raw.preview(point.x, point.y)));
  }

  /**
   * The objects under `point`, nearest first, as the selection's hex handles (the first is what
   * a click there selects): for a hover highlight. It never changes the selection or the undo
   * stack. `aperture` is the reach in world units; 0 is the engine's own pick box at the current
   * view (needs `setViewport`).
   */
  pick(point: Point, aperture = 0): string[] {
    if (!usablePoint(point) || !usableAperture(aperture)) return [];
    return parsePick(this.call(() => this.raw.pick(point.x, point.y, aperture)));
  }

  /**
   * The handle to highlight under `point`, or null: what a click there would select, as the
   * engine decides it. Nothing lights while the running command wants a point, while the
   * selection preview is off, or over an object its filter keeps dark (one on a locked layer);
   * objects on frozen layers are never under the pointer. One call, and it changes nothing.
   */
  hover(point: Point, aperture = 0): string | null {
    if (!usablePoint(point) || !usableAperture(aperture)) return null;
    return parseHover(this.call(() => this.raw.pick(point.x, point.y, aperture)));
  }

  /**
   * The pointer resolved for the running command, in one call per frame: the point the next
   * click takes under the engine's whole drafting state (running object snaps, grid snap, polar
   * and object-snap tracking, ortho), what bent it, the rays to draw, and the rubber band at that
   * point. It tells the engine where the cursor is (so `setCursor` is not needed with it) and
   * which keys are held; the drawing and the prompt are untouched. With no command wanting a
   * point the pointer is free. Input the engine would refuse answers the free pointer too.
   */
  pointer(point: Point, input: PointerInput): ResolvedPointer {
    const aperture = input.aperture ?? 0;
    if (!usablePoint(point) || !usableAperture(aperture)) return freePointer(point);
    const now = Number.isFinite(input.now) && input.now >= 0 ? input.now : 0;
    const modifiers = (input.shift === true ? 1 : 0) + (input.ctrl === true ? 2 : 0);
    return parsePointer(this.call(() => this.raw.pointer(point.x, point.y, aperture, now, modifiers)), point);
  }

  /**
   * The object snap `point` takes under the engine's running snap modes, or null: nothing
   * within reach, object snap off, or the running command is not asking for a point. `aperture`
   * is the reach in world units; 0 is the engine's own aperture at the current view (needs
   * `setViewport`). It changes nothing; `click` gives the same snap to the command.
   */
  snap(point: Point, aperture = 0): SnapPoint | null {
    if (!usablePoint(point) || !usableAperture(aperture)) return null;
    return parseSnap(this.call(() => this.raw.snap(point.x, point.y, aperture)));
  }

  /**
   * A pointer click at `point` given to the running command, resolved exactly as `pointer`
   * reported it there (so the point shown is the point taken: the object snap, the grid, the
   * polar or ortho ray), else the point itself; at "Select objects" it picks. Unlike typing the
   * coordinates, it carries a deferred tangent or perpendicular. Folded like `cmdline`; `echo`
   * writes the line to show for it in the output from the point the command took. With no
   * command running it does nothing.
   */
  click(point: Point, aperture = 0, prev: PromptState = emptyPrompt(), echo?: (taken: Point) => string | undefined): ClickResult {
    if (!usablePoint(point) || !usableAperture(aperture)) {
      return { state: { ...prev, error: "refused a click that is not a usable point" }, snap: null, point: null };
    }
    const raw = this.call(() => this.raw.click(point.x, point.y, aperture));
    const parsed = parseJson(raw);
    const reply = isRecord(parsed) ? parsed : {};
    const snap = parseSnapValue(reply["snap"]);
    // An engine that does not say the point it took (an older package) took the snap or the pointer.
    const refused = typeof reply["error"] === "string" && reply["point"] === null;
    const taken = refused ? null : (parseXy(reply["point"]) ?? snap?.point ?? point);
    return { state: reducePrompt(prev, raw, taken === null ? undefined : echo?.(taken)), snap, point: taken };
  }

  layers(): LayerInfo[] {
    const env = this.execute("layer", {});
    return env.ok ? parseLayers(env.result) : [];
  }

  setLayerFlag(name: string, flag: "on" | "frozen" | "locked", value: boolean): Envelope {
    return this.execute("layer.set", { name, [flag]: value });
  }

  setCurrentLayer(name: string): Envelope {
    return this.execute("layer.current", { name });
  }

  /**
   * The engine's own zoom command. The engine fits the drawing's extents to the canvas's aspect
   * and the facade mirrors the result into the canvas view, so a UI adopts it by reading
   * `viewRect()` afterwards (the shell's `syncView`).
   */
  zoomExtents(): Envelope {
    return this.execute("zoom", { mode: "extents" });
  }

  source(): string {
    const raw = this.call(() => this.raw.source());
    const parsed = parseJson(raw);
    return isRecord(parsed) && typeof parsed["text"] === "string" ? parsed["text"] : raw;
  }

  runScript(text: string): Envelope {
    const raw = this.call(() => this.raw.run_script(text));
    return parseEnvelope(raw) ?? { ok: false, error: "unreadable reply from run_script" };
  }

  openBytes(name: string, bytes: Uint8Array): Envelope {
    const raw = this.call(() => this.raw.open_bytes(name, bytes));
    return parseEnvelope(raw) ?? { ok: false, error: "unreadable reply from open_bytes" };
  }

  /** Replace what is open with the sample drawing (File ▸ Open Sample Drawing). */
  loadSample(): Envelope {
    const raw = this.call(() => this.raw.load_sample());
    return parseEnvelope(raw) ?? { ok: false, error: "unreadable reply from load_sample" };
  }

  saveBytes(): Uint8Array | null {
    try {
      const out = this.raw.save_bytes();
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    } catch {
      return null;
    }
  }

  digest(): string {
    return this.call(() => this.raw.digest());
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A world point both of whose ordinates are finite (the engine refuses any other). */
function usablePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** An aperture the engine takes: a finite world distance, 0 (its own box) or more. */
function usableAperture(aperture: number): boolean {
  return Number.isFinite(aperture) && aperture >= 0;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `?mock=1` in the page URL forces the mock facade. */
export function wantsMock(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URLSearchParams(location.search).get("mock") === "1";
  } catch {
    return false;
  }
}

/**
 * Build the app's facade: the real wasm one when it is there and loads, the mock otherwise.
 * This is the single switch point — everything downstream only sees `AppFacade`.
 */
export async function createFacade(options: { mock?: boolean } = {}): Promise<AppFacade> {
  const forced = options.mock ?? wantsMock();
  if (!forced) {
    try {
      // Dynamic on purpose: wasm-loader.ts uses Vite's `import.meta.glob`, which only exists in
      // a Vite build — a static import would drag it into `bun test`, where it is undefined.
      // This is also the seam the tests mock at (facade.test.ts injects a fake RawFacade).
      const loader = await import("./wasm-loader");
      const raw = await loader.loadWasmFacade();
      if (raw !== null) return new AppFacade(raw, { kind: "wasm", detail: "crates/wasm" });
    } catch (e) {
      return new AppFacade(new MockFacade(), { kind: "mock", detail: `wasm unavailable: ${message(e)}` });
    }
  }
  return new AppFacade(new MockFacade(), { kind: "mock", detail: forced ? "?mock=1" : "wasm module not built" });
}
