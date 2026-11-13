/**
 * The Ring and Gem dialogs: what a jeweler fills in where the command line would ask one
 * question at a time. Draw ▸ Ring and Draw ▸ Gem and the tool strip's keys open them; RING and
 * GEM typed at the command line still start the engine's prompts, and a programmatic `execute`
 * opens nothing.
 *
 * They are surfaces over the engine (`../jewelry-dialog.ts` holds the logic and says where each
 * figure comes from). Each opening reads what the engine lists (the alloys, the cuts, the stones,
 * its defaults). While the form is typed, the ring's size is named in every system by the
 * engine's `ringsizes`, and a cut shows the engine's own worked example. Neither dialog shows a
 * weight before OK, because the engine weighs only what it draws: OK runs the command's JSON form
 * through `execute`, and the line the command replies (the size, the grams, the carats) is handed
 * to the shell; the weight is read on the Bench section. A refusal is put beside the field it names, in
 * the engine's words, and the dialog stays open on it. Cancel, Escape and the close key change
 * nothing. A press outside the box closes only a form nobody has touched.
 *
 * Neither component is mounted here: the shell owns `open`.
 */

import { For, Show, type JSX } from "solid-js";
import { RING_SYSTEMS, sizeExample, type Fact, type GemField, type JewelryEngine, type RingField } from "../jewelry-dialog";
import { createGemEdit, createRingEdit } from "../jewelry-edit";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { SectionLabel } from "../ui/SectionLabel";
import { Select } from "../ui/Select";
import "../dialogs.css";

export interface JewelryDialogProps {
  /** The engine: `AppFacade` is one. Read on every opening, written on OK. */
  facade: JewelryEngine;
  /** Whether the dialog is showing. The shell holds it. */
  open: boolean;
  /** The dialog is done, with nothing placed or after `onPlaced`: the shell sets `open` false. */
  onClose: () => void;
  /** The engine placed the piece: the shell reads the drawing again and says the engine's line about it (null when it gave none). */
  onPlaced: (message: string | null) => void;
}

/** One row of a form: the label, its control, and the words under it. */
function FormRow(props: { label: string; for: string; children: JSX.Element; error?: string; errorId: string; help?: string; helpId?: string }): JSX.Element {
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
      <Show when={props.help}>
        {(words) => (
          <span class="drafting-help" id={props.helpId}>
            {words()}
          </span>
        )}
      </Show>
    </div>
  );
}

