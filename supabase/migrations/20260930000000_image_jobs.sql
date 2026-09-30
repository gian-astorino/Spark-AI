-- Image generations run as OpenAI background responses, checked by the app:
-- no Edge Function waits for the image model.
alter table ad_proposals
  add column creative_job_id text,
  add column creative_status text,
  add column creative_error text;

alter table brand_profiles
  add column logo_job_id text,
  add column logo_job_status text;
