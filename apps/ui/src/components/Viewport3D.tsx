/**
 * The 3D view of the piece: the stage the "3D" tab over the drawing brings to the front. It shows
 * the solid the engine makes of the parametric piece (`piecemesh`), shaded, under an orbit camera.
 *
 * The geometry is the engine's. This file is the stage: the pointer and the keys, the bar, the
 * orientation gizmo, the region names and the readout. The drawing itself (the shader programs,
 * the buffers, a frame as its passes) is `../render3d.ts`, shared with the stills made off screen;
 * the math both lean on (matrices, the camera and its clamps, the checked reading of the reply,
 * the normals, the feature edges, the order of the passes, what is under the pointer) is in
 * `../view3d.ts`, which is tested.
 *
 * The solid is shown one of four ways (`DisplayMode`): shaded, as a wireframe of its feature
 * edges, with the metal ghosted so the stones show through it, or as an X-ray. The gizmo in the
 * corner draws the engine's three axes as the camera sees them; each of its six ends is a key
 * that turns the eye to stand on it. The region names (off until asked for) hang on places taken
 * from the box the engine measured. The mode and the names are remembered by the browser.
 *
 * It is mounted only while its tab is in front and lies over the 2D canvas, which stays mounted
 * under it at its own size, so the drawing's view is exactly as it was left. While this view is up
 * the canvas under it is `inert`: it takes no focus and no pointer.
 *
 * It draws when something changed (a new mesh, a camera move, a resize, a theme change, a mode)
 * and never on an idle loop: a turn to a standard view animates for its short time and stops, and
 * does not animate at all where motion is turned down. Its inks are the theme's: the background and the grid are read from the tokens
 * on the element, and a part's colour is the one the engine sent.
 */

import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { Envelope } from "../facade";
import { downloadBytes } from "../files";
import { isRecord } from "../json";
import { wheelZoomFactor } from "../view";
import { createRenderer, type Renderer } from "../render3d";
import {
  AXIS_ENDS,
  axisCamera,
  axisEndOf,
  buildBuffers,
  clampCamera,
  DISPLAY_MODES,
  drawPlan,
  easeCamera,
  eyeFrame,
  featureEdges,
  fitCamera,
  formatSize,
  formatTriangles,
  gizmoEnds,
  groundGrid,
  isDisplayMode,
  isUnknownCommand,
  loadView3d,
  modeHasEdges,
  orbitCamera,
  panCamera,
  parseMeshReply,
  parseStlReply,
  pickPart,
  pickRay,
  pickTargets,
  placeRegions,
  saveView3d,
  sceneOf,
  standardCamera,
  standardViewOf,
  zoomCamera,
  type AxisEnd,
  type Buffers,
  type Camera,
  type DisplayMode,
  type EdgeBatch,
  type GizmoEnd,
  type PickTarget,
  type PieceMesh,
  type PlacedRegions,
  type Scene,
  type StandardView,
  type Vec3,
} from "../view3d";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { rovingBand } from "./ToolStrip";
import "../view3d.css";

export interface Viewport3DProps {
  /** The engine's `execute`, envelope parsed (`AppFacade.execute`). A promise is awaited. */
  execute: (command: string, params: unknown) => Envelope | Promise<Envelope>;
  /** The drawing's revision: when it changes while this view is up, the piece is fetched again. */
  revision: number;
  /** Say a refusal beside the command field, or (null) end what is said there. */
  onNotice: (message: string | null) => void;
}

/** What the stage shows: the solid, or one of the states that are said in words. */
type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "no-webgl"; message: string }
  | { kind: "lost" };

interface Readout {
  triangles: string;
  size: string;
  notes: readonly string[];
}

/** The standard views as the bar's keys: the face (one short word), and the name read aloud. */
const VIEW_KEYS: readonly { view: StandardView; face: string; label: string }[] = [
  { view: "three-quarter", face: "3/4", label: "Three-quarter view" },
  { view: "front", face: "Front", label: "Front view" },
  { view: "top", face: "Top", label: "Top view" },
  { view: "side", face: "Side", label: "Side view" },
];

