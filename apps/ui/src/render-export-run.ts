/**
 * Render export, the drawing: a still, a turntable and a contact sheet of the piece, made off
 * screen in one WebGL context (`render3d`'s `withPieceFrames`, in the stills' line) and handed
 * back as a `Blob`. The plans (sizes, stores, cameras, frame times) and the APNG bytes are
 * `./render-export`'s; this module only touches the browser. Each frame is drawn on a store at up
 * to twice the picture's size and scaled down on a 2D canvas (the supersampling the stills use).
 *
 * A turntable yields to the page between frames, reports its progress, and stops at the next
 * frame when cancelled. A WebM is made in two steps so its timing is exact whatever the GPU's
 * speed: every frame is drawn first (deterministically, from the turntable's cameras), then the
 * frames are played into a `MediaRecorder` over `canvas.captureStream(0)` at the turntable's own
 * rate, one `requestFrame` each. An APNG is written as it is drawn, each frame compressed at once.
 */

import { assembleSheet, meshRequest, SHEET_VIEWS, type SheetModel } from "./techsheet";
import type { Envelope } from "./facade";
import { withPieceFrames, type FrameSession } from "./render3d";
import {
  ApngWriter,
  backgroundColor,
  heldBytes,
  MAX_HELD_BYTES,
  sceneOf,
  sheetFactLines,
  sheetLayout,
  stillCamera,
  storePlan,
  turntableCameras,
  turntablePlan,
  type AngleChoice,
  type BackgroundChoice,
  type VideoFormat,
} from "./render-export";
import { fitCamera, STANDARD_VIEWS, type Camera, type PieceMesh, type Vec3 } from "./view3d";

/** A colour of 0…1 channels as the canvas takes it, six hex digits. */
function cssOf(color: Vec3): string {
  const hex = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#".concat(hex(color[0]), hex(color[1]), hex(color[2]));
}

export type Execute = (command: string, params: unknown) => Envelope | Promise<Envelope>;

/** The piece to render: its fine solid and the Tech Sheet's model (title and facts). */
export interface LoadedPiece {
  mesh: PieceMesh;
  model: SheetModel;
}

/** Read the piece, its fine solid and the bench reply; a refusal in words when there is nothing to render. */
export async function loadPiece(execute: Execute): Promise<LoadedPiece | string> {
  const pieceEnv = await execute("piece", { query: true });
  const request = meshRequest(pieceEnv);
  if (request === null) return pieceEnv.ok ? "This drawing has no parametric piece to render." : pieceEnv.error;
  const meshEnv = await execute("piecemesh", { ...request, quality: "fine" });
  const benchEnv = await execute("techsheet", {});
  const model = assembleSheet(pieceEnv, meshEnv, benchEnv);
  if (model.mesh === null) return model.note ?? "The piece has no solid to render yet.";
  return { mesh: model.mesh, model };
}

/** Thrown out of a render that was cancelled. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

export interface Progress {
  /** Frames done, of `total`. */
  done: number;
  total: number;
  /** What is happening: "Drawing" or "Recording". */
  phase: string;
}

export interface Control {
  cancelled: boolean;
  onProgress?: (progress: Progress) => void;
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A 2D canvas of a size; refuses in words where the browser gives none. */
function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("the picture could not be made: the browser gave no 2D canvas");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

/** Draw a store onto `context` at `x, y`, `w × h`, scaled down (or not) with smoothing. */
function blit(context: CanvasRenderingContext2D, store: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
  context.drawImage(store, 0, 0, store.width, store.height, x, y, w, h);
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error("the picture could not be encoded")) : resolve(blob)), "image/png"));
}

// ---- a still ----

export interface StillRequest {
  width: number;
  height: number;
  angle: AngleChoice;
  background: BackgroundChoice;
  /** The stage's Perspective camera as it was left, for `angle` "current". */
  current: Camera | null;
}

export interface Rendered {
  blob: Blob;
  width: number;
  height: number;
  /** In words, what was not as asked (a GPU cap, a format chosen for the browser); null when all was. */
  note: string | null;
  frames: number;
  ms: number;
}

