# Migration plan: CADCraft to its own layer at 2d63b6b

System: `crates/ui-egui/src/theme.rs` (Tokens + the measured recipe constants) and
`crates/ui-egui/src/widgets.rs` (7 canonical widgets) at commit **2d63b6b**, done — the build's
harden run; specs `docs/system/components/*.md`, check `cargo xtask system-check`.
Counts: imports 0, raw 168, palette 0, files 0, unassigned 0 (`inventory/counts.txt`;
`cargo xtask system-check --no-ratchet` = 168 findings, run twice with byte-identical output;
`inventory/current.tsv` = 168 rows + header).
Blind spots: the check's five — the rendered result (contrast, optical size, spacing); a control
drawn by hand from tokens with no literal left to see; a value that matches no token today (frozen,
not blessed); literals after a `//` on the same line or below a file's first `mod tests`; files
outside `crates/ui-egui/src`.

What "legacy" is here: there is no legacy component library and no palette scale to migrate off.
The app's problem is **bypasses** — 15 surfaces paint their own controls and values instead of
reading `theme.rs` and calling `widgets.rs`. So the four counts map onto this stack as: imports 0
(nothing to import away), **raw = the check's 168 findings** (`rule/raw-value` 55,
`rule/raw-hairline` 55, `rule/raw-radius` 49, `rule/raw-font` 7, `rule/raw-height` 2), palette 0,
files 0. `inventory/legacy.txt` is the five rules; `inventory/ignore.txt` excludes tests, the token
source and the widgets.

## Surfaces

One row per surface (`queue.tsv`). M = model-space findings (the drawing's own colours: leave
them), C = chrome/overlay findings (tokenize). Components are from the system's seven:
button, icon_button, field, chip, row, card, section_label.

| surface | paths | findings | M | C | components it would use | states | tier |
|---|---|---|---|---|---|---|---|
| layers | `crates/ui-egui/src/layers.rs` | 17 | 0 | 17 | button, icon_button, field, row, card, section_label | default, hover, selected, edit-name | high |
| canvas | `crates/ui-egui/src/canvas.rs` | 38 | 24 | 14 | none (theme constants: HAIRLINE, RADIUS_CONTROL) | default, selection, grip-hot, cycle | high |
| chrome | `crates/ui-egui/src/chrome.rs`, `chrome/**`, `vpscale.rs`, `i18n/tests.rs` | 15 | 0 | 15 | button, icon_button, chip, field, row, section_label | default, hover, toggle-off, toggle-on | high |
| cmdline | `crates/ui-egui/src/cmdline.rs` | 4 | 0 | 4 | field, button | idle, typing, keyword, autocomplete, history | high |
| palettes | `crates/ui-egui/src/palettes.rs`, `palettes/**` | 11 | 0 | 11 | button, icon_button, field, row, section_label, chip | default, hover, collapsed, selected | high |
| assistant | `crates/ui-egui/src/assistant.rs` | 3 | 0 | 3 | button, icon_button, field, card, row, chip | idle, streaming, queued, card | high |
| canvas-overlays | `crates/ui-egui/src/canvas/**`, `dyngrips.rs` | 6 | 3 | 3 | none (theme constants: HAIRLINE, RADIUS_CARD) | compare, bedit, grip-drag | mid |
| parametric | `crates/ui-egui/src/parametric.rs` | 18 | 0 | 18 | none (theme constants; chip grammar for the DOF readout) | bars, over, under, editing | mid |
| viewcube | `crates/ui-egui/src/viewcube.rs` | 14 | 0 | 14 | none (theme constants; card grammar for the UCS menu) | default, hover, ring, ucs-menu | mid |
| icons | `crates/ui-egui/src/icons.rs` | 17 | 0 | 17 | icon_button (its focus ring) | rest, hover, focus | mid |
| grip_dyn | `crates/ui-egui/src/grip_dyn.rs` | 7 | 0 | 7 | field | active, locked, tab | mid |
| mtext_editor | `crates/ui-egui/src/mtext_editor.rs` | 5 | 0 | 5 | button, icon_button, field, chip | editing, toolbar-hover, ruler | mid |
| docking | `crates/ui-egui/src/docking.rs` | 0 | 0 | 0 | none (the dock style already reads tokens) | tab-active, drag | mid |
| dialogs | `crates/ui-egui/src/managers.rs`, `opening.rs` | 4 | 0 | 4 | button, field, row, card, section_label | default, hover, progress | mid |
| options | `crates/ui-egui/src/options/**` | 5 | 0 | 5 | button, field, row, section_label, chip | tab, hover, preview | low |
| bedit | `crates/ui-egui/src/bedit.rs` | 4 | 0 | 4 | button, field, card | authoring, editing, preview | low |

