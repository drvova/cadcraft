/**
 * The Piece section: the parametric ring the engine's `piece` command builds, as the first
 * section of the rail. With no piece it offers the three kinds; with one it lists the parameters
 * that apply to its kind, each edited in place, then what the engine worked out (the metal's
 * weight, the stones, the size in the other systems) and its checks, and a way to remove it.
 *
 * `../piece` holds the logic: the reply's narrowing, the rows of a kind, what typed text becomes
 * (`judgePieceDraft`) and the row a refusal belongs on (`refusalRow`). No jewelry number is
 * worked out here or there: every figure is the engine's.
 *
 * A row is the properties palette's row (`.prop-row`, `../interaction.css`) and holds what that
 * palette's rows hold: text being typed survives a refresh; Enter or leaving the field commits;
 * Escape cancels the edit without reaching the shell's own Escape; an unchanged value sends
 * nothing. A refusal marks the row it names (`aria-invalid`, the engine's words as the control's
 * hint and description) and is said through the shell's notice; the refused text stays while the
 * field has the focus and the engine's value comes back when it leaves.
 *
 * The size system is how the size is read, not a parameter of its own: picking one shows the
 * engine's name for the same finger in that system and changes no drawing; a size typed then is
 * sent in it, and the engine keeps it as the piece's system.
 *
 * A check says whether it passed in a word ("Pass", "Fail"), not by its ink alone, and its
 * message wraps so it is read whole.
 *
 * No engine call lives here: the shell runs `piece` (`onRun`) and hands back the refusal, if any.
 */

import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, Show, Switch, untrack, type Accessor, type JSX } from "solid-js";
import { failedChecks, judgePieceDraft, pieceFacts, pieceHeading, pieceRows, refusalRow, refusalWords, PIECE_KINDS, type PieceChoices, type PieceRow, type PieceState } from "../piece";
import { sizeExample } from "../jewelry-dialog";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import { Select } from "../ui/Select";
import "../interaction.css";

export interface PiecePanelProps {
  /** The piece of the drawing in front, as the engine last described it. */
  state: PieceState;
  /** What the engine lets a jeweler choose: the alloys, the cuts, the stones. */
  choices: PieceChoices;
  /**
   * Run `piece` with these parameters (a kind to start one, a patch to rebuild it, `{remove:
   * true}`). Answers null when it went through, else the engine's refusal in its own words; the
   * shell has then already said it and refreshed `state`.
   */
  onRun: (params: Record<string, unknown>) => string | null;
  /** A row refused what was typed before it reached the engine. */
  onNotice?: (message: string) => void;
  /** Open the "Start from a template" gallery (the empty state's richer start). */
  onTemplates?: () => void;
}

/** The refusal standing on a row: which row, and the words for it. */
interface Refused {
  key: string;
  message: string;
}

