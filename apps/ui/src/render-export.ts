/**
 * Render export, the pure parts: what a jeweller asks for (a still, a turntable, a contact sheet)
 * turned into plans a GPU can draw, and the bytes of the files written from them. No DOM and no
 * WebGL here: `components/RenderExportDialog.tsx` draws (through `render3d`'s `withPieceFrames`),
 * this module decides the sizes, the stores, the cameras and the frame times, and writes the
 * animated PNG (`encodeApng`, with its own CRC and chunks; the deflate is handed in, the browser's
 * `CompressionStream("deflate")` by default).
 *
 * Why an animated PNG and not a GIF for the fallback: a GIF holds 256 colours a frame, and polished
 * metal is long smooth gradients of one hue under a highlight — quantised, it bands and dithers
 * visibly, worst on the very thing a client looks at. An APNG keeps every frame in full 8-bit RGBA
 * (so a transparent turntable keeps soft edges and the contact shadow), it plays in every current
 * browser and in the system webviews, and it is a small amount of code: PNG chunks, `acTL`, `fcTL`
 * and `fdAT`. The cost is size: frames are stored losslessly, so an APNG is many times a WebM.
 */

import { fitCamera, sceneOf, STANDARD_VIEWS, type Camera, type Scene, type StandardView, type Vec3 } from "./view3d";

// ---- what is asked ----

export type ExportKind = "image" | "turntable" | "sheet";
export type BackgroundChoice = "studio" | "light" | "transparent";
export type AspectChoice = "square" | "wide";
export type AngleChoice = "current" | StandardView;
export type VideoFormat = "webm" | "apng";

export const KIND_OPTIONS: readonly { value: ExportKind; label: string }[] = [
  { value: "image", label: "Image (PNG)" },
  { value: "turntable", label: "Turntable" },
  { value: "sheet", label: "Contact sheet (PNG)" },
];

export const BACKGROUND_OPTIONS: readonly { value: BackgroundChoice; label: string }[] = [
  { value: "studio", label: "Studio" },
  { value: "light", label: "Light seamless" },
  { value: "transparent", label: "Transparent" },
];

export const ASPECT_OPTIONS: readonly { value: AspectChoice; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "wide", label: "Wide 16:9" },
];

export const ANGLE_OPTIONS: readonly { value: AngleChoice; label: string }[] = [
  { value: "current", label: "Current view" },
  { value: "three-quarter", label: "Three-quarter" },
  { value: "front", label: "Front" },
  { value: "top", label: "Top" },
  { value: "side", label: "Side" },
];

/** The long side of a still, in pixels. */
export const IMAGE_SIZES: readonly number[] = [1080, 2048, 4096];
/** The long side of a turntable: every frame is drawn and kept, so it stays modest. */
export const TURNTABLE_SIZES: readonly number[] = [480, 720, 1080];
export const FPS_OPTIONS: readonly number[] = [24, 30, 60];
export const SECONDS_MIN = 1;
export const SECONDS_MAX = 20;
/** The tilt of a turntable's eye above the piece, in degrees. */
export const TILT_MIN = 0;
export const TILT_MAX = 60;
/** A turntable never has more frames than this (20 s at 60 frames a second would be 1200). */
export const MAX_FRAMES = 600;
/** A WebM is drawn first and played into the recorder; the frames waiting may hold at most this many bytes. */
export const MAX_HELD_BYTES = 640 * 1024 * 1024;
/** A still is drawn at up to this many times its size and scaled down. */
export const SUPERSAMPLE = 2;

/**
 * The backdrops, red, green and blue in 0…1. The studio is the stage's realistic sweep over a deep
 * neutral; the light one a near-white seamless paper; transparent is a cut-out (null).
 */
const BACKGROUNDS: Readonly<Record<BackgroundChoice, Vec3 | null>> = {
  studio: [0.15, 0.155, 0.17],
  light: [0.9, 0.9, 0.91],
  transparent: null,
};

export function backgroundColor(choice: BackgroundChoice): Vec3 | null {
  return BACKGROUNDS[choice];
}

