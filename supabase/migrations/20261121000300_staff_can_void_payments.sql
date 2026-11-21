-- Owner rule (2026-11-21, issue #50): admin and staff of a company see and
-- do everything; no admin-only locks. Any staff member (admin, manager, a
-- super_admin acting in the company) may void a confirmed payment of their
-- OWN company. The org check, the required reason, the audit-log row and
-- "never deletes the payment" stay exactly as they were. Re-runnable.
--
-- (Cancelling an invoice was already allowed for staff by RLS:
-- invoices_staff_update; only the UI hid it.)

drop policy if exists payments_staff_update on public.payments;
create policy payments_staff_update on public.payments
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

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
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can void payments.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a payment.' using errcode = '22023';
  end if;

  -- Two people voiding at once: the second waits, then sees 'cancelado'.
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
