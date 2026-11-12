/**
 * Checkbox — one yes-or-no value, applied when the form it sits in is, or at once where the
 * caller commits on change. A native `<input type="checkbox">` underneath, so Space, the label's
 * click, form participation and `disabled` come from the platform; the layer draws the box (the
 * accent as its fill when ticked, the mark in the ink that passes on it) from tokens, with no
 * image. The recipe lives in `./ui.css`.
 *
 * The whole `<label>` is the target. Its children are the visible label; a box with no words
 * beside it (a table cell, a property row that already shows the name) takes `ariaLabel` instead.
 *
 * `mixed` is the third state: the box stands for several things that disagree. It is set on the
 * element's own `indeterminate` property (no attribute exists for it) and said as
 * `aria-checked="mixed"`; a press on a mixed box ticks it.
 *
 * The caller owns the value: `onChange` hears what the press asks for, and the box then shows
 * whatever `checked` and `mixed` say, so a change the caller refuses does not stay drawn.
 */

import { createRenderEffect, type JSX } from "solid-js";

export interface CheckboxProps {
  /** Whether the box is ticked. The caller holds it and passes the new one back through `onChange`. */
  checked?: boolean;
  /** Runs when the user presses the box or its label, with the state the press asks for. */
  onChange?: (checked: boolean) => void;
  /** The box stands for values that disagree: the dash, `indeterminate` and `aria-checked="mixed"`. */
  mixed?: boolean;
  /** Blocks the press and drops the box and the label to the disabled ink. */
  disabled?: boolean;
  /** The accessible name when the box has no visible label. Leave it out when `children` name it. */
  ariaLabel?: string;
  /** The box's `id`, for a visible `<label for>` that stands apart from it (a row's own label in
   *  another column): that label is then the name, and no `ariaLabel` is passed. */
  id?: string;
  /** The `id` of a line of help beside the box (several, space-separated): sets `aria-describedby`. */
  describedBy?: string;
  /** The visible label. The whole of it is clickable. */
  children?: JSX.Element;
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  const mixed = (): boolean => props.mixed === true;
  const show = (el: HTMLInputElement): void => {
    el.checked = props.checked === true && !mixed();
    el.indeterminate = mixed();
    if (mixed()) el.setAttribute("aria-checked", "mixed");
    else el.removeAttribute("aria-checked");
  };
  return (
    <label class="ui-checkbox" classList={{ "ui-checkbox--disabled": props.disabled === true }}>
      <span class="ui-checkbox-box">
        <input
          ref={(el: HTMLInputElement) => createRenderEffect(() => show(el))}
          class="ui-checkbox-input"
          type="checkbox"
          id={props.id}
          aria-label={props.ariaLabel}
          aria-describedby={props.describedBy}
          disabled={props.disabled}
          onChange={(event) => {
            const el = event.currentTarget;
            props.onChange?.(el.checked);
            show(el);
          }}
        />
        <span class="ui-checkbox-mark" aria-hidden="true" />
      </span>
      {props.children === undefined ? null : <span class="ui-checkbox-label">{props.children}</span>}
    </label>
  );
}
