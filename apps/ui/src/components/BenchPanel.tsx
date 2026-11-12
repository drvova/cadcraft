/**
 * The bench panel: the piece's stones and metal, counted by the engine (`techsheet`) every time
 * the drawing changes and shown as a third section of the rail. Each stone line is a cut and a
 * size with how many and their carats; each band is its size, alloy and grams; the heading
 * carries the totals.
 *
 * A line is the sheet's way into the drawing: a press selects what it counts (every 1.3 mm
 * round, the band), and a second press lets the selection go. The line whose objects are all
 * selected is marked current, so picking stones on the drawing lights their line too. Each is the
 * system's `Row` in a list item; a line the engine named no objects for is read-only text in the
 * properties palette's row (`.prop-row`, `../interaction.css`).
 *
 * No engine call lives here: the shell runs the sheet and hands it over (`../bench` reads it),
 * and the shell selects. A stone off the calibrated melee list says so in the system's hint.
 */

import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { benchSummary, lineSelected, type BenchLine, type BenchSheet } from "../bench";
import { IconButton } from "../ui/IconButton";
import { Row } from "../ui/Row";
import { SectionLabel } from "../ui/SectionLabel";
import "../interaction.css";

export interface BenchPanelProps {
  /** The sheet of the drawing in front; null when the engine could not read one. */
  sheet: BenchSheet | null;
  /** The handles selected on the drawing: the line they make up is marked current. */
  selection: readonly string[];
  /** Select these objects on the drawing; an empty list lets the selection go. */
  onSelect: (handles: readonly string[]) => void;
}

export function BenchPanel(props: BenchPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const summary = (): string => benchSummary(props.sheet);
  const empty = (): boolean => (props.sheet?.lines.length ?? 0) === 0;
  const selected = createMemo(() => new Set(props.selection));
  const press = (line: BenchLine): void => props.onSelect(lineSelected(line, selected()) ? [] : line.handles);

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
            <Show
              when={line.handles.length > 0}
              fallback={
                <div class="prop-row" role="listitem" data-hint={line.note ?? undefined}>
                  <span class="prop-label" data-hint="">
                    {line.label}
                  </span>
                  <span class="prop-value">
                    <span class="prop-readonly">{line.value}</span>
                  </span>
                </div>
              }
            >
              <div class="bench-line" role="listitem">
                <Row selected={lineSelected(line, selected())} title={line.note ?? undefined} onClick={() => press(line)}>
                  <span class="bench-label">{line.label}</span>
                  <span class="bench-value">{line.value}</span>
                </Row>
              </div>
            </Show>
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
