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

  test("execute forwards the command and its JSON", () => {
    const { instance, calls } = fakeInstance();
    const raw = wrapWasmFacade(instance);
    raw?.execute("line", "{\"points\":[]}");
    expect(calls).toEqual([{ name: "execute", args: ["line", "{\"points\":[]}"] }]);
  });
});
