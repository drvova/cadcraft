/**
 * The Slab documents' tokens, made from the interface's own (`../tokens.css`): the dark values
 * are the document's base and the light ones a Slab `theme light`, so a Slab surface is themed
 * by the same file as everything else and no colour is written twice.
 *
 * Pure text in, text out: `scripts/build-slab.mjs` runs it when it compiles `slab/*.slab`, and
 * the result (`slab/gen/tokens.slab`, git-ignored) is what the documents import. Nothing here is
 * trusted: a value that is not a colour or a length this file knows is left out, never passed on.
 */

/** The custom properties of one rule, by name without the leading dashes. */
export type TokenTable = ReadonlyMap<string, string>;

/** The most `var()` hops followed before a token is given up as a cycle. */
const MAX_VAR_DEPTH = 8;

/** The most declarations read from one block (the sheet has under two hundred). */
const MAX_DECLARATIONS = 2_000;

/** The type sizes the documents may set text in, and so the sizes the fonts are measured at. */
export const TEXT_STYLES: readonly { name: string; size: string; mono: boolean }[] = [
  { name: "body", size: "font-body", mono: false },
  { name: "label", size: "font-label", mono: false },
  { name: "chip", size: "font-chip", mono: false },
  { name: "mono", size: "font-mono", mono: true },
];

/** The family a text style names: one per size, because a system face is measured per size (`./fonts`). */
export function familyName(mono: boolean, size: number): string {
  return `cadcraft-${mono ? "mono" : "ui"}-${size}`;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first rule whose selector is exactly `selector`; "" when there is none. */
function ruleBody(css: string, selector: string): string {
  let at = 0;
  for (;;) {
    const start = css.indexOf(selector, at);
    if (start < 0) return "";
    const open = css.indexOf("{", start);
    if (open < 0) return "";
    // The selector must be the whole prelude: `:root` is not `:root[data-theme="light"]`.
    if (css.slice(start + selector.length, open).trim() === "" && (start === 0 || /[\s}]/.test(css.charAt(start - 1)))) {
      const close = css.indexOf("}", open);
      return close < 0 ? "" : css.slice(open + 1, close);
    }
    at = start + selector.length;
  }
}

/** The custom properties a rule declares. */
function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (let m = re.exec(body); m !== null && out.size < MAX_DECLARATIONS; m = re.exec(body)) {
    const name = m[1];
    const value = m[2];
    if (name !== undefined && value !== undefined) out.set(name.toLowerCase(), value.trim());
  }
  return out;
}

/** The sheet's two tables: the base (dark) values, and the ones the light theme restates. */
export function readTokenSheet(css: string): { dark: TokenTable; light: TokenTable } {
  const clean = stripComments(css);
  return { dark: declarations(ruleBody(clean, ":root")), light: declarations(ruleBody(clean, ':root[data-theme="light"]')) };
}

/** A token's value with every `var(--x)` followed; null when one is unknown or they loop. */
export function resolveToken(name: string, tables: readonly TokenTable[], depth = 0): string | null {
  if (depth > MAX_VAR_DEPTH) return null;
  let value: string | undefined;
  for (const table of tables) {
    value = table.get(name);
    if (value !== undefined) break;
  }
  if (value === undefined) return null;
  const whole = /^var\(\s*--([a-z0-9-]+)\s*\)$/i.exec(value);
  if (whole === null) return value.includes("var(") ? null : value;
  const next = whole[1];
  return next === undefined ? null : resolveToken(next.toLowerCase(), tables, depth + 1);
}

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();

/** A CSS colour as Slab writes one (`#RRGGBB` or `#RRGGBBAA`); null for anything else. */
export function slabColor(value: string): string | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex !== null && hex[1] !== undefined) {
    const digits = hex[1];
    const full = digits.length <= 4 ? [...digits].map((c) => c + c).join("") : digits;
    return `#${full.toUpperCase()}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgb === null) return null;
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (![r, g, b, a].every((n) => Number.isFinite(n)) || a < 0 || a > 1) return null;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a >= 1 ? "" : hex2(a * 255)}`;
}

/** A length in px as a plain number of Slab units; null for anything else. */
export function slabLength(value: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && Math.abs(n) <= 100_000 ? n : null;
}

/** A duration (`0.1s`, `120ms`) in Slab's milliseconds; null for anything else. */
export function slabDuration(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value.trim());
  if (m === null) return null;
  const n = Number(m[1]) * (m[2] === "s" ? 1000 : 1);
  return Number.isFinite(n) && n <= 60_000 ? Math.round(n) : null;
}

