-- Spark onboarding: the business profile, how it was collected, and the
-- conversation that collected it.
--
-- One business per owner for now. Every table below hangs off `businesses`
-- and is readable and writable only by that business's owner (RLS at the end).
-- The Edge Functions (import, agent) run with the service role and bypass RLS.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Where a piece of the profile came from. Import results are a draft until the
-- owner confirms them in the chat; anything the owner says overrides them.
create type data_source as enum ('import', 'chat', 'manual');

create type onboarding_status as enum ('started', 'importing', 'chatting', 'completed');

create type import_source as enum ('website', 'instagram');

create type import_status as enum ('queued', 'running', 'done', 'failed', 'skipped');

-- The profile sections, as the UI shows them. Used for import progress.
create type profile_section as enum ('business', 'location', 'branding', 'catalog', 'calendar');

create type calendar_provider as enum (
  'google_calendar', 'outlook', 'apple_calendar', 'fresha', 'treatwell', 'paper', 'other'
);

create type message_role as enum ('user', 'assistant');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Business
-- ---------------------------------------------------------------------------

create table businesses (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  name              text,
  description       text,
  sector            text,
  website_url       text,
  instagram_handle  text,
  onboarding_status onboarding_status not null default 'started',
  source            data_source,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index businesses_owner_idx on businesses (owner_id);
create trigger businesses_updated_at before update on businesses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Locations and opening hours
-- ---------------------------------------------------------------------------

create table locations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name        text,
  -- As written by the site or the owner. Structured parts are filled when we
  -- can parse them, never required: "Via Tortona 12, Milano" is a valid start.
  address     text not null,
  street      text,
  city        text,
  postal_code text,
  country     char(2) default 'IT',
  timezone    text not null default 'Europe/Rome',
  position    smallint not null default 0,
  source      data_source not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index locations_business_idx on locations (business_id);
create trigger locations_updated_at before update on locations
  for each row execute function set_updated_at();

-- One row per open interval. A closed day has no rows; a lunch break is two
-- rows on the same weekday.
create table opening_hours (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  opens_at    time not null,
  closes_at   time not null,
  check (closes_at > opens_at)
);

create index opening_hours_location_idx on opening_hours (location_id, weekday);

-- ---------------------------------------------------------------------------
-- Branding
-- ---------------------------------------------------------------------------

create table brand_profiles (
  business_id     uuid primary key references businesses (id) on delete cascade,
  -- Path in the `logos` storage bucket; the original URL is kept to re-fetch.
  logo_path       text,
  logo_source_url text,
  tone_of_voice   text[] not null default '{}',
  source          data_source not null,
  updated_at      timestamptz not null default now()
);

create trigger brand_profiles_updated_at before update on brand_profiles
  for each row execute function set_updated_at();

create table brand_colors (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name        text,
  hex         char(7) not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  position    smallint not null default 0,
  source      data_source not null
);

create index brand_colors_business_idx on brand_colors (business_id);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table catalog_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses (id) on delete cascade,
  name             text not null,
  description      text,
  category         text,
  -- Money in cents, never floats. Null when the site shows no price.
  price_cents      integer check (price_cents >= 0),
  currency         char(3) not null default 'EUR',
  duration_minutes integer check (duration_minutes > 0),
  position         smallint not null default 0,
  source           data_source not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index catalog_items_business_idx on catalog_items (business_id, position);
create trigger catalog_items_updated_at before update on catalog_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Calendar: the team and the calendar they use today
-- ---------------------------------------------------------------------------

create table team_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses (id) on delete cascade,
  display_name text not null,
  role         text,
  position     smallint not null default 0,
  source       data_source not null,
  created_at   timestamptz not null default now()
);

create index team_members_business_idx on team_members (business_id);

-- What the owner told us they use. Connecting to it (OAuth, API) is a later
-- step and gets its own table when it exists.
create table calendar_setups (
  business_id    uuid primary key references businesses (id) on delete cascade,
  provider       calendar_provider not null,
  provider_label text, -- free text when provider = 'other'
  source         data_source not null,
  updated_at     timestamptz not null default now()
);

create trigger calendar_setups_updated_at before update on calendar_setups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Import: one job per attempt, with the raw pages kept for re-extraction
-- ---------------------------------------------------------------------------

create table import_jobs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  source      import_source not null,
  target      text not null, -- https URL or Instagram handle
  status      import_status not null default 'queued',
  -- Sections already written to the profile, in order: drives the marker and
  -- the panel's skeletons.
  sections_done profile_section[] not null default '{}',
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

create index import_jobs_business_idx on import_jobs (business_id, created_at desc);

-- What the scraper fetched. Kept so extraction can be re-run with a better
-- prompt without scraping the site again. Service role only.
create table scraped_pages (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references import_jobs (id) on delete cascade,
  url        text not null,
  title      text,
  markdown   text not null,
  fetched_at timestamptz not null default now()
);

create index scraped_pages_job_idx on scraped_pages (job_id);

-- ---------------------------------------------------------------------------
-- Conversation with the agent
-- ---------------------------------------------------------------------------

create table conversations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index conversations_business_idx on conversations (business_id);

-- `content` stores the model's content blocks exactly as returned (text,
-- tool_use, tool_result, thinking). The history is replayed to the model
-- verbatim, so it is append-only: never edit a stored message.
create table messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references conversations (id) on delete cascade,
  role            message_role not null,
  content         jsonb not null,
  -- What the UI renders: the text, or a marker such as {"type":"import","job_id":…}.
  display         jsonb,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, id);

create rule messages_append_only as on update to messages do instead nothing;

-- ---------------------------------------------------------------------------
-- Row level security: an owner sees and edits only their own business
-- ---------------------------------------------------------------------------

create function owns_business(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses where id = bid and owner_id = auth.uid());
$$;

alter table businesses      enable row level security;
alter table locations       enable row level security;
alter table opening_hours   enable row level security;
alter table brand_profiles  enable row level security;
alter table brand_colors    enable row level security;
alter table catalog_items   enable row level security;
alter table team_members    enable row level security;
alter table calendar_setups enable row level security;
alter table import_jobs     enable row level security;
alter table scraped_pages   enable row level security; -- no policy: service role only
alter table conversations   enable row level security;
alter table messages        enable row level security;

create policy owner_all on businesses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy owner_all on locations       for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy owner_all on brand_profiles  for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy owner_all on brand_colors    for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy owner_all on catalog_items   for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy owner_all on team_members    for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy owner_all on calendar_setups for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy owner_all on conversations   for all using (owns_business(business_id)) with check (owns_business(business_id));

create policy owner_all on opening_hours for all
  using (exists (select 1 from locations l where l.id = location_id and owns_business(l.business_id)))
  with check (exists (select 1 from locations l where l.id = location_id and owns_business(l.business_id)));

-- Jobs and messages are written by the Edge Functions; the owner only reads.
create policy owner_read on import_jobs for select using (owns_business(business_id));

create policy owner_read on messages for select
  using (exists (select 1 from conversations c where c.id = conversation_id and owns_business(c.business_id)));

-- ---------------------------------------------------------------------------
-- Realtime: the profile panel and the import marker update live
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  businesses, locations, opening_hours, brand_profiles, brand_colors,
  catalog_items, team_members, calendar_setups, import_jobs, messages;

-- ---------------------------------------------------------------------------
-- Storage: logos, one folder per business
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('logos', 'logos', false);

create policy owner_read_logos on storage.objects for select
  using (bucket_id = 'logos' and owns_business(((storage.foldername(name))[1])::uuid));
