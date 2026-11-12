/**
 * The 3D view's rendering math, with no DOM and no WebGL in it: the 4×4 matrices, the orbit
 * camera, the checked reading of the engine's mesh reply, and the vertex buffers the viewport
 * uploads. The piece's geometry is the engine's (`piecemesh`); nothing here makes or changes it —
 * a normal is how a triangle the engine sent is lit, a matrix is where the eye stands.
 *
 * The engine's frame: the finger's axis is Z, the ring lies in the XY plane about the origin, and
 * the head of the ring is at +Y. Lengths are millimetres.
 *
 * Every number that comes from outside (a reply, a pointer delta, a window size) is treated as
 * hostile: a transition that is handed a non-finite value changes nothing, and every camera a
 * transition returns is finite, inside its clamps, and never upside down.
 */

import { asNumber, asString, asStringList, isRecord } from "./json";

export type Vec3 = readonly [number, number, number];

/** A 4×4 matrix in column-major order, as WebGL's `uniformMatrix4fv` takes it. */
export type Mat4 = readonly number[];

// ---- vectors ----

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finite3 = (v: Vec3): boolean => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `v` at length 1, or `fallback` when it has no length to speak of. */
export function normalize(v: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-12 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : fallback;
}

// ---- matrices ----

export const MAT4_IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** `a · b`: the transform that applies `b` first, then `a`. */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out: number[] = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** A point through a matrix, with the perspective divide. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const at = (i: number): number => m[i] ?? 0;
  const x = at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12);
  const y = at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13);
  const z = at(2) * p[0] + at(6) * p[1] + at(10) * p[2] + at(14);
  const w = at(3) * p[0] + at(7) * p[1] + at(11) * p[2] + at(15);
  const k = Math.abs(w) > 1e-12 ? 1 / w : 1;
  return [x * k, y * k, z * k];
}

/**
 * A right-handed perspective projection onto clip space (-1…1 in depth, as WebGL's). The inputs
 * are brought inside what makes a matrix: a field of view strictly between 0 and 180 degrees, a
 * positive aspect, and 0 < near < far.
 */
export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const fov = clamp(Number.isFinite(fovY) ? fovY : FOV_Y, 0.01, Math.PI - 0.01);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 1e-3, 1e3) : 1;
  const n = Number.isFinite(near) && near > 0 ? near : 0.01;
  const f = Number.isFinite(far) && far > n * 1.0001 ? far : n * 1000;
  const focal = 1 / Math.tan(fov / 2);
  return [focal / ratio, 0, 0, 0, 0, focal, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
}

/** The view matrix of an eye with an orthonormal basis: `right`, `up`, and `forward` (into the scene). */
export function mat4View(eye: Vec3, right: Vec3, up: Vec3, forward: Vec3): Mat4 {
  return [right[0], up[0], -forward[0], 0, right[1], up[1], -forward[1], 0, right[2], up[2], -forward[2], 0, -dot(right, eye), -dot(up, eye), dot(forward, eye), 1];
}

// ---- the scene and the camera ----

/** An axis-aligned box. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** What the camera frames and is clamped about: the sphere around the piece's box. */
export interface Scene {
  center: Vec3;
  radius: number;
}

/** The smallest and largest sphere a scene may have, in millimetres: a degenerate box still frames. */
const MIN_RADIUS = 0.05;
const MAX_RADIUS = 1e5;

export function sceneOf(bounds: Bounds): Scene {
  if (!finite3(bounds.min) || !finite3(bounds.max)) return { center: [0, 0, 0], radius: 10 };
  const center = scale(add(bounds.min, bounds.max), 0.5);
  const half = scale(sub(bounds.max, bounds.min), 0.5);
  const radius = clamp(Math.hypot(half[0], half[1], half[2]), MIN_RADIUS, MAX_RADIUS);
  return finite3(center) ? { center, radius } : { center: [0, 0, 0], radius };
}

/** The vertical field of view: modest, so a ring is not stretched toward the eye. */
export const FOV_Y = (30 * Math.PI) / 180;

/**
 * The orbit camera: it looks at `target` from `distance` away, `yaw` about the world's Y (0 looks
 * down −Z at the ring's face; a quarter turn looks down −X) and `pitch` above the XY plane's
 * horizon (a quarter turn looks straight down −Y at the head).
 */
