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
import { SLAB_ABSENT, shellChoice, slabPartNotice } from "./slab/switch";
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

/** The dialogs whose body Slab draws, each when its document loads; the SolidJS one is shown otherwise. */
async function withDialogs(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const [prices, jewelry] = await Promise.all([loadSlab("pricebook"), loadSlab("jewelry-dialog")]);
  const parts: SlabParts = { ...boot.parts };
  if (prices.ok) parts.PriceBook = (await import("./slab/SlabPriceBook")).SlabPriceBook;
  if (jewelry.ok) {
    const { SlabRing, SlabGem } = await import("./slab/SlabJewelry");
    parts.Ring = SlabRing;
    parts.Gem = SlabGem;
  }
  const notice = boot.notice ?? (!prices.ok ? slabPartNotice("Price Book dialog", prices.reason) : !jewelry.ok ? slabPartNotice("Ring and Gem dialogs", jewelry.reason) : undefined);
  return notice === undefined ? { parts } : { parts, notice };
}

/** The ribbon, added to the parts when its document loads; the SolidJS strip shows when it does not. */
async function withRibbon(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const ribbon = await loadSlab("ribbon");
  if (!ribbon.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("ribbon", ribbon.reason) };
  const { SlabRibbon } = await import("./slab/SlabRibbon");
  return { ...boot, parts: { ...boot.parts, Ribbon: SlabRibbon } };
}

/** The title bar, added to the parts when its document loads; the SolidJS bar shows when it does not. */
async function withTopBar(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const topbar = await loadSlab("topbar");
  if (!topbar.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("title bar", topbar.reason) };
  const { SlabTopBar } = await import("./slab/SlabTopBar");
  return { ...boot, parts: { ...boot.parts, TopBar: SlabTopBar } };
}

/** The dialogs with kernel buttons, ticks, tabs and tables in their bodies, each when its document loads. */
async function withMoreDialogs(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const [drafting, templates] = await Promise.all([loadSlab("drafting"), loadSlab("template-gallery")]);
  const parts: SlabParts = { ...boot.parts };
  if (drafting.ok) parts.Drafting = (await import("./slab/SlabDrafting")).SlabDrafting;
  if (templates.ok) parts.Templates = (await import("./slab/SlabTemplateGallery")).SlabTemplateGallery;
  const notice = boot.notice ?? (!drafting.ok ? slabPartNotice("Drafting Settings dialog", drafting.reason) : !templates.ok ? slabPartNotice("template gallery", templates.reason) : undefined);
  return { parts, ...(notice === undefined ? {} : { notice }) };
}

/** The command line, added to the parts when its document loads; the SolidJS one shows when it does not. */
async function withCommandLine(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const cmdline = await loadSlab("cmdline");
  if (!cmdline.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("command line", cmdline.reason) };
  const { SlabCommandLine } = await import("./slab/SlabCommandLine");
  return { ...boot, parts: { ...boot.parts, CommandLine: SlabCommandLine } };
}

/** The assistant panel's frame, added to the parts when its document loads; the SolidJS panel shows when it does not. */
async function withAssistant(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const assistant = await loadSlab("assistant");
  if (!assistant.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("assistant", assistant.reason) };
  const { SlabAssistant } = await import("./slab/SlabAssistant");
  return { ...boot, parts: { ...boot.parts, Assistant: SlabAssistant } };
}

/** The command palette's list, added to the parts when its document loads; the SolidJS palette shows when it does not. */
async function withPalette(boot: SlabBoot): Promise<SlabBoot> {
  if (boot.parts === undefined) return boot;
  const { loadSlab } = await import("./slab/loader");
  const palette = await loadSlab("palette");
  if (!palette.ok) return { ...boot, notice: boot.notice ?? slabPartNotice("command palette", palette.reason) };
  const { SlabPalette } = await import("./slab/SlabPalette");
  return { ...boot, parts: { ...boot.parts, Palette: SlabPalette } };
}

const ask = shellChoice(window.location.search);
/** A checkout that never built Slab shows the standard shell without a word, unless Slab was asked for by name. */
const quietWhenAbsent = (boot: SlabBoot): SlabBoot => (!ask.asked && boot.parts === undefined && boot.notice === SLAB_ABSENT ? {} : boot);
const [facade, slab] = await Promise.all([createFacade(), ask.shell === "slab" ? loadSlabParts().then(quietWhenAbsent).then(withLayers).then(withPiece).then(withObjects).then(withProperties).then(withChromeParts).then(withDialogs).then(withMoreDialogs).then(withRibbon).then(withTopBar).then(withCommandLine).then(withAssistant).then(withPalette) : Promise.resolve<SlabBoot>({})]);
render(() => <App facade={facade} slab={slab.parts} shellNotice={slab.notice} />, root);
