/**
 * What main.tsx hands the app when the Slab shell is on: the shell and the panels already ported
 * to Slab, as components. `../app.tsx` imports this type only, so the standard interface carries
 * no code of the Slab shell.
 */

import type { Component } from "solid-js";
import type { BenchPanelProps } from "../components/BenchPanel";
import type { LayersPanelProps } from "../components/LayersPanel";
import type { MenuBarProps } from "../components/MenuBar";
import type { PiecePanelProps } from "../components/PiecePanel";
import type { ObjectsPanelProps } from "../components/ObjectsPanel";
import type { PropertiesPanelProps } from "../components/PropertiesPanel";
import type { LayoutTabsProps, StatusBarProps } from "../components/StatusBar";
import type { ToolStripProps } from "../components/ToolStrip";
import type { TopBarProps } from "../components/TopBar";
import type { AssistantPaneProps } from "../components/AssistantPane";
import type { SlabShellProps } from "./SlabShell";
import type { CommandLineProps } from "../components/CommandLine";
import type { JewelryDialogProps } from "../components/JewelryDialog";
import type { PriceBookDialogProps } from "../components/PriceBookDialog";
import type { DraftingSettingsProps } from "../components/DraftingSettings";
import type { TemplateGalleryProps } from "../components/TemplateGallery";
import type { MenuProps } from "../components/Menu";

/**
 * What the ribbon is given: the SolidJS strip's props, and the id of the command that is running
 * (when one is), which only the ribbon drawn by Slab marks. The SolidJS strip takes these props
 * and reads its own.
 */
export interface RibbonProps extends ToolStripProps {
  running?: string | null;
  /** The menu its overflow key opens: the Slab shell's when it has one (`SlabParts.Menu`); the SolidJS one otherwise. */
  menuView?: Component<MenuProps>;
}

/**
 * What the title bar is given: the SolidJS bar's props, and the menu bar's own (absent or null
 * while the in-window menus are hidden), which only the bar drawn by Slab reads: its titles are
 * part of its one surface. The SolidJS bar takes these props and draws the `menu` it is handed.
 */
export interface TitleBarProps extends TopBarProps {
  menus?: MenuBarProps | null;
  /** The menu a title opens: the Slab shell's when it has one (`SlabParts.Menu`); the SolidJS one otherwise. */
  menuView?: Component<MenuProps>;
}

export interface SlabParts {
  Shell: Component<SlabShellProps>;
  /** The Bench section; absent when its document did not load, and the SolidJS one is shown. */
  Bench?: Component<BenchPanelProps>;
  /** The Layers section; absent when its document did not load, and the SolidJS one is shown. */
  Layers?: Component<LayersPanelProps>;
  /** The Piece section; absent when its document did not load, and the SolidJS one is shown. */
  Piece?: Component<PiecePanelProps>;
  /** The Objects section; absent when its document did not load, and the SolidJS one is shown. */
  Objects?: Component<ObjectsPanelProps>;
  /** The Properties section; absent when its document did not load, and the SolidJS one is shown. */
  Properties?: Component<PropertiesPanelProps>;
  /** The status bar; absent when its document did not load, and the SolidJS one is shown. */
  StatusBar?: Component<StatusBarProps>;
  /** The tabs over the drawing; absent when their document did not load, and the SolidJS strip is shown. */
  Tabs?: Component<LayoutTabsProps>;
  /** The Price Book dialog; absent when its document did not load, and the SolidJS one is shown. */
  PriceBook?: Component<PriceBookDialogProps>;
  /** The Ring and Gem dialogs (one document); absent when it did not load, and the SolidJS ones are shown. */
  Ring?: Component<JewelryDialogProps>;
  Gem?: Component<JewelryDialogProps>;
  /** The Drafting Settings dialog; absent when its document did not load, and the SolidJS one is shown. */
  Drafting?: Component<DraftingSettingsProps>;
  /** The template gallery; absent when its document did not load, and the SolidJS one is shown. */
  Templates?: Component<TemplateGalleryProps>;
  /** The ribbon; absent when its document did not load, and the SolidJS strip is shown. */
  Ribbon?: Component<RibbonProps>;
  /** The title bar; absent when its document did not load, and the SolidJS bar is shown. */
  TopBar?: Component<TitleBarProps>;
  /** The command line; absent when its document did not load, and the SolidJS one is shown. */
  CommandLine?: Component<CommandLineProps>;
  /** The assistant panel's frame; absent when its document did not load, and the SolidJS panel is shown. */
  Assistant?: Component<AssistantPaneProps>;
  /** The menus (the title bar's, the ribbon's overflow, the right-click ones); absent when their document did not load, and the SolidJS menu is shown. */
  Menu?: Component<MenuProps>;
}
