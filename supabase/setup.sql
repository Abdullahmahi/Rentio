-- ============================================================================
-- Rentio — complete setup, in one script.
--
-- Paste the whole file into Supabase → SQL Editor → New query → Run.
-- It is ordered: schema, then RLS, then the portal view, then demo data.
--
-- Sections 4 and 5 are DEMO DATA. Section 4 begins with TRUNCATE and section 5
-- creates accounts with a known password. Delete both before running this
-- against anything but a demo or staging project.
--
-- Afterwards, verify with supabase/tests/rls_test.sql.
-- ============================================================================


-- ============================================================================
-- 1/5  SCHEMA — enums, tables, views, folio helpers
-- ============================================================================
-- Rentio — core schema
-- All money is numeric(12,2). Never float.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type user_role         as enum ('admin', 'manager', 'tenant');
create type unit_status       as enum ('vacante', 'ocupada', 'mantenimiento', 'reservada');
create type lease_status      as enum ('borrador', 'activo', 'por_vencer', 'terminado', 'rescindido');
create type lease_tenant_role as enum ('primary', 'co_tenant', 'guarantor');
create type invoice_status    as enum ('borrador', 'enviado', 'pagado_parcial', 'pagado', 'vencido', 'cancelado');
create type line_category     as enum ('renta', 'estacionamiento', 'servicios', 'cuota_mantenimiento', 'recargo', 'otro');
create type payment_method    as enum ('spei', 'efectivo', 'deposito', 'oxxo', 'cheque', 'tarjeta');
create type payment_status    as enum ('pendiente', 'confirmado', 'cancelado');
create type utility_type      as enum ('agua', 'luz', 'gas', 'cuota_mantenimiento', 'otro');
create type utility_status    as enum ('pendiente', 'facturado');
create type wo_source         as enum ('portal', 'whatsapp', 'telefono', 'personal');
create type wo_category       as enum ('plomeria', 'electricidad', 'cerrajeria', 'electrodomesticos', 'limpieza', 'otro');
create type wo_priority       as enum ('baja', 'media', 'alta', 'urgente');
create type wo_status         as enum ('nueva', 'asignada', 'en_progreso', 'esperando_refacciones', 'resuelta', 'cerrada');

-- ------------------------------------------------------- updated_at trigger

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- tables