export interface Camera {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

/** Pitch stops at straight down and straight up: past them the picture would turn over. */
const PITCH_LIMIT = Math.PI / 2;
/** How near and how far the eye may stand, in scene radii. */
const MIN_DISTANCE = 0.12;
const MAX_DISTANCE = 30;
/** How far the look-at point may be carried from the piece's centre, in scene radii. */
const MAX_PAN = 2;
/** The ground grid reaches this many radii from the centre; the clip planes hold it. */
export const GROUND_REACH = 2.5;

export type StandardView = "front" | "top" | "side" | "three-quarter";

export const STANDARD_VIEWS: Readonly<Record<StandardView, { yaw: number; pitch: number }>> = {
  front: { yaw: 0, pitch: 0 },
  top: { yaw: 0, pitch: PITCH_LIMIT },
  side: { yaw: Math.PI / 2, pitch: 0 },
  "three-quarter": { yaw: (35 * Math.PI) / 180, pitch: (24 * Math.PI) / 180 },
};

/** An angle brought into (−π, π]. */
function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  const wrapped = angle - turn * Math.floor((angle + Math.PI) / turn);
  return wrapped <= -Math.PI ? wrapped + turn : wrapped;
}

/** Any camera made finite and brought inside its clamps for `scene`. */
export function clampCamera(camera: Camera, scene: Scene): Camera {
  const radius = clamp(Number.isFinite(scene.radius) ? scene.radius : 10, MIN_RADIUS, MAX_RADIUS);
  const center: Vec3 = finite3(scene.center) ? scene.center : [0, 0, 0];
  const yaw = Number.isFinite(camera.yaw) ? wrapAngle(camera.yaw) : STANDARD_VIEWS["three-quarter"].yaw;
  const pitch = Number.isFinite(camera.pitch) ? clamp(camera.pitch, -PITCH_LIMIT, PITCH_LIMIT) : STANDARD_VIEWS["three-quarter"].pitch;
  const distance = clamp(Number.isFinite(camera.distance) && camera.distance > 0 ? camera.distance : radius * 4, radius * MIN_DISTANCE, radius * MAX_DISTANCE);
  let target: Vec3 = finite3(camera.target) ? camera.target : center;
  const off = sub(target, center);
  const away = Math.hypot(off[0], off[1], off[2]);
  if (!Number.isFinite(away)) target = center;
  else if (away > radius * MAX_PAN) target = add(center, scale(off, (radius * MAX_PAN) / away));
  return { target, yaw, pitch, distance };
}

/** Where the eye stands and which way its axes point. The basis is orthonormal at every pitch, the poles included. */
export function cameraBasis(camera: Camera): { eye: Vec3; right: Vec3; up: Vec3; forward: Vec3 } {
  const sy = Math.sin(camera.yaw);
  const cy = Math.cos(camera.yaw);
  const sp = Math.sin(camera.pitch);
  const cp = Math.cos(camera.pitch);
  const back: Vec3 = [cp * sy, sp, cp * cy];
  return {
    eye: add(camera.target, scale(back, camera.distance)),
    right: [cy, 0, -sy],
    up: [-sp * sy, cp, -sp * cy],
    forward: scale(back, -1),
  };
}

export function viewMatrix(camera: Camera): Mat4 {
  const basis = cameraBasis(camera);
  return mat4View(basis.eye, basis.right, basis.up, basis.forward);
}

/**
 * The clip planes from the scene: they hold the piece and its ground wherever the eye stands, and
 * the near one never comes closer than a hundredth of the radius, so depth keeps its precision
 * and a piece the eye is pushed into is cut only at the lens.
 */
export function clipPlanes(camera: Camera, scene: Scene): { near: number; far: number } {
  const basis = cameraBasis(camera);
  const depth = dot(sub(scene.center, basis.eye), basis.forward);
  const reach = scene.radius * (GROUND_REACH * Math.SQRT2 + 0.1);
  const near = Math.max(depth - reach, scene.radius * 0.01);
  const far = Math.max(depth + reach, near * 2);
  return { near, far };
}

export function projectionMatrix(camera: Camera, scene: Scene, aspect: number): Mat4 {
  const planes = clipPlanes(camera, scene);
  return mat4Perspective(FOV_Y, aspect, planes.near, planes.far);
}

/** The distance from which the scene's sphere fills the narrower of the view's two angles, with a margin. */
export function fitDistance(scene: Scene, aspect: number): number {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 1e-3, 1e3) : 1;
  const halfY = FOV_Y / 2;
  const halfX = Math.atan(Math.tan(halfY) * ratio);
  return (scene.radius * 1.08) / Math.sin(Math.min(halfX, halfY));
}

