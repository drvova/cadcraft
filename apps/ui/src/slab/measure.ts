/**
 * The width of a run of text as a Slab surface will lay it out: the sum of the advances the page
 * registered with the kernel (`./fonts`: one canvas `measureText` per character, kerning off,
 * kept to 1/1024 px), plus the tracking after every character. A host that has to decide
 * something by a text's width before the kernel has laid it out (what a bar too short for all
 * of it gives up, whether a tab's name is cut) asks here, and gets the kernel's own answer.
 */

import { UNITS_PER_PX } from "./fonts";
import { TEXT_STYLES } from "./tokens";

/** The width of `text` in px in one of the documents' text styles; 0 for a style nobody declared. */
export type TextMeasure = (style: string, text: string, tracking?: number) => number;

/** The most characters of one run that are measured (a label is a dozen). */
const MAX_RUN = 512;

/** A measure over per-character advances: `advance(style, char)` in px, asked once per character. */
export function runMeasure(advance: (style: string, char: string) => number): TextMeasure {
  const known = new Map<string, number>();
  return (style, text, tracking = 0) => {
    let width = 0;
    let count = 0;
    for (const char of text) {
      if (count >= MAX_RUN) break;
      count += 1;
      const id = `${style}\u0000${char}`;
      let one = known.get(id);
      if (one === undefined) {
        const raw = advance(style, char);
        one = Number.isFinite(raw) && raw > 0 ? Math.round(raw * UNITS_PER_PX) / UNITS_PER_PX : 0;
        known.set(id, one);
      }
      width += one + tracking;
    }
    return width;
  };
}

/**
 * The page's measure: each text style of `./tokens` in the face and at the size the live tokens
 * give it, as `./loader` registered it. Null when the page has no canvas to measure with.
 */
export function pageMeasure(doc: Document = document): TextMeasure | null {
  const ctx = doc.createElement("canvas").getContext("2d");
  const view = doc.defaultView;
  if (ctx === null || view === null) return null;
  const root = view.getComputedStyle(doc.documentElement);
  const fonts = new Map<string, string>();
  for (const style of TEXT_STYLES) {
    const size = root.getPropertyValue(`--${style.size}`).trim();
    const family = root.getPropertyValue(style.mono ? "--font-family-mono" : "--font-family").trim();
    if (size !== "" && family !== "") fonts.set(style.name, `400 ${size} ${family}`);
  }
  let set = "";
  return runMeasure((style, char) => {
    const font = fonts.get(style);
    if (font === undefined) return 0;
    if (set !== font) {
      ctx.font = font;
      // The web driver paints with kerning off, so a run is the sum of its advances.
      if ("fontKerning" in ctx) ctx.fontKerning = "none";
      set = font;
    }
    return ctx.measureText(char).width;
  });
}
