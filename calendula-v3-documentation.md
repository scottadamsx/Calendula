# Calendula

**Version:** 3.0
**Date:** July 27, 2026
**Owner:** Scotty
**Parent:** BONSai
**Status:** Specification. Describes intended behaviour; no implementation exists yet. Written in the present tense as reference documentation so that interface and experience decisions are settled before code. Do not read as a description of working software.
**Supersedes:** calenduh-spec-v2.md, calenduh-reminders-v2.1.md

---

## Table of contents

1. [Overview](#1-overview)
2. [Concepts](#2-concepts)
3. [Architecture](#3-architecture)
4. [Scope: single-tenant now, multi-tenant ready](#4-scope)
5. [Data model](#5-data-model)
6. [Grid engine](#6-grid-engine)
7. [Task and habit solver](#7-task-and-habit-solver)
8. [Future window planner](#8-future-window-planner)
9. [Meeting offer engine](#9-meeting-offer-engine)
10. [Reminders](#10-reminders)
11. [Advisor](#11-advisor)
12. [Reconciliation and calibration](#12-reconciliation-and-calibration)
13. [API reference](#13-api-reference)
14. [Brand system](#14-brand-system)
15. [Decision ledger](#15-decision-ledger)
16. [Build phases](#16-build-phases)
17. [Non-goals](#17-non-goals)
18. [Risks](#18-risks)
19. [Appendix: seed data](#19-appendix-seed-data)

---

## 1. Overview

Calendula is an autonomous planner that schedules a whole life, not just a job.

Motion, Reclaim, and Akiflow schedule work: tasks, meetings, deadlines. Calendula schedules work **and** the parts of life that get quietly squeezed out of it — time with people, physical habits, rest, and multi-day plans that need protecting months in advance.

**Positioning:** Motion schedules your work. Calendula schedules your life.

### What it does that others do not

1. **Relationship cadence.** Tracks how long since you saw someone against how often you want to, and proposes specific times when the gap opens.
2. **Future window planning.** Finds and defends a camping weekend in September by projecting what will *become* busy, not what is currently blank.
3. **Honest displacement cost.** When someone asks to meet, it knows what saying yes actually costs and offers accordingly, instead of reporting a solver-filled calendar as busy.
4. **Attention budgeting.** Reminders compete for a fixed daily interruption budget rather than firing unconditionally.
5. **Promotion loop.** A reminder you keep deferring is recognised as underestimated work and converted into scheduled time.

### Design thesis

**The schedulers are deterministic. The LLM lives only at the edges.**

Ingestion (messy text into structured records) and advice (solver output into human language) are LLM jobs. Placement is an algorithm. Any design that asks a model to directly emit a calendar is rejected: non-deterministic, slow, expensive per replan, and undebuggable.

This is also the margin story. The expensive operation is CPU, not tokens. LLM calls are low-volume Haiku and Sonnet at the boundaries. Calendula prices below Motion's anchor and holds margin.

### The name

*Calendula officinalis*, the pot marigold, takes its name from the Latin *calendae* — the calends, first day of the Roman month — because it blooms at the start of nearly every month. It shares that root with the word "calendar." Medieval herbals also called it *solsequium*, the sun-follower, because its petals open at dawn and close at dusk.

It is, literally, the calendar flower. The brand system in section 14 is built on that.

---

## 2. Concepts

The core mental model. Everything else follows from this taxonomy.

| Concept | Has duration | Occupies a block | Scheduled by |
|---|---|---|---|
| **Fixed block** | yes | yes, immovably | not scheduled; it is input |
| **Task** | yes | yes, in chunks | task solver (§7) |
| **Habit** | yes | yes, spaced apart | habit pass (§7.4) |
| **Reminder** | no | no — it needs a *moment* | reminder engine (§10) |
| **Activity window** | days | yes, as a defended hold | window planner (§8) |
| **Meeting offer** | yes | provisionally, until answered | offer engine (§9) |

Two distinctions carry most of the weight.

**A task is not a reminder.** A task is a duration that must find a home before a deadline. A reminder is an obligation attached to a moment. "Finish the CP assignment" is six hours of work. "Take the bins out Tuesday" is not work at all, it is a nudge. Feed reminders to the task solver and you get dozens of junk fifteen-minute placements polluting the week.

**Empty is not free.** A September weekend with nothing on it is not available, because the assignment due the following Tuesday will consume it. The window planner scores against *projected* load, not current occupancy (§8.1).

### Availability is three-state, not two

Once the solver fills gaps with work, a conventional free/busy query returns nothing useful. Calendula distinguishes:

- **Hard** — fixed blocks, pinned items, confirmed meetings, activity holds. Never offered, never auto-moved.
- **Soft** — solver-placed task chunks and habit sessions. Offerable at a computed cost, freely re-placed on re-solve.
- **Tentative** — outstanding meeting offer slots. Occupies space so the solver does not backfill, released on confirmation or expiry.

This distinction is what lets a fully-scheduled calendar still say yes to a friend honestly.

### Two scarce resources

The task solver and the reminder engine are architecturally parallel. They optimise different things.

| | Task solver | Reminder engine |
|---|---|---|
| Scarce resource | time | attention |
| Unit | 15-minute block | interruption |
| Ordering signal | slack (least slack time) | urgency × receptivity |
| Capacity limit | `max_task_minutes_per_day` | `attention_budget_per_day` |
| Overflow behaviour | returns `unplaceable` | queues silently, escalates |
| Stability rule | movement penalty | never re-deliver |
| Reads | the placements grid | the same placements grid |

Attention is scarcer than time. Budgeting it is the reason Calendula's reminders do not become noise.

---

## 3. Architecture

```
INGESTION (LLM)
  natural language  →  structured records
        │
        ▼
TRUTH LAYER (Postgres)
  fixed_blocks · tasks · habits · reminders · people
  activity_types · categories · scheduling_profile
        │
        ▼
GRID ENGINE  (§6)
  placements  →  time-sliced availability grid
        │
        ├──────────────┬───────────────┬──────────────┐
        ▼              ▼               ▼              ▼
  TASK SOLVER    WINDOW PLANNER   OFFER ENGINE   REMINDER ENGINE
     (§7)             (§8)            (§9)           (§10)
   places work    defends future   sells time     spends attention
        │              │               │              │
        └──────────────┴───────────────┴──────────────┘
                       │
                       ▼
                 ADVISOR (LLM)  (§11)
                 proposes, never writes
                       │
                       ▼
              RECONCILIATION  (§12)
              actual vs estimate → calibration
                       │
                       └──── feeds back into the solver
```

Every layer below ingestion is deterministic. The two LLM layers sit at the top and bottom of the flow and never touch placement decisions.

### Stack

Next.js App Router, TypeScript, Tailwind, Supabase (Postgres with RLS, Edge Functions for cron), Vercel.

Solvers run in server route handlers. Not client-side (they need the full dataset), not in Edge Functions (they exceed the CPU budget).

---

## 4. Scope

**v1 has exactly one user.** No billing, no signup flow, no onboarding wizard, no marketing site.

Every decision that would be expensive to reverse is made correctly now. Every decision that is cheap to add later is deferred.

### Free now, expensive later — do these

| Decision | Why it must be now |
|---|---|
| RLS on every table, `auth.uid() = user_id` | Retrofitting RLS across a live schema is a security-critical migration |
| `userId` is always an explicit parameter; nothing reads "current user" implicitly | Implicit-user code is a full rewrite to untangle |
| Solvers are pure functions: inputs in, result out, no module-level state | Module state means no concurrency, no queue, no scaling |
| All solver invocation goes through one dispatcher, even though v1 calls inline | Swapping inline for a job queue becomes a one-file change |
| Categories are a user-scoped table, not hardcoded strings | Calibration keys on category. Hardcoding one person's categories bakes their life into the schema |
| Timezone read from `scheduling_profile`, never from server locale | Timezone bugs are the most common source of silent scheduler corruption |
| Cron iterates a user set, even when that set has one row | Per-user timezone batching is structural, not cosmetic |
| Defaults live in DB columns, not env vars or code constants | Per-user config later requires no code change |

### Expensive now, cheap later — defer these

Billing. Signup and auth UI beyond a single Supabase session. Onboarding and cold-start inference. Google OAuth app verification. Team scheduling. Admin tooling. Analytics. Email. Mobile. Marketing site.

### Start early anyway

**Google Calendar write access requires OAuth verification.** Calendar scopes are classified sensitive by Google, requiring app review before going past the 100-user test cap. That process takes weeks and requirements have changed more than once, so confirm current rules before planning around a date.

v1 stays under the cap with one user, so this does not block the build. If productisation is the plan, begin verification during Phase 2 rather than at launch. This is also the argument for read-only calendar import in v1 (D14).

---

## 5. Data model

Every table carries `user_id uuid not null references auth.users(id)`. RLS is enabled on all of them without exception, including in v1:

```sql
alter table <table> enable row level security;
create policy owner on <table> for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

### 5.1 Profile and constraints

```sql
create table scheduling_profile (
  user_id                  uuid primary key references auth.users(id),
  timezone                 text not null default 'America/St_Johns',
  sleep_start              time not null default '23:30',
  sleep_end                time not null default '07:30',
  horizon_days             int  not null default 14,
  far_horizon_days         int  not null default 180,
  block_minutes            int  not null default 15,
  freeze_window_hours      int  not null default 24,
  max_task_minutes_per_day int  not null default 300,
  movement_penalty         numeric not null default 0.3,
  min_break_minutes        int  not null default 15,
  brief_hour               int  not null default 7,
  created_at               timestamptz default now()
);

create table attention_profile (
  user_id                  uuid primary key references auth.users(id),
  attention_budget_per_day int not null default 5,
  min_gap_minutes          int not null default 45,
  quiet_start              time,
  quiet_end                time,
  batch_by_default         boolean not null default true,
  promote_after_defers     int not null default 3
);
```

The timezone default is one person's, but **no code path may assume it**. Read it from this row every time.

`attention_budget_per_day` defaults to 5, deliberately low. Raising it after finding things slipping is easy; recovering trust after two weeks of over-notification is not.

### 5.2 Categories and labels

```sql
create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  name       text not null,
  color      text,
  created_at timestamptz default now(),
  unique (user_id, name)
);

create type energy_label as enum ('deep','admin','social','physical','creative');

create table energy_windows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  day_of_week int,
  start_time  time not null,
  end_time    time not null,
  quality     numeric not null check (quality between 0 and 1),
  label       energy_label not null
);
```

Categories are user-defined free text because they describe a life. Energy labels are a fixed enum because the solver matches against them structurally. That asymmetry is deliberate (D13).

### 5.3 People

```sql
create table people (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  name                 text not null,
  desired_cadence_days int,
  last_interaction_at  timestamptz,
  location             text,
  notes                text,
  created_at           timestamptz default now()
);
```

`desired_cadence_days` is the entire relationship feature. Null means untracked.

### 5.4 Commitments

```sql
create table fixed_blocks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  title                 text not null,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  location              text,
  travel_buffer_minutes int not null default 0,
  high_exertion         boolean not null default false,
  rrule                 text,
  source                text not null default 'manual',
  external_id           text,
  created_at            timestamptz default now()
);

create table tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  category_id       uuid references categories(id),
  title             text not null,
  estimated_minutes int not null,
  remaining_minutes int not null,
  deadline          timestamptz,
  priority          int not null default 3 check (priority between 1 and 5),
  min_chunk_minutes int not null default 45,
  max_chunk_minutes int not null default 180,
  splittable        boolean not null default true,
  preferred_labels  energy_label[],
  status            text not null default 'active',
  skip_count        int not null default 0,
  created_at        timestamptz default now()
);

create table habits (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null,
  title                    text not null,
  duration_minutes         int not null,
  target_sessions_per_week int not null,
  min_spacing_hours        int not null default 24,
  preferred_labels         energy_label[],
  earliest_time            time,
  latest_time              time,
  location                 text,
  travel_buffer_minutes    int not null default 0,
  active                   boolean not null default true
);
```

### 5.5 Placements — the occupancy table

```sql
create table placements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  source_type text not null check (source_type in
                ('fixed','task','habit','activity_hold','meeting_hold','meeting')),
  source_id   uuid not null,
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  hardness    text not null check (hardness in ('hard','soft','tentative')),
  pinned      boolean not null default false,
  location    text,
  run_id      uuid,
  created_at  timestamptz default now()
);

create index on placements (user_id, starts_at, ends_at);
create index on placements (user_id, hardness);
```

**This is the load-bearing table.** The grid engine reads nothing else. Every other layer reads the grid.

### 5.6 Future activities

```sql
create table activity_types (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  name               text not null,
  min_duration_hours int not null,
  requires_overnight boolean not null default false,
  season_start       date,
  season_end         date,
  lead_time_days     int not null default 0,
  buffer_after_hours int not null default 0,
  weather_sensitive  boolean not null default false
);

create table activity_holds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  activity_type_id uuid not null references activity_types(id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'held',
  participants     uuid[],
  created_at       timestamptz default now()
);
```

### 5.7 Meeting offers

```sql
create table meeting_offers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  person_ids       uuid[],
  purpose          text,
  meeting_type     text not null,
  duration_minutes int not null,
  expires_at       timestamptz not null,
  status           text not null default 'open',
  created_at       timestamptz default now()
);

create table meeting_offer_slots (
  id                uuid primary key default gen_random_uuid(),
  offer_id          uuid not null references meeting_offers(id) on delete cascade,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  displacement_cost numeric not null,
  placement_id      uuid references placements(id) on delete set null,
  chosen            boolean not null default false
);
```

### 5.8 Reminders

```sql
create type reminder_kind     as enum ('moment','window','context','latent');
create type trigger_type      as enum ('time','before_placement','after_placement','location');
create type reminder_status   as enum ('pending','delivered','acknowledged','done','dismissed','promoted');
create type interruption_cost as enum ('ambient','notify','insist');

create table reminders (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  category_id          uuid references categories(id),
  title                text not null,
  body                 text,
  kind                 reminder_kind not null,

  due_at               timestamptz,
  window_start         timestamptz,
  window_end           timestamptz,

  trigger              trigger_type not null default 'time',
  trigger_placement_id uuid references placements(id) on delete cascade,
  lead_minutes         int not null default 0,
  location             text,

  importance           int not null default 3 check (importance between 1 and 5),
  cost                 interruption_cost not null default 'notify',
  person_id            uuid references people(id),

  recurrence           text,
  status               reminder_status not null default 'pending',
  defer_count          int not null default 0,
  promotion_offered    boolean not null default false,

  source               text not null default 'user',
  derived_from_type    text,
  derived_from_id      uuid,

  created_at           timestamptz default now(),
  completed_at         timestamptz
);

create index on reminders (user_id, status, due_at);
create index on reminders (user_id, trigger_placement_id);

create table reminder_deliveries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  reminder_id  uuid not null references reminders(id) on delete cascade,
  batch_id     uuid,
  scheduled_at timestamptz not null,
  delivered_at timestamptz,
  channel      text not null,
  receptivity  numeric,
  urgency      numeric,
  outcome      text,
  created_at   timestamptz default now()
);
```

### 5.9 Reconciliation

```sql
create table completions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  task_id         uuid references tasks(id),
  habit_id        uuid references habits(id),
  placement_id    uuid references placements(id),
  planned_minutes int,
  actual_minutes  int,
  completed       boolean not null,
  logged_at       timestamptz default now()
);

create table duration_calibration (
  user_id     uuid not null,
  category_id uuid not null references categories(id),
  multiplier  numeric not null default 1.0,
  sample_size int not null default 0,
  updated_at  timestamptz default now(),
  primary key (user_id, category_id)
);
```

### 5.10 Audit

```sql
create table schedule_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  trigger       text not null,
  horizon_start timestamptz not null,
  horizon_end   timestamptz not null,
  unplaceable   jsonb not null default '[]',
  moved_count   int not null default 0,
  duration_ms   int,
  created_at    timestamptz default now()
);
```

Every solve writes a row. Retained 30 days. This is how the system answers "why is this here?"

---

## 6. Grid engine

The shared substrate. Every scheduling layer reads it; none of them query `placements` directly.

```ts
type BlockState = 'unavailable' | 'free' | 'soft' | 'hard' | 'tentative';

interface Block {
  start: Date;
  end: Date;
  state: BlockState;
  quality: number;          // 0..1
  labels: EnergyLabel[];
  sourceId?: string;
  location?: string;
  frozen: boolean;
}

function buildGrid(userId: string, from: Date, to: Date): Promise<Block[]>
```

**Construction order**

1. Slice `[from, to)` into `block_minutes` slots **in the user's timezone**. Generate in local wall time, then convert to UTC. This order is what makes the grid DST-correct.
2. Mark sleep windows `unavailable`.
3. Load overlapping placements. Mark blocks by `hardness`. A pinned `soft` placement is treated as `hard`.
4. Apply `travel_buffer_minutes` as `unavailable` padding on both edges of any placement carrying a `location`.
5. Attach `quality` and `labels` from matching `energy_windows`. Unmatched blocks default to quality 0.5.
6. Set `frozen = true` on blocks inside the freeze window.

**Invariant:** no block is ever double-assigned. This is asserted in tests and is the single most important correctness property in the system. A subtly wrong grid produces solvers that appear broken but are not.

---

## 7. Task and habit solver

### 7.1 Interface

```ts
interface SolveResult {
  placements: Placement[];
  unplaceable: { taskId: string; remainingMinutes: number; deadline: Date | null }[];
  atRisk: { taskId: string; slackMinutes: number }[];
  habitShortfall: { habitId: string; missing: number }[];
  derivedReminders: Reminder[];
  movedCount: number;
}

function solve(
  userId: string,
  opts?: { excludeRanges?: Range[]; dryRun?: boolean }
): Promise<SolveResult>
```

Pure function. No module-level state. `userId` explicit.

All invocation routes through a single dispatcher:

```ts
// lib/scheduler/dispatch.ts
export async function requestSolve(userId: string, trigger: string): Promise<SolveResult> {
  // v1: inline, debounced 2s
  // later: enqueue and return a job handle — callers unchanged
}
```

Every caller uses `requestSolve`, never `solve` directly. That indirection is the entire multi-tenant migration path.

### 7.2 Least slack time

Borrowed from real-time systems scheduling. The task with the least breathing room goes first.

```
grid       = buildGrid(userId, now, now + horizon_days)
previous   = placements from the last run          // for movement penalty
delete soft placements where NOT frozen
candidates = active tasks with remaining_minutes > 0

while candidates is non-empty:
    for each c in candidates:
        c.slack = (c.deadline - now)
                - (c.remaining_minutes * calibration[c.category_id])
    sort candidates by slack ascending, then priority descending
    head = candidates[0]

    chunk = clamp(head.remaining_minutes, head.min_chunk, head.max_chunk)
    if not head.splittable:
        chunk = head.remaining_minutes

    slot = findBestSlot(grid, head, chunk)
    if slot is null:
        mark head unplaceable; remove from candidates; continue

    place(head, slot); mark grid blocks soft
    head.remaining_minutes -= slot.duration
    if head.remaining_minutes <= 0:
        remove head from candidates
```

Tasks without a deadline take `slack = +Infinity` and are placed last into leftover space, ordered by priority.

Slack is computed against the *calibrated* estimate (§12), not the raw one. A task estimated at two hours in a category that historically runs 1.4× is treated as 168 minutes of work when computing urgency.

### 7.3 Slot scoring

```
score(slot, task) =
    + 1.0 * mean(quality across slot blocks)
    + 0.5 * labelMatch(slot.labels, task.preferred_labels)
    + 0.3 * deadlineProximity(slot.start, task.deadline)
    - movement_penalty   if the previous run placed this task elsewhere
    - 0.4 * fragmentation(slot)
    - 0.6 * dailyOverload(slot.day, task)
```

A slot is hard-rejected if it would breach `max_task_minutes_per_day`, touch a frozen block, or leave a residual gap smaller than `min_break_minutes`.

The movement penalty is what makes the schedule feel stable. Without it, every re-solve reshuffles the week and the user stops trusting the output.

### 7.4 Habits

Habits are scheduled in a second pass, after tasks, because they are flexible in time but constrained in spacing.

```
for each active habit:
    needed = target_sessions_per_week - sessions already placed this week
    for i in 1..needed:
        eligible = free blocks within [earliest_time, latest_time]
                   AND at least min_spacing_hours from the nearest existing session
        place the highest-scoring eligible run of duration_minutes
        if no eligible run exists: record a shortfall
```

Spacing is why the gym does not land three days consecutively. Shortfalls feed the advisor rather than failing silently.

### 7.5 Displacement cost

The mechanism that lets a fully-scheduled calendar still say yes.

```ts
async function displacementCost(
  userId: string,
  range: Range,
  baseline: SolveResult
): Promise<number | 'BLOCKED'> {
  const after = await solve(userId, { dryRun: true, excludeRanges: [range] });
  if (after.unplaceable.length > baseline.unplaceable.length) return 'BLOCKED';
  return sumSlackDelta(baseline.atRisk, after.atRisk);   // minutes of slack lost
}
```

Normalised to 0–1 against a 240-minute ceiling for scoring.

**Performance.** This runs a full solve per candidate. Compute `baseline` once per request and pass it in. Pre-filter to at most 20 candidate starts before computing true cost: free blocks first, then soft blocks ordered by ascending count of overlapping chunks.

---

## 8. Future window planner

Answers questions of the form "when is a good time to go camping?"

### 8.1 Projected load

An empty September weekend is not a free September weekend.

```ts
function projectedLoad(userId: string, day: Date): Promise<number>  // 0..1
```

Three components:

1. **Hard commitments** — hours of `hard` placements plus RRULE expansions of `fixed_blocks`. Classes, shifts, and recurring hikes are knowable months ahead.
2. **Deadline pressure** — for every task with a deadline within 10 days after `day`, add `estimated_minutes × proximityWeight`, where the weight rises linearly from 0 at ten days out to 1.0 at the deadline. This is what correctly makes the week before an assignment look busy while the calendar is still visually blank.
3. **Recovery debt** — any `high_exertion` placement adds load across the following `buffer_after_hours`. The weekend after an overnight hike is not a camping weekend.

Normalised against ten waking productive hours, clamped to [0, 1].

The far grid runs at **day** granularity, not fifteen minutes. Minute precision three months out is meaningless and wastes compute (D4).

### 8.2 Window search

```
type = activity_types[id]
candidates = contiguous day runs of length >= ceil(min_duration_hours / 24)
             within [now + lead_time_days, now + horizonDays]
             AND inside [season_start, season_end]

for each candidate:
    if any day carries a hard placement: reject

    loadIn          = mean projectedLoad across candidate days
    loadFlank       = mean projectedLoad across the 2 days before and after
    deadlinePenalty = max deadline pressure in the 3 days following
    weatherScore    = forecast if within 10 days, else climate normals for the date
    restBonus       = min(daysSinceLastActivityHold / 30, 1.0)

    score = 1.0 * (1 - loadIn)
          + 0.5 * (1 - loadFlank)
          - 0.8 * deadlinePenalty
          + 0.4 * weatherScore
          + 0.3 * restBonus

return the top `count`, enforcing at least 7 days separation between suggestions
```

Structured reasons accompany every score. The advisor renders them as prose:

> Sept 12–13 is your best window. No hike that weekend, nothing due until the 22nd, and it's three weeks out so Butter Pot is still bookable. Sept 5–6 also works, but you'd be starting the CP assignment that Monday.

Three options with reasons, never one answer.

### 8.3 Holding a window

On acceptance, insert an `activity_hold` plus a `placements` row with `hardness = 'hard'`, then re-solve. Coursework now routes *around* the hold, scheduling earlier rather than bleeding into the weekend.

If the re-solve returns unplaceable items, the hold is not silently accepted. The conflict surfaces immediately:

> Holding Sept 12–13 means starting the CP assignment by the 5th. Still want it?

**This is the differentiating behaviour.** The system does not merely find time. It defends it, and it tells you the price up front.

---

## 9. Meeting offer engine

Answers "when can you meet?" without lying in either direction.

### 9.1 Slot search

```ts
function findMeetingSlots(userId: string, opts: {
  durationMinutes: number;
  meetingType: 'social' | 'work' | 'call';
  horizonDays: number;
  personIds?: string[];
  count?: number;          // default 3
}): Promise<MeetingSlot[]>
```

```
grid       = buildGrid(userId, now + freeze_window, now + horizonDays)
candidates = every start where the duration fits entirely in free|soft blocks
pre-filter to at most 20
baseline   = await solve(userId, { dryRun: true })

for each candidate:
    cost = displacementCost(candidate, baseline)
    if cost == 'BLOCKED': drop

    score = 1.0 * (1 - normalize(cost))
          + 0.6 * energyFit(candidate.labels, meetingType)
          + 0.5 * travelFeasible(candidate)
          + 0.2 * earliness(candidate)

sort descending; select greedily, skipping any day already represented,
until `count` is reached or candidates are exhausted
```

`travelFeasible` returns 0 when the preceding placement carries a different `location` and the gap is under its `travel_buffer_minutes`. A downtown coffee at 4:15 when you are on campus until 4:00 is a fake option and is never offered.

Day-spread is enforced, not optional. Three slots on a single Thursday afternoon is not a real choice for the other person.

### 9.2 Tentative holds

On offer creation, a `placements` row with `hardness = 'tentative'` is inserted for **every** offered slot, then the schedule is re-solved.

Without this: three slots are offered, the solver backfills them with assignment chunks overnight, the friend picks Thursday, and the user is double-booked against their own planner. Every scheduling tool has this bug. Calendula does not ship it.

- **Confirm** — the chosen slot is promoted to `hard` with `source_type = 'meeting'`, other tentatives are deleted, `people.last_interaction_at` is updated, and the schedule re-solves.
- **Expire** — an hourly cron sets `status = 'expired'`, deletes tentative placements, and re-solves.

### 9.3 Output is a message

The deliverable of this layer is pasteable text, not a UI:

> Thursday after 2, Friday morning, or Saturday afternoon all work for me, whichever's easiest.

The complete path accepts the inbound message directly ("hey can we grab food next week?"), parses horizon, duration, and meeting type, and returns the sendable reply. Target round-trip is under five seconds.

---

## 10. Reminders

### 10.1 Taxonomy

```
moment   fires at or before a specific time         "pay rent on the 1st"
window   fires sometime inside a range              "call the dentist this week"
context  attached to a placement or location        "before the next hike, message Dee"
latent   no time pressure, surfaces when relevant   "look into Expo push eventually"
```

`latent` reminders never consume attention budget. They surface only when the advisor finds a matching context, or on explicit review. This is where "someday" items go so they stop cluttering everything else.

### 10.2 Receptivity

Reads the same grid as the solvers. No parallel infrastructure.

```ts
function receptivity(block: Block, profile: AttentionProfile): number  // 0..1
```

```
base, by block state:
    unavailable (sleep)          → 0.00   hard floor, never deliver
    hard placement               → 0.00   queue instead
    soft placement, deep label   → 0.15   protect deep work
    soft placement, admin label  → 0.55   interruptible
    free                         → 0.85

modifiers:
    + 0.25   within 5 minutes of a placement boundary
    + 0.15   block is a travel buffer
    - 0.30   inside quiet hours
    - 0.20   a delivery occurred less than min_gap_minutes ago
    -  all   if today's delivered count >= attention_budget_per_day
             (unless importance = 5)

clamp [0, 1]
```

The boundary bonus does most of the work. The best moment to tell someone something is the seam between two things they were already doing.

### 10.3 Urgency

```ts
function urgency(r: Reminder, t: Date): number  // 0..1
```

```
moment:   timeLeft = due_at - t - lead_minutes
          u = clamp(1 - (timeLeft / horizon(r)), 0, 1)
          horizon(r) = 24h × importance        // important things surface earlier

window:   u = elapsed fraction of [window_start, window_end], floor 0.2

context:  u = 1.0 when the trigger placement is within lead_minutes, else 0

latent:   u = 0                                // never budgeted

then, all kinds:
    u *= (0.6 + 0.1 × importance)
    u += 0.08 × defer_count
    clamp [0, 1]
```

**Deferral raises urgency.** This is deliberate and inverts what a snooze button normally does. A deferred reminder is not less important; it is a thing that keeps failing to get done. It gets louder, and eventually triggers promotion (§10.6).

### 10.4 Assignment

Runs on every solve and on a fifteen-minute cron. Full recompute over the next 48 hours, consistent with D2.

```
grid       = buildGrid(userId, now, now + 48h)
candidates = pending reminders where kind != 'latent'
budget     = attention_budget_per_day - deliveries already made today

pairs = []
for each r in candidates:
    for each block b where receptivity(b) > 0.2:
        if b.start > effectiveDeadline(r): continue      // never deliver late
        pairs.push({ r, b, value: urgency(r, b.start) × receptivity(b) })

sort pairs by value descending

assigned = []
for each pair:
    if r is already assigned: continue
    if assigned.length >= budget and r.importance < 5: continue
    if any assigned delivery falls within min_gap_minutes of b: continue
    assigned.push(pair)

unassigned reminders remain pending and are re-evaluated next cycle.
If now > due_at, they escalate into the daily brief, where they cost no budget.
```

Results are written to `reminder_deliveries` with `scheduled_at`. A separate dispatcher fires them. Rescheduling an already-*delivered* reminder is forbidden — deliver once, then wait for an outcome.

### 10.5 Batching

When `batch_by_default` is true, assigned deliveries are collapsed before dispatch:

```
group assigned deliveries where:
    scheduled_at falls within the same 20-minute window
    AND they share a receptivity context (same boundary or same free run)

if the group has 2 or more members:
    assign a shared batch_id
    render as a single digest
    charge the attention budget ONCE for the batch
```

That last line matters: **batching buys back budget.** Seven reminders delivered as three digests costs three interruptions, not seven. The system is structurally incentivised toward digests with no special-casing.

Digest rendering is an LLM edge job (Haiku), given the grouped reminders plus the next three placements:

> Before you head out: grab the charger, text Dee about the sponsor post, and gym's at 5:30.

`moment` reminders within 20 minutes of `due_at` bypass batching.

### 10.6 Promotion and demotion

The bidirectional link between reminders and tasks.

**Promotion — reminder becomes a task**

```
trigger when:
    defer_count >= promote_after_defers (default 3)
    OR (status = 'pending' AND age > 7 days AND kind != 'latent')

action:
    the advisor proposes, draft-only:
      "'Fix the portfolio contact form' has come up 4 times.
       That's probably not a 2-minute thing. Schedule 45 minutes for it?"

    on accept:
      insert into tasks (title, category_id, estimated_minutes, deadline, priority)
      set reminder.status = 'promoted'
      requestSolve(userId, 'reminder_promoted')
```

The initial estimate is LLM-proposed from the title and category, then corrected over time by calibration (§12).

Promotion is offered **once per reminder, ever** — tracked by `promotion_offered`. Declining is permanent. Otherwise the feature becomes nagging.

**Demotion — task becomes a reminder**

```
trigger when:
    a task has been placed and skipped 3 or more times
    AND estimated_minutes <= 30

action:
    propose demotion — it was never block-shaped work
```

Promotion catches underestimated work. Demotion stops trivia from consuming scheduled blocks.

### 10.7 Derived reminders

Other layers generate reminders automatically. This is the feedback direction.

| Source | Generated reminder | Timing |
|---|---|---|
| `activity_holds` | "Book Butter Pot for camping" | `starts_at − lead_time_days` |
| `meeting_offers` | "Erin hasn't replied — follow up?" | `expires_at − 12h` |
| Habit shortfall | "Gym is one short this week" | Friday morning |
| Task at risk (slack < 120m) | "CP assignment is tight — start today" | at detection |
| `people` past cadence | "Three weeks since Nick" | daily brief, ambient cost |
| Task with a `person_id` | "Text Dee back" | next free social block |

All carry `source = 'derived'` with `derived_from_type` and `derived_from_id`. Generation runs in the nightly cron and is idempotent on that pair.

**When the parent record is completed, cancelled, or deleted, the derived reminder cascades to `dismissed`.** Orphaned derived reminders are exactly the noise that makes people abandon planners.

### 10.8 Delivery channels

```
push     web push / iOS.  Budgeted.  Default for moment and context.
brief    folded into the daily brief.  Free, unbudgeted.
inline   surfaced in the week view.  Free, unbudgeted.
```

Reminders with `cost = 'ambient'` never use push. They live in brief and inline only. Relationship-drift nudges belong here: worth knowing, never worth interrupting for.

Every delivery captures an outcome — acknowledged, deferred (increments `defer_count`), done, or dismissed. Three consecutive dismissals without completion prompt deletion. If it never gets done and never matters, it should stop existing.

---

## 11. Advisor

The LLM layer. Reads deterministic output, writes English. **Proposes only, never writes** (D9).

### Signals

| Signal | Source | Trigger |
|---|---|---|
| Overload | `SolveResult.unplaceable` | length > 0 |
| At-risk work | `SolveResult.atRisk` | slack < 120 minutes |
| Habit shortfall | habit pass | placed < target |
| Relationship drift | SQL on `people` | past `desired_cadence_days` |
| Drift plus opportunity | drift ∩ free social blocks | a free slot exists |
| Estimate drift | `duration_calibration` | multiplier moved > 20% |
| Promotion candidate | `reminders.defer_count` | >= threshold, not yet offered |
| Overdue unassigned | reminder engine | past due, never delivered |

```sql
select p.id, p.name, p.desired_cadence_days,
       extract(day from now() - p.last_interaction_at) as days_since
from people p
where p.desired_cadence_days is not null
  and p.last_interaction_at < now() - (p.desired_cadence_days || ' days')::interval
order by days_since desc;
```

Intersected with free `social`-labelled blocks, this produces:

> You and Nick are three weeks out. Wednesday 7pm is open and costs you nothing. Movie?

### Constraints on advisor output

Overload proposals must name the **specific** task to drop or defer, ranked by `priority ascending, slack descending`. Never "you have a lot on."

Overload is not a judgment call. It is a return value: the solver could not place everything before its deadlines. The advisor explains a computed fact, it does not form an opinion.

### Model routing

Haiku for drift phrasing and digest rendering. Sonnet for the daily brief. Opus for overload triage, where the tradeoff reasoning is genuinely non-trivial.

---

## 12. Reconciliation and calibration

The layer everyone skips, and the reason planners rot.

**Daily check-in.** Evening, under sixty seconds. For each `soft` placement that has passed: done or not, and actual minutes. One tap for "as planned."

**Calibration**, nightly per category:

```
multiplier = median(actual_minutes / planned_minutes)
required:  sample_size >= 5
clamped:   [0.5, 3.0]
```

Median, not mean. One eight-hour debugging session must not permanently inflate every future estimate (D12).

The multiplier is applied inside `solve()` when computing slack. It is never displayed as the user's own estimate; it surfaces as context:

> You usually run 1.4× on coursework.

Incomplete tasks return their remaining minutes to `tasks.remaining_minutes` and trigger a re-solve. Skipped placements increment `tasks.skip_count`, which feeds demotion (§10.6).

---

## 13. API reference

Next.js App Router route handlers, all under `/api`.

### Scheduling

```
POST   /api/tasks                    create or update a task
POST   /api/schedule/solve           force a re-solve, returns SolveResult
GET    /api/schedule/week?start=     placements plus grid states
POST   /api/schedule/pin             pin or unpin a placement
POST   /api/schedule/complete        log a completion
```

### Future windows

```
GET    /api/windows/find             ?activity=&horizon=
POST   /api/windows/hold             accept a suggested window
```

### Meetings

```
POST   /api/meetings/offer           create an offer plus tentative holds, returns the message string
POST   /api/meetings/confirm         confirm a slot, release the others
POST   /api/meetings/parse           inbound message → offer parameters (LLM)
```

### Reminders

```
POST   /api/reminders                create or update
POST   /api/reminders/:id/outcome    acknowledge | defer | done | dismiss
POST   /api/reminders/assign         force a reassignment pass
GET    /api/reminders/pending        queued and scheduled, for the inline view
POST   /api/reminders/:id/promote    accept promotion to a task
```

### Other

```
GET    /api/advisor/brief            daily brief, draft-only
POST   /api/ingest                   natural language → structured records (LLM)
POST   /api/calendar/import          Google Calendar read-only pull
```

### Solve triggers

Task create, update, or complete. Fixed block change. Offer create, confirm, or expire. Hold create or release. Reminder promotion. Nightly cron at `brief_hour − 4` local.

Debounced at 2 seconds: one chat message creating three tasks triggers one solve.

### Cron shape

```ts
for (const user of await activeUsers()) {     // v1 returns one row
  await requestSolve(user.id, 'cron');
}
```

Additional crons: reminder assignment every 15 minutes; derived-reminder generation nightly; meeting offer expiry hourly.

---

## 14. Brand system

### 14.1 Origin

*Calendula officinalis* takes its name from the Latin *calendae*, the first day of the Roman month, because it blooms at the start of nearly every month. The word "calendar" shares that root. Medieval herbals called it *solsequium*, the sun-follower, because its petals open at dawn and close at dusk — it was used as a rough timekeeper.

The brand is built on that fact rather than around it. Nothing needs explaining; the story pays off when someone asks.

**Tagline:** the calendar flower.

### 14.2 Mark

A radial disc of ray florets:

- **Twelve outer petals**, one per month — the *calendae* link made structural rather than decorative.
- **Twelve inner florets**, offset by 15°, in Pollen. These provide density so the mark survives at favicon scale.
- **A Disc-coloured centre** with six Ember pollen dots.

This is the same construction logic as the Kiwi 18-seed radial disc. Shared construction is what makes BONSai products read as siblings while the palette and plant differentiate them.

**Clear space:** one petal-length on all sides. **Minimum size:** 16px, at which the inner floret ring may be dropped.

### 14.3 Palette

| Token | Hex | Role |
|---|---|---|
| **Ray** | `#F0872D` | Primary. Soft placements, accent borders, active states |
| **Pollen** | `#F5C242` | Reminders only |
| **Ember** | `#C25A12` | Overload, unplaceable, at-risk, errors |
| **Disc** | `#4A2C14` | Hard placements, primary text. Effectively the black |
| **Leaf** | `#5F7A4A` | Habits |
| **Petal** | `#FDF6EC` | Page background |
| **Bract** | `#E8D9C4` | Structural hairlines, dividers, card borders |

Supporting text uses `#8A6B4F`; muted metadata `#A88B6E`; raised card surfaces `#FFFCF7`.

**Bract exists because Ray and Pollen both fail as structural borders.** Ray at hairline weight reads as a warning state everywhere it appears. Pollen on Petal is too low-contrast to register. Bract is Petal pushed a few steps darker, and it keeps structural lines silent so coloured edges can carry meaning.

### 14.4 State encoding

The palette maps directly onto the availability model, which is why the week view is legible without a legend.

| Visual treatment | Meaning |
|---|---|
| Solid Disc fill | `hard` — fixed, immovable |
| Ray left-edge, tinted fill | `soft` — auto-scheduled, movable |
| Dashed Ray outline, no fill | `tentative` — offered, awaiting reply |
| Petal (background) | free |
| Ember left-edge | overload, at-risk, conflict |
| Leaf left-edge | habit |
| Pollen dot | reminder |

Solid dark is fixed. Warm fill is flexible. Outline is provisional. A user can tell at a glance which blocks are theirs to move.

### 14.5 Typography

| Role | Face |
|---|---|
| Display, headings | **Fraunces** — variable, warm, softness axis dialled up |
| UI, body | **Inter** |
| Times, durations, data | **JetBrains Mono**, tabular figures |

Inter and JetBrains Mono are shared with Kiwi. Fraunces replaces Newsreader because a flower brand wants warmth where Newsreader reads editorial. Two of three shared is how a family system should work: the mark and palette do the differentiating.

All times and durations are mono. They are data, not prose.

### 14.6 Motion

Derived from the plant's actual behaviour: calendula opens at dawn and closes at dusk.

- Petals unfurl on load.
- The mark sits **closed** during quiet hours and inside the freeze window.
- It **opens** with the morning brief.
- A partially-filled petal ring serves as a weekly progress indicator — twelve petals, or seven when showing days.

### 14.7 Corner rule

Anything with a single-sided accent border uses **square corners**. Everything else uses 6px, cards 10–12px.

Rounded corners with a one-sided border always look broken. This means two corner styles coexist in the interface, which is correct and intentional.

### 14.8 Voice

Sentence case everywhere. Contractions. Active voice, verb first. No exclamation marks in system copy. Never "successfully."

The tone is quietly self-deprecating rather than condescending — built for people who are bad at planning, without ever implying it. Say what happened and what to do:

> That weekend costs you the assignment start date. Still want it?

Not:

> Warning: scheduling conflict detected.

---

## 15. Decision ledger

Locked. Do not re-litigate during implementation.

| # | Decision | Rationale |
|---|---|---|
| D1 | Deterministic solvers, LLM at edges only | Debuggability, latency, cost |
| D2 | Full-horizon recompute on every change, never incremental patching | Incremental diffs create unreachable bug states |
| D3 | 15-minute blocks for the near grid (14 days) | Finer wastes compute, coarser cannot fit 45-minute sessions |
| D4 | Day granularity for the far grid (90–180 days) | Minute precision is meaningless months out |
| D5 | Three-state availability: hard / soft / free | Two-state makes an auto-scheduled calendar look permanently full |
| D6 | Movement penalty on re-solve | Without it the schedule thrashes and trust collapses |
| D7 | Nothing inside the freeze window moves without confirmation | The primary complaint about Motion |
| D8 | Meeting offers create tentative holds on all offered slots | Otherwise the solver backfills offered slots overnight |
| D9 | Advisor proposes, never writes | Draft-only guardrail |
| D10 | Participant availability is user-supplied, never inferred | Cannot be solved algorithmically; do not try |
| D11 | A single `placements` table is the only thing the grid engine reads | One source of truth for occupancy |
| D12 | Duration calibration is per-category, median-based, clamped | Mean is destroyed by one outlier |
| D13 | Categories are user-defined; energy labels are product-defined | Users have their own life buckets; the solver needs a fixed vocabulary |
| D14 | Google Calendar is read-only in v1 | Keeps OAuth verification off the critical path |
| D15 | Single-tenant v1, multi-tenant-ready schema | See §4 |
| D16 | Reminders are distinct from tasks; never placed by the task solver | No duration to place; pollutes the grid |
| D17 | Delivery is budgeted, not unconditional | Unbudgeted notification systems train the user to ignore them |
| D18 | The reminder engine reads the same grid as the solvers | One source of truth for occupancy and receptivity |
| D19 | Batch at natural boundaries by default | A digest at a transition beats seven interruptions |
| D20 | A reminder deferred N times proposes promotion to a task | Repeated deferral is evidence of real duration |
| D21 | Reminders may be derived by other layers, not only user-entered | Lead times, expiring offers, habit shortfalls |
| D22 | Never deliver during sleep or a hard placement; queue instead | Interrupting a class trains dismissal |
| D23 | Escalation may exceed budget only at importance 5 | An emergency valve, not a routine path |
| D24 | Promotion is offered once per reminder, ever | Otherwise the feature becomes nagging |
| D25 | Structural borders use Bract; Ray and Pollen carry meaning only | Coloured hairlines read as warnings and destroy the state encoding |
| D26 | Square corners on any element with a single-sided accent border | Rounded corners with one-sided borders always look broken |

---

## 16. Build phases

Each phase ships independently and is testable in isolation.

### Phase 0 — Foundation
Schema, RLS on every table, migrations, seed data, Supabase client, `requestSolve` dispatcher stub.

**Acceptance:** RLS verified by querying as a second synthetic user and receiving zero rows from every table.

### Phase 1 — Grid, read-only
`buildGrid`, week view rendering hard placements. No auto-scheduling. Brand system applied.

**Acceptance:** 14 days render correctly across a DST boundary. No block is double-assigned. Travel buffers are visible.

### Phase 2 — Task solver
Least-slack-time solver, movement penalty, freeze window, pin and unpin, `schedule_runs` audit. **Begin Google OAuth verification in parallel.**

**Acceptance:** five staggered-deadline tasks all place before their deadlines. A re-solve with no input change moves zero placements. An impossible task returns unplaceable rather than overlapping something.

### Phase 3 — Habits
Second-pass placement, spacing constraints, shortfall reporting.

**Acceptance:** a habit at 3×/week with 24h spacing never lands on consecutive days. Shortfall is reported when the week is genuinely full.

### Phase 4 — Meeting offers
Displacement cost, day-spread search, tentative holds, expiry cron, message output.

**Acceptance:** offering three slots creates three tentative placements. The overnight solve does not backfill them. Confirming one releases the others and re-solves cleanly.

### Phase 4.5 — Reminders core
Taxonomy, urgency and receptivity models, assignment algorithm, attention budget. Brief and inline channels only — no push yet.

**Acceptance:** twelve pending reminders against a budget of five assign exactly five plus importance-5 overrides. Zero assignments land during sleep or a hard placement. No reminder is ever scheduled after its `due_at`.

### Phase 4.6 — Batching and push
Batch grouping, digest rendering, web push, outcome capture.

**Acceptance:** three reminders inside one 20-minute window deliver as a single digest and charge the budget once. Outcomes persist and increment `defer_count`.

### Phase 5 — Future windows
Day grid, projected load, window scoring, defended holds.

**Acceptance:** a camping hold placed in a busy stretch causes coursework to schedule earlier rather than break. The conflict surfaces when the hold makes work unplaceable.

### Phase 6 — Advisor and reconciliation
Signal queries, brief generation, daily check-in, calibration job.

**Acceptance:** five or more logged completions shift the multiplier. The drift query surfaces a person past cadence alongside a costed free slot.

### Phase 6.5 — Promotion loop and derived reminders
Promotion and demotion proposals, derived generation, cascade-on-parent-delete.

**Acceptance:** a reminder deferred three times produces exactly one promotion proposal. Accepting it creates a task and triggers a re-solve. Deleting an activity hold dismisses its derived reminder.

### Phase 7 — Google Calendar import
Read-only pull into `fixed_blocks`, deduplicated on `external_id`.

**Acceptance:** re-import is idempotent. Events deleted upstream are removed locally.

---

## 17. Non-goals

Explicitly out of scope for v1. Do not build.

- Inferring other people's availability (D10). Availability is user-supplied or polled.
- Multi-user or shared scheduling.
- Native mobile. Responsive web only.
- Calendar write-back (D14).
- Maps-API travel time. Static per-location buffers are sufficient.
- Machine learning on preferences. The calibration multiplier is the only learned parameter.
- Billing, onboarding, marketing site.

---

## 18. Risks

| Risk | Mitigation |
|---|---|
| Input data rots and estimates become fiction | Phase 6 is not optional. Keep chat capture frictionless — any added friction kills the product |
| Displacement cost is O(candidates × solve) | Pre-filter to 20 candidates; compute the baseline once per request. Profile before optimising further |
| Schedule thrash destroys trust | D6 and D7. Monitor `schedule_runs.moved_count`; a no-op re-solve that moves anything is a bug |
| Over-scheduling causes abandonment | `max_task_minutes_per_day` defaults to 300, not 480. Leave slack deliberately |
| Notification fatigue | Budget is a hard cap (D17). Default of 5 is deliberate — raise only after reminders are demonstrably being missed |
| Derived reminders accumulate as orphaned noise | Idempotent generation keyed on parent; cascade dismissal on parent change (§10.7) |
| Promotion proposals become nagging | D24: offered once per reminder, ever. Declining is permanent |
| Solvers become undebuggable | Every run writes `schedule_runs`. Add a "why is this here?" affordance reading the run record |
| Reminders and tasks blur together in the UI | Render them visually distinct (§14.4). A reminder never appears as a block on the calendar |
| Cold start blocks productisation | Not a v1 risk with one user. Becomes the primary risk the moment a second exists. Design onboarding before opening signups, not after |
| Google verification delays launch | Begin during Phase 2, not Phase 7 |

---

## 19. Appendix: seed data

**Profile:** timezone `America/St_Johns`, sleep 23:30–07:30, attention budget 5.

**Categories:** coursework, txtsquad, sjhc, build, admin.

**Energy windows:** 08:00–12:00 deep 0.9 · 13:00–17:00 admin 0.6 · 17:30–19:00 physical 0.8 · 19:00–22:00 social 0.7.

**Fixed blocks:** two classes weekly, three TxtSquad shifts, one Saturday hike (`high_exertion = true`).

**Tasks:** CP assignment, 360 min, due +9d · Kiwi IDE work, 240 min, no deadline · admin, 60 min, due +2d.

**Habits:** gym 3×/week, 60 min, physical · violin 4×/week, 30 min, creative.

**People:** Maria, cadence 1 · Nick, cadence 21, last seen 24d · Erin, cadence 21, last seen 22d.

**Activity type:** camping — 30h minimum, overnight, May 15 to Sep 30, lead time 10d, buffer 12h.

**Reminders:** subscription renewal on the 7th monthly, ambient · "call about the gear," window, this week · "message Dee," context, before the next hike, lead 24h, importance 4 · "look into Expo push," latent · derived "book Butter Pot" from the camping hold.

### Canonical test cases

1. **Advisor** — Nick and Erin both past cadence with a genuinely free Wednesday evening.
2. **Attention budget** — twelve pending reminders, budget of five, one at importance 5.
3. **Window defence** — a camping hold that forces coursework earlier without breaking it.
4. **Offer integrity** — three offered slots that survive an overnight solve without being backfilled.
