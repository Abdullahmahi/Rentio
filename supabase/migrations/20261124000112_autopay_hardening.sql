-- Autopay hardening (security review on PR #72).
--
--   autopay_runs.status 'unknown'   Stripe timed out or errored and we cannot
--                                   tell whether it charged: staff check
--                                   Stripe; the tenant is NOT told to pay by
--                                   hand (the webhook books it if it went through).
--   autopay_due                     now also skips
--     * leases with a payment already moving: an open PaymentIntent from
--       Pay now (or autopay) that is processing, being confirmed, or was
--       started in the last day (stripe_payment_attempts);
--     * enrollments whose tenant is no longer on the lease, or whose lease
--       is no longer active.

alter table public.autopay_runs drop constraint if exists autopay_runs_status_check;
alter table public.autopay_runs add constraint autopay_runs_status_check
  check (status in ('created', 'failed', 'unknown'));

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
  join public.leases l on l.id = e.lease_id and l.org_id = e.org_id
  join public.invoices i on i.lease_id = e.lease_id and i.org_id = e.org_id
  join public.invoice_balances b on b.invoice_id = i.id
  where e.org_id = p_org
    and e.enabled
    and l.status in ('activo', 'por_vencer')
    -- the enrolled tenant is still on this lease
    and exists (select 1 from public.lease_tenants lt
                where lt.lease_id = e.lease_id and lt.tenant_id = e.tenant_id)
    and i.status in ('enviado', 'pagado_parcial', 'vencido')
    and i.due_date = public.today_el_paso()
    and b.balance > 0
    and not exists (select 1 from public.autopay_runs r where r.invoice_id = i.id)
    -- no payment already moving on this lease (ACH processing for days,
    -- a card being confirmed, a Pay now started today)
    and not exists (
      select 1 from public.stripe_payment_attempts a
      where a.lease_id = e.lease_id
        and (a.status in ('creating', 'requires_confirmation', 'requires_action', 'processing')
             or (a.status = 'requires_payment_method' and a.created_at > now() - interval '1 day'))
    )
  order by i.due_date, i.id;
$$;

revoke all on function public.autopay_due(uuid) from public, anon, authenticated;
grant execute on function public.autopay_due(uuid) to service_role;
