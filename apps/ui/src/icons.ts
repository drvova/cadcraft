/**
 * The chrome's icons: original code-drawn SVG paths on a 24x24 grid (strokes, arcs, rectangles —
 * no image assets, no icon package). One path per id; a path may hold several subpaths.
 *
 * The grammar every glyph keeps: the drawing fills the box from about 3 to 21, lines end and meet
 * round, nothing is filled, a point a tool takes (an end, a corner) is a ring of radius 2 and a
 * vertex or a centre a smaller dot, and the part of a figure a tool removes or reflects about is
 * dashed. A glyph is drawn from the geometry of what its tool does, never from another product's
 * icon.
 *
 * The stroke is one weight at every size: `STROKE` CSS pixels on the screen whether the glyph is
 * drawn at 12, 14 or 16 (`vector-effect: non-scaling-stroke`), not a width on the 24 grid that
 * thins as the glyph shrinks.
 *
 * The toolbar table lives in `ToolStrip.tsx` and uses these ids (the Save button draws the `save`
 * path but invokes the engine's `qsave` command).
 *
 * This module is `.ts`, so the component is built with Solid's hyperscript instead of JSX.
 */

import h from "solid-js/h";
import type { JSX } from "solid-js";

/** The stroke's width in CSS pixels, at every size a glyph is drawn. */
export const STROKE = 1.25;

/** The id -> `<path d>` map. Every toolbar id has one; ids are unique to each drawing. */
export const ICON_PATHS: Readonly<Record<string, string>> = {
  /** A sheet with a folded corner. */
  new: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6",
  /** A folder with a tab. */
  open: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  /** A floppy disk: shutter and label. */
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 3v6h8V3 M7 21v-7h10v7",
  /** An arrow curving back to the left. */
  u: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-4",
  /** The same arrow mirrored to the right. */
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h4",
  /** A printer: feed slot, body and the emerging sheet. */
  plot: "M7 8V3h10v5 M5 8h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z M7 14h10v7H7z",
  /** A paperclip. */
  attach: "M21 11l-9 9a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7",
  /** A rectangle with a magnifier over its lower-right corner. */
  "zoom.window": "M3 5h9v9H3z M11 14l3 3 M18 13a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
  /** A four-way move cross. */
  pan: "M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3",
  /** Four corner brackets around a small square. */
  "zoom.extents": "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M10 10h4v4h-4z",
  /** A window with a rail down its left side: the sidebar's key. */
  "ui.toggle.palettes": "M4 5h16v14H4z M9 5v14",
  /** Three stacked sheets. */
  "ui.dialog.layers": "M12 3l8 5-8 5-8-5z M4 13l8 5 8-5 M4 17l8 5 8-5",
  /** A ruler laid on the diagonal, with ticks. */
  dist: "M3 17L17 3l4 4L7 21z M8 12l2 2 M11 9l2 2 M14 6l2 2",
  /** Three bullets with three lines: the Main menu key. */
  list: "M4 5h2v2H4z M4 11h2v2H4z M4 17h2v2H4z M9 6h11 M9 12h11 M9 18h11",
  /** A segment between two end grips: the line tool. */
  line: "M6.4 17.6L17.6 6.4 M5 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M19 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** A path bent twice, a dot on each of its four vertices: the polyline tool. */
  polyline:
    "M5.1 17.1L8.9 7.9 M10.3 7.8L13.7 13.2 M15.2 13.2L18.8 6.8 M4.5 17a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3 M9.5 5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3 M14.5 13a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3 M19.5 4a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3",
  /** A quarter arc between two end grips, a dot at its centre: the arc tool. */
  arc: "M5.2 16A13 13 0 0 1 16 5.2 M5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 18h0",
  /** A rectangle held by the two opposite corners that define it: the rectangle tool. */
  rectangle: "M17 6H5v10 M7 18h12V8 M19 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** A closed boundary filled with slanted lines: the hatch tool. */
  hatch: "M4 4h16v16H4z M4 12l8-8 M4 20L20 4 M12 20l8-8",
  /** A capital T with its serifs: the text tool. */
  text: "M5 7V4h14v3 M12 4v16 M9 20h6",
  /** A square and an arrow carrying it up and away: the move tool. */
  move: "M4 12h8v8H4z M13 11l7-7 M14 4h6v6",
  /** A square and its twin set down beside it: the copy tool (`copy` is the clipboard's). */
  "copy-objects": "M4 12h8v8H4z M12 4h8v8h-8z",
  /** A square with an arrow swung a quarter turn round it: the rotate tool. */
  rotate: "M4 11h9v9H4z M9 5a10 10 0 0 1 10 10 M16 12l3 3 3-3",
  /** A triangle and its reflection either side of a dashed mirror line: the mirror tool. */
  mirror: "M12 3v3 M12 10v4 M12 18v3 M8 7v10H3z M16 7v10h5z",
  /** A rounded corner and its parallel at a set distance: the offset tool. */
  offset: "M4 20V10a6 6 0 0 1 6-6h10 M9 20v-9a2 2 0 0 1 2-2h9",
  /** A segment stopped at a cutting edge, a cross where the end it lost was: the trim tool. */
  trim: "M12 3v18 M3 12h9 M16 9.5l5 5 M21 9.5l-5 5",
  /** Two lines joined by an arc, the sharp corner it replaced left as a bracket: the fillet tool. */
  fillet: "M5 20v-7a8 8 0 0 1 8-8h7 M5 8V5h3",
  /** An eraser on its edge over the line it rubs out: the erase tool. */
  erase: "M14 4l7 7-8 8H9l-5-5z M9 9l7 7 M13 19h8",
  /** A span between two extension lines, an arrow at each end, over the edge it measures: the linear dimension tool. */
  "dimension-linear": "M4 4v11 M20 4v11 M4 8h16 M7 5L4 8l3 3 M17 5l3 3-3 3 M4 20h16",
  /** Two tracks with a knob on each: the properties inspector. */
  properties: "M4 8h9 M17 8h3 M15 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M4 16h3 M11 16h9 M9 14a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** An arrow rising out of a floor line: send (the composer's right-hand action). */
  send: "M12 19V5 M6 11l6-6 6 6",
  /** A solid square: stop. */
  stop: "M7 7h10v10H7z",
  /** A plus: new chat. */
  plus: "M12 5v14 M5 12h14",
  /** A cross: close the panel. */
  close: "M6 6l12 12 M18 6L6 18",
  /** A ring: a circle suggestion. */
  circle: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18",
  /** A right chevron: a collapsed activity row (the transcript's trailing marker). */
  "chevron-right": "M9 6l6 6-6 6",
  /** A down chevron: an open activity row. */
  "chevron-down": "M6 9l6 6 6-6",
  /** Two offset sheets: copy the message or code. */
  copy: "M9 9h10v10H9z M15 5H5v10",
  /** A circular arrow: retry the turn. */
  retry: "M20 12a8 8 0 1 1-2.6-5.9 M20 4v5h-5",
  /** A pointer arrow: the canvas selection riding in the composer. */
  pick: "M5 3l14 8-6.5 1.8L10 19z",
  /** An open eye: the layer is on. */
  "layer.on": "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
  /** The eye struck through: the layer is off. */
  "layer.off": "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M4 4l16 16",
  /** A snowflake: the layer is frozen. */
  "layer.frozen": "M12 3v18 M4.2 7.5l15.6 9 M19.8 7.5l-15.6 9 M9.5 4.5L12 7l2.5-2.5 M9.5 19.5L12 17l2.5 2.5",
  /** A sun: the layer is thawed. */
  "layer.thawed": "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2",
  /** A closed padlock: the layer is locked. */
  "layer.locked": "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  /** A padlock with its shackle swung open: the layer is unlocked. */
  "layer.unlocked": "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1",
  /** A magnifier: the command centre and the palette's field. */
  search: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13 M15.5 15.5L20 20",
  /** A window with a band along its foot: the command line's panel. */
  "layout.bottom": "M4 5h16v14H4z M4 14.5h16",
  /** A lens with a pupil: a masked value is showing (the key field's show and hide). */
  eye: "M3 12a10.5 10.5 0 0 1 18 0a10.5 10.5 0 0 1-18 0z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  /** The empty lens struck through: the value is masked. */
  "eye-off": "M3 12a10.5 10.5 0 0 1 18 0a10.5 10.5 0 0 1-18 0z M5.5 4.5l13 15",
  /** A four-point spark with a small plus: the assistant's toggle in the top bar. */
  assistant: "M11 4l1.8 5.2L18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8z M19 15v4 M17 17h4",
};

