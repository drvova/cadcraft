/**
 * The bench panel: the piece's stones and metal, counted by the engine (`techsheet`) every time
 * the drawing changes and shown as a third section of the rail. Each stone line is a cut and a
 * size with how many and their carats; each band is its size, alloy and grams; the heading
 * carries the totals. It is a reading, not an editor: the rows are the properties palette's
 * read-only rows (`.prop-row`, `../interaction.css`), so the two sections share one column.
 *
 * No engine call lives here: the shell runs the sheet and hands it over (`../bench` reads it).
 * A stone off the calibrated melee list says so in the system's hint on its row.
 */

import { createSignal, For, Show, type JSX } from "solid-js";
import { benchSummary, type BenchSheet } from "../bench";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import "../interaction.css";

export interface BenchPanelProps {
  /** The sheet of the drawing in front; null when the engine could not read one. */
  sheet: BenchSheet | null;
}

export function BenchPanel(props: BenchPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const summary = (): string => benchSummary(props.sheet);
  const empty = (): boolean => (props.sheet?.lines.length ?? 0) === 0;

  return (
    <aside class={open() ? "properties bench" : "properties bench is-folded"}>
      <div class="properties-head">
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the bench sheet" : "Show the bench sheet"} expanded={open()} controls="bench-body" onClick={() => setOpen(!open())} />
        <SectionLabel>Bench</SectionLabel>
        <span class="properties-state" data-hint="">
          {summary()}
        </span>
      </div>
      <div class="properties-body" id="bench-body" role="list" aria-label="Bench sheet" hidden={!open()}>
        <For each={props.sheet?.lines ?? []}>
          {(line) => (
            <div class="prop-row" role="listitem" data-hint={line.note ?? undefined}>
              <span class="prop-label" data-hint="">
                {line.label}
              </span>
              <span class="prop-value">
                <span class="prop-readonly">{line.value}</span>
              </span>
            </div>
          )}
        </For>
        <For each={props.sheet?.warnings ?? []}>{(warning) => <div class="properties-empty bench-warning">{warning}</div>}</For>
        <Show when={empty()}>
          <div class="properties-empty">No stones or bands yet.</div>
        </Show>
      </div>
    </aside>
  );
}
