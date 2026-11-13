/**
 * The Price Book editor as the Slab body takes it (`slab/pricebook.slab`): typed scalar and list
 * params, nothing else. What is asked, typed and refused is `../pricebook-edit`'s and `../bench`'s;
 * this file shapes it, caps it (a Slab list is laid out whole) and reads a signal's item key back
 * to the field it names.
 */

import { CURRENCY_FIELD, LABOR_FIELD, metalFieldId, stoneFieldId, type PriceAsks, type PriceForm } from "../bench";
import { paramText } from "./bench-params";
import { sentenceText } from "./piece-params";

/** One typed figure: a `FormField` of the document. */
export interface FormFieldParam {
  key: string;
  name: string;
  /** The text the field starts from. */
  shown: string;
  /** The refusal standing on it, in words; "" when there is none. */
  hint: string;
  bad: boolean;
}

/** A sentence in a list of zero or one: a `FormAlert` or a `FormNote`. */
export interface FormNoteParam {
  key: string;
  note: string;
}

export interface PriceBookParams {
  currency_hint: string;
  currency_bad: boolean;
  alerts: FormNoteParam[];
  metals: FormFieldParam[];
  bandless: FormNoteParam[];
  stones: FormFieldParam[];
  labor: FormFieldParam[];
}

/** The document's scalar params, its list params and the signals the host answers. */
export const PRICE_SCALARS = ["currency_hint", "currency_bad"] as const;
export const PRICE_LISTS = ["alerts", "metals", "bandless", "stones", "labor"] as const;
export const PRICE_SIGNALS = ["field_edit", "field_submit"] as const;

/** The most alloys and materials laid out (a piece has a handful; the engine's stone list is capped at 64). */
export const MAX_PRICE_ROWS = 64;

/** The key of the labor amount's row. */
export const LABOR_ITEM = "labor";
const metalItem = (index: number): string => `m-${index}`;
const stoneItem = (index: number): string => `s-${index}`;

const fieldParam = (key: string, label: string, value: string, error: string | undefined): FormFieldParam => ({
  key,
  name: paramText(label),
  shown: paramText(value),
  hint: error === undefined ? "" : sentenceText(error),
  bad: error !== undefined,
});

/** The body's params for the editor's state. */
export function priceBookParams(asks: PriceAsks, form: PriceForm, errors: Readonly<Record<string, string>>, summary: string): PriceBookParams {
  const metals = asks.metals.slice(0, MAX_PRICE_ROWS);
  const currency = errors[CURRENCY_FIELD];
  return {
    currency_hint: currency === undefined ? "" : sentenceText(currency),
    currency_bad: currency !== undefined,
    alerts: summary === "" ? [] : [{ key: "alert", note: sentenceText(summary) }],
    metals: metals.map((ask, index) => fieldParam(metalItem(index), ask.label, form.metals[ask.value] ?? "", errors[metalFieldId(ask.value)])),
    bandless: metals.length > 0 ? [] : [{ key: "bandless", note: "The drawing has no band to price." }],
    stones: asks.materials.slice(0, MAX_PRICE_ROWS).map((ask, index) => fieldParam(stoneItem(index), ask.label, form.stones[ask.value] ?? "", errors[stoneFieldId(ask.value)])),
    labor: form.laborMode === "none" ? [] : [fieldParam(LABOR_ITEM, "Labor amount", form.laborAmount, errors[LABOR_FIELD])],
  };
}

/** What a row's key names in the form. */
export type PriceTarget = { kind: "metal"; value: string } | { kind: "stone"; value: string } | { kind: "labor" };

/** The part of the form a signal's item key names; null when it names none shown. */
export function priceTarget(asks: PriceAsks, form: PriceForm, itemKey: string): PriceTarget | null {
  if (itemKey === LABOR_ITEM) return form.laborMode === "none" ? null : { kind: "labor" };
  const m = /^([ms])-(\d{1,2})$/.exec(itemKey);
  if (m === null) return null;
  const index = Number(m[2]);
  if (index >= MAX_PRICE_ROWS) return null;
  const ask = (m[1] === "m" ? asks.metals : asks.materials)[index];
  if (ask === undefined) return null;
  return m[1] === "m" ? { kind: "metal", value: ask.value } : { kind: "stone", value: ask.value };
}

/**
 * The row a field id of the form (`metal:…`, `stone:…`, `labor`) is drawn as; null for the
 * currency (the host's field, in a hole) and for a field no row shows.
 */
export function priceItem(asks: PriceAsks, fieldId: string): string | null {
  if (fieldId === LABOR_FIELD) return LABOR_ITEM;
  const metal = asks.metals.slice(0, MAX_PRICE_ROWS).findIndex((ask) => metalFieldId(ask.value) === fieldId);
  if (metal >= 0) return metalItem(metal);
  const stone = asks.materials.slice(0, MAX_PRICE_ROWS).findIndex((ask) => stoneFieldId(ask.value) === fieldId);
  return stone >= 0 ? stoneItem(stone) : null;
}

/** The form's value for every row, by row key: what the fields' buffers are held to. */
export function priceValues(params: PriceBookParams): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of [...params.metals, ...params.stones, ...params.labor]) out.set(row.key, row.shown);
  return out;
}
