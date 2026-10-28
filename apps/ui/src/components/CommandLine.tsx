/**
 * The command line: the engine's prompt as the input's placeholder (so a two-step command shows
 * "Specify center point for circle:" then "Specify radius of circle:"), Enter submits through
 * `cmdline()`, Escape clears, and the output tail sits above in a scrollback. Pure flex column.
 */

import { createEffect, type Accessor, type JSX } from "solid-js";
import { For, Show } from "solid-js";
import { keywordHint, promptText, type PromptState } from "../prompt";

export interface CommandLineProps {
  prompt: Accessor<PromptState>;
  notice: Accessor<string | null>;
  onSubmit: (text: string) => void;
}

export function CommandLine(props: CommandLineProps): JSX.Element {
  let input: HTMLInputElement | undefined;
  let scrollback: HTMLDivElement | undefined;

  // Follow the tail as output arrives.
  createEffect(() => {
    props.prompt().output.length;
    if (scrollback !== undefined) scrollback.scrollTop = scrollback.scrollHeight;
  });

  const submit = (): void => {
    if (input === undefined) return;
    const text = input.value;
    input.value = "";
    props.onSubmit(text);
    input.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (input !== undefined) {
        input.value = "";
        input.focus();
      }
    }
  };

  return (
    <footer class="cmdline">
      <Show when={props.prompt().output.length > 0}>
        <div class="cmd-output" ref={scrollback} aria-live="polite">
          <For each={props.prompt().output}>{(line) => <div class="cmd-line">{line}</div>}</For>
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
          placeholder={promptText(props.prompt())}
          aria-label="Command line"
          onKeyDown={onKeyDown}
        />
        <Show when={keywordHint(props.prompt())}>
          {(hint) => <span class="cmd-keywords">{hint()}</span>}
        </Show>
        <Show when={props.prompt().error ?? props.notice()}>
          {(error) => <span class="cmd-error">{error()}</span>}
        </Show>
      </div>
    </footer>
  );
}
