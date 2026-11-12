// Caption: The typed line: a bare field in a strip, the prompt mark in the start.
import { createSignal } from "solid-js";
import { Field } from "../../../../src/ui/Field";

export default function InCommandLine() {
  const [focused, setFocused] = createSignal(false);
  const [sent, setSent] = createSignal<string[]>([]);
  let input: HTMLInputElement | undefined;
  return (
    <section class="cmdline" aria-label="Command line">
      <div class="cmd-output" role="log" aria-label="Command history">
        {sent().map((line) => (
          <div class="cmd-line">{line}</div>
        ))}
      </div>
      <div class="cmd-entry">
        <div class="cmd-field" classList={{ "is-focused": focused() }}>
          <Field
            variant="bare"
            ref={(el) => {
              input = el;
            }}
            ariaLabel="Command line"
            placeholder="Command:"
            spellcheck={false}
            autocomplete="off"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || input === undefined) return;
              event.preventDefault();
              setSent([...sent(), input.value]);
              input.value = "";
            }}
            start={
              <span class="cmd-caret" aria-hidden="true">
                ›
              </span>
            }
          />
        </div>
      </div>
    </section>
  );
}
