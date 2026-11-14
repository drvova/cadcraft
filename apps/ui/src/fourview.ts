/**
 * The four-view workspace of the 3D tab, apart from what draws it: how the stage is tiled, the
 * three orthographic eyes (Top, Front, Right) and their fit, pan and zoom, and how the layout is
 * remembered. Nothing here touches the DOM or WebGL; `components/Viewport3D.tsx` draws each pane
 * on one context, scissored, and this file is tested (`fourview.test.ts`).
 *
 * The engine's frame decides the words, as for the standard views (`view3d.ts`): the finger runs
 * along Z and the head is at +Y, so Top looks down −Y on the head, Front looks along the finger
 * (down −Z, the ring seen round) and Right looks down −X (the ring edge-on, the finger across).
 *
 * The orthographic panes share one scale when they are fitted (a millimetre is the same length in
 * all three, so a size read off one can be compared with another), and each is panned and zoomed
 * on its own after that.
 */

import { cameraBasis, clipPlanes, eyeFrame, mat4Multiply, viewMatrix, type Bounds, type Camera, type DrawPass, type EyeFrame, type Mat4, type Scene, type Vec3 } from "./view3d";

export type OrthoPane = "top" | "front" | "right";
export type Pane = OrthoPane | "perspective";

/** The panes in the order they tile, reading left to right and top to bottom. */
export const PANES: readonly Pane[] = ["top", "perspective", "front", "right"];
export const ORTHO_PANES: readonly OrthoPane[] = ["top", "front", "right"];

/** The name each pane carries in its corner, and the longer name read aloud. */
export const PANE_NAMES: Readonly<Record<Pane, { name: string; spoken: string }>> = {
  top: { name: "Top", spoken: "Top view, orthographic" },
  front: { name: "Front", spoken: "Front view, orthographic" },
  right: { name: "Right", spoken: "Right view, orthographic" },
  perspective: { name: "Perspective", spoken: "Perspective view" },
};

/** Where each orthographic eye stands, as the orbit camera's angles (`view3d.ts`). */
const ORTHO_ANGLES: Readonly<Record<OrthoPane, { yaw: number; pitch: number }>> = {
  top: { yaw: 0, pitch: Math.PI / 2 },
  front: { yaw: 0, pitch: 0 },
  right: { yaw: Math.PI / 2, pitch: 0 },
};

export function isPane(value: unknown): value is Pane {
  return value === "top" || value === "front" || value === "right" || value === "perspective";
}

// ---- the layout ----

/** One view, four tiled, or one of the four filling the stage. */
export type Layout = { kind: "single" } | { kind: "four"; max: Pane | null };

/** A rectangle in CSS pixels from the stage's top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The line between two tiles, in CSS pixels. */
export const TILE_GAP = 1;

/**
 * The panes shown and where. A single view and a maximised one fill the stage; four views tile it
 * 2×2 with a hairline between them, the odd pixel going to the first column and row.
 */
export function tileRects(width: number, height: number, layout: Layout): Partial<Record<Pane, Rect>> {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  if (layout.kind === "single") return { perspective: { x: 0, y: 0, w, h } };
  if (layout.max !== null) return { [layout.max]: { x: 0, y: 0, w, h } };
  const leftW = Math.max(0, Math.ceil((w - TILE_GAP) / 2));
  const topH = Math.max(0, Math.ceil((h - TILE_GAP) / 2));
  const rightX = leftW + TILE_GAP;
  const bottomY = topH + TILE_GAP;
  const rightW = Math.max(0, w - rightX);
  const bottomH = Math.max(0, h - bottomY);
  return {
    top: { x: 0, y: 0, w: leftW, h: topH },
    perspective: { x: rightX, y: 0, w: rightW, h: topH },
    front: { x: 0, y: bottomY, w: leftW, h: bottomH },
    right: { x: rightX, y: bottomY, w: rightW, h: bottomH },
  };
}

