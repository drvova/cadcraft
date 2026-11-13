/**
 * The Tech Sheet view: the piece shown as a printable bench sheet — rendered views of the solid,
 * the stones, the metal, the dimensions and the checks. A full-surface overlay opened from the
 * ribbon's Tech Sheet tool and from Window ▸ Tech Sheet; it lies over the editor like a stage, with
 * its own chrome, and leaves exactly one page when printed.
 *
 * Nothing here is a figure of its own. The sheet model is assembled from three engine replies by
 * `../techsheet` (`piece {query:true}`, `piecemesh` and `techsheet`); the four views are one
 * offscreen render each of the engine's mesh (`../render3d`'s `renderPieceStill`, which queues the
 * stills one at a time and releases every context). The reads, the renders (the object URLs, the
 * per-tile state) and the choices are `../techsheet-state`'s, which the Slab view runs too; this
 * file draws them and owns the print. The page itself is `TechSheetPage`, which the Slab view also
 * prints with. A render that cannot run (no WebGL) shows a worded tile, never a crash.
 */

import { createEffect, For, on, Show, type JSX } from "solid-js";
import type { Envelope } from "../facade";
import { DISPLAY_MODES } from "../view3d";
import { BACKGROUND_OPTIONS } from "../techsheet";
import { createTechSheet, type TechSheetState } from "../techsheet-state";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { SectionLabel } from "../ui/SectionLabel";
import "../techsheet.css";

export interface TechSheetProps {
  /** Whether the view is shown. */
  open: boolean;
  /** The engine's `execute`, envelope parsed (`AppFacade.execute`). A promise is awaited. */
  execute: (command: string, params: unknown) => Envelope | Promise<Envelope>;
  /** The drawing's revision: the sheet is read again when it changes while the view is open. */
  revision: number;
  /** Close the view and give the keyboard back to the editor. */
  onClose: () => void;
}

const DISPLAY_OPTIONS = DISPLAY_MODES.map((entry) => ({
  value: entry.mode,
  label: entry.label,
}));

export function TechSheet(props: TechSheetProps): JSX.Element {
  let host: HTMLDivElement | undefined;
  const sheet = createTechSheet(props, { colors: () => host });

  // Put the keyboard inside the view when it opens, so Escape and the controls answer at once.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        queueMicrotask(() =>
          host?.querySelector<HTMLElement>(".techsheet-close button")?.focus(),
        );
      },
    ),
  );

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  };

  return (
    <Show when={props.open}>
      {/* A stage over the editor: role dialog so a screen reader hears a task, Escape closes it. */}
      <div
        class="techsheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Tech Sheet"
        ref={host}
        onKeyDown={onKey}
      >
        <div class="techsheet-chrome">
          <SectionLabel>Tech Sheet</SectionLabel>
          <div class="techsheet-tools">
            <Select
              size="sm"
              ariaLabel="Display mode"
              title="How the solid is shown in every view"
              value={sheet.mode()}
              options={DISPLAY_OPTIONS}
              onChange={sheet.chooseMode}
            />
            <Select
              size="sm"
              ariaLabel="Background"
              title="What is behind the piece in every view"
              value={sheet.background()}
              options={[...BACKGROUND_OPTIONS]}
              onChange={sheet.chooseBackground}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
            >
              Print
            </Button>
            <span class="techsheet-close">
              <IconButton
                icon="close"
                title="Close the tech sheet"
                onClick={() => props.onClose()}
              />
            </span>
          </div>
        </div>
        <div class="techsheet-scroll">
          <TechSheetPage sheet={sheet} />
        </div>
      </div>
    </Show>
  );
}