/**
 * The assistant's icons (`AssistantPane.tsx`): the composer's send and stop glyphs, the
 * transcript's and the header's keys, the attach key's paperclip, and the provider form's `eye`
 * and `eye-off` (a masked field's show and hide). They live in this map because it is the one icon set, and this list is
 * what lets the icon test tell a used path from an orphan one.
 */
export const COMPOSER_ICONS: readonly string[] = ["send", "stop", "plus", "close", "chevron-right", "chevron-down", "copy", "retry", "circle", "pick", "assistant", "eye", "eye-off", "attach"];

/** The shell's own glyphs: the layers palette's states (on, frozen and locked, each with its
 *  opposite; `LayersPanel.tsx`), the command centre's magnifier, the sidebar key and the panel key
 *  (`TopBar.tsx`), and the Main menu key's list (`MenuBar.tsx`). */
export const PANEL_ICONS: readonly string[] = ["layer.on", "layer.off", "layer.frozen", "layer.thawed", "layer.locked", "layer.unlocked", "search", "layout.bottom", "ui.toggle.palettes", "list"];

/** The path for a toolbar id, or null when there is none. */
export function iconPath(id: string): string | null {
  return Object.hasOwn(ICON_PATHS, id) ? (ICON_PATHS[id] ?? null) : null;
}

/** An icon: the 24x24 stroke frame around the id's path (null ids draw an empty frame). The path
 *  carries the non-scaling stroke itself: `vector-effect` is not inherited from the frame. */
export function ToolIcon(props: { id: string }): JSX.Element {
  const path = iconPath(props.id);
  const svg = h(
    "svg",
    {
      class: "tool-icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": String(STROKE),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    path === null ? undefined : h("path", { d: path, "vector-effect": "non-scaling-stroke" }),
  );
  return svg();
}
