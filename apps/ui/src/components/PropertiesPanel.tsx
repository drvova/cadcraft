/**
 * The properties palette: the engine's `properties` rows over `properties.set`. The rows are
 * parsed by `../props` (the shell calls `parseProperties`); this component renders them and
 * commits an edit on blur/Enter as `onSet(buildPatch({ [key]: value }))`.
 *
 * What a row holds against: text being typed survives a refresh from elsewhere and is dropped when
 * the selection changes; a number that cannot be one is refused on the row (`aria-invalid`, the
 * old value back on blur) and said once through `onNotice`; Escape cancels the edit without
 * reaching the shell's own Escape; an unchanged value sends nothing; a control keeps its element
 * (and so the focus) across refreshes.
 *
 * No engine call lives here: the shell owns the facade, shows a notice for a refused set, and
 * refreshes the reply.
 */

import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, Show, Switch, untrack, type Accessor, type JSX } from "solid-js";
import { buildPatch, VARIES, type PropRow, type PropertiesReply } from "../props";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import "../interaction.css";

export interface PropertiesPanelProps {
  properties: PropertiesReply | null;
  selectionCount: number;
  layers: readonly string[];
  onSet: (patch: Record<string, unknown>) => void;
  onNotice?: (message: string) => void;
}

export function PropertiesPanel(props: PropertiesPanelProps): JSX.Element {
  const title = (): string => {
    const reply = props.properties;
    if (reply === null) return props.selectionCount > 0 ? `${props.selectionCount} selected` : "No selection";
    if (reply.kind === "defaults") return "No selection";
    return reply.count === 1 ? "1 object" : `${reply.count} objects`;
  };

  /** What the rows describe: a row drops its unfinished edit when this changes under it. */
  const subject = createMemo((): string => {
    const reply = props.properties;
    if (reply === null) return "";
    if (reply.kind === "defaults") return "defaults";
    return reply.objects.map((o) => String(o["handle"])).join(",");
  });

  /** The section folds to its heading, as the editor's sidebar sections do. */
  const [open, setOpen] = createSignal(true);

  return (
    <aside class={open() ? "properties" : "properties is-folded"}>
      <div class="properties-head">
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the properties" : "Show the properties"} onClick={() => setOpen(!open())} />
        <SectionLabel>Properties</SectionLabel>
        <span class="properties-state" title={title()}>
          {title()}
        </span>
      </div>
      <div class="properties-body" role="list" hidden={!open()}>
        <Index each={props.properties?.rows ?? []}>
          {(row) => (
            <PropRowView row={row} subject={subject} layers={props.layers} onSet={props.onSet} onNotice={props.onNotice} />
          )}
        </Index>
        <Show when={(props.properties?.rows.length ?? 0) === 0}>
          <div class="properties-empty">No properties to show.</div>
        </Show>
      </div>
    </aside>
  );
}

interface PropRowViewProps {
  row: Accessor<PropRow>;
  subject: Accessor<string>;
  layers: readonly string[];
  onSet: (patch: Record<string, unknown>) => void;
  onNotice?: (message: string) => void;
}

/**
 * The number rows the engine only takes above zero: `properties.set` leaves the value as it was
 * for anything else and still answers ok, so the row has to say it.
 */
const POSITIVE_KEYS: ReadonlySet<string> = new Set(["ltscale"]);

/** The options of a choice row: the caller's layer names win for the layer row, else the row's own. */
function optionsFor(row: PropRow, layers: readonly string[]): readonly string[] {
  if (row.key === "layer" && layers.length > 0) return layers;
  return row.choices ?? [];
}

/** What becomes of text typed into a row: nothing to send, a refusal to say, or the patch. */
export type DraftVerdict = { kind: "keep" } | { kind: "refuse"; message: string } | { kind: "send"; patch: Record<string, unknown> };

/**
 * Judges `draft` against the row it was typed into. An unchanged value, an emptied number and the
 * same number written another way ("2.50" over "2.5") keep the engine's value; a number row takes
 * only a finite number (above zero where the engine needs one); everything else is sent.
 */
export function judgeDraft(row: PropRow, draft: string): DraftVerdict {
  if (draft === row.value) return { kind: "keep" };
  if (row.kind === "number") {
    const text = draft.trim();
    if (text === "") return { kind: "keep" };
    const n = Number(text);
    if (!Number.isFinite(n)) return { kind: "refuse", message: `${row.label} needs a number` };
    if (POSITIVE_KEYS.has(row.key) && n <= 0) return { kind: "refuse", message: `${row.label} needs a number above 0` };
    if (row.value.trim() !== "" && n === Number(row.value)) return { kind: "keep" };
  }
  return { kind: "send", patch: buildPatch({ [row.key]: draft }) };
}

