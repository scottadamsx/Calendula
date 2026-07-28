-- Phase 1: calendula_fixed_blocks are expanded into concrete calendula_placements rows on an
-- ingestion cron (see CLAUDE.md's resolved SPEC-GAP — recurring calendula_fixed_blocks
-- have no other rule for reaching the grid, which reads only `calendula_placements`,
-- D11). The expansion must be idempotent re-run over the same horizon
-- without duplicating rows, so each (user, source, occurrence-start) is
-- unique and the sync upserts on it.
create unique index placements_source_occurrence_key
  on calendula_placements (user_id, source_type, source_id, starts_at);
