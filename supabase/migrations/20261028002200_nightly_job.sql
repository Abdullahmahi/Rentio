-- The nightly job (execution.md A1, A3, A4; owner decisions D1, D2, D3).
--
--   today_el_paso()              "today" in SQL, always El Paso (TRD §8.1)
--   generate_invoices(period)    the Generate button (staff, own org)
--   generate_invoices_for_org()  the one place invoices are generated; the
--                                button and nightly() both end up here
--   queue_late_fee_warnings()    D3: warn before a fee is chargeable; fees
--                                themselves are never added automatically
--   late_fee_warnings_to_send()  what /api/jobs/nightly emails
--   nightly()                    the scheduled entry point, returns counts
--
-- Also fixes the §92.019 guard's current_date (B-004). Re-runnable.

-- ------------------------------------------------------------ today

create or replace function public.today_el_paso()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Denver')::date;
$$;

grant execute on function public.today_el_paso() to authenticated, service_role;

-- --------------------------------------- §92.019 guard on El Paso dates
-- Identical to 20260920001000 except current_date -> today_el_paso().

create or replace function public.enforce_late_fee_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv        record;
  grace      int;
  eligible   date;
  existing   int;
begin
  if new.category <> 'recargo' then
    return new;
  end if;

  select i.due_date, i.lease_id into inv
  from public.invoices i where i.id = new.invoice_id;

  if not found then
    return new;
  end if;

  select greatest(l.grace_days, 2) into grace
  from public.leases l where l.id = inv.lease_id;

  eligible := inv.due_date + coalesce(grace, 2) + 1;

  if public.today_el_paso() < eligible then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Texas Property Code 92.019: a late fee on this invoice cannot be charged before %s.',
        to_char(eligible, 'MM/DD/YYYY')
      );
  end if;

  select count(*) into existing
  from public.invoice_lines il
  where il.invoice_id = new.invoice_id
    and il.category = 'recargo'
    and il.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if existing > 0 then
    raise exception using
      errcode = 'check_violation',
      message = 'This invoice already has a late fee.';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------- invoice numbers per org
-- The nightly job has no org in its JWT, so the prefix must come from the
-- lease's org. The no-arg version (the browser's) now delegates here.

create or replace function public.next_invoice_number_for_org(p_org uuid)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce(
           (select invoice_prefix from public.settings where org_id = p_org),
           'REC')
      || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
$$;

create or replace function public.next_invoice_number()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select public.next_invoice_number_for_org(public.current_org_id());
$$;

revoke all on function public.next_invoice_number_for_org(uuid) from public, anon, authenticated;
grant execute on function public.next_invoice_number_for_org(uuid) to service_role;

-- ---------------------------------------------------- invoice generation
-- Rent + one line per assigned parking space, as drafts (D2). Utilities are
-- not billed: the owner dropped them (app.receipts.index.tsx passed none).
-- Billed: active leases that have started by the end of the period and
-- either run into it or are past their end date (D1 month-to-month).
-- (lease_id, period_month) is unique, so a second run, or two at once,
-- creates nothing twice.

create or replace function public.generate_invoices_for_org(p_period date, p_org uuid)
returns table (created int, skipped int)
language plpgsql
security definer
set search_path = public
as $$
declare
  period     date := date_trunc('month', p_period)::date;
  period_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  today      date := public.today_el_paso();
  l          record;
  inv_id     uuid;
  rent_total numeric(12,2);
begin
  created := 0;
  skipped := 0;

  for l in
    select le.*
    from public.leases le
    where le.org_id = p_org
      and le.status in ('activo', 'por_vencer')
      and le.start_date <= period_end
      and (le.end_date >= period or le.end_date < today)
    order by le.created_at, le.id
  loop
    if exists (select 1 from public.invoices where lease_id = l.id and period_month = period) then
      skipped := skipped + 1;
      continue;
    end if;

    select l.rent_amount + coalesce(sum(ps.monthly_fee), 0) into rent_total
    from public.parking_spaces ps where ps.lease_id = l.id;

    insert into public.invoices
      (lease_id, org_id, period_month, invoice_number, issue_date, due_date, status, total)
    values (
      l.id, l.org_id, period, public.next_invoice_number_for_org(l.org_id), today,
      -- the lease's due day, clamped to month end; never before move-in
      greatest(least(period + (l.rent_due_day - 1), period_end), l.start_date),
      'borrador', rent_total
    )
    on conflict (lease_id, period_month) do nothing
    returning id into inv_id;

    if inv_id is null then
      skipped := skipped + 1;  -- a concurrent run won
      continue;
    end if;

    insert into public.invoice_lines (invoice_id, org_id, description, category, quantity, amount)
    select inv_id, l.org_id, 'Monthly rent', 'renta'::line_category, 1, l.rent_amount
    union all
    select inv_id, l.org_id, 'Parking ' || ps.label, 'estacionamiento', 1, ps.monthly_fee
    from public.parking_spaces ps where ps.lease_id = l.id;

    created := created + 1;
  end loop;

  if created > 0 then
    insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
    values (public.current_user_id(), 'invoice', null, 'generate_month',
            jsonb_build_object('period', period, 'created', created), p_org);
  end if;

  return next;
end;
$$;

revoke all on function public.generate_invoices_for_org(date, uuid) from public, anon, authenticated;
grant execute on function public.generate_invoices_for_org(date, uuid) to service_role;

