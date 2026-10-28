# Icons

## Description

Every icon is drawn in code as an SVG path on a 24×24 grid and takes its colour from the surrounding ink (`currentColor`); no icon font, sprite or third-party artwork ships. The paths live in `src/icons.ts`, the sizes and inks in `src/tokens.css`.

## Tokens

### Sizes

| Token | Value | Role |
| --- | --- | --- |
| `--icon-size-sm` | `12px` | The small step: a chip's glyph, a row's trailing action. |
| `--icon-size-md` | `14px` | The default: a toolbar glyph, an icon button's face. |
| `--icon-size-lg` | `16px` | The large step: a primary toolbar action, a dialog's header glyph. |

### Ink

| Token | Value | Role |
| --- | --- | --- |
| `--icon` | dark `rgba(240,240,240,.66)` / light `rgba(20,20,20,.66)` | The default glyph ink. |
| `--icon-accent` | `#599CE7` / `#2678C1` | A glyph carrying the accent: the current tool, a link. |
| `--icon-point` | `#f1b467` / `#b8791f` | A glyph calling for attention: a snap or a marker. |
| `--icon-layer-off` | `#8a8a5a` | A layer switched off. |
| `--icon-layer-frozen` | `#9fd4ff` | A frozen layer. |
| `--icon-locked` | `#e6b43c` | A locked layer. |
| `--icon-current` | `#6fe06f` | The current layer's glyph. |

## Specimens

- Sizes, drawn with the tokens: <span style="display:inline-block;width:var(--icon-size-sm);height:var(--icon-size-sm);background:var(--icon);vertical-align:middle"></span> sm 12 <span style="display:inline-block;width:var(--icon-size-md);height:var(--icon-size-md);background:var(--icon);vertical-align:middle"></span> md 14 <span style="display:inline-block;width:var(--icon-size-lg);height:var(--icon-size-lg);background:var(--icon);vertical-align:middle"></span> lg 16
- Ink on `--chrome`: <span style="background:var(--chrome);color:var(--icon);padding:2px 6px">icon</span> <span style="background:var(--chrome);color:var(--icon-accent);padding:2px 6px">accent</span> <span style="background:var(--chrome);color:var(--icon-point);padding:2px 6px">point</span> <span style="background:var(--chrome);color:var(--icon-layer-off);padding:2px 6px">layer-off</span> <span style="background:var(--chrome);color:var(--icon-layer-frozen);padding:2px 6px">frozen</span> <span style="background:var(--chrome);color:var(--icon-locked);padding:2px 6px">locked</span> <span style="background:var(--chrome);color:var(--icon-current);padding:2px 6px">current</span>

The drawn set (`ICON_PATHS` in `src/icons.ts`, 24×24, `stroke-width: 1.5`, round caps and joins):

| Group | Ids |
| --- | --- |
| File | `new`, `open`, `save`, `saveas` |
| Edit | `u`, `redo` |
| Output | `plot`, `publish`, `pagesetup`, `preview`, `import`, `export`, `attach`, `share` |
| View | `zoom.window`, `pan`, `3dorbit`, `zoom.extents` |
| Panels | `ui.toggle.palettes`, `ui.dialog.layers`, `ui.dialog.blocks`, `ui.dialog.about` |
| Tools | `dist`, `list`, `area` |
| Composer | `send`, `stop`, `plus`, `close` |

## Usage

- A glyph is `currentColor`; its container sets the ink (`--icon`, `--icon-accent`, `--icon-point`), because an icon must follow the state its control is in.
- Three sizes only (`12/14/16`), matched to the control ladder, because a fourth size is a different control.
- Icons are drawn, never imported: every path is original code on the 24×24 grid, because third-party icon sets carry licences and a foreign stroke grammar.
- A glyph that means the same thing keeps its id everywhere (`save` is the floppy, `zoom.extents` the four corners), because two drawings for one action is a bug a reader reads as two actions.
- Status glyphs keep their fixed layer colours (`--icon-layer-*`, `--icon-current`) in both themes, because a layer's state must survive the chrome's theme.

## Accessibility

- Icons are never the only label: an icon-only control carries `aria-label` in its component (`src/ui/IconButton.tsx`), and the check cannot see the rendered accessibility tree, so the browser review covers it.
- Contrast: `--icon` measures 7.5:1 over `--chrome` in dark and 5.8:1 in light; the layer inks are exempt as state markers on the canvas. The Colors page carries the full measured grid from `scripts/contrast-report.mjs`.
- The 1.5 stroke on the 24×24 grid keeps a glyph readable down to 12px without hinting.

## Not tokens

- The 24×24 viewBox and `stroke-width: 1.5` are drawing constants in `src/icons.ts`, not tokens, because they are the glyphs' own geometry rather than chrome scale.
- The composer's `COMPOSER_ICONS` list (`send`, `stop`, `plus`, `close`) is a subset marker for that pane, not a second icon set.
