-- Imports after the first one (a Treatwell page, a price list, Google Maps…)
-- add to the profile instead of replacing what earlier imports found.
alter table import_jobs add column additive boolean not null default false;
