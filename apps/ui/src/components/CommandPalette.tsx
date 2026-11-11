/**
 * The command palette: every command, one search away. It drops from the title bar the way the
 * editor's own does: a field, and under it the matching commands with the matched letters lit,
 * where the menu keeps each one, the name a person types at the command line, and its shortcut.
 * With nothing typed it lists what was used last, then everything.
 *
 * It is a native `<dialog>` shown modally, so focus stays inside it, Escape closes it and the
 * rest of the window is inert while it is up. The arrow keys walk the list from the field
 * (focus never leaves the field), Enter runs the lit row, and a click outside closes it.
 *
 * The list and its order are `../palette.ts`'s; this component only draws them.
 */

import { createEffect, createMemo, createSignal, For, on, Show, type Accessor, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { ToolIcon } from "../icons";
import { highlight, rankCommands, type PaletteItem, type PaletteMatch } from "../palette";
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

export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let dialog: HTMLDialogElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const mac = isMacPlatform();

  const matches = createMemo<PaletteMatch[]>(() => (props.open() ? rankCommands(query(), props.items(), props.recent()) : []));
  /** With nothing typed, how many of the first rows are the recently used ones. */
  const recentCount = createMemo(() => {
    if (query().trim() !== "") return 0;
    const known = new Set(props.items().map((item) => item.id));
    return props.recent().filter((id) => known.has(id)).length;
  });

  createEffect(
    on(props.open, (open) => {
      if (dialog === undefined) return;
      if (open) {
        setQuery("");
        setActive(0);
        if (!dialog.open) dialog.showModal();
        input?.focus();
      } else if (dialog.open) {
        dialog.close();
      }
    }),
  );

  // The lit row stays in view as the arrows move it.
  createEffect(() => {
    const row = list?.children[active()];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  });

  const run = (item: PaletteItem | undefined): void => {
    if (item === undefined || !item.enabled) return;
    props.onRun(item.id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const count = matches().length;
    if (e.key === "ArrowDown") setActive((i) => (count === 0 ? 0 : (i + 1) % count));
    else if (e.key === "ArrowUp") setActive((i) => (count === 0 ? 0 : (i - 1 + count) % count));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(Math.max(0, count - 1));
    else if (e.key === "Enter") run(matches()[active()]?.item);
    else return;
    e.preventDefault();
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
      onClick={(e) => {
        // A click on the dialog itself is a click on its backdrop: outside the box.
        if (e.target === dialog) props.onClose();
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
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-label="Search commands"
            placeholder="Search commands by name"
            autocomplete="off"
            spellcheck={false}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div class="palette-list" id="palette-list" role="listbox" aria-label="Commands" ref={list}>
          <For each={matches()}>
            {(match, index) => (
              <Row selected={index() === active()} disabled={!match.item.enabled} onClick={() => run(match.item)}>
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
                  <Show when={!match.item.id.startsWith("ui.")}>
                    <span class="palette-id">{match.item.id}</span>
                  </Show>
                  <Show when={match.item.shortcut !== ""}>
                    <Kbd>{shortcutLabel(match.item.shortcut, mac)}</Kbd>
                  </Show>
                </span>
              </Row>
            )}
          </For>
          <Show when={matches().length === 0}>
            <div class="palette-empty">No command matches. Try its menu name, or what you would type at the command line.</div>
          </Show>
        </div>
      </div>
    </dialog>
  );
}
