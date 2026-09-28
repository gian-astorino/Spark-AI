-- The agent runs on the OpenAI Responses API and continues a conversation
-- from its last response id; `messages` keeps our own transcript.
alter table conversations add column last_response_id text;
