-- Autopay (issue #10), the run side.
--
--   autopay_runs       one row per invoice autopay ever attempted: the
--                      PaymentIntent it created, or why it failed. Visible to
--                      the company's staff and to the tenant it concerns. The
--                      success itself is booked by the Stripe webhook
--                      (record_online_payment), not here.
--   autopay_due(org)   what runAutopay (src/lib/server/autopay.ts) charges:
--                      sent invoices due TODAY (El Paso) with a balance, on
--                      leases with an enabled enrollment, never attempted.
--
-- One attempt per invoice. A failed charge is not retried by machine: the
-- tenant sees why and pays by hand. (Retries would re-debit a bank account
-- that just bounced, with an NSF fee each time.)

create table public.autopay_runs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade
                     default public.current_org_id(),
  enrollment_id      uuid not null references public.autopay_enrollments (id) on delete cascade,
  invoice_id         uuid not null unique references public.invoices (id) on delete cascade,
  run_on             date not null default public.today_el_paso(),
  status             text not null check (status in ('created', 'failed')),
  payment_intent_id  text,
  error              text,
  created_at         timestamptz not null default now()
);
create index autopay_runs_org_idx on public.autopay_runs (org_id, created_at desc);

create trigger org_from_parent before insert or update on public.autopay_runs
  for each row execute function public.org_from_parent('invoices', 'invoice_id');

alter table public.autopay_runs enable row level security;
revoke all on public.autopay_runs from anon, authenticated;
grant select on public.autopay_runs to authenticated;

create policy autopay_runs_select on public.autopay_runs
  for select to authenticated
  using (
    public.is_staff()
    or enrollment_id in (select e.id from public.autopay_enrollments e where e.tenant_id = public.my_tenant_id())
  );
create policy org_isolation on public.autopay_runs as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));

-- ------------------------------------------------------------- autopay_due
create or replace function public.autopay_due(p_org uuid)
returns table (
  enrollment_id       uuid,
  invoice_id          uuid,
  lease_id            uuid,
  tenant_id           uuid,
  due_date            date,
  balance             numeric,
  stripe_customer_id  text,
  payment_method_id   text,
  method_type         text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, i.id, i.lease_id, e.tenant_id, i.due_date, b.balance,
         e.stripe_customer_id, e.payment_method_id, e.method_type
  from public.autopay_enrollments e
  join public.invoices i on i.lease_id = e.lease_id and i.org_id = e.org_id
  join public.invoice_balances b on b.invoice_id = i.id
  where e.org_id = p_org
    and e.enabled
    and i.status in ('enviado', 'pagado_parcial', 'vencido')
    and i.due_date = public.today_el_paso()
    and b.balance > 0
    and not exists (select 1 from public.autopay_runs r where r.invoice_id = i.id)
  order by i.due_date, i.id;
$$;

revoke all on function public.autopay_due(uuid) from public, anon, authenticated;
grant execute on function public.autopay_due(uuid) to service_role;
