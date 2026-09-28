-- Font families the site uses, most prominent first.
alter table brand_profiles add column fonts text[] not null default '{}';

-- Firecrawl's branding analysis as returned, to re-read without scraping again.
alter table import_jobs add column raw_branding jsonb;
