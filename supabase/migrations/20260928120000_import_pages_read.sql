-- How many pages the crawl stored: `scraped_pages` is service-role only, so
-- the owner reads the count here.
alter table import_jobs add column pages_read smallint not null default 0;
