/**
 * The template gallery whose cards Slab draws: the params it is handed
 * (`./template-gallery-params`), the state both galleries share (`../template-gallery-edit`), and
 * the document itself (`slab/template-gallery.slab`), read as text: the vendored compiler is not
 * loaded under `bun test`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { createTemplateGallery, type TemplateGalleryEdit } from "../template-gallery-edit";
import { groupTemplates, initialThumbs, markDone, markFailed, TEMPLATES, type Template, type ThumbMap } from "../templates";
import { CARD_GAP, CARD_MIN, galleryColumns, galleryParams, GALLERY_LISTS, GALLERY_SCALARS, GALLERY_SIGNALS, pngSize, templateOfItem, thumbHeight, thumbName, type GalleryInput } from "./template-gallery-params";

const ui = join(import.meta.dir, "..", "..");
/** Spelled apart so the design-system check does not read the fixture as a colour in the interface. */
const H = "#";
const GROUPS = groupTemplates(TEMPLATES);

const input = (over: Partial<GalleryInput> = {}): GalleryInput => ({ groups: GROUPS, thumbs: initialThumbs(TEMPLATES), registered: new Set(), note: () => null, columns: 3, thumbH: 180, ...over });

/** The cards of a group's rows, by key, the gaps left out. */
const cardKeys = (p: ReturnType<typeof galleryParams>, group: number): string[][] => (p.groups[group]?.rows ?? []).map((row) => row.cards.filter((card) => !card.spacer).map((card) => card.key));

describe("the grid", () => {
  test("as many columns as the body holds at 13rem and a 12px gap, one on a phone", () => {
    expect(galleryColumns(CARD_MIN, 1280)).toBe(1);
    expect(galleryColumns(2 * CARD_MIN + CARD_GAP, 1280)).toBe(2);
    expect(galleryColumns(2 * CARD_MIN + CARD_GAP - 1, 1280)).toBe(1);
    expect(galleryColumns(818, 1280)).toBe(3);
    expect(galleryColumns(818, 390)).toBe(1);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(galleryColumns(bad, 1280)).toBe(1);
    expect(galleryColumns(1e9, 1280)).toBeLessThanOrEqual(8);
  });

  test("the still is 3 high for 4 wide inside the card's padding", () => {
    expect(thumbHeight(818, 3)).toBe(Math.round(((818 - 2 * 12) / 3 - 20) * 0.75));
    expect(thumbHeight(358, 1)).toBe(254);
    for (const bad of [0, Number.NaN]) expect(Number.isFinite(thumbHeight(bad, 3))).toBe(true);
    expect(thumbHeight(100, 0)).toBeGreaterThan(0);
  });

  test("a group's cards in rows of the columns, a short last row filled with blanks, a gap between two cards", () => {
    const p = galleryParams(input());
    expect(p.groups.map((group) => group.title)).toEqual(GROUPS.map((group) => group.label));
    expect(p.groups.map((group) => group.caps)).toEqual(GROUPS.map((group) => group.label.toUpperCase()));
    expect(p.groups.map((group) => group.lead)).toEqual(GROUPS.map((_, index) => (index === 0 ? 0 : 16)));
    const bands = GROUPS.findIndex((group) => group.kind === "band");
    expect(cardKeys(p, bands)).toEqual([
      ["plain-band", "comfort-band", "court-band"],
      ["signet-band", "blank-1", "blank-2"],
    ]);
    const rows = p.groups[bands]?.rows ?? [];
    expect(rows.map((row) => row.lead)).toEqual([0, CARD_GAP]);
    expect(rows[0]?.cards.map((card) => card.spacer)).toEqual([false, true, false, true, false]);
    expect(rows[1]?.cards.filter((card) => !card.spacer && !card.real).length).toBe(2);
    // Keys are unique in each list (the driver refuses a list with a duplicate).
    for (const group of p.groups) for (const row of group.rows) expect(new Set(row.cards.map((card) => card.key)).size).toBe(row.cards.length);
    // One column: every card on its own row, no gap, no blank.
    const one = galleryParams(input({ columns: 1 }));
    expect(cardKeys(one, bands)).toEqual([["plain-band"], ["comfort-band"], ["court-band"], ["signet-band"]]);
    expect(one.groups[bands]?.rows.every((row) => row.cards.length === 1)).toBe(true);
  });

  test("a hostile column count is one column, and never more than eight", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(galleryParams(input({ columns: bad })).groups[0]?.rows[0]?.cards.length).toBe(1);
    expect(galleryParams(input({ columns: 1000 })).groups[0]?.rows[0]?.cards.filter((card) => !card.spacer).length).toBe(8);
  });
});

