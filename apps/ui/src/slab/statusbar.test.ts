import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_FLOOR, STATUS_TOGGLES } from "../components/StatusBar";
import type { SettingsState } from "../facade";
import { MAX_PARAM_TEXT } from "./bench-params";
import { attachHints } from "./chrome-hints";
import { runMeasure, type TextMeasure } from "./measure";
import { bandEnd, idOfKey, isSlabControlHost, itemOfKey, keysWithRole, nodeAt, ringForKeysOnly, sceneNode, signalPoint, type SlabControlHost } from "./scene";
import { layerClipped, pressedToggle, STATUS_METRICS, statusFold, statusMetrics, statusParams, toggleLines, toggleParams, type StatusInput, type StatusWidths } from "./statusbar-params";
import { mapTokens } from "./tokens";
import { HINT_ATTR, HINT_KEYS_ATTR, HINT_PLACEMENT_ATTR } from "../ui/Tooltip";

const ui = join(import.meta.dir, "..", "..");
const source = readFileSync(join(ui, "slab", "statusbar.slab"), "utf8");

const settings: SettingsState = { grid: true, snap: false, ortho: false, polar: true, isodraft: false, otrack: true, osnap: true, dynmode: true, lwdisplay: false, transparency: true, qpmode: false, osmode: 0, pickbox: 3 };

/** Every character 6 px wide, in every style: widths that can be counted by hand. */
const six: TextMeasure = (_style, text, tracking = 0) => [...text].length * (6 + tracking);

const input = (over: Partial<StatusInput> = {}): StatusInput => ({ mode: "wasm", currentLayer: "Metal", entityCount: 55, layerCount: 8, selectionCount: 0, coordChars: 30, ...over });

/** A toggle's key in the scene the driver reports for this document (read from a running bar). */
const SNAP = "#bar/#line/#toggles/each@0~line-0-of-11/row@0/each@0~snap/row@0/row@0";

describe("the status bar's toggles", () => {
  test("one per drafting toggle, keyed by the command it runs, the face in capitals", () => {
    const toggles = toggleParams(STATUS_TOGGLES, settings);
    expect(toggles.map((t) => t.key)).toEqual(STATUS_TOGGLES.map((t) => t.id));
    expect(toggles[1]).toEqual({ key: "snap", name: "Snap mode", face: "SNAP", shortcut: "F9", on: false, lead: true });
    expect(toggles[4]?.shortcut).toBe("");
    expect(toggles.filter((t) => t.on).map((t) => t.key)).toEqual(["grid", "polar", "otrack", "osnap", "transparencydisplay", "dynmode"]);
  });

  test("a setting that is not a boolean reads as off", () => {
    const broken: SettingsState = { ...settings };
    Reflect.set(broken, "grid", "yes");
    Reflect.set(broken, "snap", 1);
    const toggles = toggleParams(STATUS_TOGGLES, broken);
    expect(toggles[0]?.on).toBe(false);
    expect(toggles[1]?.on).toBe(false);
  });

  test("a pressed toggle is read back to its command; a stale or forged key runs nothing", () => {
    expect(pressedToggle(STATUS_TOGGLES, "transparencydisplay")?.key).toBe("transparency");
    expect(pressedToggle(STATUS_TOGGLES, itemOfKey(SNAP))?.id).toBe("snap");
    for (const key of ["", "GRID", "grid ", "transparency", "__proto__", "constructor", "line-0", "9".repeat(4000)]) expect(pressedToggle(STATUS_TOGGLES, key)).toBeNull();
  });
});

