/**
 * TextArea — the multi-line sibling of `Field`: several lines of text the caller owns. A native
 * `<textarea>`, so typing, selection, IME, undo and `disabled` come from the platform. The recipe
 * lives in `./ui.css`.
 *
 * It is as tall as its text: never shorter than `rows` lines, never taller than `maxRows`, where
 * it starts to scroll. The height is measured (`scrollHeight`) whenever the text or the width
 * changes; nothing is typed to make room.
 *
 * `variant="bare"` draws no stroke, no fill, no padding and no ring, and takes its type from the
 * element around it: it is the editor inside a card that draws those itself (the assistant's
 * composer), and that card shows the focus (`:focus-within`).
 *
 * `onKeyDown` is the caller's (send on Enter, walk a list with the arrows), and it never hears a
 * key the input method is using: Enter that confirms a candidate is not Enter that sends.
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute, as on `Field`.
 */

import { createRenderEffect, onCleanup, onMount, type JSX } from "solid-js";
import { describeByHint, installHints } from "./Tooltip";

/** `field` is the form control; `bare` the editor inside a card that draws its own box and focus. */
export type TextAreaVariant = "field" | "bare";

export interface TextAreaProps {
  /** The current text. The caller holds it and passes the new one back through `onInput`. */
  value?: string;
  /** Runs on every edit with the new text. */
  onInput?: (value: string) => void;
  /** The placeholder. Never the only name: pair it with `ariaLabel`. */
  placeholder?: string;
  /** The accessible name when no visible `<label>` is tied to the control. */
  ariaLabel?: string;
  /** The look. Defaults to `field`. */
  variant?: TextAreaVariant;
  /** The fewest lines it shows. Defaults to 2. */
  rows?: number;
  /** The most lines it grows to before it scrolls. Defaults to 8. */
  maxRows?: number;
  /** Blocks typing and drops the ink to the disabled step. */
  disabled?: boolean;
  /** The text is refused: sets `aria-invalid` and, on `field`, the error stroke. Say why in a line tied by `describedBy`. */
  invalid?: boolean;
  /** The `id` of the help line or the error line beside the control (several, space-separated): sets `aria-describedby`. */
  describedBy?: string;
  /** The hint: a short line about the text, added to the accessible description after
   *  `describedBy`. Never the name: pass `ariaLabel`. */
  title?: string;
  /** Focus the control when it mounts. */
  autoFocus?: boolean;
  /** The native autofill hint; `off` for text no form should remember. Unset leaves it to the platform. */
  autocomplete?: string;
  /** Whether the platform's spelling checker runs. Unset leaves it to the platform. */
  spellcheck?: boolean;
  /** A key went down in the control, outside an input method's composition. The caller may
   *  `preventDefault` it (Enter that sends instead of breaking the line). */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Something was pasted: the caller may take what is not text (a picture) from the clipboard. */
  onPaste?: (event: ClipboardEvent) => void;
  /** Hands the element to the caller, to focus it or to place the caret. */
  ref?: (el: HTMLTextAreaElement) => void;
}

export const TEXTAREA_ROWS = 2;
export const TEXTAREA_MAX_ROWS = 8;

export interface TextAreaMeasure {
  /** The text's height with its padding (`scrollHeight`, read while the height is `auto`). */
  content: number;
  /** One line's height. */
  line: number;
  /** The top and bottom padding together. */
  padding: number;
  /** The top and bottom border together. */
  border: number;
}

/**
 * The height a text area takes for what it holds: its content with its borders, up to `maxRows`
 * lines with the padding and borders, past which it scrolls. The `rows` floor is the element's
 * own (`content` is read with the height at `auto`, where the platform already applies it).
 */
export function textAreaHeight(measure: TextAreaMeasure, maxRows: number): { height: number; scrolls: boolean } {
  const wanted = measure.content + measure.border;
  const most = measure.line * Math.max(1, maxRows) + measure.padding + measure.border;
  return wanted > most ? { height: most, scrolls: true } : { height: wanted, scrolls: false };
}

/** A length the platform computed, as a number; 0 for `normal`, `auto` and the empty string. */
const px = (value: string): number => Number.parseFloat(value) || 0;

function fit(el: HTMLTextAreaElement, maxRows: number): void {
  const style = getComputedStyle(el);
  // `normal` has no computed length: the platform draws it near 1.2 of the type size.
  const line = px(style.lineHeight) || px(style.fontSize) * 1.2;
  el.style.height = "auto";
  const { height, scrolls } = textAreaHeight(
    {
      content: el.scrollHeight,
      line,
      padding: px(style.paddingTop) + px(style.paddingBottom),
      border: px(style.borderTopWidth) + px(style.borderBottomWidth),
    },
    maxRows,
  );
  // Before the control is laid out nothing is measured, and the `rows` floor stands.
  el.style.height = height > 0 ? `${height}px` : "";
  el.style.overflowY = scrolls ? "auto" : "hidden";
}

export function TextArea(props: TextAreaProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  let area: HTMLTextAreaElement | undefined;
  const refit = (): void => {
    if (area !== undefined) fit(area, props.maxRows ?? TEXTAREA_MAX_ROWS);
  };
  onMount(() => {
    refit();
    if (area === undefined || typeof ResizeObserver === "undefined") return;
    // A narrower pane wraps the same text onto more lines.
    let width = area.clientWidth;
    const observer = new ResizeObserver(() => {
      if (area === undefined || area.clientWidth === width) return;
      width = area.clientWidth;
      refit();
    });
    observer.observe(area);
    onCleanup(() => observer.disconnect());
  });
  return (
    <textarea
      ref={(el: HTMLTextAreaElement) => {
        area = el;
        // The caller's text, written only when it differs from what is typed: assigning the same
        // text back in the middle of a composition would end it.
        createRenderEffect(() => {
          const value = props.value ?? "";
          if (el.value !== value) el.value = value;
          refit();
        });
        describeByHint(el, () => props.title, () => props.describedBy);
        props.ref?.(el);
      }}
      class={`ui-textarea ui-textarea--${props.variant ?? "field"}`}
      rows={props.rows ?? TEXTAREA_ROWS}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      aria-invalid={props.invalid ? "true" : undefined}
      disabled={props.disabled}
      data-hint={props.title}
      autofocus={props.autoFocus}
      autocomplete={props.autocomplete}
      spellcheck={props.spellcheck}
      onInput={(event) => {
        props.onInput?.(event.currentTarget.value);
        refit();
      }}
      onKeyDown={(event) => {
        // 229 is what a key reports while the input method holds it, in engines that do not set `isComposing` yet.
        if (event.isComposing || event.keyCode === 229) return;
        props.onKeyDown?.(event);
      }}
      onPaste={(event) => props.onPaste?.(event)}
    />
  );
}
