/**
 * Select — one value picked from a short, known list. A native `<select>` underneath, so the
 * keyboard, type-ahead, a phone's picker and every system webview's own list come from the
 * platform; the layer draws only the closed control: the field recipe, the value clipped with an
 * ellipsis before the arrow, and the system's `chevron-down` as the arrow. The recipe lives in
 * `./ui.css`.
 *
 * The native control sits under the drawn face at no opacity and takes every press; the face is
 * hidden from assistive tech, which reads the `<select>` itself. Drawing the value in a `<span>`
 * is what lets it clip with an ellipsis, end on the arrow's side (`align="end"`) and read quieter
 * while `mixed` in every engine, none of which a styled `<select>` does the same way in all three
 * webviews.
 *
 * The caller owns the value. A value that is not in `options` (a layer that was deleted while an
 * object still names it) is kept as one more option at the top, so the control never shows a
 * value the data does not hold. `mixed` is a selection whose objects disagree: the `placeholder`
 * shows in the quiet ink and is not a choice in the list.
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute. A value the box cuts
 * short is the hint's first line in full, whether or not there is a `title`.
 */

import { createMemo, For, Show, type JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { describeByHint, installHints } from "./Tooltip";

/** One choice: the value handed back, the words shown, and whether it can be picked now. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** `field` is the form control, stroked and filled at rest; `inline` is a value in a dense list
 *  row, which reads as text until the pointer or the keyboard is on it. */
export type SelectVariant = "field" | "inline";

/** `md` is the field's 24px box; `sm` the 20px box that fits a 22px list row. */
export type SelectSize = "sm" | "md";

/** The side of the box the value sits on: `start` in a form, `end` in a column of values. */
export type SelectAlign = "start" | "end";

export interface SelectProps {
  /** The current value. The caller holds it and passes the new one back through `onChange`. A
   *  value that is not in `options` is shown as one more option at the top. */
  value?: string;
  /** The choices, in the order the list shows them. */
  options: readonly SelectOption[];
  /** Runs when the user picks a choice, with its value. */
  onChange?: (value: string) => void;
  /** The accessible name when no visible `<label>` is tied to the control. */
  ariaLabel?: string;
  /** The native control's `id`, for a visible `<label for>` beside it: the label is then the name, and no `ariaLabel` is passed. */
  id?: string;
  /** The look. Defaults to `field`. */
  variant?: SelectVariant;
  /** The box size. Defaults to `md`. */
  size?: SelectSize;
  /** The side the value sits on. Defaults to `start`. */
  align?: SelectAlign;
  /** The selection holds differing values: the `placeholder` shows in the quiet ink, and the
   *  first pick replaces them all. */
  mixed?: boolean;
  /** What the control reads while `mixed` ("*VARIES*"). It is never one of the choices. */
  placeholder?: string;
  /** Blocks the list and drops the ink to the disabled step. */
  disabled?: boolean;
  /** The value is refused: sets `aria-invalid` and the error stroke. Say why in a line tied by `describedBy`. */
  invalid?: boolean;
  /** The `id` of the help line or the error line beside the control (several, space-separated): sets `aria-describedby`. */
  describedBy?: string;
  /** The hint: a short line about the value, added to the accessible description after
   *  `describedBy`. Never the name: pass `ariaLabel`. */
  title?: string;
}

export function Select(props: SelectProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  const mixed = (): boolean => props.mixed === true;
  /** The choices as the list shows them: the caller's, after the current value when they lack it. */
  const choices = createMemo((): readonly SelectOption[] => {
    const value = props.value;
    if (mixed() || value === undefined || props.options.some((option) => option.value === value)) return props.options;
    return [{ value, label: value }, ...props.options];
  });
  const shown = (): string => {
    if (mixed()) return props.placeholder ?? "";
    return choices().find((option) => option.value === props.value)?.label ?? "";
  };
  return (
    <span
      class={`ui-select ui-select--${props.variant ?? "field"} ui-select--${props.size ?? "md"} ui-select--${props.align ?? "start"}`}
      classList={{ "ui-select--mixed": mixed(), "ui-select--invalid": props.invalid === true, "ui-select--disabled": props.disabled === true }}
      data-hint={props.title ?? ""}
    >
      <select
        ref={(el: HTMLSelectElement) => describeByHint(el, () => props.title, () => props.describedBy)}
        class="ui-select-control"
        id={props.id}
        aria-label={props.ariaLabel}
        aria-invalid={props.invalid ? "true" : undefined}
        disabled={props.disabled}
        onChange={(event) => {
          const el = event.currentTarget;
          props.onChange?.(el.value);
          // The caller owns the value: a pick it did not take is put back.
          const kept = mixed() ? "" : props.value;
          if (kept !== undefined && el.value !== kept) el.value = kept;
        }}
      >
        <Show when={mixed()}>
          <option value="" disabled hidden selected>
            {props.placeholder ?? ""}
          </option>
        </Show>
        <For each={choices()}>
          {(option) => (
            <option value={option.value} disabled={option.disabled} selected={!mixed() && option.value === props.value}>
              {option.label}
            </option>
          )}
        </For>
      </select>
      <span class="ui-select-value" aria-hidden="true" data-hint-label="">
        {shown()}
      </span>
      <span class="ui-select-arrow" aria-hidden="true">
        <ToolIcon id="chevron-down" />
      </span>
    </span>
  );
}
