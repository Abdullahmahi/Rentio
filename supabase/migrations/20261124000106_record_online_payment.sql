-- record_online_payment: what the Stripe webhook calls on
-- payment_intent.succeeded. A CONFIRMED payment (money already moved), the
-- same allocation path confirm_payment and record_payment use
-- (apply_payment), an activity_log row, and idempotent on the PaymentIntent:
-- Stripe retries webhooks, and two deliveries must not record rent twice.
--
-- p_amount is the RENT portion only. A card convenience fee, when the
-- company charges one, rides in the PaymentIntent and in p_notes; it is
-- never allocated to invoices (it is not rent).
--
-- service_role only: no person, staff included, records online money by hand.

create or replace function public.record_online_payment(
  p_org             uuid,
  p_lease           uuid,
  p_amount          numeric,
  p_method          public.payment_method,
  p_payment_intent  text,
  p_charge          text default null,
  p_reference       text default null,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lease     public.leases%rowtype;
  existing  uuid;
  pay_id    uuid;
  result    jsonb;
begin
  if p_org is null or p_lease is null or coalesce(trim(p_payment_intent), '') = '' then
    raise exception 'Organization, lease and payment intent are required.' using errcode = '22023';
  end if;

  -- The lease must belong to the org the webhook mapped the Stripe account
  -- to; metadata from a PaymentIntent is never trusted on its own.
  -- The lock serialises money moves per lease, as confirm/record do.
  select * into lease
  from public.leases
  where id = p_lease and org_id = p_org
  for update;
  if not found then
    raise exception 'Lease not found.' using errcode = 'P0002';
  end if;

  select id into existing from public.payments where stripe_payment_intent_id = p_payment_intent;
  if found then
    return jsonb_build_object('payment_id', existing, 'duplicate', true);
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'The amount must be more than zero.' using errcode = '22023';
  end if;

  insert into public.payments
    (lease_id, org_id, amount, paid_at, method, reference, notes,
     status, reported_by_tenant, confirmed_at,
     stripe_payment_intent_id, stripe_charge_id)
  values (
    lease.id, lease.org_id, round(p_amount, 2), public.today_el_paso(),
    coalesce(p_method, 'card'), nullif(trim(p_reference), ''), nullif(trim(p_notes), ''),
    'confirmado', false, now(),
    trim(p_payment_intent), nullif(trim(p_charge), '')
  )
  returning id into pay_id;

  result := public.apply_payment(pay_id);

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (
    null, 'payment', pay_id, 'online_payment',
    jsonb_build_object('amount', round(p_amount, 2), 'method', p_method,
                       'payment_intent', trim(p_payment_intent),
                       'credit', (result ->> 'credit')::numeric),
    lease.org_id
  );

  return result || jsonb_build_object('payment_id', pay_id, 'duplicate', false);
end;
$$;

revoke all on function public.record_online_payment(uuid, uuid, numeric, public.payment_method, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_online_payment(uuid, uuid, numeric, public.payment_method, text, text, text, text)
  to service_role;
