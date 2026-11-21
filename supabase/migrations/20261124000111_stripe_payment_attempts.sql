-- Pay now hardening (security review on PR #71).
--
--   stripe_payment_attempts   every PaymentIntent we create, with the
--                             connected account it was created ON, so a
--                             webhook for it maps to the right org even after
--                             the company disconnects or reconnects; and at
--                             most one OPEN attempt per tenant + lease +
--                             invoice set (no second PaymentIntent, no double charge).
--   void_payment_internal     the body of void_payment, shared with:
--   reverse_online_payment    the webhook's refund / dispute / ACH-return
--                             path: void the recorded payment so the invoice
--                             balance reopens. Idempotent.
--
-- Server only (service connection) for writes; staff read their company's
-- attempts.

-- ---------------------------------------------------- stripe_payment_attempts
create table public.stripe_payment_attempts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  lease_id           uuid not null references public.leases (id) on delete cascade,
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  -- sorted, comma-joined invoice ids: "the invoice set"
  invoice_key        text not null,
  stripe_account_id  text not null,
  payment_intent_id  text unique,
  method             text not null check (method in ('card', 'ach')),
  amount_cents       integer not null check (amount_cents > 0),
  autopay            boolean not null default false,
  -- 'creating' until Stripe answers, then the PaymentIntent's own status.
  status             text not null default 'creating'
                     check (status in ('creating', 'requires_payment_method', 'requires_confirmation',
                                       'requires_action', 'processing', 'succeeded', 'canceled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

create unique index stripe_payment_attempts_one_open
  on public.stripe_payment_attempts (org_id, tenant_id, lease_id, invoice_key)
  where status not in ('succeeded', 'canceled');
create index stripe_payment_attempts_lease_open
  on public.stripe_payment_attempts (lease_id)
  where status not in ('succeeded', 'canceled');

create trigger stripe_payment_attempts_set_updated_at
  before update on public.stripe_payment_attempts
  for each row execute function public.set_updated_at();

alter table public.stripe_payment_attempts enable row level security;
revoke all on public.stripe_payment_attempts from anon, authenticated;
grant select on public.stripe_payment_attempts to authenticated;

create policy stripe_payment_attempts_staff_select on public.stripe_payment_attempts
  for select to authenticated using (public.is_staff());
create policy org_isolation on public.stripe_payment_attempts as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));

-- ------------------------------------------------------- void, shared body
-- Caller has decided who may void. Locks the payment and its lease, drops
-- the allocations, keeps the row as 'cancelado', refreshes invoice statuses
-- (the balance reopens) and logs. p_actor null = the system (Stripe).

create or replace function public.void_payment_internal(
  p_payment uuid,
  p_reason  text,
  p_actor   uuid,
  p_meta    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay      public.payments%rowtype;
  touched  uuid[];
begin
  select * into pay from public.payments where id = p_payment for update;
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
    p_actor, 'payment', pay.id, 'void',
    jsonb_build_object('reason', trim(p_reason), 'amount', pay.amount) || coalesce(p_meta, '{}'::jsonb),
    pay.org_id
  );

  return jsonb_build_object('allocations', cardinality(touched), 'amount', pay.amount);
end;
$$;

revoke all on function public.void_payment_internal(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.void_payment_internal(uuid, text, uuid, jsonb) to service_role;

-- Same checks and behaviour as before; the body now lives above.
create or replace function public.void_payment(p_payment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() or public.current_org_id() is null then
    raise exception 'Only an admin can void payments.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a payment.' using errcode = '22023';
  end if;
  perform 1 from public.payments where id = p_payment and org_id = public.current_org_id();
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  return public.void_payment_internal(p_payment, p_reason, public.current_user_id());
end;
$$;

revoke all on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated, service_role;

-- ------------------------------------------------- webhook reversal (Stripe)
-- Refund, dispute or ACH return on a PaymentIntent we booked. Only within
-- p_org (the org the webhook mapped the event to). Returns
--   {voided: true, payment_id, amount, ...}   the payment was voided now
--   {voided: false, reason: 'not_recorded'}   nothing booked for this intent
--   {voided: false, reason: 'already_voided', payment_id}
create or replace function public.reverse_online_payment(
  p_org             uuid,
  p_payment_intent  text,
  p_reason          text,
  p_event           text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments%rowtype;
begin
  select * into pay
  from public.payments
  where stripe_payment_intent_id = p_payment_intent and org_id = p_org
  for update;
  if not found then
    return jsonb_build_object('voided', false, 'reason', 'not_recorded');
  end if;
  if pay.status = 'cancelado' then
    return jsonb_build_object('voided', false, 'reason', 'already_voided', 'payment_id', pay.id);
  end if;
  return public.void_payment_internal(pay.id, p_reason, null,
           jsonb_build_object('source', 'stripe', 'stripe_event', p_event,
                              'payment_intent', p_payment_intent))
         || jsonb_build_object('voided', true, 'payment_id', pay.id);
end;
$$;

revoke all on function public.reverse_online_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reverse_online_payment(uuid, text, text, text) to service_role;
