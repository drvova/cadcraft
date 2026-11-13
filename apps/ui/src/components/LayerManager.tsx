/**
 * The Layer Properties Manager: the dialog a drafter opens to see every layer of the drawing in
 * one table and change any of them. A row per layer: its status (the current layer's mark, and
 * whether anything is drawn on it), its name, the on, freeze, lock and plot keys (the layer's
 * glyph `Toggle`, the sidebar list's own glyphs and inks), its colour, linetype, lineweight and
 * transparency (inline `Select`s) and its description.
 *
 * It is a manager, not a form: there is no OK and no Cancel. Every change is an engine command
 * run at once (`../layer-manager.ts` holds the calls and says why these), the table is then read
 * again from the engine, so it never shows a value the engine did not take, and the shell is told
 * (`onChanged`) so the drawing behind and the sidebar's list follow. A change the engine refuses
 * is said in its own words on the line under the layer's row, and once in a live region.
 *
 * A change made on one of several selected rows is made on all of them, as one undo step.
 *
 * The table is a `role="grid"` built from boxes, not a native `<table>`: only the rows near the
 * viewport are in the page (a drawing may hold thousands of layers), each placed by its index,
 * and a native table cannot place rows that way and keep its columns. The grid says how many rows
 * there are (`aria-rowcount`) and which each is (`aria-rowindex`). It is one Tab stop: the
 * arrows move the active cell (a roving `tabindex`), and the controls inside the cells are out
 * of the Tab order; a key on a cell works its control.
 *
 * The component is not mounted here: the shell owns `open`.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ToolIcon } from "../icons";
import {
  ariaSort,
  countText,
  LAYER_COLOR_CHOICES,
  LAYER_LINEWEIGHT_CHOICES,
  LAYER_TRANSPARENCY_CHOICES,
  quoted,
  shownName,
  windowOf,
  type GridCell,
  type LayerEngine,
  type LayerRow,
} from "../layer-manager";
import { COLUMNS, createLayerManagerEdit, type ChoiceKey, type Column, type FlagKey, type TextKey } from "../layer-manager-edit";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { Select, type SelectOption } from "../ui/Select";
import { Toggle, type ToggleTone } from "../ui/Toggle";
import { splitName } from "./LayersPanel";
import "../dialogs.css";

export interface LayerManagerProps {
  /** The engine: `AppFacade` is one. Read on every opening and after every change. */
  facade: LayerEngine;
  /** Whether the dialog is showing. The shell holds it. */
  open: boolean;
  /** The dialog is done: the shell sets `open` false. Every change was already applied. */
  onClose: () => void;
  /** The engine's layers were changed: the shell reads its state again. */
  onChanged: () => void;
}

/** Each flag as its key draws it: the sidebar list's glyphs, inks and words. */
const FLAGS: Readonly<Record<FlagKey, { icon: string; iconOn: string; tone: ToggleTone; word: string; turnOn: string; turnOff: string }>> = {
  on: { icon: "layer.off", iconOn: "layer.on", tone: "absent", word: "on", turnOn: "Turn on", turnOff: "Turn off" },
  frozen: { icon: "layer.thawed", iconOn: "layer.frozen", tone: "info", word: "frozen", turnOn: "Freeze", turnOff: "Thaw" },
  locked: { icon: "layer.unlocked", iconOn: "layer.locked", tone: "caution", word: "locked", turnOn: "Lock", turnOff: "Unlock" },
  plot: { icon: "close", iconOn: "plot", tone: "absent", word: "plotted", turnOn: "Plot", turnOff: "Do not plot" },
};

const COLOR_OPTIONS: readonly SelectOption[] = LAYER_COLOR_CHOICES.map((name) => ({ value: name, label: name }));
const LINEWEIGHT_OPTIONS: readonly SelectOption[] = LAYER_LINEWEIGHT_CHOICES.map((name) => ({ value: name, label: name }));
const TRANSPARENCY_OPTIONS: readonly SelectOption[] = LAYER_TRANSPARENCY_CHOICES.map((percent) => ({ value: String(percent), label: `${percent}%` }));

/** The rows drawn past each edge of the viewport, so a scroll shows rows and not a gap. */
const OVERSCAN = 8;

/** A row's height before the page is laid out: the list row of `tokens.css`. */
const ROW_HEIGHT = 22;

/** A layer's own colour for its swatch, as the engine gave it (`colorRgb`, 0 to 255 a channel):
 *  the drawing's data, as the sidebar list paints it, never an ink of the interface. */
