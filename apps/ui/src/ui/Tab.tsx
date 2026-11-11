/**
 * Tab — one tab of a tab strip: an editor tab over the drawing, or a compact tab in a pane's
 * header. A native `<button role="tab">` whose `selected` becomes `aria-selected`, so the tab in
 * front is marked for assistive tech as well as the eye (trap/current-unmarked). The caller owns
 * the strip (`role="tablist"`) and which tab is selected.
 *
 * With `onClose` the tab draws a trailing close key. A button cannot nest a button, so the tab
 * and its close `IconButton` are siblings inside one wrapper. The recipe lives in `./ui.css`.
 */

import { Show, type JSX } from "solid-js";
import { IconButton } from "./IconButton";

/** `md` is the editor tab of the 35px strip; `sm` the compact tab of a pane header. */
export type TabSize = "sm" | "md";

export interface TabProps {
  /** The tab in front: the active fill, the full ink, and `aria-selected="true"`. */
  selected?: boolean;
  /** The size. Defaults to `md`. */
  size?: TabSize;
  /** A tooltip, for what the tab switches to or for a clipped label. */
  title?: string;
  /** Runs on click: the caller brings this tab to the front. */
  onClick?: (event: MouseEvent) => void;
  /** Draws a trailing close key that runs this, and never `onClick`. */
  onClose?: () => void;
  /** The close key's accessible name and tooltip. Defaults to "Close". */
  closeLabel?: string;
  /** The tab's label. */
  children?: JSX.Element;
}

export function Tab(props: TabProps): JSX.Element {
  const tab = (): JSX.Element => (
    <button
      type="button"
      role="tab"
      class={`ui-tab ui-tab--${props.size ?? "md"}`}
      aria-selected={props.selected === true}
      title={props.title}
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
