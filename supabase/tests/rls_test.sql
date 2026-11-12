-- Rentio — row level security assertions.
--
-- The UI hiding data is not the same as the database refusing it. This file
-- asserts the database refuses it. Run it against a seeded database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
--
-- It rolls everything back, so it is safe to run against a staging database.
-- Any failed assertion aborts with an error.

begin;

-- ----------------------------------------------------------------- actors

do $$
declare
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  manager_id uuid := '00000000-0000-0000-0000-0000000000a2';
  tenant_a   uuid := '00000000-0000-0000-0000-0000000000b1';
  tenant_b   uuid := '00000000-0000-0000-0000-0000000000b2';
  t_a uuid; t_b uuid;
begin
  -- two tenants who are on different leases
  select lt.tenant_id into t_a from public.lease_tenants lt where lt.role = 'primary' order by lt.created_at limit 1;
  select lt.tenant_id into t_b from public.lease_tenants lt where lt.role = 'primary' and lt.tenant_id <> t_a order by lt.created_at limit 1;

  -- Everything seeded belongs to the first organization.
  insert into public.profiles (id, full_name, role, tenant_id, org_id)
  select v.id, v.full_name, v.role::user_role, v.tenant_id,
         (select id from public.organizations order by created_at limit 1)
  from (values
    (admin_id,   'Admin Test',   'admin',   null::uuid),
    (manager_id, 'Manager Test', 'manager', null),
    (tenant_a,   'Tenant A',     'tenant',  t_a),
    (tenant_b,   'Tenant B',     'tenant',  t_b)
  ) as v (id, full_name, role, tenant_id)
  on conflict (id) do update
    set role = excluded.role, tenant_id = excluded.tenant_id, org_id = excluded.org_id;
end;
$$;

-- --------------------------------------------------------------- harness

create or replace function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  -- What the app server puts in the token: the profile's own org. Readable
  -- here because a profile may always read itself.
  perform set_config('request.jwt.claim.org_id',
    coalesce((select org_id::text from public.profiles where id = uid), ''), true);
end;
$$;

create or replace function pg_temp.check(label text, condition boolean) returns void
language plpgsql as $$
begin
  if condition then
    raise notice 'ok   %', label;
  else
    raise exception 'FAIL %', label;
  end if;
end;
$$;

-- ------------------------------------------------------------ assertions

do $$
declare
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  manager_id uuid := '00000000-0000-0000-0000-0000000000a2';
  tenant_a   uuid := '00000000-0000-0000-0000-0000000000b1';
  tenant_b   uuid := '00000000-0000-0000-0000-0000000000b2';
  lease_a uuid; lease_b uuid; wo_b uuid; pay_id uuid;
  n int;
