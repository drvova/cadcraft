/**
 * The facade shim against the mock: envelopes, the drawing summary, layer rows, commands, and
 * the whole command-line → display-list cycle the UI depends on. These run without a DOM — the
 * mock implements the same JSON contract `crates/wasm` does, so this is the seam's unit proof.
 */

import { describe, expect, test } from "bun:test";
import {
  AppFacade,
  EMPTY_PREVIEW,
  NO_ANCHOR,
  layerColor,
  parseCommands,
  parseDrawingState,
  parseEnvelope,
  parseHexColor,
  parseLayers,
  parsePick,
  parsePreview,
  parsePromptAnchor,
  parseSnap,
} from "./facade";
import { MockFacade } from "./mock";
import { emptyPrompt, promptText } from "./prompt";

function mockFacade(): AppFacade {
  return new AppFacade(new MockFacade(), { kind: "mock", detail: "test" });
}

describe("parseEnvelope", () => {
  test("reads both arms of the engine envelope", () => {
    expect(parseEnvelope('{"ok":true,"result":{"a":1}}')).toEqual({ ok: true, result: { a: 1 } });
    expect(parseEnvelope('{"ok":false,"error":"boom"}')).toEqual({ ok: false, error: "boom" });
    expect(parseEnvelope("junk")).toBeNull();
    expect(parseEnvelope('{"result":1}')).toBeNull();
  });
});

describe("parseDrawingState", () => {
  test("reads the summary and tolerates alternate key spellings", () => {
    const state = parseDrawingState(
      JSON.stringify({ title: "plate.dxf", dirty: true, revision: 12, extents: [0, 0, 100, 60], layerCount: 4, entityCount: 7, currentLayer: "Hidden", space: "model" }),
    );
    expect(state).toEqual({ title: "plate.dxf", dirty: true, revision: 12, extents: { x0: 0, y0: 0, x1: 100, y1: 60 }, layerCount: 4, entityCount: 7, currentLayer: "Hidden", space: "model", units: "", undoDepth: null });
    const alt = parseDrawingState(JSON.stringify({ name: "x", modified: false, bounds: { min: [0, 0], max: [1, 1] }, layers: [{}, {}], entities: [{}, {}, {}], clayer: "0", activeSpace: "layout1" }));
    expect(alt?.title).toBe("x");
    expect(alt?.dirty).toBe(false);
    expect(alt?.layerCount).toBe(2);
    expect(alt?.entityCount).toBe(3);
    expect(alt?.currentLayer).toBe("0");
    expect(alt?.space).toBe("layout1");
    expect(parseDrawingState("junk")).toBeNull();
  });

  test("reads the undo depth when the facade names it", () => {
    expect(parseDrawingState(JSON.stringify({ title: "x", undoDepth: 7 }))?.undoDepth).toBe(7);
    expect(parseDrawingState(JSON.stringify({ title: "x", undoDepth: -1 }))?.undoDepth).toBeNull();
    expect(parseDrawingState(JSON.stringify({ title: "x" }))?.undoDepth).toBeNull();
  });
});

describe("layer parsing", () => {
  test("reads the engine's layer rows", () => {
    const rows = parseLayers({
      layers: [
        { name: "0", on: true, frozen: false, locked: false, plot: true, used: true, current: true, color: "7", colorRgb: "#d4d4d4", linetype: "Continuous", lineweight: "Default", description: "" },
        { name: "Hidden", on: false, frozen: true, locked: true, plot: false, used: false, current: false, color: "4", colorRgb: "#88c0d0", linetype: "HIDDEN", lineweight: "0.18" },
      ],
    });
    expect(rows.length).toBe(2);
    expect(rows[0]?.name).toBe("0");
    expect(rows[0]?.current).toBe(true);
    expect(rows[0]?.colorRgb).toEqual([212, 212, 212]);
    expect(rows[1]?.frozen).toBe(true);
    expect(rows[1]?.locked).toBe(true);
    expect(rows[1]?.colorRgb).toEqual([136, 192, 208]);
    expect(parseLayers(null)).toEqual([]);
  });

  test("layerColor falls back from hex to ACI name and index", () => {
    expect(parseHexColor("#ff0000")).toEqual([255, 0, 0]);
    expect(parseHexColor("nope")).toBeNull();
    expect(layerColor("#00ff00")).toEqual([0, 255, 0]);
    expect(layerColor("yellow")).toEqual([255, 255, 0]);
    expect(layerColor(5)).toEqual([0, 0, 255]);
    expect(layerColor("unknown-thing")).toEqual([212, 212, 212]);
  });
});

