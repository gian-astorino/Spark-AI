-- The colours of the business's website, as Firecrawl reads them from its
-- home page (primary, accent, background…). The brand palette starts from
-- the logo's colours and is completed with these; the brand board uses both.
alter table brand_profiles add column site_colors jsonb;
