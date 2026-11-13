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
 * The typed line, its keys and its history are `./CommandField`.
 *
 * The props accept the value or the accessor form (Solid passes an attribute expression through
 * as written, so a parent may hand either); the component reads both.
 */

import { createEffect, createSignal, For, Show, type Accessor, type JSX } from "solid-js";
import { freshError, promptText, type PromptState } from "../prompt";
import { Chip } from "../ui/Chip";
import { IconButton } from "../ui/IconButton";
import { CommandField, readProp } from "./CommandField";

export { commandLineLink, MAX_HISTORY, type CommandLineLink } from "./CommandField";

export interface CommandLineProps {
  prompt: PromptState | Accessor<PromptState>;
  notice: string | null | Accessor<string | null>;
  onSubmit: (text: string) => void;
}

export function CommandLine(props: CommandLineProps): JSX.Element {
  let scrollback: HTMLDivElement | undefined;
  /** How a keyword's chip submits: the field's own way (`CommandField`). */
  let submit: (text: string) => void = () => undefined;

  const state = (): PromptState => readProp(props.prompt);

  // Follow the tail as output arrives.
  createEffect(() => {
    state().output.length;
    if (scrollback !== undefined) scrollback.scrollTop = scrollback.scrollHeight;
  });

  return (
    <section class="cmdline" aria-label="Command line">
      <div class="cmd-output" ref={scrollback} role="log" aria-label="Command history">
        <For each={state().output}>{(line, i) => (isData(line) ? <DataLine line={line} id={`cmd-data-${i()}`} /> : <div class="cmd-line">{line}</div>)}</For>
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
        <CommandField
          placeholder={promptText(state())}
          running={state().running !== null}
          onSubmit={(text) => props.onSubmit(text)}
          submitter={(run) => {
            submit = run;
          }}
        />
        <Show when={freshError(state(), readProp(props.notice))}>
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

/**
 * A command's JSON answer in the log. Every one is cut to two lines on screen, the newest too (a
 * long record buried the commands typed); the document keeps every character, so a copy or a
 * screen reader has the whole answer. When the answer carries a `message` it is drawn above the
 * record as the line's words, hidden from assistive tech and from a selection because the record
 * says it already. A long answer has a fold key that shows the record whole and cuts it again.
 */
function DataLine(props: { line: string; id: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const message = (): string | null => dataMessage(props.line);
  return (
    <div class={open() ? "cmd-line is-data is-open" : "cmd-line is-data"}>
      <Show when={message()}>
        {(words) => (
          <div class="cmd-data-message" aria-hidden="true">
            {words()}
          </div>
        )}
      </Show>
      <div class="cmd-data-row">
        <div class="cmd-data-text" id={props.id}>
          {props.line}
        </div>
        <Show when={props.line.length > DATA_FOLD_AT}>
          <IconButton icon="chevron-down" size="sm" title={open() ? "Cut the reply to two lines" : "Show the whole reply"} expanded={open()} controls={props.id} onClick={() => setOpen(!open())} />
        </Show>
      </div>
    </div>
  );
}

/** How long a JSON answer is before it gets a fold key (about two lines of the log at its narrowest). */
export const DATA_FOLD_AT = 120;

/** The answer's own `message`, on one line and clipped, when the line is a JSON record with one; else null. */
export function dataMessage(line: string): string | null {
  if (line.length > 200_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = (value as Record<string, unknown>)["message"];
  if (typeof message !== "string") return null;
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
}

/** A line that is a command's JSON answer rather than words: drawn quieter than the words around it. */
export function isData(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}
