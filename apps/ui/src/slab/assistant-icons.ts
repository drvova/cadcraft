/**
 * The assistant panel's glyphs as Slab `icon` declarations, made from the interface's own paths
 * (`../icons`: `ICON_PATHS`) as the ribbon's are (`./ribbon-icons`, whose stroke rule is used here): the block
 * between the two marker lines of `slab/assistant.slab` is this file's output, and `./assistant.test.ts` holds the two equal, character for character (run it
 * with `ASSISTANT_ICONS=write` to write the block again after `icons.ts` or this table changed).
 *
 * A Slab icon scales its stroke with its design box, so a glyph drawn at two sizes is declared
 * twice, each with the stroke that comes to the interface's one weight at that size.
 */

import { ICON_PATHS } from "../icons";
import { gridStroke, ICON_GRID } from "./ribbon-icons";

/** The lines the generated block stands between in the document. */
export const ICONS_BEGIN = "// ---- glyphs: generated from src/icons.ts by src/slab/assistant-icons.ts; do not edit ----";
export const ICONS_END = "// ---- end of the generated glyphs ----";

/** The sizes the panel draws a glyph at: a key's (`--icon-size-md`) and a chip's (`--icon-size-sm`). */
export const KEY_PX = 14;
export const CHIP_PX = 12;

/** Every glyph the document declares: an id of `icons.ts` at a size. */
export const ASSISTANT_GLYPHS: readonly { id: string; px: number }[] = [
  // The title's keys, the composer's keys.
  { id: "plus", px: KEY_PX },
  { id: "close", px: KEY_PX },
  { id: "attach", px: KEY_PX },
  { id: "send", px: KEY_PX },
  { id: "stop", px: KEY_PX },
  // The empty state's suggestions.
  { id: "ring", px: KEY_PX },
  { id: "gem", px: KEY_PX },
  { id: "dist", px: KEY_PX },
  { id: "chevron-right", px: CHIP_PX },
  // A chip's glyph and its close key, a chat tab's close key, the model slot's caret.
  { id: "close", px: CHIP_PX },
  { id: "chevron-down", px: CHIP_PX },
  { id: "pick", px: CHIP_PX },
  { id: "list", px: CHIP_PX },
  { id: "gem", px: CHIP_PX },
];

/** A glyph's name in the document, `a-<id>-md` or `a-<id>-sm` (a name may not end in a number). */
const glyphName = (id: string, px: number): string => `a-${id}-${px === KEY_PX ? "md" : "sm"}`;

/** The name a glyph has in the document. "" for a glyph the document does not declare. */
export function assistantGlyph(id: string, px: number): string {
  return ASSISTANT_GLYPHS.some((glyph) => glyph.id === id && glyph.px === px) ? glyphName(id, px) : "";
}

/** The generated block, from marker to marker, with no newline after the last. A glyph with no path in `icons.ts` is left out (the test names it). */
export function assistantIconSource(): string {
  const lines = [ICONS_BEGIN];
  for (const glyph of ASSISTANT_GLYPHS) {
    const path = Object.hasOwn(ICON_PATHS, glyph.id) ? ICON_PATHS[glyph.id] : undefined;
    // A path is our own text; one that could close the string it is written in is not written.
    if (path === undefined || !/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/.test(path)) continue;
    lines.push(`icon ${glyphName(glyph.id, glyph.px)} viewbox=${ICON_GRID} {`, `  path "${path}" bg=none stroke=current stroke-w=${gridStroke(glyph.px)}`, "}");
  }
  lines.push(ICONS_END);
  return lines.join("\n");
}

/** The generated block as a document holds it now; null when the markers are not both there, in order. */
export function assistantIconBlock(source: string): string | null {
  const from = source.indexOf(ICONS_BEGIN);
  const to = source.indexOf(ICONS_END);
  return from < 0 || to < from ? null : source.slice(from, to + ICONS_END.length);
}

/** The document with its generated block replaced by the current one; null when it has no block. */
export function withAssistantIcons(source: string): string | null {
  const old = assistantIconBlock(source);
  return old === null ? null : source.replace(old, () => assistantIconSource());
}
