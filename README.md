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
cp .env.example .env.local   # fill in Supabase + Anthropic keys
npx supabase start           # local Postgres + auth, applies migrations and seed.sql
npm run dev
npm test                     # grid + RRULE expansion unit tests, no DB needed
```

Open [http://localhost:3000](http://localhost:3000). The Settings page shows
which environment variables are actually set — nothing there is faked.

`supabase/seed.sql` creates one local-only synthetic auth user
(`scott@calendula.local`) and the appendix §19 seed data under it. It is safe
only against a local `supabase start` instance — it inserts directly into
`auth.users`, which would be destructive against a real project.

The seeded `fixed_blocks` rows won't appear on the Week page until
`syncFixedBlockPlacements` has run for that horizon — it isn't wired to a
cron or on-create/update trigger yet (see `CLAUDE.md`). Call it manually
against a horizon window to populate `placements` for now.

## House style

This project inherits the visual contract in
`~/Documents/GitHub/DEVRULES & FORGE/devrules/housestyle-ui.md` — token
architecture, control-height ramp, closed button set, elevation, focus,
motion — bound to Calendula's own palette and type (spec §14). One deliberate
override: the radius ramp follows Calendula's own locked corner rule (spec
§14.7, decision D26 — square corners on single-sided-accent elements) rather
than the house style's generic 8/12/16/20 scale. See `CLAUDE.md` for the full
digest and the known spec gaps.

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
supabase/migrations/     full §5 schema + RLS, plus the placements upsert key (Phase 1)
supabase/seed.sql        appendix §19 seed data, local dev only
```

## Tests

`npm test` runs the grid engine and RRULE-expansion unit tests
(`src/lib/scheduler/*.test.ts`) — no database required. These are what
actually verify the Phase 1 acceptance criteria from spec §16: contiguous
DST-correct slicing, the no-double-assignment invariant, and travel-buffer
padding. The live end-to-end path (`supabase start` + real RLS check with a
second synthetic user) has not been run on this machine — no Docker
installed. Do that before trusting RLS beyond a read-through of the SQL.