export function isChoice<T extends string>(options: readonly { value: T }[], value: string): value is T {
  return options.some((option) => option.value === value);
}

/** The picture's size for a long side and an aspect: a wide picture keeps the long side across. */
export function pictureSize(longSide: number, aspect: AspectChoice): { width: number; height: number } {
  const side = Number.isFinite(longSide) ? Math.max(16, Math.min(8192, Math.round(longSide))) : 1080;
  // Even sides: video encoders want them, and a 16:9 of an even side is then whole.
  const even = (n: number): number => Math.max(16, 2 * Math.round(n / 2));
  return aspect === "wide" ? { width: even(side), height: even((side * 9) / 16) } : { width: even(side), height: even(side) };
}

// ---- the store, held to the GPU ----

/** What the GPU says it can draw into, in pixels a side. */
export interface GpuLimits {
  maxTexture: number;
  maxRenderbuffer: number;
  /** The viewport's largest width and height. */
  maxViewport: number;
}

export interface StorePlan {
  /** The picture that is written. */
  width: number;
  height: number;
  /** The store it is drawn in (larger by `factor` when supersampled). */
  storeWidth: number;
  storeHeight: number;
  factor: number;
  /** In words, when the picture is smaller or less smoothed than asked because of the GPU; null when it is as asked. */
  note: string | null;
}

/** The largest side this GPU draws into: the least of its limits (a bad or missing reading counts as 2048, which every WebGL GPU has). */
export function gpuSide(limits: GpuLimits): number {
  const read = (n: number): number => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2048);
  return Math.min(read(limits.maxTexture), read(limits.maxRenderbuffer), read(limits.maxViewport));
}

/**
 * The store a picture is drawn in. It is drawn at `SUPERSAMPLE` times its size where the GPU
 * allows, less where it does not; and where even one pixel per pixel is past the GPU, the picture
 * itself is made smaller to fit, and the note says so. One store, never tiled: the realistic
 * backdrop is a sweep across the whole view, so tiles would each carry their own.
 */
export function storePlan(width: number, height: number, limits: GpuLimits, supersample = SUPERSAMPLE): StorePlan {
  const cap = gpuSide(limits);
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  let note: string | null = null;
  const long = Math.max(w, h);
  if (long > cap) {
    const shrink = cap / long;
    w = Math.max(1, Math.floor(w * shrink));
    h = Math.max(1, Math.floor(h * shrink));
    note = `This graphics card draws at most ${cap} pixels a side, so the picture is ${w} × ${h} instead of ${Math.round(width)} × ${Math.round(height)}.`;
  }
  const factor = Math.max(1, Math.min(supersample, cap / Math.max(w, h)));
  const storeWidth = Math.max(1, Math.min(cap, Math.round(w * factor)));
  const storeHeight = Math.max(1, Math.min(cap, Math.round(h * factor)));
  if (note === null && factor < supersample) note = `This graphics card draws at most ${cap} pixels a side, so the picture is smoothed ${factor <= 1 ? "less (drawn at its own size)" : `at ${factor.toFixed(2)}×`} instead of ${supersample}×.`;
  return { width: w, height: h, storeWidth, storeHeight, factor, note };
}

// ---- cameras ----

/** The eye for a still: the stage's own Perspective camera as it was left, or a standard view framed to the picture. */
export function stillCamera(angle: AngleChoice, current: Camera | null, scene: Scene, aspect: number): Camera {
  if (angle === "current" && current !== null) return current;
  const view: StandardView = angle === "current" ? "three-quarter" : angle;
  return fitCamera({ target: scene.center, distance: 1, ...STANDARD_VIEWS[view] }, scene, aspect);
}

export interface TurntablePlan {
  frames: number;
  fps: number;
  /** Milliseconds each frame is shown (the WebM's pacing). */
  frameMs: number;
  /** The APNG's delay: `num`/`den` seconds a frame. */
  delayNum: number;
  delayDen: number;
  /** The real length, in seconds: `frames / fps`. */
  seconds: number;
}

