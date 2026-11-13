/**
 * The state of the Drafting Settings dialog, for whichever shell draws it
 * (`./components/DraftingSettings`, `./slab/SlabDrafting`): what the engine held when it opened,
 * the form, the refusals, the page in front, and OK. The rules are `./drafting`'s; this file
 * holds the signals and the order things are done in, so the two dialogs cannot drift apart.
 *
 * Every opening starts from the engine. OK sends only what the form changed; a form with a value
 * the engine would refuse sends nothing; a refusal marks its field, brings its page to the front
 * and asks the view to put the keyboard on it (`focusField`: only the view knows where a field is).
 */

import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { formOf, planCalls, readEngine, readState, runCalls, tabOf, unapplied, type DraftingEngine, type DraftingErrors, type DraftingField, type DraftingForm, type DraftingState, type DraftingTab, type DraftingVar } from "./drafting";

/** What the dialog is given by the shell (the props both views take). */
export interface DraftingEditProps {
  facade: DraftingEngine;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  tab?: DraftingTab;
}

export interface DraftingEdit {
  state: Accessor<DraftingState>;
  form: Accessor<DraftingForm>;
  errors: Accessor<DraftingErrors>;
  /** What happened to the whole form; "" when nothing did. */
  summary: Accessor<string>;
  tab: Accessor<DraftingTab>;
  setTab: (tab: DraftingTab) => void;
  /** Change the form; a field that was marked is no longer, once it is edited. */
  edit: (patch: Partial<DraftingForm>, ...fields: DraftingField[]) => void;
  /** Nobody has changed the form since it was read. */
  untouched: Accessor<boolean>;
  /** The engine did not report the variable: its controls cannot be used. */
  missing: (name: DraftingVar) => boolean;
  /** The engine reported a value that cannot be used: the default is shown. */
  unusable: (name: DraftingVar) => boolean;
  /** OK. */
  apply: () => void;
}

/** How many of something, in words: "1 value", "3 values". */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function createDraftingEdit(props: DraftingEditProps, focusField: (field: DraftingField) => void): DraftingEdit {
  const [state, setState] = createSignal<DraftingState>(readState({}, {}));
  const [form, setForm] = createSignal<DraftingForm>(formOf(state()));
  const [errors, setErrors] = createSignal<DraftingErrors>({});
  const [summary, setSummary] = createSignal("");
  const [tab, setTab] = createSignal<DraftingTab>("snap-grid");

  // Every opening starts from the engine: what was typed and left in a dialog that was cancelled is gone.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        const held = readEngine(props.facade);
        setState(held);
        setForm(formOf(held));
        setErrors({});
        setSummary("");
        setTab(props.tab ?? "snap-grid");
      },
    ),
  );

  const edit = (patch: Partial<DraftingForm>, ...fields: DraftingField[]): void => {
    setForm((held) => ({ ...held, ...patch }));
    if (fields.some((field) => errors()[field] !== undefined)) {
      setErrors((held) => {
        const next = { ...held };
        for (const field of fields) delete next[field];
        return next;
      });
    }
  };

  const untouched = createMemo(() => JSON.stringify(form()) === JSON.stringify(formOf(state())));

  /** Mark the fields, bring the first marked one's page to the front and put the keyboard on it. */
  const mark = (found: DraftingErrors, words: string): void => {
    setErrors(found);
    setSummary(words);
    const first = (Object.keys(found) as DraftingField[])[0];
    if (first === undefined) return;
    setTab(tabOf(first));
    queueMicrotask(() => focusField(first));
  };

  const apply = (): void => {
    const plan = planCalls(state(), form());
    if (!plan.ok) {
      mark(plan.errors, `Nothing was changed: ${count(Object.keys(plan.errors).length, "value needs", "values need")} correcting.`);
      return;
    }
    if (plan.calls.length === 0) {
      props.onClose();
      return;
    }
    const refused = runCalls(props.facade, plan.calls);
    const after = readEngine(props.facade);
    const left: DraftingErrors = { ...unapplied(after, form()), ...refused };
    const kept = Object.keys(left).length;
    setState(after);
    if (kept < plan.calls.length) props.onApplied();
    if (kept === 0) {
      props.onClose();
      return;
    }
    mark(left, `${Math.max(0, plan.calls.length - kept)} of ${count(plan.calls.length, "change was", "changes were")} applied. The engine refused the rest: each is marked.`);
  };

  return {
    state,
    form,
    errors,
    summary,
    tab,
    setTab,
    edit,
    untouched,
    missing: (name) => state().missing.includes(name),
    unusable: (name) => state().unusable.includes(name),
    apply,
  };
}
