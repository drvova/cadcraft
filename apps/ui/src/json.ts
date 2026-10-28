/**
 * The one canonical JSON guard for this package. Every boundary that parses facade replies
 * (display list, command-line state, drawing state) narrows through these, so the trust
 * boundary is defined exactly once.
 */

/** A JSON object (not null, not an array). Fields remain `unknown` until checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number, or null. */
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A string, or null. */
export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A boolean, or null. */
export function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** An array of strings, capped at `max` entries. */
export function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
