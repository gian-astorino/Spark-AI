-- The first campaign is reasoned out over the whole context, as an OpenAI
-- background response: the row exists from the start, its content arrives
-- when the job is done.
alter table ad_proposals alter column content drop not null;
alter table ad_proposals
  add column proposal_job_id text,
  add column proposal_status text not null default 'done',
  add column proposal_error text;
