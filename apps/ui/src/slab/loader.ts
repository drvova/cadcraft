/**
 * The only module that touches the Slab artifacts (`../slab-vendor/`, built by
 * `scripts/build-slab.mjs`, git-ignored). As with the engine's wasm (`../wasm-loader.ts`),
 * `import.meta.glob` resolves at Vite's build time and finds nothing when the directory is
 * absent, so the interface builds and runs either way; with nothing found the switch says so.
 *
 * Nothing here is imported statically by the shell: it is reached by `import()` when the switch
 * is on, so the default interface requests none of it. `bun test` never loads this module
 * (`import.meta.glob` is Vite's).
 */

import { TEXT_STYLES, familyName } from "./tokens";
import { registerFamilies, UI_WEIGHTS, type FamilySpec } from "./fonts";
import { SLAB_ABSENT, slabFailed } from "./switch";
import type { SlabRuntime } from "./types";

type Importer = () => Promise<unknown>;

const runtimeGlob: Record<string, Importer> = import.meta.glob("../slab-vendor/slab-runtime.js");
const documentGlob: Record<string, Importer> = import.meta.glob(["../slab-vendor/*.js", "!../slab-vendor/slab-runtime.js"]);

/** The documents the interface mounts, by file stem, and the element each defines. */
export const SLAB_TAGS = { shell: "cadcraft-shell", bench: "slab-bench-panel", layers: "slab-layers-panel" } as const;
export type SlabDocument = keyof typeof SLAB_TAGS;

export type SlabLoad = { ok: true } | { ok: false; reason: string };

function isRuntime(value: unknown): value is SlabRuntime {
  if (typeof value !== "object" || value === null || !("SlabElement" in value)) return false;
  const element: unknown = value.SlabElement;
  return typeof element === "function" && "registerFontMetrics" in element && typeof element.registerFontMetrics === "function";
}

/** A CSS length of the root in px ("13px" → 13); null when it is not one. */
function rootPx(style: CSSStyleDeclaration, name: string): number | null {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(style.getPropertyValue(name).trim());
  return m === null ? null : Number(m[1]);
}

/**
 * The families the documents name (`./tokens`), each measured in the face the page really paints:
 * the interface's own stacks at the interface's own sizes, read from the live tokens.
 */
function pageFamilies(): FamilySpec[] {
  const style = getComputedStyle(document.documentElement);
  const ui = style.getPropertyValue("--font-family").trim();
  const mono = style.getPropertyValue("--font-family-mono").trim();
  const out: FamilySpec[] = [];
  for (const text of TEXT_STYLES) {
    const size = rootPx(style, `--${text.size}`);
    const css = text.mono ? mono : ui;
    if (size === null || css === "") continue;
    out.push({ name: familyName(text.mono, size), css, size, weights: UI_WEIGHTS });
  }
  return out;
}

let runtime: Promise<SlabLoad> | null = null;

/** Load the web driver and its kernel, and hand it the page's font metrics. Once. */
function loadRuntime(): Promise<SlabLoad> {
  runtime ??= (async (): Promise<SlabLoad> => {
    const importer = runtimeGlob["../slab-vendor/slab-runtime.js"];
    if (importer === undefined) return { ok: false, reason: SLAB_ABSENT };
    try {
      const module = await importer();
      if (!isRuntime(module)) return { ok: false, reason: slabFailed("the runtime is not the patched build; run bun run build:slab again") };
      // Before any surface mounts: a surface takes the faces registered when it loads its document.
      registerFamilies(module.SlabElement, pageFamilies());
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: slabFailed(error instanceof Error ? error.message : String(error)) };
    }
  })();
  return runtime;
}

const loaded = new Map<SlabDocument, Promise<SlabLoad>>();

/** Load a compiled document, so its element is defined. Never throws; says why it could not. */
export function loadSlab(doc: SlabDocument): Promise<SlabLoad> {
  let pending = loaded.get(doc);
  if (pending === undefined) {
    pending = (async (): Promise<SlabLoad> => {
      const ready = await loadRuntime();
      if (!ready.ok) return ready;
      const importer = documentGlob[`../slab-vendor/${doc}.js`];
      if (importer === undefined) return { ok: false, reason: slabFailed(`slab/${doc}.slab is not compiled; run bun run slab:docs`) };
      try {
        await importer();
        await customElements.whenDefined(SLAB_TAGS[doc]);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: slabFailed(error instanceof Error ? error.message : String(error)) };
      }
    })();
    loaded.set(doc, pending);
  }
  return pending;
}