/**
 * Marks the ends of the list where rows lie past them (`data-clip-top`, `data-clip-bottom`;
 * interaction.css fades the list there), as the properties palette does for its own list: the
 * same marks on the same class, kept here because that palette's marker is not exported.
 * Returns the marking function, for content that changes without the list's own box changing.
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

export function PiecePanel(props: PiecePanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const piece = createMemo(() => (props.state.kind === "piece" ? props.state.piece : null));

  /** The size system picked here; null while the section shows the one the piece holds. */
  const [picked, setPicked] = createSignal<string | null>(null);
  const system = (): string => picked() ?? piece()?.params.sizeSystem ?? "us";
  // The engine's system changed (a size was sent in another one, or another piece came): follow it.
  createEffect((before: string) => {
    const now = piece()?.params.sizeSystem ?? "";
    if (now !== before) setPicked(null);
    return now;
  }, piece()?.params.sizeSystem ?? "");

  const rows = createMemo((): PieceRow[] => {
    const held = piece();
    return held === null ? [] : pieceRows(held, props.choices, system());
  });
  const facts = createMemo(() => {
    const held = piece();
    return held === null ? [] : pieceFacts(held, system());
  });
  const failed = (): number => {
    const held = piece();
    return held === null ? 0 : failedChecks(held);
  };

  const [refused, setRefused] = createSignal<Refused | null>(null);

  // The rows change under a list whose own box does not (another kind, the halo's rows, a check
  // that wraps, the section unfolded): the list's hidden ends are marked again.
  let markEnds: (() => void) | undefined;
  createEffect(() => {
    props.state;
    system();
    open();
    queueMicrotask(() => markEnds?.());
  });

  /** Send a patch; a refusal is put on the row it names. Answers whether it went through. */
  const run = (params: Record<string, unknown>): boolean => {
    const error = props.onRun(params);
    if (error === null) {
      setRefused(null);
      return true;
    }
    const key = refusalRow(error, rows());
    setRefused(key === null ? null : { key, message: refusalWords(error) });
    return false;
  };

  return (
    <aside class={open() ? "properties piece" : "properties piece is-folded"}>
      <div class="properties-head">
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the piece" : "Show the piece"} expanded={open()} controls="piece-body" onClick={() => setOpen(!open())} />
        <SectionLabel>Piece</SectionLabel>
        <span class="properties-state" data-hint="">
          {pieceHeading(props.state, system())}
        </span>
      </div>
      <div
        class="properties-body"
        id="piece-body"
        hidden={!open()}
        ref={(element) => {
          markEnds = scrollEnds(element);
        }}
      >
        <Switch>
          <Match when={props.state.kind === "unavailable"}>
            <div class="properties-empty piece-note">The piece tools are not in this build.</div>
          </Match>
          <Match when={props.state.kind === "none"}>
            <div class="properties-empty piece-note" id="piece-start-line">
              No piece yet. Start one:
            </div>
            <div class="piece-starts" role="group" aria-labelledby="piece-start-line">
              <For each={PIECE_KINDS}>
                {(kind) => (
                  <Button size="sm" ariaLabel={`Start a ${kind.label.toLowerCase()}`} onClick={() => run({ kind: kind.value })}>
                    {kind.label}
                  </Button>
                )}
              </For>
              <Show when={props.onTemplates}>
                <Button variant="quiet" size="sm" ariaLabel="Start from a template" onClick={() => props.onTemplates?.()}>
                  Templates…
                </Button>
              </Show>
            </div>
          </Match>
          <Match when={props.state.kind === "piece"}>
            <div class="piece-list" role="list" aria-label="Piece parameters">
              <Index each={rows()}>{(row) => <PieceRowView row={row} system={system} refused={refused} onRefused={setRefused} onPick={setPicked} onRun={run} onNotice={props.onNotice} />}</Index>
            </div>
            <Show when={facts().length > 0}>
              <div class="piece-list piece-results" role="list" aria-label="Piece results">
                <For each={facts()}>
                  {(fact) => (
                    <div class="prop-row" role="listitem">
                      <span class="prop-label" data-hint="">
                        {fact.label}
                      </span>
                      <span class="prop-value">
                        <span class="prop-readonly">{fact.value}</span>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={(piece()?.checks.length ?? 0) > 0}>
              <div class="piece-list piece-checks" role="list" aria-label={failed() === 0 ? "Checks, all pass" : `Checks, ${failed()} failed`}>
                <For each={piece()?.checks ?? []}>
                  {(check) => (
                    <div class={check.ok ? "piece-check" : "piece-check is-failed"} role="listitem">
                      <span class="piece-check-text">{check.message}</span>
                      <span class="piece-check-mark">{check.ok ? "Pass" : "Fail"}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="piece-foot">
              <Button variant="quiet" size="sm" title="Undo brings it back" onClick={() => run({ remove: true })}>
                Remove piece
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </aside>
  );
}

interface PieceRowViewProps {
  row: Accessor<PieceRow>;
  system: Accessor<string>;
  refused: Accessor<Refused | null>;
  onRefused: (refused: Refused | null) => void;
  /** The size system was picked: it changes what is shown, and nothing in the drawing. */
  onPick: (system: string) => void;
  onRun: (params: Record<string, unknown>) => boolean;
  onNotice?: (message: string) => void;
}

function PieceRowView(props: PieceRowViewProps): JSX.Element {
  const [draft, setDraft] = createSignal(props.row().value);
  /** Typed into since the last commit or cancel: only then is there an edit to keep or send. */
  const [dirty, setDirty] = createSignal(false);
  /** Why the draft was refused before it reached the engine; null when it was not. */
  const [fault, setFault] = createSignal<string | null>(null);
  /** The text the last refusal was for, so Enter-then-blur neither warns nor sends twice. */
  let said: string | null = null;
  /** Set when the row leaves the page: the blur a removed field fires must not send anything. */
  let gone = false;
  onCleanup(() => {
    gone = true;
  });

  /** The engine's refusal standing on this row, if one is. */
  const engineFault = (): string | null => {
    const held = props.refused();
    return held !== null && held.key === props.row().key ? held.message : null;
  };
  const why = (): string | null => fault() ?? engineFault();
  const forget = (): void => {
    if (untrack(engineFault) !== null) props.onRefused(null);
  };

  /** Back to the engine's value, with no edit pending. */
  const settle = (): void => {
    said = null;
    setDirty(false);
    setFault(null);
    forget();
    setDraft(props.row().value);
  };

  // Re-seed when the engine's value changes (a refresh after a rebuild), never over text being typed.
  createEffect(() => {
    const value = props.row().value;
    if (!untrack(dirty)) setDraft(value);
  });
  // Another parameter in this place (the kind changed): the unfinished edit was not for it.
  createEffect((before: string) => {
    const now = props.row().key;
    if (now !== before) untrack(settle);
    return now;
  }, props.row().key);

  /** A picked value (a choice, a tick): sent unless it is the one already there. */
  const commit = (value: string): void => {
    if (props.row().key === "system") {
      props.onPick(value);
      return;
    }
    const verdict = judgePieceDraft(props.row(), value, props.system());
    if (verdict.kind !== "send") return;
    // Refused, the control shows the engine's value again (the refusal is on its row).
    if (!props.onRun(verdict.patch)) setDraft(props.row().value);
  };

  /**
   * Commit the typed text. Text that is refused (here, or by the engine) is said once and stays
   * in the field, marked, while it has the focus (`leaving` false); on the way out the engine's
   * value comes back.
   */
  const commitText = (leaving: boolean): void => {
    if (gone || !dirty()) return;
    const value = draft();
    if (said === value) {
      if (leaving) settle();
      return;
    }
    const verdict = judgePieceDraft(props.row(), value, props.system());
    if (verdict.kind === "keep") {
      settle();
      return;
    }
    if (verdict.kind === "refuse") {
      props.onNotice?.(verdict.message);
      if (leaving) {
        settle();
        return;
      }
      said = value;
      setFault(verdict.message);
      return;
    }
    // Not dirty while the engine answers: the refresh a rebuild brings re-seeds the field.
    setDirty(false);
    setFault(null);
    if (props.onRun(verdict.patch)) {
      said = null;
      return;
    }
    if (leaving) {
      settle();
      return;
    }
    said = value;
    setDirty(true);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitText(false);
    } else if (e.key === "Escape" && (dirty() || why() !== null)) {
      // Escape cancels this edit only; with nothing to cancel it is the shell's.
      e.preventDefault();
      e.stopPropagation();
      settle();
    }
  };

  /** Which control the row gets; the control is kept across refreshes, so focus survives one. */
  const mode = createMemo((): "choice" | "tick" | "text" => {
    const kind = props.row().kind;
    return kind === "choice" || kind === "tick" ? kind : "text";
  });
  /** A length takes the decimal keyboard; a UK size and "auto" are letters. */
  const inputMode = (): "decimal" | "numeric" | undefined => {
    const kind = props.row().kind;
    if (kind === "number") return "decimal";
    if (kind === "whole") return "numeric";
    if (kind === "size") return props.system() === "uk" ? undefined : "decimal";
    return undefined;
  };

  return (
    <div class="prop-row" role="listitem">
      <span class="prop-label" data-hint="">
        {props.row().label}
      </span>
      <span class="prop-value">
        <Switch>
          <Match when={mode() === "tick"}>
            <Checkbox
              ariaLabel={props.row().label}
              checked={draft() === "true"}
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
                invalid={why() !== null}
                title={why() ?? undefined}
                options={props.row().choices ?? []}
                onChange={(value) => {
                  setDraft(value);
                  commit(value);
                }}
              />
            </span>
          </Match>
          <Match when={mode() === "text"}>
            <span class="prop-choice">
              <Field
                variant="inline"
                size="sm"
                align="end"
                ariaLabel={props.row().label}
                value={draft()}
                invalid={why() !== null}
                title={why() ?? undefined}
                placeholder={props.row().kind === "size" ? sizeExample(props.system()) : undefined}
                inputMode={inputMode()}
                spellcheck={false}
                autocomplete="off"
                autocapitalize="off"
                onInput={(value) => {
                  said = null;
                  setDirty(true);
                  setFault(null);
                  forget();
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
