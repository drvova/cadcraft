/**
 * The Ring and Gem dialogs' state, apart from any view: the choices the engine lists, the form as
 * typed, the refusals standing on it, what the engine says of it while it is typed, and what OK
 * does. The SolidJS dialogs (`./components/JewelryDialog.tsx`) and the ones whose body Slab draws
 * (`./slab/SlabJewelry.tsx`) both run on it, so neither forks the other's behaviour. The rules
 * themselves are `./jewelry-dialog`'s.
 */

import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
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
  ringRefusalField,
  ringSizeQuery,
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
} from "./jewelry-dialog";

/** What either dialog is given: its own props. */
export interface JewelrySource {
  facade: JewelryEngine;
  open: boolean;
  onClose: () => void;
  onPlaced: (message: string | null) => void;
}

const NO_RING: RingChoices = { metals: [], form: { system: "us", size: "", wall: "", width: "", metal: "", x: "0", y: "0" } };

export interface RingEdit {
  choices: Accessor<RingChoices>;
  form: Accessor<RingForm>;
  errors: Accessor<RingErrors>;
  /** What happened to the whole form; "" when nothing did. */
  summary: Accessor<string>;
  /** The size in every system, as the engine names it; empty while there is none. */
  facts: () => readonly Fact[];
  /** The words under the size: what OK found, else what the engine says of it as it is typed. */
  sizeError: () => string | undefined;
  /** The form is as the engine listed it: a press outside the box may close. */
  untouched: Accessor<boolean>;
  /** Change the form; the refusals standing on `fields` are answered. */
  edit: (patch: Partial<RingForm>, ...fields: RingField[]) => void;
  /** OK: place the ring; on success the shell is told and the dialog closes, else the refusal stands. */
  apply: () => void;
}

/** The Ring dialog over its props. `focusField` is the view's: the keyboard goes to the field a refusal names. */
export function createRingEdit(props: JewelrySource, focusField: (field: RingField) => void): RingEdit {
  const [choices, setChoices] = createSignal<RingChoices>(NO_RING);
  const [form, setForm] = createSignal<RingForm>(NO_RING.form);
  const [errors, setErrors] = createSignal<RingErrors>({});
  const [summary, setSummary] = createSignal("");

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
  const sizeError = (): string | undefined => {
    const held = preview();
    return errors().size ?? (held.kind === "refused" ? held.error : undefined);
  };
  const untouched = createMemo(() => JSON.stringify(form()) === JSON.stringify(choices().form));

  const mark = (found: RingErrors): void => {
    setErrors(found);
    const first = (Object.keys(found) as RingField[])[0];
    if (first === undefined) return;
    queueMicrotask(() => focusField(first));
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

  return { choices, form, errors, summary, facts, sizeError, untouched, edit, apply };
}

const NO_GEM: GemChoices = { list: { cuts: [], stones: [] }, cuts: [], stones: [], note: null, form: { cut: "", stone: "", diameter: "", length: "", width: "", x: "0", y: "0" } };

export interface GemEdit {
  choices: Accessor<GemChoices>;
  form: Accessor<GemForm>;
  errors: Accessor<GemErrors>;
  summary: Accessor<string>;
  /** The cut is one with a length and a width, not a diameter. */
  elongated: Accessor<boolean>;
  /** The engine's worked example of the cut. */
  facts: Accessor<Fact[]>;
  untouched: Accessor<boolean>;
  edit: (patch: Partial<GemForm>, ...fields: GemField[]) => void;
  apply: () => void;
}

/** The Gem dialog over its props. `focusField` is the view's: the keyboard goes to the field a refusal names. */
export function createGemEdit(props: JewelrySource, focusField: (field: GemField) => void): GemEdit {
  const [choices, setChoices] = createSignal<GemChoices>(NO_GEM);
  const [form, setForm] = createSignal<GemForm>(NO_GEM.form);
  const [errors, setErrors] = createSignal<GemErrors>({});
  const [summary, setSummary] = createSignal("");

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
    queueMicrotask(() => focusField(first));
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

  return { choices, form, errors, summary, elongated, facts, untouched, edit, apply };
}
