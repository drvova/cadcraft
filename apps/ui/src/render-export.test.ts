import { describe, expect, test } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import {
  apngFrameCount,
  ApngWriter,
  backgroundColor,
  crc32,
  exportFileName,
  filterScanlines,
  gpuSide,
  heldBytes,
  pictureSize,
  pngChunk,
  readChunks,
  stillCamera,
  storePlan,
  turntableCameras,
  turntablePlan,
  unpremultiply,
  videoFormat,
  type Deflate,
} from "./render-export";
import { sceneOf, STANDARD_VIEWS } from "./view3d";

const zlib: Deflate = async (bytes) => new Uint8Array(deflateSync(bytes));
const BIG = { maxTexture: 16384, maxRenderbuffer: 16384, maxViewport: 16384 };
const SCENE = sceneOf({ min: [-10, -10, -3], max: [10, 12, 3] });

/** Undo the Sub filter of each scanline: the pixels back. */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const type = raw[y * (stride + 1)];
    expect(type).toBe(1);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? (out[y * stride + x - 4] ?? 0) : 0;
      out[y * stride + x] = ((raw[y * (stride + 1) + 1 + x] ?? 0) + left) & 0xff;
    }
  }
  return out;
}

function frame(width: number, height: number, seed: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 1) out[i] = (i * 7 + seed * 31) & 0xff;
  return out;
}

