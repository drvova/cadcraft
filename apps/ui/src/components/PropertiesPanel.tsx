/**
 * The properties palette: the engine's `properties` rows over `properties.set`. The rows are
 * parsed by `../props` (the shell calls `parseProperties`); this component renders them and
 * commits an edit on blur/Enter as `onSet(patch)`, where `judgeDraft` (in `../props`) decides what
 * the typed text is: nothing to send, a refusal, or the patch. No property is named here.
 *
 * What a row holds against: text being typed survives a refresh from elsewhere and is dropped when
 * the selection changes; a number that cannot be one is refused on the row (`aria-invalid`, the
 * old value back on blur) and said once through `onNotice`; Escape cancels the edit without
 * reaching the shell's own Escape; an unchanged value sends nothing; a control keeps its element
 * (and so the focus) across refreshes.
 *
 * No native `title` here: text an ellipsis cuts (a label, the head's count) opts in to the
 * system's hint with an empty `data-hint`, a field shows its value while it cuts it
 * (`hintWhenClipped`), and a read-only value wraps and so needs none.
 *
 * No engine call lives here: the shell owns the facade, shows a notice for a refused set, and
 * refreshes the reply.
 */

import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, Show, Switch, untrack, type Accessor, type JSX } from "solid-js";
import { judgeDraft, VARIES, type PropRow, type PropertiesReply } from "../props";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import "../interaction.css";

export interface PropertiesPanelProps {
  properties: PropertiesReply | null;
  selectionCount: number;
  /** The drawing's layer names. The shell gives the same list to `parseProperties`, so the layer row already carries it. */
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
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the properties" : "Show the properties"} expanded={open()} controls="properties-body" onClick={() => setOpen(!open())} />
        <SectionLabel>Properties</SectionLabel>
        <span class="properties-state" data-hint="">
          {title()}
        </span>
      </div>
      <div class="properties-body" id="properties-body" role="list" aria-label="Properties" hidden={!open()}>
        <Index each={props.properties?.rows ?? []}>
          {(row) => (
            <PropRowView row={row} subject={subject} onSet={props.onSet} onNotice={props.onNotice} />
          )}
        </Index>
        <Show when={(props.properties?.rows.length ?? 0) === 0}>
          <div class="properties-empty">No properties to show.</div>
        </Show>
      </div>
    </aside>
  );
}

/** Whether a field is too narrow for its value. A text field scrolls, so its own box says; a
 *  choice does not, so its value is measured in the field's font against the room inside it. */
function cuts(field: HTMLInputElement | HTMLSelectElement): boolean {
  if (field instanceof HTMLInputElement) return field.scrollWidth > field.clientWidth;
  const style = getComputedStyle(field);
  const pen = document.createElement("canvas").getContext("2d");
  if (pen === null) return true;
  // Not `style.font`: the shorthand computes to nothing when a longhand it cannot hold is set.
  pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return pen.measureText(field.value).width > field.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
}

/**
 * A field's hint is its whole value, and only while the field cuts it: a field has no text of its
 * own for the layer to measure, so the field is measured here, just before the hint asks (the
 * pointer arriving, the focus arriving). A value that fits raises no hint.
 */
function hintWhenClipped(field: HTMLInputElement | HTMLSelectElement): void {
  const mark = (): void => field.setAttribute("data-hint", cuts(field) ? field.value : "");
  field.addEventListener("pointerover", mark);
  field.addEventListener("focusin", mark);
}

interface PropRowViewProps {
  row: Accessor<PropRow>;
  subject: Accessor<string>;
  onSet: (patch: Record<string, unknown>) => void;
  onNotice?: (message: string) => void;
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
  /** A choice row's options, as `parseProperties` set them (the layer row's are the drawing's layers). */
  const options = createMemo((): readonly string[] => props.row().choices ?? []);
  /** A tick box over objects that disagree (or a value that is neither) is neither on nor off. */
  const mixed = (): boolean => draft() !== "true" && draft() !== "false";

  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label" data-hint="">
        {props.row().label}
      </span>
      <span class="prop-value">
        <Switch>
          <Match when={mode() === "readonly"}>
            <span class="prop-readonly">{props.row().value}</span>
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
              data-hint=""
              ref={hintWhenClipped}
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
              data-hint=""
              ref={hintWhenClipped}
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
