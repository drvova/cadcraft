/**
 * The command line: the engine's prompt as the input's placeholder (so a two-step command shows
 * "Specify center point for circle:" then "Specify radius of circle:"), Enter submits through the
 * shell, Escape clears typed text (and on an empty field goes on to the shell, which cancels the
 * running command), Up/Down walk the submitted lines (most recent first, typing resets the
 * walk), and the prompt's keywords render as clickable chips that submit the keyword. The output
 * tail sits above in a scrollback. Pure flex column.
 *
 * For a screen reader the panel is a named region. The scrollback is a log that is in the page
 * before its first line (a live region that arrives with its text is not read), so each new line
 * is announced; the prompt, which a sighted user reads as the placeholder, is repeated in a status
 * line that is not drawn, so a change of prompt is announced too; and an error shown beside the
 * field is an alert. A long error wraps to two lines and is then cut; it takes the focus (Tab, a
 * click) and shows its whole text while it has it; one cut by its width is the system's hint too.
 *
 * The props accept the value or the accessor form (Solid passes an attribute expression through
 * as written, so a parent may hand either); the component reads both.
 */

import { createEffect, For, Show, type Accessor, type JSX } from "solid-js";
import { promptText, type PromptState } from "../prompt";
import { Chip } from "../ui/Chip";

export interface CommandLineProps {
  prompt: PromptState | Accessor<PromptState>;
  notice: string | null | Accessor<string | null>;
  onSubmit: (text: string) => void;
}

/** How many submitted lines the Up/Down walk keeps. */
export const MAX_HISTORY = 200;

/** Read a prop that may be a value or an accessor. */
function read<T>(value: T | Accessor<T>): T {
  return typeof value === "function" ? (value as Accessor<T>)() : value;
}

export function CommandLine(props: CommandLineProps): JSX.Element {
  let input: HTMLInputElement | undefined;
  let scrollback: HTMLDivElement | undefined;
  /** Submitted lines, most recent first; `walk` is the position the arrows are on (-1: none). */
  const history: string[] = [];
  let walk = -1;

  const state = (): PromptState => read(props.prompt);

  // Follow the tail as output arrives.
  createEffect(() => {
    state().output.length;
    if (scrollback !== undefined) scrollback.scrollTop = scrollback.scrollHeight;
  });

  /** Submit a line: remembered for the arrows, cleared from the input, sent to the shell. */
  const submit = (text: string): void => {
    if (text.trim() !== "" && history[0] !== text) {
      history.unshift(text);
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    }
    walk = -1;
    if (input !== undefined) {
      input.value = "";
      input.focus();
    }
    props.onSubmit(text);
  };

  /** Move the walk: +1 is older (Up), -1 is newer (Down); beyond either end the input stays. */
  const recall = (direction: number): void => {
    if (input === undefined || history.length === 0) return;
    const next = walk + direction;
    if (next < -1 || next >= history.length) return;
    walk = next;
    input.value = walk === -1 ? "" : (history[walk] ?? "");
    const end = input.value.length;
    input.setSelectionRange(end, end);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(input?.value ?? "");
    } else if (e.key === "Escape") {
      // Typed text is what Escape takes first: the field is cleared and the key stops here. On
      // an empty field the key is the shell's, which cancels the running command.
      walk = -1;
      if (input !== undefined && input.value !== "") {
        e.preventDefault();
        e.stopPropagation();
        input.value = "";
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      recall(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      recall(-1);
    }
  };

  /** The error to show beside the field: none when the history's last line already says it. */
  const freshError = (): string | null => {
    const error = state().error ?? read(props.notice);
    if (error === null || error === undefined || error === "") return null;
    const last = (state().output[state().output.length - 1] ?? "").trim();
    return last !== "" && (last === error.trim() || last.includes(error.trim())) ? null : error;
  };

  return (
    <section class="cmdline" aria-label="Command line">
      <div class="cmd-output" ref={scrollback} role="log" aria-label="Command history">
        <For each={state().output}>{(line) => <div class="cmd-line">{line}</div>}</For>
      </div>
      <div class="cmd-status" role="status">
        {promptText(state())}
      </div>
      <Show when={state().keywords.length > 0}>
        <div class="cmd-chips" role="group" aria-label="Keywords">
          <For each={state().keywords}>{(keyword) => (
            <Chip tone="accent" onClick={() => submit(keyword)}>
              {keyword}
            </Chip>
          )}</For>
        </div>
      </Show>
      <div class="cmd-entry">
        <span class="cmd-caret" aria-hidden="true">
          ›
        </span>
        <input
          ref={input}
          class="cmd-input"
          type="text"
          spellcheck={false}
          autocomplete="off"
          placeholder={promptText(state())}
          aria-label="Command line"
          onKeyDown={onKeyDown}
          onInput={() => {
            walk = -1;
          }}
        />
        <Show when={freshError()}>
          {(error) => (
            <span class="cmd-error" role="alert" data-hint="" tabindex="0">
              {error()}
            </span>
          )}
        </Show>
      </div>
    </section>
  );
}
