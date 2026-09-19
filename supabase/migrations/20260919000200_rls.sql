-- Rentio — row level security. Deny by default, everywhere.
--
-- Storage path convention (enforced by the policies at the bottom):
--   contracts/<lease_id>/<file>
--   tenant-docs/<tenant_id>/<file>
--   payment-receipts/<lease_id>/<file>
--   work-order-photos/<work_order_id>/<file>
--   company/<file>

-- ------------------------------------------------------- helper functions

-- security definer so that reading profiles inside a profiles policy
-- does not recurse through RLS.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'manager')
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
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
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
  where p.id = auth.uid();
$$;

grant execute on function public.is_staff, public.is_admin,
  public.my_tenant_id, public.my_lease_ids to authenticated;

-- ------------------------------------------------------------ enable RLS

do $$
declare
  t text;
begin
  foreach t in array array[
    'properties','units','tenants','profiles','leases','parking_spaces','lease_tenants',
    'invoices','invoice_lines','payments','payment_allocations','utility_charges',
    'work_orders','work_order_notes','work_order_photos','documents','activity_log','settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ------------------------------------------------- staff-only tables
-- properties, units, utility_charges, settings, activity_log:
-- no tenant access at all.

do $$
declare
  t text;
begin
  foreach t in array array['properties','units','utility_charges','settings','activity_log']
  loop
    execute format('create policy staff_select on public.%I for select to authenticated using (public.is_staff())', t);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end;
$$;

-- ------------------------------------------------------------- profiles

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_staff_insert on public.profiles
  for insert to authenticated with check (public.is_staff());
create policy profiles_staff_update on public.profiles
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------- tenants
-- A tenant reads and updates only their own row. Which COLUMNS they may
-- change is enforced by the trigger below — RLS cannot express that.

create policy tenants_staff_all on public.tenants
  for select to authenticated using (public.is_staff() or id = public.my_tenant_id());
create policy tenants_staff_insert on public.tenants
  for insert to authenticated with check (public.is_staff());
create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_staff() or id = public.my_tenant_id())
  with check (public.is_staff() or id = public.my_tenant_id());
create policy tenants_admin_delete on public.tenants
  for delete to authenticated using (public.is_admin());

create or replace function public.tenants_restrict_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff() then
    return new;
  end if;
  -- A tenant editing their own row may only touch contact columns.
  if new.full_name is distinct from old.full_name
     or new.rfc is distinct from old.rfc
     or new.notes is distinct from old.notes then
    raise exception 'Solo puedes actualizar tus datos de contacto';
  end if;
  return new;
end;
$$;

create trigger tenants_restrict_self_update
  before update on public.tenants
  for each row execute function public.tenants_restrict_self_update();

-- --------------------------------------------------------------- leases

create policy leases_select on public.leases
  for select to authenticated
  using (public.is_staff() or id in (select public.my_lease_ids()));
create policy leases_staff_insert on public.leases
  for insert to authenticated with check (public.is_staff());
create policy leases_staff_update on public.leases
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy leases_admin_delete on public.leases
  for delete to authenticated using (public.is_admin());

-- --------------------------------------------------------- lease_tenants

create policy lease_tenants_select on public.lease_tenants
  for select to authenticated
  using (public.is_staff() or lease_id in (select public.my_lease_ids()));
create policy lease_tenants_staff_insert on public.lease_tenants
  for insert to authenticated with check (public.is_staff());
create policy lease_tenants_staff_update on public.lease_tenants
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy lease_tenants_staff_delete on public.lease_tenants
  for delete to authenticated using (public.is_staff());

-- -------------------------------------------------------- parking_spaces

create policy parking_select on public.parking_spaces
  for select to authenticated
  using (public.is_staff() or lease_id in (select public.my_lease_ids()));
create policy parking_staff_insert on public.parking_spaces
  for insert to authenticated with check (public.is_staff());
create policy parking_staff_update on public.parking_spaces
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy parking_admin_delete on public.parking_spaces
  for delete to authenticated using (public.is_admin());

-- ------------------------------------------------------------- invoices

create policy invoices_select on public.invoices
  for select to authenticated
  using (public.is_staff() or lease_id in (select public.my_lease_ids()));
create policy invoices_staff_insert on public.invoices
  for insert to authenticated with check (public.is_staff());
create policy invoices_staff_update on public.invoices
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy invoices_admin_delete on public.invoices
  for delete to authenticated using (public.is_admin());

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    public.is_staff() or exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.lease_id in (select public.my_lease_ids())
    )
  );
create policy invoice_lines_staff_insert on public.invoice_lines
  for insert to authenticated with check (public.is_staff());
create policy invoice_lines_staff_update on public.invoice_lines
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy invoice_lines_staff_delete on public.invoice_lines
  for delete to authenticated using (public.is_staff());

-- ------------------------------------------------------------- payments
-- Tenants may report a payment, and nothing else. They can never UPDATE.

create policy payments_select on public.payments
  for select to authenticated
  using (public.is_staff() or lease_id in (select public.my_lease_ids()));

create policy payments_tenant_insert on public.payments
  for insert to authenticated
  with check (
    not public.is_staff()
    and lease_id in (select public.my_lease_ids())
    and status = 'pendiente'
    and reported_by_tenant = true
  );

