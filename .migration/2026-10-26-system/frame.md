# Frame: CADCraft to its own layer at 2d63b6b

Mode: full (this run folder is the migration; this step is its audit half — `plan.md` — and the
edit run continues in the same folder).

Done when:
- `cargo xtask system-check --no-ratchet` reports 0 findings outside `inventory/ignore.txt` and
  `allowlist.tsv` on the final commit (imports 0, palette 0, files 0; raw = the check's findings;
  the model-space colours the Frame keeps are allowlisted with reasons)
- all 16 rows in `queue.tsv` are `done` with a `verified` or `self-verified` ledger row at the
  final commit
- the drawing area's model-space colours are unchanged (the allowlist names every kept one)

Scope: `crates/ui-egui/src/**` — the 15 surfaces with findings (168 findings; 16 queue rows,
`docking` carries none).
Out: `crates/ui-egui/src/theme.rs` and `crates/ui-egui/src/widgets.rs` (single-writer; a new role
is the shared layer's one change), tests, `xtask/**`, `scripts/**`.

Target system: CADCraft's own layer — `crates/ui-egui/src/theme.rs` (Tokens + the measured recipe
constants) and `crates/ui-egui/src/widgets.rs` (button, icon_button, field, chip, row, card,
section_label) — pinned to commit **2d63b6b** (HEAD at framing).
Criteria: `docs/system/index.md`, `docs/system/components/*.md`, and `cargo xtask system-check`
(the same files go to every worker, verifier and `ui-review`).

Parity mode: mapped. 113 findings swap to a constant that already holds the value; 1 reads an
existing token (`theme::BAR_SHADOW`); 35 chrome colour literals need a role (the shared layer adds
it, value-identical); 12 are data conversions (allowlist); 7 model-space colour literals stay.

Themes: dark, light (both already ship; the drawing area keeps its colours in both).
Widths: the app's own window 2000x1250 and the narrowest docked pane (a native egui app; no
browser widths).

Budget: 90 minutes wall clock, 20:35 to 22:05 (the person's clearance "okay fix all in what you
found then" at 20:35; build `state.md`). Stop spawning at 70% (21:38).
Window cap: 1 (no worktrees on this host; writing workers run in sequence — build D-07).

Run branch: `main` (the person's standing order in `AGENTS.md`; build D-04). Merging is the
person's call.
May look broken mid-run: nothing — every swap is value-identical or a mapped token, and the
drawing area is not repainted.
Platform: subagents, one writing worker at a time; a verifier that did not write the surface
after each landing.
