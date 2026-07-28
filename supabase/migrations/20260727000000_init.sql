-- Calendula v3 — Phase 0 schema (spec §5).
-- Every table carries user_id and RLS with the owner policy, no exceptions
-- (spec §4, "Free now, expensive later").

-- =============================================================================
-- Enum types (§5.2, §5.8)
-- =============================================================================

create type calendula_energy_label as enum ('deep', 'admin', 'social', 'physical', 'creative');
create type calendula_reminder_kind as enum ('moment', 'window', 'context', 'latent');
create type calendula_trigger_type as enum ('time', 'before_placement', 'after_placement', 'location');
create type calendula_reminder_status as enum ('pending', 'delivered', 'acknowledged', 'done', 'dismissed', 'promoted');
create type calendula_interruption_cost as enum ('ambient', 'notify', 'insist');

-- =============================================================================
-- §5.1 Profile and constraints
-- =============================================================================

create table calendula_scheduling_profile (
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

create table calendula_attention_profile (
  user_id                  uuid primary key references auth.users(id),
  attention_budget_per_day int not null default 5,
  min_gap_minutes          int not null default 45,
  quiet_start              time,
  quiet_end                time,
  batch_by_default         boolean not null default true,
  promote_after_defers     int not null default 3
);

-- =============================================================================
-- §5.2 Categories and labels
-- =============================================================================

create table calendula_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  name       text not null,
  color      text,
  created_at timestamptz default now(),
  unique (user_id, name)
);

create table calendula_energy_windows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  day_of_week int,
  start_time  time not null,
  end_time    time not null,
  quality     numeric not null check (quality between 0 and 1),
  label       calendula_energy_label not null
);

-- =============================================================================
-- §5.3 People
-- =============================================================================

create table calendula_people (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  name                 text not null,
  desired_cadence_days int,
  last_interaction_at  timestamptz,
  location             text,
  notes                text,
  created_at           timestamptz default now()
);

-- =============================================================================
-- §5.4 Commitments
-- =============================================================================

create table calendula_fixed_blocks (
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

create table calendula_tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  category_id       uuid references calendula_categories(id),
  title             text not null,
  estimated_minutes int not null,
  remaining_minutes int not null,
  deadline          timestamptz,
  priority          int not null default 3 check (priority between 1 and 5),
  min_chunk_minutes int not null default 45,
  max_chunk_minutes int not null default 180,
  splittable        boolean not null default true,
  preferred_labels  calendula_energy_label[],
  status            text not null default 'active',
  skip_count        int not null default 0,
  created_at        timestamptz default now()
);

create table calendula_habits (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null,
  title                    text not null,
  duration_minutes         int not null,
  target_sessions_per_week int not null,
  min_spacing_hours        int not null default 24,
  preferred_labels         calendula_energy_label[],
  earliest_time            time,
  latest_time              time,
  location                 text,
  travel_buffer_minutes    int not null default 0,
  active                   boolean not null default true
);

-- =============================================================================
-- §5.5 Placements — the occupancy table. The grid engine reads nothing else.
-- =============================================================================

create table calendula_placements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  source_type text not null check (source_type in
                ('fixed', 'task', 'habit', 'activity_hold', 'meeting_hold', 'meeting')),
  source_id   uuid not null,
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  hardness    text not null check (hardness in ('hard', 'soft', 'tentative')),
  pinned      boolean not null default false,
  location    text,
  run_id      uuid,
  created_at  timestamptz default now()
);

create index on calendula_placements (user_id, starts_at, ends_at);
create index on calendula_placements (user_id, hardness);

-- =============================================================================
-- §5.6 Future activities
-- =============================================================================

create table calendula_activity_types (
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

create table calendula_activity_holds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  activity_type_id uuid not null references calendula_activity_types(id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'held',
  participants     uuid[],
  created_at       timestamptz default now()
);

-- =============================================================================
-- §5.7 Meeting offers
-- =============================================================================

create table calendula_meeting_offers (
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

-- SPEC-GAP (see CLAUDE.md escalation rule): §5.7 of the v3 doc omits user_id
-- from calendula_meeting_offer_slots, which contradicts §5's own "every table carries
-- user_id" invariant and would leave this table unreachable by the standard
-- owner RLS policy. Recommendation applied: denormalize user_id onto the
-- child row so the same policy shape covers it. Flagging rather than silently
-- deviating — revisit if the spec is amended.
create table calendula_meeting_offer_slots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  offer_id          uuid not null references calendula_meeting_offers(id) on delete cascade,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  displacement_cost numeric not null,
  placement_id      uuid references calendula_placements(id) on delete set null,
  chosen            boolean not null default false
);

-- =============================================================================
-- §5.8 Reminders
-- =============================================================================

create table calendula_reminders (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null,
  category_id          uuid references calendula_categories(id),
  title                text not null,
  body                 text,
  kind                 calendula_reminder_kind not null,

  due_at               timestamptz,
  window_start         timestamptz,
  window_end           timestamptz,

  trigger              calendula_trigger_type not null default 'time',
  trigger_placement_id uuid references calendula_placements(id) on delete cascade,
  lead_minutes         int not null default 0,
  location             text,

  importance           int not null default 3 check (importance between 1 and 5),
  cost                 calendula_interruption_cost not null default 'notify',
  person_id            uuid references calendula_people(id),

  recurrence           text,
  status               calendula_reminder_status not null default 'pending',
  defer_count          int not null default 0,
  promotion_offered    boolean not null default false,

  source               text not null default 'user',
  derived_from_type    text,
  derived_from_id      uuid,

  created_at           timestamptz default now(),
  completed_at         timestamptz
);

create index on calendula_reminders (user_id, status, due_at);
create index on calendula_reminders (user_id, trigger_placement_id);

create table calendula_reminder_deliveries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  reminder_id  uuid not null references calendula_reminders(id) on delete cascade,
  batch_id     uuid,
  scheduled_at timestamptz not null,
  delivered_at timestamptz,
  channel      text not null,
  receptivity  numeric,
  urgency      numeric,
  outcome      text,
  created_at   timestamptz default now()
);

-- =============================================================================
-- §5.9 Reconciliation
-- =============================================================================

create table calendula_completions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  task_id         uuid references calendula_tasks(id),
  habit_id        uuid references calendula_habits(id),
  placement_id    uuid references calendula_placements(id),
  planned_minutes int,
  actual_minutes  int,
  completed       boolean not null,
  logged_at       timestamptz default now()
);

create table calendula_duration_calibration (
  user_id     uuid not null,
  category_id uuid not null references calendula_categories(id),
  multiplier  numeric not null default 1.0,
  sample_size int not null default 0,
  updated_at  timestamptz default now(),
  primary key (user_id, category_id)
);

-- =============================================================================
-- §5.10 Audit
-- =============================================================================

create table calendula_schedule_runs (
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

-- =============================================================================
-- Row-level security — every table, no exceptions (spec §4, §5).
-- =============================================================================

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'calendula_scheduling_profile', 'calendula_attention_profile',
      'calendula_categories', 'calendula_energy_windows',
      'calendula_people',
      'calendula_fixed_blocks', 'calendula_tasks', 'calendula_habits',
      'calendula_placements',
      'calendula_activity_types', 'calendula_activity_holds',
      'calendula_meeting_offers', 'calendula_meeting_offer_slots',
      'calendula_reminders', 'calendula_reminder_deliveries',
      'calendula_completions', 'calendula_duration_calibration',
      'calendula_schedule_runs'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy owner on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t
    );
  end loop;
end $$;
