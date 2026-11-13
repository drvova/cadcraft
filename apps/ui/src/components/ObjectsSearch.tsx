/**
 * The search over the objects tree (`./ObjectsPanel`): one field, in a file of its own.
 */

import type { JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { MAX_QUERY_CHARS } from "../objects";
import { Field } from "../ui/Field";

/** What the search field takes from the panel that shows it. */
export interface ObjectsSearchProps {
  value: string;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  ref?: (el: HTMLInputElement) => void;
}

export function ObjectsSearch(props: ObjectsSearchProps): JSX.Element {
  return (
    <Field
      type="search"
      ref={(el) => props.ref?.(el)}
      value={props.value}
      ariaLabel="Search objects"
      placeholder="Round 1.3"
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      maxLength={MAX_QUERY_CHARS}
      start={<ToolIcon id="search" />}
      onInput={(value) => props.onInput(value)}
      onKeyDown={(event) => props.onKeyDown(event)}
    />
  );
}