describe("parseCommands", () => {
  test("reads the command table, with the menu path joined", () => {
    const commands = parseCommands(
      JSON.stringify([{ id: "circle", label: "Circle", menu: ["Draw", "Circle"], shortcut: "C", aliases: ["c"], params: "{center, radius}", enabled: true }]),
    );
    expect(commands.length).toBe(1);
    expect(commands[0]?.id).toBe("circle");
    expect(commands[0]?.menu).toBe("Draw › Circle");
    expect(commands[0]?.aliases).toEqual(["c"]);
    expect(parseCommands("junk")).toEqual([]);
  });
});

describe("AppFacade over the mock", () => {
  test("the canned display list carries every primitive kind", () => {
    const list = mockFacade().displayList();
    const kinds = new Set(list.prims.map((p) => p.kind));
    expect(kinds.has("polyline")).toBe(true);
    expect(kinds.has("tris")).toBe(true);
    expect(kinds.has("point")).toBe(true);
    expect(kinds.has("image")).toBe(true);
    expect(list.verts.length).toBeGreaterThan(0);
  });

  test("the two-step circle: centre, then radius, then the circle is in the display list", () => {
    const facade = mockFacade();
    const before = facade.displayList();

    let state = facade.currentPrompt();
    expect(promptText(state)).toBe("Command:");

    state = facade.cmdline("circle", state);
    expect(promptText(state)).toBe("Specify center point for circle:");

    state = facade.cmdline("0,0", state);
    expect(promptText(state)).toBe("Specify radius of circle:");

    state = facade.cmdline("5", state);
    expect(promptText(state)).toBe("Command:");
    expect(state.error).toBeNull();
    // The log accumulates across the whole prompt cycle (each call folds into the last state).
    expect(state.output).toEqual(["circle", "0,0", "5"]);

    const after = facade.displayList();
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.prims.length).toBe(before.prims.length + 1);
    expect(after.bounds.x1).toBeGreaterThanOrEqual(5);
  });

  test("the one-line circle and a refused radius", () => {
    const facade = mockFacade();
    const count = facade.displayList().prims.length;
    facade.cmdline("circle 10,10 2");
    expect(facade.displayList().prims.length).toBe(count + 1);
    const state = facade.cmdline("circle 0,0 -1");
    expect(state.error).toBe("circle: the radius must be positive");
    expect(facade.displayList().prims.length).toBe(count + 1);
  });

  test("layers: list, toggle, make current, and the current layer cannot freeze", () => {
    const facade = mockFacade();
    const layers = facade.layers();
    expect(layers.map((l) => l.name)).toContain("Dimensions");
    expect(layers.find((l) => l.current)?.name).toBe("0");

    expect(facade.setLayerFlag("Notes", "on", true).ok).toBe(true);
    expect(facade.layers().find((l) => l.name === "Notes")?.on).toBe(true);

    expect(facade.setLayerFlag("0", "frozen", true).ok).toBe(false);
    expect(facade.setCurrentLayer("Hidden").ok).toBe(true);
    expect(facade.layers().find((l) => l.current)?.name).toBe("Hidden");
    expect(facade.drawingState()?.currentLayer).toBe("Hidden");
  });

  test("view: read back, refuse a degenerate rectangle, accept a real one", () => {
    const facade = mockFacade();
    const view = facade.viewRect();
    expect(view).not.toBeNull();
    expect(facade.setView({ x0: 5, y0: 5, x1: 5, y1: 5 }).ok).toBe(false);
    expect(facade.setView({ x0: NaN, y0: 0, x1: 10, y1: 10 }).ok).toBe(false);
    expect(facade.setView({ x0: -10, y0: -10, x1: 110, y1: 70 }).ok).toBe(true);
    expect(facade.viewRect()).toEqual({ x0: -10, y0: -10, x1: 110, y1: 70 });
  });

  test("zoom extents moves the view onto the drawing", () => {
    const facade = mockFacade();
    expect(facade.zoomExtents().ok).toBe(true);
    const view = facade.viewRect();
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.x0).toBeLessThanOrEqual(0);
    expect(view.x1).toBeGreaterThanOrEqual(100);
  });

  test("display is deterministic while nothing changes, and the digest follows edits", () => {
    const facade = mockFacade();
    const a = facade.displayList();
    const b = facade.displayList();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const digest = facade.digest();
    facade.cmdline("circle 0,0 5");
    expect(facade.digest()).not.toBe(digest);
  });

  test("a facade that throws is reported, not propagated", () => {
    const trap = (): string => {
      throw new Error("trap");
    };
    const facade = new AppFacade(
      {
        execute: () => {
          throw new Error("trap");
        },
        cmdline: () => "",
        start: () => "",
        cancel: () => "",
        prompt: () => "",
        state: () => "",
        selection: () => "",
        settings: () => "",
        format_point: () => "",
        commands: () => "",
        source: () => "",
        run_script: () => "",
        display: () => "",
        set_view: () => "",
        view: () => "",
        set_viewport: trap,
        set_cursor: trap,
        preview: trap,
        pick: trap,
        snap: trap,
        click: trap,
        open_bytes: () => "",
        load_sample: () => "",
        save_bytes: () => new Uint8Array(),
        digest: () => "",
      },
      { kind: "wasm", detail: "test" },
    );
    const env = facade.execute("circle", {});
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error).toContain("trap");
    expect(facade.displayList().prims).toEqual([]);
    // The pointer calls run on every frame: a trap in one is a quiet nothing, never a throw.
    const sized = facade.setViewport(800, 600);
    expect(sized.ok).toBe(false);
    if (!sized.ok) expect(sized.error).toContain("trap");
    expect(facade.setCursor({ x: 1, y: 2 }).ok).toBe(false);
    expect(facade.preview({ x: 1, y: 2 })).toBe(EMPTY_PREVIEW);
    expect(facade.pick({ x: 1, y: 2 })).toEqual([]);
    expect(facade.snap({ x: 1, y: 2 })).toBeNull();
    const clicked = facade.click({ x: 1, y: 2 });
    expect(clicked.snap).toBeNull();
    expect(clicked.state.running).toBeNull();
  });
});

