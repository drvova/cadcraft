/**
 * The inline ask: one line over the drawing, opened with the editor's own key for it (Ctrl+K),
 * that hands what is typed to the assistant without leaving the drawing. It is the chat's own
 * draft seen from the canvas: the line and the panel's composer hold the same text, so closing
 * the line loses nothing and the panel shows what was typed here.
 *
 * Enter sends and opens the panel, where the turn is read; Escape closes the line and gives the
 * keyboard back to the drawing. What is selected on the drawing rides along, and the line says
 * how many objects that is. Nothing here calls the engine or a model: the shell owns both.
 *
 * Its controls are the system's own: a bare `Field` in the box this surface draws (the palette's
 * box: the elevated surface, the popover's stroke and shadow), a `Chip` for the selection, and the
 * composer's inverted `IconButton` to send.
 */

import { createEffect, Show, type JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { Chip } from "../ui/Chip";
import { Field } from "../ui/Field";
import { IconButton } from "../ui/IconButton";
import "../inline-ask.css";

export interface InlineAskProps {
  open: boolean;
  /** The chat's draft, shared with the panel's composer. */
  draft: string;
  onDraft: (text: string) => void;
  /** How many objects are selected on the drawing. */
  selected: number;
  /** Whether a model is set up; without one, sending opens the panel on its setup. */
  ready: boolean;
  /** Send the draft (the shell opens the panel and starts the turn). */
  onSend: () => void;
  onClose: () => void;
}

/** The most one line takes; a longer message is the panel's composer's to write. */
export const INLINE_ASK_MAX = 2_000;

/** What the field suggests: a jeweler's sentence about what is selected, or about the piece. */
export function inlineAskExample(selected: number): string {
  return selected > 0 ? "Set these in four prongs" : "Draw a size 6 band, 2 mm wide";
}

/** The selection's chip: how many objects the message is about. */
export function selectedLabel(selected: number): string {
  return `${selected.toLocaleString("en-US")} selected`;
}

export function InlineAsk(props: InlineAskProps): JSX.Element {
  let field: HTMLInputElement | undefined;
  // Opened from the keyboard: the keyboard is in the line at once.
  createEffect(() => {
    if (props.open) queueMicrotask(() => field?.focus());
  });
  const empty = (): boolean => props.draft.trim() === "";
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (!empty()) props.onSend();
    } else if (e.key === "Escape") {
      // The line's own Escape: the shell's (cancel a command, clear the selection) is not run.
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    }
  };

  return (
    <Show when={props.open}>
      <div class="inline-ask" role="group" aria-label="Ask the assistant">
        <div class="inline-ask-box">
          <Field
            variant="bare"
            ariaLabel="Ask the assistant about this drawing"
            placeholder={inlineAskExample(props.selected)}
            value={props.draft}
            maxLength={INLINE_ASK_MAX}
            autocomplete="off"
            spellcheck={true}
            ref={(el) => (field = el)}
            onInput={props.onDraft}
            onKeyDown={onKeyDown}
            start={
              <span class="inline-ask-icon">
                <ToolIcon id="assistant" />
              </span>
            }
          />
          <Show when={props.selected > 0}>
            <Chip title="The selection goes with the message">{selectedLabel(props.selected)}</Chip>
          </Show>
          <IconButton
            icon="send"
            size="sm"
            variant="inverted"
            title="Send to the assistant"
            shortcut="Enter"
            description={empty() ? "Type a message first" : props.ready ? undefined : "No model yet: opens the setup"}
            disabled={empty()}
            onClick={props.onSend}
          />
        </div>
      </div>
    </Show>
  );
}