/** How many frames a turntable has and how long each shows. The seconds and the rate are held to their ranges. */
export function turntablePlan(seconds: number, fps: number): TurntablePlan {
  const rate = Number.isFinite(fps) ? Math.max(1, Math.min(60, Math.round(fps))) : 30;
  const secs = Number.isFinite(seconds) ? Math.max(SECONDS_MIN, Math.min(SECONDS_MAX, seconds)) : 4;
  const frames = Math.max(2, Math.min(MAX_FRAMES, Math.round(secs * rate)));
  return { frames, fps: rate, frameMs: 1000 / rate, delayNum: 1, delayDen: rate, seconds: frames / rate };
}

/**
 * The eye of each frame of a turntable: one whole turn about the piece's upright axis, starting at
 * `startYaw`, in `frames` equal steps. Frame `frames` would be frame 0 again, so it is not drawn:
 * played in a loop, the turn is seamless with no doubled frame. The eye stands `tilt` degrees
 * above the piece and as far as frames the whole piece at every turn (the bounding sphere does not
 * turn, so the distance is one for all of them).
 */
export function turntableCameras(scene: Scene, aspect: number, frames: number, tiltDegrees: number, startYaw = STANDARD_VIEWS["three-quarter"].yaw): Camera[] {
  const count = Number.isFinite(frames) ? Math.max(1, Math.min(MAX_FRAMES, Math.floor(frames))) : 1;
  const tilt = Number.isFinite(tiltDegrees) ? Math.max(TILT_MIN, Math.min(TILT_MAX, tiltDegrees)) : 20;
  const pitch = (tilt * Math.PI) / 180;
  const start = Number.isFinite(startYaw) ? startYaw : 0;
  const out: Camera[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(fitCamera({ target: scene.center, distance: 1, yaw: start + (2 * Math.PI * i) / count, pitch }, scene, aspect));
  }
  return out;
}

export { sceneOf };

/** Bytes held when a WebM's frames are drawn first and then played: four a pixel. */
export function heldBytes(frames: number, width: number, height: number): number {
  return frames * width * height * 4;
}

/** The format a turntable is written in: a cut-out or a browser without a WebM recorder takes the APNG. */
export function videoFormat(background: BackgroundChoice, webmSupported: boolean, wanted: VideoFormat): { format: VideoFormat; note: string | null } {
  if (wanted === "apng") return { format: "apng", note: null };
  if (background === "transparent") return { format: "apng", note: "A transparent turntable is saved as an animated PNG: WebM video does not keep the cut-out reliably." };
  if (!webmSupported) return { format: "apng", note: "This browser cannot record WebM video, so the turntable is saved as an animated PNG." };
  return { format: "webm", note: null };
}

// ---- file names ----

