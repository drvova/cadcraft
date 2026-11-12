/**
 * Dialog — a task that takes the window until it is finished or put away: a titled box over the
 * page holding fields, with its actions in a footer. A native `<dialog>` opened with
 * `showModal()`, so the focus trap, Escape, the inert page behind it and the top layer are the
 * platform's, never rebuilt by hand. The recipe lives in `./ui.css`.
 *
 * The caller owns `open`. The dialog only asks to be closed, through `onClose` with the reason:
 * `escape` (the key), `backdrop` (a press and release outside the box), `close` (the title bar's
 * key) or `action` (a footer action that finished: the footer's `done`). A caller that leaves
 * `open` true keeps the dialog up.
 *
 * Focus goes, on opening, to `initialFocus`, else to the first field of the body, and never to the
 * close key: a dialog whose first Enter or Space closes it has lost the task. With no field (a
 * question with two buttons), or under a coarse pointer (where focusing a text field raises the
 * on-screen keyboard over the sheet before anything was read), the dialog itself takes it, and
 * its title is what a screen reader says. On closing, the focus returns to what had it.
 *
 * The body and the footer are one `<form>`. A footer button with `type="submit"` is the primary
 * action, and Enter in a single-line field presses it: that is the platform's implicit
 * submission, so a key an input method is using never does it and a primary action that is
 * `aria-disabled` refuses it like any click. Nothing is submitted anywhere.
 *
 * Escape closes unless something inside used the key first (`preventDefault` on its `keydown`: a
 * field that gives its old value back).
 */

import { createMemo, createRenderEffect, onCleanup, Show, type JSX } from "solid-js";
import { IconButton } from "./IconButton";

/** The box's width: `sm` a question or one field (about 360px), `md` a form (about 520px), `lg` a
 *  form with a table or two columns (about 720px). Each is capped to the window. */
export type DialogSize = "sm" | "md" | "lg";

/** Why the dialog asks to be closed. */
export type DialogCloseReason = "escape" | "backdrop" | "close" | "action";

/** Where the focus goes on opening: a selector inside the dialog, an element, or a function that returns one. */
export type DialogInitialFocus = string | HTMLElement | (() => HTMLElement | null | undefined);

export interface DialogProps {
  /** Whether the dialog is showing. The caller holds it and answers `onClose` by setting it false. */
  open: boolean;
  /** The dialog asks to be closed, and says why. Cancel and a finished action are the caller's own buttons. */
  onClose: (reason: DialogCloseReason) => void;
  /** The title bar's text and the dialog's accessible name. */
  title: string;
  /** The box's width. Defaults to `md`. */
  size?: DialogSize;
  /** The `id` of a line inside the dialog that says what it is for (several, space-separated): sets `aria-describedby`. */
  describedBy?: string;
  /** Where the focus goes on opening. Defaults to the first field of the body, never the close key. */
  initialFocus?: DialogInitialFocus;
  /** The actions, drawn in a bar under the body: the layer's `Button`s, the primary one `type="submit"`.
   *  Pass a function to be handed `done`, which asks to close with the reason `action`. */
  footer?: JSX.Element | ((done: () => void) => JSX.Element);
  /** Whether a press outside the box asks to close. Defaults to true; pass false where closing would lose work. */
  dismissOnBackdrop?: boolean;
  /** The body: it scrolls when it is taller than the window allows, under a title bar and a footer that stay. */
  children?: JSX.Element;
}

/** The controls a person types or picks in: the body's first one takes the focus. */
const FIELDS = "input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled])";

/** Every dialog's title has its own `id` for `aria-labelledby`: a count, so it is the same in every build. */
let titles = 0;

