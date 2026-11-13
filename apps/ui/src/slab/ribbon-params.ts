/**
 * The ribbon as the Slab document takes it (`slab/ribbon.slab`): the tab row's list, the band's
 * groups with the tools that fit, and what each one says. The model is the SolidJS strip's
 * (`../ribbon`: the tabs, their groups, `toolsFit`, `foldedRows`), and so are a tool's words
 * (`../components/ToolStrip`: `toolNote`, `toolHint`). What this file adds is what the SolidJS
 * strip reads from the page and a Slab surface has to know before it is laid out: where each
 * tool of a tab ends when all of them stand in a row, worked out from the same measures the
 * document draws with and the page's own text widths (`./measure`).
 *
 * Pure: no DOM, no kernel. The tests drive all of it.
 */

import { shortcutLabel } from "../commands";
import { toolHint, toolNote } from "../components/ToolStrip";
import { RIBBON, toolCaption, toolsFit, type RibbonTab, type ToolbarEntry } from "../ribbon";
import { paramText } from "./bench-params";
import type { SlabHint } from "./chrome-hints";
import type { TextMeasure } from "./measure";
import { glyphName } from "./ribbon-icons";
import { itemOfKey } from "./scene";

/** One item of the document's `tabs` list: a `RibbonTabKey`. */
export interface RibbonTabParam {
  /** The item's identity in the kernel: the tab's id. */
  key: string;
  name: string;
  /** The tab whose tools the band holds. */
  front: boolean;
  /** Every tab but the first: the room between two tabs is before it. */
  lead: boolean;
  /** The widest the tab may be, in px. */
  cap: number;
}

/** One item of a group's `tools` list: a `RibbonTool`. */
export interface RibbonToolParam {
  /** The item's identity in the kernel: the tool's place among the tab's tools. */
  key: string;
  /** The tool's accessible name: the command's label. */
  name: string;
  /** The word drawn under the glyph. */
  face: string;
  /** The accessible description: what the hint adds, and the shortcut. */
  said: string;
  /** The name of the glyph's declaration in the document. */
  glyph: string;
  /** The one-row ribbon's icon key. */
  slim: boolean;
  /** The engine will not run the tool now. */
  off: boolean;
  /** The tool's command is the one running. */
  on: boolean;
  /** Every tool but its group's first: the room between two tools is before it. */
  lead: boolean;
  /** The one-row ribbon under a finger: the keys stand further apart. */
  wide: boolean;
}

/** One item of the document's `groups` list: a `RibbonGroup`. */
export interface RibbonGroupParam {
  /** The item's identity in the kernel: the group's place in the band. */
  key: string;
  name: string;
  /** A hairline stands before the group. */
  lead: boolean;
  slim: boolean;
  /** The widest the caption may be, in px. */
  cap: number;
  tools: RibbonToolParam[];
}

/**
 * The measures the fit is worked out with: the document's own (`slab/ribbon.slab` and the tokens
 * it imports), restated here as the values `../tokens.css` gives them so the fit can be worked out
 * before a surface has solved a frame, and read back from the surface after (`ribbonMetrics`).
 */
export interface RibbonMetrics {
  /** A labelled tool is never narrower than this, and its label stands this far from each side. */
  toolMin: number;
  toolPad: number;
  /** A tool's glyph, and an icon key's box (a slim tool, the overflow key). */
  glyph: number;
  key: number;
  /** Between two tools of a group: in the band, in the one-row ribbon, and there under a finger. */
  toolGap: number;
  slimGap: number;
  slimGapCoarse: number;
  /** A group's hairline, and the room on each side of it in the band and in the one-row ribbon. */
  rule: number;
  ruleGap: number;
  slimRuleGap: number;
  /** Before the overflow key: in the band, and in the one-row ribbon. */
  moreGap: number;
  slimMoreGap: number;
  /** The band's inset at each end, and the room after the one-row ribbon's select. */
  bandPad: number;
  pickGap: number;
}

export const RIBBON_METRICS: RibbonMetrics = { toolMin: 41, toolPad: 6, glyph: 16, key: 24, toolGap: 2, slimGap: 2, slimGapCoarse: 6, rule: 1, ruleGap: 6, slimRuleGap: 4, moreGap: 4, slimMoreGap: 2, bandPad: 6, pickGap: 6 };

