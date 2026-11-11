/**
 * Field — the single-line text input. A native `<input>` so typing, selection, IME, autofill and
 * `disabled` come from the platform. The caller owns the value (a controlled field), passes its
 * accessible name through `ariaLabel`, and picks the input `type` the value needs
 * (trap/field-input-type: email fields get `type="email"`, codes get `inputmode` and no
 * spellcheck). The recipe lives in `./ui.css`.
 *
 * What the platform does with the value is the caller's to say: `autocomplete` names the autofill
 * the field takes (or `off`), `spellcheck` switches the checker, and a secret is never
 * spell-checked whatever its `type` reads at the moment (a shown key is `text`, so its caller
 * passes `spellcheck={false}`; a `password` field gets it without asking). A value the caller
 * refuses is `invalid`, and the line that says why, or a line of help, is tied to the input with
 * `describedBy`.
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
  /** The native autofill hint: `off` for a value no form should remember (an API key), or a
   *  token the platform knows (`email`, `url`, `current-password`). Unset leaves it to the platform. */
  autocomplete?: string;
  /** Whether the platform's spelling checker runs. Unset leaves it to the platform, except a
   *  `password` field, which is never checked. Pass `false` for codes, keys, addresses and names. */
  spellcheck?: boolean;
  /** The value is refused: sets `aria-invalid` and the error stroke. Say why in a line tied by `describedBy`. */
  invalid?: boolean;
  /** The `id` of the help line or the error line under the field (several, space-separated): sets `aria-describedby`. */
  describedBy?: string;
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
      autocomplete={props.autocomplete}
      spellcheck={props.spellcheck ?? (props.type === "password" ? false : undefined)}
      aria-invalid={props.invalid ? "true" : undefined}
      aria-describedby={props.describedBy}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
    />
  );
}