/** Frame the piece: look at its centre from the fitting distance, keeping the direction. */
export function fitCamera(camera: Camera, scene: Scene, aspect: number): Camera {
  return clampCamera({ ...camera, target: scene.center, distance: fitDistance(scene, aspect) }, scene);
}

/** One of the standard views, framed. */
export function standardCamera(view: StandardView, scene: Scene, aspect: number): Camera {
  return fitCamera({ target: scene.center, distance: 1, ...STANDARD_VIEWS[view] }, scene, aspect);
}

/** The standard view the camera's direction is exactly, or null. */
export function standardViewOf(camera: Camera): StandardView | null {
  for (const name of ["front", "top", "side", "three-quarter"] as const) {
    const view = STANDARD_VIEWS[name];
    if (Math.abs(wrapAngle(camera.yaw - view.yaw)) < 1e-9 && Math.abs(camera.pitch - view.pitch) < 1e-9) return name;
  }
  return null;
}

/** Turn about the look-at point by these angles (radians): positive yaw carries the eye toward +X, positive pitch lifts it. */
export function orbitCamera(camera: Camera, scene: Scene, yaw: number, pitch: number): Camera {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return clampCamera(camera, scene);
  return clampCamera({ ...camera, yaw: camera.yaw + yaw, pitch: camera.pitch + pitch }, scene);
}

/**
 * Carry the picture by a drag of `dx`, `dy` CSS pixels (right and down) in a view `height` pixels
 * tall: what was under the pointer at the look-at depth stays under it.
 */
export function panCamera(camera: Camera, scene: Scene, dx: number, dy: number, height: number): Camera {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(height) || height <= 0) return clampCamera(camera, scene);
  const basis = cameraBasis(camera);
  const perPixel = (2 * camera.distance * Math.tan(FOV_Y / 2)) / height;
  const target = add(camera.target, add(scale(basis.right, -dx * perPixel), scale(basis.up, dy * perPixel)));
  return clampCamera({ ...camera, target }, scene);
}

/**
 * Zoom by `factor` (below 1 comes nearer) toward the point of the view at `ndcX`, `ndcY` (−1…1,
 * up positive): what is under the pointer at the look-at depth stays under it.
 */
export function zoomCamera(camera: Camera, scene: Scene, factor: number, ndcX: number, ndcY: number, aspect: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return clampCamera(camera, scene);
  const from = clampCamera(camera, scene);
  const distance = clamp(from.distance * factor, scene.radius * MIN_DISTANCE, scene.radius * MAX_DISTANCE);
  const applied = distance / from.distance;
  const x = Number.isFinite(ndcX) ? clamp(ndcX, -1, 1) : 0;
  const y = Number.isFinite(ndcY) ? clamp(ndcY, -1, 1) : 0;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 1e-3, 1e3) : 1;
  const basis = cameraBasis(from);
  const half = from.distance * Math.tan(FOV_Y / 2);
  const under = add(scale(basis.right, x * half * ratio), scale(basis.up, y * half));
  return clampCamera({ ...from, distance, target: add(from.target, scale(under, 1 - applied)) }, scene);
}

// ---- the engine's reply ----

/** The contract's ceiling on a mesh reply; a reply over it is refused, not cut. */
export const MAX_TRIANGLES = 150_000;
/** The most separate meshes a reply may hold (a full eternity band is a metal and a stone per seat). */
const MAX_MESHES = 2_000;
/** No coordinate of a piece of jewelry is a hundred metres from the origin. */
const MAX_COORDINATE = 1e5;
const MAX_NOTES = 8;
const MAX_NOTE_LENGTH = 240;

export type PartKind = "metal" | "stone";

/** One mesh of the reply, checked: every index names a vertex and every coordinate is finite. */
export interface PartMesh {
  part: PartKind;
  name: string;
  /** Red, green and blue, each 0…1. */
  color: Vec3;
  positions: Float32Array;
  indices: Uint32Array;
}

export interface PieceMesh {
  parts: PartMesh[];
  /** The box the engine measured: the readout's size. */
  bounds: Bounds;
  /** The box of the vertices that will be drawn: what the camera frames. */
  extent: Bounds;
  /** The triangles counted in the reply. */
  triangles: number;
  notes: string[];
}

export type MeshReply = { ok: true; mesh: PieceMesh } | { ok: false; error: string };

