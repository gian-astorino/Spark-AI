-- Transcripts of calls with the client, pasted in the chat: the agent uses
-- them to update the profile and keeps each one as a document — a summary,
-- the key points, the next steps, then the transcript itself — in Markdown.
create table call_transcripts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses (id) on delete cascade,
  title        text not null,
  call_date    date,
  participants text[] not null default '{}',
  summary      text not null,
  document     text not null,
  transcript   text not null,
  created_at   timestamptz not null default now()
);

create index call_transcripts_business_idx on call_transcripts (business_id, created_at desc);
alter table call_transcripts enable row level security;
-- Written by the agent function; the owner reads.
create policy owner_read on call_transcripts for select using (owns_business(business_id));
