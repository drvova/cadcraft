/**
 * The mock facade: a small, deterministic stand-in for `crates/wasm`'s `Facade`, used while the
 * real crate is in flight (or with `?mock=1`). It implements the same JSON contract
 * (.design-system/boss/briefs/s-facade.1.md) and carries a canned drawing that exercises every
 * primitive kind the canvas draws: polylines, triangles, points and an image quad.
 *
 * The command-line side models the engine's two-step prompts (`circle` asks for a centre, then
 * a radius) so the prompt handling in the UI is developed against a real prompt cycle.
 */

import type { RawFacade } from "./facade";
import type { Rect } from "./view";

type Rgb = readonly [number, number, number];

interface MockLayer {
  name: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  used: boolean;
  colorName: string;
  colorRgb: Rgb;
  linetype: string;
  lineweight: string;
  description: string;
}

type Entity =
  | { kind: "circle"; layer: string; color: Rgb; cx: number; cy: number; r: number }
  | { kind: "line"; layer: string; color: Rgb; x0: number; y0: number; x1: number; y1: number }
  | { kind: "rect"; layer: string; color: Rgb; x0: number; y0: number; x1: number; y1: number };

/** The mock's price book: prices per gram and per carat, a currency and one labor figure. */
interface MockBook {
  currency?: string;
  metal: Record<string, number>;
  stone: Record<string, number>;
  labor?: { mode: "flat" | "perStone" | "perGram"; amount: number };
}

/** The alloys and materials the mock prices (a small stand-in for the engine's full tables). */
const MOCK_METALS = new Set(["gold24", "gold22", "gold18", "gold14", "gold10", "gold9", "platinum", "palladium", "silver", "steel", "titanium", "brass", "copper", "wax"]);
const MOCK_STONES = new Set(["diamond", "cz", "moissanite", "sapphire", "ruby", "emerald", "morganite", "aquamarine", "amethyst", "topaz", "garnet", "opal", "default"]);
const MOCK_PRICE_MAX = 1e12;

const SEGMENTS = 64;
const DEFAULT_COLOR: Rgb = [212, 212, 212];
const AMBER: Rgb = [241, 180, 103];
const CYAN: Rgb = [136, 192, 208];
const GREEN: Rgb = [63, 162, 102];
const BLUE: Rgb = [129, 161, 193];

function envelope(ok: boolean, payload: Record<string, unknown> | readonly unknown[]): string {
  if (ok) return JSON.stringify({ ok: true, result: payload });
  const error = Array.isArray(payload) ? "error" : String((payload as Record<string, unknown>)["error"] ?? "error");
  return JSON.stringify({ ok: false, error });
}

