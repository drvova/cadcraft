/**
 * The recovery bar: one quiet band over the drawing that offers back the unsaved work an earlier
 * tab left (`../autosave`), and says, once, when a recovery copy could not be kept. It is never a
 * dialog: the app under it stays usable, and nothing is restored or thrown away until the person
 * presses the key that says so.
 *
 * Several drawings' copies are offered one at a time, newest first, with the number still
 * waiting beside the sentence: Restore replaces the drawing in front, so each is its own
 * decision, and one line stays one line at 390 wide.
 *
 * `createRecovery` is the shell's one seam: it builds the autosave controller on the browser's
 * storage, clock and timers, wires the page's own moments (a hidden tab, a page going away, the
 * leave-this-page question), and hands back what the shell calls and the bar's props.
 */

import { createEffect, createSignal, on, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { attachToPage, createAutosave, indexedDbStore, newSession, offerParts, PRIVACY_NOTE, sessionLocks, waitingWords, WORDS, type Autosave, type DocState, type Offer, type OpenReply } from "../autosave";
import { downloadBytes, recoveredFileName } from "../files";
import { Button } from "../ui/Button";
import "../recovery.css";

export interface RecoveryBarProps {
  /** What earlier tabs left, newest first; the first is the one shown. */
  offers: Accessor<readonly Offer[]>;
  /** One line to tell the person (a copy that could not be kept, what an action came to). */
  notice: Accessor<string | null>;
  /** The time the sentence counts from ("12 minutes ago"). */
  now: Accessor<number>;
  onRestore: (offer: Offer) => void;
  onCopy: (offer: Offer) => void;
  onDiscard: (offer: Offer) => void;
  onDismiss: () => void;
}

export function RecoveryBar(props: RecoveryBarProps): JSX.Element {
  /** The offer whose Discard was pressed once: the bar asks before it throws anything away. */
  const [asking, setAsking] = createSignal<string | null>(null);
  let bar: HTMLElement | undefined;
  /** Whether the focus was last seen on one of the bar's keys. */
  let held = false;
  // A key that was pressed is often gone a moment later (the offer was settled, the question
  // opened): the focus then moves to the bar's last key rather than falling to the page.
  createEffect(
    on([props.notice, props.offers, asking], () => {
      queueMicrotask(() => {
        // Only a focus that fell to the page is moved: one the person put elsewhere is theirs.
        const active = document.activeElement;
        if (!held || bar === undefined || (active !== null && active !== document.body)) return;
        const keys = bar.querySelectorAll<HTMLElement>("button");
        keys[keys.length - 1]?.focus();
      });
    }),
  );
  return (
    <Show when={props.notice() !== null || props.offers().length > 0}>
      <section class="recovery" aria-label="Drawing recovery" ref={bar} onFocusIn={() => (held = true)} onFocusOut={(event) => (held = event.relatedTarget === null || (bar?.contains(event.relatedTarget as Node) ?? false))}>
        <Show when={props.notice()}>
          {(text) => (
            <div class="recovery-row">
              <p class="recovery-text" role="status">
                {text()}
              </p>
              <div class="recovery-actions">
                <Button size="sm" variant="quiet" onClick={() => props.onDismiss()}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </Show>
        <Show when={props.offers()[0]} keyed>
          {(offer) => {
            const parts = (): { before: string; name: string; after: string } => offerParts(offer, props.now());
            return (
              <div class="recovery-row">
                <Show
                  when={asking() === offer.key}
                  fallback={
                    <p class="recovery-text" role="status">
                      <span class="recovery-sentence">
                        {parts().before}
                        <span class="recovery-name">{parts().name}</span>
                        {parts().after}
                      </span>{" "}
                      <span class="recovery-note">
                        {waitingWords(props.offers().length)} {PRIVACY_NOTE}
                      </span>
                    </p>
                  }
                >
                  <p class="recovery-text" role="status">
                    <span class="recovery-sentence">
                      Discard the recovery copy of <span class="recovery-name">{parts().name}</span>?
                    </span>{" "}
                    <span class="recovery-note">It cannot be brought back.</span>
                  </p>
                </Show>
                <div class="recovery-actions">
                  <Show
                    when={asking() === offer.key}
                    fallback={
                      <>
                        <Button size="sm" variant="quiet" title="Remove this recovery copy" onClick={() => setAsking(offer.key)}>
                          Discard
                        </Button>
                        <Button size="sm" variant="ghost" title="Download it without opening it" onClick={() => props.onCopy(offer)}>
                          Save a copy…
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!offer.restorable}
                          title={offer.restorable ? "Open it in place of this drawing" : "Made by another version of CADCraft. Save a copy instead."}
                          onClick={() => props.onRestore(offer)}
                        >
                          Restore
                        </Button>
                      </>
                    }
                  >
                    <Button size="sm" variant="danger" onClick={() => (setAsking(null), props.onDiscard(offer))}>
                      Discard
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                      Keep
                    </Button>
                  </Show>
                </div>
              </div>
            );
          }}
        </Show>
      </section>
    </Show>
  );
}

/** The part of the facade recovery uses: how the shell saves and opens today, and nothing more. */
export interface RecoveryFacade {
  saveBytes(): Uint8Array | null;
  openBytes(name: string, bytes: Uint8Array): OpenReply;
  drawingState(): DocState | null;
}

export interface Recovery {
  /** After anything that may have changed the drawing (the shell's `refresh`). */
  noteChange(state: DocState | null): void;
  /** Before the drawing in front is replaced (New, Open, the sample): keep what is unsaved. */
  flush(): void;
  /** After the person saved the drawing themselves. */
  markSaved(): void;
  /** The bar's props: `<RecoveryBar {...recovery.bar} />`. */
  bar: RecoveryBarProps;
  /** The controller itself (the browser checks read its measurements). */
  autosave: Autosave;
}

/** How often the bar's "12 minutes ago" is counted again. */
const CLOCK_TICK_MS = 30_000;
/** The longest the page waits for idle time before it writes a slow drawing out anyway. */
const IDLE_TIMEOUT_MS = 2_000;

/** A browser object that may be missing, or may throw when read (storage in a locked-down page). */
function reach<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Build recovery for the shell. Call it in the app component's body: it starts on mount (reads
 * what earlier tabs left, holds this tab's lock, listens for the page going away) and stops on
 * cleanup. `afterRestore` is the shell's own refresh once a restore has replaced the drawing.
 */
export function createRecovery(options: { facade: RecoveryFacade; afterRestore: () => void }): Recovery {
  const [offers, setOffers] = createSignal<readonly Offer[]>([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const session = newSession(reach(() => globalThis.crypto), Date.now());
  const locks = sessionLocks(reach(() => globalThis.navigator?.locks));
  const autosave = createAutosave({
    store: indexedDbStore(reach(() => globalThis.indexedDB)),
    now: () => Date.now(),
    elapsed: () => performance.now(),
    after: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    idle: (fn) => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
      else fn();
    },
    session,
    liveSessions: locks.live,
    serialise: () => options.facade.saveBytes(),
    state: () => options.facade.drawingState(),
    report: setNotice,
  });

  /** One action at a time: a second press while the store is answering does nothing. */
  let busy = false;
  const act = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
  };
  const settle = (offer: Offer): void => {
    setOffers(offers().filter((o) => o.key !== offer.key));
  };

  onMount(() => {
    locks.hold(session);
    const detach = attachToPage(autosave, window);
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    void autosave.start().then((found) => {
      setNow(Date.now());
      setOffers(found);
    });
    onCleanup(() => {
      detach();
      clearInterval(tick);
      autosave.dispose();
    });
  });

  return {
    noteChange: (state) => autosave.noteChange(state),
    flush: () => autosave.flush(),
    markSaved: () => {
      autosave.markSaved();
      // "It is unsaved" and "save it to keep your changes" are no longer true.
      setNotice(null);
    },
    autosave,
    bar: {
      offers,
      notice,
      now,
      onDismiss: () => setNotice(null),
      onRestore: (offer) =>
        void act(async () => {
          // What is open now may be unsaved too: it gets its own copy before it is replaced.
          autosave.flush();
          // Under the drawing's own name, so it keeps it. The engine reads the bytes by what they
          // are; should a name's ending ever mislead it, the same bytes are tried once as a .dxf.
          const result = await autosave.restore(offer, (name, bytes) => {
            const reply = options.facade.openBytes(name, bytes);
            return reply.ok ? reply : options.facade.openBytes(`${name}.dxf`, bytes);
          });
          if (result.ok) options.afterRestore();
          if (result.settled) settle(offer);
          setNotice(result.message);
        }),
      onCopy: (offer) =>
        void act(async () => {
          const result = await autosave.copy(offer);
          if (result.file === null) {
            setNotice(result.message);
            return;
          }
          const file = recoveredFileName(result.file.name);
          downloadBytes(file, result.file.bytes);
          setNotice(WORDS.copied(file));
        }),
      onDiscard: (offer) =>
        void act(async () => {
          const result = await autosave.discard(offer);
          if (result.settled) settle(offer);
          setNotice(result.ok ? null : result.message);
        }),
    },
  };
}
