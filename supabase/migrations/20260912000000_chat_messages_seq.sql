-- Rows persisted in one turn share a created_at (one insert statement, one
-- now()), so ordering by created_at alone is nondeterministic across a turn's
-- own rows — and the Messages API rejects a transcript whose tool_result
-- doesn't directly follow its tool_use. A sequence makes replay order exact.
alter table calendula_chat_messages add column if not exists seq bigserial;
create index if not exists calendula_chat_messages_user_seq on calendula_chat_messages (user_id, seq);
