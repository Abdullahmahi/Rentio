-- A tenant's portal request may only say what is wrong: category, priority,
-- title, description and which of their leases it is about. Everything else
-- on work_orders is staff-only and is server-defaulted here, so a crafted
-- insert cannot arrive already "resuelta", priced, assigned to a vendor,
-- filed under another unit or org, or backdated (created_at drives the
-- §92.056 written-notice clock).
--
-- RLS (work_orders_tenant_insert) still decides WHETHER a tenant may insert:
-- own lease and source = 'portal'. This trigger decides WHAT they may set.
-- Photos live in work_order_photos and keep their own policy.
--
-- Trigger order: same-timing triggers fire alphabetically, so
--   guard_tenant_work_order_insert   (this: reset staff-only columns)
--   org_from_parent                  (derive org_id from the reset unit_id)
--   work_orders_set_written_notice   (portal order -> written_notice_at = created_at)
-- That keeps the existing written-notice semantics: it is always "now".

create or replace function public.guard_tenant_work_order_insert()
returns trigger
language plpgsql
-- Deliberately SECURITY INVOKER: current_user is the caller's role, and the
-- lease lookup below goes through the tenant's own RLS.
as $$
begin
  -- Staff, service_role and migrations insert as themselves. Only a
  -- non-staff authenticated caller (a tenant) is restricted.
  if current_user <> 'authenticated' or public.is_staff() then
    return new;
  end if;

  -- The unit follows the lease. If the lease isn't theirs the lookup finds
  -- nothing and RLS rejects the row anyway.
  new.unit_id := coalesce(
    (select l.unit_id from public.leases l where l.id = new.lease_id),
    new.unit_id
  );
  new.org_id                := null;  -- org_from_parent fills it from the unit
  new.reported_by_tenant    := public.my_tenant_id();
  new.status                := 'nueva';
  new.vendor_name           := null;
  new.vendor_phone          := null;
  new.cost                  := null;
  new.resolved_at           := null;
  new.affects_health_safety := false;
  new.written_notice_at     := null;  -- work_orders_set_written_notice sets it
  new.created_at            := now();
  new.updated_at            := null;
  -- ponytail: always re-draws the folio, so a defaulted insert burns one extra
  -- sequence number. Folios already have gaps; fine unless someone audits them.
  new.folio                 := public.next_work_order_folio();
  return new;
end;
$$;

drop trigger if exists guard_tenant_work_order_insert on public.work_orders;
create trigger guard_tenant_work_order_insert
  before insert on public.work_orders
  for each row execute function public.guard_tenant_work_order_insert();
