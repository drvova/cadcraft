/**
 * The state of the Layer Properties Manager, for whichever shell draws it
 * (`./components/LayerManager`, `./slab/SlabLayerManager`): the rows read from the engine, the
 * order and the filter they are shown in, the selection, the active cell of the grid, the cell
 * being typed in, the refusals, and what the last action came to. The rules are
 * `./layer-manager`'s; this file holds the signals and the order things are done in, so the two
 * dialogs cannot drift apart.
 *
 * What only a view can do is asked of it (`LayerManagerView`): put the keyboard on the active
 * cell, open a cell's list of values, bring a cell into view, and say how many rows a page is.
 *
 * Every change is an engine command run at once, the rows are then read again from the engine
 * (so the table never shows a value the engine did not take), and the shell is told
 * (`onChanged`). A change made on one of several selected rows is made on all of them, as one
 * undo step.
 */

import { createEffect, createMemo, createSignal, on, untrack, type Accessor } from "solid-js";
import {
  currentVerdict,
  deleteVerdict,
  filterRows,
  moveCell,
  nextSort,
  NO_SELECTION,
  planChange,
  planCurrent,
  planDelete,
  planNew,
  planRename,
  pruneSelection,
  quoted,
  readLinetypes,
  readRows,
  renameInSelection,
  runCalls,
  selectAll,
  selectPress,
  sortRows,
  targetsOf,
  typeaheadRow,
  TYPEAHEAD_MS,
  type GridCell,
  type LayerCall,
  type LayerEngine,
  type LayerPatch,
  type LayerRefusal,
  type LayerRow,
  type Selection,
  type Sort,
  type SortKey,
  type Verdict,
} from "./layer-manager";
import { isTypeaheadKey } from "./roving";

export type FlagKey = "on" | "frozen" | "locked" | "plot";
export type ChoiceKey = "color" | "linetype" | "lineweight" | "transparency";
export type TextKey = "name" | "description";

/** One column: what it sorts by, its heading, and the kind of cell it holds. */
export interface Column {
  key: SortKey;
  label: string;
  kind: "status" | "name" | "flag" | "choice" | "text";
  /** A flag column's heading is its glyph. */
  icon?: string;
  /** The heading as its narrow column draws it; the whole word stays its name and its hint. */
  short?: string;
}

export const COLUMNS: readonly Column[] = [
  { key: "status", label: "Status", kind: "status" },
  { key: "name", label: "Name", kind: "name" },
  { key: "on", label: "On", kind: "flag", icon: "layer.on" },
  { key: "frozen", label: "Freeze", kind: "flag", icon: "layer.frozen" },
  { key: "locked", label: "Lock", kind: "flag", icon: "layer.locked" },
  { key: "plot", label: "Plot", kind: "flag", icon: "plot" },
  { key: "color", label: "Color", kind: "choice" },
  { key: "linetype", label: "Linetype", kind: "choice" },
  { key: "lineweight", label: "Lineweight", kind: "choice" },
  { key: "transparency", label: "Transparency", kind: "choice", short: "Transp." },
  { key: "description", label: "Description", kind: "text" },
];

export const NAME_COLUMN = COLUMNS.findIndex((column) => column.kind === "name");

/** What the props of either dialog hold. */
export interface LayerManagerEditProps {
  /** The engine: `AppFacade` is one. Read on every opening and after every change. */
  facade: LayerEngine;
  /** Whether the dialog is showing. The shell holds it. */
  open: boolean;
  /** The engine's layers were changed: the shell reads its state again. */
  onChanged: () => void;
}

/** What only the view can do. */
export interface LayerManagerView {
  /** Put the keyboard on the active cell and bring it into view. */
  focusActive: () => void;
  /** Open the list of values of a choice cell. */
  openChoice: (cell: GridCell) => void;
  /** Bring a cell into view without moving the keyboard. */
  revealCell: (cell: GridCell) => void;
  /** How many rows a page key moves. */
  pageRows: () => number;
}

/** The parts of a key event the grid reads (a `KeyboardEvent` is one). */
export interface GridKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  preventDefault: () => void;
}

/** How a pointer press on a row chose: the modifier keys held. */
export interface PressMods {
  toggle: boolean;
  range: boolean;
}

