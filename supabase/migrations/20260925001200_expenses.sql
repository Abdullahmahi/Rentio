-- Gastos: landlord expenses, entered by hand, one row per unit.
-- The property is reached through units.property_id, like utility_charges.

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references public.units (id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  spent_at     date not null default current_date,
  description  text not null check (length(trim(description)) > 0),
  notes        text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.expenses is
  'Landlord expenses per unit. Staff-only; rolled up per property in Reportes.';

create index on public.expenses (unit_id, spent_at);
create index on public.expenses (spent_at);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- RLS
-- Staff-only, exactly like utility_charges.

alter table public.expenses enable row level security;

create policy expenses_staff_select on public.expenses
  for select to authenticated using (public.is_staff());
create policy expenses_staff_insert on public.expenses
  for insert to authenticated with check (public.is_staff());
create policy expenses_staff_update on public.expenses
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy expenses_admin_delete on public.expenses
  for delete to authenticated using (public.is_admin());
