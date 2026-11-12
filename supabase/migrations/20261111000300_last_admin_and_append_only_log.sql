-- Two guards the audit found missing (audit-product-2026-10-28.md §1).
--
-- 1. A company always keeps one admin. Settings → Users let the only admin
--    pick "Property manager" for themselves; nobody could reach Users again
--    and the fix was SQL. Enforced here so every path (UI, API, a future
--    import) is covered. Row-level BEFORE triggers see rows already changed
--    by the same statement, so "demote every admin" refuses on the last one.
-- 2. The audit log is append-only. Staff had update and delete on
--    activity_log through the generic staff_update / admin_delete policies.

create or replace function public.profiles_keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_id() is null then
    return new;  -- the app server's service connection
  end if;
  if old.role = 'admin'
     and new.role is distinct from 'admin'
     and old.org_id is not null
     and not exists (
       select 1 from public.profiles
       where org_id = old.org_id and role = 'admin' and id <> old.id
     ) then
    raise exception 'A company needs at least one admin.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Named to sort after profiles_restrict_role_changes: triggers on one event
-- fire alphabetically, and a privilege refusal ("only platform staff") must
-- win over this one.
drop trigger if exists profiles_keep_one_admin on public.profiles;
drop trigger if exists profiles_zz_keep_one_admin on public.profiles;
create trigger profiles_zz_keep_one_admin
  before update on public.profiles
  for each row execute function public.profiles_keep_one_admin();

drop policy if exists staff_update on public.activity_log;
drop policy if exists admin_delete on public.activity_log;
