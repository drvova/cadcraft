/**
 * Dynamic input: the command line brought to the crosshair. While a command asks for something,
 * this box stands beside the pointer, says what is asked in a quiet line, and takes the answer
 * there: X and Y for a first point, a distance and an angle for a next one, one field for a
 * number, one for a keyword. A field with nothing typed shows the pointer's own value (as its
 * placeholder, in the quieter ink, so the value is never written into what is being typed); a
 * typed field is locked, shows a padlock, and holds the rubber band to its value. Tab goes from
 * field to field, a comma goes on to Y, `<` to the angle, Enter sends the line, Escape drops
 * what was typed, and the Down arrow lists the prompt's options.
 *
 * The rules are in ../dynamic.ts. This component holds the draft (what is typed, which field is
 * active) and nothing of the command line's: what is typed here is the command line's input, so
 * every edit is written into the command line's own field (`echo`) and every line is sent
 * through it (`submit`), exactly as Enter there or a keyword's chip does. The command line keeps
 * its history and the engine's echo as before; with the command line folded away nothing is
 * typed here, and the shell opens it as it always has.
 *
 * The canvas owns where the box is and whether it shows (`handle.root`, by a transform and an
 * attribute, once a frame), tells it where the pointer is (`aim`), and hands it the keys pressed
 * on the drawing (`key`). The box takes nothing from the pointer, so the drawing under it is
 * still drawn on; only the list of options, while it is open, can be pressed, and the box stays
 * where it is until the list closes.
 *
 * For a screen reader the box is a group named "Dynamic input", described by the prompt; each
 * field has its name ("Distance", "Angle", "X", "Y", "Radius"). Nothing here is a live region:
 * the values that follow the pointer are placeholders, and are not announced as it moves. The
 * options are a listbox the active field drives while it is open, as the command palette's is.
 */

import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show, untrack, type Accessor, type JSX } from "solid-js";
import { draftFor, dynamicLabel, echoFor, editDraft, fieldCount, fieldNames, hasTyped, isLocked, lineFor, liveValues, routeKey, type Aim, type Draft } from "../dynamic";
import { ToolIcon } from "../icons";
import type { PromptState } from "../prompt";
import { Field } from "../ui/Field";
import { Kbd } from "../ui/Kbd";
import { Row } from "../ui/Row";
import { commandLineLink } from "./CommandLine";

/** What the canvas does with the box. */
export interface DynamicHandle {
  /** The box: the canvas places it by a transform and hides it with `data-off`. */
  root: HTMLDivElement;
  /** What is typed now. */
  draft: () => Draft;
  /** Where the pointer is, as the engine resolved it; null when it is not on the drawing. */
  aim: (aim: Aim | null) => void;
  /** A key pressed on the drawing itself: true when dynamic input took it. */
  key: (event: KeyboardEvent) => boolean;
  /** Send what is typed, with the pointer where it is. False when nothing was sent. */
  submit: () => boolean;
  /** The box must stay in sight: something is typed, the keyboard is in it, or its options are open. */
  busy: () => boolean;
  /** The options are open: the box stays where it is, so the list can be reached. */
  held: () => boolean;
}

export interface DynamicInputProps {
  /** The running command's prompt. */
  state: Accessor<PromptState>;
  /** The draft changed (a field was typed in, emptied, or the kind of entry changed). */
  onDraft: () => void;
  /** The keyboard goes back to the drawing (a line was sent, the typed text was dropped). */
  onRest: () => void;
  handle: (handle: DynamicHandle) => void;
}

const SLOTS = [0, 1] as const;