describe("the toggles' lines", () => {
  const toggles = toggleParams(STATUS_TOGGLES, settings);
  const widths = toggles.map(() => 30);

  test("one line while the room is unknown or enough; a line's first toggle keeps no gap", () => {
    for (const room of [Infinity, 0, -5, NaN, 11 * 30 + 10 * 4]) {
      const lines = toggleLines(toggles, widths, room, 4);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.toggles.map((t) => t.lead)).toEqual([false, ...Array<boolean>(10).fill(true)]);
    }
  });

  test("a shorter room breaks the run in order, each line as full as it can be", () => {
    const lines = toggleLines(toggles, widths, 5 * 30 + 4 * 4, 4);
    expect(lines.map((l) => l.toggles.map((t) => t.key).join(" "))).toEqual(["grid snap ortho polar isodraft", "otrack osnap lwdisplay transparencydisplay dynmode", "qpmode"]);
    expect(lines.map((l) => l.toggles[0]?.lead)).toEqual([false, false, false]);
    // One px short of five to a line: four.
    expect(toggleLines(toggles, widths, 5 * 30 + 4 * 4 - 1, 4)[0]?.toggles).toHaveLength(4);
  });

  test("a toggle wider than the room has a line to itself, and the lines are capped", () => {
    expect(toggleLines(toggles, widths, 1, 4)).toHaveLength(11);
    const many = Array.from({ length: 500 }, (_, i) => ({ ...toggles[0]!, key: `t${i}` }));
    const lines = toggleLines(many, many.map(() => 30), 1, 4);
    expect(lines.length).toBeLessThanOrEqual(64);
    expect(lines.reduce((n, l) => n + l.toggles.length, 0)).toBe(500);
  });

  test("the lines' keys say how the run is broken, so a new break makes every line anew", () => {
    const one = toggleLines(toggles, widths, Infinity, 4).map((l) => l.key);
    const two = toggleLines(toggles, widths, 7 * 34, 4).map((l) => l.key);
    const other = toggleLines(toggles, widths, 6 * 34, 4).map((l) => l.key);
    expect(one).toEqual(["line-0-of-11"]);
    expect(two).toEqual(["line-0-of-7.4", "line-1-of-7.4"]);
    expect(other).toEqual(["line-0-of-6.5", "line-1-of-6.5"]);
    expect(two.filter((key) => other.includes(key))).toEqual([]);
    // The same break: the same keys, so a toggle that flips rebuilds nothing.
    expect(toggleLines(toggleParams(STATUS_TOGGLES, { ...settings, grid: false }), widths, 7 * 34, 4).map((l) => l.key)).toEqual(two);
  });
});

describe("what a short status bar gives up", () => {
  const w: StatusWidths = { mode: 50, layer: 100, layerFloor: 36, layerAfter: 12, objects: 70, layers: 60, selection: 0, toggles: 400, coord: 200 };
  const all = w.mode + w.layer + w.layerAfter + w.objects + w.layers + w.toggles + w.coord;

  test("everything in a bar that has the room, or is not measured yet", () => {
    // A bar that holds it all to the pixel holds it all.
    for (const room of [0, -1, NaN, all, all + 1, 5000]) expect(statusFold(room, w)).toEqual({ layer_w: 100, show_mode: true, show_objects: true, show_layers: true, show_coord: true, toggleRoom: Infinity });
  });

  test("the order: the layer's name narrows, then the layer count, the object count, the engine, the position", () => {
    expect(statusFold(all - 20, w)).toMatchObject({ layer_w: 80, show_layers: true });
    expect(statusFold(all - 65, w)).toMatchObject({ layer_w: 36, show_layers: false, show_objects: true });
    expect(statusFold(all - 65 - 60, w)).toMatchObject({ show_layers: false, show_objects: false, show_mode: true });
    expect(statusFold(all - 65 - 130, w)).toMatchObject({ show_objects: false, show_mode: false, show_coord: true });
    expect(statusFold(all - 65 - 180, w)).toMatchObject({ show_mode: false, show_coord: false, toggleRoom: Infinity });
  });

  test("still short with everything gone: the toggles get what is left, never less than nothing", () => {
    const fold = statusFold(36 + 12 + 300, w);
    expect(fold.show_coord).toBe(false);
    expect(fold.toggleRoom).toBeCloseTo(300.5, 5);
    expect(statusFold(1, w).toggleRoom).toBeGreaterThanOrEqual(0);
  });
});

