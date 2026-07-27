-- Local-dev-only seed data (spec §19 appendix). Never run against a
-- production project — it inserts directly into auth.users, which is only
-- safe on a local Supabase instance (`supabase start` / `supabase db reset`).
--
-- Everything below is scoped to one fixed synthetic user id so RLS can be
-- exercised: sign in as this user and every row should be visible; sign in
-- as any other user (or anon) and every table should return zero rows
-- (Phase 0 acceptance criterion, spec §16).

do $$
declare
  seed_user_id uuid := '00000000-0000-0000-0000-000000000001';
  cat_coursework uuid;
  cat_txtsquad   uuid;
  cat_sjhc       uuid;
  cat_build      uuid;
  cat_admin      uuid;
  hike_block_id  uuid;
  camping_type_id uuid;
  camping_hold_id uuid;
begin
  -- Synthetic auth user, local only.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', seed_user_id, 'authenticated', 'authenticated',
    'scott@calendula.local', crypt('password', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}'
  )
  on conflict (id) do nothing;

  -- §19: profile — timezone America/St_Johns, sleep 23:30–07:30, budget 5.
  insert into scheduling_profile (user_id) values (seed_user_id)
  on conflict (user_id) do nothing;

  insert into attention_profile (user_id) values (seed_user_id)
  on conflict (user_id) do nothing;

  -- Categories.
  insert into categories (user_id, name) values
    (seed_user_id, 'coursework'),
    (seed_user_id, 'txtsquad'),
    (seed_user_id, 'sjhc'),
    (seed_user_id, 'build'),
    (seed_user_id, 'admin')
  on conflict (user_id, name) do nothing;

  select id into cat_coursework from categories where user_id = seed_user_id and name = 'coursework';
  select id into cat_txtsquad   from categories where user_id = seed_user_id and name = 'txtsquad';
  select id into cat_sjhc       from categories where user_id = seed_user_id and name = 'sjhc';
  select id into cat_build      from categories where user_id = seed_user_id and name = 'build';
  select id into cat_admin      from categories where user_id = seed_user_id and name = 'admin';

  -- Energy windows — apply every day (day_of_week null).
  insert into energy_windows (user_id, day_of_week, start_time, end_time, quality, label) values
    (seed_user_id, null, '08:00', '12:00', 0.9, 'deep'),
    (seed_user_id, null, '13:00', '17:00', 0.6, 'admin'),
    (seed_user_id, null, '17:30', '19:00', 0.8, 'physical'),
    (seed_user_id, null, '19:00', '22:00', 0.7, 'social');

  -- Fixed blocks — two classes weekly, three TxtSquad shifts, one Saturday
  -- hike (high_exertion). Anchored to the current week so the seed stays
  -- meaningful whenever it's applied.
  insert into fixed_blocks (user_id, title, starts_at, ends_at, rrule, source) values
    (seed_user_id, 'Class — CP 2315',
      date_trunc('week', now()) + interval '0 day' + time '09:00',
      date_trunc('week', now()) + interval '0 day' + time '10:30',
      'FREQ=WEEKLY;BYDAY=MO', 'manual'),
    (seed_user_id, 'Class — CP 4485',
      date_trunc('week', now()) + interval '2 day' + time '09:00',
      date_trunc('week', now()) + interval '2 day' + time '10:30',
      'FREQ=WEEKLY;BYDAY=WE', 'manual'),
    (seed_user_id, 'TxtSquad shift',
      date_trunc('week', now()) + interval '1 day' + time '13:00',
      date_trunc('week', now()) + interval '1 day' + time '17:00',
      'FREQ=WEEKLY;BYDAY=TU', 'manual'),
    (seed_user_id, 'TxtSquad shift',
      date_trunc('week', now()) + interval '3 day' + time '13:00',
      date_trunc('week', now()) + interval '3 day' + time '17:00',
      'FREQ=WEEKLY;BYDAY=TH', 'manual'),
    (seed_user_id, 'TxtSquad shift',
      date_trunc('week', now()) + interval '4 day' + time '13:00',
      date_trunc('week', now()) + interval '4 day' + time '17:00',
      'FREQ=WEEKLY;BYDAY=FR', 'manual');

  insert into fixed_blocks (user_id, title, starts_at, ends_at, high_exertion, rrule, source)
  values (
    seed_user_id, 'Saturday hike',
    date_trunc('week', now()) + interval '5 day' + time '08:00',
    date_trunc('week', now()) + interval '5 day' + time '16:00',
    true, 'FREQ=WEEKLY;BYDAY=SA', 'manual'
  )
  returning id into hike_block_id;

  -- Tasks: CP assignment 360m due +9d · Kiwi IDE work 240m no deadline ·
  -- admin 60m due +2d.
  insert into tasks (user_id, category_id, title, estimated_minutes, remaining_minutes, deadline) values
    (seed_user_id, cat_coursework, 'CP assignment', 360, 360, now() + interval '9 day'),
    (seed_user_id, cat_build, 'Kiwi IDE work', 240, 240, null),
    (seed_user_id, cat_admin, 'Admin', 60, 60, now() + interval '2 day');

  -- Habits: gym 3x/week 60m physical · violin 4x/week 30m creative.
  insert into habits (user_id, title, duration_minutes, target_sessions_per_week, preferred_labels) values
    (seed_user_id, 'Gym', 60, 3, array['physical']::energy_label[]),
    (seed_user_id, 'Violin', 30, 4, array['creative']::energy_label[]);

  -- People: Maria cadence 1 · Nick cadence 21 last seen 24d · Erin cadence 21 last seen 22d.
  insert into people (user_id, name, desired_cadence_days, last_interaction_at) values
    (seed_user_id, 'Maria', 1, now() - interval '1 day'),
    (seed_user_id, 'Nick', 21, now() - interval '24 day'),
    (seed_user_id, 'Erin', 21, now() - interval '22 day');

  -- Activity type: camping — 30h min, overnight, May 15–Sep 30, lead 10d, buffer 12h.
  insert into activity_types (
    user_id, name, min_duration_hours, requires_overnight,
    season_start, season_end, lead_time_days, buffer_after_hours
  ) values (
    seed_user_id, 'Camping', 30, true, '2026-05-15', '2026-09-30', 10, 12
  )
  returning id into camping_type_id;

  -- A held camping weekend, so the derived "book Butter Pot" reminder below
  -- has something to derive from (spec §8.3, §10.7 — not itemised as its own
  -- seed row in §19, but implied by the derived reminder it lists).
  insert into activity_holds (user_id, activity_type_id, starts_at, ends_at, status)
  values (
    seed_user_id, camping_type_id,
    '2026-09-12 12:00'::timestamptz, '2026-09-13 18:00'::timestamptz, 'held'
  )
  returning id into camping_hold_id;

  insert into placements (user_id, source_type, source_id, title, starts_at, ends_at, hardness)
  values (
    seed_user_id, 'activity_hold', camping_hold_id, 'Camping — Butter Pot',
    '2026-09-12 12:00'::timestamptz, '2026-09-13 18:00'::timestamptz, 'hard'
  );

  -- Reminders.
  insert into reminders (user_id, title, kind, due_at, cost, recurrence) values
    (seed_user_id, 'Subscription renewal', 'moment', date_trunc('month', now()) + interval '6 day' + interval '9 hour', 'ambient', 'monthly');

  insert into reminders (user_id, title, kind, window_start, window_end) values
    (seed_user_id, 'Call about the gear', 'window', now(), now() + interval '7 day');

  insert into reminders (
    user_id, title, kind, trigger, trigger_placement_id, lead_minutes, importance, person_id
  )
  select
    seed_user_id, 'Message Dee', 'context', 'before_placement', p.id, 1440, 4,
    (select id from people where user_id = seed_user_id and name = 'Maria')
  from placements p
  where p.source_id = hike_block_id and p.source_type = 'fixed'
  limit 1;

  -- The hike fixed_block above has no matching placements row yet in Phase 0
  -- (placements are solver output, and no solver has run) — fall back to a
  -- context reminder with no trigger_placement_id rather than a dangling FK.
  if not exists (
    select 1 from reminders where user_id = seed_user_id and title = 'Message Dee'
  ) then
    insert into reminders (user_id, title, kind, trigger, lead_minutes, importance, person_id)
    values (
      seed_user_id, 'Message Dee', 'context', 'before_placement', 1440, 4,
      (select id from people where user_id = seed_user_id and name = 'Maria')
    );
  end if;

  insert into reminders (user_id, title, kind) values
    (seed_user_id, 'Look into Expo push', 'latent');

  insert into reminders (
    user_id, title, kind, due_at, source, derived_from_type, derived_from_id
  ) values (
    seed_user_id, 'Book Butter Pot for camping', 'moment',
    '2026-09-12 12:00'::timestamptz - interval '10 day',
    'derived', 'activity_holds', camping_hold_id
  );
end $$;