/** The same measures read from a surface's tokens (`getToken`); a token that is not a length keeps its default. */
export function ribbonMetrics(token: (path: string) => unknown): RibbonMetrics {
  const read = (path: string, fallback: number): number => {
    const value = token(path);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4096 ? value : fallback;
  };
  const d = RIBBON_METRICS;
  const g2 = read("space.g2", d.toolGap);
  const g4 = read("space.g4", d.moreGap);
  const g6 = read("space.g6", d.toolPad);
  return {
    toolMin: read("ribbon.tool-min", d.toolMin),
    toolPad: g6,
    glyph: read("size.icon-size-lg", d.glyph),
    key: read("size.control-h-input", d.key),
    toolGap: g2,
    slimGap: g2,
    slimGapCoarse: g6,
    rule: read("size.hairline", d.rule),
    ruleGap: g6,
    slimRuleGap: g4,
    moreGap: g4,
    slimMoreGap: g2,
    bandPad: g6,
    pickGap: g6,
  };
}

/** How the ribbon is arranged: the band of labelled tools, or the one row of icon keys (`slim`), there under a finger or not. */
export interface RibbonArrangement {
  slim: boolean;
  coarse: boolean;
}

/** The most tools of one tab that are laid out (a tab holds a dozen). */
export const MAX_TAB_TOOLS = 256;

/** A tab's tools in the band's order, capped. */
export function tabTools(tab: RibbonTab): ToolbarEntry[] {
  return tab.groups.flatMap((group) => group.tools).slice(0, MAX_TAB_TOOLS);
}

/** How wide one tool is drawn. */
export function toolWidth(entry: ToolbarEntry, how: RibbonArrangement, measure: TextMeasure, m: RibbonMetrics): number {
  if (how.slim) return m.key;
  return Math.max(m.toolMin, 2 * m.toolPad + Math.max(m.glyph, measure("chip", paramText(toolCaption(entry)))));
}

/**
 * Where each tool of a tab ends when every one is laid out, measured from the band's first tool
 * (what the SolidJS strip reads from the page for `toolsFit`). A group is as wide as its tools or
 * its caption, whichever is wider, and every group but the first has its hairline before it.
 */
export function toolEnds(tab: RibbonTab, how: RibbonArrangement, measure: TextMeasure, m: RibbonMetrics): number[] {
  const ends: number[] = [];
  const gap = how.slim ? (how.coarse ? m.slimGapCoarse : m.slimGap) : m.toolGap;
  let start = 0;
  tab.groups.forEach((group, index) => {
    if (ends.length >= MAX_TAB_TOOLS) return;
    if (index > 0) start += m.rule + 2 * (how.slim ? m.slimRuleGap : m.ruleGap);
    let at = start;
    group.tools.forEach((entry, place) => {
      if (ends.length >= MAX_TAB_TOOLS) return;
      if (place > 0) at += gap;
      at += toolWidth(entry, how, measure, m);
      ends.push(at);
    });
    const caption = how.slim ? 0 : measure("chip", paramText(group.name));
    start += Math.max(at - start, caption);
  });
  return ends;
}

/**
 * The room the tools have in a ribbon `width` wide: the band less its insets, and in the one-row
 * ribbon less the select (`pick`) and the room after it. Never less than nothing.
 */
export function toolRoom(width: number, how: RibbonArrangement, pick: number, m: RibbonMetrics): number {
  if (!Number.isFinite(width)) return Number.NaN;
  const taken = 2 * m.bandPad + (how.slim ? (Number.isFinite(pick) && pick > 0 ? pick : 0) + m.pickGap : 0);
  return Math.max(0, width - taken);
}

/**
 * How many leading tools of a tab are drawn in a ribbon `width` wide: the SolidJS strip's own rule
 * (`toolsFit`) over the ends worked out here. A ribbon that has no width yet folds nothing.
 */
export function toolsShown(tab: RibbonTab, how: RibbonArrangement, width: number, pick: number, measure: TextMeasure, m: RibbonMetrics): number {
  const ends = toolEnds(tab, how, measure, m);
  if (!(width > 0)) return ends.length;
  return toolsFit(ends, toolRoom(width, how, pick, m), m.key + (how.slim ? m.slimMoreGap : m.moreGap));
}

