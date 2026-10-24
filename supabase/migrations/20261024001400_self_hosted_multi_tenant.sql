-- Off Supabase, onto self-hosted Postgres + PostgREST, and multi-tenant.
--
-- RENTIO_MIGRATION_SPEC.md §2 (organizations, org_id everywhere) and §3
-- (replace Supabase auth primitives). Safe to run against the Hetzner restore
-- of the Supabase dump and against a fresh database built from these
-- migrations.
--
-- Session context. The app server verifies the Clerk session, looks up the
-- profile, and mints a short-lived JWT for PostgREST carrying
--   sub    = profiles.id   (internal uuid, NOT the Clerk id)
--   org_id = profiles.org_id
--   role   = authenticated
-- PostgREST puts those claims in the transaction-local `request.jwt.claims`
-- GUC, so a pooled connection can never carry one request's identity into
-- the next. Every helper below reads from there.

-- ---------------------------------------------------------------- roles
-- Supabase created these for us. A plain Postgres has none of them, and a
-- pg_dump never carries roles, so create whatever is missing.
--
-- authenticator is the only role PostgREST logs in as. Set its password by
-- hand, never in a migration:
--   alter role authenticator password '<from Coolify env>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end;
$$;

grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- Nothing is reachable without a session. The two public forms (request
-- access, tenant enrolment) go through app server routes, not PostgREST.
revoke all on all tables in schema public from anon;

-- ------------------------------------------------------ session helpers

create or replace function public.jwt_claim(name text)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.' || name, true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> name
  );
$$;

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claim('sub'), '')::uuid;
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claim('org_id'), '')::uuid;
$$;

-- The restored dump still has policies and functions written against
-- auth.uid(). Point it at the new source so nothing reads a NULL shim.
-- (Swallowed if the restore left auth.uid() owned by a Supabase role.)
create schema if not exists auth;
do $$
begin
  execute $f$
    create or replace function auth.uid() returns uuid
    language sql stable as 'select public.current_user_id()'
  $f$;
exception when insufficient_privilege then
  raise notice 'auth.uid() not replaced (not owner); nothing in public depends on it after this migration';
end;
$$;

-- --------------------------------------------------------- organizations

