/**
 * The proposals waiting for a decision, as cards over the assistant's composer (drawn as
 * this one component in the stack, `AssistantPane`'s `stack`): what a change would do to the
 * drawing, with Accept and Reject, before anything is changed.
 *
 * A card is a labelled region: its title, the checks the change would make fail (first, in the
 * warning ink and in words), a table of the figures that differ (label, before, after, the signed
 * difference), the checks it would make pass, the objects line when there is no piece to describe,
 * and a still of the piece before and after when both sides have one (drawn lazily by
 * `../proposals`' still cache, one at a time, kept by the parameters). A proposal the drawing has
 * moved past says so and offers only Reject. The variants of one `propose` stand side by side
 * where the panel has the room and one under another where it has not, each with its own Accept,
 * under one "Reject all".
 *
 * Every figure and sentence is `../proposals`' (shared, pure, tested); this file only draws them
 * and hands the presses back. After a decision the keyboard goes to the composer (`onDecided`).
 */

import { createEffect, For, Match, Show, Switch, untrack, type JSX } from "solid-js";
import { changeRows, checkLines, hasStills, objectsLine, rowsTsv, type ChangeRow, type Proposal, type ProposalGroup, type ProposalsModel, type StillCache } from "../proposals";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import "../proposals.css";

export interface ProposalCardsProps {
  model: ProposalsModel;
  /** Absent: no stills are drawn (a card still shows every figure). */
  stills?: StillCache;
  /** A turn is running: Accept waits for it to end (the model may still be changing the drawing). */
  busy: boolean;
  /** A proposal was accepted (its title) or rejected (null): the keyboard goes back to the composer. */
  onDecided: (accepted: string | null) => void;
}

function Still(props: { cache: StillCache; params: Readonly<Record<string, unknown>>; side: "Before" | "After" }): JSX.Element {
  createEffect(() => {
    const params = props.params;
    untrack(() => props.cache.request(params));
  });
  const state = () => props.cache.state(props.params);
  return (
    <figure class="proposal-still">
      <Switch fallback={<div class="proposal-still-tile" aria-hidden="true" />}>
        <Match when={state()?.kind === "done" ? state() : undefined}>
          {(done) => <img class="proposal-still-tile" src={(done() as { url: string }).url} alt={props.side === "Before" ? "The piece as it is" : "The piece as it would be"} />}
        </Match>
        <Match when={state()?.kind === "failed" ? state() : undefined}>
          {(failed) => <p class="proposal-still-tile proposal-still-note">{(failed() as { message: string }).message}</p>}
        </Match>
      </Switch>
      <figcaption>{props.side}</figcaption>
    </figure>
  );
}

/**
 * A copy made inside the table writes the rows it touches as tab-separated lines, whatever the
 * card's layout draws them as. A selection that runs out of the table is the browser's to copy.
 */
function copyRows(e: ClipboardEvent, rows: readonly ChangeRow[]): void {
  const table = e.currentTarget;
  const selection = window.getSelection();
  if (!(table instanceof HTMLTableElement) || selection === null || selection.isCollapsed || e.clipboardData === null) return;
  const range = selection.getRangeAt(0);
  if (!table.contains(range.commonAncestorContainer)) return;
  const touched = rows.filter((row) => {
    const tr = table.querySelector(`tr[data-row="${CSS.escape(row.key)}"]`);
    return tr !== null && selection.containsNode(tr, true);
  });
  if (touched.length === 0) return;
  e.clipboardData.setData("text/plain", rowsTsv(touched));
  e.preventDefault();
}

