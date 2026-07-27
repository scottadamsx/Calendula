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
- **Open, blocks Phase 1**: §6's grid engine reads only from `placements`
  ("no other layer reads `placements` directly" — D11), and step 3 of construction
  says "load overlapping placements, mark blocks by hardness." But nothing in §5 or
  §13 says how a `fixed_blocks` row (especially a recurring one, via `rrule`) becomes
  one or more rows in `placements`. §8.3 gives this explicitly for activity holds
  (insert the hold, then a hard `placements` row) — the seed data
  (`supabase/seed.sql`) follows that pattern for the camping hold, but does *not*
  mirror the seeded `fixed_blocks` rows into `placements`, because no ingestion rule
  says how to expand an RRULE into concrete instances. Resolve before implementing
  `buildGrid()`: is this an ingestion-time job (on fixed_block create/update, expand
  and upsert placements rows for the horizon), or does the grid engine itself expand
  RRULEs on read?
  recommendation: ingestion-time expansion, upserted per horizon window on a nightly
  cron plus on create/update — keeps `buildGrid()` a pure read, matches D2's
  full-horizon-recompute philosophy, and avoids RRULE-parsing inside the hot path.
  blocked-task: Phase 1 — `buildGrid()`.

## Your last task, always

The SPEC-GAP-RETRO audit: enumerate every design decision made during implementation
that isn't in the spec. For each, say what was decided, where in the code, and why it
wasn't escalated. An empty list is a claim — it will be spot-checked against the diff.

## Cadence

Commit at each build-order phase boundary (§16). `git init` already happened —
don't re-run it.
