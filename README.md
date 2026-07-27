# Calendula

An autonomous planner that schedules a whole life, not just a job. Full
specification: [`calendula-v3-documentation.md`](./calendula-v3-documentation.md).

**Status: Phase 0 — Foundation.** Schema, row-level security, the solver
dispatch stub, and the brand/house-style system are in place. There is no
scheduling logic yet — no grid engine, no task solver, no advisor. See the
Overview page (`/`) once running, or the build-phase table in the spec (§16).

## Stack

Next.js App Router · TypeScript strict · Tailwind v4 (CSS-first, `@theme`) ·
Supabase (Postgres + auth, RLS on every table) · Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Anthropic keys
npx supabase start           # local Postgres + auth, applies migrations and seed.sql
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Settings page shows
which environment variables are actually set — nothing there is faked.

`supabase/seed.sql` creates one local-only synthetic auth user
(`scott@calendula.local`) and the appendix §19 seed data under it. It is safe
only against a local `supabase start` instance — it inserts directly into
`auth.users`, which would be destructive against a real project.

## House style

This project inherits the visual contract in
`~/Documents/GitHub/DEVRULES & FORGE/devrules/housestyle-ui.md` — token
architecture, control-height ramp, closed button set, elevation, focus,
motion — bound to Calendula's own palette and type (spec §14). One deliberate
override: the radius ramp follows Calendula's own locked corner rule (spec
§14.7, decision D26 — square corners on single-sided-accent elements) rather
than the house style's generic 8/12/16/20 scale. See `CLAUDE.md` for the full
digest and the one known spec gap (`meeting_offer_slots` missing `user_id`).

## Project structure

```
src/app/                 routes: overview, settings, connectors, how-it-works
src/components/brand/    the mark (CalendulaMark)
src/components/shell/    sidebar, topbar, app shell
src/components/ui/       Button, Panel, Badge, PageHeader — the closed set
src/lib/scheduler/       solve() (pure, currently a Phase 0 stub) + requestSolve
                         dispatcher (debounced, the only thing callers use)
src/lib/supabase/        browser/server clients, session-refresh middleware
supabase/migrations/     full §5 schema, RLS owner policy on every table
supabase/seed.sql        appendix §19 seed data, local dev only
```
