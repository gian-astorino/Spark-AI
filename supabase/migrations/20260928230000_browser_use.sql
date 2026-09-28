-- The import now runs as a Browser Use run: a hosted agent that browses
-- like a person (clicks, scrolls, screenshots) and returns the profile.
alter table import_jobs
  add column browser_run_id text,
  add column cost_usd numeric(10, 4),
  add column raw_result text;