create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  -- Spec §2.1 has this NOT NULL. Access is resolved from profiles.org_id, so
  -- nothing reads it yet; it is the hook for Clerk Organizations later.
  clerk_org_id  text unique,
  name          text not null,
  slug          text unique not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan          text not null default 'trial',
  doors_limit   integer,
  status        text not null default 'active' check (status in ('active', 'past_due', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

alter table public.organizations enable row level security;

-- Everything already in the database belongs to the first customer. Named
-- after what the existing settings row already calls the company.
insert into public.organizations (name, slug)
select
  s.company_name,
  coalesce(nullif(trim(both '-' from regexp_replace(lower(s.company_name), '[^a-z0-9]+', '-', 'g')), ''), 'first-customer')
from public.settings s
where not exists (select 1 from public.organizations)
order by s.created_at
limit 1;

insert into public.organizations (name, slug)
select 'First customer', 'first-customer'
where not exists (select 1 from public.organizations);

-- ------------------------------------------------- profiles ↔ Clerk (§3.3)

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists clerk_user_id text unique;
-- How an invited or existing profile is matched to a Clerk login the first
-- time that person signs in. Clerk has verified the address by then.
alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_key on public.profiles (lower(email));

do $$
begin
  -- The Hetzner restore's shim has auth.users(id) only, no email: skip.
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'email') then
    update public.profiles p set email = u.email
    from auth.users u
    where u.id = p.id and p.email is null;
  end if;
end;
$$;

-- --------------------------------------------------- org_id everywhere (§2.2)

do $$
declare
  first_org uuid := (select id from public.organizations order by created_at limit 1);
  t text;
begin
  foreach t in array array[
    -- roots
    'properties','tenants','settings','access_requests','activity_log','documents',
    -- descendants (denormalised on purpose: simple policies, simple indexes)
    'units','parking_spaces','leases','lease_tenants','lease_notices','invoices',
    'invoice_lines','payments','payment_allocations','expenses','utility_charges',
    'work_orders','work_order_notes','work_order_photos','unit_turnover_checklist',
    -- nullable: super_admin has no org
    'profiles'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid references public.organizations (id) on delete restrict', t);
    -- Backfill without firing the late-fee guard, updated_at stamps, etc.
    -- on rows that are only gaining a column.
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set org_id = $1 where org_id is null', t) using first_org;
    execute format('alter table public.%I enable trigger user', t);
    if t <> 'profiles' then
      execute format('alter table public.%I alter column org_id set not null', t);
    end if;
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_id_idx', t);
  end loop;
end;
$$;

-- Every table defaults to the caller's org, so no client ever sends org_id.
-- For descendants the trigger below then checks that default against the
-- parent row (and fills it from the parent when there is no caller org: a
-- service connection, or super_admin).
do $$
declare
  t text;
begin
  foreach t in array array[
    'properties','tenants','settings','access_requests','activity_log','documents',
    'units','parking_spaces','leases','lease_tenants','lease_notices','invoices',
    'invoice_lines','payments','payment_allocations','expenses','utility_charges',
    'work_orders','work_order_notes','work_order_photos','unit_turnover_checklist'
  ]
  loop
    execute format('alter table public.%I alter column org_id set default public.current_org_id()', t);
  end loop;
end;
$$;

-- Descendants inherit org_id from their parent and refuse a mismatch, so an
-- API bug cannot write a row that points across organizations.
create or replace function public.org_from_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id  uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  parent_org uuid;
begin
  if parent_id is not null then
    execute format('select org_id from public.%I where id = $1', tg_argv[0])
      into parent_org using parent_id;
  end if;

  if parent_org is null then
    -- Nullable parent left empty: the caller's org.
    new.org_id := coalesce(new.org_id, public.current_org_id());
  elsif new.org_id is null then
    new.org_id := parent_org;
  elsif new.org_id <> parent_org then
    -- Also catches an UPDATE re-parenting a row under another org's parent.
    raise exception 'org_id mismatch on %: parent %.% belongs to another organization',
      tg_table_name, tg_argv[0], parent_id using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  rel text[];
begin
  foreach rel slice 1 in array array[
    ['units',                   'properties',  'property_id'],
    ['parking_spaces',          'properties',  'property_id'],
    ['leases',                  'units',       'unit_id'],
    ['lease_tenants',           'leases',      'lease_id'],
    ['lease_notices',           'leases',      'lease_id'],
    ['invoices',                'leases',      'lease_id'],
    ['invoice_lines',           'invoices',    'invoice_id'],
    ['payments',                'leases',      'lease_id'],
    ['payment_allocations',     'payments',    'payment_id'],
    ['expenses',                'units',       'unit_id'],
    ['utility_charges',         'units',       'unit_id'],
    ['work_orders',             'units',       'unit_id'],
    ['work_order_notes',        'work_orders', 'work_order_id'],
    ['work_order_photos',       'work_orders', 'work_order_id'],
    ['unit_turnover_checklist', 'units',       'unit_id']
  ]
  loop
    execute format('drop trigger if exists org_from_parent on public.%I', rel[1]);
    execute format(
      'create trigger org_from_parent before insert or update on public.%I
         for each row execute function public.org_from_parent(%L, %L)',
      rel[1], rel[2], rel[3]);
  end loop;
end;
$$;

-- Hot filters (§2.3). The plain (org_id) ones were created in the loop.
create index if not exists invoices_org_status_idx   on public.invoices (org_id, status);
create index if not exists invoices_org_due_date_idx on public.invoices (org_id, due_date);
create index if not exists work_orders_org_status_idx on public.work_orders (org_id, status);

-- ------------------------------------------- uniqueness that was global

-- settings was a singleton; now one row per organization.
alter table public.settings drop column if exists singleton;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_org_id_key') then
    alter table public.settings add constraint settings_org_id_key unique (org_id);
  end if;
end;
$$;

-- Two companies may both have REC-00001.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.invoices'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (invoice_number)'
  loop
    execute format('alter table public.invoices drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_invoice_number_key') then
    alter table public.invoices add constraint invoices_org_invoice_number_key unique (org_id, invoice_number);
  end if;
end;
$$;

-- Prefix from the caller's own settings. The counter stays one global
-- sequence, so numbers cannot collide; an org just sees gaps.
-- ponytail: global sequence; per-org counters if a customer asks for gapless numbering.
create or replace function public.next_invoice_number()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce(
           (select invoice_prefix from public.settings where org_id = public.current_org_id()),
           'REC')
      || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
$$;

-- -------------------------------------------------------- role helpers

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_user_id() and role = 'super_admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_user_id() and role in ('admin', 'manager', 'super_admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_user_id() and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = public.current_user_id();
$$;

create or replace function public.my_lease_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select lt.lease_id
  from public.lease_tenants lt
  join public.profiles p on p.tenant_id = lt.tenant_id
  where p.id = public.current_user_id();
$$;

grant execute on function public.jwt_claim, public.current_user_id, public.current_org_id,
  public.is_super_admin to authenticated, service_role;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = public.current_user_id() or public.is_staff());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = public.current_user_id()) with check (id = public.current_user_id());

