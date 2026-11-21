-- Vendor directory (issue #11). One row per company the org hires for repairs.
-- Staff only (admin and manager alike): tenants never read this table.
--
-- A later vendor login will add a profile link (profiles.vendor_id or
-- vendors.profile_id) and a vendor role; nothing here assumes either.

create table public.vendors (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null default public.current_org_id()
                          references public.organizations (id) on delete restrict,
  company_name          text not null check (length(trim(company_name)) > 0),
  contact_name          text,
  phone                 text,
  email                 text,
  -- Free text; the UI suggests a short list (plumbing, electrical, ...).
  trade                 text,
  insurance_expires_on  date,
  w9_on_file            boolean not null default false,
  notes                 text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  -- Target of the (org_id, vendor_id) foreign keys: a row can only point at a
  -- vendor of its own org.
  unique (org_id, id)
);

comment on table public.vendors is
  'Vendors an organization hires. Staff-only. Deactivate instead of deleting.';

create index vendors_org_id_idx on public.vendors (org_id);

create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;

create policy vendors_staff_select on public.vendors
  for select to authenticated using (public.is_staff());
create policy vendors_staff_insert on public.vendors
  for insert to authenticated with check (public.is_staff());
create policy vendors_staff_update on public.vendors
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- Owner rule: inside a company, admin and manager may both delete.
create policy vendors_staff_delete on public.vendors
  for delete to authenticated using (public.is_staff());

do $$
declare
  mine constant text := 'org_id = (select public.current_org_id())';
  platform constant text :=
    '((select public.is_super_admin()) and (select public.current_org_id()) is null)';
begin
  execute format('create policy org_isolation_select on public.vendors as restrictive for select to authenticated using (%s or %s)', mine, platform);
  execute format('create policy org_isolation_insert on public.vendors as restrictive for insert to authenticated with check (%s)', mine);
  execute format('create policy org_isolation_update on public.vendors as restrictive for update to authenticated using (%s) with check (%s)', mine, mine);
  execute format('create policy org_isolation_delete on public.vendors as restrictive for delete to authenticated using (%s)', mine);
end;
$$;
