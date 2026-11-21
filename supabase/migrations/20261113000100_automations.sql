-- Automations a manager can switch and tune (approved Paper mock-up
-- "13 · Automations", 2026-11-13). The heartbeat stays the daily cron; what
-- it does per company comes from these settings, read at run time, so a
-- change applies from the next run with no deploy.
--
--   settings.auto_*            per-company switches and numbers
--   job_runs                   one row per company per run, for "Last run"
--   nightly()                  reads auto_invoice_day; per-company breakdown
--   queue_late_fee_warnings()  respects auto_late_fee_warning
--   queue_rent_reminders()     respects auto_rent_reminder(_days)
--   notify_* triggers          respect auto_payment_emails / auto_repair_emails
--   claim_notifications()      now returns org_id so runs can be counted per company

alter table public.settings
  add column if not exists auto_invoice_day        int     not null default 1 check (auto_invoice_day between 1 and 28),
  add column if not exists auto_invoice_send       boolean not null default false,
  add column if not exists auto_rent_reminder      boolean not null default true,
  add column if not exists auto_rent_reminder_days int     not null default 3 check (auto_rent_reminder_days between 1 and 14),
  add column if not exists auto_late_fee_warning   boolean not null default true,
  add column if not exists auto_payment_emails     boolean not null default true,
  add column if not exists auto_repair_emails      boolean not null default true;

-- ------------------------------------------------------------- job runs

create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  trigger     text not null check (trigger in ('cron', 'manual')),
  actor_id    uuid references public.profiles (id) on delete set null,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  summary     jsonb not null default '{}'::jsonb,
  error       text
);
create index if not exists job_runs_org_started_idx on public.job_runs (org_id, started_at desc);

alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;
grant select on public.job_runs to authenticated;
-- Staff read their company's runs; only the server writes.
-- drop-if-exists first so the file can be re-run after a partial deploy.
drop policy if exists job_runs_staff_select on public.job_runs;
create policy job_runs_staff_select on public.job_runs
  for select to authenticated using (public.is_staff());
do $$
declare
  mine constant text := 'org_id = (select public.current_org_id())';
  platform constant text :=
    '((select public.is_super_admin()) and (select public.current_org_id()) is null)';
begin
  drop policy if exists org_isolation_select on public.job_runs;
  execute format('create policy org_isolation_select on public.job_runs as restrictive for select to authenticated using (%s or %s)', mine, platform);
end;
$$;

-- --------------------------------------------------------------- nightly
-- Per company: draft the month's invoices on its chosen day (or later in
-- the month if that run was missed), in its own sub-transaction. Returns a
-- per-company breakdown with the ids drafted this run, so the server can
-- email them for companies that chose "send automatically".

create or replace function public.nightly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today       date := public.today_el_paso();
  period      date := date_trunc('month', public.today_el_paso())::date;
  run_started timestamptz := now();
  org     record;
  made    int := 0;
  skipped int := 0;
  failed  uuid[] := '{}';
  per_org jsonb := '[]'::jsonb;
  r       record;
  ids     uuid[];
  queued  int;
begin
  for org in
    select o.id, coalesce(s.auto_invoice_day, 1) as invoice_day
    from public.organizations o
    left join public.settings s on s.org_id = o.id
    where o.status = 'active'
  loop
    begin
      ids := '{}';
      if extract(day from today) >= org.invoice_day
         and (extract(day from today) = org.invoice_day
              or not exists (select 1 from public.invoices where org_id = org.id and period_month = period)) then
        select * into r from public.generate_invoices_for_org(period, org.id);
        made := made + r.created;
        skipped := skipped + r.skipped;
        select coalesce(array_agg(id), '{}') into ids
        from public.invoices
        where org_id = org.id and period_month = period and created_at >= run_started;
        per_org := per_org || jsonb_build_object(
          'org_id', org.id, 'invoices_created', r.created,
          'invoices_skipped', r.skipped, 'invoice_ids', to_jsonb(ids));
      else
        per_org := per_org || jsonb_build_object(
          'org_id', org.id, 'invoices_created', 0, 'invoices_skipped', 0, 'invoice_ids', '[]'::jsonb);
      end if;
    exception when others then
      raise warning 'nightly: invoicing failed for org %: %', org.id, sqlerrm;
      failed := failed || org.id;
      per_org := per_org || jsonb_build_object('org_id', org.id, 'error', sqlerrm);
    end;
  end loop;

  queued := public.queue_late_fee_warnings();

  return jsonb_build_object(
    'today', today,
    'period', period,
    'invoices_created', made,
    'invoices_skipped', skipped,
    'orgs_failed', to_jsonb(failed),
    'warnings_queued', queued,
    'orgs', per_org
  );
