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
 */

import { Show, type JSX } from "solid-js";
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
      class={`ui-tab ui-tab--${props.size ?? "md"}`}
      aria-selected={props.selected === true}
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
