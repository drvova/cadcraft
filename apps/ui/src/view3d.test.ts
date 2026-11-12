/**
 * The 3D view's pure parts: the matrices, the orbit camera and its clamps, the checked reading of
 * the mesh reply, and the vertex buffers. The picture itself is proved by the screenshot; what is
 * asserted here is that nothing a reply or a pointer can send makes a camera that is not a number,
 * a buffer larger than the contract, or a mesh read out of range.
 */

import { describe, expect, test } from "bun:test";
import { MockFacade } from "./mock";
import {
  buildBuffers,
  cameraBasis,
  clampCamera,
  clipPlanes,
  fitCamera,
  fitDistance,
  formatSize,
  formatTriangles,
  FOV_Y,
  GRID_FLOATS,
  groundGrid,
  isUnknownCommand,
  mat4Multiply,
  MAT4_IDENTITY,
  mat4Perspective,
  MAX_TRIANGLES,
  niceStep,
  normalize,
  orbitCamera,
  panCamera,
  parseMeshReply,
  parseStlReply,
  projectionMatrix,
  sceneOf,
  standardCamera,
  standardViewOf,
  transformPoint,
  VERTEX_FLOATS,
  viewMatrix,
  zoomCamera,
  type Camera,
  type PieceMesh,
  type Scene,
  type Vec3,
} from "./view3d";

/** A unit cube about the origin, wound counter-clockwise seen from outside (test data only). */
function cube(): { positions: number[]; indices: number[] } {
  const positions = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const indices = [4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 5, 1, 2, 5, 2, 6, 0, 4, 7, 0, 7, 3, 7, 6, 2, 7, 2, 3, 0, 1, 5, 0, 5, 4];
  return { positions, indices };
}

/** A torus in the XY plane about Z with shared vertices (test data only). */
function torus(major: number, minor: number, around: number, across: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < around; i += 1) {
    const u = (2 * Math.PI * i) / around;
    for (let j = 0; j < across; j += 1) {
      const v = (2 * Math.PI * j) / across;
      const r = major + minor * Math.cos(v);
      positions.push(r * Math.cos(u), r * Math.sin(u), minor * Math.sin(v));
      const a = i * across + j;
      const b = ((i + 1) % around) * across + j;
      const c = ((i + 1) % around) * across + ((j + 1) % across);
      const d = i * across + ((j + 1) % across);
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices };
}

const reply = (meshes: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  meshes,
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  triangles: 12,
  ...extra,
});

const metalCube = (): Record<string, unknown> => ({ part: "metal", name: "band", color: [200, 160, 60], ...cube() });

function parsed(result: unknown): PieceMesh {
  const out = parseMeshReply(result);
  if (!out.ok) throw new Error(out.error);
  return out.mesh;
}

const SCENE: Scene = { center: [0, 0, 0], radius: 10 };
const finiteCamera = (c: Camera): boolean => [...c.target, c.yaw, c.pitch, c.distance].every(Number.isFinite);
const near = (a: Vec3, b: Vec3, eps = 1e-9): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;

describe("matrices", () => {
  test("multiplying by the identity changes nothing", () => {
    const p = mat4Perspective(FOV_Y, 1.5, 1, 100);
    expect(mat4Multiply(p, MAT4_IDENTITY)).toEqual([...p]);
    expect(mat4Multiply(MAT4_IDENTITY, p)).toEqual([...p]);
  });

  test("the perspective maps the near plane to -1 and the far plane to 1", () => {
    const p = mat4Perspective(FOV_Y, 1, 2, 50);
    expect(transformPoint(p, [0, 0, -2])[2]).toBeCloseTo(-1, 9);
    expect(transformPoint(p, [0, 0, -50])[2]).toBeCloseTo(1, 9);
  });

  test("hostile perspective inputs still make a finite matrix", () => {
    for (const args of [
      [NaN, NaN, NaN, NaN],
      [0, 0, 0, 0],
      [Math.PI, -3, 5, 1],
      [Infinity, Infinity, -1, Infinity],
    ] as const) {
      expect(mat4Perspective(args[0], args[1], args[2], args[3]).every(Number.isFinite)).toBe(true);
    }
  });

  test("normalize falls back when there is no length", () => {
    expect(normalize([0, 0, 0], [0, 1, 0])).toEqual([0, 1, 0]);
    expect(normalize([NaN, 0, 0])).toEqual([0, 0, 1]);
    expect(normalize([3, 0, 4])).toEqual([0.6, 0, 0.8]);
  });
});