describe("the status bar's params", () => {
  const toggles = toggleParams(STATUS_TOGGLES, settings);

  test("the words the SolidJS bar says", () => {
    const p = statusParams(input({ selectionCount: 1284 }), toggles, 0, six);
    expect(p.scalars).toMatchObject({ mode: "wasm", live: true, layer: "Metal", objects: "55 objects", layers: "8 layers", selection: "1,284 selected", selected: true });
    expect(statusParams(input({ mode: "mock", entityCount: 1, layerCount: 1 }), toggles, 0, six).scalars).toMatchObject({ live: false, objects: "1 object", layers: "1 layer", selection: "", selected: false });
    expect(statusParams(input({ entityCount: 1284019 }), toggles, 0, six).scalars.objects).toBe("1,284,019 objects");
  });

  test("the layer's box: its name's width, never under its first letters', never over 24 characters", () => {
    expect(statusParams(input(), toggles, 0, six).scalars.layer_w).toBe(30);
    expect(statusParams(input({ currentLayer: "A-WALL-FULL-HEIGHT-PHASE-1-EXISTING" }), toggles, 0, six).scalars.layer_w).toBe(24 * 6);
    const narrow = statusParams(input({ currentLayer: "A-WALL-FULL-HEIGHT-PHASE-1-EXISTING" }), toggles, 500, six);
    expect(narrow.scalars.layer_w).toBe(LAYER_FLOOR * 6);
    expect(layerClipped("A-WALL-FULL-HEIGHT-PHASE-1-EXISTING", narrow.scalars.layer_w, six)).toBe(true);
    expect(layerClipped("Metal", 30, six)).toBe(false);
  });

  test("the position's box is reserved in characters of the mono face, and capped", () => {
    expect(statusParams(input({ coordChars: 30 }), toggles, 0, six).scalars.coord_w).toBe(7 + 180);
    expect(statusParams(input({ coordChars: 1e9 }), toggles, 0, six).scalars.coord_w).toBe(7 + 256 * 6);
    expect(statusParams(input({ coordChars: -4 }), toggles, 0, six).scalars.coord_w).toBe(7);
  });

  test("a wide bar shows it all on one line; a phone's keeps the layer and wraps the toggles", () => {
    const wide = statusParams(input(), toggles, 1280, six);
    expect(wide.scalars).toMatchObject({ show_mode: true, show_objects: true, show_layers: true, show_coord: true });
    expect(wide.lines).toHaveLength(1);
    const phone = statusParams(input(), toggles, 390, six);
    expect(phone.scalars).toMatchObject({ show_mode: false, show_objects: false, show_layers: false, show_coord: false, layer: "Metal" });
    expect(phone.lines.length).toBeGreaterThan(1);
    expect(phone.lines.flatMap((l) => l.toggles.map((t) => t.key))).toEqual(STATUS_TOGGLES.map((t) => t.id));
  });

  test("hostile input never throws, and never reaches the kernel as more than a line", () => {
    for (const n of [NaN, Infinity, -Infinity, -1, 1e308, 0.5]) {
      const p = statusParams(input({ entityCount: n, layerCount: n, selectionCount: n, coordChars: n }), toggles, n, six);
      expect(Number.isFinite(p.scalars.coord_w)).toBe(true);
      expect(Number.isFinite(p.scalars.layer_w)).toBe(true);
      expect(p.scalars.objects).toMatch(/^[\d,]+ objects?$/);
    }
    const p = statusParams(input({ currentLayer: `a\u0000b\n${"x".repeat(5000)}` }), toggles, 800, () => NaN);
    expect(p.scalars.layer.length).toBeLessThanOrEqual(MAX_PARAM_TEXT);
    expect(p.scalars.layer).not.toMatch(/[\u0000-\u001f]/);
    expect(Number.isFinite(p.scalars.layer_w)).toBe(true);
    expect(Number.isFinite(p.scalars.coord_w)).toBe(true);
    expect(p.lines.flatMap((l) => l.toggles)).toHaveLength(STATUS_TOGGLES.length);
  });

  test("the measures come from the document's tokens; a token that is missing or absurd keeps its default", () => {
    expect(statusMetrics(() => undefined)).toEqual(STATUS_METRICS);
    expect(statusMetrics((path) => (path === "space.g8" ? 10 : path === "status.track" ? "wide" : path === "space.g4" ? 9000 : -1))).toEqual({ ...STATUS_METRICS, pad: 10, coordPad: 10 });
  });

  test("under a finger a toggle has more room around its word and is never narrower than the target", () => {
    const coarse = statusMetrics(() => undefined, true);
    expect(coarse).toEqual({ ...STATUS_METRICS, togglePad: 8, toggleMin: 24 });
    const fine = statusParams(input(), toggles, 390, six);
    const touch = statusParams(input(), toggles, 390, six, coarse);
    expect(touch.lines[0]?.toggles.length).toBeLessThan(fine.lines[0]?.toggles.length ?? 0);
    // "LW" and "QP" are two letters: 12 px of word and 16 of room is the target's 24 and more; a one-letter face would be held to 24.
    expect(toggleLines(toggleParams(STATUS_TOGGLES, settings), STATUS_TOGGLES.map(() => 24), 24 * 3 + 8, 4)[0]?.toggles).toHaveLength(3);
    expect(source).toContain("when coarse { h=status.chip-touch pad=0,space.g8 min-w=size.control-h-input pack=center }");
  });
});

