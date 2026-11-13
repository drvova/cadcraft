/**
 * The realistic look's numbers, without a GPU: the material each engine colour is drawn as, the
 * studio's light, the tone curve, the supersampled size of a still and the contact shadow.
 */

import { describe, expect, test } from "bun:test";
import {
  acesFilm,
  boxSpread,
  channelIors,
  contactShadow,
  f0OfIor,
  fresnelSchlick,
  linearToSrgb,
  materialFloats,
  metalOf,
  METALS,
  REAL_FLOATS,
  realBatch,
  SHADOW_FLOATS,
  srgbToLinear,
  stoneOf,
  STONES,
  STUDIO,
  studioRadiance,
  supersampledSize,
  SWEEP,
} from "./materials";
import type { Vec3 } from "./view3d";

const rgb = (r: number, g: number, b: number): Vec3 => [r / 255, g / 255, b / 255];

describe("the materials", () => {
  test("each metal of the engine's palette is found by its colour", () => {
    expect(metalOf(rgb(240, 196, 92)).id).toBe("gold18");
    expect(metalOf(rgb(229, 228, 226)).id).toBe("platinum");
    expect(metalOf(rgb(224, 225, 229)).id).toBe("silver");
    expect(metalOf(rgb(200, 117, 51)).id).toBe("copper");
    for (const m of METALS) expect(metalOf(m.engine).id).toBe(m.id);
  });

  test("gold is warm, the white metals are near neutral, silver is the brightest and platinum darker than it", () => {
    const gold = metalOf(rgb(240, 196, 92)).f0;
    expect(gold[0]).toBeGreaterThan(gold[1]);
    expect(gold[1]).toBeGreaterThan(gold[2]);
    const pt = metalOf(rgb(229, 228, 226)).f0;
    const ag = metalOf(rgb(224, 225, 229)).f0;
    expect(Math.max(...pt) - Math.min(...pt)).toBeLessThan(0.1);
    expect(ag[1]).toBeGreaterThan(pt[1]);
    // A white metal must reflect enough to read as metal, not grey plastic.
    expect(Math.min(...pt)).toBeGreaterThan(0.6);
    for (const m of METALS) for (const c of m.f0) expect(c >= 0 && c <= 1).toBe(true);
  });

  test("an unknown or broken colour is still a metal, bright enough, and never NaN", () => {
    for (const c of [rgb(10, 10, 10), [NaN, Infinity, -1] as Vec3, rgb(183, 110, 121)]) {
      const m = metalOf(c);
      for (const v of m.f0) expect(Number.isFinite(v) && v >= 0 && v <= 1).toBe(true);
      expect(Math.max(...m.f0)).toBeGreaterThanOrEqual(0.55 - 1e-9);
    }
  });

  test("stones are found by colour; diamond has its index and fire, coloured stones their body colour", () => {
    const d = stoneOf(rgb(226, 238, 250));
    expect(d.id).toBe("diamond");
    expect(d.ior).toBeCloseTo(2.42, 2);
    expect(d.dispersion).toBeCloseTo(0.044, 3);
    expect(stoneOf(rgb(22, 62, 160)).id).toBe("sapphire");
    const ruby = stoneOf(rgb(176, 16, 44));
    expect(ruby.body[0]).toBeGreaterThan(ruby.body[1] * 10);
    expect(stoneOf(rgb(240, 234, 220)).opaque).toBe(true);
    for (const s of STONES) expect(stoneOf(s.engine).id).toBe(s.id);
    const odd = stoneOf([NaN, 2, -3] as unknown as Vec3);
    expect(odd.opaque).toBe(false);
    for (const v of odd.body) expect(Number.isFinite(v)).toBe(true);
  });

  test("red bends least and blue most, around the stone's own index", () => {
    const [r, g, b] = channelIors(stoneOf(rgb(226, 238, 250)));
    expect(r).toBeLessThan(g);
    expect(g).toBeCloseTo(2.42, 6);
    expect(b).toBeGreaterThan(g);
    expect(channelIors(stoneOf(rgb(240, 234, 220)))).toEqual([1.53, 1.53, 1.53]);
  });

  test("Fresnel: diamond reflects about 17% head on, everything reflects all at grazing", () => {
    expect(f0OfIor(2.42)).toBeCloseTo(0.172, 3);
    expect(f0OfIor(1.5)).toBeCloseTo(0.04, 3);
    expect(f0OfIor(NaN)).toBeCloseTo(0.04, 3);
    expect(fresnelSchlick(1, 0.04)).toBeCloseTo(0.04, 9);
    expect(fresnelSchlick(0, 0.04)).toBeCloseTo(1, 9);
    expect(fresnelSchlick(NaN, 0.2)).toBeCloseTo(0.2, 9);
  });

  test("a realistic batch carries each vertex's material, and a stone's dispersion", () => {
    const gold = rgb(240, 196, 92);
    const data = new Float32Array([1, 2, 3, 0, 0, 1, ...gold, 4, 5, 6, 0, 1, 0, ...gold]);
    const out = realBatch("metal", data, 2, 9);
    expect(out.length).toBe(2 * REAL_FLOATS);
    expect(Array.from(out.subarray(0, 6))).toEqual([1, 2, 3, 0, 0, 1]);
    const f0 = metalOf(gold).f0;
    expect(out[6]).toBeCloseTo(f0[0], 6);
    expect(out[9]).toBeCloseTo(metalOf(gold).roughness, 6);
    expect(out[10]).toBe(0);
    const diamond = rgb(226, 238, 250);
    const stone = realBatch("stone", new Float32Array([0, 0, 0, 0, 0, 1, ...diamond]), 1, 9);
    expect(stone[9]).toBeCloseTo(2.42, 5);
    expect(stone[10]).toBeGreaterThan(0.044);
    expect(materialFloats("stone", rgb(24, 24, 28))[3]).toBeLessThan(0);
    expect(materialFloats("metal", rgb(58, 140, 112))[3]).toBeLessThan(0);
    // A count past the data is held to it.
    expect(realBatch("metal", data, 1e9, 9).length).toBe(2 * REAL_FLOATS);
    expect(realBatch("metal", data, NaN, 9).length).toBe(0);
  });
});