/** A point `x,y` or `x y`; null when it does not parse. */
function parsePoint(text: string): { x: number; y: number } | null {
  const parts = text.split(/[\s,]+/).filter((s) => s.length > 0);
  if (parts.length < 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** An ordinate the engine's pointer calls take: finite and within its `MAX_COORD` (1e15). */
function usableOrdinate(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) <= 1e15;
}

function parseNumber(text: string): number | null {
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : null;
}

export class MockFacade implements RawFacade {
  private entities: Entity[] = [];
  private layers: MockLayer[] = [];
  private currentLayer = "0";
  private revision = 1;
  private dirty = false;
  private title = "sample.dxf";
  private currentView: Rect = { x0: -20, y0: -9, x1: 120, y1: 83 };
  private pending: { id: string; step: number; center?: { x: number; y: number }; first?: { x: number; y: number } } | null = null;
  /** The last command that opened a prompt: what an empty Enter starts again. */
  private lastAsked: string | null = null;
  private selected: string[] = [];
  /** The mock's parametric ring (`piece`): its parameters, or null when the drawing has none. */
  private piece: Record<string, unknown> | null = null;
  /** The mock's price book (`pricebook`): the jeweler's own prices, or null when none are set. */
  private priceBook: MockBook | null = null;
  /** The canvas size in CSS pixels (`set_viewport`); the engine's default until it is told. */
  private viewport: [number, number] = [1200, 800];
  /** The drafting toggles the status bar shows (GRID, SNAP, ORTHO). */
  private toggles = { grid: true, snap: false, ortho: false };

  constructor() {
    this.reset();
    // `?mock=1&piece=solitaire` starts the mock with a piece, so the 3D view has something to show
    // without the Piece section being worked first (band, solitaire or eternity).
    const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("piece");
    if (asked !== null) this.pieceCommand({ kind: asked });
  }

  private reset(): void {
    this.layers = [
      { name: "0", on: true, frozen: false, locked: false, plot: true, used: true, colorName: "7", colorRgb: DEFAULT_COLOR, linetype: "Continuous", lineweight: "Default", description: "The default layer" },
      { name: "Dimensions", on: true, frozen: false, locked: false, plot: true, used: true, colorName: "2", colorRgb: AMBER, linetype: "Continuous", lineweight: "0.25", description: "Dimension lines" },
      { name: "Hidden", on: true, frozen: false, locked: false, plot: true, used: true, colorName: "4", colorRgb: CYAN, linetype: "HIDDEN", lineweight: "0.18", description: "" },
      { name: "Notes", on: false, frozen: false, locked: false, plot: false, used: false, colorName: "3", colorRgb: GREEN, linetype: "Continuous", lineweight: "Default", description: "Frozen annotation" },
    ];
    this.currentLayer = "0";
    this.revision = 1;
    this.dirty = false;
    this.pending = null;
    this.lastAsked = null;
    this.piece = null;
    // The canned drawing: a 100x60 plate with a bore, a datum line, a filled arrow (tris),
    // corner points and an image frame — every primitive kind the canvas knows.
    this.entities = [
      { kind: "rect", layer: "0", color: DEFAULT_COLOR, x0: 0, y0: 0, x1: 100, y1: 60 },
      { kind: "circle", layer: "Hidden", color: CYAN, cx: 30, cy: 30, r: 14 },
      { kind: "circle", layer: "0", color: DEFAULT_COLOR, cx: 70, cy: 30, r: 8 },
      { kind: "line", layer: "Dimensions", color: AMBER, x0: 0, y0: 70, x1: 100, y1: 70 },
      { kind: "line", layer: "Dimensions", color: AMBER, x0: 0, y0: 66, x1: 0, y1: 74 },
      { kind: "line", layer: "Dimensions", color: AMBER, x0: 100, y0: 66, x1: 100, y1: 74 },
    ];
  }

  private touch(): void {
    this.revision += 1;
    this.dirty = true;
  }

  private layerOf(name: string): MockLayer | undefined {
    return this.layers.find((l) => l.name.toLowerCase() === name.toLowerCase());
  }

  private colorOf(layerName: string): Rgb {
    return this.layerOf(layerName)?.colorRgb ?? DEFAULT_COLOR;
  }

  private visible(entity: Entity): boolean {
    const l = this.layerOf(entity.layer);
    return l === undefined ? true : l.on && !l.frozen;
  }

  private promptJson(): Record<string, unknown> {
    const p = this.pending;
    if (p === null) {
      return { prompt: "", running: null, keywords: [], accept: null, buffer: "", history: [] };
    }
    if (p.id === "circle") {
      return p.step === 0
        ? { prompt: "Specify center point for circle:", running: "circle", keywords: ["2Point", "3Point", "Ttr"], accept: "point", buffer: "", history: [] }
        : { prompt: "Specify radius of circle:", running: "circle", keywords: ["Diameter"], accept: "number", buffer: "", history: [] };
    }
    if (p.id === "line") {
      return p.step === 0
        ? { prompt: "Specify first point:", running: "line", keywords: [], accept: "point", buffer: "", history: [] }
        : { prompt: "Specify next point or [Undo]:", running: "line", keywords: ["Undo", "Close"], accept: "point", buffer: "", history: [] };
    }
    return {
      prompt: p.step === 0 ? "Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:" : "Specify other corner point or [Area/Dimensions/Rotation]:",
      running: "rectang",
      keywords: p.step === 0 ? ["Chamfer", "Elevation", "Fillet", "Thickness", "Width"] : ["Area", "Dimensions", "Rotation"],
      accept: "point",
      buffer: "",
      history: [],
    };
  }

  private replyWith(output: string[], error?: string): string {
    const st = this.promptJson();
    st["output"] = output;
    if (error !== undefined) st["error"] = error;
    return JSON.stringify(st);
  }

  /** Open a command's first question and remember it for the empty Enter that repeats it. */
  private ask(id: string): void {
    this.pending = { id, step: 0 };
    this.lastAsked = id;
  }

  /** A command's one-line form, dispatched like the engine's typed input. */
  private dispatch(text: string): string {
    const trimmed = text.trim();
    const space = trimmed.search(/\s/);
    const head = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
    const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
    const args = rest.length > 0 ? rest.split(/\s+/) : [];
    switch (head) {
      case "":
        // An empty Enter repeats the last prompting command, as the engine's does.
        return this.lastAsked === null ? this.replyWith([]) : this.start(this.lastAsked);
      case "circle":
        if (args.length === 0) {
          this.ask("circle");
          return this.replyWith([]);
        }
        return this.circleFrom(args);
      case "line":
        if (args.length === 0) {
          this.ask("line");
          return this.replyWith([]);
        }
        return this.lineFrom(args);
      case "rectang":
      case "rectangle":
        if (args.length === 0) {
          this.ask("rectang");
          return this.replyWith([]);
        }
        return this.rectFrom(args);
      case "zoom": {
        const mode = (args[0] ?? "extents").toLowerCase();
        if (mode === "extents" || mode === "e" || mode === "all") {
          const b = this.bounds();
          if (b !== null) {
            const dx = (b.x1 - b.x0) * 0.05;
            const dy = (b.y1 - b.y0) * 0.05;
            this.currentView = { x0: b.x0 - dx, y0: b.y0 - dy, x1: b.x1 + dx, y1: b.y1 + dy };
          }
          return this.replyWith(["Regenerating model."]);
        }
        return this.replyWith([], `zoom: unknown mode \`${mode}\``);
      }
      case "layer": {
        const lines = this.layers.map((l) => `${l.name.padEnd(12)} ${l.on ? "on " : "off"} ${l.frozen ? "frozen" : "thawed"} ${l.locked ? "locked" : "unlocked"}`);
        return this.replyWith(lines);
      }
      case "erase":
        return this.replyWith([], "erase: nothing is selected (the mock draws, it does not select)");
      default:
        return this.replyWith([], `Unknown command "${head}". Press F1 for a list of commands.`);
    }
  }

  private circleFrom(args: string[]): string {
    const center = parsePoint(args[0] ?? "");
    const radius = args.length >= 2 ? parseNumber(args[1] ?? "") : null;
    if (center === null) return this.replyWith([], "circle: need a centre point (x,y)");
    if (radius === null) return this.replyWith([], "circle: need a radius");
    if (radius <= 0) return this.replyWith([], "circle: the radius must be positive");
    this.entities.push({ kind: "circle", layer: this.currentLayer, color: this.colorOf(this.currentLayer), cx: center.x, cy: center.y, r: radius });
    this.touch();
    return this.replyWith([]);
  }

  private lineFrom(args: string[]): string {
    const a = parsePoint(args[0] ?? "");
    const b = args.length >= 2 ? parsePoint(args[1] ?? "") : null;
    if (a === null) return this.replyWith([], "line: need a first point (x,y)");
    if (b === null) return this.replyWith([], "line: need a second point (x,y)");
    this.entities.push({ kind: "line", layer: this.currentLayer, color: this.colorOf(this.currentLayer), x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    this.touch();
    return this.replyWith([]);
  }

  private rectFrom(args: string[]): string {
    const a = parsePoint(args[0] ?? "");
    const b = args.length >= 2 ? parsePoint(args[1] ?? "") : null;
    if (a === null) return this.replyWith([], "rectang: need a first corner (x,y)");
    if (b === null) return this.replyWith([], "rectang: need the other corner (x,y)");
    this.entities.push({ kind: "rect", layer: this.currentLayer, color: this.colorOf(this.currentLayer), x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
    this.touch();
    return this.replyWith([]);
  }

  /** Feed the active prompt: each step answers with the next prompt or a refusal. */
  private feed(text: string): string {
    const p = this.pending;
    if (p === null) return this.dispatch(text);
    const value = text.trim();
    if (value.toLowerCase() === "x") {
      this.pending = null;
      return this.replyWith(["*Cancel*"]);
    }
    if (p.id === "circle") {
      if (p.step === 0) {
        const center = parsePoint(value);
        if (center === null) return this.replyWith([], "Invalid point.");
        p.center = center;
        p.step = 1;
        return this.replyWith([]);
      }
      const radius = parseNumber(value);
      if (radius === null || radius <= 0) return this.replyWith([], "Value must be positive and numeric.");
      const c = p.center ?? { x: 0, y: 0 };
      this.pending = null;
      this.entities.push({ kind: "circle", layer: this.currentLayer, color: this.colorOf(this.currentLayer), cx: c.x, cy: c.y, r: radius });
      this.touch();
      return this.replyWith([]);
    }
    if (p.id === "line") {
      if (p.step === 0) {
        const first = parsePoint(value);
        if (first === null) return this.replyWith([], "Invalid point.");
        p.first = first;
        p.step = 1;
        return this.replyWith([]);
      }
      if (value.toLowerCase() === "c" || value.toLowerCase() === "close") {
        const a = p.first ?? { x: 0, y: 0 };
        const last = this.entities.at(-1);
        if (last !== undefined && last.kind === "line") {
          this.entities.push({ kind: "line", layer: this.currentLayer, color: this.colorOf(this.currentLayer), x0: last.x1, y0: last.y1, x1: a.x, y1: a.y });
          this.touch();
        }
        this.pending = null;
        return this.replyWith([]);
      }
      const next = parsePoint(value);
      if (next === null) return this.replyWith([], "Invalid point.");
      const a = p.first ?? { x: 0, y: 0 };
      this.entities.push({ kind: "line", layer: this.currentLayer, color: this.colorOf(this.currentLayer), x0: a.x, y0: a.y, x1: next.x, y1: next.y });
      p.first = next;
      this.touch();
      return this.replyWith([]);
    }
    // rectang
    if (p.step === 0) {
      const first = parsePoint(value);
      if (first === null) return this.replyWith([], "Invalid point.");
      p.first = first;
      p.step = 1;
      return this.replyWith([]);
    }
    const other = parsePoint(value);
    if (other === null) return this.replyWith([], "Invalid point.");
    const a = p.first ?? { x: 0, y: 0 };
    this.pending = null;
    this.entities.push({ kind: "rect", layer: this.currentLayer, color: this.colorOf(this.currentLayer), x0: Math.min(a.x, other.x), y0: Math.min(a.y, other.y), x1: Math.max(a.x, other.x), y1: Math.max(a.y, other.y) });
    this.touch();
    return this.replyWith([]);
  }

  private bounds(): Rect | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const take = (x: number, y: number): void => {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    };
    for (const e of this.entities) {
      if (!this.visible(e)) continue;
      if (e.kind === "circle") {
        take(e.cx - e.r, e.cy - e.r);
        take(e.cx + e.r, e.cy + e.r);
      } else if (e.kind === "line") {
        take(e.x0, e.y0);
        take(e.x1, e.y1);
      } else {
        take(e.x0, e.y0);
        take(e.x1, e.y1);
      }
    }
    // The fixed decoration (tris, points, image frame) lives in the same world.
    take(74, 40);
    take(86, 50);
    take(12, 12);
    take(34, 34);
    return x0 <= x1 ? { x0, y0, x1, y1 } : null;
  }

  // ---- RawFacade ----

  execute(command: string, paramsJson: string): string {
    let params: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(paramsJson);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
    } catch {
      return envelope(false, { error: `execute: bad JSON parameters for \`${command}\`` });
    }
    const id = command.trim().toLowerCase();
    switch (id) {
      case "layer":
        return envelope(true, { layers: this.layers.map((l) => ({ ...l, current: l.name.toLowerCase() === this.currentLayer.toLowerCase() })), states: [] });
      case "layer.set": {
        const name = typeof params["name"] === "string" ? params["name"] : null;
        if (name === null) return envelope(false, { error: "layer.set: `name` is required" });
        const l = this.layerOf(name);
        if (l === undefined) return envelope(false, { error: `layer.set: no layer \`${name}\`` });
        if (typeof params["on"] === "boolean") l.on = params["on"];
        if (typeof params["frozen"] === "boolean") {
          if (params["frozen"] && l.name.toLowerCase() === this.currentLayer.toLowerCase()) return envelope(false, { error: "layer.set: cannot freeze the current layer" });
          l.frozen = params["frozen"];
        }
        if (typeof params["locked"] === "boolean") l.locked = params["locked"];
        if (typeof params["plot"] === "boolean") l.plot = params["plot"];
        this.touch();
        return envelope(true, { layer: l.name });
      }
      case "layer.current": {
        const name = typeof params["name"] === "string" ? params["name"] : null;
        if (name === null) return envelope(false, { error: "layer.current: `name` is required" });
        const l = this.layerOf(name);
        if (l === undefined) return envelope(false, { error: `layer.current: no layer \`${name}\`` });
        l.frozen = false;
        this.currentLayer = l.name;
        this.touch();
        return envelope(true, { layer: l.name });
      }
      case "zoom": {
        const mode = typeof params["mode"] === "string" ? params["mode"].toLowerCase() : "extents";
        if (mode !== "extents" && mode !== "e" && mode !== "all") return envelope(true, { view: this.currentView });
        const b = this.bounds();
        if (b !== null) {
          const dx = (b.x1 - b.x0) * 0.05;
          const dy = (b.y1 - b.y0) * 0.05;
          this.currentView = { x0: b.x0 - dx, y0: b.y0 - dy, x1: b.x1 + dx, y1: b.y1 + dy };
        }
        return envelope(true, { view: this.currentView });
      }
      case "select": {
        if (params["clear"] === true) {
          this.selected = [];
          return envelope(true, { selected: 0, handles: [] });
        }
        const picked: string[] = [];
        const hs = params["handles"];
        if (Array.isArray(hs)) {
          for (const h of hs) if (typeof h === "string") picked.push(h);
        } else if (Array.isArray(params["at"])) {
          const at = params["at"];
          const x = typeof at[0] === "number" ? at[0] : null;
          const y = typeof at[1] === "number" ? at[1] : null;
          if (x === null || y === null) return envelope(false, { error: "select: `at` needs two numbers" });
          const hit = this.handleAt(x, y);
          if (hit !== null) picked.push(hit);
        } else if (Array.isArray(params["window"])) {
          const w = params["window"];
          const a = Array.isArray(w[0]) ? w[0] : null;
          const b = Array.isArray(w[1]) ? w[1] : null;
          const ax = a !== null && typeof a[0] === "number" ? a[0] : null;
          const ay = a !== null && typeof a[1] === "number" ? a[1] : null;
          const bx = b !== null && typeof b[0] === "number" ? b[0] : null;
          const by = b !== null && typeof b[1] === "number" ? b[1] : null;
          if (ax === null || ay === null || bx === null || by === null) return envelope(false, { error: "select: `window` needs two corners" });
          for (const h of this.handlesInWindow(ax, ay, bx, by)) picked.push(h);
        } else {
          return envelope(false, { error: "select: need `handles`, `at`, `window` or `clear`" });
        }
        this.selected = params["add"] === true ? [...this.selected, ...picked] : picked;
        return envelope(true, { selected: this.selected.length, handles: [...this.selected] });
      }
      case "grid":
      case "snap":
      case "ortho": {
        const key = id === "grid" ? "grid" : id === "snap" ? "snap" : "ortho";
        const on = typeof params["on"] === "boolean" ? params["on"] : !this.toggles[key];
        this.toggles[key] = on;
        return envelope(true, { on, message: `<${id} ${on ? "on" : "off"}>` });
      }
      case "layout.list":
        return envelope(true, [{ name: "Layout1", tabOrder: 0, current: false, page: { widthMm: 297, heightMm: 210, landscape: true }, viewports: [] }]);
      case "layout.set": {
        const name = typeof params["name"] === "string" ? params["name"] : null;
        if (name === null) return envelope(false, { error: "layout.set: `name` is required" });
        return envelope(true, { name });
      }
      case "properties": {
        if (this.selected.length > 0) {
          const objects = this.selected.map((handle) => ({ handle, type: "Line", layer: this.currentLayer, color: "ByLayer", linetype: "ByLayer", lineweight: "ByLayer", ltscale: 1, transparency: "ByLayer", thickness: 0, visible: true }));
          return envelope(true, { count: objects.length, objects });
        }
        return envelope(true, {
          selection: "No selection",
          color: "ByLayer",
          layer: this.currentLayer,
          linetype: "ByLayer",
          linetypeScale: 1,
          lineweight: "ByLayer",
          textStyle: "Standard",
          dimStyle: "Standard",
          textHeight: 0.2,
        });
      }
      case "properties.set": {
        if (this.selected.length === 0) return envelope(false, { error: "properties.set: nothing selected" });
        return envelope(true, { changed: Object.keys(params).length });
      }
      case "piece":
        return this.pieceCommand(params);
      case "objects":
        return this.objectsCommand(params);
      case "piecemesh": {
        // The piece as a solid, for the 3D view: a mock's stand-in shape, never the engine's ring.
        // PIECEMESH takes the piece's parameters directly and changes nothing (the gallery's
        // thumbnails lean on that), so a full spec in `params` is built from; else the stored piece.
        const spec = typeof params["kind"] === "string" ? params : this.piece;
        if (spec === null) return envelope(false, { error: "piecemesh: the drawing has no piece" });
        return envelope(true, mockPieceMesh(spec, params["quality"] === "fine"));
      }
      case "stlout": {
        if (this.piece === null) return envelope(false, { error: "stlout: the drawing has no piece" });
        const solid = mockPieceMesh(this.piece, true);
        return envelope(true, mockStl(solid.meshes.filter((mesh) => params["stones"] !== false || mesh.part !== "stone"), `${String(this.piece["kind"] ?? "piece")}-mock.stl`));
      }
      case "gemlist":
        // A mock's list: enough for the Piece section's and the Gem dialog's choices.
        return envelope(true, {
          cuts: [
            { name: "round", measure: "diameter" },
            { name: "princess", measure: "diameter" },
            { name: "oval", measure: "length" },
            { name: "emerald", measure: "length" },
          ],
          stones: [
            ["diamond", 3.52],
            ["sapphire", 4.0],
            ["ruby", 4.0],
          ],
        });
      case "techsheet":
        return this.techSheet();
      case "pricebook":
        return this.priceBookCommand(params);
      case "circle":
        return envelope(false, { error: "circle: use the command line (`cmdline`) or centre/radius params in the mock" });
      default:
        return envelope(false, { error: `unknown command \`${command}\`` });
    }
  }

  /**
   * A stand-in for the engine's `piece`: it keeps the parameters, refuses what the engine refuses
   * in the engine's form of words, and answers with canned figures. Nothing is drawn and nothing
   * here is a real weight, carat or size conversion: this is a mock.
   */
  private pieceCommand(params: Record<string, unknown>): string {
    const bad = (error: string): string => envelope(false, { error: `piece: ${error}` });
    if (params["query"] === true) return envelope(true, { piece: this.piece === null ? null : this.pieceJson(this.piece) });
    if (params["remove"] === true) {
      const removed = this.piece === null ? 0 : 1;
      this.piece = null;
      if (removed > 0) this.touch();
      return envelope(true, { piece: null, removed });
    }
    const defaults: Record<string, unknown> = { system: "us", size: 6, sizeSystem: "us", wall: 1.8, width: 2.2, profile: "flat", metal: "gold18", cut: "round", stoneLength: 6.5, stoneWidth: 6.5, stone: "diamond", prongs: 6, halo: false, melee: 1.8, count: null, gap: 0.2 };
    const next: Record<string, unknown> = { ...(this.piece ?? defaults) };
    for (const key of ["kind", "wall", "width", "profile", "metal", "cut", "stoneLength", "stoneWidth", "stone", "prongs", "halo", "melee", "count", "gap"]) {
      if (key in params) next[key] = params[key];
    }
    const kind = next["kind"];
    if (typeof kind !== "string") return bad("give `kind`: band, solitaire or eternity");
    if (!["band", "solitaire", "eternity"].includes(kind)) return bad("`kind` must be band, solitaire or eternity");
    for (const [key, min, max] of [
      ["wall", 0.3, 10],
      ["width", 0.5, 30],
      ["stoneWidth", 0.5, 30],
      ["stoneLength", 0.5, 30],
      ["melee", 0.8, 6],
      ["gap", 0, 5],
    ] as const) {
      const v = next[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return bad(`\`${key}\` must be a number of millimetres from ${min} to ${max}`);
    }
    if (next["profile"] !== "flat" && next["profile"] !== "dome") return bad("`profile` must be flat or dome");
    if (!["gold24", "gold22", "gold18", "gold14", "platinum", "silver"].includes(String(next["metal"]))) return bad(`\`${String(next["metal"]).slice(0, 24)}\` is not a metal (gold24|22|18|14, platinum, silver)`);
    if (!["round", "princess", "oval", "emerald"].includes(String(next["cut"]))) return bad(`\`${String(next["cut"]).slice(0, 24)}\` is not a cut (GEMLIST lists them)`);
    if (!["diamond", "sapphire", "ruby"].includes(String(next["stone"]))) return bad(`\`${String(next["stone"]).slice(0, 24)}\` is not a stone (GEMLIST lists them)`);
    const prongs = next["prongs"];
    if (typeof prongs !== "number" || !Number.isInteger(prongs) || prongs < 3 || prongs > 8) return bad("`prongs` must be a whole number from 3 to 8");
    const halo = next["halo"];
    if (halo === true) next["halo"] = 1.3;
    else if (halo !== false && (typeof halo !== "number" || !Number.isFinite(halo) || halo < 0.8 || halo > 3)) return bad("`halo` must be true, false or a melee width from 0.8 to 3 millimetres");
    const count = next["count"];
    if (count !== null && (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 400)) return bad("`count` must be a whole number from 1 to 400");
    if ("size" in params) {
      const system = typeof params["system"] === "string" ? params["system"].toLowerCase() : "us";
      const size = params["size"];
      if (system === "uk" ? typeof size !== "string" || !/^[a-z]/i.test(size) : typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > 80) {
        return envelope(false, { error: `piece: ${typeof size === "string" ? `\`${size.slice(0, 8)}\`` : String(size)} is not a ${system.toUpperCase()} ring size` });
      }
      next["sizeSystem"] = system;
      // The mock converts nothing: a US size is kept as given, any other system's stays US 6.
      next["size"] = system === "us" ? size : 6;
      next["mockSize"] = system === "us" ? null : [system, size];
    }
    this.piece = next;
    this.touch();
    return envelope(true, { piece: this.pieceJson(next), message: `piece: a ${kind} (mock)` });
  }

  /** The mock piece as the engine's reply shapes it; every figure is canned. */
  private pieceJson(p: Record<string, unknown>): Record<string, unknown> {
    const { mockSize, ...params } = p;
    const us = typeof p["size"] === "number" ? p["size"] : 6;
    const half = Math.abs(us - Math.floor(us) - 0.5) < 0.01;
    const size: Record<string, unknown> = { mm: 16.51, diameter: 16.51, circumference: 51.87, us, usText: `${Math.floor(us)}${half ? "½" : ""}`, uk: "L½", eu: 52, jp: 12, cn: 12 };
    if (Array.isArray(mockSize) && typeof mockSize[0] === "string") size[mockSize[0]] = mockSize[1];
    const wall = typeof p["wall"] === "number" ? p["wall"] : 1.8;
    const kind = p["kind"];
    const stones = kind === "band" ? { count: 0, carat: 0 } : kind === "solitaire" ? { count: p["halo"] === false ? 1 : 19, carat: p["halo"] === false ? 1.03 : 1.21 } : { count: typeof p["count"] === "number" ? p["count"] : 26, carat: 0.62 };
    const checks: Record<string, unknown>[] = [
      wall < 0.8 ? { id: "wall", ok: false, message: `The wall is ${wall} mm: under 0.8 mm a casting fails` } : { id: "wall", ok: true, message: "The wall is thick enough to cast" },
    ];
    if (kind === "eternity") checks.push({ id: "fit", ok: true, message: "The stones fit around the band" });
    if (kind === "solitaire") checks.push({ id: "head", ok: true, message: "The head clears the finger" });
    return {
      params: { ...params, sizeText: size["usText"] },
      handles: ["A1", "A2"],
      size,
      metal: { name: p["metal"], density: 15.5, grams: 3.42 },
      stones,
      checks,
      at: [0, 0],
    };
  }

  /**
   * The mock's bench sheet: a canned piece of diamonds in a gold band, plus the estimated `cost`
   * when a price book is set. Nothing here is a real weight or carat; it is enough to exercise the
   * Bench section and the Price Book editor at `?mock=1`.
   */
  private techSheet(): string {
    const metal = typeof this.piece?.["metal"] === "string" ? this.piece["metal"] : "gold18";
    const groups = [
      { cut: "round", width: 6.5, length: 6.5, depth: 4, sg: 3.52, count: 1, caratEach: 1.031, carat: 1.031, depthFrom: "name", calibrated: false, handles: [] as string[] },
      { cut: "round", width: 1.3, length: 1.3, depth: 0.8, sg: 3.52, count: 18, caratEach: 0.008, carat: 0.149, depthFrom: "default", calibrated: true, handles: [] as string[] },
    ];
    const bands = [{ block: "RING-16.51x2.4", size: "US 6", mm: 16.51, metal, grams: 3.86, width: 2.4, wall: 1.8, handle: "A1" }];
    const reply: Record<string, unknown> = {
      stones: { groups, count: 19, carat: 1.18 },
      bands,
      warnings: [],
      metal: null,
      table: null,
      message: `19 stones, 1.18 ct total; band US 6 — ${metal}, 3.86 g`,
    };
    const cost = this.priceBook === null ? null : this.mockCost(this.priceBook, groups, bands);
    if (cost !== null) reply["cost"] = cost;
    return envelope(true, reply);
  }

  /** The cost the mock totals from a book, mirroring the engine's shape. */
  private mockCost(book: MockBook, groups: { cut: string; width: number; sg: number; count: number; carat: number }[], bands: { size: string; metal: string; grams: number }[]): Record<string, unknown> {
    const currency = book.currency ?? "USD";
    const digits = ["JPY", "KRW", "VND", "CLP"].includes(currency) ? 0 : 2;
    const scale = 10 ** digits;
    const round = (x: number): number => Math.round(x * scale) / scale;
    const lines: Record<string, unknown>[] = [];
    let metalTotal = 0;
    let stoneTotal = 0;
    let unpriced = 0;
    let grams = 0;
    let stoneCount = 0;
    for (const b of bands) {
      grams += b.grams;
      const rate = book.metal[b.metal];
      if (rate !== undefined) {
        const amount = round(b.grams * rate);
        metalTotal += amount;
        lines.push({ what: `${b.metal} band (${b.size})`, metal: b.metal, qty: b.grams, unit: "g", rate, amount });
      } else {
        unpriced++;
        lines.push({ what: `${b.metal} band (${b.size})`, metal: b.metal, qty: b.grams, unit: "g", note: `no metal price for ${b.metal}` });
      }
    }
    for (const g of groups) {
      stoneCount += g.count;
      const material = Math.abs(g.sg - 3.52) < 1e-6 ? "diamond" : null;
      const rate = (material !== null ? book.stone[material] : undefined) ?? book.stone["default"];
      const what = `${material ?? "stone"} ${g.cut} ${g.width} mm`;
      if (rate !== undefined) {
        const amount = round(g.carat * rate);
        stoneTotal += amount;
        lines.push({ what, material, qty: g.count, carat: g.carat, unit: "ct", rate, amount });
      } else {
        unpriced++;
        lines.push({ what, material, qty: g.count, carat: g.carat, unit: "ct", note: material === null ? "no stone price (material unspecified)" : `no stone price for ${material}` });
      }
    }
    let labor: number | undefined;
    if (book.labor !== undefined) {
      const { mode, amount } = book.labor;
      const figure = mode === "perStone" ? amount * stoneCount : mode === "perGram" ? amount * grams : amount;
      labor = round(figure);
      lines.push({ what: `labor (${mode})`, qty: mode === "perStone" ? stoneCount : mode === "perGram" ? grams : 1, unit: mode === "perStone" ? "pc" : mode === "perGram" ? "g" : "flat", rate: amount, amount: labor });
    }
    const total = round(metalTotal + stoneTotal + (labor ?? 0));
    const cost: Record<string, unknown> = { currency, metal: round(metalTotal), stones: round(stoneTotal), total, lines, unpriced, note: "Estimate from the prices you set, not a market quote." };
    if (labor !== undefined) cost["labor"] = labor;
    return cost;
  }

  /** The `pricebook` command: set merges, clear empties, a read returns the stored book. */
  private priceBookCommand(params: Record<string, unknown>): string {
    const bad = (error: string): string => envelope(false, { error: `pricebook: ${error}` });
    const flag = (key: string): boolean | string => {
      const v = params[key];
      if (v === undefined || v === null) return false;
      return typeof v === "boolean" ? v : `\`${key}\` must be true or false`;
    };
    const clear = flag("clear");
    const query = flag("query");
    if (typeof clear === "string") return bad(clear);
    if (typeof query === "string") return bad(query);
    const set = params["set"];
    if (clear && set !== undefined && set !== null) return bad("give `set` or `clear`, not both");
    if (clear) {
      this.priceBook = null;
      this.touch();
      return envelope(true, { book: this.bookJson(), message: "Price book cleared." });
    }
    if (set !== undefined && set !== null) {
      const patch = this.normalizeSet(set);
      if (typeof patch === "string") return bad(patch);
      const base: MockBook = this.priceBook ?? { metal: {}, stone: {} };
      this.priceBook = {
        currency: patch.currency ?? base.currency,
        metal: { ...base.metal, ...patch.metal },
        stone: { ...base.stone, ...patch.stone },
        labor: patch.labor ?? base.labor,
      };
      this.touch();
      return envelope(true, { book: this.bookJson(), message: "Price book updated." });
    }
    return envelope(true, { book: this.bookJson(), message: this.priceBook === null ? "No prices set yet." : "Price book." });
  }

  /** Validate a `set` payload into a mock book, or the words for why it is refused. */
  private normalizeSet(raw: unknown): MockBook | string {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "`set` must be an object of prices";
    const obj = raw as Record<string, unknown>;
    const out: MockBook = { metal: {}, stone: {} };
    const currency = obj["currency"];
    if (currency !== undefined && currency !== null) {
      if (typeof currency !== "string" || !/^[A-Za-z0-9]{1,8}$/.test(currency.trim())) return '`currency` must be a short code such as "USD"';
      out.currency = currency.trim().toUpperCase();
    }
    const price = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MOCK_PRICE_MAX ? v : null);
    const read = (key: "metal" | "stone", known: Set<string>): string | null => {
      const map = obj[key];
      if (map === undefined || map === null) return null;
      if (typeof map !== "object" || Array.isArray(map)) return `\`${key}\` must be an object of prices`;
      for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
        const norm = name.trim().toLowerCase();
        if (!known.has(norm)) continue; // unknown key: ignored
        const p = price(value);
        if (p === null) return `\`${key}.${name}\` must be a price from 0 to a sane maximum`;
        out[key][norm] = p;
      }
      return null;
    };
    const metalError = read("metal", MOCK_METALS);
    if (metalError !== null) return metalError;
    const stoneError = read("stone", MOCK_STONES);
    if (stoneError !== null) return stoneError;
    const labor = obj["labor"];
    if (labor !== undefined && labor !== null) {
      if (typeof labor === "number") {
        const p = price(labor);
        if (p === null) return "`labor` must be a number from 0 to a sane maximum";
        out.labor = { mode: "flat", amount: p };
      } else if (typeof labor === "object" && !Array.isArray(labor)) {
        for (const mode of ["flat", "perStone", "perGram"] as const) {
          const v = (labor as Record<string, unknown>)[mode];
          if (v !== undefined && v !== null) {
            const p = price(v);
            if (p === null) return `\`labor.${mode}\` must be a number from 0 to a sane maximum`;
            out.labor = { mode, amount: p };
            break;
          }
        }
      } else {
        return "`labor` must be a number, or {flat|perStone|perGram: amount}";
      }
    }
    return out;
  }

  /** The stored book as the engine's `book` reply shapes it (always with metal and stone maps). */
  private bookJson(): Record<string, unknown> {
    const b = this.priceBook;
    if (b === null) return { metal: {}, stone: {} };
    const out: Record<string, unknown> = { metal: { ...b.metal }, stone: { ...b.stone } };
    if (b.currency !== undefined) out["currency"] = b.currency;
    if (b.labor !== undefined) out["labor"] = { mode: b.labor.mode, amount: b.labor.amount };
    return out;
  }

  /**
   * The mock's own entities as the engine's `objects` lists a space: handle (the display handle a
   * pick answers with), kind, layer and one measurement, capped at `limit` (2000; 5000 at most).
   * It changes nothing.
   */
  private objectsCommand(params: Record<string, unknown>): string {
    const asked = params["limit"];
    if (asked !== undefined && asked !== null && (typeof asked !== "number" || !Number.isInteger(asked) || asked < 0)) {
      return envelope(false, { error: "objects: `limit` must be a whole number from 0 to 5000" });
    }
    const limit = Math.min(typeof asked === "number" ? asked : 2000, 5000);
    const shown = this.entities.filter((e) => this.visible(e));
    const objects = shown.slice(0, limit).map((e, i) => {
      const row = { handle: String(i + 1), layer: e.layer };
      if (e.kind === "circle") return { ...row, kind: "circle", size: (e.r * 2).toFixed(4) };
      if (e.kind === "line") return { ...row, kind: "line", size: Math.hypot(e.x1 - e.x0, e.y1 - e.y0).toFixed(4) };
      return { ...row, kind: "lwpolyline" };
    });
    return envelope(true, { objects, total: shown.length, truncated: shown.length > objects.length, space: "Model" });
  }

  /** The display handle of the first entity containing `(x, y)` — the mock's canned pick. */
  private handleAt(x: number, y: number): string | null {
    let handle = 1;
    for (const e of this.entities) {
      if (!this.visible(e)) continue;
      const hit =
        e.kind === "rect"
          ? x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1
          : e.kind === "circle"
            ? Math.hypot(x - e.cx, y - e.cy) <= e.r
            : (() => {
                const dx = e.x1 - e.x0;
                const dy = e.y1 - e.y0;
                const len2 = dx * dx + dy * dy;
                if (len2 === 0) return false;
                const t = Math.max(0, Math.min(1, ((x - e.x0) * dx + (y - e.y0) * dy) / len2));
                return Math.hypot(x - (e.x0 + t * dx), y - (e.y0 + t * dy)) <= 0.5;
              })();
      if (hit) return String(handle);
      handle += 1;
    }
    return null;
  }

  /** Every entity fully inside the window, the mock's canned window selection. */
  private handlesInWindow(ax: number, ay: number, bx: number, by: number): string[] {
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by);
    const y1 = Math.max(ay, by);
    const out: string[] = [];
    let handle = 1;
    for (const e of this.entities) {
      if (!this.visible(e)) continue;
      if (e.kind === "rect") {
        if (e.x0 >= x0 && e.x1 <= x1 && e.y0 >= y0 && e.y1 <= y1) out.push(String(handle));
      } else if (e.kind === "circle") {
        if (e.cx - e.r >= x0 && e.cx + e.r <= x1 && e.cy - e.r >= y0 && e.cy + e.r <= y1) out.push(String(handle));
      } else if (e.x0 >= x0 && e.x0 <= x1 && e.y0 >= y0 && e.y0 <= y1 && e.x1 >= x0 && e.x1 <= x1 && e.y1 >= y0 && e.y1 <= y1) {
        out.push(String(handle));
      }
      handle += 1;
    }
    return out;
  }

  cmdline(text: string): string {
    return this.feed(text);
  }

  /**
   * Escape, as the engine's session cancels: the running command ends with `*Cancel*`; with
   * none running the selection is cleared and nothing is said.
   */
  cancel(): string {
    if (this.pending === null) {
      this.selected = [];
      return this.replyWith([]);
    }
    this.pending = null;
    return this.replyWith(["*Cancel*"]);
  }

  /**
   * Start a command by id, as a menu click does: `circle`/`line`/`rectang` open their two-step
   * prompt, a simple command echoes `Command: X` and answers with its own output, an unknown id
   * is refused. The reply carries the same delta fields `cmdline` does (running, prompt,
   * keywords, accept, output, error).
   */
  start(id: string): string {
    const name = id.trim().toLowerCase();
    if (name === "") return this.replyWith([], 'Unknown command "". Press F1 for a list of commands.');
    if (name === "circle" || name === "line" || name === "rectang" || name === "rectangle") {
      const promptId = name === "rectangle" ? "rectang" : name;
      this.ask(promptId);
      return this.replyWith([`Command: ${promptId.toUpperCase()}`]);
    }
    if (name === "zoom") {
      const b = this.bounds();
      if (b !== null) {
        const dx = (b.x1 - b.x0) * 0.05;
        const dy = (b.y1 - b.y0) * 0.05;
        this.currentView = { x0: b.x0 - dx, y0: b.y0 - dy, x1: b.x1 + dx, y1: b.y1 + dy };
      }
      return this.replyWith(["Command: ZOOM", "Regenerating model."]);
    }
    if (name === "layer") {
      const lines = this.layers.map((l) => `${l.name.padEnd(12)} ${l.on ? "on " : "off"} ${l.frozen ? "frozen" : "thawed"} ${l.locked ? "locked" : "unlocked"}`);
      return this.replyWith(["Command: LAYER", ...lines]);
    }
    if (name === "grid" || name === "snap" || name === "ortho") {
      const key = name === "grid" ? "grid" : name === "snap" ? "snap" : "ortho";
      const on = !this.toggles[key];
      this.toggles[key] = on;
      return this.replyWith([`Command: ${name.toUpperCase()}`, `<${name} ${on ? "on" : "off"}>`]);
    }
    return this.replyWith([], `Unknown command "${id}". Press F1 for a list of commands.`);
  }

  selection(): string {
    return JSON.stringify({ count: this.selected.length, handles: [...this.selected] });
  }

  settings(): string {
    return JSON.stringify({
      grid: this.toggles.grid,
      snap: this.toggles.snap,
      ortho: this.toggles.ortho,
      polar: false,
      isodraft: false,
      otrack: false,
      osnap: true,
      dynmode: true,
      lwdisplay: false,
      transparency: true,
      qpmode: false,
      osmode: 4133,
      pickbox: 3,
    });
  }

  format_point(x: number, y: number): string {
    const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(4) : "0.0000");
    return JSON.stringify({ text: `${f(x)}, ${f(y)}, 0.0000` });
  }

  prompt(): string {
    return JSON.stringify(this.promptJson());
  }

  state(): string {
    const b = this.bounds();
    return JSON.stringify({
      title: this.title,
      dirty: this.dirty,
      revision: this.revision,
      extents: b === null ? [0, 0, 0, 0] : [b.x0, b.y0, b.x1, b.y1],
      layerCount: this.layers.length,
      entityCount: this.entities.length,
      currentLayer: this.currentLayer,
      space: "model",
    });
  }

  commands(): string {
    return JSON.stringify([
      { id: "circle", label: "Circle", menu: ["Draw", "Circle"], shortcut: "", aliases: ["c"], params: "{center, radius}", enabled: true },
      { id: "line", label: "Line", menu: ["Draw", "Line"], shortcut: "", aliases: ["l"], params: "{points: [[x,y], …]}", enabled: true },
      { id: "rectang", label: "Rectangle", menu: ["Draw", "Rectangle"], shortcut: "", aliases: ["rectangle", "rec"], params: "{corner1, corner2}", enabled: true },
      { id: "zoom", label: "Zoom", menu: ["View", "Zoom"], shortcut: "", aliases: ["z"], params: "{mode}", enabled: true },
      { id: "layer", label: "Layers", menu: ["Format", "Layers"], shortcut: "", aliases: ["la"], params: "{} → layers", enabled: true },
      { id: "layer.set", label: "Set Layer Properties", menu: [], shortcut: "", aliases: [], params: "{name, on?, frozen?, locked?}", enabled: true },
      { id: "layer.current", label: "Make Current", menu: [], shortcut: "", aliases: [], params: "{name}", enabled: true },
      { id: "piece", label: "Piece", menu: [], shortcut: "", aliases: [], params: "{kind?: band|solitaire|eternity, metal?: gold24|22|18|14|platinum|silver (default gold18), query?, remove?} → {piece}", enabled: true },
      { id: "objects", label: "Objects", menu: [], shortcut: "", aliases: [], params: "{limit?: n (default 2000, at most 5000)} → {objects: [{handle, kind, layer, size?}], total, truncated, space}", enabled: true },
      { id: "techsheet", label: "Tech Sheet", menu: ["Inquiry", "Tech Sheet"], shortcut: "", aliases: ["bom", "stonesheet"], params: "{handles?, metal?, section?, size?, system?, price?} → {stones, bands, metal, cost?, message}", enabled: true },
      { id: "pricebook", label: "Price Book", menu: ["Inquiry", "Price Book"], shortcut: "", aliases: [], params: "{set?: {currency?, metal?: {gold18|platinum|…: price per gram}, stone?: {diamond|…|default: price per carat}, labor?: number | {flat|perStone|perGram: amount}}, query?, clear?} → {book, message}", enabled: true },
    ]);
  }

  source(): string {
    return JSON.stringify({ text: this.entities.map((e) => (e.kind === "circle" ? `(circle ${e.cx},${e.cy} ${e.r})` : e.kind === "line" ? `(line ${e.x0},${e.y0} ${e.x1},${e.y1})` : `(rectang ${e.x0},${e.y0} ${e.x1},${e.y1})`)).join("\n") });
  }

  run_script(text: string): string {
    let added = 0;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t === "") continue;
      const m = /^\((circle|line|rectang)\s+(.*)\)$/.exec(t);
      if (m === null) continue;
      const args = (m[2] ?? "").split(/\s+/);
      const r = m[1] === "circle" ? this.circleFrom(args) : m[1] === "line" ? this.lineFrom(args) : this.rectFrom(args);
      if (r.includes('"error"')) return envelope(false, { error: `run_script: bad line \`${t}\`` });
      added += 1;
    }
    return envelope(true, { added });
  }

  display(margin = 0): string {
    void margin; // the mock has one drawing and no culling; the window never matters
    const verts: [number, number][] = [];
    const prims: Record<string, unknown>[] = [];
    const push = (points: readonly [number, number][], kind: string, color: Rgb, lw: number, alpha: number, handle: number, len?: number): void => {
      const start = verts.length;
      for (const p of points) verts.push(p);
      prims.push({ kind, start, len: len ?? points.length, color: [...color], lw, alpha, handle });
    };
    let handle = 1;
    for (const e of this.entities) {
      if (!this.visible(e)) continue;
      if (e.kind === "circle") {
        const pts: [number, number][] = [];
        for (let i = 0; i <= SEGMENTS; i++) {
          const a = (i / SEGMENTS) * Math.PI * 2;
          pts.push([e.cx + Math.cos(a) * e.r, e.cy + Math.sin(a) * e.r]);
        }
        push(pts, "polyline", e.color, 0.25, 255, handle++);
      } else if (e.kind === "line") {
        push([[e.x0, e.y0], [e.x1, e.y1]], "polyline", e.color, 0.18, 255, handle++);
      } else {
        push([[e.x0, e.y0], [e.x1, e.y0], [e.x1, e.y1], [e.x0, e.y1], [e.x0, e.y0]], "polyline", e.color, 0.35, 255, handle++);
      }
    }
    // The fixed decoration: a filled arrow (tris), corner points, and an image frame.
    push([[74, 40], [86, 50], [74, 50]], "tris", GREEN, 0, 255, handle++);
    push([[80, 50], [86, 40], [74, 40]], "tris", BLUE, 0, 200, handle++);
    for (const [x, y] of [[0, 0], [100, 0], [100, 60], [0, 60]] as const) {
      push([[x, y]], "point", AMBER, 0, 255, handle++);
    }
    push([[12, 12], [34, 12], [34, 34], [12, 34]], "image", BLUE, 0, 255, handle++);
    const b = this.bounds() ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    // The mock has model space only: the list says so, and carries no sheet of paper.
    return JSON.stringify({ revision: this.revision, bounds: [b.x0, b.y0, b.x1, b.y1], space: "model", sheet: null, verts, prims });
  }

  set_view(x0: number, y0: number, x1: number, y1: number): string {
    if (![x0, y0, x1, y1].every((n) => Number.isFinite(n))) return envelope(false, { error: "set_view: the view must be finite" });
    if (!(x1 - x0 > 1e-9) || !(y1 - y0 > 1e-9)) return envelope(false, { error: "set_view: the view must have a positive span" });
    this.currentView = { x0, y0, x1, y1 };
    return envelope(true, { view: this.currentView });
  }

  view(): string {
    return JSON.stringify({ min: [this.currentView.x0, this.currentView.y0], max: [this.currentView.x1, this.currentView.y1] });
  }

  /** The canvas size is kept as the engine keeps it: refused unless positive, each edge in 1..=32768. */
  set_viewport(width: number, height: number): string {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return envelope(false, { error: "the canvas size is not finite" });
    if (width <= 0 || height <= 0) return envelope(false, { error: "the canvas size must be positive" });
    const edge = (v: number): number => Math.min(32768, Math.max(1, v));
    this.viewport = [edge(width), edge(height)];
    return JSON.stringify({ ok: true, viewport: this.viewport });
  }

  /** The mock has no direct distance entry, so the cursor is only checked, as the engine checks it. */
  set_cursor(x: number, y: number): string {
    if (!usableOrdinate(x) || !usableOrdinate(y)) return envelope(false, { error: "the point is not a usable world coordinate" });
    return JSON.stringify({ ok: true });
  }

  /** The mock draws no rubber band: the empty preview, with `error` for a point it refuses. */
  preview(x: number, y: number): string {
    const empty = { verts: [], prims: [], drag: null };
    return JSON.stringify(usableOrdinate(x) && usableOrdinate(y) ? empty : { ...empty, error: "the point is not a usable world coordinate" });
  }

  /** The canned pick, as a hover reads it: the entity under the point, the selection untouched. */
  pick(x: number, y: number, aperture: number): string {
    if (!usableOrdinate(x) || !usableOrdinate(y)) return JSON.stringify({ handles: [], error: "the point is not a usable world coordinate" });
    if (!Number.isFinite(aperture) || aperture < 0) return JSON.stringify({ handles: [], error: "the aperture must be a finite world distance, 0 or more" });
    const hit = this.handleAt(x, y);
    // The mock's click selects what is under it whenever no prompt is up, so that is what lights.
    return JSON.stringify({ handles: hit === null ? [] : [hit], hover: this.pending === null ? hit : null });
  }

  /**
   * The mock has no drafting aids: the pointer is free (the point is the pointer, nothing bends
   * it, no rays, no rubber band), in the engine's own reply shape, and what the engine refuses
   * (a point, an aperture, a time or modifiers that are not usable) is refused the same way.
   */
  pointer(x: number, y: number, aperture: number, nowMs: number, modifiers: number): string {
    const free = { constraint: "none", snap: null, from: null, distance: null, angle: null, label: "", paths: { verts: [], prims: [] }, acquired: [], wait: false, preview: { verts: [], prims: [], drag: null } };
    const refuse = (error: string): string => JSON.stringify({ point: null, ...free, error });
    if (!usableOrdinate(x) || !usableOrdinate(y)) return refuse("the point is not a usable world coordinate");
    if (!Number.isFinite(aperture) || aperture < 0) return refuse("the aperture must be a finite world distance, 0 or more");
    if (!Number.isFinite(nowMs) || nowMs < 0 || nowMs > 1e15) return refuse("the time must be finite milliseconds, 0 or more");
    if (![0, 1, 2, 3].includes(modifiers)) return refuse("the modifiers must be 0 to 3: 1 for Shift, 2 for Ctrl");
    return JSON.stringify({ point: [x, y], ...free });
  }

  /** The mock has no object snap: never a hit, with `error` for input it refuses. */
  snap(x: number, y: number, aperture: number): string {
    if (!usableOrdinate(x) || !usableOrdinate(y)) return JSON.stringify({ snap: null, error: "the point is not a usable world coordinate" });
    if (!Number.isFinite(aperture) || aperture < 0) return JSON.stringify({ snap: null, error: "the aperture must be a finite world distance, 0 or more" });
    return JSON.stringify({ snap: null });
  }

  /**
   * A click given to the running prompt: the point itself (there is no snap), answered as the
   * typed point is. With no prompt up it does nothing, as the engine's does.
   */
  click(x: number, y: number, aperture: number): string {
    const refuse = (error: string): string => JSON.stringify({ ...this.promptJson(), output: [], error, snap: null, point: null });
    if (!usableOrdinate(x) || !usableOrdinate(y)) return refuse("the point is not a usable world coordinate");
    if (!Number.isFinite(aperture) || aperture < 0) return refuse("the aperture must be a finite world distance, 0 or more");
    const reply = this.pending === null ? this.replyWith([]) : this.feed(`${x},${y}`);
    const parsed: unknown = JSON.parse(reply);
    return JSON.stringify({ ...(typeof parsed === "object" && parsed !== null ? parsed : {}), snap: null, point: [x, y] });
  }

  /** The mock has no grips: a selection shows none, in the engine's own reply shape. */
  grips(): string {
    return JSON.stringify({ shown: false, size: 0, reach: 0, truncated: false, grips: [] });
  }

  /** Never a grip under the pointer, with `error` for input the engine refuses. */
  grip_at(x: number, y: number, aperture: number): string {
    if (!usableOrdinate(x) || !usableOrdinate(y)) return JSON.stringify({ grip: null, error: "the point is not a usable world coordinate" });
    if (!Number.isFinite(aperture) || aperture < 0) return JSON.stringify({ grip: null, error: "the aperture must be a finite world distance, 0 or more" });
    return JSON.stringify({ grip: null });
  }

  /** No grip to make hot: refused, the command line as it was. */
  grip_start(_idsJson: string): string {
    return JSON.stringify({ ...this.promptJson(), gripEdit: null, output: [], error: "the selection shows no grips now" });
  }

  /** No grip has a menu. */
  grip_options(_id: string): string {
    return JSON.stringify({ options: [], error: "the selection shows no grips now" });
  }

  /** No option to invoke: refused, the command line as it was. */
  grip_option(_id: string, _option: string): string {
    return JSON.stringify({ ...this.promptJson(), gripEdit: null, output: [], error: "the selection shows no grips now" });
  }

  open_bytes(name: string, bytes: Uint8Array): string {
    if (bytes.length > 8 * 1024 * 1024) return envelope(false, { error: "open_bytes: the file is too large for the mock" });
    this.reset();
    this.title = name;
    this.touch();
    return envelope(true, { entities: this.entities.length });
  }

  load_sample(name?: string): string {
    this.reset();
    this.title = name === "solitaire" ? "Solitaire" : "sample.dxf";
    this.touch();
    return envelope(true, { title: this.title, entityCount: this.entities.length });
  }

  save_bytes(): Uint8Array {
    return new TextEncoder().encode(this.source());
  }

  digest(): string {
    return `mock-${this.revision}-${this.entities.length}`;
  }
}

