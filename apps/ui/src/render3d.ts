/**
 * The 3D view's drawing, shared by the stage (`components/Viewport3D.tsx`) and by stills made off
 * screen (`renderPieceStill`, for a sheet that shows the piece from several sides): the shader
 * programs, the buffers, and one frame drawn as the passes `drawPlan` lists for a display mode.
 *
 * Nothing here decides geometry. The triangles are the engine's (`piecemesh`); the math (the
 * camera, the edges, the order of the passes) is `./view3d.ts`, which is tested without a GPU.
 * What is left here needs a WebGL context, so it is verified in the browser.
 */

import {
  buildBuffers,
  drawPlan,
  EDGE_FLOATS,
  eyeFrame,
  featureEdges,
  GRID_FLOATS,
  modeHasEdges,
  sceneOf,
  standardCamera,
  VERTEX_FLOATS,
  type Buffers,
  type Camera,
  type DisplayMode,
  type DrawPass,
  type EdgeBatch,
  type EyeFrame,
  type PieceMesh,
  type Scene,
  type StandardView,
  type Vec3,
} from "./view3d";

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
 *
 * `uGhost` is a see-through pass's opacity and how much the rim lifts it; a negative opacity
 * leaves the kind's own (metal solid, a stone slightly see-through).
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
uniform vec2 uGhost;
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
  if (uGhost.x >= 0.0) alpha = clamp(uGhost.x + uGhost.y * rim, 0.0, 1.0);
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

/**
 * An edge carries its middle, half its span, and the normals of the two faces it lies between
 * (`featureEdges`). It is drawn where one face looks at the eye and the other away, which a sharp
 * edge's pair of opposite normals always does; elsewhere both its ends are put outside the view.
 * The test is made at the edge's middle, so both ends agree. `uNudge` moves the line by a
 * fraction of a pixel, for a second and third stroke that thicken it.
 */
const EDGE_VERTEX = `
attribute vec3 aMid;
attribute vec3 aHalf;
attribute vec3 aNa;
attribute vec3 aNb;
attribute vec3 aColor;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec2 uNudge;
varying vec3 vColor;
void main() {
  vec3 v = uEye - aMid;
  vColor = aColor;
  vec4 p = uViewProj * vec4(aMid + aHalf, 1.0);
  p.xy += uNudge * p.w;
  if (dot(aNa, v) * dot(aNb, v) > 0.0) p = vec4(2.0, 2.0, 2.0, 1.0);
  gl_Position = p;
}`;

/** An edge in its part's colour, lifted toward white so it reads as a line, or in the one ink the caller gave. */
const EDGE_FRAGMENT = `
precision mediump float;
uniform vec4 uInk;
uniform float uAlpha;
varying vec3 vColor;
void main() {
  vec3 own = mix(vColor, vec3(1.0), 0.25);
  gl_FragColor = vec4(mix(own, uInk.rgb, uInk.a), uAlpha);
}`;

// ---- the renderer ----

/** One frame: the eye, and the inks that are not the parts' own. */
export interface Frame extends EyeFrame {
  /** What the frame is cleared to; null clears to nothing (a still over a page). */
  background: Vec3 | null;
  gridInk: Vec3;
  /** One ink for every edge; null draws each edge in its part's colour. */
  edgeInk: Vec3 | null;
}

export interface Ground {
  data: Float32Array;
  vertices: number;
}

export interface Renderer {
  upload: (buffers: Buffers | null, ground: Ground | null, edges: EdgeBatch | null) => void;
  /** Draw one frame as `plan`'s passes on a store `width` by `height` device pixels. */
  draw: (frame: Frame, plan: readonly DrawPass[], width: number, height: number) => void;
  dispose: () => void;
}

/** The strokes of a bold edge, in device pixels from the line. */
const BOLD_STROKES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
];

