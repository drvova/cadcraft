/**
 * The widths of the Slab shell's side panes, kept by the host: what the reader last dragged the
 * sidebar and the assistant to, remembered in this browser, and put back whenever the kernel's
 * split container would let them drift.
 *
 * Slab's `splits` (SPEC §6.12) keeps one size per pane and rescales all of them in proportion
 * when the row's width changes or a pane leaves. An editor wants the other thing: the side panes
 * keep their pixels and the editor takes what is left. So after every solve the host compares the
 * panes with these targets and writes the targets back (`setSplit`) when they differ. The kernel
 * still owns the drag, the clamps, the keyboard and which panes show at all.
 */

import { isRecord } from "../json";

export interface PaneWidths {
  side: number;
  chat: number;
}

/** The three panes of the row, by the names the shell's document gives them. */
export interface PaneSizes {
  side: number;
  editor: number;
  chat: number;
}

/** Where the widths are remembered. */
export const PANES_KEY = "cadcraft.shell.panes";

/** The widest a remembered pane is believed (the document clamps to its own, narrower, limits). */
const MAX_PANE = 4_000;
const MIN_PANE = 40;

const believable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= MIN_PANE && v <= MAX_PANE;

/** The remembered widths; the defaults for anything missing, malformed or absurd. */
export function readPaneWidths(stored: string | null, defaults: PaneWidths): PaneWidths {
  if (stored === null || stored.length > 200) return { ...defaults };
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return { ...defaults };
  }
  if (!isRecord(raw)) return { ...defaults };
  const side = raw["side"];
  const chat = raw["chat"];
  return { side: believable(side) ? Math.round(side) : defaults.side, chat: believable(chat) ? Math.round(chat) : defaults.chat };
}

export function writePaneWidths(widths: PaneWidths): string {
  return JSON.stringify({ side: Math.round(widths.side), chat: Math.round(widths.chat) });
}

/** A pane is on screen when the kernel gave it room. */
const shown = (size: number): boolean => Number.isFinite(size) && size >= 1;

/**
 * The sizes the panes should have in a row `total` wide, given which of them the kernel is
 * showing (`solved`: a hidden pane is 0 wide there). A side pane that shows beside the editor has
 * its remembered width; the editor has the rest; a pane alone in the row has all of it.
 */
export function targetSizes(total: number, widths: PaneWidths, solved: PaneSizes): PaneSizes {
  const width = Number.isFinite(total) && total > 0 ? total : 0;
  const editor = shown(solved.editor);
  let side = shown(solved.side) ? widths.side : 0;
  let chat = shown(solved.chat) ? widths.chat : 0;
  if (!editor) {
    // One part has the workspace: the assistant before the sidebar, as the document shows them.
    if (chat > 0) return { side: 0, editor: 0, chat: width };
    return { side: side > 0 ? width : 0, editor: 0, chat: 0 };
  }
  // The side panes never take more than the row has: the assistant gives way last.
  if (side + chat > width) side = Math.max(0, width - chat);
  if (chat > width) chat = width;
  return { side, editor: Math.max(0, width - side - chat), chat };
}

/** Whether the solved sizes are the targets, to the half pixel the kernel rounds within. */
export function sizesMatch(solved: PaneSizes, target: PaneSizes, tolerance = 0.75): boolean {
  return Math.abs(solved.side - target.side) <= tolerance && Math.abs(solved.editor - target.editor) <= tolerance && Math.abs(solved.chat - target.chat) <= tolerance;
}

/**
 * The widths to remember after the reader let go of a divider: a pane showing beside the editor
 * has the width it was dragged to; one that is hidden, or alone in the row, keeps what it had.
 */
export function widthsAfterDrag(previous: PaneWidths, solved: PaneSizes): PaneWidths {
  if (!shown(solved.editor)) return { ...previous };
  return {
    side: shown(solved.side) ? Math.round(solved.side) : previous.side,
    chat: shown(solved.chat) ? Math.round(solved.chat) : previous.chat,
  };
}

/** The window's width class, from the breakpoints the shell's document declares. */
export function widthClass(width: number, narrowAt: number, compactAt: number): { narrow: boolean; compact: boolean } {
  if (!Number.isFinite(width) || width <= 0) return { narrow: false, compact: false };
  return { narrow: width <= narrowAt, compact: width <= compactAt };
}
