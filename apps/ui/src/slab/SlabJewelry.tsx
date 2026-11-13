/**
 * The Ring and Gem dialogs with their bodies drawn by Slab (`slab/jewelry-dialog.slab`, one
 * document for both): the same props as `../components/JewelryDialog`, the same state
 * (`../jewelry-edit`), the same frame (`../ui/Dialog`: the box, the title bar, the footer's keys,
 * the backdrop, Escape, the focus trap and the focus returning to the opener). Only what stands
 * in the body is Slab's (`./modal` says how a surface is made part of the frame).
 *
 * - **A measure** (the size, the wall, a position) is the kernel's text field, a row of a list:
 *   `field_edit` carries every change to the form, `field_submit` (Enter) is OK.
 * - **A choice from a list** (the size system, the metal, the cut, the stone) is the interface's
 *   `Select` in a hole: a native list, with the platform's keyboard, type-ahead and picker. No
 *   popup is built here.
 *
 * Mounted by the shell in the place of the SolidJS dialogs, after `loadSlab("jewelry-dialog")`
 * has defined the element.
 */

import { createEffect, createMemo, on, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import type { JewelryDialogProps } from "../components/JewelryDialog";
import { RING_SYSTEMS, type GemField, type RingField } from "../jewelry-dialog";
import { createGemEdit, createRingEdit } from "../jewelry-edit";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Select } from "../ui/Select";
import { isSlabFieldHost, type SlabFieldHost } from "./fields";
import { gemParams, gemTyped, jewelryValues, ringParams, ringTyped, JEWELRY_LISTS, JEWELRY_SCALARS, JEWELRY_SIGNALS, type JewelryParams } from "./jewelry-params";
import { applyParams, attachModalSurface, isItemKey, ModalHole, type ModalSurface } from "./modal";
import { isSlabHost, signalDetail } from "./types";
import "../dialogs.css";
import "./slab-dialogs.css";

/** The footer both dialogs share: Cancel, then the action. */
function Actions(props: { onCancel: () => void; onOk: () => void }): JSX.Element {
  return (
    <>
      <Button onClick={() => props.onCancel()}>Cancel</Button>
      <Button variant="primary" type="submit" onClick={() => props.onOk()}>
        OK
      </Button>
    </>
  );
}

/** What a body is given by its dialog. */
interface BodyWiring {
  params: Accessor<JewelryParams>;
  /** A typed row changed: its key and its text. */
  typed: (item: string, text: string) => void;
  /** Enter in a field. */
  submit: () => void;
}

/** The mounted body: where the keyboard can be put. */
interface Body {
  surface: ModalSurface;
  host: SlabFieldHost;
}

/** Wire a mounted `<cadcraft-jewelry-dialog>` to its dialog. Run inside `onMount`. */
function mountBody(element: HTMLElement | undefined, wiring: BodyWiring): Body | null {
  if (element === undefined || !isSlabHost(element) || !isSlabFieldHost(element)) return null;
  const host = element;
  const surface = attachModalSurface(host, {
    signals: JEWELRY_SIGNALS,
    values: () => jewelryValues(wiring.params()),
    on: (name, event) => {
      if (name === "field_submit") {
        wiring.submit();
        return;
      }
      const detail = signalDetail(event);
      const item = detail?.item ?? "";
      const text = detail?.text;
      if (name === "field_edit" && typeof text === "string" && isItemKey(item)) wiring.typed(item, text);
    },
  });
  onCleanup(() => surface.dispose());
  /** The lists as last handed over. */
  const sent = new Map<string, string>();
  createEffect(() => {
    applyParams(host, wiring.params(), JEWELRY_SCALARS, JEWELRY_LISTS, sent);
    surface.sync();
  });
  return { surface, host };
}

/** The control mounted in a hole's wrapper. */
const controlIn = (wrapper: HTMLElement | undefined): HTMLElement | null => wrapper?.querySelector<HTMLElement>("select") ?? null;

