/**
 * What main.tsx hands the app when the Slab shell is on: the shell and the panels already ported
 * to Slab, as components. `../app.tsx` imports this type only, so the standard interface carries
 * no code of the Slab shell.
 */

import type { Component } from "solid-js";
import type { BenchPanelProps } from "../components/BenchPanel";
import type { LayersPanelProps } from "../components/LayersPanel";
import type { PiecePanelProps } from "../components/PiecePanel";
import type { ObjectsPanelProps } from "../components/ObjectsPanel";
import type { PropertiesPanelProps } from "../components/PropertiesPanel";
import type { LayoutTabsProps, StatusBarProps } from "../components/StatusBar";
import type { SlabShellProps } from "./SlabShell";
import type { JewelryDialogProps } from "../components/JewelryDialog";
import type { PriceBookDialogProps } from "../components/PriceBookDialog";

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
}
