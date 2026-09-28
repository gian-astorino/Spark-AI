-- Files the owner attaches in the chat: photos, price lists, a logo, PDFs.
-- The agent reads them, extracts what they say and can keep them in the
-- profile (as the logo, or as photos of the business).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads', 'uploads', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf']
);

-- One folder per business: `<business_id>/<file>`. The owner uploads and reads.
create policy owner_upload on storage.objects for insert
  with check (bucket_id = 'uploads' and owns_business(((storage.foldername(name))[1])::uuid));
create policy owner_read_uploads on storage.objects for select
  using (bucket_id = 'uploads' and owns_business(((storage.foldername(name))[1])::uuid));

create type media_kind as enum ('photo');

-- Images the agent kept as part of the profile (the logo lives in brand_profiles).
create table business_media (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  kind        media_kind not null default 'photo',
  bucket      text not null,
  path        text not null,
  caption     text,
  position    smallint not null default 0,
  source      data_source not null,
  created_at  timestamptz not null default now()
);

create index business_media_business_idx on business_media (business_id, position);
alter table business_media enable row level security;
create policy owner_all on business_media
  for all using (owns_business(business_id)) with check (owns_business(business_id));
alter publication supabase_realtime add table business_media;
