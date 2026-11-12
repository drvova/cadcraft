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
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute: it shows in the hint
 * box and joins `describedBy` as the field's accessible description. It is never the name. A value
 * the box cuts short is the hint's first line in full, whether or not there is a `title` (never a
 * password's).
 *
 * `variant="inline"` is a value in a dense list row: text until the pointer or the keyboard is on
 * it, as `Select variant="inline"` is, and `size="sm"` is the 20px box that fits a 22px row. Such
 * a row commits on Enter and on leaving and gives the old value back on Escape, so the field hands
 * its caller `onKeyDown` (never a key an input method is using), `onFocus`, `onBlur` and the
 * element (`ref`), and `selectOnFocus` selects the whole value as focus arrives, so typing
 * replaces it.
 *
 * A field that drives a list (the command palette's input) is a combobox: `role`, `expanded`,
 * `controls`, `activeDescendant` and `autocompleteKind` say so, in the layer's own names.
 *
 * `variant="bare"` is the one line inside a box a surface draws itself (the palette's header, the
 * command line's strip): no stroke, no fill, no inset, no ring, in the surface's own face and
 * size, as `TextArea variant="bare"` is. The surface shows the focus.
 *
 * `start` and `end` are adornments inside the field's two ends: a glyph that says what the value
 * is (a search field's lens), or one small control that acts on the value (show or hide a key).
 * The field is then a `<span class="ui-field-box">` around the same `<input>`, which is still the
 * whole box: the stroke, the focus ring and the error edge go around the adornments, and the
 * input's padding grows by each adornment's measured width, so a long value scrolls beside them
 * and never under them. A field with neither is the bare `<input>`, as before.
 */

import { children, onCleanup, onMount, Show, type JSX } from "solid-js";
import { describeByHint, installHints } from "./Tooltip";

/** `field` is the form control, stroked and filled at rest; `inline` is a value in a dense list
 *  row, which reads as text until the pointer or the keyboard is on it; `bare` is the one line
 *  inside a box the surface draws and whose focus the surface shows. */
export type FieldVariant = "field" | "inline" | "bare";

/** `md` is the 24px box; `sm` the 20px box that fits a 22px list row. */
export type FieldSize = "sm" | "md";

/** The side of the box the value sits on: `start` in a form, `end` in a column of values. */
export type FieldAlign = "start" | "end";

/** The keyboard a phone shows for the value, where `type` alone does not say. */
export type FieldInputMode = "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url" | "none";

/** What a combobox's list does with the typed text: `list` offers matches, `inline` completes the
 *  text in place, `both` does both, `none` offers the same list whatever is typed. */
export type AutocompleteKind = "list" | "inline" | "both" | "none";

export interface FieldProps {
  /** The current value. The caller holds it and passes the new one back through `onInput`. */
  value?: string;
  /** Runs on every keystroke with the new value. */
  onInput?: (value: string) => void;
  /** The placeholder. Never the only name: pair it with `ariaLabel` (trap/field-label). */
  placeholder?: string;
  /** The accessible name when no visible `<label>` is tied to the input. */
  ariaLabel?: string;
  /** The input's `id`, for a visible `<label for>` beside it: the label is then the name, and no `ariaLabel` is passed. */
  id?: string;
  /** The native input type. Defaults to `text`; the app uses `search` for the command line. */
  type?: "text" | "email" | "search" | "password";
  /** Blocks typing and drops the ink to the disabled step. */
  disabled?: boolean;
  /** The hint: a short line about the value. It shows in the layer's hint box and is added to
   *  the field's accessible description, after `describedBy`. Never the name: pass `ariaLabel`. */
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
  /** The look. Defaults to `field`. */
  variant?: FieldVariant;
  /** The box size. Defaults to `md`. */
  size?: FieldSize;
  /** The side the value sits on. Defaults to `start`; `end` also lines its figures up in a column. */
  align?: FieldAlign;
  /** The value stands for several things that differ ("*VARIES*"): it reads in the quiet ink. */
  mixed?: boolean;
  /** The value can be selected and copied, not changed. It stays a Tab stop, unlike `disabled`. */
  readOnly?: boolean;
  /** The most characters the field takes. */
  maxLength?: number;
  /** The keyboard a phone shows: `decimal` for a number with a fraction, `numeric` for digits. */
  inputMode?: FieldInputMode;
  /** Select the whole value when focus arrives, by key or by click, so typing replaces it. */
  selectOnFocus?: boolean;
  /** A key went down in the field, outside an input method's composition. The caller may
   *  `preventDefault` it (Enter that commits, Escape that gives the old value back). */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Focus arrived. */
  onFocus?: (event: FocusEvent) => void;
  /** Focus left: a row that commits on leaving does it here. */
  onBlur?: (event: FocusEvent) => void;
  /** Hands the element to the caller, to focus it or to place the caret. */
  ref?: (el: HTMLInputElement) => void;
  /** The field drives a list of matches and keeps the keyboard: `combobox`. Pass `expanded`,
   *  `controls` and `activeDescendant` with it. */
  role?: "combobox";
  /** A combobox: whether its list is showing now (`aria-expanded`). */
  expanded?: boolean;
  /** A combobox: the `id` of its list (`aria-controls`). */
  controls?: string;
  /** A combobox: the `id` of the option the arrow keys are on (`aria-activedescendant`); unset when none is. */
  activeDescendant?: string;
  /** A combobox: what its list does with the typed text (`aria-autocomplete`). */
  autocompleteKind?: AutocompleteKind;
  /** The native `autocapitalize`: `off` for a command, a code or a name a phone's keyboard must
   *  not capitalise. Unset leaves it to the platform. */
  autocapitalize?: "off" | "none" | "sentences" | "words" | "characters";
  /** An adornment inside the field's leading end: a glyph that says what the value is. A press on
   *  a glyph lands on the input; hide it from assistive tech (`ToolIcon` does). */
  start?: JSX.Element;
  /** An adornment inside the field's trailing end: a glyph, or one small control that acts on the
   *  value (`<IconButton size="sm">`), which follows the input in the Tab order. */
  end?: JSX.Element;
}

/**
 * A slot's width, handed to the stylesheet as the padding the input grows by. It is measured (an
 * adornment is a glyph, a 20px key or a few characters, and the layer cannot know which) once the
 * slot is laid out and again whenever its box changes; until then, and where nothing is laid out,
 * the stylesheet's own default (one small control) stands.
 */
function measured(side: "start" | "end"): (slot: HTMLElement) => void {
  return (slot) => {
    const measure = (): void => makeRoom(slot, side);
    onMount(measure);
    const watcher = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    watcher?.observe(slot);
    onCleanup(() => {
      watcher?.disconnect();
      slot.parentElement?.style.removeProperty(`--ui-field-${side}`);
    });
  };
}

/** Writes a slot's laid-out width on its box, where the stylesheet reads it as the input's
 *  padding on that side. A slot that is not laid out (no width) changes nothing. Exported for
 *  the tests. */
export function makeRoom(slot: HTMLElement, side: "start" | "end"): void {
  const width = slot.offsetWidth;
  if (width > 0) slot.parentElement?.style.setProperty(`--ui-field-${side}`, `${width}px`);
}

export function Field(props: FieldProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  // A press that brings the focus ends in a mouseup, which in WebKit drops the selection the
  // focus just made: that one mouseup is refused.
  let pressedIn = false;
  const input = (
    <input
      ref={(el: HTMLInputElement) => {
        describeByHint(el, () => props.title, () => props.describedBy);
        props.ref?.(el);
      }}
      class={`ui-field ui-field--${props.variant ?? "field"} ui-field--${props.size ?? "md"} ui-field--${props.align ?? "start"}`}
      classList={{ "ui-field--mixed": props.mixed === true }}
      id={props.id}
      type={props.type ?? "text"}
      value={props.value ?? ""}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      inputMode={props.inputMode}
      data-hint={props.title ?? ""}
      autofocus={props.autoFocus}
      autocomplete={props.autocomplete}
      spellcheck={props.spellcheck ?? (props.type === "password" ? false : undefined)}
      aria-invalid={props.invalid ? "true" : undefined}
      role={props.role}
      aria-expanded={props.expanded === undefined ? undefined : props.expanded}
      aria-controls={props.controls}
      aria-activedescendant={props.activeDescendant}
      aria-autocomplete={props.autocompleteKind}
      autocapitalize={props.autocapitalize}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
      onKeyDown={(event) => {
        // 229 is what a key reports while the input method holds it, in engines that do not set `isComposing` yet.
        if (event.isComposing || event.keyCode === 229) return;
        props.onKeyDown?.(event);
      }}
      onPointerDown={(event) => {
        pressedIn = props.selectOnFocus === true && document.activeElement !== event.currentTarget;
      }}
      onMouseUp={(event) => {
        if (pressedIn) event.preventDefault();
        pressedIn = false;
      }}
      onFocus={(event) => {
        if (props.selectOnFocus === true) event.currentTarget.select();
        props.onFocus?.(event);
      }}
      onBlur={(event) => props.onBlur?.(event)}
    />
  );
  // Whether the field is boxed is settled when it is made (the caller wrote `start` or `end`);
  // what stands in a slot may come and go after that.
  if (!("start" in props) && !("end" in props)) return input;
  const start = children(() => props.start);
  const end = children(() => props.end);
  const filled = (slot: unknown): boolean => slot !== undefined && slot !== null && slot !== false;
  return (
    <span
      class={`ui-field-box ui-field-box--${props.variant ?? "field"} ui-field-box--${props.size ?? "md"}`}
      classList={{
        "ui-field-box--start": filled(start()),
        "ui-field-box--end": filled(end()),
        "ui-field-box--disabled": props.disabled === true,
      }}
    >
      <Show when={filled(start())}>
        <span class="ui-field-slot ui-field-slot--start" ref={measured("start")}>
          {start()}
        </span>
      </Show>
      {input}
      <Show when={filled(end())}>
        <span class="ui-field-slot ui-field-slot--end" ref={measured("end")}>
          {end()}
        </span>
      </Show>
    </span>
  );
}
