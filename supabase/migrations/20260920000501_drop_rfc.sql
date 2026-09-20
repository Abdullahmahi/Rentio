-- Prompt 20's cleanup, pulled forward: `rfc` was captured for Mexican tax
-- invoicing (CFDI) that will never happen for a Texas landlord. Removing it
-- here keeps the tenant form and the self-update guard consistent with the
-- rest of the US localization.

alter table public.tenants drop column rfc;

create or replace function public.tenants_restrict_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff() then
    return new;
  end if;
  -- A tenant editing their own row may only touch contact columns.
  if new.full_name is distinct from old.full_name
     or new.notes is distinct from old.notes then
    raise exception 'You can only update your own contact details';
  end if;
  return new;
end;
$$;