/** The item key of the tool at a place among its tab's tools. Keys are by place, so a tool that folds away removes the last key only. */
const toolKey = (place: number): string => `tool-${place}`;
const groupKey = (place: number): string => `group-${place}`;

/** The mark that joins a description's parts: a full stop, as the hint's second line is written. */
const said = (parts: readonly (string | undefined)[]): string => paramText(parts.filter((part): part is string => part !== undefined && part !== "").join(". "));

/** What the band shows, beyond the tab in front. */
export interface RibbonView extends RibbonArrangement {
  /** How many leading tools are drawn (`toolsShown`). */
  shown: number;
  /** The engine's answer for a command id: whether it can run now. */
  enabled: (id: string) => boolean;
  /** The id of the command that is running, when one is. */
  running: string | null;
  /** The shortcuts are written for a Mac. */
  mac: boolean;
}

/**
 * The band's groups with the tools that are drawn. A group with no tool drawn is absent; one
 * drawn in part keeps its caption under the tools that show (`cap`). `measure` and `m` are the
 * ones the fit was worked out with.
 */
export function groupParams(tab: RibbonTab, view: RibbonView, measure: TextMeasure, m: RibbonMetrics): RibbonGroupParam[] {
  const groups: RibbonGroupParam[] = [];
  const shown = Number.isFinite(view.shown) ? Math.max(0, Math.min(MAX_TAB_TOOLS, Math.floor(view.shown))) : MAX_TAB_TOOLS;
  let place = 0;
  for (const group of tab.groups) {
    const tools: RibbonToolParam[] = [];
    let width = 0;
    for (const entry of group.tools) {
      if (place >= shown) break;
      const live = view.enabled(entry.id);
      const keys = entry.shortcut === "" ? undefined : shortcutLabel(entry.shortcut, view.mac);
      if (tools.length > 0) width += m.toolGap;
      width += toolWidth(entry, view, measure, m);
      tools.push({
        key: toolKey(place),
        name: paramText(entry.label),
        face: view.slim ? "" : paramText(toolCaption(entry)),
        said: said([toolNote(entry, live), keys]),
        glyph: glyphName(entry.icon),
        slim: view.slim,
        off: !live,
        on: live && view.running !== null && view.running === entry.id,
        lead: tools.length > 0,
        wide: view.slim && view.coarse,
      });
      place += 1;
    }
    if (tools.length === 0) break;
    const whole = tools.length === group.tools.length;
    groups.push({ key: groupKey(groups.length), name: paramText(group.name), lead: groups.length > 0, slim: view.slim, cap: whole || view.slim ? OPEN_CAP : Math.ceil(width), tools });
    if (!whole) break;
  }
  return groups;
}

/** A caption with no cap: the document's `ribbon.open`. */
export const OPEN_CAP = 100_000;

/** The tab row's list. `cap` is the widest a tab may be, in px. */
export function tabParams(front: string, cap: number): RibbonTabParam[] {
  const width = Number.isFinite(cap) && cap > 0 ? Math.min(cap, 4096) : 0;
  return RIBBON.map((tab, index) => ({ key: tab.id, name: paramText(tab.label), front: tab.id === front, lead: index > 0, cap: width }));
}

/**
 * The tool the item key of a signal stands for, among the tools of `tab` that are drawn. Null for
 * a key that names none of them, so a stale or forged signal starts nothing.
 */
export function pressedTool(tab: RibbonTab, shown: number, itemKey: string): ToolbarEntry | null {
  const m = /^tool-(\d{1,3})$/.exec(itemKey);
  if (m === null) return null;
  const place = Number(m[1]);
  if (!(place < shown)) return null;
  return tabTools(tab)[place] ?? null;
}

/**
 * Whether the control of the tool bar with this key is about to go, when the band is next drawn
 * up to its first `shown` tools: a tool at a place that folds away, or the overflow key (`more`
 * says whether there will be one). A key of no control of the bar does not go.
 */
export function keyGoes(key: string, shown: number, more: boolean): boolean {
  if (key.endsWith("/#more")) return !more;
  const m = /^tool-(\d{1,3})$/.exec(itemOfKey(key));
  return m !== null && !(Number(m[1]) < shown);
}

