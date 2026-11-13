/**
 * The command palette with its list drawn by Slab (`slab/palette.slab`): the same props as
 * `../components/CommandPalette`, the same model (`../palette-model`: what is typed, the lit row,
 * the keys, what a press runs, the line under the list), the same frame. Only the list, the lines
 * that say nothing matched and the foot are Slab's.
 *
 * **The frame is the SolidJS palette's**: a native `<dialog>` shown modally (the top layer, the
 * inert page, Escape at the first press, a press outside, the focus handed back to what opened
 * it), the box, and the field over the list. The field is the interface's own bare `Field`, as in
 * the SolidJS palette, and it stands over the surface, not in a hole of it: it is the one control
 * here, it keeps the keyboard the whole time, and the kernel's text field was measured and turned
 * down for search (`SlabObjects.tsx`, `CommandField.tsx`: no word selection, an input method's
 * text drawn over its example, a slower key to paint).
 *
 * **What a screen reader gets.** The field is a combobox whose `aria-activedescendant` names the
 * lit option. An id inside the surface's shadow tree is out of reach of an attribute in the page
 * (the Properties popup met this: `./popup.tsx`), and the element reference that could reach it
 * may only point out of a shadow tree, not into one. So the surface is hidden from assistive tech,
 * and the field's listbox is the page's own, beside it and out of sight: the lit option and ten
 * either side, each with its place in the whole list (`aria-posinset`, `aria-setsize`) and the
 * same text as a SolidJS row, and the status line. The combobox, its expanded state, the active
 * option's name, place, selected and disabled states and the status are announced as in the
 * SolidJS palette; what is lost is a reading, in browse mode, of rows further than ten from the
 * lit one (the SolidJS list holds sixty at first, more as it is walked).
 *
 * **What the kernel does**: lays out the rows in view (a `virtual` list), paints them, the lit
 * one, the matched letters, the empty lines and the foot, and scrolls the list under the wheel
 * and its scrollbar. Nothing in it takes the focus or emits a signal: the lit row is a state the
 * host sets on that row (`lit`), a move of the keys scrolls the list from here
 * (`followOffset`), and a press or a move of the pointer is placed on a row from where it lands
 * (`rowAt`: the rows are all one height), so no binder asks for a frame per move.
 *
 * Mounted in the place of the SolidJS palette, after `loadSlab("palette")` has defined the
 * element. The element is in the page from the start (the dialog is closed, not absent), so its
 * document is mounted long before the first opening; at that first opening it is measured at once
 * rather than a frame later (the driver measures a surface when it is connected).
 */

import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import { ToolIcon } from "../icons";
import { rowName } from "../palette";
import { createPaletteModel, paletteOptionId as optionId, type CommandPaletteProps } from "../palette-model";
import { Field } from "../ui/Field";
import { followOffset, listHeight, listMax, mirrorWindow, NARROW_MAX, pageRows, paletteRows, PALETTE_SCALARS, rowAt, type PaletteParams } from "./palette-params";
import { isSlabControlHost, type SlabControlHost } from "./scene";
import { attachSurface } from "./surface";
import "../palette.css";
import "./slab-palette.css";

/** The driver's per-node app state (`inst_set_node_state`), beyond what `./scene` lists. */
interface PaletteHost extends SlabControlHost {
  setNodeState(key: string, name: string, on: boolean): boolean;
}

function isPaletteHost(element: Element): element is PaletteHost {
  return isSlabControlHost(element) && "setNodeState" in element && typeof Reflect.get(element, "setNodeState") === "function";
}

/** The document's keys: the scrolling list and its rows. */
const LIST = "#box/#body/#list";
const EACH = `${LIST}/rows`;
/** The full key of a row's own node (the template's root `row`): the kernel escapes `%`, `/` and `~` in an item's key. */
const rowNodeKey = (item: string): string => `${EACH}~${item.replace(/[%/~]/g, (c) => (c === "%" ? "%25" : c === "/" ? "%2F" : "%7E"))}/row@0`;

/** How many options either side of the lit one the field's listbox holds. */
const MIRROR_REACH = 10;