const refuse = (error: string): MeshReply => ({ ok: false, error: `the 3D mesh could not be read: ${error}` });

function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const x = asNumber(value[0]);
  const y = asNumber(value[1]);
  const z = asNumber(value[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
}

/** Read `piecemesh`'s result. Anything out of the contract refuses the whole reply, with the reason. */
export function parseMeshReply(result: unknown): MeshReply {
  if (!isRecord(result)) return refuse("the reply is not an object");
  const meshes = result["meshes"];
  if (!Array.isArray(meshes)) return refuse("it has no list of meshes");
  if (meshes.length > MAX_MESHES) return refuse(`it has more than ${MAX_MESHES} meshes`);
  const parts: PartMesh[] = [];
  let triangles = 0;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const entry of meshes) {
    if (!isRecord(entry)) return refuse("a mesh is not an object");
    const part = entry["part"];
    if (part !== "metal" && part !== "stone") return refuse("a mesh is neither metal nor stone");
    const name = (asString(entry["name"]) ?? "").slice(0, 80);
    const rgb = asVec3(entry["color"]);
    if (rgb === null) return refuse(`the colour of ${name === "" ? "a mesh" : name} is not three numbers`);
    const rawPositions = entry["positions"];
    const rawIndices = entry["indices"];
    if (!Array.isArray(rawPositions) || !Array.isArray(rawIndices)) return refuse("a mesh has no positions or no indices");
    if (rawPositions.length % 3 !== 0) return refuse("a mesh's positions are not whole points");
    if (rawIndices.length % 3 !== 0) return refuse("a mesh's indices are not whole triangles");
    triangles += rawIndices.length / 3;
    if (triangles > MAX_TRIANGLES) return refuse(`it has more than ${MAX_TRIANGLES.toLocaleString("en-US")} triangles`);
    // A triangle names three vertices, so more points than three per triangle are not a mesh's.
    if (rawPositions.length > rawIndices.length * 3) return refuse("a mesh has more points than its triangles use");
    const vertices = rawPositions.length / 3;
    const positions = new Float32Array(rawPositions.length);
    for (let i = 0; i < rawPositions.length; i += 1) {
      const v = asNumber(rawPositions[i]);
      if (v === null || Math.abs(v) > MAX_COORDINATE) return refuse("a coordinate is not a number in range");
      positions[i] = v;
      const axis = i % 3;
      if (v < (lo[axis] ?? 0)) lo[axis] = v;
      if (v > (hi[axis] ?? 0)) hi[axis] = v;
    }
    const indices = new Uint32Array(rawIndices.length);
    for (let i = 0; i < rawIndices.length; i += 1) {
      const v = asNumber(rawIndices[i]);
      if (v === null || !Number.isInteger(v) || v < 0 || v >= vertices) return refuse("an index names no vertex");
      indices[i] = v;
    }
    if (indices.length === 0) continue;
    parts.push({ part, name, color: [clamp(rgb[0], 0, 255) / 255, clamp(rgb[1], 0, 255) / 255, clamp(rgb[2], 0, 255) / 255], positions, indices });
  }
  if (triangles === 0) return refuse("it has no triangles");
  const extent: Bounds = { min: [lo[0], lo[1], lo[2]], max: [hi[0], hi[1], hi[2]] };
  const sent = isRecord(result["bounds"]) ? result["bounds"] : null;
  const min = sent === null ? null : asVec3(sent["min"]);
  const max = sent === null ? null : asVec3(sent["max"]);
  if (min === null || max === null) return refuse("it has no bounds");
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) return refuse("its bounds are inside out");
  if (Math.max(...min.map(Math.abs), ...max.map(Math.abs)) > MAX_COORDINATE) return refuse("its bounds are out of range");
  const notes = asStringList(result["notes"], MAX_NOTES).map((note) => note.slice(0, MAX_NOTE_LENGTH));
  return { ok: true, mesh: { parts, bounds: { min, max }, extent, triangles, notes } };
}

/** The piece's overall size as it is read, from the engine's bounds: "21.4 × 23.8 × 4.0 mm". */
export function formatSize(bounds: Bounds): string {
  const side = (axis: 0 | 1 | 2): string => Math.max(0, bounds.max[axis] - bounds.min[axis]).toFixed(1);
  return `${side(0)} × ${side(1)} × ${side(2)} mm`;
}