/** The pane under a stage point, or null (on a gap, or outside). */
export function paneAt(tiles: Partial<Record<Pane, Rect>>, x: number, y: number): Pane | null {
  for (const pane of PANES) {
    const r = tiles[pane];
    if (r !== undefined && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return pane;
  }
  return null;
}

/**
 * A CSS rectangle as WebGL's viewport in device pixels: from the bottom-left, its edges rounded
 * the same way wherever they fall, so neighbours meet without a seam or an overlap.
 */
export function deviceRect(rect: Rect, ratio: number, storeHeight: number): Rect {
  const k = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const x0 = Math.round(rect.x * k);
  const x1 = Math.round((rect.x + rect.w) * k);
  const y0 = Math.round(rect.y * k);
  const y1 = Math.round((rect.y + rect.h) * k);
  return { x: x0, y: Math.max(0, storeHeight - y1), w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** What a double-click (or the key, or the button) on a pane does to the layout. */
export function toggleMax(layout: Layout, pane: Pane): Layout {
  if (layout.kind === "single") return layout;
  return { kind: "four", max: layout.max === null ? pane : null };
}

// ---- the layout as it is remembered ----

const LAYOUT_KEY = "cadcraft.view3d.layout";

export interface LayoutStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function browserStore(): LayoutStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The layout as text: "single", "four" or "four:<pane>". */
export function layoutText(layout: Layout): string {
  return layout.kind === "single" ? "single" : layout.max === null ? "four" : `four:${layout.max}`;
}

export function parseLayout(text: unknown): Layout | null {
  if (text === "single") return { kind: "single" };
  if (text === "four") return { kind: "four", max: null };
  if (typeof text === "string" && text.startsWith("four:")) {
    const pane = text.slice(5);
    return isPane(pane) ? { kind: "four", max: pane } : null;
  }
  return null;
}

/** A stage narrower than this (CSS pixels) starts on the single Perspective view. */
export const FOUR_FROM = 560;

/** The layout remembered in this browser, or the default for a stage `width` wide: four views on a wide one, one on a phone. */
export function loadLayout(width: number, store: LayoutStore | null = browserStore()): Layout {
  let held: Layout | null = null;
  try {
    held = store === null ? null : parseLayout(store.getItem(LAYOUT_KEY));
  } catch {
    held = null;
  }
  if (held !== null) return held;
  return Number.isFinite(width) && width >= FOUR_FROM ? { kind: "four", max: null } : { kind: "single" };
}

export function saveLayout(layout: Layout, store: LayoutStore | null = browserStore()): void {
  if (store === null) return;
  try {
    store.setItem(LAYOUT_KEY, layoutText(layout));
  } catch {
    // A full or refused store: the layout still works, it is only forgotten.
  }
}

// ---- the orthographic eyes ----

/** An orthographic eye: what it looks at, and half the height it shows, in millimetres. */
export interface OrthoView {
  target: Vec3;
  span: number;
}

/** How small and how large a span may be, in scene radii, and how far the look-at point may be carried. */
const MIN_SPAN = 0.04;
const MAX_SPAN = 20;
const MAX_PAN = 2;
/** The margin round a fitted piece. */
const FIT_MARGIN = 1.12;
/** How far back the eye stands, in radii: only the clip planes and the lights' highlights read it. */
const EYE_BACK = 4;

const finite = (v: Vec3): boolean => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The orbit camera an orthographic pane stands as (for its basis, its clip planes and its lights). */
export function orthoCamera(pane: OrthoPane, view: OrthoView, scene: Scene): Camera {
  return { target: view.target, distance: scene.radius * EYE_BACK, ...ORTHO_ANGLES[pane] };
}

/** Any view made finite and inside its clamps for `scene`. */
export function clampOrtho(view: OrthoView, scene: Scene): OrthoView {
  const radius = Number.isFinite(scene.radius) && scene.radius > 0 ? scene.radius : 10;
  const center: Vec3 = finite(scene.center) ? scene.center : [0, 0, 0];
  const span = clampN(Number.isFinite(view.span) && view.span > 0 ? view.span : radius, radius * MIN_SPAN, radius * MAX_SPAN);
  let target: Vec3 = finite(view.target) ? view.target : center;
  const off: Vec3 = [target[0] - center[0], target[1] - center[1], target[2] - center[2]];
  const away = Math.hypot(off[0], off[1], off[2]);
  if (away > radius * MAX_PAN) {
    const k = (radius * MAX_PAN) / away;
    target = [center[0] + off[0] * k, center[1] + off[1] * k, center[2] + off[2] * k];
  }
  return { target, span };
}

/** Half the width and half the height of a box as a pane sees it. */
function boxHalves(pane: OrthoPane, box: Bounds): { across: number; up: number } {
  const basis = cameraBasis({ target: [0, 0, 0], distance: 1, ...ORTHO_ANGLES[pane] });
  const half: Vec3 = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
  const reach = (axis: Vec3): number => Math.abs(axis[0]) * half[0] + Math.abs(axis[1]) * half[1] + Math.abs(axis[2]) * half[2];
  return { across: reach(basis.right), up: reach(basis.up) };
}

/**
 * The three panes fitted to the piece's box at one shared scale: the span that holds the box in
 * the tightest of them, given each pane's aspect.
 */
export function fitOrthos(box: Bounds, scene: Scene, aspects: Readonly<Partial<Record<OrthoPane, number>>>): Record<OrthoPane, OrthoView> {
  const okBox = finite(box.min) && finite(box.max);
  const center: Vec3 = okBox ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2] : scene.center;
  let span = 0;
  for (const pane of ORTHO_PANES) {
    const raw = aspects[pane];
    const aspect = raw !== undefined && Number.isFinite(raw) && raw > 0 ? clampN(raw, 1e-3, 1e3) : 1;
    const half = okBox ? boxHalves(pane, box) : { across: scene.radius, up: scene.radius };
    span = Math.max(span, half.up, half.across / aspect);
  }
  const view = (): OrthoView => clampOrtho({ target: center, span: span * FIT_MARGIN }, scene);
  return { top: view(), front: view(), right: view() };
}

/** A column-major orthographic projection onto WebGL's clip space. */
export function mat4Ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const w = right - left || 1;
  const h = top - bottom || 1;
  const d = far - near || 1;
  return [2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, -2 / d, 0, -(right + left) / w, -(top + bottom) / h, -(far + near) / d, 1];
}

/** The frame an orthographic pane is drawn with: the eye's lights, under a parallel projection. */
export function orthoFrame(pane: OrthoPane, view: OrthoView, scene: Scene, aspect: number): EyeFrame {
  const v = clampOrtho(view, scene);
  const camera = orthoCamera(pane, v, scene);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? clampN(aspect, 1e-3, 1e3) : 1;
  const planes = clipPlanes(camera, scene);
  const projection = mat4Ortho(-v.span * ratio, v.span * ratio, -v.span, v.span, planes.near, planes.far);
  return { ...eyeFrame(camera, scene, ratio), viewProj: mat4Multiply(projection, viewMatrix(camera)) };
}

/** Carry the picture by a drag of `dx`, `dy` CSS pixels in a pane `height` pixels tall: what was under the pointer stays under it. */
export function orthoPan(pane: OrthoPane, view: OrthoView, scene: Scene, dx: number, dy: number, height: number): OrthoView {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(height) || height <= 0) return clampOrtho(view, scene);
  const basis = cameraBasis(orthoCamera(pane, view, scene));
  const k = (2 * view.span) / height;
  const target: Vec3 = [0, 1, 2].map((i) => (view.target[i] ?? 0) - (basis.right[i] ?? 0) * dx * k + (basis.up[i] ?? 0) * dy * k) as unknown as Vec3;
  return clampOrtho({ target, span: view.span }, scene);
}

