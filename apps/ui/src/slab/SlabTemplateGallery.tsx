/**
 * The "Start from a template" gallery with its cards drawn by Slab (`slab/template-gallery.slab`):
 * the same props as `../components/TemplateGallery`, the same state (`../template-gallery-edit`:
 * the stills, the choice, the refusals), the same frame (`../ui/Dialog`). Only the cards are
 * Slab's (`./modal` says how a surface is made part of the frame).
 *
 * - **The stills** are the PNGs the 3D stage drew, the very bytes the SolidJS gallery shows as
 *   `<img>`s, registered with the surface as runtime images (`imgRegister`, by the size the PNG
 *   says it has) as each is drawn. A card shows the drawn ring until its still is registered.
 * - **The grid** is laid out here: as many columns as the body holds (`galleryColumns`, as the
 *   CSS grid's `auto-fill`), the still 3 high for 4 wide at that width.
 * - **The words that say what the gallery is** stand over the surface in the page, where the
 *   dialog's `aria-describedby` reaches them.
 * - **The keyboard**: every card's key is a Tab stop in reading order, Enter and Space press it,
 *   the arrows do nothing (`arrows`), as the SolidJS buttons.
 *
 * Mounted by the shell in the place of the SolidJS gallery, after `loadSlab("template-gallery")`
 * has defined the element.
 */

import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { TemplateGalleryProps } from "../components/TemplateGallery";
import { createTemplateGallery } from "../template-gallery-edit";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { isSlabFieldHost } from "./fields";
import { applyParams, attachModalSurface } from "./modal";
import { galleryColumns, galleryParams, GALLERY_LISTS, GALLERY_SCALARS, GALLERY_SIGNALS, pngSize, templateOfItem, thumbHeight, thumbName } from "./template-gallery-params";
import { isSlabHost, signalDetail } from "./types";
import "../templates.css";
import "./slab-dialogs.css";

/** The driver's runtime images (Slab §13.7): PNG is format 0. */
interface SlabImageHost {
  imgRegister(name: string, width: number, height: number, format: number, bytes: Uint8Array): number;
  imgUnregister(name: string): boolean;
}

const hasImages = (el: object): el is SlabImageHost => "imgRegister" in el && typeof el.imgRegister === "function" && "imgUnregister" in el && typeof el.imgUnregister === "function";

export function SlabTemplateGallery(props: TemplateGalleryProps): JSX.Element {
  let element: HTMLElement | undefined;
  const gallery = createTemplateGallery(props);
  const [width, setWidth] = createSignal(0);
  const [windowWidth, setWindowWidth] = createSignal(typeof window === "undefined" ? 1280 : window.innerWidth);
  /** The templates whose stills the surface holds. */
  const [registered, setRegistered] = createSignal<ReadonlySet<string>>(new Set());

  const columns = createMemo(() => galleryColumns(width(), windowWidth()));
  const params = createMemo(() => galleryParams({ groups: gallery.groups, thumbs: gallery.thumbs(), registered: registered(), note: gallery.note, columns: columns(), thumbH: thumbHeight(width(), columns()) }));

  onMount(() => {
    if (element === undefined || !isSlabHost(element) || !isSlabFieldHost(element)) return;
    const host = element;

    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      const across = host.getBoundingClientRect().width;
      if (across > 0) setWidth(across);
      setWindowWidth(window.innerWidth);
    });
    sizes?.observe(host);
    onCleanup(() => sizes?.disconnect());

    // Each still as it is drawn, once.
    if (hasImages(host)) {
      const images = host;
      createEffect(() => {
        const bytes = gallery.bytes();
        const held = registered();
        const added = new Set(held);
        for (const [id, png] of Object.entries(bytes)) {
          if (held.has(id)) continue;
          const size = pngSize(png);
          if (size !== null && images.imgRegister(thumbName(id), size.width, size.height, 0, png) >= 0) added.add(id);
        }
        if (added.size !== held.size) setRegistered(added);
      });
      onCleanup(() => {
        for (const id of registered()) images.imgUnregister(thumbName(id));
      });
    }

    const modal = attachModalSurface(host, {
      signals: GALLERY_SIGNALS,
      values: () => new Map(),
      // The cards' keys answer the arrows as the page's buttons do: not at all.
      arrows: () => false,
      on: (name, event) => {
        if (name !== "use") return;
        const template = templateOfItem(gallery.groups, signalDetail(event)?.item ?? "");
        if (template !== null) gallery.choose(template);
      },
    });
    onCleanup(() => modal.dispose());
    const sent = new Map<string, string>();
    createEffect(() => {
      applyParams(host, params(), GALLERY_SCALARS, GALLERY_LISTS, sent);
    });
  });

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
      <cadcraft-template-gallery ref={element} class="slab-dialog-body" />
    </Dialog>
  );
}