describe("a card", () => {
  const find = (p: ReturnType<typeof galleryParams>, id: string) => p.groups.flatMap((group) => group.rows.flatMap((row) => row.cards)).find((card) => card.key === id);

  test("shows the drawn ring until its still is registered, a stone over it for a set piece", () => {
    const p = galleryParams(input());
    expect(find(p, "plain-band")).toMatchObject({ real: true, drawn: false, plain: true, stoned: false, thumb: "" });
    expect(find(p, "solitaire-round")).toMatchObject({ drawn: false, plain: false, stoned: true });
    expect(find(p, "solitaire-round")?.said).toBe("Start from the Round Solitaire template");
    expect(find(p, "solitaire-round")?.ring_px).toBe(Math.round(180 * 0.62));
  });

  test("shows its still once it is drawn and the surface holds it, not before", () => {
    const thumbs: ThumbMap = markDone(initialThumbs(TEMPLATES), "plain-band", "blob:x");
    expect(find(galleryParams(input({ thumbs })), "plain-band")?.drawn).toBe(false);
    const p = galleryParams(input({ thumbs, registered: new Set(["plain-band"]) }));
    expect(find(p, "plain-band")).toMatchObject({ drawn: true, plain: false, stoned: false, thumb: thumbName("plain-band") });
  });

  test("a refusal or a preview that could not be drawn is the card's note", () => {
    const thumbs = markFailed(initialThumbs(TEMPLATES), "court-band", "Needs a newer engine for the court profile.");
    const note = (template: Template): string | null => (template.id === "eternity-band" ? "piece: refused" : thumbs[template.id]?.message ?? null);
    const p = galleryParams(input({ thumbs, note }));
    expect(find(p, "court-band")).toMatchObject({ noted: true, note: "Needs a newer engine for the court profile.", plain: true });
    expect(find(p, "eternity-band")).toMatchObject({ noted: true, note: "piece: refused" });
    expect(find(p, "plain-band")).toMatchObject({ noted: false, note: "" });
  });

  test("a signal's key names its template; a blank, a gap or a forged key names nothing", () => {
    expect(templateOfItem(GROUPS, "court-band")?.name).toBe("Court Band");
    for (const bad of ["", "blank-1", "gap-1", "row-0", "group-0", "__proto__", "constructor", "x".repeat(5000)]) expect(templateOfItem(GROUPS, bad)).toBeNull();
  });
});

