/**
 * The Price Book dialog with its body drawn by Slab (`slab/pricebook.slab`): the same props as
 * `../components/PriceBookDialog`, the same editor (`../pricebook-edit`), the same frame
 * (`../ui/Dialog`: the box, the title bar, the footer's keys, the backdrop, Escape, the focus
 * trap and the focus returning to the opener). Only what stands in the body is Slab's
 * (`./modal` says how a surface is made part of the frame).
 *
 * - **A price** is the kernel's text field, a row of a list: `field_edit` carries every change
 *   to the editor, `field_submit` (Enter) is Save.
 * - **The currency** is the interface's `Field` and **the labor mode** its `Select`, each in a
 *   hole: free text and a native list are better left to the platform, and neither row is in a
 *   list (a hole cannot be).
 * - **The sentence over the form** is the dialog's description, tied to the box by its id: it
 *   stays an element of the page.
 *
 * Mounted by the shell in the place of the SolidJS dialog, after `loadSlab("pricebook")` has
 * defined the element.
 */

import { createEffect, createMemo, on, onCleanup, onMount, type JSX } from "solid-js";
import { CURRENCY_FIELD } from "../bench";
import type { PriceBookDialogProps } from "../components/PriceBookDialog";
import { createPriceBookEdit, LABOR_OPTIONS } from "../pricebook-edit";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Select } from "../ui/Select";
import { isSlabFieldHost, type SlabFieldHost } from "./fields";
import { applyParams, attachModalSurface, isItemKey, ModalHole, type ModalSurface } from "./modal";
import { priceBookParams, priceItem, priceTarget, priceValues, PRICE_LISTS, PRICE_SCALARS, PRICE_SIGNALS } from "./pricebook-params";
import { isSlabHost, signalDetail } from "./types";
import "../dialogs.css";
import "./slab-dialogs.css";

export function SlabPriceBook(props: PriceBookDialogProps): JSX.Element {
  let element: HTMLElement | undefined;
  let currency: HTMLDivElement | undefined;
  let surface: ModalSurface | undefined;
  /** The surface, once the element is the driver's. */
  let mounted: SlabFieldHost | undefined;

  /** Put the keyboard on a field of the form, by its id there. */
  const focusField = (field: string): void => {
    if (field === CURRENCY_FIELD) {
      const input = currency?.querySelector<HTMLElement>("input");
      if (input != null) surface?.focus(input);
      return;
    }
    const item = priceItem(edit.asks(), field);
    if (item !== null) surface?.focus(item);
  };

  const edit = createPriceBookEdit(props, focusField);
  const params = createMemo(() => priceBookParams(edit.asks(), edit.form(), edit.errors(), edit.summary()));

  // Opened, the keyboard goes to the first field, as in the SolidJS dialog (which names it to the
  // frame, under a finger too). After the frame has opened and the body has been solved: until
  // then the frame's own box has the focus, and its title is what a screen reader says first.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open || mounted === undefined) return;
        const first = edit.firstField();
        void mounted.whenSettled().then(() => {
          if (props.open) focusField(first);
        });
      },
      { defer: true },
    ),
  );

  onMount(() => {
    if (element === undefined || !isSlabHost(element) || !isSlabFieldHost(element)) return;
    const host = element;
    mounted = host;
    const modal = attachModalSurface(host, {
      signals: PRICE_SIGNALS,
      values: () => priceValues(params()),
      on: (name, event) => {
        if (name === "field_submit") {
          edit.save();
          return;
        }
        const detail = signalDetail(event);
        const item = detail?.item ?? "";
        const text = detail?.text;
        if (name !== "field_edit" || typeof text !== "string" || !isItemKey(item)) return;
        const target = priceTarget(edit.asks(), edit.form(), item);
        if (target === null) return;
        if (target.kind === "metal") {
          if (edit.form().metals[target.value] !== text) edit.setMetal(target.value, text);
        } else if (target.kind === "stone") {
          if (edit.form().stones[target.value] !== text) edit.setStone(target.value, text);
        } else if (edit.form().laborAmount !== text) edit.setLaborAmount(text);
      },
    });
    surface = modal;
    onCleanup(() => {
      surface = undefined;
      modal.dispose();
    });
    /** The lists as last handed over. */
    const sent = new Map<string, string>();
    createEffect(() => {
      applyParams(host, params(), PRICE_SCALARS, PRICE_LISTS, sent);
      modal.sync();
    });
  });

  return (
    <Dialog
      open={props.open}
      title="Price Book"
      size="md"
      initialFocus={() => null}
      describedBy="price-intro"
      dismissOnBackdrop={edit.untouched()}
      onClose={() => props.onClose()}
      footer={
        <>
          <Button onClick={() => props.onClose()}>Cancel</Button>
          <Button variant="primary" type="submit" onClick={edit.save}>
            Save
          </Button>
        </>
      }
    >
      <div class="jewelry">
        <p class="drafting-help" id="price-intro">
          These are your own prices, not market quotes. The bench sheet totals an estimate from them.
        </p>
        <cadcraft-pricebook ref={element} class="slab-dialog-body">
          <ModalHole name="currency" describedId="price-currency-error" refusal={edit.errors()[CURRENCY_FIELD]}>
            <div ref={currency} class="slab-dialog-control">
              <Field
                ariaLabel="Currency"
                value={edit.form().currency}
                maxLength={8}
                spellcheck={false}
                autocomplete="off"
                selectOnFocus
                invalid={edit.errors()[CURRENCY_FIELD] !== undefined}
                describedBy={edit.errors()[CURRENCY_FIELD] === undefined ? undefined : "price-currency-error"}
                onInput={edit.setCurrency}
              />
            </div>
          </ModalHole>
          <ModalHole name="labor" describedId="price-labor-mode-error" refusal={undefined}>
            <Select ariaLabel="Labor" value={edit.form().laborMode} options={LABOR_OPTIONS} onChange={edit.setLaborMode} />
          </ModalHole>
        </cadcraft-pricebook>
      </div>
    </Dialog>
  );
}