/** Zoom by `factor` (below 1 comes nearer) about the pane point at `ndcX`, `ndcY` (−1…1, up positive): it stays where it is. */
export function orthoZoom(pane: OrthoPane, view: OrthoView, scene: Scene, factor: number, ndcX: number, ndcY: number, aspect: number): OrthoView {
  const from = clampOrtho(view, scene);
  if (!Number.isFinite(factor) || factor <= 0) return from;
  const to = clampOrtho({ target: from.target, span: from.span * factor }, scene);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? clampN(aspect, 1e-3, 1e3) : 1;
  const x = Number.isFinite(ndcX) ? clampN(ndcX, -1, 1) : 0;
  const y = Number.isFinite(ndcY) ? clampN(ndcY, -1, 1) : 0;
  const basis = cameraBasis(orthoCamera(pane, from, scene));
  const shift = from.span - to.span;
  const target: Vec3 = [0, 1, 2].map((i) => (from.target[i] ?? 0) + (basis.right[i] ?? 0) * x * ratio * shift + (basis.up[i] ?? 0) * y * shift) as unknown as Vec3;
  return clampOrtho({ target, span: to.span }, scene);
}

/** Millimetres per CSS pixel in a pane `height` pixels tall: what a scale bar reads. */
export function mmPerPixel(view: OrthoView, height: number): number {
  return height > 0 && Number.isFinite(view.span) ? (2 * view.span) / height : 0;
}

/** The world direction a pane's screen right points along (for tests and the handles). */
export function orthoRight(pane: OrthoPane): Vec3 {
  return cameraBasis({ target: [0, 0, 0], distance: 1, ...ORTHO_ANGLES[pane] }).right;
}

// ---- how the orthographic panes are drawn ----

/**
 * The passes of an orthographic pane, whatever the Perspective pane's mode: flat shading with its
 * feature edges in one ink over it, and the ground's lines. A drawing to measure from wants a
 * silhouette that is sharp and the same from frame to frame; the studio's reflections in the
 * Realistic mode move a highlight across a face and blur where an edge is, so they are kept for
 * the Perspective pane.
 */
export function orthoPlan(): DrawPass[] {
  const face = (what: "metal" | "stone"): DrawPass => ({ kind: "faces", what, color: true, depthTest: true, depthWrite: true, opacity: null, rim: 0, pushed: true, real: false });
  return [face("metal"), { kind: "ground" }, face("stone"), { kind: "edges", depthTest: true, alpha: 1, bold: false }];
}

