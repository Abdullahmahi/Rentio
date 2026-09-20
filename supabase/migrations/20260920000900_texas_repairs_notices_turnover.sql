-- Prompt 19 — three smaller Texas Property Code obligations.

-- ---------------------------------------- 1. repair notice (§92.052, §92.056)
--
-- The duty to repair a condition materially affecting health or safety is
-- triggered by the tenant's WRITTEN notice, and 7 days is presumed a
-- reasonable time to repair. A portal-submitted work order IS written notice,
-- which is an advantage for the client, so it is recorded as one.

alter table public.work_orders
  add column affects_health_safety boolean not null default false,
  add column written_notice_at timestamptz;

comment on column public.work_orders.written_notice_at is
  'When the tenant gave written notice. §92.056 presumes 7 days a reasonable '
  'time to repair from this moment. Set automatically for portal orders.';

-- Backfill: every existing portal order already was written notice.
update public.work_orders set written_notice_at = created_at where source = 'portal';

create or replace function public.work_orders_set_written_notice()
returns trigger
language plpgsql
as $$
begin
  -- A portal submission is the tenant's own written notice, so it dates from
  -- when they sent it, not from when a manager happened to flag it.
  if new.source = 'portal' and new.written_notice_at is null then
    new.written_notice_at := coalesce(new.created_at, now());
  end if;
  return new;
end;
$$;

create trigger work_orders_set_written_notice
  before insert or update on public.work_orders
  for each row execute function public.work_orders_set_written_notice();

create index on public.work_orders (written_notice_at)
  where affects_health_safety and resolved_at is null;

-- ------------------------------------------ 2. notice to vacate (§24.005)

create type notice_type as enum ('non_payment', 'lease_violation', 'end_of_term');
create type notice_delivery as enum ('in_person', 'mail', 'affixed_to_door');

create table public.lease_notices (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references public.leases (id) on delete cascade,
  type           notice_type not null,
  reason         text,
  vacate_date    date not null,
  delivery       notice_delivery not null,
  delivered_at   date not null default current_date,
  document_url   text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

comment on table public.lease_notices is
  'A record that a notice to vacate was generated and delivered. §24.005 '
  'governs the notice itself. This files NOTHING with a court.';

create index on public.lease_notices (lease_id);

-- ------------------- 3. move-in / turnover checklist (§92.156, §92.251–92.261)
--
-- Security devices must be rekeyed no later than the 7th day after a new
-- tenant takes possession, and smoke alarms maintained.

create table public.unit_turnover_checklist (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references public.units (id) on delete cascade,
  lease_id     uuid not null references public.leases (id) on delete cascade,
  item         text not null,
  -- Ordering key, and what the rekey countdown keys off.
  item_key     text not null,
  position     int not null default 0,
  completed    boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  unique (lease_id, item_key)
);

create index on public.unit_turnover_checklist (unit_id);
create index on public.unit_turnover_checklist (lease_id);

-- Keep completed_at honest without making every caller remember to set it.
create or replace function public.turnover_set_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.completed and not coalesce(old.completed, false) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif not new.completed then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

create trigger turnover_set_completed_at
  before update on public.unit_turnover_checklist
  for each row execute function public.turnover_set_completed_at();

-- updated_at, same as every other table.
create trigger lease_notices_set_updated_at
  before update on public.lease_notices
  for each row execute function public.set_updated_at();
create trigger unit_turnover_checklist_set_updated_at
  before update on public.unit_turnover_checklist
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- RLS
--
-- Deny by default, like every other table. Both of these are internal
-- records: a tenant has no business reading the turnover checklist, and a
-- notice reaches them as a delivered document, not as a row they can poll.

alter table public.lease_notices enable row level security;
alter table public.unit_turnover_checklist enable row level security;

create policy lease_notices_staff_select on public.lease_notices
  for select to authenticated using (public.is_staff());
create policy lease_notices_staff_insert on public.lease_notices
  for insert to authenticated with check (public.is_staff());
create policy lease_notices_staff_update on public.lease_notices
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy lease_notices_admin_delete on public.lease_notices
  for delete to authenticated using (public.is_admin());

create policy turnover_staff_select on public.unit_turnover_checklist
  for select to authenticated using (public.is_staff());
create policy turnover_staff_insert on public.unit_turnover_checklist
  for insert to authenticated with check (public.is_staff());
create policy turnover_staff_update on public.unit_turnover_checklist
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy turnover_admin_delete on public.unit_turnover_checklist
  for delete to authenticated using (public.is_admin());
