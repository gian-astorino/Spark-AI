-- First-ad proposals the model reasons out once the profile is complete:
-- which treatment, what discount, the ad itself, audience and budget.
create table ad_proposals (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  content     jsonb not null,
  created_at  timestamptz not null default now()
);

create index ad_proposals_business_idx on ad_proposals (business_id, created_at desc);
alter table ad_proposals enable row level security;
-- Written by the proposal function; the owner reads.
create policy owner_read on ad_proposals for select using (owns_business(business_id));
