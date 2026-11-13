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
import { contactShadow, DEEP_POWER, EXPOSURE, HUE_KEEP, realBatch, REAL_FLOATS, SHADOW_FLOATS, STUDIO, STUDIO_BOXES, supersampledSize, SWEEP } from "./materials";

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

// ---- the realistic look ----

/**
 * The studio, as GLSL: `studio(d, r)` is `studioRadiance` of `./materials.ts` for a direction in
 * the eye's frame and a roughness. It stands in for a prefiltered environment map: a rough surface
 * sees each box with a wider, dimmer edge. No texture, so no float-texture extension is needed.
 */
const STUDIO_GLSL = `
uniform vec3 uBoxDir[${STUDIO_BOXES}];
uniform vec3 uBoxAcross[${STUDIO_BOXES}];
uniform vec4 uBoxShape[${STUDIO_BOXES}];
uniform float uBoxGrad[${STUDIO_BOXES}];
uniform vec4 uSweep;
uniform float uHueWhite;
uniform float uDeepPower;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uBack;
vec3 toEye(vec3 d) { return vec3(dot(d, uRight), dot(d, uUp), dot(d, uBack)); }
float sweep(vec3 d, float r) {
  float soft = 0.12 + 0.6 * r;
  float light = d.y < 0.0 ? mix(uSweep.x, uSweep.y, smoothstep(-0.3 - soft, 0.02, d.y)) : mix(uSweep.y, uSweep.z, smoothstep(0.0, 0.6 + soft, d.y));
  return light * (1.0 - uSweep.w * smoothstep(0.975 - soft * 0.3, 0.996, d.z));
}
float boxes(vec3 d, float r) {
  float light = 0.0;
  for (int i = 0; i < ${STUDIO_BOXES}; i++) {
    vec3 bd = uBoxDir[i];
    float c = dot(d, bd);
    if (c > 0.02) {
      vec3 ac = uBoxAcross[i];
      vec3 up = cross(bd, ac);
      vec4 sh = uBoxShape[i];
      float x = abs(dot(d, ac) / c);
      float y = abs(dot(d, up) / c);
      float e = sh.w + 1.6 * r * r;
      float grow = e - sh.w;
      float gain = sh.x * sh.y / ((sh.x + grow) * (sh.y + grow));
      float t = sh.x < sh.y ? min(1.0, x / (sh.x + e)) : min(1.0, y / (sh.y + e));
      light += sh.z * gain * (1.0 - smoothstep(sh.x - e, sh.x + e, x)) * (1.0 - smoothstep(sh.y - e, sh.y + e, y)) * (1.0 - uBoxGrad[i] * t * t);
    }
  }
  return light;
}
float studio(vec3 d, float r) { return sweep(d, r) + boxes(d, r); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec4 finish(vec3 c, float keepHue) {
  vec3 x = max(c, vec3(0.0)) * uExposure;
  vec3 m = aces(x);
  float peak = max(x.r, max(x.g, x.b));
  vec3 hue = peak > 1e-6 ? x * (aces(vec3(peak)).r / peak) : vec3(0.0);
  m = mix(m, clamp(hue * (1.0 - uHueWhite) + m * uHueWhite, 0.0, 1.0), keepHue);
  return vec4(pow(m, vec3(1.0 / 2.2)), 1.0);
}
vec3 deepTint(vec3 f0) {
  float hi = max(f0.r, max(f0.g, f0.b));
  float lo = min(f0.r, min(f0.g, f0.b));
  if (hi <= 0.0) return vec3(0.0);
  float p = 1.0 + uDeepPower * smoothstep(0.2, 0.55, (hi - lo) / hi);
  return hi * pow(max(f0, vec3(0.0)) / hi, vec3(p));
}
`;

const REAL_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aMaterial;
attribute float aDispersion;
uniform mat4 uViewProj;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec4 vMaterial;
varying float vDispersion;
void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vMaterial = aMaterial;
  vDispersion = aDispersion;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

