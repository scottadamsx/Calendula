-- Phase 6.5: demotion mirrors promotion's own anti-nagging design ("offered
-- once per reminder, ever... declining is permanent," spec §10.6) but the
-- spec's schema never gave `tasks` an equivalent tracking column the way
-- `reminders.promotion_offered` exists — a real gap, not an interpretation
-- call, so it's a migration rather than a workaround.
alter table calendula_tasks
  add column if not exists demotion_offered boolean not null default false;
