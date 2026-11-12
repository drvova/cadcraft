/**
 * The 3D view of the piece: the stage the "3D" tab over the drawing brings to the front. It shows
 * the solid the engine makes of the parametric piece (`piecemesh`), shaded, under an orbit camera.
 *
 * The geometry is the engine's. This file is the thin WebGL part: two small shader programs, three
 * vertex buffers, the pointer and the keys. The math it leans on (matrices, the camera and its
 * clamps, the checked reading of the reply, the normals) is in `../view3d.ts`, which is tested.
 *
 * It is mounted only while its tab is in front and lies over the 2D canvas, which stays mounted
 * under it at its own size, so the drawing's view is exactly as it was left. While this view is up
 * the canvas under it is `inert`: it takes no focus and no pointer.
 *
 * It draws when something changed (a new mesh, a camera move, a resize, a theme change) and never
 * on an idle loop. Its inks are the theme's: the background and the grid are read from the tokens
 * on the element, and a part's colour is the one the engine sent.
 */

import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { Envelope } from "../facade";
import { downloadBytes } from "../files";
import { isRecord } from "../json";
import { wheelZoomFactor } from "../view";
import {
  buildBuffers,
  cameraBasis,
  clampCamera,
  fitCamera,
  formatSize,
  formatTriangles,
  GRID_FLOATS,
  groundGrid,
  isUnknownCommand,
  mat4Multiply,
  normalize,
  orbitCamera,
  panCamera,
  parseMeshReply,
  parseStlReply,
  projectionMatrix,
  sceneOf,
  standardCamera,
  standardViewOf,
  VERTEX_FLOATS,
  viewMatrix,
  zoomCamera,
  type Buffers,
  type Camera,
  type Scene,
  type StandardView,
  type Vec3,
} from "../view3d";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
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

/**
 * The camera as it was left, for the next time the tab comes to the front: there is one 3D stage
 * in the window, and it is unmounted while a layout shows.
 */
let remembered: { camera: Camera; framed: boolean } | null = null;

// ---- the shaders ----

const MESH_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uViewProj;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

/**
 * One program for both kinds. Metal: a key and a fill light over an ambient floor, a soft
 * highlight in the metal's own colour, and a broad light-above, dark-below reflection so a curved
 * band reads as polished. Stone: the colour lifted toward white, a tight highlight, a bright rim
 * where the surface turns away (a Fresnel-like term), and a little see-through. No refraction.
 */
