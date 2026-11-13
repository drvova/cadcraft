/**
 * The realistic look's physics, without a GPU: what each metal and stone is made of (its
 * reflectance at normal incidence, its index of refraction, its dispersion, its body colour), the
 * studio the piece is lit by, and the curve that brings the light into a screen's range. The
 * shaders in `./render3d.ts` evaluate the same studio and the same formulas; this module is their
 * tested reference and their source of numbers.
 *
 * The values are this project's own approximations of commonly quoted optical constants
 * (normal-incidence reflectance of the pure metals and their alloys, gemmological refractive
 * indices and B–G dispersions), rounded and chosen by eye under the studio below. No table, image
 * or environment map was copied from anywhere: the studio is a few rectangles and a gradient,
 * drawn by formula.
 *
 * The renderer receives only the engine's colour for a part (`piecemesh` names a part `metal` or
 * `stone` and gives it the colour of its alloy or gem), so a material is found by that colour:
 * the nearest entry of the engine's own palette, or a generic one made from the colour itself.
 */

import type { Vec3 } from "./view3d";

// ---- colour spaces ----

/** One sRGB channel (0…1) to linear light. */
export function srgbToLinear(c: number): number {
  const v = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** One linear channel (0…1, clamped) to sRGB. */
export function linearToSrgb(c: number): number {
  const v = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const linear3 = (c: Vec3): Vec3 => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
const bytes = (r: number, g: number, b: number): Vec3 => [r / 255, g / 255, b / 255];

// ---- metals ----

export interface Metal {
  id: string;
  /** The colour the engine gives the alloy (sRGB 0…1): how the renderer recognises it. */
  engine: Vec3;
  /** Reflectance at normal incidence, linear RGB: a metal's specular colour (Fresnel-Schlick F0). */
  f0: Vec3;
  /** GGX roughness of a polished finish (0 is a perfect mirror). */
  roughness: number;
  /** Not a metal at all (casting wax): a dielectric with `f0` as its body colour. */
  dielectric?: boolean;
}

/**
 * Polished alloys. The golds run from the deep yellow of fine gold toward the paler 9k as the
 * alloy carries more silver and copper; platinum and palladium are the cool, slightly darker white
 * metals; silver is the brightest. The engine's palette has no rose gold; a rose colour that
 * reaches the renderer gets the copper-leaning generic of `metalOf`.
 */
export const METALS: readonly Metal[] = [
  { id: "gold24", engine: bytes(255, 198, 52), f0: [1.0, 0.7, 0.24], roughness: 0.07 },
  { id: "gold22", engine: bytes(250, 198, 68), f0: [0.99, 0.71, 0.28], roughness: 0.07 },
  { id: "gold18", engine: bytes(240, 196, 92), f0: [0.98, 0.72, 0.33], roughness: 0.08 },
  { id: "gold14", engine: bytes(233, 197, 112), f0: [0.95, 0.74, 0.42], roughness: 0.08 },
  { id: "gold10", engine: bytes(226, 198, 130), f0: [0.92, 0.76, 0.5], roughness: 0.09 },
  { id: "platinum", engine: bytes(229, 228, 226), f0: [0.74, 0.72, 0.68], roughness: 0.07 },
  { id: "palladium", engine: bytes(206, 208, 211), f0: [0.72, 0.7, 0.67], roughness: 0.08 },
  { id: "silver", engine: bytes(224, 225, 229), f0: [0.96, 0.95, 0.92], roughness: 0.06 },
  { id: "steel", engine: bytes(176, 180, 186), f0: [0.56, 0.57, 0.58], roughness: 0.14 },
  { id: "titanium", engine: bytes(135, 134, 130), f0: [0.54, 0.5, 0.45], roughness: 0.16 },
  { id: "brass", engine: bytes(201, 170, 82), f0: [0.9, 0.77, 0.43], roughness: 0.1 },
  { id: "copper", engine: bytes(200, 117, 51), f0: [0.95, 0.64, 0.54], roughness: 0.1 },
  { id: "wax", engine: bytes(58, 140, 112), f0: linear3(bytes(58, 140, 112)), roughness: 0.35, dielectric: true },
];

/** How far (in sRGB, summed squares) a colour may be from a palette entry and still be it. */
const MATCH = 0.004;

function nearest<T extends { engine: Vec3 }>(table: readonly T[], color: Vec3): T | null {
  let best: T | null = null;
  let distance = MATCH;
  for (const entry of table) {
    const d = (entry.engine[0] - color[0]) ** 2 + (entry.engine[1] - color[1]) ** 2 + (entry.engine[2] - color[2]) ** 2;
    if (d <= distance) {
      distance = d;
      best = entry;
    }
  }
  return best;
}

const finiteColor = (color: Vec3): Vec3 => [0, 1, 2].map((i) => (Number.isFinite(color[i]) ? Math.min(1, Math.max(0, color[i] ?? 0)) : 0.8)) as unknown as Vec3;

/** The metal of an engine colour: its palette entry, or a polished metal of that colour. */
export function metalOf(color: Vec3): Metal {
  const c = finiteColor(color);
  const known = nearest(METALS, c);
  if (known !== null) return known;
  // An unknown alloy: its own colour as the reflectance, kept bright enough to read as metal.
  const f0 = linear3(c);
  const peak = Math.max(f0[0], f0[1], f0[2], 1e-3);
  const lift = peak < 0.55 ? 0.55 / peak : 1;
  return { id: "metal", engine: c, f0: [Math.min(1, f0[0] * lift), Math.min(1, f0[1] * lift), Math.min(1, f0[2] * lift)], roughness: 0.1 };
}

// ---- stones ----

export interface Stone {
  id: string;
  engine: Vec3;
  /** Refractive index (sodium D line). */
  ior: number;
  /** Dispersion: the index's spread between the blue and the red end (B–G interval). */
  dispersion: number;
  /** What the light picks up inside, linear RGB per unit path: white for a colourless stone. */
  body: Vec3;
  /** Light does not pass (opal, pearl, onyx…): shaded as a polished body of its colour. */
  opaque: boolean;
}

const stone = (id: string, rgb: Vec3, ior: number, dispersion: number, opaque = false, body?: Vec3): Stone => ({
  id,
  engine: rgb,
  ior,
  dispersion,
  body: body ?? linear3(rgb),
  opaque,
});

/**
 * Gems. The colourless ones (diamond, and what the engine paints like it: cubic zirconia,
 * moissanite, quartz, zircon) share the engine's colour, so they are drawn as diamond.
 */
export const STONES: readonly Stone[] = [
  stone("diamond", bytes(226, 238, 250), 2.42, 0.044, false, [0.97, 0.98, 1.0]),
  stone("sapphire", bytes(22, 62, 160), 1.77, 0.018),
  stone("ruby", bytes(176, 16, 44), 1.77, 0.018),
  stone("emerald", bytes(16, 132, 82), 1.58, 0.014),
  stone("morganite", bytes(244, 190, 186), 1.59, 0.014),
  stone("aquamarine", bytes(150, 216, 226), 1.58, 0.014),
  stone("amethyst", bytes(142, 84, 180), 1.55, 0.013),
  stone("citrine", bytes(228, 168, 44), 1.55, 0.013),
  stone("topaz", bytes(112, 184, 228), 1.62, 0.014),
  stone("spinel", bytes(206, 52, 92), 1.72, 0.02),
  stone("tanzanite", bytes(78, 70, 172), 1.69, 0.019),
  stone("tourmaline", bytes(214, 80, 136), 1.63, 0.017),
  stone("garnet", bytes(124, 22, 30), 1.76, 0.022),
  stone("peridot", bytes(164, 200, 52), 1.67, 0.02),
  stone("alexandrite", bytes(52, 132, 122), 1.75, 0.015),
  stone("opal", bytes(226, 236, 232), 1.45, 0, true),
  stone("pearl", bytes(240, 234, 220), 1.53, 0, true),
  stone("onyx", bytes(24, 24, 28), 1.54, 0, true),
  stone("turquoise", bytes(64, 190, 196), 1.62, 0, true),
  stone("lapis", bytes(34, 64, 150), 1.5, 0, true),
  stone("jade", bytes(92, 164, 110), 1.66, 0, true),
  stone("moonstone", bytes(214, 222, 236), 1.52, 0, true),
  stone("coral", bytes(240, 112, 88), 1.49, 0, true),
];

/** The stone of an engine colour: its palette entry, or a transparent gem of that colour. */
export function stoneOf(color: Vec3): Stone {
  const c = finiteColor(color);
  return nearest(STONES, c) ?? stone("gem", c, 1.65, 0.016);
}

/** Reflectance at normal incidence of a dielectric of index `ior` in air. */
export function f0OfIor(ior: number): number {
  const n = Number.isFinite(ior) && ior >= 1 ? ior : 1.5;
  return ((n - 1) / (n + 1)) ** 2;
}

/** Fresnel-Schlick: the share reflected at `cos` (angle to the normal) for a reflectance `f0` at normal incidence. */
export function fresnelSchlick(cos: number, f0: number): number {
  const c = Number.isFinite(cos) ? Math.min(1, Math.max(0, cos)) : 1;
  return f0 + (1 - f0) * (1 - c) ** 5;
}

/**
 * The index for red, green and blue: the dispersion spread across the three, red lowest. It is
 * widened by `FIRE` so the fire shows at the size a stone is seen on screen; the shader uses the same.
 */
export const FIRE = 1.2;

export function channelIors(s: Stone): Vec3 {
  const half = (s.dispersion * FIRE) / 2;
  return [s.ior - half, s.ior, s.ior + half];
}

/**
 * The material numbers a vertex carries in the realistic buffers, four floats after its position
 * and normal. Metal: the reflectance (linear) and the roughness, negated for a dielectric. Stone:
 * the body colour (linear) and the index, negated for an opaque stone.
 */
export function materialFloats(kind: "metal" | "stone", color: Vec3): [number, number, number, number] {
  if (kind === "metal") {
    const m = metalOf(color);
    return [m.f0[0], m.f0[1], m.f0[2], m.dielectric === true ? -m.roughness : m.roughness];
  }
  const s = stoneOf(color);
  return [s.body[0], s.body[1], s.body[2], s.opaque ? -s.ior : s.ior];
}

/** Floats per vertex of a realistic batch: position, normal, the four of `materialFloats`, and the widened dispersion (a stone's; 0 for metal). */
export const REAL_FLOATS = 11;

/**
 * A batch of `VERTEX_FLOATS`-per-vertex (position, normal, colour) rewritten for the realistic
 * shader: the colour becomes the material. Colours repeat (a piece has one metal and one or two
 * stones), so each is looked up once.
 */
export function realBatch(kind: "metal" | "stone", data: Float32Array, vertices: number, stride: number): Float32Array {
  const count = Math.max(0, Math.min(Math.floor(vertices), Math.floor(data.length / Math.max(1, stride))));
  const out = new Float32Array(count * REAL_FLOATS);
  const memo = new Map<string, number[]>();
  for (let v = 0; v < count; v += 1) {
    const at = v * stride;
    const to = v * REAL_FLOATS;
    for (let i = 0; i < 6; i += 1) out[to + i] = data[at + i] ?? 0;
    const color: Vec3 = [data[at + 6] ?? 0, data[at + 7] ?? 0, data[at + 8] ?? 0];
    const key = `${color[0]},${color[1]},${color[2]}`;
    let mat = memo.get(key);
    if (mat === undefined) {
      mat = [...materialFloats(kind, color), kind === "stone" ? stoneOf(color).dispersion * FIRE : 0];
      memo.set(key, mat);
    }
    out[to + 6] = mat[0] ?? 0;
    out[to + 7] = mat[1] ?? 0;
    out[to + 8] = mat[2] ?? 0;
    out[to + 9] = mat[3] ?? 0;
    out[to + 10] = mat[4] ?? 0;
  }
  return out;
}

// ---- the studio ----

/**
 * One softbox, in the eye's frame (x right, y up, z toward the viewer): where its centre lies, how
 * it is turned, its half-size as the tangent of the angle it spans, and its brightness.
 */
export interface Softbox {
  dir: Vec3;
  /** The box's own "across" direction, at right angles to `dir`. */
  across: Vec3;
  half: readonly [number, number];
  intensity: number;
  /** Width of the soft edge, in the same tangent units. */
  edge: number;
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A box facing the piece from `dir`, its long side across (horizontal) unless `tall`. */
function box(dir: Vec3, half: readonly [number, number], intensity: number, edge: number): Softbox {
  const d = unit(dir);
  const across = unit(cross([0, 1, 0], d));
  return { dir: d, across: Math.hypot(...across) > 0 ? across : [1, 0, 0], half, intensity, edge };
}

/**
 * A jeweller's light tent, seen from the piece: a broad box overhead, a key strip high on the
 * left, a narrow fill strip on the right and a low kicker behind, with dark gaps between them.
 * The gaps matter as much as the boxes: polished metal and a diamond are read by the contrast of
 * what they mirror.
 */
export const STUDIO: readonly Softbox[] = [
  box([0.0, 1.0, 0.25], [0.95, 0.6], 4.0, 0.12),
  box([-0.85, 0.45, 0.55], [0.22, 0.8], 7.0, 0.06),
  box([0.9, 0.25, 0.5], [0.12, 0.7], 4.0, 0.05),
  box([0.2, 0.35, -1.0], [0.9, 0.18], 3.0, 0.08),
];

/**
 * The sweep behind the boxes: brightness at the floor, at the horizon and overhead, and how much of
 * the light straight behind the eye is held back (the photographer and the camera, which a polished
 * piece mirrors: the dark that gives a diamond its contrast).
 */
export const SWEEP = { floor: 0.12, horizon: 1.3, top: 0.6, eye: 0.85 } as const;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How a box spreads at a roughness: its edge widens and its brightness falls so its light is kept. */
export function boxSpread(b: Softbox, roughness: number): { edge: number; gain: number } {
  const r = Number.isFinite(roughness) ? Math.min(1, Math.max(0, roughness)) : 0;
  const edge = b.edge + 1.6 * r * r;
  const gain = (b.half[0] * b.half[1]) / ((b.half[0] + edge - b.edge) * (b.half[1] + edge - b.edge));
  return { edge, gain };
}

/**
 * The studio's light arriving along `dir` (eye frame), as seen in a mirror of `roughness`: the
 * analytic stand-in for a prefiltered environment map. The roughness widens each box's edge and
 * lowers its brightness by the area it grew by, so a rough metal sees a soft, dimmer glow and a
 * polished one a crisp, bright box. The shader's `studio()` is this function.
 */
export function studioRadiance(dir: Vec3, roughness: number): number {
  return sweepRadiance(dir, roughness) + boxRadiance(dir, roughness);
}

/** The sweep alone (the shader's `sweep()`). */
export function sweepRadiance(dir: Vec3, roughness: number): number {
  const d = unit(dir);
  const y = d[1];
  const r = Number.isFinite(roughness) ? Math.min(1, Math.max(0, roughness)) : 0;
  const soft = 0.12 + 0.6 * r;
  const light = y < 0 ? SWEEP.floor + (SWEEP.horizon - SWEEP.floor) * smoothstep(-0.3 - soft, 0.02, y) : SWEEP.top + (SWEEP.horizon - SWEEP.top) * (1 - smoothstep(0, 0.6 + soft, y));
  return light * (1 - SWEEP.eye * smoothstep(0.82 - soft * 0.5, 0.97, d[2]));
}

/** The softboxes alone (the shader's `boxes()`): what a stone returns from inside, where the sweep is lost. */
export function boxRadiance(dir: Vec3, roughness: number): number {
  const d = unit(dir);
  const r = Number.isFinite(roughness) ? Math.min(1, Math.max(0, roughness)) : 0;
  let light = 0;
  for (const b of STUDIO) {
    const c = dot(d, b.dir);
    if (c <= 0.02) continue;
    const up = cross(b.dir, b.across);
    const x = Math.abs(dot(d, b.across) / c);
    const yy = Math.abs(dot(d, up) / c);
    const { edge, gain } = boxSpread(b, r);
    const mx = 1 - smoothstep(b.half[0] - edge, b.half[0] + edge, x);
    const my = 1 - smoothstep(b.half[1] - edge, b.half[1] + edge, yy);
    light += b.intensity * gain * mx * my;
  }
  return light;
}

// ---- the picture ----

/** ACES filmic tone curve (Narkowicz's fit), linear light in, 0…1 out. */
export function acesFilm(x: number): number {
  const v = Number.isFinite(x) ? Math.max(0, x) : 0;
  const mapped = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  return Math.min(1, Math.max(0, mapped));
}

/**
 * How much of a colour's own hue a bright highlight keeps. Run per channel, ACES drives a bright
 * gold toward a pale cream (its red and green both saturate while its blue climbs): the khaki,
 * washed-out gold. The hue-keeping curve maps the brightest channel through ACES and scales the
 * others with it, so gold stays gold up to its brightest highlight; `HUE_KEEP.white` of the
 * per-channel curve is mixed back so the hottest glints still burn toward white. Metal only: the
 * stones keep the per-channel curve and their look.
 */
export const HUE_KEEP = { white: 0.22 } as const;

/** The hue-keeping tone curve (the shader's `finish()` for metal), linear light in, 0…1 out. */
export function toneKeepHue(c: Vec3, white: number = HUE_KEEP.white): Vec3 {
  const v: Vec3 = [0, 1, 2].map((i) => (Number.isFinite(c[i]) ? Math.max(0, c[i] ?? 0) : 0)) as unknown as Vec3;
  const peak = Math.max(v[0], v[1], v[2]);
  const k = peak > 1e-6 ? acesFilm(peak) / peak : 0;
  const w = Number.isFinite(white) ? Math.min(1, Math.max(0, white)) : 0;
  return v.map((x) => Math.min(1, Math.max(0, x * k * (1 - w) + acesFilm(x) * w))) as unknown as Vec3;
}

/**
 * The deeper colour a coloured metal shows where it mirrors the dim sweep rather than a box: in a
 * jeweller's tent the dark around a gold piece is lit by the gold itself and by warm cards, so its
 * shadows are a deep amber, not a grey-brown. The reflectance is raised to a power that grows with
 * how coloured the alloy is (its saturation), so the white metals are left as they are. The shader
 * does the same per pixel.
 */
export function deepTint(f0: Vec3): Vec3 {
  const hi = Math.max(f0[0], f0[1], f0[2]);
  const lo = Math.min(f0[0], f0[1], f0[2]);
  if (!(hi > 0) || !Number.isFinite(hi) || !Number.isFinite(lo)) return [0, 0, 0];
  const p = 1 + DEEP_POWER * smoothstep(0.2, 0.55, (hi - lo) / hi);
  return f0.map((x) => hi * Math.pow(Math.max(0, x) / hi, p)) as unknown as Vec3;
}

/** How much deeper a fully coloured alloy's shadows are (the extra power `deepTint` raises it to). */
export const DEEP_POWER = 0.9;

/** The exposure the realistic shader multiplies by before the tone curve. */
export const EXPOSURE = 0.85;

/** How a still is supersampled: drawn this many times larger on each side, then scaled down. */
export const STILL_SUPERSAMPLE = 2;

/** The size a still is drawn at before it is scaled down: twice its size, but never over `max` on a side. */
export function supersampledSize(width: number, height: number, max: number): { width: number; height: number; factor: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const factor = Math.max(1, Math.min(STILL_SUPERSAMPLE, max / Math.max(w, h)));
  return { width: Math.max(1, Math.round(w * factor)), height: Math.max(1, Math.round(h * factor)), factor };
}

// ---- the contact shadow ----

/** Floats per vertex of the shadow quad: position, then where it lies across the shadow (−1…1 each way). */
export const SHADOW_FLOATS = 5;

/**
 * A square on the ground plane (the piece's lowest Y, a hair beneath it) under the piece, a little
 * wider than its footprint, for the soft contact shadow: two triangles, the shader darkens toward
 * the middle. Null when the box is not finite.
 */
export function contactShadow(extent: { min: Vec3; max: Vec3 }): Float32Array | null {
  const [x0, y0, z0] = extent.min;
  const [x1, y1, z1] = extent.max;
  if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite) || x1 < x0 || z1 < z0 || y1 < y0) return null;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const span = Math.max(x1 - x0, z1 - z0, (y1 - y0) * 0.5, 1e-3);
  const hx = Math.max((x1 - x0) * 0.75, span * 0.45);
  const hz = Math.max((z1 - z0) * 0.75, span * 0.45);
  const y = y0 - span * 0.002;
  const corner = (sx: number, sz: number): number[] => [cx + sx * hx, y, cz + sz * hz, sx, sz];
  return new Float32Array([...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1)]);
}