export function Dialog(props: DialogProps): JSX.Element {
  titles += 1;
  const titleId = `ui-dialog-title-${titles}`;
  let dialog: HTMLDialogElement | undefined;
  let body: HTMLDivElement | undefined;
  /** What had the focus when the dialog opened: it gets it back. */
  let opener: Element | null = null;
  /** A press that began outside the box: only its own release there asks to close. */
  let pressedOutside = false;
  /** Escape went down and something inside used it. */
  let escapeUsed = false;

  const outside = (event: MouseEvent): boolean => {
    if (dialog === undefined || event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };

  const focusFirst = (): void => {
    if (dialog === undefined) return;
    const want = props.initialFocus;
    let target: HTMLElement | null | undefined;
    if (typeof want === "string") target = dialog.querySelector<HTMLElement>(want);
    else if (typeof want === "function") target = want();
    else if (want !== undefined) target = want;
    else if (typeof matchMedia !== "function" || !matchMedia("(pointer: coarse)").matches) {
      // The first field that is showing: a panel behind (a `hidden` ancestor) holds fields too.
      target = Array.from(body?.querySelectorAll<HTMLElement>(FIELDS) ?? []).find((field) => field.closest("[hidden]") === null);
    }
    (target ?? dialog).focus();
  };

  const show = (): void => {
    if (dialog === undefined || dialog.open) return;
    opener = document.activeElement;
    dialog.showModal();
    if (body !== undefined) body.scrollTop = 0;
    focusFirst();
  };

  const hide = (): void => {
    if (dialog === undefined) return;
    if (dialog.open) dialog.close();
    const back = opener;
    opener = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  };

  /** Make the dialog what the caller says, once everything else this turn has settled. Opening
   *  waits for that on purpose: the caller's own effects (a form read afresh, the page it opens
   *  on) run first, so the field that takes the focus is the one that will be showing. */
  const settle = (): void => queueMicrotask(() => (props.open ? show() : hide()));

  /** Ask the caller to close, then follow its answer. */
  const ask = (reason: DialogCloseReason): void => {
    props.onClose(reason);
    settle();
  };

  onCleanup(() => {
    if (dialog?.open === true) dialog.close();
  });

  const done = (): void => ask("action");
  const footer = createMemo((): JSX.Element => {
    const slot = props.footer;
    return typeof slot === "function" ? slot(done) : slot;
  });

  return (
    <dialog
      ref={(el: HTMLDialogElement) => {
        dialog = el;
        // Closing is at once; opening settles (above), by which time the element is in the page.
        createRenderEffect(() => (props.open ? settle() : hide()));
      }}
      class={`ui-dialog ui-dialog--${props.size ?? "md"}`}
      aria-labelledby={titleId}
      aria-describedby={props.describedBy}
      tabIndex={-1}
      onKeyDown={(event) => {
        // The key reaches here after everything inside heard it.
        if (event.key === "Escape") escapeUsed = event.defaultPrevented;
      }}
      onCancel={(event) => {
        // The caller owns `open`: the platform never closes the dialog by itself.
        event.preventDefault();
        const used = escapeUsed;
        escapeUsed = false;
        if (!used) ask("escape");
      }}
      onClose={() => {
        // The platform may close a dialog without asking (a second Escape in a row). The caller is
        // told; one that keeps `open` true gets its dialog back.
        if (props.open) ask("escape");
      }}
      onPointerDown={(event) => {
        pressedOutside = outside(event);
      }}
      onClick={(event) => {
        const was = pressedOutside;
        pressedOutside = false;
        if (was && outside(event) && props.dismissOnBackdrop !== false) ask("backdrop");
      }}
    >
      {/* Plain boxes, not <header> and <footer>: inside a dialog those are announced as the page's
          own banner and footer landmarks. */}
      <div class="ui-dialog-head">
        <h2 class="ui-dialog-title" id={titleId}>
          {props.title}
        </h2>
        <IconButton icon="close" title="Close" onClick={() => ask("close")} />
      </div>
      <form class="ui-dialog-form" novalidate onSubmit={(event) => event.preventDefault()}>
        <div class="ui-dialog-body" ref={(el: HTMLDivElement) => (body = el)}>
          {props.children}
        </div>
        <Show when={footer()}>
          <div class="ui-dialog-foot">{footer()}</div>
        </Show>
      </form>
    </dialog>
  );
}