/** A count as it is read: "12,480 triangles". */
export function formatTriangles(count: number): string {
  return count === 1 ? "1 triangle" : `${count.toLocaleString("en-US")} triangles`;
}

// ---- vertex buffers ----

/** Floats per vertex: position, normal, colour. */
export const VERTEX_FLOATS = 9;

/** One draw call's worth: every triangle of one kind, expanded so each corner has its own normal. */
export interface Batch {
  /** `VERTEX_FLOATS` per vertex, three vertices per triangle. */
  data: Float32Array;
  vertices: number;
}

export interface Buffers {
  metal: Batch;
  stone: Batch;
}

/** Faces that meet at less than this angle (as its cosine) shade as one curved surface. */
const CREASE_COS = Math.cos((38 * Math.PI) / 180);

/**
 * The buffers the viewport uploads. The engine sends no normals: each is taken from the triangles.
 * A stone is facets, so each of its faces is lit flat. Metal is lit smooth across faces that share
 * a vertex and meet at a shallow angle (a band's curve) and flat across a sharp edge (a band's
 * rim). A triangle with no area is left out. The total is capped at `MAX_TRIANGLES`, the same
 * ceiling the reply is held to, so the memory is bounded whatever is passed.
 */
export function buildBuffers(mesh: PieceMesh): Buffers {
  const count = (kind: PartKind): number => mesh.parts.reduce((sum, part) => (part.part === kind ? sum + part.indices.length / 3 : sum), 0);
  let budget = MAX_TRIANGLES;
  const build = (kind: PartKind): Batch => {
    const room = Math.min(count(kind), budget);
    budget -= room;
    const data = new Float32Array(room * 3 * VERTEX_FLOATS);
    let written = 0;
    for (const part of mesh.parts) {
      if (part.part !== kind) continue;
      written = writePart(part, kind === "metal", data, written, room);
    }
    return { data: written === room ? data : data.subarray(0, written * 3 * VERTEX_FLOATS), vertices: written * 3 };
  };
  return { metal: build("metal"), stone: build("stone") };
}

/** Write one mesh's triangles into `data` from triangle `start`; returns the next free triangle. */
function writePart(part: PartMesh, smooth: boolean, data: Float32Array, start: number, room: number): number {
  const { positions, indices, color } = part;
  const faces = indices.length / 3;
  const vertices = positions.length / 3;
  // Each face's unit normal (zero for a face with no area).
  const normals = new Float32Array(faces * 3);
  for (let face = 0; face < faces; face += 1) {
    const a = (indices[face * 3] ?? 0) * 3;
    const b = (indices[face * 3 + 1] ?? 0) * 3;
    const c = (indices[face * 3 + 2] ?? 0) * 3;
    const ux = (positions[b] ?? 0) - (positions[a] ?? 0);
    const uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 1e-12) || !Number.isFinite(length)) continue;
    normals[face * 3] = nx / length;
    normals[face * 3 + 1] = ny / length;
    normals[face * 3 + 2] = nz / length;
  }
  // The faces around each vertex, as one flat list with an offset per vertex.
  let offsets: Uint32Array | null = null;
  let around: Uint32Array | null = null;
  if (smooth) {
    offsets = new Uint32Array(vertices + 1);
    for (let i = 0; i < indices.length; i += 1) {
      const slot = (indices[i] ?? 0) + 1;
      offsets[slot] = (offsets[slot] ?? 0) + 1;
    }
    for (let v = 0; v < vertices; v += 1) offsets[v + 1] = (offsets[v + 1] ?? 0) + (offsets[v] ?? 0);
    around = new Uint32Array(indices.length);
    const filled = new Uint32Array(vertices);
    for (let i = 0; i < indices.length; i += 1) {
      const v = indices[i] ?? 0;
      around[(offsets[v] ?? 0) + (filled[v] ?? 0)] = Math.floor(i / 3);
      filled[v] = (filled[v] ?? 0) + 1;
    }
  }
  let triangle = start;
  for (let face = 0; face < faces && triangle < room; face += 1) {
    const fx = normals[face * 3] ?? 0;
    const fy = normals[face * 3 + 1] ?? 0;
    const fz = normals[face * 3 + 2] ?? 0;
    if (fx === 0 && fy === 0 && fz === 0) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const v = indices[face * 3 + corner] ?? 0;
      let nx = fx;
      let ny = fy;
      let nz = fz;
      if (offsets !== null && around !== null) {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        const end = offsets[v + 1] ?? 0;
        for (let k = offsets[v] ?? 0; k < end; k += 1) {
          const other = (around[k] ?? 0) * 3;
          const ox = normals[other] ?? 0;
          const oy = normals[other + 1] ?? 0;
          const oz = normals[other + 2] ?? 0;
          if (ox * fx + oy * fy + oz * fz < CREASE_COS) continue;
          sx += ox;
          sy += oy;
          sz += oz;
        }
        const length = Math.hypot(sx, sy, sz);
        if (length > 1e-6) {
          nx = sx / length;
          ny = sy / length;
          nz = sz / length;
        }
      }
      const at = (triangle * 3 + corner) * VERTEX_FLOATS;
      data[at] = positions[v * 3] ?? 0;
      data[at + 1] = positions[v * 3 + 1] ?? 0;
      data[at + 2] = positions[v * 3 + 2] ?? 0;
      data[at + 3] = nx;
      data[at + 4] = ny;
      data[at + 5] = nz;
      data[at + 6] = color[0];
      data[at + 7] = color[1];
      data[at + 8] = color[2];
    }
    triangle += 1;
  }
  return triangle;
}