create policy payments_staff_insert on public.payments
  for insert to authenticated with check (public.is_staff());

-- Only an admin may void. Managers can confirm and reject-to-... nothing else.
create policy payments_staff_update on public.payments
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff() and (status <> 'cancelado' or public.is_admin()));

create policy payments_admin_delete on public.payments
  for delete to authenticated using (public.is_admin());

create policy allocations_select on public.payment_allocations
  for select to authenticated
  using (
    public.is_staff() or exists (
      select 1 from public.payments p
      where p.id = payment_id and p.lease_id in (select public.my_lease_ids())
    )
  );
create policy allocations_staff_insert on public.payment_allocations
  for insert to authenticated with check (public.is_staff());
create policy allocations_staff_update on public.payment_allocations
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy allocations_staff_delete on public.payment_allocations
  for delete to authenticated using (public.is_staff());

-- ---------------------------------------------------------- work_orders

create policy work_orders_select on public.work_orders
  for select to authenticated
  using (public.is_staff() or lease_id in (select public.my_lease_ids()));

create policy work_orders_tenant_insert on public.work_orders
  for insert to authenticated
  with check (
    not public.is_staff()
    and lease_id in (select public.my_lease_ids())
    and source = 'portal'
  );

create policy work_orders_staff_insert on public.work_orders
  for insert to authenticated with check (public.is_staff());
create policy work_orders_staff_update on public.work_orders
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy work_orders_admin_delete on public.work_orders
  for delete to authenticated using (public.is_admin());

-- Internal notes are invisible to tenants. This is the single most
-- important policy in the file — staff write blunt things in them.
create policy wo_notes_select on public.work_order_notes
  for select to authenticated
  using (
    public.is_staff() or (
      is_internal = false and exists (
        select 1 from public.work_orders w
        where w.id = work_order_id and w.lease_id in (select public.my_lease_ids())
      )
    )
  );
create policy wo_notes_staff_insert on public.work_order_notes
  for insert to authenticated with check (public.is_staff());
create policy wo_notes_staff_update on public.work_order_notes
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy wo_notes_staff_delete on public.work_order_notes
  for delete to authenticated using (public.is_staff());

create policy wo_photos_select on public.work_order_photos
  for select to authenticated
  using (
    public.is_staff() or exists (
      select 1 from public.work_orders w
      where w.id = work_order_id and w.lease_id in (select public.my_lease_ids())
    )
  );
create policy wo_photos_insert on public.work_order_photos
  for insert to authenticated
  with check (
    public.is_staff() or exists (
      select 1 from public.work_orders w
      where w.id = work_order_id and w.lease_id in (select public.my_lease_ids())
    )
  );
create policy wo_photos_staff_delete on public.work_order_photos
  for delete to authenticated using (public.is_staff());

-- ------------------------------------------------------------ documents
-- A tenant sees documents attached to their lease or to their own record.

create policy documents_select on public.documents
  for select to authenticated
  using (
    public.is_staff()
    or (owner_type = 'lease'  and owner_id in (select public.my_lease_ids()))
    or (owner_type = 'tenant' and owner_id = public.my_tenant_id())
  );
create policy documents_staff_insert on public.documents
  for insert to authenticated with check (public.is_staff());
create policy documents_staff_update on public.documents
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy documents_staff_delete on public.documents
  for delete to authenticated using (public.is_staff());

-- --------------------------------------------------- tenant-safe settings
-- `settings` itself stays staff-only per spec. The tenant portal needs the
-- bank transfer details, so expose exactly those columns through a
-- security-definer view — nothing else leaks.

create view public.public_settings
with (security_invoker = false)
as
select company_name, logo_url, bank_name, clabe, account_holder, invoice_prefix
from public.settings
limit 1;

grant select on public.public_settings to authenticated;

-- --------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values
  ('contracts',         'contracts',         false),
  ('tenant-docs',       'tenant-docs',       false),
  ('payment-receipts',  'payment-receipts',  false),
  ('work-order-photos', 'work-order-photos', false),
  ('company',           'company',           false)
on conflict (id) do nothing;

create policy storage_staff_all on storage.objects
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Tenants read only files filed under an id that belongs to them.
create policy storage_tenant_read on storage.objects
  for select to authenticated
  using (
    (bucket_id = 'contracts'
      and ((storage.foldername(name))[1])::uuid in (select public.my_lease_ids()))
    or (bucket_id = 'payment-receipts'
      and ((storage.foldername(name))[1])::uuid in (select public.my_lease_ids()))
    or (bucket_id = 'tenant-docs'
      and ((storage.foldername(name))[1])::uuid = public.my_tenant_id())
    or (bucket_id = 'work-order-photos' and exists (
      select 1 from public.work_orders w
      where w.id = ((storage.foldername(name))[1])::uuid
        and w.lease_id in (select public.my_lease_ids())
    ))
    or bucket_id = 'company'
  );

-- Tenants upload proof of payment and maintenance photos, nothing else.
create policy storage_tenant_write on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'payment-receipts'
      and ((storage.foldername(name))[1])::uuid in (select public.my_lease_ids()))
    or (bucket_id = 'work-order-photos' and exists (
      select 1 from public.work_orders w
      where w.id = ((storage.foldername(name))[1])::uuid
        and w.lease_id in (select public.my_lease_ids())
    ))
  );
