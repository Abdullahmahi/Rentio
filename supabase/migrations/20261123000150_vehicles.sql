-- Vehicles (issue #7). A tenant registers their own cars; staff see them on
-- the lease and the parking page. Not money, so staff may delete.

create table public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) default public.current_org_id(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  lease_id    uuid references public.leases (id) on delete set null,
  make        text,
  model       text,
  color       text,
  plate       text not null check (plate <> ''),
  state       text check (state is null or state ~ '^[A-Z]{2}$'),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index vehicles_org_idx    on public.vehicles (org_id);
create index vehicles_tenant_idx on public.vehicles (tenant_id);
create index vehicles_lease_idx  on public.vehicles (lease_id);

create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

-- org_id comes from the tenant; the lease, when set, must agree (a second
-- org_from_parent pass raises on a mismatch instead of re-deriving).
create trigger org_from_parent before insert or update on public.vehicles
  for each row execute function public.org_from_parent('tenants', 'tenant_id');
create trigger org_from_parent_lease before insert or update on public.vehicles
  for each row execute function public.org_from_parent('leases', 'lease_id');

-- "abc 123 " and "ABC 123" are the same plate.
create or replace function public.vehicles_normalise()
returns trigger
language plpgsql
as $$
begin
  new.plate := upper(regexp_replace(btrim(new.plate), '\s+', ' ', 'g'));
  new.state := nullif(upper(btrim(new.state)), '');
  return new;
end;
$$;
create trigger vehicles_normalise before insert or update on public.vehicles
  for each row execute function public.vehicles_normalise();

alter table public.vehicles enable row level security;

create policy org_isolation on public.vehicles as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));

create policy vehicles_staff_all on public.vehicles
  for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- A tenant: only their own, and only on a lease they are on.
create policy vehicles_tenant_own on public.vehicles
  for all to authenticated
  using (
    tenant_id = (select public.my_tenant_id())
    and (lease_id is null or lease_id in (select public.my_lease_ids()))
  )
  with check (
    tenant_id = (select public.my_tenant_id())
    and (lease_id is null or lease_id in (select public.my_lease_ids()))
  );
