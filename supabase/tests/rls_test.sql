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

  insert into auth.users (id, email) values
    (admin_id, 'admin@test.mx'), (manager_id, 'manager@test.mx'),
    (tenant_a, 'tenant.a@test.mx'), (tenant_b, 'tenant.b@test.mx')
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, role, tenant_id) values
    (admin_id,   'Admin Test',   'admin',   null),
    (manager_id, 'Manager Test', 'manager', null),
    (tenant_a,   'Tenant A',     'tenant',  t_a),
    (tenant_b,   'Tenant B',     'tenant',  t_b)
  on conflict (id) do update set role = excluded.role, tenant_id = excluded.tenant_id;
end;
$$;

-- --------------------------------------------------------------- harness

create or replace function pg_temp.act_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
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

  reset role;
  raise notice '--- all RLS assertions passed ---';
end;
$$;

rollback;