export interface LayerManagerEdit {
  rows: Accessor<LayerRow[]>;
  linetypes: Accessor<string[]>;
  sort: Accessor<Sort>;
  filter: Accessor<string>;
  selection: Accessor<Selection>;
  active: Accessor<GridCell>;
  setActive: (cell: GridCell) => void;
  editing: Accessor<{ name: string; key: TextKey; invalid: boolean } | null>;
  draft: Accessor<string>;
  refusals: Accessor<ReadonlyMap<string, string>>;
  said: Accessor<string>;
  /** The rows as the table shows them: filtered, then in the chosen order. */
  shown: Accessor<LayerRow[]>;
  order: Accessor<string[]>;
  /** The linetypes a layer may take from the list (never ByLayer nor ByBlock). */
  linetypeNames: Accessor<string[]>;
  removable: Accessor<Verdict>;
  currentable: Accessor<Verdict>;
  renamable: Accessor<boolean>;
  /** Run `change`, then put the active cell back on the layer it was on, wherever that row went. */
  keepingActive: (change: () => void, follow?: string) => void;
  /** A change made on `name`'s row: on every selected row when that row is one of several. */
  change: (name: string, patch: LayerPatch) => void;
  makeCurrent: (name: string) => void;
  makeSelectedCurrent: () => void;
  removeSelected: () => void;
  isEditing: (name: string, key: TextKey) => boolean;
  startEdit: (name: string, key: TextKey) => void;
  cancelEdit: () => void;
  commitEdit: (stay: boolean) => void;
  /** Typing in the field of the cell being edited. */
  input: (value: string) => void;
  onEditKey: (event: KeyboardEvent) => void;
  addLayer: () => void;
  renameSelected: () => void;
  sortBy: (key: SortKey) => void;
  /** The filter was typed in (the active cell stays on its layer). */
  setFilterText: (value: string) => void;
  /** Escape in the filter: true when it emptied a filter (the key is used). */
  clearFilterKey: () => boolean;
  clearFilter: () => void;
  /** A press on a row's body (not on a control of its own). */
  pressRow: (name: string, mods: PressMods) => void;
  /** A double press on a cell of a row. */
  doublePress: (name: string, column: number) => void;
  /** A key on the grid, not in a field nor in an open list. */
  gridKey: (event: GridKeyEvent) => void;
}

/** The keys that move the active cell. */
const MOVES: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/** What a key on the grid does: `pass` leaves it alone (it is not the grid's); every other kind is the grid's, and the key is used. */
export type GridAction =
  | { kind: "pass" }
  | { kind: "used" }
  | { kind: "all" }
  | { kind: "move"; to: GridCell; select: { name: string; range: boolean } | null }
  | { kind: "jump"; to: GridCell; name: string }
  | { kind: "sort"; key: SortKey }
  | { kind: "flag"; name: string; patch: LayerPatch }
  | { kind: "choice"; cell: GridCell }
  | { kind: "select"; name: string; toggle: boolean; range: boolean }
  | { kind: "edit"; name: string; key: TextKey }
  | { kind: "current"; name: string }
  | { kind: "delete" };

/** The letters typed for the type-ahead so far, and when the last came (ms). */
export interface Typed {
  text: string;
  at: number;
}

/** What the grid's keys read: the active cell, the rows as shown, a page's rows, the type-ahead, the time. */
export interface GridKeyState {
  cell: GridCell;
  rows: readonly LayerRow[];
  page: number;
  typed: Typed;
  now: number;
}

/**
 * The SolidJS grid's keys, as one decision, for both dialogs: the arrows, Home and End (with Ctrl
 * or Cmd the table's ends) and the page keys move the active cell, and a move to another row takes
 * the selection with it (Shift ranges from the anchor; Ctrl moves the keyboard alone); Ctrl+A
 * takes every row; Enter or Space on a heading sorts; on a flag they turn it; on a choice Enter,
 * Space and F2 open its values; Space selects the row (Shift ranges), and Ctrl+Space adds it to the selection or takes it out; Enter and F2
 * type a name or a description; Enter on the status makes the layer current; Delete deletes the
 * selection; a letter on a name jumps to the next layer that starts with the letters typed.
 * Alt, and a chord the grid has no use for, are left alone.
 */