const MESH_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uEye;
uniform vec3 uKey;
uniform vec3 uFill;
uniform vec3 uUp;
uniform float uStone;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vPosition);
  if (dot(n, v) < 0.0) n = -n;
  float key = max(dot(n, uKey), 0.0);
  float fill = max(dot(n, uFill), 0.0);
  float facing = max(dot(n, v), 0.0);
  float rim = pow(1.0 - facing, 3.0);
  vec3 r = reflect(-v, n);
  float sky = smoothstep(-0.45, 0.8, dot(r, uUp));
  float glint = max(dot(n, normalize(uKey + v)), 0.0);
  vec3 color;
  float alpha = 1.0;
  if (uStone < 0.5) {
    vec3 lit = vColor * (0.20 + 0.50 * key + 0.18 * fill);
    vec3 mirror = vColor * (0.04 + 0.46 * sky);
    vec3 shine = mix(vColor, vec3(1.0), 0.55) * (0.50 * pow(glint, 42.0) + 0.10 * pow(glint, 8.0));
    color = lit + mirror + shine + vColor * rim * 0.10;
  } else {
    vec3 base = mix(vColor, vec3(1.0), 0.45);
    float flash = pow(glint, 60.0);
    color = base * (0.52 + 0.30 * key + 0.14 * fill + 0.16 * sky) + vec3(1.0) * (0.45 * flash + 0.45 * rim);
    alpha = clamp(0.62 + 0.38 * rim + 0.5 * flash, 0.0, 1.0);
  }
  gl_FragColor = vec4(min(color, vec3(1.0)), alpha);
}`;

const GRID_VERTEX = `
attribute vec3 aPosition;
attribute float aShow;
uniform mat4 uViewProj;
varying float vShow;
void main() {
  vShow = aShow;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const GRID_FRAGMENT = `
precision mediump float;
uniform vec3 uInk;
varying float vShow;
void main() {
  gl_FragColor = vec4(uInk, vShow);
}`;

// ---- the renderer ----

interface Frame {
  viewProj: readonly number[];
  eye: Vec3;
  key: Vec3;
  fill: Vec3;
  up: Vec3;
  background: Vec3;
  gridInk: Vec3;
}

interface Renderer {
  upload: (buffers: Buffers | null, grid: { data: Float32Array; vertices: number } | null) => void;
  draw: (frame: Frame, width: number, height: number) => void;
  dispose: () => void;
}

/** Build the programs and buffers on a context, or say in words why it cannot be done. */
function createRenderer(gl: WebGLRenderingContext): Renderer | string {
  const compile = (type: number, source: string): WebGLShader | string => {
    const shader = gl.createShader(type);
    if (shader === null) return "a shader could not be created";
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      const log = gl.getShaderInfoLog(shader) ?? "";
      gl.deleteShader(shader);
      return `a shader did not compile: ${log.slice(0, 200)}`;
    }
    return shader;
  };
  const link = (vertex: string, fragment: string): WebGLProgram | string => {
    const vs = compile(gl.VERTEX_SHADER, vertex);
    if (typeof vs === "string") return vs;
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    if (typeof fs === "string") {
      gl.deleteShader(vs);
      return fs;
    }
    const program = gl.createProgram();
    if (program === null) return "a program could not be created";
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // The program keeps what it needs of them; flagged now, they go with it.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      return `the shaders did not link: ${log.slice(0, 200)}`;
    }
    return program;
  };
  const mesh = link(MESH_VERTEX, MESH_FRAGMENT);
  if (typeof mesh === "string") return mesh;
  const grid = link(GRID_VERTEX, GRID_FRAGMENT);
  if (typeof grid === "string") {
    gl.deleteProgram(mesh);
    return grid;
  }
  const metalBuffer = gl.createBuffer();
  const stoneBuffer = gl.createBuffer();
  const gridBuffer = gl.createBuffer();
  let metalCount = 0;
  let stoneCount = 0;
  let gridCount = 0;
  const meshAt = { position: gl.getAttribLocation(mesh, "aPosition"), normal: gl.getAttribLocation(mesh, "aNormal"), color: gl.getAttribLocation(mesh, "aColor") };
  const meshU = {
    viewProj: gl.getUniformLocation(mesh, "uViewProj"),
    eye: gl.getUniformLocation(mesh, "uEye"),
    key: gl.getUniformLocation(mesh, "uKey"),
    fill: gl.getUniformLocation(mesh, "uFill"),
    up: gl.getUniformLocation(mesh, "uUp"),
    stone: gl.getUniformLocation(mesh, "uStone"),
  };
  const gridAt = { position: gl.getAttribLocation(grid, "aPosition"), show: gl.getAttribLocation(grid, "aShow") };
  const gridU = { viewProj: gl.getUniformLocation(grid, "uViewProj"), ink: gl.getUniformLocation(grid, "uInk") };
  const BYTES = Float32Array.BYTES_PER_ELEMENT;

  const fill = (buffer: WebGLBuffer | null, data: Float32Array | null): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data ?? new Float32Array(0), gl.STATIC_DRAW);
  };
  const point = (location: number, size: number, stride: number, offset: number): void => {
    if (location < 0) return;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * BYTES, offset * BYTES);
  };
  const unpoint = (...locations: number[]): void => {
    for (const location of locations) if (location >= 0) gl.disableVertexAttribArray(location);
  };
  const drawMesh = (buffer: WebGLBuffer | null, count: number, stone: boolean): void => {
    if (count === 0) return;
    gl.uniform1f(meshU.stone, stone ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    point(meshAt.position, 3, VERTEX_FLOATS, 0);
    point(meshAt.normal, 3, VERTEX_FLOATS, 3);
    point(meshAt.color, 3, VERTEX_FLOATS, 6);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  };

  return {
    upload(buffers, ground) {
      fill(metalBuffer, buffers?.metal.data ?? null);
      fill(stoneBuffer, buffers?.stone.data ?? null);
      fill(gridBuffer, ground?.data ?? null);
      metalCount = buffers?.metal.vertices ?? 0;
      stoneCount = buffers?.stone.vertices ?? 0;
      gridCount = ground?.vertices ?? 0;
    },
    draw(frame, width, height) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(frame.background[0], frame.background[1], frame.background[2], 1);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // Both sides of a face are lit (the shader turns the normal to the eye), so a part that is
      // an open surface is still seen from behind.
      gl.disable(gl.CULL_FACE);
      const viewProj = new Float32Array(frame.viewProj);

      gl.useProgram(mesh);
      gl.uniformMatrix4fv(meshU.viewProj, false, viewProj);
      gl.uniform3f(meshU.eye, frame.eye[0], frame.eye[1], frame.eye[2]);
      gl.uniform3f(meshU.key, frame.key[0], frame.key[1], frame.key[2]);
      gl.uniform3f(meshU.fill, frame.fill[0], frame.fill[1], frame.fill[2]);
      gl.uniform3f(meshU.up, frame.up[0], frame.up[1], frame.up[2]);
      gl.disable(gl.BLEND);
      drawMesh(metalBuffer, metalCount, false);
      unpoint(meshAt.position, meshAt.normal, meshAt.color);

      // The ground's lines: behind the metal where it covers them, and never written to depth.
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (gridCount > 0) {
        gl.useProgram(grid);
        gl.depthMask(false);
        gl.uniformMatrix4fv(gridU.viewProj, false, viewProj);
        gl.uniform3f(gridU.ink, frame.gridInk[0], frame.gridInk[1], frame.gridInk[2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
        point(gridAt.position, 3, GRID_FLOATS, 0);
        point(gridAt.show, 1, GRID_FLOATS, 3);
        gl.drawArrays(gl.LINES, 0, gridCount);
        unpoint(gridAt.position, gridAt.show);
        gl.depthMask(true);
      }

      // The stones last, over what is behind them.
      gl.useProgram(mesh);
      drawMesh(stoneBuffer, stoneCount, true);
      unpoint(meshAt.position, meshAt.normal, meshAt.color);
      gl.disable(gl.BLEND);
    },
    dispose() {
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      gl.deleteBuffer(metalBuffer);
      gl.deleteBuffer(stoneBuffer);
      gl.deleteBuffer(gridBuffer);
      gl.deleteProgram(mesh);
      gl.deleteProgram(grid);
    },
  };
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

  // What is drawn. None of it is reactive: a change calls `schedule`.
  let gl: WebGLRenderingContext | null = null;
  let renderer: Renderer | null = null;
  let buffers: Buffers | null = null;
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
    const basis = cameraBasis(eye);
    const back: Vec3 = [-basis.forward[0], -basis.forward[1], -basis.forward[2]];
    // The lights travel with the eye, so the form reads the same from every side: the key from
    // over the left shoulder, the fill low from the right.
    const mix = (r: number, u: number, b: number): Vec3 =>
      normalize([basis.right[0] * r + basis.up[0] * u + back[0] * b, basis.right[1] * r + basis.up[1] * u + back[1] * b, basis.right[2] * r + basis.up[2] * u + back[2] * b]);
    renderer.draw(
      {
        viewProj: mat4Multiply(projectionMatrix(eye, use, aspect()), viewMatrix(eye)),
        eye: basis.eye,
        key: mix(-0.5, 0.7, 0.55),
        fill: mix(0.8, -0.1, 0.45),
        up: basis.up,
        background: inks.background,
        gridInk: inks.grid,
      },
      size.pxW,
      size.pxH,
    );
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
    schedule();
  };

  const fit = (): void => {
    if (scene === null) return;
    look(fitCamera(camera ?? standardCamera("three-quarter", scene, aspect()), scene, aspect()), true);
  };

  const showView = (view: StandardView): void => {
    if (scene !== null) look(standardCamera(view, scene, aspect()), true);
  };

  /** The camera after the piece or the stage changed size: fitted again if it was, clamped otherwise. */
  const settle = (): void => {
    if (scene === null) return;
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
    renderer.upload(buffers, ground);
    return true;
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
    ground = null;
    scene = null;
    setReadout(null);
    renderer?.upload(null, null);
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
    buffers = buildBuffers(reply.mesh);
    ground = groundGrid(reply.mesh.extent);
    scene = sceneOf(reply.mesh.extent);
    renderer?.upload(buffers, ground);
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

  const onPointerDown = (e: PointerEvent): void => {
    if (scene === null || canvas === undefined) return;
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
    const at = ndc(e.clientX, e.clientY);
    look(zoomCamera(camera, scene, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), at.x, at.y, aspect()), false);
  };

  /** The stage's keys, only while it has the focus. A key it takes never reaches the shell. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || scene === null || camera === null || status().kind !== "ready") return;
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

    onCleanup(() => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
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
        onDblClick={fit}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      />
      <Show when={status().kind === "ready"}>
        <div class="view3d-foot">
          <Show when={readout()}>
            {(facts) => (
              <div class="view3d-readout">
                <span class="view3d-fact">{facts().triangles}</span>
                <span class="view3d-fact">{facts().size}</span>
                <For each={facts().notes}>{(note) => <span class="view3d-note">{note}</span>}</For>
              </div>
            )}
          </Show>
          <div class="view3d-bar" role="toolbar" aria-label="3D view" ref={(element) => rovingBand(element, "button")}>
            <IconButton icon="zoom.extents" title="Fit the piece" shortcut="F" onClick={fit} />
            <For each={VIEW_KEYS}>
              {(key) => (
                <Toggle variant="text" size="sm" ariaLabel={key.label} hint={key.label} placement="top" pressed={standard() === key.view} onChange={() => showView(key.view)}>
                  {key.face}
                </Toggle>
              )}
            </For>
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