describe("the orbit camera", () => {
  test("the standard views look down the axes the contract names", () => {
    const aspect = 1.6;
    const front = cameraBasis(standardCamera("front", SCENE, aspect));
    expect(near(front.forward, [0, 0, -1])).toBe(true);
    expect(near(front.up, [0, 1, 0])).toBe(true);
    expect(near(front.right, [1, 0, 0])).toBe(true);
    const top = cameraBasis(standardCamera("top", SCENE, aspect));
    expect(near(top.forward, [0, -1, 0])).toBe(true);
    expect(near(top.right, [1, 0, 0])).toBe(true);
    const side = cameraBasis(standardCamera("side", SCENE, aspect));
    expect(near(side.forward, [-1, 0, 0])).toBe(true);
    expect(near(side.up, [0, 1, 0])).toBe(true);
  });

  test("the basis is orthonormal and right-handed at every pitch, the poles included", () => {
    for (const pitch of [-Math.PI / 2, -1, 0, 0.7, Math.PI / 2]) {
      for (const yaw of [-3, 0, 1, 2.5]) {
        const b = cameraBasis({ target: [1, 2, 3], yaw, pitch, distance: 5 });
        const cross: Vec3 = [b.forward[1] * b.up[2] - b.forward[2] * b.up[1], b.forward[2] * b.up[0] - b.forward[0] * b.up[2], b.forward[0] * b.up[1] - b.forward[1] * b.up[0]];
        expect(near(cross, b.right, 1e-9)).toBe(true);
        expect(Math.hypot(...b.up)).toBeCloseTo(1, 9);
        expect(Math.hypot(...b.right)).toBeCloseTo(1, 9);
      }
    }
  });

  test("the view matrix puts the look-at point straight ahead at the camera's distance", () => {
    const camera: Camera = { target: [2, -1, 4], yaw: 0.6, pitch: 0.3, distance: 12 };
    const seen = transformPoint(viewMatrix(camera), camera.target);
    expect(near(seen, [0, 0, -12], 1e-9)).toBe(true);
  });

  test("a fitted view holds the whole sphere at any aspect", () => {
    for (const aspect of [0.4, 1, 2.5]) {
      const camera = standardCamera("three-quarter", SCENE, aspect);
      const m = mat4Multiply(projectionMatrix(camera, SCENE, aspect), viewMatrix(camera));
      const basis = cameraBasis(camera);
      for (const direction of [basis.right, basis.up, [-basis.right[0], -basis.right[1], -basis.right[2]] as Vec3, [-basis.up[0], -basis.up[1], -basis.up[2]] as Vec3]) {
        const edge = transformPoint(m, [direction[0] * SCENE.radius, direction[1] * SCENE.radius, direction[2] * SCENE.radius]);
        expect(Math.abs(edge[0])).toBeLessThan(1);
        expect(Math.abs(edge[1])).toBeLessThan(1);
      }
      expect(camera.distance).toBeCloseTo(fitDistance(SCENE, aspect), 9);
    }
  });

  test("the fit is known as its standard view, and an orbit leaves it", () => {
    const camera = standardCamera("top", SCENE, 1);
    expect(standardViewOf(camera)).toBe("top");
    expect(standardViewOf(orbitCamera(camera, SCENE, 0.1, 0))).toBeNull();
    expect(standardViewOf(standardCamera("three-quarter", SCENE, 1))).toBe("three-quarter");
  });

  test("pitch stops at the poles and yaw wraps: the picture never turns over", () => {
    let camera = standardCamera("front", SCENE, 1);
    for (let i = 0; i < 200; i += 1) camera = orbitCamera(camera, SCENE, 0.5, 0.3);
    expect(camera.pitch).toBe(Math.PI / 2);
    expect(Math.abs(camera.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(cameraBasis(camera).up[1]).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 200; i += 1) camera = orbitCamera(camera, SCENE, -0.5, -0.3);
    expect(camera.pitch).toBe(-Math.PI / 2);
    expect(cameraBasis(camera).up[1]).toBeGreaterThanOrEqual(0);
  });

  test("zoom is clamped both ways and keeps the point under the pointer", () => {
    const aspect = 1.5;
    const start = standardCamera("front", SCENE, aspect);
    const project = (camera: Camera, p: Vec3): Vec3 => transformPoint(mat4Multiply(projectionMatrix(camera, SCENE, aspect), viewMatrix(camera)), p);
    // The point of the look-at plane under ndc (0.4, -0.2) before the zoom is under it after.
    const basis = cameraBasis(start);
    const half = start.distance * Math.tan(FOV_Y / 2);
    const under: Vec3 = [basis.right[0] * 0.4 * half * aspect + basis.up[0] * -0.2 * half, basis.right[1] * 0.4 * half * aspect + basis.up[1] * -0.2 * half, 0];
    const zoomed = zoomCamera(start, SCENE, 0.6, 0.4, -0.2, aspect);
    const before = project(start, under);
    const after = project(zoomed, under);
    expect(before[0]).toBeCloseTo(0.4, 6);
    expect(after[0]).toBeCloseTo(0.4, 6);
    expect(after[1]).toBeCloseTo(-0.2, 6);
    let camera = start;
    for (let i = 0; i < 400; i += 1) camera = zoomCamera(camera, SCENE, 0.5, 0, 0, aspect);
    expect(camera.distance).toBeGreaterThan(0);
    expect(camera.distance).toBeCloseTo(SCENE.radius * 0.12, 9);
    for (let i = 0; i < 400; i += 1) camera = zoomCamera(camera, SCENE, 3, 0.9, 0.9, aspect);
    expect(camera.distance).toBeCloseTo(SCENE.radius * 30, 9);
    expect(finiteCamera(camera)).toBe(true);
  });

  test("a pan carries the look-at point across the view and stops near the piece", () => {
    const start = standardCamera("front", SCENE, 1);
    const moved = panCamera(start, SCENE, 100, 0, 800);
    expect(moved.target[0]).toBeLessThan(0);
    expect(moved.target[1]).toBeCloseTo(0, 9);
    let camera = start;
    for (let i = 0; i < 500; i += 1) camera = panCamera(camera, SCENE, 300, -200, 800);
    expect(Math.hypot(...camera.target)).toBeCloseTo(SCENE.radius * 2, 6);
  });

  test("hostile deltas change nothing and never make a camera that is not a number", () => {
    const start = standardCamera("three-quarter", SCENE, 1.2);
    const bad = [NaN, Infinity, -Infinity];
    for (const v of bad) {
      expect(orbitCamera(start, SCENE, v, 0)).toEqual(start);
      expect(orbitCamera(start, SCENE, 0, v)).toEqual(start);
      expect(panCamera(start, SCENE, v, 0, 600)).toEqual(start);
      expect(panCamera(start, SCENE, 1, 1, v)).toEqual(start);
      expect(zoomCamera(start, SCENE, v, 0, 0, 1)).toEqual(start);
      expect(finiteCamera(zoomCamera(start, SCENE, 0.5, v, v, v))).toBe(true);
    }
    expect(panCamera(start, SCENE, 5, 5, 0)).toEqual(start);
    expect(zoomCamera(start, SCENE, 0, 0, 0, 1)).toEqual(start);
    expect(zoomCamera(start, SCENE, -2, 0, 0, 1)).toEqual(start);
    const broken: Camera = { target: [NaN, 0, Infinity], yaw: NaN, pitch: Infinity, distance: -1 };
    expect(finiteCamera(clampCamera(broken, SCENE))).toBe(true);
    expect(finiteCamera(clampCamera(broken, { center: [NaN, 0, 0], radius: NaN }))).toBe(true);
    expect(finiteCamera(fitCamera(broken, sceneOf({ min: [NaN, 0, 0], max: [1, 1, 1] }), NaN))).toBe(true);
  });

  test("the clip planes hold the piece wherever the eye stands, and near stays positive", () => {
    let camera = standardCamera("three-quarter", SCENE, 1);
    for (const factor of [1, 0.01, 1000]) {
      camera = zoomCamera(camera, SCENE, factor, 0.5, 0.5, 1);
      const planes = clipPlanes(camera, SCENE);
      expect(planes.near).toBeGreaterThanOrEqual(SCENE.radius * 0.01);
      expect(planes.far).toBeGreaterThan(planes.near);
      expect(planes.far / planes.near).toBeLessThan(5000);
      const depth = -transformPoint(viewMatrix(camera), SCENE.center)[2];
      expect(planes.far).toBeGreaterThanOrEqual(depth + SCENE.radius);
    }
  });

  test("a box with no size still makes a scene", () => {
    const scene = sceneOf({ min: [3, 3, 3], max: [3, 3, 3] });
    expect(scene.radius).toBeGreaterThan(0);
    expect(scene.center).toEqual([3, 3, 3]);
  });
});

describe("reading the mesh reply", () => {
  test("a well-formed reply is read, colours scaled to 0…1", () => {
    const mesh = parsed(reply([metalCube(), { part: "stone", name: "stone 1", color: [255, 300, -5], ...cube() }], { notes: ["draft quality", 7] }));
    expect(mesh.triangles).toBe(24);
    expect(mesh.parts.map((p) => p.part)).toEqual(["metal", "stone"]);
    expect(mesh.parts[0]?.color[0]).toBeCloseTo(200 / 255, 9);
    expect(mesh.parts[1]?.color).toEqual([1, 1, 0]);
    expect(mesh.extent).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
    expect(mesh.notes).toEqual(["draft quality"]);
  });

  test("everything out of the contract is refused with a reason", () => {
    const { positions, indices } = cube();
    const broken: unknown[] = [
      null,
      [],
      {},
      { meshes: "x", bounds: {} },
      reply([null]),
      reply([{ ...metalCube(), part: "wood" }]),
      reply([{ ...metalCube(), color: [1, 2] }]),
      reply([{ ...metalCube(), color: [1, 2, "3"] }]),
      reply([{ ...metalCube(), positions: positions.slice(0, -1) }]),
      reply([{ ...metalCube(), indices: indices.slice(0, -1) }]),
      reply([{ ...metalCube(), positions: [...positions.slice(0, -1), NaN] }]),
      reply([{ ...metalCube(), positions: [...positions.slice(0, -1), 1e300] }]),
      reply([{ ...metalCube(), positions: [...positions.slice(0, -1), "1"] }]),
      reply([{ ...metalCube(), indices: [...indices.slice(0, -1), 8] }]),
      reply([{ ...metalCube(), indices: [...indices.slice(0, -1), -1] }]),
      reply([{ ...metalCube(), indices: [...indices.slice(0, -1), 1.5] }]),
      reply([{ ...metalCube(), positions: 5 }]),
      reply([{ ...metalCube(), positions: new Array<number>(300).fill(0), indices: [0, 1, 2] }]),
      reply([{ ...metalCube(), indices: [] }]),
      reply([]),
      reply([metalCube()], { bounds: null }),
      reply([metalCube()], { bounds: { min: [0, 0, 0], max: [1, 1] } }),
      reply([metalCube()], { bounds: { min: [2, 0, 0], max: [1, 1, 1] } }),
      reply([metalCube()], { bounds: { min: [0, 0, 0], max: [1, 1, Infinity] } }),
      reply([metalCube()], { bounds: { min: [0, 0, 0], max: [1, 1, 1e9] } }),
    ];
    for (const value of broken) {
      const out = parseMeshReply(value);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toStartWith("the 3D mesh could not be read: ");
    }
  });

  test("a reply over the contract's triangles is refused, not cut", () => {
    const indices = new Array<number>((MAX_TRIANGLES + 1) * 3).fill(0);
    const out = parseMeshReply(reply([{ part: "metal", name: "big", color: [1, 1, 1], positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices }]));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("150,000");
    // Split across meshes it is refused all the same.
    const half = new Array<number>((MAX_TRIANGLES / 2 + 3) * 3).fill(0);
    const part = { part: "metal", name: "half", color: [1, 1, 1], positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: half };
    expect(parseMeshReply(reply([part, part])).ok).toBe(false);
  });

  test("the readout's words", () => {
    expect(formatSize({ min: [-10.72, -11.9, -2], max: [10.72, 11.9, 2] })).toBe("21.4 × 23.8 × 4.0 mm");
    expect(formatTriangles(12480)).toBe("12,480 triangles");
    expect(formatTriangles(1)).toBe("1 triangle");
  });
});

describe("the vertex buffers", () => {
  test("a cube is twelve flat triangles whose normals point out along the axes", () => {
    const buffers = buildBuffers(parsed(reply([metalCube()])));
    expect(buffers.metal.vertices).toBe(36);
    expect(buffers.stone.vertices).toBe(0);
    expect(buffers.metal.data.length).toBe(36 * VERTEX_FLOATS);
    for (let v = 0; v < 36; v += 1) {
      const at = v * VERTEX_FLOATS;
      const p: Vec3 = [buffers.metal.data[at] ?? 0, buffers.metal.data[at + 1] ?? 0, buffers.metal.data[at + 2] ?? 0];
      const n: Vec3 = [buffers.metal.data[at + 3] ?? 0, buffers.metal.data[at + 4] ?? 0, buffers.metal.data[at + 5] ?? 0];
      // A cube's edge is sharp, so each corner keeps its face's normal: one axis, pointing out.
      expect(n.map(Math.abs).sort()).toEqual([0, 0, 1]);
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeCloseTo(1, 6);
      expect(buffers.metal.data[at + 6]).toBeCloseTo(200 / 255, 6);
    }
  });

  test("metal is smooth across a shallow bend: a torus's normals point away from its tube's centre line", () => {
    const major = 9;
    const minor = 1.5;
    const mesh = parsed({ meshes: [{ part: "metal", name: "band", color: [1, 1, 1], ...torus(major, minor, 48, 24) }], bounds: { min: [-10.5, -10.5, -1.5], max: [10.5, 10.5, 1.5] }, triangles: 0 });
    const { data, vertices } = buildBuffers(mesh).metal;
    expect(vertices).toBe(48 * 24 * 2 * 3);
    let worst = 1;
    for (let v = 0; v < vertices; v += 1) {
      const at = v * VERTEX_FLOATS;
      const [x, y, z] = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
      const ring = Math.hypot(x, y);
      const out = normalize([x - (x / ring) * major, y - (y / ring) * major, z]);
      const n: Vec3 = [data[at + 3] ?? 0, data[at + 4] ?? 0, data[at + 5] ?? 0];
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      worst = Math.min(worst, n[0] * out[0] + n[1] * out[1] + n[2] * out[2]);
    }
    // Smooth: every corner's normal is within a few degrees of the true one (flat would be off by 7.5).
    expect(worst).toBeGreaterThan(Math.cos((4 * Math.PI) / 180));
  });

  test("a stone is lit flat, and a triangle with no area is left out", () => {
    const stone = { part: "stone", name: "s", color: [9, 9, 9], ...torus(9, 1.5, 12, 6) };
    const sliver = { part: "metal", name: "sliver", color: [9, 9, 9], positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0], indices: [0, 1, 2, 0, 1, 3] };
    const buffers = buildBuffers(parsed(reply([stone, sliver])));
    expect(buffers.metal.vertices).toBe(3);
    expect(buffers.metal.data.length).toBe(3 * VERTEX_FLOATS);
    const { data, vertices } = buffers.stone;
    for (let t = 0; t < vertices / 3; t += 1) {
      const n = (corner: number): number[] => Array.from(data.subarray((t * 3 + corner) * VERTEX_FLOATS + 3, (t * 3 + corner) * VERTEX_FLOATS + 6));
      expect(n(1)).toEqual(n(0));
      expect(n(2)).toEqual(n(0));
    }
    expect(Array.from(data).every(Number.isFinite)).toBe(true);
  });

  test("the buffers never hold more than the contract's triangles, whatever is passed", () => {
    const indices = new Uint32Array((MAX_TRIANGLES + 500) * 3);
    for (let i = 0; i < indices.length; i += 1) indices[i] = i % 3;
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const mesh: PieceMesh = {
      parts: [
        { part: "stone", name: "a", color: [1, 1, 1], positions, indices },
        { part: "metal", name: "b", color: [1, 1, 1], positions, indices: indices.subarray(0, 300) },
      ],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      extent: { min: [0, 0, 0], max: [1, 1, 0] },
      triangles: MAX_TRIANGLES + 600,
      notes: [],
    };
    const buffers = buildBuffers(mesh);
    expect((buffers.metal.vertices + buffers.stone.vertices) / 3).toBeLessThanOrEqual(MAX_TRIANGLES);
    expect(buffers.metal.vertices).toBe(300);
  });
});

