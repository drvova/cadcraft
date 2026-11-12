/**
 * Drafting Settings: the dialog a drafter opens to set what the status bar's toggles turn on and
 * off. Three pages: Snap and Grid (each switch and its spacing along X and Y), Polar Tracking (the
 * switch, the increment angle from the usual list or typed, the additional angles) and Object
 * Snap (the switch, tracking, and a box per running snap beside the marker the drawing shows for
 * it: the same figure, from `snapGlyph` in `../canvas.ts`, at the same size).
 *
 * It is a surface over the engine: each time it opens it reads what the engine holds
 * (`readEngine`), and OK sends only what the form changed, through `execute` (`planCalls`,
 * `runCalls`; `../drafting.ts` holds the mapping and says why these calls). The engine has no
 * transaction for settings, so the order of safety is the dialog's own: a form with a value the
 * engine would refuse sends nothing at all; every call is then run, a refusal is shown beside
 * its field with a count of what was applied, and the dialog stays open on it. Cancel, Escape and
 * the close key change nothing. A press outside the box closes only a form nobody has touched.
 *
 * The component is not mounted here: the shell owns `open` and passes `tab` when a status toggle
 * asked for its own page.
 */

import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
import { SNAP_MARKER_HALF, SNAP_MARKER_WIDTH, snapGlyph } from "../canvas";
import {
  formOf,
  OSNAP_ALL,
  OSNAP_MODES,
  planCalls,
  POLAR_ANGLES,
  POLAR_CUSTOM,
  readEngine,
  readState,
  runCalls,
  snapShapePath,
  tabOf,
  unapplied,
  type DraftingEngine,
  type DraftingErrors,
  type DraftingField,
  type DraftingForm,
  type DraftingState,
  type DraftingTab,
  type DraftingVar,
} from "../drafting";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { SectionLabel } from "../ui/SectionLabel";
import { Select, type SelectOption } from "../ui/Select";
import { TabPanels } from "../ui/Tab";
import "../dialogs.css";

export interface DraftingSettingsProps {
  /** The engine: `AppFacade` is one. Read on every opening, written on OK. */
  facade: DraftingEngine;
  /** Whether the dialog is showing. The shell holds it. */
  open: boolean;
  /** The dialog is done, with or without changes: the shell sets `open` false. */
  onClose: () => void;
  /** At least one setting was changed in the engine: the shell reads its settings again. */
  onApplied: () => void;
  /** The page in front when it opens. Defaults to Snap and Grid. */
  tab?: DraftingTab;
}

const errorId = (field: DraftingField): string => `drafting-${field}-error`;

/** The `id` a control takes so its visible label can name it. */
const controlId = (name: keyof DraftingForm): string => `drafting-${name}`;

const ANGLE_OPTIONS: readonly SelectOption[] = [...POLAR_ANGLES.map((angle) => ({ value: angle, label: `${angle}°` })), { value: POLAR_CUSTOM, label: "Custom" }];

/** Half the glyph's box in the marker's own units: the marker's 6px half inside a 14px box. */
const GLYPH_VIEW = (SNAP_MARKER_HALF + 1) / SNAP_MARKER_HALF;

/** The marker the drawing shows for an object snap, drawn from the canvas's own strokes at its own size. */
function SnapGlyph(props: { bit: number }): JSX.Element {
  return (
    <svg class="drafting-glyph" viewBox={`${-GLYPH_VIEW} ${-GLYPH_VIEW} ${2 * GLYPH_VIEW} ${2 * GLYPH_VIEW}`} fill="none" stroke="currentColor" stroke-width={SNAP_MARKER_WIDTH / SNAP_MARKER_HALF} aria-hidden="true">
      <For each={snapGlyph(props.bit)}>{(shape) => <path d={snapShapePath(shape)} />}</For>
    </svg>
  );
}

