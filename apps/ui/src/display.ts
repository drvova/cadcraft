/**
 * The display-list parser: `Facade::display()`'s JSON (the contract in
 * .design-system/boss/briefs/s-facade.1.md) into typed, drawable structures.
 *
 * The wire format is:
 *   {"revision": n, "bounds": [minx,miny,maxx,maxy],
 *    "space": "Model" | a layout's name,
 *    "sheet": null | {"paper":[minx,miny,maxx,maxy], "printable":[minx,miny,maxx,maxy]},
 *    "verts": [[x,y], …],
 *    "prims": [{"kind":"polyline"|"tris"|"point"|"image", "start":i, "len":n,
 *               "color":[r,g,b], "lw":mm, "alpha":0..255, "handle":h, "ink"?: "fg"|"mask"}, …]}
 *
 * `space` and `sheet` say what the list is of: a layout's list carries its sheet of paper, so the
 * canvas never draws one space's objects on another's ground. A reply without them (an engine
 * package built before layouts had paper) is a list with no sheet. `ink` marks the primitives
 * whose colour depends on the ground under them: "fg" is the foreground colour (colour 7: light
 * on the dark canvas, dark on paper) and "mask" a wipeout (the ground's own colour).
 *
 * The parser is the app's only trust boundary for engine bytes: it never throws, skips
 * primitives whose ranges fall outside `verts`, clamps every number, and caps its own loops.
 */

import { boundsOfPoints, parseRect, UNIT_RECT, type Point, type Rect } from "./view";
import { asNumber, isRecord } from "./json";

export type PrimKind = "polyline" | "tris" | "point" | "image";

export interface DisplayPrim {
  kind: PrimKind;
  /** Index into `DisplayList.verts` of the primitive's first vertex. */
  start: number;
  /** How many vertices the primitive uses: a polyline's points, three per triangle, 1 for a
   *  point, 4 for an image quad. */
  len: number;
  /** sRGB, 0..255 per channel. */
  color: readonly [number, number, number];
  /** Lineweight in mm (0 = thinnest). */
  lw: number;
  /** Opacity, 0..1 (the wire format carries 0..255). */
  alpha: number;
  /** The entity handle, for later picking. */
  handle: number;
  /**
   * Set when the colour follows the ground the primitive lies on: "fg" is the drawing's
   * foreground colour (colour 7) and "mask" a wipeout. `color` is then what it is on the canvas's
   * own ground; on a sheet of paper the canvas inks it from its paper tokens.
   */
  ink?: "fg" | "mask";
}

/** A layout's sheet of paper, in the layout's drawing units. */
export interface LayoutSheet {
  /** The whole sheet. */
  paper: Rect;
  /** The area a plot can reach, inside the device's margins (the sheet itself when it has none). */
  printable: Rect;
}

export interface DisplayList {
  revision: number;
  bounds: Rect;
  verts: readonly Point[];
  prims: readonly DisplayPrim[];
  /** The space the list is of ("Model" or a layout's name); absent when the engine does not say. */
  space?: string;
  /** The sheet of paper of a layout's list; null or absent in model space. */
  sheet?: LayoutSheet | null;
}

export const EMPTY_DISPLAY: DisplayList = { revision: 0, bounds: UNIT_RECT, verts: [], prims: [] };

const MAX_VERTS = 2_000_000;
const MAX_PRIMS = 1_000_000;
const MAX_REPLY_BYTES = 64 * 1024 * 1024;
const DEFAULT_COLOR: readonly [number, number, number] = [212, 212, 212];

function intOr(v: unknown, fallback: number): number {
  const n = asNumber(v);
  return n === null ? fallback : Math.round(n);
}

function channel(v: unknown): number {
  const n = asNumber(v);
  return n === null ? 0 : Math.min(255, Math.max(0, Math.round(n)));
}

/** Parse a facade `display()` reply; null when it is not a display list at all. */
export function parseDisplayList(raw: string): DisplayList | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REPLY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return displayListOf(value);
}

/**
 * Read a display list out of a value that is already parsed: the whole of a `display()` reply, or
 * the part of a larger reply that has its shape (a preview, a pointer's rubber band and its
 * tracking paths), so a reply that carries one is parsed once. Null when it is not a JSON object.
 */