/** A file name from the piece's title, its kind and an extension. */
export function exportFileName(title: string, what: string, extension: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f·]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base === "" ? "Piece" : base} - ${what}.${extension}`;
}

// ---- PNG chunks and CRC ----

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of PNG (ISO 3309), over the bytes. */
export function crc32(bytes: Uint8Array, start = 0xffffffff): number {
  let c = start >>> 0;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** One chunk: length, type, data, and the CRC over type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i) & 0xff;
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function u32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value >>> 0));
  return out;
}

export function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8; // bit depth
  data[9] = 6; // RGBA
  return pngChunk("IHDR", data);
}

/**
 * RGBA pixels as PNG scanlines, each filtered with Sub (the byte to its left subtracted): a turning
 * metal surface is smooth along a row, so this halves the deflated size against no filter.
 */
export function filterScanlines(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const from = y * stride;
    const to = y * (stride + 1);
    out[to] = 1;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? (rgba[from + x - 4] ?? 0) : 0;
      out[to + 1 + x] = ((rgba[from + x] ?? 0) - left) & 0xff;
    }
  }
  return out;
}

/** A zlib stream of the bytes (the PNG's compression). */
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;

/** The browser's own deflate (zlib format), with no dependency. */
export const browserDeflate: Deflate = async (bytes) => {
  if (typeof CompressionStream === "undefined") throw new Error("this browser cannot compress, so an animated PNG cannot be written");
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * An animated PNG writer that takes its frames one at a time, so a long turntable is never held
 * whole: each frame is filtered, deflated and kept compressed. Frame 0 is the default image
 * (`IDAT`) and the first frame of the animation; the rest are `fdAT`. Every frame covers the whole
 * picture, replaces the one before (`dispose_op` none, `blend_op` source: a cut-out frame must not
 * show the last one through it) and loops forever.
 */
export class ApngWriter {
  private readonly parts: Uint8Array[] = [];
  private sequence = 0;
  private count = 0;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly frames: number,
    readonly delayNum: number,
    readonly delayDen: number,
    private readonly deflate: Deflate = browserDeflate,
  ) {}

  /** Add the next frame's RGBA pixels (straight, not premultiplied alpha). */
  async add(rgba: Uint8Array): Promise<void> {
    if (rgba.length !== this.width * this.height * 4) throw new Error("a frame is not the picture's size");
    if (this.count >= this.frames) throw new Error("more frames than the animation was opened for");
    const data = await this.deflate(filterScanlines(rgba, this.width, this.height));
    const fctl = new Uint8Array(26);
    const view = new DataView(fctl.buffer);
    view.setUint32(0, this.sequence);
    view.setUint32(4, this.width);
    view.setUint32(8, this.height);
    view.setUint32(12, 0);
    view.setUint32(16, 0);
    view.setUint16(20, this.delayNum);
    view.setUint16(22, this.delayDen);
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source
    this.sequence += 1;
    this.parts.push(pngChunk("fcTL", fctl));
    if (this.count === 0) this.parts.push(pngChunk("IDAT", data));
    else {
      const fdat = new Uint8Array(4 + data.length);
      new DataView(fdat.buffer).setUint32(0, this.sequence);
      fdat.set(data, 4);
      this.sequence += 1;
      this.parts.push(pngChunk("fdAT", fdat));
    }
    this.count += 1;
  }

  get added(): number {
    return this.count;
  }

  /** The whole file. It refuses before every frame it was opened for has been added. */
  finish(): Uint8Array {
    if (this.count !== this.frames) throw new Error(`the animation has ${this.count} of its ${this.frames} frames`);
    const head = [PNG_SIGNATURE, ihdr(this.width, this.height), pngChunk("acTL", u32s(this.frames, 0))];
    const end = pngChunk("IEND", new Uint8Array(0));
    const all = [...head, ...this.parts, end];
    const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of all) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** Premultiplied RGBA (as WebGL reads it back) to straight RGBA, in place. */
export function unpremultiply(rgba: Uint8Array): Uint8Array {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] ?? 0;
    if (a === 0 || a === 255) continue;
    for (let k = 0; k < 3; k += 1) rgba[i + k] = Math.min(255, Math.round(((rgba[i + k] ?? 0) * 255) / a));
  }
  return rgba;
}

// ---- reading a PNG back (the tests, and the dialog's own check of what it wrote) ----

export interface PngChunk {
  type: string;
  data: Uint8Array;
  crcOk: boolean;
}

/** The chunks of a PNG file, each with whether its CRC is right; null when the signature is wrong or a chunk runs past the end. */
export function readChunks(file: Uint8Array): PngChunk[] | null {
  if (file.length < 8 || PNG_SIGNATURE.some((byte, i) => file[i] !== byte)) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out: PngChunk[] = [];
  let at = 8;
  while (at + 12 <= file.length) {
    const length = view.getUint32(at);
    if (at + 12 + length > file.length) return null;
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const data = file.subarray(at + 8, at + 8 + length);
    const crc = view.getUint32(at + 8 + length);
    out.push({ type, data, crcOk: crc32(file.subarray(at + 4, at + 8 + length)) === crc });
    at += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

/** The frame count an APNG's `acTL` says, or 0 for a still PNG or a file that is not one. */
export function apngFrameCount(file: Uint8Array): number {
  const actl = readChunks(file)?.find((chunk) => chunk.type === "acTL");
  if (actl === undefined || actl.data.length < 8) return 0;
  return new DataView(actl.data.buffer, actl.data.byteOffset, 8).getUint32(0);
}