export function SlabPalette(props: CommandPaletteProps): JSX.Element {
  let dialog: HTMLDialogElement | undefined;
  let input: HTMLInputElement | undefined;
  let element: HTMLElement | undefined;
  let surface: PaletteHost | undefined;
  const mac = isMacPlatform();
  const [win, setWin] = createSignal({ w: typeof window === "undefined" ? 1280 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight });

  const max = createMemo(() => listMax(win().h));
  /** How tall the list is now: the room its rows take, up to the cap. */
  const viewport = (): number => listHeight(model.matches().length, max());

  /**
   * Whether the list has been laid out. The kernel at the pinned commit traps when a scroll is
   * set or read on a container it has not solved yet (the surface was hidden with the closed
   * dialog), and an instance that trapped answers nothing again: the scroll waits for a frame.
   */
  let solved = false;
  const scrollOf = (): number => (surface !== undefined && solved ? surface.getScroll(LIST, 0) : 0);
  const scrollTo = (offset: number): void => {
    if (surface !== undefined && solved) surface.setScroll(LIST, 0, offset);
  };

  const model = createPaletteModel(props, {
    pageRows: () => pageRows(viewport()),
    toTop: () => scrollTo(0),
  });
  const { query, active, matches, recentCount, current, status } = model;

  const rows = createMemo(() => paletteRows(matches(), recentCount(), (shortcut) => shortcutLabel(shortcut, mac)));
  const params = createMemo(
    (): PaletteParams => ({
      rows: rows(),
      filled: rows().length > 0 || !props.open(),
      query: query().trim(),
      status: status(),
      narrow: win().w <= NARROW_MAX,
      list_max: max(),
    }),
  );

  createEffect(
    on(props.open, (open) => {
      if (dialog === undefined) return;
      if (open) {
        model.opened();
        if (!dialog.open) dialog.showModal();
        scrollTo(0);
        // The driver measures a surface when it is connected and when its size changes; a
        // surface in a dialog that has just been shown would be measured after this frame's
        // layout, and painted a frame late. It is measured now.
        if (element !== undefined && "connectedCallback" in element && typeof element.connectedCallback === "function") Reflect.apply(element.connectedCallback, element, []);
        input?.focus();
        input?.select();
      } else if (dialog.open) {
        dialog.close();
      }
    }),
  );

  onMount(() => {
    const onResize = (): void => {
      setWin({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));

    if (element === undefined || !isPaletteHost(element)) return;
    const host = element;
    surface = host;
    const detach = attachSurface(host, [], () => undefined);

    /** The list as last handed over, and the row the `lit` state is on. */
    let sent: unknown = null;
    let lit: string | null = null;
    /** The lit row's state could not be set yet (its row is not laid out): the next frame tries again. */
    let litPending = false;
    const setLit = (key: string | null): void => {
      if (lit !== null && lit !== key) host.setNodeState(rowNodeKey(lit), "lit", false);
      lit = key;
      litPending = key !== null && !host.setNodeState(rowNodeKey(key), "lit", true);
    };

    createEffect(() => {
      const next = params();
      for (const name of PALETTE_SCALARS) host.setParam(name, next[name]);
      if (sent !== next.rows) {
        sent = next.rows;
        host.setList("rows", "", next.rows);
      }
      const row = next.rows[active()];
      setLit(row?.key ?? null);
    });

    // The lit row stays in view as the keys move it, with a row of context past it.
    createEffect(
      on(active, (index) => {
        if (!model.follows()) return;
        scrollTo(followOffset(scrollOf(), index, matches().length, viewport()));
      }),
    );

    const onFrame = (): void => {
      if (!solved) {
        solved = host.sceneSnapshot().some((node) => node.key === LIST);
        if (solved) scrollTo(followOffset(0, active(), matches().length, viewport()));
      }
      if (litPending && lit !== null) setLit(lit);
    };
    host.addEventListener("slab-frame", onFrame);

    /** The row under a pointer event; -1 when it is over none. */
    const rowOf = (event: PointerEvent | MouseEvent): number => {
      const box = host.getBoundingClientRect();
      return rowAt(event.clientX - box.left, event.clientY - box.top, scrollOf(), box.width, viewport(), matches().length);
    };
    const onPointerMove = (event: PointerEvent): void => {
      const index = rowOf(event);
      if (index >= 0) model.pointerOver(event.screenX, event.screenY, index);
    };
    const onClick = (event: MouseEvent): void => {
      const index = rowOf(event);
      if (index >= 0) model.run(matches()[index]?.item);
    };
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("click", onClick);

    onCleanup(() => {
      detach();
      host.removeEventListener("slab-frame", onFrame);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("click", onClick);
      surface = undefined;
    });
  });

  /** The options the field's listbox holds for a screen reader. */
  const mirror = createMemo(() => {
    const all = matches();
    const { from, to } = mirrorWindow(active(), all.length, MIRROR_REACH);
    return all.slice(from, to).map((match, at) => ({ match, index: from + at }));
  });

  return (
    <dialog
      class="palette slab-palette"
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
        <cadcraft-palette ref={element} class="slab-palette-surface" aria-hidden="true" />
        <div class="slab-palette-sr" id="palette-list" role="listbox" aria-label="Commands">
          <For each={mirror()}>
            {(entry) => (
              <div role="option" id={optionId(entry.index)} aria-selected={entry.index === active()} aria-disabled={entry.match.item.enabled ? undefined : "true"} aria-posinset={entry.index + 1} aria-setsize={matches().length}>
                <span>{entry.match.item.label}</span>
                <Show when={entry.match.item.path !== ""}>
                  <span>{entry.match.item.path}</span>
                </Show>
                <span>
                  <Show when={recentCount() > 0 && entry.index === 0}>
                    <span>recently used</span>
                  </Show>
                  <Show when={recentCount() > 0 && entry.index === recentCount()}>
                    <span>other commands</span>
                  </Show>
                  <Show when={!entry.match.item.enabled}>
                    <span>not available</span>
                  </Show>
                  <Show when={rowName(entry.match) !== ""}>
                    <span>{rowName(entry.match)}</span>
                  </Show>
                  <Show when={entry.match.item.shortcut !== ""}>
                    <kbd>{shortcutLabel(entry.match.item.shortcut, mac)}</kbd>
                  </Show>
                </span>
              </div>
            )}
          </For>
          <Show when={props.open() && matches().length === 0}>
            <div>
              No command matches {query().trim()}. Try fewer letters, the menu it lives in (Draw, Modify, Dimension), or the name you would type at the command line.
            </div>
          </Show>
        </div>
        <span class="slab-palette-sr" id="palette-status" role="status">
          {status()}
        </span>
      </div>
    </dialog>
  );
}
