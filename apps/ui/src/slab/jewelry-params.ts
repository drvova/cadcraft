/**
 * The Ring and Gem dialogs as the Slab body takes them (`slab/jewelry-dialog.slab`): typed scalar
 * and list params, nothing else. One document draws both; `gem` says which. What is listed,
 * typed and refused is `../jewelry-edit`'s and `../jewelry-dialog`'s; this file shapes it, caps
 * it and reads a signal's item key back to the field it names.
 */

import { sizeExample, type Fact, type GemErrors, type GemForm, type RingErrors, type RingForm } from "../jewelry-dialog";
import { paramText } from "./bench-params";
import { sentenceText } from "./piece-params";

/** One typed measure: a `FormField` of the document. Its key is the form's field. */
export interface JewelryFieldParam {
  key: string;
  name: string;
  /** The text the field starts from. */
  shown: string;
  /** The refusal standing on it, in words; "" when there is none. */
  hint: string;
  bad: boolean;
  /** The example to go by, shown under an empty field (the kernel's field has no placeholder). */
  eg: string;
  blank: boolean;
}

/** A sentence in a list of zero or one. */
export interface JewelryNoteParam {
  key: string;
  note: string;
}

/** One of the engine's figures: a `FormFact`. */
export interface JewelryFactParam {
  key: string;
  name: string;
  amount: string;
  /** The line as a screen reader is told it ("US: 6.5"). */
  said: string;
}

export interface JewelryParams {
  gem: boolean;
  alerts: JewelryNoteParam[];
  notes: JewelryNoteParam[];
  first_name: string;
  first_hint: string;
  first_bad: boolean;
  top: JewelryFieldParam[];
  stone_hint: string;
  stone_bad: boolean;
  facts_head: string;
  facts_title: string;
  facts: JewelryFactParam[];
  facts_empty: JewelryNoteParam[];
  facts_note: string;
  mid: JewelryFieldParam[];
  metal_hint: string;
  metal_bad: boolean;
  place: JewelryFieldParam[];
}

/** The document's scalar params, its list params and the signals the host answers. */
export const JEWELRY_SCALARS = ["gem", "first_name", "first_hint", "first_bad", "stone_hint", "stone_bad", "facts_head", "facts_title", "facts_note", "metal_hint", "metal_bad"] as const;
export const JEWELRY_LISTS = ["alerts", "notes", "top", "facts", "facts_empty", "mid", "place"] as const;
export const JEWELRY_SIGNALS = ["field_edit", "field_submit"] as const;

/** The most figures laid out (the engine names a size in five systems, and a cut in a handful of lines). */
export const MAX_JEWELRY_FACTS = 12;

/** The fields of each form that are typed (the rest are picked from a list, in a hole). */
export const RING_TYPED = ["size", "wall", "width", "x", "y"] as const;
export const GEM_TYPED = ["diameter", "length", "width", "x", "y"] as const;
export type RingTyped = (typeof RING_TYPED)[number];
export type GemTyped = (typeof GEM_TYPED)[number];

/** The typed field of the ring's form a signal's item key names; null when it names none. */
export function ringTyped(itemKey: string): RingTyped | null {
  return RING_TYPED.find((field) => field === itemKey) ?? null;
}

/** The typed field of the gem's form a signal's item key names, among those the cut shows; null otherwise. */
export function gemTyped(itemKey: string, elongated: boolean): GemTyped | null {
  const field = GEM_TYPED.find((name) => name === itemKey) ?? null;
  if (field === "diameter") return elongated ? null : field;
  if (field === "length" || field === "width") return elongated ? field : null;
  return field;
}

const field = (key: string, label: string, value: string, error: string | undefined, eg = ""): JewelryFieldParam => ({
  key,
  name: paramText(label),
  shown: paramText(value),
  hint: error === undefined ? "" : sentenceText(error),
  bad: error !== undefined,
  eg: paramText(eg),
  blank: eg !== "" && error === undefined && value.trim() === "",
});

const words = (text: string | undefined): string => (text === undefined ? "" : sentenceText(text));
const one = (key: string, text: string | null | undefined): JewelryNoteParam[] => (text === undefined || text === null || text === "" ? [] : [{ key, note: sentenceText(text) }]);

function factParams(facts: readonly Fact[]): JewelryFactParam[] {
  return facts.slice(0, MAX_JEWELRY_FACTS).map((fact, index) => {
    const name = paramText(fact.label);
    const amount = sentenceText(fact.value);
    return { key: `fact-${index}`, name, amount, said: `${name}: ${amount}` };
  });
}

/** What the Ring dialog shows beside its form. */
export interface RingView {
  errors: RingErrors;
  /** The words under the size: what OK found, else what the engine says of it as it is typed. */
  sizeError: string | undefined;
  summary: string;
  facts: readonly Fact[];
}

/** The body's params for the Ring dialog. */
export function ringParams(form: RingForm, view: RingView): JewelryParams {
  const facts = factParams(view.facts);
  return {
    gem: false,
    alerts: one("alert", view.summary),
    notes: [],
    first_name: "Size system",
    first_hint: words(view.errors.system),
    first_bad: view.errors.system !== undefined,
    top: [field("size", "Size", form.size, view.sizeError, `For example ${sizeExample(form.system)}`)],
    stone_hint: "",
    stone_bad: false,
    facts_head: "SIZES",
    facts_title: "Sizes",
    facts,
    facts_empty: facts.length > 0 ? [] : one("empty", "Type a size to see it in every system."),
    facts_note: "The weight is worked out by the engine when the ring is placed, and read on the Bench sheet.",
    mid: [field("wall", "Wall, in mm", form.wall, view.errors.wall), field("width", "Width, in mm", form.width, view.errors.width)],
    metal_hint: words(view.errors.metal),
    metal_bad: view.errors.metal !== undefined,
    place: [field("x", "Position X", form.x, view.errors.x), field("y", "Position Y", form.y, view.errors.y)],
  };
}

/** What the Gem dialog shows beside its form. */
export interface GemView {
  errors: GemErrors;
  summary: string;
  /** The engine's note over the form; null when it gave none. */
  note: string | null;
  elongated: boolean;
  facts: readonly Fact[];
}

/** The body's params for the Gem dialog. */
export function gemParams(form: GemForm, view: GemView): JewelryParams {
  const facts = factParams(view.facts);
  return {
    gem: true,
    alerts: one("alert", view.summary),
    notes: one("note", view.note),
    first_name: "Cut",
    first_hint: words(view.errors.cut),
    first_bad: view.errors.cut !== undefined,
    top: view.elongated
      ? [field("length", "Length, in mm", form.length, view.errors.length), field("width", "Width, in mm", form.width, view.errors.width)]
      : [field("diameter", "Diameter, in mm", form.diameter, view.errors.diameter)],
    stone_hint: words(view.errors.stone),
    stone_bad: view.errors.stone !== undefined,
    facts_head: "CUT",
    facts_title: "Cut",
    facts,
    facts_empty: facts.length > 0 ? [] : one("empty", "The engine gave no example for this cut."),
    facts_note: "The example is the engine's, not this stone. The carat weight is worked out when the stone is placed, and read on the Bench sheet.",
    mid: [],
    metal_hint: "",
    metal_bad: false,
    place: [field("x", "Position X", form.x, view.errors.x), field("y", "Position Y", form.y, view.errors.y)],
  };
}

/** The form's value for every typed row, by row key: what the fields' buffers are held to. */
export function jewelryValues(params: JewelryParams): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of [...params.top, ...params.mid, ...params.place]) out.set(row.key, row.shown);
  return out;
}
