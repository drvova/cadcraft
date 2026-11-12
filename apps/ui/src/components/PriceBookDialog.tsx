/**
 * The Price Book editor: what a piece costs in metal and stones, from the jeweler's own prices.
 * The engine holds no market prices; every figure here is one the user types. It opens from the
 * Bench section when there is no cost yet ("Set prices to estimate cost") and from the cost group
 * ("Edit prices").
 *
 * What it asks about comes from the engine, not a hardcoded list: the alloys the drawing's bands
 * are in (priced per gram) and the materials its stones are (priced per carat, named from their
 * gravity through `gemlist`), plus a catch-all for any the names miss, and one labor figure. Save
 * runs `pricebook {set:{…}}` and, on success, the shell re-reads the bench sheet so the cost
 * appears; a refusal stays in the dialog beside the field it names.
 *
 * The component is not mounted here: the shell owns `open`. All the logic lives in `../bench`.
 */

import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
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
} from "../bench";
import type { Envelope } from "../facade";
import { parseGemList, type JewelryEngine } from "../jewelry-dialog";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Select } from "../ui/Select";
import { SectionLabel } from "../ui/SectionLabel";
import "../dialogs.css";

export interface PriceBookDialogProps {
  /** The engine: read on opening (its stone list and the stored book), written on Save. */
  facade: JewelryEngine;
  /** Whether the dialog is showing. The shell holds it. */
  open: boolean;
  /** The bench sheet in front: the alloys and materials the editor asks about come from it. */
  sheet: BenchSheet | null;
  /** The dialog is done, placed nothing: the shell sets `open` false. */
  onClose: () => void;
  /** The book was saved: the shell re-reads the bench sheet so the cost appears. */
  onSaved: () => void;
}

const LABOR_OPTIONS = [
  { value: "none", label: "No labor charge" },
  { value: "flat", label: "Flat sum for the piece" },
  { value: "perStone", label: "Per stone set" },
  { value: "perGram", label: "Per gram of metal" },
] as const;

const EMPTY_ASKS: PriceAsks = { metals: [], materials: [] };
const EMPTY_FORM: PriceForm = { currency: "USD", metals: {}, stones: {}, laborMode: "none", laborAmount: "" };

/** One labelled field of the form, with its error line under it. */
function Row(props: { label: string; for: string; children: JSX.Element; error?: string; errorId: string }): JSX.Element {
  return (
    <div class="jewelry-row">
      <div class="drafting-pair">
        <label class="drafting-label" for={props.for}>
          {props.label}
        </label>
        {props.children}
      </div>
      <Show when={props.error}>
        {(words) => (
          <span class="drafting-error" id={props.errorId}>
            {words()}
          </span>
        )}
      </Show>
    </div>
  );
}

export function PriceBookDialog(props: PriceBookDialogProps): JSX.Element {
  const [asks, setAsks] = createSignal<PriceAsks>(EMPTY_ASKS);
  const [form, setForm] = createSignal<PriceForm>(EMPTY_FORM);
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [summary, setSummary] = createSignal("");
  let body: HTMLDivElement | undefined;

  const errorId = (field: string): string => `price-${field.replace(":", "-")}-error`;
  const inputId = (field: string): string => `price-${field.replace(":", "-")}`;

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

  const setMetal = (alloy: string, value: string): void => {
    setForm((held) => ({ ...held, metals: { ...held.metals, [alloy]: value } }));
    clearError(metalFieldId(alloy));
  };
  const setStone = (material: string, value: string): void => {
    setForm((held) => ({ ...held, stones: { ...held.stones, [material]: value } }));
    clearError(stoneFieldId(material));
  };

  const mark = (found: Record<string, string>): void => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first === undefined) return;
    queueMicrotask(() => body?.querySelector<HTMLElement>(`#${CSS.escape(inputId(first))}`)?.focus());
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

  const priceField = (field: string, value: string, onInput: (v: string) => void, label: string): JSX.Element => (
    <Row label={label} for={inputId(field)} error={errors()[field]} errorId={errorId(field)}>
      <Field
        id={inputId(field)}
        align="end"
        value={value}
        inputMode="decimal"
        spellcheck={false}
        autocomplete="off"
        selectOnFocus
        invalid={errors()[field] !== undefined}
        describedBy={errors()[field] === undefined ? undefined : errorId(field)}
        onInput={onInput}
      />
    </Row>
  );

  const firstField = (): string => {
    const metal = asks().metals[0];
    if (metal !== undefined) return `#${CSS.escape(inputId(metalFieldId(metal.value)))}`;
    const stone = asks().materials[0];
    return stone === undefined ? `#${CSS.escape(inputId(CURRENCY_FIELD))}` : `#${CSS.escape(inputId(stoneFieldId(stone.value)))}`;
  };

  return (
    <Dialog
      open={props.open}
      title="Price Book"
      size="md"
      initialFocus={firstField()}
      describedBy="price-intro"
      dismissOnBackdrop={untouched()}
      onClose={() => props.onClose()}
      footer={
        <>
          <Button onClick={() => props.onClose()}>Cancel</Button>
          <Button variant="primary" type="submit" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div class="jewelry" ref={body}>
        <p class="drafting-help" id="price-intro">
          These are your own prices, not market quotes. The bench sheet totals an estimate from them.
        </p>
        <Show when={summary() !== ""}>
          <p class="drafting-summary" id="price-summary" role="alert">
            {summary()}
          </p>
        </Show>
        <Row label="Currency" for={inputId(CURRENCY_FIELD)} error={errors()[CURRENCY_FIELD]} errorId={errorId(CURRENCY_FIELD)}>
          <Field
            id={inputId(CURRENCY_FIELD)}
            value={form().currency}
            maxLength={8}
            spellcheck={false}
            autocomplete="off"
            selectOnFocus
            invalid={errors()[CURRENCY_FIELD] !== undefined}
            describedBy={errors()[CURRENCY_FIELD] === undefined ? undefined : errorId(CURRENCY_FIELD)}
            onInput={(value) => {
              setForm((held) => ({ ...held, currency: value }));
              clearError(CURRENCY_FIELD);
            }}
          />
        </Row>
        <div class="drafting-group" role="group" aria-label="Metal, per gram">
          <SectionLabel>Metal, per gram</SectionLabel>
          <Show when={asks().metals.length > 0} fallback={<p class="drafting-help">The drawing has no band to price.</p>}>
            <For each={asks().metals}>{(ask) => priceField(metalFieldId(ask.value), form().metals[ask.value] ?? "", (v) => setMetal(ask.value, v), ask.label)}</For>
          </Show>
        </div>
        <div class="drafting-group" role="group" aria-label="Stones, per carat">
          <SectionLabel>Stones, per carat</SectionLabel>
          <For each={asks().materials}>{(ask) => priceField(stoneFieldId(ask.value), form().stones[ask.value] ?? "", (v) => setStone(ask.value, v), ask.label)}</For>
        </div>
        <div class="drafting-group">
          <Row label="Labor" for={inputId("laborMode")} errorId={errorId("laborModeNil")}>
            <Select
              id={inputId("laborMode")}
              value={form().laborMode}
              options={LABOR_OPTIONS}
              onChange={(value) => {
                setForm((held) => ({ ...held, laborMode: value as LaborMode }));
                clearError(LABOR_FIELD);
              }}
            />
          </Row>
          <Show when={form().laborMode !== "none"}>
            {priceField(LABOR_FIELD, form().laborAmount, (v) => {
              setForm((held) => ({ ...held, laborAmount: v }));
              clearError(LABOR_FIELD);
            }, "Labor amount")}
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
