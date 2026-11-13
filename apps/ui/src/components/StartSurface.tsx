import { For, type JSX } from "solid-js";
import { Button } from "../ui/Button";
import { PIECE_KINDS } from "../piece";

/**
 * The quiet invitation over an empty drawing: start a piece, pick a template, open a file or ask
 * the assistant. Every button is an existing command; the shell hides the surface as soon as the
 * drawing has content (or a command runs), so it never sits over work.
 */
export function StartSurface(props: {
  onPiece: (kind: string) => void;
  onTemplates: () => void;
  onOpen: () => void;
  onAsk: () => void;
}): JSX.Element {
  return (
    <div class="start-surface">
      <section class="start-card" aria-labelledby="start-title">
        <h2 class="start-title" id="start-title">
          Start a piece
        </h2>
        <p class="start-lede">A ring drawn to size, with its stones counted and weighed.</p>
        <div class="start-kinds" role="group" aria-labelledby="start-title">
          <For each={PIECE_KINDS}>
            {(kind) => (
              <Button size="sm" ariaLabel={`Start a ${kind.label.toLowerCase()}`} onClick={() => props.onPiece(kind.value)}>
                {kind.label}
              </Button>
            )}
          </For>
        </div>
        <div class="start-more">
          <Button variant="quiet" size="sm" onClick={() => props.onTemplates()}>
            Templates…
          </Button>
          <Button variant="quiet" size="sm" onClick={() => props.onOpen()}>
            Open a file…
          </Button>
          <Button variant="quiet" size="sm" onClick={() => props.onAsk()}>
            Ask the assistant
          </Button>
        </div>
      </section>
    </div>
  );
}
