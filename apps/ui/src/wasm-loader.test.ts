import { describe, expect, test } from "bun:test";
import { wrapWasmFacade } from "./wasm-loader";

/**
 * A fake wasm instance that records every call. It carries the exact method set the loader's
 * `REQUIRED` table names — if the loader ever looks for a different spelling, `wrapWasmFacade`
 * returns null and the test fails loudly.
 */
function fakeInstance(): { instance: Record<string, unknown>; calls: Array<{ name: string; args: unknown[] }> } {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = (name: string) => (...args: unknown[]): string => {
    calls.push({ name, args });
    return name === "save_bytes" ? "" : JSON.stringify({ ok: true });
  };
  const instance: Record<string, unknown> = {
    execute: record("execute"),
    cmdline: record("cmdline"),
    start: record("start"),
    cancel: record("cancel"),
    prompt: record("prompt"),
    state: record("state"),
    selection: record("selection"),
    settings: record("settings"),
    format_point: record("format_point"),
    commands: record("commands"),
    source: record("source"),
    run_script: record("run_script"),
    display: record("display"),
    set_view: record("set_view"),
    view: record("view"),
    open_bytes: record("open_bytes"),
    load_sample: record("load_sample"),
    save_bytes: () => { calls.push({ name: "save_bytes", args: [] }); return new Uint8Array(); },
    digest: record("digest"),
  };
  return { instance, calls };
}