/** The backing store is at most this many device pixels per CSS pixel, and this many pixels a side. */
const MAX_PIXEL_RATIO = 2;
const MAX_BACKING = 4096;
/** A drag of one CSS pixel turns the camera by this many radians. */
const ORBIT_PER_PIXEL = 0.008;
/** One press of an arrow key turns the camera by this much; one press of + or − zooms by this factor. */
const KEY_TURN = Math.PI / 12;
const KEY_ZOOM = 0.8;
/** After the drawing has been quiet this long, the draft mesh is replaced by the fine one. */
const FINE_AFTER_MS = 350;
/** A stage narrower than this (CSS pixels) folds the bar: the Front, Top and Side keys go, and the gizmo's ends do their work. */
const COMPACT_BELOW = 560;
/** A turn to a standard view takes this long when the token that sets it cannot be read. */
const FLIGHT_MS = 200;
const NO_REGIONS: PlacedRegions = { labels: [], axis: null };

/** The display modes as the bar's list. */
const MODE_OPTIONS = DISPLAY_MODES.map((entry) => ({ value: entry.mode, label: entry.label }));
/** How far from the gizmo's middle an axis end stands, of the gizmo's half width. */
const GIZMO_REACH = 0.7;

/**
 * The camera as it was left, for the next time the tab comes to the front: there is one 3D stage
 * in the window, and it is unmounted while a layout shows.
 */
let remembered: { camera: Camera; framed: boolean } | null = null;

/**
 * A token's colour as red, green and blue in 0…1, whatever notation the token is written in: the
 * browser paints it on one pixel and the pixel is read back. Null when it cannot be read.
 */
function tokenColor(element: Element, token: string, probe: CanvasRenderingContext2D | null): Vec3 | null {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  if (value === "" || probe === null || typeof CSS === "undefined" || !CSS.supports("color", value)) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;
  return [(pixel[0] ?? 0) / 255, (pixel[1] ?? 0) / 255, (pixel[2] ?? 0) / 255];
}

