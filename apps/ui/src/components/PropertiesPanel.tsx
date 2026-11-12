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
 * The choice and the tick are the layer's `Select` (inline, small, its value ending on the arrow's
 * side) and `Checkbox`; each sits in the value column and is named by its row's label.
 *
 * No native `title` here: text an ellipsis cuts (a label, the head's count) opts in to the
 * system's hint with an empty `data-hint`, a typed field shows its value while it cuts it
 * (the `Field` shows its own), a choice shows its own (the `Select` does), and a read-only value wraps and
 * so needs none.
 *
 * No engine call lives here: the shell owns the facade, shows a notice for a refused set, and
 * refreshes the reply.
 */

import { createEffect, createMemo, createSignal, Index, Match, onCleanup, Show, Switch, untrack, type Accessor, type JSX } from "solid-js";
import { judgeDraft, VARIES, type PropRow, type PropertiesReply } from "../props";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import { Select, type SelectOption } from "../ui/Select";
import "../interaction.css";

export interface PropertiesPanelProps {
  properties: PropertiesReply | null;
  selectionCount: number;
  /** The drawing's layer names. The shell gives the same list to `parseProperties`, so the layer row already carries it. */
  layers: readonly string[];
  onSet: (patch: Record<string, unknown>) => void;
  onNotice?: (message: string) => void;
}

/** A count as the status bar writes it: grouped in threes ("1,284"). */
const count = (n: number): string => n.toLocaleString("en-US");

/**
 * Marks the ends of a list that scrolls where rows lie past them (`data-clip-top`,
 * `data-clip-bottom`; interaction.css fades the list there, so a row cut by the list's edge reads
 * as one that goes on, and at either end of the scroll nothing is faded). Call it from the list's
 * `ref`. Returns the marking function, for content that changes without the list's own box changing.
 */
function scrollEnds(list: HTMLElement): () => void {
  const mark = (): void => {
    const hidden = list.scrollHeight - list.clientHeight;
    list.toggleAttribute("data-clip-top", list.scrollTop > 1);
    list.toggleAttribute("data-clip-bottom", list.scrollTop < hidden - 1);
  };
  const observer = new ResizeObserver(mark);
  observer.observe(list);
  list.addEventListener("scroll", mark, { passive: true });
  onCleanup(() => {
    observer.disconnect();
    list.removeEventListener("scroll", mark);
  });
  return mark;
}

export function PropertiesPanel(props: PropertiesPanelProps): JSX.Element {
  // One count, one name: the heading says what the status bar says ("21 selected").
  const title = (): string => {
    const reply = props.properties;
    if (reply === null) return props.selectionCount > 0 ? `${count(props.selectionCount)} selected` : "No selection";
    if (reply.kind === "defaults") return "No selection";
    return `${count(reply.count)} selected`;
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

  // The rows change under a list whose own box does not (another selection, a value that wraps
  // onto a second line, the section unfolded): the list's hidden ends are marked again.
  let markEnds: (() => void) | undefined;
  createEffect(() => {
    props.properties;
    open();
    queueMicrotask(() => markEnds?.());
  });

  return (
    <aside class={open() ? "properties" : "properties is-folded"}>
      <div class="properties-head">
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the properties" : "Show the properties"} expanded={open()} controls="properties-body" onClick={() => setOpen(!open())} />
        <SectionLabel>Properties</SectionLabel>
        <span class="properties-state" data-hint="">
          {title()}
        </span>
      </div>
      <div
        class="properties-body"
        id="properties-body"
        role="list"
        aria-label="Properties"
        hidden={!open()}
        ref={(element) => {
          markEnds = scrollEnds(element);
        }}
      >
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

/** A choice row's values as the `Select` takes them: each is its own label. */
export function choiceOptions(choices: readonly string[] | undefined): SelectOption[] {
  return (choices ?? []).map((value) => ({ value, label: value }));
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
  const options = createMemo((): SelectOption[] => choiceOptions(props.row().choices));
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
            <Checkbox
              ariaLabel={props.row().label}
              checked={draft() === "true"}
              mixed={mixed()}
              onChange={(checked) => {
                const value = checked ? "true" : "false";
                setDraft(value);
                commit(value);
              }}
            />
          </Match>
          <Match when={mode() === "choice"}>
            <span class="prop-choice prop-choice-arrow">
              <Select
                variant="inline"
                size="sm"
                align="end"
                ariaLabel={props.row().label}
                value={draft()}
                mixed={draft() === VARIES}
                placeholder={VARIES}
                options={options()}
                onChange={(value) => {
                  setDraft(value);
                  commit(value);
                }}
              />
            </span>
          </Match>
          <Match when={mode() === "text" || mode() === "number"}>
            <span class="prop-choice">
              <Field
                variant="inline"
                size="sm"
                align="end"
                ariaLabel={props.row().label}
                value={draft()}
                mixed={draft() === VARIES}
                invalid={invalid()}
                inputMode={mode() === "number" ? "decimal" : undefined}
                spellcheck={false}
                autocomplete="off"
                onInput={(value) => {
                  setDirty(true);
                  setInvalid(false);
                  setDraft(value);
                }}
                onKeyDown={onKeyDown}
                onBlur={() => commitText(true)}
              />
            </span>
          </Match>
        </Switch>
      </span>
    </div>
  );
}