describe("a still's bytes", () => {
  /** The first 24 bytes of a PNG of `w` by `h`. */
  const head = (w: number, h: number): Uint8Array => {
    const out = new Uint8Array(33);
    out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(out.buffer).setUint32(16, w);
    new DataView(out.buffer).setUint32(20, h);
    return out;
  };

  test("a PNG says its size; anything else is not one of ours", () => {
    expect(pngSize(head(320, 240))).toEqual({ width: 320, height: 240 });
    expect(pngSize(new Uint8Array(0))).toBeNull();
    expect(pngSize(head(320, 240).slice(0, 20))).toBeNull();
    expect(pngSize(head(0, 240))).toBeNull();
    expect(pngSize(head(0xffffffff, 240))).toBeNull();
    const notPng = head(320, 240);
    notPng[1] = 0;
    expect(pngSize(notPng)).toBeNull();
    const notIhdr = head(320, 240);
    notIhdr[12] = 0x58;
    expect(pngSize(notIhdr)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The state both galleries run on
// ---------------------------------------------------------------------------------------------

interface Opened {
  gallery: TemplateGalleryEdit;
  chosen: Record<string, unknown>[];
  closed: () => number;
  dispose: () => void;
}

/**
 * The gallery's state over a dialog's props, as either view makes it. Under `bun test` Solid's
 * core is its server build: effects never run, so the drawing of the stills is not exercised here
 * (it is in the browser run, and the drawer is swapped for one that is never called). The choice is.
 */
function opened(refuse: (params: Record<string, unknown>) => string | null): Opened {
  const chosen: Record<string, unknown>[] = [];
  let closed = 0;
  return createRoot((dispose) => {
    const gallery = createTemplateGallery(
      {
        open: true,
        onClose: () => (closed += 1),
        execute: () => ({ ok: false, error: "unused" }),
        onChoose: (params) => {
          chosen.push(params);
          return refuse(params);
        },
      },
      () => Promise.resolve({ message: "not drawn here" }),
    );
    return { gallery, chosen, closed: () => closed, dispose };
  });
}

describe("the gallery's state, as both galleries run it", () => {
  test("a template that is built closes the gallery, with its own copy of the parameters", () => {
    const o = opened(() => null);
    const template = templateOfItem(o.gallery.groups, "plain-band");
    if (template === null) throw new Error("no plain band");
    o.gallery.choose(template);
    expect(o.chosen).toEqual([{ ...template.params }]);
    expect(o.chosen[0]).not.toBe(template.params);
    expect(o.closed()).toBe(1);
    expect(o.gallery.note(template)).toBeNull();
    o.dispose();
  });

  test("a refused template leaves the gallery open with the refusal on its card", () => {
    const o = opened(() => "piece: unknown kind `threestone`");
    const template = templateOfItem(o.gallery.groups, "three-stone");
    if (template === null) throw new Error("no three-stone");
    o.gallery.choose(template);
    expect(o.closed()).toBe(0);
    expect(o.gallery.note(template)).toBe("Needs a newer engine for the three-stone setting.");
    const other = templateOfItem(o.gallery.groups, "plain-band");
    if (other === null) throw new Error("no plain band");
    expect(o.gallery.note(other)).toBeNull();
    o.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

describe("the document", () => {
  const source = readFileSync(join(ui, "slab", "template-gallery.slab"), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const flat = code.replace(/\\\n\s*/g, " ");
  const props = (name: string): string[] =>
    (new RegExp(`def ${name}\\(([^)]*)\\)`).exec(flat)?.[1] ?? "")
      .split(",")
      .map((part) => part.trim().split("=")[0] ?? "")
      .filter((part) => part !== "");

  test("declares every param the host sets, and no other", () => {
    const declared = [...code.slice(code.indexOf("params {"), code.indexOf("col #body")).matchAll(/^\s+([a-z_]+)\s+(text|bool|num|list\()/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...GALLERY_SCALARS, ...GALLERY_LISTS].sort());
  });

  test("fires the signals the host answers, and no other", () => {
    const fired = new Set([...code.matchAll(/\b(?:act|field|submit)=([a-z_]+)/g)].map((m) => m[1]));
    expect([...fired].sort()).toEqual([...GALLERY_SIGNALS].sort());
  });

  test("each item carries the fields the params give it", () => {
    const p = galleryParams(input());
    const group = p.groups[0];
    const row = group?.rows[0];
    const fields = (item: object | undefined): string[] => Object.keys(item ?? {}).filter((name) => name !== "key").sort();
    expect(fields(group)).toEqual(props("CardGroup").sort());
    expect(fields(row)).toEqual(props("CardRow").sort());
    expect(fields(row?.cards[0])).toEqual(props("TemplateCard").sort());
  });

  test("has no hole, and lays out no `each` under `wrap`", () => {
    expect(code).not.toMatch(/\bhole\b/);
    expect(code).not.toMatch(/\bwrap\b/);
  });

  test("takes its colours from the token sheet, names no font, and draws only the placeholder of the SolidJS gallery", () => {
    expect(code).not.toMatch(new RegExp(`${H}[0-9a-fA-F]{3,8}\\b`));
    expect(code).toContain('import "gen/tokens.slab"');
    expect(code).not.toMatch(/\bfamily\b|\.(ttf|otf|woff2?|shx|png|svg)\b/i);
    for (const m of code.matchAll(/\bstyle=([a-z.-]+)/g)) expect(m[1]).toMatch(/^text\.(body|label|chip)$/);
    // The ring and its stone are `PlaceholderRing`'s own figures, on its 100 box.
    const gallery = readFileSync(join(ui, "src", "components", "TemplateGallery.tsx"), "utf8");
    expect(gallery).toContain('cx="50" cy="56" r="26"');
    expect(gallery).toContain('d="M50 12 L59 23 L50 34 L41 23 Z"');
    expect([...code.matchAll(/^icon ([a-z-]+) viewbox=100/gm)].map((m) => m[1])).toEqual(["ring-plain", "ring-stoned"]);
    expect(code).toContain('path "M24 56a26 26 0 1 0 52 0a26 26 0 1 0 -52 0"');
    expect(code).toContain('path "M50 12L59 23L50 34L41 23Z"');
  });

  test("every card is a list item named by its template, and its key says what it does", () => {
    expect(code).toMatch(/role=listitem label=name/);
    expect(code).toMatch(/act=use role=button label=said/);
    expect(code).toMatch(/role=heading level=2 label=title/);
    expect(code).toMatch(/role="list" label=title/);
  });
});