describe("crc32", () => {
  test("is PNG's CRC (the check value of the standard)", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  test("an IEND chunk has the CRC every PNG ends with", () => {
    const end = pngChunk("IEND", new Uint8Array(0));
    expect([...end]).toEqual([0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82]);
  });
});

describe("sizes", () => {
  test("square and 16:9 pictures, even sides", () => {
    expect(pictureSize(2048, "square")).toEqual({ width: 2048, height: 2048 });
    expect(pictureSize(1080, "wide")).toEqual({ width: 1080, height: 608 });
    expect(pictureSize(4096, "wide")).toEqual({ width: 4096, height: 2304 });
    expect(pictureSize(Number.NaN, "square")).toEqual({ width: 1080, height: 1080 });
  });
  test("a store at twice the size where the GPU allows", () => {
    const plan = storePlan(2048, 2048, BIG);
    expect(plan).toMatchObject({ width: 2048, height: 2048, storeWidth: 4096, storeHeight: 4096, factor: 2, note: null });
  });
  test("less supersampling where the GPU is smaller, said in words", () => {
    const plan = storePlan(4096, 4096, { maxTexture: 8192, maxRenderbuffer: 6000, maxViewport: 16384 });
    expect(plan.storeWidth).toBe(6000);
    expect(plan.width).toBe(4096);
    expect(plan.note).toContain("6000");
  });
  test("a picture past the GPU is made smaller to fit, and says so", () => {
    const plan = storePlan(4096, 2304, { maxTexture: 4096, maxRenderbuffer: 2048, maxViewport: 4096 });
    expect(plan.width).toBe(2048);
    expect(plan.height).toBe(1152);
    expect(plan.storeWidth).toBe(2048);
    expect(plan.factor).toBe(1);
    expect(plan.note).toContain("2048 × 1152");
  });
  test("a hostile limit reads as the WebGL floor", () => {
    expect(gpuSide({ maxTexture: Number.NaN, maxRenderbuffer: 0, maxViewport: -1 })).toBe(2048);
  });
  test("held bytes of a WebM's frames", () => {
    expect(heldBytes(120, 720, 720)).toBe(120 * 720 * 720 * 4);
  });
});

describe("turntable", () => {
  test("frames from seconds and rate, held to the ranges", () => {
    expect(turntablePlan(4, 30)).toMatchObject({ frames: 120, fps: 30, delayNum: 1, delayDen: 30, seconds: 4 });
    expect(turntablePlan(100, 60).frames).toBe(600);
    expect(turntablePlan(Number.NaN, Number.NaN).frames).toBe(120);
  });
  test("the turn closes exactly, with no doubled first and last frame", () => {
    const cams = turntableCameras(SCENE, 1, 120, 20);
    expect(cams.length).toBe(120);
    const step = (2 * Math.PI) / 120;
    const first = cams[0];
    const last = cams[119];
    if (first === undefined || last === undefined) throw new Error("no cameras");
    // Yaw is kept in (−π, π]: compare angles a whole turn apart as equal.
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    // One more step from the last is the first again.
    expect(wrap(last.yaw + step - first.yaw)).toBeCloseTo(0, 12);
    const seen = new Set(cams.map((c) => `${Math.cos(c.yaw).toFixed(9)},${Math.sin(c.yaw).toFixed(9)}`));
    expect(seen.size).toBe(120);
    for (let i = 1; i < cams.length; i += 1) expect(wrap((cams[i]?.yaw ?? 0) - (cams[i - 1]?.yaw ?? 0))).toBeCloseTo(step, 12);
  });
  test("one tilt and one distance for every frame", () => {
    const cams = turntableCameras(SCENE, 16 / 9, 24, 30);
    for (const cam of cams) {
      expect(cam.pitch).toBeCloseTo(Math.PI / 6, 12);
      expect(cam.distance).toBeCloseTo(cams[0]?.distance ?? 0, 12);
    }
    expect(turntableCameras(SCENE, 1, 4, 500)[0]?.pitch).toBeCloseTo(Math.PI / 3, 12);
  });
  test("a still's camera: the current one as left, or a standard view", () => {
    const current = { target: [1, 2, 3] as [number, number, number], yaw: 0.3, pitch: 0.2, distance: 50 };
    expect(stillCamera("current", current, SCENE, 1)).toBe(current);
    expect(stillCamera("top", current, SCENE, 1).pitch).toBe(STANDARD_VIEWS.top.pitch);
    expect(stillCamera("current", null, SCENE, 1).yaw).toBe(STANDARD_VIEWS["three-quarter"].yaw);
  });
  test("the format: a cut-out or no recorder takes the APNG", () => {
    expect(videoFormat("studio", true, "webm")).toEqual({ format: "webm", note: null });
    expect(videoFormat("transparent", true, "webm").format).toBe("apng");
    expect(videoFormat("light", false, "webm").note).toContain("cannot record");
    expect(videoFormat("light", true, "apng").format).toBe("apng");
  });
});

describe("backgrounds and names", () => {
  test("studio and light are colours, transparent is none", () => {
    expect(backgroundColor("transparent")).toBeNull();
    const studio = backgroundColor("studio");
    const light = backgroundColor("light");
    expect(studio).not.toBeNull();
    expect((light?.[0] ?? 0) > (studio?.[0] ?? 1)).toBe(true);
  });
  test("a file name from the title", () => {
    expect(exportFileName("Solitaire · US 6½ · 18k gold", "2048", "png")).toBe("Solitaire US 6½ 18k gold - 2048.png");
    expect(exportFileName("  ", "turntable", "webm")).toBe("Piece - turntable.webm");
  });
});

describe("APNG", () => {
  test("signature, IHDR, acTL, fcTL sequence and CRCs; frames decode back", async () => {
    const w = 5;
    const h = 3;
    const frames = [frame(w, h, 1), frame(w, h, 2), frame(w, h, 3)];
    const writer = new ApngWriter(w, h, 3, 1, 30, zlib);
    for (const f of frames) await writer.add(f);
    const file = writer.finish();
    const chunks = readChunks(file);
    if (chunks === null) throw new Error("not a PNG");
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"]);
    const ihdr = chunks[0]?.data ?? new Uint8Array(0);
    const iv = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
    expect([iv.getUint32(0), iv.getUint32(4), ihdr[8], ihdr[9]]).toEqual([5, 3, 8, 6]);
    expect(apngFrameCount(file)).toBe(3);
    // Sequence numbers run 0…n-1 across fcTL and fdAT, in file order.
    const seq = chunks.filter((c) => c.type === "fcTL" || c.type === "fdAT").map((c) => new DataView(c.data.buffer, c.data.byteOffset, 4).getUint32(0));
    expect(seq).toEqual([0, 1, 2, 3, 4]);
    // Each fcTL: the whole picture, at 1/30 s, replace.
    for (const c of chunks.filter((c) => c.type === "fcTL")) {
      const v = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
      expect([v.getUint32(4), v.getUint32(8), v.getUint32(12), v.getUint32(16), v.getUint16(20), v.getUint16(22), c.data[24], c.data[25]]).toEqual([5, 3, 0, 0, 1, 30, 0, 0]);
    }
    // The pixels come back exactly.
    const datas = chunks.filter((c) => c.type === "IDAT" || c.type === "fdAT").map((c) => (c.type === "IDAT" ? c.data : c.data.subarray(4)));
    datas.forEach((data, i) => expect([...unfilter(new Uint8Array(inflateSync(data)), w, h)]).toEqual([...(frames[i] ?? [])]));
  });
  test("refuses a frame of the wrong size, too many frames, and an early finish", async () => {
    const writer = new ApngWriter(2, 2, 1, 1, 24, zlib);
    await expect(writer.add(new Uint8Array(3))).rejects.toThrow();
    expect(() => writer.finish()).toThrow();
    await writer.add(new Uint8Array(16));
    await expect(writer.add(new Uint8Array(16))).rejects.toThrow();
    expect(apngFrameCount(writer.finish())).toBe(1);
  });
  test("a corrupt file reads as none", () => {
    expect(readChunks(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(apngFrameCount(new Uint8Array(0))).toBe(0);
  });
  test("Sub filter of one row", () => {
    expect([...filterScanlines(new Uint8Array([10, 20, 30, 40, 15, 25, 35, 45]), 2, 1)]).toEqual([1, 10, 20, 30, 40, 5, 5, 5, 5]);
  });
  test("unpremultiply", () => {
    expect([...unpremultiply(new Uint8Array([64, 32, 0, 128, 9, 9, 9, 0, 200, 100, 50, 255]))]).toEqual([128, 64, 0, 128, 9, 9, 9, 0, 200, 100, 50, 255]);
  });
});