export function gridKeyAction(event: Omit<GridKeyEvent, "preventDefault">, state: GridKeyState): { action: GridAction; typed: Typed } {
  const typed = state.typed;
  const pass = { action: { kind: "pass" } as const, typed };
  if (event.altKey) return pass;
  const cell = state.cell;
  const column = COLUMNS[cell.column];
  if (column === undefined) return pass;
  const row = cell.row >= 0 ? state.rows[cell.row] : undefined;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "a") return { action: { kind: "all" }, typed };
  if (MOVES.has(event.key)) {
    const next = moveCell(cell, event, state.rows.length, COLUMNS.length, state.page);
    if (next === null) return { action: { kind: "used" }, typed };
    const name = state.rows[next.row]?.name;
    // A move to another row takes the selection with it, as a list does: Shift ranges from the
    // anchor, and Ctrl moves the keyboard alone, to pick rows apart with Ctrl+Space.
    const select = next.row !== cell.row && name !== undefined && !mod ? { name, range: event.shiftKey } : null;
    return { action: { kind: "move", to: next, select }, typed };
  }
  const space = event.key === " ";
  // Ctrl+Space (Cmd+Space) adds the row the keyboard is on to the selection, or takes it out: it
  // is how rows are picked apart after Ctrl with an arrow moved the keyboard alone. On any cell
  // of the row, a flag's included: with Ctrl the key is the row's, not the cell's.
  if (mod && space) {
    if (event.repeat || row === undefined) return { action: { kind: "used" }, typed };
    return { action: { kind: "select", name: row.name, toggle: true, range: event.shiftKey }, typed };
  }
  if (mod) return pass;
  const enter = event.key === "Enter";
  if (enter || space || event.key === "F2") {
    if (event.repeat) return { action: { kind: "used" }, typed };
    if (row === undefined) return { action: cell.row === -1 && (enter || space) ? { kind: "sort", key: column.key } : { kind: "used" }, typed };
    const flag = column.key as FlagKey;
    if (column.kind === "flag" && (enter || space)) return { action: { kind: "flag", name: row.name, patch: { [flag]: !row[flag] } }, typed };
    if (column.kind === "choice") return { action: { kind: "choice", cell }, typed };
    // Ctrl+Space was taken above, so Space here selects the row alone.
    if (space) return { action: { kind: "select", name: row.name, toggle: false, range: event.shiftKey }, typed };
    if (column.kind === "name") return { action: { kind: "edit", name: row.name, key: "name" }, typed };
    if (column.kind === "text") return { action: { kind: "edit", name: row.name, key: "description" }, typed };
    if (column.kind === "status" && enter) return { action: { kind: "current", name: row.name }, typed };
    return { action: { kind: "used" }, typed };
  }
  if (event.key === "Delete") return { action: event.repeat ? { kind: "used" } : { kind: "delete" }, typed };
  // Letters typed on a name jump to the next layer that starts with them.
  if (column.kind !== "name" || !isTypeaheadKey(event)) return pass;
  const text = state.now - typed.at > TYPEAHEAD_MS ? event.key : typed.text + event.key;
  const next = { text, at: state.now };
  const found = typeaheadRow(state.rows.map((candidate) => candidate.name), cell.row, text);
  const name = found === null ? undefined : state.rows[found]?.name;
  if (found === null || name === undefined) return { action: { kind: "pass" }, typed: next };
  return { action: { kind: "jump", to: { row: found, column: cell.column }, name }, typed: next };
}

