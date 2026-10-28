/**
 * The display-list parser: `Facade::display()`'s JSON (the contract in
 * .design-system/boss/briefs/s-facade.1.md) into typed, drawable structures.
 *
 * The wire format is:
 *   {"revision": n, "bounds": [minx,miny,maxx,maxy],
 *    "verts": [[x,y], …],
 *    "prims": [{"kind":"polyline"|"tris"|"point"|"image", "start":i, "len":n,
 *               "color":[r,g,b], "lw":mm, "alpha":0..255, "handle":h}, …]}
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
}

export interface DisplayList {
  revision: number;
  bounds: Rect;
  verts: readonly Point[];
  prims: readonly DisplayPrim[];
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
  if (!isRecord(value)) return null;
  const verts = parseVerts(value["verts"]);
  const prims = parsePrims(value["prims"], verts.length);
  const bounds = parseRect(value["bounds"]) ?? boundsOfPoints(verts) ?? UNIT_RECT;
  return { revision: Math.max(0, intOr(value["revision"], 0)), bounds, verts, prims };
}

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
    out.push({
      kind,
      start,
      len,
      color,
      lw: Math.max(0, asNumber(p["lw"]) ?? 0),
      alpha: alpha === null ? 1 : Math.min(1, Math.max(0, alpha / 255)),
      handle: Math.max(0, intOr(p["handle"], 0)),
    });
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
