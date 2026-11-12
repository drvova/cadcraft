/**
 * The font a Slab surface is measured with is the font it is painted with: the interface's own
 * stack (`--font-family`, `--font-family-mono` of `../tokens.css`), whatever face that resolves to
 * on this machine.
 *
 * Slab's kernel measures text from a table of advances per codepoint and never asks the page.
 * Upstream's kernel carries Inter and JetBrains Mono and measures and paints with them; the one
 * built here carries no font at all (`third_party/slab`, the `bundled-fonts` feature off), and a
 * document compiled for it holds only a built-in default advance table. This repository ships no
 * font and paints in the system's, so the page measures the face it will really paint with (a
 * canvas `measureText` per codepoint, per weight, per size) and hands the kernel those advances
 * (`SlabElement.registerFontMetrics`, the series' web patch). No font file is read, fetched or
 * shipped. A family the page did not register would be laid out with the default table and
 * named in the element's diagnostics (`font-default`).
 *
 * A system face is not one outline scaled: its advances at 11px are not 11/13 of those at 13px
 * (hinting, optical sizes, the tracking a platform adds to small text). So each type size is its
 * own family to the kernel (`cadcraft-ui-13`, `cadcraft-ui-12`, …: `./tokens`), measured at
 * exactly that size.
 */

/** A face's metrics as the web driver's `registerFontMetrics` takes them. */
export interface FontMetrics {
  weight: number;
  upem: number;
  ascent: number;
  descent: number;
  lineGap: number;
  defaultAdvance: number;
  underlinePosition: number;
  underlineThickness: number;
  cps: Uint32Array;
  gids: Uint32Array;
  advs: Uint32Array;
}

/** Font units per CSS pixel: an advance is kept to 1/1024 px. */
export const UNITS_PER_PX = 1024;

/** The weights the interface sets text in. */
export const UI_WEIGHTS: readonly number[] = [400, 500, 600, 700];

/**
 * The codepoints measured: Basic Latin, Latin-1, Latin Extended-A, and the punctuation, arrows
 * and signs the interface writes (· × − … ’ “ ” € → ✓). Anything else is charged the default
 * advance by the kernel and painted by the browser's fallback, which the web driver boxes to
 * that advance.
 */
export const CODEPOINT_RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0x17f],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2190, 0x2193],
  [0x2212, 0x2212],
  [0x2260, 0x2265],
  [0x2713, 0x2713],
];

/** Every codepoint of the ranges, ascending. */
export function codepoints(ranges: readonly (readonly [number, number])[] = CODEPOINT_RANGES): number[] {
  const out: number[] = [];
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to && out.length < 4096; cp++) out.push(cp);
  }
  return out;
}

/** What a face measures as at one size and weight. */
export interface FaceMeasure {
  /** The advance of one codepoint's character in px; a non-finite or negative answer is dropped. */
  advance: (char: string) => number;
  /** The face's ascent and descent in px (both positive). */
  ascent: number;
  descent: number;
}

const finitePositive = (n: number, fallback: number): number => (Number.isFinite(n) && n > 0 ? n : fallback);

/** The metrics table of one face at one size and weight, from its measured advances. */
export function buildMetrics(measure: FaceMeasure, size: number, weight: number, cps: readonly number[] = codepoints()): FontMetrics {
  const px = finitePositive(size, 13);
  const upem = Math.round(px * UNITS_PER_PX);
  const kept: number[] = [];
  const advs: number[] = [];
  for (const cp of cps) {
    const width = measure.advance(String.fromCodePoint(cp));
    if (!Number.isFinite(width) || width < 0 || width > px * 4) continue;
    kept.push(cp);
    advs.push(Math.round(width * UNITS_PER_PX));
  }
  const space = kept.indexOf(0x20);
  const zero = kept.indexOf(0x30);
  // What an unmeasured character is charged: a digit's width (most faces' average), else half an em.
  const defaultAdvance = advs[zero] ?? advs[space] ?? Math.round(upem / 2);
  return {
    weight,
    upem,
    ascent: Math.round(finitePositive(measure.ascent, px * 0.9) * UNITS_PER_PX),
    descent: -Math.round(finitePositive(measure.descent, px * 0.25) * UNITS_PER_PX),
    lineGap: 0,
    defaultAdvance,
    underlinePosition: -Math.round(upem / 10),
    underlineThickness: Math.max(1, Math.round(upem / 16)),
    cps: Uint32Array.from(kept),
    // The kernel reads a zero glyph as "not covered"; any other number means the host paints it.
    gids: Uint32Array.from(kept, (_, index) => index + 1),
    advs: Uint32Array.from(advs),
  };
}

/** One family to register: its name in the documents, the CSS stack it paints with, its size. */
export interface FamilySpec {
  name: string;
  css: string;
  size: number;
  weights: readonly number[];
}

/** The part of the web driver this file calls. */
export interface FontRegistry {
  registerFontMetrics(name: string, metrics: FontMetrics, cssFamily: string): boolean;
}

/** A measurer over a 2D canvas context set to one face. */
function canvasMeasure(ctx: CanvasRenderingContext2D, css: string, size: number, weight: number): FaceMeasure {
  ctx.font = `${weight} ${size}px ${css}`;
  // The web driver paints with kerning and ligatures off, so a run is the sum of its advances.
  if ("fontKerning" in ctx) ctx.fontKerning = "none";
  const box = ctx.measureText("Hg");
  return {
    advance: (char) => ctx.measureText(char).width,
    ascent: box.fontBoundingBoxAscent,
    descent: box.fontBoundingBoxDescent,
  };
}

/**
 * Measure each family in the page and register it. Says how many faces were registered; 0 when
 * the page has no canvas to measure with (the documents are then laid out with the kernel's
 * built-in default advances).
 */
export function registerFamilies(registry: FontRegistry, families: readonly FamilySpec[], doc: Document = document): number {
  const ctx = doc.createElement("canvas").getContext("2d");
  if (ctx === null) return 0;
  const cps = codepoints();
  let count = 0;
  for (const family of families) {
    if (family.css.trim() === "" || !(family.size > 0)) continue;
    for (const weight of family.weights) {
      if (registry.registerFontMetrics(family.name, buildMetrics(canvasMeasure(ctx, family.css, family.size, weight), family.size, weight, cps), family.css)) count += 1;
    }
  }
  return count;
}
