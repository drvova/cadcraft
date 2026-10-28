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
  private selected: string[] = [];
  private grid = true;
  private snap = false;
  private ortho = false;

  constructor() {
    this.reset();
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

  /** A command's one-line form, dispatched like the engine's typed input. */
  private dispatch(text: string): string {
    const trimmed = text.trim();
    const space = trimmed.search(/\s/);
    const head = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
    const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
    const args = rest.length > 0 ? rest.split(/\s+/) : [];
    switch (head) {
      case "":
        return this.replyWith([]);
      case "circle":
        if (args.length === 0) {
          this.pending = { id: "circle", step: 0 };
          return this.replyWith([]);
        }
        return this.circleFrom(args);
      case "line":
        if (args.length === 0) {
          this.pending = { id: "line", step: 0 };
          return this.replyWith([]);
        }
        return this.lineFrom(args);
      case "rectang":
      case "rectangle":
        if (args.length === 0) {
          this.pending = { id: "rectang", step: 0 };
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
        const on = typeof params["on"] === "boolean" ? params["on"] : !this[key];
        this[key] = on;
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
      case "circle":
        return envelope(false, { error: "circle: use the command line (`cmdline`) or centre/radius params in the mock" });
      default:
        return envelope(false, { error: `unknown command \`${command}\`` });
    }
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
      this.pending = { id: promptId, step: 0 };
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
      const on = !this[key];
      this[key] = on;
      return this.replyWith([`Command: ${name.toUpperCase()}`, `<${name} ${on ? "on" : "off"}>`]);
    }
    return this.replyWith([], `Unknown command "${id}". Press F1 for a list of commands.`);
  }

  selection(): string {
    return JSON.stringify({ count: this.selected.length, handles: [...this.selected] });
  }

  settings(): string {
    return JSON.stringify({
      grid: this.grid,
      snap: this.snap,
      ortho: this.ortho,
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

  display(): string {
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
    return JSON.stringify({ revision: this.revision, bounds: [b.x0, b.y0, b.x1, b.y1], verts, prims });
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

  open_bytes(name: string, bytes: Uint8Array): string {
    if (bytes.length > 8 * 1024 * 1024) return envelope(false, { error: "open_bytes: the file is too large for the mock" });
    this.reset();
    this.title = name;
    this.touch();
    return envelope(true, { entities: this.entities.length });
  }

  load_sample(): string {
    this.reset();
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
