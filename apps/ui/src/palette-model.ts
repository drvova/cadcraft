/**
 * The command palette's state, shared by the two views of it: the SolidJS list
 * (`./components/CommandPalette`) and the one Slab draws (`./slab/SlabPalette`). What is typed,
 * which row is lit, how many rows are drawn, what a key does, what a press runs and the line
 * under the list are decided here once; a view only draws the rows and says how its list scrolls.
 *
 * The keys work from the field (the focus never leaves it): the arrows walk the list and wrap,
 * Page Up and Page Down move a page, Home and End go to the ends while the field is empty (or
 * with Ctrl, so they still edit the text otherwise), Enter runs the lit row, Tab writes its name
 * into the field. Escape is the dialog's (its `cancel`). The pointer lights the row it moves
 * over; a list that scrolls under a still pointer does not.
 *
 * The list and its order are `./palette`'s.
 */

import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { PALETTE_LIMIT, rankCommands, recentItems, stepActive, type PaletteItem, type PaletteMatch } from "./palette";

export interface CommandPaletteProps {
  open: Accessor<boolean>;
  items: Accessor<readonly PaletteItem[]>;
  /** The ids used last, newest first. */
  recent: Accessor<readonly string[]>;
  /** Run a command; the shell closes the palette. */
  onRun: (id: string) => void;
  onClose: () => void;
}

/** What the model asks of the view that draws the list. */
export interface PaletteView {
  /** How many rows a page key moves: the rows the list shows, less one kept for context. */
  pageRows(): number;
  /** The list starts again from its top (a new query). */
  toTop(): void;
}

/** What a key pressed in the field does to the list; null when the key is the field's own. */
export type PaletteKeyAction = { kind: "light"; index: number } | { kind: "run" } | { kind: "complete" };

/** The key facts the palette reads (a `KeyboardEvent` is one). */
export interface PaletteKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The palette's keys, pure: `active` is the lit row of `count`, `query` what the field holds,
 * `page` the rows a page key moves.
 */
export function paletteKey(e: PaletteKey, active: number, count: number, query: string, page: () => number): PaletteKeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "ArrowDown") return { kind: "light", index: stepActive(active, 1, count, true) };
  if (e.key === "ArrowUp") return { kind: "light", index: stepActive(active, -1, count, true) };
  if (e.key === "PageDown") return { kind: "light", index: stepActive(active, page(), count, false) };
  if (e.key === "PageUp") return { kind: "light", index: stepActive(active, -page(), count, false) };
  // Home and End belong to the text while there is text; Ctrl (or an empty field) gives them to the list.
  if (e.key === "Home" && (mod || query === "") && !e.shiftKey) return { kind: "light", index: 0 };
  if (e.key === "End" && (mod || query === "") && !e.shiftKey) return { kind: "light", index: Math.max(0, count - 1) };
  if (e.key === "Enter") return { kind: "run" };
  if (e.key === "Tab" && !e.shiftKey && !mod && !e.altKey) return { kind: "complete" };
  return null;
}