Totals: 168 findings — 113 mechanical swaps (96 chrome, 17 model-space), 35 chrome colour roles,
12 data conversions (9 chrome, 3 model-space), 7 model-space colour literals kept, 1 existing role.

### Which findings are model-space, and which are chrome

**Model-space (27) — leave the drawing's colours alone.** The build's Frame excludes them and the
person's clearance keeps them "still following the drawing". The edit run allowlists the colour
literals here; the mechanical swaps among them still land, because they hold the same value and
touch no colour.

- `canvas` (24): 267, 273, 1266 (entity/selection colour conversions); 731, 740, 749, 752, 773
  (grid + axes); 914, 1089, 1142 (entity primitives); 1328×2 (snap label fill + radius); 1337
  (snap tracking); 1895×2 (printable area); 1932 (clip boundary); 2051, 2056×2 (grips); 2095
  (crossing/window); 2415 (crosshair); 2673, 2677 (UCS icon + its label). The kept colour
  literals: 1328, 1895, 1932, 2051, 2056 — the rest are width/radius/font swaps.
- `canvas-overlays` (3): `dyngrips.rs` 90, 94×2 (dynamic-block grip markers; the kept literals
  0xff7f9f and 0x103080 match `canvas.rs:2051`/`2056`).

**Chrome/overlay (141) — tokenize.** Everything else, per surface:

- `canvas` (14): 2291 (cycle badge), 2320, 2321×2, 2327 (cycle list), 2340 (tooltip frame),
  2527, 2528×2, 2538 (options menu), 2644, 2645, 2646, 2651 (dynamic-input boxes).
- `canvas-overlays` (3): `compare.rs` 63, 70 (COMPARE bar + area outline), `blockedit.rs` 46
  (block-editor bar).
