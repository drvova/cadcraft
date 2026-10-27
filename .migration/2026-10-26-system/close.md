# Close: CADCraft's surfaces onto its own layer (2026-10-26)

The migration the audit offered at 20:35 and the person cleared ("okay fix all in what you found
then", G-06): 15 surfaces with findings, one commit per surface group, every swap value-identical.

```
commit        fa2a4b6a1664 (the migration head; the close commit carries this record)
inventory     before 168 raw findings (value 55, hairline 55, radius 49, font 7, height 2); imports 0, palette 0, files 0
              after  19 raw findings (value 19; hairline 0, radius 0, font 0, height 0); imports 0, palette 0, files 0
allowlist     none — this stack keeps no allowlist.tsv; the check's ratchet holds the deliberate remainder
left          19 findings, all deliberate (grouped below); scripts/check-system-ratchet.json = {"rule/raw-value": 19}
surfaces      15 landed of 15 with findings; docking carried 0 (16 queue rows, all done)
verified      15 of 15 landed surfaces in one independent pass (MigrateVerify, did not write the code);
              self-verified: none; unverified: none
still raw     the 19 deliberate findings below
close commit  ok
```

## What landed

| surface | commit | findings before -> after | capture pair (measured) |
|---|---|---|---|
| layers (pilot) | 32a5c96648bd | 17 -> 3 (14 fixed: 11 mechanical, 3 roles) | layers-* pixel-identical |
| chrome | bf50ae292d8e | 15 -> 0 (12 mechanical + the test's 3, fixed) | chrome-* and chrome-start-* identical |
| palettes | bfc9f8dd564d | 11 -> 1 (10 fixed) | palettes-* identical |
| grip_dyn | 95c2955bfc1b | 7 -> 0 | grip_dyn-* identical |
| mtext_editor | 9389430f035b | 5 -> 1 (4 fixed) | mtext_editor-* identical |
| options | af5d1d5cd15e | 5 -> 3 (2 fixed) | options-* identical |
| cmdline | 2c55c8dd2807 | 4 -> 0 | cmdline-* identical |
| bedit | fb2ef10436d0 | 4 -> 0 | bedit-* identical |
| dialogs | b8804b97b3d2 | 4 -> 0 | dialogs-pagesetup-*, dialogs-ptype-* identical |
| assistant | d0193c6151e3 | 3 -> 0 | assistant-* identical |
| viewcube | ad0041ee6e7e | 14 -> 0 | viewcube-* identical |
| parametric | ebfac38e39c9 | 18 -> 0 | parametric-* differ only by the cmdline caret; parametric-manager-* identical |
| icons | e77957292e10 | 17 -> 1 (16 fixed) | icons-* identical |
| canvas | fb86c8d760c3 | 38 -> 8 (30 fixed) | canvas-* identical |
| canvas-overlays (canvas/**, dyngrips.rs) | fb86c8d760c3 + fa2a4b6a1664 | 6 -> 2 (4 fixed: 3 chrome + the dyngrips hairline) | canvas-overlays-* differ only by the cmdline caret; canvas-overlays-compare-* identical |

The shared layer (bf0a7ef4acfd) added 27 roles to `theme.rs`, each holding today's literal.
`docking` carried 0 findings and needed no commit.

## The deliberate remainder, grouped by reason (19)

**11 variable -> `Color32` conversions — the value is data, not a literal; no role can read it.**
canvas.rs 267, 273, 1267 (the drawing's own entity/selection colours); layers.rs 32, 92, 140;
mtext_editor.rs 91; options/dialog.rs 119, 509; options/mod.rs 114; palettes.rs 325.

**7 model-space colour literals — the drawing's own colours, which the Frame excludes from the
system ("still following the drawing").** canvas.rs 1329 (snap label fill), 1896 (printable-area
dashed line), 1933 (clip boundary), 2052 and 2060 (grip markers); dyngrips.rs 90, 94 (the
dynamic-block grip markers, same two values).

**1 icon ramp — a drawn 9-step gradient, not one colour a role can hold.** icons.rs 452.

## Verification (independent pass, MigrateVerify)

- `cargo xtask system-check --no-ratchet` at head: 19 findings, all `rule/raw-value`; the other
  four rules (hairline, radius, font, height) are at 0. Every one of the 19 was opened and is one
  of the three reasons above (the plan's marked model-space lines, the named conversions, the ramp).
- Three diffs spot-checked for value-identity: bf50ae2 (`3.0` -> `RADIUS_SMALL` = 3.0, `1.0` ->
  `HAIRLINE` = 1.0, `13.0` -> `body()` = 13.0, `12.0` -> `FONT_LABEL`/`mono()` = 12.0);
  32a5c96 (`from_gray(25)` -> `swatch_border`, `0x4cc25a` -> `layer_current`, `0xe05050` ->
  `layer_no_plot`, `2.0` -> `RADIUS_CONTROL`, `1.0` -> `HAIRLINE`); 95c2955 (5x `1.0` ->
  `HAIRLINE`, 2x `2.0` -> `RADIUS_CONTROL`).
- Captures: 19 before/after pairs at 2000x1250 (one or two per touched surface), every pair
  decoded and compared pixel-for-pixel: 17 of 19 identical (0 differing pixels); the 2 draw pairs
  (parametric, canvas-overlays) differ by exactly 54 px — the command line's 3x18 caret at
  (666,1181)-(669,1199), drawn in the after and blinking off in the before. Not the swap: the
  command line is not in those commits, and the cmdline pair is pixel-identical. The draw worker's
  "all 7 identical" claim is corrected to 5 of 7 (the two differ only by the caret).
- `cargo xtask system-check --ratchet-update` -> `{"rule/raw-value": 19}`; then
  `cargo xtask system-check` -> exit 0, "no new drift (19 findings held)".
- `cargo xtask ci` -> exit 0, "all 8 steps passed (fmt, clippy, test, i18n, assets, layers,
  system-check, wasm)".
- `check-spec.mjs --no-props docs/system` -> 7 specs, 0 failures (nothing the run deleted or moved).

## Gates

- G-07 (`gate: registry`) is open, default A (no `registry.json`; the specs stay the index).
- G-01..G-06 are applied (see `gates.md`). No gate reads `todo`.
- Montage warnings on open gates: none.

## Found, not fixed

| ID | Severity | Route | What | Why not fixed | Fix |
|---|---|---|---|---|---|
| F-01 | should-fix | decision | the 7 model-space colour literals the drawing still paints (canvas.rs 1329, 1896, 1933, 2052, 2060; dyngrips.rs 90, 94) | the Frame keeps the drawing area's colours; the person's clearance keeps them "still following the drawing" | a decision, then roles if the person wants the drawing tokenized |
| F-02 | note | - | the 11 variable -> `Color32` conversions | the value is data (a stored Rgb/Aci colour), not a literal; no role can read it | none unless the data model changes |
| F-03 | note | - | icons.rs 452's 9-step ramp | a drawn gradient, not a single colour | none |
| F-04 | note | - | G-07 open: no `registry.json` | out of scope for this stack | add one, or accept written Props sections |
| F-05 | note | - | A-17 routed the 3 `i18n/tests.rs` findings to the allowlist; the chrome commit fixed them instead (value-identical: `12.0` -> `FONT_LABEL`/`mono()` = 12.0, same assertions) | the worker's route was better than the audit's, and the test's meaning is unchanged | none |

## Ledger

`ledger.tsv`: 16 surface rows + 1 integration row. Every landed surface carries a `verified`
verdict at its commit; the integration row records the check and the ci gate.
