/**
 * The Tech Sheet view: the piece shown as a printable bench sheet — rendered views of the solid,
 * the stones, the metal, the dimensions and the checks. A full-surface overlay opened from the
 * ribbon's Tech Sheet tool and from Window ▸ Tech Sheet; it lies over the editor like a stage, with
 * its own chrome, and leaves exactly one page when printed.
 *
 * Nothing here is a figure of its own. The sheet model is assembled from three engine replies by
 * `../techsheet` (`piece {query:true}`, `piecemesh` and `techsheet`); the four views are one
 * offscreen render each of the engine's mesh (`../render3d`'s `renderPieceStill`, which queues the
 * stills one at a time and releases every context). This file owns the canvas renders (the object
 * URLs, the per-tile state) and the print; the drawing, the dimensions and the tables are the
 * engine's. A render that cannot run (no WebGL) shows a worded tile, never a crash.
 */

import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import type { Envelope } from "../facade";
import { renderPieceStill } from "../render3d";
import {
  DISPLAY_MODES,
  isDisplayMode,
  type DisplayMode,
  type PieceMesh,
  type StandardView,
  type Vec3,
} from "../view3d";
import {
  assembleSheet,
  BACKGROUND_OPTIONS,
  failedCount,
  freshTiles,
  meshRequest,
  nextPending,
  setTile,
  type SheetBackground,
  type SheetModel,
  wantsInk,
} from "../techsheet";
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

/** Each view is drawn at this many device pixels a side; a square tile frames a ring from any side. */
const RENDER_PX = 640;
/** A mode or background change waits this long before the four stills are drawn again. */
const DEBOUNCE_MS = 140;

const DISPLAY_OPTIONS = DISPLAY_MODES.map((entry) => ({
  value: entry.mode,
  label: entry.label,
}));

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A token's colour as red, green and blue in 0…1 (the browser paints one pixel and it is read
 * back), so a still's background and ink come from the sheet's own tokens. Null when it cannot be read.
 */
function tokenColor(
  element: Element,
  token: string,
  probe: CanvasRenderingContext2D | null,
): Vec3 | null {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  if (
    value === "" ||
    probe === null ||
    typeof CSS === "undefined" ||
    !CSS.supports("color", value)
  )
    return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;
  return [(pixel[0] ?? 0) / 255, (pixel[1] ?? 0) / 255, (pixel[2] ?? 0) / 255];
}

