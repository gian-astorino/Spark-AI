-- The import now runs as a Firecrawl crawl with JSON extraction per page.
alter table import_jobs
  add column firecrawl_id text,
  add column pages_total smallint,
  -- Set by the one check that gets to process the finished crawl, so two
  -- overlapping checks never write the profile twice.
  add column processing_started_at timestamptz;