create table public.properties (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  street       text,
  colonia      text,
  city         text,
  state        text,
  postal_code  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

create table public.units (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  unit_number  text not null,
  floor        int,
  bedrooms     int,
  bathrooms    numeric(3,1),
  sqm          numeric(8,2),
  base_rent    numeric(12,2) not null default 0,
  status       unit_status not null default 'vacante',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  unique (property_id, unit_number)
);

create table public.tenants (
  id                       uuid primary key default gen_random_uuid(),
  full_name                text not null,
  email                    text,
  phone                    text,
  rfc                      text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  role        user_role not null default 'tenant',
  locale      text not null default 'es-MX',
  tenant_id   uuid references public.tenants (id) on delete set null,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table public.leases (
  id                 uuid primary key default gen_random_uuid(),
  unit_id            uuid not null references public.units (id) on delete restrict,
  start_date         date not null,
  end_date           date not null,
  rent_amount        numeric(12,2) not null,
  rent_due_day       int not null default 1 check (rent_due_day between 1 and 31),
  grace_days         int not null default 5,
  late_fee_amount    numeric(12,2) not null default 0,
  deposit_amount     numeric(12,2) not null default 0,
  deposit_status     text not null default 'retenido',
  deposit_refunded   numeric(12,2),
  deposit_retained   numeric(12,2),
  deposit_notes      text,
  status             lease_status not null default 'borrador',
  contract_url       text,
  move_out_date      date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

create table public.parking_spaces (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  label        text not null,
  type         text not null default 'techado',
  monthly_fee  numeric(12,2) not null default 0,
  status       text not null default 'disponible',
  lease_id     uuid references public.leases (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  unique (property_id, label)
);

create table public.lease_tenants (
  id         uuid primary key default gen_random_uuid(),
  lease_id   uuid not null references public.leases (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  role       lease_tenant_role not null default 'primary',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (lease_id, tenant_id)
);

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references public.leases (id) on delete restrict,
  period_month   date not null,
  invoice_number text unique,
  issue_date     date not null default current_date,
  due_date       date not null,
  status         invoice_status not null default 'borrador',
  total          numeric(12,2) not null default 0,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  -- the backstop against double-generating a month
  unique (lease_id, period_month)
);

create table public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  category    line_category not null default 'otro',
  quantity    numeric not null default 1,
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  lease_id            uuid not null references public.leases (id) on delete restrict,
  amount              numeric(12,2) not null check (amount > 0),
  paid_at             date not null default current_date,
  method              payment_method not null default 'spei',
  reference           text,
  status              payment_status not null default 'pendiente',
  receipt_url         text,
  reported_by_tenant  boolean not null default false,
  recorded_by         uuid references public.profiles (id) on delete set null,
  confirmed_by        uuid references public.profiles (id) on delete set null,
  confirmed_at        timestamptz,
  void_reason         text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create table public.payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.payments (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  amount      numeric(12,2) not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table public.utility_charges (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units (id) on delete cascade,
  lease_id      uuid references public.leases (id) on delete set null,
  type          utility_type not null default 'otro',
  period_month  date not null,
  amount        numeric(12,2) not null default 0,
  status        utility_status not null default 'pendiente',
  invoice_id    uuid references public.invoices (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  -- "Captura masiva" skips units that already have this type for this month
  unique (unit_id, type, period_month)
);

create table public.work_orders (
  id                  uuid primary key default gen_random_uuid(),
  unit_id             uuid not null references public.units (id) on delete cascade,
  lease_id            uuid references public.leases (id) on delete set null,
  reported_by_tenant  uuid references public.tenants (id) on delete set null,
  source              wo_source not null default 'personal',
  category            wo_category not null default 'otro',
  priority            wo_priority not null default 'media',
  folio               text unique,
  title               text not null,
  description         text,
  status              wo_status not null default 'nueva',
  vendor_name         text,
  vendor_phone        text,
  cost                numeric(12,2),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create table public.work_order_notes (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  author_id      uuid references public.profiles (id) on delete set null,
  body           text not null,
  is_internal    boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

create table public.work_order_photos (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  url            text not null,
  uploaded_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  owner_type  text not null,
  owner_id    uuid not null,
  name        text not null,
  url         text not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table public.settings (
  id                  uuid primary key default gen_random_uuid(),
  singleton           boolean not null default true unique check (singleton),
  company_name        text not null default 'Rentio',
  logo_url            text,
  bank_name           text,
  clabe               text,
  account_holder      text,
  invoice_prefix      text not null default 'REC',
  default_late_fee    numeric(12,2) not null default 0,
  default_grace_days  int not null default 5,
  street              text,
  colonia             text,
  city                text,
  state               text,
  postal_code         text,
  phone               text,
  email               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

-- ---------------------------------------------------------------- indexes

create index on public.units (property_id);
create index on public.units (status);
create index on public.leases (unit_id);
create index on public.leases (status);
create index on public.lease_tenants (tenant_id);
create index on public.parking_spaces (lease_id);
create index on public.invoices (lease_id);
create index on public.invoices (period_month);
create index on public.invoices (status);
create index on public.invoice_lines (invoice_id);
create index on public.payments (lease_id);
create index on public.payments (status);
create index on public.payment_allocations (payment_id);
create index on public.payment_allocations (invoice_id);
create index on public.utility_charges (unit_id, period_month);
create index on public.utility_charges (status);
create index on public.work_orders (unit_id);
create index on public.work_orders (status);
create index on public.work_order_notes (work_order_id);
create index on public.work_order_photos (work_order_id);
create index on public.documents (owner_type, owner_id);
create index on public.profiles (tenant_id);

-- ------------------------------------------------------- updated_at wiring

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
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

-- --------------------------------------------------------- folio sequences

create sequence public.invoice_number_seq start 1;
create sequence public.work_order_folio_seq start 1;

-- Sequential, gap-tolerant folio. Prefix comes from settings.
create or replace function public.next_invoice_number()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce((select invoice_prefix from public.settings limit 1), 'REC')
      || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
$$;

create or replace function public.next_work_order_folio()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'OT-' || lpad(nextval('public.work_order_folio_seq')::text, 5, '0');
$$;

alter table public.work_orders alter column folio set default public.next_work_order_folio();

-- ------------------------------------------------------------------ view

-- Per-lease money position. Cancelled invoices and non-confirmed payments
-- are excluded, which is what every balance card in the app shows.
create view public.lease_balances
with (security_invoker = true)
as
select
  l.id as lease_id,
  coalesce(i.total_invoiced, 0)                            as total_invoiced,
  coalesce(p.total_paid, 0)                                as total_paid,
  coalesce(i.total_invoiced, 0) - coalesce(p.total_paid, 0) as balance,
  i.oldest_overdue_date
from public.leases l
left join lateral (
  select
    sum(inv.total) as total_invoiced,
    min(inv.due_date) filter (
      where inv.due_date < current_date
        and inv.status not in ('pagado', 'cancelado')
    ) as oldest_overdue_date
  from public.invoices inv
  where inv.lease_id = l.id and inv.status <> 'cancelado'
) i on true
left join lateral (
  select sum(pay.amount) as total_paid
  from public.payments pay
  where pay.lease_id = l.id and pay.status = 'confirmado'
) p on true;

-- Money already applied to each invoice. Used to derive pagado / pagado_parcial.
create view public.invoice_balances
with (security_invoker = true)
as
select
  inv.id as invoice_id,
  inv.lease_id,
  inv.total,
  coalesce(a.paid, 0)             as paid,
  inv.total - coalesce(a.paid, 0) as balance
from public.invoices inv
left join lateral (
  select sum(pa.amount) as paid
  from public.payment_allocations pa
  join public.payments pay on pay.id = pa.payment_id
  where pa.invoice_id = inv.id and pay.status = 'confirmado'
) a on true;

insert into public.settings (company_name, invoice_prefix) values ('Rentio', 'REC');


-- ============================================================================
-- 2/5  ROW LEVEL SECURITY — policies, storage buckets
-- ============================================================================
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


-- ============================================================================
-- 3/5  PORTAL VIEW — a tenant's own unit number and address
-- ============================================================================
-- The tenant portal needs the tenant's OWN unit number and building address:
-- it is the payment reference on the Inicio screen and the whole of the
-- Contrato screen. `units` and `properties` stay staff-only per the spec, so
-- this security-definer view exposes exactly those columns, and only for
-- leases the caller is actually on.

create view public.my_lease_details
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
  p.colonia,
  p.city,
  p.state,
  p.postal_code
from public.leases l
join public.units u      on u.id = l.unit_id
join public.properties p on p.id = u.property_id
-- Staff read everything; a tenant sees only the leases they are named on.
where public.is_staff() or l.id in (select public.my_lease_ids());

grant select on public.my_lease_details to authenticated;


-- ============================================================================
-- 4/5  DEMO DATA — 3 CDMX properties, 40 units, 30 leases
-- ============================================================================
-- Rentio — demo data (Mexican Spanish, CDMX).
-- Safe to re-run: it clears the demo tables first.
--
-- Deliberately leaves 4 active leases WITHOUT an invoice for the current
-- month, and their utility charges `pendiente`, so "Generar recibos del mes"
-- has real work to do on a fresh demo.

begin;

truncate table
  public.activity_log, public.documents, public.work_order_photos,
  public.work_order_notes, public.work_orders, public.utility_charges,
  public.payment_allocations, public.payments, public.invoice_lines,
  public.invoices, public.lease_tenants, public.parking_spaces,
  public.leases, public.units, public.tenants, public.properties
  restart identity cascade;

alter sequence public.invoice_number_seq restart with 1;
alter sequence public.work_order_folio_seq restart with 1;

update public.settings set
  company_name   = 'Inmobiliaria Arrendo CDMX',
  bank_name      = 'BBVA México',
  clabe          = '012180001234567895',
  account_holder = 'Inmobiliaria Arrendo CDMX, S.A. de C.V.',
  invoice_prefix = 'REC',
  default_late_fee = 500.00,
  default_grace_days = 5,
  street = 'Av. Insurgentes Sur 1602',
  colonia = 'Crédito Constructor',
  city = 'Ciudad de México',
  state = 'Ciudad de México',
  postal_code = '03940',
  phone = '+52 55 5555 1200',
  email = 'administracion@arrendocdmx.mx';

-- ------------------------------------------------------------ properties

insert into public.properties (name, street, colonia, city, state, postal_code, notes) values
  ('Edificio Roma 214',     'Álvaro Obregón 214', 'Roma Norte',        'Ciudad de México', 'Ciudad de México', '06700', 'Edificio remodelado en 2021. Portero de 7:00 a 22:00.'),
  ('Residencial Del Valle', 'Av. Coyoacán 1523',  'Del Valle Centro',  'Ciudad de México', 'Ciudad de México', '03100', 'Amenidades: roof garden y salón de usos múltiples.'),
  ('Torre Narvarte',        'Dr. Vértiz 842',     'Narvarte Poniente', 'Ciudad de México', 'Ciudad de México', '03020', 'Elevador con mantenimiento mensual programado.');

-- ----------------------------------------------------------------- units
-- 40 units: 14 / 14 / 12. Rent lands between $8,000 and $28,000 MXN.

insert into public.units (property_id, unit_number, floor, bedrooms, bathrooms, sqm, base_rent, status)
select
  p.id,
  (((i - 1) / 4 + 1) * 100 + ((i - 1) % 4 + 1))::text,
  (i - 1) / 4 + 1,
  b.bedrooms,
  case when b.bedrooms = 1 then 1.0 when b.bedrooms = 2 then 1.5 else 2.0 end,
  round((42 + b.bedrooms * 21 + (i % 4) * 3)::numeric, 2),
  round((8000 + (b.bedrooms - 1) * 6500 + cfg.premium + (i % 5) * 500)::numeric, 2),
  'vacante'
from (values
  ('Edificio Roma 214', 14, 3500),
  ('Residencial Del Valle', 14, 2000),
  ('Torre Narvarte', 12, 0)
) as cfg(pname, n, premium)
join public.properties p on p.name = cfg.pname
cross join lateral generate_series(1, cfg.n) as i
cross join lateral (select (i % 3) + 1 as bedrooms) b;

-- -------------------------------------------------------- parking spaces
-- 25 spaces: 10 / 9 / 6.

insert into public.parking_spaces (property_id, label, type, monthly_fee, status)
select
  p.id,
  'E-' || lpad(i::text, 2, '0'),
  case when i % 3 = 0 then 'descubierto' else 'techado' end,
  case when i % 3 = 0 then 800.00 else 1200.00 end,
  'disponible'
from (values ('Edificio Roma 214', 10), ('Residencial Del Valle', 9), ('Torre Narvarte', 6)) as cfg(pname, n)
join public.properties p on p.name = cfg.pname
cross join lateral generate_series(1, cfg.n) as i;

-- --------------------------------------------------------------- tenants

insert into public.tenants (full_name, email, phone, rfc, emergency_contact_name, emergency_contact_phone)
select
  n.full_name,
  lower(
    translate(split_part(n.full_name, ' ', 1), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN') || '.' ||
    translate(split_part(n.full_name, ' ', 2), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')
  ) || '@example.mx',
  '+52 55 ' || lpad((1000 + n.i * 37)::text, 4, '0') || ' ' || lpad((2000 + n.i * 53)::text, 4, '0'),
  case when n.i % 3 = 0 then null else upper(left(translate(n.full_name, ' áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), 4)) || '8' || lpad((100000 + n.i * 911)::text, 6, '0') end,
  n.emergency,
  '+52 55 ' || lpad((3000 + n.i * 29)::text, 4, '0') || ' ' || lpad((4000 + n.i * 61)::text, 4, '0')
from (
  select row_number() over () as i, full_name, emergency from (values
    ('María Fernanda Ríos',      'Jorge Ríos Medina'),
    ('Juan Carlos Pérez',        'Laura Pérez Solís'),
    ('Ana Sofía Hernández',      'Miguel Hernández Cruz'),
    ('Luis Enrique Ramírez',     'Patricia Ramírez Ortiz'),
    ('Gabriela Mendoza',         'Raúl Mendoza Lara'),
    ('Ricardo Alonso Vargas',    'Claudia Vargas Nieto'),
    ('Alejandra Castillo',       'Héctor Castillo Ruiz'),
    ('Fernando Gutiérrez',       'Norma Gutiérrez Paz'),
    ('Paola Jiménez Soto',       'Andrés Jiménez Rocha'),
    ('Roberto Núñez Salas',      'Elena Núñez Vega'),
    ('Diana Laura Ortega',       'Sergio Ortega Campos'),
    ('Miguel Ángel Domínguez',   'Rosa Domínguez Islas'),
    ('Carmen Elizabeth Flores',  'Pedro Flores Aguilar'),
    ('José Antonio Reyes',       'Silvia Reyes Cabrera'),
    ('Verónica Salazar',         'Arturo Salazar Peña'),
    ('Héctor Iván Morales',      'Beatriz Morales Luna'),
    ('Claudia Patricia Cruz',    'Ramón Cruz Estrada'),
    ('Eduardo Barrera Lima',     'Mónica Barrera Téllez'),
    ('Mariana Quintero',         'Felipe Quintero Arce'),
    ('Sergio Alberto Navarro',   'Adriana Navarro Fuentes'),
    ('Lucía Beltrán Arriaga',    'Emilio Beltrán Cano'),
    ('Óscar Daniel Cervantes',   'Teresa Cervantes Lozano'),
    ('Rocío Guadalupe Andrade',  'Javier Andrade Pineda'),
    ('Armando Téllez Rosas',     'Guadalupe Téllez Mora'),
    ('Isabel Cristina Guzmán',   'Rodrigo Guzmán Franco'),
    ('Pablo Emilio Zamora',      'Cecilia Zamora Rangel'),
    ('Nadia Escobar Ponce',      'Ignacio Escobar Ávila'),
    ('Rubén Darío Maldonado',    'Alicia Maldonado Bravo'),
    ('Silvia Nájera Campos',     'Mauricio Nájera Duarte'),
    ('Emiliano Rivas Cuéllar',   'Daniela Rivas Montes')
  ) as t(full_name, emergency)
) n;

-- ---------------------------------------------------------------- leases
-- 30 active leases on the first 30 units. Four of them end within 60 days
-- so the "Por vencer" badge has something to show.

with ordered_units as (
  select u.id, u.base_rent, row_number() over (order by p.name, u.unit_number) as rn
  from public.units u join public.properties p on p.id = u.property_id
)
insert into public.leases (
  unit_id, start_date, end_date, rent_amount, rent_due_day, grace_days,
  late_fee_amount, deposit_amount, status
)
select
  ou.id,
  d.start_date,
  (d.start_date + interval '12 months' - interval '1 day')::date,
  ou.base_rent,
  case when ou.rn % 4 = 0 then 5 else 1 end,
  5,
  500.00,
  ou.base_rent,
  'activo'
from ordered_units ou
cross join lateral (
  select case
    when ou.rn <= 4 then (date_trunc('month', current_date) - interval '11 months' + interval '10 days')::date
    else (date_trunc('month', current_date) - ((ou.rn % 9) + 2) * interval '1 month')::date
  end as start_date
) d
where ou.rn <= 30;

update public.units u set status = 'ocupada'
where exists (select 1 from public.leases l where l.unit_id = u.id and l.status = 'activo');

-- A little texture in the remaining 10 vacant units.
with spare as (
  select u.id, row_number() over (order by u.created_at, u.unit_number) as rn
  from public.units u where u.status = 'vacante'
)
update public.units u set status = case when s.rn <= 2 then 'mantenimiento'::unit_status else 'reservada'::unit_status end
from spare s where u.id = s.id and s.rn <= 4;

-- ---------------------------------------------------------- lease tenants

with l as (
  select id, row_number() over (order by created_at, id) as rn from public.leases
), t as (
  select id, row_number() over (order by created_at, id) as rn from public.tenants
)
insert into public.lease_tenants (lease_id, tenant_id, role)
select l.id, t.id, 'primary' from l join t on t.rn = l.rn;

-- Every fifth lease gets a co-tenant, every seventh a guarantor.
with l as (
  select id, row_number() over (order by created_at, id) as rn from public.leases
), t as (
  select id, row_number() over (order by created_at, id) as rn from public.tenants
)
insert into public.lease_tenants (lease_id, tenant_id, role)
select l.id, t.id, r.role
from l
join lateral (values ('co_tenant'::lease_tenant_role, 5, 1), ('guarantor'::lease_tenant_role, 7, 2)) as r(role, modulo, offs) on l.rn % r.modulo = 0
join t on t.rn = ((l.rn + r.offs - 1) % 30) + 1
on conflict (lease_id, tenant_id) do nothing;

-- ------------------------------------------------------ parking assignment
-- 15 of 25 spaces assigned, always to a lease in the same property.

with ranked_spaces as (
  select ps.id, ps.property_id, row_number() over (partition by ps.property_id order by ps.label) as rn
  from public.parking_spaces ps
), ranked_leases as (
  select l.id as lease_id, u.property_id, row_number() over (partition by u.property_id order by u.unit_number) as rn
  from public.leases l join public.units u on u.id = l.unit_id where l.status = 'activo'
)
update public.parking_spaces ps
set lease_id = rl.lease_id, status = 'asignado'
from ranked_spaces rs
join ranked_leases rl on rl.property_id = rs.property_id and rl.rn = rs.rn
where ps.id = rs.id and rs.rn <= 5;

update public.parking_spaces set status = 'fuera_de_servicio'
where lease_id is null and label in ('E-09', 'E-10');

-- ------------------------------------------------------- utility charges
-- Two billed months behind us, the current month still pendiente.

insert into public.utility_charges (unit_id, lease_id, type, period_month, amount, status, notes)
select
  l.unit_id,
  l.id,
  ut.type,
  (date_trunc('month', current_date) - m.offset_months * interval '1 month')::date,
  ut.amount,
  case when m.offset_months = 0 then 'pendiente'::utility_status else 'facturado'::utility_status end,
  null
from public.leases l
join lateral (
  select row_number() over (order by l2.created_at, l2.id) as rn from public.leases l2 where l2.id = l.id
) r on true
cross join lateral (values (0), (1), (2)) as m(offset_months)
cross join lateral (values
  ('agua'::utility_type, round((180 + (r.rn % 7) * 35)::numeric, 2)),
  ('cuota_mantenimiento'::utility_type, 950.00)
) as ut(type, amount)
where l.status = 'activo'
on conflict (unit_id, type, period_month) do nothing;

-- --------------------------------------------------------------- invoices
-- Months M-2 and M-1 for all 30 leases; month M for 26 of them.

with l as (
  select l.*, row_number() over (order by l.created_at, l.id) as rn from public.leases l where l.status = 'activo'
),
periods as (select * from (values (2), (1), (0)) as p(offset_months)),
target as (
  select l.*, p.offset_months,
         (date_trunc('month', current_date) - p.offset_months * interval '1 month')::date as period_month
  from l cross join periods p
  where not (p.offset_months = 0 and l.rn > 26)   -- 4 leases left for the generator to pick up
),
ins as (
  insert into public.invoices (lease_id, period_month, invoice_number, issue_date, due_date, status, total)
  select
    t.id,
    t.period_month,
    public.next_invoice_number(),
    t.period_month,
    (t.period_month + (least(t.rent_due_day, 28) - 1) * interval '1 day')::date,
    case when t.offset_months = 0 then 'enviado'::invoice_status else 'pagado'::invoice_status end,
    0
  from target t
  order by t.period_month, t.rn
  returning id, lease_id, period_month
)
insert into public.invoice_lines (invoice_id, description, category, quantity, amount)
-- rent
select i.id, 'Renta mensual', 'renta'::line_category, 1::numeric, l.rent_amount
from ins i join public.leases l on l.id = i.lease_id
union all
-- parking
select i.id, 'Estacionamiento ' || ps.label, 'estacionamiento'::line_category, 1::numeric, ps.monthly_fee
from ins i join public.parking_spaces ps on ps.lease_id = i.lease_id
union all
-- utilities already billed
select i.id,
       case uc.type when 'agua' then 'Agua' when 'cuota_mantenimiento' then 'Cuota de mantenimiento' else 'Servicio' end,
       case uc.type when 'cuota_mantenimiento' then 'cuota_mantenimiento'::line_category else 'servicios'::line_category end,
       1::numeric, uc.amount
from ins i
join public.utility_charges uc on uc.lease_id = i.lease_id and uc.period_month = i.period_month and uc.status = 'facturado';

-- Point the consumed charges at the invoice that ate them.
update public.utility_charges uc
set invoice_id = i.id
from public.invoices i
where uc.lease_id = i.lease_id and uc.period_month = i.period_month and uc.status = 'facturado';

-- Totals always come from the lines.
update public.invoices i
set total = coalesce((select sum(il.amount * il.quantity) from public.invoice_lines il where il.invoice_id = i.id), 0);

-- --------------------------------------------------------------- payments
-- M-2: everyone paid. M-1: most paid, a few short. M: about half paid.

with inv as (
  select i.*, row_number() over (order by i.period_month, i.invoice_number) as rn,
         (date_part('month', age(date_trunc('month', current_date), i.period_month)))::int
         + (date_part('year', age(date_trunc('month', current_date), i.period_month)))::int * 12 as months_ago
  from public.invoices i
),
payable as (
  select inv.*,
    case
      when months_ago = 2 then inv.total                                   -- fully paid
      when months_ago = 1 and inv.rn % 10 = 0 then round(inv.total * 0.5, 2)  -- partial
      when months_ago = 1 and inv.rn % 10 = 3 then 0                       -- never paid -> vencido
      when months_ago = 1 then inv.total
      when months_ago = 0 and inv.rn % 2 = 0 then inv.total                -- current month, half paid
      else 0
    end as pay_amount
  from inv
),
pay as (
  insert into public.payments (lease_id, amount, paid_at, method, reference, status, reported_by_tenant, confirmed_at)
  select
    p.lease_id,
    p.pay_amount,
    least(p.due_date + ((p.rn % 4))::int, current_date),
    (array['spei','spei','spei','efectivo','deposito','oxxo'])[(p.rn % 6) + 1]::payment_method,
    'SPEI' || lpad((7000000 + p.rn * 137)::text, 9, '0'),
    'confirmado',
    false,
    now()
  from payable p
  where p.pay_amount > 0
  -- `reference` is derived from the invoice's row number, so it is the
  -- key that ties each payment back to exactly one invoice.
  returning id, amount, reference
)
insert into public.payment_allocations (payment_id, invoice_id, amount)
select pay.id, payable.id, pay.amount
from pay
join payable on 'SPEI' || lpad((7000000 + payable.rn * 137)::text, 9, '0') = pay.reference;

-- Three self-reported payments waiting in the confirmation queue.
insert into public.payments (lease_id, amount, paid_at, method, reference, status, reported_by_tenant, notes)
select l.id, l.rent_amount, current_date - 1, 'spei', 'SPEI' || lpad((9100000 + row_number() over ())::text, 9, '0'),
       'pendiente', true, 'Transferencia realizada desde BBVA.'
from public.leases l
where l.status = 'activo'
order by l.created_at
limit 3;

-- Derive invoice status from what was actually allocated.
update public.invoices i
set status = case
  when i.status = 'cancelado' then i.status
  when b.paid >= i.total then 'pagado'
  when b.paid > 0 then 'pagado_parcial'
  when i.due_date < current_date then 'vencido'
  else 'enviado'
end
from public.invoice_balances b
where b.invoice_id = i.id;

-- ------------------------------------------------------------ work orders
-- 15 orders spread across every status, category and source.

insert into public.work_orders (unit_id, lease_id, reported_by_tenant, source, category, priority, title, description, status, vendor_name, vendor_phone, cost, resolved_at, created_at)
select
  l.unit_id, l.id, lt.tenant_id,
  w.source, w.category, w.priority, w.title, w.description, w.status,
  case when w.status in ('asignada','en_progreso','esperando_refacciones','resuelta','cerrada') then w.vendor end,
  case when w.status in ('asignada','en_progreso','esperando_refacciones','resuelta','cerrada') then '+52 55 4120 ' || lpad((3000 + w.rn * 17)::text, 4, '0') end,
  case when w.status in ('resuelta','cerrada') then w.cost end,
  case when w.status in ('resuelta','cerrada') then now() - (w.rn || ' days')::interval end,
  now() - ((w.rn * 3) || ' days')::interval
from (values
  (1,  'portal'::wo_source,   'plomeria'::wo_category,          'urgente'::wo_priority, 'Fuga de agua en el baño principal', 'El agua escurre por la pared debajo del lavabo desde ayer.',            'nueva'::wo_status,                 'Plomería Express',   1450.00),
  (2,  'whatsapp',            'electricidad',                   'alta',                 'Apagón en la recámara',             'No hay luz en los contactos de la recámara principal.',                 'asignada',                         'Electro Servicios',  890.00),
  (3,  'telefono',            'cerrajeria',                     'media',                'Cerradura atascada',                'La llave entra pero no gira en la puerta de entrada.',                   'en_progreso',                      'Cerrajería 24/7',    650.00),
  (4,  'personal',            'electrodomesticos',              'media',                'Boiler no calienta',                'El agua sale tibia aun al máximo.',                                     'esperando_refacciones',            'Clima y Calor',     2300.00),
  (5,  'portal',              'limpieza',                       'baja',                 'Limpieza de tinaco',                'Solicito limpieza programada del tinaco.',                              'resuelta',                         'Limpieza Integral',  900.00),
  (6,  'portal',              'plomeria',                       'alta',                 'Drenaje tapado en cocina',          'El fregadero no desagua.',                                              'cerrada',                          'Plomería Express',  1100.00),
  (7,  'whatsapp',            'electricidad',                   'urgente',              'Corto circuito en pasillo',         'Saltó el interruptor general dos veces hoy.',                            'en_progreso',                      'Electro Servicios', 1750.00),
  (8,  'telefono',            'otro',                           'baja',                 'Ruido en el elevador',              'Se escucha un rechinido al subir del piso 2 al 3.',                      'nueva',                            'Elevadores Mex',    3200.00),
  (9,  'personal',            'plomeria',                       'media',                'Goteo en regadera',                 'Gotea constantemente aunque esté cerrada.',                              'asignada',                         'Plomería Express',   520.00),
  (10, 'portal',              'electrodomesticos',              'alta',                 'Estufa sin gas',                    'Dos quemadores no encienden.',                                          'resuelta',                         'Gas del Valle',      780.00),
  (11, 'portal',              'cerrajeria',                     'urgente',              'Puerta principal no cierra',        'La chapa quedó floja y la puerta no asegura.',                           'cerrada',                          'Cerrajería 24/7',    980.00),
  (12, 'whatsapp',            'limpieza',                       'baja',                 'Basura acumulada en azotea',        'Hay bolsas acumuladas junto a la salida de azotea.',                     'resuelta',                         'Limpieza Integral',  400.00),
  (13, 'telefono',            'electricidad',                   'media',                'Foco fundido en pasillo común',     'El pasillo del segundo piso quedó a oscuras.',                           'cerrada',                          'Electro Servicios',  180.00),
  (14, 'personal',            'otro',                           'media',                'Revisión de humedad en muro',       'Mancha de humedad creciendo en el muro de la sala.',                     'esperando_refacciones',            'Impermeabiliza MX', 4500.00),
  (15, 'portal',              'plomeria',                       'alta',                 'Presión de agua muy baja',          'Casi no sale agua en la regadera por las mañanas.',                      'nueva',                            'Plomería Express',   700.00)
) as w(rn, source, category, priority, title, description, status, vendor, cost)
join lateral (
  select l.* from public.leases l
  where l.status = 'activo'
  order by l.created_at, l.id
  offset (w.rn - 1) limit 1
) l on true
join lateral (
  select lt.tenant_id from public.lease_tenants lt where lt.lease_id = l.id and lt.role = 'primary' limit 1
) lt on true;

insert into public.work_order_notes (work_order_id, body, is_internal)
select w.id, n.body, n.is_internal
from public.work_orders w
join lateral (values
  ('Proveedor contactado, agenda visita para mañana por la mañana.', true),
  ('Ya contactamos al proveedor. La visita queda agendada para mañana entre 9:00 y 12:00.', false)
) as n(body, is_internal) on true
where w.status <> 'nueva';

commit;


-- ============================================================================
-- 5/5  DEMO LOGINS — admin / manager / three tenants
-- ============================================================================
-- Rentio — demo login accounts. DEMO AND STAGING ONLY.
--
-- Never run this against production: it creates accounts with a known
-- password. Run it AFTER seed.sql, which creates the tenants these link to.
--
--   Admin    admin@rentio.mx     Rentio2026!
--   Manager  gerente@rentio.mx   Rentio2026!
--   Tenant   (first two tenants, by email from seed.sql)  Rentio2026!

begin;

do $$
declare
  demo_password constant text := 'Rentio2026!';
  rec record;
  uid uuid;
begin
  for rec in
    select 'admin@rentio.mx'::text as email, 'Mariana Torres Aguilar'::text as full_name,
           'admin'::user_role as role, null::uuid as tenant_id
    union all
    select 'gerente@rentio.mx', 'Diego Lozano Ibarra', 'manager', null
    union all
    -- The first three seeded tenants get portal access. The limit lives in a
    -- subquery: attached to the UNION it would truncate the staff rows too.
    select * from (
      select t.email, t.full_name, 'tenant'::user_role as role, t.id as tenant_id
      from public.tenants t
      join public.lease_tenants lt on lt.tenant_id = t.id and lt.role = 'primary'
      order by lt.created_at
      limit 3
    ) demo_tenants
  loop
    select id into uid from auth.users where email = rec.email;

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        rec.email, crypt(demo_password, gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', rec.full_name),
        '', '', '', ''
      );

      insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at)
      values (uid, uid::text, 'email',
              jsonb_build_object('sub', uid::text, 'email', rec.email, 'email_verified', true),
              now())
      on conflict (provider_id, provider) do nothing;
    else
      update auth.users set encrypted_password = crypt(demo_password, gen_salt('bf')) where id = uid;
    end if;

    insert into public.profiles (id, full_name, role, tenant_id, locale)
    values (uid, rec.full_name, rec.role, rec.tenant_id, 'es-MX')
    on conflict (id) do update
      set full_name = excluded.full_name,
          role      = excluded.role,
          tenant_id = excluded.tenant_id;
  end loop;
end;
$$;

commit;