export function TechSheet(props: TechSheetProps): JSX.Element {
  let host: HTMLDivElement | undefined;
  let probe: CanvasRenderingContext2D | null = null;
  const [model, setModel] = createSignal<SheetModel | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [mode, setMode] = createSignal<DisplayMode>("shaded");
  const [background, setBackground] = createSignal<SheetBackground>("surface");
  const [tiles, setTiles] = createSignal(freshTiles());
  /** The PNG of each drawn view, by the view it is of; revoked when it is replaced. */
  const [urls, setUrls] = createSignal<Partial<Record<StandardView, string>>>(
    {},
  );

  /** The newest read: a reply to an older one is dropped (the drawing may have changed under it). */
  let read = 0;
  /** The newest render run: a still from an older one is dropped. */
  let generation = 0;
  let debounce = 0;

  const revokeAll = (): void => {
    for (const url of Object.values(urls()))
      if (url !== undefined) URL.revokeObjectURL(url);
  };

  /** Read the piece, its fine solid and the bench reply, and assemble the sheet from the three. */
  const load = async (): Promise<void> => {
    const mine = (read += 1);
    setLoading(true);
    const pieceEnv = await props.execute("piece", { query: true });
    if (mine !== read) return;
    const request = meshRequest(pieceEnv);
    const meshEnv: Envelope =
      request === null
        ? { ok: false, error: "the drawing has no piece to render" }
        : await props.execute("piecemesh", { ...request, quality: "fine" });
    if (mine !== read) return;
    const benchEnv = await props.execute("techsheet", {});
    if (mine !== read) return;
    setModel(assembleSheet(pieceEnv, meshEnv, benchEnv));
    setLoading(false);
  };

  /** Draw the four views, one after another, each on the sheet's surface or as a cut-out. */
  const renderAll = async (
    mesh: PieceMesh,
    chosen: DisplayMode,
    surface: SheetBackground,
  ): Promise<void> => {
    const mine = (generation += 1);
    revokeAll();
    setUrls({});
    setTiles(freshTiles());
    const background: Vec3 | null =
      surface === "surface" && host !== undefined
        ? (tokenColor(host, "--paper", probe) ?? [0.98, 0.98, 0.98])
        : null;
    const edgeInk: Vec3 | null =
      wantsInk(chosen, surface) && host !== undefined
        ? tokenColor(host, "--paper-ink", probe)
        : null;
    let next = nextPending(tiles());
    while (next !== null) {
      if (mine !== generation) return;
      const view = next;
      setTiles((current) => setTile(current, view, "rendering"));
      try {
        const blob = await renderPieceStill(mesh, {
          view,
          mode: chosen,
          width: RENDER_PX,
          height: RENDER_PX,
          background,
          edgeInk,
        });
        if (mine !== generation) return;
        const url = URL.createObjectURL(blob);
        setUrls((current) => ({ ...current, [view]: url }));
        setTiles((current) => setTile(current, view, "done"));
      } catch (error) {
        if (mine !== generation) return;
        setTiles((current) => setTile(current, view, "failed", message(error)));
      }
      next = nextPending(tiles());
    }
  };

  // Read the sheet when the view opens, and again when the drawing changes under it.
  createEffect(
    on(
      () => [props.open, props.revision] as const,
      ([open]) => {
        if (open) void load();
      },
    ),
  );

  // Draw (or redraw) the views when the mesh, the mode or the background changes while open.
  createEffect(() => {
    const mesh = model()?.mesh ?? null;
    const open = props.open;
    const chosen = mode();
    const surface = background();
    if (debounce !== 0) window.clearTimeout(debounce);
    if (!open || mesh === null) return;
    debounce = window.setTimeout(() => {
      debounce = 0;
      void renderAll(mesh, chosen, surface);
    }, DEBOUNCE_MS);
  });

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

  onMount(() => {
    probe = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
  });
  onCleanup(() => {
    if (debounce !== 0) window.clearTimeout(debounce);
    revokeAll();
  });

  const chooseMode = (value: string): void => {
    if (isDisplayMode(value)) setMode(value);
  };
  const chooseBackground = (value: string): void => {
    if (value === "surface" || value === "transparent") setBackground(value);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  };

  const checksNote = (): string => {
    const sheet = model();
    if (sheet === null || sheet.piece === null) return "";
    const failed = failedCount(sheet);
    return failed === 0
      ? "All pass"
      : `${failed} of ${sheet.checks.length} fail`;
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
              value={mode()}
              options={DISPLAY_OPTIONS}
              onChange={chooseMode}
            />
            <Select
              size="sm"
              ariaLabel="Background"
              title="What is behind the piece in every view"
              value={background()}
              options={[...BACKGROUND_OPTIONS]}
              onChange={chooseBackground}
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
          <div class="techsheet-sheet">
            <div class="techsheet-head">
              <h1 class="techsheet-title">{model()?.title ?? "Tech Sheet"}</h1>
              <Show when={loading() && model() === null}>
                <p class="techsheet-muted">Reading the piece…</p>
              </Show>
            </div>

            {/* Views */}
            <section
              class="techsheet-block techsheet-views-block"
              aria-label="Views"
            >
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
                fallback={
                  <p class="techsheet-muted">No checks for this drawing.</p>
                }
              >
                <ul class="techsheet-checks">
                  <For each={model()?.checks ?? []}>
                    {(check) => (
                      <li
                        class="techsheet-check"
                        data-ok={check.ok ? "" : undefined}
                      >
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
        </div>
      </div>
    </Show>
  );
}
