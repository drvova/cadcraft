/**
 * The chrome's icons: original code-drawn SVG paths on a 24x24 grid (strokes, arcs, rectangles —
 * no image assets, no icon package). One path per toolbar id; a path may hold several subpaths.
 *
 * The toolbar table lives in `ToolStrip.tsx` and uses these ids (the Save button draws the `save`
 * path but invokes the engine's `qsave` command, exactly as `chrome.rs`'s `TOOLBAR` does).
 *
 * This module is `.ts`, so the component is built with Solid's hyperscript instead of JSX.
 */

import h from "solid-js/h";
import type { JSX } from "solid-js";

/** The id -> `<path d>` map. Every toolbar id has one; ids are unique to each drawing. */
export const ICON_PATHS: Readonly<Record<string, string>> = {
  /** A sheet with a folded corner. */
  new: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6",
  /** A folder with a tab. */
  open: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  /** A floppy disk: shutter and label. */
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 3v6h8V3 M7 21v-7h10v7",
  /** A floppy disk with an arrow leaving its open corner. */
  saveas: "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M8 3v5h5V3 M6 21v-6h10v6 M15 8h6 M18 5l3 3-3 3",
  /** An arrow curving back to the left. */
  u: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-4",
  /** The same arrow mirrored to the right. */
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h4",
  /** A printer: feed slot, body and the emerging sheet. */
  plot: "M7 8V3h10v5 M5 8h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z M7 14h10v7H7z",
  /** A cloud with an arrow rising into it. */
  publish: "M7 18a4 4 0 0 1 0-8a5 5 0 0 1 9-2a4 4 0 0 1 3 10z M12 21v-8 M9 16l3-3 3 3",
  /** A page with margin ticks down its left edge. */
  pagesetup: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M5 8h4 M5 12h4 M5 16h4",
  /** An eye with a pupil. */
  preview: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  /** An arrow falling into a tray. */
  import: "M12 3v10 M8 9l4 4 4-4 M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  /** An arrow rising out of a tray. */
  export: "M12 14V4 M8 8l4-4 4 4 M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  /** A paperclip. */
  attach: "M21 11l-9 9a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7",
  /** Three nodes joined by two edges. */
  share: "M6 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M8 11l8-5 M8 13l8 5",
  /** A rectangle with a magnifier over its lower-right corner. */
  "zoom.window": "M3 5h9v9H3z M11 14l3 3 M18 13a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
  /** A four-way move cross. */
  pan: "M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3",
  /** An orbit: an ellipse with a body on it. */
  "3dorbit": "M3 15a9 5 0 1 0 18 0a9 5 0 1 0-18 0 M15 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** Four corner brackets around a small square. */
  "zoom.extents": "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M10 10h4v4h-4z",
  /** A window with a rail down its left side. */
  "ui.toggle.palettes": "M4 5h16v14H4z M9 5v14",
  /** Three stacked sheets. */
  "ui.dialog.layers": "M12 3l8 5-8 5-8-5z M4 13l8 5 8-5 M4 17l8 5 8-5",
  /** Four blocks in a two-by-two grid. */
  "ui.dialog.blocks": "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  /** A ruler laid on the diagonal, with ticks. */
  dist: "M3 17L17 3l4 4L7 21z M8 12l2 2 M11 9l2 2 M14 6l2 2",
  /** Three bullets with three lines. */
  list: "M4 5h2v2H4z M4 11h2v2H4z M4 17h2v2H4z M9 6h11 M9 12h11 M9 18h11",
  /** A triangle with two chords across it. */
  area: "M4 19L12 5l8 14z M8 13h8 M10 9h4",
  /** A ring with an information stem. */
  "ui.dialog.about": "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 8h0 M12 11v6",
  /** An arrow rising out of a floor line: send (the composer's right-hand action). */
  send: "M12 19V5 M6 11l6-6 6 6",
  /** A solid square: stop. */
  stop: "M7 7h10v10H7z",
};

/**
 * The composer's icons (`AssistantPane.tsx`): the send and stop glyphs. They live in this map
 * because it is the one icon set, and this list is what lets the icon test tell a used path from
 * an orphan one.
 */
export const COMPOSER_ICONS: readonly string[] = ["send", "stop"];

/** The path for a toolbar id, or null when there is none. */
export function iconPath(id: string): string | null {
  return Object.hasOwn(ICON_PATHS, id) ? (ICON_PATHS[id] ?? null) : null;
}

/** A toolbar icon: the 24x24 stroke frame around the id's path (null ids draw an empty frame). */
export function ToolIcon(props: { id: string }): JSX.Element {
  const path = iconPath(props.id);
  const svg = h(
    "svg",
    {
      class: "tool-icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    path === null ? undefined : h("path", { d: path }),
  );
  return svg();
}