begin
  select lt.lease_id into lease_a from public.lease_tenants lt join public.profiles p on p.tenant_id = lt.tenant_id where p.id = tenant_a limit 1;
  select lt.lease_id into lease_b from public.lease_tenants lt join public.profiles p on p.tenant_id = lt.tenant_id where p.id = tenant_b limit 1;
  perform pg_temp.check('fixture: two distinct leases', lease_a is not null and lease_b is not null and lease_a <> lease_b);

  -- =============================================== staff sees everything
  set local role authenticated;
  perform pg_temp.act_as(admin_id);

  select count(*) into n from public.leases;
  perform pg_temp.check('admin reads all leases', n >= 30);
  select count(*) into n from public.properties;
  perform pg_temp.check('admin reads properties', n = 3);

  -- A draft the nightly job would create; the tenant below must not see it.
  insert into public.invoices (lease_id, period_month, due_date, status)
  values (lease_a, date '2099-01-01', date '2099-01-01', 'borrador');

  -- ============================================ tenant is fenced to own lease
  perform pg_temp.act_as(tenant_a);

  select count(*) into n from public.leases;
  perform pg_temp.check('tenant sees only own lease(s)', n >= 1 and n <= 3);
  select count(*) into n from public.leases where id = lease_b;
  perform pg_temp.check('tenant cannot read another lease', n = 0);

  select count(*) into n from public.invoices where lease_id = lease_b;
  perform pg_temp.check('tenant cannot read another tenant invoices', n = 0);
  select count(*) into n from public.invoices where lease_id = lease_a;
  perform pg_temp.check('tenant CAN read own invoices', n >= 1);
  select count(*) into n from public.invoices where lease_id = lease_a and status = 'borrador';
  perform pg_temp.check('tenant cannot read own draft invoices', n = 0);

  select count(*) into n from public.invoice_lines il join public.invoices i on i.id = il.invoice_id where i.lease_id = lease_b;
  perform pg_temp.check('tenant cannot read another tenant invoice lines', n = 0);

  select count(*) into n from public.payments where lease_id = lease_b;
  perform pg_temp.check('tenant cannot read another tenant payments', n = 0);

  select count(*) into n from public.work_orders where lease_id = lease_b;
  perform pg_temp.check('tenant cannot read another tenant work orders', n = 0);

  select count(*) into n from public.tenants;
  perform pg_temp.check('tenant sees only own tenant row', n = 1);

  -- ======================================== staff-only tables are invisible
  select count(*) into n from public.properties;
  perform pg_temp.check('tenant cannot read properties', n = 0);
  select count(*) into n from public.units;
  perform pg_temp.check('tenant cannot read units', n = 0);
  select count(*) into n from public.utility_charges;
  perform pg_temp.check('tenant cannot read utility charges', n = 0);
  select count(*) into n from public.expenses;
  perform pg_temp.check('tenant cannot read expenses', n = 0);
  select count(*) into n from public.settings;
  perform pg_temp.check('tenant cannot read settings table', n = 0);
  select count(*) into n from public.activity_log;
  perform pg_temp.check('tenant cannot read activity log', n = 0);

  -- ...but CAN read the narrow payment-instructions view the portal needs
  select count(*) into n from public.public_settings where company_name is not null;
  perform pg_temp.check('tenant CAN read public_settings view', n = 1);

  -- ...and that view must NOT carry bank numbers. Publishing a routing and
  -- account number to every tenant is what prompt 16 removed; this is the
  -- assertion that stops it coming back.
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_settings'
    and column_name in ('clabe', 'bank_name', 'account_holder',
                        'routing_number', 'account_number');
  perform pg_temp.check('public_settings exposes no bank account numbers', n = 0);

  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'settings'
    and column_name in ('clabe', 'routing_number', 'account_number');
  perform pg_temp.check('settings stores no bank account numbers', n = 0);

  -- ...and their OWN unit number and address, but nobody else's
  select count(*) into n from public.my_lease_details where lease_id = lease_a;
  perform pg_temp.check('tenant CAN read own unit details', n = 1);
  select count(*) into n from public.my_lease_details where lease_id = lease_b;
  perform pg_temp.check('tenant cannot read another unit details', n = 0);
  select count(*) into n from public.my_lease_details;
  perform pg_temp.check('my_lease_details is scoped to own leases', n <= 3);

  -- ============================================ internal notes stay internal
  select count(*) into n from public.work_order_notes where is_internal = true;
  perform pg_temp.check('tenant cannot read ANY internal note', n = 0);
  select count(*) into n from public.work_order_notes;
  perform pg_temp.check('tenant only ever sees tenant-visible notes', n >= 0);

  -- =========================================== tenant write restrictions
  begin
    insert into public.payments (lease_id, amount, method, status, reported_by_tenant)
    values (lease_a, 100, 'ach', 'confirmado', true);
    perform pg_temp.check('tenant cannot self-confirm a payment', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check('tenant cannot self-confirm a payment', true);
  end;

  begin
    insert into public.payments (lease_id, amount, method, status, reported_by_tenant)
    values (lease_b, 100, 'ach', 'pendiente', true);
    perform pg_temp.check('tenant cannot report against another lease', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check('tenant cannot report against another lease', true);
  end;

  insert into public.payments (lease_id, amount, method, status, reported_by_tenant)
  values (lease_a, 100, 'ach', 'pendiente', true) returning id into pay_id;
  perform pg_temp.check('tenant CAN report a payment on own lease', pay_id is not null);

  begin
    update public.payments set status = 'confirmado' where id = pay_id;
    get diagnostics n = row_count;
    perform pg_temp.check('tenant cannot update payments', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.check('tenant cannot update payments', true);
  end;

  begin
    update public.tenants set full_name = 'Hacked' where id = (select tenant_id from public.profiles where id = tenant_a);
    perform pg_temp.check('tenant cannot rename themselves', false);
  exception when raise_exception or insufficient_privilege then
    perform pg_temp.check('tenant cannot rename themselves', true);
  end;

  update public.tenants set phone = '(915) 555-0000' where id = (select tenant_id from public.profiles where id = tenant_a);
  get diagnostics n = row_count;
  perform pg_temp.check('tenant CAN update own phone', n = 1);

  begin
    insert into public.work_orders (unit_id, lease_id, source, category, title)
    select unit_id, lease_a, 'personal', 'otro', 'escalated' from public.leases where id = lease_a;
    perform pg_temp.check('tenant cannot forge work order source', false);
  exception when insufficient_privilege or check_violation or no_data_found then
    perform pg_temp.check('tenant cannot forge work order source', true);
  end;

  -- ==================== prompt 19 tables stay entirely staff-only
  -- Both hold internal records. A notice reaches the tenant as a delivered
  -- document; the turnover checklist is none of their business.
  select count(*) into n from public.lease_notices;
  perform pg_temp.check('tenant cannot read lease notices', n = 0);
  select count(*) into n from public.unit_turnover_checklist;
  perform pg_temp.check('tenant cannot read the turnover checklist', n = 0);

  begin
    insert into public.lease_notices (lease_id, type, vacate_date, delivery)
    values (lease_a, 'non_payment', current_date + 3, 'in_person');
    perform pg_temp.check('tenant cannot write a notice to vacate', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check('tenant cannot write a notice to vacate', true);
  end;

  begin
    update public.unit_turnover_checklist set completed = true where true;
    get diagnostics n = row_count;
    perform pg_temp.check('tenant cannot tick off turnover items', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.check('tenant cannot tick off turnover items', true);
  end;

  -- ============================ access requests are staff-only
  -- The public form writes through an edge function under the service role.
  -- The table itself must be closed to tenants in both directions.
  select count(*) into n from public.access_requests;
  perform pg_temp.check('tenant cannot read access requests', n = 0);

  begin
    insert into public.access_requests (full_name, email)
    values ('Intruder', 'intruder@example.com');
    perform pg_temp.check('tenant cannot write an access request', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check('tenant cannot write an access request', true);
  end;

  -- ============================================ manager vs admin privileges
  perform pg_temp.act_as(manager_id);

  select count(*) into n from public.access_requests;
  perform pg_temp.check('staff CAN read access requests', n >= 0);

  select count(*) into n from public.unit_turnover_checklist;
  perform pg_temp.check('staff CAN read the turnover checklist', n > 0);

  select id into pay_id from public.payments where status = 'confirmado' limit 1;
  begin
    update public.payments set status = 'cancelado', void_reason = 'test' where id = pay_id;
    perform pg_temp.check('manager cannot void a payment', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.check('manager cannot void a payment', true);
  end;

  begin
    delete from public.properties where true;
    get diagnostics n = row_count;
    perform pg_temp.check('manager cannot delete properties', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.check('manager cannot delete properties', true);
  end;

  perform pg_temp.act_as(admin_id);
  update public.payments set status = 'cancelado', void_reason = 'test' where id = pay_id;
  get diagnostics n = row_count;
  perform pg_temp.check('admin CAN void a payment', n = 1);

  begin
    perform pg_temp.act_as(manager_id);
    update public.profiles set role = 'admin' where id = manager_id;
    perform pg_temp.check('manager cannot promote themselves', false);
  exception when insufficient_privilege then
    perform pg_temp.check('manager cannot promote themselves', true);
  end;

  begin
    perform pg_temp.act_as(manager_id);
    insert into public.profiles (full_name, role, org_id)
    values ('Planted admin', 'admin', (select org_id from public.profiles where id = manager_id));
    perform pg_temp.check('manager cannot create an admin', false);
  exception when insufficient_privilege then
    perform pg_temp.check('manager cannot create an admin', true);
  end;

  -- QA A-01: an admin must not be able to reach the platform role.
  perform pg_temp.act_as(admin_id);
  begin
    update public.profiles set role = 'super_admin' where id = admin_id;
    perform pg_temp.check('admin cannot promote themselves to super_admin', false);
  exception when insufficient_privilege then
    perform pg_temp.check('admin cannot promote themselves to super_admin', true);
  end;
  begin
    update public.profiles set org_id = null where id = admin_id;
    perform pg_temp.check('admin cannot leave their organization', false);
  exception when insufficient_privilege then
    perform pg_temp.check('admin cannot leave their organization', true);
  end;
  begin
    insert into public.profiles (full_name, role, org_id)
    values ('Planted platform', 'super_admin', (select org_id from public.profiles where id = admin_id));
    perform pg_temp.check('admin cannot create a super_admin', false);
  exception when insufficient_privilege then
    perform pg_temp.check('admin cannot create a super_admin', true);
  end;

  reset role;
end;
$$;

-- ================================================ cross-organization leaks
-- RENTIO_MIGRATION_SPEC §6 step 5: the test that matters. A second company
-- with one of everything; org A must not see, touch, or point at any of it.

do $$
declare
  admin_a uuid := '00000000-0000-0000-0000-0000000000a1';
  admin_b uuid := '00000000-0000-0000-0000-0000000000c1';
  super_id uuid := '00000000-0000-0000-0000-0000000000d1';
  org_a uuid := (select id from public.organizations order by created_at limit 1);
  org_b uuid; prop_b uuid; unit_b uuid; lease_b uuid; tenant_b uuid; inv_b uuid; wo_b uuid;
  n int; folio text;
begin
  -- Fixtures, written as the table owner (RLS does not apply) with no
  -- caller identity, like the app server's service connection.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.org_id', '', true);
  insert into public.organizations (name, slug) values ('Other Co', 'other-co') returning id into org_b;
  perform pg_temp.check('a new organization gets its settings row', (select count(*) from public.settings where org_id = org_b) = 1);
  update public.settings set invoice_prefix = 'OTH' where org_id = org_b;
  insert into public.properties (org_id, name) values (org_b, 'B Tower') returning id into prop_b;
  -- descendants take org_id from their parent
  insert into public.units (property_id, unit_number) values (prop_b, 'B1') returning id into unit_b;
  insert into public.tenants (org_id, full_name) values (org_b, 'B Renter') returning id into tenant_b;
  insert into public.leases (unit_id, start_date, end_date, rent_amount)
    values (unit_b, current_date, current_date + 365, 1000) returning id into lease_b;
  insert into public.lease_tenants (lease_id, tenant_id) values (lease_b, tenant_b);
  insert into public.invoices (lease_id, period_month, due_date)
    values (lease_b, date_trunc('month', current_date), current_date) returning id into inv_b;
  insert into public.work_orders (unit_id, lease_id, title) values (unit_b, lease_b, 'B leak') returning id into wo_b;
  insert into public.profiles (id, full_name, role, org_id) values
    (admin_b, 'Admin B', 'admin', org_b),
    (super_id, 'PortfolioAI', 'super_admin', null);

  perform pg_temp.check('trigger derived org_id for a unit', (select org_id from public.units where id = unit_b) = org_b);
  perform pg_temp.check('trigger derived org_id for an invoice', (select org_id from public.invoices where id = inv_b) = org_b);

  begin
    insert into public.units (property_id, unit_number, org_id) values (prop_b, 'B2', org_a);
    perform pg_temp.check('child row cannot claim another org than its parent', false);
  exception when insufficient_privilege then
    perform pg_temp.check('child row cannot claim another org than its parent', true);
  end;

  set local role authenticated;

  -- ------------------------------------------------ org A admin, by direct id
  perform pg_temp.act_as(admin_a);
  select count(*) into n from public.properties where id = prop_b;
  perform pg_temp.check('org A cannot read org B property', n = 0);
  select count(*) into n from public.units where id = unit_b;
  perform pg_temp.check('org A cannot read org B unit', n = 0);
  select count(*) into n from public.leases where id = lease_b;
  perform pg_temp.check('org A cannot read org B lease', n = 0);
  select count(*) into n from public.invoices where id = inv_b;
  perform pg_temp.check('org A cannot read org B invoice', n = 0);
  select count(*) into n from public.work_orders where id = wo_b;
  perform pg_temp.check('org A cannot read org B work order', n = 0);
  select count(*) into n from public.tenants where id = tenant_b;
  perform pg_temp.check('org A cannot read org B tenant', n = 0);
  select count(*) into n from public.profiles where id = admin_b;
  perform pg_temp.check('org A cannot read org B staff', n = 0);
  select count(*) into n from public.my_lease_details where lease_id = lease_b;
  perform pg_temp.check('my_lease_details does not leak org B', n = 0);
  select count(*) into n from public.settings;
  perform pg_temp.check('org A sees only its own settings row', n = 1);
  select count(*) into n from public.public_settings where company_name = 'Other Co';
  perform pg_temp.check('public_settings does not leak org B', n = 0);
  select count(*) into n from public.organizations;
  perform pg_temp.check('org A sees only its own organization', n = 1);

  update public.properties set name = 'pwned' where id = prop_b;
  get diagnostics n = row_count;
  perform pg_temp.check('org A cannot update org B property', n = 0);
  delete from public.invoices where id = inv_b;
  get diagnostics n = row_count;
  perform pg_temp.check('org A cannot delete org B invoice', n = 0);

  begin
    insert into public.units (property_id, unit_number) values (prop_b, 'A-sneaks-in');
    perform pg_temp.check('org A cannot add a unit under org B property', false);
  exception when insufficient_privilege then
    perform pg_temp.check('org A cannot add a unit under org B property', true);
  end;

  begin
    insert into public.properties (name, org_id) values ('Planted', org_b);
    perform pg_temp.check('org A cannot insert a row into org B', false);
  exception when insufficient_privilege then
    perform pg_temp.check('org A cannot insert a row into org B', true);
  end;

  begin
    update public.properties set org_id = org_b where org_id = org_a;
    perform pg_temp.check('org A cannot move its rows into org B', false);
  exception when insufficient_privilege then
    perform pg_temp.check('org A cannot move its rows into org B', true);
  end;

  insert into public.properties (name) values ('A default org') returning id into prop_b;
  perform pg_temp.check('root insert defaults to the caller org',
    (select org_id from public.properties where id = prop_b) = org_a);

  -- ------------------------------------------------------------ org B admin
  perform pg_temp.act_as(admin_b);
  select count(*) into n from public.properties;
  perform pg_temp.check('org B sees only its own property', n = 1);
  select count(*) into n from public.leases;
  perform pg_temp.check('org B sees only its own lease', n = 1);
  folio := public.next_invoice_number();
  perform pg_temp.check('invoice numbers use the caller org prefix', folio like 'OTH-%');

  -- ------------------------------------------------------------ super admin
  perform pg_temp.act_as(super_id);
  select count(*) into n from public.organizations;
  perform pg_temp.check('super_admin sees every organization', n >= 2);
  select count(*) into n from public.properties;
  perform pg_temp.check('super_admin reads across organizations', n >= 5);
  begin
    insert into public.properties (name) values ('nowhere');
    perform pg_temp.check('super_admin with no company picked cannot insert', false);
  exception when not_null_violation or insufficient_privilege then
    perform pg_temp.check('super_admin with no company picked cannot insert', true);
  end;

  begin
    update public.properties set name = 'renamed by platform' where id = prop_b;
    get diagnostics n = row_count;
    perform pg_temp.check('platform view cannot update rows', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.check('platform view cannot update rows', true);
  end;
  begin
    delete from public.properties where id = prop_b;
    get diagnostics n = row_count;
    perform pg_temp.check('platform view cannot delete rows', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.check('platform view cannot delete rows', true);
  end;
  update public.profiles set full_name = 'PortfolioAI (renamed)' where id = super_id;
  get diagnostics n = row_count;
  perform pg_temp.check('super_admin can still edit their own profile', n = 1);

  -- a super_admin row that somehow carries an org is NOT platform staff
  -- (the owner edits below run with no caller identity, like the service connection)
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set org_id = org_b where id = super_id;
  set local role authenticated;
  perform pg_temp.act_as(super_id);
  select count(*) into n from public.properties where org_id = org_a;
  perform pg_temp.check('super_admin with an org_id gets no cross-org read', n = 0);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set org_id = null where id = super_id;
  set local role authenticated;
  perform pg_temp.act_as(super_id);

  -- ...and acting inside a company, scoped exactly like its admin
  perform set_config('request.jwt.claim.org_id', org_b::text, true);
  select count(*) into n from public.properties;
  perform pg_temp.check('super_admin acting in org B sees only org B', n = 1);
  select count(*) into n from public.organizations;
  perform pg_temp.check('super_admin acting in org B still lists every organization', n >= 2);
  insert into public.properties (name) values ('B by super') returning id into prop_b;
  perform pg_temp.check('super_admin acting in org B inserts into org B',
    (select org_id from public.properties where id = prop_b) = org_b);
  select count(*) into n from public.my_lease_details where lease_id = lease_b;
  perform pg_temp.check('super_admin acting in org B reads org B lease details', n = 1);
  perform set_config('request.jwt.claim.org_id', org_a::text, true);
  select count(*) into n from public.properties where id = prop_b;
  perform pg_temp.check('super_admin acting in org A cannot see org B property', n = 0);

  reset role;
  raise notice '--- all RLS assertions passed ---';
end;
$$;

-- ======================================== B-013 confirm_payment, D3 warnings
-- One transaction, staff of the payment's org only, oldest invoice first,
-- and a second confirm is a clear error rather than a second allocation.

do $$
declare
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  manager_id uuid := '00000000-0000-0000-0000-0000000000a2';
  tenant_a   uuid := '00000000-0000-0000-0000-0000000000b1';
  admin_b    uuid := '00000000-0000-0000-0000-0000000000c1';
  pay public.payments%rowtype;
  open_before numeric; allocated numeric; n int; result jsonb;
  inv_a uuid; inv_other uuid; lease_a uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.org_id', '', true);
  select * into pay from public.payments where status = 'pendiente' order by created_at limit 1;
  perform pg_temp.check('fixture: a pending payment', pay.id is not null);
  select coalesce(sum(b.balance), 0) into open_before
  from public.invoice_balances b join public.invoices i on i.id = b.invoice_id
  where i.lease_id = pay.lease_id and i.status <> 'cancelado' and b.balance > 0;

  set local role authenticated;

  perform pg_temp.act_as(tenant_a);
  begin
    perform public.confirm_payment(pay.id);
    perform pg_temp.check('tenant cannot confirm a payment', false);
  exception when insufficient_privilege then
    perform pg_temp.check('tenant cannot confirm a payment', true);
  end;

  perform pg_temp.act_as(admin_b);
  begin
    perform public.confirm_payment(pay.id);
    perform pg_temp.check('org B admin cannot confirm an org A payment', false);
  exception when no_data_found then
    perform pg_temp.check('org B admin cannot confirm an org A payment', true);
  end;

  perform pg_temp.act_as(manager_id);
  result := public.confirm_payment(pay.id);
  perform pg_temp.check('manager confirms a pending payment',
    (select status from public.payments where id = pay.id) = 'confirmado'
    and (select confirmed_by from public.payments where id = pay.id) = manager_id);
  select coalesce(sum(amount), 0), count(*) into allocated, n
  from public.payment_allocations where payment_id = pay.id;
  perform pg_temp.check('allocations = min(amount, open balance)', allocated = least(pay.amount, open_before));
  perform pg_temp.check('result reports the allocations', (result ->> 'allocations')::int = n
    and (result ->> 'credit')::numeric = pay.amount - allocated);
  -- oldest first: every allocated invoice but the newest is now fully paid
  perform pg_temp.check('allocation is oldest-first', not exists (
    select 1 from public.payment_allocations pa
    join public.invoices i on i.id = pa.invoice_id
    join public.invoice_balances b on b.invoice_id = i.id
    where pa.payment_id = pay.id and b.balance > 0
      and i.due_date < (select max(i2.due_date) from public.payment_allocations pa2
                        join public.invoices i2 on i2.id = pa2.invoice_id where pa2.payment_id = pay.id)));
  perform pg_temp.check('confirm writes activity_log', exists (
    select 1 from public.activity_log where entity_id = pay.id and action = 'confirm'));

  begin
    perform public.confirm_payment(pay.id);
    perform pg_temp.check('second confirm is refused', false);
  exception when raise_exception then
    perform pg_temp.check('second confirm is refused', true);
  end;
  select count(*) into n from public.payment_allocations where payment_id = pay.id;
  perform pg_temp.check('second confirm adds no allocations', n = (result ->> 'allocations')::int);

  -- -------------------------------- record_payment / void_payment roles
  perform pg_temp.act_as(tenant_a);
  begin
    perform public.record_payment(pay.lease_id, 10, current_date, 'cash');
    perform pg_temp.check('tenant cannot record a payment', false);
  exception when insufficient_privilege then
    perform pg_temp.check('tenant cannot record a payment', true);
  end;
  begin
    perform public.void_payment(pay.id, 'tenant');
    perform pg_temp.check('tenant cannot void a payment (rpc)', false);
  exception when insufficient_privilege then
    perform pg_temp.check('tenant cannot void a payment (rpc)', true);
  end;

  perform pg_temp.act_as(admin_b);
  begin
    perform public.record_payment(pay.lease_id, 10, current_date, 'cash');
    perform pg_temp.check('org B admin cannot record on an org A lease', false);
  exception when no_data_found then
    perform pg_temp.check('org B admin cannot record on an org A lease', true);
  end;
  begin
    perform public.void_payment(pay.id, 'other org');
    perform pg_temp.check('org B admin cannot void an org A payment', false);
  exception when no_data_found then
    perform pg_temp.check('org B admin cannot void an org A payment', true);
  end;

  perform pg_temp.act_as(manager_id);
  result := public.record_payment(pay.lease_id, 10, current_date, 'cash');
  perform pg_temp.check('manager CAN record a payment', exists (
    select 1 from public.payments where id = (result ->> 'payment_id')::uuid and status = 'confirmado'));
  begin
    perform public.void_payment(pay.id, 'manager');
    perform pg_temp.check('manager cannot void a payment (rpc)', false);
  exception when insufficient_privilege then
    perform pg_temp.check('manager cannot void a payment (rpc)', true);
  end;

  perform pg_temp.act_as(admin_id);
  perform public.void_payment(pay.id, 'rls test');
  perform pg_temp.check('admin CAN void a payment (rpc)',
    (select status from public.payments where id = pay.id) = 'cancelado'
    and not exists (select 1 from public.payment_allocations where payment_id = pay.id));
  begin
    perform public.void_payment(pay.id, 'twice');
    perform pg_temp.check('second void is refused', false);
  exception when raise_exception then
    perform pg_temp.check('second void is refused', true);
  end;
  perform pg_temp.act_as(manager_id);

  -- the nightly pieces are not reachable through the API as a person
  begin
    perform public.apply_payment(pay.id);
    perform pg_temp.check('staff cannot call apply_payment() directly', false);
  exception when insufficient_privilege then
    perform pg_temp.check('staff cannot call apply_payment() directly', true);
  end;
  begin
    perform public.nightly();
    perform pg_temp.check('staff cannot call nightly()', false);
  exception when insufficient_privilege then
    perform pg_temp.check('staff cannot call nightly()', true);
  end;
  begin
    perform public.generate_invoices_for_org(current_date, (select org_id from public.profiles where id = admin_b));
    perform pg_temp.check('staff cannot generate for another org', false);
  exception when insufficient_privilege then
    perform pg_temp.check('staff cannot generate for another org', true);
  end;

  -- --------------------------------------------- late_fee_warnings RLS
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.org_id', '', true);
  select lt.lease_id into lease_a from public.lease_tenants lt
    join public.profiles p on p.tenant_id = lt.tenant_id where p.id = tenant_a limit 1;
  select id into inv_a from public.invoices where lease_id = lease_a limit 1;
  select id into inv_other from public.invoices
    where lease_id not in (select lt.lease_id from public.lease_tenants lt
                           join public.profiles p on p.tenant_id = lt.tenant_id where p.id = tenant_a)
      and org_id = (select org_id from public.invoices where id = inv_a) limit 1;
  insert into public.late_fee_warnings (invoice_id, eligible_on) values
    (inv_a, current_date), (inv_other, current_date) on conflict do nothing;
  perform pg_temp.check('warning takes org_id from its invoice',
    (select org_id from public.late_fee_warnings where invoice_id = inv_a)
      = (select org_id from public.invoices where id = inv_a));

  set local role authenticated;
  perform pg_temp.act_as(tenant_a);
  select count(*) into n from public.late_fee_warnings where invoice_id = inv_a;
  perform pg_temp.check('tenant reads the warning on their own invoice', n = 1);
  select count(*) into n from public.late_fee_warnings where invoice_id = inv_other;
  perform pg_temp.check('tenant cannot read another tenant warning', n = 0);
  update public.late_fee_warnings set sent_at = now() where invoice_id = inv_a;
  get diagnostics n = row_count;
  perform pg_temp.check('tenant cannot mark a warning sent', n = 0);

  perform pg_temp.act_as(admin_id);
  select count(*) into n from public.late_fee_warnings where invoice_id in (inv_a, inv_other);
  perform pg_temp.check('staff read their org warnings', n = 2);
  begin
    insert into public.late_fee_warnings (invoice_id, eligible_on)
    select id, current_date from public.invoices
    where id not in (select invoice_id from public.late_fee_warnings) limit 1;
    perform pg_temp.check('staff cannot write warnings directly', false);
  exception when insufficient_privilege then
    perform pg_temp.check('staff cannot write warnings directly', true);
  end;

  perform pg_temp.act_as(admin_b);
  select count(*) into n from public.late_fee_warnings where invoice_id in (inv_a, inv_other);
  perform pg_temp.check('org B cannot read org A warnings', n = 0);

  reset role;
  raise notice '--- confirm_payment and warning assertions passed ---';
end;
$$;

-- ============================ keep one admin; the audit log is append-only
do $$
declare
  admin_id   uuid := '00000000-0000-0000-0000-0000000000a1';
  manager_id uuid := '00000000-0000-0000-0000-0000000000a2';
  n int; refused boolean := false; row_id uuid;
begin
  set local role authenticated;
  perform pg_temp.act_as(admin_id);
  select count(*) into n from public.profiles
  where org_id = public.current_org_id() and role = 'admin';
  perform pg_temp.check('last-admin test starts with exactly one admin', n = 1);

  begin
    update public.profiles set role = 'manager' where id = admin_id;
  exception when others then refused := sqlerrm like '%at least one admin%';
  end;
  perform pg_temp.check('the last admin cannot be demoted', refused);
  perform pg_temp.check('the last admin is still an admin',
    (select role from public.profiles where id = admin_id) = 'admin');

  update public.profiles set role = 'admin' where id = manager_id;
  update public.profiles set role = 'manager' where id = admin_id;
  perform pg_temp.check('an admin can step down once another admin exists',
    (select role from public.profiles where id = admin_id) = 'manager');

  perform pg_temp.act_as(manager_id);  -- the admin now
  insert into public.activity_log (actor_id, entity_type, action)
  values (manager_id, 'test', 'seeded') returning id into row_id;
  update public.activity_log set action = 'tampered' where id = row_id;
  perform pg_temp.check('staff cannot edit the audit log',
    (select action from public.activity_log where id = row_id) = 'seeded');
  delete from public.activity_log where id = row_id;
  perform pg_temp.check('staff cannot delete from the audit log',
    (select count(*) from public.activity_log where id = row_id) = 1);
  -- put the roles back for the blocks below
  update public.profiles set role = 'admin' where id = admin_id;
  update public.profiles set role = 'manager' where id = manager_id;
  reset role;
end;
$$;

-- ====================================================== notifications outbox
do $$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  tenant_a uuid := '00000000-0000-0000-0000-0000000000b1';
  tenant_b uuid := '00000000-0000-0000-0000-0000000000b2';
  lease_a uuid; pay uuid; wo uuid; n int; first_run int; second_run int;
  refused boolean := false;
begin
  set local role authenticated;
  -- the tenant reports a payment; staff refuse it → the tenant is told, with the reason
  perform pg_temp.act_as(tenant_a);
  select lt.lease_id into lease_a
  from public.lease_tenants lt join public.profiles p on p.tenant_id = lt.tenant_id
  where p.id = tenant_a limit 1;
  insert into public.payments (lease_id, amount, reported_by_tenant, status, method)
  values (lease_a, 50, true, 'pendiente', 'zelle') returning id into pay;
  perform pg_temp.act_as(admin_id);
  update public.payments set status = 'cancelado', void_reason = 'wrong amount' where id = pay;
  select count(*) into n from public.notifications where entity_id = pay and kind = 'payment_rejected';
  perform pg_temp.check('refusing a reported payment queues a notification', n >= 1);
  perform pg_temp.check('the refusal carries the reason',
    (select payload->>'reason' from public.notifications where entity_id = pay limit 1) = 'wrong amount');

  -- a status change on the tenant's request → the tenant is told
  select id into wo from public.work_orders where lease_id = lease_a order by created_at limit 1;
  if wo is not null then
    update public.work_orders
    set status = (case when status = 'resuelta' then 'cerrada' else 'resuelta' end)::public.wo_status
    where id = wo;
  end if;
  select count(*) into n from public.notifications where entity_id = wo and kind = 'work_order_status';
  perform pg_temp.check('a repair status change queues a notification', wo is null or n >= 1);

  -- fenced to the tenant it is for; the tenant may mark it read, nothing else
  perform pg_temp.act_as(tenant_a);
  select count(*) into n from public.notifications where entity_id = pay;
  perform pg_temp.check('tenant reads their own notification', n >= 1);
  update public.notifications set read_at = now() where entity_id = pay;
  perform pg_temp.check('tenant can mark it read',
    (select count(*) from public.notifications where entity_id = pay and read_at is null) = 0);
  begin
    update public.notifications set sent_at = null where entity_id = pay;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.check('tenant cannot touch delivery columns', refused);
  perform pg_temp.act_as(tenant_b);
  select count(*) into n from public.notifications where entity_id = pay;
  perform pg_temp.check('another tenant cannot read it', n = 0);
  reset role;

  -- reminders are once per invoice and tenant; a claim marks rows sent
  select public.queue_rent_reminders() into first_run;
  select public.queue_rent_reminders() into second_run;
  perform pg_temp.check('rent reminders are idempotent', second_run = 0);
  perform (select count(*) from public.claim_notifications(1000));
  select count(*) into n from public.notifications where sent_at is null;
  perform pg_temp.check('claim_notifications marks every pending row sent', n = 0);
  perform public.notification_result(
    (select id from public.notifications where entity_id = pay limit 1), null);
  select count(*) into n from public.notifications where entity_id = pay and sent_at is null;
  perform pg_temp.check('a failed send releases the row', n >= 1);
end;
$$;

-- ========================================== create_lease: one transaction
do $$
declare
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  unit_v    uuid; t1 uuid; t2 uuid; new_lease uuid; n int;
  refused   boolean := false;
  terms     jsonb;
begin
  set local role authenticated;
  perform pg_temp.act_as(admin_id);
  select id into unit_v from public.units
  where status = 'vacante' and org_id = public.current_org_id()
  order by id limit 1;
  select id into t1 from public.tenants order by id limit 1;
  select id into t2 from public.tenants order by id desc limit 1;
  perform pg_temp.check('create_lease test has a vacant unit and two tenants',
    unit_v is not null and t1 is not null and t2 is not null and t1 <> t2);
  terms := jsonb_build_object(
    'start_date', current_date, 'end_date', current_date + 365,
    'rent_amount', 1000, 'rent_due_day', 1, 'grace_days', 5,
    'late_fee_type', 'percent', 'late_fee_percent', 10, 'late_fee_amount', 0,
    'late_fee_over_cap_ack', false, 'deposit_amount', 1000);

  begin
    perform public.create_lease(unit_v, terms, t1, array[t2], array[t2], '[]'::jsonb);
  exception when others then
    refused := sqlerrm like '%one role%';
    if not refused then raise notice 'create_lease raised: %', sqlerrm; end if;
  end;
  perform pg_temp.check('create_lease refuses one person in two roles', refused);
  select count(*) into n from public.leases where unit_id = unit_v and status = 'activo';
  perform pg_temp.check('a refused lease leaves nothing behind', n = 0);
  perform pg_temp.check('a refused lease leaves the unit vacant',
    (select status from public.units where id = unit_v) = 'vacante');

  new_lease := public.create_lease(unit_v, terms, t1, array[t2], '{}',
    '[{"item":"Rekey","item_key":"rekey","position":0}]'::jsonb);
  select count(*) into n from public.lease_tenants where lease_id = new_lease;
  perform pg_temp.check('create_lease links every party', n = 2);
  perform pg_temp.check('create_lease occupies the unit',
    (select status from public.units where id = unit_v) = 'ocupada');
  select count(*) into n from public.unit_turnover_checklist where lease_id = new_lease;
  perform pg_temp.check('create_lease seeds the turnover checklist', n = 1);
  reset role;
end;
$$;

rollback;
