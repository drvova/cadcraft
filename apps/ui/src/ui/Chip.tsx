/**
 * Chip — a compact fact or a suggestion. Static chips are a `<span>` (a fact is not a control,
 * so it takes no tab stop); a chip with `onClick` renders a `<button>` and takes the pointer and
 * the focus ring. The recipes are Cursor's pill (`.design-system/research/cursor-recipes-2026-10-28.md`
 * §2: `border-radius 9999px`, 11px type) and §5's hover fill.
 *
 * `title` is the layer's hint (`./Tooltip.tsx`), never the native attribute. The chip's text is
 * its name; the hint is what the text leaves out, tied to the interactive chip as its accessible
 * description. A chip a surface clips shows its full text in the hint by itself.
 */

import type { JSX } from "solid-js";
import { describeByHint, installHints } from "./Tooltip";

/** `neutral` is a quiet fact; `accent` is the accent-tinted one (the composer's keyword chips). */
export type ChipTone = "neutral" | "accent";

export interface ChipProps {
  /** The tone. Defaults to `neutral`. */
  tone?: ChipTone;
  /** When present the chip is interactive and renders as a `<button>`; without it, a `<span>`. */
  onClick?: (event: MouseEvent) => void;
  /** The hint: what the chip's text leaves out. It shows in the layer's hint box; on the
   *  interactive form it is also the accessible description. Never the name. */
  title?: string;
  /** The chip's text. Keep it a noun or a short value, never a sentence. */
  children?: JSX.Element;
}

export function Chip(props: ChipProps): JSX.Element {
  if (typeof document !== "undefined") installHints();
  if (props.onClick) {
    return (
      <button
        ref={(el: HTMLButtonElement) => describeByHint(el, () => props.title)}
        type="button"
        class={`ui-chip ui-chip--${props.tone ?? "neutral"} ui-chip--interactive`}
        data-hint={props.title ?? ""}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    );
  }
  return (
    <span class={`ui-chip ui-chip--${props.tone ?? "neutral"}`} data-hint={props.title ?? ""}>
      {props.children}
    </span>
  );
}
