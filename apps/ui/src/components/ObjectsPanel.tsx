/**
 * The objects panel: what the space on screen holds, as a tree a jeweler reads — the piece with
 * its parts, the stones by cut and size, the bands, then everything else by layer and kind — with
 * a search over it. The engine lists the objects (`objects`); `../objects` reads the reply,
 * builds the tree, filters it, caps it and walks it. Nothing is counted or measured here.
 *
 * The tree is the drawing's selection seen as a list, both ways. A press on a row selects what
 * the row holds (one object, or a whole group); a second press lets it go; with Ctrl or Cmd the
 * row is added to what is selected, or taken out of it. A row whose objects are all selected is
 * the selected row (`aria-selected`, the list's selected fill); a group that is partly selected
 * says how far ("3/18"). A selection made on the drawing opens the way to its first row and
 * brings it into view, without taking the keyboard.
 *
 * It is one Tab stop (`role="tree"`): the arrows, Home, End and a typed letter move the keyboard
 * from row to row, Right and Left open and close a group, Enter and Space select. The rows are
 * the tree's own elements (`role="treeitem"` holding a `role="group"`): the system's `Row` is a
 * button, and a tree's item must be the thing the keyboard is on. Their recipe is the row's,
 * value for value, from the same tokens (`../interaction.css`).
 *
 * No engine call lives here: the shell lists the objects and hands the list over, and the shell
 * selects.
 */

import { createEffect, createMemo, createSignal, For, Index, Show, untrack, type JSX } from "solid-js";
import { ToolIcon } from "../icons";
import {
  buildTree,
  layout,
  moreId,
  objectsSummary,
  PIECE_ID,
  pressSelection,
  revealTarget,
  searchTokens,
  selectedCount,
  showMore,
  treeKey,
  type ObjectList,
  type VisibleNode,
} from "../objects";
import { highlight } from "../palette";
import { isTypeaheadKey } from "../roving";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import { SectionLabel } from "../ui/SectionLabel";
import "../interaction.css";

export interface ObjectsPanelProps {
  /** The objects of the space in front; null when the engine could not list them. */
  list: ObjectList | null;
  /** Whether the engine has the `objects` command at all. */
  available: boolean;
  /** The handles selected on the drawing. */
  selection: readonly string[];
  /** Make these objects the drawing's selection; an empty list lets the selection go. */
  onSelect: (handles: readonly string[]) => void;
}

const count = (n: number): string => n.toLocaleString("en-US");

/** Run once the page has been laid out again (the next frame; at once where there are no frames). */
function later(run: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else queueMicrotask(run);
}

/** The window height, in CSS pixels, from which the section starts open. */
const ROOMY_WINDOW = 860;

/** A row's name for assistive tech: its label, and for a group how much it holds and how much of that is selected. */
function rowName(node: VisibleNode, selected: number): string {
  if (node.kind !== "group") return node.label;
  const holds = `${node.label}, ${count(node.count)} ${node.count === 1 ? "object" : "objects"}`;
  return selected > 0 && selected < node.count ? `${holds}, ${count(selected)} selected` : holds;
}

/** The rows of one level, each a tree item that holds its own group. Kept by position (`Index`),
 *  so a row the keyboard is on is still there after the list is read again. */
function Branch(props: { nodes: readonly VisibleNode[]; selection: ReadonlySet<string>; active: string | null }): JSX.Element {
  return (
    <Index each={props.nodes}>
      {(node) => {
        const selected = createMemo(() => (node().kind === "more" ? 0 : selectedCount(node().handles, props.selection)));
        const current = (): boolean => node().handles.length > 0 && selected() === node().handles.length;
        return (
          <div
            class="objects-item"
            classList={{ "objects-item--more": node().kind === "more" }}
            role="treeitem"
            data-node={node().id}
            tabIndex={props.active === node().id ? 0 : -1}
            aria-level={node().level}
            aria-posinset={node().position}
            aria-setsize={node().siblings}
            aria-expanded={node().kind === "group" ? node().open : undefined}
            aria-selected={node().kind === "more" ? undefined : current()}
            aria-label={rowName(node(), selected())}
          >
            <div class="objects-row" style={{ "--objects-level": String(node().level) }}>
              <span class="objects-twist" data-twist={node().kind === "group" ? "" : undefined} aria-hidden="true">
                <Show when={node().kind === "group"}>
                  <ToolIcon id="chevron-right" />
                </Show>
              </span>
              <span class="objects-label">
                <For each={highlight(node().label, node().hits)}>{(part) => (part.hit ? <mark class="objects-hit">{part.text}</mark> : part.text)}</For>
              </span>
              <Show when={node().kind === "group"}>
                <span class="objects-count">{selected() > 0 && selected() < node().count ? `${count(selected())}/${count(node().count)}` : count(node().count)}</span>
              </Show>
            </div>
            <Show when={node().kind === "group" && node().open}>
              <div class="objects-group" role="group">
                <Branch nodes={node().children} selection={props.selection} active={props.active} />
              </div>
            </Show>
          </div>
        );
      }}
    </Index>
  );
}

