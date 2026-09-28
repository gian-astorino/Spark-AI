-- Fonts with the role they play on the site: [{ "role": "heading", "family": "Marcellus" }, …]
alter table brand_profiles drop column fonts;
alter table brand_profiles add column fonts jsonb not null default '[]';