export function DynamicInput(props: DynamicInputProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  const inputs: (HTMLInputElement | undefined)[] = [undefined, undefined];
  const labelId = createUniqueId();
  const listId = createUniqueId();
  const fresh = createMemo(() => draftFor(props.state()));
  const [draft, setDraft] = createSignal<Draft>(untrack(fresh));
  const [live, setLive] = createSignal<readonly [string, string]>(["", ""]);
  const [open, setOpen] = createSignal(false);
  const [option, setOption] = createSignal(0);
  /** The field a line could not be made for (a half-typed point with no pointer to read). */
  const [refused, setRefused] = createSignal<number | null>(null);
  let aim: Aim | null = null;

  const keywords = (): readonly string[] => props.state().keywords;
  const names = createMemo(() => fieldNames(draft().kind, props.state()));
  const count = (): number => fieldCount(draft().kind);

  const showLive = (): void => {
    const next = liveValues(draft(), aim);
    const now = live();
    if (next[0] !== now[0] || next[1] !== now[1]) setLive(next);
  };

  /** Take a new draft: the fields, the command line's own field, and the canvas all follow it. */
  const change = (next: Draft, echo = true): void => {
    setRefused(null);
    setDraft(next);
    showLive();
    if (echo) commandLineLink()?.echo(echoFor(next));
    props.onDraft();
  };

  // A new prompt starts with nothing typed. The prompt is a new one when what it asks, what it
  // measures from or what it offers has changed; a drafting toggle pressed while a value is
  // typed (F8, F12) changes none of these and keeps the value.
  const asked = createMemo(() => {
    const state = props.state();
    const base = state.anchor.base;
    return [state.running ?? "", state.prompt, fresh().kind, base === null ? "" : `${base.x},${base.y}`, state.keywords.join("/")].join("\u0000");
  });
  createEffect(
    on(
      asked,
      () => {
        setOpen(false);
        setRefused(null);
        setDraft(fresh());
        showLive();
        props.onDraft();
      },
      { defer: true },
    ),
  );

  const focusField = (index: number): void => {
    const el = inputs[index];
    if (el !== undefined && document.activeElement !== el) el.focus({ preventScroll: true });
  };

  const submit = (): boolean => {
    const link = commandLineLink();
    if (link === null) return false;
    const now = draft();
    const line = lineFor(now, aim);
    if (line === null) {
      setRefused(isLocked(now, 0) ? 1 : 0);
      return false;
    }
    if (line === "") return false;
    setOpen(false);
    props.onRest();
    change(fresh(), false);
    link.submit(line);
    return true;
  };

  /** Choose an option: its keyword is sent exactly as its chip on the command line sends it. */
  const choose = (keyword: string): void => {
    const link = commandLineLink();
    if (link === null) return;
    setOpen(false);
    props.onRest();
    change(fresh(), false);
    link.submit(keyword);
  };

  const used = (event: KeyboardEvent): true => {
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  /** A key while the options are open: the arrows walk them, Enter or Space takes one, Escape closes. */
  const listKey = (event: KeyboardEvent): boolean | null => {
    const all = keywords();
    const last = all.length - 1;
    switch (event.key) {
      case "ArrowDown":
        setOption((i) => (i >= last ? 0 : i + 1));
        return used(event);
      case "ArrowUp":
        setOption((i) => (i <= 0 ? last : i - 1));
        return used(event);
      case "Home":
        setOption(0);
        return used(event);
      case "End":
        setOption(last);
        return used(event);
      case "Enter":
      case " ": {
        const keyword = all[option()];
        if (keyword !== undefined) choose(keyword);
        return used(event);
      }
      case "Escape":
        setOpen(false);
        return used(event);
      default:
        // Any other key closes the list and is then read as it would have been without it.
        if (event.key.length === 1 || event.key === "Tab" || event.key === "Backspace") setOpen(false);
        return null;
    }
  };

  /**
   * A key, pressed in a field or on the drawing (`onDrawing`). True when it was dynamic input's;
   * the shell is then kept from it. A character that types is left to the field's own editing:
   * pressed on the drawing, the keyboard moves into the active field during the key, so the
   * character lands there, as typing on the drawing lands in the command line with dynamic
   * input off.
   */
  const key = (event: KeyboardEvent, onDrawing: boolean): boolean => {
    if (event.isComposing || event.ctrlKey || event.metaKey || (event.altKey && !event.getModifierState("AltGraph"))) return false;
    if (root === undefined || commandLineLink() === null) return false;
    // Out of sight (no pointer on the drawing yet), the command line takes the typing, as before.
    if (onDrawing && "off" in root.dataset) return false;
    if (open()) {
      const taken = listKey(event);
      if (taken !== null) return taken;
    }
    const now = draft();
    const action = routeKey(now, event.key, event.shiftKey, fresh());
    switch (action.kind) {
      case "pass":
        return false;
      case "type":
        if (onDrawing) {
          focusField(now.active);
          event.stopPropagation();
        }
        return true;
      case "draft":
        change(action.draft);
        focusField(action.draft.active);
        return used(event);
      case "submit":
        submit();
        return used(event);
      case "clear":
        props.onRest();
        change(fresh());
        return used(event);
      case "options":
        if (keywords().length === 0 || count() === 0) return false;
        focusField(now.active);
        setOption(0);
        setOpen(true);
        return used(event);
    }
  };

  /** The keyboard left the drawing with something typed: the command line keeps the text, the fields let go of it. */
  const onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    if (root === undefined || !document.hasFocus()) return;
    if (to instanceof Node && (root.parentElement ?? root).contains(to)) return;
    setOpen(false);
    if (hasTyped(draft()) || draft().kind !== fresh().kind) change(fresh(), false);
  };

  const mark = (index: number): string => {
    const now = draft();
    if (index === 0) return now.kind === "point" || now.kind === "polar" ? now.prefix : "";
    return now.kind === "polar" ? "<" : "";
  };

  const slot = (index: 0 | 1): JSX.Element => {
    const combo = (): boolean => open() && draft().active === index;
    return (
      <>
        <span
          class="canvas-dyn-field"
          hidden={index >= count()}
          data-active={draft().active === index ? "" : undefined}
          data-locked={isLocked(draft(), index) ? "" : undefined}
          data-invalid={refused() === index ? "" : undefined}
          data-kind={draft().kind}
        >
          <span class="canvas-dyn-mark" aria-hidden="true" hidden={mark(index) === ""}>
            {mark(index)}
          </span>
          <span class="canvas-dyn-lock" aria-hidden="true">
            <ToolIcon id="layer.locked" />
          </span>
          <Field
            variant="bare"
            size="sm"
            align={draft().kind === "text" ? "start" : "end"}
            ariaLabel={names()[index] ?? "Value"}
            value={draft().text[index]}
            placeholder={live()[index]}
            invalid={refused() === index}
            inputMode={draft().kind === "text" ? "text" : "decimal"}
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            selectOnFocus
            role={combo() ? "combobox" : undefined}
            expanded={combo() ? true : undefined}
            controls={combo() ? listId : undefined}
            activeDescendant={combo() ? `${listId}-${option()}` : undefined}
            autocompleteKind={combo() ? "none" : undefined}
            ref={(el) => {
              inputs[index] = el;
            }}
            onFocus={() => {
              if (draft().active !== index) change({ ...draft(), active: index });
            }}
            onInput={(text) => change(editDraft({ ...draft(), active: index }, text))}
            onKeyDown={(event) => key(event, false)}
          />
        </span>
      </>
    );
  };

  return (
    <div
      class="canvas-dyn"
      role="group"
      aria-label="Dynamic input"
      aria-describedby={labelId}
      data-off=""
      onFocusOut={onFocusOut}
      ref={(el) => {
        root = el;
        props.handle({
          root: el,
          draft,
          aim: (next) => {
            aim = next;
            showLive();
          },
          key: (event) => key(event, true),
          submit,
          busy: () => open() || hasTyped(draft()) || el.contains(document.activeElement),
          held: open,
        });
      }}
    >
      <div class="canvas-dyn-prompt">
        <span id={labelId}>{dynamicLabel(props.state())}</span>
        <Show when={keywords().length > 0 && count() > 0}>
          <span class="canvas-dyn-more">
            Options <Kbd>↓</Kbd>
          </span>
        </Show>
      </div>
      <div class="canvas-dyn-fields" hidden={count() === 0}>
        <For each={SLOTS}>{(index) => slot(index)}</For>
      </div>
      <div class="canvas-dyn-options" role="listbox" id={listId} aria-label="Options" hidden={!open()}>
        <For each={keywords()}>{(keyword, index) => (
          <Row option id={`${listId}-${index()}`} selected={index() === option()} onPointerMove={() => setOption(index())} onClick={() => choose(keyword)}>
            {keyword}
          </Row>
        )}</For>
      </div>
    </div>
  );
}
