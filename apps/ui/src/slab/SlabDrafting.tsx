/**
 * The Drafting Settings dialog with its body drawn by Slab (`slab/drafting.slab`): the same props
 * as `../components/DraftingSettings`, the same state (`../drafting-edit`), the same frame
 * (`../ui/Dialog`). Only what stands in the body is Slab's (`./modal` says how a surface is made
 * part of the frame, and what the keyboard does in one).
 *
 * - **The tabs** are the kernel's: the strip is one Tab stop (the tab in front), and Left, Right,
 *   Home and End bring the next page to the front with the keyboard on its tab.
 * - **A tick** is the kernel's: Space or a press ticks it, Enter is OK.
 * - **A typed value** is the kernel's text field: `field_edit` carries every change to the form,
 *   `field_submit` (Enter) is OK.
 * - **The increment angle** opens its values as a popup the host draws (`./popup`), mounted in
 *   the frame: the page behind a modal dialog is inert, and so would a popup of the page be.
 *
 * - **One height for every page.** The SolidJS dialog stacks its three pages in one cell, so the
 *   box is as tall as its tallest page whichever is in front, and does not move when the page
 *   changes. A surface is as tall as what it solved, so a second, unseen and inert surface solves
 *   the tallest page (Object Snap) at the same width with the same alert, and the body is never
 *   shorter than it (`min-height`).
 *
 * Mounted by the shell in the place of the SolidJS dialog, after `loadSlab("drafting")` has
 * defined the element.
 */

import { createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import type { DraftingSettingsProps } from "../components/DraftingSettings";
import { OSNAP_ALL, type DraftingField } from "../drafting";
import { createDraftingEdit } from "../drafting-edit";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { ANGLE_OPTIONS, draftingParams, draftingSkips, draftingValues, DRAFTING_LISTS, DRAFTING_SCALARS, DRAFTING_SIGNALS, isDraftingTab, lineOfField, modeBit, POLAR_CHOICE_LINE, tabAfter, tickField, TWO_COLUMNS_FROM, typedField } from "./drafting-params";
import { isSlabFieldHost, type SlabFieldHost } from "./fields";
import { applyParams, attachModalSurface, isItemKey, itemOfKey, type ModalSurface } from "./modal";
import { isReopen, returnFocus, sceneBoxInWindow, SlabPopup, type OpenPopup, type PopupDismiss } from "./popup";
import { isSlabHost, signalDetail } from "./types";
import "../dialogs.css";
import "./slab-dialogs.css";

/** The combobox of the increment angle's line, in a scene. */
const choiceNode = (scene: readonly { key: string }[]): string | null => scene.find((node) => node.key.endsWith("#choice") && itemOfKey(node.key) === POLAR_CHOICE_LINE)?.key ?? null;

export function SlabDrafting(props: DraftingSettingsProps): JSX.Element {
  let element: HTMLElement | undefined;
  let surface: ModalSurface | undefined;
  let mounted: SlabFieldHost | undefined;
  let twin: HTMLElement | undefined;
  /** The height of the tallest page at this width, from the unseen surface; 0 until it is known. */
  const [tallest, setTallest] = createSignal(0);
  const [popup, setPopup] = createSignal<OpenPopup | null>(null);
  const [two, setTwo] = createSignal(true);
  /** When a press outside the popup closed it: that press, on the combobox, is not a new opening. */
  let closedAt: number | null = null;

  /** Put the keyboard on the line a field of the form is shown on (its page is in front by now). */
  const focusField = (field: DraftingField): void => {
    const line = lineOfField(field, edit.form());
    if (line !== null) surface?.focus(line);
    else surface?.focus(`mode-1`);
  };

  const edit = createDraftingEdit(props, focusField);
  const params = createMemo(() => draftingParams({ tab: edit.tab(), form: edit.form(), errors: edit.errors(), state: edit.state(), choiceOpen: popup() !== null, summary: edit.summary(), two: two() }));

  // Opened, the keyboard goes to the page's first control. Closed, an open popup goes with it.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) {
          setPopup(null);
          return;
        }
        if (mounted === undefined) return;
        void mounted.whenSettled().then(() => {
          if (props.open) surface?.focus(params().lines.find((line) => line.tick || line.typed || line.wide || line.choice)?.key);
        });
      },
      { defer: true },
    ),
  );

  const closePopup = (reason: PopupDismiss | "pick", byKey: boolean): void => {
    if (popup() === null) return;
    setPopup(null);
    closedAt = reason === "outside" ? performance.now() : null;
    const host = mounted;
    if (host === undefined || reason === "outside" || reason === "away") return;
    returnFocus(host, () => choiceNode(host.sceneSnapshot()), byKey);
  };

  onMount(() => {
    if (element === undefined || !isSlabHost(element) || !isSlabFieldHost(element)) return;
    const host = element;
    mounted = host;

    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      const width = host.getBoundingClientRect().width;
      if (width > 0) setTwo(width >= TWO_COLUMNS_FROM);
    });
    sizes?.observe(host);
    onCleanup(() => sizes?.disconnect());

    const openChoice = (): void => {
      setPopup({
        label: "Increment angle",
        options: ANGLE_OPTIONS,
        held: edit.form().polarChoice,
        anchor: () => {
          const key = choiceNode(host.sceneSnapshot());
          const part = host.sceneSnapshot().find((node) => node.key === key);
          return part === undefined ? null : sceneBoxInWindow(host, part);
        },
      });
    };

    const modal = attachModalSurface(host, {
      signals: DRAFTING_SIGNALS,
      values: () => draftingValues(params()),
      skip: (key) => draftingSkips(key, itemOfKey(key), edit.tab()),
      // The arrows are the strip's alone (its mapped keys); nowhere do they walk the kernel's ring.
      arrows: (key) => /#tabs\//.test(key),
      on: (name, event) => {
        const item = signalDetail(event)?.item ?? "";
        switch (name) {
          case "field_submit":
          case "line_submit":
            edit.apply();
            return;
          case "tab_pick":
            if (isDraftingTab(item)) edit.setTab(item);
            return;
          case "tab_prev":
          case "tab_next":
          case "tab_first":
          case "tab_last": {
            const next = tabAfter(edit.tab(), name);
            edit.setTab(next);
            modal.focus(next);
            return;
          }
          case "line_tick": {
            const field = tickField(item);
            if (field !== null) edit.edit({ [field]: !edit.form()[field] }, field);
            return;
          }
          case "line_choose":
            if (item !== POLAR_CHOICE_LINE) return;
            if (popup() !== null) closePopup("escape", false);
            else if (!isReopen(closedAt, performance.now())) openChoice();
            return;
          case "field_edit": {
            const text = signalDetail(event)?.text;
            const field = isItemKey(item) ? typedField(item) : null;
            if (field !== null && typeof text === "string" && edit.form()[field.form] !== text) edit.edit({ [field.form]: text }, field.marks);
            return;
          }
          case "mode_tick": {
            const bit = modeBit(item);
            if (bit !== null) edit.edit({ modes: edit.form().modes ^ bit }, "modes");
            return;
          }
          case "modes_all":
            edit.edit({ modes: OSNAP_ALL }, "modes");
            return;
          case "modes_none":
            edit.edit({ modes: 0 }, "modes");
            return;
          default:
            return;
        }
      },
    });
    surface = modal;
    onCleanup(() => {
      surface = undefined;
      modal.dispose();
    });
    const sent = new Map<string, string>();
    createEffect(() => {
      applyParams(host, params(), DRAFTING_SCALARS, DRAFTING_LISTS, sent);
      modal.sync();
    });

    // The unseen surface: the Object Snap page, as it would stand in this body now.
    if (twin === undefined || !isSlabHost(twin) || !isSlabFieldHost(twin)) return;
    const ghost = twin;
    const measure = (): void => {
      const height = ghost.getBoundingClientRect().height;
      if (Number.isFinite(height) && height > 0 && Math.abs(height - tallest()) > 0.5) setTallest(height);
    };
    ghost.addEventListener("slab-frame", measure);
    onCleanup(() => ghost.removeEventListener("slab-frame", measure));
    const ghostSent = new Map<string, string>();
    createEffect(() => {
      const shown = params();
      applyParams(ghost, draftingParams({ tab: "osnap", form: edit.form(), errors: edit.errors(), state: edit.state(), choiceOpen: false, summary: edit.summary(), two: shown.two }), DRAFTING_SCALARS, DRAFTING_LISTS, ghostSent);
    });
  });

  return (
    <Dialog
      open={props.open}
      title="Drafting Settings"
      size="md"
      initialFocus={() => null}
      dismissOnBackdrop={edit.untouched()}
      onClose={() => props.onClose()}
      footer={
        <>
          <Button onClick={() => props.onClose()}>Cancel</Button>
          <Button variant="primary" type="submit" onClick={edit.apply}>
            OK
          </Button>
        </>
      }
    >
      <div class="slab-dialog-twin" aria-hidden="true" inert>
        <cadcraft-drafting ref={twin} />
      </div>
      <cadcraft-drafting ref={element} class="slab-dialog-body" style={tallest() > 0 ? { "min-height": `${tallest()}px` } : undefined} />
      <SlabPopup
        popup={popup}
        mount={() => element?.closest("dialog") ?? undefined}
        onPick={(value, byKey) => {
          edit.edit({ polarChoice: value }, "polarAngle");
          closePopup("pick", byKey);
        }}
        onClose={(reason) => closePopup(reason, reason === "escape" || reason === "tab")}
      />
    </Dialog>
  );
}
