/**
 * The template gallery as the Slab body takes it (`slab/template-gallery.slab`): typed list
 * params, nothing else. The templates, their groups and the words are `../templates`'s and
 * `../template-gallery-edit`'s; this file lays the cards out in rows, names their stills, and
 * reads a signal's item key back to the template it names.
 */

import { templateKind, type Template, type TemplateGroup, type ThumbMap } from "../templates";
import { paramText } from "./bench-params";
import { sentenceText } from "./piece-params";

/** One card: a `TemplateCard` of the document. A blank holds a column of a short last row. */
export interface TemplateCardParam {
  key: string;
  name: string;
  blurb: string;
  note: string;
  /** What the card's key is called, as the SolidJS key's `aria-label`. */
  said: string;
  /** The name of the still registered with the surface; "" while there is none. */
  thumb: string;
  /** The still's box: 3 high for 4 wide, as `.template-thumb`'s `aspect-ratio`. */
  thumb_h: number;
  /** The placeholder ring's side: 62% of the box, as `.template-thumb-svg`. */
  ring_px: number;
  real: boolean;
  drawn: boolean;
  plain: boolean;
  stoned: boolean;
  noted: boolean;
  /** The gap between two cards of a row. */
  spacer: boolean;
}

export interface CardRowParam {
  key: string;
  /** The gap over the row: 0 for the first of its group. */
  lead: number;
  cards: TemplateCardParam[];
}

export interface CardGroupParam {
  key: string;
  title: string;
  /** The heading as it shows: in capitals, as `SectionLabel`. */
  caps: string;
  /** The room over the group: 0 for the first, 16 between groups (`.template-group`). */
  lead: number;
  rows: CardRowParam[];
}

export interface TemplateGalleryParams {
  groups: CardGroupParam[];
}

export const GALLERY_SCALARS = [] as const;
export const GALLERY_LISTS = ["groups"] as const;
export const GALLERY_SIGNALS = ["use"] as const;

/** `.template-grid`: the smallest a card may be (13rem) and the gap between cards. */
export const CARD_MIN = 208;
export const CARD_GAP = 12;
/** The card's padding (`.template-card`). */
const CARD_PAD = 10;
/** At or under this window width the cards stand in one column (`.template-grid`'s media query). */
export const ONE_COLUMN_UPTO = 560;
/** The most columns laid out, whatever the width. */
const MAX_COLUMNS = 8;

/** How many columns of cards a body of `width` holds, as `repeat(auto-fill, minmax(13rem, 1fr))`. */
export function galleryColumns(width: number, windowWidth: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  if (Number.isFinite(windowWidth) && windowWidth <= ONE_COLUMN_UPTO) return 1;
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP))));
}

/** The height of a card's still at `columns` across a body of `width`. */
export function thumbHeight(width: number, columns: number): number {
  const across = Number.isFinite(width) && width > 0 ? width : CARD_MIN;
  const n = Number.isInteger(columns) && columns > 0 ? columns : 1;
  const card = (across - CARD_GAP * (n - 1)) / n;
  return Math.max(48, Math.round(((card - 2 * CARD_PAD) * 3) / 4));
}

/** The name a template's still is registered under with the surface. */
export const thumbName = (id: string): string => `thumb-${id}`;

/** The template a card's key names; null when it names none (a blank, a stale or forged key). */
export function templateOfItem(groups: readonly TemplateGroup[], item: string): Template | null {
  for (const group of groups) for (const template of group.templates) if (template.id === item) return template;
  return null;
}

export interface GalleryInput {
  groups: readonly TemplateGroup[];
  thumbs: ThumbMap;
  /** The templates whose stills the surface holds. */
  registered: ReadonlySet<string>;
  note: (template: Template) => string | null;
  columns: number;
  thumbH: number;
}

/** The body's params. */
export function galleryParams(input: GalleryInput): TemplateGalleryParams {
  const columns = Number.isInteger(input.columns) && input.columns > 0 ? Math.min(input.columns, MAX_COLUMNS) : 1;
  const thumbH = Number.isFinite(input.thumbH) && input.thumbH > 0 ? input.thumbH : 120;
  const ring = Math.round(thumbH * 0.62);
  const card = (template: Template): TemplateCardParam => {
    const note = input.note(template);
    const drawn = input.registered.has(template.id) && input.thumbs[template.id]?.phase === "done";
    const stoned = templateKind(template) !== "band";
    return {
      key: template.id,
      name: paramText(template.name),
      blurb: sentenceText(template.blurb),
      note: note === null ? "" : sentenceText(note),
      said: paramText(`Start from the ${template.name} template`),
      thumb: drawn ? thumbName(template.id) : "",
      thumb_h: thumbH,
      ring_px: ring,
      real: true,
      drawn,
      plain: !drawn && !stoned,
      stoned: !drawn && stoned,
      noted: note !== null,
      spacer: false,
    };
  };
  const blank = (key: string, spacer: boolean): TemplateCardParam => ({ key, name: "", blurb: "", note: "", said: "", thumb: "", thumb_h: thumbH, ring_px: ring, real: false, drawn: false, plain: false, stoned: false, noted: false, spacer });
  return {
    groups: input.groups.map((group, index) => {
      const rows: CardRowParam[] = [];
      for (let at = 0; at < group.templates.length; at += columns) {
        const shown = group.templates.slice(at, at + columns).map(card);
        for (let fill = shown.length; fill < columns; fill += 1) shown.push(blank(`blank-${fill}`, false));
        const cards = shown.flatMap((one, index) => (index === 0 ? [one] : [blank(`gap-${index}`, true), one]));
        rows.push({ key: `row-${rows.length}`, lead: rows.length === 0 ? 0 : CARD_GAP, cards });
      }
      return { key: `group-${index}`, title: paramText(group.label), caps: paramText(group.label.toUpperCase()), lead: index === 0 ? 0 : 16, rows };
    }),
  };
}

/** The width and height a PNG says it has (its IHDR chunk); null for bytes that are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  // The first chunk is IHDR: its type at 12..16, then the width and height, big-endian.
  if (String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0) !== "IHDR") return null;
  const word = (at: number): number => (((bytes[at] ?? 0) << 24) >>> 0) + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0);
  const width = word(16);
  const height = word(20);
  // A still is a few hundred pixels a side; anything else is not one of ours.
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
  return { width, height };
}
