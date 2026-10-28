/**
 * SectionLabel — the small uppercase heading of a panel section. An `<h2>` so a screen reader
 * can jump between panels by heading, which a styled `<div>` never offers. It renders a label,
 * never an action: anything clickable is a Button.
 */

import type { JSX } from "solid-js";

export interface SectionLabelProps {
  /** The section's name. One or two words, the same noun the panel uses elsewhere. */
  children?: JSX.Element;
}

export function SectionLabel(props: SectionLabelProps): JSX.Element {
  return <h2 class="ui-section-label">{props.children}</h2>;
}
