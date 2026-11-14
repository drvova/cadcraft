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
 * The solid is shown one of five ways (`DisplayMode`): realistic (the default: polished metal and
 * faceted stones under a studio, `../materials.ts`), shaded, as a wireframe of its feature
 * edges, with the metal ghosted so the stones show through it, or as an X-ray. The gizmo in the
 * corner draws the engine's three axes as the camera sees them; each of its six ends is a key
 * that turns the eye to stand on it. The region names (off until asked for) hang on places taken
 * from the box the engine measured. The mode and the names are remembered by the browser.
 *
 * It is mounted only while its tab is in front and lies over the 2D canvas, which stays mounted
 * under it at its own size, so the drawing's view is exactly as it was left. While this view is up
 * the canvas under it is `inert`: it takes no focus and no pointer.
 *
 * The stage is one view (Perspective) or four tiled 2×2 (`../fourview.ts`): Top, Front and Right,
 * orthographic and drawn flat-shaded with their edges so a size reads off them, and Perspective in
 * the chosen mode. A double-click on a pane (or M, or the bar's key) maximises it and restores the
 * tiling; the layout is remembered. All four are drawn on one context, each scissored to its
 * rectangle of a store that is kept between frames, so a pane is drawn again only when what it
 * shows changed: turning the Perspective pane draws that pane alone.
 *
 * Handles stand on the piece (`../handles.ts`): the centre stone's girdle, the halo's melee, an
 * eternity's stones, the wall and the band's width. A drag previews the piece at draft quality
 * (`piecemesh` with the new number, at most one a frame), names the number beside the pointer and
 * says the checks it would break (`propose`, read and dropped at once); the release makes one
 * `piece` change, or with Alt held a proposal. A handle is a slider to the keyboard: the arrows
 * nudge it, Enter commits, Escape puts it back.
 *
 * It draws when something changed (a new mesh, a camera move, a resize, a theme change, a mode)
 * and never on an idle loop: a turn to a standard view animates for its short time and stops, and
 * does not animate at all where motion is turned down. Its inks are the theme's: the background and the grid are read from the tokens
 * on the element, and a part's colour is the one the engine sent.
 */

import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { Envelope } from "../facade";
import { downloadBytes } from "../files";
import { isRecord } from "../json";
import { wheelZoomFactor } from "../view";
import { contactShadow } from "../materials";
import { createRenderer, type Renderer } from "../render3d";
import {
  deviceRect,
  fitOrthos,
  loadLayout,
  ORTHO_PANES,
  orthoFrame,
  orthoPan,
  orthoPlan,
  orthoZoom,
  paneAt,
  PANE_NAMES,
  PANES,
  saveLayout,
  tileRects,
  toggleMax,
  type Layout,
  type OrthoPane,
  type OrthoView,
  type Pane,
  type Rect,
} from "../fourview";
import { dragValue, shortRefusal, handlePatch, handleReadout, handleTitle, nudgeValue, pieceHandles, screenHandle, settleValue, type Handle } from "../handles";
import { parseProposals, checkLines } from "../proposals";
import type { Mat4 } from "../view3d";
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
import { RenderExportButtons } from "./RenderExportDialog";
import "../view3d.css";

export interface Viewport3DProps {
  /** The engine's `execute`, envelope parsed (`AppFacade.execute`). A promise is awaited. */
  execute: (command: string, params: unknown) => Envelope | Promise<Envelope>;
  /** The drawing's revision: when it changes while this view is up, the piece is fetched again. */
  revision: number;
  /** Say a refusal beside the command field, or (null) end what is said there. */
  onNotice: (message: string | null) => void;
  /**
   * A handle was let go: make the change (`piece` with `patch`, one undo step), or with `propose`
   * make it a proposal titled `title`. Answers null when it went through, else the refusal. Without
   * it the piece has no handles.
   */
  onPieceEdit?: (patch: Record<string, unknown>, propose: boolean, title: string) => string | null;
}

/** A handle placed on one pane: where it stands in the stage (CSS pixels) and its axis there. */
interface PlacedHandle {
  handle: Handle;
  pane: Pane;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** The one placing of a handle that takes the keyboard (the others are the same handle seen again). */
  primary: boolean;
}

/** A handle being dragged or nudged: its value now, and what the engine says of it. */
interface HandleEdit {
  handle: Handle;
  value: number;
  /** Where the words stand: beside the pointer, or beside the handle for the keyboard. */
  x: number;
  y: number;
  /** The checks the value would break, or the engine's refusal; null while it is being asked. */
  verdict: { kind: "ok" } | { kind: "broken"; messages: string[] } | { kind: "refused"; message: string } | null;
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
/** A drag asks for a new draft mesh at most this often, and for the checks once it rests this long. */
const PREVIEW_MS = 50;
const CHECKS_MS = 220;
/** One press of an arrow key carries an orthographic pane by this share of its height. */
const KEY_PAN = 0.1;

/** The display modes as the bar's list. */
const MODE_OPTIONS = DISPLAY_MODES.map((entry) => ({ value: entry.mode, label: entry.label }));
/** The STL's sprue: none, or the engine's default sprue at the bottom of the shank. */
const SPRUE_OPTIONS = [
  { value: "none", label: "No sprue" },
  { value: "bottom", label: "Sprue" },
];
/** The STL's casting shrinkage allowance, percent. */
const SHRINK_OPTIONS = ["0", "1", "1.5", "2", "2.5", "3"].map((value) => ({ value, label: value === "0" ? "No shrink" : `+${value}%` }));
/** How far from the gizmo's middle an axis end stands, of the gizmo's half width. */
const GIZMO_REACH = 0.7;

/**
 * The camera as it was left, for the next time the tab comes to the front: there is one 3D stage
 * in the window, and it is unmounted while a layout shows.
 */
let remembered: { camera: Camera; framed: boolean } | null = null;

/** The Perspective camera as it was left (Save Render's "Current view"); null before the stage was shown. */
export function stageCamera(): Camera | null {
  return remembered?.camera ?? null;
}

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
  const [sprue, setSprue] = createSignal("none");
  const [shrink, setShrink] = createSignal("0");
  const [compact, setCompact] = createSignal(false);
  const [gizmo, setGizmo] = createSignal<GizmoEnd[]>(gizmoEnds(remembered?.camera ?? standardCamera("three-quarter", { center: [0, 0, 0], radius: 10 }, 1)));
  const [onEnd, setOnEnd] = createSignal<AxisEnd["id"] | null>(null);
  const [regions, setRegions] = createSignal<PlacedRegions>(NO_REGIONS);
  /** The part under the pointer, by the engine's name for it; null when the pointer is on none. */
  const [pointed, setPointed] = createSignal<string | null>(null);
  /** The pointer can rest over the stage without pressing (a mouse, not a finger): only then is the part under it named. */
  const hovers = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  /** One view or four; read again from the stage's own width once it is measured. */
  const [layout, setLayoutNow] = createSignal<Layout>(loadLayout(typeof window === "undefined" ? 1280 : window.innerWidth));
  const [tiles, setTiles] = createSignal<Partial<Record<Pane, Rect>>>({});
  /** The pane the keys and the bar's Maximise act on: the one last pressed or wheeled. */
  const [active, setActive] = createSignal<Pane>("perspective");
  const [placed, setPlaced] = createSignal<PlacedHandle[]>([]);
  const [edit, setEdit] = createSignal<HandleEdit | null>(null);
  /** The placings by a key that stays while the handle is on its pane, so its element (and its focus and pointer capture) stays too. */
  const placedKeys = createMemo(() => placed().map((spot) => `${spot.pane}:${spot.handle.id}`), [], { equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]) });
  const spotOf = (key: string): PlacedHandle | undefined => placed().find((spot) => `${spot.pane}:${spot.handle.id}` === key);
  /** A short line after a handle's change was refused or put back. */
  const [handleSaid, setHandleSaid] = createSignal("");

  // What is drawn. None of it is reactive: a change calls `schedule`.
  let gl: WebGLRenderingContext | null = null;
  let renderer: Renderer | null = null;
  let buffers: Buffers | null = null;
  /** The reply the buffers were made from: the edges and the pick are made from it when they are first wanted. */
  let solid: PieceMesh | null = null;
  let edges: EdgeBatch | null = null;
  let targets: PickTarget[] | null = null;
  let ground: { data: Float32Array; vertices: number } | null = null;
  /** The realistic mode's contact shadow under the piece. */
  let shadow: Float32Array | null = null;
  let scene: Scene | null = null;
  let camera: Camera | null = remembered?.camera ?? null;
  /** The camera still frames the piece (no pan or zoom since the last fit): a resize or a new size of piece fits again. */
  let framed = remembered?.framed ?? true;
  let size = { w: 0, h: 0, pxW: 0, pxH: 0 };
  let inks: { background: Vec3; grid: Vec3; edge: Vec3; gap: Vec3 } = { background: [0, 0, 0], grid: [0, 0, 0], edge: [1, 1, 1], gap: [0, 0, 0] };
  /** The orthographic panes' eyes, and whether they still frame the piece (fitted at one scale). */
  let orthos: Record<OrthoPane, OrthoView> | null = null;
  let orthoFramed = true;
  /** The piece's box the panes were fitted to. */
  let extent: PieceMesh["extent"] | null = null;
  /** The panes whose picture is out of date: only they are drawn in the next frame. */
  const dirty = new Set<Pane>(PANES);
  /** The piece's parameters as the engine gave them, and the finger's diameter: what the handles are made from. */
  let pieceParams: Record<string, unknown> | null = null;
  let diameter: number | null = null;
  let handles: Handle[] = [];
  /** Each pane's matrix as last drawn, for placing the handles. */
  const paneMatrix = new Map<Pane, Mat4>();
  let probe: CanvasRenderingContext2D | null = null;
  let frame = 0;
  let disposed = false;

  /** A pane's rectangle in the stage; the whole stage for a pane not shown. */
  const rectOf = (pane: Pane): Rect => tiles()[pane] ?? { x: 0, y: 0, w: size.w, h: size.h };
  const aspectOf = (pane: Pane): number => {
    const r = rectOf(pane);
    return r.w > 0 && r.h > 0 ? r.w / r.h : 1;
  };
  /** The Perspective pane's aspect: the one the orbit camera frames for. */
  const aspect = (): number => aspectOf("perspective");
  const orthoAspects = (): Partial<Record<OrthoPane, number>> => ({ top: aspectOf("top"), front: aspectOf("front"), right: aspectOf("right") });

  /** The orthographic eyes fitted to the piece again, at one scale. */
  const fitOrthoViews = (): void => {
    if (scene === null || extent === null) return;
    orthos = fitOrthos(extent, scene, orthoAspects());
    orthoFramed = true;
  };

  const draw = (): void => {
    if (renderer === null || gl === null || gl.isContextLost() || size.pxW === 0 || size.pxH === 0) return;
    const use = scene ?? { center: [0, 0, 0] as const, radius: 10 };
    const shown = tiles();
    const panes = PANES.filter((pane) => shown[pane] !== undefined);
    const whole = panes.length === 1 && layout().kind === "single";
    const ratio = size.w > 0 ? size.pxW / size.w : 1;
    // Every pane at once (a resize, a new layout): the gaps between them are laid first.
    if (!whole && panes.every((pane) => dirty.has(pane))) {
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(inks.gap[0], inks.gap[1], inks.gap[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const pane of panes) {
      const rect = shown[pane];
      if (rect === undefined || !dirty.has(pane)) continue;
      const at = deviceRect(rect, ratio, size.pxH);
      if (at.w <= 0 || at.h <= 0) continue;
      const paneAspect = rect.w > 0 && rect.h > 0 ? rect.w / rect.h : 1;
      const offset = whole ? undefined : { x: at.x, y: at.y };
      if (pane === "perspective") {
        const eye = clampCamera(camera ?? standardCamera("three-quarter", use, paneAspect), use);
        const view = eyeFrame(eye, use, paneAspect);
        renderer.draw({ ...view, background: inks.background, gridInk: inks.grid, edgeInk: null }, drawPlan(mode()), at.w, at.h, offset);
        paneMatrix.set(pane, view.viewProj);
        // What stands over the solid follows the same eye, in the same frame.
        setGizmo(gizmoEnds(eye));
        setRegions(labels() && solid !== null ? shiftRegions(placeRegions(solid.bounds, view.viewProj, rect.w, rect.h), rect) : NO_REGIONS);
      } else {
        if (orthos === null) fitOrthoViews();
        const view = orthos?.[pane];
        if (view === undefined) continue;
        const frameOf = orthoFrame(pane, view, use, paneAspect);
        renderer.draw({ ...frameOf, background: inks.background, gridInk: inks.grid, edgeInk: inks.edge }, orthoPlan(), at.w, at.h, offset);
        paneMatrix.set(pane, frameOf.viewProj);
      }
    }
    dirty.clear();
    placeHandles();
  };

  /** The region names placed in a pane, carried to the stage. */
  const shiftRegions = (placedIn: PlacedRegions, rect: Rect): PlacedRegions => ({
    labels: placedIn.labels.map((label) => ({ ...label, x: label.x + rect.x, y: label.y + rect.y })),
    axis: placedIn.axis === null ? null : { x1: placedIn.axis.x1 + rect.x, y1: placedIn.axis.y1 + rect.y, x2: placedIn.axis.x2 + rect.x, y2: placedIn.axis.y2 + rect.y },
  });

  /** Where every handle stands on every pane shown, from the matrices just drawn. */
  const placeHandles = (): void => {
    if (handles.length === 0 || status().kind !== "ready") {
      if (placed().length > 0) setPlaced([]);
      return;
    }
    const shown = tiles();
    const out: PlacedHandle[] = [];
    const primary = new Set<string>();
    // The keyboard's handle is the one on the Perspective pane where it is shown there.
    const order: Pane[] = ["perspective", "top", "front", "right"];
    for (const pane of order) {
      const rect = shown[pane];
      const matrix = paneMatrix.get(pane);
      if (rect === undefined || matrix === undefined) continue;
      for (const handle of handles) {
        const on = screenHandle(handle, matrix, rect.w, rect.h);
        if (!on.shown) continue;
        const first = !primary.has(handle.id);
        primary.add(handle.id);
        out.push({ handle, pane, x: on.x + rect.x, y: on.y + rect.y, dx: on.dx, dy: on.dy, primary: first });
      }
    }
    setPlaced(out);
  };

  const schedule = (panes: readonly Pane[] = PANES): void => {
    for (const pane of panes) dirty.add(pane);
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
    schedule(["perspective"]);
  };

  /** Take an orthographic pane's eye: that pane alone is drawn again. */
  const lookOrtho = (pane: OrthoPane, next: OrthoView): void => {
    if (orthos === null) return;
    orthos = { ...orthos, [pane]: next };
    orthoFramed = false;
    schedule([pane]);
  };

  /** Change the layout, remember it, and draw every pane it shows. */
  const setLayout = (next: Layout): void => {
    setLayoutNow(next);
    saveLayout(next);
    if (next.kind === "four" && next.max !== null) setActive(next.max);
    else if (next.kind === "single") setActive("perspective");
    wantEdges();
    retile();
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
    fitOrthoViews();
    schedule(ORTHO_PANES);
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
    if (orthos === null || orthoFramed) fitOrthoViews();
    else orthos = { top: orthoPan("top", orthos.top, scene, 0, 0, 1), front: orthoPan("front", orthos.front, scene, 0, 0, 1), right: orthoPan("right", orthos.right, scene, 0, 0, 1) };
    schedule();
    if (camera === null) look(standardCamera("three-quarter", scene, aspect()), true);
    else if (framed) look(fitCamera(camera, scene, aspect()), true);
    else look(clampCamera(camera, scene), false);
  };

  const readInks = (): boolean => {
    if (host === undefined) return false;
    const background = tokenColor(host, "--canvas", probe) ?? inks.background;
    const grid = tokenColor(host, "--grid-major", probe) ?? inks.grid;
    // The orthographic panes' edges take the dim text ink, and the lines between panes the border.
    const edge = tokenColor(host, "--text-faint", probe) ?? inks.edge;
    const gap = tokenColor(host, "--chrome-dark", probe) ?? inks.gap;
    const next = [background, grid, edge, gap];
    const was = [inks.background, inks.grid, inks.edge, inks.gap];
    const same = next.every((ink, k) => ink.every((v, i) => v === was[k]?.[i]));
    inks = { background, grid, edge, gap };
    return !same;
  };

  /** Make the context's programs and hand it what is held; false (with the reason said) when it cannot. */
  const start = (): boolean => {
    if (canvas === undefined) return false;
    if (gl === null) {
      // The store is kept between frames: a pane that did not change is not drawn again.
      const options: WebGLContextAttributes = { antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true };
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
    renderer.upload(buffers, ground, edges, shadow);
    return true;
  };

  // ---- how it is shown ----

  /** The edges of the piece on screen, made the first time a mode draws them. */
  const wantEdges = (): void => {
    if (edges !== null || solid === null || !(modeHasEdges(mode()) || orthoShown())) return;
    edges = featureEdges(solid);
    renderer?.upload(buffers, ground, edges, shadow);
  };

  const chooseMode = (value: string): void => {
    if (!isDisplayMode(value)) return;
    setMode(value);
    saveView3d({ mode: value, labels: labels() });
    wantEdges();
    schedule(["perspective"]);
  };

  const chooseLabels = (on: boolean): void => {
    setLabels(on);
    saveView3d({ mode: mode(), labels: on });
    schedule(["perspective"]);
  };

  // ---- staying in step with the drawing ----

  /** The newest request: a reply to an older one is dropped. */
  let request = 0;
  /** The engine has no such command: said once, and not asked again. */
  let unavailable = false;
  let fineTimer = 0;

  /** The piece's parameters, or the state there is to show instead. */
  const queryPiece = async (): Promise<{ params: Record<string, unknown>; diameter: number | null } | Status> => {
    const env = await props.execute("piece", { query: true });
    if (!env.ok) return isUnknownCommand(env.error) ? { kind: "unavailable" } : { kind: "error", message: env.error };
    const piece = isRecord(env.result) ? env.result["piece"] : undefined;
    if (piece === null) return { kind: "empty" };
    if (!isRecord(piece) || !isRecord(piece["params"])) return { kind: "error", message: "the piece could not be read" };
    const sized = isRecord(piece["size"]) ? piece["size"] : {};
    const across = typeof sized["diameter"] === "number" ? sized["diameter"] : sized["mm"];
    return { params: piece["params"], diameter: typeof across === "number" && Number.isFinite(across) && across > 0 && across < 1000 ? across : null };
  };

  const clearMesh = (): void => {
    buffers = null;
    solid = null;
    edges = null;
    targets = null;
    setPointed(null);
    ground = null;
    shadow = null;
    scene = null;
    extent = null;
    handles = [];
    pieceParams = null;
    setReadout(null);
    renderer?.upload(null, null, null);
    schedule();
  };

  /** The next mesh keeps every eye where it is (after a handle's change): the piece changes under a still camera. */
  let holdEyes = false;

  /** Hand a mesh to the renderer and the panes. */
  const takeMesh = (mesh: PieceMesh): void => {
    solid = mesh;
    buffers = buildBuffers(mesh);
    ground = groundGrid(mesh.extent);
    shadow = contactShadow(mesh.extent);
    edges = modeHasEdges(mode()) || orthoShown() ? featureEdges(mesh) : null;
    targets = null;
    renderer?.upload(buffers, ground, edges, shadow);
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
    pieceParams = piece.params;
    diameter = piece.diameter;
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
    // A drag in hand keeps its own preview on screen; the engine's mesh comes when it ends.
    if (edit() !== null) return;
    takeMesh(reply.mesh);
    handles = props.onPieceEdit === undefined ? [] : pieceHandles(piece.params, piece.diameter, reply.mesh);
    setReadout({ triangles: formatTriangles(reply.mesh.triangles), size: formatSize(reply.mesh.bounds), notes: reply.mesh.notes });
    keepGl({ kind: "ready" });
    if (holdEyes && scene !== null) {
      // The eyes stay; the new box only bounds how far they may go.
      extent = reply.mesh.extent;
      scene = sceneOf(reply.mesh.extent);
      if (quality === "fine") holdEyes = false;
      schedule();
    } else {
      extent = reply.mesh.extent;
      scene = sceneOf(reply.mesh.extent);
      settle();
    }
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
    const env = await props.execute("stlout", { ...piece.params, stones: true, quality: "fine", sprue: sprue() === "bottom", shrink: Number(shrink()) });
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
  /** The pane a gesture began on: it stays that pane's until every pointer is up. */
  let gesturePane: Pane = "perspective";

  /** A window point in the stage's own CSS pixels. */
  const stagePoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const box = canvas?.getBoundingClientRect();
    return box === undefined ? { x: 0, y: 0 } : { x: clientX - box.left, y: clientY - box.top };
  };

  /** The pane under a window point (the Perspective pane when it is on a gap). */
  const paneUnder = (clientX: number, clientY: number): Pane => {
    const at = stagePoint(clientX, clientY);
    return paneAt(tiles(), at.x, at.y) ?? (tiles().perspective !== undefined ? "perspective" : (PANES.find((p) => tiles()[p] !== undefined) ?? "perspective"));
  };

  /** A window point as a pane's own −1…1 (up positive). */
  const ndcIn = (pane: Pane, clientX: number, clientY: number): { x: number; y: number } => {
    const at = stagePoint(clientX, clientY);
    const r = rectOf(pane);
    if (r.w <= 0 || r.h <= 0) return { x: 0, y: 0 };
    return { x: ((at.x - r.x) / r.w) * 2 - 1, y: 1 - ((at.y - r.y) / r.h) * 2 };
  };

  const pinch = (): { x: number; y: number; spread: number } | null => {
    const [a, b] = Array.from(pointers.values());
    if (a === undefined || b === undefined) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  /** Which panes are orthographic and shown. */
  const orthoShown = (): boolean => ORTHO_PANES.some((pane) => tiles()[pane] !== undefined);

  /** The tiles for the stage as it is now; every pane is drawn again. */
  const retile = (): void => {
    setTiles(tileRects(size.w, size.h, layout()));
    wantEdges();
    settle();
    schedule();
  };

  const maximise = (pane: Pane = active()): void => {
    if (layout().kind === "single") return;
    setLayout(toggleMax(layout(), pane));
  };

  // ---- the part under the pointer ----

  let pickFrame = 0;
  let pickAt: { x: number; y: number } | null = null;

  /** Name the part under the resting pointer: at most once a frame, never while the solid is being turned, and on the Perspective pane only. */
  const pickSoon = (clientX: number, clientY: number): void => {
    if (paneUnder(clientX, clientY) !== "perspective") {
      pickAt = null;
      if (pointed() !== null) setPointed(null);
      return;
    }
    pickAt = ndcIn("perspective", clientX, clientY);
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
    if (pointers.size === 0) {
      gesturePane = paneUnder(e.clientX, e.clientY);
      setActive(gesturePane);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured: the drag simply ends at the edge.
    }
    // An orthographic pane does not turn: any drag carries it.
    dragMode = gesturePane !== "perspective" || (e.pointerType === "mouse" && (e.button === 1 || e.button === 2)) ? "pan" : "orbit";
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
    const pane = gesturePane;
    const rect = rectOf(pane);
    if (pointers.size >= 2) {
      const after = pinch();
      if (before === null || after === null) return;
      const zooming = before.spread > 8 && after.spread > 8;
      const at = ndcIn(pane, after.x, after.y);
      if (pane === "perspective") {
        let next = panCamera(camera, scene, after.x - before.x, after.y - before.y, rect.h);
        if (zooming) next = zoomCamera(next, scene, before.spread / after.spread, at.x, at.y, aspect());
        look(next, false);
      } else if (orthos !== null) {
        let next = orthoPan(pane, orthos[pane], scene, after.x - before.x, after.y - before.y, rect.h);
        if (zooming) next = orthoZoom(pane, next, scene, before.spread / after.spread, at.x, at.y, aspectOf(pane));
        lookOrtho(pane, next);
      }
      return;
    }
    const dx = e.clientX - was.x;
    const dy = e.clientY - was.y;
    if (dx === 0 && dy === 0) return;
    if (pane !== "perspective") {
      if (orthos !== null) lookOrtho(pane, orthoPan(pane, orthos[pane], scene, dx, dy, rect.h));
    } else if (dragMode === "pan") look(panCamera(camera, scene, dx, dy, rect.h), false);
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
    const pane = paneUnder(e.clientX, e.clientY);
    setActive(pane);
    const at = ndcIn(pane, e.clientX, e.clientY);
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey);
    if (pane === "perspective") look(zoomCamera(camera, scene, factor, at.x, at.y, aspect()), false);
    else if (orthos !== null) lookOrtho(pane, orthoZoom(pane, orthos[pane], scene, factor, at.x, at.y, aspectOf(pane)));
  };

  /** A double-click maximises the pane under it, or restores the four; in the single view it frames the piece. */
  const onDoubleClick = (e: MouseEvent): void => {
    if (layout().kind === "single") {
      fit();
      return;
    }
    maximise(paneUnder(e.clientX, e.clientY));
  };

  /** The stage's keys, only while it has the focus. A key it takes never reaches the shell. They act on the active pane. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || scene === null || camera === null || status().kind !== "ready") return;
    stopFlight();
    const pane = active();
    const turn = (yaw: number, pitch: number): void => {
      if (scene === null || camera === null) return;
      if (pane === "perspective") look(orbitCamera(camera, scene, yaw, pitch), framed);
      else if (orthos !== null) {
        // An orthographic pane does not turn: the arrows carry it.
        const h = rectOf(pane).h;
        lookOrtho(pane, orthoPan(pane, orthos[pane], scene, Math.sign(yaw) * h * KEY_PAN, -Math.sign(pitch) * h * KEY_PAN, h));
      }
    };
    const zoom = (factor: number): void => {
      if (scene === null || camera === null) return;
      if (pane === "perspective") look(zoomCamera(camera, scene, factor, 0, 0, aspect()), false);
      else if (orthos !== null) lookOrtho(pane, orthoZoom(pane, orthos[pane], scene, factor, 0, 0, aspectOf(pane)));
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
      case "m":
      case "M":
        if (layout().kind === "single") return;
        maximise();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // ---- the handles ----

  /** The drag in hand: where the pointer began, the handle's axis on its pane then, and its value then. */
  let grip: { pointerId: number; x: number; y: number; dx: number; dy: number; start: number } | null = null;
  let previewTimer = 0;
  let checksTimer = 0;
  let lastPreview = 0;
  /** The value the screen shows a preview of, so the same value is not asked for twice. */
  let previewed: number | null = null;

  const stopTimers = (): void => {
    if (previewTimer !== 0) window.clearTimeout(previewTimer);
    if (checksTimer !== 0) window.clearTimeout(checksTimer);
    previewTimer = 0;
    checksTimer = 0;
  };

  /** The piece's mesh for the value in hand, at draft quality: the panes show it, the eyes stay. */
  const preview = async (): Promise<void> => {
    previewTimer = 0;
    const now = edit();
    if (now === null || pieceParams === null || previewed === now.value) return;
    previewed = now.value;
    lastPreview = performance.now();
    const patch = handlePatch(now.handle, now.value, pieceParams);
    const env = await props.execute("piecemesh", { ...pieceParams, ...patch, quality: "draft" });
    if (disposed || edit() === null) return;
    if (!env.ok) {
      setEdit({ ...now, verdict: { kind: "refused", message: shortRefusal(env.error) } });
      return;
    }
    const reply = parseMeshReply(env.result);
    if (!reply.ok) return;
    takeMesh(reply.mesh);
    const moved = pieceHandles({ ...pieceParams, ...patch }, diameter, reply.mesh);
    // The handle in hand keeps the value it began from; the others follow the new piece.
    handles = moved.map((h) => (h.id === now.handle.id ? { ...h, value: now.handle.value } : h));
    schedule();
  };

  /** What the checks would say of the value in hand: `propose` reads it and puts the drawing back, and the proposal is dropped at once. */
  const judge = async (): Promise<void> => {
    checksTimer = 0;
    const now = edit();
    if (now === null || pieceParams === null) return;
    const patch = handlePatch(now.handle, now.value, pieceParams);
    const env = await props.execute("propose", { steps: [{ command: "piece", params: patch }], title: handleTitle(now.handle, now.value) });
    const made = env.ok ? parseProposals(env.result) : [];
    for (const p of made) void props.execute("reject", { id: p.id });
    const after = edit();
    if (disposed || after === null || after.value !== now.value) return;
    if (!env.ok) {
      setEdit({ ...after, verdict: { kind: "refused", message: shortRefusal(env.error) } });
      return;
    }
    const first = made[0];
    const lines = first === undefined ? null : checkLines(first);
    const broken = lines === null ? [] : lines.broken.map((c) => c.message);
    setEdit({ ...after, verdict: broken.length > 0 ? { kind: "broken", messages: broken.slice(0, 3) } : { kind: "ok" } });
  };

  /** The value in hand changed: preview it (at most one mesh per `PREVIEW_MS`), and ask the checks once it rests. */
  const valueChanged = (value: number, x: number, y: number): void => {
    const now = edit();
    if (now === null) return;
    if (now.value === value) {
      setEdit({ ...now, x, y });
      return;
    }
    setEdit({ ...now, value, x, y, verdict: null });
    if (previewTimer === 0) previewTimer = window.setTimeout(() => void preview(), Math.max(0, PREVIEW_MS - (performance.now() - lastPreview)));
    if (checksTimer !== 0) window.clearTimeout(checksTimer);
    checksTimer = window.setTimeout(() => void judge(), CHECKS_MS);
  };

  const beginEdit = (handle: Handle, x: number, y: number): void => {
    stopTimers();
    previewed = handle.value;
    setHandleSaid("");
    setEdit({ handle, value: handle.value, x, y, verdict: null });
  };

  /** Put the piece back as the engine holds it, the eyes where they are. */
  const restore = (): void => {
    holdEyes = true;
    void load("draft");
  };

  /** Let the edit go without a change. */
  const cancelEdit = (said: string): void => {
    const now = edit();
    stopTimers();
    dropGrip();
    setEdit(null);
    if (now !== null && now.value !== now.handle.value) {
      setHandleSaid(said);
      restore();
    }
  };

  /** Make the change (or, with `propose`, a proposal of it): one `piece` step. */
  const commitEdit = (propose: boolean): void => {
    const now = edit();
    stopTimers();
    dropGrip();
    setEdit(null);
    if (now === null || pieceParams === null || props.onPieceEdit === undefined) return;
    if (Math.abs(now.value - now.handle.value) < 1e-9) return;
    const error = props.onPieceEdit(handlePatch(now.handle, now.value, pieceParams), propose, handleTitle(now.handle, now.value));
    if (error !== null) {
      setHandleSaid(`Not changed: ${shortRefusal(error)}`);
      restore();
      return;
    }
    setHandleSaid(propose ? `Proposed: ${handleTitle(now.handle, now.value)}` : `${handleTitle(now.handle, now.value)}`);
    // A proposal leaves the drawing as it was: the piece on screen goes back to it.
    if (propose) restore();
    else holdEyes = true;
  };

  const onHandleDown = (spot: PlacedHandle, e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Not captured: the drag ends when the pointer leaves the handle.
    }
    target.focus({ preventScroll: true });
    setActive(spot.pane);
    const at = stagePoint(e.clientX, e.clientY);
    grip = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dx: spot.dx, dy: spot.dy, start: spot.handle.value };
    beginEdit(spot.handle, at.x, at.y);
    // The window hears the rest of the drag: the handle's element may move under the pointer.
    window.addEventListener("pointermove", onHandleMove);
    window.addEventListener("pointerup", onHandleUp);
    window.addEventListener("pointercancel", onGripCancel);
  };

  const dropGrip = (): void => {
    grip = null;
    window.removeEventListener("pointermove", onHandleMove);
    window.removeEventListener("pointerup", onHandleUp);
    window.removeEventListener("pointercancel", onGripCancel);
  };

  const onGripCancel = (e: PointerEvent): void => {
    if (grip !== null && e.pointerId === grip.pointerId) cancelEdit("Put back: the drag was interrupted");
  };

  const onHandleMove = (e: PointerEvent): void => {
    if (grip === null || e.pointerId !== grip.pointerId) return;
    const now = edit();
    if (now === null) return;
    const raw = dragValue(grip.start, now.handle.rate, grip, e.clientX - grip.x, e.clientY - grip.y);
    const at = stagePoint(e.clientX, e.clientY);
    valueChanged(settleValue(now.handle, raw, e.shiftKey), at.x, at.y);
  };

  const onHandleUp = (e: PointerEvent): void => {
    if (grip === null || e.pointerId !== grip.pointerId) return;
    commitEdit(e.altKey);
  };

  const onHandleKey = (spot: PlacedHandle, e: KeyboardEvent): void => {
    const now = edit();
    const nudge = (dir: 1 | -1): void => {
      const held = now ?? null;
      if (held === null) beginEdit(spot.handle, spot.x, spot.y);
      const from = held?.value ?? spot.handle.value;
      valueChanged(nudgeValue(spot.handle, from, dir, e.shiftKey), spot.x, spot.y);
    };
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        nudge(1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        nudge(-1);
        break;
      case "Enter":
        if (now === null) return;
        commitEdit(e.altKey);
        break;
      case "Escape":
        if (now === null) return;
        cancelEdit("Put back: nothing changed");
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  /** Leaving a handle with a nudged value in hand puts it back: only Enter (or a release) commits. */
  const onHandleBlur = (): void => {
    if (grip === null && edit() !== null) cancelEdit("Put back: the handle lost the focus before Enter");
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
      const changed = pxW !== size.pxW || pxH !== size.pxH || box.width !== size.w || box.height !== size.h;
      const first = size.w === 0;
      size = { w: box.width, h: box.height, pxW, pxH };
      setCompact(box.width < COMPACT_BELOW);
      if (!changed) return;
      // The default layout is the stage's own: four views when it is wide, one on a phone.
      if (first) setLayoutNow(loadLayout(box.width));
      surface.width = pxW;
      surface.height = pxH;
      setTiles(tileRects(size.w, size.h, layout()));
      wantEdges();
      settle();
      // Sizing the store clears it: draw in the same frame, so a resize never shows an empty one.
      for (const pane of PANES) dirty.add(pane);
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
      stopTimers();
      dropGrip();
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
        aria-label={
          layout().kind === "single"
            ? "The piece in 3D. Drag to turn it; the arrow keys turn it, plus and minus zoom, F frames it."
            : `The piece in 3D, ${layout().kind === "four" && (layout() as { max: Pane | null }).max !== null ? "one view maximised" : "in four views: Top, Perspective, Front and Right"}. The keys act on the ${PANE_NAMES[active()].name} view: the arrows turn or carry it, plus and minus zoom, F frames the piece, M maximises or restores.`
        }
        data-gesture={gesture() ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerLeave}
        onDblClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      />
      <Show when={status().kind === "ready"}>
        {/* The panes' frames and names; they take no pointer, so the canvas under them gets it. */}
        <div class="view3d-panes" aria-hidden="true">
          <For each={PANES.filter((pane) => tiles()[pane] !== undefined)}>
            {(pane) => (
              <div
                class="view3d-pane"
                data-pane={pane}
                data-active={layout().kind === "four" && active() === pane ? "" : undefined}
                style={{
                  "--px": (rectOf(pane).x / Math.max(1, size.w)) * 100,
                  "--py": (rectOf(pane).y / Math.max(1, size.h)) * 100,
                  "--pw": (rectOf(pane).w / Math.max(1, size.w)) * 100,
                  "--ph": (rectOf(pane).h / Math.max(1, size.h)) * 100,
                }}
              >
                <Show when={layout().kind === "four"}>
                  <span class="view3d-pane-name">{PANE_NAMES[pane].name}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="view3d-handles" role="group" aria-label="Handles on the piece">
          <For each={placedKeys()}>
            {(key) => (
              <Show when={spotOf(key)}>
                {(spot) => (
              <div
                class="view3d-handle"
                role="slider"
                tabindex={spot().primary ? 0 : -1}
                aria-hidden={spot().primary ? undefined : "true"}
                aria-label={`${spot().handle.label}, drag or use the arrow keys; Enter makes the change, Alt+Enter proposes it, Escape puts it back`}
                aria-valuemin={spot().handle.min}
                aria-valuemax={spot().handle.max}
                aria-valuenow={edit()?.handle.id === spot().handle.id ? (edit()?.value ?? spot().handle.value) : spot().handle.value}
                aria-valuetext={`${(edit()?.handle.id === spot().handle.id ? (edit()?.value ?? spot().handle.value) : spot().handle.value).toFixed(2)} millimetres`}
                data-handle={spot().handle.id}
                data-held={edit()?.handle.id === spot().handle.id ? "" : undefined}
                style={{ "--hx": (spot().x / Math.max(1, size.w)) * 100, "--hy": (spot().y / Math.max(1, size.h)) * 100 }}
                onPointerDown={(e) => onHandleDown(spot(), e)}
                onKeyDown={(e) => onHandleKey(spot(), e)}
                onBlur={onHandleBlur}
              />
                )}
              </Show>
            )}
          </For>
        </div>
        <Show when={edit()}>
          {(now) => (
            <div
              class="view3d-drag"
              role="status"
              data-left={now().x > size.w * 0.55 ? "" : undefined}
              data-up={now().y > size.h * 0.6 ? "" : undefined}
              style={{ "--hx": (now().x / Math.max(1, size.w)) * 100, "--hy": (now().y / Math.max(1, size.h)) * 100 }}>
              <span class="view3d-drag-value">{handleReadout(now().handle, now().value)}</span>
              <Show when={now().verdict}>
                {(verdict) => (
                  <Show
                    when={verdict().kind !== "ok"}
                    fallback={<span class="view3d-drag-ok">Checks pass</span>}
                  >
                    <For each={verdict().kind === "broken" ? (verdict() as { messages: string[] }).messages : [(verdict() as { message: string }).message]}>
                      {(line) => <span class="view3d-drag-fault">{verdict().kind === "refused" ? `Refused: ${line}` : `Breaks: ${line}`}</span>}
                    </For>
                  </Show>
                )}
              </Show>
            </div>
          )}
        </Show>
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
        <div class="view3d-gizmo" role="toolbar" aria-label="Orientation" hidden={tiles().perspective === undefined || edit() !== null} ref={(element) => rovingBand(element, "button")}>
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
                <Show when={handleSaid() !== ""}>
                  <span class="view3d-note" role="status">
                    {handleSaid()}
                  </span>
                </Show>
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
            <Toggle variant="text" size="sm" ariaLabel="Four views" hint="Top, Front, Right and Perspective (double-click a view to maximise it)" placement="top" pressed={layout().kind === "four"} onChange={(on) => setLayout(on ? { kind: "four", max: null } : { kind: "single" })}>
              4 views
            </Toggle>
            <Show when={layout().kind === "four"}>
              <Button variant="quiet" size="sm" title={`${(layout() as { max: Pane | null }).max === null ? `Fill the stage with the ${PANE_NAMES[active()].name} view` : "Show the four views again"} (M)`} onClick={() => maximise()}>
                {(layout() as { max: Pane | null }).max === null ? "Maximise" : "Restore"}
              </Button>
            </Show>
            <Select size="sm" ariaLabel="Display mode" title="How the solid is shown" value={mode()} options={MODE_OPTIONS} onChange={chooseMode} />
            <Toggle variant="text" size="sm" ariaLabel="Region labels" hint="Name the regions of the ring" placement="top" pressed={labels()} onChange={chooseLabels}>
              Labels
            </Toggle>
            <Select size="sm" ariaLabel="STL sprue" title="A sprue for casting, merged into the STL at the bottom of the shank" value={sprue()} options={SPRUE_OPTIONS} onChange={setSprue} />
            <Select size="sm" ariaLabel="STL shrinkage" title="Scale the STL up for the metal's casting shrinkage" value={shrink()} options={SHRINK_OPTIONS} onChange={setShrink} />
            <Button variant="quiet" size="sm" title="Save the piece as a file for printing" onClick={() => void downloadStl()}>
              Download STL
            </Button>
            <RenderExportButtons />
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