/** Build the programs and buffers on a context, or say in words why it cannot be done. */
export function createRenderer(gl: WebGLRenderingContext): Renderer | string {
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
  const edge = link(EDGE_VERTEX, EDGE_FRAGMENT);
  if (typeof edge === "string") {
    gl.deleteProgram(mesh);
    gl.deleteProgram(grid);
    return edge;
  }
  const metalBuffer = gl.createBuffer();
  const stoneBuffer = gl.createBuffer();
  const gridBuffer = gl.createBuffer();
  const edgeBuffer = gl.createBuffer();
  let metalCount = 0;
  let stoneCount = 0;
  let gridCount = 0;
  let edgeCount = 0;
  const meshAt = { position: gl.getAttribLocation(mesh, "aPosition"), normal: gl.getAttribLocation(mesh, "aNormal"), color: gl.getAttribLocation(mesh, "aColor") };
  const meshU = {
    viewProj: gl.getUniformLocation(mesh, "uViewProj"),
    eye: gl.getUniformLocation(mesh, "uEye"),
    key: gl.getUniformLocation(mesh, "uKey"),
    fill: gl.getUniformLocation(mesh, "uFill"),
    up: gl.getUniformLocation(mesh, "uUp"),
    stone: gl.getUniformLocation(mesh, "uStone"),
    ghost: gl.getUniformLocation(mesh, "uGhost"),
  };
  const gridAt = { position: gl.getAttribLocation(grid, "aPosition"), show: gl.getAttribLocation(grid, "aShow") };
  const gridU = { viewProj: gl.getUniformLocation(grid, "uViewProj"), ink: gl.getUniformLocation(grid, "uInk") };
  const edgeAt = {
    mid: gl.getAttribLocation(edge, "aMid"),
    half: gl.getAttribLocation(edge, "aHalf"),
    na: gl.getAttribLocation(edge, "aNa"),
    nb: gl.getAttribLocation(edge, "aNb"),
    color: gl.getAttribLocation(edge, "aColor"),
  };
  const edgeU = {
    viewProj: gl.getUniformLocation(edge, "uViewProj"),
    eye: gl.getUniformLocation(edge, "uEye"),
    nudge: gl.getUniformLocation(edge, "uNudge"),
    ink: gl.getUniformLocation(edge, "uInk"),
    alpha: gl.getUniformLocation(edge, "uAlpha"),
  };
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
  /** Blending that also keeps the store's own coverage right, so a still cleared to nothing is a true cut-out. */
  const blend = (on: boolean): void => {
    if (!on) {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  const drawFaces = (frame: Frame, viewProj: Float32Array, pass: Extract<DrawPass, { kind: "faces" }>): void => {
    const stone = pass.what === "stone";
    const count = stone ? stoneCount : metalCount;
    if (count === 0) return;
    gl.useProgram(mesh);
    gl.uniformMatrix4fv(meshU.viewProj, false, viewProj);
    gl.uniform3f(meshU.eye, frame.eye[0], frame.eye[1], frame.eye[2]);
    gl.uniform3f(meshU.key, frame.key[0], frame.key[1], frame.key[2]);
    gl.uniform3f(meshU.fill, frame.fill[0], frame.fill[1], frame.fill[2]);
    gl.uniform3f(meshU.up, frame.up[0], frame.up[1], frame.up[2]);
    gl.uniform1f(meshU.stone, stone ? 1 : 0);
    gl.uniform2f(meshU.ghost, pass.opacity ?? -1, pass.rim);
    if (pass.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(pass.depthWrite && pass.depthTest);
    gl.colorMask(pass.color, pass.color, pass.color, pass.color);
    // Solid metal covers what is behind it; everything else is laid over it.
    blend(pass.color && (stone || pass.opacity !== null));
    if (pass.pushed) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 2);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, stone ? stoneBuffer : metalBuffer);
    point(meshAt.position, 3, VERTEX_FLOATS, 0);
    point(meshAt.normal, 3, VERTEX_FLOATS, 3);
    point(meshAt.color, 3, VERTEX_FLOATS, 6);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    unpoint(meshAt.position, meshAt.normal, meshAt.color);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
  };

  /** The ground's lines: behind whatever is already in depth, and never written to it. */
  const drawGround = (frame: Frame, viewProj: Float32Array): void => {
    if (gridCount === 0) return;
    gl.useProgram(grid);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    blend(true);
    gl.uniformMatrix4fv(gridU.viewProj, false, viewProj);
    gl.uniform3f(gridU.ink, frame.gridInk[0], frame.gridInk[1], frame.gridInk[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
    point(gridAt.position, 3, GRID_FLOATS, 0);
    point(gridAt.show, 1, GRID_FLOATS, 3);
    gl.drawArrays(gl.LINES, 0, gridCount);
    unpoint(gridAt.position, gridAt.show);
    gl.depthMask(true);
  };

  const drawEdges = (frame: Frame, viewProj: Float32Array, pass: Extract<DrawPass, { kind: "edges" }>, width: number, height: number): void => {
    if (edgeCount === 0) return;
    gl.useProgram(edge);
    if (pass.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    blend(true);
    gl.uniformMatrix4fv(edgeU.viewProj, false, viewProj);
    gl.uniform3f(edgeU.eye, frame.eye[0], frame.eye[1], frame.eye[2]);
    const ink = frame.edgeInk;
    gl.uniform4f(edgeU.ink, ink?.[0] ?? 0, ink?.[1] ?? 0, ink?.[2] ?? 0, ink === null ? 0 : 1);
    gl.uniform1f(edgeU.alpha, pass.alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
    point(edgeAt.mid, 3, EDGE_FLOATS, 0);
    point(edgeAt.half, 3, EDGE_FLOATS, 3);
    point(edgeAt.na, 3, EDGE_FLOATS, 6);
    point(edgeAt.nb, 3, EDGE_FLOATS, 9);
    point(edgeAt.color, 3, EDGE_FLOATS, 12);
    for (const [x, y] of pass.bold ? BOLD_STROKES : BOLD_STROKES.slice(0, 1)) {
      gl.uniform2f(edgeU.nudge, (2 * x) / width, (2 * y) / height);
      gl.drawArrays(gl.LINES, 0, edgeCount);
    }
    unpoint(edgeAt.mid, edgeAt.half, edgeAt.na, edgeAt.nb, edgeAt.color);
    gl.depthMask(true);
  };

  return {
    upload(buffers, ground, edges) {
      fill(metalBuffer, buffers?.metal.data ?? null);
      fill(stoneBuffer, buffers?.stone.data ?? null);
      fill(gridBuffer, ground?.data ?? null);
      fill(edgeBuffer, edges === null ? null : edges.data.subarray(0, edges.vertices * EDGE_FLOATS));
      metalCount = buffers?.metal.vertices ?? 0;
      stoneCount = buffers?.stone.vertices ?? 0;
      gridCount = ground?.vertices ?? 0;
      edgeCount = edges?.vertices ?? 0;
    },
    draw(frame, plan, width, height) {
      if (!(width > 0) || !(height > 0)) return;
      gl.viewport(0, 0, width, height);
      const back = frame.background;
      gl.clearColor(back?.[0] ?? 0, back?.[1] ?? 0, back?.[2] ?? 0, back === null ? 0 : 1);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthFunc(gl.LEQUAL);
      // Both sides of a face are lit (the shader turns the normal to the eye), so a part that is
      // an open surface is still seen from behind.
      gl.disable(gl.CULL_FACE);
      const viewProj = new Float32Array(frame.viewProj);
      for (const pass of plan) {
        if (pass.kind === "faces") drawFaces(frame, viewProj, pass);
        else if (pass.kind === "ground") drawGround(frame, viewProj);
        else drawEdges(frame, viewProj, pass, width, height);
      }
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    },
    dispose() {
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      gl.deleteBuffer(metalBuffer);
      gl.deleteBuffer(stoneBuffer);
      gl.deleteBuffer(gridBuffer);
      gl.deleteBuffer(edgeBuffer);
      gl.deleteProgram(mesh);
      gl.deleteProgram(grid);
      gl.deleteProgram(edge);
    },
  };
}

// ---- stills ----

export interface StillOptions {
  /** Which side the piece is seen from, framed to the picture. */
  view: StandardView;
  /** How it is shown. Defaults to `shaded`. */
  mode?: DisplayMode;
  /** The picture's size in pixels. Each side is held to `STILL_MIN`…`STILL_MAX`. */
  width: number;
  height: number;
  /** What is behind the piece, red, green and blue in 0…1; null or left out is nothing (a cut-out with its own transparency). */
  background?: Vec3 | null;
  /** One ink for the edges of a wireframe or an X-ray (a dark one over paper); null or left out draws each in its part's colour. */
  edgeInk?: Vec3 | null;
}

export const STILL_MIN = 16;
export const STILL_MAX = 4096;

/** What a still is drawn with, worked out without a GPU: the size it will have, where the eye stands, and the passes. */
export interface StillSetup {
  width: number;
  height: number;
  scene: Scene;
  camera: Camera;
  frame: Frame;
  plan: DrawPass[];
  /** Whether the mode draws the feature edges, so whether they are computed. */
  edges: boolean;
}

export function stillSetup(mesh: PieceMesh, options: StillOptions): StillSetup {
  const side = (value: number): number => (Number.isFinite(value) ? Math.min(STILL_MAX, Math.max(STILL_MIN, Math.round(value))) : STILL_MIN);
  const width = side(options.width);
  const height = side(options.height);
  const mode = options.mode ?? "shaded";
  const scene = sceneOf(mesh.extent);
  const camera = standardCamera(options.view, scene, width / height);
  const background = options.background ?? null;
  return {
    width,
    height,
    scene,
    camera,
    // A still has no ground: it is the piece alone.
    frame: { ...eyeFrame(camera, scene, width / height), background, gridInk: background ?? [0, 0, 0], edgeInk: options.edgeInk ?? null },
    plan: drawPlan(mode).filter((pass) => pass.kind !== "ground"),
    edges: modeHasEdges(mode),
  };
}

/** The stills wait in one line: a browser keeps only a few WebGL contexts, so there is never more than one extra. */
let line: Promise<unknown> = Promise.resolve();

/**
 * One picture of the piece, drawn off screen with the stage's own shaders: a PNG as a `Blob`. It
 * makes a context of its own, draws one frame, and gives the context back before it resolves.
 * Calls made together are drawn one after another. It rejects, with the reason in words, where
 * WebGL is not available or the picture cannot be encoded.
 */
export function renderPieceStill(mesh: PieceMesh, options: StillOptions): Promise<Blob> {
  const run = line.then(() => drawStill(mesh, options));
  line = run.catch(() => undefined);
  return run;
}

async function drawStill(mesh: PieceMesh, options: StillOptions): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("a still needs a browser to draw in");
  const setup = stillSetup(mesh, options);
  const canvas = document.createElement("canvas");
  canvas.width = setup.width;
  canvas.height = setup.height;
  // The store is kept after the frame, so it is still there when the picture is encoded.
  const attributes: WebGLContextAttributes = { antialias: true, alpha: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true };
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", attributes);
  } catch {
    gl = null;
  }
  if (gl === null) throw new Error("the still could not be drawn: WebGL is not available");
  let renderer: Renderer | null = null;
  try {
    const made = createRenderer(gl);
    if (typeof made === "string") throw new Error(`the still could not be drawn: ${made}`);
    renderer = made;
    renderer.upload(buildBuffers(mesh), null, setup.edges ? featureEdges(mesh) : null);
    renderer.draw(setup.frame, setup.plan, setup.width, setup.height);
    if (gl.isContextLost()) throw new Error("the still could not be drawn: the graphics context was lost");
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) throw new Error("the still could not be encoded");
    return blob;
  } finally {
    renderer?.dispose();
    // Given back now, not when the canvas is collected.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.width = 0;
    canvas.height = 0;
  }
}
