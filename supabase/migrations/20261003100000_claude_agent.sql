-- The agent moves to Claude and acts through skills: one conversation runs
-- as a loop of steps the app moves on, the ads it makes are records of their
-- own (any number, each with its images), and what it writes down for later
-- (a strategy, a report, a memory) is a note.

-- ---------------------------------------------------------------------------
-- Conversation: one loop at a time, resumable
-- ---------------------------------------------------------------------------

-- 'openai' conversations are read only (their history is shown); new turns
-- go to the latest 'claude' one. `messages.content` holds Claude's content
-- blocks verbatim (thinking, tool_use, tool_result, compaction): the history
-- is replayed as it is, so it stays append-only.
alter table conversations
  add column engine text not null default 'openai',
  add column status text not null default 'idle',
  -- What the agent is doing right now, for the app ("Leggo example.com").
  add column activity text,
  -- The step under way: a later call that finds it fresh just reports.
  add column processing_started_at timestamptz,
  -- The current owner's turn: rounds used, pages read, choices and ads to show.
  add column turn jsonb not null default '{}';

-- Why the model stopped: 'tool_use' and 'pause_turn' mean the loop goes on.
alter table messages add column stop_reason text;

alter publication supabase_realtime add table conversations;

-- ---------------------------------------------------------------------------
-- Ads
-- ---------------------------------------------------------------------------

-- `content` is what the agent decided: the strategy behind it, the copy, the
-- creative brief. Its shape is the agent's (see the save_ad tool); the app
-- shows the fields it knows and lists the rest.
create table ads (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name        text not null,
  status      text not null default 'draft',
  content     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ads_business_idx on ads (business_id, updated_at desc);
alter table ads enable row level security;
create policy owner_read on ads for select using (owns_business(business_id));

-- Every image made for an ad, newest last: an edit is a new image, the old
-- ones stay. Generated as OpenAI background jobs (see _shared/image-jobs.ts).
create table ad_images (
  id          uuid primary key default gen_random_uuid(),
  ad_id       uuid not null references ads (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  prompt      text not null,
  size        text,
  job_id      text,
  status      text not null default 'running',
  path        text,
  error       text,
  created_at  timestamptz not null default now()
);
create index ad_images_ad_idx on ad_images (ad_id, created_at);
alter table ad_images enable row level security;
create policy owner_read on ad_images for select using (owns_business(business_id));
alter publication supabase_realtime add table ad_images;

-- The first-campaign proposals made so far become ads.
insert into ads (id, business_id, name, status, content, created_at, updated_at)
select
  p.id,
  p.business_id,
  coalesce(p.content #>> '{campaign,product}', 'Prima campagna'),
  'draft',
  jsonb_build_object(
    'objective', 'Acquisire nuovi clienti',
    'strategy', jsonb_build_array(
      jsonb_build_object('label', 'Prodotto o servizio', 'text', p.content #>> '{campaign,product}'),
      jsonb_build_object('label', 'Offerta', 'text', p.content #>> '{campaign,offer}'),
      jsonb_build_object('label', 'Target', 'text', p.content #>> '{campaign,target}'),
      jsonb_build_object('label', 'Problema o desiderio', 'text', p.content #>> '{campaign,problem}'),
      jsonb_build_object('label', 'Angolo', 'text', p.content #>> '{campaign,angle}'),
      jsonb_build_object('label', 'CPL medio stimato', 'text', concat(p.content #>> '{cpl,estimate_eur}', ' € — ', p.content #>> '{cpl,reasoning}')),
      jsonb_build_object('label', 'Consapevolezza', 'text', p.content ->> 'awareness')
    ),
    'copy', jsonb_build_object(
      'primary_text', p.content #>> '{ad,primary_text}',
      'headline', p.content #>> '{ad,headline}',
      'description', null,
      'cta', p.content #>> '{ad,cta}'
    ),
    'creative', jsonb_build_object(
      'format', p.content #>> '{creative,format}',
      'brief', p.content #>> '{creative,hero_visual}',
      'text_on_image', p.content #>> '{creative,copy_on_image}'
    )
  ),
  p.created_at,
  p.created_at
from ad_proposals p
where p.proposal_status = 'done' and p.content ->> 'version' = '3';

insert into ad_images (ad_id, business_id, prompt, status, path, created_at)
select p.id, p.business_id, '(prima versione)', 'done', p.creative_path, p.created_at
from ad_proposals p
where p.proposal_status = 'done' and p.content ->> 'version' = '3' and p.creative_path is not null;

-- ---------------------------------------------------------------------------
-- Notes: what the agent keeps for later
-- ---------------------------------------------------------------------------

create table agent_notes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- Free: 'strategy', 'report', 'memory', … as the skills use them.
  kind        text not null,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index agent_notes_business_idx on agent_notes (business_id, kind, updated_at desc);
alter table agent_notes enable row level security;
create policy owner_read on agent_notes for select using (owns_business(business_id));

-- ---------------------------------------------------------------------------
-- Skills edited live
-- ---------------------------------------------------------------------------

-- The skills ship with the agent function (functions/agent/skills). A row
-- here adds a skill, or replaces the shipped one with the same name, without
-- a deploy; `enabled = false` turns a skill off. Admins only.
create table agent_skills (
  name        text primary key check (name ~ '^[a-z0-9-]+$'),
  description text not null,
  body        text not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table agent_skills enable row level security;
create policy admin_all on agent_skills for all using (is_admin()) with check (is_admin());
