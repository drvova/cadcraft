/**
 * File ▸ Import in the browser: the file's bytes go to the engine's `import` command as base64
 * (DXF, DWG or a Rhino `.3dm`), and the reply becomes one line for the notice. A Rhino file's
 * reply is IMPORT3DM's report: each mesh's weight and the curves brought in. Pure functions; the
 * shell picks the file and shows the line.
 */

/** The file types File ▸ Import offers. */
export const IMPORT_ACCEPT = ".dxf,.dwg,.3dm";

/** Base64 of `bytes`, in slices so a large file never overflows the argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** The parameters of the engine's `import` for a picked file. */
export function importParams(name: string, bytes: Uint8Array): { data: string; name: string } {
  return { data: toBase64(bytes), name };
}

const record = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One mesh of a Rhino report as words: its name, its volume and its weight in 18k gold. */
function meshLine(m: Record<string, unknown>): string {
  const name = typeof m["name"] === "string" && m["name"] !== "" ? m["name"] : "mesh";
  const volume = num(m["volumeMm3"]);
  const gold = num(record(m["grams"])["gold18"]);
  if (volume === null || gold === null) return `${name}: open, not weighed`;
  return `${name}: ${volume.toFixed(1)} mm³, ${gold.toFixed(2)} g in 18k gold`;
}

/** The notice line for an `import` reply: the engine's message, and for a Rhino file each mesh. */
export function importSummary(file: string, result: unknown): string {
  const r = record(result);
  const message = typeof r["message"] === "string" ? r["message"] : "imported";
  const meshes = list(r["meshes"]).map((m) => meshLine(record(m)));
  const skipped = list(r["skipped"]).map((k) => {
    const s = record(k);
    return `${num(s["count"]) ?? 0} ${typeof s["kind"] === "string" ? s["kind"] : "object"} not read`;
  });
  const parts = [`${file}: ${message}`, ...meshes, ...skipped];
  return parts.join("; ");
}