// ---- the mock's solid (`piecemesh`, `stlout`) ----

interface MockMesh {
  part: "metal" | "stone";
  name: string;
  color: [number, number, number];
  positions: number[];
  indices: number[];
}

/**
 * A stand-in solid for the 3D view, generated here and clearly a mock: a plain torus for the band
 * (as wide and as thick as the mock piece says) and, for a piece that has a stone, one octahedron
 * above the head. It is in the engine's frame (the finger's axis is Z, the head at +Y, millimetres,
 * triangles counter-clockwise seen from outside) and is no model of a ring: nothing here is a
 * seat, a prong or a cut.
 */
function mockPieceMesh(piece: Record<string, unknown>, fine: boolean): { meshes: MockMesh[]; bounds: { min: number[]; max: number[] }; triangles: number; notes: string[] } {
  const num = (key: string, fallback: number, lo: number, hi: number): number => {
    const v = piece[key];
    return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  };
  const wall = num("wall", 1.8, 0.3, 10);
  const width = num("width", 2.2, 0.5, 30);
  const inner = 8.25;
  const major = inner + wall / 2;
  const around = fine ? 96 : 48;
  const across = fine ? 20 : 12;
  const band: MockMesh = { part: "metal", name: "band (mock)", color: [214, 178, 92], positions: [], indices: [] };
  for (let i = 0; i < around; i += 1) {
    const u = (2 * Math.PI * i) / around;
    for (let j = 0; j < across; j += 1) {
      const v = (2 * Math.PI * j) / across;
      const r = major + (wall / 2) * Math.cos(v);
      band.positions.push(r * Math.cos(u), r * Math.sin(u), (width / 2) * Math.sin(v));
      const a = i * across + j;
      const b = ((i + 1) % around) * across + j;
      const c = ((i + 1) % around) * across + ((j + 1) % across);
      const d = i * across + ((j + 1) % across);
      band.indices.push(a, b, c, a, c, d);
    }
  }
  const meshes: MockMesh[] = [band];
  if (piece["kind"] !== "band") {
    const half = num("stoneWidth", 6.5, 0.5, 30) / 2;
    const girdle = inner + wall + half * 0.75;
    const corners = [
      [half, girdle, 0],
      [0, girdle, half],
      [-half, girdle, 0],
      [0, girdle, -half],
    ];
    const stone: MockMesh = { part: "stone", name: "stone (mock)", color: [176, 214, 244], positions: [0, girdle + half * 0.45, 0, 0, girdle - half * 0.75, 0, ...corners.flat()], indices: [] };
    for (let k = 0; k < 4; k += 1) {
      const here = 2 + k;
      const next = 2 + ((k + 1) % 4);
      stone.indices.push(0, next, here, 1, here, next);
    }
    meshes.push(stone);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const mesh of meshes) {
    triangles += mesh.indices.length / 3;
    mesh.positions.forEach((v, i) => {
      min[i % 3] = Math.min(min[i % 3] ?? v, v);
      max[i % 3] = Math.max(max[i % 3] ?? v, v);
    });
  }
  return { meshes, bounds: { min, max }, triangles, notes: ["A mock solid: a plain torus, not the engine's ring."] };
}

/** The mock solid as a binary STL in base64, shaped as the engine's `stlout` replies. */
function mockStl(meshes: readonly MockMesh[], name: string): Record<string, unknown> {
  const triangles = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  const bytes = new Uint8Array(84 + triangles * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles, true);
  let at = 84;
  for (const mesh of meshes) {
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const corner = (k: number): [number, number, number] => {
        const v = (mesh.indices[t + k] ?? 0) * 3;
        return [mesh.positions[v] ?? 0, mesh.positions[v + 1] ?? 0, mesh.positions[v + 2] ?? 0];
      };
      const [a, b, c] = [corner(0), corner(1), corner(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const length = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0) || 1;
      [...n.map((v) => v / length), ...a, ...b, ...c].forEach((v, i) => view.setFloat32(at + i * 4, v, true));
      at += 50;
    }
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { format: "stl-binary", base64: btoa(binary), bytes: bytes.length, triangles, name };
}