export function renderStill(mesh: PieceMesh, request: StillRequest): Promise<Rendered> {
  const started = performance.now();
  return withPieceFrames(mesh, "realistic", async (session) => {
    const plan = storePlan(request.width, request.height, session.limits);
    const camera = stillCamera(request.angle, request.current, sceneOf(mesh.extent), plan.width / plan.height);
    const store = session.draw(camera, plan.storeWidth, plan.storeHeight, backgroundColor(request.background));
    const out = canvas2d(plan.width, plan.height);
    blit(out.context, store, 0, 0, plan.width, plan.height);
    const blob = await toPng(out.canvas);
    return { blob, width: plan.width, height: plan.height, note: plan.note, frames: 1, ms: performance.now() - started };
  });
}

// ---- a turntable ----

export interface TurntableRequest {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  tilt: number;
  background: BackgroundChoice;
  format: VideoFormat;
}

/** The WebM type this browser records, or null where it records none (then the APNG is written). */
export function webmType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return null;
  for (const type of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // A recorder that cannot even be asked records nothing.
    }
  }
  return null;
}

/** Draw frame `i` of a turntable onto the small canvas. */
function drawFrame(session: FrameSession, camera: Camera, plan: ReturnType<typeof storePlan>, background: BackgroundChoice, out: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }): void {
  const store = session.draw(camera, plan.storeWidth, plan.storeHeight, backgroundColor(background));
  out.context.clearRect(0, 0, plan.width, plan.height);
  blit(out.context, store, 0, 0, plan.width, plan.height);
}

export async function renderTurntable(mesh: PieceMesh, request: TurntableRequest, control: Control): Promise<Rendered> {
  const started = performance.now();
  // The WebM's frames are drawn with the context held, then recorded after it is given back.
  const drawn = await withPieceFrames(mesh, "realistic", async (session): Promise<Rendered | { held: ImageBitmap[]; width: number; height: number; note: string | null; frameMs: number; type: string }> => {
    const plan = storePlan(request.width, request.height, session.limits);
    const timing = turntablePlan(request.seconds, request.fps);
    const cameras = turntableCameras(sceneOf(mesh.extent), plan.width / plan.height, timing.frames, request.tilt);
    const out = canvas2d(plan.width, plan.height);
    const report = (done: number, phase: string): void => control.onProgress?.({ done, total: timing.frames, phase });
    if (request.format === "apng") {
      const writer = new ApngWriter(plan.width, plan.height, timing.frames, timing.delayNum, timing.delayDen);
      for (const [i, camera] of cameras.entries()) {
        if (control.cancelled) throw new Cancelled();
        drawFrame(session, camera, plan, request.background, out);
        // The 2D canvas gives straight (not premultiplied) RGBA: what a PNG holds.
        const pixels = out.context.getImageData(0, 0, plan.width, plan.height).data;
        await writer.add(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
        report(i + 1, "Drawing");
        await nextTask();
      }
      const bytes = writer.finish();
      return { blob: new Blob([bytes.slice()], { type: "image/apng" }), width: plan.width, height: plan.height, note: plan.note, frames: timing.frames, ms: performance.now() - started };
    }
    const type = webmType();
    if (type === null) throw new Error("this browser cannot record WebM video");
    if (heldBytes(timing.frames, plan.width, plan.height) > MAX_HELD_BYTES) {
      throw new Error(`${timing.frames} frames at ${plan.width} × ${plan.height} are more than this window can hold for a video; choose a smaller size, fewer seconds or a lower frame rate.`);
    }
    const held: ImageBitmap[] = [];
    try {
      for (const [i, camera] of cameras.entries()) {
        if (control.cancelled) throw new Cancelled();
        drawFrame(session, camera, plan, request.background, out);
        held.push(await createImageBitmap(out.canvas));
        report(i + 1, "Drawing");
        await nextTask();
      }
    } catch (error) {
      for (const bitmap of held) bitmap.close();
      throw error;
    }
    return { held, width: plan.width, height: plan.height, note: plan.note, frameMs: timing.frameMs, type };
  });
  if (!("held" in drawn)) return drawn;
  try {
    const total = drawn.held.length;
    const blob = await record(drawn.held, drawn.width, drawn.height, drawn.frameMs, drawn.type, control, (done) => control.onProgress?.({ done, total, phase: "Recording" }));
    return { blob, width: drawn.width, height: drawn.height, note: drawn.note, frames: total, ms: performance.now() - started };
  } finally {
    for (const bitmap of drawn.held) bitmap.close();
  }
}

/** Play the drawn frames into a recorder at their own rate: one `requestFrame` each, on time. */
async function record(frames: readonly ImageBitmap[], width: number, height: number, frameMs: number, type: string, control: Control, onFrame: (done: number) => void): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("the video could not be made: the browser gave no 2D canvas");
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  if (track === undefined || !("requestFrame" in track) || typeof track.requestFrame !== "function") throw new Error("this browser cannot record a canvas frame by frame");
  const push = (): void => (track as CanvasCaptureMediaStreamTrack).requestFrame();
  // About 0.2 bits a pixel a frame: a metal surface stays clean, a 4 s 720 turntable is a few megabytes.
  const bits = Math.round(Math.min(40e6, Math.max(2e6, width * height * (1000 / frameMs) * 0.2)));
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bits });
  const parts: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) parts.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  const first = frames[0];
  if (first !== undefined) context.drawImage(first, 0, 0);
  recorder.start();
  const t0 = performance.now();
  try {
    for (const [i, frame] of frames.entries()) {
      if (control.cancelled) throw new Cancelled();
      context.clearRect(0, 0, width, height);
      context.drawImage(frame, 0, 0);
      push();
      onFrame(i + 1);
      const wait = t0 + (i + 1) * frameMs - performance.now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    for (const t of stream.getTracks()) t.stop();
  }
  await stopped;
  return new Blob(parts, { type: "video/webm" });
}

