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
