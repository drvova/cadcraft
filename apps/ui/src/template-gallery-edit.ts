/**
 * The state of the "Start from a template" gallery (`./components/TemplateGallery`): the
 * thumbnails as they are drawn, the refusals left on the cards, and the choice. The list and the
 * rules are `./templates`'s; this file holds the signals and the order things are done in, so the
 * component only draws.
 *
 * A thumbnail is the engine's own solid (`piecemesh`, read-only: it changes nothing in the
 * drawing) drawn to a small PNG with the 3D stage's own shaders (`renderPieceStill`). They are
 * drawn lazily while the gallery is open and one at a time (the renderer keeps a single
 * off-screen context), cached once drawn, and a template whose preview cannot be made keeps its
 * placeholder and says why. Each drawn still is held as a blob URL (an `<img>`'s source).
 *
 * Choosing a card does not call the engine here: the shell's piece-start handler is reused
 * through `onChoose`. A refusal stays on the card in the engine's words and the gallery stays
 * open; a build that goes through closes it.
 */

import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import type { Envelope } from "./facade";
import { renderPieceStill } from "./render3d";
import { chooseMessage, groupTemplates, initialThumbs, markDone, markFailed, markRendering, nextThumb, templateParams, thumbMessage, THUMB_HEIGHT, THUMB_WIDTH, TEMPLATES, type Template, type TemplateGroup, type ThumbMap } from "./templates";
import { parseMeshReply } from "./view3d";

/** What the gallery is given by the shell. */
export interface TemplateGalleryEditProps {
  open: boolean;
  onClose: () => void;
  execute: (command: string, params: unknown) => Envelope;
  onChoose: (params: Record<string, unknown>) => string | null;
}

export interface TemplateGalleryEdit {
  groups: readonly TemplateGroup[];
  thumbs: Accessor<ThumbMap>;
  /** Build the template; close on success, else leave its refusal on the card. */
  choose: (template: Template) => void;
  /** The note under a card: a build refusal first, else a thumbnail that could not be drawn. */
  note: (template: Template) => string | null;
}

/** One still: its blob URL, or the words to show when it cannot be drawn. */
type Drawn = { url: string } | { message: string };

/** Draws one template's still. Swapped in tests, where there is no WebGL. */
export type StillDrawer = (template: Template, execute: TemplateGalleryEditProps["execute"]) => Promise<Drawn>;

export const drawStill: StillDrawer = async (template, execute) => {
  const env = execute("piecemesh", { ...template.params, quality: "draft" });
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

export function createTemplateGallery(props: TemplateGalleryEditProps, draw: StillDrawer = drawStill): TemplateGalleryEdit {
  const [thumbs, setThumbs] = createSignal<ThumbMap>(initialThumbs(TEMPLATES));
  const [chooseErrors, setChooseErrors] = createSignal<Readonly<Record<string, string>>>({});
  /** True while one thumbnail render is in flight, so only one runs at a time. */
  let busy = false;

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
    void draw(template, props.execute).then((result) => {
      busy = false;
      if ("url" in result) {
        setThumbs((current) => markDone(current, id, result.url));
      } else setThumbs((current) => markFailed(current, id, result.message));
    });
  });

  // The blob URLs the thumbnails hold are released when the gallery leaves the page.
  onCleanup(() => {
    for (const thumb of Object.values(untrack(thumbs))) {
      if (thumb.url !== null) URL.revokeObjectURL(thumb.url);
    }
  });

  const choose = (template: Template): void => {
    const error = props.onChoose(templateParams(template));
    if (error === null) {
      props.onClose();
      return;
    }
    setChooseErrors((errors) => ({ ...errors, [template.id]: chooseMessage(template, error) }));
  };

  const note = (template: Template): string | null => {
    const chosen = chooseErrors()[template.id];
    if (chosen !== undefined) return chosen;
    const thumb = thumbs()[template.id];
    return thumb?.phase === "failed" ? thumb.message : null;
  };

  return { groups: groupTemplates(TEMPLATES), thumbs, choose, note };
}