export function createLayerManagerEdit(props: LayerManagerEditProps, view: LayerManagerView): LayerManagerEdit {
  const [rows, setRows] = createSignal<LayerRow[]>([]);
  const [linetypes, setLinetypes] = createSignal<string[]>([]);
  const [sort, setSort] = createSignal<Sort>(null);
  const [filter, setFilter] = createSignal("");
  const [selection, setSelection] = createSignal<Selection>(NO_SELECTION);
  const [active, setActive] = createSignal<GridCell>({ row: -1, column: NAME_COLUMN }, { equals: (a, b) => a.row === b.row && a.column === b.column });
  /** The cell being typed in: a layer's name or its description. */
  const [editing, setEditing] = createSignal<{ name: string; key: TextKey; invalid: boolean } | null>(null);
  const [draft, setDraft] = createSignal("");
  /** What the engine refused in the last change, by layer. */
  const [refusals, setRefusals] = createSignal<ReadonlyMap<string, string>>(new Map());
  /** What the last action came to, for a screen reader. */
  const [said, setSaid] = createSignal("");

  let typed = "";
  let typedAt = 0;

  const shown = createMemo(() => sortRows(filterRows(rows(), filter()), sort()));
  const order = createMemo(() => shown().map((row) => row.name));
  const linetypeNames = createMemo(() => linetypes().filter((name) => !/^by(layer|block)$/i.test(name)));

  const removable = createMemo(() => deleteVerdict(rows(), selection().names));
  const currentable = createMemo(() => currentVerdict(rows(), selection().names));
  const renamable = createMemo(() => selection().names.size === 1);

  const keepingActive = (change: () => void, follow?: string): void => {
    const was = active();
    const name = follow ?? untrack(order)[was.row];
    change();
    const names = untrack(order);
    const found = name === undefined ? -1 : names.indexOf(name);
    setActive({ row: found >= 0 ? found : Math.min(was.row, names.length - 1), column: was.column });
  };

  /* ---- The engine ---- */

  /** Read the layers again: the table shows what the engine holds, and nothing else. */
  const reload = (follow?: string): void => {
    keepingActive(() => {
      const next = readRows(props.facade);
      setRows(next);
      setSelection((held) => pruneSelection(held, next));
    }, follow);
  };

  const sayRefusals = (refused: readonly LayerRefusal[]): void => {
    const first = refused[0];
    if (first === undefined) setSaid("");
    else if (refused.length === 1) setSaid(`${quoted(first.layer)} was not changed. ${first.message}`);
    else setSaid(`${refused.length} layers were not changed. Each says why under its row.`);
  };

  /** Run the calls, show what was refused beside its row, read the engine again, tell the shell. */
  const act = (calls: readonly LayerCall[], follow?: string): LayerRefusal[] => {
    if (calls.length === 0) return [];
    const refused = runCalls(props.facade, calls);
    setRefusals(new Map(refused.map((refusal) => [refusal.layer, refusal.message])));
    sayRefusals(refused);
    reload(follow);
    props.onChanged();
    return refused;
  };

  const change = (name: string, patch: LayerPatch): void => {
    const targets = targetsOf(selection(), order(), name);
    if (!selection().names.has(name)) setSelection({ names: new Set([name]), anchor: name });
    act(planChange(rows(), targets, patch), name);
  };

  const makeCurrent = (name: string): void => {
    act([planCurrent(name)], name);
  };

  const makeSelectedCurrent = (): void => {
    const verdict = currentable();
    if (!verdict.allowed) {
      setSaid(verdict.reason);
      return;
    }
    const name = [...selection().names][0];
    if (name !== undefined) makeCurrent(name);
  };

  const removeSelected = (): void => {
    const verdict = removable();
    if (!verdict.allowed) {
      setSaid(verdict.reason);
      return;
    }
    const names = order().filter((name) => selection().names.has(name));
    const refused = act(planDelete(names.length > 0 ? names : [...selection().names]));
    if (refused.length === 0) setSaid(names.length === 1 ? `Deleted ${quoted(names[0] ?? "")}` : `Deleted ${names.length} layers`);
    view.focusActive();
  };

  /* ---- Typing in a cell ---- */

  const isEditing = (name: string, key: TextKey): boolean => {
    const held = editing();
    return held !== null && held.name === name && held.key === key;
  };

  const startEdit = (name: string, key: TextKey): void => {
    const row = rows().find((candidate) => candidate.name === name);
    if (row === undefined) return;
    setDraft(key === "name" ? row.name : row.description);
    setEditing({ name, key, invalid: false });
  };

  /** Leave the field without sending anything: the engine's value shows again. */
  const cancelEdit = (): void => {
    if (editing() === null) return;
    setEditing(null);
    setRefusals(new Map());
    setSaid("");
    view.focusActive();
  };

  /**
   * Send what was typed. A refusal is said under the row; on Enter (`stay`) the field keeps the
   * text to correct, and on leaving the field the engine's value shows again.
   */
  const commitEdit = (stay: boolean): void => {
    const held = editing();
    if (held === null) return;
    const refuse = (message: string): void => {
      setRefusals(new Map([[held.name, message]]));
      setSaid(`${quoted(held.name)} was not changed. ${message}`);
      if (stay) setEditing({ ...held, invalid: true });
      else setEditing(null);
    };
    if (held.key === "description") {
      setEditing(null);
      const text = draft().trim();
      change(held.name, { description: text });
      if (stay) view.focusActive();
      return;
    }
    const plan = planRename(held.name, draft());
    if (plan.kind === "refuse") {
      refuse(plan.message);
      return;
    }
    if (plan.kind === "keep") {
      setEditing(null);
      setRefusals(new Map());
      if (stay) view.focusActive();
      return;
    }
    const refused = runCalls(props.facade, [plan.call]);
    const first = refused[0];
    if (first !== undefined) {
      refuse(first.message);
      return;
    }
    setEditing(null);
    setRefusals(new Map());
    setSaid(`Renamed to ${quoted(plan.to)}`);
    setSelection((selected) => renameInSelection(selected, held.name, plan.to));
    reload(plan.to);
    props.onChanged();
    if (stay) view.focusActive();
  };

  const input = (value: string): void => {
    setDraft(value);
    const held = editing();
    if (held !== null && held.invalid) setEditing({ ...held, invalid: false });
  };

  const onEditKey = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit(true);
    } else if (event.key === "Escape") {
      // The key is used here: the dialog stays open.
      event.preventDefault();
      cancelEdit();
    }
    event.stopPropagation();
  };

  /** Bring a layer's row into the table (a filter may hide it), put the keyboard on it and type its name. */
  const editName = (name: string): void => {
    if (!order().includes(name)) setFilter("");
    const row = order().indexOf(name);
    if (row < 0) return;
    setActive({ row, column: NAME_COLUMN });
    setSelection({ names: new Set([name]), anchor: name });
    view.revealCell(active());
    startEdit(name, "name");
  };

  const addLayer = (): void => {
    const plan = planNew(rows());
    const refused = act([plan.call]);
    if (refused.length > 0) return;
    setSaid(`Created ${quoted(plan.name)}. Type its name.`);
    editName(plan.name);
  };

  const renameSelected = (): void => {
    const name = [...selection().names][0];
    if (name !== undefined && selection().names.size === 1) editName(name);
  };

  /* ---- The keyboard ---- */

  const sortBy = (key: SortKey): void => {
    keepingActive(() => setSort((held) => nextSort(held, key)));
  };

  const setFilterText = (value: string): void => keepingActive(() => setFilter(value));

  const clearFilterKey = (): boolean => {
    if (filter() === "") return false;
    keepingActive(() => setFilter(""));
    return true;
  };

  const clearFilter = (): void => {
    setFilter("");
  };

  const pressRow = (name: string, mods: PressMods): void => {
    setSelection((held) => selectPress(held, order(), name, mods));
  };

  const doublePress = (name: string, column: number): void => {
    const kind = COLUMNS[column]?.kind;
    if (kind === "name") startEdit(name, "name");
    else if (kind === "text") startEdit(name, "description");
    else if (kind === "status") makeCurrent(name);
  };

  const gridKey = (event: GridKeyEvent): void => {
    const now = Date.now();
    const decided = gridKeyAction(event, { cell: active(), rows: shown(), page: view.pageRows(), typed: { text: typed, at: typedAt }, now });
    typed = decided.typed.text;
    typedAt = decided.typed.at;
    const action = decided.action;
    if (action.kind === "pass") return;
    // The grid's own keys never scroll the box under it, nor reach what is behind the grid.
    event.preventDefault();
    switch (action.kind) {
      case "used":
        return;
      case "all":
        setSelection((held) => selectAll(held, order()));
        return;
      case "move":
        setActive(action.to);
        if (action.select !== null) {
          const how = action.select;
          setSelection((held) => selectPress(held, order(), how.name, { range: how.range }));
        }
        view.focusActive();
        return;
      case "jump":
        setActive(action.to);
        setSelection({ names: new Set([action.name]), anchor: action.name });
        view.focusActive();
        return;
      case "sort":
        sortBy(action.key);
        return;
      case "flag":
        change(action.name, action.patch);
        return;
      case "choice":
        view.openChoice(action.cell);
        return;
      case "select": {
        const how = action;
        setSelection((held) => selectPress(held, order(), how.name, { toggle: how.toggle, range: how.range }));
        return;
      }
      case "edit":
        startEdit(action.name, action.key);
        return;
      case "current":
        makeCurrent(action.name);
        return;
      case "delete":
        removeSelected();
        return;
    }
  };

  // Every opening starts from the engine, on the current layer's row.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        const next = readRows(props.facade);
        setLinetypes(readLinetypes(props.facade));
        setEditing(null);
        setRefusals(new Map());
        setSaid("");
        setFilter("");
        setRows(next);
        const current = next.find((row) => row.current)?.name;
        setSelection(current === undefined ? NO_SELECTION : { names: new Set([current]), anchor: current });
        setActive({ row: current === undefined ? Math.min(0, next.length - 1) : untrack(order).indexOf(current), column: NAME_COLUMN });
      },
    ),
  );

  return {
    rows,
    linetypes,
    sort,
    filter,
    selection,
    active,
    setActive,
    editing,
    draft,
    refusals,
    said,
    shown,
    order,
    linetypeNames,
    removable,
    currentable,
    renamable,
    keepingActive,
    change,
    makeCurrent,
    makeSelectedCurrent,
    removeSelected,
    isEditing,
    startEdit,
    cancelEdit,
    commitEdit,
    input,
    onEditKey,
    addLayer,
    renameSelected,
    sortBy,
    setFilterText,
    clearFilterKey,
    clearFilter,
    pressRow,
    doublePress,
    gridKey,
  };
}
