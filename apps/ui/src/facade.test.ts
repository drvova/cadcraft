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
  freePointer,
  layerColor,
  parseCommands,
  parseDrawingState,
  parseEnvelope,
  parseHexColor,
  parseHover,
  parseLayers,
  parsePick,
  parsePointer,
  parsePreview,
  parsePromptAnchor,
  parseSnap,
  NO_GRIPS,
  parseGripAt,
  parseGripEdit,
  parseGripOptions,
  parseGrips,
  type RawFacade,
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
        pointer: trap,
        click: trap,
        grips: trap,
        grip_at: trap,
        grip_start: trap,
        grip_options: trap,
        grip_option: trap,
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
    expect(facade.pointer({ x: 1, y: 2 }, { now: 0 })).toEqual(freePointer({ x: 1, y: 2 }));
    expect(facade.hover({ x: 1, y: 2 })).toBeNull();
    expect(facade.pick({ x: 1, y: 2 })).toEqual([]);
    expect(facade.snap({ x: 1, y: 2 })).toBeNull();
    const clicked = facade.click({ x: 1, y: 2 });
    expect(clicked.snap).toBeNull();
    expect(clicked.state.running).toBeNull();
    // The grip calls too: no grips, nothing under the pointer, no menu, and a refused start.
    expect(facade.grips()).toBe(NO_GRIPS);
    expect(facade.gripAt({ x: 1, y: 2 })).toBeNull();
    expect(facade.gripOptions("1A:0")).toEqual([]);
    const started = facade.gripStart(["1A:0"]);
    expect(started.edit).toBeNull();
    expect(started.state.error).toContain("trap");
    const chosen = facade.gripOption("1A:0", "lengthen");
    expect(chosen.edit).toBeNull();
    expect(chosen.state.error).toContain("trap");
  });
});

