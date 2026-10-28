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

import { EMPTY_DISPLAY, parseDisplayList, type DisplayList } from "./display";
import { emptyPrompt, reducePrompt, type PromptState } from "./prompt";
import { MockFacade } from "./mock";
import { asBool, asNumber, asString, isRecord } from "./json";
import { parseRect, rectIsDegenerate, type Rect } from "./view";

/** The raw wasm-bindgen handle: exactly the facade's methods, JSON strings in and out. */
export interface RawFacade {
  execute(command: string, paramsJson: string): string;
  cmdline(text: string): string;
  start(id: string): string;
  prompt(): string;
  state(): string;
  selection(): string;
  settings(): string;
  format_point(x: number, y: number): string;
  commands(): string;
  source(): string;
  run_script(text: string): string;
  display(): string;
  set_view(x0: number, y0: number, x1: number, y1: number): string;
  view(): string;
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

  displayList(): DisplayList {
    return parseDisplayList(this.call(() => this.raw.display())) ?? EMPTY_DISPLAY;
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

  /** The engine's own zoom command. Note: it does not move the facade's canvas view (`view()`),
   *  which only `setView` changes — a UI that owns the canvas should set the view itself. */
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
