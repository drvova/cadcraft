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
 * The list and its order are `../palette.ts`'s, and the state and the keys `../palette-model.ts`'s
 * (shared with the palette Slab draws); this component only draws them, a screenful at
 * a time (more rows are drawn as the list is walked or scrolled, so a long registry costs
 * nothing to open).
 */

import { createEffect, For, on, Show, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { ToolIcon } from "../icons";
import { highlight, rowName } from "../palette";
import { createPaletteModel, paletteOptionId as optionId, type CommandPaletteProps } from "../palette-model";
import { Field } from "../ui/Field";
import { Kbd } from "../ui/Kbd";
import { Row } from "../ui/Row";
import "../palette.css";

export type { CommandPaletteProps } from "../palette-model";

export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  let dialog: HTMLDialogElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const mac = isMacPlatform();

  /** How many rows a page key moves: the rows the list shows, less one kept for context. */
  const page = (): number => {
    const row = list?.querySelector(".ui-row");
    const height = row instanceof HTMLElement ? row.offsetHeight : 0;
    return height > 0 && list !== undefined ? Math.max(1, Math.floor(list.clientHeight / height) - 1) : 10;
  };
  // The state, the keys and the order are the model's (`../palette-model`), shared with the
  // palette Slab draws; this component draws the rows and scrolls its list.
  const model = createPaletteModel(props, {
    pageRows: page,
    toTop: () => {
      if (list !== undefined) list.scrollTop = 0;
    },
  });
  const { query, active, matches, rows, recentCount, current, run, status } = model;

  createEffect(
    on(props.open, (open) => {
      if (dialog === undefined) return;
      if (open) {
        model.opened();
        if (!dialog.open) dialog.showModal();
        if (list !== undefined) list.scrollTop = 0;
        input?.focus();
        input?.select();
      } else if (dialog.open) {
        dialog.close();
      }
    }),
  );

  // The lit row stays in view as the keys move it, with a row of context past it (the list's
  // scroll padding); the first and last rows take the list to its very end.
  createEffect(
    on(active, (index) => {
      if (!model.follows() || list === undefined) return;
      if (index === 0) list.scrollTop = 0;
      else if (index === matches().length - 1) list.scrollTop = list.scrollHeight;
      else document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
    }),
  );

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
          {/* The system's bare field: the box around it is the palette's, and the palette shows
              no ring on a field the focus never leaves. The lens is its leading adornment. */}
          <Field
            variant="bare"
            ref={(el) => {
              input = el;
            }}
            role="combobox"
            expanded={matches().length > 0}
            controls="palette-list"
            activeDescendant={current() === undefined ? undefined : optionId(active())}
            autocompleteKind="list"
            ariaLabel="Search commands"
            describedBy="palette-status"
            placeholder="Search commands by name"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={query()}
            onInput={model.input}
            onKeyDown={(e) => {
              model.keyDown(e);
            }}
            start={
              <span class="palette-field-icon">
                <ToolIcon id="search" />
              </span>
            }
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
            if (el.scrollTop + el.clientHeight * 2 >= el.scrollHeight) model.more();
          }}
        >
          <For each={rows()}>
            {(match, index) => (
              <Row option id={optionId(index())} selected={index() === active()} disabled={!match.item.enabled} onPointerMove={(e) => model.pointerOver(e.screenX, e.screenY, index())} onClick={() => run(match.item)}>
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
