# Colors

## Description

One base colour at an alpha ladder over a few near-black surfaces in dark, mirrored in light: colour is a signal, never decoration. This page is the token list, the role of each token, and the measured contrast of every pair; the values themselves live in `src/tokens.css` (measured from the running Cursor 3.27.22, the run's research notes).

## Tokens

Dark is the default (`:root`); light restates only the roles that change, under `:root[data-theme="light"]`, and inherits the rest.

### Surfaces

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--chrome` | `#141414` | `#F8F8F8` | The window chrome and every panel behind the drawing. |
| `--chrome-dark` | `#0f0f0f` | `#F3F3F3` | The recessed chrome: the status bar, the tab strip's well. |
| `--panel` | `#141414` | `#FCFCFC` | A floating panel's surface, one step above chrome. |
| `--tab-active` | `#181818` | `#FCFCFC` | The selected tab, lifted off the strip. |
| `--control` | `#1c1c1c` | `#e8e8e8` | A control's own fill: fields, buttons at rest, list rows. |
| `--control-hover` | `#232323` | `#dedede` | The control fill under the pointer. |
| `--surface-elevated` | `#212121` | `#FCFCFC` | The elevated surface: the composer, menus, popovers. |
| `--border` | `rgba(240,240,240,.12)` | `rgba(20,20,20,.12)` | The measured border stroke (Cursor §1). |
| `--border-soft` | `rgba(240,240,240,.08)` | `rgba(20,20,20,.08)` | The hairline stroke inside controls. |

### Drawing area

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--canvas` | `#181818` | `#181818` | The drawing surface, one step off chrome; it keeps its own colours in both themes. |
| `--grid-minor` | `#202020` | `#202020` | The minor unit grid. |
| `--grid-major` | `#2a2a2a` | `#2a2a2a` | The major grid every ten units. |
| `--axis-x` | `#552633` | `#552633` | The X axis, warm and dim so it never reads as geometry. |
| `--axis-y` | `#23412f` | `#23412f` | The Y axis, cool and dim. |

### Text and icons

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--text` | `#F0F0F0` | `#141414` | Primary ink: labels, values, the drawing's titles. |
| `--text-dim` | `rgba(240,240,240,.74)` | `rgba(20,20,20,.74)` | Secondary ink: hints, units, secondary values. |
| `--text-faint` | `rgba(240,240,240,.60)` | `rgba(20,20,20,.66)` | Tertiary ink: section headers, captions. Light's `.60` misses 4.5 over the `#e8e8e8` control (4.49); the nearest passing measured step, the icon ink `.66` (5.45), is used instead. |
| `--text-disabled` | `rgba(240,240,240,.36)` | `rgba(20,20,20,.36)` | Disabled ink (Cursor §5); exempt from contrast as an inactive control. |
| `--text-accent` | `#599CE7` | `#005DA4` | The accent as a text ink: the label of an accent chip. Dark's is the accent itself; light's is the accent's hue and chroma at OKLCH L .47 (the accent is .56), because `#2678C1` measures 3.28 on its own tint over the `#e8e8e8` control. |
| `--icon` | `rgba(240,240,240,.66)` | `rgba(20,20,20,.66)` | The default glyph ink. |
| `--icon-accent` | `#599CE7` | `#2678C1` | A glyph carrying the accent: the current tool, a link. |
| `--icon-point` | `#f1b467` | `#b8791f` | A glyph calling for attention without error: snap, warning-adjacent. |

### Action and selection

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--accent` | `#599CE7` | `#2678C1` | The one action colour: the primary button's fill, the selection stroke, focus. |
| `--accent-hover` | `#6AA6E9` | `#226CAE` | The primary button's hover: the accent stepped 10% away from the surface (toward white in dark, toward black in light), so the label on it gains contrast in both. |
| `--accent-pressed` | `#7AB0EC` | `#1E609A` | The same at 20%: the primary button's pressed fill. |
| `--accent-soft` | `rgba(89,156,231,.12)` | `rgba(38,120,193,.12)` | The accent-tinted chip fill (Chip tone=accent). |
| `--selection` | `#599CE7` | `#2678C1` | The canvas selection highlight. |
| `--focus-ring` | `var(--accent)` | `#005DA4` | The focus ring's ink. Dark's is the accent; light's is the accent's text step, because `#2678C1` measures 2.83 against the `.14` selected fill over the control. |
| `--hover` | `rgba(240,240,240,.08)` | `rgba(20,20,20,.08)` | The one hover fill (Cursor §5: hover is a fill, never a colour change). |
| `--fill-active` | `rgba(240,240,240,.14)` | `rgba(20,20,20,.14)` | The pressed/selected fill. |
| `--fill-pressed` | `rgba(240,240,240,.20)` | `rgba(20,20,20,.20)` | The pressed step of a `.14`-hover control. |
| `--fill-disabled` | `rgba(240,240,240,.04)` | `rgba(20,20,20,.04)` | The disabled fill (Cursor §5: no fill change). |
| `--grip-hot` | `#e34671` | `#e34671` | A grip under the pointer: the resize handle lights up. |

### Status

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--warn` | `#f1b467` | `#A46701` | A warning message or glyph. |
| `--error` | `#e34671` | `#BE1744` | An error: the danger button's fill, an error message. |
| `--error-hover` | `#E6597F` | `#AB153D` | The danger button's hover: the error fill stepped 10% away from the surface (toward white in dark, toward black in light). |
| `--error-pressed` | `#E96B8D` | `#981236` | The same at 20%. |
| `--snap` | `#3fa266` | `#007041` | The snap indicator on the canvas. |
| `--toggle-on` | `#3fa266` | `#007041` | A switch in its on position. |

### Command line

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--cmd-bg` | `rgba(28,28,28,.94)` | `#ebebeb` | The command line's own surface over the chrome. |
| `--cmd-border` | `#333333` | `#c9c9c9` | Its border. |
| `--cmd-keyword` | `#599CE7` | `#2678C1` | A recognised command keyword. |
| `--cmd-keyword-hover` | `rgba(89,156,231,.12)` | `rgba(38,120,193,.12)` | The keyword's hover tint. |
| `--cmd-history` | `rgba(26,26,26,.667)` | `#f2f2f2` | A recalled history row. |

### Lists

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--list-bg` | `#1c1c1c` | `#ffffff` | The command list's surface under the command line. |
| `--list-row` | `var(--fill-active)` | `var(--fill-active)` | The highlighted row: the one selected fill, reused. |

### Layers

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--icon-layer-off` | `#8a8a5a` | `#8a8a5a` | A layer switched off. |
| `--icon-layer-frozen` | `#9fd4ff` | `#9fd4ff` | A frozen layer. |
| `--icon-locked` | `#e6b43c` | `#e6b43c` | A locked layer. |
| `--icon-current` | `#6fe06f` | `#6fe06f` | The current layer's glyph. |
| `--layer-current` | `#4cc25a` | `#d5dfe9` | The current layer's row fill. |
| `--swatch-border` | `#191919` | `#191919` | The hairline around a colour swatch. |

### Elevation, scrollbars, borders, misc

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--shadow` | `rgba(0,0,0,.45)` | `rgba(0,0,0,.18)` | The shadow under floating surfaces (menus, the composer). |
| `--scrollbar` | `rgba(240,240,240,.14)` | `rgba(20,20,20,.14)` | The scrollbar thumb (Cursor §1). |
| `--scrollbar-hover` | `rgba(240,240,240,.22)` | `rgba(20,20,20,.22)` | The thumb under the pointer. |
| `--composer-border` | `rgba(240,240,240,.08)` | `rgba(20,20,20,.08)` | The composer's hairline (Cursor §1/§5). |
| `--composer-border-active` | `rgba(240,240,240,.12)` | `rgba(20,20,20,.12)` | The composer's border once focused. |
| `--on-accent` | `#191C22` | `#FCFCFC` | The ink on an action fill (the primary button's label). |
| `--on-error` | `#121418` | `#FCFCFC` | The ink on the error fill (the danger button's label): `--on-accent` measures 4.37 there in dark. |
| `--crosshair` | `#e4e4e4` | `#e4e4e4` | The crosshair cursor on the canvas. |
| `--paper` | `#fcfcfc` | `#fcfcfc` | Paper white for previews and print-like surfaces. |

## Specimens

Each specimen is drawn with the token itself, never a copied value.

- Surface ladder: <span style="display:inline-block;width:56px;height:18px;background:var(--chrome-dark);vertical-align:middle"></span> <span style="display:inline-block;width:56px;height:18px;background:var(--chrome);vertical-align:middle"></span> <span style="display:inline-block;width:56px;height:18px;background:var(--control);vertical-align:middle"></span> <span style="display:inline-block;width:56px;height:18px;background:var(--control-hover);vertical-align:middle"></span> <span style="display:inline-block;width:56px;height:18px;background:var(--surface-elevated);vertical-align:middle"></span> — `--chrome-dark`, `--chrome`, `--control`, `--control-hover`, `--surface-elevated`.
- Text ladder on `--chrome`: <span style="background:var(--chrome);color:var(--text);padding:2px 8px">Text</span> <span style="background:var(--chrome);color:var(--text-dim);padding:2px 8px">Text dim</span> <span style="background:var(--chrome);color:var(--text-faint);padding:2px 8px">Text faint</span> <span style="background:var(--chrome);color:var(--text-disabled);padding:2px 8px">Disabled</span>.
- Icons on `--chrome`: <span style="background:var(--chrome);color:var(--icon);padding:2px 8px">icon</span> <span style="background:var(--chrome);color:var(--icon-accent);padding:2px 8px">icon-accent</span> <span style="background:var(--chrome);color:var(--icon-point);padding:2px 8px">icon-point</span>.
- Action fills: <span style="display:inline-block;width:72px;height:20px;background:var(--accent);vertical-align:middle"></span> <span style="display:inline-block;width:72px;height:20px;background:var(--accent-hover);vertical-align:middle"></span> <span style="display:inline-block;width:72px;height:20px;background:var(--accent-pressed);vertical-align:middle"></span> <span style="display:inline-block;width:72px;height:20px;background:var(--accent-soft);vertical-align:middle"></span> — accent, hover, pressed, soft.
- On accent: <span style="background:var(--accent);color:var(--on-accent);padding:2px 10px">Primary</span> <span style="background:var(--error);color:var(--on-accent);padding:2px 10px">Danger</span>.
- Status: <span style="color:var(--warn)">warn</span> <span style="color:var(--error)">error</span> <span style="color:var(--snap)">snap</span> <span style="color:var(--toggle-on)">toggle-on</span>.
- State fills over `--control`: <span style="background:var(--control);padding:2px 10px">rest <span style="background:var(--hover);padding:1px 6px">hover</span> <span style="background:var(--fill-active);padding:1px 6px">active</span> <span style="background:var(--fill-pressed);padding:1px 6px">pressed</span> <span style="background:var(--fill-disabled);padding:1px 6px">disabled</span></span>.
- Borders: <span style="border:1px solid var(--border);padding:2px 10px">border</span> <span style="border:1px solid var(--border-soft);padding:2px 10px">border-soft</span>.

## Usage

- Reach for a role, never a hue: `--accent` for the one action, `--error` for a failure, `--warn` for a caution, `--snap` for a snap indicator, because a second meaning per hue makes the interface unreadable at a glance.
- Hover and selection are fills, not colour changes — `--hover`, `--fill-active`, `--fill-pressed` over whatever surface the control sits on — because a hue swap changes a control's meaning, while a fill step only moves it.
- Disabled is a lighter ink (`--text-disabled`) on an unchanged fill (`--fill-disabled`), because a disabled control should read as unavailable, not as a different control.
- On an accent fill the label is `--on-accent`, never `--text`, because the fill is the same in both themes' buttons and the ink must stay readable on it; on the error fill it is `--on-error`, because the dark error fill is darker than the dark accent and the accent's ink misses 4.5 on it.
- Accent-coloured text is `--text-accent`, never `--accent`, because the accent is tuned as a fill and a stroke (3:1) and in light it misses 4.5 as text on every surface but the lightest.
- A focus ring is `--focus-ring`, never `--accent`, because a ring crosses the selected and hover fills and the light accent drops under 3:1 against them.
- The drawing area keeps its own colours (`--canvas`, `--grid-*`, `--axis-*`) in both themes, because a drawing's paper should not change when the chrome's theme does.
- `--text-faint` is the lowest ink a reader must still read; anything quieter is `--text-disabled`, which only disabled controls carry, because an enabled control a reader cannot read is a bug, not a hierarchy.

## Accessibility

Contrast, measured by `node scripts/contrast-report.mjs` (run from the app folder), WCAG 2.x. Every cell is the foreground composited over that surface: ratio, then ✓ at the token's threshold (4.5:1 text, 3:1 icons and borders), ✗ below it, · for the fills, which carry no threshold — their cell shows how visible the step is against the surface.

### dark (default)

| foreground \ surface | `--chrome` | `--chrome-dark` | `--panel` | `--tab-active` | `--control` | `--control-hover` | `--surface-elevated` | `--canvas` | `--list-bg` | `--cmd-bg` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--text` | 16.2 ✓ | 16.8 ✓ | 16.2 ✓ | 15.6 ✓ | 15.0 ✓ | 13.8 ✓ | 14.1 ✓ | 15.6 ✓ | 15.0 ✓ | 15.0 ✓ |
| `--text-dim` | 9.2 ✓ | 9.4 ✓ | 9.2 ✓ | 8.9 ✓ | 8.7 ✓ | 8.2 ✓ | 8.3 ✓ | 8.9 ✓ | 8.7 ✓ | 8.7 ✓ |
| `--text-faint` | 6.4 ✓ | 6.5 ✓ | 6.4 ✓ | 6.3 ✓ | 6.1 ✓ | 5.9 ✓ | 6.0 ✓ | 6.3 ✓ | 6.1 ✓ | 6.1 ✓ |
| `--text-disabled` | 3.1 · | 3.0 · | 3.1 · | 3.1 · | 3.1 · | 3.0 · | 3.0 · | 3.1 · | 3.1 · | 3.1 · |
| `--icon` | 7.5 ✓ | 7.6 ✓ | 7.5 ✓ | 7.3 ✓ | 7.2 ✓ | 6.8 ✓ | 6.9 ✓ | 7.3 ✓ | 7.2 ✓ | 7.2 ✓ |
| `--icon-accent` | 6.4 ✓ | 6.7 ✓ | 6.4 ✓ | 6.2 ✓ | 6.0 ✓ | 5.5 ✓ | 5.6 ✓ | 6.2 ✓ | 6.0 ✓ | 6.0 ✓ |
| `--icon-point` | 10.1 ✓ | 10.5 ✓ | 10.1 ✓ | 9.7 ✓ | 9.3 ✓ | 8.6 ✓ | 8.8 ✓ | 9.7 ✓ | 9.3 ✓ | 9.3 ✓ |
| `--accent` | 6.4 ✓ | 6.7 ✓ | 6.4 ✓ | 6.2 ✓ | 6.0 ✓ | 5.5 ✓ | 5.6 ✓ | 6.2 ✓ | 6.0 ✓ | 6.0 ✓ |
| `--warn` | 10.1 ✓ | 10.5 ✓ | 10.1 ✓ | 9.7 ✓ | 9.3 ✓ | 8.6 ✓ | 8.8 ✓ | 9.7 ✓ | 9.3 ✓ | 9.3 ✓ |
| `--error` | 4.7 ✓ | 4.9 ✓ | 4.7 ✓ | 4.5 ✓ | 4.4 ✓ | 4.0 ✓ | 4.1 ✓ | 4.5 ✓ | 4.4 ✓ | 4.4 ✓ |
| `--snap` | 5.8 ✓ | 6.0 ✓ | 5.8 ✓ | 5.6 ✓ | 5.3 ✓ | 4.9 ✓ | 5.0 ✓ | 5.6 ✓ | 5.3 ✓ | 5.3 ✓ |
| `--toggle-on` | 5.8 ✓ | 6.0 ✓ | 5.8 ✓ | 5.6 ✓ | 5.3 ✓ | 4.9 ✓ | 5.0 ✓ | 5.6 ✓ | 5.3 ✓ | 5.3 ✓ |
| `--cmd-keyword` | 6.4 ✓ | 6.7 ✓ | 6.4 ✓ | 6.2 ✓ | 6.0 ✓ | 5.5 ✓ | 5.6 ✓ | 6.2 ✓ | 6.0 ✓ | 6.0 ✓ |
| `--hover` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.3 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · |
| `--fill-active` (fill) | 1.5 · | 1.4 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · |
| `--fill-pressed` (fill) | 1.8 · | 1.7 · | 1.8 · | 1.8 · | 1.8 · | 1.8 · | 1.8 · | 1.8 · | 1.8 · | 1.8 · |
| `--fill-disabled` (fill) | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · |
| `--accent-soft` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · |
| `--cmd-keyword-hover` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · |
| `--border` (fill) | 1.4 · | 1.3 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · |
| `--border-soft` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.3 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · |
| `--scrollbar` (fill) | 1.5 · | 1.4 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · |
| `--scrollbar-hover` (fill) | 1.9 · | 1.9 · | 1.9 · | 1.9 · | 1.9 · | 2.0 · | 2.0 · | 1.9 · | 1.9 · | 1.9 · |
| `--composer-border` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.3 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · |
| `--composer-border-active` (fill) | 1.4 · | 1.3 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · | 1.4 · |
| `--cmd-history` (fill) | 1.0 · | 1.1 · | 1.0 · | 1.0 · | 1.0 · | 1.1 · | 1.1 · | 1.0 · | 1.0 · | 1.0 · |

`--on-accent` on the action fills: `--accent` 6.0 ✓; `--accent-hover` 6.7 ✓; `--accent-pressed` 7.5 ✓; `--error` 4.4 ✗; `--error-hover` 5.0 ✓; `--error-pressed` 5.6 ✓; `--selection` 6.0 ✓.

Below threshold: on-accent over error 4.4:1 (needs 4.5:1)

### light

| foreground \ surface | `--chrome` | `--chrome-dark` | `--panel` | `--tab-active` | `--control` | `--control-hover` | `--surface-elevated` | `--canvas` | `--list-bg` | `--cmd-bg` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--text` | 17.3 ✓ | 16.6 ✓ | 18.0 ✓ | 18.0 ✓ | 15.0 ✓ | 13.7 ✓ | 18.0 ✓ | 1.0 ✗ | 18.4 ✓ | 15.5 ✓ |
| `--text-dim` | 7.7 ✓ | 7.5 ✓ | 7.8 ✓ | 7.8 ✓ | 7.1 ✓ | 6.7 ✓ | 7.8 ✓ | 1.0 ✗ | 7.9 ✓ | 7.2 ✓ |
| `--text-faint` | 5.8 ✓ | 5.7 ✓ | 5.9 ✓ | 5.9 ✓ | 5.5 ✓ | 5.2 ✓ | 5.9 ✓ | 1.0 ✗ | 5.9 ✓ | 5.5 ✓ |
| `--text-disabled` | 2.3 · | 2.3 · | 2.3 · | 2.3 · | 2.2 · | 2.2 · | 2.3 · | 1.0 · | 2.3 · | 2.3 · |
| `--icon` | 5.8 ✓ | 5.7 ✓ | 5.9 ✓ | 5.9 ✓ | 5.5 ✓ | 5.2 ✓ | 5.9 ✓ | 1.0 ✗ | 5.9 ✓ | 5.5 ✓ |
| `--icon-accent` | 4.4 ✓ | 4.2 ✓ | 4.5 ✓ | 4.5 ✓ | 3.8 ✓ | 3.4 ✓ | 4.5 ✓ | 3.8 ✓ | 4.6 ✓ | 3.9 ✓ |
| `--icon-point` | 3.4 ✓ | 3.3 ✓ | 3.5 ✓ | 3.5 ✓ | 3.0 ✗ | 2.7 ✗ | 3.5 ✓ | 4.9 ✓ | 3.6 ✓ | 3.0 ✓ |
| `--accent` | 4.4 ✓ | 4.2 ✓ | 4.5 ✓ | 4.5 ✓ | 3.8 ✓ | 3.4 ✓ | 4.5 ✓ | 3.8 ✓ | 4.6 ✓ | 3.9 ✓ |
| `--warn` | 4.4 ✓ | 4.2 ✓ | 4.5 ✓ | 4.5 ✓ | 3.8 ✓ | 3.5 ✓ | 4.5 ✓ | 3.8 ✓ | 4.6 ✓ | 3.9 ✓ |
| `--error` | 5.8 ✓ | 5.6 ✓ | 6.0 ✓ | 6.0 ✓ | 5.0 ✓ | 4.6 ✓ | 6.0 ✓ | 2.9 ✗ | 6.2 ✓ | 5.2 ✓ |
| `--snap` | 5.8 ✓ | 5.6 ✓ | 6.0 ✓ | 6.0 ✓ | 5.0 ✓ | 4.6 ✓ | 6.0 ✓ | 2.9 ✗ | 6.2 ✓ | 5.2 ✓ |
| `--toggle-on` | 5.8 ✓ | 5.6 ✓ | 6.0 ✓ | 6.0 ✓ | 5.0 ✓ | 4.6 ✓ | 6.0 ✓ | 2.9 ✗ | 6.2 ✓ | 5.2 ✓ |
| `--cmd-keyword` | 4.4 ✗ | 4.2 ✗ | 4.5 ✓ | 4.5 ✓ | 3.8 ✗ | 3.4 ✗ | 4.5 ✓ | 3.8 ✗ | 4.6 ✓ | 3.9 ✗ |
| `--hover` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.0 · | 1.2 · | 1.2 · |
| `--fill-active` (fill) | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.0 · | 1.3 · | 1.3 · |
| `--fill-pressed` (fill) | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.5 · | 1.0 · | 1.5 · | 1.5 · |
| `--fill-disabled` (fill) | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.1 · | 1.0 · | 1.1 · | 1.1 · |
| `--accent-soft` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.1 · | 1.2 · | 1.1 · | 1.2 · | 1.2 · |
| `--cmd-keyword-hover` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.1 · | 1.2 · | 1.1 · | 1.2 · | 1.2 · |
| `--border` (fill) | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.0 · | 1.3 · | 1.3 · |
| `--border-soft` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.0 · | 1.2 · | 1.2 · |
| `--scrollbar` (fill) | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.0 · | 1.3 · | 1.3 · |
| `--scrollbar-hover` (fill) | 1.6 · | 1.6 · | 1.6 · | 1.6 · | 1.6 · | 1.6 · | 1.6 · | 1.0 · | 1.6 · | 1.6 · |
| `--composer-border` (fill) | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.2 · | 1.0 · | 1.2 · | 1.2 · |
| `--composer-border-active` (fill) | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.3 · | 1.0 · | 1.3 · | 1.3 · |
| `--cmd-history` (fill) | 1.1 · | 1.0 · | 1.1 · | 1.1 · | 1.1 · | 1.2 · | 1.1 · | 15.9 · | 1.1 · | 1.1 · |

`--on-accent` on the action fills: `--accent` 4.5 ✓; `--accent-hover` 5.4 ✓; `--accent-pressed` 6.4 ✓; `--error` 6.0 ✓; `--error-hover` 7.0 ✓; `--error-pressed` 8.3 ✓; `--selection` 4.5 ✓.

Below threshold: text over canvas 1.0:1 (needs 4.5:1); text-dim over canvas 1.0:1 (needs 4.5:1); text-faint over canvas 1.0:1 (needs 4.5:1); icon over canvas 1.0:1 (needs 3:1); icon-point over control 3.0:1 (needs 3:1); icon-point over control-hover 2.7:1 (needs 3:1); error over canvas 2.9:1 (needs 3:1); snap over canvas 2.9:1 (needs 3:1); toggle-on over canvas 2.9:1 (needs 3:1); cmd-keyword over chrome 4.4:1 (needs 4.5:1); cmd-keyword over chrome-dark 4.2:1 (needs 4.5:1); cmd-keyword over control 3.8:1 (needs 4.5:1); cmd-keyword over control-hover 3.4:1 (needs 4.5:1); cmd-keyword over canvas 3.8:1 (needs 4.5:1); cmd-keyword over cmd-bg 3.9:1 (needs 4.5:1)

`--on-accent` over `--error` (4.4 in dark) is no longer a pair the app draws: the danger button's label is `--on-error`, 4.72 there.

### The layer's pairs

The nine components of `src/ui/`, measured in the running app on 2026-11-11 from the browser's computed token colours (WCAG 2.x): each ink composited over its own fill over every surface the component sits on, with the lowest ratio and the surface it falls on. Text needs 4.5:1; a glyph and a focus ring need 3:1; a disabled state is exempt. Before is the layer as it stood that morning; after is the layer with `--text-accent`, `--focus-ring`, `--on-error` and the light action steps. The report above does not list the three new tokens: its ink list lives in `scripts/contrast-report.mjs`.

| Component | State | Theme | Lowest on | Before | After | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| Button secondary | rest label | dark | `--surface-elevated` | 11.32 | 11.32 | 4.5 |
| Button secondary | hover/pressed label | dark | `--surface-elevated` | 9.39 | 9.39 | 4.5 |
| Button secondary | disabled label | dark | `--surface-elevated` | 2.96 | 2.96 | exempt |
| Button primary | rest label | dark | `--chrome` | 5.96 | 5.96 | 4.5 |
| Button primary | hover label | dark | `--chrome` | 6.70 | 6.70 | 4.5 |
| Button primary | pressed label | dark | `--chrome` | 7.52 | 7.52 | 4.5 |
| Button ghost | rest label | dark | `--surface-elevated` | 14.13 | 14.13 | 4.5 |
| Button ghost | hover label | dark | `--surface-elevated` | 11.32 | 11.32 | 4.5 |
| Button ghost | pressed label | dark | `--surface-elevated` | 9.39 | 9.39 | 4.5 |
| Button ghost | disabled label | dark | `--surface-elevated` | 3.04 | 3.04 | exempt |
| Button danger | rest label | dark | `--chrome` | 4.37 | 4.72 | 4.5 |
| Button danger | hover label | dark | `--chrome` | 4.96 | 5.36 | 4.5 |
| Button danger | pressed label | dark | `--chrome` | 5.65 | 6.10 | 4.5 |
| Button secondary | focus ring vs fill | dark | `--surface-elevated` | 4.51 | 4.51 | 3 |
| Button primary | focus ring vs fill | dark | `--chrome` | 1.00 | 5.96 | 3 |
| Button danger | focus ring vs fill | dark | `--chrome` | 1.36 | 4.72 | 3 |
| IconButton ghost | rest glyph | dark | `--surface-elevated` | 6.90 | 6.90 | 3 |
| IconButton ghost | hover glyph | dark | `--surface-elevated` | 11.32 | 11.32 | 3 |
| IconButton ghost | pressed glyph | dark | `--surface-elevated` | 9.39 | 9.39 | 3 |
| IconButton ghost | disabled glyph | dark | `--surface-elevated` | 3.04 | 3.04 | exempt |
| IconButton any | selected glyph | dark | `--surface-elevated` | 9.39 | 9.39 | 3 |
| IconButton soft | rest glyph | dark | `--surface-elevated` | 5.90 | 5.90 | 3 |
| IconButton soft | hover glyph | dark | `--surface-elevated` | 9.39 | 9.39 | 3 |
| IconButton soft | pressed glyph | dark | `--surface-elevated` | 7.73 | 7.73 | 3 |
| IconButton inverted | rest glyph | dark | `--chrome` | 14.98 | 14.98 | 3 |
| IconButton inverted | hover glyph | dark | `--chrome-dark` | 8.37 | 8.37 | 3 |
| IconButton inverted | pressed glyph | dark | `--chrome-dark` | 5.77 | 5.77 | 3 |
| IconButton ghost | focus ring vs surface | dark | `--surface-elevated` | 5.62 | 5.62 | 3 |
| IconButton any | focus ring vs selected fill | dark | `--surface-elevated` | 3.74 | 3.74 | 3 |
| IconButton inverted | focus ring vs fill | dark | `--chrome` | 2.51 | 14.98 | 3 |
| Chip neutral | text | dark | `--surface-elevated` | 5.95 | 5.95 | 4.5 |
| Chip neutral | hover text | dark | `--surface-elevated` | 5.17 | 5.17 | 4.5 |
| Chip neutral | pressed text | dark | `--surface-elevated` | 4.54 | 4.54 | 4.5 |
| Chip accent | text | dark | `--surface-elevated` | 4.68 | 4.68 | 4.5 |
| Chip accent | hover text | dark | `--surface-elevated` | 4.51 | 4.51 | 4.5 |
| Chip accent | pressed text | dark | `--surface-elevated` | 3.74 | 4.51 | 4.5 |
| Chip accent | text (command line) | dark | `--cmd-bg` | 5.01 | 5.01 | 4.5 |
| Field | value | dark | `--control` | 14.95 | 14.95 | 4.5 |
| Field | placeholder | dark | `--control` | 6.15 | 6.15 | 4.5 |
| Field | disabled value | dark | `--control` | 3.07 | 3.07 | exempt |
| Field | focus ring vs field | dark | `--control` | 5.95 | 5.95 | 3 |
| Field | focus ring vs surface | dark | `--surface-elevated` | 5.62 | 5.62 | 3 |
| Row | rest text | dark | `--surface-elevated` | 8.31 | 8.31 | 4.5 |
| Row | hover text | dark | `--surface-elevated` | 6.98 | 6.98 | 4.5 |
| Row | selected text | dark | `--surface-elevated` | 9.39 | 9.39 | 4.5 |
| Row | disabled text | dark | `--surface-elevated` | 3.04 | 3.04 | exempt |
| Row | focus ring vs selected fill | dark | `--surface-elevated` | 3.74 | 3.74 | 3 |
| Tab md | unselected label | dark | `--chrome` | 6.39 | 6.39 | 4.5 |
| Tab md | hover label | dark | `--chrome` | 13.35 | 13.35 | 4.5 |
| Tab md | selected label | dark | `--tab-active` | 15.58 | 15.58 | 4.5 |
| Tab sm | unselected label | dark | `--tab-active` | 6.28 | 6.28 | 4.5 |
| Tab sm | hover label | dark | `--tab-active` | 12.72 | 12.72 | 4.5 |
| Tab sm | selected label | dark | `--tab-active` | 10.57 | 10.57 | 4.5 |
| Tab sm | focus ring vs selected fill | dark | `--tab-active` | 4.21 | 4.21 | 3 |
| Kbd | text | dark | `--surface-elevated` | 5.95 | 5.95 | 4.5 |
| Kbd | text in a selected row | dark | `--surface-elevated` | 4.54 | 4.54 | 4.5 |
| Tooltip | text | dark | `--tooltip-bg` | 16.17 | 16.17 | 4.5 |
| SectionLabel | text | dark | `--surface-elevated` | 5.95 | 5.95 | 4.5 |
| Button secondary | rest label | light | `--control` | 12.81 | 12.81 | 4.5 |
| Button secondary | hover/pressed label | light | `--control` | 11.28 | 11.28 | 4.5 |
| Button secondary | disabled label | light | `--control` | 2.22 | 2.22 | exempt |
| Button primary | rest label | light | `--chrome` | 4.51 | 4.51 | 4.5 |
| Button primary | hover label | light | `--chrome` | 3.77 | 5.35 | 4.5 |
| Button primary | pressed label | light | `--chrome` | 3.20 | 6.41 | 4.5 |
| Button ghost | rest label | light | `--control` | 15.04 | 15.04 | 4.5 |
| Button ghost | hover label | light | `--control` | 12.81 | 12.81 | 4.5 |
| Button ghost | pressed label | light | `--control` | 11.28 | 11.28 | 4.5 |
| Button ghost | disabled label | light | `--control` | 2.25 | 2.25 | exempt |
| Button danger | rest label | light | `--chrome` | 6.03 | 6.03 | 4.5 |
| Button danger | hover label | light | `--chrome` | 5.25 | 7.04 | 4.5 |
| Button danger | pressed label | light | `--chrome` | 4.46 | 8.27 | 4.5 |
| Button secondary | focus ring vs fill | light | `--control` | 3.22 | 4.71 | 3 |
| Button primary | focus ring vs fill | light | `--chrome` | 1.00 | 4.51 | 3 |
| Button danger | focus ring vs fill | light | `--chrome` | 1.34 | 6.03 | 3 |
| IconButton ghost | rest glyph | light | `--control` | 5.45 | 5.45 | 3 |
| IconButton ghost | hover glyph | light | `--control` | 12.81 | 12.81 | 3 |
| IconButton ghost | pressed glyph | light | `--control` | 11.28 | 11.28 | 3 |
| IconButton ghost | disabled glyph | light | `--control` | 2.25 | 2.25 | exempt |
| IconButton any | selected glyph | light | `--control` | 11.28 | 11.28 | 3 |
| IconButton soft | rest glyph | light | `--control` | 5.08 | 5.08 | 3 |
| IconButton soft | hover glyph | light | `--control` | 11.28 | 11.28 | 3 |
| IconButton soft | pressed glyph | light | `--control` | 9.87 | 9.87 | 3 |
| IconButton inverted | rest glyph | light | `--chrome` | 17.96 | 17.96 | 3 |
| IconButton inverted | hover glyph | light | `--list-bg` | 7.72 | 7.72 | 3 |
| IconButton inverted | pressed glyph | light | `--list-bg` | 5.78 | 5.78 | 3 |
| IconButton ghost | focus ring vs surface | light | `--control` | 3.78 | 5.53 | 3 |
| IconButton any | focus ring vs selected fill | light | `--control` | 2.83 | 4.14 | 3 |
| IconButton inverted | focus ring vs fill | light | `--chrome` | 3.98 | 17.96 | 3 |
| Chip neutral | text | light | `--control` | 5.45 | 5.45 | 4.5 |
| Chip neutral | hover text | light | `--control` | 5.08 | 5.08 | 4.5 |
| Chip neutral | pressed text | light | `--control` | 4.78 | 4.78 | 4.5 |
| Chip accent | text | light | `--control` | 3.28 | 4.80 | 4.5 |
| Chip accent | hover text | light | `--control` | 3.22 | 4.71 | 4.5 |
| Chip accent | pressed text | light | `--control` | 2.83 | 4.71 | 4.5 |
| Chip accent | text (command line) | light | `--cmd-bg` | 3.37 | 4.93 | 4.5 |
| Field | value | light | `--control` | 15.04 | 15.04 | 4.5 |
| Field | placeholder | light | `--control` | 5.45 | 5.45 | 4.5 |
| Field | disabled value | light | `--control` | 2.25 | 2.25 | exempt |
| Field | focus ring vs field | light | `--control` | 3.78 | 5.53 | 3 |
| Field | focus ring vs surface | light | `--control` | 3.78 | 5.53 | 3 |
| Row | rest text | light | `--control` | 7.11 | 7.11 | 4.5 |
| Row | hover text | light | `--control` | 6.49 | 6.49 | 4.5 |
| Row | selected text | light | `--control` | 11.28 | 11.28 | 4.5 |
| Row | disabled text | light | `--control` | 2.25 | 2.25 | exempt |
| Row | focus ring vs selected fill | light | `--control` | 2.83 | 4.14 | 3 |
| Tab md | unselected label | light | `--chrome-dark` | 5.68 | 5.68 | 4.5 |
| Tab md | hover label | light | `--chrome-dark` | 14.11 | 14.11 | 4.5 |
| Tab md | selected label | light | `--tab-active` | 17.96 | 17.96 | 4.5 |
| Tab sm | unselected label | light | `--chrome` | 5.79 | 5.79 | 4.5 |
| Tab sm | hover label | light | `--chrome` | 14.73 | 14.73 | 4.5 |
| Tab sm | selected label | light | `--chrome` | 12.94 | 12.94 | 4.5 |
| Tab sm | focus ring vs selected fill | light | `--chrome` | 3.25 | 4.75 | 3 |
| Kbd | text | light | `--control` | 5.45 | 5.45 | 4.5 |
| Kbd | text in a selected row | light | `--control` | 4.78 | 4.78 | 4.5 |
| Tooltip | text | light | `--tooltip-bg` | 17.35 | 17.35 | 4.5 |
| SectionLabel | text | light | `--control` | 5.45 | 5.45 | 4.5 |

The accent chip on the command line itself, read from the rendered chip (11px, `--cmd-bg`): light 3.37 before, 4.93 after; dark 5.01, unchanged.

## Not tokens

- The wasm canvas draws its primitives' colours from the tokens through `src/canvas.ts`; its fallback literals (`#181818`, `#202020`, …) only apply when a token is missing, and the palette it reads is the token list above.
- The `axis-x`/`axis-y` hues and the layer glyph colours are fixed in both themes on purpose: they identify canvas objects, not chrome roles.