describe("the pointer replies", () => {
  test("parsePreview reads the rubber band's verts and prims", () => {
    const band = parsePreview('{"drag":null,"prims":[{"alpha":255,"color":[255,255,255],"handle":0,"kind":"polyline","len":2,"lw":0.25,"start":0}],"verts":[[0,5],[4,7]]}');
    expect(band.verts).toEqual([{ x: 0, y: 5 }, { x: 4, y: 7 }]);
    expect(band.prims).toEqual([{ kind: "polyline", start: 0, len: 2, color: [255, 255, 255], lw: 0.25, alpha: 1, handle: 0 }]);
    expect(band.drag).toBeNull();
  });

  test("parsePreview reads a drag's handles and matrix", () => {
    const move = parsePreview('{"drag":{"clipboard":false,"handles":[18,26],"matrix":[1,0,0,1,3,4]},"prims":[],"verts":[]}');
    expect(move.drag).toEqual({ handles: [18, 26], matrix: [1, 0, 0, 1, 3, 4], clipboard: false });
    // A drag is a preview even with no rubber-band geometry of its own.
    expect(move).not.toBe(EMPTY_PREVIEW);
    // A matrix that is short, or holds anything but finite numbers, is no drag at all.
    expect(parsePreview('{"drag":{"handles":[18],"matrix":[1,0,0,1,3]},"prims":[],"verts":[]}')).toBe(EMPTY_PREVIEW);
    expect(parsePreview('{"drag":{"handles":[18],"matrix":[1,0,0,1,3,null]},"prims":[],"verts":[]}')).toBe(EMPTY_PREVIEW);
    expect(parsePreview('{"drag":{"handles":[18],"matrix":"1 0 0 1 3 4"},"prims":[],"verts":[]}')).toBe(EMPTY_PREVIEW);
    // Handles that are not numbers are dropped, the drag stays.
    expect(parsePreview('{"drag":{"handles":["1A",-3,7.2,null],"matrix":[1,0,0,1,0,0]},"prims":[],"verts":[]}').drag?.handles).toEqual([7]);
  });

  test("parsePreview answers the empty preview for a refusal or anything unreadable", () => {
    for (const raw of ["", "junk", "null", "[]", "42", '{"ok":false,"error":"trap"}', '{"verts":[],"prims":[],"drag":null,"error":"the point is not a usable world coordinate"}', '{"prims":[{"kind":"polyline","start":0,"len":9}],"verts":[[0,0]]}']) {
      expect(parsePreview(raw)).toBe(EMPTY_PREVIEW);
    }
  });

  test("parsePick keeps the hex handles, in order, and nothing else", () => {
    expect(parsePick('{"handles":["1A","2B"]}')).toEqual(["1A", "2B"]);
    expect(parsePick('{"handles":[1,"",null,"C",{}]}')).toEqual(["C"]);
    expect(parsePick('{"handles":[],"error":"the aperture must be a finite world distance, 0 or more"}')).toEqual([]);
    for (const raw of ["", "junk", "null", "[]", '{"handles":"1A"}', '{"ok":false,"error":"trap"}']) expect(parsePick(raw)).toEqual([]);
    // A reply longer than the engine ever sends is cut, not trusted.
    expect(parsePick(JSON.stringify({ handles: Array.from({ length: 500 }, (_, i) => i.toString(16)) })).length).toBe(64);
  });

  test("parseSnap reads the point, the mode and its name, or null", () => {
    expect(parseSnap('{"snap":{"deferred":false,"mode":1,"name":"Endpoint","point":[10,0]}}')).toEqual({ point: { x: 10, y: 0 }, mode: 1, name: "Endpoint", deferred: false });
    expect(parseSnap('{"snap":{"deferred":true,"mode":256,"name":"Tangent","point":[5,0]}}')?.deferred).toBe(true);
    // A click reply carries the same field beside the command-line state.
    expect(parseSnap('{"prompt":"LINE Specify next point:","running":"line","snap":{"mode":2,"name":"Midpoint","point":[5,0]}}')).toEqual({ point: { x: 5, y: 0 }, mode: 2, name: "Midpoint", deferred: false });
    for (const raw of ["", "junk", "null", '{"snap":null}', '{"snap":null,"error":"x"}', '{"snap":{"mode":1}}', '{"snap":{"point":[1]}}', '{"snap":{"point":["a","b"]}}', '{"snap":[1,2]}', '{"ok":false,"error":"trap"}']) {
      expect(parseSnap(raw)).toBeNull();
    }
  });

  test("parsePromptAnchor reads the base, corner and distance of a command-line reply", () => {
    expect(parsePromptAnchor('{"base":[2,3],"corner":false,"deferred":false,"distance":false,"running":"line"}')).toEqual({ base: { x: 2, y: 3 }, corner: false, distance: false, deferred: false });
    expect(parsePromptAnchor('{"base":[4,5],"corner":true,"deferred":false,"distance":false}').corner).toBe(true);
    expect(parsePromptAnchor('{"base":[1,1],"distance":true}').distance).toBe(true);
    expect(parsePromptAnchor('{"base":null,"deferred":true}')).toEqual({ base: null, corner: false, distance: false, deferred: true });
    // An older package, the mock, or junk: no anchor.
    for (const raw of ["", "junk", "null", "[]", '{"prompt":"Command:"}', '{"base":[1],"corner":"yes","distance":1}']) expect(parsePromptAnchor(raw)).toEqual(NO_ANCHOR);
  });
});

