/**
 * The only module that touches the generated wasm-bindgen glue. It exists because the glue may
 * not be built yet: `import.meta.glob` resolves at Vite build time and simply finds nothing when
 * `src/wasm/` is absent, so the app falls back to the mock instead of failing the build.
 *
 * `bun test` never loads this module (it is imported dynamically by facade.ts), because
 * `import.meta.glob` is a Vite feature and is undefined under Bun.
 */

import type { RawFacade } from "./facade";
import { isRecord } from "./json";
import { formatPoint } from "./prompt";

type WasmModule = Record<string, unknown>;

/**
 * The facade's shim names, snake_case and camelCase: the crate is free to pick either, so the
 * loader accepts both spellings (`#[wasm_bindgen(js_name = runScript)]` produces camelCase).
 */
const REQUIRED: readonly (readonly string[])[] = [
  ["execute"],
  ["cmdline"],
  ["start"],
  ["cancel"],
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

/**
 * The pointer calls, added after the first wasm packages shipped. A package built before them
 * (a stale `src/wasm/`, until `bun run build:wasm` runs again) still carries the whole drawing
 * contract above, so it is kept rather than traded for the mock: each call missing from it
 * answers the inert reply `STALE` holds, and a `click` types its point at the command line,
 * which is what a click did before `click` existed (no object snap).
 *
 * `pointer` came later again. A package without it resolves the pointer the way the canvas did
 * before: the cursor told, the object snap asked, the rubber band drawn at the snapped point
 * (`stalePointer`), so object snap still works and ortho, polar, grid snap and tracking, which
 * only `pointer` knows, do nothing rather than something wrong.
 */
const POINTER: readonly (readonly string[])[] = [
  ["set_viewport", "setViewport"],
  ["set_cursor", "setCursor"],
  ["preview"],
  ["pick"],
  ["snap"],
  ["click"],
  ["pointer"],
];

/**
 * The grip calls, added after `pointer`. A package without them has no grips: the selection
 * lists none, nothing is under the pointer, no grip has a menu, and starting an edit or invoking
 * an option is refused with the command line left as it is. Nothing is made up in their place.
 */
const GRIPS: readonly (readonly string[])[] = [["grips"], ["grip_at", "gripAt"], ["grip_start", "gripStart"], ["grip_options", "gripOptions"], ["grip_option", "gripOption"]];

const STALE_MESSAGE = "the wasm package is older than this interface: run `bun run build:wasm`";

const STALE_REFUSAL = JSON.stringify({ ok: false, error: STALE_MESSAGE });

/** What each pointer or grip call answers when the wasm package does not have it. */
const STALE: Readonly<Record<string, string>> = {
  set_viewport: STALE_REFUSAL,
  set_cursor: STALE_REFUSAL,
  preview: JSON.stringify({ verts: [], prims: [], drag: null }),
  pick: JSON.stringify({ handles: [] }),
  snap: JSON.stringify({ snap: null }),
  grips: JSON.stringify({ shown: false, size: 0, reach: 0, truncated: false, grips: [] }),
  grip_at: JSON.stringify({ grip: null }),
  grip_options: JSON.stringify({ options: [] }),
};

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

/**
 * A command-line reply (`prompt()`) turned into a refusal: the same state, no output lines (the
 * caller's log already holds the tail `prompt()` repeats) and `error`.
 */
function withError(reply: string, error: string): string {
  let state: unknown;
  try {
    state = JSON.parse(reply);
  } catch {
    state = null;
  }
  return JSON.stringify({ ...(isRecord(state) ? state : {}), output: [], error });
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
  for (const names of [...POINTER, ...GRIPS]) {
    const method = resolveMethod(instance, names);
    if (method !== null) resolved.set(names[0] as string, method);
  }
  const call = (key: string, args: unknown[]): unknown => {
    const f = resolved.get(key);
    if (f === undefined) throw new Error(`the facade has no \`${key}\``);
    return f(...args);
  };
  const text = (key: string, args: unknown[]): string => String(call(key, args));
  /** A pointer call: the wasm method when the package has it, else its inert reply. */
  const pointer = (key: string, args: unknown[]): string => (resolved.has(key) ? text(key, args) : (STALE[key] ?? STALE_REFUSAL));
  /** A reply parsed for one of its fields; anything unreadable is an empty object. */
  const fields = (reply: string): Record<string, unknown> => {
    let value: unknown;
    try {
      value = JSON.parse(reply);
    } catch {
      value = null;
    }
    return isRecord(value) ? value : {};
  };
  /**
   * `pointer` on a package without it, from the calls it does have: the object snap alone bends
   * the point, and the reply has every field the real one has, so its reader needs no second path.
   */
  const stalePointer = (x: number, y: number, aperture: number): string => {
    pointer("set_cursor", [x, y]);
    const snap = fields(pointer("snap", [x, y, aperture]))["snap"];
    const at = isRecord(snap) && Array.isArray(snap["point"]) && typeof snap["point"][0] === "number" && typeof snap["point"][1] === "number" ? [snap["point"][0], snap["point"][1]] : null;
    const taken = at ?? [x, y];
    const preview = fields(pointer("preview", taken));
    return JSON.stringify({
      point: Number.isFinite(taken[0]) && Number.isFinite(taken[1]) ? taken : null,
      constraint: at === null ? "none" : "osnap",
      snap: at === null ? null : snap,
      from: null,
      distance: null,
      angle: null,
      label: "",
      paths: { verts: [], prims: [] },
      acquired: [],
      wait: false,
      preview: { verts: preview["verts"] ?? [], prims: preview["prims"] ?? [], drag: preview["drag"] ?? null },
    });
  };
  /** `click` on a package without it: the point typed at the command line, in full precision. */
  const typedClick = (x: number, y: number): string => {
    const typed = formatPoint({ x, y }, Number.NaN);
    // A point that cannot be written leaves the command line as it is, and says why.
    if (typed === null) return withError(text("prompt", []), "the point is not a usable world coordinate");
    return text("cmdline", [typed]);
  };
  return {
    execute: (command, paramsJson) => text("execute", [command, paramsJson]),
    cmdline: (t) => text("cmdline", [t]),
    start: (id) => text("start", [id]),
    cancel: () => text("cancel", []),
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
    set_viewport: (width, height) => pointer("set_viewport", [width, height]),
    set_cursor: (x, y) => pointer("set_cursor", [x, y]),
    preview: (x, y) => pointer("preview", [x, y]),
    pick: (x, y, aperture) => pointer("pick", [x, y, aperture]),
    snap: (x, y, aperture) => pointer("snap", [x, y, aperture]),
    pointer: (x, y, aperture, nowMs, modifiers) => (resolved.has("pointer") ? text("pointer", [x, y, aperture, nowMs, modifiers]) : stalePointer(x, y, aperture)),
    click: (x, y, aperture) => (resolved.has("click") ? text("click", [x, y, aperture]) : typedClick(x, y)),
    grips: () => pointer("grips", []),
    grip_at: (x, y, aperture) => pointer("grip_at", [x, y, aperture]),
    grip_start: (idsJson) => (resolved.has("grip_start") ? text("grip_start", [idsJson]) : withError(text("prompt", []), STALE_MESSAGE)),
    grip_options: (id) => pointer("grip_options", [id]),
    grip_option: (id, option) => (resolved.has("grip_option") ? text("grip_option", [id, option]) : withError(text("prompt", []), STALE_MESSAGE)),
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