describe("the grip replies", () => {
  const END = { id: "1A:2", handle: "1A", index: 2, point: [10, 0], kind: "standard", multi: true, locked: false, hot: false, dynamic: null };
  const ARROW = { id: "2B:d2:end", handle: "2B", index: null, point: [136, -4], kind: "linear", multi: false, locked: false, hot: true, dynamic: { node: 2, part: "end", dir: [1, 0], property: "Width", choices: [] } };
  const LIST = { id: "2B:d1:at", handle: "2B", index: null, point: [100, 5], kind: "list", multi: true, locked: true, hot: false, dynamic: { node: 1, part: "at", dir: [0, 0], property: "Visibility1", choices: ["Open", "Closed"] } };

  test("parseGrips reads the list, its box size and reach, and each kind of grip", () => {
    const list = parseGrips(JSON.stringify({ shown: true, size: 5, reach: 0.16, truncated: false, grips: [END, ARROW, LIST] }));
    expect(list.shown).toBe(true);
    expect(list.size).toBe(5);
    expect(list.reach).toBe(0.16);
    expect(list.truncated).toBe(false);
    expect(list.grips).toEqual([
      { id: "1A:2", handle: "1A", index: 2, point: { x: 10, y: 0 }, kind: "standard", multi: true, locked: false, hot: false, dynamic: null },
      { id: "2B:d2:end", handle: "2B", index: null, point: { x: 136, y: -4 }, kind: "linear", multi: false, locked: false, hot: true, dynamic: { node: 2, part: "end", dir: { x: 1, y: 0 }, property: "Width", choices: [] } },
      { id: "2B:d1:at", handle: "2B", index: null, point: { x: 100, y: 5 }, kind: "list", multi: true, locked: true, hot: false, dynamic: { node: 1, part: "at", dir: { x: 0, y: 0 }, property: "Visibility1", choices: ["Open", "Closed"] } },
    ]);
  });

  test("parseGrips skips rows that are not grips, and says the list is short", () => {
    const rows: unknown[] = [
      END,
      null,
      7,
      "1A:0",
      [],
      { ...END, id: "" },
      { ...END, id: 7 },
      { ...END, id: "x".repeat(600) },
      { ...END, handle: null },
      { ...END, point: [null, 0] },
      { ...END, point: "10,0" },
      { ...END, kind: "endpoint" },
      { ...END, kind: "linear" },
      { ...ARROW, kind: "standard" },
      { ...ARROW, dynamic: { ...ARROW.dynamic, part: "middle" } },
      { ...ARROW, dynamic: { ...ARROW.dynamic, node: 1.5 } },
      { ...ARROW, dynamic: [] },
    ];
    const list = parseGrips(JSON.stringify({ shown: true, size: 5, reach: 0.16, truncated: false, grips: rows }));
    expect(list.grips.map((g) => g.id)).toEqual(["1A:2"]);
    expect(list.truncated).toBe(true);
    // Fields that are not what they should be fall to the inert value, never through.
    const loose = parseGrips(JSON.stringify({ shown: "yes", size: -5, reach: "far", grips: [{ ...END, index: -1, multi: 1, locked: "no", hot: null }, { ...LIST, dynamic: { ...LIST.dynamic, dir: "up", property: 9, choices: ["Open", 3, "", null, "Closed"] } }] }));
    expect(loose.shown).toBe(false);
    expect(loose.size).toBe(0);
    expect(loose.reach).toBe(0);
    expect(loose.grips[0]).toMatchObject({ index: null, multi: false, locked: false, hot: false });
    expect(loose.grips[1]?.dynamic).toEqual({ node: 1, part: "at", dir: { x: 0, y: 0 }, property: "", choices: ["Open", "Closed"] });
    // No more than the engine lists are read.
    const flood = parseGrips(JSON.stringify({ shown: true, size: 5, reach: 1, truncated: false, grips: Array.from({ length: 3000 }, (_, i) => ({ ...END, id: `1A:${i}` })) }));
    expect(flood.grips.length).toBe(2048);
    expect(flood.truncated).toBe(true);
  });

  test("parseGrips answers no grips for a refusal and for anything unreadable", () => {
    for (const raw of ["", "junk", "null", "[]", "7", '{"grips":7}', '{"shown":true}', '{"shown":false,"size":5,"reach":0.1,"truncated":true,"grips":[],"error":"the selection has too many grips to list"}', '{"ok":false,"error":"the facade call failed"}']) {
      expect(parseGrips(raw)).toBe(NO_GRIPS);
    }
    expect(parseGrips(JSON.stringify({ shown: false, size: 5, reach: 0.16, truncated: false, grips: [] }))).toEqual({ shown: false, size: 5, reach: 0.16, truncated: false, grips: [] });
  });

  test("parseGripAt reads the grip under the pointer, or null", () => {
    expect(parseGripAt(JSON.stringify({ grip: END }))?.id).toBe("1A:2");
    expect(parseGripAt(JSON.stringify({ grip: LIST }))?.dynamic?.choices).toEqual(["Open", "Closed"]);
    for (const raw of ['{"grip":null}', '{"grip":null,"error":"the point is not a usable world coordinate"}', '{"grip":"1A:2"}', '{"grip":{"id":"1A:2"}}', "{}", "[]", "junk", ""]) {
      expect(parseGripAt(raw)).toBeNull();
    }
  });

  test("parseGripOptions reads a grip's menu and a list grip's choices", () => {
    const menu = parseGripOptions('{"options":[{"id":"addVertex","label":"Add Vertex","keyword":"Add vertex","needsPoint":true},{"id":"removeVertex","label":"Remove Vertex","keyword":"Remove vertex","needsPoint":false}]}');
    expect(menu).toEqual([
      { id: "addVertex", label: "Add Vertex", keyword: "Add vertex", needsPoint: true },
      { id: "removeVertex", label: "Remove Vertex", keyword: "Remove vertex", needsPoint: false },
    ]);
    expect(parseGripOptions('{"options":[{"id":"Closed","label":"Closed","keyword":null,"needsPoint":false}]}')).toEqual([{ id: "Closed", label: "Closed", keyword: null, needsPoint: false }]);
    // A row without an id is skipped; a missing label is the id; a loose flag is false.
    expect(parseGripOptions('{"options":[null,{"label":"x"},{"id":""},{"id":7},{"id":"radius","needsPoint":"yes"}]}')).toEqual([{ id: "radius", label: "radius", keyword: null, needsPoint: false }]);
    for (const raw of ['{"options":[],"error":"that is not a grip id"}', '{"options":{"0":{"id":"x"}}}', "{}", "[]", "junk", ""]) {
      expect(parseGripOptions(raw)).toEqual([]);
    }
  });

  test("parseGripEdit tells a grip edit from an ordinary command", () => {
    expect(parseGripEdit('{"running":"grip","gripEdit":{"mode":"stretch","hot":["1A:2"]}}')).toEqual({ mode: "stretch", hot: ["1A:2"] });
    expect(parseGripEdit('{"running":"grip","gripEdit":{"mode":null,"hot":["1A:2","1A:0"]}}')).toEqual({ mode: null, hot: ["1A:2", "1A:0"] });
    expect(parseGripEdit('{"running":"grip","gripEdit":{"mode":7,"hot":[1,"","1A:2",null]}}')).toEqual({ mode: null, hot: ["1A:2"] });
    expect(parseGripEdit('{"running":"grip","gripEdit":{}}')).toEqual({ mode: null, hot: [] });
    // An ordinary command, nothing running, and a refusal: no grip edit.
    expect(parseGripEdit('{"running":"line","gripEdit":null}')).toBeNull();
    expect(parseGripEdit('{"running":null,"gripEdit":null,"error":"that is not a grip id"}')).toBeNull();
    expect(parseGripEdit('{"running":"line"}')).toBeNull();
    // The engine's word is taken over the command's name, and an older reply is read by the name.
    expect(parseGripEdit('{"running":"grip","gripEdit":null}')).toBeNull();
    expect(parseGripEdit('{"running":"grip"}')).toEqual({ mode: null, hot: [] });
    for (const raw of ['{"gripEdit":"stretch"}', '{"gripEdit":[]}', "[]", "null", "junk", ""]) {
      expect(parseGripEdit(raw)).toBeNull();
    }
  });

  /** A raw facade whose grip calls answer what the engine answers for one selected line. */
  function gripFacade(calls: Array<{ name: string; args: unknown[] }>): AppFacade {
    const prompt = (edit: unknown, extra: Record<string, unknown> = {}): string =>
      JSON.stringify({ prompt: edit === null ? "Command" : "** STRETCH ** Specify stretch point or [Base point/Copy/Undo/Lengthen/eXit]", running: edit === null ? null : "grip", keywords: edit === null ? [] : ["Base point", "Copy", "Undo", "Lengthen", "eXit"], accept: { point: true, enter: true }, base: edit === null ? null : [10, 0], gripEdit: edit, output: [], ...extra });
    const record = <A extends unknown[]>(name: string, reply: (...args: A) => string) => (...args: A): string => {
      calls.push({ name, args });
      return reply(...args);
    };
    const mock = new MockFacade();
    const raw: RawFacade = {
      execute: (c, p) => mock.execute(c, p),
      cmdline: (t) => mock.cmdline(t),
      start: (id) => mock.start(id),
      cancel: () => mock.cancel(),
      prompt: record("prompt", () => prompt({ mode: "move", hot: ["1A:2"] })),
      state: () => mock.state(),
      selection: () => mock.selection(),
      settings: () => mock.settings(),
      format_point: (x, y) => mock.format_point(x, y),
      commands: () => mock.commands(),
      source: () => mock.source(),
      run_script: (t) => mock.run_script(t),
      display: (m) => mock.display(m),
      set_view: (a, b, c, d) => mock.set_view(a, b, c, d),
      view: () => mock.view(),
      set_viewport: (w, h) => mock.set_viewport(w, h),
      set_cursor: (x, y) => mock.set_cursor(x, y),
      preview: (x, y) => mock.preview(x, y),
      pick: (x, y, a) => mock.pick(x, y, a),
      snap: (x, y, a) => mock.snap(x, y, a),
      pointer: (x, y, a, n, m) => mock.pointer(x, y, a, n, m),
      click: (x, y, a) => mock.click(x, y, a),
      grips: record("grips", () => JSON.stringify({ shown: true, size: 5, reach: 0.16, truncated: false, grips: [END] })),
      grip_at: record("grip_at", (x: number) => JSON.stringify({ grip: x > 9 ? END : null })),
      grip_start: record("grip_start", (ids: string) => (ids === '["1A:2"]' ? prompt({ mode: "stretch", hot: ["1A:2"] }) : prompt(null, { error: "that grip's object is not selected" }))),
      grip_options: record("grip_options", () => '{"options":[{"id":"lengthen","label":"Lengthen","keyword":"Lengthen","needsPoint":true}]}'),
      grip_option: record("grip_option", (_id: string, option: string) => (option === "lengthen" ? prompt({ mode: "lengthen", hot: ["1A:2"] }) : prompt(null, { error: "that grip has no such option" }))),
      open_bytes: (n, b) => mock.open_bytes(n, b),
      load_sample: () => mock.load_sample(),
      save_bytes: () => mock.save_bytes(),
      digest: () => mock.digest(),
    };
    return new AppFacade(raw, { kind: "wasm", detail: "test" });
  }

  test("AppFacade forwards the grip calls and narrows what comes back", () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const facade = gripFacade(calls);
    expect(facade.grips().grips.map((g) => g.id)).toEqual(["1A:2"]);
    expect(facade.gripAt({ x: 10, y: 0 })?.id).toBe("1A:2");
    expect(facade.gripAt({ x: 3, y: 0 }, 0.5)).toBeNull();
    expect(facade.gripOptions("1A:2")).toEqual([{ id: "lengthen", label: "Lengthen", keyword: "Lengthen", needsPoint: true }]);
    const started = facade.gripStart(["1A:2"]);
    expect(started.edit).toEqual({ mode: "stretch", hot: ["1A:2"] });
    expect(started.state.running).toBe("grip");
    expect(started.state.error).toBeNull();
    expect(started.state.keywords).toEqual(["Base point", "Copy", "Undo", "Lengthen", "eXit"]);
    expect(started.state.anchor.base).toEqual({ x: 10, y: 0 });
    const asked = facade.gripOption("1A:2", "lengthen", started.state);
    expect(asked.edit).toEqual({ mode: "lengthen", hot: ["1A:2"] });
    expect(facade.gripEdit()).toEqual({ mode: "move", hot: ["1A:2"] });
    expect(calls).toEqual([
      { name: "grips", args: [] },
      { name: "grip_at", args: [10, 0, 0] },
      { name: "grip_at", args: [3, 0, 0.5] },
      { name: "grip_options", args: ["1A:2"] },
      { name: "grip_start", args: ['["1A:2"]'] },
      { name: "grip_option", args: ["1A:2", "lengthen"] },
      { name: "prompt", args: [] },
    ]);
  });

  test("a refused grip call is an error on the command line, and input the engine would refuse never reaches it", () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const facade = gripFacade(calls);
    const stale = facade.gripStart(["9F:0"]);
    expect(stale.edit).toBeNull();
    expect(stale.state.error).toBe("that grip's object is not selected");
    expect(stale.state.running).toBeNull();
    const none = facade.gripOption("1A:2", "explode");
    expect(none.edit).toBeNull();
    expect(none.state.error).toBe("that grip has no such option");
    calls.length = 0;
    // No ids, too many ids, and points and apertures that are not usable stop here.
    const prev = { ...emptyPrompt(), prompt: "kept" };
    const empty = facade.gripStart([], prev);
    expect(empty.edit).toBeNull();
    expect(empty.state.prompt).toBe("kept");
    expect(empty.state.error).toContain("refused");
    expect(facade.gripStart(Array.from({ length: 1001 }, () => "1A:2")).edit).toBeNull();
    for (const [point, aperture] of [[{ x: NaN, y: 0 }, 0], [{ x: 0, y: Infinity }, 0], [{ x: 10, y: 0 }, -1], [{ x: 10, y: 0 }, NaN], [{ x: 10, y: 0 }, Infinity]] as const) {
      expect(facade.gripAt(point, aperture)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  test("the mock has no grips, in the engine's own reply shapes", () => {
    const facade = mockFacade();
    facade.execute("select", { at: [50, 30] });
    expect(facade.grips()).toEqual(NO_GRIPS);
    expect(facade.gripAt({ x: 0, y: 0 })).toBeNull();
    expect(facade.gripOptions("1A:0")).toEqual([]);
    const before = facade.currentPrompt();
    const started = facade.gripStart(["1A:0"], before);
    expect(started.edit).toBeNull();
    expect(started.state.error).toContain("no grips");
    expect(started.state.running).toBe(before.running);
    expect(facade.gripOption("1A:0", "lengthen").state.error).toContain("no grips");
    expect(facade.gripEdit()).toBeNull();
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

  test("parsePreview reads a reply once, whatever it holds", () => {
    const parse = JSON.parse;
    let parses = 0;
    JSON.parse = ((text: string) => {
      parses++;
      return parse(text) as unknown;
    }) as typeof JSON.parse;
    try {
      const drag = parsePreview('{"drag":{"clipboard":false,"handles":[18],"matrix":[1,0,0,1,3,4]},"prims":[{"kind":"polyline","start":0,"len":2}],"verts":[[0,0],[1,1]]}');
      expect(drag.drag?.handles).toEqual([18]);
      expect(drag.prims).toHaveLength(1);
      expect(parses).toBe(1);
      parsePreview('{"verts":[[0,0],[1,1]],"prims":[{"kind":"polyline","start":0,"len":2}],"drag":null}');
      expect(parses).toBe(2);
      parsePointer('{"point":[1,2],"constraint":"none","preview":{"verts":[],"prims":[],"drag":{"handles":[3],"matrix":[1,0,0,1,0,0]}}}', { x: 0, y: 0 });
      expect(parses).toBe(3);
    } finally {
      JSON.parse = parse;
    }
  });

  test("parseHover reads the engine's own choice, and falls back to the nearest handle without one", () => {
    expect(parseHover('{"handles":["1A","2B"],"hover":"1A"}')).toBe("1A");
    // The engine says nothing lights (a locked layer, a point prompt, the preview off): nothing does.
    expect(parseHover('{"handles":["1A","2B"],"hover":null}')).toBeNull();
    expect(parseHover('{"handles":["1A"],"hover":""}')).toBeNull();
    expect(parseHover('{"handles":["1A"],"hover":7}')).toBeNull();
    // An older package, or a canned facade: the nearest handle, as the hover was before.
    expect(parseHover('{"handles":["1A","2B"]}')).toBe("1A");
    expect(parseHover('{"handles":[]}')).toBeNull();
    // A refusal, or anything unreadable.
    expect(parseHover('{"handles":[],"hover":null,"error":"the point is not a usable world coordinate"}')).toBeNull();
    for (const raw of ["", "junk", "null", "[]", "42", '{"ok":false,"error":"trap"}']) expect(parseHover(raw)).toBeNull();
  });

  test("parsePointer reads the resolved point, what bent it, its rays and its rubber band", () => {
    const polar = parsePointer(
      JSON.stringify({
        point: [4.025, 4.025],
        constraint: "polar",
        snap: null,
        from: [1, 1],
        distance: 4.278,
        angle: 45,
        label: "Polar: 4.2780 < 45°",
        paths: { verts: [[1, 1], [40, 40]], prims: [{ kind: "polyline", start: 0, len: 2, color: [255, 255, 255], lw: 0, alpha: 255, handle: 0 }] },
        acquired: [[10, 0]],
        wait: true,
        preview: { verts: [[1, 1], [4.025, 4.025]], prims: [{ kind: "polyline", start: 0, len: 2, color: [1, 2, 3], lw: 0, alpha: 255, handle: 0 }], drag: null },
      }),
      { x: 4.05, y: 4 },
    );
    expect(polar.point).toEqual({ x: 4.025, y: 4.025 });
    expect(polar.constraint).toBe("polar");
    expect(polar.from).toEqual({ x: 1, y: 1 });
    expect(polar.distance).toBe(4.278);
    expect(polar.angle).toBe(45);
    expect(polar.label).toBe("Polar: 4.2780 < 45°");
    expect(polar.paths.verts).toEqual([{ x: 1, y: 1 }, { x: 40, y: 40 }]);
    expect(polar.paths.prims).toHaveLength(1);
    expect(polar.acquired).toEqual([{ x: 10, y: 0 }]);
    expect(polar.wait).toBe(true);
    expect(polar.preview.verts[1]).toEqual({ x: 4.025, y: 4.025 });
    const snapped = parsePointer('{"point":[10,0],"constraint":"osnap","snap":{"point":[10,0],"mode":1,"name":"Endpoint","deferred":false}}', { x: 9.9, y: 0.1 });
    expect(snapped.snap).toEqual({ point: { x: 10, y: 0 }, mode: 1, name: "Endpoint", deferred: false });
    expect(snapped.preview).toBe(EMPTY_PREVIEW);
    expect(snapped.paths.prims).toEqual([]);
  });

  test("parsePointer answers the free pointer for a refusal or anything malformed", () => {
    const at = { x: 3, y: -4 };
    const refusal = '{"point":null,"constraint":"none","snap":null,"paths":{"verts":[],"prims":[]},"acquired":[],"wait":false,"preview":{"verts":[],"prims":[],"drag":null},"error":"the time must be finite milliseconds, 0 or more"}';
    for (const raw of ["", "junk", "null", "[]", "42", '{"ok":false,"error":"trap"}', refusal, '{"point":[1]}', '{"point":["a","b"]}', '{"point":{"x":1,"y":2}}']) {
      expect(parsePointer(raw, at)).toEqual(freePointer(at));
    }
    // A point with junk around it keeps the point and tames the rest.
    const junk = parsePointer('{"point":[1,2],"constraint":"sideways","snap":{"mode":1},"from":[1],"distance":"far","angle":null,"label":7,"paths":{"verts":[[0,0]],"prims":[{"kind":"polyline","start":0,"len":9}]},"acquired":[[1],"x",[2,3]],"wait":"yes","preview":"none"}', at);
    expect(junk).toEqual({ ...freePointer({ x: 1, y: 2 }), acquired: [{ x: 2, y: 3 }] });
    // More acquired points, or a longer label, than the engine ever sends are cut.
    const many = parsePointer(JSON.stringify({ point: [0, 0], acquired: Array.from({ length: 500 }, (_, i) => [i, i]), label: "x".repeat(5000) }), at);
    expect(many.acquired.length).toBe(16);
    expect(many.label.length).toBe(120);
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
    let clicked = facade.click({ x: 1.5, y: -2 }, 0, state, (taken) => `${taken.x},${taken.y}`);
    expect(clicked.point).toEqual({ x: 1.5, y: -2 });
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
    expect(refused.point).toBeNull();
    expect(refused.state.running).toBe("line");
    expect(facade.click({ x: 0, y: 0 }, -1, clicked.state).state.error).toContain("refused");
    const raw: unknown = JSON.parse(new MockFacade().click(Infinity, 0, 0));
    expect(raw).toMatchObject({ snap: null, point: null, output: [] });
  });

  test("click echoes the point the engine says it took, not the one under the pointer", () => {
    const reply = (extra: Record<string, unknown>): string => JSON.stringify({ prompt: "LINE Specify next point:", running: "line", keywords: [], output: [], ...extra });
    const facadeWith = (click: string): AppFacade => new AppFacade({ ...new MockFacade(), click: () => click } as unknown as MockFacade, { kind: "wasm", detail: "test" });
    const echo = (taken: { x: number; y: number }): string => `${taken.x},${taken.y}`;
    // Ortho bent it: the history shows where the line went.
    const bent = facadeWith(reply({ snap: null, point: [6, 2], base: [6, 2] })).click({ x: 6, y: 3 }, 0, emptyPrompt(), echo);
    expect(bent.point).toEqual({ x: 6, y: 2 });
    expect(bent.state.output).toEqual(["6,2"]);
    expect(bent.state.anchor.base).toEqual({ x: 6, y: 2 });
    // A package that names no point took the snap, or else the pointer.
    const snapped = facadeWith(reply({ snap: { point: [10, 0], mode: 1, name: "Endpoint" } })).click({ x: 9.9, y: 0.1 }, 0, emptyPrompt(), echo);
    expect(snapped.point).toEqual({ x: 10, y: 0 });
    expect(facadeWith(reply({})).click({ x: 9.9, y: 0.1 }, 0, emptyPrompt(), echo).state.output).toEqual(["9.9,0.1"]);
    // A refusal from the engine names no point, and nothing is echoed for it.
    const refused = facadeWith(reply({ snap: null, point: null, error: "the point is not a usable world coordinate" })).click({ x: 1, y: 1 }, 0, emptyPrompt(), echo);
    expect(refused.point).toBeNull();
    expect(refused.state.output).toEqual([]);
    expect(refused.state.error).toContain("usable");
  });

  test("the prompt state carries the anchor its reply named, with no second read of the prompt", () => {
    const facade = mockFacade();
    // The mock names no base: the state says so, by the shared constant.
    expect(facade.currentPrompt().anchor).toBe(NO_ANCHOR);
    expect(facade.start("line").anchor).toBe(NO_ANCHOR);
    let prompts = 0;
    const engine = new AppFacade(
      {
        ...new MockFacade(),
        prompt: () => {
          prompts++;
          return "{}";
        },
        start: () => '{"prompt":"LINE Specify first point:","running":"line","keywords":[],"base":null,"corner":false,"distance":false,"deferred":true,"output":[]}',
        cmdline: () => '{"prompt":"LINE Specify next point:","running":"line","keywords":[],"base":[2,3],"corner":false,"distance":false,"deferred":false,"output":[]}',
        cancel: () => '{"prompt":"Command:","running":null,"keywords":[],"base":null,"corner":false,"distance":false,"deferred":false,"output":["*Cancel*"]}',
        click: () => '{"prompt":"RECTANG Specify other corner:","running":"rectang","keywords":[],"base":[4,5],"corner":true,"distance":false,"deferred":false,"output":[],"snap":null,"point":[4,5]}',
      } as unknown as MockFacade,
      { kind: "wasm", detail: "test" },
    );
    let state = engine.start("line");
    expect(state.anchor).toEqual({ base: null, corner: false, distance: false, deferred: true });
    state = engine.cmdline("2,3", state);
    expect(state.anchor).toEqual({ base: { x: 2, y: 3 }, corner: false, distance: false, deferred: false });
    expect(engine.click({ x: 4, y: 5 }, 0, state).state.anchor).toEqual({ base: { x: 4, y: 5 }, corner: true, distance: false, deferred: false });
    expect(engine.cancel(state).anchor).toBe(NO_ANCHOR);
    expect(prompts).toBe(0);
  });

  test("pointer is free in the mock, and what the engine refuses is refused the same way", () => {
    const facade = mockFacade();
    expect(facade.pointer({ x: 5, y: 6 }, { now: 12 })).toEqual(freePointer({ x: 5, y: 6 }));
    facade.start("line");
    expect(facade.pointer({ x: 5, y: 6 }, { now: 12, shift: true, ctrl: true }).point).toEqual({ x: 5, y: 6 });
    // Hostile numbers never reach the facade as they are: the free pointer, quietly.
    expect(facade.pointer({ x: NaN, y: 0 }, { now: 0 }).constraint).toBe("none");
    expect(facade.pointer({ x: 0, y: 0 }, { now: 0, aperture: -1 }).preview).toBe(EMPTY_PREVIEW);
    const mock = new MockFacade();
    for (const args of [[NaN, 0, 0, 0, 0], [0, 1e308, 0, 0, 0], [0, 0, -1, 0, 0], [0, 0, Infinity, 0, 0], [0, 0, 0, -1, 0], [0, 0, 0, NaN, 0], [0, 0, 0, Infinity, 0], [0, 0, 0, 1e308, 0], [0, 0, 0, 0, 4], [0, 0, 0, 0, -1], [0, 0, 0, 0, 1.5], [0, 0, 0, 0, NaN]] as const) {
      const reply: unknown = JSON.parse(mock.pointer(args[0], args[1], args[2], args[3], args[4]));
      expect(reply).toMatchObject({ point: null, constraint: "none", preview: { verts: [], prims: [], drag: null } });
      expect(typeof (reply as { error?: unknown }).error).toBe("string");
    }
    expect(JSON.parse(mock.pointer(1, 2, 0, 1e15, 3))).toMatchObject({ point: [1, 2] });
  });

  test("the clock and the keys cross as numbers the engine takes", () => {
    const seen: number[][] = [];
    const facade = new AppFacade(
      {
        ...new MockFacade(),
        pointer: (...args: number[]) => {
          seen.push(args);
          return '{"point":[0,0]}';
        },
      } as unknown as MockFacade,
      { kind: "wasm", detail: "test" },
    );
    facade.pointer({ x: 1, y: 2 }, { now: 16.5 });
    facade.pointer({ x: 1, y: 2 }, { now: 33, shift: true, aperture: 0.25 });
    facade.pointer({ x: 1, y: 2 }, { now: 50, ctrl: true });
    facade.pointer({ x: 1, y: 2 }, { now: NaN, shift: true, ctrl: true });
    facade.pointer({ x: 1, y: 2 }, { now: -5 });
    expect(seen).toEqual([
      [1, 2, 0, 16.5, 0],
      [1, 2, 0.25, 33, 1],
      [1, 2, 0, 50, 2],
      [1, 2, 0, 0, 3],
      [1, 2, 0, 0, 0],
    ]);
  });

  test("hover is the mock's pick at rest and nothing while a prompt is up", () => {
    const facade = mockFacade();
    expect(facade.hover({ x: 50, y: 5 })).toBe(facade.pick({ x: 50, y: 5 })[0] ?? null);
    expect(facade.hover({ x: -500, y: -500 })).toBeNull();
    expect(facade.hover({ x: NaN, y: 0 })).toBeNull();
    expect(facade.hover({ x: 50, y: 5 }, -1)).toBeNull();
    facade.start("line");
    expect(facade.pick({ x: 50, y: 5 }).length).toBe(1);
    expect(facade.hover({ x: 50, y: 5 })).toBeNull();
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
      pointer: () => '{"point":[null,2],"paths":7,"preview":[]}',
      click: () => "not json",
      grips: () => '{"shown":true,"grips":{"0":{"id":"1A:0"}}}',
      grip_at: () => '{"grip":["1A:0"]}',
      grip_start: () => "not json",
      grip_options: () => '{"options":"lengthen"}',
      grip_option: () => "[]",
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
    expect(clicked.state.anchor).toBe(NO_ANCHOR);
    expect(facade.pointer({ x: 3, y: 4 }, { now: 0 })).toEqual(freePointer({ x: 3, y: 4 }));
    expect(facade.hover({ x: 0, y: 0 })).toBeNull();
    // The grip replies: each malformed one is the inert answer too.
    expect(facade.grips()).toBe(NO_GRIPS);
    expect(facade.gripAt({ x: 0, y: 0 })).toBeNull();
    expect(facade.gripOptions("1A:0")).toEqual([]);
    const gripped = facade.gripStart(["1A:0"], state);
    expect(gripped.edit).toBeNull();
    expect(gripped.state.error).toContain("unreadable");
    expect(facade.gripOption("1A:0", "lengthen", state).state.error).toContain("unreadable");
    expect(facade.gripEdit()).toBeNull();
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
      "pointer",
      "click",
      "grips",
      "grip_at",
      "grip_start",
      "grip_options",
      "grip_option",
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
    expect(typeof mock.pointer(NaN, -Infinity, NaN, -1, 1e308)).toBe("string");
    expect(typeof mock.click(NaN, NaN, NaN)).toBe("string");
    expect(typeof mock.grips()).toBe("string");
    expect(typeof mock.grip_at(NaN, 1e308, -1)).toBe("string");
    expect(typeof mock.grip_start("not json")).toBe("string");
    expect(typeof mock.grip_options("")).toBe("string");
    expect(typeof mock.grip_option("", "")).toBe("string");
    expect(typeof mock.open_bytes("x", new Uint8Array())).toBe("string");
    expect(typeof mock.load_sample()).toBe("string");
    expect(mock.save_bytes()).toBeInstanceOf(Uint8Array);
    expect(typeof mock.digest()).toBe("string");
  });
});
