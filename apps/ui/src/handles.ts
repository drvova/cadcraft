/**
 * The drag handles on the piece in the 3D tab, apart from what draws them: which handles a piece
 * has and where they stand (from its parameters and the mesh the engine made of it), how a drag
 * on the screen becomes a number, how that number is snapped and held to what `piece` accepts,
 * and the patch it becomes. Nothing here touches the DOM or the engine; `components/Viewport3D.tsx`
 * places the handles, previews a drag with `piecemesh` and commits it with `piece` (or `propose`).
 *
 * The engine's frame (`crates/engine/src/cmd/jewelry/mesh.rs`): the band is revolved about Z and
 * centred on Z = 0, so the finger's centre is the origin; the head stands at +Y. The finger's
 * radius is half the size's diameter; the wall is radial; the width runs along Z.
 *
 * The ranges are those `piece` documents (wall 0.3–10, width 0.5–30, stone 0.5–30, halo melee
 * 0.8–3, eternity melee 0.8–6): a value outside them is never sent. Whether a value inside them
 * makes a piece the engine accepts (an eternity's stones must fit, a three-stone's side stones
 * must clear the centre) is the engine's to say, and the view says it.
 */

import type { PieceMesh, Vec3 } from "./view3d";
import { projectToView, type Mat4 } from "./view3d";

export type HandleId = "stone" | "width" | "wall" | "halo" | "melee";

export interface Handle {
  id: HandleId;
  /** What the handle is read aloud as, and named beside the cursor. */
  label: string;
  /** The parameter it changes, as `piece` names it. */
  key: "stoneWidth" | "width" | "wall" | "halo" | "melee";
  /** The value now, millimetres. */
  value: number;
  min: number;
  max: number;
  /** Where it stands on the piece, and the way it is dragged (unit length, world). */
  anchor: Vec3;
  axis: Vec3;
  /** How much the value grows per millimetre the handle travels along its axis (2 where both sides move). */
  rate: number;
}

const RANGES: Readonly<Record<HandleId, { min: number; max: number }>> = {
  stone: { min: 0.5, max: 30 },
  width: { min: 0.5, max: 30 },
  wall: { min: 0.3, max: 10 },
  halo: { min: 0.8, max: 3 },
  melee: { min: 0.8, max: 6 },
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The extreme vertex of a part along `dir` (a unit axis), among the vertices `keep` accepts; null when it has none. */
function extreme(mesh: PieceMesh, name: string, dir: Vec3, keep: (p: Vec3) => boolean = () => true): Vec3 | null {
  let best: Vec3 | null = null;
  let most = -Infinity;
  for (const part of mesh.parts) {
    if (part.name !== name) continue;
    const pos = part.positions;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const p: Vec3 = [pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0];
      if (!keep(p)) continue;
      const along = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2];
      if (along > most) {
        most = along;
        best = p;
      }
    }
  }
  return best;
}

/**
 * The handles of a piece: its raw `params` (as `piece {query}` gives them), the finger's diameter
 * (`size.diameter`), and the mesh on screen. A handle whose value or place cannot be read is left
 * out; nothing here throws.
 */
export function pieceHandles(params: Readonly<Record<string, unknown>>, diameter: number | null, mesh: PieceMesh | null): Handle[] {
  const out: Handle[] = [];
  const kind = params["kind"];
  const wall = num(params["wall"]);
  const width = num(params["width"]);
  const radius = diameter !== null && Number.isFinite(diameter) && diameter > 0 ? diameter / 2 : null;
  const make = (id: HandleId, label: string, key: Handle["key"], value: number, anchor: Vec3, axis: Vec3, rate: number): void => {
    if (!Number.isFinite(value) || !anchor.every(Number.isFinite)) return;
    out.push({ id, label, key, value, ...RANGES[id], anchor, axis, rate });
  };
  // A pendant's or an earring's stone takes the solitaire's handles; it has no band to drag.
  const worn = kind === "pendant" || kind === "stud" || kind === "drop";
  if (mesh !== null && (kind === "solitaire" || kind === "threestone" || worn)) {
    const stoneWidth = num(params["stoneWidth"]);
    const girdle = extreme(mesh, "centre stone", [1, 0, 0]);
    if (stoneWidth !== null && girdle !== null) make("stone", "Centre stone size", "stoneWidth", stoneWidth, girdle, [1, 0, 0], 2);
    const halo = num(params["halo"]);
    const ring = (kind === "solitaire" || worn) && halo !== null ? extreme(mesh, "melee", [-1, 0, 0]) : null;
    if (halo !== null && ring !== null) make("halo", "Halo stone size", "halo", halo, ring, [-1, 0, 0], 1);
  }
  if (mesh !== null && kind === "eternity") {
    const melee = num(params["melee"]);
    // The stone at twelve o'clock: the melee nearest the top, and its edge toward +Z.
    const top = extreme(mesh, "melee", [0, 1, 0]);
    if (melee !== null && top !== null) {
      const edge = extreme(mesh, "melee", [0, 0, 1], (p) => Math.abs(p[0]) < melee && p[1] > top[1] - melee);
      if (edge !== null) make("melee", "Stone size", "melee", melee, edge, [0, 0, 1], 2);
    }
  }
  if (radius !== null && wall !== null && !worn) {
    // The band's outside on the right at the finger's height: the surface that moves with the wall
    // (the inside is the finger's size and stays where it is).
    make("wall", "Wall", "wall", wall, [radius + wall, 0, 0], [1, 0, 0], 1);
    if (width !== null) make("width", "Band width", "width", width, [-(radius + wall), 0, width / 2], [0, 0, 1], 2);
  }
  return out;
}