export function SlabRing(props: JewelryDialogProps): JSX.Element {
  let element: HTMLElement | undefined;
  let system: HTMLDivElement | undefined;
  let metal: HTMLDivElement | undefined;
  let body: Body | null = null;

  /** Put the keyboard on a field of the form: a typed row, or the list in a hole. */
  const focusField = (field: RingField): void => {
    if (body === null) return;
    const picked = field === "system" ? controlIn(system) : field === "metal" ? controlIn(metal) : null;
    if (picked !== null) body.surface.focus(picked);
    else if (ringTyped(field) !== null) body.surface.focus(field);
  };

  const edit = createRingEdit(props, focusField);
  const params = createMemo(() => ringParams(edit.form(), { errors: edit.errors(), sizeError: edit.sizeError(), summary: edit.summary(), facts: edit.facts() }));

  // Opened, the keyboard goes to the size, as in the SolidJS dialog (which names it to the frame,
  // under a finger too). After the frame has opened and the body has been solved: until then the
  // frame's own box has the focus, and its title is what a screen reader says first.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open || body === null) return;
        void body.host.whenSettled().then(() => {
          if (props.open) focusField("size");
        });
      },
      { defer: true },
    ),
  );

  onMount(() => {
    body = mountBody(element, {
      params,
      submit: edit.apply,
      typed: (item, text) => {
        const field = ringTyped(item);
        if (field !== null && edit.form()[field] !== text) edit.edit({ [field]: text }, field);
      },
    });
  });

  return (
    <Dialog open={props.open} title="Ring" size="md" initialFocus={() => null} dismissOnBackdrop={edit.untouched()} onClose={() => props.onClose()} footer={<Actions onCancel={() => props.onClose()} onOk={edit.apply} />}>
      <cadcraft-jewelry-dialog ref={element} class="slab-dialog-body">
        <ModalHole name="first" describedId="ring-system-error" refusal={edit.errors().system}>
          <div ref={system} class="slab-dialog-control">
            <Select
              ariaLabel="Size system"
              value={edit.form().system}
              options={RING_SYSTEMS}
              invalid={edit.errors().system !== undefined}
              describedBy={edit.errors().system === undefined ? undefined : "ring-system-error"}
              onChange={(value) => edit.edit({ system: value }, "system", "size")}
            />
          </div>
        </ModalHole>
        <ModalHole name="metal" describedId="ring-metal-error" refusal={edit.errors().metal}>
          <div ref={metal} class="slab-dialog-control">
            <Select
              ariaLabel="Metal"
              value={edit.form().metal}
              options={edit.choices().metals}
              invalid={edit.errors().metal !== undefined}
              describedBy={edit.errors().metal === undefined ? undefined : "ring-metal-error"}
              onChange={(value) => edit.edit({ metal: value }, "metal")}
            />
          </div>
        </ModalHole>
      </cadcraft-jewelry-dialog>
    </Dialog>
  );
}

export function SlabGem(props: JewelryDialogProps): JSX.Element {
  let element: HTMLElement | undefined;
  let cut: HTMLDivElement | undefined;
  let stone: HTMLDivElement | undefined;
  let body: Body | null = null;

  const focusField = (field: GemField): void => {
    if (body === null) return;
    const picked = field === "cut" ? controlIn(cut) : field === "stone" ? controlIn(stone) : null;
    if (picked !== null) body.surface.focus(picked);
    else if (gemTyped(field, edit.elongated()) !== null) body.surface.focus(field);
  };

  const edit = createGemEdit(props, focusField);
  const params = createMemo(() => gemParams(edit.form(), { errors: edit.errors(), summary: edit.summary(), note: edit.choices().note, elongated: edit.elongated(), facts: edit.facts() }));

  // Opened, the keyboard goes to the stone's first measure, as in the SolidJS dialog.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open || body === null) return;
        void body.host.whenSettled().then(() => {
          if (props.open) focusField(edit.elongated() ? "length" : "diameter");
        });
      },
      { defer: true },
    ),
  );

  onMount(() => {
    body = mountBody(element, {
      params,
      submit: edit.apply,
      typed: (item, text) => {
        const field = gemTyped(item, edit.elongated());
        if (field !== null && edit.form()[field] !== text) edit.edit({ [field]: text }, field);
      },
    });
  });

  return (
    <Dialog open={props.open} title="Gem" size="md" initialFocus={() => null} dismissOnBackdrop={edit.untouched()} onClose={() => props.onClose()} footer={<Actions onCancel={() => props.onClose()} onOk={edit.apply} />}>
      <cadcraft-jewelry-dialog ref={element} class="slab-dialog-body">
        <ModalHole name="first" describedId="gem-cut-error" refusal={edit.errors().cut}>
          <div ref={cut} class="slab-dialog-control">
            <Select
              ariaLabel="Cut"
              value={edit.form().cut}
              options={edit.choices().cuts}
              invalid={edit.errors().cut !== undefined}
              describedBy={edit.errors().cut === undefined ? undefined : "gem-cut-error"}
              onChange={(value) => edit.edit({ cut: value }, "cut")}
            />
          </div>
        </ModalHole>
        <ModalHole name="stone" describedId="gem-stone-error" refusal={edit.errors().stone}>
          <div ref={stone} class="slab-dialog-control">
            <Select
              ariaLabel="Stone"
              value={edit.form().stone}
              options={edit.choices().stones}
              invalid={edit.errors().stone !== undefined}
              describedBy={edit.errors().stone === undefined ? undefined : "gem-stone-error"}
              onChange={(value) => edit.edit({ stone: value }, "stone")}
            />
          </div>
        </ModalHole>
      </cadcraft-jewelry-dialog>
    </Dialog>
  );
}
