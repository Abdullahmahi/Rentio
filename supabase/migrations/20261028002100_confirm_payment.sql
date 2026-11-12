-- B-013: confirming a payment was four browser writes with no transaction
-- (status, allocations, invoice statuses, activity log). A failed insert or a
-- not-yet-loaded invoice list left a payment confirmed with no allocations;
-- two staff confirming at once double-allocated it.
--
-- One function, one transaction. Same allocation as allocateOldestFirst in
-- src/lib/invoicing.ts (oldest due date first, drafts count, cancelled
-- invoices never), same status rule as the old refreshInvoiceStatuses.
-- Re-runnable: create or replace + idempotent grants.

create or replace function public.confirm_payment(p_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay        public.payments%rowtype;
  remaining  numeric(12,2);
  applied    numeric(12,2);
  inv        record;
  touched    uuid[] := '{}';
begin
  -- Same rule as payments_staff_update: any staff member of the payment's
  -- org (admin, manager, super_admin acting in that org). The platform view
  -- (no org in the JWT) writes nothing.
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can confirm payments.' using errcode = '42501';
  end if;

  -- The row lock serialises two people pressing Confirm at once: the second
  -- waits, then sees 'confirmado' below.
  select * into pay
  from public.payments
  where id = p_payment and org_id = public.current_org_id()
  for update;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if pay.status = 'confirmado' then
    raise exception 'This payment is already confirmed.' using errcode = 'P0001';
  end if;
  if pay.status <> 'pendiente' then
    raise exception 'Only a pending payment can be confirmed.' using errcode = 'P0001';
  end if;

  -- Two different payments on one lease must not both see the same open
  -- balance: serialise money moves per lease.
  perform 1 from public.leases where id = pay.lease_id for update;

  update public.payments
  set status = 'confirmado',
      confirmed_by = public.current_user_id(),
      confirmed_at = now()
  where id = pay.id;

  remaining := pay.amount;
  for inv in
    select b.invoice_id, b.balance
    from public.invoice_balances b
    join public.invoices i on i.id = b.invoice_id
    where i.lease_id = pay.lease_id
      and i.status <> 'cancelado'
      and b.balance > 0
    order by i.due_date, i.created_at, i.id
  loop
    exit when remaining <= 0;
    applied := least(remaining, inv.balance);
    insert into public.payment_allocations (payment_id, invoice_id, amount, org_id)
    values (pay.id, inv.invoice_id, applied, pay.org_id);
    remaining := remaining - applied;
    touched := touched || inv.invoice_id;
  end loop;

  -- Keep invoice.status honest. Drafts stay drafts until someone sends them.
  update public.invoices i
  set status = case
        when b.paid >= b.total - 0.005 then 'pagado'::invoice_status
        when b.paid > 0 then 'pagado_parcial'::invoice_status
        else 'enviado'::invoice_status
      end
  from public.invoice_balances b
  where b.invoice_id = i.id
    and i.id = any (touched)
    and i.status not in ('cancelado', 'borrador');

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (
    public.current_user_id(), 'payment', pay.id, 'confirm',
    jsonb_build_object('amount', pay.amount, 'allocations', cardinality(touched)),
    pay.org_id
  );

  return jsonb_build_object(
    'allocations', cardinality(touched),
    'applied', pay.amount - remaining,
    'credit', remaining
  );
end;
$$;

revoke all on function public.confirm_payment(uuid) from public, anon;
grant execute on function public.confirm_payment(uuid) to authenticated, service_role;