/** How many of something, in words: "1 value", "3 values". */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function DraftingSettings(props: DraftingSettingsProps): JSX.Element {
  const [state, setState] = createSignal<DraftingState>(readState({}, {}));
  const [form, setForm] = createSignal<DraftingForm>(formOf(state()));
  const [errors, setErrors] = createSignal<DraftingErrors>({});
  const [summary, setSummary] = createSignal("");
  const [tab, setTab] = createSignal<DraftingTab>("snap-grid");
  let body: HTMLDivElement | undefined;

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

  /** Change the form; a field that was marked is no longer, once it is edited. */
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
  const missing = (name: DraftingVar): boolean => state().missing.includes(name);
  const unusable = (name: DraftingVar): boolean => state().unusable.includes(name);

  /** Mark the fields, bring the first marked one's page to the front and put the keyboard on it. */
  const mark = (found: DraftingErrors, words: string): void => {
    setErrors(found);
    setSummary(words);
    const first = (Object.keys(found) as DraftingField[])[0];
    if (first === undefined) return;
    setTab(tabOf(first));
    queueMicrotask(() => body?.querySelector<HTMLElement>(`[aria-describedby~="${errorId(first)}"]`)?.focus());
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

  /** The line under a field that says why it is marked. */
  const ErrorLine = (line: { field: DraftingField }): JSX.Element => (
    <Show when={errors()[line.field]}>
      {(words) => (
        <span class="drafting-error" id={errorId(line.field)}>
          {words()}
        </span>
      )}
    </Show>
  );

  /** A typed number under its label, on the page's value column. */
  const NumberRow = (row: { field: "snapX" | "snapY" | "gridX" | "gridY" | "polarCustom"; marks: DraftingField; label: string; disabled: boolean }): JSX.Element => (
    <div class="drafting-row">
      <div class="drafting-pair">
        <label class="drafting-label" for={controlId(row.field)}>
          {row.label}
        </label>
        <Field
          id={controlId(row.field)}
          align="end"
          value={form()[row.field]}
          inputMode="decimal"
          spellcheck={false}
          autocomplete="off"
          selectOnFocus
          disabled={row.disabled}
          invalid={errors()[row.marks] !== undefined}
          describedBy={errors()[row.marks] === undefined ? undefined : errorId(row.marks)}
          onInput={(value) => edit({ [row.field]: value }, row.marks)}
        />
      </div>
      <ErrorLine field={row.marks} />
    </div>
  );

  /** A switch with its own line for a refusal. */
  const SwitchRow = (row: { field: "snapOn" | "gridOn" | "polarOn" | "additionalOn" | "osnapOn" | "otrackOn"; label: string; disabled?: boolean }): JSX.Element => (
    <div class="drafting-switch">
      <Checkbox checked={form()[row.field]} disabled={row.disabled} describedBy={errors()[row.field] === undefined ? undefined : errorId(row.field)} onChange={(on) => edit({ [row.field]: on }, row.field)}>
        {row.label}
      </Checkbox>
      <ErrorLine field={row.field} />
    </div>
  );

  /** Why a group's values cannot be changed, or what is shown in place of a value that could not be used. */
  const Note = (note: { name: DraftingVar; what: string }): JSX.Element => (
    <>
      <Show when={missing(note.name)}>
        <p class="drafting-note">The engine did not report {note.what}, so it cannot be changed here.</p>
      </Show>
      <Show when={unusable(note.name)}>
        <p class="drafting-note">The engine reported {note.what} that cannot be used. The default is shown, and OK sets it.</p>
      </Show>
    </>
  );

  const snapGrid = (): JSX.Element => (
    <div class="drafting-page">
      <div class="drafting-group">
        <SwitchRow field="snapOn" label="Snap on" />
        <NumberRow field="snapX" marks="snapX" label="Snap X spacing" disabled={missing("SNAPUNIT")} />
        <NumberRow field="snapY" marks="snapY" label="Snap Y spacing" disabled={missing("SNAPUNIT")} />
        <Note name="SNAPUNIT" what="a snap spacing" />
      </div>
      <div class="drafting-group">
        <SwitchRow field="gridOn" label="Grid on" />
        <NumberRow field="gridX" marks="gridX" label="Grid X spacing" disabled={missing("GRIDUNIT")} />
        <NumberRow field="gridY" marks="gridY" label="Grid Y spacing" disabled={missing("GRIDUNIT")} />
        <Note name="GRIDUNIT" what="a grid spacing" />
      </div>
    </div>
  );

  const polar = (): JSX.Element => (
    <div class="drafting-page">
      <div class="drafting-group">
        <SwitchRow field="polarOn" label="Polar tracking on" />
        <div class="drafting-row">
          <div class="drafting-pair">
            <label class="drafting-label" for={controlId("polarChoice")}>
              Increment angle
            </label>
            <Select
              id={controlId("polarChoice")}
              value={form().polarChoice}
              options={ANGLE_OPTIONS}
              disabled={missing("POLARANG")}
              invalid={form().polarChoice !== POLAR_CUSTOM && errors().polarAngle !== undefined}
              describedBy={form().polarChoice !== POLAR_CUSTOM && errors().polarAngle !== undefined ? errorId("polarAngle") : undefined}
              onChange={(value) => edit({ polarChoice: value }, "polarAngle")}
            />
          </div>
          <Show when={form().polarChoice !== POLAR_CUSTOM}>
            <ErrorLine field="polarAngle" />
          </Show>
        </div>
        <Show when={form().polarChoice === POLAR_CUSTOM}>
          <NumberRow field="polarCustom" marks="polarAngle" label="Custom angle, in degrees" disabled={missing("POLARANG")} />
        </Show>
        <Note name="POLARANG" what="an increment angle" />
      </div>
      <div class="drafting-group">
        <SwitchRow field="additionalOn" label="Track additional angles" disabled={missing("POLARMODE")} />
        <div class="drafting-row">
          <div class="drafting-stack">
            <label class="drafting-label" for={controlId("additionalAngles")}>
              Additional angles
            </label>
            <Field
              id={controlId("additionalAngles")}
              value={form().additionalAngles}
              placeholder="15; 75"
              spellcheck={false}
              autocomplete="off"
              disabled={missing("POLARADDANG")}
              invalid={errors().additionalAngles !== undefined}
              describedBy={errors().additionalAngles === undefined ? "drafting-angles-help" : `${errorId("additionalAngles")} drafting-angles-help`}
              onInput={(value) => edit({ additionalAngles: value }, "additionalAngles")}
            />
          </div>
          <ErrorLine field="additionalAngles" />
          <span class="drafting-help" id="drafting-angles-help">
            Degrees, separated by semicolons. Up to 10.
          </span>
        </div>
        <Note name="POLARADDANG" what="additional angles" />
      </div>
    </div>
  );

  const osnap = (): JSX.Element => (
    <div class="drafting-page">
      <div class="drafting-group drafting-switches">
        <SwitchRow field="osnapOn" label="Object snap on" />
        <SwitchRow field="otrackOn" label="Object snap tracking on" />
      </div>
      <div class="drafting-group">
        <div class="drafting-modes-head">
          <SectionLabel>Snap modes</SectionLabel>
          <span class="drafting-actions">
            <Button size="sm" variant="ghost" onClick={() => edit({ modes: OSNAP_ALL }, "modes")}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => edit({ modes: 0 }, "modes")}>
              Clear all
            </Button>
          </span>
        </div>
        <div class="drafting-modes" role="group" aria-label="Object snap modes" aria-describedby={errors().modes === undefined ? undefined : errorId("modes")}>
          <For each={OSNAP_MODES}>
            {(mode) => (
              <Checkbox checked={(form().modes & mode.bit) !== 0} onChange={(on) => edit({ modes: on ? form().modes | mode.bit : form().modes & ~mode.bit }, "modes")}>
                <span class="drafting-mode">
                  <SnapGlyph bit={mode.bit} />
                  {mode.label}
                </span>
              </Checkbox>
            )}
          </For>
        </div>
        <ErrorLine field="modes" />
      </div>
    </div>
  );

  return (
    <Dialog
      open={props.open}
      title="Drafting Settings"
      size="md"
      describedBy={summary() === "" ? undefined : "drafting-summary"}
      dismissOnBackdrop={untouched()}
      onClose={() => props.onClose()}
      footer={
        <>
          <Button onClick={() => props.onClose()}>Cancel</Button>
          <Button variant="primary" type="submit" onClick={apply}>
            OK
          </Button>
        </>
      }
    >
      <div class="drafting" ref={body}>
        <Show when={summary() !== ""}>
          <p class="drafting-summary" id="drafting-summary" role="alert">
            {summary()}
          </p>
        </Show>
        <TabPanels
          ariaLabel="Drafting settings"
          selected={tab()}
          onChange={(id) => setTab(id as DraftingTab)}
          panels={[
            { id: "snap-grid", label: "Snap and Grid", content: snapGrid },
            { id: "polar", label: "Polar Tracking", content: polar },
            { id: "osnap", label: "Object Snap", content: osnap },
          ]}
        />
      </div>
    </Dialog>
  );
}