export function ObjectsPanel(props: ObjectsPanelProps): JSX.Element {
  /** The section folds to its heading, as the rail's other sections do. It starts open where the
   *  rail has the room for a fifth section, and folded in a short window, where the four sections
   *  around it already fill the rail. */
  const [open, setOpen] = createSignal(typeof window === "undefined" || window.innerHeight >= ROOMY_WINDOW);
  const [query, setQuery] = createSignal("");
  /** The piece is the drawing's subject: it starts open, everything else folded. */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([PIECE_ID]));
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const [shown, setShown] = createSignal<ReadonlyMap<string, number>>(new Map());
  /** The row the keyboard is on (the tree's one Tab stop); the first row when it is gone. */
  const [active, setActive] = createSignal<string | null>(null);
  let treeEl: HTMLDivElement | undefined;
  let searchEl: HTMLInputElement | undefined;

  const tree = createMemo(() => buildTree(props.list));
  const drawn = createMemo(() => layout(tree(), { query: query(), expanded: expanded(), collapsed: collapsed(), shown: shown() }));
  const selected = createMemo(() => new Set(props.selection));
  const searching = (): boolean => searchTokens(query()).length > 0;
  const stop = (): string | null => {
    const rows = drawn().rows;
    const at = active();
    return rows.some((row) => row.id === at) ? at : (rows[0]?.id ?? null);
  };

  /** The heading: how many objects, or how many of them a search found. */
  const summary = (): string => {
    if (!props.available || props.list === null) return "";
    return searching() ? `${count(drawn().matches)} of ${count(props.list.rows.length)}` : objectsSummary(props.list);
  };

  /** What stands in the place of the tree, or under it: one line each. */
  const notes = (): string[] => {
    if (!props.available) return ["The object list is not in this build."];
    const list = props.list;
    if (list === null) return ["The objects could not be listed."];
    const out: string[] = [];
    if (list.rows.length === 0) out.push(list.total === 0 ? "Nothing drawn yet." : "The objects could not be listed.");
    else if (drawn().rows.length === 0) out.push(`Nothing matches “${query().trim().slice(0, 40)}”.`);
    if (drawn().cut) out.push("More rows are open than the list shows. Search to narrow it.");
    if (list.truncated && list.rows.length > 0 && list.rows.length < list.total) out.push(`The first ${count(list.rows.length)} of ${count(list.total)} objects are listed.`);
    return out;
  };

  const element = (id: string): HTMLElement | null => {
    for (const item of treeEl?.querySelectorAll<HTMLElement>("[data-node]") ?? []) if (item.dataset["node"] === id) return item;
    return null;
  };

  /** Bring a row into the tree's own view (never the page's: the rail does not scroll). */
  const bringIntoView = (id: string): void => {
    const row = element(id)?.firstElementChild;
    if (treeEl === undefined || !(row instanceof HTMLElement)) return;
    const box = treeEl.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < box.top) treeEl.scrollTop -= box.top - at.top;
    else if (at.bottom > box.bottom) treeEl.scrollTop += at.bottom - box.bottom;
  };

  const focusRow = (id: string): void => {
    setActive(id);
    element(id)?.focus({ preventScroll: true });
    bringIntoView(id);
  };

  const setOpenGroup = (id: string, to: boolean): void => {
    if (searching()) {
      const next = new Set(collapsed());
      if (to) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    } else {
      const next = new Set(expanded());
      if (to) next.add(id);
      else next.delete(id);
      setExpanded(next);
    }
  };

  /** A selection this panel asked for is not brought into view again: the row is under the hand. */
  let ownPress = false;
  const select = (node: VisibleNode, additive: boolean): void => {
    if (node.handles.length === 0) return;
    ownPress = true;
    props.onSelect(pressSelection(node.handles, props.selection, additive));
  };

  const more = (parent: string): void => {
    const rows = drawn().rows;
    const at = rows.findIndex((row) => row.id === moreId(parent));
    const before = rows[at - 1]?.id;
    setShown(showMore(shown(), parent));
    // The row that showed more is gone: the keyboard goes to the first row it brought.
    const next = drawn().rows;
    const from = before === undefined ? -1 : next.findIndex((row) => row.id === before);
    const first = next[from + 1];
    if (first !== undefined && treeEl?.contains(document.activeElement) === true) focusRow(first.id);
  };

  const nodeOf = (target: EventTarget | null): VisibleNode | null => {
    const item = target instanceof Element ? target.closest<HTMLElement>("[data-node]") : null;
    const id = item?.dataset["node"];
    return id === undefined ? null : (drawn().rows.find((row) => row.id === id) ?? null);
  };

  const onClick = (event: MouseEvent): void => {
    const node = nodeOf(event.target);
    if (node === null) return;
    setActive(node.id);
    if (node.kind === "more") more(node.parent ?? "");
    else if (node.kind === "group" && event.target instanceof Element && event.target.closest("[data-twist]") !== null) setOpenGroup(node.id, !node.open);
    else select(node, event.ctrlKey || event.metaKey);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    const rows = drawn().rows;
    const action = treeKey(event, rows, stop());
    if (action === null) {
      // A letter that no row starts with is still the tree's: the shell would take a letter it
      // is not told about as the start of a command and move the keyboard to the command line.
      if (isTypeaheadKey(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    switch (action.type) {
      case "focus":
        focusRow(action.id);
        return;
      case "open":
        setOpenGroup(action.id, true);
        return;
      case "close":
        setOpenGroup(action.id, false);
        return;
      case "more":
        more(action.parent);
        return;
      case "select": {
        const node = rows.find((row) => row.id === action.id);
        if (node !== undefined) select(node, action.additive);
        return;
      }
    }
  };

  // A selection made on the drawing: open the way to its first row and bring it into view. Only
  // when the selection itself changed (every refresh hands over a new list of the same handles).
  let lastSelection = "";
  createEffect(() => {
    const key = props.selection.join(",");
    if (key === lastSelection) return;
    lastSelection = key;
    const own = ownPress;
    ownPress = false;
    if (!untrack(open)) return;
    // The palette under the tree grows with a selection and the tree gives way: the row that was
    // pressed stays in view once the rail has settled.
    const pressed = untrack(active);
    if (own && pressed !== null) later(() => bringIntoView(pressed));
    if (own || props.selection.length === 0) return;
    const reveal = untrack(() => revealTarget(tree(), selected()));
    if (reveal === null) return;
    if (!untrack(searching)) {
      const opened = untrack(expanded);
      if (reveal.open.some((id) => !opened.has(id))) setExpanded(new Set([...opened, ...reveal.open]));
      if (reveal.shown.size > 0) {
        const next = new Map(untrack(shown));
        for (const [id, cap] of reveal.shown) next.set(id, Math.max(cap, next.get(id) ?? 0));
        setShown(next);
      }
    }
    later(() => bringIntoView(reveal.id));
  });

  return (
    <aside class={open() ? "properties objects" : "properties objects is-folded"}>
      <div class="properties-head">
        <IconButton icon="chevron-down" size="sm" title={open() ? "Hide the objects" : "Show the objects"} expanded={open()} controls="objects-body" onClick={() => setOpen(!open())} />
        <SectionLabel>Objects</SectionLabel>
        <span class="properties-state objects-state" role="status" data-hint="">
          {summary()}
        </span>
      </div>
      <div class="objects-body" id="objects-body" hidden={!open()}>
        <Show when={props.available && props.list !== null && props.list.rows.length > 0}>
          <div class="objects-search">
            <Field
              type="search"
              ref={(el) => {
                searchEl = el;
              }}
              value={query()}
              ariaLabel="Search objects"
              placeholder="Round 1.3"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              maxLength={200}
              start={<ToolIcon id="search" />}
              onInput={(value) => {
                setQuery(value);
                setCollapsed(new Set<string>());
                if (treeEl !== undefined) treeEl.scrollTop = 0;
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query() !== "") {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                  if (searchEl !== undefined) searchEl.value = "";
                } else if (event.key === "ArrowDown") {
                  const first = stop();
                  if (first === null) return;
                  event.preventDefault();
                  focusRow(first);
                }
              }}
            />
          </div>
          <div
            class="objects-tree"
            role="tree"
            aria-label="Objects"
            aria-multiselectable="true"
            ref={(el) => {
              treeEl = el;
            }}
            onClick={onClick}
            onKeyDown={onKeyDown}
          >
            <Branch nodes={drawn().nodes} selection={selected()} active={stop()} />
          </div>
        </Show>
        <For each={notes()}>{(note) => <div class="properties-empty objects-note">{note}</div>}</For>
      </div>
    </aside>
  );
}
