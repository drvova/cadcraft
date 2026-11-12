/**
 * Boot: build the facade (real wasm when `crates/wasm` is built, the mock otherwise), then mount
 * the app. The chosen mode is shown in the top bar and is what the screenshot reports.
 *
 * With `?shell=slab` the outer layout is Slab's (`./slab`): its parts are loaded here, before the
 * first paint, and only then. Without the switch none of it is requested.
 */

import { render } from "solid-js/web";
import { App } from "./app";
import { createFacade } from "./facade";
import { shellChoice } from "./slab/switch";
import type { SlabParts } from "./slab/parts";
import "./tokens.css";
import "./ui/ui.css";
import "./styles.css";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("index.html is missing #app");
}

/** The Slab shell's parts, or the one line that says why the standard shell is shown instead. */
interface SlabBoot {
  parts?: SlabParts;
  notice?: string;
}

async function loadSlabParts(): Promise<SlabBoot> {
  const { loadSlab } = await import("./slab/loader");
  const shell = await loadSlab("shell");
  if (!shell.ok) return { notice: shell.reason };
  const [{ SlabShell }, bench] = await Promise.all([import("./slab/SlabShell"), loadSlab("bench")]);
  if (!bench.ok) return { parts: { Shell: SlabShell }, notice: bench.reason };
  const { SlabBench } = await import("./slab/SlabBench");
  return { parts: { Shell: SlabShell, Bench: SlabBench } };
}

const [facade, slab] = await Promise.all([createFacade(), shellChoice(window.location.search) === "slab" ? loadSlabParts() : Promise.resolve<SlabBoot>({})]);
render(() => <App facade={facade} slab={slab.parts} shellNotice={slab.notice} />, root);