/** The engine's figures, read and not typed: a name and its value on each line. */
function Facts(props: { title: string; facts: readonly Fact[]; empty: string; note: string }): JSX.Element {
  return (
    <div class="jewelry-readout" role="group" aria-label={props.title}>
      <SectionLabel>{props.title}</SectionLabel>
      <div aria-live="polite">
        <Show when={props.facts.length > 0} fallback={<p class="drafting-help">{props.empty}</p>}>
          <dl class="jewelry-facts">
            <For each={props.facts}>
              {(fact) => (
                <div class="jewelry-fact">
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
      </div>
      <p class="drafting-help">{props.note}</p>
    </div>
  );
}

/** The footer both dialogs share: Cancel, then the action. */
function Actions(props: { onCancel: () => void; onOk: () => void }): JSX.Element {
  return (
    <>
      <Button onClick={() => props.onCancel()}>Cancel</Button>
      <Button variant="primary" type="submit" onClick={() => props.onOk()}>
        OK
      </Button>
    </>
  );
}

export function RingDialog(props: JewelryDialogProps): JSX.Element {
  let body: HTMLDivElement | undefined;

  const id = (field: RingField): string => `ring-${field}`;
  const errorId = (field: RingField): string => `ring-${field}-error`;

  // The state and what OK does are `../jewelry-edit`'s.
  const { choices, form, errors, summary, facts, sizeError, untouched, edit, apply } = createRingEdit(props, (field) => body?.querySelector<HTMLElement>(`#${id(field)}`)?.focus());

  const number = (field: "wall" | "width" | "x" | "y", label: string): JSX.Element => (
    <FormRow label={label} for={id(field)} error={errors()[field]} errorId={errorId(field)}>
      <Field
        id={id(field)}
        align="end"
        value={form()[field]}
        inputMode="decimal"
        spellcheck={false}
        autocomplete="off"
        selectOnFocus
        invalid={errors()[field] !== undefined}
        describedBy={errors()[field] === undefined ? undefined : errorId(field)}
        onInput={(value) => edit({ [field]: value }, field)}
      />
    </FormRow>
  );

  return (
    <Dialog
      open={props.open}
      title="Ring"
      size="md"
      initialFocus={`#${id("size")}`}
      describedBy={summary() === "" ? undefined : "ring-summary"}
      dismissOnBackdrop={untouched()}
      onClose={() => props.onClose()}
      footer={<Actions onCancel={() => props.onClose()} onOk={apply} />}
    >
      <div class="jewelry" ref={body}>
        <Show when={summary() !== ""}>
          <p class="drafting-summary" id="ring-summary" role="alert">
            {summary()}
          </p>
        </Show>
        <div class="drafting-group">
          <FormRow label="Size system" for={id("system")} error={errors().system} errorId={errorId("system")}>
            <Select
              id={id("system")}
              value={form().system}
              options={RING_SYSTEMS}
              invalid={errors().system !== undefined}
              describedBy={errors().system === undefined ? undefined : errorId("system")}
              onChange={(value) => edit({ system: value }, "system", "size")}
            />
          </FormRow>
          <FormRow label="Size" for={id("size")} error={sizeError()} errorId={errorId("size")}>
            <Field
              id={id("size")}
              align="end"
              value={form().size}
              placeholder={sizeExample(form().system)}
              inputMode={form().system === "uk" ? "text" : "decimal"}
              spellcheck={false}
              autocomplete="off"
              selectOnFocus
              invalid={sizeError() !== undefined}
              describedBy={sizeError() === undefined ? undefined : errorId("size")}
              onInput={(value) => edit({ size: value }, "size")}
            />
          </FormRow>
        </div>
        <Facts title="Sizes" facts={facts()} empty="Type a size to see it in every system." note="The weight is worked out by the engine when the ring is placed, and read on the Bench sheet." />
        <div class="drafting-group">
          {number("wall", "Wall, in mm")}
          {number("width", "Width, in mm")}
          <FormRow label="Metal" for={id("metal")} error={errors().metal} errorId={errorId("metal")}>
            <Select
              id={id("metal")}
              value={form().metal}
              options={choices().metals}
              invalid={errors().metal !== undefined}
              describedBy={errors().metal === undefined ? undefined : errorId("metal")}
              onChange={(value) => edit({ metal: value }, "metal")}
            />
          </FormRow>
        </div>
        <div class="drafting-group">
          {number("x", "Position X")}
          {number("y", "Position Y")}
        </div>
      </div>
    </Dialog>
  );
}

export function GemDialog(props: JewelryDialogProps): JSX.Element {
  let body: HTMLDivElement | undefined;

  const id = (field: GemField): string => `gem-${field}`;
  const errorId = (field: GemField): string => `gem-${field}-error`;

  const { choices, form, errors, summary, elongated, facts, untouched, edit, apply } = createGemEdit(props, (field) => body?.querySelector<HTMLElement>(`#${id(field)}`)?.focus());

  const number = (field: "diameter" | "length" | "width" | "x" | "y", label: string): JSX.Element => (
    <FormRow label={label} for={id(field)} error={errors()[field]} errorId={errorId(field)}>
      <Field
        id={id(field)}
        align="end"
        value={form()[field]}
        inputMode="decimal"
        spellcheck={false}
        autocomplete="off"
        selectOnFocus
        invalid={errors()[field] !== undefined}
        describedBy={errors()[field] === undefined ? undefined : errorId(field)}
        onInput={(value) => edit({ [field]: value }, field)}
      />
    </FormRow>
  );

  return (
    <Dialog
      open={props.open}
      title="Gem"
      size="md"
      initialFocus={elongated() ? `#${id("length")}` : `#${id("diameter")}`}
      describedBy={summary() === "" ? undefined : "gem-summary"}
      dismissOnBackdrop={untouched()}
      onClose={() => props.onClose()}
      footer={<Actions onCancel={() => props.onClose()} onOk={apply} />}
    >
      <div class="jewelry" ref={body}>
        <Show when={summary() !== ""}>
          <p class="drafting-summary" id="gem-summary" role="alert">
            {summary()}
          </p>
        </Show>
        <Show when={choices().note}>{(words) => <p class="drafting-help">{words()}</p>}</Show>
        <div class="drafting-group">
          <FormRow label="Cut" for={id("cut")} error={errors().cut} errorId={errorId("cut")}>
            <Select
              id={id("cut")}
              value={form().cut}
              options={choices().cuts}
              invalid={errors().cut !== undefined}
              describedBy={errors().cut === undefined ? undefined : errorId("cut")}
              onChange={(value) => edit({ cut: value }, "cut")}
            />
          </FormRow>
          <Show when={elongated()} fallback={number("diameter", "Diameter, in mm")}>
            {number("length", "Length, in mm")}
            {number("width", "Width, in mm")}
          </Show>
          <FormRow label="Stone" for={id("stone")} error={errors().stone} errorId={errorId("stone")}>
            <Select
              id={id("stone")}
              value={form().stone}
              options={choices().stones}
              invalid={errors().stone !== undefined}
              describedBy={errors().stone === undefined ? undefined : errorId("stone")}
              onChange={(value) => edit({ stone: value }, "stone")}
            />
          </FormRow>
        </div>
        <Facts title="Cut" facts={facts()} empty="The engine gave no example for this cut." note="The example is the engine's, not this stone. The carat weight is worked out when the stone is placed, and read on the Bench sheet." />
        <div class="drafting-group">
          {number("x", "Position X")}
          {number("y", "Position Y")}
        </div>
      </div>
    </Dialog>
  );
}