export function displayListOf(value: unknown): DisplayList | null {
  if (!isRecord(value)) return null;
  const verts = parseVerts(value["verts"]);
  const prims = parsePrims(value["prims"], verts.length);
  const bounds = parseRect(value["bounds"]) ?? boundsOfPoints(verts) ?? UNIT_RECT;
  const list: DisplayList = { revision: Math.max(0, intOr(value["revision"], 0)), bounds, verts, prims, sheet: parseSheet(value["sheet"]) };
  const space = value["space"];
  if (typeof space === "string" && space.length <= MAX_SPACE_NAME) list.space = space;
  return list;
}

/** The longest space name kept (a layout's name is at most 255 characters). */
const MAX_SPACE_NAME = 1024;

/** The largest ordinate of a sheet that is drawn: past it a double no longer holds whole units. */
const MAX_SHEET_COORD = 1e15;

/** A rectangle with finite corners inside the usable range and a real area, or null. */
function usableRect(value: unknown): Rect | null {
  const r = parseRect(value);
  if (r === null) return null;
  if (![r.x0, r.y0, r.x1, r.y1].every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_SHEET_COORD)) return null;
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

/**
 * Read a layout's sheet (`{"paper":[…],"printable":[…]}`); null for model space, an engine that
 * does not send one, and a sheet that is not a real rectangle. A printable area that is missing,
 * unusable or reaches outside the paper is held to the paper.
 */
export function parseSheet(value: unknown): LayoutSheet | null {
  if (!isRecord(value)) return null;
  const paper = usableRect(value["paper"]);
  if (paper === null) return null;
  const area = usableRect(value["printable"]);
  if (area === null) return { paper, printable: paper };
  const printable = { x0: Math.max(area.x0, paper.x0), y0: Math.max(area.y0, paper.y0), x1: Math.min(area.x1, paper.x1), y1: Math.min(area.y1, paper.y1) };
  return { paper, printable: printable.x1 > printable.x0 && printable.y1 > printable.y0 ? printable : paper };
}

/** The most bytes of a reply holding a display list that is read at all. */
export const MAX_DISPLAY_REPLY_BYTES = MAX_REPLY_BYTES;

function parseVerts(v: unknown): Point[] {
  if (!Array.isArray(v)) return [];
  const out: Point[] = [];
  const n = Math.min(v.length, MAX_VERTS);
  for (let i = 0; i < n; i++) {
    const p = v[i];
    if (!Array.isArray(p)) {
      out.push({ x: NaN, y: NaN });
      continue;
    }
    // A bad vertex keeps its index (so prim ranges stay meaningful) and reads as NaN; the
    // draw loop skips NaN points.
    out.push({ x: asNumber(p[0]) ?? NaN, y: asNumber(p[1]) ?? NaN });
  }
  return out;
}

function parsePrims(v: unknown, vertCount: number): DisplayPrim[] {
  if (!Array.isArray(v)) return [];
  const out: DisplayPrim[] = [];
  const n = Math.min(v.length, MAX_PRIMS);
  for (let i = 0; i < n; i++) {
    const p = v[i];
    if (!isRecord(p)) continue;
    const kind = p["kind"];
    if (kind !== "polyline" && kind !== "tris" && kind !== "point" && kind !== "image") continue;
    const start = intOr(p["start"], -1);
    const len = intOr(p["len"], 0);
    if (start < 0 || len <= 0 || start + len > vertCount) continue;
    const color = Array.isArray(p["color"])
      ? ([channel(p["color"][0]), channel(p["color"][1]), channel(p["color"][2])] as const)
      : DEFAULT_COLOR;
    const alpha = asNumber(p["alpha"]);
    const prim: DisplayPrim = {
      kind,
      start,
      len,
      color,
      lw: Math.max(0, asNumber(p["lw"]) ?? 0),
      alpha: alpha === null ? 1 : Math.min(1, Math.max(0, alpha / 255)),
      handle: Math.max(0, intOr(p["handle"], 0)),
    };
    const ink = p["ink"];
    if (ink === "fg" || ink === "mask") prim.ink = ink;
    out.push(prim);
  }
  return out;
}

/** The world bounding rectangle of one primitive, or null when it has no finite vertex. */
export function boundsOfPrim(prim: DisplayPrim, verts: readonly Point[]): Rect | null {
  const end = Math.min(prim.start + prim.len, verts.length);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = prim.start; i < end; i++) {
    const p = verts[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}