/**
 * The realistic materials, one program for both kinds (`uStone`).
 *
 * Metal: Cook-Torrance's image-based form: the studio seen in the mirror direction at the
 * finish's roughness, times the split-sum response of GGX with Fresnel-Schlick from the alloy's
 * own reflectance (Karis's analytic fit of the integrated BRDF, in place of its lookup table).
 * With derivatives the roughness grows where the normal changes fast across a pixel, so a tight
 * curve does not shimmer. Wax (a negative roughness) is a dull dielectric of its colour.
 *
 * Stone: flat facets (the buffers give every facet its own normal). What a facet reflects (the
 * studio along the mirror direction, by the stone's own Fresnel) over what it returns from inside:
 * light enters, bounces off the pavilion and comes back out near the way it came, turned by the
 * facet's tilt several times over; each of red, green and blue is turned by its own index, which
 * is the fire. The return is tinted by the body colour. An opaque stone (a negative index) is a
 * polished body of its colour.
 */
const REAL_FRAGMENT = (derivatives: boolean): string => `${derivatives ? "#extension GL_OES_standard_derivatives : enable\\n#define DERIVATIVES 1\\n" : ""}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uEye;
uniform float uStone;
uniform float uExposure;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec4 vMaterial;
varying float vDispersion;
${STUDIO_GLSL}
vec2 envBrdf(float rough, float nv) {
  vec4 r = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a + r.zw;
}
float inside(vec3 t, float ior) {
  // t: the facet's tilt from the line of sight, in the eye's frame. Light that comes back out
  // has been turned by the tilt several times over and scattered round the stone's axis by the
  // pavilion's bounces: its angle from the eye grows with the tilt and the index, and its bearing
  // is the tilt's, tripled and twisted. The numbers are chosen by eye, not derived.
  float m = length(t.xy);
  float phi = m > 1e-4 ? atan(t.y, t.x) : 0.0;
  float psi = 3.0 * phi + 2.0 * m * ior + 4.0 * m;
  float el = min(2.4 * (ior - 1.0) * m + 0.15, 1.45);
  vec3 a = vec3(cos(psi) * sin(el), sin(psi) * sin(el), cos(el));
  float psi2 = 1.3 - 2.0 * psi;
  float el2 = 0.6 * el + 0.25;
  vec3 b = vec3(cos(psi2) * sin(el2), sin(psi2) * sin(el2), cos(el2));
  // Inside a stone the sweep is mostly lost through the pavilion: the boxes are what come back,
  // and a scatter of small lamps (a lattice of points on the sphere) is the sparkle.
  vec3 q = a * 11.0;
  float lamps = pow(max(sin(q.x) * sin(q.y) * sin(q.z), 0.0), 8.0) * smoothstep(0.35, 0.7, el);
  return 0.45 * boxes(a, 0.03) + 0.25 * boxes(b, 0.05) + 4.0 * lamps + 0.015;
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vPosition);
  if (dot(n, v) < 0.0) n = -n;
  float nv = clamp(dot(n, v), 1e-3, 1.0);
  vec3 r = reflect(-v, n);
  vec3 color;
  float keepHue = 0.0;
  if (uStone < 0.5) {
    keepHue = vMaterial.w >= 0.0 ? 1.0 : 0.0;
    float rough = abs(vMaterial.w);
#ifdef DERIVATIVES
    vec3 dn = fwidth(n);
    rough = clamp(sqrt(rough * rough + 0.6 * dot(dn, dn)), 0.0, 1.0);
#endif
    vec2 ab = envBrdf(rough, nv);
    if (vMaterial.w >= 0.0) {
      // The boxes mirror in the alloy's colour; the dim sweep in its deeper tint (see deepTint).
      vec3 re = toEye(r);
      color = boxes(re, rough) * (vMaterial.rgb * ab.x + ab.y) + sweep(re, rough) * (deepTint(vMaterial.rgb) * ab.x + ab.y);
    } else {
      color = vMaterial.rgb * studio(toEye(n), 1.0) * 0.9 + studio(toEye(r), rough) * (0.04 * ab.x + ab.y);
    }
  } else {
    float ior = abs(vMaterial.w);
    float f0 = (ior - 1.0) / (ior + 1.0);
    f0 *= f0;
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
    vec3 mirror = vec3(boxes(toEye(r), 0.02) + 0.5 * sweep(toEye(r), 0.02));
    if (vMaterial.w < 0.0) {
      color = vMaterial.rgb * studio(toEye(n), 1.0) * 0.85 + vec3(studio(toEye(r), 0.12)) * fresnel;
    } else {
      vec3 tilt = n - v * nv;
      float h = 0.5 * vDispersion;
      vec3 te = toEye(tilt);
      vec3 back = vec3(inside(te, ior - h), inside(te, ior), inside(te, ior + h));
      // Fire is a fringe, not a facet's whole colour: half of each channel is the stone's mean.
      back = mix(vec3(dot(back, vec3(0.3333))), back, 0.45);
      vec3 body = pow(max(vMaterial.rgb, vec3(0.0)), vec3(1.4));
      color = mirror * fresnel + back * body * (1.0 - fresnel);
    }
  }
  gl_FragColor = finish(color, keepHue);
}`;

