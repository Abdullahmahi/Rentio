-- Rental applications (issue #6): link -> prospect applies -> staff review
-- -> approve creates the tenant and a draft lease -> the lease activates
-- (e-sign) -> the applicant's login becomes a tenant login.
--
--   application_links         staff hand these out, per org or per unit
--   applications              one per prospect per link; the applicant edits
--                             it while draft, staff decide
--   application_co_applicants other adults on the application
--   application_files         ID and pay stubs, bucket "applications",
--                             path <application_id>/<file>
--   application_reviews       staff only: background-check result and
--                             notes, the decision note. The applicant sees
--                             only applications.status.
--
-- Admin and manager have the same powers here (owner rule): every write is
-- is_staff(), nothing is admin-only.
--
--   approve_application(..)   staff: tenant(s) + draft lease, one transaction
--   leases_promote_applicants trigger: lease becomes 'activo' -> applicant
--                             profiles on it become role 'tenant'
--
-- Applicant profiles are created only by the app server's service
-- connection (/api/fn/start-application), never through PostgREST.
-- profiles.email is unique platform-wide, so one email is one account: an
-- email that already belongs to staff or a tenant cannot apply.

-- ------------------------------------------------------------- tables

create table public.application_links (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org_id() references public.organizations (id) on delete restrict,
  unit_id     uuid references public.units (id) on delete cascade,
  -- 122 random bits; the link is the only thing a prospect holds.
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  active      boolean not null default true,
  created_by  uuid default public.current_user_id() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index application_links_org_id_idx on public.application_links (org_id);

create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org_id() references public.organizations (id) on delete restrict,
  unit_id          uuid references public.units (id) on delete set null,
  link_id          uuid references public.application_links (id) on delete set null,
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'draft'
                   check (status in ('draft', 'submitted', 'under_review', 'approved', 'denied', 'lease_sent')),
  -- answers
  full_name        text,
  email            text,     -- the Clerk-verified login email, set by the server
  phone            text,
  date_of_birth    date,
  current_address  text,
  desired_move_in  date,
  employer         text,
  job_title        text,
  employer_phone   text,
  employment_start date,
  monthly_income   numeric(12, 2) check (monthly_income is null or monthly_income >= 0),
  -- [{address, landlord_name, landlord_phone, rent, from, to, reason}]
  rental_history   jsonb not null default '[]'::jsonb check (jsonb_typeof(rental_history) = 'array'),
  notes            text,
  submitted_at     timestamptz,
  tenant_id       uuid references public.tenants (id) on delete set null,
  lease_id         uuid references public.leases (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);
create index applications_org_status_idx on public.applications (org_id, status);
create index applications_profile_idx on public.applications (profile_id);

create table public.application_co_applicants (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default public.current_org_id() references public.organizations (id) on delete restrict,
  application_id  uuid not null references public.applications (id) on delete cascade,
  full_name       text not null,
  email           text,
  phone           text,
  relationship    text,
  monthly_income  numeric(12, 2) check (monthly_income is null or monthly_income >= 0),
  created_at      timestamptz not null default now()
);
create index application_co_applicants_app_idx on public.application_co_applicants (application_id);

create table public.application_files (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default public.current_org_id() references public.organizations (id) on delete restrict,
  application_id  uuid not null references public.applications (id) on delete cascade,
  kind            text not null default 'other' check (kind in ('id', 'pay_stub', 'other')),
  path            text not null,
  file_name       text,
  created_at      timestamptz not null default now()
);
create index application_files_app_idx on public.application_files (application_id);

-- Staff only. Kept off applications so the applicant's own row never
-- carries what the office wrote about them.
create table public.application_reviews (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.current_org_id() references public.organizations (id) on delete restrict,
  application_id   uuid not null unique references public.applications (id) on delete cascade,
  screening_result text check (screening_result in ('approved', 'denied')),
  screening_note   text,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  decision_note    text,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

create trigger set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.application_reviews
  for each row execute function public.set_updated_at();

do $$
declare
  rel text[];
begin
  foreach rel slice 1 in array array[
    ['application_links',         'units',        'unit_id'],
    ['applications',              'units',        'unit_id'],
    ['application_co_applicants', 'applications', 'application_id'],
    ['application_files',         'applications', 'application_id'],
    ['application_reviews',       'applications', 'application_id']
  ]
  loop
    execute format(
      'create trigger org_from_parent before insert or update on public.%I
         for each row execute function public.org_from_parent(%L, %L)',
      rel[1], rel[2], rel[3]);
  end loop;
end;
$$;

-- --------------------------------------------------------------- RLS

do $$
declare
  t text;
  mine constant text := 'org_id = (select public.current_org_id())';
  platform constant text :=
    '((select public.is_super_admin()) and (select public.current_org_id()) is null)';
begin
  foreach t in array array['application_links', 'applications', 'application_co_applicants',
                           'application_files', 'application_reviews']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy org_isolation_select on public.%I as restrictive for select to authenticated using (%s or %s)', t, mine, platform);
    execute format('create policy org_isolation_insert on public.%I as restrictive for insert to authenticated with check (%s)', t, mine);
    execute format('create policy org_isolation_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t, mine, mine);
    execute format('create policy org_isolation_delete on public.%I as restrictive for delete to authenticated using (%s)', t, mine);
  end loop;
end;
$$;

-- Links: staff only. Prospects reach them through the app server.
create policy application_links_staff on public.application_links
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy application_reviews_staff on public.application_reviews
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Applications: staff read and decide; the applicant reads their own and
-- edits it while it is a draft. Nobody inserts through PostgREST.
create policy applications_select on public.applications
  for select to authenticated
  using (public.is_staff() or profile_id = public.current_user_id());
create policy applications_staff_update on public.applications
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy applications_applicant_update on public.applications
  for update to authenticated
  using (profile_id = public.current_user_id() and status = 'draft')
  with check (profile_id = public.current_user_id() and status in ('draft', 'submitted'));
create policy applications_staff_delete on public.applications
  for delete to authenticated using (public.is_staff());

-- The applicant's own draft, for the child tables' write policies.
create or replace function public.my_draft_application_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.applications
  where profile_id = public.current_user_id() and status = 'draft';
$$;

do $$
declare
  t text;
begin
  foreach t in array array['application_co_applicants', 'application_files']
  loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.is_staff() or application_id in
        (select id from public.applications where profile_id = public.current_user_id()))$p$,
      t || '_select', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (public.is_staff() or application_id in (select public.my_draft_application_ids()))
      with check (public.is_staff() or application_id in (select public.my_draft_application_ids()))$p$,
      t || '_write', t);
  end loop;
end;
$$;

-- RLS cannot say which COLUMNS an applicant may write. Answers only, and
-- the one status move draft -> submitted.
create or replace function public.applications_restrict_applicant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_id() is null or public.is_staff() then
    return new;
  end if;
  if new.org_id is distinct from old.org_id
     or new.profile_id is distinct from old.profile_id
     or new.unit_id is distinct from old.unit_id
     or new.link_id is distinct from old.link_id
     or new.email is distinct from old.email
     or new.tenant_id is distinct from old.tenant_id
     or new.lease_id is distinct from old.lease_id
     or not (new.status = old.status or (old.status = 'draft' and new.status = 'submitted')) then
    raise exception 'Only the office can change that on an application.' using errcode = '42501';
  end if;
  if new.status = 'submitted' and old.status = 'draft' then
    new.submitted_at := now();
  else
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end;
$$;

create trigger applications_restrict_applicant
  before update on public.applications
  for each row execute function public.applications_restrict_applicant();

-- ------------------------------------------- applicants see nothing else
-- After approval an applicant profile carries tenant_id (so activation can
-- find it). Until it is promoted, the tenant helpers ignore it: an
-- applicant reads no tenant, lease, invoice or payment rows, not even the
-- draft lease made for them.

create or replace function public.my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles
  where id = public.current_user_id() and role <> 'applicant';
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
  where p.id = public.current_user_id() and p.role <> 'applicant';
$$;

-- ------------------------------------------------ role trigger exception
-- profiles_restrict_role_changes lets only an admin or the service
-- connection change role or tenant_id. A manager approving, or a manager
-- activating a lease, must still move an applicant along. The two
-- security-definer functions below set a transaction-local flag around
-- their one UPDATE; with it on, exactly two changes pass:
--   applicant, no tenant -> applicant linked to a tenant   (approve)
--   applicant with tenant -> tenant, same tenant           (promotion)
-- PostgREST cannot set arbitrary settings, so a caller cannot raise it.
-- Otherwise unchanged from 20261027001500.

create or replace function public.profiles_restrict_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_id() is null or public.is_super_admin() then
    return new;  -- the app server's service connection, or platform staff
  end if;
  if tg_op = 'UPDATE'
     and current_setting('rentio.applicant_step', true) = 'on'
     and old.role = 'applicant'
     and new.org_id is not distinct from old.org_id
     and new.clerk_user_id is not distinct from old.clerk_user_id
     and new.email is not distinct from old.email
     and (
       (new.role = 'applicant' and old.tenant_id is null and new.tenant_id is not null)
       or (new.role = 'tenant' and old.tenant_id is not null and new.tenant_id = old.tenant_id)
     ) then
    return new;
  end if;
  -- Nobody below platform staff hands out the platform role or moves a
  -- profile to another company (or out of every company).
  if new.role = 'super_admin'
     or (tg_op = 'UPDATE' and new.org_id is distinct from old.org_id)
     or (tg_op = 'INSERT' and new.org_id is distinct from public.current_org_id()) then
    raise exception 'Only PortfolioAI staff can do that' using errcode = '42501';
  end if;
  if public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role <> 'tenant' then
      raise exception 'Only an admin can create staff accounts' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.tenant_id is distinct from old.tenant_id
     or new.clerk_user_id is distinct from old.clerk_user_id
     or new.email is distinct from old.email then
    raise exception 'Only an admin can change role, organization or login' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------ approve

create or replace function public.approve_application(
  p_application uuid,
  p_terms       jsonb,
  p_unit        uuid  default null,
  p_note        text  default null,
  p_checklist   jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a          public.applications%rowtype;
  login      public.profiles%rowtype;
  unit       uuid;
  new_tenant uuid;
  co         uuid[];
  new_lease  uuid;
begin
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can approve applications.' using errcode = '42501';
  end if;
  select * into a from public.applications
  where id = p_application and org_id = public.current_org_id()
  for update;
  if a.id is null then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if a.lease_id is not null and a.status in ('approved', 'lease_sent') then
    return jsonb_build_object('tenant_id', a.tenant_id, 'lease_id', a.lease_id);  -- idempotent
  end if;
  if a.status not in ('submitted', 'under_review') then
    raise exception 'Only a submitted application can be approved.' using errcode = 'P0001';
  end if;
  unit := coalesce(p_unit, a.unit_id);
  if unit is null then
    raise exception 'Pick a unit for this lease.' using errcode = '22023';
  end if;
  select * into login from public.profiles where id = a.profile_id;

  insert into public.tenants (org_id, full_name, email, phone)
  values (a.org_id, coalesce(nullif(trim(a.full_name), ''), login.full_name, login.email),
          login.email, a.phone)
  returning id into new_tenant;

  -- Co-applicants sign as co-tenants.
  with made as (
    insert into public.tenants (org_id, full_name, email, phone)
    select a.org_id, c.full_name, c.email, c.phone
    from public.application_co_applicants c
    where c.application_id = a.id
    returning id
  )
  select coalesce(array_agg(id), '{}') into co from made;

  new_lease := public.create_lease(
    unit, coalesce(p_terms, '{}'::jsonb) || '{"status": "borrador"}'::jsonb,
    new_tenant, co, '{}', coalesce(p_checklist, '[]'::jsonb));

  perform set_config('rentio.applicant_step', 'on', true);
  update public.profiles set tenant_id = new_tenant
  where id = a.profile_id and role = 'applicant' and tenant_id is null;
  perform set_config('rentio.applicant_step', 'off', true);

  update public.applications
  set status = 'approved', unit_id = unit, tenant_id = new_tenant, lease_id = new_lease
  where id = a.id;

  insert into public.application_reviews (org_id, application_id, decision_note, decided_by, decided_at)
  values (a.org_id, a.id, nullif(trim(p_note), ''), public.current_user_id(), now())
  on conflict (application_id) do update
    set decision_note = coalesce(excluded.decision_note, application_reviews.decision_note),
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (public.current_user_id(), 'application', a.id, 'approve',
          jsonb_build_object('tenant_id', new_tenant, 'lease_id', new_lease, 'unit_id', unit),
          a.org_id);

  return jsonb_build_object('tenant_id', new_tenant, 'lease_id', new_lease);
end;
$$;

revoke all on function public.approve_application(uuid, jsonb, uuid, text, jsonb) from public, anon;
grant execute on function public.approve_application(uuid, jsonb, uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------- promotion
-- Fires for whoever activates: a manager, an admin, or the service
-- connection finishing an anonymous e-signature. The app server caches a
-- profile for 60s, so the portal opens within a minute of activation.

create or replace function public.promote_applicants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('rentio.applicant_step', 'on', true);
  update public.profiles set role = 'tenant'
  where role = 'applicant'
    and org_id = new.org_id
    and tenant_id in (select tenant_id from public.lease_tenants where lease_id = new.id);
  perform set_config('rentio.applicant_step', 'off', true);
  return null;
end;
$$;

revoke all on function public.promote_applicants() from public, anon, authenticated;

create trigger leases_promote_applicants
  after update of status on public.leases
  for each row
  when (new.status = 'activo' and old.status is distinct from 'activo')
  execute function public.promote_applicants();

-- ------------------------------------------------------ lease sent
-- "Lease sent" means a signature request really went out (e-sign lane's
-- signature_requests), not that staff clicked through to the lease.

create or replace function public.applications_mark_lease_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.applications set status = 'lease_sent'
  where lease_id = new.lease_id and org_id = new.org_id and status = 'approved';
  return null;
end;
$$;

revoke all on function public.applications_mark_lease_sent() from public, anon, authenticated;

create trigger applications_mark_lease_sent
  after insert on public.signature_requests
  for each row execute function public.applications_mark_lease_sent();
