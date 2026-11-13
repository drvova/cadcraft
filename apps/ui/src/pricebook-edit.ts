/**
 * The Price Book editor's state, apart from any view: what it asks about, the form as typed, the
 * refusals standing on it and what Save does. The SolidJS dialog
 * (`./components/PriceBookDialog.tsx`) and the one whose body Slab draws
 * (`./slab/SlabPriceBook.tsx`) both run on it, so neither forks the other's behaviour. The rules
 * themselves (what a price is, what the engine is sent) are `./bench`'s.
 */

import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import {
  CURRENCY_FIELD,
  hasAnyPrice,
  LABOR_FIELD,
  metalFieldId,
  planPriceBook,
  priceAsks,
  priceForm,
  priceRefusalField,
  stoneFieldId,
  type BenchSheet,
  type LaborMode,
  type PriceAsks,
  type PriceForm,
} from "./bench";
import type { Envelope } from "./facade";
import { parseGemList, type JewelryEngine } from "./jewelry-dialog";

/** What the editor is given: the dialog's own props. */
export interface PriceBookSource {
  facade: JewelryEngine;
  open: boolean;
  sheet: BenchSheet | null;
  onClose: () => void;
  onSaved: () => void;
}

export const LABOR_OPTIONS = [
  { value: "none", label: "No labor charge" },
  { value: "flat", label: "Flat sum for the piece" },
  { value: "perStone", label: "Per stone set" },
  { value: "perGram", label: "Per gram of metal" },
] as const;

const EMPTY_ASKS: PriceAsks = { metals: [], materials: [] };
const EMPTY_FORM: PriceForm = { currency: "USD", metals: {}, stones: {}, laborMode: "none", laborAmount: "" };

export interface PriceBookEdit {
  asks: Accessor<PriceAsks>;
  form: Accessor<PriceForm>;
  /** The refusal standing on each field, by field id (`metal:…`, `stone:…`, `labor`, `currency`). */
  errors: Accessor<Record<string, string>>;
  /** What happened to the whole form; "" when nothing did. */
  summary: Accessor<string>;
  /** No price has been typed: a press outside the box may close. */
  untouched: Accessor<boolean>;
  /** The field the focus goes to on opening. */
  firstField: () => string;
  setCurrency: (value: string) => void;
  setMetal: (alloy: string, value: string) => void;
  setStone: (material: string, value: string) => void;
  setLaborMode: (value: string) => void;
  setLaborAmount: (value: string) => void;
  /** Store the book; on success the shell is told and the dialog closes, else the refusal stands. */
  save: () => void;
}

/**
 * The editor over the dialog's props. `focusField` is the view's: it puts the keyboard on the
 * field a refusal names, once the refusal shows.
 */
export function createPriceBookEdit(props: PriceBookSource, focusField: (field: string) => void): PriceBookEdit {
  const [asks, setAsks] = createSignal<PriceAsks>(EMPTY_ASKS);
  const [form, setForm] = createSignal<PriceForm>(EMPTY_FORM);
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [summary, setSummary] = createSignal("");

  // Every opening reads the engine afresh: the materials in the piece, and the stored book.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        let stones: Envelope;
        try {
          stones = props.facade.execute("gemlist", {});
        } catch {
          stones = { ok: false, error: "gemlist unavailable" } as Envelope;
        }
        const list = stones.ok ? parseGemList(stones.result) : { cuts: [], stones: [] };
        const held = priceAsks(props.sheet, list.stones);
        let book: unknown = null;
        try {
          const reply = props.facade.execute("pricebook", {});
          if (reply.ok && reply.result !== null && typeof reply.result === "object") book = (reply.result as Record<string, unknown>)["book"];
        } catch {
          book = null;
        }
        setAsks(held);
        setForm(priceForm(book, held));
        setErrors({});
        setSummary("");
      },
    ),
  );

  const clearError = (field: string): void => {
    setSummary("");
    if (errors()[field] !== undefined) {
      setErrors((held) => {
        const next = { ...held };
        delete next[field];
        return next;
      });
    }
  };

  const mark = (found: Record<string, string>): void => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first === undefined) return;
    queueMicrotask(() => focusField(first));
  };

  const untouched = createMemo(() => !hasAnyPrice(form()));

  const save = (): void => {
    if (!hasAnyPrice(form())) {
      setErrors({});
      setSummary("Enter at least one price to estimate a cost.");
      return;
    }
    const plan = planPriceBook(form());
    if (!plan.ok) {
      setSummary("");
      mark(plan.errors);
      return;
    }
    let reply: Envelope;
    try {
      reply = props.facade.execute("pricebook", plan.params);
    } catch {
      setSummary("The engine could not store the price book.");
      return;
    }
    if (reply.ok) {
      props.onSaved();
      props.onClose();
      return;
    }
    const field = priceRefusalField(reply.error);
    if (field === null) {
      setErrors({});
      setSummary(reply.error.slice(0, 400));
    } else {
      setSummary("");
      mark({ [field]: reply.error.slice(0, 400) });
    }
  };

  const firstField = (): string => {
    const metal = asks().metals[0];
    if (metal !== undefined) return metalFieldId(metal.value);
    const stone = asks().materials[0];
    return stone === undefined ? CURRENCY_FIELD : stoneFieldId(stone.value);
  };

  return {
    asks,
    form,
    errors,
    summary,
    untouched,
    firstField,
    setCurrency: (value) => {
      setForm((held) => ({ ...held, currency: value }));
      clearError(CURRENCY_FIELD);
    },
    setMetal: (alloy, value) => {
      setForm((held) => ({ ...held, metals: { ...held.metals, [alloy]: value } }));
      clearError(metalFieldId(alloy));
    },
    setStone: (material, value) => {
      setForm((held) => ({ ...held, stones: { ...held.stones, [material]: value } }));
      clearError(stoneFieldId(material));
    },
    setLaborMode: (value) => {
      setForm((held) => ({ ...held, laborMode: value as LaborMode }));
      clearError(LABOR_FIELD);
    },
    setLaborAmount: (value) => {
      setForm((held) => ({ ...held, laborAmount: value }));
      clearError(LABOR_FIELD);
    },
    save,
  };
}