function Card(props:{ proposal: Proposal; cards: ProposalCardsProps }): JSX.Element {
  const p = (): Proposal => props.proposal;
  const titleId = (): string => `proposal-${p().id}-title`;
  const rows = () => changeRows(p());
  const checks = () => checkLines(p());
  const objects = () => objectsLine(p());
  const refusal = () => props.cards.model.refusal(p().id);
  const accept = (): void => {
    if (props.cards.busy || p().stale) return;
    const title = p().title;
    if (props.cards.model.accept(p().id) === null) props.cards.onDecided(title);
  };
  const reject = (): void => {
    if (props.cards.model.reject(p().id) === null) props.cards.onDecided(null);
  };
  return (
    <section class={p().stale ? "proposal is-stale" : "proposal"} role="region" aria-labelledby={titleId()}>
      <div class="proposal-head">
        <h3 class="proposal-title" id={titleId()} data-hint="">
          {p().title}
        </h3>
        <Show when={p().stale}>
          <Chip title="The drawing changed since this was proposed">Out of date</Chip>
        </Show>
      </div>
      <Show when={checks().broken.length > 0}>
        <ul class="proposal-checks proposal-checks--broken" aria-label="Checks it would fail">
          <For each={checks().broken}>
            {(c) => (
              <li>
                <span class="proposal-check-word">Would fail</span> {c.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.cards.stills !== undefined && hasStills(p())}>
        <div class="proposal-stills">
          <Show when={p().before.params}>{(params) => <Still cache={props.cards.stills as StillCache} params={params()} side="Before" />}</Show>
          <Show when={p().after.params}>{(params) => <Still cache={props.cards.stills as StillCache} params={params()} side="After" />}</Show>
        </div>
      </Show>
      <Show when={rows().length > 0}>
        {/* The roles are said outright: a narrow card draws the rows as grids (proposals.css),
            which would otherwise take the table's meaning away from a screen reader. */}
        <table class="proposal-table" role="table" aria-labelledby={`${titleId()}-figures`} onCopy={(e) => copyRows(e, rows())}>
          <caption class="proposal-said" id={`${titleId()}-figures`}>
            What changes
          </caption>
          <thead class="proposal-table-head" role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                Figure
              </th>
              <th scope="col" role="columnheader">
                Before
              </th>
              <th scope="col" role="columnheader">
                After
              </th>
              <th scope="col" role="columnheader">
                Change
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <For each={rows()}>
              {(row) => (
                <tr role="row" data-row={row.key}>
                  <th scope="row" role="rowheader">
                    {row.label}
                  </th>
                  <td class="proposal-before" role="cell">
                    {row.before}
                  </td>
                  <td class="proposal-after" role="cell">
                    {row.after}
                  </td>
                  <td class="proposal-delta" role="cell">
                    {row.delta ?? ""}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      <Show when={checks().fixed.length > 0}>
        <ul class="proposal-checks" aria-label="Checks it would pass">
          <For each={checks().fixed}>
            {(c) => (
              <li>
                <span class="proposal-check-word">Would pass</span> {c.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={checks().stillFailing > 0}>
        <p class="proposal-line">{checks().stillFailing === 1 ? "1 check fails before and after" : `${checks().stillFailing} checks fail before and after`}</p>
      </Show>
      <Show when={objects()}>{(line) => <p class="proposal-line">{line()}</p>}</Show>
      <Show when={p().stale}>
        <p class="proposal-line proposal-line--stale">The drawing changed since this was proposed, so it can no longer be accepted.</p>
      </Show>
      <Show when={refusal() !== null && !p().stale}>
        <p class="proposal-line proposal-line--stale">{refusal()}</p>
      </Show>
      <div class="proposal-actions">
        <Button variant="ghost" size="sm" title="Forget it; the drawing stays as it is" onClick={reject}>
          Reject
        </Button>
        <Show when={!p().stale}>
          <Button variant="primary" size="sm" disabled={props.cards.busy} title={props.cards.busy ? "Wait for this turn to end" : "Make this change as one undo step"} onClick={accept}>
            Accept
          </Button>
        </Show>
      </div>
    </section>
  );
}

function Group(props: { group: ProposalGroup; cards: ProposalCardsProps }): JSX.Element {
  const many = (): boolean => props.group.items.length > 1;
  const headId = (): string => `proposal-group-${props.group.group}`;
  return (
    <div class="proposal-group" role="group" aria-labelledby={many() ? headId() : undefined}>
      <Show when={many()}>
        <div class="proposal-group-head">
          <span class="proposal-group-count" id={headId()}>{`${props.group.items.length} options: accept one`}</span>
          <Button
            variant="ghost"
            size="sm"
            title="Forget every option; the drawing stays as it is"
            onClick={() => {
              if (props.cards.model.rejectGroup(props.group.group) === null) props.cards.onDecided(null);
            }}
          >
            Reject all
          </Button>
        </div>
      </Show>
      <div class="proposal-variants">
        <For each={props.group.items}>{(p) => <Card proposal={p} cards={props.cards} />}</For>
      </div>
    </div>
  );
}

export function ProposalCards(props: ProposalCardsProps): JSX.Element {
  return (
    <>
      {/* Said politely when a proposal arrives and when one is decided; always in the page, so
          the first arrival is heard too. */}
      <p class="proposal-said" role="status" aria-live="polite" aria-atomic="true">
        {props.model.said()}
      </p>
      <Show when={props.model.list().length > 0}>
        <div class="assistant-proposals">
          <For each={props.model.groups()}>{(g) => <Group group={g} cards={props} />}</For>
        </div>
      </Show>
    </>
  );
}
