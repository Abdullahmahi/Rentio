-- Rentio — money and lease lifecycle in SQL (execution.md A1, A3, A4; B-013).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lifecycle_test.sql
--
-- Seeded database, one transaction, rolled back. Dates are relative to
-- today_el_paso(), so it passes on any day.

begin;

create or replace function pg_temp.check(label text, condition boolean) returns void
language plpgsql as $$
begin
  if condition then raise notice 'ok   %', label;
  else raise exception 'FAIL %', label;
  end if;
end;
$$;

do $$
declare
  org uuid := (select id from public.organizations order by created_at limit 1);
  today date := public.today_el_paso();
  nxt date := (date_trunc('month', public.today_el_paso()) + interval '1 month')::date;
  prop uuid; u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  l_running uuid; l_holdover uuid; l_ended uuid; l_renewal uuid; l_ending uuid;
  admin_id uuid := '00000000-0000-0000-0000-0000000000e1';
  r record; n int; j jsonb;
  inv_old uuid; inv_new uuid; inv_paid uuid; inv_due_today uuid; inv_due_tomorrow uuid; pay uuid;
  inv_draft uuid; pay2 uuid;
begin
  -- ------------------------------------------------------------ fixtures
  -- Written as the owner with no caller identity, like the service connection.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.org_id', '', true);
  insert into public.properties (org_id, name) values (org, 'Lifecycle Test') returning id into prop;
  insert into public.units (property_id, unit_number) values (prop, 'LC1') returning id into u1;
  insert into public.units (property_id, unit_number) values (prop, 'LC2') returning id into u2;
  insert into public.units (property_id, unit_number) values (prop, 'LC3') returning id into u3;
  insert into public.units (property_id, unit_number) values (prop, 'LC4') returning id into u4;
  insert into public.units (property_id, unit_number) values (prop, 'LC5') returning id into u5;

  -- runs through next month, due on the 31st (clamps to month end), with parking
  insert into public.leases (unit_id, start_date, end_date, rent_amount, rent_due_day, status, late_fee_type, late_fee_amount)
    values (u1, today - 200, today + 200, 1000, 31, 'activo', 'fixed', 50) returning id into l_running;
  insert into public.parking_spaces (property_id, label, monthly_fee, lease_id) values (prop, 'LC-P1', 35.50, l_running);
  -- D1 holdover: past its end date, still active, keeps billing
  insert into public.leases (unit_id, start_date, end_date, rent_amount, status)
    values (u2, today - 400, today - 10, 900, 'activo') returning id into l_holdover;
  -- ended by a person: never billed
  insert into public.leases (unit_id, start_date, end_date, rent_amount, status)
    values (u3, today - 400, today - 10, 800, 'terminado') returning id into l_ended;
  -- renewal that starts the month after next: not billed for next month
  insert into public.leases (unit_id, start_date, end_date, rent_amount, status)
    values (u4, (nxt + interval '1 month')::date, (nxt + interval '13 months')::date, 700, 'activo') returning id into l_renewal;
  -- ends later this month (not yet a holdover): not billed for next month
  insert into public.leases (unit_id, start_date, end_date, rent_amount, status)
    values (u5, today - 300, greatest(today, (nxt - 1)), 600, 'activo') returning id into l_ending;

  insert into public.profiles (id, full_name, role, org_id) values (admin_id, 'LC Admin', 'admin', org);

  -- ------------------------------------------------- A3 generate_invoices
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.org_id', org::text, true);

  select * into r from public.generate_invoices(nxt);
  perform pg_temp.check('generate creates invoices', r.created > 0);
  perform pg_temp.check('running lease billed',
    exists (select 1 from public.invoices where lease_id = l_running and period_month = nxt));
  perform pg_temp.check('holdover lease billed (D1)',
    exists (select 1 from public.invoices where lease_id = l_holdover and period_month = nxt));
  perform pg_temp.check('ended lease not billed',
    not exists (select 1 from public.invoices where lease_id = l_ended));
  perform pg_temp.check('future renewal not billed',
    not exists (select 1 from public.invoices where lease_id = l_renewal));
  perform pg_temp.check('lease ending this month not billed next month',
    not exists (select 1 from public.invoices where lease_id = l_ending and period_month = nxt));
  perform pg_temp.check('invoices are drafts with a number',
    not exists (select 1 from public.invoices where period_month = nxt and lease_id in (l_running, l_holdover)
                and (status <> 'borrador' or invoice_number is null)));
  perform pg_temp.check('total equals the sum of lines', not exists (
    select 1 from public.invoices i where i.period_month = nxt
      and i.total <> (select sum(amount * quantity) from public.invoice_lines where invoice_id = i.id)));
  perform pg_temp.check('rent + parking lines',
    (select total from public.invoices where lease_id = l_running and period_month = nxt) = 1035.50
    and (select count(*) from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
         where i.lease_id = l_running and i.period_month = nxt) = 2);
  perform pg_temp.check('due day 31 clamps to month end',
    (select due_date from public.invoices where lease_id = l_running and period_month = nxt)
      = (nxt + interval '1 month - 1 day')::date);

  select * into r from public.generate_invoices(nxt);
  perform pg_temp.check('second generate creates nothing', r.created = 0 and r.skipped > 0);

  -- platform view (no org in the JWT) is refused
  perform set_config('request.jwt.claim.org_id', '', true);
  begin
    perform public.generate_invoices(nxt);
    perform pg_temp.check('generate without an org is refused', false);
  exception when insufficient_privilege then
    perform pg_temp.check('generate without an org is refused', true);
  end;
  perform set_config('request.jwt.claim.org_id', org::text, true);

  -- ------------------------------------- B-013 parity with allocateOldestFirst
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.org_id', '', true);
  insert into public.invoices (lease_id, period_month, due_date, status, total)
    values (l_holdover, date_trunc('month', today - 60), today - 60, 'enviado', 900) returning id into inv_old;
  insert into public.invoices (lease_id, period_month, due_date, status, total)
    values (l_holdover, date_trunc('month', today - 30), today - 30, 'enviado', 900) returning id into inv_new;
  insert into public.payments (lease_id, amount, status) values (l_holdover, 1350, 'pendiente') returning id into pay;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.org_id', org::text, true);
  j := public.confirm_payment(pay);
  perform pg_temp.check('oldest invoice paid in full',
    (select amount from public.payment_allocations where payment_id = pay and invoice_id = inv_old) = 900
    and (select status from public.invoices where id = inv_old) = 'pagado');
  perform pg_temp.check('remainder on the next one, partial',
    (select amount from public.payment_allocations where payment_id = pay and invoice_id = inv_new) = 450
    and (select status from public.invoices where id = inv_new) = 'pagado_parcial');
  perform pg_temp.check('the draft for next month is untouched',
    not exists (select 1 from public.payment_allocations pa join public.invoices i on i.id = pa.invoice_id
                where pa.payment_id = pay and i.period_month = nxt));
  perform pg_temp.check('confirm returns its counts',
    (j ->> 'allocations')::int = 2 and (j ->> 'credit')::numeric = 0);

  -- ------------------------------------ record_payment / void_payment
  -- After the confirm above: inv_old paid, inv_new owes 450, next month's
  -- draft owes 900. Recording 600 pays inv_new off and puts 150 on the draft.
  select id into inv_draft from public.invoices where lease_id = l_holdover and period_month = nxt;
  j := public.record_payment(l_holdover, 600, today, 'zelle', ' R-1 ', null, null, null);
  pay2 := (j ->> 'payment_id')::uuid;
  perform pg_temp.check('record: payment is confirmed, recorded by the caller',
    (select status = 'confirmado' and recorded_by = admin_id and confirmed_by = admin_id
            and reference = 'R-1' from public.payments where id = pay2));
  perform pg_temp.check('record: oldest open invoice paid off',
    (select balance from public.invoice_balances where invoice_id = inv_new) = 0
    and (select status from public.invoices where id = inv_new) = 'pagado');
  perform pg_temp.check('record: rest on the draft, which stays a draft',
    (select balance from public.invoice_balances where invoice_id = inv_draft) = 750
    and (select status from public.invoices where id = inv_draft) = 'borrador');
  perform pg_temp.check('record: returns its counts',
    (j ->> 'allocations')::int = 2 and (j ->> 'applied')::numeric = 600 and (j ->> 'credit')::numeric = 0);
  perform pg_temp.check('record: writes activity_log', exists (
    select 1 from public.activity_log where entity_id = pay2 and action = 'create'
      and (meta ->> 'amount')::numeric = 600));

  -- a typed split: 100 on the draft only, 50 left as credit
  j := public.record_payment(l_holdover, 150, today, 'cash', null, null, null,
         jsonb_build_array(jsonb_build_object('invoice_id', inv_draft, 'amount', 100)));
  perform pg_temp.check('record: typed split honoured, rest is credit',
    (j ->> 'allocations')::int = 1 and (j ->> 'credit')::numeric = 50
    and (select balance from public.invoice_balances where invoice_id = inv_draft) = 650);
  begin
    perform public.record_payment(l_holdover, 100, today, 'cash', null, null, null,
      jsonb_build_array(jsonb_build_object('invoice_id', inv_draft, 'amount', 200)));
    perform pg_temp.check('record: split above the payment is refused', false);
  exception when raise_exception then
    perform pg_temp.check('record: split above the payment is refused', true);
  end;
  begin
    perform public.record_payment(l_holdover, 100, today, 'cash', null, null, null,
      jsonb_build_array(jsonb_build_object('invoice_id', inv_due_today, 'amount', 50)));
    perform pg_temp.check('record: split onto another lease is refused', false);
  exception when raise_exception then
    perform pg_temp.check('record: split onto another lease is refused', true);
  end;

  -- voiding the 600 puts both balances back (the draft keeps the typed 100)
  j := public.void_payment(pay2, '  bounced  ');
  perform pg_temp.check('void: balances restored',
    (select balance from public.invoice_balances where invoice_id = inv_new) = 450
    and (select balance from public.invoice_balances where invoice_id = inv_draft) = 800);
  perform pg_temp.check('void: statuses restored',
    (select status from public.invoices where id = inv_new) = 'pagado_parcial'
    and (select status from public.invoices where id = inv_draft) = 'borrador');
  perform pg_temp.check('void: row kept, cancelled with the reason, no allocations',
    (select status = 'cancelado' and void_reason = 'bounced' from public.payments where id = pay2)
    and not exists (select 1 from public.payment_allocations where payment_id = pay2));
  perform pg_temp.check('void: writes activity_log', exists (
    select 1 from public.activity_log where entity_id = pay2 and action = 'void'
      and meta ->> 'reason' = 'bounced' and (meta ->> 'amount')::numeric = 600));
  begin
    perform public.void_payment(pay2, 'again');
    perform pg_temp.check('void: a second void is refused', false);
  exception when raise_exception then
    perform pg_temp.check('void: a second void is refused',
      sqlerrm = 'This payment is already voided.');
  end;
  begin
    perform public.void_payment(pay, '   ');
    perform pg_temp.check('void: a blank reason is refused', false);
  exception when invalid_parameter_value then
    perform pg_temp.check('void: a blank reason is refused', true);
  end;

  -- ---------------------------------------------- A4 late-fee warnings
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.org_id', '', true);
  -- l_running: grace 5 (default), fixed $50 fee. Last grace day = due + 5.
  insert into public.invoices (lease_id, period_month, due_date, status, total)
    values (l_running, '2000-01-01', today - 5, 'enviado', 1000) returning id into inv_due_today;
  insert into public.invoices (lease_id, period_month, due_date, status, total)
    values (l_running, '2000-02-01', today - 4, 'enviado', 1000) returning id into inv_due_tomorrow;
  insert into public.invoices (lease_id, period_month, due_date, status, total)
    values (l_running, '2000-03-01', today - 5, 'pagado', 0) returning id into inv_paid;

  n := public.queue_late_fee_warnings();
  perform pg_temp.check('warning queued on the last grace day',
    exists (select 1 from public.late_fee_warnings where invoice_id = inv_due_today
            and eligible_on = today + 1 and sent_at is null));
  perform pg_temp.check('no warning the day before the last grace day',
    not exists (select 1 from public.late_fee_warnings where invoice_id = inv_due_tomorrow));
  perform pg_temp.check('no warning on a paid invoice',
    not exists (select 1 from public.late_fee_warnings where invoice_id = inv_paid));
  perform pg_temp.check('no warning for a lease with no late fee',
    not exists (select 1 from public.late_fee_warnings w join public.invoices i on i.id = w.invoice_id
                where i.lease_id = l_holdover));
  perform pg_temp.check('re-running queues nothing', public.queue_late_fee_warnings() = 0);
  perform pg_temp.check('fee and balance reach the sender',
    (select fee from public.late_fee_warnings_to_send() where invoice_id = inv_due_today) = 50
    and (select balance from public.late_fee_warnings_to_send() where invoice_id = inv_due_today) = 1000);
  perform pg_temp.check('no late fee line was added (D3)',
    not exists (select 1 from public.invoice_lines where invoice_id = inv_due_today and category = 'recargo'));

  -- ------------------------------------------------------- A1 nightly()
  perform public.nightly();
  j := public.nightly();
  perform pg_temp.check('second nightly() changes nothing',
    (j ->> 'invoices_created')::int = 0 and (j ->> 'warnings_queued')::int = 0);

  raise notice '--- all lifecycle assertions passed ---';
end;
$$;

rollback;