- `parametric` (18): 56, 57, 58, 275, 293 (constraint + DOF colours), 294, 392, 462, 463, 464×2,
  469×2, 471, 477, 488 (constraint bars + chips), 636 (Parameters Manager's error label).
- `viewcube` (14): 86×2, 88×2, 90, 97×2, 98, 99×3, 100×2, 144 (ring, faces, edges, labels, the
  UCS menu).
- `icons` (17): 452 (the gradient ramp), 681, 683, 684, 688, 695×2, 697, 700, 709, 717 (layer
  states + glyphs), 831, 832, 852 (plot/paper glyphs), 956, 988×2 (the icon_button focus ring).
- `layers` (17): 32, 42×2, 60, 92, 140 (swatch strokes + row chrome), 173, 185 (preview lines),
  198, 506 (on/off state marks), 430, 466, 468, 520, 541, 575, 598 (rows + buttons).
- `chrome` (15): `chrome.rs` 78, 127, 146, 237, 374, 455, 502, 504, 535; `annoscale.rs` 26;
  `vpscale.rs` 125, 142; `i18n/tests.rs` 500, 506, 508 (test-only — see A-17).
- `palettes` (11): `palettes.rs` 325, 326×2, 420, 422, 462, 463, 890; `patterns.rs` 68, 83, 84.
- `grip_dyn` (7): 152, 192, 193, 208, 209×2, 214.
- `mtext_editor` (5): 91, 129, 276, 457, 537.
- `options` (5): `dialog.rs` 119, 134, 509×2; `mod.rs` 114.
- `cmdline` (4): 512, 568, 574, 633 (633 = the local BAR_SHADOW copy; G-05's role exists).
- `bedit` (4): 137, 138×2, 185.
- `assistant` (3): 532, 869, 894.
- `dialogs` (4): `managers.rs` 270, 1071, 1075; `opening.rs` 87.

## Shared layer work

One agent, alone, before the fan-out (the skill's Shared layer phase): add the 35 chrome colour
roles to `crates/ui-egui/src/theme.rs` (the single writer), each holding today's literal value, so
every surface's swap stays value-identical. Nothing else is shared: no system package, no lockfile,
no providers — the system is the app's own layer (build D-03), and `widgets.rs` already exists.
The 96 chrome mechanical swaps, the 9 chrome conversions (allowlist) and `cmdline`'s existing
`theme::BAR_SHADOW` need no shared work.

## Parity

No legacy call sites exist (imports 0), so there is no `parity.tsv`: the migration's parity
question is per finding, and every answer is one of — mechanical (113: the constant holds the same
value), role (35: the shared layer adds it, value-identical), conversion (9: allowlisted),
existing (1: `theme::BAR_SHADOW`). No blocking row; fan-out waits only on the shared layer.

## Gaps for the system owner

The 35 chrome colour literals with no role today, grouped (file:line — surfaces blocked):

- **Constraint colours** (parametric: 56, 57, 58, 275, 293, 462, 464, 469, 471, 636) — the
  constraint-bar chrome (fill 0xb9bec6, stroke 0x6e7580, hover 0xf2f4f7, glyph 0x262b33), the
  dimension colour 0x9fb6d6, and the status trio 0x4caf50 / 0xff8a6a / 0x9fb6d6.
- **ViewCube colours** (viewcube: 86×2, 88, 90, 97×2, 99, 100) — ring, ring-hover, edge, label,
  face, face-hover, face-border.
- **Layer-state and glyph colours** (icons: 681, 683, 684, 688, 695×2, 697, 700, 709, 717, 831,
  832, 852; layers: 198, 506) — layer off/freeze/lock/on, bulb on/off, current, plot/paper marks.
- **Swatch borders** (layers: 42; palettes: 326) — the two grey swatch strokes.
- **The gradient ramp** (icons: 452) — a drawn 9-step ramp; no role fits. Allowlist it.

If a role is refused, its finding goes to `allowlist.tsv` with the reason and the surface verifies
anyway (the skill's default for a missing token).

## Docs coverage

| component | page | twin | sections in order | check |
|---|---|---|---|---|
| button | `docs/system/components/button.md` | `docs/generated/system/components/button.md` | yes | check-spec exit 0 (build) |
| card | `docs/system/components/card.md` | `docs/generated/system/components/card.md` | yes | check-spec exit 0 |
| chip | `docs/system/components/chip.md` | `docs/generated/system/components/chip.md` | yes | check-spec exit 0 |
| field | `docs/system/components/field.md` | `docs/generated/system/components/field.md` | yes | check-spec exit 0 |
| icon-button | `docs/system/components/icon-button.md` | `docs/generated/system/components/icon-button.md` | yes | check-spec exit 0 |
| row | `docs/system/components/row.md` | `docs/generated/system/components/row.md` | yes | check-spec exit 0 |
| section-label | `docs/system/components/section-label.md` | `docs/generated/system/components/section-label.md` | yes | check-spec exit 0 |

The Props sections are written, not generated: no `registry.json` (G-07) and no
`scripts/props-table.mjs` in this stack (build F-04).

## Pilot

`layers` — the Layer manager. It is G-06's file, holds 17 findings (the most outside the drawing
area), draws its own rows, swatches, fields and buttons, and it is the build's named next screen.
One worker, one commit, before/after captures, a verifier that did not write it; then the codemod
is cut from its recipe.

## Codemod candidates

| rewrite | findings | share |
|---|---|---|
| `Stroke::new(1.0, ` → `Stroke::new(theme::HAIRLINE, ` | 55 | 33% |
| radius literal → the `theme::RADIUS_*` constant that holds it | 49 | 29% |
| font literal → `theme::FONT_CHIP` / `theme::FONT_LABEL` / `theme::body()` | 7 | 4% |
| `24.0` control height → `theme::CONTROL_H_INPUT` | 2 | 1% |

113 of 168 findings (67%) are value-identical rewrites a codemod can do; the remaining 55 are 35
colour roles, 12 conversions, 7 model-space literals kept, and 1 existing role.

## Gates

G-01..G-05 applied (the build's defaults landed); G-06 done (in scope — the migration takes
`layers.rs`); G-07 `gate: registry` (no `registry.json` in this stack; default: none — the specs
stay the index). Details in `gates.md`.

## Estimate

15 surfaces with findings (16 rows; `docking` carries none), 7 widget families, window 1 (no
worktrees on this host — build D-07). The codemod does the 113 mechanical swaps in one pass; the
15 surfaces' capture-and-verify is the rest. At the build's measured pace (safe moves: 6 surfaces /
59 findings in ~80 minutes) all 168 findings are about 2 hours; the granted budget is 90 minutes
(20:35–22:05), which covers the 113 mechanical swaps and the first surfaces, with the 35 colour
roles carrying to the next window. Assumptions: the 35 roles land in the shared layer as value-identical
tokens; the model-space colours stay; one writing worker at a time.

## Found, not fixed

One row per surface with findings, per gap for the system owner, per note, and per gate. Nothing
here is fixed by this audit step — audit mode writes no product code.

| ID | Severity | Route | What | Why not fixed | Fix |
|---|---|---|---|---|---|
| A-01 | should-fix | layers | 17 findings (11 mechanical, 3 roles, 3 conversions) | audit mode: no product code in this step | the edit run's pilot (G-06) |
| A-02 | should-fix | canvas | 38 findings — 24 model-space (leave), 14 chrome (6 hairlines, 8 radii) | audit mode | edit run; the 24 stay (allowlist) |
| A-03 | should-fix | parametric | 18 findings (8 mechanical, 10 colour roles) | audit mode | edit run; roles via the shared layer |
| A-04 | should-fix | viewcube | 14 findings (6 mechanical, 8 roles) | audit mode | edit run; roles via the shared layer |
| A-05 | should-fix | icons | 17 findings (3 mechanical, 13 roles, 1 conversion) | audit mode | edit run; roles via the shared layer |
| A-06 | should-fix | chrome | 15 findings (all mechanical; 3 are test-only) | audit mode | edit run; the test-only 3 allowlisted |
| A-07 | should-fix | palettes | 11 findings (9 mechanical, 1 role, 1 conversion) | audit mode | edit run |
| A-08 | should-fix | grip_dyn | 7 findings (all mechanical) | audit mode | edit run |
| A-09 | should-fix | canvas-overlays | 6 findings (3 mechanical, 3 model-space grips) | audit mode | edit run; the 3 grips stay |
| A-10 | should-fix | mtext_editor | 5 findings (4 mechanical, 1 conversion) | audit mode | edit run |
| A-11 | should-fix | options | 5 findings (2 mechanical, 3 conversions) | audit mode | edit run |
| A-12 | should-fix | cmdline | 4 findings (3 mechanical, 1 existing role) | audit mode | edit run; reads `theme::BAR_SHADOW` (G-05) |
| A-13 | should-fix | bedit | 4 findings (all mechanical) | audit mode | edit run |
| A-14 | should-fix | dialogs | 4 findings (all mechanical) | audit mode | edit run |
| A-15 | should-fix | assistant | 3 findings (all mechanical) | audit mode | edit run |
| A-16 | note | - | 12 findings are data conversions (a stored Rgb/Aci colour becomes a `Color32`) | the value is data, not a literal; no role to read | `allowlist.tsv` rows in the edit run |
| A-17 | note | - | 3 findings are test-only (`i18n/tests.rs:500,506,508`) | tests stay as written (standing order 3) | `allowlist.tsv` rows with the reason |
| A-18 | note | - | 27 model-space findings (the drawing's own colours) | the Frame keeps them; the clearance keeps them "following the drawing" | `allowlist.tsv` rows; the mechanical swaps still land |
| A-19 | note | - | the check's five blind spots | by construction | the verifier's visual check covers the rendered result |
| A-20 | note | shared | 35 chrome colour literals have no token role today | out of scope for the audit step | the edit run's shared layer adds them (value-identical) |
| A-21 | gate | - | G-07: no `registry.json` in this stack | not invented; recorded as a gate | default: none — the specs stay the index |

Next: To migrate the 15 surfaces with findings (16 rows; 7 widget families; 168 findings — 113
mechanical, 35 colour roles, 12 allowlist conversions, 7 model-space literals kept, 1 existing
role), reply "Go, 90m". Clearance is already given ("okay fix all in what you found then", 20:35)
and the frame's budget is 90 minutes (20:35–22:05); the codemod's 113 land inside it at the build's
pace, and the 35 colour roles carry to the next window if the clock runs out.
