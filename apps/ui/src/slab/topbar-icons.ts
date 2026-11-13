/**
 * The title bar's glyphs as Slab `icon` declarations, made by the ribbon's generator
 * (`./ribbon-icons`: `glyphBlock`) from the interface's own paths (`../icons`: `ICON_PATHS`) and
 * never copied by hand. The block between the two marker lines of `slab/topbar.slab` is this
 * file's output, and `./topbar.test.ts` holds the two equal, character for character (run it with
 * `TOPBAR_ICONS=write` to write the block again after `icons.ts` or the keys' table changed).
 */

import { LAYOUT_KEYS } from "../components/TopBar";
import { glyphBlock, glyphName, iconBlockOf, KEY_GLYPH_PX, type RibbonGlyph } from "./ribbon-icons";

/** The size the command centre's magnifier is drawn at (`--icon-size-sm`). */
export const CENTRE_GLYPH_PX = 12;

/** The command centre's magnifier and the Main menu key's glyph, by their ids of `icons.ts`. */
export const CENTRE_ICON = "search";
export const MENU_KEY_ICON = "list";

/** Every declaration the title bar needs: the magnifier, the menu key's glyph, then each layout key's. */
export function topBarGlyphs(): RibbonGlyph[] {
  return [{ name: glyphName(CENTRE_ICON), id: CENTRE_ICON, px: CENTRE_GLYPH_PX }, ...[MENU_KEY_ICON, ...LAYOUT_KEYS.map((key) => key.icon)].map((id): RibbonGlyph => ({ name: glyphName(id), id, px: KEY_GLYPH_PX }))];
}

export function topBarIconSource(): string {
  return glyphBlock(topBarGlyphs());
}

/** The document with its generated block replaced by the current one; null when it has no block. */
export function withTopBarIcons(source: string): string | null {
  const old = iconBlockOf(source);
  return old === null ? null : source.replace(old, () => topBarIconSource());
}
