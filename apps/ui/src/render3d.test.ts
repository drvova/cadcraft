/**
 * The part of the still renderer that needs no GPU: what a still is drawn with (`stillSetup`).
 * The drawing itself needs a WebGL context and is verified in the browser.
 */

import { describe, expect, test } from "bun:test";
import { renderPieceStill, STILL_MAX, STILL_MIN, stillSetup } from "./render3d";
import { axisEndOf, cameraBasis, drawPlan, fitDistance, parseMeshReply, type PieceMesh } from "./view3d";

function mesh(): PieceMesh {
  const positions = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const indices = [4, 5, 6, 4, 6, 7, 1, 0, 3, 1, 3, 2, 5, 1, 2, 5, 2, 6, 0, 4, 7, 0, 7, 3, 7, 6, 2, 7, 2, 3, 0, 1, 5, 0, 5, 4];
  const out = parseMeshReply({ meshes: [{ part: "metal", name: "band", color: [200, 160, 60], positions, indices }], bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, triangles: 12 });
  if (!out.ok) throw new Error(out.error);
  return out.mesh;
}

describe("a still's setup", () => {
  test("each view stands the eye where the stage's own view does, framed to the picture's shape", () => {
    const front = stillSetup(mesh(), { view: "front", width: 800, height: 400 });
    expect(axisEndOf(front.camera)?.id).toBe("+z");
    expect(front.camera.distance).toBeCloseTo(fitDistance(front.scene, 2), 9);
    expect(front.frame.eye).toEqual(cameraBasis(front.camera).eye);
    expect(axisEndOf(stillSetup(mesh(), { view: "top", width: 400, height: 400 }).camera)?.id).toBe("+y");
    expect(axisEndOf(stillSetup(mesh(), { view: "side", width: 400, height: 400 }).camera)?.id).toBe("+x");
    expect(axisEndOf(stillSetup(mesh(), { view: "three-quarter", width: 400, height: 400 }).camera)).toBeNull();
    expect(front.frame.viewProj.every(Number.isFinite)).toBe(true);
  });

  test("it is the mode's own passes without the ground, realistic unless said, and wants edges only where the mode draws them", () => {
    const real = stillSetup(mesh(), { view: "front", width: 400, height: 400 });
    expect(real.plan).toEqual(drawPlan("realistic"));
    expect(real.edges).toBe(false);
    for (const mode of ["shaded", "wireframe", "ghosted", "xray"] as const) {
      const setup = stillSetup(mesh(), { view: "front", mode, width: 400, height: 400 });
      expect(setup.plan).toEqual(drawPlan(mode).filter((pass) => pass.kind !== "ground"));
      expect(setup.plan.some((pass) => pass.kind === "ground")).toBe(false);
      expect(setup.edges).toBe(mode === "wireframe" || mode === "xray");
    }
  });

  test("the background and the edge ink are the caller's, and nothing when not given", () => {
    const bare = stillSetup(mesh(), { view: "front", width: 400, height: 400 });
    expect(bare.frame.background).toBeNull();
    expect(bare.frame.edgeInk).toBeNull();
    const paper = stillSetup(mesh(), { view: "front", width: 400, height: 400, background: [1, 1, 1], edgeInk: [0.1, 0.1, 0.1] });
    expect(paper.frame.background).toEqual([1, 1, 1]);
    expect(paper.frame.edgeInk).toEqual([0.1, 0.1, 0.1]);
  });

  test("a size that is no size is brought inside the limits", () => {
    for (const [width, height] of [
      [NaN, Infinity],
      [0, -5],
      [1e9, 3.4],
    ] as const) {
      const setup = stillSetup(mesh(), { view: "front", width, height });
      for (const side of [setup.width, setup.height]) {
        expect(Number.isInteger(side)).toBe(true);
        expect(side).toBeGreaterThanOrEqual(STILL_MIN);
        expect(side).toBeLessThanOrEqual(STILL_MAX);
      }
      expect(setup.frame.viewProj.every(Number.isFinite)).toBe(true);
    }
  });

  test("where there is no WebGL the still is refused in words, and the one after it is still tried", async () => {
    const options = { view: "front", width: 64, height: 64 } as const;
    await expect(renderPieceStill(mesh(), options)).rejects.toThrow(/still (needs a browser|could not be drawn)/);
    await expect(renderPieceStill(mesh(), options)).rejects.toThrow(/still (needs a browser|could not be drawn)/);
  });
});
