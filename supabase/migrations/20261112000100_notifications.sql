-- Tenants never heard back (audit-product-2026-10-28.md §2.1 #8): no
-- "payment confirmed", no "payment rejected, and why", no repair update, no
-- rent reminder. This is the outbox. Triggers queue one row per tenant party
-- (guarantors excluded); the server drains it, emailing in the tenant's
-- language or, with no address, leaving the row for the portal
-- (channel = 'portal'). Idempotent through dedupe_key.
--
--   queue_notification(lease, kind, entity, salt, payload)  internal
--   queue_rent_reminders()        nightly: open invoices due within 3 days
--   claim_notifications(limit)    server: mark sent, return what to email
--   notification_result(id, ch)   server: 'email' | 'portal' | null = release

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  lease_id    uuid references public.leases (id) on delete cascade,
  kind        text not null check (kind in (
                'payment_confirmed', 'payment_rejected',
                'work_order_status', 'work_order_note', 'rent_reminder')),
  entity_id   uuid,
  dedupe_key  text not null unique,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  channel     text check (channel in ('email', 'portal')),
  read_at     timestamptz
);
create index notifications_pending_idx on public.notifications (created_at) where sent_at is null;
create index notifications_tenant_idx  on public.notifications (tenant_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Tenants read their own, staff their company's. Only the triggers below
-- and the server write rows; a tenant may mark their own as read.
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    public.is_staff()
    or tenant_id in (select p.tenant_id from public.profiles p where p.id = public.current_user_id())
  );
create policy notifications_tenant_read on public.notifications
  for update to authenticated
  using (tenant_id in (select p.tenant_id from public.profiles p where p.id = public.current_user_id()))
  with check (tenant_id in (select p.tenant_id from public.profiles p where p.id = public.current_user_id()));

do $$
declare
  mine constant text := 'org_id = (select public.current_org_id())';
  platform constant text :=
    '((select public.is_super_admin()) and (select public.current_org_id()) is null)';
begin
  execute format('create policy org_isolation_select on public.notifications as restrictive for select to authenticated using (%s or %s)', mine, platform);
  execute format('create policy org_isolation_update on public.notifications as restrictive for update to authenticated using (%s) with check (%s)', mine, mine);
end;
$$;

-- ----------------------------------------------------------- queue (internal)

create or replace function public.queue_notification(
  p_lease uuid, p_kind text, p_entity uuid, p_salt text, p_payload jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into public.notifications (org_id, tenant_id, lease_id, kind, entity_id, dedupe_key, payload)
  select l.org_id, lt.tenant_id, l.id, p_kind, p_entity,
         p_kind || ':' || p_entity || ':' || lt.tenant_id || ':' || coalesce(p_salt, ''),
         coalesce(p_payload, '{}'::jsonb)
  from public.leases l
  join public.lease_tenants lt on lt.lease_id = l.id and lt.role <> 'guarantor'
  where l.id = p_lease
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.queue_notification(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.queue_notification(uuid, text, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------- triggers

-- A tenant-reported payment confirmed or refused (the reason rides along).
create or replace function public.notify_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reported_by_tenant
     and new.status is distinct from old.status
     and new.status in ('confirmado', 'cancelado') then
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

drop trigger if exists payments_notify_tenant on public.payments;
create trigger payments_notify_tenant
  after update on public.payments
  for each row execute function public.notify_payment_change();

-- A repair request moved. Property Meld's finding: updates along the way
-- matter more to tenants than how fast the fix was.
create or replace function public.notify_work_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lease_id is not null and new.status is distinct from old.status then
    perform public.queue_notification(
      new.lease_id, 'work_order_status', new.id, new.status::text,
      jsonb_build_object('title', new.title, 'status', new.status));
  end if;
  return null;
end;
$$;

drop trigger if exists work_orders_notify_tenant on public.work_orders;
create trigger work_orders_notify_tenant
  after update on public.work_orders
  for each row execute function public.notify_work_order_status();

-- A note staff marked "visible to tenant".
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
  if wo.lease_id is not null then
    perform public.queue_notification(
      wo.lease_id, 'work_order_note', new.id, '',
      jsonb_build_object('title', wo.title, 'body', left(new.body, 500)));
  end if;
  return null;
end;
$$;

drop trigger if exists work_order_notes_notify_tenant on public.work_order_notes;
create trigger work_order_notes_notify_tenant
  after insert on public.work_order_notes
  for each row execute function public.notify_work_order_note();

-- ------------------------------------------------------------ rent reminders
-- Open, sent invoices due within three days; once per invoice and tenant.
-- ponytail: 3-day window hard-coded, make it a setting when a client asks.

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
    where i.status in ('enviado', 'pagado_parcial')
      and b.balance > 0
      and i.due_date between today and today + 3
  loop
    queued := queued + public.queue_notification(
      r.lease_id, 'rent_reminder', r.id, '',
      jsonb_build_object('period_month', r.period_month, 'due_date', r.due_date, 'balance', r.balance));
  end loop;
  return queued;
end;
$$;

revoke all on function public.queue_rent_reminders() from public, anon, authenticated;
grant execute on function public.queue_rent_reminders() to service_role;

-- ------------------------------------------------------------------ drain
-- Claim first (sent_at = now), so two overlapping runs never email twice.
-- A failed send releases the row with notification_result(id, null).

create or replace function public.claim_notifications(p_limit int default 100)
returns table (
  id           uuid,
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
  select c.id, c.kind, c.payload, t.full_name, nullif(trim(t.email), ''),
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

create or replace function public.notification_result(p_id uuid, p_channel text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set channel = p_channel,
      sent_at = case when p_channel is null then null else sent_at end
  where id = p_id;
$$;

revoke all on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
revoke all on function public.notification_result(uuid, text) from public, anon, authenticated;
grant execute on function public.notification_result(uuid, text) to service_role;