// ---- the ground ----

/** A round step near `value`: 1, 2 or 5 times a power of ten. */
export function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const lead = value / power;
  return (lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10) * power;
}

/** Floats per grid vertex: position and how strongly the line shows there (0…1). */
export const GRID_FLOATS = 4;

/**
 * A faint grid on the plane the piece stands on (its lowest Y), as line segments that fade out
 * toward the edge. It is a drawing aid, like the 2D canvas's grid: it shows where down is and how
 * big a millimetre step is, and is no part of the piece.
 */
export function groundGrid(extent: Bounds): { data: Float32Array; vertices: number; step: number } {
  const scene = sceneOf(extent);
  const y = Number.isFinite(extent.min[1]) ? extent.min[1] : 0;
  const reach = scene.radius * GROUND_REACH;
  const step = niceStep(reach / 8);
  const lines = Math.min(40, Math.floor(reach / step));
  const span = lines * step;
  const pieces = 16;
  const data = new Float32Array((2 * lines + 1) * 2 * pieces * 2 * GRID_FLOATS);
  let at = 0;
  const cx = Math.round(scene.center[0] / step) * step;
  const cz = Math.round(scene.center[2] / step) * step;
  const put = (x: number, z: number): void => {
    const away = Math.hypot(x - cx, z - cz) / span;
    data[at] = x;
    data[at + 1] = y;
    data[at + 2] = z;
    data[at + 3] = clamp(1 - away * away, 0, 1);
    at += GRID_FLOATS;
  };
  for (let line = -lines; line <= lines; line += 1) {
    const offset = line * step;
    for (let piece = 0; piece < pieces; piece += 1) {
      const from = -span + (2 * span * piece) / pieces;
      const to = -span + (2 * span * (piece + 1)) / pieces;
      put(cx + offset, cz + from);
      put(cx + offset, cz + to);
      put(cx + from, cz + offset);
      put(cx + to, cz + offset);
    }
  }
  return { data, vertices: at / GRID_FLOATS, step };
}

// ---- the STL download ----

/** The largest STL the shell hands to the browser: the contract's triangles at 50 bytes each, and the header. */
const MAX_STL_BYTES = MAX_TRIANGLES * 50 + 84;

export type StlReply = { ok: true; name: string; bytes: Uint8Array } | { ok: false; error: string };

/** Read `stlout`'s result: the file's bytes and a name that is safe to save under and ends in `.stl`. */
export function parseStlReply(result: unknown): StlReply {
  const refused = (why: string): StlReply => ({ ok: false, error: `the STL could not be read: ${why}` });
  if (!isRecord(result)) return refused("the reply is not an object");
  const text = asString(result["base64"]);
  if (text === null || text === "") return refused("it holds no file");
  if (text.length > Math.ceil(MAX_STL_BYTES / 3) * 4 + 4) return refused("the file is too large");
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return refused("the file is not base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const cleaned = (asString(result["name"]) ?? "")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .slice(0, 120);
  const stem = cleaned.replace(/\.stl$/i, "").replace(/^\.+/, "");
  return { ok: true, name: `${stem === "" ? "piece" : stem}.stl`, bytes };
}

/** Whether the engine's refusal says it has no such command: the 3D view is not in this build. */
export function isUnknownCommand(error: string): boolean {
  return /unknown command/i.test(error);
}
