# CADCraft web

## Description

The CADCraft web interface's design system: the tokens, the fourteen canonical components and the rules the interface is built from, serving the SolidJS app in `apps/ui` over the cadcraft-wasm facade. Foundation: hand-rolled — the system is the app's own, measured from the running Cursor 3.27.22, and no registry item ships it.

## Importing a component

```tsx
import { Button } from "./ui/Button"; // from a file in src/, or the registry's import path
```

## The one rule

New UI uses a registry component (`docs/registry.json`) and the tokens in `src/tokens.css`. If none fits, open a gate before writing one — do not restyle a native element.

## Priority order

When two rules conflict, the earlier wins:

1. Accessibility — keyboard paths, focus, contrast, target size.
2. The tokens — a value that has a token uses the token.
3. The existing components — reuse beats a new variant.
4. The scales — a gap, a radius, a size is a ladder step.
5. Polish — spacing, alignment, motion last.

## The page shell

The app's real shell, in order (from `src/app.tsx`):

```tsx
<div class="app">                     <!-- a grid of four rows: auto, auto, the rest, auto -->
  <TopBar menu={<MenuBar … />} … />   <!-- the title bar, 35px: the menus (one Main menu key under 900px), the command centre, three layout keys -->
  <ToolStrip … />                     <!-- the tool strip, 28px: the drawing tools, an overflow menu for the ones that do not fit -->
  <div class="workspace">             <!-- a flex row: sidebar, editor, assistant -->
    <aside class="sidebar">           <!-- left, 252px: LayersPanel over PropertiesPanel -->
    <div class="editor">              <!-- the middle, what is left -->
      <LayoutTabs … />                <!-- the editor tabs (Model and the layouts) -->
      <main class="stage"><CanvasView … /></main>
      <CommandLine … />               <!-- the bottom panel -->
    </div>
    <AssistantPane … />               <!-- right, 340px by default, resizable -->
  </div>
  <StatusBar … />                     <!-- the status bar, one 22px line -->
  <CommandPalette … />                <!-- a dialog over the page (Ctrl+Shift+P) -->
  <!-- a modal dialog (Drafting Settings) is a `Dialog` mounted here, beside the palette, its `open` held by the shell -->
</div>
```

Every part but the editor can be hidden (the title bar's layout keys, View's commands). With the assistant open under 900px the sidebar steps aside, and under 560px the assistant takes the whole workspace.

## When to ask

Ask only for an amount or a limit the task did not give (a new size, a new duration, a new colour role). Decide everything else from these pages and say what you chose.

## Reject list

- No second brand hue; `--accent` is the one action colour.
- No looping or ambient animation; motion is state feedback only.
- No raw values where a token exists; no px in a control's box that is not on a ladder.
- No icon fonts, sprites or third-party iconography; glyphs are drawn in `src/icons.ts`.
- No component copies inside `docs/system/examples`; examples import the real component.

## Checking the work

`bun run check`, from `apps/ui/` — typecheck, the drift check, the spec check and the docs check, in one command.