describe("the measure", () => {
  test("a run is the sum of its characters' advances, kept to 1/1024 px, plus the tracking after each", () => {
    let asked = 0;
    const measure = runMeasure((_style, char) => {
      asked += 1;
      return char === "i" ? 2.00049 : 7;
    });
    expect(measure("label", "wii")).toBeCloseTo(7 + 2 * (2049 / 1024), 9);
    expect(measure("label", "ww", 0.5)).toBe(15);
    // Each character is asked for once per style.
    expect(asked).toBe(2);
    expect(measure("mono", "w")).toBe(7);
    expect(asked).toBe(3);
  });

  test("an advance that is no length counts as none, and a run is capped", () => {
    const measure = runMeasure((_style, char) => (char === "a" ? NaN : char === "b" ? -3 : char === "c" ? Infinity : 1));
    expect(measure("label", "abc")).toBe(0);
    expect(measure("label", "x".repeat(100000))).toBe(512);
  });
});

describe("reading a surface's scene", () => {
  test("the list item and the authored id a key is in", () => {
    expect(itemOfKey(SNAP)).toBe("snap");
    expect(itemOfKey("#views/#strip/each@0~view-12/row@0")).toBe("view-12");
    expect(itemOfKey("#bar/#line/#layer")).toBe("");
    expect(itemOfKey(`a~${"x".repeat(600)}`)).toBe("");
    expect(idOfKey("#bar/#line/#layer/text@0")).toBe("layer");
    expect(idOfKey("#bar/#line/#coord")).toBe("coord");
    expect(idOfKey("row@0/text@1")).toBe("");
    expect(idOfKey("#".repeat(600))).toBe("");
  });

  test("a signal's point is taken only when it is one", () => {
    expect(signalPoint(new CustomEvent("x", { detail: { meta: { x: 12, y: 3.5 } } }))).toEqual({ x: 12, y: 3.5 });
    for (const detail of [null, 4, {}, { meta: null }, { meta: { x: 1 } }, { meta: { x: "1", y: 2 } }, { meta: { x: NaN, y: 2 } }, { meta: { x: -1, y: 2 } }, { meta: { x: Infinity, y: 0 } }]) expect(signalPoint(new CustomEvent("x", { detail }))).toBeNull();
    expect(signalPoint(new Event("x"))).toBeNull();
  });
});

/** A stand-in for the driver's element: a scene, a focus, and the calls a host makes, recorded. */
function fakeHost(scene: { key: string; x: number; y: number; w: number; h: number; role?: string }[]): { host: SlabControlHost; calls: string[]; focus: (key: string | null) => void } {
  const el = document.createElement("div");
  const calls: string[] = [];
  let focused: string | null = null;
  Object.assign(el, {
    setParam: () => undefined,
    setList: () => undefined,
    setTheme: () => undefined,
    setSplit: () => true,
    getSplit: () => -1,
    getToken: () => undefined,
    clearFocus: () => true,
    registerFontMetrics: () => undefined,
    sceneSnapshot: () => scene,
    focusedKey: () => focused,
    setFocus: (key: string, visible?: boolean) => {
      calls.push(`focus ${key} ${String(visible)}`);
      focused = key;
      return true;
    },
    getScroll: () => 0,
    setScroll: () => true,
    reveal: () => true,
  });
  document.body.appendChild(el);
  if (!isSlabControlHost(el)) throw new Error("the stand-in is not a control host");
  return {
    host: el,
    calls,
    focus: (key) => {
      focused = key;
    },
  };
}