// ---- the screen ----

/** A handle on a pane: where it is in CSS pixels, and how many pixels its axis covers per millimetre. */
export interface ScreenHandle {
  x: number;
  y: number;
  /** Pixels per millimetre along the axis, on the screen (right and down). */
  dx: number;
  dy: number;
  /** In front of the eye and inside the pane. */
  shown: boolean;
}

/** A handle whose axis covers fewer pixels a millimetre than this, of the pane's own scale, points at the eye: it is not offered there. */
export const MIN_AXIS_SHARE = 0.35;

/**
 * A handle as a pane sees it. `scale` is the pane's pixels per millimetre at the handle (any
 * axis-aligned millimetre at its depth); a handle whose axis is foreshortened below
 * `MIN_AXIS_SHARE` of it is not shown, since it could not be dragged.
 */
export function screenHandle(handle: Handle, viewProj: Mat4, width: number, height: number): ScreenHandle {
  const at = projectToView(viewProj, handle.anchor, width, height);
  const tip = projectToView(viewProj, [handle.anchor[0] + handle.axis[0], handle.anchor[1] + handle.axis[1], handle.anchor[2] + handle.axis[2]], width, height);
  const dx = tip.x - at.x;
  const dy = tip.y - at.y;
  // The pane's own scale at the handle: the longest of the three unit axes there.
  let scale = 0;
  for (const unit of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const) {
    const p = projectToView(viewProj, [handle.anchor[0] + unit[0], handle.anchor[1] + unit[1], handle.anchor[2] + unit[2]], width, height);
    scale = Math.max(scale, Math.hypot(p.x - at.x, p.y - at.y));
  }
  const along = Math.hypot(dx, dy);
  const ok = at.shown && tip.depth > 0 && Number.isFinite(along) && scale > 0 && along >= scale * MIN_AXIS_SHARE;
  return { x: at.x, y: at.y, dx, dy, shown: ok };
}

/**
 * The value a drag comes to: the pointer's travel (`moveX`, `moveY` CSS pixels) projected on the
 * handle's axis as the screen shows it, in millimetres, times the handle's rate. Not snapped or
 * held to range: `settleValue` does that.
 */
export function dragValue(start: number, rate: number, screen: Pick<ScreenHandle, "dx" | "dy">, moveX: number, moveY: number): number {
  const len2 = screen.dx * screen.dx + screen.dy * screen.dy;
  if (!(len2 > 1e-9) || !Number.isFinite(moveX) || !Number.isFinite(moveY) || !Number.isFinite(start)) return start;
  const mm = (moveX * screen.dx + moveY * screen.dy) / len2;
  return start + rate * mm;
}

// ---- snapping ----

/**
 * The centre stone sizes a drag snaps to: tenths under 3 mm, then quarters to 10 mm (the round
 * sizes a setter stocks: 6.5 mm is about a carat), then halves. `piece` itself takes any size in
 * range and does not round a centre stone; these are the stops a hand lands on.
 */
export const STONE_SIZES: readonly number[] = (() => {
  const out: number[] = [];
  for (let t = 5; t < 30; t += 1) out.push(t / 10);
  for (let q = 12; q <= 40; q += 1) out.push(q / 4);
  for (let h = 21; h <= 60; h += 1) out.push(h / 2);
  return out;
})();