/** The paper page: what the SolidJS view shows, and what either view prints. */
export function TechSheetPage(props: { sheet: TechSheetState }): JSX.Element {
  const model = (): ReturnType<TechSheetState["model"]> => props.sheet.model();
  const loading = (): boolean => props.sheet.loading();
  const tiles = (): ReturnType<TechSheetState["tiles"]> => props.sheet.tiles();
  const urls = (): ReturnType<TechSheetState["urls"]> => props.sheet.urls();
  const checksNote = (): string => props.sheet.checksNote();
  return (
    <div class="techsheet-sheet">
      <div class="techsheet-head">
        <h1 class="techsheet-title">{model()?.title ?? "Tech Sheet"}</h1>
        <Show when={loading() && model() === null}>
          <p class="techsheet-muted">Reading the piece…</p>
        </Show>
      </div>

      {/* Views */}
      <section class="techsheet-block techsheet-views-block" aria-label="Views">
        <Show
          when={model()?.mesh}
          fallback={
            <p class="techsheet-placeholder">
              {model()?.note ?? "Reading the piece…"}
            </p>
          }
        >
          <div class="techsheet-views">
            <For each={tiles()}>
              {(tile) => (
                <figure class="techsheet-tile">
                  <div class="techsheet-canvas" data-phase={tile.phase}>
                    <Show
                      when={urls()[tile.view]}
                      fallback={
                        <span class="techsheet-tile-state">
                          {tile.phase === "failed"
                            ? (tile.message ?? "Could not render")
                            : "Rendering…"}
                        </span>
                      }
                    >
                      {(url) => (
                        <img
                          class="techsheet-still"
                          src={url()}
                          alt={`${tile.label} view of the piece`}
                        />
                      )}
                    </Show>
                  </div>
                  <figcaption class="techsheet-tile-label">
                    {tile.label}
                  </figcaption>
                </figure>
              )}
            </For>
          </div>
        </Show>
      </section>

      <div class="techsheet-columns">
        {/* Dimensions */}
        <section class="techsheet-block" aria-label="Dimensions">
          <SectionLabel>Dimensions</SectionLabel>
          <Show
            when={
              (model()?.dimensions.length ?? 0) > 0 ||
              (model()?.ringSizes.length ?? 0) > 0
            }
            fallback={<p class="techsheet-muted">No dimensions yet.</p>}
          >
            <dl class="techsheet-facts">
              <For each={model()?.dimensions ?? []}>
                {(fact) => (
                  <div class="techsheet-fact">
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                )}
              </For>
              <Show when={(model()?.ringSizes.length ?? 0) > 0}>
                <div class="techsheet-fact techsheet-fact-wide">
                  <dt>Ring size</dt>
                  <dd>
                    <For each={model()?.ringSizes ?? []}>
                      {(size) => (
                        <span class="techsheet-size">{`${size.label} ${size.value}`}</span>
                      )}
                    </For>
                  </dd>
                </div>
              </Show>
            </dl>
          </Show>
        </section>

        {/* Metal */}
        <section class="techsheet-block" aria-label="Metal">
          <SectionLabel>Metal</SectionLabel>
          <Show
            when={(model()?.bands.length ?? 0) > 0}
            fallback={<p class="techsheet-muted">No metal yet.</p>}
          >
            <dl class="techsheet-facts">
              <For each={model()?.bands ?? []}>
                {(band) => (
                  <div class="techsheet-fact">
                    <dt>{band.label}</dt>
                    <dd>{band.value}</dd>
                  </div>
                )}
              </For>
              <Show when={model()?.metalTotal}>
                {(total) => (
                  <div class="techsheet-fact techsheet-total">
                    <dt>{total().label}</dt>
                    <dd>{total().value}</dd>
                  </div>
                )}
              </Show>
            </dl>
          </Show>
        </section>
      </div>

      {/* Stones */}
      <section class="techsheet-block" aria-label="Stones">
        <SectionLabel>Stones</SectionLabel>
        <Show
          when={(model()?.stones.length ?? 0) > 0}
          fallback={<p class="techsheet-muted">No stones yet.</p>}
        >
          <div class="techsheet-stones" role="table">
            <div class="techsheet-stone-head" role="row">
              <span role="columnheader">Cut and size</span>
              <span role="columnheader">Count</span>
              <span role="columnheader">Carats</span>
            </div>
            <For each={model()?.stones ?? []}>
              {(stone) => (
                <div class="techsheet-stone" role="row">
                  <span role="cell">
                    {stone.name}
                    <Show when={stone.note}>
                      <span class="techsheet-flag">{stone.note}</span>
                    </Show>
                  </span>
                  <span role="cell">{stone.count}</span>
                  <span role="cell">{stone.carat}</span>
                </div>
              )}
            </For>
            <Show when={model()?.stoneTotal}>
              {(total) => (
                <div class="techsheet-stone techsheet-total" role="row">
                  <span role="cell">{total().label}</span>
                  <span role="cell" />
                  <span role="cell">{total().value}</span>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </section>

      {/* Checks */}
      <section class="techsheet-block" aria-label="Checks">
        <div class="techsheet-block-head">
          <SectionLabel>Checks</SectionLabel>
          <Show when={checksNote() !== ""}>
            <span class="techsheet-muted">{checksNote()}</span>
          </Show>
        </div>
        <Show
          when={(model()?.checks.length ?? 0) > 0}
          fallback={<p class="techsheet-muted">No checks for this drawing.</p>}
        >
          <ul class="techsheet-checks">
            <For each={model()?.checks ?? []}>
              {(check) => (
                <li class="techsheet-check" data-ok={check.ok ? "" : undefined}>
                  <span class="techsheet-check-mark" aria-hidden="true" />
                  <span class="techsheet-check-status">
                    {check.ok ? "Pass" : "Fail"}
                  </span>
                  <span class="techsheet-check-msg">{check.message}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <For each={model()?.warnings ?? []}>
        {(warning) => <p class="techsheet-warning">{warning}</p>}
      </For>
    </div>
  );
}