/** The tab the item key of a signal stands for; null when it names none. */
export function pressedTab(itemKey: string): RibbonTab | null {
  return RIBBON.find((tab) => tab.id === itemKey) ?? null;
}

/**
 * A tool's hint, as the SolidJS strip's control carries it: a labelled tool adds its note (or its
 * label again beside a key cap, which a hint that only repeats the label is not drawn without);
 * an icon key says its label, with the note under it.
 */
export function toolHintFor(entry: ToolbarEntry, live: boolean, slim: boolean, mac: boolean): SlabHint | null {
  const keys = entry.shortcut === "" ? undefined : shortcutLabel(entry.shortcut, mac);
  const cap = keys === undefined ? {} : { keys };
  if (slim) {
    const note = toolNote(entry, live);
    return { text: entry.label, ...cap, ...(note === undefined ? {} : { note }) };
  }
  const text = toolHint(entry, live);
  return text === undefined ? null : { text, ...cap, shows: toolCaption(entry) };
}

/** What the fold key would do, as its hint and its description say it. */
export function foldSaid(folded: boolean): string {
  return folded ? "Show the tools" : "Hide the tools";
}

/** What the tab row holds between two presses: the tab in front, the fold, and whether the last single press unfolded the band. */
export interface RibbonHead {
  tab: string;
  folded: boolean;
  /** The first press of a double press now arriving was the one that brought the band back. */
  broughtBack: boolean;
}

/**
 * The tab row after a tab was asked for, as the SolidJS strip's `pick` and its double click
 * together decide it. `clicks` is how many presses in a row this one is (0 for Enter or Space on
 * the tab); null is an arrow key, which brings the tab's tools to the front and unfolds nothing.
 * A press brings the band back; the second of a double press folds it away, unless the first was
 * the one that brought it back.
 */
export function pressTab(head: RibbonHead, id: string, clicks: number | null): RibbonHead {
  if (clicks === null) return { tab: id, folded: head.folded, broughtBack: head.folded };
  if (!(clicks >= 2)) return { tab: id, folded: false, broughtBack: head.folded };
  // The DOM's double click comes with every second press of a run.
  if (clicks % 2 === 0) return { tab: id, folded: !head.broughtBack, broughtBack: false };
  return { tab: id, folded: false, broughtBack: head.broughtBack };
}

/** A solved node of the surface, as far as the hit test reads it. */
export interface RibbonBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  role?: unknown;
}

/**
 * The key of the control with a hint under a point of the surface (in its own px): a tool, the
 * overflow key or the fold key. Null over anything else (a tab, a caption, the band itself), and
 * for a point that is no point. The host asks on a move of the pointer, where a `pointer-move`
 * binder in the document would have the kernel solve a frame for every move.
 */
export function controlAt(scene: readonly RibbonBox[], x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const node of scene) {
    if (node.role !== "button" || !(x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h)) continue;
    const stop = stopOfKey(node.key);
    if (stop === "tools" || stop === "fold") return node.key;
  }
  return null;
}

/** The stops the Tab key makes in the ribbon, in order: the tab row, the fold key, the tools. */
export type RibbonStop = "tabs" | "fold" | "tools";

/** Which stop a focused node of the document belongs to, by its role and its key; null for a node of none. */
export function stopOfKey(key: string): RibbonStop | null {
  if (key.includes("/#tabs/")) return "tabs";
  if (key.endsWith("/#fold")) return "fold";
  if (key.includes("/#bar/")) return "tools";
  return null;
}

/**
 * Where Tab (or Shift+Tab, `back`) goes from a stop: the next stop that is there, or null when the
 * key leaves the ribbon. The one-row ribbon has the tools alone (its select is the page's own
 * stop); a folded band has no tools.
 */
export function nextStop(from: RibbonStop, back: boolean, has: { head: boolean; tools: boolean }): RibbonStop | null {
  const order: RibbonStop[] = [...(has.head ? (["tabs", "fold"] as const) : []), ...(has.tools ? (["tools"] as const) : [])];
  const at = order.indexOf(from);
  if (at < 0) return null;
  return order[at + (back ? -1 : 1)] ?? null;
}
