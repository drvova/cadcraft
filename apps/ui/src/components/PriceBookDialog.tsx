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

import { For, Show, type JSX } from "solid-js";
import { CURRENCY_FIELD, LABOR_FIELD, metalFieldId, stoneFieldId, type BenchSheet } from "../bench";
import type { JewelryEngine } from "../jewelry-dialog";
import { createPriceBookEdit, LABOR_OPTIONS } from "../pricebook-edit";
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
  let body: HTMLDivElement | undefined;

  const errorId = (field: string): string => `price-${field.replace(":", "-")}-error`;
  const inputId = (field: string): string => `price-${field.replace(":", "-")}`;

  // The state and what Save does are shared with the Slab-drawn dialog (`../pricebook-edit`).
  const { asks, form, errors, summary, untouched, firstField, setCurrency, setMetal, setStone, setLaborMode, setLaborAmount, save } = createPriceBookEdit(props, (field) =>
    body?.querySelector<HTMLElement>(`#${CSS.escape(inputId(field))}`)?.focus(),
  );

  // `value` is read where the field reads it: read at the call, inside a `Show`, it would make
  // the row anew on every keystroke and the field being typed into would lose the keyboard.
  const priceField = (field: string, value: () => string, onInput: (v: string) => void, label: string): JSX.Element => (
    <Row label={label} for={inputId(field)} error={errors()[field]} errorId={errorId(field)}>
      <Field
        id={inputId(field)}
        align="end"
        value={value()}
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

  return (
    <Dialog
      open={props.open}
      title="Price Book"
      size="md"
      initialFocus={`#${CSS.escape(inputId(firstField()))}`}
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
            onInput={setCurrency}
          />
        </Row>
        <div class="drafting-group" role="group" aria-label="Metal, per gram">
          <SectionLabel>Metal, per gram</SectionLabel>
          <Show when={asks().metals.length > 0} fallback={<p class="drafting-help">The drawing has no band to price.</p>}>
            <For each={asks().metals}>{(ask) => priceField(metalFieldId(ask.value), () => form().metals[ask.value] ?? "", (v) => setMetal(ask.value, v), ask.label)}</For>
          </Show>
        </div>
        <div class="drafting-group" role="group" aria-label="Stones, per carat">
          <SectionLabel>Stones, per carat</SectionLabel>
          <For each={asks().materials}>{(ask) => priceField(stoneFieldId(ask.value), () => form().stones[ask.value] ?? "", (v) => setStone(ask.value, v), ask.label)}</For>
        </div>
        <div class="drafting-group">
          <Row label="Labor" for={inputId("laborMode")} errorId={errorId("laborModeNil")}>
            <Select
              id={inputId("laborMode")}
              value={form().laborMode}
              options={LABOR_OPTIONS}
              onChange={setLaborMode}
            />
          </Row>
          <Show when={form().laborMode !== "none"}>
            {priceField(LABOR_FIELD, () => form().laborAmount, setLaborAmount, "Labor amount")}
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
