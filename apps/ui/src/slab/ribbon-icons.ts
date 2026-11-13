/**
 * The ribbon's glyphs as Slab `icon` declarations, made from the interface's own paths
 * (`../icons`: `ICON_PATHS`) and never copied by hand. A Slab icon is a static declaration, and a
 * tool names the one it draws by a text prop, so the document (`slab/ribbon.slab`) has to hold
 * one declaration per glyph of the ribbon: the block between the two marker lines there is this
 * file's output, and `./ribbon.test.ts` holds the two equal, character for character (run it with
 * `RIBBON_ICONS=write` to write the block again after `icons.ts` or the ribbon's table changed).
 *
 * The interface draws a glyph with one stroke weight at every size (`STROKE` CSS pixels,
 * `vector-effect: non-scaling-stroke`). A Slab icon scales its stroke with its design box, so a
 * glyph is declared for the size it is drawn at, with the stroke that comes to `STROKE` there.
 */

import { ICON_PATHS, STROKE } from "../icons";
import { RIBBON_TOOLS } from "../ribbon";

/** The side of the design box every path of `icons.ts` is drawn on. */
export const ICON_GRID = 24;

/** The size the band and the one-row ribbon draw a tool's glyph at (`--icon-size-lg`). */
export const TOOL_GLYPH_PX = 16;

/** The size a key's chevron is drawn at (`--icon-size-md`: the fold key and the overflow key). */
export const KEY_GLYPH_PX = 14;

/** The lines the generated block stands between in the document. */
export const ICONS_BEGIN = "// ---- glyphs: generated from src/icons.ts by src/slab/ribbon-icons.ts; do not edit ----";
export const ICONS_END = "// ---- end of the generated glyphs ----";

/** One declaration: its name in the document, the id of `icons.ts` it draws, and the size it is drawn at. */
export interface RibbonGlyph {
  name: string;
  id: string;
  px: number;
}

/**
 * The name a tool's glyph has in the document: an identifier (an id of `icons.ts` may hold dots),
 * under a prefix, so that no id meets a word of the language (`text`, `scale`, `rotate`).
 */
export function glyphName(id: string): string {
  return `glyph-${id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/** The fold key's and the overflow key's chevrons. */
export const KEY_GLYPHS: readonly RibbonGlyph[] = [
  { name: "key-fold", id: "chevron-up", px: KEY_GLYPH_PX },
  { name: "key-more", id: "chevron-down", px: KEY_GLYPH_PX },
];

/** Every declaration the ribbon needs: each tool's glyph once, then the keys' chevrons. */
export function ribbonGlyphs(): RibbonGlyph[] {
  const tools = [...new Set(RIBBON_TOOLS.map((tool) => tool.icon))].map((id): RibbonGlyph => ({ name: glyphName(id), id, px: TOOL_GLYPH_PX }));
  return [...tools, ...KEY_GLYPHS];
}

/** A stroke width on the design grid that comes to `STROKE` px at `px`, at most four decimals. */
export function gridStroke(px: number): string {
  return String(Number(((STROKE * ICON_GRID) / px).toFixed(4)));
}

/** The generated block, from marker to marker, with no newline after the last. A glyph with no path in `icons.ts` is left out (the test names it). */
export function ribbonIconSource(): string {
  return glyphBlock(ribbonGlyphs());
}

/** The same block for any document's glyphs (`./topbar-icons` declares the title bar's with it). */
export function glyphBlock(glyphs: readonly RibbonGlyph[]): string {
  const lines = [ICONS_BEGIN];
  for (const glyph of glyphs) {
    const path = Object.hasOwn(ICON_PATHS, glyph.id) ? ICON_PATHS[glyph.id] : undefined;
    // A path is our own text; one that could close the string it is written in is not written.
    if (path === undefined || !/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/.test(path)) continue;
    lines.push(`icon ${glyph.name} viewbox=${ICON_GRID} {`, `  path "${path}" bg=none stroke=current stroke-w=${gridStroke(glyph.px)}`, "}");
  }
  lines.push(ICONS_END);
  return lines.join("\n");
}

/** The generated block as a document holds it now; null when the markers are not both there, in order. */
export function iconBlockOf(source: string): string | null {
  const from = source.indexOf(ICONS_BEGIN);
  const to = source.indexOf(ICONS_END);
  return from < 0 || to < from ? null : source.slice(from, to + ICONS_END.length);
}

/** The document with its generated block replaced by the current one; null when it has no block. */
export function withIconBlock(source: string): string | null {
  const old = iconBlockOf(source);
  return old === null ? null : source.replace(old, () => ribbonIconSource());
}