-- What the Generate button calls: staff, own org only. The platform view
-- (super_admin, no company picked) has no org and is refused (A-10).
create or replace function public.generate_invoices(p_period date)
returns table (created int, skipped int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can generate invoices.' using errcode = '42501';
  end if;
  return query select * from public.generate_invoices_for_org(p_period, public.current_org_id());
end;
$$;

revoke all on function public.generate_invoices(date) from public, anon;
grant execute on function public.generate_invoices(date) to authenticated, service_role;

-- ------------------------------------------------- late-fee warnings (D3)

create table if not exists public.late_fee_warnings (
  invoice_id  uuid primary key references public.invoices (id) on delete cascade,
  org_id      uuid not null default public.current_org_id() references public.organizations (id) on delete restrict,
  eligible_on date not null,
  sent_at     timestamptz,
  channel     text check (channel in ('email', 'portal')),
  created_at  timestamptz not null default now()
);

create index if not exists late_fee_warnings_org_id_idx on public.late_fee_warnings (org_id);
create index if not exists late_fee_warnings_unsent_idx on public.late_fee_warnings (invoice_id) where sent_at is null;

drop trigger if exists org_from_parent on public.late_fee_warnings;
create trigger org_from_parent before insert or update on public.late_fee_warnings
  for each row execute function public.org_from_parent('invoices', 'invoice_id');

alter table public.late_fee_warnings enable row level security;

-- Read-only to people: rows are written by the nightly job (service role)
-- and by the security-definer queue function, never through the API.
drop policy if exists late_fee_warnings_select on public.late_fee_warnings;
create policy late_fee_warnings_select on public.late_fee_warnings
  for select to authenticated
  using (
    public.is_staff() or exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.lease_id in (select public.my_lease_ids())
    )
  );

do $$
declare
  mine constant text := 'org_id = (select public.current_org_id())';
  platform constant text :=
    '((select public.is_super_admin()) and (select public.current_org_id()) is null)';
begin
  execute 'drop policy if exists org_isolation_select on public.late_fee_warnings';
  execute 'drop policy if exists org_isolation_insert on public.late_fee_warnings';
  execute 'drop policy if exists org_isolation_update on public.late_fee_warnings';
  execute 'drop policy if exists org_isolation_delete on public.late_fee_warnings';
  execute format('create policy org_isolation_select on public.late_fee_warnings as restrictive for select to authenticated using (%s or %s)', mine, platform);
  execute format('create policy org_isolation_insert on public.late_fee_warnings as restrictive for insert to authenticated with check (%s)', mine);
  execute format('create policy org_isolation_update on public.late_fee_warnings as restrictive for update to authenticated using (%s) with check (%s)', mine, mine);
  execute format('create policy org_isolation_delete on public.late_fee_warnings as restrictive for delete to authenticated using (%s)', mine);
end;
$$;

revoke all on public.late_fee_warnings from anon;
grant select on public.late_fee_warnings to authenticated;
grant select, insert, update, delete on public.late_fee_warnings to service_role;

-- The lease's fee in dollars. Mirrors lateFeeAmount in src/lib/late-fee.ts.
create or replace function public.lease_late_fee(l public.leases)
returns numeric
language sql
immutable
as $$
  select round(
    case when l.late_fee_type = 'percent'
         then l.rent_amount * l.late_fee_percent / 100
         else l.late_fee_amount end, 2);
$$;

-- A warning for every open, sent invoice whose last grace day is today
-- (or was yesterday, so one missed run still warns; the fee is still only
-- added by hand). Drafts are skipped: the tenant has not been billed yet.
-- Leases with no late fee are skipped: there is nothing to warn about.
-- The primary key makes it once per invoice, however often this runs.
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
  where i.status not in ('borrador', 'pagado', 'cancelado')
    and b.balance > 0
    and public.lease_late_fee(l) > 0
    and i.due_date + greatest(l.grace_days, 2) between today - 1 and today
  on conflict (invoice_id) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.queue_late_fee_warnings() from public, anon, authenticated;
grant execute on function public.queue_late_fee_warnings() to service_role;

-- Everything the email needs, for warnings not yet sent.
create or replace function public.late_fee_warnings_to_send()
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
  order by w.created_at;
$$;

revoke all on function public.late_fee_warnings_to_send() from public, anon, authenticated;
grant execute on function public.late_fee_warnings_to_send() to service_role;

-- ---------------------------------------------------------------- nightly
-- Invoices on the 1st, or any day the org has none for this month yet (so a
-- missed run heals itself). Every step is idempotent, so a second call
-- returns zeros.

create or replace function public.nightly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today   date := public.today_el_paso();
  period  date := date_trunc('month', public.today_el_paso())::date;
  org     record;
  made    int := 0;
  skipped int := 0;
  r       record;
  queued  int;
begin
  for org in select id from public.organizations where status = 'active' loop
    if extract(day from today) = 1
       or not exists (select 1 from public.invoices where org_id = org.id and period_month = period) then
      select * into r from public.generate_invoices_for_org(period, org.id);
      made := made + r.created;
      skipped := skipped + r.skipped;
    end if;
  end loop;

  queued := public.queue_late_fee_warnings();

  return jsonb_build_object(
    'today', today,
    'period', period,
    'invoices_created', made,
    'invoices_skipped', skipped,
    'warnings_queued', queued
  );
end;
$$;

revoke all on function public.nightly() from public, anon, authenticated;
grant execute on function public.nightly() to service_role;
