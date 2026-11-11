/**
 * The title bar, laid out as the editor's: the menus on the left, the command centre in the
 * middle (the drawing's name; a click, Ctrl+Shift+P or F1 opens the command palette), and on the
 * right the three keys that fold the window's parts away: the sidebar, the command line and the
 * assistant. What the drawing holds (its layer, its counts, which engine is live) is the status
 * bar's to say.
 */

import { Show, type Accessor, type JSX } from "solid-js";
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

export function TopBar(props: TopBarProps): JSX.Element {
  const title = (): string => props.drawing()?.title ?? "Untitled";
  const dirty = (): boolean => props.drawing()?.dirty ?? false;
  return (
    <header class="titlebar">
      <div class="titlebar-start">{props.menu}</div>
      <div class="titlebar-center">
        <Button size="sm" title={`Search commands (${props.paletteShortcut})`} onClick={() => props.onOpenPalette()}>
          <span class="command-center">
            <span class="command-center-icon">
              <ToolIcon id="search" />
            </span>
            <span class="command-center-title">{title()}</span>
            <Show when={dirty()}>
              <span class="command-center-dirty" title="Unsaved changes" />
            </Show>
          </span>
        </Button>
      </div>
      <div class="titlebar-end">
        <IconButton icon="ui.toggle.palettes" title="Sidebar (Ctrl+B)" selected={props.sidebarOpen()} onClick={() => props.onToggleSidebar()} />
        <IconButton icon="layout.bottom" title="Command line (Ctrl+J)" selected={props.panelOpen()} onClick={() => props.onTogglePanel()} />
        <IconButton icon="assistant" title="Assistant (Ctrl+7)" selected={props.assistantOpen()} onClick={() => props.onToggleAssistant()} />
      </div>
    </header>
  );
}