describe("a surface's controls", () => {
  const scene = [
    { key: "#bar", x: 0, y: 0, w: 400, h: 22 },
    { key: "#bar/#line/#layer", x: 8, y: 1, w: 40, h: 21 },
    { key: "a~grid/row@0/row@0", x: 100, y: 1, w: 30, h: 21, role: "switch" },
    { key: "a~snap/row@0/row@0", x: 134, y: 1, w: 30, h: 21, role: "switch" },
    { key: "a~qpmode/row@0/row@0", x: 168, y: 1, w: 20, h: 21, role: "switch" },
  ];

  test("an element without the driver's calls is not a control host", () => {
    expect(isSlabControlHost(document.createElement("div"))).toBe(false);
  });

  test("the node with a key, the node under a point, the controls of a role", () => {
    const { host } = fakeHost(scene);
    expect(sceneNode(host, "#bar/#line/#layer")?.w).toBe(40);
    expect(sceneNode(host, "nothing")).toBeUndefined();
    expect(nodeAt(host, 140, 10, (key) => itemOfKey(key) !== "")?.key).toBe("a~snap/row@0/row@0");
    expect(nodeAt(host, 131, 10, (key) => itemOfKey(key) !== "")).toBeUndefined();
    expect(nodeAt(host, NaN, 10, () => true)).toBeUndefined();
    expect(keysWithRole(host, "switch")).toHaveLength(3);
    host.remove();
  });

  test("Home and End name the first and the last control; any other key, or a modifier, none", () => {
    const { host } = fakeHost(scene);
    expect(bandEnd(host, "switch", new KeyboardEvent("keydown", { key: "Home" }))).toBe("a~grid/row@0/row@0");
    expect(bandEnd(host, "switch", new KeyboardEvent("keydown", { key: "End" }))).toBe("a~qpmode/row@0/row@0");
    expect(bandEnd(host, "switch", new KeyboardEvent("keydown", { key: "End", ctrlKey: true }))).toBeNull();
    expect(bandEnd(host, "switch", new KeyboardEvent("keydown", { key: "ArrowRight" }))).toBeNull();
    expect(bandEnd(host, "tab", new KeyboardEvent("keydown", { key: "Home" }))).toBeNull();
    host.remove();
  });

  test("the ring is the keyboard's: a press, and the focus leaving, set the focus again without it", () => {
    const { host, calls, focus } = fakeHost(scene);
    const undo = ringForKeysOnly(host);
    host.dispatchEvent(new Event("pointerup"));
    expect(calls).toEqual([]);
    focus("a~snap/row@0/row@0");
    host.dispatchEvent(new Event("pointerup"));
    host.dispatchEvent(new FocusEvent("focusout"));
    expect(calls).toEqual(["focus a~snap/row@0/row@0 false", "focus a~snap/row@0/row@0 false"]);
    undo();
    host.dispatchEvent(new Event("pointerup"));
    expect(calls).toHaveLength(2);
    host.remove();
  });

  test("a hint stands an element over the control, carrying the hint, and tells the tooltip", () => {
    const { host, focus } = fakeHost(scene);
    const frame = document.createElement("div");
    document.body.appendChild(frame);
    const seen: string[] = [];
    frame.addEventListener("pointerover", (event) => seen.push(event.target instanceof Element ? (event.target.getAttribute(HINT_ATTR) ?? "") : ""));
    frame.addEventListener("focusin", (event) => seen.push(`focus:${event.target instanceof Element ? (event.target.getAttribute(HINT_ATTR) ?? "") : ""}`));
    const hints = attachHints(host, frame, (key) => (itemOfKey(key) === "snap" ? { text: "Snap mode", keys: "F9", shows: "SNAP", placement: "top" } : null));
    hints.over("a~snap/row@0/row@0");
    const anchor = frame.querySelector(".slab-hint-anchor");
    expect(anchor?.getAttribute(HINT_ATTR)).toBe("Snap mode");
    expect(anchor?.getAttribute(HINT_KEYS_ATTR)).toBe("F9");
    expect(anchor?.getAttribute(HINT_PLACEMENT_ATTR)).toBe("top");
    expect(anchor?.getAttribute("aria-hidden")).toBe("true");
    expect(anchor?.textContent).toBe("SNAP");
    expect(seen).toEqual(["Snap mode"]);
    // The same control again says nothing; a node with no hint leaves no stand-in behind.
    hints.over("a~snap/row@0/row@0");
    hints.over("#bar/#line/#layer");
    hints.over("no such node");
    expect(seen).toEqual(["Snap mode"]);
    expect(frame.querySelectorAll(".slab-hint-anchor")).toHaveLength(1);
    // The keyboard's focus is read after a frame, only while the page's focus is in the surface.
    focus("a~snap/row@0/row@0");
    host.dispatchEvent(new Event("slab-frame"));
    expect(seen).toEqual(["Snap mode"]);
    hints.detach();
    expect(frame.querySelector(".slab-hint-anchor")).toBeNull();
    host.remove();
    frame.remove();
  });

  test("the stand-ins are capped however many controls ask", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ key: `a~t${i}/row@0`, x: i, y: 0, w: 1, h: 1 }));
    const { host } = fakeHost(many);
    const frame = document.createElement("div");
    document.body.appendChild(frame);
    const hints = attachHints(host, frame, () => ({ text: "x" }));
    for (const node of many) hints.over(node.key);
    expect(frame.querySelectorAll(".slab-hint-anchor").length).toBeLessThanOrEqual(64);
    hints.detach();
    host.remove();
    frame.remove();
  });
});