function swatchColor(channels: readonly [number, number, number]): string {
  return `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;
}

/** The index of the last row that starts at or before `line`. */
function rowAtLine(tops: readonly number[], line: number): number {
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((tops[mid] ?? 0) <= line) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function LayerManager(props: LayerManagerProps): JSX.Element {
  /** The row under the pointer: its choices are lists, as the active row's are. */
  const [hot, setHot] = createSignal(-1);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewHeight, setViewHeight] = createSignal(0);
  const [rowHeight, setRowHeight] = createSignal(ROW_HEIGHT);

  let grid: HTMLDivElement | undefined;
  let scroller: HTMLDivElement | undefined;
  let head: HTMLDivElement | undefined;
  let probe: HTMLDivElement | undefined;

  /* ---- Focus ---- */

  const cellAt = (cell: GridCell): HTMLElement | null => grid?.querySelector<HTMLElement>(`[data-row="${cell.row}"] > [data-col="${cell.column}"]`) ?? null;

  /** Put the keyboard on the active cell and bring it into view, clear of the sticky header. */
  const focusActive = (): void => {
    const el = cellAt(edit.active());
    if (el === null) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const openChoice = (cell: GridCell): void => {
    const control = cellAt(cell)?.querySelector<HTMLSelectElement>("select");
    if (control === null || control === undefined) return;
    control.focus();
    if (typeof control.showPicker === "function") control.showPicker();
  };

  /** How many rows a page key moves: the rows in view, less one to keep the place. */
  const pageRows = (): number => Math.max(1, Math.floor(viewHeight() / rowHeight()) - 1);

  // The state, the engine calls and the keys are shared with the dialog Slab draws (`../layer-manager-edit`).
  const edit = createLayerManagerEdit(props, {
    focusActive,
    openChoice,
    revealCell: (cell) => cellAt(cell)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    pageRows,
  });
  const { rows, sort, filter, selection, active, editing, draft, refusals, said, shown, order, removable, currentable, renamable, change, isEditing } = edit;

  const linetypeOptions = createMemo((): readonly SelectOption[] => edit.linetypeNames().map((name) => ({ value: name, label: name })));

  /** Where each row stands, in lines: a row with a refusal under it takes two. */
  const layout = createMemo(() => {
    const refused = refusals();
    const names = order();
    const tops: number[] = new Array<number>(names.length);
    let line = 0;
    for (let i = 0; i < names.length; i++) {
      tops[i] = line;
      line += refused.size > 0 && refused.has(names[i] ?? "") ? 2 : 1;
    }
    return { tops, lines: line };
  });

  /** The rows in the page: the ones near the viewport, and the one the keyboard is on. */
  const drawn = createMemo((): number[] => {
    const { tops, lines } = layout();
    const count = tops.length;
    if (count === 0) return [];
    const span = windowOf(scrollTop(), viewHeight(), rowHeight(), lines, OVERSCAN);
    const first = rowAtLine(tops, span.first);
    const last = rowAtLine(tops, span.last);
    const out: number[] = [];
    for (let i = first; i <= last; i++) out.push(i);
    const at = active().row;
    if (at >= 0 && at < count && (at < first || at > last)) out.push(at);
    return out;
  });

  /* ---- The keyboard ---- */

  const onGridKey = (event: KeyboardEvent): void => {
    const target = event.target;
    // A field being typed in has its own keys (`onEditKey`). A list that has the keyboard keeps
    // its keys too; Escape leaves it for its cell, and only the next one reaches the dialog.
    if (target instanceof HTMLInputElement) return;
    if (target instanceof HTMLSelectElement) {
      if (event.key === "Escape") {
        event.preventDefault();
        focusActive();
      }
      return;
    }
    edit.gridKey(event);
  };

  /** The cell a press or a Tab landed in becomes the active one; a key inside a cell hands the
   *  keyboard to its cell, so the grid's keys answer and a key is never pressed twice. */
  const onGridFocus = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cell = target.closest<HTMLElement>("[data-col]");
    const rowEl = target.closest<HTMLElement>("[data-row]");
    if (cell === null || rowEl === null) return;
    edit.setActive({ row: Number(rowEl.dataset["row"]), column: Number(cell.dataset["col"]) });
    if (target instanceof HTMLButtonElement) cell.focus({ preventScroll: true });
  };

  /** What a press on a row was on: a control of its own keeps the press. A key's glyph is drawn
   *  again when its state changes, so by now the pressed one may be out of the page: that was a key too. */
  const onControl = (event: MouseEvent): boolean => event.target instanceof Element && (!event.target.isConnected || event.target.closest("button, select, input, .ui-select") !== null);

  /* ---- The page ---- */

  /** The controls inside the grid are out of the Tab order: the grid is one stop. */
  const untab = (root: ParentNode): void => {
    for (const control of root.querySelectorAll<HTMLElement>("button, select")) control.tabIndex = -1;
  };

  const measure = (): void => {
    if (scroller === undefined) return;
    const line = probe?.offsetHeight ?? 0;
    if (line > 0) setRowHeight(line);
    setViewHeight(Math.max(0, scroller.clientHeight - (head?.offsetHeight ?? 0)));
  };

  onMount(() => {
    if (grid === undefined || scroller === undefined) return;
    untab(grid);
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches("button, select")) node.tabIndex = -1;
          untab(node);
        }
      }
    });
    watcher.observe(grid, { childList: true, subtree: true });
    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    sizes?.observe(scroller);
    onCleanup(() => {
      watcher.disconnect();
      sizes?.disconnect();
    });
  });

  /* ---- The cells ---- */

  const tab = (row: number, column: number): number => (active().row === row && active().column === column ? 0 : -1);

  const HeadCell = (cell: { column: Column; index: number }): JSX.Element => (
    <div
      role="columnheader"
      class={`lm-cell lm-head-cell lm-cell--${cell.column.kind} lm-cell--${cell.column.key}`}
      aria-label={cell.column.label}
      aria-sort={ariaSort(sort(), cell.column.key)}
      aria-colindex={cell.index + 1}
      data-col={cell.index}
      tabIndex={tab(-1, cell.index)}
    >
      <Show
        when={cell.column.icon}
        fallback={
          <Button variant="quiet" size="sm" ariaLabel={`Sort by ${cell.column.label}`} title={cell.column.kind === "status" ? "The current layer, then layers with objects" : cell.column.short === undefined ? undefined : cell.column.label} onClick={() => edit.sortBy(cell.column.key)}>
            <Show when={cell.column.kind === "status"} fallback={cell.column.short ?? cell.column.label}>
              <span class="lm-used is-used" />
            </Show>
          </Button>
        }
      >
        {(icon) => <IconButton size="sm" icon={icon()} title={`Sort by ${cell.column.label}`} onClick={() => edit.sortBy(cell.column.key)} />}
      </Show>
      <span class="lm-caret" aria-hidden="true">
        <ToolIcon id="chevron-down" />
      </span>
    </div>
  );

  const FlagCell = (cell: { row: LayerRow; flag: FlagKey }): JSX.Element => {
    const look = FLAGS[cell.flag];
    return (
      <Toggle
        size="sm"
        tone={look.tone}
        icon={look.icon}
        iconOn={look.iconOn}
        ariaLabel={`${shownName(cell.row.name)} ${look.word}`}
        hint={cell.row[cell.flag] ? look.turnOff : look.turnOn}
        pressed={cell.row[cell.flag]}
        onChange={(value) => change(cell.row.name, { [cell.flag]: value })}
      />
    );
  };

  /** A choice at rest: its value as text. The list itself is made for the row under the pointer or
   *  holding the keyboard (`live`): four lists a row, each with its options, for every row drawn
   *  made a scroll through a thousand layers stutter. */
  const ChoiceCell = (cell: { row: LayerRow; choice: ChoiceKey; live: boolean }): JSX.Element => (
    <Show when={cell.live} fallback={<ChoiceText row={cell.row} choice={cell.choice} />}>
      <ChoiceSelect row={cell.row} choice={cell.choice} />
    </Show>
  );

  const ChoiceText = (cell: { row: LayerRow; choice: ChoiceKey }): JSX.Element => (
    <>
      <Show when={cell.choice === "color"}>
        <span class="lm-swatch" role="img" aria-label={`RGB ${cell.row.colorRgb.join(", ")}`} style={{ background: swatchColor(cell.row.colorRgb) }} />
      </Show>
      <span class="lm-value">{cell.choice === "color" ? cell.row.colorName : cell.choice === "transparency" ? `${cell.row.transparency}%` : cell.row[cell.choice]}</span>
    </>
  );

  const ChoiceSelect = (cell: { row: LayerRow; choice: ChoiceKey }): JSX.Element => {
    const name = (): string => shownName(cell.row.name);
    switch (cell.choice) {
      case "color":
        return (
          <>
            <span class="lm-swatch" role="img" aria-label={`RGB ${cell.row.colorRgb.join(", ")}`} style={{ background: swatchColor(cell.row.colorRgb) }} data-hint={`${cell.row.colorName}, RGB ${cell.row.colorRgb.join(", ")}`} />
            <Select variant="inline" size="sm" ariaLabel={`${name()} color`} value={cell.row.colorName} options={COLOR_OPTIONS} onChange={(value) => change(cell.row.name, { color: value })} />
          </>
        );
      case "linetype":
        return <Select variant="inline" size="sm" ariaLabel={`${name()} linetype`} value={cell.row.linetype} options={linetypeOptions()} onChange={(value) => change(cell.row.name, { linetype: value })} />;
      case "lineweight":
        return <Select variant="inline" size="sm" ariaLabel={`${name()} lineweight`} value={cell.row.lineweight} options={LINEWEIGHT_OPTIONS} onChange={(value) => change(cell.row.name, { lineweight: value })} />;
      case "transparency":
        return (
          <Select
            variant="inline"
            size="sm"
            ariaLabel={`${name()} transparency`}
            value={String(cell.row.transparency)}
            options={TRANSPARENCY_OPTIONS}
            onChange={(value) => change(cell.row.name, { transparency: Number(value) })}
          />
        );
    }
  };

  const EditField = (field: { row: LayerRow; what: TextKey }): JSX.Element => (
    <span class="lm-edit">
      <Field
        variant="inline"
        size="sm"
        ariaLabel={field.what === "name" ? `Name of ${shownName(field.row.name)}` : `Description of ${shownName(field.row.name)}`}
        value={draft()}
        spellcheck={field.what === "description"}
        autocomplete="off"
        autocapitalize="off"
        maxLength={field.what === "name" ? 255 : 1024}
        invalid={editing()?.invalid === true}
        describedBy={refusals().has(field.row.name) ? "lm-note-active" : undefined}
        selectOnFocus
        ref={(el) => queueMicrotask(() => el.focus())}
        onInput={edit.input}
        onKeyDown={edit.onEditKey}
        onBlur={() => edit.commitEdit(false)}
      />
    </span>
  );

  const NameCell = (cell: { row: LayerRow }): JSX.Element => {
    const parts = createMemo(() => splitName(shownName(cell.row.name)));
    return (
      <Show when={!isEditing(cell.row.name, "name")} fallback={<EditField row={cell.row} what="name" />}>
        <span class="lm-name" classList={{ "lm-name--none": cell.row.name === "" }}>
          <span class="layer-name-head" dir="auto" aria-hidden="true">
            {parts().head}
          </span>
          <Show when={parts().tail}>
            {(tail) => (
              <span class="layer-name-tail" aria-hidden="true">
                {tail()}
              </span>
            )}
          </Show>
          <span class="layer-name-full">{shownName(cell.row.name)}</span>
        </span>
      </Show>
    );
  };

  const BodyRow = (line: { index: number }): JSX.Element => {
    const row = (): LayerRow | undefined => shown()[line.index];
    return (
      <Show when={row()}>
        {(layer) => {
          const selected = (): boolean => selection().names.has(layer().name);
          const refusal = (): string | undefined => refusals().get(layer().name);
          const live = createMemo(() => hot() === line.index || active().row === line.index);
          return (
            <div
              role="row"
              class="lm-row"
              classList={{ "is-selected": selected(), "is-current": layer().current, "has-note": refusal() !== undefined }}
              aria-rowindex={line.index + 2}
              aria-selected={selected()}
              data-row={line.index}
              style={{ "--lm-line": String(layout().tops[line.index] ?? 0) }}
              onPointerEnter={() => setHot(line.index)}
              onClick={(event) => {
                if (onControl(event)) return;
                edit.pressRow(layer().name, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
              }}
              onDblClick={(event) => {
                if (onControl(event) || !(event.target instanceof Element)) return;
                edit.doublePress(layer().name, Number(event.target.closest<HTMLElement>("[data-col]")?.dataset["col"]));
              }}
            >
              <For each={COLUMNS}>
                {(column, at) => (
                  <div
                    role="gridcell"
                    class={`lm-cell lm-cell--${column.kind} lm-cell--${column.key}`}
                    aria-colindex={at() + 1}
                    data-col={at()}
                    tabIndex={tab(line.index, at())}
                    data-hint={column.kind === "name" && !isEditing(layer().name, "name") ? layer().name : column.kind === "text" && !isEditing(layer().name, "description") ? layer().description : undefined}
                  >
                    {column.kind === "status" ? (
                      <>
                        <span class={layer().used ? "lm-used is-used" : "lm-used"} data-hint={layer().used ? "Has objects" : "No objects"} />
                        <span class="lm-current" data-hint={layer().current ? "The current layer" : "Double-click to make current"}>
                          <Show when={layer().current}>
                            <ToolIcon id="chevron-right" />
                          </Show>
                        </span>
                        <span class="layer-name-full">{`${layer().current ? "Current layer. " : ""}${layer().used ? "Has objects" : "No objects"}`}</span>
                      </>
                    ) : column.kind === "name" ? (
                      <>
                        <NameCell row={layer()} />
                        <Show when={refusal()}>
                          {(words) => (
                            <span class="lm-note" id={isEditing(layer().name, "name") ? "lm-note-active" : undefined} data-hint={words()}>
                              {words()}
                            </span>
                          )}
                        </Show>
                      </>
                    ) : column.kind === "flag" ? (
                      <FlagCell row={layer()} flag={column.key as FlagKey} />
                    ) : column.kind === "choice" ? (
                      <ChoiceCell row={layer()} choice={column.key as ChoiceKey} live={live()} />
                    ) : (
                      <Show when={!isEditing(layer().name, "description")} fallback={<EditField row={layer()} what="description" />}>
                        <span class="lm-text">{layer().description}</span>
                      </Show>
                    )}
                  </div>
                )}
              </For>
            </div>
          );
        }}
      </Show>
    );
  };

  return (
    <Dialog
      open={props.open}
      title="Layer Properties Manager"
      size="lg"
      initialFocus={() => cellAt(active())}
      onClose={() => props.onClose()}
      footer={(done) => <Button onClick={done}>Close</Button>}
    >
      <div class="lm">
        <div class="lm-bar" role="group" aria-label="Layer actions">
          <span class="lm-actions">
            <Button size="sm" onClick={edit.addLayer}>
              New layer
            </Button>
            <Button size="sm" disabled={!renamable()} title={renamable() ? undefined : "Select one layer to rename"} shortcut="F2" onClick={edit.renameSelected}>
              Rename
            </Button>
            <Button size="sm" disabled={!removable().allowed} title={(() => { const verdict = removable(); return verdict.allowed ? undefined : verdict.reason; })()} onClick={edit.removeSelected}>
              Delete
            </Button>
            <Button size="sm" disabled={!currentable().allowed} title={(() => { const verdict = currentable(); return verdict.allowed ? undefined : verdict.reason; })()} onClick={edit.makeSelectedCurrent}>
              Set current
            </Button>
          </span>
          <span class="lm-find">
            <Field
              inputMode="search"
              ariaLabel="Filter layers by name"
              placeholder="Filter by name"
              title="Text matches anywhere in a name. * stands for any characters, ? for one."
              value={filter()}
              spellcheck={false}
              autocomplete="off"
              autocapitalize="off"
              maxLength={256}
              start={<ToolIcon id="search" />}
              onInput={edit.setFilterText}
              onKeyDown={(event) => {
                // Escape empties a filter before it closes the dialog.
                if (event.key === "Escape" && edit.clearFilterKey()) event.preventDefault();
              }}
            />
            <span class="lm-count" role="status">
              {countText(shown().length, rows().length)}
            </span>
          </span>
        </div>
        <div class="lm-scroll" ref={(el: HTMLDivElement) => (scroller = el)} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          <div
            class="lm-grid"
            role="grid"
            aria-label="Layers"
            aria-multiselectable="true"
            aria-rowcount={shown().length + 1}
            aria-colcount={COLUMNS.length}
            ref={(el: HTMLDivElement) => (grid = el)}
            onKeyDown={onGridKey}
            onFocusIn={onGridFocus}
          >
            <div role="row" class="lm-head" aria-rowindex={1} data-row={-1} ref={(el: HTMLDivElement) => (head = el)}>
              <For each={COLUMNS}>{(column, at) => <HeadCell column={column} index={at()} />}</For>
            </div>
            <div class="lm-body" role="rowgroup" style={{ "--lm-lines": String(layout().lines) }}>
              <For each={drawn()}>{(index) => <BodyRow index={index} />}</For>
            </div>
          </div>
          <div class="lm-probe" aria-hidden="true" ref={(el: HTMLDivElement) => (probe = el)} />
          <Show when={shown().length === 0}>
            <p class="lm-empty">
              <Show when={rows().length > 0} fallback="The drawing has no layers to show.">
                No layer's name matches {quoted(filter().trim())}.
                <Button variant="quiet" size="sm" onClick={edit.clearFilter}>
                  Clear the filter
                </Button>
              </Show>
            </p>
          </Show>
        </div>
        <p class="lm-live" role="status">
          {said()}
        </p>
      </div>
    </Dialog>
  );
}
