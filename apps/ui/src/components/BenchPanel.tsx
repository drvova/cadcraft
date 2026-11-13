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
import { benchSummary, caratText, lineSelected, trim, type BenchCost, type BenchLine, type BenchSheet } from "../bench";
import { Button } from "../ui/Button";
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
  /** Whether the engine has the Price Book command (the running wasm may not yet): the cost
   *  affordance shows only when it does. */
  canPrice: boolean;
  /** Open the Price Book editor. */
  onEditPrices: () => void;
}

/** The estimated cost under the sheet: the metal, the stones, any labor, the total, and the
 *  lines the engine could not price. Shown only when the engine priced a cost. */
function CostGroup(props: { cost: BenchCost; onEdit: () => void }): JSX.Element {
  const unpriced = () => props.cost.lines.filter((line) => line.amount === null);
  return (
    <div class="bench-cost" role="group" aria-label="Estimated cost">
      <div class="bench-cost-head">
        <SectionLabel>Cost</SectionLabel>
        <Button variant="quiet" size="sm" title="Change the drawing's prices" onClick={() => props.onEdit()}>
          Edit prices
        </Button>
      </div>
      <dl class="bench-cost-rows">
        <div class="bench-cost-row">
          <dt>Metal</dt>
          <dd>{props.cost.metal}</dd>
        </div>
        <div class="bench-cost-row">
          <dt>Stones</dt>
          <dd>{props.cost.stones}</dd>
        </div>
        <Show when={props.cost.labor !== null}>
          <div class="bench-cost-row">
            <dt>Labor</dt>
            <dd>{props.cost.labor}</dd>
          </div>
        </Show>
        <div class="bench-cost-row bench-cost-total">
          <dt>Total</dt>
          <dd>{props.cost.total}</dd>
        </div>
      </dl>
      <For each={unpriced()}>
        {(line) => (
          <p class="bench-cost-unpriced">
            {line.what} — unpriced{line.note === null ? "" : ` (${line.note})`}
          </p>
        )}
      </For>
      <p class="bench-cost-note">An estimate from the prices you set, not a market quote.</p>
    </div>
  );
}

/** One line of the sheet: a press selects what it counts when the engine named its objects, else
 *  it is read-only. Its value is the sheet's two numeric columns when the line has them. */
function LineView(props: { line: BenchLine; selected: ReadonlySet<string>; onPress: (line: BenchLine) => void }): JSX.Element {
  const value = (): JSX.Element =>
    props.line.cells === undefined ? (
      <span class="bench-value">{props.line.value}</span>
    ) : (
      <>
        <span class="bench-cell bench-count">{props.line.cells[0]}</span>
        <span class="bench-cell">{props.line.cells[1]}</span>
      </>
    );
  return (
    <Show
      when={props.line.handles.length > 0}
      fallback={
        <div class="bench-static" role="listitem" data-hint={props.line.note ?? undefined}>
          <span class="bench-label">{props.line.label}</span>
          {value()}
        </div>
      }
    >
      <div class="bench-line" role="listitem">
        <Row selected={lineSelected(props.line, props.selected)} title={props.line.note ?? undefined} onClick={() => props.onPress(props.line)}>
          <span class="bench-label">{props.line.label}</span>
          {value()}
        </Row>
      </div>
    </Show>
  );
}

interface SheetPart {
  name: string;
  totals: [string, string];
  lines: BenchLine[];
}

/** The sheet's two parts, each with its totals on its head line: the stones (pieces, carats),
 *  then the metal (its weight). A part with no line is left out. */
function sheetParts(sheet: BenchSheet | null): SheetPart[] {
  if (sheet === null) return [];
  const stones = sheet.lines.filter((l) => l.part !== "metal");
  const metal = sheet.lines.filter((l) => l.part === "metal");
  const parts: SheetPart[] = [];
  if (stones.length > 0) parts.push({ name: "Stones", totals: [`${sheet.stones.toLocaleString("en-US")} pc`, caratText(sheet.carat)], lines: stones });
  if (metal.length > 0) parts.push({ name: "Metal", totals: ["", `${trim(sheet.grams, 2)} g`], lines: metal });
  return parts;
}

export function BenchPanel(props: BenchPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. */
  const [open, setOpen] = createSignal(true);
  const summary = (): string => benchSummary(props.sheet);
  const empty = (): boolean => (props.sheet?.lines.length ?? 0) === 0;
  const selected = createMemo(() => new Set(props.selection));
  const parts = createMemo(() => sheetParts(props.sheet));
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
      <div class="properties-body" id="bench-body" role="group" aria-label="Bench sheet" hidden={!open()}>
        <For each={parts()}>
          {(part) => (
            <div class="bench-part">
              <div class="bench-part-head" aria-hidden="true">
                <span class="bench-label">{part.name}</span>
                <span class="bench-cell bench-count">{part.totals[0]}</span>
                <span class="bench-cell">{part.totals[1]}</span>
              </div>
              <div class="bench-part-list" role="list" aria-label={part.name}>
                <For each={part.lines}>{(line) => <LineView line={line} selected={selected()} onPress={press} />}</For>
              </div>
            </div>
          )}
        </For>
        <For each={props.sheet?.warnings ?? []}>{(warning) => <div class="properties-empty bench-warning">{warning}</div>}</For>
        <Show when={empty()}>
          <div class="properties-empty">No stones or bands yet.</div>
        </Show>
        <Show when={props.sheet?.cost ?? null}>{(cost) => <CostGroup cost={cost()} onEdit={() => props.onEditPrices()} />}</Show>
        <Show when={props.canPrice && !empty() && (props.sheet?.cost ?? null) === null}>
          <div class="bench-set">
            <Button variant="quiet" size="sm" title="Price the metal and stones to estimate what the piece costs" onClick={() => props.onEditPrices()}>
              Set prices to estimate cost
            </Button>
          </div>
        </Show>
      </div>
    </aside>
  );
}