-- Only an admin hands out roles. Before this, profiles_staff_insert and
-- profiles_staff_update let a manager write role = 'admin' (on themselves
-- or a new row), and a tenant could rewrite its own role through
-- profiles_update_self.
create or replace function public.profiles_restrict_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or public.current_user_id() is null then
    return new;  -- an admin, or the app server's service connection
  end if;
  if tg_op = 'INSERT' then
    if new.role <> 'tenant' then
      raise exception 'Only an admin can create staff accounts' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.org_id is distinct from old.org_id
     or new.tenant_id is distinct from old.tenant_id
     or new.clerk_user_id is distinct from old.clerk_user_id
     or new.email is distinct from old.email then
    raise exception 'Only an admin can change role, organization or login' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_restrict_role_changes on public.profiles;
create trigger profiles_restrict_role_changes
  before insert or update on public.profiles
  for each row execute function public.profiles_restrict_role_changes();

-- --------------------------------------------- org isolation (§3.2)
-- One RESTRICTIVE policy per table, ANDed with every existing permissive
-- policy. The 77 hand-written policies keep deciding WHO within an org may
-- do WHAT; this decides WHICH org, in one place.
-- `(select …)` makes each helper an initplan: evaluated once per statement,
-- not once per row.

do $$
declare
  t text;
begin
  foreach t in array array[
    'properties','tenants','settings','access_requests','activity_log','documents',
    'units','parking_spaces','leases','lease_tenants','lease_notices','invoices',
    'invoice_lines','payments','payment_allocations','expenses','utility_charges',
    'work_orders','work_order_notes','work_order_photos','unit_turnover_checklist'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format(
      'create policy org_isolation on public.%I as restrictive for all to authenticated
         using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
         with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()))',
      t);
  end loop;
end;
$$;

drop policy if exists org_isolation on public.profiles;
create policy org_isolation on public.profiles as restrictive for all to authenticated
  using (
    org_id = (select public.current_org_id())
    or id = (select public.current_user_id())
    or (select public.is_super_admin())
  )
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select public.current_org_id()) or (select public.is_super_admin()));
drop policy if exists organizations_super_admin_write on public.organizations;
create policy organizations_super_admin_write on public.organizations
  for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
grant select, insert, update, delete on public.organizations to authenticated, service_role;

-- -------------------------------------- security-definer views leaked
-- Both bypass RLS by design, so neither saw the org policies above. Before
-- this, any staff member read every org's leases through my_lease_details,
-- and public_settings handed out whichever org's settings came first.

create or replace view public.my_lease_details
with (security_invoker = false)
as
select
  l.id            as lease_id,
  u.id            as unit_id,
  u.unit_number,
  u.floor,
  u.bedrooms,
  u.bathrooms,
  u.sqm,
  p.name          as property_name,
  p.street,
  p.address_line_2,
  p.city,
  p.state,
  p.postal_code
from public.leases l
join public.units u      on u.id = l.unit_id
join public.properties p on p.id = u.property_id
where (public.is_staff() and (l.org_id = public.current_org_id() or public.is_super_admin()))
   or l.id in (select public.my_lease_ids());

create or replace view public.public_settings
with (security_invoker = false)
as
select
  company_name,
  logo_url,
  invoice_prefix,
  street,
  address_line_2,
  city,
  state,
  postal_code,
  phone,
  email,
  zelle_handle,
  check_payable_to,
  check_mailing_address,
  dropoff_address,
  office_hours,
  payment_notes
from public.settings
where org_id = public.current_org_id();

revoke all on public.my_lease_details, public.public_settings from anon;
grant select on public.my_lease_details, public.public_settings to authenticated, service_role;
