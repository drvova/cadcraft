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
import { shellChoice, slabPartNotice } from "./slab/switch";
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
  if (!bench.ok) return { parts: { Shell: SlabShell }, notice: slabPartNotice("Bench section", bench.reason) };
  const { SlabBench } = await import("./slab/SlabBench");
  return { parts: { Shell: SlabShell, Bench: SlabBench } };
}

/** The Layers section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withLayers(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const layers = await loadSlab("layers");
  if (!layers.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("Layers section", layers.reason) };
  const { SlabLayers } = await import("./slab/SlabLayers");
  return { ...boot, parts: { ...boot.parts, Layers: SlabLayers } };
}

/** The Piece section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withPiece(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const piece = await loadSlab("piece");
  if (!piece.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("Piece section", piece.reason) };
  const { SlabPiece } = await import("./slab/SlabPiece");
  return { ...boot, parts: { ...boot.parts, Piece: SlabPiece } };
}

/** The Objects section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withObjects(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const objects = await loadSlab("objects");
  if (!objects.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("Objects section", objects.reason) };
  const { SlabObjects } = await import("./slab/SlabObjects");
  return { ...boot, parts: { ...boot.parts, Objects: SlabObjects } };
}

/** The Properties section, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withProperties(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const properties = await loadSlab("properties");
  if (!properties.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("Properties section", properties.reason) };
  const { SlabProperties } = await import("./slab/SlabProperties");
  return { ...boot, parts: { ...boot.parts, Properties: SlabProperties } };
}

/** The status bar and the tabs over the drawing, each when its document loads; the SolidJS one is shown otherwise. */
async function withChromeParts(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const [status, tabs] = await Promise.all([loadSlab("statusbar"), loadSlab("tabs")]);
  const parts: SlabParts = { ...boot.parts };
  if (status.ok) parts.StatusBar = (await import("./slab/SlabStatusBar")).SlabStatusBar;
  if (tabs.ok) parts.Tabs = (await import("./slab/SlabTabs")).SlabTabs;
  const notice = boot.notice ?? (!status.ok ? slabPartNotice("status bar", status.reason) : !tabs.ok ? slabPartNotice("view tabs", tabs.reason) : undefined);
  return notice === undefined ? { parts } : { parts, notice };
}

const [facade, slab] = await Promise.all([createFacade(), shellChoice(window.location.search) === "slab" ? loadSlabParts().then(withLayers).then(withPiece).then(withObjects).then(withProperties).then(withChromeParts) : Promise.resolve<SlabBoot>({})]);
render(() => <App facade={facade} slab={slab.parts} shellNotice={slab.notice} />, root);