export function Viewport3D(props: Viewport3DProps): JSX.Element {
  let host: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const [status, setStatus] = createSignal<Status>({ kind: "loading" });
  const [readout, setReadout] = createSignal<Readout | null>(null);
  const [standard, setStandard] = createSignal<StandardView | null>(null);
  const [gesture, setGesture] = createSignal<"orbit" | "pan" | null>(null);
  const memory = loadView3d();
  const [mode, setMode] = createSignal<DisplayMode>(memory.mode);
  const [labels, setLabels] = createSignal(memory.labels);
  const [compact, setCompact] = createSignal(false);
  const [gizmo, setGizmo] = createSignal<GizmoEnd[]>(gizmoEnds(remembered?.camera ?? standardCamera("three-quarter", { center: [0, 0, 0], radius: 10 }, 1)));
  const [onEnd, setOnEnd] = createSignal<AxisEnd["id"] | null>(null);
  const [regions, setRegions] = createSignal<PlacedRegions>(NO_REGIONS);
  /** The part under the pointer, by the engine's name for it; null when the pointer is on none. */
  const [pointed, setPointed] = createSignal<string | null>(null);
  /** The pointer can rest over the stage without pressing (a mouse, not a finger): only then is the part under it named. */
  const hovers = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // What is drawn. None of it is reactive: a change calls `schedule`.
  let gl: WebGLRenderingContext | null = null;
  let renderer: Renderer | null = null;
  let buffers: Buffers | null = null;
  /** The reply the buffers were made from: the edges and the pick are made from it when they are first wanted. */
  let solid: PieceMesh | null = null;
  let edges: EdgeBatch | null = null;
  let targets: PickTarget[] | null = null;
  let ground: { data: Float32Array; vertices: number } | null = null;
  let scene: Scene | null = null;
  let camera: Camera | null = remembered?.camera ?? null;
  /** The camera still frames the piece (no pan or zoom since the last fit): a resize or a new size of piece fits again. */
  let framed = remembered?.framed ?? true;
  let size = { w: 0, h: 0, pxW: 0, pxH: 0 };
  let inks: { background: Vec3; grid: Vec3 } = { background: [0, 0, 0], grid: [0, 0, 0] };
  let probe: CanvasRenderingContext2D | null = null;
  let frame = 0;
  let disposed = false;

  const aspect = (): number => (size.w > 0 && size.h > 0 ? size.w / size.h : 1);

  const draw = (): void => {
    if (renderer === null || gl === null || gl.isContextLost() || size.pxW === 0 || size.pxH === 0) return;
    const use = scene ?? { center: [0, 0, 0] as const, radius: 10 };
    const eye = clampCamera(camera ?? standardCamera("three-quarter", use, aspect()), use);
    const view = eyeFrame(eye, use, aspect());
    renderer.draw({ ...view, background: inks.background, gridInk: inks.grid, edgeInk: null }, drawPlan(mode()), size.pxW, size.pxH);
    // What stands over the solid follows the same eye, in the same frame.
    setGizmo(gizmoEnds(eye));
    setRegions(labels() && solid !== null ? placeRegions(solid.bounds, view.viewProj, size.w, size.h) : NO_REGIONS);
  };

  const schedule = (): void => {
    if (frame !== 0 || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };

  /** Take a camera from a transition: it is drawn, remembered, and the bar's keys follow it. */
  const look = (next: Camera, stillFramed: boolean): void => {
    camera = next;
    framed = stillFramed;
    remembered = { camera: next, framed };
    setStandard(stillFramed ? standardViewOf(next) : null);
    setOnEnd(stillFramed ? (axisEndOf(next)?.id ?? null) : null);
    schedule();
  };

  // ---- a turn to a standard view ----

  let flight = 0;
  const stopFlight = (): void => {
    if (flight !== 0) cancelAnimationFrame(flight);
    flight = 0;
  };

  /** Motion is turned down, by the system or by the app's own setting (View ▸ Accessibility ▸ Animation Effects). */
  const stillness = (): boolean =>
    document.documentElement.getAttribute("data-animations") === "off" || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /** How long a turn takes: the system's slow step, read from the token. */
  const flightTime = (): number => {
    const seconds = host === undefined ? NaN : Number.parseFloat(getComputedStyle(host).getPropertyValue("--dur-slow"));
    return Number.isFinite(seconds) && seconds > 0 && seconds < 2 ? seconds * 1000 : FLIGHT_MS;
  };

  /** Turn the eye to `to`, framed: eased over a short time, or at once where motion is turned down. */
  const fly = (to: Camera): void => {
    stopFlight();
    const from = camera;
    if (from === null || stillness()) {
      look(to, true);
      return;
    }
    const took = flightTime();
    const began = performance.now();
    const step = (now: number): void => {
      const t = (now - began) / took;
      if (!(t < 1) || disposed) {
        flight = 0;
        look(to, true);
        return;
      }
      look(easeCamera(from, to, t), true);
      flight = requestAnimationFrame(step);
    };
    flight = requestAnimationFrame(step);
  };

  const fit = (): void => {
    if (scene === null) return;
    stopFlight();
    look(fitCamera(camera ?? standardCamera("three-quarter", scene, aspect()), scene, aspect()), true);
  };

  const showView = (view: StandardView): void => {
    if (scene !== null) fly(standardCamera(view, scene, aspect()));
  };

  /**
   * Stand the eye on an axis end. The end the eye already stands on covers its opposite in the
   * gizmo, so a press on it turns the eye to the opposite end: the way round to the back.
   */
  const showEnd = (end: AxisEnd): void => {
    if (scene === null) return;
    const opposite = AXIS_ENDS.find((other) => other.axis === end.axis && other.id !== end.id);
    fly(axisCamera(onEnd() === end.id && opposite !== undefined ? opposite : end, scene, aspect()));
  };

  /** The camera after the piece or the stage changed size: fitted again if it was, clamped otherwise. */
  const settle = (): void => {
    if (scene === null) return;
    stopFlight();
    if (camera === null) look(standardCamera("three-quarter", scene, aspect()), true);
    else if (framed) look(fitCamera(camera, scene, aspect()), true);
    else look(clampCamera(camera, scene), false);
  };

  const readInks = (): boolean => {
    if (host === undefined) return false;
    const background = tokenColor(host, "--canvas", probe) ?? inks.background;
    const grid = tokenColor(host, "--grid-major", probe) ?? inks.grid;
    const same = background.every((v, i) => v === inks.background[i]) && grid.every((v, i) => v === inks.grid[i]);
    inks = { background, grid };
    return !same;
  };

  /** Make the context's programs and hand it what is held; false (with the reason said) when it cannot. */
  const start = (): boolean => {
    if (canvas === undefined) return false;
    if (gl === null) {
      const options: WebGLContextAttributes = { antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: true };
      try {
        gl = canvas.getContext("webgl", options) ?? (canvas.getContext("experimental-webgl", options) as WebGLRenderingContext | null);
      } catch {
        gl = null;
      }
    }
    if (gl === null) {
      setStatus({ kind: "no-webgl", message: "This browser cannot draw the 3D view: WebGL is not available." });
      return false;
    }
    const made = createRenderer(gl);
    if (typeof made === "string") {
      setStatus({ kind: "no-webgl", message: `The 3D view could not start: ${made}.` });
      return false;
    }
    renderer = made;
    renderer.upload(buffers, ground, edges);
    return true;
  };

  // ---- how it is shown ----

  /** The edges of the piece on screen, made the first time a mode draws them. */
  const wantEdges = (): void => {
    if (edges !== null || solid === null || !modeHasEdges(mode())) return;
    edges = featureEdges(solid);
    renderer?.upload(buffers, ground, edges);
  };

  const chooseMode = (value: string): void => {
    if (!isDisplayMode(value)) return;
    setMode(value);
    saveView3d({ mode: value, labels: labels() });
    wantEdges();
    schedule();
  };

  const chooseLabels = (on: boolean): void => {
    setLabels(on);
    saveView3d({ mode: mode(), labels: on });
    schedule();
  };

  // ---- staying in step with the drawing ----

  /** The newest request: a reply to an older one is dropped. */
  let request = 0;
  /** The engine has no such command: said once, and not asked again. */
  let unavailable = false;
  let fineTimer = 0;

  /** The piece's parameters, or the state there is to show instead. */
  const queryPiece = async (): Promise<{ params: Record<string, unknown> } | Status> => {
    const env = await props.execute("piece", { query: true });
    if (!env.ok) return isUnknownCommand(env.error) ? { kind: "unavailable" } : { kind: "error", message: env.error };
    const piece = isRecord(env.result) ? env.result["piece"] : undefined;
    if (piece === null) return { kind: "empty" };
    if (!isRecord(piece) || !isRecord(piece["params"])) return { kind: "error", message: "the piece could not be read" };
    return { params: piece["params"] };
  };

  const clearMesh = (): void => {
    buffers = null;
    solid = null;
    edges = null;
    targets = null;
    setPointed(null);
    ground = null;
    scene = null;
    setReadout(null);
    renderer?.upload(null, null, null);
    schedule();
  };

  const load = async (quality: "draft" | "fine"): Promise<void> => {
    if (unavailable || disposed) return;
    const mine = (request += 1);
    const stale = (): boolean => mine !== request || disposed;
    const keepGl = (next: Status): void => {
      // A stage that cannot draw keeps saying so; any other state gives way to the new one.
      const now = status().kind;
      if (now !== "no-webgl" && now !== "lost") setStatus(next);
    };
    const piece = await queryPiece();
    if (stale()) return;
    if ("kind" in piece) {
      if (piece.kind === "unavailable") unavailable = true;
      clearMesh();
      keepGl(piece);
      return;
    }
    const env = await props.execute("piecemesh", { ...piece.params, quality });
    if (stale()) return;
    if (!env.ok) {
      // The finer mesh was refused: the draft on screen stays.
      if (quality === "fine" && buffers !== null) return;
      if (isUnknownCommand(env.error)) unavailable = true;
      clearMesh();
      keepGl(unavailable ? { kind: "unavailable" } : { kind: "error", message: env.error });
      return;
    }
    const reply = parseMeshReply(env.result);
    if (!reply.ok) {
      if (quality === "fine" && buffers !== null) return;
      clearMesh();
      keepGl({ kind: "error", message: reply.error });
      return;
    }
    solid = reply.mesh;
    buffers = buildBuffers(reply.mesh);
    ground = groundGrid(reply.mesh.extent);
    scene = sceneOf(reply.mesh.extent);
    edges = modeHasEdges(mode()) ? featureEdges(reply.mesh) : null;
    targets = null;
    renderer?.upload(buffers, ground, edges);
    setReadout({ triangles: formatTriangles(reply.mesh.triangles), size: formatSize(reply.mesh.bounds), notes: reply.mesh.notes });
    keepGl({ kind: "ready" });
    settle();
    if (quality === "draft") {
      fineTimer = window.setTimeout(() => {
        fineTimer = 0;
        void load("fine");
      }, FINE_AFTER_MS);
    }
  };

  createEffect(
    on(
      () => props.revision,
      () => {
        if (fineTimer !== 0) window.clearTimeout(fineTimer);
        fineTimer = 0;
        void load("draft");
      },
    ),
  );

  const downloadStl = async (): Promise<void> => {
    const piece = await queryPiece();
    if ("kind" in piece) {
      props.onNotice(piece.kind === "error" ? piece.message : piece.kind === "empty" ? "there is no piece to save as STL" : "STL export is not in this build");
      return;
    }
    const env = await props.execute("stlout", { ...piece.params, stones: true, quality: "fine" });
    if (!env.ok) {
      props.onNotice(isUnknownCommand(env.error) ? "STL export is not in this build" : env.error);
      return;
    }
    const file = parseStlReply(env.result);
    if (!file.ok) {
      props.onNotice(file.error);
      return;
    }
    props.onNotice(null);
    downloadBytes(file.name, file.bytes, "model/stl");
  };

  // ---- the pointer and the keys ----

  const pointers = new Map<number, { x: number; y: number }>();
  let dragMode: "orbit" | "pan" = "orbit";

  /** A window point as the view's own −1…1 (up positive). */
  const ndc = (clientX: number, clientY: number): { x: number; y: number } => {
    const box = canvas?.getBoundingClientRect();
    if (box === undefined || box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
    return { x: ((clientX - box.left) / box.width) * 2 - 1, y: 1 - ((clientY - box.top) / box.height) * 2 };
  };

  const pinch = (): { x: number; y: number; spread: number } | null => {
    const [a, b] = Array.from(pointers.values());
    if (a === undefined || b === undefined) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  // ---- the part under the pointer ----

  let pickFrame = 0;
  let pickAt: { x: number; y: number } | null = null;

  /** Name the part under the resting pointer: at most once a frame, and never while the solid is being turned. */
  const pickSoon = (clientX: number, clientY: number): void => {
    pickAt = ndc(clientX, clientY);
    if (pickFrame !== 0 || disposed) return;
    pickFrame = requestAnimationFrame(() => {
      pickFrame = 0;
      if (pickAt === null || solid === null || camera === null || pointers.size > 0) return;
      targets ??= pickTargets(solid);
      const ray = pickRay(camera, pickAt.x, pickAt.y, aspect());
      const hit = ray === null ? null : pickPart(targets, ray);
      setPointed(hit === null ? null : hit.name === "" ? hit.part : hit.name);
    });
  };

  const onPointerLeave = (): void => {
    pickAt = null;
    setPointed(null);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (scene === null || canvas === undefined) return;
    stopFlight();
    setPointed(null);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured: the drag simply ends at the edge.
    }
    dragMode = e.pointerType === "mouse" && (e.button === 1 || e.button === 2) ? "pan" : "orbit";
    setGesture(pointers.size > 1 ? "pan" : dragMode);
    // The middle button's autoscroll would take the drag.
    if (e.button === 1) e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent): void => {
    const was = pointers.get(e.pointerId);
    if (was === undefined && hovers && e.pointerType === "mouse") pickSoon(e.clientX, e.clientY);
    if (was === undefined || scene === null || camera === null) return;
    const before = pinch();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const after = pinch();
      if (before === null || after === null) return;
      let next = panCamera(camera, scene, after.x - before.x, after.y - before.y, size.h);
      if (before.spread > 8 && after.spread > 8) {
        const at = ndc(after.x, after.y);
        next = zoomCamera(next, scene, before.spread / after.spread, at.x, at.y, aspect());
      }
      look(next, false);
      return;
    }
    const dx = e.clientX - was.x;
    const dy = e.clientY - was.y;
    if (dx === 0 && dy === 0) return;
    if (dragMode === "pan") look(panCamera(camera, scene, dx, dy, size.h), false);
    else look(orbitCamera(camera, scene, -dx * ORBIT_PER_PIXEL, dy * ORBIT_PER_PIXEL), framed);
  };

  const onPointerEnd = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    setGesture(pointers.size === 0 ? null : pointers.size > 1 ? "pan" : dragMode);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (scene === null || camera === null) return;
    stopFlight();
    const at = ndc(e.clientX, e.clientY);
    look(zoomCamera(camera, scene, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), at.x, at.y, aspect()), false);
  };

  /** The stage's keys, only while it has the focus. A key it takes never reaches the shell. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || scene === null || camera === null || status().kind !== "ready") return;
    stopFlight();
    const turn = (yaw: number, pitch: number): void => {
      if (scene !== null && camera !== null) look(orbitCamera(camera, scene, yaw, pitch), framed);
    };
    const zoom = (factor: number): void => {
      if (scene !== null && camera !== null) look(zoomCamera(camera, scene, factor, 0, 0, aspect()), false);
    };
    switch (e.key) {
      case "ArrowLeft":
        turn(-KEY_TURN, 0);
        break;
      case "ArrowRight":
        turn(KEY_TURN, 0);
        break;
      case "ArrowUp":
        turn(0, KEY_TURN);
        break;
      case "ArrowDown":
        turn(0, -KEY_TURN);
        break;
      case "+":
      case "=":
        zoom(KEY_ZOOM);
        break;
      case "-":
      case "_":
        zoom(1 / KEY_ZOOM);
        break;
      case "Home":
      case "f":
      case "F":
        fit();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  onMount(() => {
    if (host === undefined || canvas === undefined) return;
    const stage = host;
    const surface = canvas;
    // The drawing under this view keeps its size and its state, and takes nothing while it is covered.
    const under = stage.previousElementSibling;
    const wasInert = under?.hasAttribute("inert") ?? false;
    under?.setAttribute("inert", "");
    onCleanup(() => {
      if (!wasInert) under?.removeAttribute("inert");
    });

    probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    readInks();
    // The inks are tokens: a theme may change them under a view that is already drawn.
    const theme = new MutationObserver(() => {
      if (readInks()) schedule();
    });
    theme.observe(document.documentElement, { attributes: true });
    onCleanup(() => theme.disconnect());

    const measure = (): void => {
      const box = surface.getBoundingClientRect();
      const raw = window.devicePixelRatio;
      const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(0.5, Number.isFinite(raw) && raw > 0 ? raw : 1));
      const pxW = Math.min(MAX_BACKING, Math.round(box.width * ratio));
      const pxH = Math.min(MAX_BACKING, Math.round(box.height * ratio));
      if (!(pxW > 0) || !(pxH > 0)) return;
      const changed = pxW !== size.pxW || pxH !== size.pxH;
      size = { w: box.width, h: box.height, pxW, pxH };
      setCompact(box.width < COMPACT_BELOW);
      if (!changed) return;
      surface.width = pxW;
      surface.height = pxH;
      settle();
      // Sizing the store clears it: draw in the same frame, so a resize never shows an empty one.
      draw();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    onCleanup(() => observer.disconnect());

    const onLost = (e: Event): void => {
      // Asked for, so the browser may give the context back.
      e.preventDefault();
      renderer = null;
      setStatus({ kind: "lost" });
    };
    const onRestored = (): void => {
      if (!start()) return;
      setStatus(unavailable ? { kind: "unavailable" } : buffers !== null ? { kind: "ready" } : { kind: "loading" });
      if (buffers === null) void load("draft");
      schedule();
    };
    surface.addEventListener("webglcontextlost", onLost);
    surface.addEventListener("webglcontextrestored", onRestored);
    surface.addEventListener("wheel", onWheel, { passive: false });
    start();
    measure();
    schedule();

    // While developing, a script in the page can ask for the mesh on screen (to draw stills of it).
    if (import.meta.env.DEV) {
      const scope = window as unknown as { __view3d?: { mesh: () => PieceMesh | null } };
      scope.__view3d = { mesh: () => solid };
      onCleanup(() => {
        delete scope.__view3d;
      });
    }

    onCleanup(() => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      if (pickFrame !== 0) cancelAnimationFrame(pickFrame);
      stopFlight();
      if (fineTimer !== 0) window.clearTimeout(fineTimer);
      surface.removeEventListener("webglcontextlost", onLost);
      surface.removeEventListener("webglcontextrestored", onRestored);
      surface.removeEventListener("wheel", onWheel);
      renderer?.dispose();
      renderer = null;
      // The context is given back now, not when the canvas is collected: a browser keeps only a few.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
    });
  });

  const message = (): string | null => {
    const now = status();
    switch (now.kind) {
      case "empty":
        return "No piece yet. Start one in the Piece section of the sidebar.";
      case "unavailable":
        return "The 3D view is not in this build.";
      case "error":
      case "no-webgl":
        return now.message;
      case "lost":
        return "The 3D view lost its graphics context. It comes back when the browser restores it.";
      default:
        return null;
    }
  };

  return (
    <div class="view3d" ref={host}>
      <canvas
        ref={canvas}
        class="view3d-canvas"
        tabindex="0"
        role="img"
        aria-label="The piece in 3D. Drag to turn it; the arrow keys turn it, plus and minus zoom, F frames it."
        data-gesture={gesture() ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerLeave}
        onDblClick={fit}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      />
      <Show when={status().kind === "ready"}>
        <Show when={labels()}>
          <div class="view3d-regions" aria-hidden="true">
            <Show when={regions().axis}>
              {(axis) => (
                <svg class="view3d-axis">
                  <line x1={axis().x1} y1={axis().y1} x2={axis().x2} y2={axis().y2} />
                </svg>
              )}
            </Show>
            <For each={regions().labels}>
              {(label) => (
                <Show when={label.shown}>
                  <span
                    class="view3d-label"
                    data-region={label.id}
                    style={{ "--lx": (label.x / Math.max(1, size.w)) * 100, "--ly": (label.y / Math.max(1, size.h)) * 100, "--dx": label.dx, "--dy": label.dy }}
                  >
                    {label.label}
                  </span>
                </Show>
              )}
            </For>
          </div>
        </Show>
        <div class="view3d-gizmo" role="toolbar" aria-label="Orientation" ref={(element) => rovingBand(element, "button")}>
          <svg class="view3d-gizmo-axes" viewBox="-1 -1 2 2" aria-hidden="true">
            <For each={AXIS_ENDS}>
              {(end, index) => (
                <line class="view3d-gizmo-axis" data-axis={end.axis} data-back={end.id.startsWith("-") ? "" : undefined} x1="0" y1="0" x2={(gizmo()[index()]?.x ?? 0) * GIZMO_REACH} y2={-(gizmo()[index()]?.y ?? 0) * GIZMO_REACH} />
              )}
            </For>
          </svg>
          <For each={AXIS_ENDS}>
            {(end, index) => (
              <span
                class="view3d-gizmo-end"
                data-axis={end.axis}
                data-back={end.id.startsWith("-") ? "" : undefined}
                style={{ "--gx": (gizmo()[index()]?.x ?? 0) * GIZMO_REACH, "--gy": -(gizmo()[index()]?.y ?? 0) * GIZMO_REACH, "z-index": Math.round(((gizmo()[index()]?.depth ?? 0) + 1) * 10) + 1 }}
              >
                <Toggle variant="text" size="sm" ariaLabel={end.name} hint={end.hint} placement="bottom" pressed={onEnd() === end.id} onChange={() => showEnd(end)}>
                  {end.face}
                </Toggle>
              </span>
            )}
          </For>
        </div>
        <div class="view3d-foot">
          <Show when={readout()}>
            {(facts) => (
              <div class="view3d-readout">
                <span class="view3d-fact">{facts().triangles}</span>
                <span class="view3d-fact">{facts().size}</span>
                <Show when={hovers}>
                  <span class="view3d-pointed" data-empty={pointed() === null ? "" : undefined}>
                    {pointed() === null ? "Point at a part to name it" : `Under the pointer: ${pointed() ?? ""}`}
                  </span>
                </Show>
                <For each={facts().notes}>{(note) => <span class="view3d-note">{note}</span>}</For>
              </div>
            )}
          </Show>
          <div class="view3d-bar" role="toolbar" aria-label="3D view" ref={(element) => rovingBand(element, "button")}>
            <IconButton icon="zoom.extents" title="Fit the piece" shortcut="F" onClick={fit} />
            <For each={compact() ? VIEW_KEYS.slice(0, 1) : VIEW_KEYS}>
              {(key) => (
                <Toggle variant="text" size="sm" ariaLabel={key.label} hint={key.label} placement="top" pressed={standard() === key.view} onChange={() => showView(key.view)}>
                  {key.face}
                </Toggle>
              )}
            </For>
            <Select size="sm" ariaLabel="Display mode" title="How the solid is shown" value={mode()} options={MODE_OPTIONS} onChange={chooseMode} />
            <Toggle variant="text" size="sm" ariaLabel="Region labels" hint="Name the regions of the ring" placement="top" pressed={labels()} onChange={chooseLabels}>
              Labels
            </Toggle>
            <Button variant="quiet" size="sm" title="Save the piece as a file for printing" onClick={() => void downloadStl()}>
              Download STL
            </Button>
          </div>
        </div>
      </Show>
      <Show when={message()}>
        {(words) => (
          <div class="view3d-message" role="status">
            <p>{words()}</p>
          </div>
        )}
      </Show>
    </div>
  );
}
