# Calendula

Full spec: `calendula-v3-documentation.md` at the repo root — read §1–4 and §16 now,
the rest on demand per task. Decision ledger (§15) is locked; don't re-litigate it.
House style: `~/Documents/GitHub/DEVRULES & FORGE/devrules/housestyle.md` and
`housestyle-ui.md` — the visual contract this project inherits, overridden once
(see below).

If implementation requires a decision not present in the spec, STOP. Do not infer.
Emit a `SPEC-GAP` block naming the missing decision, its apparent options, and your
recommended default. Await resolution.

```
SPEC-GAP
decision: <what's missing>
options: <a> | <b>
recommendation: <a, because ...>
blocked-task: <phase/task>
```

## Conventions digest

- **Naming**: table and column names match spec §5 verbatim — solver code should read
  as a direct transcription, not a reinterpretation.
- **Errors**: typed result objects at boundaries (route handlers); throw only for
  programmer error.
- **Styling source of truth**: `src/app/globals.css` (`@theme`, Tailwind v4 CSS-first,
  no `tailwind.config.*`). One deliberate override of `housestyle-ui.md`: the radius
  ramp uses Calendula's own scale (0 / 6 / 10 / 12 / 999) per spec §14.7 and D26 —
  square corners on single-sided-accent elements, not the generic house-style ramp.
  Everything else in the visual contract (control heights, spacing grid, button
  variants, elevation, focus, motion) is unmodified house style bound to Calendula's
  palette.

## Known spec gaps

- `meeting_offer_slots` (§5.7) omits `user_id`, contradicting §5's "every table
  carries user_id" rule. The migration (`supabase/migrations/20260727000000_init.sql`)
  adds it so the standard owner RLS policy covers the table. Flagged, not silently
  patched — revisit if the spec is amended.
- **Resolved for Phase 1** (was open, blocked `buildGrid()`): nothing in §5/§13 said
  how a `fixed_blocks` row, especially a recurring one via `rrule`, becomes rows in
  `placements` — the only table the grid engine reads (D11). Went with the logged
  recommendation: ingestion-time expansion, not expansion inside `buildGrid()` itself.
  `syncFixedBlockPlacements` (`src/lib/scheduler/fixedBlocks.ts`) expands each
  `fixed_blocks` row for a horizon window via `expandFixedBlock` and upserts hard
  `placements` rows, keyed on `(user_id, source_type, source_id, starts_at)` — a
  unique index added in `supabase/migrations/20260727010000_placements_upsert_key.sql`
  — so re-running it is idempotent. Not yet wired to run automatically (no cron or
  on-create/update trigger calls it yet); that's the next open item, not this one.

## RRULE expansion — the one non-obvious piece of Phase 1

`rrule`'s own BYDAY/FREQ math is computed against the UTC instant of `dtstart`, which
drifts a recurring local wall-clock time (e.g. "9am Monday") by the DST delta once a
horizon crosses a boundary. `expandFixedBlock` works around this with a "floating
clock" trick — building the rule against a UTC `Date` whose Y-M-D-H-M fields are
copied from the local wall clock, then reinterpreting each result back as local time
in the real zone. Covered by `src/lib/scheduler/fixedBlocks.test.ts` (crosses the
2026-03-08 America/St_Johns spring-forward). Don't "simplify" this to a plain
`rrule` call against the real UTC `dtstart` — that's the bug this works around.

## Your last task, always

The SPEC-GAP-RETRO audit: enumerate every design decision made during implementation
that isn't in the spec. For each, say what was decided, where in the code, and why it
wasn't escalated. An empty list is a claim — it will be spot-checked against the diff.

## Cadence

Commit at each build-order phase boundary (§16). `git init` already happened —
don't re-run it.
