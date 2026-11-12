/**
 * Tab — one tab of a tab strip: an editor tab over the drawing, or a compact tab in a pane's
 * header. A native `<button role="tab">` whose `selected` becomes `aria-selected`, so the tab in
 * front is marked for assistive tech as well as the eye (trap/current-unmarked). The caller owns
 * the strip (`role="tablist"`) and which tab is selected.
 *
 * With `onClose` the tab draws a trailing close key. A button cannot nest a button, so the tab
 * and its close `IconButton` are siblings inside one wrapper. The recipe lives in `./ui.css`.
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute. The label is the
 * tab's name; the hint is what the label leaves out, tied to the tab as its accessible
 * description. A label the tab clips shows in full in the hint by itself, title or no title.
 *
 * `TabPanels`, below, is the whole pattern for a set of views that swap in place (a dialog's
 * pages): the strip, its tabs, and one `role="tabpanel"` per tab, tied both ways (`aria-controls`,
 * `aria-labelledby`). There the strip is one Tab stop and the arrow keys, Home and End move along
 * it and bring each view to the front as they go.
 */

import { For, Show, type JSX } from "solid-js";
import { rovingIndex } from "../roving";
import { IconButton } from "./IconButton";
import { describeByHint, installHints } from "./Tooltip";

/** `md` is the editor tab of the 35px strip; `sm` the compact tab of a pane header. */
export type TabSize = "sm" | "md";

export interface TabProps {
  /** The tab in front: the active fill, the full ink, and `aria-selected="true"`. */
  selected?: boolean;
  /** The size. Defaults to `md`. */
  size?: TabSize;
  /** The hint: what the tab switches to. It shows in the layer's hint box and is the tab's
   *  accessible description. A clipped label needs none: its full text shows by itself. */
  title?: string;
  /** Runs on click: the caller brings this tab to the front. */
  onClick?: (event: MouseEvent) => void;
  /** Draws a trailing close key that runs this, and never `onClick`. */
  onClose?: () => void;
  /** The close key's accessible name and tooltip. Defaults to "Close". */
  closeLabel?: string;
  /** The tab's own `id`, for the panel it shows to name it (`aria-labelledby`). */
  id?: string;
  /** The `id` of the panel this tab shows: sets `aria-controls`. */
  controls?: string;
  /** For a strip that is one Tab stop: `0` on the tab in front, `-1` on the others. Unset, the
   *  component writes no attribute and every tab is a Tab stop. */
  tabIndex?: number;
  /** The tab's label. */
  children?: JSX.Element;
}

export function Tab(props: TabProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  const tab = (): JSX.Element => (
    <button
      ref={(el: HTMLButtonElement) => describeByHint(el, () => props.title)}
      type="button"
      role="tab"
      id={props.id}
      class={`ui-tab ui-tab--${props.size ?? "md"}`}
      aria-selected={props.selected === true}
      aria-controls={props.controls}
      tabIndex={props.tabIndex}
      data-hint={props.title ?? ""}
      onClick={(event) => props.onClick?.(event)}
    >
      {props.children}
    </button>
  );
  return (
    <Show when={props.onClose} fallback={tab()}>
      {(close) => (
        <span class={`ui-tab-closable ui-tab-closable--${props.size ?? "md"}`}>
          {tab()}
          <IconButton icon="close" size="sm" title={props.closeLabel ?? "Close"} onClick={() => close()()} />
        </span>
      )}
    </Show>
  );
}

/** One view of a `TabPanels`: its key, the tab's label, and what the panel holds. */
export interface TabPanel {
  /** The key the caller's `selected` and `onChange` speak in. Letters, digits and hyphens: it is part of an `id`. */
  id: string;
  /** The tab's label. */
  label: string;
  /** The panel's content. It is built once and kept while its tab is behind, so a field keeps what was typed in it. */
  content: () => JSX.Element;
}

export interface TabPanelsProps {
  /** The strip's accessible name: what the views are views of ("Drafting settings"). */
  ariaLabel: string;
  /** The views, in the strip's order. */
  panels: readonly TabPanel[];
  /** The `id` of the view in front. The caller holds it and passes the new one back through `onChange`. */
  selected: string;
  /** Runs when a click or an arrow key asks for another view, with its `id`. */
  onChange: (id: string) => void;
}

/**
 * A strip of compact tabs over the panels they show, one in front. The tabs pattern with automatic
 * activation: the strip is one Tab stop (the tab in front), Left, Right, Home and End move the
 * focus and bring that view to the front at once (a panel here is already built, so showing it
 * costs nothing), and Tab goes on into the panel. A panel behind is `hidden`, not removed.
 */
/** Every strip's tabs and panels name each other by `id`: a count per strip, the same in every build. */
let strips = 0;

export function TabPanels(props: TabPanelsProps): JSX.Element {
  strips += 1;
  const base = `ui-tabs-${strips}`;
  const tabId = (id: string): string => `${base}-tab-${id}`;
  const panelId = (id: string): string => `${base}-panel-${id}`;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const at = props.panels.findIndex((panel) => panel.id === props.selected);
    const next = props.panels[rovingIndex(event.key, at, props.panels.length, "horizontal") ?? -1];
    if (next === undefined) return;
    event.preventDefault();
    props.onChange(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };
  return (
    <div class="ui-tabs">
      <div class="ui-tabs-strip" role="tablist" aria-label={props.ariaLabel} onKeyDown={onKeyDown}>
        <For each={props.panels}>
          {(panel) => (
            <Tab size="sm" id={tabId(panel.id)} controls={panelId(panel.id)} selected={props.selected === panel.id} tabIndex={props.selected === panel.id ? 0 : -1} onClick={() => props.onChange(panel.id)}>
              {panel.label}
            </Tab>
          )}
        </For>
      </div>
      <For each={props.panels}>
        {(panel) => (
          <div class="ui-tabs-panel" role="tabpanel" id={panelId(panel.id)} aria-labelledby={tabId(panel.id)} hidden={props.selected !== panel.id}>
            {panel.content()}
          </div>
        )}
      </For>
    </div>
  );
}
