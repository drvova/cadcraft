/**
 * The title bar, laid out as the editor's: the menus on the left, the command centre in the
 * middle (the drawing's name; a click, Ctrl+Shift+P or F1 opens the command palette), and on the
 * right the three keys that fold the window's parts away: the sidebar, the command line and the
 * assistant. What the drawing holds (its layer, its counts, which engine is live) is the status
 * bar's to say.
 *
 * The command centre's name is the action, the drawing's name and, while there are any, "unsaved
 * changes" (a button's `aria-label` replaces what is inside it, so the dot cannot say it for
 * itself); the dot's own hint is for the pointer. Each key's shortcut is passed by itself: a key
 * cap in the hint and `aria-keyshortcuts`, not words in the name.
 */

import { Show, type Accessor, type JSX } from "solid-js";
import { isMacPlatform, shortcutLabel } from "../commands";
import type { DrawingState } from "../facade";
import { ToolIcon } from "../icons";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

export interface TopBarProps {
  drawing: Accessor<DrawingState | null>;
  /** The menu bar, when the in-window menus are shown. */
  menu?: JSX.Element;
  /** The palette's shortcut in this platform's words ("Ctrl+Shift+P"). */
  paletteShortcut: string;
  onOpenPalette: () => void;
  sidebarOpen: Accessor<boolean>;
  onToggleSidebar: () => void;
  panelOpen: Accessor<boolean>;
  onTogglePanel: () => void;
  assistantOpen: Accessor<boolean>;
  onToggleAssistant: () => void;
}

/** The command centre's name: the action, the drawing's name and, while there are any, "unsaved changes". */
export function commandCentreName(title: string, dirty: boolean): string {
  return dirty ? `Search commands, ${title}, unsaved changes` : `Search commands, ${title}`;
}

/** The three keys that fold the window's parts away, in the order drawn: glyph, name, shortcut (`Cmd` is the platform's). */
export const LAYOUT_KEYS = [
  { part: "sidebar", icon: "ui.toggle.palettes", title: "Sidebar", shortcut: "Cmd+B" },
  { part: "panel", icon: "layout.bottom", title: "Command line", shortcut: "Cmd+J" },
  { part: "assistant", icon: "assistant", title: "Assistant", shortcut: "Cmd+7" },
] as const;

const [SIDEBAR, PANEL, ASSISTANT] = LAYOUT_KEYS;

export function TopBar(props: TopBarProps): JSX.Element {
  const title = (): string => props.drawing()?.title ?? "Untitled";
  const dirty = (): boolean => props.drawing()?.dirty ?? false;
  /** A layout key's shortcut in this platform's words, as the menus print it. */
  const key = (shortcut: string): string => shortcutLabel(shortcut, isMacPlatform());
  return (
    <header class="titlebar">
      <div class="titlebar-start">{props.menu}</div>
      <div class="titlebar-center">
        <Button size="sm" ariaLabel={commandCentreName(title(), dirty())} title="Command palette" shortcut={props.paletteShortcut} onClick={() => props.onOpenPalette()}>
          <span class="command-center">
            <span class="command-center-icon">
              <ToolIcon id="search" />
            </span>
            <span class="command-center-title">{title()}</span>
            <Show when={dirty()}>
              <span class="command-center-dirty" aria-hidden="true" data-hint="Unsaved changes" />
            </Show>
          </span>
        </Button>
      </div>
      <div class="titlebar-end">
        <IconButton icon={SIDEBAR.icon} title={SIDEBAR.title} shortcut={key(SIDEBAR.shortcut)} selected={props.sidebarOpen()} onClick={() => props.onToggleSidebar()} />
        <IconButton icon={PANEL.icon} title={PANEL.title} shortcut={key(PANEL.shortcut)} selected={props.panelOpen()} onClick={() => props.onTogglePanel()} />
        <IconButton icon={ASSISTANT.icon} title={ASSISTANT.title} shortcut={key(ASSISTANT.shortcut)} selected={props.assistantOpen()} onClick={() => props.onToggleAssistant()} />
      </div>
    </header>
  );
}
