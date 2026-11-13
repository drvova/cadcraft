/**
 * The "Start from a template" gallery: a grid of preset pieces a jeweler can start from. Each card
 * shows the template's name, a one-line blurb and a 3D thumbnail; choosing one builds that ring.
 *
 * The list and all the logic are `../templates` (the const table, the thumbnail state machine, the
 * refusal words) and `../template-gallery-edit` (the renders, the choice, shared with the gallery
 * the Slab shell draws). This component only draws it: a thumbnail is the engine's
 * own solid (`piecemesh`, read-only — it changes nothing in the drawing) drawn to a small PNG with
 * the 3D stage's own shaders (`renderPieceStill`). Thumbnails are drawn lazily and one at a time
 * (the renderer keeps a single off-screen context), cached once drawn, and a template whose preview
 * the engine cannot make — an older engine, or a kind a newer one adds — shows a drawn ring instead
 * of a blank or a crash.
 *
 * Choosing a card does not call the engine here: the shell's own piece-start handler is reused
 * through `onChoose`, so a template reaches `piece` exactly as the Piece section's starts do. A
 * refusal (a kind this engine does not build) stays on the card in the engine's words and the
 * gallery stays open; a build that goes through closes it.
 *
 * The shell owns `open`; the component is mounted once.
 */

import { For, Show, type JSX } from "solid-js";
import type { Envelope } from "../facade";
import { createTemplateGallery } from "../template-gallery-edit";
import { templateKind } from "../templates";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SectionLabel } from "../ui/SectionLabel";
import "../templates.css";

export interface TemplateGalleryProps {
  /** Whether the gallery is showing. The shell holds it. */
  open: boolean;
  /** The gallery is done: the shell sets `open` false. */
  onClose: () => void;
  /** Run a read-only engine command (the facade's `execute`). Used for `piecemesh` thumbnails. */
  execute: (command: string, params: unknown) => Envelope;
  /**
   * Build the chosen template's piece, reusing the shell's piece-start handler (it removes any
   * current piece, runs `piece`, frames the view and refreshes). Answers null when it went
   * through, else the engine's refusal in its own words.
   */
  onChoose: (params: Record<string, unknown>) => string | null;
}

/** The thumbnail area: the drawn still once it is ready, else a placeholder ring from the tokens. */
function Thumb(props: { kind: string; url: string | null }): JSX.Element {
  return (
    <div class="template-thumb" aria-hidden="true">
      <Show when={props.url} fallback={<PlaceholderRing stoned={props.kind !== "band"} />}>
        {(url) => <img class="template-thumb-img" src={url()} alt="" draggable={false} />}
      </Show>
    </div>
  );
}

/** A plain drawn ring, used until a thumbnail resolves and when one cannot be drawn. */
function PlaceholderRing(props: { stoned: boolean }): JSX.Element {
  return (
    <svg class="template-thumb-svg" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <circle class="template-ring-band" cx="50" cy="56" r="26" />
      <circle class="template-ring-hole" cx="50" cy="56" r="15" />
      <Show when={props.stoned}>
        <path class="template-ring-stone" d="M50 12 L59 23 L50 34 L41 23 Z" />
      </Show>
    </svg>
  );
}

export function TemplateGallery(props: TemplateGalleryProps): JSX.Element {
  const { groups, thumbs, choose, note } = createTemplateGallery(props);

  return (
    <Dialog
      open={props.open}
      title="Start from a template"
      size="lg"
      describedBy="template-gallery-intro"
      onClose={() => props.onClose()}
      footer={(done) => (
        <Button variant="quiet" onClick={done}>
          Close
        </Button>
      )}
    >
      <p id="template-gallery-intro" class="template-gallery-intro">
        Pick a starting point; it builds the ring, and you can tune every number after in the Piece section.
      </p>
      <For each={groups}>
        {(group) => (
          <section class="template-group">
            <SectionLabel>{group.label}</SectionLabel>
            <ul class="template-grid" role="list">
              <For each={group.templates}>
                {(template) => (
                  <li class="template-card" classList={{ "is-failed": note(template) !== null }}>
                    <Thumb kind={templateKind(template)} url={thumbs()[template.id]?.url ?? null} />
                    <div class="template-card-body">
                      <strong class="template-name">{template.name}</strong>
                      <p class="template-blurb">{template.blurb}</p>
                      <Show when={note(template)}>
                        {(message) => <p class="template-note">{message()}</p>}
                      </Show>
                    </div>
                    <div class="template-card-foot">
                      <Button size="sm" ariaLabel={`Start from the ${template.name} template`} onClick={() => choose(template)}>
                        Use this template
                      </Button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </Dialog>
  );
}
