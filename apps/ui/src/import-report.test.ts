import { describe, expect, test } from "bun:test";
import { IMPORT_ACCEPT, importParams, importSummary, toBase64 } from "./import-report";

describe("import report", () => {
  test("File ▸ Import offers Rhino files beside DXF and DWG", () => {
    expect(IMPORT_ACCEPT.split(",")).toEqual([".dxf", ".dwg", ".3dm"]);
  });

  test("base64 matches the browser's own for small and sliced inputs", () => {
    expect(toBase64(new TextEncoder().encode("3D Geometry"))).toBe(btoa("3D Geometry"));
    const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 251);
    expect(atob(toBase64(big)).length).toBe(big.length);
    expect(importParams("ring.3dm", new Uint8Array([1, 2, 3]))).toEqual({ data: "AQID", name: "ring.3dm" });
  });

  test("a Rhino reply names each mesh's weight and what was not read", () => {
    const reply = {
      message: "1 meshes, 2 curves read from a Rhino 80 file; 2 objects added",
      meshes: [
        { name: "band", volumeMm3: 612.34, grams: { gold18: 9.491 } },
        { name: "", closed: false },
      ],
      skipped: [{ kind: "brep (polysurface)", count: 3 }],
    };
    expect(importSummary("ring.3dm", reply)).toBe(
      "ring.3dm: 1 meshes, 2 curves read from a Rhino 80 file; 2 objects added; band: 612.3 mm³, 9.49 g in 18k gold; mesh: open, not weighed; 3 brep (polysurface) not read",
    );
  });

  test("a DXF reply is its message", () => {
    expect(importSummary("a.dxf", { message: "4 objects imported from a.dxf" })).toBe("a.dxf: 4 objects imported from a.dxf");
    expect(importSummary("x", null)).toBe("x: imported");
  });
});