function PropRowView(props: PropRowViewProps): JSX.Element {
  const [draft, setDraft] = createSignal(props.row().value);
  /** Typed into since the last commit or cancel: only then is there an edit to keep or send. */
  const [dirty, setDirty] = createSignal(false);
  /** The draft was refused as it stands; cleared by the next keystroke, cancel or commit. */
  const [invalid, setInvalid] = createSignal(false);
  /** The text the last number warning was for, so Enter-then-blur does not warn twice. */
  let warned = "";
  /** Set when the row leaves the page: the blur a removed field fires must not send anything. */
  let gone = false;
  onCleanup(() => {
    gone = true;
  });

  /** Back to the engine's value, with no edit pending. */
  const settle = (): void => {
    warned = "";
    setDirty(false);
    setInvalid(false);
    setDraft(props.row().value);
  };

  // Re-seed when the engine's value changes (a refresh after a set), never over text being typed.
  createEffect(() => {
    const value = props.row().value;
    if (!untrack(dirty)) setDraft(value);
  });
  // Another selection, or another property in this place: the unfinished edit was not for it.
  createEffect((before: string) => {
    const now = `${props.subject()}/${props.row().key}`;
    if (now !== before) untrack(settle);
    return now;
  }, `${props.subject()}/${props.row().key}`);

  /** A picked value (a choice, a tick): sent unless it is the one already there. */
  const commit = (value: string): void => {
    const verdict = judgeDraft(props.row(), value);
    if (verdict.kind === "send") props.onSet(verdict.patch);
  };

  /**
   * Commit the typed text. A number that cannot be one is said once and stays in the field,
   * marked, while it has the focus (`leaving` false); on the way out the old value comes back.
   */
  const commitText = (leaving: boolean): void => {
    if (gone || !dirty()) return;
    const value = draft();
    const verdict = judgeDraft(props.row(), value);
    if (verdict.kind === "refuse") {
      if (warned !== value) props.onNotice?.(verdict.message);
      if (leaving) {
        settle();
        return;
      }
      warned = value;
      setInvalid(true);
      return;
    }
    if (verdict.kind === "keep") {
      settle();
      return;
    }
    warned = "";
    setDirty(false);
    setInvalid(false);
    props.onSet(verdict.patch);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitText(false);
    } else if (e.key === "Escape" && (dirty() || invalid())) {
      // Escape cancels this edit only; with nothing to cancel it is the shell's (it clears the selection).
      e.preventDefault();
      e.stopPropagation();
      settle();
    }
  };

  /** Which control the row gets; the control is kept across refreshes, so focus survives one. */
  const mode = createMemo((): "readonly" | PropRow["kind"] => (props.row().editable ? props.row().kind : "readonly"));
  const options = createMemo(() => optionsFor(props.row(), props.layers));
  /** A tick box over objects that disagree (or a value that is neither) is neither on nor off. */
  const mixed = (): boolean => draft() !== "true" && draft() !== "false";

  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label" title={props.row().label}>
        {props.row().label}
      </span>
      <span class="prop-value">
        <Switch>
          <Match when={mode() === "readonly"}>
            <span class="prop-readonly" title={props.row().value}>
              {props.row().value}
            </span>
          </Match>
          <Match when={mode() === "bool"}>
            <input
              class="prop-check"
              type="checkbox"
              checked={draft() === "true"}
              ref={(el) => {
                createEffect(() => {
                  el.indeterminate = mixed();
                });
              }}
              aria-label={props.row().label}
              onChange={(e) => {
                const value = e.currentTarget.checked ? "true" : "false";
                setDraft(value);
                commit(value);
              }}
            />
          </Match>
          <Match when={mode() === "choice"}>
            <select
              class="prop-select"
              classList={{ "is-varies": draft() === VARIES }}
              title={draft()}
              aria-label={props.row().label}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setDraft(value);
                commit(value);
              }}
            >
              <Show when={!options().includes(draft())}>
                <option value={draft()} selected>
                  {draft()}
                </option>
              </Show>
              <For each={options()}>
                {(option) => (
                  <option value={option} selected={option === draft()}>
                    {option}
                  </option>
                )}
              </For>
            </select>
          </Match>
          <Match when={mode() === "text" || mode() === "number"}>
            <input
              class="prop-input"
              classList={{ "is-varies": draft() === VARIES }}
              type="text"
              inputmode={mode() === "number" ? "decimal" : undefined}
              spellcheck={false}
              autocomplete="off"
              value={draft()}
              title={draft()}
              aria-label={props.row().label}
              aria-invalid={invalid() ? "true" : undefined}
              onInput={(e) => {
                setDirty(true);
                setInvalid(false);
                setDraft(e.currentTarget.value);
              }}
              onKeyDown={onKeyDown}
              onBlur={() => commitText(true)}
            />
          </Match>
        </Switch>
      </span>
    </div>
  );
}
