-- ============================================================================
-- Rentio — repair demo logins ("Database error querying schema")
--
-- GoTrue scans several auth.users text columns into non-nullable Go strings.
-- A row inserted by hand that leaves any of them NULL makes EVERY sign-in on
-- the project fail with "Database error querying schema" — not just that user.
--
-- This sets only NULL values to '', so it cannot clobber real data.
-- Safe to run more than once.
-- ============================================================================

do $$
declare
  col text;
  touched int;
begin
  for col in
    select c.column_name
    from information_schema.columns c
    where c.table_schema = 'auth'
      and c.table_name = 'users'
      and c.data_type in ('text', 'character varying')
      and (
        c.column_name like '%token%'
        or c.column_name in ('email_change', 'phone_change')
      )
  loop
    execute format('update auth.users set %I = %L where %I is null', col, '', col);
    get diagnostics touched = row_count;
    if touched > 0 then
      raise notice 'auth.users.% : filled % NULL value(s)', col, touched;
    end if;
  end loop;
end;
$$;

-- Identities are required for password sign-in; make sure each demo user has one.
insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email in (
  'admin@rentio.mx', 'gerente@rentio.mx',
  'maria.fernanda@example.mx', 'ana.sofia@example.mx', 'emiliano.rivas@example.mx'
)
and not exists (
  select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
)
on conflict do nothing;

-- Confirm the addresses so sign-in is not blocked pending verification.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    confirmed_at       = coalesce(confirmed_at, now())
where email like '%@rentio.mx' or email like '%@example.mx';

select email,
       email_confirmed_at is not null as confirmed,
       (select count(*) from auth.identities i where i.user_id = u.id) as identities
from auth.users u
order by email;
