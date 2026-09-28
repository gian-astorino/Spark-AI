-- Every source a research run touched, in order: pages read, web searches,
-- image searches, branding reads. Shown to the owner when the run ends.
alter table import_jobs add column sources jsonb not null default '[]';
