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

/** The Layers section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withLayers(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const layers = await loadSlab("layers");
  if (!layers.ok) return { ...boot, notice: boot.notice ?? layers.reason };
  const { SlabLayers } = await import("./slab/SlabLayers");
  return { ...boot, parts: { ...boot.parts, Layers: SlabLayers } };
}

/** The Piece section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withPiece(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const piece = await loadSlab("piece");
  if (!piece.ok) return { ...boot, notice: boot.notice ?? piece.reason };
  const { SlabPiece } = await import("./slab/SlabPiece");
  return { ...boot, parts: { ...boot.parts, Piece: SlabPiece } };
}

/** The Objects section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withObjects(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const objects = await loadSlab("objects");
  if (!objects.ok) return { ...boot, notice: boot.notice ?? objects.reason };
  const { SlabObjects } = await import("./slab/SlabObjects");
  return { ...boot, parts: { ...boot.parts, Objects: SlabObjects } };
}

const [facade, slab] = await Promise.all([createFacade(), shellChoice(window.location.search) === "slab" ? loadSlabParts().then(withLayers).then(withPiece).then(withObjects) : Promise.resolve<SlabBoot>({})]);
render(() => <App facade={facade} slab={slab.parts} shellNotice={slab.notice} />, root);
