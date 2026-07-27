-- Phase 1: fixed_blocks are expanded into concrete placements rows on an
-- ingestion cron (see CLAUDE.md's resolved SPEC-GAP — recurring fixed_blocks
-- have no other rule for reaching the grid, which reads only `placements`,
-- D11). The expansion must be idempotent re-run over the same horizon
-- without duplicating rows, so each (user, source, occurrence-start) is
-- unique and the sync upserts on it.
create unique index placements_source_occurrence_key
  on placements (user_id, source_type, source_id, starts_at);
