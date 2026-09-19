-- Rentio — demo login accounts. DEMO AND STAGING ONLY.
--
-- Never run this against production: it creates accounts with a known
-- password. Run it AFTER seed.sql, which creates the tenants these link to.
--
--   Admin    admin@rentio.mx     Rentio2026!
--   Manager  gerente@rentio.mx   Rentio2026!
--   Tenant   (first two tenants, by email from seed.sql)  Rentio2026!

begin;

do $$
declare
  demo_password constant text := 'Rentio2026!';
  rec record;
  uid uuid;
begin
  for rec in
    select 'admin@rentio.mx'::text as email, 'Mariana Torres Aguilar'::text as full_name,
           'admin'::user_role as role, null::uuid as tenant_id
    union all
    select 'gerente@rentio.mx', 'Diego Lozano Ibarra', 'manager', null
    union all
    -- The first three seeded tenants get portal access. The limit lives in a
    -- subquery: attached to the UNION it would truncate the staff rows too.
    select * from (
      select t.email, t.full_name, 'tenant'::user_role as role, t.id as tenant_id
      from public.tenants t
      join public.lease_tenants lt on lt.tenant_id = t.id and lt.role = 'primary'
      order by lt.created_at
      limit 3
    ) demo_tenants
  loop
    select id into uid from auth.users where email = rec.email;

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        rec.email, crypt(demo_password, gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', rec.full_name),
        '', '', '', ''
      );

      insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at)
      values (uid, uid::text, 'email',
              jsonb_build_object('sub', uid::text, 'email', rec.email, 'email_verified', true),
              now())
      on conflict (provider_id, provider) do nothing;
    else
      update auth.users set encrypted_password = crypt(demo_password, gen_salt('bf')) where id = uid;
    end if;

    insert into public.profiles (id, full_name, role, tenant_id, locale)
    values (uid, rec.full_name, rec.role, rec.tenant_id, 'es-MX')
    on conflict (id) do update
      set full_name = excluded.full_name,
          role      = excluded.role,
          tenant_id = excluded.tenant_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- GoTrue scans several auth.users text columns into NON-NULLABLE Go strings.
-- A hand-inserted row that leaves any of them NULL breaks EVERY sign-in on the
-- project with "Database error querying schema" — not just that user's. The
-- exact column set varies by GoTrue version, so fill whatever this project has
-- rather than naming them. Only NULLs are touched.
-- ---------------------------------------------------------------------------

do $$
declare
  col text;
begin
  for col in
    select c.column_name
    from information_schema.columns c
    where c.table_schema = 'auth'
      and c.table_name = 'users'
      and c.data_type in ('text', 'character varying')
      and (c.column_name like '%token%' or c.column_name in ('email_change', 'phone_change'))
  loop
    execute format('update auth.users set %I = %L where %I is null', col, '', col);
  end loop;
end;
$$;

commit;