/** The Slab group a length token goes in, and its name there: `gap-8` is `space.g8`. */
function lengthGroup(name: string): { group: string; key: string } | null {
  const gap = /^gap-(\d+)$/.exec(name);
  if (gap !== null) return { group: "space", key: `g${gap[1]}` };
  const radius = /^radius-([a-z]+)$/.exec(name);
  if (radius !== null && radius[1] !== undefined) return { group: "radius", key: radius[1] };
  if (/^(control-h|icon-size|button-pad|field-pad)-[a-z0-9-]+$/.test(name) || name === "hairline" || name === "leading-ui") return { group: "size", key: name };
  const font = /^font-(body|label|chip|mono)$/.exec(name);
  if (font !== null && font[1] !== undefined) return { group: "font", key: font[1] };
  return null;
}

/** A number as Slab reads it: at most four decimals, no exponent. */
const num = (n: number): string => String(Number(n.toFixed(4)));

export interface SlabTokens {
  /** The base (dark) colours, by token name. */
  colors: Map<string, string>;
  /** The colours the light theme changes. */
  light: Map<string, string>;
  /** The lengths, by group then name. */
  lengths: Map<string, Map<string, number>>;
  /** The durations in milliseconds. */
  durations: Map<string, number>;
  /** The type sizes by style name (`body` → 13). */
  textSizes: Map<string, number>;
  /** The interface's line height in px. */
  leading: number;
}

/** Every token of the sheet a Slab document can use, converted. */
export function mapTokens(css: string): SlabTokens {
  const { dark, light } = readTokenSheet(css);
  const colors = new Map<string, string>();
  const lightColors = new Map<string, string>();
  const lengths = new Map<string, Map<string, number>>();
  const durations = new Map<string, number>();
  for (const name of dark.keys()) {
    const base = resolveToken(name, [dark]);
    if (base === null) continue;
    const color = slabColor(base);
    if (color !== null) {
      colors.set(name, color);
      // The light value may come through a `var()` the light theme restates further down.
      const other = resolveToken(name, [light, dark]);
      const lightColor = other === null ? null : slabColor(other);
      if (lightColor !== null && lightColor !== color) lightColors.set(name, lightColor);
      continue;
    }
    const length = slabLength(base);
    const place = length === null ? null : lengthGroup(name);
    if (length !== null && place !== null) {
      const group = lengths.get(place.group) ?? new Map<string, number>();
      group.set(place.key, length);
      lengths.set(place.group, group);
      continue;
    }
    const duration = /^dur-([a-z]+)$/.exec(name);
    const ms = duration === null ? null : slabDuration(base);
    if (duration !== null && duration[1] !== undefined && ms !== null) durations.set(duration[1], ms);
  }
  const textSizes = new Map<string, number>();
  for (const style of TEXT_STYLES) {
    const raw = resolveToken(style.size, [dark]);
    const size = raw === null ? null : slabLength(raw);
    if (size !== null && size > 0) textSizes.set(style.name, size);
  }
  const leadingRaw = resolveToken("leading-ui", [dark]);
  const leading = (leadingRaw === null ? null : slabLength(leadingRaw)) ?? 16;
  return { colors, light: lightColors, lengths, durations, textSizes, leading };
}

function block(name: string, entries: Iterable<[string, string]>, indent: string): string {
  const lines = [...entries].map(([key, value]) => `${indent}  ${key} ${value}`);
  return lines.length === 0 ? "" : `${indent}${name} {\n${lines.join("\n")}\n${indent}}\n`;
}

/** The token sheet as a Slab declaration module: `tokens { … }` and `theme light { … }`. */
export function slabTokenSource(css: string): string {
  const t = mapTokens(css);
  let out = "// GENERATED from src/tokens.css by scripts/build-slab.mjs (src/slab/tokens.ts). Do not edit.\n";
  out += "tokens {\n";
  out += block("color", t.colors, "  ");
  for (const [group, values] of t.lengths) out += block(group, [...values].map(([k, v]): [string, string] => [k, num(v)]), "  ");
  out += block("dur", [...t.durations].map(([k, v]): [string, string] => [k, num(v)]), "  ");
  let text = "";
  for (const style of TEXT_STYLES) {
    const size = t.textSizes.get(style.name);
    if (size === undefined) continue;
    text += `    ${style.name} { family "${familyName(style.mono, size)}"; size ${num(size)}; leading ${num(t.leading / size)} }\n`;
  }
  if (text !== "") out += `  text {\n${text}  }\n`;
  out += "}\n";
  // One theme is selected at a time, so light and still are declared alone and together: the
  // interface's theme (`data-theme`) and its motion switch (`data-animations`) are independent.
  const light = block("color", t.light, "  ");
  const still = block("dur", [...t.durations.keys()].map((k): [string, string] => [k, "0"]), "  ");
  out += `theme light {\n${light}}\n`;
  out += `theme still {\n${still}}\n`;
  out += `theme light-still {\n${light}${still}}\n`;
  return out;
}
