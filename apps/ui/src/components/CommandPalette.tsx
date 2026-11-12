/**
 * The command palette: every command, one search away. It drops from the title bar the way the
 * editor's own does: a field, and under it the matching commands with the matched letters lit,
 * where the menu keeps each one, the name a person types at the command line, and its shortcut.
 * With nothing typed it lists what was used last, then everything.
 *
 * It is a native `<dialog>` shown modally, so focus stays inside it, the rest of the window is
 * inert while it is up, and closing it hands the focus back to what opened it. The keys work
 * from the field (the focus never leaves it): the arrows walk the list and wrap, Page Up and
 * Page Down move a page, Home and End go to the ends while the field is empty (or with Ctrl,
 * so they still edit the text otherwise), Enter runs the lit row, Tab writes its name into the
 * field. Escape closes at the first press, as it does in the editor and as a CAD hand expects
 * of Escape; what was typed is kept and comes back selected, so nothing is lost and typing
 * replaces it. Running a command clears it. A click outside closes.
 *
 * The pointer lights the row it moves over; a list that scrolls under a still pointer does not.
 *
 * The list and its order are `../palette.ts`'s; this component only draws them, a screenful at
 * a time (more rows are drawn as the list is walked or scrolled, so a long registry costs
 * nothing to open).
 */