describe("wrapWasmFacade", () => {
  test("every named method is present, in snake_case", () => {
    const { instance } = fakeInstance();
    expect(wrapWasmFacade(instance)).not.toBeNull();
  });

  test("camelCase spellings are accepted too", () => {
    const { instance } = fakeInstance();
    instance["formatPoint"] = instance["format_point"];
    delete instance["format_point"];
    instance["runScript"] = instance["run_script"];
    delete instance["run_script"];
    instance["setView"] = instance["set_view"];
    delete instance["set_view"];
    instance["openBytes"] = instance["open_bytes"];
    delete instance["open_bytes"];
    instance["loadSample"] = instance["load_sample"];
    delete instance["load_sample"];
    instance["saveBytes"] = instance["save_bytes"];
    delete instance["save_bytes"];
    expect(wrapWasmFacade(instance)).not.toBeNull();
  });

  test("a missing method is refused (null, never a half-wrapped facade)", () => {
    const { instance } = fakeInstance();
    delete instance["display"];
    expect(wrapWasmFacade(instance)).toBeNull();
  });

  /**
   * The argument pass-through: a wrapped method that forgets an argument still typechecks (fewer
   * parameters is assignable) and silently drops it at runtime. `display` did exactly that once:
   * the shell asked for a padded window, the loader called `display()` with nothing, and the
   * engine answered for the bare view — so a pan showed blank space until a second fetch.
   */
  test("display forwards its margin, exactly", () => {
    const { instance, calls } = fakeInstance();
    const raw = wrapWasmFacade(instance);
    expect(raw).not.toBeNull();
    raw?.display(0.5);
    expect(calls).toEqual([{ name: "display", args: [0.5] }]);
    raw?.display(0);
    expect(calls[1]).toEqual({ name: "display", args: [0] });
  });

  test("set_view forwards all four edges, in order", () => {
    const { instance, calls } = fakeInstance();
    const raw = wrapWasmFacade(instance);
    raw?.set_view(-1, 2, 3, 4);
    expect(calls).toEqual([{ name: "set_view", args: [-1, 2, 3, 4] }]);
  });

  test("cancel reaches the engine's own cancel, and a module without one is refused", () => {
    const { instance, calls } = fakeInstance();
    wrapWasmFacade(instance)?.cancel();
    expect(calls).toEqual([{ name: "cancel", args: [] }]);
    delete instance["cancel"];
    expect(wrapWasmFacade(instance)).toBeNull();
  });

  test("the pointer calls forward every argument, in order, in either spelling", () => {
    const { instance, calls } = fakeInstance();
    const pointer = ["set_viewport", "set_cursor", "preview", "pick", "snap", "click", "pointer"];
    for (const name of pointer) instance[name] = (...args: unknown[]): string => { calls.push({ name, args }); return "{}"; };
    const raw = wrapWasmFacade(instance);
    raw?.set_viewport(1280, 800);
    raw?.set_cursor(1.5, -2);
    raw?.preview(3, 4);
    raw?.pick(5, 6, 0.25);
    raw?.snap(7, 8, 0);
    raw?.click(9, 10, 0.5);
    raw?.pointer(11, 12, 0.75, 1234.5, 3);
    expect(calls).toEqual([
      { name: "set_viewport", args: [1280, 800] },
      { name: "set_cursor", args: [1.5, -2] },
      { name: "preview", args: [3, 4] },
      { name: "pick", args: [5, 6, 0.25] },
      { name: "snap", args: [7, 8, 0] },
      { name: "click", args: [9, 10, 0.5] },
      { name: "pointer", args: [11, 12, 0.75, 1234.5, 3] },
    ]);
    // wasm-bindgen's `js_name` spellings reach the same methods.
    instance["setViewport"] = instance["set_viewport"];
    delete instance["set_viewport"];
    instance["setCursor"] = instance["set_cursor"];
    delete instance["set_cursor"];
    calls.length = 0;
    const camel = wrapWasmFacade(instance);
    camel?.set_viewport(640, 480);
    camel?.set_cursor(0, 1);
    expect(calls).toEqual([
      { name: "set_viewport", args: [640, 480] },
      { name: "set_cursor", args: [0, 1] },
    ]);
  });

  test("the grip calls forward every argument, in order, in either spelling", () => {
    const { instance, calls } = fakeInstance();
    for (const name of ["grips", "grip_at", "grip_start", "grip_options", "grip_option"]) instance[name] = (...args: unknown[]): string => { calls.push({ name, args }); return "{}"; };
    const raw = wrapWasmFacade(instance);
    raw?.grips();
    raw?.grip_at(1.5, -2, 0.25);
    raw?.grip_start('["1A:2","1A:0"]');
    raw?.grip_options("1A:2");
    raw?.grip_option("1A:2", "lengthen");
    expect(calls).toEqual([
      { name: "grips", args: [] },
      { name: "grip_at", args: [1.5, -2, 0.25] },
      { name: "grip_start", args: ['["1A:2","1A:0"]'] },
      { name: "grip_options", args: ["1A:2"] },
      { name: "grip_option", args: ["1A:2", "lengthen"] },
    ]);
    // wasm-bindgen's `js_name` spellings reach the same methods.
    for (const [snake, camel] of [["grip_at", "gripAt"], ["grip_start", "gripStart"], ["grip_options", "gripOptions"], ["grip_option", "gripOption"]] as const) {
      instance[camel] = instance[snake];
      delete instance[snake];
    }
    calls.length = 0;
    const camel = wrapWasmFacade(instance);
    camel?.grip_at(3, 4, 0);
    camel?.grip_start('["2B:d2:end"]');
    camel?.grip_options("2B:d1:at");
    camel?.grip_option("2B:d1:at", "Closed");
    expect(calls).toEqual([
      { name: "grip_at", args: [3, 4, 0] },
      { name: "grip_start", args: ['["2B:d2:end"]'] },
      { name: "grip_options", args: ["2B:d1:at"] },
      { name: "grip_option", args: ["2B:d1:at", "Closed"] },
    ]);
  });

  /**
   * A package built before the grip calls has no grips: it is kept, the looks answer "none", and
   * a start or an option is refused with the command line it has, never invented.
   */
  test("a package without the grip calls is kept, and has no grips", () => {
    const { instance, calls } = fakeInstance();
    instance["prompt"] = (): string => { calls.push({ name: "prompt", args: [] }); return '{"prompt":"Command","running":null,"keywords":[],"output":["old line"]}'; };
    const raw = wrapWasmFacade(instance);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    expect(JSON.parse(raw.grips())).toEqual({ shown: false, size: 0, reach: 0, truncated: false, grips: [] });
    expect(JSON.parse(raw.grip_at(1, 2, 0))).toEqual({ grip: null });
    expect(JSON.parse(raw.grip_options("1A:2"))).toEqual({ options: [] });
    expect(calls).toEqual([]);
    for (const reply of [raw.grip_start('["1A:2"]'), raw.grip_option("1A:2", "lengthen")]) {
      const parsed: unknown = JSON.parse(reply);
      expect(parsed).toMatchObject({ prompt: "Command", running: null, output: [] });
      expect(JSON.stringify(parsed)).toContain("build:wasm");
    }
    expect(calls).toEqual([{ name: "prompt", args: [] }, { name: "prompt", args: [] }]);
    // One of them alone is used where it is; the rest stay inert.
    instance["gripAt"] = (): string => '{"grip":{"id":"1A:2"}}';
    const partial = wrapWasmFacade(instance);
    expect(JSON.parse(partial?.grip_at(1, 2, 0) ?? "null")).toEqual({ grip: { id: "1A:2" } });
    expect(JSON.parse(partial?.grips() ?? "null")).toMatchObject({ shown: false, grips: [] });
  });

  /**
   * A wasm package built before the pointer calls existed still carries the whole drawing
   * contract: it is kept (never traded for the mock), and each missing call answers inertly.
   */
  test("a package without the pointer calls is kept, and they answer inertly", () => {
    const { instance, calls } = fakeInstance();
    const raw = wrapWasmFacade(instance);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    expect(JSON.parse(raw.preview(1, 2))).toEqual({ verts: [], prims: [], drag: null });
    expect(JSON.parse(raw.pick(1, 2, 0))).toEqual({ handles: [] });
    expect(JSON.parse(raw.snap(1, 2, 0))).toEqual({ snap: null });
    for (const reply of [raw.set_viewport(800, 600), raw.set_cursor(1, 2)]) {
      const parsed: unknown = JSON.parse(reply);
      expect(parsed).toMatchObject({ ok: false });
      expect(JSON.stringify(parsed)).toContain("build:wasm");
    }
    // `pointer` on such a package is the free pointer, in the real reply's whole shape.
    expect(JSON.parse(raw.pointer(1, 2, 0, 16, 1))).toEqual({
      point: [1, 2],
      constraint: "none",
      snap: null,
      from: null,
      distance: null,
      angle: null,
      label: "",
      paths: { verts: [], prims: [] },
      acquired: [],
      wait: false,
      preview: { verts: [], prims: [], drag: null },
    });
    expect(JSON.parse(raw.pointer(Number.NaN, 2, 0, 16, 0))).toMatchObject({ point: null, constraint: "none" });
    expect(calls).toEqual([]);
  });

  /**
   * A package built after `snap` and `preview` but before `pointer`: the pointer is resolved from
   * those, as the canvas did then. Object snap works; ortho, polar and grid snap do nothing.
   */
  test("a package without `pointer` resolves it from the object snap and the rubber band it has", () => {
    const { instance, calls } = fakeInstance();
    const band = { verts: [[0, 0], [10, 0]], prims: [{ kind: "polyline", start: 0, len: 2 }], drag: null };
    const reply: Record<string, (args: unknown[]) => string> = {
      set_cursor: () => '{"ok":true}',
      snap: (args) => (args[0] === 9.9 ? '{"snap":{"point":[10,0],"mode":1,"name":"Endpoint","deferred":false}}' : '{"snap":null}'),
      preview: () => JSON.stringify(band),
      click: () => "{}",
    };
    for (const name of Object.keys(reply)) instance[name] = (...args: unknown[]): string => { calls.push({ name, args }); return reply[name]?.(args) ?? "{}"; };
    const raw = wrapWasmFacade(instance);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    const snapped: unknown = JSON.parse(raw.pointer(9.9, 0.1, 0.5, 16, 3));
    expect(snapped).toMatchObject({ point: [10, 0], constraint: "osnap", snap: { name: "Endpoint", mode: 1 }, label: "", wait: false, preview: band });
    // The cursor told, the snap asked, the rubber band drawn at the snapped point: nothing else.
    expect(calls).toEqual([
      { name: "set_cursor", args: [9.9, 0.1] },
      { name: "snap", args: [9.9, 0.1, 0.5] },
      { name: "preview", args: [10, 0] },
    ]);
    calls.length = 0;
    const free: unknown = JSON.parse(raw.pointer(3, 4, 0, 32, 0));
    expect(free).toMatchObject({ point: [3, 4], constraint: "none", snap: null });
    expect(calls.at(-1)).toEqual({ name: "preview", args: [3, 4] });
    // A snap or a preview that is not JSON is the free pointer with no rubber band.
    instance["snap"] = (): string => "not json";
    instance["preview"] = (): string => "[]";
    const junk: unknown = JSON.parse(wrapWasmFacade(instance)?.pointer(5, 6, 0, 48, 0) ?? "null");
    expect(junk).toMatchObject({ point: [5, 6], constraint: "none", snap: null, preview: { verts: [], prims: [], drag: null } });
  });

  test("a click on a package without `click` types its point, as a click did before", () => {
    const { instance, calls } = fakeInstance();
    instance["prompt"] = (): string => { calls.push({ name: "prompt", args: [] }); return JSON.stringify({ prompt: "LINE Specify next point:", running: "line", output: ["old line"] }); };
    const raw = wrapWasmFacade(instance);
    raw?.click(12.5, -0.000001, 0.5);
    // Plain decimals at full precision: never an exponent the command line might not read.
    expect(calls).toEqual([{ name: "cmdline", args: ["12.5,-0.000001"] }]);
    calls.length = 0;
    raw?.click(1e-9, 3, 0);
    expect(calls).toEqual([{ name: "cmdline", args: ["0.000000001,3"] }]);
    // A point that cannot be written is refused with the prompt left up and nothing typed.
    calls.length = 0;
    const refused: unknown = JSON.parse(raw?.click(Number.NaN, 0, 0) ?? "null");
    expect(calls).toEqual([{ name: "prompt", args: [] }]);
    expect(refused).toMatchObject({ running: "line", prompt: "LINE Specify next point:", output: [] });
    expect(JSON.stringify(refused)).toContain("not a usable world coordinate");
  });

  test("execute forwards the command and its JSON", () => {
    const { instance, calls } = fakeInstance();
    const raw = wrapWasmFacade(instance);
    raw?.execute("line", "{\"points\":[]}");
    expect(calls).toEqual([{ name: "execute", args: ["line", "{\"points\":[]}"] }]);
  });
});