/** The step a handle's value moves by (and snaps to) when it is not a stone size. Melee is calibrated in tenths (`piece`'s calibrated check). */
export function stepOf(id: HandleId): number {
  return id === "halo" || id === "melee" ? 0.1 : 0.05;
}

const round = (value: number, step: number): number => Math.round(value / step) * step;
/** A value written without the float's noise (0.30000000000000004 is 0.3). */
const clean = (value: number): number => Math.round(value * 1e6) / 1e6;

/** The nearest stop of a sorted list. */
function nearest(list: readonly number[], value: number): number {
  let best = list[0] ?? value;
  for (const v of list) if (Math.abs(v - value) < Math.abs(best - value)) best = v;
  return best;
}

/**
 * A dragged value as it is sent: held to the handle's range, then snapped (a stone to the nearest
 * stock size, anything else to its step). `fine` (Shift held) snaps to hundredths instead.
 */
export function settleValue(handle: Pick<Handle, "id" | "min" | "max">, value: number, fine = false): number {
  const v = Number.isFinite(value) ? Math.min(handle.max, Math.max(handle.min, value)) : handle.min;
  const snapped = fine ? round(v, 0.01) : handle.id === "stone" ? nearest(STONE_SIZES, v) : round(v, stepOf(handle.id));
  return clean(Math.min(handle.max, Math.max(handle.min, snapped)));
}

/** One keyboard nudge: the next stop up (`dir` 1) or down (−1) from `value`, held to range. */
export function nudgeValue(handle: Pick<Handle, "id" | "min" | "max">, value: number, dir: 1 | -1, fine = false): number {
  const v = Number.isFinite(value) ? value : handle.min;
  if (!fine && handle.id === "stone") {
    const next = dir > 0 ? STONE_SIZES.find((s) => s > v + 1e-9) : [...STONE_SIZES].reverse().find((s) => s < v - 1e-9);
    return clean(Math.min(handle.max, Math.max(handle.min, next ?? v)));
  }
  const step = fine ? 0.01 : stepOf(handle.id);
  // From a value off the grid, the first nudge lands on the grid in its direction.
  const on = dir > 0 ? Math.floor(v / step + 1e-9) * step + step : Math.ceil(v / step - 1e-9) * step - step;
  return clean(Math.min(handle.max, Math.max(handle.min, on)));
}

// ---- what is sent and said ----

/**
 * The `piece` patch a handle's value is: one key, except the stone, whose length keeps its
 * proportion to its width (a round stays round, an oval stays the same oval).
 */
export function handlePatch(handle: Pick<Handle, "id" | "key" | "value">, value: number, params: Readonly<Record<string, unknown>>): Record<string, number> {
  if (handle.id === "stone") {
    const w = num(params["stoneWidth"]);
    const l = num(params["stoneLength"]);
    const ratio = w !== null && l !== null && w > 0 ? l / w : 1;
    return { stoneWidth: value, stoneLength: clean(Math.round(value * ratio * 100) / 100) };
  }
  return { [handle.key]: value };
}

/** A value as the label beside the cursor shows it: "6.50 mm". */
export function formatHandleValue(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} mm` : "";
}

/** The words beside the cursor: "Centre stone size 6.50 mm (was 6.00)". */
export function handleReadout(handle: Pick<Handle, "label" | "value">, value: number): string {
  const was = Math.abs(value - handle.value) > 1e-9 ? ` (was ${handle.value.toFixed(2)})` : "";
  return `${handle.label} ${formatHandleValue(value)}${was}`;
}

/** The title a proposal made with Alt carries: "Centre stone size 6.50 mm". */
export function handleTitle(handle: Pick<Handle, "label">, value: number): string {
  return `${handle.label} ${formatHandleValue(value)}`;
}

/** The most characters of a refusal said beside the cursor. */
export const REFUSAL_MAX = 180;

/**
 * An engine refusal as it is said beside the cursor: without the wrapping a proposal's step puts
 * round it ("step 1 (`piece`) failed: invalid parameters for `piece`: …"), on one line, clipped.
 */
export function shortRefusal(error: unknown): string {
  if (typeof error !== "string") return "the engine refused this value";
  const bare = error
    .slice(0, REFUSAL_MAX * 4)
    .replace(/^\s*step \d+ \(`[a-z]+`\) failed:\s*/i, "")
    .replace(/^\s*invalid parameters for `[a-z]+`:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (bare === "") return "the engine refused this value";
  return bare.length > REFUSAL_MAX ? `${bare.slice(0, REFUSAL_MAX - 1)}…` : bare;
}