import { createEffect, createMemo, createSignal, For, on, Show, type Accessor, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { ToolIcon } from "../icons";
import { highlight, PALETTE_LIMIT, rankCommands, recentItems, rowName, stepActive, type PaletteItem, type PaletteMatch } from "../palette";
import { Kbd } from "../ui/Kbd";
import { Row } from "../ui/Row";
import "../palette.css";

export interface CommandPaletteProps {
  open: Accessor<boolean>;
  items: Accessor<readonly PaletteItem[]>;
  /** The ids used last, newest first. */
  recent: Accessor<readonly string[]>;
  /** Run a command; the shell closes the palette. */
  onRun: (id: string) => void;
  onClose: () => void;
}

const optionId = (index: number): string => `palette-option-${index}`;

export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  /** How many of the matches are drawn; it grows as the list is walked or scrolled. */
  const [shown, setShown] = createSignal(PALETTE_LIMIT);
  let dialog: HTMLDialogElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  /** The lit row follows the keyboard into view; a row lit by the pointer is already under it. */
  let follow = true;
  /** Where the pointer last was, so a row sliding under a still pointer is not taken for a move. */
  let pointerAt = "";
  const mac = isMacPlatform();

  const matches = createMemo<PaletteMatch[]>(() => (props.open() ? rankCommands(query(), props.items(), props.recent(), Number.POSITIVE_INFINITY) : []));
  const rows = createMemo(() => matches().slice(0, shown()));
  const typed = (): boolean => query().trim() !== "";
  /** With nothing typed, how many of the first rows are the recently used ones. */
  const recentCount = createMemo(() => (typed() ? 0 : recentItems(props.items(), props.recent()).length));
  const current = (): PaletteMatch | undefined => matches()[active()];

  /** Light a row from the keyboard: draw it if the list has not reached it yet, and bring it into view. */
  const light = (index: number): void => {
    follow = true;
    if (index >= shown()) setShown((Math.floor(index / PALETTE_LIMIT) + 1) * PALETTE_LIMIT);
    setActive(index);
  };

  createEffect(
    on(props.open, (open) => {
      if (dialog === undefined) return;
      if (open) {
        setShown(PALETTE_LIMIT);
        light(0);
        pointerAt = "";
        if (!dialog.open) dialog.showModal();
        if (list !== undefined) list.scrollTop = 0;
        input?.focus();
        input?.select();
      } else if (dialog.open) {
        dialog.close();
      }
    }),
  );

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

  // The lit row stays in view as the keys move it, with a row of context past it (the list's
  // scroll padding); the first and last rows take the list to its very end.
  createEffect(
    on(active, (index) => {
      if (!follow || list === undefined) return;
      if (index === 0) list.scrollTop = 0;
      else if (index === matches().length - 1) list.scrollTop = list.scrollHeight;
      else document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
    }),
  );

  const run = (item: PaletteItem | undefined): void => {
    if (item === undefined || !item.enabled) return;
    setQuery("");
    props.onRun(item.id);
  };

  /** How many rows a page key moves: the rows the list shows, less one kept for context. */
  const page = (): number => {
    const row = list?.querySelector(".ui-row");
    const height = row instanceof HTMLElement ? row.offsetHeight : 0;
    return height > 0 && list !== undefined ? Math.max(1, Math.floor(list.clientHeight / height) - 1) : 10;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    const count = matches().length;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown") light(stepActive(active(), 1, count, true));
    else if (e.key === "ArrowUp") light(stepActive(active(), -1, count, true));
    else if (e.key === "PageDown") light(stepActive(active(), page(), count, false));
    else if (e.key === "PageUp") light(stepActive(active(), -page(), count, false));
    // Home and End belong to the text while there is text; Ctrl (or an empty field) gives them to the list.
    else if (e.key === "Home" && (mod || query() === "") && !e.shiftKey) light(0);
    else if (e.key === "End" && (mod || query() === "") && !e.shiftKey) light(Math.max(0, count - 1));
    else if (e.key === "Enter") run(current()?.item);
    else if (e.key === "Tab" && !e.shiftKey && !mod && !e.altKey) {
      // Tab writes the lit command's name into the field and stays on that command.
      const item = current()?.item;
      if (item !== undefined) {
        setQuery(item.label);
        setShown(PALETTE_LIMIT);
        if (list !== undefined) list.scrollTop = 0;
        light(Math.max(0, matches().findIndex((m) => m.item.id === item.id)));
      }
    } else return;
    e.preventDefault();
  };

  /** The pointer moved over a row. A scroll sends the same event with the pointer where it was. */
  const onPointerMove = (e: PointerEvent, index: number): void => {
    const at = `${e.screenX},${e.screenY}`;
    if (at === pointerAt) return;
    const first = pointerAt === "";
    pointerAt = at;
    // The first event after opening is the pointer being found where it already was.
    if (first || index === active()) return;
    follow = false;
    setActive(index);
  };

  /** One line under the list: how many commands there are, or why the lit one will not run. */
  const status = (): string => {
    const count = matches().length;
    const lit = current()?.item;
    if (lit !== undefined && !lit.enabled) return `${lit.label} is not available right now`;
    if (count === 0) return "No matches";
    if (!typed()) return `${count} ${count === 1 ? "command" : "commands"}`;
    return `${count} ${count === 1 ? "match" : "matches"}`;
  };

  return (
    <dialog
      class="palette"
      ref={dialog}
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClose={() => {
        // The platform may close a dialog without asking (a second Escape in a row): keep the shell's switch true to it.
        if (props.open()) props.onClose();
      }}
      onClick={(e) => {
        // A click on the dialog itself is a click on its backdrop: outside the box.
        if (e.target === dialog) props.onClose();
        // Anywhere inside, the keyboard stays in the field.
        else input?.focus();
      }}
    >
      <div class="palette-box">
        <div class="palette-field">
          <span class="palette-field-icon">
            <ToolIcon id="search" />
          </span>
          <input
            class="palette-input"
            ref={input}
            type="text"
            role="combobox"
            aria-expanded={matches().length > 0}
            aria-controls="palette-list"
            aria-activedescendant={current() === undefined ? undefined : optionId(active())}
            aria-autocomplete="list"
            aria-label="Search commands"
            aria-describedby="palette-status"
            placeholder="Search commands by name"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setShown(PALETTE_LIMIT);
              light(0);
              // The best match is the first row: the list starts again from its top.
              if (list !== undefined) list.scrollTop = 0;
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div
          class="palette-list"
          id="palette-list"
          role="listbox"
          aria-label="Commands"
          ref={list}
          onScroll={(e) => {
            // Near the end of what is drawn, draw the next screenful.
            const el = e.currentTarget;
            if (shown() < matches().length && el.scrollTop + el.clientHeight * 2 >= el.scrollHeight) setShown((n) => n + PALETTE_LIMIT);
          }}
        >
          <For each={rows()}>
            {(match, index) => (
              <Row option id={optionId(index())} selected={index() === active()} disabled={!match.item.enabled} onPointerMove={(e) => onPointerMove(e, index())} onClick={() => run(match.item)}>
                <span class="palette-label">
                  <For each={highlight(match.item.label, match.indices)}>{(part) => (part.hit ? <mark class="palette-hit">{part.text}</mark> : part.text)}</For>
                </span>
                <Show when={match.item.path !== ""}>
                  <span class="palette-path">{match.item.path}</span>
                </Show>
                <span class="palette-trail">
                  <Show when={recentCount() > 0 && index() === 0}>
                    <span class="palette-tag">recently used</span>
                  </Show>
                  <Show when={recentCount() > 0 && index() === recentCount()}>
                    <span class="palette-tag">other commands</span>
                  </Show>
                  <Show when={!match.item.enabled}>
                    <span class="palette-tag">not available</span>
                  </Show>
                  <Show when={rowName(match) !== ""}>
                    <span class="palette-id">{rowName(match)}</span>
                  </Show>
                  <Show when={match.item.shortcut !== ""}>
                    <Kbd>{shortcutLabel(match.item.shortcut, mac)}</Kbd>
                  </Show>
                </span>
              </Row>
            )}
          </For>
          <Show when={props.open() && matches().length === 0}>
            <div class="palette-empty">
              <span class="palette-empty-lead">
                No command matches <span class="palette-empty-query">{query().trim()}</span>
              </span>
              <span>Try fewer letters, the menu it lives in (Draw, Modify, Dimension), or the name you would type at the command line.</span>
            </div>
          </Show>
        </div>
        <div class="palette-foot">
          <span class="palette-status" id="palette-status" role="status">
            {status()}
          </span>
          <span class="palette-keys" aria-hidden="true">
            <span class="palette-key">
              Run <Kbd>Enter</Kbd>
            </span>
            <span class="palette-key">
              Complete <Kbd>Tab</Kbd>
            </span>
            <span class="palette-key">
              Close <Kbd>Esc</Kbd>
            </span>
          </span>
        </div>
      </div>
    </dialog>
  );
}
