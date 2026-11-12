/**
 * The "Start from a template" gallery: a grid of preset pieces a jeweler can start from. Each card
 * shows the template's name, a one-line blurb and a 3D thumbnail; choosing one builds that ring.
 *
 * The list and all the logic are `../templates` (the const table, the thumbnail state machine, the
 * refusal words). This component only draws it and runs the renders: a thumbnail is the engine's
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

import { createEffect, createSignal, For, onCleanup, Show, untrack, type JSX } from "solid-js";
import type { Envelope } from "../facade";
import { renderPieceStill } from "../render3d";
import {
  chooseMessage,
  groupTemplates,
  initialThumbs,
  markDone,
  markFailed,
  markRendering,
  nextThumb,
  templateKind,
  templateParams,
  thumbMessage,
  THUMB_HEIGHT,
  THUMB_WIDTH,
  TEMPLATES,
  type Template,
  type ThumbMap,
} from "../templates";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SectionLabel } from "../ui/SectionLabel";
import { parseMeshReply } from "../view3d";
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
  const [thumbs, setThumbs] = createSignal<ThumbMap>(initialThumbs(TEMPLATES));
  /** The engine's refusal on a card, keyed by template id, after the reader chose it. */
  const [chooseErrors, setChooseErrors] = createSignal<Readonly<Record<string, string>>>({});
  /** True while one thumbnail render is in flight, so only one runs at a time. */
  let busy = false;

  const groups = groupTemplates(TEMPLATES);

  /** One template's thumbnail: its solid as a PNG, or the words to show when it cannot be drawn. */
  const renderOne = async (template: Template): Promise<{ url: string } | { message: string }> => {
    const env = props.execute("piecemesh", { ...template.params, quality: "draft" });
    if (!env.ok) return { message: thumbMessage(template, env.error) };
    const reply = parseMeshReply(env.result);
    if (!reply.ok) return { message: reply.error };
    try {
      const blob = await renderPieceStill(reply.mesh, { view: "three-quarter", width: THUMB_WIDTH, height: THUMB_HEIGHT, background: null });
      return { url: URL.createObjectURL(blob) };
    } catch {
      return { message: "The preview could not be drawn." };
    }
  };

  // While the gallery is open, draw the thumbnails lazily and one at a time: each render marks its
  // template `rendering` (so nothing else starts), and on finishing advances to the next idle one.
  createEffect(() => {
    if (!props.open) return;
    const id = nextThumb(thumbs(), TEMPLATES);
    if (id === null || busy) return;
    const template = TEMPLATES.find((t) => t.id === id);
    if (template === undefined) return;
    busy = true;
    setThumbs((current) => markRendering(current, id));
    void renderOne(template).then((result) => {
      busy = false;
      setThumbs((current) => ("url" in result ? markDone(current, id, result.url) : markFailed(current, id, result.message)));
    });
  });

  // The blob URLs the thumbnails hold are released when the gallery leaves the page.
  onCleanup(() => {
    for (const thumb of Object.values(untrack(thumbs))) {
      if (thumb.url !== null) URL.revokeObjectURL(thumb.url);
    }
  });

  /** Build the template; close on success, else leave its refusal on the card. */
  const choose = (template: Template): void => {
    const error = props.onChoose(templateParams(template));
    if (error === null) {
      props.onClose();
      return;
    }
    setChooseErrors((errors) => ({ ...errors, [template.id]: chooseMessage(template, error) }));
  };

  /** The note under a card: a build refusal first, else a thumbnail that could not be drawn. */
  const note = (template: Template): string | null => {
    const chosen = chooseErrors()[template.id];
    if (chosen !== undefined) return chosen;
    const thumb = thumbs()[template.id];
    return thumb?.phase === "failed" ? thumb.message : null;
  };

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
