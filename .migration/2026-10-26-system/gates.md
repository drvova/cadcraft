# Gates

The build's gates, reconciled for the migration. G-01..G-05 are applied (their defaults landed in
the build); G-06 is now in scope (the person's clearance); G-07 is the one new gate this stack
needs (`gate: registry`). No gate reads `todo`.

## G-01. Does the new look go in place or in a new folder?
Default: in place. Status: done (applied). Commit: 313ab2a. From: build G-01.
Opened: 2026-10-26 (build). Answered: default, applied — the interface wears Cursor's system in
place; the migration keeps it there.
Blocks: nothing.

## G-02. The app ships radius 6/8/10/12 (a third-party clone's doc); Cursor's own CSS measures 2/3/4/5. Replace the scale?
Default: the measured values. Status: done (applied). Commit: 104205d. From: build G-02.
Opened: 2026-10-26 (build). Applied: `theme.rs` holds the measured scale; the check's radius
findings all name a `RADIUS_*` constant, so the migration swaps them value-identically.
Blocks: nothing.

## G-03. The palette has no error fill and no foreground that reads on an accent fill. Add `Tokens::error` and `Tokens::on_accent`?
Default: add both. Status: done (applied). Commit: 104205d. From: build G-03.
Blocks: nothing.

## G-04. The Dynamic Input tooltip frame paints radius 6 where the composer measures 5. Fix it?
Default: fix to 5. Status: done (applied). Commit: 2d63b6b. From: build G-04.
Blocks: nothing. (`canvas.rs:2340` now measures `theme::RADIUS_COMPOSER`'s value.)

## G-05. `BAR_SHADOW` is a local const in `cmdline.rs`; it belongs in `theme.rs`. Move it?
Default: move it. Status: done (applied). Commit: 2d63b6b (`theme::BAR_SHADOW` exists). From: build G-05.
Blocks: nothing. The migration's `cmdline` surface deletes the local copy and reads
`theme::BAR_SHADOW` (`cmdline.rs:633` is the one finding it covers).

## G-06. `layers.rs` holds 17 literals the check freezes; the Layer manager's own chrome. Take it in this run?
Default: leave it to the migration. Status: done (in scope). Commit: -. From: build G-06.
Opened: 2026-10-26 (build). Answered by the person's clearance "okay fix all in what you found
then" at 20:35: the migration takes `layers.rs`, and it is the pilot surface.
Blocks: nothing.

## G-07. No `registry.json` in this stack (gate: registry). Add one?
Default: no — reconcile the migration against the specs and `widgets.rs`; the registry stays absent.
Status: gate
Commit: -
From: brief (migrate-audit.1), build F-04.
Opened: 2026-10-26T21:05Z. Asked: person (or the system owner).
Blocks: nothing: the migration reconciles by spec; `check-spec` keeps running `--no-props`, and the
docs' Props sections stay written, not generated.
Options:
  A. No registry; the specs remain the system's index. (default)
  B. Add a `registry.json` + `scripts/props-table.mjs`; Props tables become generated and
     `check-spec` gains example-import checking.
Default if no answer by close: A, with the Props sections reported as written.
