# CADCraft web

## Description

The CADCraft web interface's design system: the tokens, the six canonical components and the rules the interface is built from, serving the SolidJS app in `apps/ui` over the cadcraft-wasm facade. Foundation: hand-rolled — the system is the app's own, measured from the running Cursor 3.27.22, and no registry item ships it.

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
<div class="app">
  <TopBar … />                       <!-- header: title, mode, layer, zoom -->
  <MenuBar … />                      <!-- the menu row -->
  <ToolStrip … />                    <!-- the toolbar -->
  <div class="workspace">            <!-- canvas + assistant + rail -->
    <main class="stage"><CanvasView … /></main>
    <aside class="rail">             <!-- layers + properties, 260px -->
  </div>
  <CommandLine … />                  <!-- the command line -->
  <StatusBar … />                    <!-- the status bar -->
</div>
```

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