describe("the ground grid", () => {
  test("round steps", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(2.6)).toBe(2);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(80)).toBe(100);
    expect(niceStep(NaN)).toBe(1);
    expect(niceStep(-4)).toBe(1);
  });

  test("the grid lies on the piece's lowest plane and fades to nothing at its edge", () => {
    const grid = groundGrid({ min: [-10, -11, -2], max: [10, 12, 2] });
    expect(grid.vertices).toBeGreaterThan(0);
    expect(grid.vertices % 2).toBe(0);
    expect(grid.data.length).toBe(grid.vertices * GRID_FLOATS);
    let strongest = 0;
    for (let v = 0; v < grid.vertices; v += 1) {
      expect(grid.data[v * GRID_FLOATS + 1]).toBe(-11);
      const alpha = grid.data[v * GRID_FLOATS + 3] ?? -1;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      strongest = Math.max(strongest, alpha);
    }
    expect(strongest).toBe(1);
    expect(Array.from(groundGrid({ min: [NaN, 0, 0], max: [0, 0, 0] }).data).every(Number.isFinite)).toBe(true);
  });
});

describe("the STL download and the missing command", () => {
  test("the file's bytes and a safe name ending in .stl", () => {
    const out = parseStlReply({ format: "stl-binary", base64: btoa("solid"), bytes: 5, triangles: 0, name: "../my ring.STL" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.name).toBe("_my ring.stl");
    expect(Array.from(out.bytes)).toEqual([115, 111, 108, 105, 100]);
    const unnamed = parseStlReply({ base64: btoa("x") });
    expect(unnamed.ok && unnamed.name).toBe("piece.stl");
    const other = parseStlReply({ base64: btoa("x"), name: "band.dxf" });
    expect(other.ok && other.name).toBe("band.dxf.stl");
  });

  test("a reply with no file is refused", () => {
    for (const value of [null, {}, { base64: "" }, { base64: 5 }, { base64: "***" }]) expect(parseStlReply(value).ok).toBe(false);
  });

  test("the engine's unknown-command refusal is told from any other", () => {
    expect(isUnknownCommand("unknown command `piecemesh`")).toBe(true);
    expect(isUnknownCommand("piecemesh: the drawing has no piece")).toBe(false);
  });
});

describe("the mock's stand-in solid", () => {
  const run = (mock: MockFacade, command: string, params: unknown): { ok: boolean; result?: unknown; error?: string } => JSON.parse(mock.execute(command, JSON.stringify(params))) as { ok: boolean; result?: unknown; error?: string };

  test("without a piece it refuses; with one it is a mesh the viewport reads, wound outward", () => {
    const mock = new MockFacade();
    expect(run(mock, "piecemesh", { quality: "draft" }).ok).toBe(false);
    expect(run(mock, "stlout", {}).ok).toBe(false);
    expect(run(mock, "piece", { kind: "solitaire" }).ok).toBe(true);
    const draft = parsed(run(mock, "piecemesh", { quality: "draft" }).result);
    const fine = parsed(run(mock, "piecemesh", { quality: "fine" }).result);
    expect(fine.triangles).toBeGreaterThan(draft.triangles);
    expect(draft.parts.map((p) => p.part)).toEqual(["metal", "stone"]);
    // Counter-clockwise seen from outside: every stone facet's normal points away from the stone's middle.
    const stone = buildBuffers(draft).stone;
    const middle = [0, 0, 0];
    for (let v = 0; v < stone.vertices; v += 1) for (let k = 0; k < 3; k += 1) middle[k] = (middle[k] ?? 0) + (stone.data[v * VERTEX_FLOATS + k] ?? 0) / stone.vertices;
    for (let v = 0; v < stone.vertices; v += 1) {
      const at = v * VERTEX_FLOATS;
      let out = 0;
      for (let k = 0; k < 3; k += 1) out += ((stone.data[at + k] ?? 0) - (middle[k] ?? 0)) * (stone.data[at + 3 + k] ?? 0);
      expect(out).toBeGreaterThan(0);
    }
    // And the band's point away from the finger's axis on its outer side.
    const metal = buildBuffers(draft).metal;
    for (let v = 0; v < metal.vertices; v += 1) {
      const at = v * VERTEX_FLOATS;
      const [x, y] = [metal.data[at] ?? 0, metal.data[at + 1] ?? 0];
      if (Math.hypot(x, y) > 9.9) expect(x * (metal.data[at + 3] ?? 0) + y * (metal.data[at + 4] ?? 0)).toBeGreaterThan(0);
    }
  });

  test("its STL is a binary STL of the size its header says", () => {
    const mock = new MockFacade();
    run(mock, "piece", { kind: "band" });
    const file = parseStlReply(run(mock, "stlout", { stones: true, quality: "fine" }).result);
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    expect(file.name).toBe("band-mock.stl");
    const count = new DataView(file.bytes.buffer).getUint32(80, true);
    expect(file.bytes.length).toBe(84 + count * 50);
    expect(count).toBeGreaterThan(0);
  });
});