/** One line under the list: how many commands there are, or why the lit one will not run. */
export function paletteStatus(count: number, lit: PaletteItem | undefined, typed: boolean): string {
  if (lit !== undefined && !lit.enabled) return `${lit.label} is not available right now`;
  if (count === 0) return "No matches";
  if (!typed) return `${count} ${count === 1 ? "command" : "commands"}`;
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

/** The ids of the options the field points at, by their place in the list. */
export const paletteOptionId = (index: number): string => `palette-option-${index}`;

export interface PaletteModel {
  query: Accessor<string>;
  active: Accessor<number>;
  /** How many of the matches are drawn; it grows as the list is walked or scrolled. */
  shown: Accessor<number>;
  matches: Accessor<PaletteMatch[]>;
  /** The matches drawn: the first `shown`. */
  rows: Accessor<PaletteMatch[]>;
  typed: () => boolean;
  /** With nothing typed, how many of the first rows are the recently used ones. */
  recentCount: Accessor<number>;
  current: () => PaletteMatch | undefined;
  status: () => string;
  /** Whether the lit row is to be brought into view (it was lit by a key, not by the pointer). */
  follows: () => boolean;
  /** The palette opened: the first row is lit, nothing is drawn past the first screenful. */
  opened: () => void;
  /** The field's text changed. */
  input: (value: string) => void;
  /** A key in the field: true when it was the palette's (and its default is prevented). */
  keyDown: (e: KeyboardEvent) => boolean;
  /** Draw a screenful more (the list was scrolled near the end of what is drawn). */
  more: () => void;
  /** The pointer moved over a row (at its screen position: a scroll sends a move where it was). */
  pointerOver: (screenX: number, screenY: number, index: number) => void;
  run: (item: PaletteItem | undefined) => void;
}

export function createPaletteModel(props: CommandPaletteProps, view: PaletteView): PaletteModel {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [shown, setShown] = createSignal(PALETTE_LIMIT);
  /** The lit row follows the keyboard into view; a row lit by the pointer is already under it. */
  let follow = true;
  /** Where the pointer last was, so a row sliding under a still pointer is not taken for a move. */
  let pointerAt = "";

  const matches = createMemo<PaletteMatch[]>(() => (props.open() ? rankCommands(query(), props.items(), props.recent(), Number.POSITIVE_INFINITY) : []));
  const rows = createMemo(() => matches().slice(0, shown()));
  const typed = (): boolean => query().trim() !== "";
  const recentCount = createMemo(() => (typed() ? 0 : recentItems(props.items(), props.recent()).length));
  const current = (): PaletteMatch | undefined => matches()[active()];

  /** Light a row from the keyboard: draw it if the list has not reached it yet, and bring it into view. */
  const light = (index: number): void => {
    follow = true;
    if (index >= shown()) setShown((Math.floor(index / PALETTE_LIMIT) + 1) * PALETTE_LIMIT);
    setActive(index);
  };

  // The registry can change under an open palette (a command ends, a selection changes what can
  // run): the lit row stays on its command, and never points past the end of the list.
  let litId = "";
  let litQuery = "";
  createEffect(
    on(matches, (now) => {
      const at = litQuery === query() && litId !== "" ? now.findIndex((m) => m.item.id === litId) : -1;
      if (at >= 0 && at !== active()) light(at);
      else if (active() >= now.length && now.length > 0) light(now.length - 1);
    }),
  );
  createEffect(() => {
    litId = current()?.item.id ?? "";
    litQuery = query();
  });

  const run = (item: PaletteItem | undefined): void => {
    if (item === undefined || !item.enabled) return;
    setQuery("");
    props.onRun(item.id);
  };

  const keyDown = (e: KeyboardEvent): boolean => {
    if (e.isComposing) return false;
    const action = paletteKey(e, active(), matches().length, query(), view.pageRows);
    if (action === null) return false;
    if (action.kind === "light") light(action.index);
    else if (action.kind === "run") run(current()?.item);
    else {
      // Tab writes the lit command's name into the field and stays on that command.
      const item = current()?.item;
      if (item !== undefined) {
        setQuery(item.label);
        setShown(PALETTE_LIMIT);
        view.toTop();
        light(Math.max(0, matches().findIndex((m) => m.item.id === item.id)));
      }
    }
    e.preventDefault();
    return true;
  };

  return {
    query,
    active,
    shown,
    matches,
    rows,
    typed,
    recentCount,
    current,
    status: () => paletteStatus(matches().length, current()?.item, typed()),
    follows: () => follow,
    opened: () => {
      setShown(PALETTE_LIMIT);
      light(0);
      pointerAt = "";
    },
    input: (value) => {
      setQuery(value);
      setShown(PALETTE_LIMIT);
      light(0);
      // The best match is the first row: the list starts again from its top.
      view.toTop();
    },
    keyDown,
    more: () => {
      if (shown() < matches().length) setShown((n) => n + PALETTE_LIMIT);
    },
    pointerOver: (screenX, screenY, index) => {
      const at = `${screenX},${screenY}`;
      if (at === pointerAt) return;
      const first = pointerAt === "";
      pointerAt = at;
      // The first event after opening is the pointer being found where it already was.
      if (first || index === active()) return;
      follow = false;
      setActive(index);
    },
    run,
  };
}
