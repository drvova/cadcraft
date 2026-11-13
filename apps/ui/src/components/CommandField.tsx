/**
 * The command line's typed line: the one field every command is typed into (`./CommandLine`),
 * with its keys and its history, in a file of its own.
 *
 * The typed line is the system's `Field`, bare: the strip around it (`.cmd-field`) draws the
 * edge, the fill and the focus, and sets the mono face the field takes; the prompt mark is the
 * field's `start` adornment, so it stands in a gutter of its own and the typed text starts after
 * it, on the panel's column. The engine's prompt is the field's placeholder. The field is not
 * given a value: the history writes the element's own, so nothing is assigned back while an input
 * method is composing.
 *
 * Enter submits through the shell, Escape clears typed text (and on an empty field goes on to the
 * shell, which cancels the running command), Up/Down walk the submitted lines (most recent first,
 * typing resets the walk).
 */

import { createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import { commandHistory } from "../command-history";
import { Field } from "../ui/Field";

export { MAX_HISTORY } from "../command-history";

/** Read a prop that may be a value or an accessor (the panels' props take either form). */
export function readProp<T>(value: T | Accessor<T>): T {
  return typeof value === "function" ? (value as Accessor<T>)() : value;
}

/**
 * What the drawing's dynamic input (`CanvasView`) needs of the command line on screen. What is
 * typed beside the pointer is the same input, so it goes through this field and no other way:
 * `echo` writes the typed part into the field as it is typed, and `submit` sends a line exactly
 * as Enter here, or a keyword's chip, does (remembered for the arrows, echoed to the history, the
 * field cleared), leaving the keyboard where it is.
 */
export interface CommandLineLink {
  echo: (text: string) => void;
  submit: (text: string) => void;
}

/** The command line on screen; the window has one at most. */
let mounted: CommandLineLink | null = null;

/** The command line on screen, or null while it is folded away. */
export function commandLineLink(): CommandLineLink | null {
  return mounted;
}

export interface CommandFieldProps {
  /** The engine's prompt, shown while the field is empty. */
  placeholder: string;
  /** A command is running: the prompt mark takes the accent. */
  running: boolean;
  onSubmit: (text: string) => void;
  /**
   * Handed, once, the way a keyword's chip submits: as Enter does, with the keyboard brought to
   * the field.
   */
  submitter?: (submit: (text: string) => void) => void;
  /** A key of the panel that draws the field, seen before the field's own; true when it took it. */
  onPanelKey?: (event: KeyboardEvent) => boolean;
}

export function CommandField(props: CommandFieldProps): JSX.Element {
  let input: HTMLInputElement | undefined;
  const history = commandHistory();
  /** The strip shows the field's focus (the field is bare and draws no ring of its own). */
  const [focused, setFocused] = createSignal(false);

  // The shell finds the field by this name (F6, Ctrl+J, typing from the drawing: `.cmd-input` in
  // `app.tsx`). It is a hook only, added once the field has written its own classes: no rule
  // styles it.
  onMount(() => input?.classList.add("cmd-input"));

  /**
   * Submit a line: remembered for the arrows, cleared from the input, sent to the shell. The
   * keyboard comes to the field, unless the line was typed on the drawing (`focus` false).
   */
  const submit = (text: string, focus = true): void => {
    history.remember(text);
    if (input !== undefined) {
      input.value = "";
      if (focus) input.focus();
    }
    props.onSubmit(text);
  };
  props.submitter?.((text) => submit(text));

  // The drawing's dynamic input types into this command line while it is on screen.
  const link: CommandLineLink = {
    echo: (text) => {
      history.reset();
      if (input !== undefined && input.value !== text) input.value = text;
    },
    submit: (text) => submit(text, false),
  };
  onMount(() => {
    mounted = link;
  });
  onCleanup(() => {
    if (mounted === link) mounted = null;
  });

  /** Move the walk: +1 is older (Up), -1 is newer (Down); beyond either end the input stays. */
  const recall = (direction: number): void => {
    if (input === undefined) return;
    const line = history.recall(direction);
    if (line === null) return;
    input.value = line;
    const end = input.value.length;
    input.setSelectionRange(end, end);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (props.onPanelKey?.(e) === true) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submit(input?.value ?? "");
    } else if (e.key === "Escape") {
      // Typed text is what Escape takes first: the field is cleared and the key stops here. On
      // an empty field the key is the shell's, which cancels the running command.
      history.reset();
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

  return (
    <div class="cmd-field" classList={{ "is-focused": focused() }}>
      <Field
        variant="bare"
        ref={(el) => {
          input = el;
        }}
        spellcheck={false}
        autocomplete="off"
        placeholder={props.placeholder}
        ariaLabel="Command line"
        onKeyDown={onKeyDown}
        onInput={() => history.reset()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        start={
          <span class={props.running ? "cmd-caret is-running" : "cmd-caret"} aria-hidden="true">
            ›
          </span>
        }
      />
    </div>
  );
}
