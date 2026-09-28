-- The import is now a research run on OpenAI: a background response that
-- searches the web, reads pages through Firecrawl and saves as it goes.
alter table import_jobs
  add column openai_response_id text,
  add column rounds smallint not null default 0,
  -- What the research is doing right now, for the marker in the chat.
  add column activity text,
  add column summary text;
