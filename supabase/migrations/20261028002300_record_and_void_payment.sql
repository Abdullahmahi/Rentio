-- B-013 continued: "Record payment" and "Void" were several browser writes
-- each (payment, allocations, invoice statuses, activity log) with no
-- transaction, like confirm was. Now one function each, one transaction.
--
--   refresh_invoice_statuses(ids)    internal: paid / partial / sent from balances
--   apply_payment(payment, split)    internal: allocations + statuses; the one
--                                    allocator confirm and record share
--   confirm_payment(payment)         unchanged behaviour, now calls apply_payment
--   record_payment(...)              staff: a confirmed payment, allocated
--   void_payment(payment, reason)    admin: drop allocations, keep the row
--
-- Re-runnable: create or replace + idempotent grants.

-- ------------------------------------------------ invoice statuses (internal)
-- Keep invoice.status honest. Drafts stay drafts until someone sends them.
-- Same rule as the old refreshInvoiceStatuses in app.payments.index.tsx.

create or replace function public.refresh_invoice_statuses(p_invoices uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.invoices i
  set status = case
        when b.paid >= b.total - 0.005 then 'pagado'::invoice_status
        when b.paid > 0 then 'pagado_parcial'::invoice_status
        else 'enviado'::invoice_status
      end
  from public.invoice_balances b
  where b.invoice_id = i.id
    and i.id = any (p_invoices)
    and i.status not in ('cancelado', 'borrador');
$$;

revoke all on function public.refresh_invoice_statuses(uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_invoice_statuses(uuid[]) to service_role;

-- ------------------------------------------------------ allocation (internal)
-- The caller has checked who is asking and holds the payment and lease
-- locks. p_allocations null: oldest due date first, drafts count, cancelled
-- invoices never (allocateOldestFirst in src/lib/invoicing.ts). Otherwise
-- the split the person typed, [{invoice_id, amount}], checked here: each
-- invoice on the payment's lease, not cancelled, no more than its balance,
-- and no more than the payment in total. What is left over is credit.

create or replace function public.apply_payment(p_payment uuid, p_allocations jsonb default null)
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
  bal        numeric(12,2);
  touched    uuid[] := '{}';
begin
  select * into pay from public.payments where id = p_payment;
  remaining := pay.amount;

  if p_allocations is null then
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
  else
    if jsonb_typeof(p_allocations) <> 'array' then
      raise exception 'Allocations must be a list.' using errcode = '22023';
    end if;
    for inv in
      select x.invoice_id, round(x.amount, 2) as amount
      from jsonb_to_recordset(p_allocations) as x (invoice_id uuid, amount numeric)
    loop
      continue when coalesce(inv.amount, 0) = 0;
      if inv.amount < 0 then
        raise exception 'An allocation cannot be negative.' using errcode = '22023';
      end if;
      select b.balance into bal
      from public.invoice_balances b
      join public.invoices i on i.id = b.invoice_id
      where i.id = inv.invoice_id
        and i.lease_id = pay.lease_id
        and i.status <> 'cancelado';
      if not found then
        raise exception 'That invoice is not open on this lease.' using errcode = 'P0001';
      end if;
      if inv.amount > bal + 0.005 then
        raise exception 'An allocation is more than the invoice balance.' using errcode = 'P0001';
      end if;
      if inv.amount > remaining + 0.005 then
        raise exception 'The allocations add up to more than the payment.' using errcode = 'P0001';
      end if;
      insert into public.payment_allocations (payment_id, invoice_id, amount, org_id)
      values (pay.id, inv.invoice_id, inv.amount, pay.org_id);
      remaining := remaining - inv.amount;
      touched := touched || inv.invoice_id;
    end loop;
  end if;

  perform public.refresh_invoice_statuses(touched);

  return jsonb_build_object(
    'allocations', cardinality(touched),
    'applied', pay.amount - remaining,
    'credit', remaining
  );
end;
$$;

revoke all on function public.apply_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment(uuid, jsonb) to service_role;

-- ---------------------------------------------------------- confirm_payment
-- Same checks, locks, result and activity as 20261028002100; the allocation
-- now lives in apply_payment.

create or replace function public.confirm_payment(p_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay     public.payments%rowtype;
  result  jsonb;
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

  result := public.apply_payment(pay.id);

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (
    public.current_user_id(), 'payment', pay.id, 'confirm',
    jsonb_build_object('amount', pay.amount, 'allocations', (result ->> 'allocations')::int),
    pay.org_id
  );

  return result;
end;
$$;

revoke all on function public.confirm_payment(uuid) from public, anon;
grant execute on function public.confirm_payment(uuid) to authenticated, service_role;

-- ----------------------------------------------------------- record_payment
-- The "Record payment" dialog: staff take money in person, so it is
-- confirmed on the spot. p_receipt_url is a path the app already uploaded.
-- Returns apply_payment's counts plus the new payment's id.

create or replace function public.record_payment(
  p_lease       uuid,
  p_amount      numeric,
  p_paid_at     date,
  p_method      public.payment_method,
  p_reference   text default null,
  p_notes       text default null,
  p_receipt_url text default null,
  p_allocations jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lease   public.leases%rowtype;
  pay_id  uuid;
  result  jsonb;
begin
  -- Same rule as confirm_payment.
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can record payments.' using errcode = '42501';
  end if;

  -- Serialise money moves per lease, as confirm_payment does.
  select * into lease
  from public.leases
  where id = p_lease and org_id = public.current_org_id()
  for update;

  if not found then
    raise exception 'Lease not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'The amount must be more than zero.' using errcode = '22023';
  end if;

  insert into public.payments
    (lease_id, org_id, amount, paid_at, method, reference, notes, receipt_url,
     status, recorded_by, confirmed_by, confirmed_at)
  values (
    lease.id, lease.org_id, p_amount, coalesce(p_paid_at, public.today_el_paso()),
    coalesce(p_method, 'ach'), nullif(trim(p_reference), ''), nullif(trim(p_notes), ''),
    nullif(p_receipt_url, ''),
    'confirmado', public.current_user_id(), public.current_user_id(), now()
  )
  returning id into pay_id;

  result := public.apply_payment(pay_id, p_allocations);

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (
    public.current_user_id(), 'payment', pay_id, 'create',
    jsonb_build_object('amount', round(p_amount, 2), 'credit', (result ->> 'credit')::numeric),
    lease.org_id
  );

  return result || jsonb_build_object('payment_id', pay_id);
end;
$$;

revoke all on function public.record_payment(uuid, numeric, date, public.payment_method, text, text, text, jsonb) from public, anon;
grant execute on function public.record_payment(uuid, numeric, date, public.payment_method, text, text, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------- void_payment
-- Never deletes the payment (TRD §8.5): drops its allocations, marks it
-- cancelado with the reason, restores the invoice statuses. Admin only, the
-- same rule as payments_staff_update's with check (managers cannot void).
-- There is no un-void here (security.md S-006).

create or replace function public.void_payment(p_payment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay      public.payments%rowtype;
  touched  uuid[];
begin
  if not public.is_admin() or public.current_org_id() is null then
    raise exception 'Only an admin can void payments.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a payment.' using errcode = '22023';
  end if;

  -- Two admins voiding at once: the second waits, then sees 'cancelado'.
  select * into pay
  from public.payments
  where id = p_payment and org_id = public.current_org_id()
  for update;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if pay.status = 'cancelado' then
    raise exception 'This payment is already voided.' using errcode = 'P0001';
  end if;
  if pay.status <> 'confirmado' then
    raise exception 'Only a confirmed payment can be voided.' using errcode = 'P0001';
  end if;

  perform 1 from public.leases where id = pay.lease_id for update;

  with gone as (
    delete from public.payment_allocations where payment_id = pay.id returning invoice_id
  )
  select coalesce(array_agg(invoice_id), '{}') into touched from gone;

  update public.payments
  set status = 'cancelado',
      void_reason = trim(p_reason)
  where id = pay.id;

  perform public.refresh_invoice_statuses(touched);

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (
    public.current_user_id(), 'payment', pay.id, 'void',
    jsonb_build_object('reason', trim(p_reason), 'amount', pay.amount),
    pay.org_id
  );

  return jsonb_build_object('allocations', cardinality(touched), 'amount', pay.amount);
end;
$$;

revoke all on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated, service_role;