describe("the status bar's document", () => {
  test("takes its inks and measures from the tokens, and names no font, colour or image", () => {
    const tokens = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8"));
    const inks = new Set([...source.matchAll(/color\.([a-z0-9-]+)/g)].map((m) => m[1] ?? ""));
    expect(inks.size).toBeGreaterThan(5);
    for (const name of inks) expect(tokens.colors.has(name)).toBe(true);
    expect(source).toContain('import "gen/tokens.slab"');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(rgb|hsl)a?\(/);
    expect(source).not.toMatch(/font-family|family=|Inter|JetBrains|system-ui|url\(|\.(png|svg|woff2?|ttf)\b/);
  });

  test("declares every param the host sets, and the signals the host handles", () => {
    const p = statusParams(input(), toggleParams(STATUS_TOGGLES, settings), 1280, six);
    for (const name of [...Object.keys(p.scalars), "coord", "lines"]) expect(source).toMatch(new RegExp(`^\\s+${name} (text|bool|num|list\\(\\w+\\)) =`, "m"));
    for (const name of Object.keys(toggleParams(STATUS_TOGGLES, settings)[0] ?? {})) if (name !== "key") expect(source).toMatch(new RegExp(`def StatusToggle\\([^)]*\\b${name}=`));
    for (const signal of ["act=toggle", "context=toggle_settings", "pointer-move=hint", "pointer-move=hint_off"]) expect(source).toContain(signal);
    // Every control says what it is: `act=` alone gives no role.
    expect(source).toContain("role=switch");
    expect(source).toContain("checked=on");
    expect(source).toContain('role=toolbar label="Drafting settings"');
    expect(source).toContain("role=status live=polite");
  });

  test("the measures the host folds with are the document's own tokens", () => {
    const status = /tokens \{\s*status \{([\s\S]*?)\n {2}\}/.exec(source)?.[1] ?? "";
    expect(status).toContain(`after ${STATUS_METRICS.after}`);
    expect(status).toContain(`track ${STATUS_METRICS.track}`);
    expect(status).toContain(`dot ${STATUS_METRICS.dot}`);
    expect(status).toContain(`rule-gap ${STATUS_METRICS.ruleGap}`);
    const lengths = mapTokens(readFileSync(join(ui, "src", "tokens.css"), "utf8")).lengths;
    expect(lengths.get("space")?.get("g8")).toBe(STATUS_METRICS.pad);
    expect(lengths.get("space")?.get("g4")).toBe(STATUS_METRICS.toggleGap);
    expect(lengths.get("space")?.get("g3")).toBe(STATUS_METRICS.togglePad);
  });
});

describe("the standard shell", () => {
  test("carries no Slab code: the bars are reached only through the parts the Slab boot loads", () => {
    for (const file of ["app.tsx", join("components", "StatusBar.tsx")]) {
      const text = readFileSync(join(ui, "src", file), "utf8");
      expect(text).not.toMatch(/from "\.\.?\/slab\/(Slab|statusbar|tabs|chrome|scene|measure)/);
      expect(text).not.toContain("cadcraft-statusbar");
      expect(text).not.toContain("cadcraft-tabs");
    }
    const main = readFileSync(join(ui, "src", "main.tsx"), "utf8");
    expect(main).toContain('await import("./slab/SlabStatusBar")');
    expect(main).toContain('await import("./slab/SlabTabs")');
    expect(main).not.toMatch(/^import .*Slab(StatusBar|Tabs)/m);
  });
});
