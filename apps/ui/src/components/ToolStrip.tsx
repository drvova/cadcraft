/**
 * The tool strip: the icon row of `chrome.rs`'s `TOOLBAR` table, in the same groups and order,
 * with a thin divider between groups. Each button invokes its command id through `onInvoke` and
 * its tooltip names the command and its shortcut, exactly as the desktop does.
 *
 * The icons come from `icons.ts` (original code-drawn paths); the table below is transcribed from
 * the Rust table, egui types removed.
 */

import { For, Show, type JSX } from "solid-js";
import { ToolIcon } from "../icons";
import { isMacPlatform, shortcutLabel } from "../commands";

/** One toolbar button: the icon id, the command id it invokes, the label, and the shortcut. */
export interface ToolbarEntry {
  icon: string;
  id: string;
  label: string;
  shortcut: string;
}

/** The toolbar groups, mirroring `crates/ui-egui/src/chrome.rs`'s `TOOLBAR`. */
export const TOOLBAR: readonly (readonly ToolbarEntry[])[] = [
  [
    { icon: "new", id: "new", label: "New Drawing", shortcut: "Cmd+N" },
    { icon: "open", id: "open", label: "Open", shortcut: "Cmd+O" },
    { icon: "save", id: "qsave", label: "Save", shortcut: "Cmd+S" },
    { icon: "saveas", id: "saveas", label: "Save As", shortcut: "" },
  ],
  [
    { icon: "u", id: "u", label: "Undo", shortcut: "Cmd+Z" },
    { icon: "redo", id: "redo", label: "Redo", shortcut: "Cmd+Shift+Z" },
  ],
  [
    { icon: "plot", id: "plot", label: "Print", shortcut: "" },
    { icon: "publish", id: "publish", label: "Batch Publish", shortcut: "" },
    { icon: "pagesetup", id: "pagesetup", label: "Page Setup Manager", shortcut: "" },
    { icon: "preview", id: "preview", label: "Plot Preview", shortcut: "" },
  ],
  [
    { icon: "import", id: "import", label: "Import", shortcut: "" },
    { icon: "export", id: "export", label: "Export", shortcut: "" },
    { icon: "attach", id: "attach", label: "Attach", shortcut: "" },
    { icon: "share", id: "share", label: "Share", shortcut: "" },
  ],
  [
    { icon: "zoom.window", id: "zoom.window", label: "Zoom Window", shortcut: "" },
    { icon: "pan", id: "pan", label: "Pan", shortcut: "" },
    { icon: "3dorbit", id: "3dorbit", label: "Orbit", shortcut: "" },
  ],
  [
    { icon: "zoom.extents", id: "zoom.extents", label: "Zoom Extents", shortcut: "" },
    { icon: "ui.toggle.palettes", id: "ui.toggle.palettes", label: "Properties", shortcut: "" },
    { icon: "ui.dialog.layers", id: "ui.dialog.layers", label: "Layer Properties Manager", shortcut: "" },
    { icon: "ui.dialog.blocks", id: "ui.dialog.blocks", label: "Blocks", shortcut: "" },
  ],
  [
    { icon: "dist", id: "dist", label: "Measure Distance", shortcut: "" },
    { icon: "list", id: "list", label: "List", shortcut: "" },
    { icon: "area", id: "area", label: "Area", shortcut: "" },
  ],
  [{ icon: "ui.dialog.about", id: "ui.dialog.about", label: "Help", shortcut: "" }],
];

export interface ToolStripProps {
  onInvoke: (id: string) => void;
}

export function ToolStrip(props: ToolStripProps): JSX.Element {
  return (
    <nav class="toolstrip" role="toolbar" aria-label="Tool bar">
      <For each={TOOLBAR}>
        {(group, index) => (
          <>
            <Show when={index() > 0}>
              <span class="tool-divider" aria-hidden="true" />
            </Show>
            <For each={group}>
              {(entry) => (
                <button
                  class="tool-button"
                  type="button"
                  title={entry.shortcut === "" ? entry.label : `${entry.label} (${shortcutLabel(entry.shortcut, isMacPlatform())})`}
                  aria-label={entry.label}
                  onClick={() => props.onInvoke(entry.id)}
                >
                  <ToolIcon id={entry.icon} />
                </button>
              )}
            </For>
          </>
        )}
      </For>
    </nav>
  );
}
