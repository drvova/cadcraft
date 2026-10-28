/**
 * Field — the single-line text input. A native `<input>` so typing, selection, IME, autofill and
 * `disabled` come from the platform. The caller owns the value (a controlled field), passes its
 * accessible name through `ariaLabel`, and picks the input `type` the value needs
 * (trap/field-input-type: email fields get `type="email"`, codes get `inputmode` and no
 * spellcheck). The recipe lives in `./ui.css`.
 */

import type { JSX } from "solid-js";

export interface FieldProps {
  /** The current value. The caller holds it and passes the new one back through `onInput`. */
  value?: string;
  /** Runs on every keystroke with the new value. */
  onInput?: (value: string) => void;
  /** The placeholder. Never the only name: pair it with `ariaLabel` (trap/field-label). */
  placeholder?: string;
  /** The accessible name when no visible `<label>` is tied to the input. */
  ariaLabel?: string;
  /** The native input type. Defaults to `text`; the app uses `search` for the command line. */
  type?: "text" | "email" | "search" | "password";
  /** Blocks typing and drops the ink to the disabled step. */
  disabled?: boolean;
  /** A tooltip. */
  title?: string;
  /** Focus the input when it mounts. */
  autoFocus?: boolean;
}

export function Field(props: FieldProps): JSX.Element {
  return (
    <input
      class="ui-field"
      type={props.type ?? "text"}
      value={props.value ?? ""}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      title={props.title}
      autofocus={props.autoFocus}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
    />
  );
}
