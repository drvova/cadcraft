/**
 * The only module that touches the generated wasm-bindgen glue. It exists because the glue may
 * not be built yet: `import.meta.glob` resolves at Vite build time and simply finds nothing when
 * `src/wasm/` is absent, so the app falls back to the mock instead of failing the build.
 *
 * `bun test` never loads this module (it is imported dynamically by facade.ts), because
 * `import.meta.glob` is a Vite feature and is undefined under Bun.
 */

import type { RawFacade } from "./facade";

type WasmModule = Record<string, unknown>;

/**
 * The facade's shim names, snake_case and camelCase: the crate is free to pick either, so the
 * loader accepts both spellings (`#[wasm_bindgen(js_name = runScript)]` produces camelCase).
 */
const REQUIRED: readonly (readonly string[])[] = [
  ["execute"],
  ["cmdline"],
  ["start"],
  ["prompt"],
  ["state"],
  ["selection"],
  ["settings"],
  ["format_point", "formatPoint"],
  ["commands"],
  ["source"],
  ["run_script", "runScript"],
  ["display"],
  ["set_view", "setView"],
  ["view"],
  ["open_bytes", "openBytes"],
  ["load_sample", "loadSample"],
  ["save_bytes", "saveBytes"],
  ["digest"],
];

/** The facade class among the module's exports: the `Facade`-named one, else the first class. */
function findConstructor(mod: WasmModule): (new () => unknown) | null {
  const names = Object.keys(mod).filter((n) => !n.startsWith("init") && n !== "default");
  const preferred = names.filter((n) => /facade/i.test(n));
  for (const name of [...preferred, ...names]) {
    const value = mod[name];
    if (typeof value === "function") return value as new () => unknown;
  }
  return null;
}

/** Resolve one logical method name on the wasm instance, trying each accepted spelling. */
function resolveMethod(instance: WasmModule, names: readonly string[]): ((...args: unknown[]) => unknown) | null {
  for (const name of names) {
    const f = instance[name];
    if (typeof f === "function") return (f as (...args: unknown[]) => unknown).bind(instance);
  }
  return null;
}

/**
 * Wrap the wasm object in a validated `RawFacade`; null when it does not carry the contract.
 * Exported for the argument pass-through test: a method listed here that forgets an argument
 * typechecks (fewer parameters is assignable) and silently drops it at runtime.
 */
export function wrapWasmFacade(instance: WasmModule): RawFacade | null {
  const resolved = new Map<string, (...args: unknown[]) => unknown>();
  for (const names of REQUIRED) {
    const method = resolveMethod(instance, names);
    if (method === null) return null;
    resolved.set(names[0] as string, method);
  }
  const call = (key: string, args: unknown[]): unknown => {
    const f = resolved.get(key);
    if (f === undefined) throw new Error(`the facade has no \`${key}\``);
    return f(...args);
  };
  const text = (key: string, args: unknown[]): string => String(call(key, args));
  return {
    execute: (command, paramsJson) => text("execute", [command, paramsJson]),
    cmdline: (t) => text("cmdline", [t]),
    start: (id) => text("start", [id]),
    prompt: () => text("prompt", []),
    state: () => text("state", []),
    selection: () => text("selection", []),
    settings: () => text("settings", []),
    format_point: (x, y) => text("format_point", [x, y]),
    commands: () => text("commands", []),
    source: () => text("source", []),
    run_script: (t) => text("run_script", [t]),
    display: (margin) => text("display", [margin]),
    set_view: (x0, y0, x1, y1) => text("set_view", [x0, y0, x1, y1]),
    view: () => text("view", []),
    open_bytes: (name, bytes) => text("open_bytes", [name, bytes]),
    load_sample: () => text("load_sample", []),
    save_bytes: () => {
      const out = call("save_bytes", []);
      return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBufferLike);
    },
    digest: () => text("digest", []),
  };
}

/** Load the generated module, initialise it, and wrap the facade; null when it is not built. */
export async function loadWasmFacade(): Promise<RawFacade | null> {
  const modules = import.meta.glob("./wasm/*.js") as Record<string, () => Promise<unknown>>;
  const keys = Object.keys(modules);
  if (keys.length === 0) return null;
  const entry = keys.find((k) => k.endsWith("cadcraft_wasm.js")) ?? keys[0];
  if (entry === undefined) return null;
  const load = modules[entry];
  if (load === undefined) return null;
  const mod = (await load()) as WasmModule;
  const init = mod["default"];
  if (typeof init !== "function") return null;
  await (init as () => Promise<unknown>)();
  const ctor = findConstructor(mod);
  if (ctor === null) return null;
  // The facade offers `new CadFacade()` (empty) and `CadFacade.sample()` (the sample drawing);
  // the UI opens on the sample so the canvas has something to show, as the mock does.
  const sample = (ctor as unknown as Record<string, unknown>)["sample"];
  const instance = (typeof sample === "function" ? (sample as () => unknown)() : new ctor()) as WasmModule;
  return wrapWasmFacade(instance);
}