describe("the pointer calls over the mock", () => {
  test("setViewport keeps a real size and refuses a hidden or hostile one", () => {
    const facade = mockFacade();
    expect(facade.setViewport(1280, 800).ok).toBe(true);
    for (const [w, h] of [[0, 0], [0, 600], [800, -1], [NaN, 600], [800, Infinity], [-Infinity, NaN]] as const) {
      expect(facade.setViewport(w, h).ok, `${w} x ${h}`).toBe(false);
    }
    // The mock clamps as the engine does.
    expect(JSON.parse(new MockFacade().set_viewport(0.25, 1e9))).toEqual({ ok: true, viewport: [1, 32768] });
  });

  test("setCursor takes a finite point and refuses the rest", () => {
    const facade = mockFacade();
    expect(facade.setCursor({ x: 3, y: 4 }).ok).toBe(true);
    for (const p of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 1e308, y: 0 }]) expect(facade.setCursor(p).ok).toBe(false);
  });

  test("preview is empty in the mock, at rest and mid-command", () => {
    const facade = mockFacade();
    expect(facade.preview({ x: 1, y: 1 })).toBe(EMPTY_PREVIEW);
    let state = facade.start("line");
    state = facade.cmdline("0,0", state);
    expect(facade.preview({ x: 5, y: 5 })).toBe(EMPTY_PREVIEW);
    expect(facade.preview({ x: NaN, y: 5 })).toBe(EMPTY_PREVIEW);
    expect(JSON.parse(new MockFacade().preview(Infinity, 0)).error).toContain("usable");
  });

  test("pick names what is under the pointer and leaves the selection alone", () => {
    const facade = mockFacade();
    const revision = facade.drawingState()?.revision;
    // (50,5) is inside the plate (the mock's handle 1) and outside both bores.
    expect(facade.pick({ x: 50, y: 5 })).toEqual(["1"]);
    expect(facade.pick({ x: -500, y: -500 })).toEqual([]);
    expect(facade.selection()).toEqual({ count: 0, handles: [] });
    expect(facade.drawingState()?.revision).toBe(revision);
    // It is the handle a click there selects.
    facade.execute("select", { at: [50, 5] });
    expect(facade.selection().handles).toEqual(["1"]);
    facade.pick({ x: -500, y: -500 });
    expect(facade.selection().handles).toEqual(["1"]);
    // Hostile numbers: nothing, quietly.
    expect(facade.pick({ x: NaN, y: 0 })).toEqual([]);
    expect(facade.pick({ x: 50, y: 5 }, -1)).toEqual([]);
    expect(facade.pick({ x: 50, y: 5 }, Infinity)).toEqual([]);
    expect(JSON.parse(new MockFacade().pick(1e308, 0, 1)).error).toContain("usable");
    expect(JSON.parse(new MockFacade().pick(0, 0, -1)).error).toContain("aperture");
  });

  test("snap never hits in the mock", () => {
    const facade = mockFacade();
    expect(facade.snap({ x: 0, y: 0 })).toBeNull();
    expect(facade.snap({ x: 0, y: 0 }, 5)).toBeNull();
    expect(facade.snap({ x: NaN, y: 0 })).toBeNull();
    expect(facade.snap({ x: 0, y: 0 }, -1)).toBeNull();
    expect(JSON.parse(new MockFacade().snap(0, 0, NaN)).error).toContain("aperture");
  });

  test("click answers the running prompt with its point, and does nothing at rest", () => {
    const facade = mockFacade();
    const before = facade.displayList().prims.length;
    const idle = facade.click({ x: 5, y: 5 });
    expect(idle.state.running).toBeNull();
    expect(idle.state.error).toBeNull();
    expect(idle.snap).toBeNull();
    expect(facade.displayList().prims.length).toBe(before);

    let state = facade.start("line");
    let clicked = facade.click({ x: 1.5, y: -2 }, 0, state, "1.5,-2");
    state = clicked.state;
    expect(state.running).toBe("line");
    expect(promptText(state)).toBe("Specify next point or [Undo]:");
    expect(state.output.at(-1)).toBe("1.5,-2");
    clicked = facade.click({ x: 8, y: 3 }, 0, state);
    expect(clicked.state.error).toBeNull();
    expect(clicked.snap).toBeNull();
    expect(facade.displayList().prims.length).toBe(before + 1);

    // A hostile click is refused before it reaches the facade, and the prompt stays up.
    const refused = facade.click({ x: NaN, y: 0 }, 0, clicked.state);
    expect(refused.state.error).toContain("refused");
    expect(refused.state.running).toBe("line");
    expect(facade.click({ x: 0, y: 0 }, -1, clicked.state).state.error).toContain("refused");
    const raw: unknown = JSON.parse(new MockFacade().click(Infinity, 0, 0));
    expect(raw).toMatchObject({ snap: null, output: [] });
  });

  test("promptAnchor has no base in the mock (it does not say one)", () => {
    const facade = mockFacade();
    expect(facade.promptAnchor()).toEqual(NO_ANCHOR);
    facade.start("line");
    expect(facade.promptAnchor()).toEqual(NO_ANCHOR);
  });
});

