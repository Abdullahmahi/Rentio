-- super_admin: a real platform role, and a way to work inside a company.
--
-- 1. A super_admin has no organization of their own, so every INSERT they
--    made failed on org_id NOT NULL ("Something went wrong" on New property).
--    Now the app server lets them pick a company (cookie, /api/org) and puts
--    it in the JWT as org_id. With a company picked they are scoped exactly
--    like that company's admin: see only it, write only into it. With none
--    picked they keep the platform view: read everything, write nothing.
--    Reads and writes are now separate policies so that "write nothing" is
--    enforced by the database, not by the UI.
--
-- 2. QA A-01: any company admin could PATCH their own profile to
--    role = 'super_admin' and then read every company. is_super_admin() now
--    also requires org_id IS NULL, and only a super_admin (or the service
--    connection) can hand out that role or move a profile between companies.
--
-- 3. QA A-08: a new organization gets its settings row automatically.
-- 4. QA A-22: the tenant branch of my_lease_details is pinned to the org.

-- ------------------------------------------------------------- 2. roles

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_user_id() and role = 'super_admin' and org_id is null
  );
$$;

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

-- ------------------------------------------------ 1. read vs write scope
-- Platform view (super_admin, no company picked) may read every row and
-- write none. Everyone else, super_admin included once they pick a company,
-- is confined to the org in their JWT.

do $$
declare
  t text;
  mine constant text := 'org_id = (select public.current_org_id())';
  platform constant text :=
    '((select public.is_super_admin()) and (select public.current_org_id()) is null)';
begin
  foreach t in array array[
    'properties','tenants','settings','access_requests','activity_log','documents',
    'units','parking_spaces','leases','lease_tenants','lease_notices','invoices',
    'invoice_lines','payments','payment_allocations','expenses','utility_charges',
    'work_orders','work_order_notes','work_order_photos','unit_turnover_checklist'
  ]
  loop
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format('drop policy if exists org_isolation_select on public.%I', t);
    execute format('drop policy if exists org_isolation_insert on public.%I', t);
    execute format('drop policy if exists org_isolation_update on public.%I', t);
    execute format('drop policy if exists org_isolation_delete on public.%I', t);
    execute format('create policy org_isolation_select on public.%I as restrictive for select to authenticated using (%s or %s)', t, mine, platform);
    execute format('create policy org_isolation_insert on public.%I as restrictive for insert to authenticated with check (%s)', t, mine);
    execute format('create policy org_isolation_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t, mine, mine);
    execute format('create policy org_isolation_delete on public.%I as restrictive for delete to authenticated using (%s)', t, mine);
  end loop;
end;
$$;

-- profiles: a person may always read and update their own row (locale, name),
-- which matters for super_admins, whose own row has no org.
drop policy if exists org_isolation on public.profiles;
drop policy if exists org_isolation_select on public.profiles;
drop policy if exists org_isolation_insert on public.profiles;
drop policy if exists org_isolation_update on public.profiles;
drop policy if exists org_isolation_delete on public.profiles;
create policy org_isolation_select on public.profiles as restrictive for select to authenticated
  using (
    org_id = (select public.current_org_id())
    or id = (select public.current_user_id())
    or ((select public.is_super_admin()) and (select public.current_org_id()) is null)
  );
create policy org_isolation_insert on public.profiles as restrictive for insert to authenticated
  with check (org_id = (select public.current_org_id()));
create policy org_isolation_update on public.profiles as restrictive for update to authenticated
  using (org_id = (select public.current_org_id()) or id = (select public.current_user_id()))
  with check (org_id = (select public.current_org_id()) or id = (select public.current_user_id()));
create policy org_isolation_delete on public.profiles as restrictive for delete to authenticated
  using (org_id = (select public.current_org_id()));

-- ------------------------------------------------------- 4. the view
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
where (public.is_staff()
       and (l.org_id = public.current_org_id()
            or (public.is_super_admin() and public.current_org_id() is null)))
   or (l.id in (select public.my_lease_ids()) and l.org_id = public.current_org_id());

-- ------------------------------------------- 3. settings per new org
create or replace function public.organizations_create_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.settings (org_id, company_name) values (new.id, new.name)
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_create_settings on public.organizations;
create trigger organizations_create_settings
  after insert on public.organizations
  for each row execute function public.organizations_create_settings();