// ---- a contact sheet ----

/** The sheet's inks, red, green and blue in 0…1: the text over a dark backdrop is light, over a light one or a cut-out dark. */
const SHEET_INK: { dark: Vec3; light: Vec3; faint: number } = { dark: [0.95, 0.95, 0.955], light: [0.115, 0.115, 0.13], faint: 0.68 };

export function renderContactSheet(mesh: PieceMesh, model: SheetModel, background: BackgroundChoice, tile = 800): Promise<Rendered> {
  const started = performance.now();
  return withPieceFrames(mesh, "realistic", async (session) => {
    const facts = sheetFactLines(model);
    const layout = sheetLayout(tile, facts.lines.length);
    const plan = storePlan(layout.tile, layout.tile, session.limits);
    const scene = sceneOf(mesh.extent);
    const color = backgroundColor(background);
    const out = canvas2d(layout.width, layout.height);
    if (color !== null) {
      out.context.fillStyle = cssOf(color);
      out.context.fillRect(0, 0, layout.width, layout.height);
    }
    const ink = cssOf(background === "studio" ? SHEET_INK.dark : SHEET_INK.light);
    const font = (px: number, weight: number): string => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const [i, view] of SHEET_VIEWS.entries()) {
      const at = layout.tiles[i];
      if (at === undefined) continue;
      const camera = fitCamera({ target: scene.center, distance: 1, ...STANDARD_VIEWS[view.view] }, scene, 1);
      const store = session.draw(camera, plan.storeWidth, plan.storeHeight, color);
      blit(out.context, store, at.x, at.y, layout.tile, layout.tile);
      out.context.fillStyle = ink;
      out.context.globalAlpha = SHEET_INK.faint;
      out.context.font = font(Math.round(layout.label * 0.55), 500);
      out.context.textBaseline = "middle";
      out.context.fillText(view.label, at.x, at.y + layout.tile + layout.label / 2);
      out.context.globalAlpha = 1;
      await nextTask();
    }
    out.context.fillStyle = ink;
    out.context.textBaseline = "top";
    out.context.font = font(Math.round(layout.line * 1.05), 600);
    const step = Math.round(layout.line * 1.5);
    out.context.fillText(facts.title, layout.margin, layout.factsY, layout.width - 2 * layout.margin);
    out.context.font = font(Math.round(layout.line * 0.8), 400);
    facts.lines.forEach((text, i) => out.context.fillText(text, layout.margin, layout.factsY + step * (i + 1), layout.width - 2 * layout.margin));
    const blob = await toPng(out.canvas);
    return { blob, width: layout.width, height: layout.height, note: plan.note, frames: 4, ms: performance.now() - started };
  });
}
