/**
 * Chip — a compact fact or a suggestion. Static chips are a `<span>` (a fact is not a control,
 * so it takes no tab stop); a chip with `onClick` renders a `<button>` and takes the pointer and
 * the focus ring. The recipes are Cursor's pill (`.design-system/research/cursor-recipes-2026-10-28.md`
 * §2: `border-radius 9999px`, 11px type) and §5's hover fill.
 */

import type { JSX } from "solid-js";

/** `neutral` is a quiet fact; `accent` is the accent-tinted one (the composer's keyword chips). */
export type ChipTone = "neutral" | "accent";

export interface ChipProps {
  /** The tone. Defaults to `neutral`. */
  tone?: ChipTone;
  /** When present the chip is interactive and renders as a `<button>`; without it, a `<span>`. */
  onClick?: (event: MouseEvent) => void;
  /** A tooltip; on the interactive form it is also the accessible name when the text is short. */
  title?: string;
  /** The chip's text. Keep it a noun or a short value, never a sentence. */
  children?: JSX.Element;
}

export function Chip(props: ChipProps): JSX.Element {
  if (props.onClick) {
    return (
      <button
        type="button"
        class={`ui-chip ui-chip--${props.tone ?? "neutral"} ui-chip--interactive`}
        title={props.title}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    );
  }
  return (
    <span class={`ui-chip ui-chip--${props.tone ?? "neutral"}`} title={props.title}>
      {props.children}
    </span>
  );
}
