-- Extraction now runs on our side (OpenAI) over the crawled markdown; its raw
-- output is kept to see why a field came out empty.
alter table import_jobs add column raw_extraction jsonb;