/** A triangle over the whole view for the backdrop. */
const BACKDROP_VERTEX = `
attribute vec2 aCorner;
varying vec2 vAt;
void main() {
  vAt = aCorner;
  gl_Position = vec4(aCorner, 0.999, 1.0);
}`;

/** A seamless sweep over the theme's canvas colour: lighter behind the piece and above it, falling off to the corners. */
const BACKDROP_FRAGMENT = `
precision mediump float;
uniform vec3 uBase;
uniform vec2 uAspect;
varying vec2 vAt;
void main() {
  vec2 p = vAt * uAspect;
  float glow = exp(-dot(p - vec2(0.0, 0.15), p - vec2(0.0, 0.15)) * 0.9);
  float fall = smoothstep(-1.2, 1.0, vAt.y);
  vec3 c = uBase + vec3(0.075) * (glow - 0.3) + vec3(0.025) * (fall - 0.5);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const SHADOW_VERTEX = `
attribute vec3 aPosition;
attribute vec2 aAt;
uniform mat4 uViewProj;
varying vec2 vAt;
void main() {
  vAt = aAt;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

/** The contact shadow: a tight dark core where the piece meets the ground and a broad faint one around it. */
const SHADOW_FRAGMENT = `
precision mediump float;
uniform float uStrength;
varying vec2 vAt;
void main() {
  vec2 core = vAt * vec2(3.2, 2.0);
  vec2 wide = vAt * vec2(1.5, 1.5);
  float a = 0.55 * exp(-dot(core, core)) + 0.3 * exp(-dot(wide, wide));
  a *= 1.0 - smoothstep(0.85, 1.0, max(abs(vAt.x), abs(vAt.y)));
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * uStrength);
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
  /** Hand over what is drawn. `shadow` is the realistic contact shadow's quad (`contactShadow`), null for none. */
  upload: (buffers: Buffers | null, ground: Ground | null, edges: EdgeBatch | null, shadow?: Float32Array | null) => void;
  /** Draw one frame as `plan`'s passes on a store `width` by `height` device pixels. */
  draw: (frame: Frame, plan: readonly DrawPass[], width: number, height: number) => void;
  dispose: () => void;
  /** Whether the realistic program runs here, and how: "full", "no derivatives", or why it does not (then a realistic pass is drawn shaded). */
  realistic: string;
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
  // The realistic programs are wanted, not needed: where they cannot be made, a realistic pass is drawn shaded.
  const derivatives = gl.getExtension("OES_standard_derivatives") !== null;
  let realistic = "full";
  let real: WebGLProgram | null = null;
  let backdrop: WebGLProgram | null = null;
  let shade: WebGLProgram | null = null;
  {
    let made = link(REAL_VERTEX, REAL_FRAGMENT(derivatives));
    if (typeof made === "string" && derivatives) made = link(REAL_VERTEX, REAL_FRAGMENT(false));
    const back = link(BACKDROP_VERTEX, BACKDROP_FRAGMENT);
    const sh = link(SHADOW_VERTEX, SHADOW_FRAGMENT);
    if (typeof made === "string" || typeof back === "string" || typeof sh === "string") {
      realistic = [made, back, sh].find((x): x is string => typeof x === "string") ?? "unavailable";
      for (const p of [made, back, sh]) if (typeof p !== "string") gl.deleteProgram(p);
    } else {
      real = made;
      backdrop = back;
      shade = sh;
      if (!derivatives) realistic = "no derivatives";
    }
  }
  const realMetalBuffer = gl.createBuffer();
  const realStoneBuffer = gl.createBuffer();
  const backdropBuffer = gl.createBuffer();
  const shadowBuffer = gl.createBuffer();
  let held: Buffers | null = null;
  /** The realistic batches are made the first time a realistic pass draws, from `held`. */
  let realReady = false;
  let shadowCount = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, backdropBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const realAt =
    real === null
      ? null
      : {
          position: gl.getAttribLocation(real, "aPosition"),
          normal: gl.getAttribLocation(real, "aNormal"),
          material: gl.getAttribLocation(real, "aMaterial"),
          dispersion: gl.getAttribLocation(real, "aDispersion"),
        };
  const studioU = (program: WebGLProgram) => ({
    viewProj: gl.getUniformLocation(program, "uViewProj"),
    eye: gl.getUniformLocation(program, "uEye"),
    stone: gl.getUniformLocation(program, "uStone"),
    exposure: gl.getUniformLocation(program, "uExposure"),
    boxDir: gl.getUniformLocation(program, "uBoxDir"),
    boxAcross: gl.getUniformLocation(program, "uBoxAcross"),
    boxShape: gl.getUniformLocation(program, "uBoxShape"),
    boxGrad: gl.getUniformLocation(program, "uBoxGrad"),
    sweep: gl.getUniformLocation(program, "uSweep"),
    hueWhite: gl.getUniformLocation(program, "uHueWhite"),
    deepPower: gl.getUniformLocation(program, "uDeepPower"),
    right: gl.getUniformLocation(program, "uRight"),
    up: gl.getUniformLocation(program, "uUp"),
    back: gl.getUniformLocation(program, "uBack"),
  });
  const realU = real === null ? null : studioU(real);
  const boxDir = new Float32Array(STUDIO.flatMap((b) => [...b.dir]));
  const boxAcross = new Float32Array(STUDIO.flatMap((b) => [...b.across]));
  const boxShape = new Float32Array(STUDIO.flatMap((b) => [b.half[0], b.half[1], b.intensity, b.edge]));
  const boxGrad = new Float32Array(STUDIO.map((b) => b.grad));
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

  const drawReal = (frame: Frame, viewProj: Float32Array, pass: Extract<DrawPass, { kind: "faces" }>, program: WebGLProgram, at: NonNullable<typeof realAt>, u: NonNullable<typeof realU>): void => {
    const stone = pass.what === "stone";
    if (!realReady) {
      realReady = true;
      fill(realMetalBuffer, held === null ? null : realBatch("metal", held.metal.data, held.metal.vertices, VERTEX_FLOATS));
      fill(realStoneBuffer, held === null ? null : realBatch("stone", held.stone.data, held.stone.vertices, VERTEX_FLOATS));
    }
    const count = stone ? stoneCount : metalCount;
    if (count === 0) return;
    gl.useProgram(program);
    gl.uniformMatrix4fv(u.viewProj, false, viewProj);
    gl.uniform3f(u.eye, frame.eye[0], frame.eye[1], frame.eye[2]);
    gl.uniform1f(u.stone, stone ? 1 : 0);
    gl.uniform1f(u.exposure, EXPOSURE);
    gl.uniform3fv(u.boxDir, boxDir);
    gl.uniform3fv(u.boxAcross, boxAcross);
    gl.uniform4fv(u.boxShape, boxShape);
    gl.uniform1fv(u.boxGrad, boxGrad);
    gl.uniform4f(u.sweep, SWEEP.floor, SWEEP.horizon, SWEEP.top, SWEEP.eye);
    gl.uniform1f(u.hueWhite, HUE_KEEP.white);
    gl.uniform1f(u.deepPower, DEEP_POWER);
    gl.uniform3f(u.right, frame.right[0], frame.right[1], frame.right[2]);
    gl.uniform3f(u.up, frame.up[0], frame.up[1], frame.up[2]);
    gl.uniform3f(u.back, frame.back[0], frame.back[1], frame.back[2]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    blend(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, stone ? realStoneBuffer : realMetalBuffer);
    point(at.position, 3, REAL_FLOATS, 0);
    point(at.normal, 3, REAL_FLOATS, 3);
    point(at.material, 4, REAL_FLOATS, 6);
    point(at.dispersion, 1, REAL_FLOATS, 10);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    unpoint(at.position, at.normal, at.material, at.dispersion);
  };

  /** The realistic backdrop (over a background, not over a cut-out) and the contact shadow. Neither writes depth. */
  const drawStudio = (frame: Frame, viewProj: Float32Array, width: number, height: number): void => {
    if (backdrop === null || shade === null) return;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    if (frame.background !== null) {
      blend(false);
      gl.useProgram(backdrop);
      const back = frame.background;
      gl.uniform3f(gl.getUniformLocation(backdrop, "uBase"), back[0], back[1], back[2]);
      gl.uniform2f(gl.getUniformLocation(backdrop, "uAspect"), Math.min(2, width / height), 1);
      const corner = gl.getAttribLocation(backdrop, "aCorner");
      gl.bindBuffer(gl.ARRAY_BUFFER, backdropBuffer);
      point(corner, 2, 2, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      unpoint(corner);
    }
    if (shadowCount > 0) {
      blend(true);
      gl.useProgram(shade);
      gl.uniformMatrix4fv(gl.getUniformLocation(shade, "uViewProj"), false, viewProj);
      // A light backdrop takes a darker shadow than a dark one, where it would be lost.
      const base = frame.background === null ? 0.6 : (frame.background[0] + frame.background[1] + frame.background[2]) / 3;
      gl.uniform1f(gl.getUniformLocation(shade, "uStrength"), 0.5 + 0.4 * base);
      const position = gl.getAttribLocation(shade, "aPosition");
      const at = gl.getAttribLocation(shade, "aAt");
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer);
      point(position, 3, SHADOW_FLOATS, 0);
      point(at, 2, SHADOW_FLOATS, 3);
      gl.drawArrays(gl.TRIANGLES, 0, shadowCount);
      unpoint(position, at);
    }
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  };

  const drawFaces = (frame: Frame, viewProj: Float32Array, pass: Extract<DrawPass, { kind: "faces" }>): void => {
    if (pass.real && real !== null && realAt !== null && realU !== null) {
      drawReal(frame, viewProj, pass, real, realAt, realU);
      return;
    }
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
    realistic,
    upload(buffers, ground, edges, shadow = null) {
      held = buffers;
      realReady = false;
      fill(shadowBuffer, shadow);
      shadowCount = shadow === null ? 0 : Math.floor(shadow.length / SHADOW_FLOATS);
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
        else if (pass.kind === "studio") drawStudio(frame, viewProj, width, height);
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
      for (const b of [realMetalBuffer, realStoneBuffer, backdropBuffer, shadowBuffer]) gl.deleteBuffer(b);
      for (const p of [real, backdrop, shade]) if (p !== null) gl.deleteProgram(p);
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
  /** How it is shown. Defaults to `realistic`. */
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
  const mode = options.mode ?? "realistic";
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
  // Drawn larger and scaled down: the supersampling smooths the facets' edges and the highlights.
  const store = supersampledSize(setup.width, setup.height, STILL_MAX);
  const canvas = document.createElement("canvas");
  canvas.width = store.width;
  canvas.height = store.height;
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
    renderer.upload(buildBuffers(mesh), null, setup.edges ? featureEdges(mesh) : null, contactShadow(mesh.extent));
    renderer.draw(setup.frame, setup.plan, store.width, store.height);
    if (gl.isContextLost()) throw new Error("the still could not be drawn: the graphics context was lost");
    let out: HTMLCanvasElement = canvas;
    if (store.factor > 1) {
      const small = document.createElement("canvas");
      small.width = setup.width;
      small.height = setup.height;
      const context = small.getContext("2d");
      if (context !== null) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(canvas, 0, 0, setup.width, setup.height);
        out = small;
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
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