describe("the extended facade contract over the mock", () => {
  test("start('circle') prompts centre then radius, and the circle lands", () => {
    const facade = mockFacade();
    const before = facade.displayList().prims.length;

    let state = facade.start("circle");
    expect(state.running).toBe("circle");
    expect(promptText(state)).toBe("Specify center point for circle:");
    expect(state.output).toContain("Command: CIRCLE");

    state = facade.cmdline("0,0", state);
    expect(promptText(state)).toBe("Specify radius of circle:");
    state = facade.cmdline("5", state);
    expect(promptText(state)).toBe("Command:");
    expect(state.error).toBeNull();

    expect(facade.displayList().prims.length).toBe(before + 1);
  });

  test("cancel ends the running command with *Cancel*, and an empty Enter repeats it", () => {
    const facade = mockFacade();
    const before = facade.displayList().prims.length;
    let state = facade.start("circle");
    state = facade.cmdline("0,0", state);
    expect(state.running).toBe("circle");

    state = facade.cancel(state);
    expect(state.running).toBeNull();
    expect(promptText(state)).toBe("Command:");
    expect(state.error).toBeNull();
    expect(state.output.at(-1)).toBe("*Cancel*");
    expect(facade.displayList().prims.length).toBe(before);

    // Enter repeats the command the user ran, from its first question.
    state = facade.cmdline("", state);
    expect(state.running).toBe("circle");
    expect(promptText(state)).toBe("Specify center point for circle:");

    // With nothing running a cancel clears the selection and adds no line.
    state = facade.cancel(state);
    facade.execute("select", { at: [0, 0] });
    expect(facade.selection().count).toBe(1);
    const lines = state.output.length;
    state = facade.cancel(state);
    expect(facade.selection().count).toBe(0);
    expect(state.output.length).toBe(lines);
  });

  test("start on an unknown id replies an error, and a simple command echoes", () => {
    const facade = mockFacade();
    const bad = facade.start("no-such-command");
    expect(bad.error).toContain("no-such-command");
    const zoom = facade.start("zoom");
    expect(zoom.error).toBeNull();
    expect(zoom.output).toContain("Command: ZOOM");
  });

  test("selection reflects a select command and a clear", () => {
    const facade = mockFacade();
    expect(facade.selection()).toEqual({ count: 0, handles: [] });
    // The plate's lower-left corner (0,0) lies inside the 100x60 rect (handle 1 in the mock).
    const env = facade.execute("select", { at: [0, 0] });
    expect(env.ok).toBe(true);
    const sel = facade.selection();
    expect(sel.count).toBe(1);
    expect(sel.handles.length).toBe(1);
    expect(facade.execute("select", { clear: true }).ok).toBe(true);
    expect(facade.selection()).toEqual({ count: 0, handles: [] });
  });

  test("settings round-trips a grid toggle", () => {
    const facade = mockFacade();
    const s = facade.settings();
    expect(typeof s.grid).toBe("boolean");
    expect(typeof s.osmode).toBe("number");
    expect(typeof s.pickbox).toBe("number");
    expect(facade.execute("grid", { on: true }).ok).toBe(true);
    expect(facade.settings().grid).toBe(true);
    expect(facade.execute("grid", { on: false }).ok).toBe(true);
    expect(facade.settings().grid).toBe(false);
  });

  test("formatPoint returns the mock's own formatting", () => {
    const facade = mockFacade();
    expect(facade.formatPoint(6, 4)).toBe("6.0000, 4.0000, 0.0000");
    expect(facade.formatPoint(NaN, Infinity)).toBe("0.0000, 0.0000, 0.0000");
  });

  test("layouts, setLayout, properties and setProperties work in mock mode", () => {
    const facade = mockFacade();
    const layouts = facade.layouts();
    expect(layouts.length).toBe(1);
    expect(layouts[0]?.name).toBe("Layout1");
    expect(layouts[0]?.current).toBe(false);
    expect(facade.setLayout("Layout1").ok).toBe(true);

    const defaults = facade.properties();
    expect(defaults).not.toBeNull();
    if (defaults !== null && "selection" in defaults) {
      expect(defaults.selection).toBe("No selection");
      expect(defaults.defaults["layer"]).toBe("0");
    }
    expect(facade.setProperties({ color: "red" }).ok).toBe(false);
    facade.execute("select", { at: [0, 0] });
    const picked = facade.properties();
    if (picked !== null && "objects" in picked) {
      expect(picked.count).toBe(1);
    }
    expect(facade.setProperties({ color: "red" }).ok).toBe(true);
  });

  test("malformed replies yield the safe defaults", () => {
    const raw = {
      execute: () => "{",
      cmdline: () => "[]",
      start: () => "not json",
      cancel: () => "not json",
      prompt: () => "null",
      state: () => "{}",
      selection: () => '{"count":"many","handles":[1,"A"]}',
      settings: () => "42",
      format_point: () => "raw-text",
      commands: () => "x",
      source: () => "",
      run_script: () => "",
      display: () => "",
      set_view: () => "",
      view: () => "",
      set_viewport: () => "",
      set_cursor: () => "[]",
      preview: () => '{"verts":"none","prims":7,"drag":{"matrix":[1]}}',
      pick: () => '{"handles":{"0":"1A"}}',
      snap: () => '{"snap":{"point":[null,2],"mode":"end"}}',
      click: () => "not json",
      open_bytes: () => "",
      load_sample: () => "",
      save_bytes: () => new Uint8Array(),
      digest: () => "",
    };
    const facade = new AppFacade(raw, { kind: "wasm", detail: "test" });
    // A non-numeric count falls back to the parsed handle list.
    expect(facade.selection()).toEqual({ count: 1, handles: ["A"] });
    expect(facade.settings()).toEqual({
      grid: false,
      snap: false,
      ortho: false,
      polar: false,
      isodraft: false,
      otrack: false,
      osnap: false,
      dynmode: false,
      lwdisplay: false,
      transparency: false,
      qpmode: false,
      osmode: 0,
      pickbox: 3,
    });
    expect(facade.formatPoint(1, 2)).toBe("raw-text");
    // A start reply that is not JSON keeps the previous state and raises the error line.
    const state = facade.start("circle", emptyPrompt());
    expect(state.error).toContain("unreadable");
    // The pointer replies: each malformed one is the inert answer.
    expect(facade.setViewport(800, 600)).toEqual({ ok: false, error: "unreadable reply from set_viewport" });
    expect(facade.setCursor({ x: 0, y: 0 })).toEqual({ ok: false, error: "unreadable reply from set_cursor" });
    expect(facade.preview({ x: 0, y: 0 })).toBe(EMPTY_PREVIEW);
    expect(facade.pick({ x: 0, y: 0 })).toEqual([]);
    expect(facade.snap({ x: 0, y: 0 })).toBeNull();
    const clicked = facade.click({ x: 0, y: 0 }, 0, state);
    expect(clicked.state.error).toContain("unreadable");
    expect(clicked.snap).toBeNull();
    expect(facade.promptAnchor()).toEqual(NO_ANCHOR);
  });

  test("MockFacade satisfies every RawFacade method the shim uses", () => {
    const mock = new MockFacade();
    const required = [
      "execute",
      "cmdline",
      "start",
      "cancel",
      "prompt",
      "state",
      "selection",
      "settings",
      "format_point",
      "commands",
      "source",
      "run_script",
      "display",
      "set_view",
      "view",
      "set_viewport",
      "set_cursor",
      "preview",
      "pick",
      "snap",
      "click",
      "open_bytes",
      "load_sample",
      "save_bytes",
      "digest",
    ];
    for (const name of required) {
      const fn = (mock as unknown as Record<string, unknown>)[name];
      expect(typeof fn, `MockFacade is missing \`${name}\``).toBe("function");
    }
    // The argument-taking methods answer a string when called with hostile-but-shaped input.
    expect(typeof mock.execute("", "{}")).toBe("string");
    expect(typeof mock.cmdline("")).toBe("string");
    expect(typeof mock.start("circle")).toBe("string");
    expect(typeof mock.prompt()).toBe("string");
    expect(typeof mock.state()).toBe("string");
    expect(typeof mock.selection()).toBe("string");
    expect(typeof mock.settings()).toBe("string");
    expect(typeof mock.format_point(1, 2)).toBe("string");
    expect(typeof mock.commands()).toBe("string");
    expect(typeof mock.source()).toBe("string");
    expect(typeof mock.run_script("")).toBe("string");
    expect(typeof mock.display(0.5)).toBe("string");
    expect(typeof mock.set_view(0, 0, 1, 1)).toBe("string");
    expect(typeof mock.view()).toBe("string");
    expect(typeof mock.set_viewport(NaN, -1)).toBe("string");
    expect(typeof mock.set_cursor(NaN, Infinity)).toBe("string");
    expect(typeof mock.preview(NaN, 1e308)).toBe("string");
    expect(typeof mock.pick(NaN, 0, -1)).toBe("string");
    expect(typeof mock.snap(0, -Infinity, NaN)).toBe("string");
    expect(typeof mock.click(NaN, NaN, NaN)).toBe("string");
    expect(typeof mock.open_bytes("x", new Uint8Array())).toBe("string");
    expect(typeof mock.load_sample()).toBe("string");
    expect(mock.save_bytes()).toBeInstanceOf(Uint8Array);
    expect(typeof mock.digest()).toBe("string");
  });
});
