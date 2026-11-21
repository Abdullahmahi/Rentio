-- Automations run one company at a time (issue #13). Every function the
-- pipeline calls now takes the company it works on, so "Run now" in company
-- A can never draft, queue, claim or email anything of company B. The
-- nightly cron loops the active companies in the app, one call per company.
--
-- The old no-argument versions ran every company at once and are dropped:
-- nothing may call them any more. Re-runnable.
--
--   nightly(p_org_id)                   invoices + late-fee warning queue
--   queue_late_fee_warnings(p_org_id)
--   late_fee_warnings_to_send(p_org_id)
--   queue_rent_reminders(p_org_id)
--   claim_notifications(p_org_id, p_limit)

drop function if exists public.nightly();
drop function if exists public.queue_late_fee_warnings();
drop function if exists public.late_fee_warnings_to_send();
drop function if exists public.queue_rent_reminders();
drop function if exists public.claim_notifications(int);

-- --------------------------------------------- late-fee warnings (queue)

create or replace function public.queue_late_fee_warnings(p_org_id uuid)
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
  where i.org_id = p_org_id
    and i.status not in ('borrador', 'pagado', 'cancelado')
    and b.balance > 0
    and public.lease_late_fee(l) > 0
    and i.due_date + greatest(l.grace_days, 2) between today - 1 and today
  on conflict (invoice_id) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.queue_late_fee_warnings(uuid) from public, anon, authenticated;
grant execute on function public.queue_late_fee_warnings(uuid) to service_role;

-- --------------------------------------------- late-fee warnings (send)

create or replace function public.late_fee_warnings_to_send(p_org_id uuid)
returns table (
  invoice_id   uuid,
  org_id       uuid,
  eligible_on  date,
  period_month date,
  fee          numeric,
  balance      numeric,
  unit_number  text,
  tenant_name  text,
  tenant_email text,
  locale       text,
  company_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.invoice_id, w.org_id, w.eligible_on, i.period_month,
         public.lease_late_fee(l), b.balance, u.unit_number,
         t.full_name, nullif(trim(t.email), ''),
         coalesce((select p.locale from public.profiles p
                   where p.tenant_id = t.id and p.locale is not null limit 1), 'es-MX'),
         coalesce(s.company_name, 'Rentio')
  from public.late_fee_warnings w
  join public.invoices i on i.id = w.invoice_id
  join public.leases l on l.id = i.lease_id
  join public.units u on u.id = l.unit_id
  join public.invoice_balances b on b.invoice_id = i.id
  left join lateral (
    select tt.* from public.lease_tenants lt
    join public.tenants tt on tt.id = lt.tenant_id
    where lt.lease_id = l.id and lt.role = 'primary'
    order by lt.created_at limit 1
  ) t on true
  left join public.settings s on s.org_id = w.org_id
  where w.sent_at is null
    and w.org_id = p_org_id
  order by w.created_at;
$$;

revoke all on function public.late_fee_warnings_to_send(uuid) from public, anon, authenticated;
grant execute on function public.late_fee_warnings_to_send(uuid) to service_role;

-- ---------------------------------------------------------- rent reminders

create or replace function public.queue_rent_reminders(p_org_id uuid)
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
    where i.org_id = p_org_id
      and i.status in ('enviado', 'pagado_parcial')
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

revoke all on function public.queue_rent_reminders(uuid) from public, anon, authenticated;
grant execute on function public.queue_rent_reminders(uuid) to service_role;

-- --------------------------------------------------------------- nightly
-- One company: draft the month's invoices on its chosen day (or later in
-- the month if that run was missed), queue its late-fee warnings. Same
-- return shape as before, with a one-element 'orgs' array.

create or replace function public.nightly(p_org_id uuid)
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
  queued  int := 0;
begin
  select o.id, coalesce(s.auto_invoice_day, 1) as invoice_day into org
  from public.organizations o
  left join public.settings s on s.org_id = o.id
  where o.id = p_org_id and o.status = 'active';

  if org.id is not null then
    begin
      ids := '{}';
      if extract(day from today) >= org.invoice_day
         and (extract(day from today) = org.invoice_day
              or not exists (select 1 from public.invoices where org_id = org.id and period_month = period)) then
        select * into r from public.generate_invoices_for_org(period, org.id);
        made := r.created;
        skipped := r.skipped;
        select coalesce(array_agg(id), '{}') into ids
        from public.invoices
        where org_id = org.id and period_month = period and created_at >= run_started;
      end if;
      per_org := per_org || jsonb_build_object(
        'org_id', org.id, 'invoices_created', made,
        'invoices_skipped', skipped, 'invoice_ids', to_jsonb(ids));
    exception when others then
      raise warning 'nightly: invoicing failed for org %: %', org.id, sqlerrm;
      failed := failed || org.id;
      made := 0;
      skipped := 0;
      per_org := per_org || jsonb_build_object('org_id', org.id, 'error', sqlerrm);
    end;
    queued := public.queue_late_fee_warnings(org.id);
  end if;

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

revoke all on function public.nightly(uuid) from public, anon, authenticated;
grant execute on function public.nightly(uuid) to service_role;

-- ---------------------------------------------------- notifications outbox

create or replace function public.claim_notifications(p_org_id uuid, p_limit int default 100)
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
        and p.org_id = p_org_id
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

revoke all on function public.claim_notifications(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_notifications(uuid, int) to service_role;
