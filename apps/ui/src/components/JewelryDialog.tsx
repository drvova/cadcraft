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

import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
import {
  gemFacts,
  gemRefusalField,
  isElongated,
  place,
  planGem,
  planRing,
  previewRing,
  readGemChoices,
  readRingChoices,
  RING_SYSTEMS,
  ringRefusalField,
  ringSizeQuery,
  sizeExample,
  type Fact,
  type GemChoices,
  type GemErrors,
  type GemField,
  type GemForm,
  type JewelryEngine,
  type RingChoices,
  type RingErrors,
  type RingField,
  type RingForm,
  type RingPreview,
} from "../jewelry-dialog";
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

const NO_RING: RingChoices = { metals: [], form: { system: "us", size: "", wall: "", width: "", metal: "", x: "0", y: "0" } };

export function RingDialog(props: JewelryDialogProps): JSX.Element {
  const [choices, setChoices] = createSignal<RingChoices>(NO_RING);
  const [form, setForm] = createSignal<RingForm>(NO_RING.form);
  const [errors, setErrors] = createSignal<RingErrors>({});
  const [summary, setSummary] = createSignal("");
  let body: HTMLDivElement | undefined;

  const id = (field: RingField): string => `ring-${field}`;
  const errorId = (field: RingField): string => `ring-${field}-error`;

  // Every opening starts from what the engine lists: a form that was cancelled is gone.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        const held = readRingChoices(props.facade);
        setChoices(held);
        setForm(held.form);
        setErrors({});
        setSummary("");
      },
    ),
  );

  const edit = (patch: Partial<RingForm>, ...fields: RingField[]): void => {
    setForm((held) => ({ ...held, ...patch }));
    setSummary("");
    if (fields.some((field) => errors()[field] !== undefined)) {
      setErrors((held) => {
        const next = { ...held };
        for (const field of fields) delete next[field];
        return next;
      });
    }
  };

  // The engine is asked about a size once, when the size or its system changes, and not at all
  // while the dialog is closed.
  const sizeKey = createMemo(() => (props.open ? JSON.stringify(ringSizeQuery(form())) : "null"));
  const preview = createMemo<RingPreview>(() => (sizeKey() === "null" ? { kind: "none" } : previewRing(props.facade, form())));
  const facts = (): readonly Fact[] => {
    const held = preview();
    return held.kind === "sizes" ? held.facts : [];
  };
  /** The words under the size: what OK found, else what the engine says of it as it is typed. */
  const sizeError = (): string | undefined => {
    const held = preview();
    return errors().size ?? (held.kind === "refused" ? held.error : undefined);
  };
  const untouched = createMemo(() => JSON.stringify(form()) === JSON.stringify(choices().form));

  const mark = (found: RingErrors): void => {
    setErrors(found);
    const first = (Object.keys(found) as RingField[])[0];
    if (first === undefined) return;
    queueMicrotask(() => body?.querySelector<HTMLElement>(`#${id(first)}`)?.focus());
  };

  const apply = (): void => {
    const plan = planRing(form());
    if (!plan.ok) {
      setSummary("");
      mark(plan.errors);
      return;
    }
    const placed = place(props.facade, "ring", plan.params);
    if (placed.ok) {
      props.onPlaced(placed.message);
      props.onClose();
      return;
    }
    const field = ringRefusalField(placed.error);
    if (field === null) {
      setErrors({});
      setSummary(placed.error);
    } else {
      setSummary("");
      mark({ [field]: placed.error });
    }
  };

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

const NO_GEM: GemChoices = { list: { cuts: [], stones: [] }, cuts: [], stones: [], note: null, form: { cut: "", stone: "", diameter: "", length: "", width: "", x: "0", y: "0" } };

export function GemDialog(props: JewelryDialogProps): JSX.Element {
  const [choices, setChoices] = createSignal<GemChoices>(NO_GEM);
  const [form, setForm] = createSignal<GemForm>(NO_GEM.form);
  const [errors, setErrors] = createSignal<GemErrors>({});
  const [summary, setSummary] = createSignal("");
  let body: HTMLDivElement | undefined;

  const id = (field: GemField): string => `gem-${field}`;
  const errorId = (field: GemField): string => `gem-${field}-error`;

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        const held = readGemChoices(props.facade);
        setChoices(held);
        setForm(held.form);
        setErrors({});
        setSummary("");
      },
    ),
  );

  const edit = (patch: Partial<GemForm>, ...fields: GemField[]): void => {
    setForm((held) => ({ ...held, ...patch }));
    setSummary("");
    if (fields.some((field) => errors()[field] !== undefined)) {
      setErrors((held) => {
        const next = { ...held };
        for (const field of fields) delete next[field];
        return next;
      });
    }
  };

  const elongated = createMemo(() => isElongated(choices().list, form()));
  const facts = createMemo(() => gemFacts(choices().list, form()));
  const untouched = createMemo(() => JSON.stringify(form()) === JSON.stringify(choices().form));

  const mark = (found: GemErrors): void => {
    setErrors(found);
    const first = (Object.keys(found) as GemField[])[0];
    if (first === undefined) return;
    queueMicrotask(() => body?.querySelector<HTMLElement>(`#${id(first)}`)?.focus());
  };

  const apply = (): void => {
    const plan = planGem(choices().list, form());
    if (!plan.ok) {
      setSummary("");
      mark(plan.errors);
      return;
    }
    const placed = place(props.facade, "gem", plan.params);
    if (placed.ok) {
      props.onPlaced(placed.message);
      props.onClose();
      return;
    }
    const field = gemRefusalField(placed.error, elongated());
    if (field === null) {
      setErrors({});
      setSummary(placed.error);
    } else {
      setSummary("");
      mark({ [field]: placed.error });
    }
  };

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
