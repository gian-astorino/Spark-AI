-- The image of an ad proposal, generated from the business's branding.
alter table ad_proposals add column creative_path text;

insert into storage.buckets (id, name, public) values ('creatives', 'creatives', false);

-- One folder per business: `<business_id>/<proposal_id>.png`. The owner reads.
create policy owner_read_creatives on storage.objects for select
  using (bucket_id = 'creatives' and owns_business(((storage.foldername(name))[1])::uuid));
