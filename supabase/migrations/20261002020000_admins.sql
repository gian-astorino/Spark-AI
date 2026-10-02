-- Roles. Every user has one workspace (one business); admins see and work in
-- all of them, and can create as many as they need.

create table admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
-- A user can tell whether they are an admin; the list itself is the service role's.
create policy self_read on admins for select using (user_id = auth.uid());

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- Every policy built on owns_business (the profile's tables, the chat, the
-- calls, the ads, the storage buckets) now lets admins in too.
create or replace function owns_business(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses where id = bid and owner_id = auth.uid()) or is_admin();
$$;

drop policy owner_all on businesses;
create policy owner_all on businesses
  for all using (owner_id = auth.uid() or is_admin()) with check (owner_id = auth.uid() or is_admin());

-- One workspace per user, admins excepted.
create function one_workspace_per_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admins where user_id = new.owner_id)
     and exists (select 1 from businesses where owner_id = new.owner_id) then
    raise exception 'workspace_limit: this account already has its workspace';
  end if;
  return new;
end;
$$;
create trigger businesses_one_per_user before insert on businesses
  for each row execute function one_workspace_per_user();

-- For admins: who each workspace belongs to.
create function workspace_owners() returns table (business_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select b.id, u.email::text from businesses b join auth.users u on u.id = b.owner_id where is_admin();
$$;

-- The first admin.
insert into admins (user_id)
select id from auth.users where email = 'gianluca@skyground.online';
