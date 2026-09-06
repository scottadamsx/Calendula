-- New main space (Scotty's request, 2026-08-26): a conversational agent that
-- reads/updates the calendar via the exact same server actions the form UI
-- uses, asking multiple-choice follow-up questions when it needs more
-- information. Not in the original spec — spec §13 only ever named a
-- one-shot `POST /api/ingest` (never built, LLM-gated like everything else
-- in this project without ANTHROPIC_API_KEY); this is a genuinely new,
-- multi-turn surface.
--
-- `content` stores the exact Anthropic content-block array (text, tool_use,
-- tool_result) as JSONB, not just a display string — replaying a
-- conversation into the Messages API requires the *exact* prior turns,
-- including tool_use/tool_result blocks, not a lossy text transcript. A
-- pending (unanswered) `ask_multiple_choice` tool_use is what "pauses" the
-- agent across requests — the browser click that answers it lands as a new
-- row with a tool_result block, and the pause resolves automatically without
-- a dedicated "pending question" table.
create table calendula_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  role       text not null check (role in ('user', 'assistant')),
  content    jsonb not null,
  created_at timestamptz not null default now()
);

create index on calendula_chat_messages (user_id, created_at);

-- Matches the standard owner policy every other table got from the Phase 0
-- migration's own loop (`create policy owner on %I for all using
-- (auth.uid() = user_id)...`) — this table didn't exist yet to be included
-- in that loop, so it's applied directly here instead.
alter table calendula_chat_messages enable row level security;

create policy owner on calendula_chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
