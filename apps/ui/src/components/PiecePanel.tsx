/**
 * The Piece section: the parametric ring the engine's `piece` command builds, as the first
 * section of the rail. With no piece it offers the three kinds; with one it shows a summary (size,
 * metal, stones, the centre stone), any failing check, then the parameters in groups (Ring, Band,
 * Stones, Head; `pieceGroups`), and lists the parameters
 * that apply to its kind, each edited in place, then what the engine worked out (the metal's
 * weight, the stones, the size in the other systems) and its checks, and a way to remove it.
 *
 * `../piece` holds the logic: the reply's narrowing, the rows of a kind, what typed text becomes
 * (`judgePieceDraft`) and the row a refusal belongs on (`refusalRow`); `../piece-edit` holds how a
 * row is edited (when a draft is sent, kept or cancelled) and the section's state. No jewelry number is worked out
 * here: every
 * figure is the engine's.
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
import { passingLine, pieceGroups, pieceHeading, pieceSummary, PIECE_KINDS, profileUpdate, railUpdate, rowShownName, rowUnit, type PieceChoices, type PieceRow, type PieceState } from "../piece";
import { createPieceSection, createRowEdit, type Refused } from "../piece-edit";
import { sizeExample } from "../jewelry-dialog";
import { ToolIcon } from "../icons";
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
  // The piece, the size system shown, its rows and the refusal standing on one: `../piece-edit`'s.
  const { piece, system, setPicked, rows, facts, failed, refused, setRefused, run } = createPieceSection(props);
  // The layout over the same figures: the summary on top, the failing checks under it, the
  // parameters in their groups, the other systems' sizes in the ring's group, the passing checks last.
  const summary = createMemo(() => {
    const held = piece();
    return held === null ? null : pieceSummary(held, system());
  });
  const groups = createMemo(() => pieceGroups(rows(), piece()?.params.kind ?? ""));
  const failing = createMemo(() => (piece()?.checks ?? []).filter((c) => !c.ok));
  const passing = createMemo(() => (piece()?.checks ?? []).filter((c) => c.ok));
  /** The passing checks fold to one line ("6 checks pass"); the failing ones always show. */
  const [showPassing, setShowPassing] = createSignal(false);
  const others = createMemo(() => facts().filter((f) => f.label === "Also"));

  // The rows change under a list whose own box does not (another kind, the halo's rows, a check
  // that wraps, the section unfolded): the list's hidden ends are marked again.
  let markEnds: (() => void) | undefined;
  createEffect(() => {
    props.state;
    system();
    open();
    showPassing();
    queueMicrotask(() => markEnds?.());
  });

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
            <Show when={summary()}>
              {(s) => (
                <div class="piece-summary" role="group" aria-label="Summary">
                  <Show when={s().tiles.length > 0}>
                    <dl class="piece-tiles">
                      <For each={s().tiles}>
                        {(tile) => (
                          <div class="piece-tile">
                            <dt class="piece-tile-label">{tile.label}</dt>
                            <dd class="piece-tile-value">{tile.value}</dd>
                            <Show when={tile.detail !== ""}>
                              <dd class="piece-tile-detail">{tile.detail}</dd>
                            </Show>
                          </div>
                        )}
                      </For>
                    </dl>
                  </Show>
                  <Show when={s().centre}>{(centre) => <p class="piece-centre">{centre()}</p>}</Show>
                </div>
              )}
            </Show>
            <Show when={failing().length > 0}>
              <div class="piece-list piece-failing" role="list" aria-label={`Checks, ${failed()} failed`}>
                <For each={failing()}>
                  {(check) => (
                    <div class="piece-check is-failed" role="listitem">
                      <span class="piece-check-mark">Fail</span>
                      <span class="piece-check-text">{check.message}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Index each={groups()}>
              {(group) => (
                <div class="piece-group">
                  <div class="piece-group-label" aria-hidden="true">
                    {group().name}
                  </div>
                  <div class="piece-list" role="list" aria-label={`${group().name} parameters`}>
                    <Index each={group().rows}>{(row) => <PieceRowView row={row} system={system} refused={refused} onRefused={setRefused} onPick={setPicked} onRun={run} onNotice={props.onNotice} />}</Index>
                    <Show when={group().name === "Ring" || group().name === "Piece"}>
                      <For each={others()}>
                        {(fact) => (
                          <div class="prop-row piece-also" role="listitem">
                            <span class="prop-label" data-hint="">
                              {fact.label}
                            </span>
                            <span class="prop-value">
                              <span class="prop-readonly" title={fact.value}>
                                {fact.value}
                              </span>
                            </span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              )}
            </Index>
            <Show when={passing().length > 0}>
              <div class="piece-passing">
                <Button variant="quiet" size="sm" expanded={showPassing()} controls="piece-passing-list" onClick={() => setShowPassing(!showPassing())}>
                  <span class="piece-passing-chevron" aria-hidden="true" data-open={showPassing() ? "" : undefined}>
                    <ToolIcon id="chevron-right" />
                  </span>
                  {passingLine(passing().length, failed())}
                </Button>
              </div>
              <div class="piece-list piece-checks" id="piece-passing-list" hidden={!showPassing()} role="list" aria-label={failed() === 0 ? "Checks, all pass" : "Checks that pass"}>
                <For each={passing()}>
                  {(check) => (
                    <div class="piece-check" role="listitem">
                      <span class="piece-check-text">{check.message}</span>
                      <span class="piece-check-mark">Pass</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="piece-foot">
              <Show when={props.state.kind === "piece" ? profileUpdate(props.state.piece) : null}>
                {(patch) => (
                  <Button variant="quiet" size="sm" title="Read the profile again from the curve it was drawn as" onClick={() => run(patch())}>
                    Update from curve
                  </Button>
                )}
              </Show>
              <Show when={props.state.kind === "piece" ? railUpdate(props.state.piece) : null}>
                {(patch) => (
                  <Button variant="quiet" size="sm" title="Read the rail again from the curve it was drawn as" onClick={() => run(patch())}>
                    Update rail from curve
                  </Button>
                )}
              </Show>
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

  /** The engine's refusal standing on this row, if one is. */
  const engineFault = (): string | null => {
    const held = props.refused();
    return held !== null && held.key === props.row().key ? held.message : null;
  };
  // What becomes of the draft is `../piece-edit`'s.
  const edit = createRowEdit({
    row: () => props.row(),
    system: () => props.system(),
    draft,
    setDraft,
    dirty,
    setDirty,
    fault,
    setFault,
    engineFault,
    forget: () => {
      if (untrack(engineFault) !== null) props.onRefused(null);
    },
    pick: (system) => props.onPick(system),
    run: (patch) => props.onRun(patch),
    notice: (message) => props.onNotice?.(message),
  });
  // The row leaves the page: the blur a removed field fires must not send anything.
  onCleanup(edit.gone);
  const why = edit.why;

  // Re-seed when the engine's value changes (a refresh after a rebuild), never over text being typed.
  createEffect(() => {
    const value = props.row().value;
    if (!untrack(dirty)) setDraft(value);
  });
  // Another parameter in this place (the kind changed): the unfinished edit was not for it.
  createEffect((before: string) => {
    const now = props.row().key;
    if (now !== before) untrack(edit.settle);
    return now;
  }, props.row().key);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      edit.commitText(false);
    } else if (e.key === "Escape" && edit.cancel()) {
      // Escape cancels this edit only; with nothing to cancel it is the shell's.
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** Which control the row gets; the control is kept across refreshes, so focus survives one. */
  const mode = createMemo((): "choice" | "tick" | "text" | "readonly" => {
    const kind = props.row().kind;
    return kind === "choice" || kind === "tick" || kind === "readonly" ? kind : "text";
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
        {rowShownName(props.row())}
      </span>
      <span class="prop-value">
        <Switch>
          <Match when={mode() === "readonly"}>
            <span class="prop-readonly" title="From the drawn profile: scale the curve and update the piece from it">
              {props.row().value}
              {rowUnit(props.row()) === "" ? "" : ` ${rowUnit(props.row())}`}
            </span>
          </Match>
          <Match when={mode() === "tick"}>
            <Checkbox
              ariaLabel={props.row().label}
              checked={draft() === "true"}
              onChange={(checked) => {
                const value = checked ? "true" : "false";
                setDraft(value);
                edit.commit(value);
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
                  edit.commit(value);
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
                end={
                  rowUnit(props.row()) === "" ? undefined : (
                    <span class="piece-unit" aria-hidden="true">
                      {rowUnit(props.row())}
                    </span>
                  )
                }
                spellcheck={false}
                autocomplete="off"
                autocapitalize="off"
                onInput={edit.typed}
                onKeyDown={onKeyDown}
                onBlur={() => edit.commitText(true)}
              />
            </span>
          </Match>
        </Switch>
      </span>
    </div>
  );
}
