/**
 * The tabs over the drawing as the Slab document takes them (`slab/tabs.slab`): one typed list.
 * Which tabs there are is the SolidJS strip's rule (`../components/StatusBar`: `LayoutTabs`):
 * Model, then the drawing's layouts in their order, then the 3D view when the host offers it.
 * This file shapes that list, caps it (a Slab list is laid out whole) and reads a pressed tab
 * back to the view it stands for.
 */

import { paramText } from "./bench-params";

/** One item of the strip's `tabs` list: a `ViewTab` of the document. */
export interface ViewTabParam {
  /** The item's identity in the kernel: the tab's place in the strip, or the 3D view. */
  key: string;
  /** The tab's label and its accessible name. */
  name: string;
  /** What the tab switches to: its accessible description and its hint. */
  hint: string;
  /** The tab in front. */
  front: boolean;
  /** The widest the tab may be, in px. */
  cap: number;
}

/** What a tab stands for. */
export type ViewTarget = { kind: "layout"; name: string } | { kind: "3d" };

/** The most layouts the strip draws. A drawing with more reaches the rest from the command line. */
export const MAX_VIEW_TABS = 256;

/** The model space's tab: the first, whatever the drawing's layouts are. */
export const MODEL = "Model";

/**
 * Every tab's key is its place in the strip, the 3D tab's too (it is the last). The driver at the
 * pinned commit appends the accessible node of a new list item after its siblings, wherever the
 * item stands in the list: with keys by place a layout that is made or deleted adds or removes
 * the last key only, and the order a screen reader walks stays the order drawn.
 */
const tabKey = (index: number): string => `view-${index}`;

/** The names of the strip's layout tabs, in order: Model, then the drawing's layouts. */
function viewNames(layouts: readonly string[]): string[] {
  return [MODEL, ...layouts.slice(0, MAX_VIEW_TABS - 1)];
}

/**
 * The strip's tabs. `space` is "Model" or the active layout's name; with `view3d` the 3D tab is
 * the one in front and no layout's is; `offers3d` is whether there is a 3D tab at all.
 */
export function viewTabs(layouts: readonly string[], space: string, view3d: boolean, offers3d: boolean, cap: number): ViewTabParam[] {
  const width = Number.isFinite(cap) && cap > 0 ? Math.min(cap, 4096) : 0;
  const tabs = viewNames(layouts).map((name, index) => ({
    key: tabKey(index),
    name: paramText(name),
    hint: paramText(name === MODEL ? "Switch to model space" : `Switch to ${name}`),
    front: !view3d && space === name,
    cap: width,
  }));
  if (offers3d) tabs.push({ key: tabKey(tabs.length), name: "3D", hint: "Show the piece as a solid", front: view3d, cap: width });
  return tabs;
}

/**
 * The view the tab with this item key stands for: a layout by its real name (never the label,
 * which may be shortened), or the 3D view. Null when the key names no tab of the strip, so a
 * stale or forged signal switches nothing.
 */
export function pressedView(itemKey: string, layouts: readonly string[], offers3d: boolean): ViewTarget | null {
  const m = /^view-(\d{1,4})$/.exec(itemKey);
  if (m === null) return null;
  const names = viewNames(layouts);
  const index = Number(m[1]);
  if (offers3d && index === names.length) return { kind: "3d" };
  const name = names[index];
  return name === undefined ? null : { kind: "layout", name };
}

/** Which edges of a strip hide something: it is scrolled past its start, or stops short of its end. */
export function clippedEdges(offset: number, viewport: number, content: number): { start: boolean; end: boolean } {
  if (![offset, viewport, content].every((n) => Number.isFinite(n))) return { start: false, end: false };
  return { start: offset > 0.5, end: offset + viewport < content - 0.5 };
}