describe("the studio", () => {
  test("a box seen square on is bright, a gap between boxes is the dim sweep", () => {
    for (const b of STUDIO) expect(studioRadiance(b.dir, 0)).toBeGreaterThan(b.intensity * 0.9);
    expect(studioRadiance([0, -1, 0], 0)).toBeCloseTo(SWEEP.floor, 6);
    // Straight back toward the viewer, between the boxes.
    expect(studioRadiance([0, 0, 1], 0)).toBeLessThan(0.5);
  });

  test("roughness widens and dims a box, keeping roughly its light", () => {
    for (const b of STUDIO) {
      expect(boxSpread(b, 0).edge).toBe(b.edge);
      expect(boxSpread(b, 0).gain).toBeCloseTo(1, 12);
      const rough = boxSpread(b, 0.6);
      expect(rough.edge).toBeGreaterThan(b.edge);
      expect(rough.gain).toBeLessThan(1);
      expect(studioRadiance(b.dir, 0.6)).toBeLessThan(studioRadiance(b.dir, 0));
    }
  });

  test("it is finite and never negative, whatever is asked", () => {
    for (const d of [[0, 0, 0], [NaN, 1, 0], [1e30, -1e30, 3], [0.3, 0.2, -0.9]] as Vec3[]) {
      for (const r of [0, 0.5, 1, NaN, -3, 9]) {
        const v = studioRadiance(d, r);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the picture", () => {
  test("the tone curve rises from black to white and never leaves 0…1", () => {
    expect(acesFilm(0)).toBe(0);
    expect(acesFilm(1e9)).toBe(1);
    expect(acesFilm(NaN)).toBe(0);
    expect(acesFilm(-4)).toBe(0);
    let last = -1;
    for (let x = 0; x < 20; x += 0.05) {
      const y = acesFilm(x);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
  });

  test("sRGB and linear are each other's inverse", () => {
    for (let c = 0; c <= 1; c += 0.1) expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 6);
    expect(srgbToLinear(NaN)).toBe(0);
  });

  test("a still is drawn at twice its size, but never past the ceiling", () => {
    expect(supersampledSize(300, 200, 4096)).toEqual({ width: 600, height: 400, factor: 2 });
    const big = supersampledSize(3000, 1000, 4096);
    expect(big.width).toBeLessThanOrEqual(4096);
    expect(big.factor).toBeGreaterThanOrEqual(1);
    expect(supersampledSize(NaN, -1, 4096)).toEqual({ width: 2, height: 2, factor: 2 });
  });

  test("the contact shadow is a quad on the ground under the piece, and none for a box that is no box", () => {
    const quad = contactShadow({ min: [-10, -2, -3], max: [10, 20, 3] });
    expect(quad?.length).toBe(6 * SHADOW_FLOATS);
    for (let i = 0; i < 6; i += 1) {
      expect(quad?.[i * SHADOW_FLOATS + 1]).toBeLessThan(-2);
      expect(quad?.[i * SHADOW_FLOATS + 1]).toBeGreaterThan(-2.2);
      expect(Math.abs(quad?.[i * SHADOW_FLOATS + 3] ?? 0)).toBe(1);
    }
    expect(contactShadow({ min: [NaN, 0, 0], max: [1, 1, 1] })).toBeNull();
    expect(contactShadow({ min: [1, 1, 1], max: [0, 0, 0] })).toBeNull();
  });
});