end;
$$;

-- ------------------------------------------------- late-fee warnings (flag)

create or replace function public.queue_late_fee_warnings()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.today_el_paso();
  queued int;
begin
  insert into public.late_fee_warnings (invoice_id, org_id, eligible_on)
  select i.id, i.org_id, i.due_date + greatest(l.grace_days, 2) + 1
  from public.invoices i
  join public.leases l on l.id = i.lease_id
  join public.invoice_balances b on b.invoice_id = i.id
  join public.settings s on s.org_id = i.org_id and s.auto_late_fee_warning
  where i.status not in ('borrador', 'pagado', 'cancelado')
    and b.balance > 0
    and public.lease_late_fee(l) > 0
    and i.due_date + greatest(l.grace_days, 2) between today - 1 and today
  on conflict (invoice_id) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

-- ---------------------------------------------- rent reminders (flag, days)

create or replace function public.queue_rent_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.today_el_paso();
  r record;
  queued int := 0;
begin
  for r in
    select i.id, i.lease_id, i.period_month, i.due_date, b.balance
    from public.invoices i
    join public.invoice_balances b on b.invoice_id = i.id
    join public.settings s on s.org_id = i.org_id and s.auto_rent_reminder
    where i.status in ('enviado', 'pagado_parcial')
      and b.balance > 0
      and i.due_date between today and today + s.auto_rent_reminder_days
  loop
    queued := queued + public.queue_notification(
      r.lease_id, 'rent_reminder', r.id, '',
      jsonb_build_object('period_month', r.period_month, 'due_date', r.due_date, 'balance', r.balance));
  end loop;
  return queued;
end;
$$;

-- ------------------------------------------------- tenant emails (flags)

create or replace function public.notify_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_by_tenant
     and new.status is distinct from old.status
     and new.status in ('confirmado', 'cancelado')
     and coalesce((select auto_payment_emails from public.settings where org_id = new.org_id), true) then
    perform public.queue_notification(
      new.lease_id,
      case when new.status = 'confirmado' then 'payment_confirmed' else 'payment_rejected' end,
      new.id, new.status::text,
      jsonb_build_object('amount', new.amount, 'paid_at', new.paid_at,
                         'method', new.method, 'reason', new.void_reason));
  end if;
  return null;
end;
$$;

create or replace function public.notify_work_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lease_id is not null
     and new.status is distinct from old.status
     and coalesce((select auto_repair_emails from public.settings where org_id = new.org_id), true) then
    perform public.queue_notification(
      new.lease_id, 'work_order_status', new.id, new.status::text,
      jsonb_build_object('title', new.title, 'status', new.status));
  end if;
  return null;
end;
$$;

create or replace function public.notify_work_order_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wo public.work_orders%rowtype;
begin
  if new.is_internal then return null; end if;
  select * into wo from public.work_orders where id = new.work_order_id;
  if wo.lease_id is not null
     and coalesce((select auto_repair_emails from public.settings where org_id = wo.org_id), true) then
    perform public.queue_notification(
      wo.lease_id, 'work_order_note', new.id, '',
      jsonb_build_object('title', wo.title, 'body', left(new.body, 500)));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------- claim returns org_id now

drop function if exists public.claim_notifications(int);
create function public.claim_notifications(p_limit int default 100)
returns table (
  id           uuid,
  org_id       uuid,
  kind         text,
  payload      jsonb,
  tenant_name  text,
  tenant_email text,
  locale       text,
  company_name text,
  unit_number  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    update public.notifications n
    set sent_at = now()
    where n.id in (
      select p.id from public.notifications p
      where p.sent_at is null
      order by p.created_at
      limit p_limit
      for update skip locked
    )
    returning n.id, n.kind, n.payload, n.lease_id, n.tenant_id, n.org_id
  )
  select c.id, c.org_id, c.kind, c.payload, t.full_name, nullif(trim(t.email), ''),
         coalesce((select p.locale from public.profiles p
                   where p.tenant_id = t.id and p.locale is not null limit 1), 'es-MX'),
         coalesce(s.company_name, 'Rentio'),
         u.unit_number
  from claimed c
  join public.tenants t on t.id = c.tenant_id
  left join public.leases l on l.id = c.lease_id
  left join public.units u on u.id = l.unit_id
  left join public.settings s on s.org_id = c.org_id;
end;
$$;

revoke all on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
