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
 * The strip draws a glyph at 16, where one pixel is 1.5 of the grid: a horizontal or vertical stroke
 * belongs on a pixel's middle (0.75 plus a multiple of 1.5: 3.75, 5.25 ... 20.25), where it is one
 * sharp pixel at ratio 1, and never between two pixels (a multiple of 1.5), where it is a soft pair.
 * `icons.test.ts` holds the strip's glyphs to that and names the older ones that still put a stroke
 * between two pixels. Each strip glyph has one idea that is still there in ten pixels, and no two
 * share a silhouette (a pair of strokes is the offset, one round corner the fillet; a plus on a twin
 * is the copy, a magnifier on a window the zoom).
 *
 * The stroke is one weight at every size: `STROKE` CSS pixels on the screen whether the glyph is
 * drawn at 12, 14 or 16 (`vector-effect: non-scaling-stroke`), not a width on the 24 grid that
 * thins as the glyph shrinks.
 *
 * The ribbon's table lives in `ribbon.ts` and uses these ids (the Save button draws the `save`
 * path but invokes the engine's `qsave` command). The band draws a tool's glyph at the same 16.
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
  new: "M13 3.75H7a2 2 0 0 0-2 2v12.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.75z M13 3.75v6h6",
  /** A folder with a tab. */
  open: "M3.75 5.75a2 2 0 0 1 2-2h3.5l2 3h7a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z",
  /** A floppy disk: shutter and label. */
  save: "M5.75 3.75h11.5l3 3v11.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2z M8.25 3.75v6h7.5v-6 M6.75 20.25v-6h10.5v6",
  /** An arrow curving back to the left. */
  u: "M9 14.75l-5-5 5-5 M4 9.75h10.75a5.25 5.25 0 0 1 0 10.5H10",
  /** The same arrow mirrored to the right. */
  redo: "M15 14.75l5-5-5-5 M20 9.75H9.25a5.25 5.25 0 0 0 0 10.5H14",
  /** A printer: feed slot, body and the emerging sheet. */
  plot: "M6.75 8.25v-4.5h10.5v4.5 M5.75 8.25h12.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z M6.75 14.25h10.5v6h-10.5z",
  /** A paperclip. */
  attach: "M21 11l-9 9a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7",
  /** Three corners of a dragged window, a magnifier standing where the fourth would be: zoom to a window. */
  "zoom.window": "M3.75 8.25v-4.5h4.5 M12 3.75h3.75v3.75 M3.75 12v3.75h3.75 M15.75 11.25a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9 M19 19l2.5 2.5",
  /** A four-way move cross. */
  pan: "M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3",
  /** Four corner brackets around a small square. */
  "zoom.extents": "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M10 10h4v4h-4z",
  /** A window with a rail down its left side: the sidebar's key. */
  "ui.toggle.palettes": "M4 5h16v14H4z M9 5v14",
  /** Three stacked sheets. */
  "ui.dialog.layers": "M12 3l8 5-8 5-8-5z M4 13l8 5 8-5 M4 17l8 5 8-5",
  /** A band seen from the front with its stone on top: the ring blank. */
  ring: "M12 7.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13 M12 2.5l3 2.5-3 2.5-3-2.5z",
  /** A brilliant from the side: the table, the girdle, and the pavilion's facets to the culet. */
  gem: "M7.5 5.25h9l4.5 4.5-9 10.5-9-10.5z M3 9.75h18 M9 9.75l3 10.5 M15 9.75l-3 10.5",
  /** Five small stones in two offset rows: melee laid as a brick pavé. */
  pave: "M6 6a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M12 6a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M18 6a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M9 13a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M15 13a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5",
  /** A stone from above with a prong at each corner. */
  setting: "M12 5.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13 M6 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M6 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** A ruler laid on the diagonal, with ticks. */
  dist: "M3 17L17 3l4 4L7 21z M8 12l2 2 M11 9l2 2 M14 6l2 2",
  /** Three bullets with three lines: the Main menu key. */
  list: "M4 5h2v2H4z M4 11h2v2H4z M4 17h2v2H4z M9 6h11 M9 12h11 M9 18h11",
  /** A segment between two end grips: the line tool. */
  line: "M6.4 17.6L17.6 6.4 M5 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M19 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** One path bent twice between two end grips: the polyline tool (the line's grips, a zigzag between them). */
  polyline: "M5.7 17.1L9.5 7l5 8 3.7-8.2 M5 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M19 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** A quarter arc between two end grips, a dot at its centre: the arc tool. */
  arc: "M5.2 16A13 13 0 0 1 16 5.2 M5 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 18h0",
  /** A rectangle held by the two opposite corners that define it: the rectangle tool. */
  rectangle: "M16.75 6.75H5.25v8.5 M7.25 17.25h11.5v-8.5 M18.75 4.75a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M5.25 15.25a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** A closed boundary filled with slanted lines: the hatch tool. */
  hatch: "M4 4h16v16H4z M4 12l8-8 M4 20L20 4 M12 20l8-8",
  /** A capital T with its serifs: the text tool. */
  text: "M5 7V4h14v3 M12 4v16 M9 20h6",
  /** A square and an arrow carrying it up and away: the move tool. */
  move: "M3.75 12.75h7.5v7.5h-7.5z M12.75 11.25l7.5-7.5 M14.25 3.75h6v6",
  /** A square in front of its twin, a plus on the one being made: the copy tool (`copy` is the clipboard's). */
  "copy-objects": "M3.75 8.25h12v12h-12z M8.25 8.25v-4.5h12v12h-4.5 M9.75 11.25v6 M6.75 14.25h6",
  /** A square with an arrow turning three quarters of a circle about it: the rotate tool. */
  rotate: "M20.25 12A8.25 8.25 0 1 1 12 3.75 M10 2l2 1.75-2 2.5 M9.75 9.75h4.5v4.5h-4.5z",
  /** A triangle and its reflection pointing away from a dashed mirror line: the mirror tool. */
  mirror: "M12.75 3.75v2.25 M12.75 10.5v4.5 M12.75 19.5v2.25 M8.25 6.75v12L3.75 12.75z M17.25 6.75v12l4.5-6z",
  /** A rounded corner and, well clear inside it, its parallel (the round shrunk to a point, as an
   *  offset by the radius does): the offset tool. A pair of strokes, where the fillet is one. */
  offset: "M3.75 20.25v-9a7.5 7.5 0 0 1 7.5-7.5h9 M11.25 20.25v-9h9",
  /** A cutting edge, a line that stops at it, and the piece cut off left as dashes: the trim tool. */
  trim: "M9.75 3v18 M3 15.75h6.75 M13.5 15.75h2.25 M19.5 15.75h1.5",
  /** Two long legs turning through one round corner, a dot where the sharp corner was: the fillet tool. */
  fillet: "M3.75 3.75h9a7.5 7.5 0 0 1 7.5 7.5v9 M20.25 3.75h0",
  /** An eraser on its edge over the line it rubs out: the erase tool. */
  erase: "M14 4l7 7-8 8H9l-5-5z M9 9l7 7 M13 19h8",
  /** A span between two extension lines, an arrow at each end, over the edge it measures: the linear dimension tool. */
  "dimension-linear": "M4 4v11 M20 4v11 M4 8h16 M7 5L4 8l3 3 M17 5l3 3-3 3 M4 20h16",
  /** A six-sided figure about its centre: the polygon tool. */
  polygon: "M7.5 3.75h9l4.5 8.25-4.5 8.25h-9L3 12z M12 12h0",
  /** An oval struck from four centres, as a drafter's compass draws one, a dot at its centre: the ellipse tool. */
  ellipse: "M3.9 9.3A10.125 10.125 0 0 1 20.1 9.3A4.5 4.5 0 0 1 20.1 14.7A10.125 10.125 0 0 1 3.9 14.7A4.5 4.5 0 0 1 3.9 9.3 M12 12h0",
  /** One curve that turns both ways between two end grips: the spline tool (the line's grips, an S between them). */
  spline: "M5.6 17.1A5.5 5.5 0 0 1 12 12A5.5 5.5 0 0 0 18.4 6.9 M5 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M19 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  /** A small square, the large one it grows into from the same corner, and the arrow of its growth: the scale tool. */
  scale: "M3.75 3.75h16.5v16.5H3.75z M3.75 12.75h7.5v7.5 M13.5 10.5l3.75-3.75 M14.25 6.75h3v3",
  /** A boundary edge, a line that stops short of it, and the arrow that carries it there: the extend tool. */
  extend: "M18.75 3v18 M3 12.75h5.25 M11.25 12.75h4.5 M13.5 9.75l3 3-3 3",
  /** Two long legs joined by one straight cut, a dot where the sharp corner was: the chamfer tool (the fillet's corner, cut flat). */
  chamfer: "M3.75 3.75h9l7.5 7.5v9 M20.25 3.75h0",
  /** A slanted edge and, parallel to it between two extension lines, its measure with an arrow at each end: the aligned dimension tool. */
  "dimension-aligned": "M7.5 20.5l13-7.5 M3.5 13.6l13-7.5 M6.75 19.2l-4-6.9 M19.75 11.7l-4-6.9 M6.3 13.7l-2.8-.1 1.3-2.5 M13.7 6l2.8.1-1.3 2.5",
  /** A circle, its centre, and an arrow from the centre out to the curve: the radius dimension tool. */
  "dimension-radius": "M12 3.75a8.25 8.25 0 1 0 0 16.5a8.25 8.25 0 1 0 0-16.5 M12 12h0 M12 12l5.8-5.8 M14.9 6.2h2.9v2.9",
  /** Two legs from one vertex and the arc that spans the angle between them: the angular dimension tool. */
  "dimension-angular": "M20.25 20.25H3.75L14 4.5 M15.75 20.25A12 12 0 0 0 10.3 10.2",
  /** An arrow on what it points at, bent to a landing beside two lines of a note: the leader tool. */
  mleader: "M4.3 16.3L3.75 20.25l3.6-1.8 M3.75 20.25l7.5-10.5h3 M15.75 8.25h4.5 M15.75 11.25h4.5",
  /** A ruled grid under a heading row: the table tool. */
  table: "M3.75 5.25h16.5v13.5H3.75z M3.75 9.75h16.5 M3.75 14.25h16.5 M9.75 9.75v9",
  /** A ring mandrel, the tapered stick a finger size is read from, with its size marks: the ring-size table. */
  ringsizes: "M3 10.75L20.25 7.5v9L3 13.25z M8.25 9.75v4.5 M12.75 9v6 M17.25 8.25v7.5",
  /** A stone from above and a tick beside it: the stones fit their seats. */
  gemfit: "M9.75 3.75a6 6 0 1 0 0 12a6 6 0 1 0 0-12 M13 17.5l3 3 5-7.5",
  /** A sheet with a stone drawn at its head and the rows of its list: the tech sheet. */
  techsheet: "M5.25 3.75h13.5v16.5H5.25z M9.75 6a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5 M14.25 8.25h1.5 M8.25 14.25h7.5 M8.25 17.25h7.5",
  /** A balance, a pan for the stones and a pan for the metal: the bench sheet's weights. */
  bench: "M12.75 3.75v16.5 M9.75 20.25h6 M6.25 6.75h13 M6.25 6.75l-2.5 6a2.5 2.5 0 0 0 5 0z M19.25 6.75l-2.5 6a2.5 2.5 0 0 0 5 0z",
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
  /** An up chevron: the key that folds the ribbon's band away. */
  "chevron-up": "M6 15l6-6 6 6",
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
 *  (`TopBar.tsx`), the Main menu key's list (`MenuBar.tsx`), and the up chevron of the ribbon's
 *  fold key (`ToolStrip.tsx`). */
export const PANEL_ICONS: readonly string[] = ["layer.on", "layer.off", "layer.frozen", "layer.thawed", "layer.locked", "layer.unlocked", "search", "layout.bottom", "ui.toggle.palettes", "list", "chevron-up"];

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
