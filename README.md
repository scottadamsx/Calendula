# Calendula

An autonomous planner that schedules a whole life, not just a job. Full
specification: [`calendula-v3-documentation.md`](./calendula-v3-documentation.md).

**Status: Phase 1 — Grid, read-only.** Schema, RLS, the brand/house-style
system, `buildGrid()`, and a read-only week view are in place. There is no
auto-scheduling yet — no task solver, no habits, no advisor. See the Overview
page (`/`) once running, or the build-phase table in the spec (§16).

## Stack

Next.js App Router · TypeScript strict · Tailwind v4 (CSS-first, `@theme`) ·
Supabase (Postgres + auth, RLS on every table) · Vercel.

## Getting started

```bash
npm install
npm run dev
npm test    # grid + RRULE expansion unit tests, no DB needed
```

Open [http://localhost:3000](http://localhost:3000) and go to **Connectors**.
No terminal, Docker, or Supabase CLI needed: create a free project at
[supabase.com/dashboard](https://supabase.com/dashboard), copy four values
(Project URL, anon key, service role key, and the database connection string
from Project Settings → Database), paste them into the Connect panel, and the
app tests the connection, applies the schema itself, and saves everything to
`.env.local`. A live checklist shows each step going green.

Prefer the terminal / already have a local Supabase stack? `.env.example`
still documents the same four variables — `cp .env.example .env.local` and
fill them in by hand (or `npx supabase start` for a local Postgres instance)
works exactly the same way.

The Settings page shows which environment variables are actually set —
nothing there is faked.

`supabase/seed.sql` creates one local-only synthetic auth user
(`scott@calendula.local`) and the appendix §19 seed data under it. It is safe
only against a local `supabase start` instance — it inserts directly into
`auth.users`, which would be destructive against a real project. The in-app
Connect flow deliberately does not run this — it applies the schema only.

The seeded `fixed_blocks` rows won't appear on the Week page until
`syncFixedBlockPlacements` has run for that horizon — it isn't wired to a
cron or on-create/update trigger yet (see `CLAUDE.md`). Call it manually
against a horizon window to populate `placements` for now.

## House style

This project inherits the visual contract in
`~/Documents/GitHub/DEVRULES & FORGE/devrules/housestyle-ui.md` — token
architecture, control-height ramp, closed button set, elevation, focus,
motion — bound to Calendula's own palette and type (spec §14), with two
deliberate overrides: the radius ramp follows Calendula's own locked corner
rule (spec §14.7, decision D26) rather than the house style's generic scale,
and the neutral base tone was cooled from the spec's warm cream/brown toward
a stone/slate family so Ray-orange reads as an isolated accent rather than a
blanket warm wash (this cooling is a live deviation from written spec §14.3,
not from house style). See `CLAUDE.md` for the full digest, the known spec
gaps, and a Tailwind v4 dark-mode gotcha worth reading before touching
`globals.css` again.

The brand mark blooms centre-out on load on the Overview page (spec §14.6),
generated from the construction rule rather than a canned animation.

## Project structure

```
src/app/                 routes: overview, week, settings, connectors, how-it-works
src/components/brand/    the mark (CalendulaMark)
src/components/shell/    sidebar, topbar, app shell
src/components/ui/       Button, Panel, Badge, PageHeader — the closed set
src/lib/scheduler/
  types.ts               shared solver types (spec §6, §7.1)
  grid.ts                computeGrid() — pure, DST-correct (spec §6), + mergeBySource
  buildGrid.ts            DB wrapper: fetches profile/placements/energy windows, calls computeGrid
  fixedBlocks.ts          expandFixedBlock() (pure, RRULE + DST) + syncFixedBlockPlacements (DB)
  solve.ts                pure Phase 0/1 stub — the real solver is Phase 2
  dispatch.ts             requestSolve — debounced, the only thing callers use
src/lib/supabase/        browser/server/service-role clients, session-refresh proxy
src/lib/db/              runMigrations() — applies supabase/migrations/*.sql via a raw pg connection
src/lib/config/          .env.local upsert helper (preserves unrelated vars)
src/lib/qa/              file-based QA tracker store (qa-status.json)
supabase/migrations/     full §5 schema + RLS, plus the placements upsert key (Phase 1)
supabase/seed.sql        appendix §19 seed data, local dev only (never run by the in-app Connect flow)
qa-status.json           per-phase verified/bugs state, git-tracked
```

## Tests

`npm test` runs the grid engine and RRULE-expansion unit tests
(`src/lib/scheduler/*.test.ts`) — no database required. These are what
actually verify the Phase 1 acceptance criteria from spec §16: contiguous
DST-correct slicing, the no-double-assignment invariant, and travel-buffer
padding. The live end-to-end path (`supabase start` + real RLS check with a
second synthetic user) has not been run on this machine — no Docker
installed. Do that before trusting RLS beyond a read-through of the SQL.
